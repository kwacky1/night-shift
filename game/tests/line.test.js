import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFramed, localNetworkPermission, dialFailure, ownTabUrl, ALLOW_PROMPT } from '../src/bridge/line.js';

test('isFramed: top-level, framed, and a cross-origin parent that throws', () => {
  const top = {};
  top.top = top;
  top.self = top;
  assert.equal(isFramed(top), false);
  assert.equal(isFramed({ top: {}, self: {} }), true);
  const hostile = { self: {} };
  Object.defineProperty(hostile, 'top', { get: () => { throw new Error('SecurityError'); } });
  assert.equal(isFramed(hostile), true);
});

test('localNetworkPermission: feature-detected, errors ignored', async () => {
  assert.equal(await localNetworkPermission(undefined), null);
  assert.equal(await localNetworkPermission({}), null);
  assert.equal(await localNetworkPermission({ permissions: {} }), null);
  const throws = { permissions: { query: async () => { throw new TypeError('bad name'); } } };
  assert.equal(await localNetworkPermission(throws), null);
  const syncThrow = { permissions: { query() { throw new TypeError('bad name'); } } };
  assert.equal(await localNetworkPermission(syncThrow), null);
  for (const state of ['granted', 'prompt', 'denied']) {
    assert.equal(await localNetworkPermission({ permissions: { query: async () => ({ state }) } }), state);
  }
  assert.equal(await localNetworkPermission({ permissions: { query: async () => ({ state: 'weird' }) } }), null);
});

test('localNetworkPermission falls back to the newer loopback-network name', async () => {
  const asked = [];
  const nav = {
    permissions: {
      query: async ({ name }) => {
        asked.push(name);
        if (name !== 'loopback-network') throw new TypeError('unknown');
        return { state: 'prompt' };
      },
    },
  };
  assert.equal(await localNetworkPermission(nav), 'prompt');
  assert.deepEqual(asked, ['local-network-access', 'loopback-network']);
});

test('dialFailure in a frame: line blocked, own-tab button, Allow hint and the save warning', () => {
  for (const permission of [null, 'prompt', 'denied']) {
    const f = dialFailure({ framed: true, permission });
    assert.equal(f.title, 'LINE BLOCKED BY YOUR BROWSER');
    assert.match(f.text, /itch's frame/);
    assert.ok(f.openTab);
    assert.ok(f.hint.includes(`Allow '${ALLOW_PROMPT}'`));
    assert.match(f.hint, /own save/);
  }
});

test('dialFailure top-level: DIAL FAILED, no own-tab button, hint follows the permission', () => {
  const f = dialFailure({ attempts: 5 });
  assert.equal(f.title, 'DIAL FAILED');
  assert.equal(f.openTab, false);
  assert.match(f.text, /5 tries/);
  assert.match(f.text, /npx -y @kwacky1\/night-shift-mcp/);
  assert.match(dialFailure({ attempts: 1 }).text, /1 try\b/);
  assert.match(dialFailure({ permission: 'denied' }).hint, /blocking this page.*site settings/);
  assert.doesNotMatch(dialFailure({ permission: 'prompt' }).hint, /blocking/);
});

test('ownTabUrl keeps the page and sets ?intern= to the dialled address', () => {
  const frame = 'https://html-classic.itch.zone/html/20341346-2320942/index.html';
  assert.equal(new URL(ownTabUrl(frame, 'ws://localhost:7117')).searchParams.get('intern'), 'ws://localhost:7117');
  assert.ok(ownTabUrl(frame, 'ws://localhost:7117').startsWith(frame));
  const withParam = ownTabUrl(`${frame}?intern=ws://localhost:9000&x=1`, 'ws://localhost:7117');
  const u = new URL(withParam);
  assert.equal(u.searchParams.get('intern'), 'ws://localhost:7117');
  assert.equal(u.searchParams.get('x'), '1');
  assert.equal(new URL(ownTabUrl(`${frame}?intern=ws://localhost:9000`)).searchParams.get('intern'), 'ws://localhost:9000');
});
