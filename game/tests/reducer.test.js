import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reducer } from '../src/core/reducer.js';
import { actions } from '../src/core/actions.js';
import { createInitialState } from '../src/core/initialState.js';
import { createStore } from '../src/core/store.js';
import { childrenOf, clockLabel, pathOf } from '../src/core/selectors.js';

const data = {
  files: [
    { id: 'docs', name: 'DOCS', type: 'folder' },
    { id: 'a', name: 'A.TXT', parent: 'docs', content: ['hello', 'world'] },
    { id: 'b', name: 'B.TXT', parent: 'docs' },
    { id: 'c', name: 'C.TXT', parent: 'docs' },
    { id: 'd', name: 'D.TXT', parent: 'docs' },
    { id: 'bak', name: 'LOG.BAK', parent: 'docs', locked: true, renameUnlock: 'LOG.TXT', lockedMessage: 'Backup.' },
    { id: 'pay', name: 'PAY.DAT', locked: true, puzzleId: 'p1' },
  ],
  puzzles: [{ id: 'p1', start: '0x00F0', target: '0xF0F0', moveLimit: 3, ops: [{ type: 'shl', n: 4 }, { type: 'xor', mask: '0x0FFF' }] }],
};

const fresh = () => createInitialState(data);
const run = (...acts) => acts.reduce(reducer, fresh());
const desktop = () => run(actions.bootComplete(), actions.clockIn());

test('initial state is plain serialisable JSON', () => {
  const s = fresh();
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
  assert.equal(s.phase, 'boot');
  assert.equal(s.files.a.content, 'hello\nworld');
  assert.equal(s.puzzles.p1.start, 0xf0);
  assert.ok(s.desktop.positions.docs);
  assert.equal(s.desktop.positions.a, undefined);
});

test('boot -> clock in -> desktop', () => {
  let s = fresh();
  s = reducer(s, actions.clockIn());
  assert.equal(s.phase, 'boot', 'cannot clock in before boot completes');
  s = reducer(s, actions.bootComplete());
  assert.equal(s.phase, 'clockin');
  s = reducer(s, actions.clockIn());
  assert.equal(s.phase, 'desktop');
  assert.match(s.log.at(-1).text, /clocked in/);
  assert.equal(s.log.at(-1).at, '22:00');
});

test('clock ticks from 22:00, wraps midnight, stops at 06:00', () => {
  let s = desktop();
  assert.equal(clockLabel(s), '22:00');
  s = reducer(s, actions.tick(125));
  assert.equal(clockLabel(s), '00:05');
  s = reducer(s, actions.tick(1000));
  assert.equal(clockLabel(s), '06:00');
  assert.equal(s.flags.shiftOver, true);
  assert.ok(s.alert);
  assert.equal(reducer(s, actions.tick()), s);
  assert.equal(reducer(fresh(), actions.tick()).clock.elapsed, 0, 'no ticking during boot');
});

test('opening files routes by type and lock state', () => {
  let s = reducer(desktop(), actions.openFile('docs'));
  assert.equal(s.windows.at(-1).kind, 'explorer');
  s = reducer(s, actions.openFile('a'));
  assert.equal(s.windows.at(-1).kind, 'viewer');
  s = reducer(s, actions.openFile('pay'));
  assert.equal(s.windows.at(-1).kind, 'bitrot');
  assert.equal(s.windows.length, 3);
  s = reducer(s, actions.openFile('bak'));
  assert.equal(s.windows.length, 3);
  assert.equal(s.alert.text, 'Backup.');
  s = reducer(s, actions.dismissAlert());
  assert.equal(s.alert, null);
});

test('reopening a file focuses the existing window', () => {
  let s = reducer(desktop(), actions.openFile('docs'));
  s = reducer(s, actions.openFile('a'));
  const before = s.windows.length;
  s = reducer(s, actions.openFile('docs'));
  assert.equal(s.windows.length, before);
  assert.equal(s.focusedWindowId, s.windows[0].id);
});

test('window focus, move, minimise, close', () => {
  let s = reducer(desktop(), actions.openFile('docs'));
  s = reducer(s, actions.openFile('a'));
  const [w1, w2] = s.windows;
  assert.equal(s.focusedWindowId, w2.id);
  s = reducer(s, actions.focusWindow(w1.id));
  assert.equal(s.focusedWindowId, w1.id);
  assert.ok(s.windows[0].z > s.windows[1].z);
  s = reducer(s, actions.moveWindow(w1.id, 300.4, -20));
  assert.deepEqual([s.windows[0].x, s.windows[0].y], [300, 0]);
  s = reducer(s, actions.minimiseWindow(w1.id));
  assert.equal(s.focusedWindowId, w2.id);
  s = reducer(s, actions.focusWindow(w1.id));
  assert.equal(s.windows[0].minimised, false);
  s = reducer(s, actions.closeWindow(w1.id));
  assert.equal(s.windows.length, 1);
  assert.equal(s.focusedWindowId, w2.id);
});

