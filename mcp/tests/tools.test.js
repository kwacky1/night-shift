import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { GameLink, isAllowedOrigin, isLocalHostHeader } from '../src/link.js';
import { createTools, notConnectedText } from '../src/tools.js';
import { actions } from '../../game/src/core/actions.js';
import { FakeGame, newStore, waitFor } from './fake-game.js';

let link;
let tools;
let game;

const call = async (name, args = {}) => {
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool, `tool ${name} exists`);
  const res = await tool.handler(args);
  return { text: res.content.map((c) => c.text).join('\n'), isError: Boolean(res.isError) };
};

const connectGame = async (store) => {
  game = new FakeGame(store);
  await game.connect(link.port);
  await waitFor(() => link.connected);
  return game;
};

beforeEach(async () => {
  link = new GameLink({ port: 0 });
  await link.start();
  tools = createTools(link);
});

afterEach(async () => {
  game?.close();
  game = null;
  await link.stop();
});

test('origin and host checks', () => {
  assert.ok(isAllowedOrigin(undefined));
  assert.ok(isAllowedOrigin('http://localhost:8080'));
  assert.ok(isAllowedOrigin('http://127.0.0.1:5500'));
  assert.ok(isAllowedOrigin('https://html-classic.itch.zone'));
  assert.ok(isAllowedOrigin('https://kwacky1.itch.io'));
  assert.ok(!isAllowedOrigin('https://evil.example'));
  assert.ok(!isAllowedOrigin('https://itch.zone.evil.example'));
  assert.ok(!isAllowedOrigin('null'));
  assert.ok(isAllowedOrigin('https://mine.example', ['https://mine.example']));
  assert.ok(isLocalHostHeader('localhost:7117'));
  assert.ok(isLocalHostHeader('127.0.0.1:7117'));
  assert.ok(isLocalHostHeader('[::1]:7117'));
  assert.ok(!isLocalHostHeader('attacker.example:7117'));
  assert.ok(!isLocalHostHeader(undefined));
});

test('the link only listens on loopback', () => {
  assert.equal(link.wss.address().address, '127.0.0.1');
});

test('a browser page from a foreign origin is refused', async () => {
  const bad = new FakeGame();
  await assert.rejects(bad.connect(link.port, { origin: 'https://evil.example' }), /403/);
  assert.equal(link.connected, false);
});

test('tools answer in character when no game is connected', async () => {
  for (const name of ['whoami', 'list_files', 'read_messages']) {
    const res = await call(name);
    assert.equal(res.text, notConnectedText(link.port));
    assert.match(res.text, /INTERN\.EXE/);
  }
});

test('tools wait for the sysadmin to clock in', async () => {
  await connectGame(newStore({ clockIn: false }));
  assert.match((await call('list_files')).text, /not clocked in/);
  assert.match((await call('whoami')).text, /PROBATION/);
});

test('the newest game window wins and the old one is closed with 4000', async () => {
  const first = await connectGame();
  const second = new FakeGame();
  await second.connect(link.port);
  await waitFor(() => first.closeCode === 4000);
  assert.ok(link.connected);
  second.store.dispatch(actions.chatSend('from the second window'));
  await waitFor(() => link.state.intern.messages.some((m) => m.text === 'from the second window'));
  second.close();
  await waitFor(() => !link.connected);
});

test('invalid and oversized messages from the game are dropped', async () => {
  await connectGame();
  const before = link.state;
  game.ws.send('not json');
  game.ws.send(JSON.stringify({ type: 'state', action: 'X', state: { nope: true } }));
  game.ws.send(JSON.stringify({ type: 'result', id: 'r999', ok: true }));
  game.ws.send(Buffer.from([1, 2, 3]), { binary: true });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(link.state, before);
  assert.ok(link.connected);
});

test('the link forgets the game when it disconnects', async () => {
  await connectGame();
  game.close();
  await waitFor(() => !link.connected);
  assert.equal((await call('whoami')).text, notConnectedText(link.port));
  await assert.rejects(link.dispatch({ type: 'CHAT_SEND', text: 'hi' }), /No game connected/);
});

