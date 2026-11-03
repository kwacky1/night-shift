// Pure 16-bit helpers. Every result is masked to 16 bits, so values stay in 0..0xFFFF.
export const WIDTH = 16;
export const MASK = 0xffff;

export const toWord = (n) => (Number(n) >>> 0) & MASK;

export const shl = (value, n = 1) => toWord(toWord(value) << n);

// Logical shift: zeros come in from the left.
export const shr = (value, n = 1) => toWord(toWord(value) >>> n);

export const xor = (value, mask) => toWord(toWord(value) ^ toWord(mask));

// Most significant bit first, ready for rendering left-to-right.
export const toBits = (value) => {
  const word = toWord(value);
  return Array.from({ length: WIDTH }, (_, i) => (word >>> (WIDTH - 1 - i)) & 1);
};

export const fromBits = (bits) => {
  if (bits.length !== WIDTH) throw new RangeError(`Expected ${WIDTH} bits, got ${bits.length}`);
  return bits.reduce((acc, bit) => ((acc << 1) | (bit ? 1 : 0)) & MASK, 0);
};

export const popcount = (value) => toBits(value).reduce((a, b) => a + b, 0);

export const toHex = (value) => '0x' + toWord(value).toString(16).toUpperCase().padStart(4, '0');

export const toBinary = (value) => toWord(value).toString(2).padStart(WIDTH, '0');
