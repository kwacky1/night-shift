import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isLocalSocketUrl, handleBridgeMessage, sanitiseRemoteAction, REMOTE_ACTION_TYPES } from '../src/bridge/api.js';
import { createStore } from '../src/core/store.js';
import { reducer } from '../src/core/reducer.js';
import { actions } from '../src/core/actions.js';
import { createInitialState } from '../src/core/initialState.js';

const load = async (name) => JSON.parse(await readFile(new URL(`../data/${name}`, import.meta.url), 'utf8'));
const data = { files: await load('files.json'), puzzles: await load('puzzles.json') };

const gameStore = () => {
  const store = createStore(reducer, createInitialState(data));
  store.dispatch(actions.bootComplete());
  store.dispatch(actions.clockIn());
  return store;
};
const send = (store, action, id = 1) => handleBridgeMessage(store, JSON.stringify({ type: 'dispatch', id, action }));

test('intern bridge only accepts local socket URLs', () => {
  assert.equal(isLocalSocketUrl('ws://localhost:7117'), true);
  assert.equal(isLocalSocketUrl('ws://127.0.0.1:7117/path'), true);
  assert.equal(isLocalSocketUrl('wss://example.com'), false);
  assert.equal(isLocalSocketUrl('http://localhost:7117'), false);
  assert.equal(isLocalSocketUrl('not a url'), false);
});

test('only a short allowlist of actions can be sent remotely', () => {
  assert.deepEqual([...REMOTE_ACTION_TYPES].sort(), ['CHAT_SEND', 'PUZZLE_APPLY_OP', 'PUZZLE_ENTER_KEY']);
  for (const type of ['HYDRATE', 'OPEN_FILE', 'RENAME_FILE', 'PUZZLE_RESET', 'PUZZLE_UNDO', 'TICK', 'CLOCK_IN', 'constructor', '__proto__', 'toString']) {
    assert.throws(() => sanitiseRemoteAction({ type }), /not allowed remotely/, type);
  }
});

test('remote actions are rebuilt and stamped as the intern', () => {
  const a = sanitiseRemoteAction({ type: 'CHAT_SEND', text: 'hi', from: 'player', scripted: true, topic: 'key', actor: 'player' });
  assert.deepEqual(a, { type: 'CHAT_SEND', from: 'intern', text: 'hi', actor: 'intern' });
  const op = sanitiseRemoteAction({ type: 'PUZZLE_APPLY_OP', puzzleId: 'payroll', opIndex: 0, evil: 1 });
  assert.deepEqual(op, { type: 'PUZZLE_APPLY_OP', puzzleId: 'payroll', opIndex: 0, actor: 'intern' });
  assert.throws(() => sanitiseRemoteAction({ type: 'PUZZLE_APPLY_OP', puzzleId: 'payroll', opIndex: '0' }));
  assert.throws(() => sanitiseRemoteAction({ type: 'PUZZLE_APPLY_OP', puzzleId: '../etc', opIndex: 0 }));
  assert.throws(() => sanitiseRemoteAction(null));
  assert.throws(() => sanitiseRemoteAction([]));
});

test('handleBridgeMessage dispatches allowed actions and reports results', () => {
  const store = gameStore();
  assert.deepEqual(send(store, { type: 'PUZZLE_APPLY_OP', puzzleId: 'payroll', opIndex: 0 }, 'a1'), { type: 'result', id: 'a1', ok: true });
  assert.equal(store.getState().puzzles.payroll.value, 0x0006);
  const denied = send(store, { type: 'PUZZLE_APPLY_OP', puzzleId: 'payroll', opIndex: 2 }, 'a2');
  assert.equal(denied.ok, false);
  assert.match(denied.error, /PROBATION/);
  const hydrate = send(store, { type: 'HYDRATE', state: {} }, 'a3');
  assert.deepEqual(hydrate, { type: 'result', id: 'a3', ok: false, error: 'HYDRATE is not allowed remotely' });
  assert.equal(store.getState().phase, 'desktop');
});

test('handleBridgeMessage ignores junk without throwing', () => {
  const store = gameStore();
  const before = store.getState();
  for (const raw of ['nope', '{"type":"state"}', '{"type":"dispatch"}', 'x'.repeat(20000), JSON.stringify({ type: 'dispatch', id: {}, action: {} })]) {
    assert.equal(handleBridgeMessage(store, raw), null);
  }
  assert.equal(store.getState(), before);
});
