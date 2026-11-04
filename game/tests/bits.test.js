import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shl, shr, xor, toBits, fromBits, popcount, toHex, toBinary, toWord } from '../src/logic/bits.js';

test('shl drops bits that fall off the top', () => {
  assert.equal(shl(0x0001), 0x0002);
  assert.equal(shl(0x8000), 0x0000);
  assert.equal(shl(0x00ff, 4), 0x0ff0);
  assert.equal(shl(0xf00f, 4), 0x00f0);
});

test('shr is logical (zero fill)', () => {
  assert.equal(shr(0x8000), 0x4000);
  assert.equal(shr(0x0001), 0x0000);
  assert.equal(shr(0xffff, 8), 0x00ff);
});

test('xor flips masked bits and stays 16-bit', () => {
  assert.equal(xor(0x00ff, 0xffff), 0xff00);
  assert.equal(xor(0x1234, 0x1234), 0);
  assert.equal(xor(0x1_0000, 0), 0);
});

test('toWord masks and handles negatives', () => {
  assert.equal(toWord(-1), 0xffff);
  assert.equal(toWord(0x12345), 0x2345);
});

test('toBits / fromBits round-trip, MSB first', () => {
  const bits = toBits(0x8001);
  assert.equal(bits.length, 16);
  assert.equal(bits[0], 1);
  assert.equal(bits[15], 1);
  assert.equal(bits.slice(1, 15).every((b) => b === 0), true);
  for (const v of [0, 1, 0xbeef, 0xffff, 0x5a5a]) assert.equal(fromBits(toBits(v)), v);
  assert.throws(() => fromBits([1, 0]));
});

test('formatting helpers', () => {
  assert.equal(popcount(0xf0f0), 8);
  assert.equal(toHex(0xbeef), '0xBEEF');
  assert.equal(toHex(5), '0x0005');
  assert.equal(toBinary(5), '0000000000000101');
});
