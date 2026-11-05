// Spell a 16-bit value out as four hex digits in words: 0x0117 -> "zero, one, one, seven".
// Used by hidden logs and the scripted intern so keys are never printed as plain numbers.
const DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'A', 'B', 'C', 'D', 'E', 'F'];

export const hexInWords = (value) =>
  [...((Number(value) >>> 0) & 0xffff).toString(16).padStart(4, '0')].map((d) => DIGITS[parseInt(d, 16)]).join(', ');

const WORD_DIGITS = Object.fromEntries([
  ...DIGITS.map((w, i) => [w.toLowerCase(), i]),
  ['oh', 0],
  ['nought', 0],
  ['nil', 0],
]);

// Parse an override key as typed by a person. Keys are ALWAYS hex, so bare digits are hex too:
// "0x0117", "0117", "117", "117h", "0 1 1 7" and "zero, one, one, seven" all give 0x0117.
// Returns NaN for anything else (including values over 16 bits).
export const parseKey = (input) => {
  if (typeof input === 'number') return Number.isInteger(input) && input >= 0 && input <= 0xffff ? input : NaN;
  if (typeof input !== 'string') return NaN;
  const s = input.trim().toLowerCase();
  if (!s || s.length > 64) return NaN;
  const hex = /^(?:0x|\$|#)?([0-9a-f]{1,4})h?$/.exec(s);
  if (hex) return parseInt(hex[1], 16);
  const tokens = s.split(/[\s,.;:/-]+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 4) return NaN;
  let value = 0;
  for (const t of tokens) {
    const d = t in WORD_DIGITS ? WORD_DIGITS[t] : /^[0-9a-f]$/.test(t) ? parseInt(t, 16) : NaN;
    if (Number.isNaN(d)) return NaN;
    value = value * 16 + d;
  }
  return value;
};