test('whoami, list_files and read_file show the intern view', async () => {
  await connectGame();
  assert.match((await call('whoami')).text, /"clearance": "PROBATION"/);
  const files = (await call('list_files')).text;
  assert.match(files, /NS-02\.LOG {2}\[hidden, needs OPERATOR\]/);
  assert.match((await call('list_files', { path: 'C:\\C_DRIVE\\SYSTEM' })).text, /BOOTLOG\.TXT/);
  assert.match((await call('read_file', { path: 'BOOTLOG.TXT' })).text, /--- C:\\C_DRIVE\\SYSTEM\\BOOTLOG\.TXT ---/);
  assert.match((await call('read_file', { path: 'NS-02.LOG' })).text, /ACCESS DENIED/);
  assert.equal((await call('read_file', { path: '..\\..\\Windows\\win.ini' })).isError, true);
  assert.match((await call('read_logs', { limit: 5 })).text, /Badge 0117 clocked in/);
});

test('inspect_puzzle lists sectors and never shows the target', async () => {
  await connectGame();
  assert.match((await call('inspect_puzzle')).text, /"badge"/);
  const badge = (await call('inspect_puzzle', { puzzle: 'BADGE.DB' })).text;
  assert.match(badge, /0x0118/);
  assert.match(badge, /REDACTED/);
  assert.doesNotMatch(badge, /0x0FF0|0x0117/);
});

