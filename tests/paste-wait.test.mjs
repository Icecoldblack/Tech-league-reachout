// Pins the behaviour that makes "Paste to LinkedIn Chat" usable at all.
//
// Clicking into the chat box closes the popup, so a paste path that demands
// an already-open composer can never be satisfied from the popup button: the
// click that would satisfy the check is the click that dismisses the button.
// waitForComposer() is what breaks that, so these tests cover the waiting,
// not the selectors (composer-detection.test.mjs covers those).
import assert from 'node:assert';

// Mirrors waitForComposer() in content/content.js.
function makeWaiter({ findComposer, isVisible, getActiveBox }) {
  return function waitForComposer(budgetMs, now = Date.now, schedule = setTimeout) {
    const active = getActiveBox();
    const existing = (active && active.isConnected && isVisible(active))
      ? active
      : findComposer();
    if (existing) return Promise.resolve(existing);

    return new Promise(resolve => {
      const deadline = now() + budgetMs;
      const tick = () => {
        const box = findComposer();
        if (box) { resolve(box); return; }
        if (now() >= deadline) { resolve(null); return; }
        schedule(tick, 150);
      };
      schedule(tick, 150);
    });
  };
}

let pass = 0;
const t = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

console.log('waiting for a composer');

await t('an already-open composer resolves immediately', async () => {
  const box = { isConnected: true };
  const wait = makeWaiter({
    findComposer: () => box, isVisible: () => true, getActiveBox: () => null
  });
  assert.equal(await wait(4000), box);
});

await t('a composer that appears mid-wait is picked up', async () => {
  // The real sequence: the user clicks Paste, then opens the chat box.
  let box = null;
  let calls = 0;
  const wait = makeWaiter({
    findComposer: () => { calls++; return calls >= 3 ? (box = { isConnected: true }) : null; },
    isVisible: () => true,
    getActiveBox: () => null
  });
  const got = await wait(4000);
  assert.ok(got, 'should have resolved with the composer that appeared');
  assert.equal(got, box);
});

await t('no composer at all resolves null rather than hanging', async () => {
  let clock = 0;
  const wait = makeWaiter({
    findComposer: () => null, isVisible: () => true, getActiveBox: () => null
  });
  // Virtual clock so the budget expires without the test sleeping for it.
  const got = await wait(4000, () => (clock += 500), (fn) => fn());
  assert.equal(got, null);
});

await t('a stale activeBox is not reused once detached', async () => {
  const stale = { isConnected: false };
  const fresh = { isConnected: true };
  const wait = makeWaiter({
    findComposer: () => fresh, isVisible: () => true, getActiveBox: () => stale
  });
  assert.equal(await wait(4000), fresh);
});

await t('an invisible activeBox is not reused', async () => {
  // A minimized bubble stays connected but must not receive the paste.
  const hiddenActive = { isConnected: true, visible: false };
  const fresh = { isConnected: true, visible: true };
  const wait = makeWaiter({
    findComposer: () => fresh,
    isVisible: el => el.visible !== false,
    getActiveBox: () => hiddenActive
  });
  assert.equal(await wait(4000), fresh);
});

console.log('\nchoosing a frame');

// Mirrors findComposerFrame() in popup/popup.js.
async function findComposerFrame(frames, ask) {
  const results = await Promise.all(frames.map(async f => {
    try {
      const r = await ask(f.frameId);
      return (r && r.hasComposer) ? f.frameId : null;
    } catch (e) { return null; }
  }));
  const hits = results.filter(id => id != null);
  if (!hits.length) return null;
  const sub = hits.find(id => id !== 0);
  return sub != null ? sub : hits[0];
}

await t('the frame holding the composer is chosen over one that does not', async () => {
  const frames = [{ frameId: 0 }, { frameId: 7 }];
  const id = await findComposerFrame(frames, fid => ({ hasComposer: fid === 7 }));
  assert.equal(id, 7);
});

await t('a frame with no content script does not break the search', async () => {
  const frames = [{ frameId: 0 }, { frameId: 3 }, { frameId: 9 }];
  const id = await findComposerFrame(frames, fid => {
    if (fid === 3) throw new Error('no receiver'); // cross-origin, not injected
    return { hasComposer: fid === 9 };
  });
  assert.equal(id, 9);
});

await t('no composer anywhere returns null, so the caller can broadcast', async () => {
  const frames = [{ frameId: 0 }, { frameId: 2 }];
  const id = await findComposerFrame(frames, () => ({ hasComposer: false }));
  assert.equal(id, null);
});

await t('the top frame is used when it is the only one with a composer', async () => {
  const frames = [{ frameId: 0 }, { frameId: 4 }];
  const id = await findComposerFrame(frames, fid => ({ hasComposer: fid === 0 }));
  assert.equal(id, 0);
});

console.log('\n' + pass + ' assertions passed');
