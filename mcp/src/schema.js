// zod schemas for everything the game sends us. Unknown keys are stripped, so the server only
// ever works with the fields it understands, and anything malformed is dropped at the door.
import { z } from 'zod';

const word = z.number().int().min(0).max(0xffff);
const shortText = z.string().max(200);
const id = z.string().min(1).max(64);

const Op = z.object({
  type: z.enum(['shl', 'shr', 'xor']),
  n: z.number().int().min(1).max(15).optional(),
  mask: word.optional(),
  keyed: z.boolean().optional(),
  hands: z.enum(['player', 'intern', 'both']).optional(),
});

const Puzzle = z.object({
  id,
  title: shortText.optional(),
  hint: z.string().max(500).optional(),
  start: word,
  target: word,
  value: word,
  moveLimit: z.number().int().min(1).max(64),
  history: z.array(word).max(64),
  by: z.array(z.enum(['player', 'intern'])).max(64).optional().default([]),
  internMoves: z.number().int().min(0).max(64).optional(),
  noop: z.object({ seq: z.number().int().min(0), op: z.number().int().min(0).max(15), by: z.enum(['player', 'intern']) }).nullable().optional().default(null),
  solvedBy: z.enum(['player', 'intern']).nullable().optional().default(null),
  unlocked: z.array(z.number().int().min(0).max(15)).max(16).optional().default([]),
  ops: z.array(Op).min(1).max(16),
  playerHides: z.array(z.string().max(16)).max(8).optional(),
  solved: z.boolean(),
  failed: z.boolean(),
});

const File = z.object({
  id,
  name: z.string().min(1).max(12),
  type: z.string().max(16),
  parent: id.nullable(),
  locked: z.boolean(),
  puzzleId: id.nullable().optional(),
  renameUnlock: z.string().max(12).nullable().optional(),
  lockedMessage: z.string().max(1000).nullable().optional(),
  hidden: z.boolean().optional().default(false),
  dormant: z.boolean().optional().default(false),
  minLevel: z.number().int().min(0).max(9).optional().default(0),
  app: z.string().max(32).nullable().optional(),
  content: z.string().max(64 * 1024).optional().default(''),
});

const Message = z.object({
  id: z.number().int().min(1),
  from: z.enum(['player', 'intern', 'system', 'ghost']),
  at: z.string().max(8),
  text: z.string().max(1000),
  scripted: z.boolean().optional(),
});

const level = z.number().min(0).max(100);

const Power = z.object({
  level,
  lowest: level.optional(),
  drainScale: z.number().min(0).max(1).optional().default(1),
  generator: z
    .object({ running: z.boolean(), stalled: z.boolean(), gear: z.number().int().min(-1).max(9), rpm: z.number().min(0).max(20000) })
    .partial()
    .optional()
    .default({}),
  config: z
    .object({
      drainPerMinute: z.number().min(0).max(100).optional(),
      thresholds: z.object({ flicker: level, brownout: level, critical: level }),
      nagBelow: level.optional().default(40),
    })
    .optional(),
});

const Ending = z.object({ id: z.string().max(32), title: z.string().max(64), text: z.string().max(500) });

// BLAME.EXE. The intern gets the suspects and limits, its own statement, whether the sysadmin
// has filed (not what they said) and the verdict once it's in. Evidence weights and ending rules
// are stripped here and never reach a tool.
const Blame = z.object({
  open: z.boolean(),
  config: z
    .object({
      maxEvidence: z.number().int().min(1).max(8).optional(),
      statementMax: z.number().int().min(1).max(500).optional(),
      suspects: z.array(z.object({ id: z.string().max(32), name: z.string().max(64) })).max(16),
    })
    .nullable()
    .optional()
    .default(null),
  player: z.object({}).nullable().optional().default(null),
  intern: z
    .object({ suspect: z.string().max(32), evidence: z.array(z.string().max(40)).max(8), statement: z.string().max(500), at: z.string().max(8).optional() })
    .nullable()
    .optional()
    .default(null),
  result: z.object({ suspect: z.string().max(32).nullable().optional(), ending: Ending }).nullable().optional().default(null),
});

export const GameState = z.object({
  version: z.number().int(),
  phase: z.string().max(16),
  clock: z.object({ elapsed: z.number().int().min(0), length: z.number().int().min(1) }),
  shiftNumber: z.number().int().min(1).optional().default(1),
  shiftEnd: z.object({ reason: z.enum(['clock', 'blackout', 'audit']), at: z.string().max(8), ending: Ending.optional() }).nullable().optional().default(null),
  power: Power.optional(),
  blame: Blame.optional(),
  stats: z.record(z.string().max(32), z.number().min(0)).refine((s) => Object.keys(s).length <= 32, 'Too many stats').optional(),
  files: z.record(id, File).refine((files) => Object.keys(files).length <= 500, 'Too many files'),
  puzzles: z.record(id, Puzzle).refine((p) => Object.keys(p).length <= 100, 'Too many puzzles'),
  log: z.array(z.object({ at: z.string().max(8), text: z.string().max(500) })).max(200),
  intern: z.object({
    level: z.number().int().min(0).max(9),
    messages: z.array(Message).max(500),
  }),
});

export const InboundMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), protocol: z.number().int(), version: z.number().int(), state: GameState }),
  z.object({ type: z.literal('state'), action: z.string().max(64), state: GameState }),
  z.object({ type: z.literal('result'), id: z.string().max(64), ok: z.boolean(), error: z.string().max(500).optional() }),
]);
