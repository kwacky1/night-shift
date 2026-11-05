// The scripted fallback intern, for players without an MCP agent. Pure: given the game state,
// the player's message and the script (data/intern.json), pick a reply. Deliberately unhelpful,
// but every topic escalates with each ask, so the key eventually leaks (grudgingly).
//
// Reply resolution, in order:
//   1. A described 16-bit pattern (binary or 0x hex) -> the `detect: "bits"` topic. CURRENT vs
//      TARGET is decided by nearby words. A heard target gets a route from the BFS solver.
//   2. A message that is only follow-up noise ("please", "go on", "?") -> the last topic.
//   3. The first eligible topic (in file order) whose keyword matches.
//   4. No match -> the last topic, else default.
// Topics only count once their sector/file is on the drive (`when`), and when a message matches
// several topics the one about the sector the player is looking at wins.
//
// fallbackNag(prev, next, script) is the unprompted bit: it moans about mainframe power.
import { internLevel, isOpUnlocked } from '../core/permissions.js';
import { livePuzzles } from '../core/selectors.js';
import { POWER_STATUSES, powerConfig, powerLevel, powerStatus } from '../core/power.js';
import { hexInWords } from '../logic/words.js';
import { toHex, toWord } from '../logic/bits.js';
import { solve } from '../logic/puzzle.js';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const wordRe = (keyword) => {
  const k = keyword.toLowerCase();
  // Word boundaries only make sense around word characters.
  const pre = /^\w/.test(k) ? '\\b' : '';
  const post = /\w$/.test(k) ? '\\b' : '';
  return new RegExp(`${pre}${escapeRe(k)}${post}`, 'g');
};

const matches = (text, keyword) => wordRe(keyword).test(text);

// Index just past the last occurrence of any keyword in text, or -1.
const lastIndexOf = (text, keywords) => {
  let best = -1;
  for (const k of keywords) for (const m of text.matchAll(wordRe(k))) best = Math.max(best, m.index + m[0].length);
  return best;
};

const firstIndexOf = (text, keywords) => {
  let best = Infinity;
  for (const k of keywords) for (const m of text.matchAll(wordRe(k))) best = Math.min(best, m.index);
  return best;
};

export const bitsOf = (v) => toWord(v).toString(2).padStart(16, '0').match(/.{4}/g).join(' ');

const keyedIndex = (p) => p?.ops.findIndex((op) => op.keyed) ?? -1;

// A puzzle is "unlocked" for chat purposes once its keyed op is open (or it is solved).
const isUnlocked = (state, puzzleId) => {
  const p = state?.puzzles?.[puzzleId];
  if (!p) return false;
  const k = keyedIndex(p);
  return p.solved || (k >= 0 && isOpUnlocked(p, k));
};

const isRevealed = (state, fileId) => {
  const f = state?.files?.[fileId];
  return Boolean(f && !f.dormant);
};

const isEligible = (state, t) => {
  if (t.detect) return false;
  if (t.when === 'unlocked') return isUnlocked(state, t.puzzle);
  if (t.when === 'revealed') return isRevealed(state, t.file);
  return true;
};

const isFollowUp = (script, lower) => {
  let rest = lower;
  for (const f of script.followUps ?? []) rest = rest.replace(wordRe(f), ' ');
  return rest.replace(/[\s?!.,]+/g, '') === '' && lower.trim() !== '';
};

const topicPuzzle = (t) => t.puzzle ?? t.leaks?.puzzle;

export const topicFor = (script, text, state = {}) => {
  const lower = String(text ?? '').toLowerCase();
  const lastId = state.intern?.lastTopic;
  const last = lastId ? script.topics.find((t) => t.id === lastId && (t.detect || isEligible(state, t))) : undefined;
  if (last && isFollowUp(script, lower)) return last;
  const hits = script.topics.filter((t) => isEligible(state, t) && t.keywords.some((k) => matches(lower, k)));
  // "the key?" means the key for the sector in front of the player, not the first one in the file.
  const focus = hits.length > 1 && state.puzzles ? focusPuzzle(state)?.id : undefined;
  const hit = (focus && hits.find((t) => topicPuzzle(t) === focus)) || hits[0];
  return hit ?? last ?? script.topics.find((t) => t.id === 'default');
};

// ---- routes -------------------------------------------------------------------------------

