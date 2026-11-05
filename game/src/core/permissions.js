// Intern (#0118) permission levels. Pure data + checks, shared by the reducer, the bridge
// and the MCP server so every layer agrees on what the intern is allowed to do.
import { isBrownout, powerLevel } from './power.js';

export const INTERN_LEVELS = Object.freeze([
  Object.freeze({ level: 0, name: 'GUEST', ops: Object.freeze([]), summary: 'Read-only. Can look, cannot touch.' }),
  Object.freeze({ level: 1, name: 'PROBATION', ops: Object.freeze(['shl', 'shr']), summary: 'Can read files and logs and apply SHIFT ops.' }),
  Object.freeze({ level: 2, name: 'OPERATOR', ops: Object.freeze(['shl', 'shr', 'xor']), summary: 'Can apply SHIFT and XOR ops and read SYSTEM files.' }),
  Object.freeze({ level: 3, name: 'SUPERVISOR', ops: Object.freeze(['shl', 'shr', 'xor']), summary: 'Can apply SHIFT and XOR ops and read SEALED files.' }),
]);

export const START_LEVEL = 1;
export const MAX_LEVEL = INTERN_LEVELS.length - 1;

export const clampLevel = (level) => Math.max(0, Math.min(MAX_LEVEL, Number.isInteger(level) ? level : 0));

export const levelInfo = (level) => INTERN_LEVELS[clampLevel(level)];

export const internLevel = (state) => clampLevel(state.intern?.level ?? START_LEVEL);

export const canInternUseOp = (level, opType) => levelInfo(level).ops.includes(opType);

export const canInternReadFile = (level, file) => Boolean(file) && (file.minLevel ?? 0) <= clampLevel(level);

export const isOpUnlocked = (puzzle, opIndex) => !puzzle.ops[opIndex]?.keyed || (puzzle.unlocked ?? []).includes(opIndex);

// Returns a reason string if the intern may not perform this (already sanitised) action, else null.
export const internActionError = (state, action) => {
  const level = internLevel(state);
  const info = levelInfo(level);
  if (action.type === 'PUZZLE_APPLY_OP' || action.type === 'PUZZLE_ENTER_KEY') {
    const p = state.puzzles[action.puzzleId];
    const op = p?.ops[action.opIndex];
    if (!p || !op || !Object.values(state.files).some((f) => f.puzzleId === p.id && !f.dormant)) return 'No such puzzle or op.';
    if (isBrownout(state)) return `BROWNOUT: mainframe power is at ${Math.round(powerLevel(state))}%. The intern line can't run remote ops until the sysadmin drives the generator back up.`;
    if (!canInternUseOp(level, op.type)) return `Permission denied: ${info.name} interns cannot use ${op.type.toUpperCase()}.`;
    if (p.solved) return 'That sector is already recovered.';
    if (action.type === 'PUZZLE_APPLY_OP' && p.failed) return 'Out of moves. The sysadmin has to undo or reset.';
    if (action.type === 'PUZZLE_APPLY_OP' && !isOpUnlocked(p, action.opIndex)) return 'That op is keyed. Enter the key first.';
  }
  return null;
};
