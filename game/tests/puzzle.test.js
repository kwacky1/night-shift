import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, isSolved, validatePuzzle, solve, opLabel, parseWord, normalisePuzzle } from '../src/logic/puzzle.js';

const sample = {
  id: 'sample',
  start: '0x00F0',
  target: '0x0F0F',
  moveLimit: 4,
  ops: [{ type: 'shl', n: 4 }, { type: 'shr', n: 4 }, { type: 'xor', mask: '0x0FFF' }],
};

test('parseWord accepts hex, binary and decimal', () => {
  assert.equal(parseWord('0xBEEF'), 0xbeef);
  assert.equal(parseWord('0b101'), 5);
  assert.equal(parseWord('42'), 42);
  assert.equal(parseWord(7), 7);
  assert.equal(parseWord('nonsense'), 0);
});

test('applyOp runs each op type', () => {
  assert.equal(applyOp(0x00f0, sample.ops[0]), 0x0f00);
  assert.equal(applyOp(0x00f0, sample.ops[1]), 0x000f);
  assert.equal(applyOp(0x00f0, sample.ops[2]), 0x0f0f);
  assert.throws(() => applyOp(1, { type: 'rol' }));
});

test('opLabel is human readable', () => {
  assert.equal(opLabel(sample.ops[0]), '<< 4');
  assert.equal(opLabel(sample.ops[1]), '>> 4');
  assert.equal(opLabel(sample.ops[2]), 'XOR 0x0FFF');
});

test('isSolved compares against target', () => {
  assert.equal(isSolved(0x0f0f, sample), true);
  assert.equal(isSolved(0x0f0e, sample), false);
});

test('validatePuzzle accepts a good puzzle and flags bad ones', () => {
  assert.deepEqual(validatePuzzle(sample), []);
  assert.ok(validatePuzzle({ ...sample, moveLimit: 0 }).length);
  assert.ok(validatePuzzle({ ...sample, ops: [] }).length);
  assert.ok(validatePuzzle({ ...sample, ops: [{ type: 'rol' }] }).length);
  assert.ok(validatePuzzle({ ...sample, ops: [{ type: 'xor' }] }).length);
  assert.ok(validatePuzzle({ ...sample, ops: [{ type: 'shl', n: 16 }] }).length);
  assert.ok(validatePuzzle({ ...sample, target: '0x10000' }).length);
  assert.ok(validatePuzzle({ ...sample, target: sample.start }).length);
  assert.ok(validatePuzzle({ ...sample, id: '' }).length);
});

test('solve finds the shortest path', () => {
  assert.deepEqual(solve(sample), [2]);
  const twoStep = { ...sample, target: '0xF0F0' };
  const path = solve(twoStep);
  assert.ok(path);
  const end = path.reduce((v, i) => applyOp(v, twoStep.ops[i]), parseWord(twoStep.start));
  assert.equal(end, 0xf0f0);
  assert.equal(path.length, 2);
});

test('solve returns null when unreachable within limit', () => {
  assert.equal(solve({ ...sample, ops: [{ type: 'shl', n: 1 }], target: '0x0001' }), null);
  assert.equal(solve({ ...sample, target: '0xF0F0', moveLimit: 1 }), null);
});

test('normalisePuzzle converts strings to numbers', () => {
  const p = normalisePuzzle(sample);
  assert.equal(p.start, 0xf0);
  assert.equal(p.ops[2].mask, 0x0fff);
  assert.equal(p.ops[0].n, 4);
});