const opInWords = (op) => {
  const amount = (n) => (n === 4 ? 'a nibble' : n === 8 ? 'a byte' : String(n));
  if (op.type === 'xor') return op.keyed ? 'the key XOR' : `XOR ${toHex(op.mask)}`;
  return op.type === 'shl' ? `shove it left ${amount(op.n ?? 1)}` : `nudge it right ${amount(op.n ?? 1)}`;
};

const OP_TYPE_WORDS = { xor: 'XOR', shl: 'shift left', shr: 'shift right' };

// Shortest route from the puzzle's CURRENT value within the moves left, or null.
export const routeFrom = (p) => {
  if (!p || p.solved || p.failed) return null;
  const left = p.moveLimit - p.history.length;
  if (left <= 0) return null;
  return solve({ ...p, start: p.value }, left);
};

export const planInWords = (p, path) => {
  const seen = new Set();
  const parts = path.map((i) => {
    const words = opInWords(p.ops[i]) + (seen.has(i) ? ' again' : '');
    seen.add(i);
    return words;
  });
  if (parts.length === 1) return `${parts[0]} and that's it`;
  return [`${parts[0]} first`, ...parts.slice(1).map((s) => `then ${s}`)].join(', ');
};

const opTypesInWords = (p, path) => path.map((i) => OP_TYPE_WORDS[p.ops[i].type]).join(', ');

// ---- described bit patterns ---------------------------------------------------------------

// Every 16-bit value in the text: 16 binary digits (spaces/underscores allowed) or 0x hex.
export const findValues = (text) => {
  const found = [];
  for (const m of text.matchAll(/[01](?:[ _]*[01])*/g)) {
    const bits = m[0].replace(/[ _]/g, '');
    if (bits.length === 16) found.push({ value: parseInt(bits, 2), binary: true, start: m.index, end: m.index + m[0].length });
  }
  for (const m of text.matchAll(/\b0x([0-9a-f]{1,4})\b/gi)) found.push({ value: parseInt(m[1], 16), binary: false, start: m.index, end: m.index + m[0].length });
  return found.sort((a, b) => a.start - b.start);
};

// 'current' | 'target' | null, from the words before the value (closest wins; strong beats weak),
// falling back to the words after it. Hex only counts with strong words (it's often a key).
const roleOf = (roles, before, after, tiers) => {
  for (const tier of tiers) {
    const c = lastIndexOf(before, roles.current[tier]);
    const t = lastIndexOf(before, roles.target[tier]);
    if (c >= 0 || t >= 0) return c > t ? 'current' : 'target';
  }
  for (const tier of tiers) {
    const c = firstIndexOf(after, roles.current[tier]);
    const t = firstIndexOf(after, roles.target[tier]);
    if (c !== Infinity || t !== Infinity) return c < t ? 'current' : 'target';
  }
  return null;
};

export const describedValues = (text, roles) => {
  const lower = String(text ?? '').toLowerCase();
  const values = findValues(lower);
  return values.map((v, i) => ({
    ...v,
    role: roleOf(roles, lower.slice(i ? values[i - 1].end : 0, v.start), lower.slice(v.end, values[i + 1]?.start ?? lower.length), v.binary ? ['strong', 'weak'] : ['strong']),
  }));
};

// The sector the player is most likely talking about.
const focusPuzzle = (state) => {
  const live = livePuzzles(state);
  const puzzleOf = (w) => live.find((p) => p.id === state.files[w?.fileId]?.puzzleId);
  const focused = state.windows?.find((w) => w.id === state.focusedWindowId);
  const open = [...(state.windows ?? [])].reverse().map(puzzleOf).filter((p) => p && !p.solved);
  const unsolved = live.filter((p) => !p.solved);
  return (puzzleOf(focused)?.solved ? null : puzzleOf(focused)) ?? open[0] ?? unsolved.find((p) => p.playerHides?.length) ?? unsolved[0];
};

const fillPattern = (line, vars) => line.replace(/\{\{(\w+)\}\}/g, (m, k) => vars[k] ?? m);

const patternLine = (state, topic, kind, vars) => {
  const key = `${topic.id}:${kind}`;
  const lines = topic[kind];
  return { text: fillPattern(lines[(state.intern?.pester?.[key] ?? 0) % lines.length], vars), topic: key, thread: topic.id };
};