test('messages flow both ways', async () => {
  await connectGame();
  assert.equal((await call('message_player', { text: 'Hi, intern #0118 here.' })).text, 'Sent.');
  const last = game.store.getState().intern.messages.at(-1);
  assert.equal(last.from, 'intern');
  assert.equal(last.text, 'Hi, intern #0118 here.');

  assert.match((await call('read_messages')).text, /No new messages/);
  game.playerSays('Hello intern, the badge pattern is two lit nibbles in the middle.');
  await waitFor(() => link.state.intern.messages.at(-1).from === 'player');
  assert.match((await call('read_messages')).text, /SYSADMIN: Hello intern/);
  assert.match((await call('read_messages')).text, /No new messages/);
  assert.match((await call('read_messages', { all: true })).text, /YOU \(#0118\): Hi, intern/);
});

test('wait_for_player returns when the sysadmin types', async () => {
  await connectGame();
  const waiting = call('wait_for_player', { timeoutSeconds: 5 });
  setTimeout(() => game.playerSays('ok go'), 50);
  assert.match((await waiting).text, /SYSADMIN: ok go/);
});

test('wait_for_player gives up when the game disconnects', async () => {
  await connectGame();
  const waiting = call('wait_for_player', { timeoutSeconds: 5 });
  setTimeout(() => game.close(), 50);
  assert.equal((await waiting).text, notConnectedText(link.port));
});

test('PROBATION interns can shift but not XOR', async () => {
  await connectGame();
  const shifted = await call('shift_right', { puzzle: 'payroll' });
  assert.match(shifted.text, /CURRENT is now 0x0000.*Moves 1\/6/);
  assert.equal(game.store.getState().puzzles.payroll.value, 0);
  assert.match((await call('xor', { puzzle: 'payroll', mask: '0x0F0F' })).text, /PROBATION interns cannot use XOR/);
  assert.equal(game.store.getState().puzzles.payroll.history.length, 1);
  assert.match((await call('shift_left', { puzzle: 'payroll', n: 7 })).text, /no << 7 op/);
  assert.equal((await call('xor', { puzzle: 'payroll', mask: 'banana' })).isError, true);
  assert.equal((await call('enter_key', { puzzle: 'badge', key: 'banana' })).isError, true);
});

test('end to end: solve payroll together, get promoted, read the key, recover the badge', async () => {
  await connectGame();
  const store = game.store;
  // Payroll: intern shifts, the sysadmin does the XOR they are not cleared for yet.
  await call('shift_right', { puzzle: 'PAYROLL.DAT' });
  store.dispatch(actions.applyOp('payroll', 2));
  await waitFor(() => link.state.puzzles.payroll.value === 0x0f0f);
  await call('shift_left', { puzzle: 'payroll' });
  const promoted = await call('shift_left', { puzzle: 'payroll' });
  assert.match(promoted.text, /SECTOR RECOVERED/);
  assert.match((await call('whoami')).text, /OPERATOR/);

  // NS-02.LOG opens up and spells out the key in words.
  const log = (await call('read_file', { path: 'NS-02.LOG' })).text;
  assert.match(log, /zero, one, one, seven/);

  // A wrong key is rejected without spending a move.
  assert.match((await call('enter_key', { puzzle: 'badge', key: '0x1234' })).text, /KEY REJECTED/);
  assert.equal(store.getState().puzzles.badge.history.length, 0);

  // Badge: XOR FF00, keyed XOR 0117, << 4, XOR FF00 -> 0x0FF0.
  await call('xor', { puzzle: 'badge', mask: '0xFF00' });
  // Keys are always hex, however they're typed: words unlock, bare digits apply.
  assert.match((await call('enter_key', { puzzle: 'badge', key: 'zero, one, one, seven' })).text, /Key accepted/);
  const keyed = await call('xor', { puzzle: 'badge', mask: '0117' });
  assert.match(keyed.text, /Applied XOR 0x0117/);
  assert.deepEqual(store.getState().puzzles.badge.unlocked, [3]);
  await call('shift_left', { puzzle: 'badge' });
  const done = await call('xor', { puzzle: 'badge', mask: '0xFF00' });
  assert.match(done.text, /SECTOR RECOVERED/);
  assert.equal(store.getState().puzzles.badge.solved, true);
});

test('xor with a bare-digit key unlocks and applies in one go', async () => {
  const store = newStore();
  store.dispatch({ type: 'HYDRATE', state: { ...store.getState(), intern: { ...store.getState().intern, level: 2 } } });
  await connectGame(store);
  assert.match((await call('xor', { puzzle: 'badge', mask: '117' })).text, /Applied XOR 0x0117/);
  assert.match((await call('xor', { puzzle: 'payroll', mask: '0117' })).text, /No XOR with mask 0117/);
});

test('the agent cannot smuggle in other actions', async () => {
  await connectGame();
  const res = await link.dispatch({ type: 'HYDRATE', state: {} });
  assert.equal(res.ok, false);
  const res2 = await link.dispatch({ type: 'PUZZLE_APPLY_OP', puzzleId: 'payroll', opIndex: 2 });
  assert.equal(res2.ok, false);
  assert.equal(game.store.getState().puzzles.payroll.history.length, 0);
});

test('a raw client with no game state cannot use the tools', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${link.port}`);
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'hello', protocol: 1, state: {} }));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(link.connected, false);
  ws.close();
});

test('brownout: the intern can still chat but ops are refused', async () => {
  const store = newStore();
  await connectGame(store);
  store.dispatch(actions.hydrate({ ...store.getState(), power: { ...store.getState().power, level: 20 } }));
  await waitFor(() => link.state.power.level === 20);
  assert.match((await call('whoami')).text, /BROWNOUT/);
  assert.match((await call('shift_left', { puzzle: 'payroll' })).text, /BROWNOUT/);
  assert.equal(store.getState().puzzles.payroll.history.length, 0);
  assert.equal((await call('message_player', { text: 'please drive' })).isError, false);
  assert.equal(store.getState().intern.messages.at(-1).text, 'please drive');
});

test('after 06:00 the tools say the shift is over', async () => {
  const store = newStore();
  await connectGame(store);
  store.dispatch(actions.tick(480));
  await waitFor(() => link.state.phase === 'over');
  assert.match((await call('list_files')).text, /shift is over/);
  assert.match((await call('whoami')).text, /shiftOver/);
});
