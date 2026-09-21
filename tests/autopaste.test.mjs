// Pins when auto-paste is allowed to fire.
//
// The behaviour being protected: a message box appearing is enough on its
// own — no popup, no button. The bug this replaced keyed the "already done"
// marker on the conversation, which on a profile page falls back to the
// pathname; that does not change while you stay on one profile, so the first
// compose box auto-pasted and every one after it was skipped until you
// navigated away.
import assert from 'node:assert';

// Mirrors maybeAutoPaste() in content/content.js.
function makeAutoPaste({ settings, template, isBlocked = () => false }) {
  const pasted = [];
  const run = async (box) => {
    if (!settings.autoPaste) return pasted;
    if (!template) return pasted;
    if (!box.empty) return pasted;
    if (box.dataset.progsuAutopasted === '1') return pasted;

    if (await isBlocked(box)) return pasted;
    if (!box.isConnected || !box.empty) return pasted;

    // The real code defers by 600ms; the guards are what matter here.
    if (!box.isConnected || !box.empty) return pasted;
    if (box.dataset.progsuAutopasted === '1') return pasted;
    box.dataset.progsuAutopasted = '1';
    pasted.push(box.name);
    return pasted;
  };
  return { run, pasted };
}

const mkBox = (name, o = {}) => Object.assign({
  name, empty: true, isConnected: true, dataset: {}
}, o);

let pass = 0;
const t = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

console.log('auto-fill on sight');

await t('a message box that appears is filled with no user action', async () => {
  const ap = makeAutoPaste({ settings: { autoPaste: true }, template: { body: 'hi' } });
  await ap.run(mkBox('box-1'));
  assert.deepEqual(ap.pasted, ['box-1']);
});

await t('THE REGRESSION: a second box on the same page also fills', async () => {
  // Same pathname, same recipient, different element. The old conversation
  // key made this a no-op; keying on the element makes it work.
  const ap = makeAutoPaste({ settings: { autoPaste: true }, template: { body: 'hi' } });
  await ap.run(mkBox('first'));
  await ap.run(mkBox('second'));
  assert.deepEqual(ap.pasted, ['first', 'second']);
});

await t('the same box is never filled twice by a re-render', async () => {
  const ap = makeAutoPaste({ settings: { autoPaste: true }, template: { body: 'hi' } });
  const box = mkBox('box-1');
  await ap.run(box);
  await ap.run(box); // scan() runs every 1200ms over the same element
  await ap.run(box);
  assert.deepEqual(ap.pasted, ['box-1']);
});

await t('a box the user already typed in is left alone', async () => {
  const ap = makeAutoPaste({ settings: { autoPaste: true }, template: { body: 'hi' } });
  await ap.run(mkBox('typed', { empty: false }));
  assert.deepEqual(ap.pasted, []);
});

console.log('\nwhen it must not fire');

await t('a blocked contact is not auto-filled', async () => {
  const ap = makeAutoPaste({
    settings: { autoPaste: true }, template: { body: 'hi' }, isBlocked: async () => true
  });
  await ap.run(mkBox('blocked'));
  assert.deepEqual(ap.pasted, []);
});

await t('a blocked box stays eligible if the verdict later clears', async () => {
  // The marker must not be burned by a run that never pasted, or reopening
  // the chat after a teammate removes the contact would silently do nothing.
  let blocked = true;
  const ap = makeAutoPaste({
    settings: { autoPaste: true }, template: { body: 'hi' },
    isBlocked: async () => blocked
  });
  const box = mkBox('box-1');
  await ap.run(box);
  assert.deepEqual(ap.pasted, []);
  blocked = false;
  await ap.run(box);
  assert.deepEqual(ap.pasted, ['box-1']);
});

await t('a box that vanished during the block check is not pasted into', async () => {
  const box = mkBox('vanishing');
  const ap = makeAutoPaste({
    settings: { autoPaste: true }, template: { body: 'hi' },
    isBlocked: async () => { box.isConnected = false; return false; }
  });
  await ap.run(box);
  assert.deepEqual(ap.pasted, []);
});

await t('auto-paste off means nothing fires', async () => {
  const ap = makeAutoPaste({ settings: { autoPaste: false }, template: { body: 'hi' } });
  await ap.run(mkBox('box-1'));
  assert.deepEqual(ap.pasted, []);
});

await t('no template means nothing fires', async () => {
  const ap = makeAutoPaste({ settings: { autoPaste: true }, template: null });
  await ap.run(mkBox('box-1'));
  assert.deepEqual(ap.pasted, []);
});

console.log('\n' + pass + ' assertions passed');