test('selection: click, Shift+click range, Ctrl+click toggle', () => {
  const sel = (s) => s.selection.ids;
  let s = reducer(desktop(), actions.selectFile('docs', 'b'));
  assert.deepEqual(sel(s), ['b']);
  s = reducer(s, actions.selectFile('docs', 'd', { shift: true }));
  assert.deepEqual(sel(s), ['b', 'c', 'd']);
  s = reducer(s, actions.selectFile('docs', 'a', { shift: true }));
  assert.deepEqual(sel(s), ['a', 'b'], 'range is re-anchored on the original anchor');
  s = reducer(s, actions.selectFile('docs', 'd', { ctrl: true }));
  assert.deepEqual(sel(s), ['a', 'b', 'd']);
  s = reducer(s, actions.selectFile('docs', 'a', { ctrl: true }));
  assert.deepEqual(sel(s), ['b', 'd']);
  s = reducer(s, actions.selectFile('docs', null));
  assert.deepEqual(sel(s), []);
  s = reducer(s, actions.selectFile('desktop', 'a'));
  assert.deepEqual(sel(s), [], 'ignores files outside the folder');
  const same = reducer(s, actions.selectFile('docs', null));
  assert.equal(same, s, 'unchanged selection keeps the same state object');
});

test('select set and moving desktop icons', () => {
  let s = reducer(desktop(), actions.selectSet('desktop', ['docs', 'pay', 'a']));
  assert.deepEqual(s.selection.ids, ['docs', 'pay']);
  const before = s.desktop.positions.docs;
  s = reducer(s, actions.moveIcons(['docs', 'pay'], 10, 5));
  assert.deepEqual(s.desktop.positions.docs, { x: before.x + 10, y: before.y + 5 });
});

test('rename validates 8.3 names and clashes', () => {
  let s = reducer(desktop(), actions.renameFile('a', 'notes.txt'));
  assert.equal(s.files.a.name, 'NOTES.TXT');
  s = reducer(s, actions.renameFile('a', 'waytoolongname.txt'));
  assert.equal(s.files.a.name, 'NOTES.TXT');
  assert.match(s.alert.text, /not a valid/);
  s = reducer(reducer(s, actions.dismissAlert()), actions.renameFile('a', 'B.TXT'));
  assert.match(s.alert.text, /already exists/);
  assert.equal(s.files.a.name, 'NOTES.TXT');
});

test('renaming a backup to its proper name restores it', () => {
  let s = reducer(desktop(), actions.renameFile('bak', 'LOG.OLD'));
  assert.equal(s.files.bak.locked, true);
  s = reducer(s, actions.renameFile('bak', 'log.txt'));
  assert.equal(s.files.bak.locked, false);
  s = reducer(s, actions.openFile('bak'));
  assert.equal(s.windows.at(-1).kind, 'viewer');
});

test('puzzle: solving unlocks the file', () => {
  let s = desktop();
  s = reducer(s, actions.applyOp('p1', 1));
  assert.equal(s.puzzles.p1.value, 0x0f0f);
  s = reducer(s, actions.applyOp('p1', 0));
  assert.equal(s.puzzles.p1.value, 0xf0f0);
  assert.equal(s.puzzles.p1.solved, true);
  assert.equal(s.files.pay.locked, false);
  assert.match(s.log.at(-1).text, /recovered in 2 moves/);
  assert.equal(reducer(s, actions.applyOp('p1', 0)), s, 'no moves after solving');
  s = reducer(s, actions.openFile('pay'));
  assert.equal(s.windows.at(-1).kind, 'viewer');
});

test('puzzle: running out of moves fails; undo and reset recover', () => {
  let s = desktop();
  for (let i = 0; i < 3; i++) s = reducer(s, actions.applyOp('p1', 0));
  assert.equal(s.puzzles.p1.failed, true);
  assert.equal(reducer(s, actions.applyOp('p1', 1)), s);
  s = reducer(s, actions.undo('p1'));
  assert.equal(s.puzzles.p1.failed, false);
  assert.equal(s.puzzles.p1.history.length, 2);
  s = reducer(s, actions.resetPuzzle('p1'));
  assert.equal(s.puzzles.p1.value, 0xf0);
  assert.equal(s.puzzles.p1.history.length, 0);
  assert.equal(reducer(s, actions.applyOp('p1', 9)), s, 'bad op index ignored');
});

test('reducer never mutates its input', () => {
  const s = desktop();
  const snapshot = JSON.stringify(s);
  reducer(s, actions.openFile('docs'));
  reducer(s, actions.applyOp('p1', 1));
  reducer(s, actions.renameFile('a', 'X.TXT'));
  reducer(s, actions.selectFile('docs', 'a'));
  assert.equal(JSON.stringify(s), snapshot);
});

test('store dispatches, notifies, rejects unknown actions, round-trips', () => {
  const store = createStore(reducer, fresh());
  const seen = [];
  const off = store.subscribe((s, prev, a) => seen.push(a.type));
  store.dispatch(actions.bootComplete());
  store.dispatch(actions.tick());
  assert.deepEqual(seen, ['BOOT_COMPLETE'], 'no-op actions do not notify');
  assert.throws(() => store.dispatch({ type: 'NOPE' }), TypeError);
  assert.throws(() => store.dispatch(null), TypeError);
  const json = store.serialise();
  const other = createStore(reducer, fresh());
  other.hydrate(json);
  assert.deepEqual(other.getState(), store.getState());
  off();
  store.dispatch(actions.clockIn());
  assert.equal(seen.length, 1);
});

test('selectors', () => {
  const s = fresh();
  assert.deepEqual(childrenOf(s, 'docs').map((f) => f.name), ['A.TXT', 'B.TXT', 'C.TXT', 'D.TXT', 'LOG.BAK']);
  assert.equal(pathOf(s, 'a'), 'C:\\DOCS\\A.TXT');
});