const routeReply = (state, topic, p, extraVars = {}) => {
  const vars = { target: toHex(p.target), targetBits: bitsOf(p.target), actual: toHex(p.value), actualBits: bitsOf(p.value), ...extraVars };
  if (p.solved) return { ...patternLine(state, topic, 'doneLines', vars), heardTarget: p.id };
  const path = routeFrom(p);
  if (!path) return { ...patternLine(state, topic, 'stuckLines', vars), heardTarget: p.id };
  return { ...patternLine(state, topic, 'lines', { ...vars, plan: planInWords(p, path) }), heardTarget: p.id };
};

const heard = (state, p) => Boolean(p && (state.intern?.heardTargets ?? []).includes(p.id));

const patternReply = (state, text, topic) => {
  const values = describedValues(text, topic.roles);
  if (!values.length) return null;
  const puzzles = livePuzzles(state);
  const byTarget = (v) => puzzles.find((p) => p.target === v && !p.solved) ?? puzzles.find((p) => p.target === v);
  const byCurrent = (v) => puzzles.find((p) => p.value === v && !p.solved);
  // Only unlabelled binary rows are guessed from their value. Bare hex is probably a key.
  for (const v of values) if (!v.role && v.binary) v.role = byTarget(v.value) ? 'target' : byCurrent(v.value) ? 'current' : null;

  const target = values.find((v) => v.role === 'target');
  if (target) {
    const p = byTarget(target.value);
    const vars = { value: toHex(target.value), valueBits: bitsOf(target.value) };
    if (!p) return patternLine(state, topic, 'wrongLines', vars);
    return routeReply(state, topic, p, vars);
  }
  const current = values.find((v) => v.role === 'current');
  if (current) {
    const p = byCurrent(current.value) ?? focusPuzzle(state);
    if (!p) return null;
    const vars = { value: toHex(current.value), valueBits: bitsOf(current.value), actual: toHex(p.value), actualBits: bitsOf(p.value) };
    if (p.value !== current.value) return patternLine(state, topic, 'currentWrongLines', vars);
    if (heard(state, p)) return routeReply(state, topic, p, vars);
    return patternLine(state, topic, 'currentLines', vars);
  }
  // A bare binary pattern with no clue which row it is. Bare hex is left alone (it's probably a key).
  const bare = values.find((v) => v.binary);
  return bare ? patternLine(state, topic, 'unknownLines', { value: toHex(bare.value), valueBits: bitsOf(bare.value) }) : null;
};

// ---- replies ------------------------------------------------------------------------------

const pick = (lines, count, cycle) => lines[cycle ? count % lines.length : Math.min(count, lines.length - 1)];

// Fill {{key}} / {{opTypes}} / {{power}}. Returns null when a placeholder can't be filled (no route left).
const fill = (line, state, topic) => {
  let missing = false;
  const text = line.replace(/\{\{(\w+)\}\}/g, (m, k) => {
    if (k === 'power') return `${Math.round(powerLevel(state))}%`;
    if (k === 'key') {
      const p = state.puzzles[topic.leaks?.puzzle];
      const mask = p?.ops[keyedIndex(p)]?.mask;
      return mask === undefined ? 'something I have forgotten' : hexInWords(mask);
    }
    if (k === 'opTypes') {
      const p = state.puzzles[topic.puzzle];
      const path = routeFrom(p);
      if (!path) missing = true;
      return path ? opTypesInWords(p, path) : '';
    }
    return m;
  });
  return missing ? null : text;
};

