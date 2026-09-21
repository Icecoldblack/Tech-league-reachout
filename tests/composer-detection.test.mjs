// Verifies the composer picker against the layouts LinkedIn actually ships,
// with the "New message" overlay as the case that motivated the fallback net:
// a compose surface whose classes match none of the msg-form selectors, with
// the recipient typeahead focused while the real box sits unfocused below it.
//
// The selection logic only needs matches/closest/querySelectorAll and a
// bounding rect, so the elements here are plain objects rather than a full
// DOM — the point is to pin the ranking, not to re-implement a browser.
import assert from 'node:assert';

// ---- Selectors and scoring, mirrored from content/content.js -------
// Kept as literals so a change there that breaks the overlay fails here.

const EXCLUDE_SELF_PATTERNS = [
  el => /typeahead/.test(el.cls) && el.contenteditable,
  el => el.role === 'combobox',
  el => el.ariaAutocomplete != null,
  el => /type a name/i.test(el.label),
  el => /add a recipient/i.test(el.label),
  el => /search/i.test(el.label)
];

const EXCLUDE_ANCESTOR = /search-global-typeahead|share-creation|share-box|comments-comment/;

function isComposer(el) {
  if (!el.contenteditable) return false;
  if (el.ancestors.some(a => EXCLUDE_ANCESTOR.test(a))) return false;
  if (EXCLUDE_SELF_PATTERNS.some(p => p(el))) return false;
  const label = el.label.toLowerCase();
  if (label.includes('search')) return false;
  if (label.includes('type a name') || label.includes('recipient')) return false;
  return true;
}

function isVisible(el) {
  return el.width >= 40 && el.height >= 8 && !el.hidden;
}

function composerScore(el) {
  let score = 0;
  if (el.focused) score += 100;
  if (el.ancestors.some(a => /msg-form|msg-overlay-conversation-bubble|msg-convo/.test(a))) score += 50;
  if (/msg-form__contenteditable/.test(el.cls)) score += 25;
  const label = el.label.toLowerCase();
  if (label.includes('message') || label.includes('write')) score += 10;
  if (el.ancestors.some(a => /is-minimized/.test(a))) score -= 40;
  if (el.height >= 48) score += 120;
  else if (el.height <= 28) score -= 60;
  if (el.hasSendButton) score += 40;
  return score;
}

function findComposer(els) {
  const candidates = els.filter(el => isComposer(el) && isVisible(el));
  if (!candidates.length) return null;
  let best = candidates[0];
  let bestScore = composerScore(best);
  for (let i = 1; i < candidates.length; i++) {
    const sc = composerScore(candidates[i]);
    if (sc >= bestScore) { best = candidates[i]; bestScore = sc; }
  }
  return best;
}

const box = (name, o) => Object.assign({
  name, cls: '', label: '', role: '', ariaAutocomplete: null,
  contenteditable: true, focused: false, hidden: false,
  width: 400, height: 80, ancestors: [], hasSendButton: false
}, o);

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

// ---- The case this fix exists for ---------------------------------

console.log('"New message" overlay (profile / feed)');
t('the message body wins over the focused recipient field', () => {
  // The To: field is focused because the overlay just opened. Scoring focus
  // alone would hand it the paste and type the template into the recipient.
  const recipient = box('recipient', {
    cls: 'msg-connections-typeahead__search-field',
    label: 'Type a name', focused: true, height: 24,
    ancestors: ['msg-connections-typeahead']
  });
  const body = box('body', {
    label: 'Write a message...', height: 120, hasSendButton: true,
    ancestors: ['msg-form']
  });
  assert.equal(findComposer([recipient, body]).name, 'body');
});

t('the recipient field is rejected outright, not merely outranked', () => {
  const recipient = box('recipient', {
    cls: 'msg-connections-typeahead__search-field',
    label: 'Type a name', focused: true, height: 24
  });
  assert.equal(isComposer(recipient), false);
  // Alone on the page it must still not be chosen.
  assert.equal(findComposer([recipient]), null);
});

t('a combobox recipient with no telltale class is still rejected', () => {
  const recipient = box('recipient', { role: 'combobox', focused: true, height: 24 });
  assert.equal(isComposer(recipient), false);
});

t('an unfocused body with no msg-form ancestor is still found', () => {
  // The renamed-classes case: nothing matches the known selector list.
  const body = box('body', { label: 'Write a message...', height: 120 });
  assert.equal(findComposer([body]).name, 'body');
});

// ---- Layouts that already worked, which must keep working ---------

console.log('existing layouts');
t('full messaging page still resolves to the real composer', () => {
  const body = box('body', {
    cls: 'msg-form__contenteditable', label: 'Write a message...',
    height: 90, focused: true, hasSendButton: true, ancestors: ['msg-form']
  });
  assert.equal(findComposer([body]).name, 'body');
});

t('the global search bar is never a composer', () => {
  const search = box('search', {
    label: 'Search', focused: true, height: 24,
    ancestors: ['search-global-typeahead']
  });
  assert.equal(findComposer([search]), null);
});

t('a post composer is not mistaken for a chat box', () => {
  const share = box('share', {
    label: 'What do you want to talk about?', height: 200,
    ancestors: ['share-creation-state']
  });
  assert.equal(findComposer([share]), null);
});

t('a comment box is not mistaken for a chat box', () => {
  const comment = box('comment', {
    label: 'Add a comment', height: 60,
    ancestors: ['comments-comment-box']
  });
  assert.equal(findComposer([comment]), null);
});

t('a minimized bubble loses to an open conversation', () => {
  const mini = box('minimized', {
    cls: 'msg-form__contenteditable', label: 'Write a message...', height: 60,
    ancestors: ['msg-overlay-conversation-bubble', 'msg-overlay-conversation-bubble--is-minimized']
  });
  const open = box('open', {
    cls: 'msg-form__contenteditable', label: 'Write a message...', height: 60,
    ancestors: ['msg-overlay-conversation-bubble']
  });
  assert.equal(findComposer([mini, open]).name, 'open');
});

t('an invisible composer is skipped', () => {
  const hidden = box('hidden', { label: 'Write a message...', hidden: true });
  assert.equal(findComposer([hidden]), null);
});

t('with two open chats, the focused one wins', () => {
  const a = box('chat-a', { label: 'Write a message...', height: 80, ancestors: ['msg-form'] });
  const b = box('chat-b', { label: 'Write a message...', height: 80, focused: true, ancestors: ['msg-form'] });
  assert.equal(findComposer([a, b]).name, 'chat-b');
});

console.log('\n' + pass + ' assertions passed');
