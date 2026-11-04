// Spell a 16-bit value out as four hex digits in words: 0x0117 -> "zero, one, one, seven".
// Used by hidden logs and the scripted intern so keys are never printed as plain numbers.
const DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'A', 'B', 'C', 'D', 'E', 'F'];

export const hexInWords = (value) =>
  [...((Number(value) >>> 0) & 0xffff).toString(16).padStart(4, '0')].map((d) => DIGITS[parseInt(d, 16)]).join(', ');
