// Role projection: what intern #0118 is allowed to know. The game sends the full state; this
// module is the only way tool handlers look at it.
//
// Asymmetry, by design:
// - The intern sees hidden SYSTEM files, the system event log and exact numbers (hex/binary).
// - The intern never sees a puzzle's TARGET (that is a picture on the sysadmin's screen) and
//   never sees a keyed op's mask until someone enters the key.
// - The player sees the target and current bit patterns but, on some sectors, no numbers at all.
import { toBinary, toHex } from '../../game/src/logic/bits.js';
import { opLabel, parseNumber } from '../../game/src/logic/puzzle.js';
import { livePuzzles, pathOf } from '../../game/src/core/selectors.js';
import { generatorSummary, isBitrotPowered, isBrownout, powerConfig, powerLevel, powerStatus } from '../../game/src/core/power.js';
import { canInternReadFile, canInternUseOp, internLevel, isOpUnlocked, levelInfo } from '../../game/src/core/permissions.js';

export const BADGE = '#0118';
const HOURS = (m) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
const SHIFT_START = 22 * 60;

const clock = (state) => {
  const m = (SHIFT_START + state.clock.elapsed) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

const nibbles = (v) => toBinary(v).match(/..../g).join(' ');

export const whoami = (state) => {
  const level = internLevel(state);
  const info = levelInfo(level);
  return {
    badge: BADGE,
    clearance: info.name,
    level,
    summary: info.summary,
    allowedOps: info.ops,
    clock: clock(state),
    shiftLeft: HOURS(Math.max(0, state.clock.length - state.clock.elapsed)),
    sysadminPhase: state.phase,
    ...(state.shiftNumber ? { shiftNumber: state.shiftNumber } : {}),
    ...(state.phase === 'over' ? { shiftOver: state.shiftEnd?.reason === 'blackout' ? 'BLACKOUT: the mainframe went down.' : 'The shift has ended (06:00).' } : {}),
    ...(state.power ? powerView(state) : {}),
  };
};

// Power is the sysadmin's job. The intern can only watch the needle and nag.
const powerView = (state) => {
  const status = powerStatus(state);
  const level = Math.round(powerLevel(state));
  const notes = {
    ok: 'Mainframe power is fine.',
    flicker: 'Power is getting low and the lights are flickering.',
    brownout: 'BROWNOUT: your line is browned out. Chat still works, but apply_op and enter_key are refused until power is back up.',
    critical: 'CRITICAL: Bit Rot ops are offline for everyone until power is back up.',
    blackout: 'BLACKOUT: the mainframe is down.',
  };
  const low = level < (powerConfig(state).nagBelow ?? 40);
  return {
    mainframePower: `${level}%`,
    powerStatus: status.toUpperCase(),
    generator: generatorSummary(state),
    powerNote: notes[status],
    canRunOps: !isBrownout(state) && isBitrotPowered(state),
    whoDrives: `Only the sysadmin can drive the generator (GEARGR~1.EXE on their desktop). You cannot.${low ? ' Power is low: nag them to drive.' : ''}`,
  };
};

// Dormant files are not on the drive yet, for anyone.
const visibleFiles = (state) => Object.values(state.files).filter((f) => f.id !== 'desktop' && !f.dormant);

export const filePath = (state, file) => pathOf(state, file.id);

export const fileEntry = (state, f) => {
  const level = internLevel(state);
  const tags = [];
  if (f.type === 'folder') tags.push('folder');
  if (f.hidden) tags.push('hidden');
  if (f.locked && f.puzzleId) tags.push('bit rot');
  else if (f.locked) tags.push('locked');
  if (!canInternReadFile(level, f)) tags.push(`needs ${levelInfo(f.minLevel).name}`);
  return { path: filePath(state, f), name: f.name, type: f.type, tags };
};

const depth = (path) => path.split('\\').length;

// Every file under folderId (default: the whole drive), in path order.
export const listFiles = (state, folderId = 'desktop') => {
  const root = folderId === 'desktop' ? 'C:' : pathOf(state, folderId);
  return visibleFiles(state)
    .map((f) => fileEntry(state, f))
    .filter((e) => e.path.startsWith(`${root}\\`))
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((e) => ({ ...e, depth: depth(e.path) - depth(root) }));
};

const norm = (s) =>
  String(s ?? '')
    .trim()
    .replace(/\//g, '\\')
    .replace(/^c:\\?/i, '')
    .replace(/^\\+|\\+$/g, '')
    .toUpperCase();

// Find a file by id, full path (C:\C_DRIVE\MEMOS\MEMO_01.TXT, slashes either way) or unique name.
export const resolveFile = (state, query) => {
  const q = norm(query);
  if (!q || String(query).trim() === 'desktop') return { file: state.files.desktop };
  const all = visibleFiles(state);
  const byId = all.find((f) => f.id === String(query).trim());
  if (byId) return { file: byId };
  const byPath = all.find((f) => norm(pathOf(state, f.id)) === q);
  if (byPath) return { file: byPath };
  const byName = all.filter((f) => f.name === q);
  if (byName.length === 1) return { file: byName[0] };
  if (byName.length > 1) return { error: `Several files are called ${q}: ${byName.map((f) => pathOf(state, f.id)).join(', ')}. Use the full path.` };
  return { error: `File not found: ${query}. Try list_files.` };
};

// Returns { text } or { error } for the intern reading a file.
export const readFile = (state, file) => {
  const level = internLevel(state);
  const path = filePath(state, file);
  if (file.type === 'folder') return { error: `${path} is a folder. Use list_files.` };
  if (!canInternReadFile(level, file)) {
    return { error: `ACCESS DENIED: ${path} needs ${levelInfo(file.minLevel).name} clearance. You are ${levelInfo(level).name}.` };
  }
  if (file.locked && file.puzzleId) {
    return { error: `${path} has Bit Rot. The contents are scrambled until the sector is recovered. Try inspect_puzzle.` };
  }
  if (file.locked) return { error: `${path} will not open. ${file.lockedMessage ?? ''}`.trim() };
  if (file.type === 'app') return { text: `[${file.name} - executable]\n${file.content}` };
  return { text: file.content };
};

export const puzzleFiles = (state, puzzleId) => visibleFiles(state).filter((f) => f.puzzleId === puzzleId);

export const resolvePuzzle = (state, query) => {
  const q = String(query ?? '').trim();
  const live = livePuzzles(state);
  const byId = live.find((p) => p.id === q);
  if (byId) return { puzzle: byId };
  const { file, error } = resolveFile(state, q);
  const viaFile = file?.puzzleId && live.find((p) => p.id === file.puzzleId);
  if (viaFile) return { puzzle: viaFile };
  if (file) return { error: `${filePath(state, file)} has no Bit Rot.` };
  return { error: error ?? `No puzzle called ${q}.` };
};

const opView = (state, p, op, index) => {
  const level = internLevel(state);
  const keyedLocked = !isOpUnlocked(p, index);
  return {
    index,
    type: op.type,
    label: keyedLocked ? 'XOR [REDACTED - keyed]' : opLabel(op),
    ...(op.type === 'xor' ? { mask: keyedLocked ? null : toHex(op.mask) } : { n: op.n }),
    keyed: Boolean(op.keyed),
    locked: keyedLocked,
    youCanUse: canInternUseOp(level, op.type),
  };
};

export const puzzleView = (state, p) => ({
  id: p.id,
  files: puzzleFiles(state, p.id).map((f) => filePath(state, f)),
  title: p.title ?? p.id,
  hint: p.hint ?? null,
  current: { hex: toHex(p.value), binary: nibbles(p.value), decimal: p.value },
  target: 'NOT VISIBLE TO YOU. The sysadmin can see it as a pattern of lit squares. Ask them.',
  moves: { used: p.history.length, limit: p.moveLimit, left: p.moveLimit - p.history.length },
  trail: [...p.history, p.value].map(toHex),
  ops: p.ops.map((op, i) => opView(state, p, op, i)),
  sysadminSeesNumbers: !(p.playerHides ?? []).includes('hex'),
  status: p.solved ? 'RECOVERED' : p.failed ? 'OUT OF MOVES (sysadmin must undo or reset)' : 'CORRUPTED',
});

export const listPuzzles = (state) => livePuzzles(state).map((p) => puzzleView(state, p));

export const readLogs = (state, limit = 20) => state.log.slice(-limit).map((l) => `[${l.at}] ${l.text}`);

// Ghost posts arrive on the line as #0117. Nobody has explained that to the intern either.
const SPEAKERS = { player: 'player', intern: 'intern', system: 'system', ghost: '#0117' };
export const chat = (state) => state.intern.messages.map((m) => ({ id: m.id, at: m.at, from: SPEAKERS[m.from] ?? m.from, text: m.text }));

export const parseMask = (value) => {
  const n = parseNumber(String(value ?? '').trim());
  return Number.isInteger(n) && n >= 0 && n <= 0xffff ? n : null;
};

// The full intern view in one object. Handy for debugging and for tests.
export const projectForIntern = (state) => ({
  whoami: whoami(state),
  files: listFiles(state),
  puzzles: listPuzzles(state),
  log: readLogs(state, 100),
  messages: chat(state),
});