// Returns { text, topic, thread?, heardTarget? }:
//   topic       the pester counter to bump when the reply is posted
//   thread      the topic follow-ups should continue (absent for chit-chat)
//   heardTarget a puzzle id whose target the player has now described
export const fallbackReply = (state, text, script) => {
  const detector = script.topics.find((t) => t.detect === 'bits');
  if (detector) {
    const r = patternReply(state, text, detector);
    if (r) return r;
  }
  const topic = topicFor(script, text, state);
  const thread = topic.thread === false ? undefined : topic.id;
  const pester = state.intern?.pester ?? {};

  if (topic.detect) {
    // "go on" after a pattern: re-plan from wherever the sector is now.
    const p = focusPuzzle(state);
    if (heard(state, p)) return routeReply(state, topic, p);
    const fallback = script.topics.find((t) => t.id === 'default');
    return { text: pick(fallback.lines, pester.default ?? 0, true), topic: 'default' };
  }
  const about = topic.leaks?.puzzle ?? topic.puzzle;
  if (about && state.puzzles[about]?.solved && topic.doneLine) return { text: topic.doneLine, topic: `${topic.id}:done`, thread };
  if (topic.requiresLevel !== undefined && internLevel(state) < topic.requiresLevel) {
    const key = `${topic.id}:locked`;
    return { text: fill(pick(topic.lockedLines, pester[key] ?? 0, true), state, topic), topic: key, thread };
  }
  if (topic.unlockedLine && topic.leaks && isUnlocked(state, topic.leaks.puzzle)) return { text: topic.unlockedLine, topic: `${topic.id}:unlocked`, thread };
  if (topic.lowLines && powerLevel(state) < powerConfig(state).nagBelow) {
    const key = `${topic.id}:low`;
    return { text: fill(pick(topic.lowLines, pester[key] ?? 0, true), state, topic), topic: key, thread };
  }
  const line = fill(pick(topic.lines, pester[topic.id] ?? 0, topic.cycle), state, topic);
  if (line === null) return { text: pick(topic.stuckLines, pester[`${topic.id}:stuck`] ?? 0, true), topic: `${topic.id}:stuck`, thread };
  return { text: line, topic: topic.id, thread };
};

// ---- unprompted power nags ----------------------------------------------------------------

const statusRank = (state) => POWER_STATUSES.indexOf(powerStatus(state));

// Called with the state before and after a change. Returns { text, topic } when the scripted
// intern should moan about mainframe power, else null. It nags when power first drops under
// power.config.nagBelow, whenever the status gets worse, and every nag.everyMinutes while low.
export const fallbackNag = (prev, next, script) => {
  const nag = script.nag;
  if (!nag || !prev?.power || !next?.power || next.phase !== 'desktop') return null;
  const level = powerLevel(next);
  if (level <= 0 || level >= powerConfig(next).nagBelow) return null;
  const crossed = powerLevel(prev) >= powerConfig(next).nagBelow;
  const worse = statusRank(next) > statusRank(prev);
  const every = nag.everyMinutes ?? 0;
  const periodic = every > 0 && Math.floor(next.clock.elapsed / every) > Math.floor(prev.clock.elapsed / every);
  if (!crossed && !worse && !periodic) return null;
  const kind = ['brownout', 'critical'].includes(powerStatus(next)) && nag.brownoutLines ? 'brownoutLines' : 'lines';
  const key = kind === 'lines' ? 'nag' : 'nag:brownout';
  return { text: fill(pick(nag[kind], next.intern?.pester?.[key] ?? 0, true), next, {}), topic: key };
};

// ---- validation ---------------------------------------------------------------------------

const TOPIC_FIELDS = new Set(['id', 'keywords', 'lines', 'cycle', 'thread', 'requiresLevel', 'lockedLines', 'leaks', 'doneLine', 'unlockedLine', 'when', 'puzzle', 'file', 'stuckLines', 'lowLines', 'detect', 'roles', 'currentLines', 'currentWrongLines', 'wrongLines', 'unknownLines', 'doneLines']);
const PATTERN_LISTS = ['lines', 'currentLines', 'currentWrongLines', 'wrongLines', 'unknownLines', 'stuckLines', 'doneLines'];
const PATTERN_VARS = ['plan', 'target', 'targetBits', 'value', 'valueBits', 'actual', 'actualBits'];
const isLines = (v) => Array.isArray(v) && v.length > 0 && v.every((l) => typeof l === 'string' && l.trim());
const isWords = (v) => Array.isArray(v) && v.every((k) => typeof k === 'string' && k.trim() && k === k.toLowerCase());
const placeholders = (lines) => (lines ?? []).flatMap((l) => [...String(l).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]));

