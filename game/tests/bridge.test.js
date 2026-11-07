import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isLocalSocketUrl, handleBridgeMessage, sanitiseRemoteAction, REMOTE_ACTION_TYPES, connectIntern, LINE_TAKEN_CODE, QUIET_ATTEMPTS, DIAL_ATTEMPTS, PROTOCOL_VERSION, WELCOME_TIMEOUT_MS, parseControl } from '../src/bridge/api.js';
import { createStore } from '../src/core/store.js';
import { reducer } from '../src/core/reducer.js';
import { actions } from '../src/core/actions.js';
import { createInitialState, STATE_VERSION } from '../src/core/initialState.js';

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
  assert.deepEqual([...REMOTE_ACTION_TYPES].sort(), ['BLAME_SUBMIT', 'CHAT_SEND', 'PUZZLE_APPLY_OP', 'PUZZLE_ENTER_KEY']);
  const blame = sanitiseRemoteAction({ type: 'BLAME_SUBMIT', suspect: '0117', evidence: ['readme:1'], statement: 'hi', scripted: true, actor: 'player' });
  assert.deepEqual(blame, { type: 'BLAME_SUBMIT', suspect: '0117', evidence: ['readme:1'], statement: 'hi', actor: 'intern' });
  for (const bad of [{ suspect: '../x' }, { suspect: 'a', evidence: 'readme:1' }, { suspect: 'a', evidence: ['readme'] }, { suspect: 'a', statement: 5 }]) {
    assert.throws(() => sanitiseRemoteAction({ type: 'BLAME_SUBMIT', ...bad }), /Bad BLAME_SUBMIT/);
  }
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

// ---- connectIntern with a fake socket and fake timers ---------------------------------------

const fakeNet = () => {
  const sockets = [];
  class FakeSocket {
    static OPEN = 1;
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      this.listeners = {};
      sockets.push(this);
    }
    addEventListener(type, fn) {
      (this.listeners[type] ??= []).push(fn);
    }
    emit(type, event = {}) {
      for (const fn of this.listeners[type] ?? []) fn(event);
    }
    send(text) {
      this.sent.push(JSON.parse(text));
    }
    close() {
      this.readyState = 3;
    }
    accept() {
      this.readyState = 1;
      this.emit('open');
    }
    drop(code = 1006) {
      this.readyState = 3;
      this.emit('close', { code });
    }
  }
  const timers = [];
  let clock = 0;
  const setTimer = (fn, ms) => {
    const t = { fn, at: clock + ms, done: false };
    timers.push(t);
    return t;
  };
  const clearTimer = (t) => t && (t.done = true);
  const advance = (ms) => {
    clock += ms;
    for (const t of timers) if (!t.done && t.at <= clock) {
      t.done = true;
      t.fn();
    }
  };
  return { sockets, FakeSocket, opts: { WebSocketImpl: FakeSocket, setTimer, clearTimer, now: () => clock }, advance, timers };
};

test('another window taking the line reports "taken" and does not redial', () => {
  const net = fakeNet();
  const statuses = [];
  connectIntern('ws://localhost:7117', gameStore(), (s) => statuses.push(s), net.opts);
  net.sockets[0].accept();
  net.sockets[0].drop(LINE_TAKEN_CODE);
  assert.equal(statuses.at(-1), 'taken');
  net.advance(60000);
  assert.equal(net.sockets.length, 1, 'no automatic redial after losing the line');
});

test('an ordinary drop keeps redialling with backoff', () => {
  const net = fakeNet();
  const statuses = [];
  connectIntern('ws://localhost:7117', gameStore(), (s) => statuses.push(s), net.opts);
  net.sockets[0].accept();
  net.sockets[0].drop();
  assert.equal(statuses.at(-1), 'connecting');
  net.advance(1000);
  assert.equal(net.sockets.length, 2);
  net.sockets[1].drop();
  net.advance(1000);
  assert.equal(net.sockets.length, 2, 'backs off to 2 s');
  net.advance(1000);
  assert.equal(net.sockets.length, 3);
});

