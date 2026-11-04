import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reducer } from '../src/core/reducer.js';
import { actions } from '../src/core/actions.js';
import { createInitialState } from '../src/core/initialState.js';
import { childrenOf, unreadForPlayer } from '../src/core/selectors.js';
import { internActionError, canInternReadFile, levelInfo } from '../src/core/permissions.js';

const data = {
  files: [
    { id: 'intern', name: 'INTERN.EXE', type: 'app', app: 'intern' },
    { id: 'sys', name: 'SYSTEM', type: 'folder', hidden: true },
    { id: 'secret', name: 'NS-02.LOG', parent: 'sys', hidden: true, minLevel: 2, content: 'key is zero, one, one, seven' },
    { id: 'pay', name: 'PAY.DAT', locked: true, puzzleId: 'p1' },
    { id: 'badge', name: 'BADGE.DB', locked: true, puzzleId: 'k1' },
  ],
  puzzles: [
    { id: 'p1', start: '0x00F0', target: '0x0FF0', moveLimit: 3, ops: [{ type: 'shl', n: 4 }, { type: 'xor', mask: '0x00F0' }], onSolve: { internLevel: 2 } },
    { id: 'k1', start: '0x0001', target: '0x0116', moveLimit: 4, playerHides: ['hex'], ops: [{ type: 'shl', n: 1 }, { type: 'xor', mask: '0x0117', keyed: true }] },
  ],
};

const desktop = () => [actions.bootComplete(), actions.clockIn()].reduce(reducer, createInitialState(data));
const asIntern = (action) => ({ ...action, actor: 'intern' });

test('initial intern state starts on probation with a join message after clock in', () => {
  const s = desktop();
  assert.equal(s.intern.level, 1);
  assert.equal(levelInfo(s.intern.level).name, 'PROBATION');
  assert.equal(s.intern.messages.at(-1).from, 'system');
  assert.equal(unreadForPlayer(s), 1);
  assert.equal(unreadForPlayer(reducer(s, actions.chatRead())), 0);
});

test('hidden files are invisible to the player and cannot be opened', () => {
  const s = desktop();
  assert.ok(!childrenOf(s, 'desktop').some((f) => f.id === 'sys'));
  assert.ok(childrenOf(s, 'desktop', { includeHidden: true }).some((f) => f.id === 'sys'));
  assert.equal(s.desktop.positions.sys, undefined);
  const opened = reducer(s, actions.openFile('sys'));
  assert.equal(opened.windows.length, 0);
  assert.match(opened.alert.text, /Cannot find/);
});

test('app files open their own window kind', () => {
  const s = reducer(desktop(), actions.openFile('intern'));
  assert.equal(s.windows[0].kind, 'intern');
});

test('chat: player and intern messages, trimmed and capped', () => {
  let s = desktop();
  s = reducer(s, actions.chatSend('  hello   there  '));
  assert.deepEqual(
    { from: s.intern.messages.at(-1).from, text: s.intern.messages.at(-1).text },
    { from: 'player', text: 'hello there' },
  );
  assert.equal(reducer(s, actions.chatSend('   ')), s, 'empty messages are ignored');
  s = reducer(s, asIntern(actions.chatSend('x'.repeat(500), 'player')));
  assert.equal(s.intern.messages.at(-1).from, 'intern', 'remote messages are always from the intern');
  assert.equal(s.intern.messages.at(-1).text.length, 280);
});

test('scripted messages bump the pester count, remote ones cannot', () => {
  let s = desktop();
  s = reducer(s, actions.chatSend('no', 'intern', { scripted: true, topic: 'key' }));
  s = reducer(s, actions.chatSend('still no', 'intern', { scripted: true, topic: 'key' }));
  assert.equal(s.intern.pester.key, 2);
  assert.equal(s.intern.messages.at(-1).scripted, true);
  s = reducer(s, asIntern(actions.chatSend('sneaky', 'intern', { scripted: true, topic: 'key' })));
  assert.equal(s.intern.pester.key, 2);
  assert.equal(s.intern.messages.at(-1).scripted, undefined);
});

test('intern permissions gate ops; the player is never gated by intern level', () => {
  const s = desktop();
  assert.equal(internActionError(s, asIntern(actions.applyOp('p1', 0))), null);
  assert.match(internActionError(s, asIntern(actions.applyOp('p1', 1))), /PROBATION/);
  assert.equal(reducer(s, asIntern(actions.applyOp('p1', 1))), s);
  const byIntern = reducer(s, asIntern(actions.applyOp('p1', 0)));
  assert.equal(byIntern.puzzles.p1.value, 0x0f00);
  assert.match(byIntern.intern.messages.at(-1).text, /#0118 applied << 4/);
  assert.equal(reducer(s, actions.applyOp('p1', 1)).puzzles.p1.value, 0);
});

test('solving a puzzle with onSolve promotes the intern', () => {
  let s = desktop();
  s = reducer(s, actions.applyOp('p1', 0));
  s = reducer(s, actions.applyOp('p1', 1));
  assert.equal(s.puzzles.p1.solved, true);
  assert.equal(s.intern.level, 2);
  assert.match(s.intern.messages.at(-1).text, /OPERATOR/);
  assert.equal(canInternReadFile(s.intern.level, s.files.secret), true);
  assert.equal(canInternReadFile(1, s.files.secret), false);
});

test('keyed ops are locked until the right key is entered', () => {
  let s = desktop();
  assert.equal(reducer(s, actions.applyOp('k1', 1)), s, 'locked op does nothing');
  const bad = reducer(s, actions.enterKey('k1', 1, '0x1234'));
  assert.match(bad.alert.text, /REJECTED/);
  assert.deepEqual(bad.puzzles.k1.unlocked, []);
  assert.deepEqual(reducer(s, actions.enterKey('k1', 1, 'nonsense')).puzzles.k1.unlocked, []);
  s = reducer(s, actions.enterKey('k1', 1, '0x0117'));
  assert.deepEqual(s.puzzles.k1.unlocked, [1]);
  assert.match(s.intern.messages.at(-1).text, /Override key accepted/);
  s = reducer(s, actions.applyOp('k1', 1));
  assert.equal(s.puzzles.k1.value, 0x0116);
  assert.equal(s.puzzles.k1.solved, true);
});

test('intern needs OPERATOR to enter a key for an XOR op', () => {
  const s = desktop();
  assert.match(internActionError(s, asIntern(actions.enterKey('k1', 1, '0x0117'))), /cannot use XOR/);
  assert.equal(reducer(s, asIntern(actions.enterKey('k1', 1, '0x0117'))), s);
  const promoted = { ...s, intern: { ...s.intern, level: 2 } };
  const keyed = reducer(promoted, asIntern(actions.enterKey('k1', 1, '0x0117')));
  assert.deepEqual(keyed.puzzles.k1.unlocked, [1]);
  assert.equal(keyed.alert, null, 'intern key attempts never pop alerts on the player');
});