// Returns a list of problems with the script; empty means it is well formed.
// Pass { puzzleIds, fileIds } to also check that puzzle and file references exist.
export const validateScript = (script, { puzzleIds, fileIds } = {}) => {
  const errors = [];
  if (!Array.isArray(script?.topics)) return ['topics must be an array'];
  if (script.followUps !== undefined && !isWords(script.followUps)) errors.push('followUps must be lowercase strings');
  if (script.nag !== undefined) {
    for (const k of Object.keys(script.nag)) if (!['lines', 'brownoutLines', 'everyMinutes'].includes(k)) errors.push(`nag: unknown field ${k}`);
    if (!isLines(script.nag.lines)) errors.push('nag: needs lines');
    if (script.nag.brownoutLines !== undefined && !isLines(script.nag.brownoutLines)) errors.push('nag: brownoutLines must be lines');
    if (script.nag.everyMinutes !== undefined && !(Number.isInteger(script.nag.everyMinutes) && script.nag.everyMinutes > 0)) errors.push('nag: everyMinutes must be a positive integer');
    for (const v of placeholders([...(script.nag.lines ?? []), ...(script.nag.brownoutLines ?? [])])) if (v !== 'power') errors.push(`nag: placeholder {{${v}}} not allowed here`);
  }
  const ids = new Set();
  const checkPuzzle = (t, id) => {
    if (typeof id !== 'string') errors.push(`${t.id}: puzzle reference must be a string`);
    else if (puzzleIds && !puzzleIds.includes(id)) errors.push(`${t.id}: unknown puzzle ${id}`);
  };
  for (const t of script.topics) {
    if (!t.id || ids.has(t.id)) errors.push(`bad or duplicate topic id: ${t.id}`);
    ids.add(t.id);
    for (const k of Object.keys(t)) if (!TOPIC_FIELDS.has(k)) errors.push(`${t.id}: unknown field ${k}`);
    if (!isWords(t.keywords)) errors.push(`${t.id}: keywords must be lowercase strings`);
    if (!isLines(t.lines)) errors.push(`${t.id}: needs at least one line`);
    if (t.thread !== undefined && t.thread !== false) errors.push(`${t.id}: thread may only be false`);
    if (t.detect !== undefined) {
      if (t.detect !== 'bits') errors.push(`${t.id}: detect must be "bits"`);
      for (const k of PATTERN_LISTS) if (!isLines(t[k])) errors.push(`${t.id}: needs ${k}`);
      for (const role of ['current', 'target']) for (const tier of ['strong', 'weak']) if (!isWords(t.roles?.[role]?.[tier])) errors.push(`${t.id}: roles.${role}.${tier} must be lowercase strings`);
      for (const v of placeholders(PATTERN_LISTS.flatMap((k) => t[k] ?? []))) if (!PATTERN_VARS.includes(v)) errors.push(`${t.id}: unknown placeholder {{${v}}}`);
      if (placeholders(t.lines).every((v) => v !== 'plan')) errors.push(`${t.id}: lines must give the {{plan}}`);
      continue;
    }
    if (t.requiresLevel !== undefined && !isLines(t.lockedLines)) errors.push(`${t.id}: requiresLevel needs lockedLines`);
    if (t.when !== undefined && !['unlocked', 'revealed'].includes(t.when)) errors.push(`${t.id}: when must be "unlocked" or "revealed"`);
    if (t.when === 'unlocked' && t.puzzle === undefined) errors.push(`${t.id}: when needs a puzzle`);
    if (t.when === 'revealed' && typeof t.file !== 'string') errors.push(`${t.id}: when "revealed" needs a file`);
    if (t.file !== undefined && t.when !== 'revealed') errors.push(`${t.id}: file is only used with when "revealed"`);
    if (typeof t.file === 'string' && fileIds && !fileIds.includes(t.file)) errors.push(`${t.id}: unknown file ${t.file}`);
    if (t.lowLines !== undefined && !isLines(t.lowLines)) errors.push(`${t.id}: lowLines must be lines`);
    if (t.puzzle !== undefined) checkPuzzle(t, t.puzzle);
    if (t.leaks) checkPuzzle(t, t.leaks.puzzle);
    if (t.leaks && !String(t.lines?.at(-1)).includes('{{key}}')) errors.push(`${t.id}: last line must leak {{key}}`);
    if (t.unlockedLine !== undefined && !t.leaks) errors.push(`${t.id}: unlockedLine needs leaks`);
    for (const v of placeholders([...(t.lines ?? []), ...(t.lockedLines ?? []), ...(t.lowLines ?? [])])) {
      if (v === 'power') continue;
      if (v === 'key' && t.leaks) continue;
      if (v === 'opTypes' && t.puzzle) continue;
      errors.push(`${t.id}: placeholder {{${v}}} not allowed here`);
    }
    if (placeholders(t.lines).includes('opTypes') && !isLines(t.stuckLines)) errors.push(`${t.id}: {{opTypes}} needs stuckLines`);
    if (placeholders(t.lockedLines).includes('key')) errors.push(`${t.id}: lockedLines must not leak {{key}}`);
  }
  if (!ids.has('default')) errors.push('missing default topic');
  return errors;
};