test('a quiet auto-dial stays SCRIPTED while it tries, then gives up', () => {
  const net = fakeNet();
  const statuses = [];
  connectIntern('ws://localhost:7117', gameStore(), (s) => statuses.push(s), { ...net.opts, quiet: true });
  for (let i = 0; i < QUIET_ATTEMPTS; i++) {
    net.sockets.at(-1).drop();
    net.advance(10000);
  }
  assert.equal(net.sockets.length, QUIET_ATTEMPTS);
  assert.ok(statuses.every((s) => s === 'offline'), `never shows DIALLING: ${statuses.join(',')}`);
  net.advance(60000);
  assert.equal(net.sockets.length, QUIET_ATTEMPTS, 'gave up');
});

test('a failed dial gives up with DIAL FAILED after DIAL_ATTEMPTS, with backoff', () => {
  const net = fakeNet();
  const seen = [];
  connectIntern('ws://localhost:7117', gameStore(), (s, d) => seen.push([s, d]), net.opts);
  for (let i = 1; i < DIAL_ATTEMPTS; i++) {
    net.sockets.at(-1).drop();
    assert.equal(seen.at(-1)[0], 'connecting');
    net.advance(10000);
  }
  net.sockets.at(-1).drop();
  assert.deepEqual(seen.at(-1), ['failed', { attempts: DIAL_ATTEMPTS }]);
  net.advance(60000);
  assert.equal(net.sockets.length, DIAL_ATTEMPTS, 'no more redials');
});

test('a framed dial (maxAttempts 1) fails on the first attempt instead of Dialling forever', () => {
  const net = fakeNet();
  const seen = [];
  connectIntern('ws://localhost:7117', gameStore(), (s, d) => seen.push([s, d]), { ...net.opts, maxAttempts: 1 });
  net.sockets[0].drop();
  assert.deepEqual(seen.map(([s]) => s), ['connecting', 'failed']);
  net.advance(60000);
  assert.equal(net.sockets.length, 1);
});

test('after being online, drops redial and the failure count starts again', () => {
  const net = fakeNet();
  const statuses = [];
  connectIntern('ws://localhost:7117', gameStore(), (s) => statuses.push(s), { ...net.opts, maxAttempts: 2 });
  net.sockets[0].drop();
  net.advance(10000);
  net.sockets[1].accept();
  net.sockets[1].drop();
  assert.equal(statuses.at(-1), 'connecting', 'the drop from an open line does not count');
  net.advance(10000);
  net.sockets[2].drop();
  assert.equal(statuses.at(-1), 'connecting');
  net.advance(10000);
  net.sockets[3].drop();
  assert.equal(statuses.at(-1), 'failed');
});

test('a quiet auto-dial never shows DIAL FAILED, even with maxAttempts 1', () => {
  const net = fakeNet();
  const statuses = [];
  connectIntern('ws://localhost:7117', gameStore(), (s) => statuses.push(s), { ...net.opts, quiet: true, maxAttempts: 1 });
  for (let i = 0; i < QUIET_ATTEMPTS; i++) {
    net.sockets.at(-1).drop();
    net.advance(10000);
  }
  assert.ok(statuses.every((s) => s === 'offline'), statuses.join(','));
});

test('a quiet auto-dial that gets through is a normal line', () => {
  const net = fakeNet();
  const statuses = [];
  connectIntern('ws://localhost:7117', gameStore(), (s) => statuses.push(s), { ...net.opts, quiet: true });
  net.sockets[0].drop();
  net.advance(1000);
  net.sockets[1].accept();
  assert.equal(statuses.at(-1), 'online');
  assert.equal(net.sockets[1].sent[0].type, 'hello');
  net.sockets[1].drop();
  assert.equal(statuses.at(-1), 'connecting', 'after being online, a drop shows as redialling');
});

