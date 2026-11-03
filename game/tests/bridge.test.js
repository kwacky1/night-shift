import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLocalSocketUrl } from '../src/bridge/api.js';

test('intern bridge only accepts local socket URLs', () => {
  assert.equal(isLocalSocketUrl('ws://localhost:7117'), true);
  assert.equal(isLocalSocketUrl('ws://127.0.0.1:7117/path'), true);
  assert.equal(isLocalSocketUrl('wss://example.com'), false);
  assert.equal(isLocalSocketUrl('http://localhost:7117'), false);
  assert.equal(isLocalSocketUrl('not a url'), false);
});
