import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { hexInWords, parseKey } from '../src/logic/words.js';
import { reducer } from '../src/core/reducer.js';
import { actions } from '../src/core/actions.js';
import { createInitialState } from '../src/core/initialState.js';

const load = async (name) => JSON.parse(await readFile(new URL(`../data/${name}`, import.meta.url), 'utf8'));
const data = { files: await load('files.json'), puzzles: await load('puzzles.json') };

test('parseKey: keys are always hex, however they are typed', () => {
  for (const typed of ['0x0117', '0X0117', '0117', '117', ' 0117 ', '0117h', '#0117', '0 1 1 7', 'zero one one seven', 'zero, one, one, seven', 'Zero-One-One-Seven', 'oh one one seven']) {
    assert.equal(parseKey(typed), 0x0117, typed);
  }
  assert.equal(parseKey('beef'), 0xbeef);
  assert.equal(parseKey('B, E, E, F'), 0xbeef);
  assert.equal(parseKey(hexInWords(0xa0c3)), 0xa0c3, 'round-trips hexInWords');
  assert.equal(parseKey(0x117), 0x117);
});

test('parseKey rejects junk and oversize values', () => {
  for (const bad of ['', '   ', 'banana', '0x10000', '12345', 'one two three four five', 'eleven', '0x', '0xg', 'zero one one sevens', null, undefined, {}, -1, 0x10000, 1.5, 'x'.repeat(80)]) {
    assert.ok(Number.isNaN(parseKey(bad)), String(bad));
  }
});

const badgeAt = (level = 2) => {
  const s = [actions.bootComplete(), actions.clockIn()].reduce(reducer, createInitialState(data));
  return { ...s, intern: { ...s.intern, level } };
};

test('the BADGE.DB key box accepts the key as the intern reads it out', () => {
  for (const typed of ['0117', '117', '0x0117', 'zero, one, one, seven', 'zero one one seven']) {
    const s = reducer(badgeAt(), actions.enterKey('badge', 3, typed));
    assert.deepEqual(s.puzzles.badge.unlocked, [3], typed);
    assert.equal(s.alert, null, typed);
  }
});

test('a wrong key is still rejected, including the old decimal reading', () => {
  for (const typed of ['279', '0x0118', 'zero one one eight', 'nope']) {
    const s = reducer(badgeAt(), actions.enterKey('badge', 3, typed));
    assert.deepEqual(s.puzzles.badge.unlocked, [], typed);
    assert.match(s.alert.text, /KEY REJECTED/, typed);
  }
});