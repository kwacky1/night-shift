// Bit Rot puzzle engine. Puzzles are plain data:
// { id, title, start, target, moveLimit, ops: [{ type: 'shl'|'shr', n } | { type: 'xor', mask }] }
import { shl, shr, xor, toWord, toHex } from './bits.js';

export const OP_TYPES = ['shl', 'shr', 'xor'];

// Accepts numbers or strings like "0xBEEF", "0b1010" or "42". Returns NaN for junk.
export const parseNumber = (v) => {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return NaN;
  const s = v.trim().toLowerCase();
  if (/^0x[0-9a-f]+$/.test(s)) return parseInt(s.slice(2), 16);
  if (/^0b[01]+$/.test(s)) return parseInt(s.slice(2), 2);
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return NaN;
};

export const parseWord = (v) => toWord(parseNumber(v) || 0);

export const normaliseOp = (op) => {
  if (op.type === 'xor') return { type: 'xor', mask: parseWord(op.mask) };
  return { type: op.type, n: op.n ?? 1 };
};

export const normalisePuzzle = (p) => ({
  ...p,
  start: parseWord(p.start),
  target: parseWord(p.target),
  ops: (p.ops ?? []).map(normaliseOp),
});

export const applyOp = (value, op) => {
  switch (op.type) {
    case 'shl':
      return shl(value, op.n ?? 1);
    case 'shr':
      return shr(value, op.n ?? 1);
    case 'xor':
      return xor(value, parseWord(op.mask));
    default:
      throw new Error(`Unknown op: ${op.type}`);
  }
};

export const opLabel = (op) => {
  if (op.type === 'xor') return `XOR ${toHex(parseWord(op.mask))}`;
  return `${op.type === 'shl' ? '<<' : '>>'} ${op.n ?? 1}`;
};

export const isSolved = (value, puzzle) => toWord(value) === parseWord(puzzle.target);

// Returns a list of problems; empty means the puzzle is well formed.
export const validatePuzzle = (puzzle) => {
  const errors = [];
  if (!puzzle || typeof puzzle !== 'object') return ['puzzle must be an object'];
  if (!puzzle.id) errors.push('missing id');
  if (!Number.isInteger(puzzle.moveLimit) || puzzle.moveLimit < 1) errors.push('moveLimit must be a positive integer');
  if (!Array.isArray(puzzle.ops) || puzzle.ops.length === 0) errors.push('ops must be a non-empty array');
  for (const op of puzzle.ops ?? []) {
    if (!OP_TYPES.includes(op.type)) errors.push(`unknown op type: ${op.type}`);
    if (op.type !== 'xor' && op.n !== undefined && !(Number.isInteger(op.n) && op.n >= 1 && op.n <= 15))
      errors.push(`shift amount out of range: ${op.n}`);
    if (op.type === 'xor' && op.mask === undefined) errors.push('xor op missing mask');
  }
  for (const key of ['start', 'target']) {
    const v = parseNumber(puzzle[key]);
    if (!Number.isInteger(v) || v < 0 || v > 0xffff) errors.push(`${key} must be a 16-bit value`);
  }
  if (errors.length === 0 && isSolved(puzzle.start, puzzle)) errors.push('puzzle starts solved');
  return errors;
};

// Breadth-first search for the shortest op sequence. Returns indices into puzzle.ops, or null.
export const solve = (puzzle, maxDepth = puzzle.moveLimit) => {
  const start = parseWord(puzzle.start);
  const target = parseWord(puzzle.target);
  if (start === target) return [];
  const seen = new Map([[start, null]]);
  let frontier = [start];
  for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
    const next = [];
    for (const value of frontier) {
      for (let i = 0; i < puzzle.ops.length; i++) {
        const v = applyOp(value, puzzle.ops[i]);
        if (seen.has(v)) continue;
        seen.set(v, { prev: value, op: i });
        if (v === target) {
          const path = [];
          for (let cur = v; seen.get(cur); cur = seen.get(cur).prev) path.unshift(seen.get(cur).op);
          return path;
        }
        next.push(v);
      }
    }
    frontier = next;
  }
  return null;
};
