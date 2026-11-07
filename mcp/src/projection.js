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
import { citeFileError, fileLines, maxEvidence, statementMax } from '../../game/src/core/blame.js';
import { canActorUseOp, canInternReadFile, canInternUseOp, internLevel, internOpsLeft, isOpUnlocked, levelInfo, opHands } from '../../game/src/core/permissions.js';

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
    ...(state.phase === 'over' ? { shiftOver: shiftOverText(state) } : {}),
    ...(state.blame?.open ? { audit: 'OPEN: Head Office is running BLAME.EXE. See audit_status, then submit_blame.' } : {}),
    ...(state.power ? powerView(state) : {}),
  };
};

export const shiftOverText = (state) => {
  const end = state.shiftEnd;
  if (end?.reason === 'blackout') return 'BLACKOUT: the mainframe went down.';
  if (end?.reason === 'audit' && end.ending) return `The audit is closed. Head Office: ${end.ending.title}. ${end.ending.text}`;
  return 'The shift has ended (06:00).';
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
    hands: HANDS_TEXT[opHands(op)],
    youCanUse: canInternUseOp(level, op.type) && canActorUseOp('intern', op),
  };
};

const HANDS_TEXT = { both: 'either of you', player: 'sysadmin only (NS-02 console)', intern: 'you only (remote line)' };

const remoteLeft = (p) => {
  const left = internOpsLeft(p);
  return Number.isFinite(left) ? left : null;
};

export const puzzleView = (state, p) => ({
  id: p.id,
  files: puzzleFiles(state, p.id).map((f) => filePath(state, f)),
  title: p.title ?? p.id,
  hint: p.hint ?? null,
  current: { hex: toHex(p.value), binary: nibbles(p.value), decimal: p.value },
  target: 'NOT VISIBLE TO YOU. The sysadmin can see it as a pattern of lit squares. Ask them.',
  moves: { used: p.history.length, limit: p.moveLimit, left: p.moveLimit - p.history.length, yourRemoteOpsLeft: remoteLeft(p), yourRemoteOpsPerAttempt: p.internMoves ?? null },
  trail: [...p.history, p.value].map(toHex),
  ops: p.ops.map((op, i) => opView(state, p, op, i)),
  sysadminSeesNumbers: !(p.playerHides ?? []).includes('hex'),
  status: p.solved ? 'RECOVERED' : p.failed ? 'OUT OF MOVES (sysadmin must undo or reset)' : 'CORRUPTED',
});

export const listPuzzles = (state) => livePuzzles(state).map((p) => puzzleView(state, p));

export const readLogs = (state, limit = 20) => state.log.slice(-limit).map((l) => `[${l.at}] ${l.text}`);

// Lines are numbered so they can be cited in the audit as PATH:LINE.
export const numberLines = (content) => fileLines({ content }).map((l, i) => `${String(i + 1).padStart(3)}| ${l}`).join('\n');

// BLAME.EXE as the intern sees it: who can be named, the rules of filing and the files it has read
// tonight (readIds is tracked by the server, not the game). No weights, no endings.
export const auditView = (state, readIds = new Set()) => {
  const b = state.blame;
  const config = b?.config;
  if (!b?.open || !config) return null;
  const read = [...readIds].map((id) => state.files[id]).filter((f) => f && !citeFileError(state, 'intern', f));
  return {
    audit: 'OPEN. NS-02 is frozen and the clock has stopped. Head Office wants one statement from each of you.',
    howToFile: `submit_blame: one suspect id, up to ${maxEvidence(config)} citations as PATH:LINE (read_file numbers the lines), and why, in up to ${statementMax(config)} characters. You can only cite files you have read tonight. You get one go.`,
    suspects: config.suspects.map(({ id, name }) => ({ id, name })),
    filesYouHaveRead: read.map((f) => ({ path: filePath(state, f), lines: fileLines(f).length })),
    yourStatement: b.intern ? { suspect: b.intern.suspect, evidence: b.intern.evidence.map((ref) => citePath(state, ref)), statement: b.intern.statement } : null,
    sysadminFiled: Boolean(b.player),
  };
};

// "badge:7" -> "C:\C_DRIVE\...\BADGE.DB:7" so the intern never has to think in file ids.
export const citePath = (state, ref) => {
  const [id, line] = String(ref).split(':');
  return state.files[id] ? `${filePath(state, state.files[id])}:${line}` : ref;
};

// Ghost posts arrive on the line as #0117. Nobody has explained that to the intern either.
const SPEAKERS = { player: 'player', intern: 'intern', system: 'system', ghost: '#0117' };
export const chat = (state) => state.intern.messages.map((m) => ({ id: m.id, at: m.at, from: SPEAKERS[m.from] ?? m.from, text: m.text, ...(m.ping ? { ping: true } : {}) }));

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