test('noisy state updates are coalesced, everything else is sent at once', () => {
  const net = fakeNet();
  const store = gameStore();
  connectIntern('ws://localhost:7117', store, () => {}, net.opts);
  const sock = net.sockets[0];
  sock.accept();
  const states = () => sock.sent.filter((m) => m.type === 'state').map((m) => m.action);
  for (let i = 0; i < 8; i++) store.dispatch(actions.driveReport({ charge: 0.5, running: true, gear: 2, rpm: 3000 + i }));
  assert.deepEqual(states(), [], 'nothing yet: within the coalescing window');
  net.advance(1000);
  assert.deepEqual(states(), ['DRIVE_REPORT'], 'one trailing update');
  assert.equal(sock.sent.at(-1).state.power.generator.rpm, 3007, 'with the latest state');
  store.dispatch(actions.chatSend('hello'));
  assert.deepEqual(states(), ['DRIVE_REPORT', 'CHAT_SEND'], 'chat goes straight through');
});

test('handshake: a welcome keeps the line, a reject or silence means the driver is out of date', () => {
  const welcomed = fakeNet();
  const seen = [];
  connectIntern('ws://localhost:7117', gameStore(), (s, d) => seen.push([s, d]), welcomed.opts);
  welcomed.sockets[0].accept();
  const hello = welcomed.sockets[0].sent[0];
  assert.deepEqual([hello.type, hello.protocol, hello.version], ['hello', PROTOCOL_VERSION, STATE_VERSION]);
  welcomed.sockets[0].emit('message', { data: JSON.stringify({ type: 'welcome', protocol: PROTOCOL_VERSION, version: STATE_VERSION }) });
  welcomed.advance(WELCOME_TIMEOUT_MS * 2);
  assert.equal(seen.at(-1)[0], 'online');

  const rejected = fakeNet();
  const r = [];
  connectIntern('ws://localhost:7117', gameStore(), (s, d) => r.push([s, d]), rejected.opts);
  rejected.sockets[0].accept();
  rejected.sockets[0].emit('message', { data: JSON.stringify({ type: 'reject', reason: 'version', driver: { protocol: 2, version: 3 } }) });
  rejected.sockets[0].drop(4003);
  assert.equal(r.at(-1)[0], 'outdated');
  assert.equal(r.at(-1)[1].text, `INTERN DRIVER OUT OF DATE (game v${PROTOCOL_VERSION}.${STATE_VERSION}, driver v2.3)`);
  rejected.advance(60000);
  assert.equal(rejected.sockets.length, 1, 'no redial loop against an old driver');

  // An old driver drops our hello on the floor and never answers. That's the playtest bug.
  const silent = fakeNet();
  const q = [];
  connectIntern('ws://localhost:7117', gameStore(), (s, d) => q.push([s, d]), silent.opts);
  silent.sockets[0].accept();
  assert.equal(q.at(-1)[0], 'online');
  silent.advance(WELCOME_TIMEOUT_MS);
  assert.equal(q.at(-1)[0], 'outdated');
  assert.match(q.at(-1)[1].text, /driver older\)/);
  silent.sockets[0].drop(1000);
  silent.advance(60000);
  assert.equal(silent.sockets.length, 1);
});

test('handshake: a warn from the driver shows as line noise while online', () => {
  const net = fakeNet();
  const seen = [];
  connectIntern('ws://localhost:7117', gameStore(), (s, d) => seen.push([s, d]), net.opts);
  net.sockets[0].accept();
  net.sockets[0].emit('message', { data: JSON.stringify({ type: 'warn', reason: 'phase: too long' }) });
  assert.deepEqual(seen.at(-1), ['online', { warning: 'phase: too long' }]);
  assert.equal(parseControl('{"type":"dispatch"}'), null);
  assert.equal(parseControl('junk'), null);
});
