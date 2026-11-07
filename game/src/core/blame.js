// BLAME.EXE: the Head Office audit at 06:00. Pure helpers shared by the reducer, the UI, the
// scripted intern and the MCP server. The verdict rules live in data/blame.json, and the intern's
// projection never sees them (only the suspects and its own statement).
import { canInternReadFile, internLevel } from './permissions.js';

export const BLAME_SIDES = ['player', 'intern'];
const REF_PATTERN = /^([a-z0-9_-]{1,32}):(\d{1,4})$/i;
const COND_KEYS = ['verdict', 'player', 'intern', 'tags', 'facts', 'any'];
const FACT_KINDS = ['stat', 'solved', 'solvedBy', 'movesBy'];
export const ENDING_TITLE_MAX = 24;
export const ENDING_TEXT_MAX = 280;

export const createBlame = (config) => ({ open: false, config: config ? structuredClone(config) : null, player: null, intern: null, result: null });

export const blameConfig = (state) => state.blame?.config ?? null;
export const maxEvidence = (config) => config?.maxEvidence ?? 3;
export const statementMax = (config) => config?.statementMax ?? 140;
export const suspectName = (config, id) => config?.suspects?.find((s) => s.id === id)?.name ?? id;

// The audit starts at 06:00 if BLAME.EXE made it onto the desktop (the 05:00 beat reveals it).
export const auditDue = (state) => {
  const config = blameConfig(state);
  const file = config && state.files?.[config.file ?? 'blame'];
  return Boolean(file && !file.dormant);
};

export const parseRef = (ref) => {
  const m = REF_PATTERN.exec(String(ref ?? '').trim());
  return m ? { fileId: m[1].toLowerCase(), line: Number(m[2]) } : null;
};

export const fileLines = (file) => String(file?.content ?? '').split('\n');

// Can this side cite this file at all? The sysadmin can cite what they can open (no hidden system
// files); the intern can cite what its clearance can read. Corrupted files can't be quoted.
export const citeFileError = (state, side, file) => {
  if (!file || file.dormant || file.type === 'folder' || file.type === 'app') return 'No such file.';
  if (file.locked) return `${file.name} is still locked.`;
  if (side === 'player' && file.hidden) return 'No such file.';
  if (side === 'intern' && !canInternReadFile(internLevel(state), file)) return `${file.name} is above #0118's clearance.`;
  return null;
};

export const citeError = (state, side, ref) => {
  const r = parseRef(ref);
  if (!r) return `Bad citation ${String(ref).slice(0, 40)}: use file:line.`;
  const file = state.files?.[r.fileId];
  const err = citeFileError(state, side, file);
  if (err) return err;
  const n = fileLines(file).length;
  if (r.line < 1 || r.line > n) return `${file.name} has lines 1-${n}.`;
  return null;
};

// Files this side could cite right now, with their lines (for the BLAME.EXE picker).
export const citableFiles = (state, side) =>
  Object.values(state.files ?? {})
    .filter((f) => !citeFileError(state, side, f))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((f) => ({ id: f.id, name: f.name, lines: fileLines(f) }));

// Cleans a submission or explains what's wrong with it. Returns { submission } or { error }.
export const checkSubmission = (state, side, { suspect, evidence = [], statement = '' } = {}) => {
  const config = blameConfig(state);
  if (!state.blame?.open || !config) return { error: 'There is no audit running.' };
  if (state.blame[side]) return { error: 'That statement is already filed.' };
  if (!config.suspects.some((s) => s.id === suspect)) return { error: `Unknown suspect. Pick one of: ${config.suspects.map((s) => s.id).join(', ')}.` };
  if (!Array.isArray(evidence)) return { error: 'Evidence must be a list of file:line citations.' };
  const refs = [...new Set(evidence.map((e) => String(e).trim().toLowerCase()))];
  if (refs.length > maxEvidence(config)) return { error: `Cite at most ${maxEvidence(config)} lines.` };
  for (const ref of refs) {
    const err = citeError(state, side, ref);
    if (err) return { error: err };
  }
  const text = String(statement ?? '').replace(/\s+/g, ' ').trim();
  if (text.length > statementMax(config)) return { error: `Keep the statement to ${statementMax(config)} characters.` };
  return { submission: { suspect, evidence: refs, statement: text } };
};

// ---- the verdict ----------------------------------------------------------------------------

export const factHolds = (state, when = {}) => {
  const min = when.min ?? 1;
  if (when.stat !== undefined) return (state.stats?.[when.stat] ?? 0) >= min;
  if (when.solved !== undefined) return Boolean(state.puzzles?.[when.solved]?.solved);
  if (when.solvedBy !== undefined) return Object.values(state.puzzles ?? {}).filter((p) => p.solved && p.solvedBy === when.solvedBy).length >= min;
  if (when.movesBy !== undefined) return (state.puzzles?.[when.movesBy.puzzle]?.by ?? []).filter((b) => b === when.movesBy.actor).length >= min;
  return false;
};

export const scoreBlame = (state) => {
  const config = blameConfig(state);
  const scores = Object.fromEntries(config.suspects.map((s) => [s.id, 0]));
  const add = (points = {}) => {
    for (const [id, n] of Object.entries(points)) if (id in scores) scores[id] += n;
  };
  const tags = {};
  const contradictions = {};
  for (const side of BLAME_SIDES) {
    const sub = state.blame[side];
    if (!sub) continue;
    for (const ref of sub.evidence) {
      const e = config.evidence.find((x) => x.ref === ref);
      if (!e) continue;
      add(e.points);
      for (const t of e.tags ?? []) tags[t] = (tags[t] ?? 0) + 1;
      for (const c of e.clears ?? []) scores[c] -= 1;
      if ((e.clears ?? []).includes(sub.suspect)) contradictions[side] = ref;
    }
    if (!contradictions[side]) scores[sub.suspect] += config.accusationWeight ?? 1;
  }
  const facts = (config.facts ?? []).filter((f) => factHolds(state, f.when)).map((f) => f.id);
  for (const id of facts) add(config.facts.find((f) => f.id === id).points);
  const top = Math.max(...Object.values(scores));
  const leaders = Object.keys(scores).filter((id) => scores[id] === top);
  const verdict = top > 0 && leaders.length === 1 ? leaders[0] : null;
  return { scores, verdict, tags, facts, contradictions };
};

const matches = (cond, ctx) =>
  Object.entries(cond ?? {}).every(([k, v]) => {
    if (k === 'verdict') return v.includes(ctx.verdict ?? 'none');
    if (k === 'player' || k === 'intern') return v.includes(ctx.suspects[k]);
    if (k === 'tags') return Object.entries(v).every(([tag, min]) => (ctx.tags[tag] ?? 0) >= min);
    if (k === 'facts') return v.every((f) => ctx.facts.includes(f));
    if (k === 'any') return v.some((c) => matches(c, ctx));
    return false;
  });

// Both statements are in: decide. Returns { ending: { id, title, text }, suspect, ... }.
export const decideBlame = (state) => {
  const config = blameConfig(state);
  const score = scoreBlame(state);
  const ctx = { ...score, suspects: { player: state.blame.player?.suspect, intern: state.blame.intern?.suspect } };
  const ending = config.endings.find((e) => matches(e.when, ctx)) ?? config.endings.at(-1);
  const name = suspectName(config, score.verdict);
  return {
    ...score,
    suspect: score.verdict,
    ending: { id: ending.id, title: ending.title, text: ending.text.replaceAll('{{name}}', name ?? 'nobody') },
  };
};

// ---- the scripted intern's statement --------------------------------------------------------

// The scripted intern blames the sysadmin, unhelpfully but plausibly: the first variant whose
// facts hold, citing only lines it can actually see right now.
export const scriptedBlame = (state) => {
  const config = blameConfig(state);
  const variants = config?.scripted ?? [];
  const facts = (config?.facts ?? []).filter((f) => factHolds(state, f.when)).map((f) => f.id);
  const v = variants.find((x) => (x.facts ?? []).every((f) => facts.includes(f))) ?? variants.at(-1);
  if (!v) return null;
  return { suspect: v.suspect, evidence: v.evidence.filter((ref) => !citeError(state, 'intern', ref)).slice(0, maxEvidence(config)), statement: v.statement };
};

// Should the scripted intern file #0118's statement now? 'file', 'wait' (a real intern is on the
// line: wait for it however long it takes) or null (nothing to do). forced = the sysadmin pressed
// FILE WITHOUT THE INTERN. If the real intern drops off the line, aiOnLine goes false and the
// scripted intern files as usual once the sysadmin has.
export const scriptedBlameDecision = (state, { aiOnLine = false, forced = false } = {}) => {
  const b = state.blame;
  if (!b?.open || !b.config || b.intern) return null;
  if (forced) return 'file';
  if (!b.player) return null;
  return aiOnLine ? 'wait' : 'file';
};

// ---- endings found (kept in localStorage, outside the save) --------------------------------

export const ENDINGS_KEY = 'night-shift:endings';

export const parseEndings = (raw, config) => {
  try {
    const ids = JSON.parse(raw);
    const known = new Set((config?.endings ?? []).map((e) => e.id));
    return Array.isArray(ids) ? [...new Set(ids.filter((id) => typeof id === 'string' && (!config || known.has(id))))] : [];
  } catch {
    return [];
  }
};

export const addEnding = (found, id) => (found.includes(id) ? found : [...found, id]);

// ---- validation -----------------------------------------------------------------------------

// Returns a list of problems; empty means data/blame.json is well formed. Pass { files } (the
// files.json list) to check every citation points at a real line.
export const validateBlame = (config, { files } = {}) => {
  const errors = [];
  if (!config || typeof config !== 'object') return ['blame config must be an object'];
  const suspects = new Set();
  for (const s of config.suspects ?? []) {
    if (!s.id || suspects.has(s.id)) errors.push(`bad or duplicate suspect ${s.id}`);
    if (!s.name || s.name.length > 40) errors.push(`${s.id}: name must be 1-40 characters`);
    suspects.add(s.id);
  }
  if (suspects.size < 3) errors.push('needs at least 3 suspects');
  for (const k of ['maxEvidence', 'statementMax']) if (config[k] !== undefined && !(Number.isInteger(config[k]) && config[k] > 0)) errors.push(`${k} must be a positive integer`);
  const lines = files ? Object.fromEntries(files.map((f) => [f.id, (Array.isArray(f.content) ? f.content : String(f.content ?? '').split('\n')).length])) : null;
  if (files && !files.some((f) => f.id === (config.file ?? 'blame'))) errors.push(`unknown file ${config.file ?? 'blame'}`);
  const checkRef = (where, ref) => {
    const r = parseRef(ref);
    if (!r || r.fileId !== String(ref).split(':')[0]) return errors.push(`${where}: bad ref ${ref}`);
    if (lines && !(r.fileId in lines)) return errors.push(`${where}: unknown file ${r.fileId}`);
    if (lines && (r.line < 1 || r.line > lines[r.fileId])) errors.push(`${where}: ${r.fileId} has no line ${r.line}`);
  };
  const checkPoints = (where, points) => {
    for (const [id, n] of Object.entries(points ?? {})) {
      if (!suspects.has(id)) errors.push(`${where}: unknown suspect ${id}`);
      if (!Number.isInteger(n) || Math.abs(n) > 5) errors.push(`${where}: points must be integers within 5`);
    }
  };
  const tags = new Set();
  const refs = new Set();
  for (const e of config.evidence ?? []) {
    checkRef('evidence', e.ref);
    if (refs.has(e.ref)) errors.push(`duplicate evidence ${e.ref}`);
    refs.add(e.ref);
    checkPoints(e.ref, e.points);
    for (const c of e.clears ?? []) if (!suspects.has(c)) errors.push(`${e.ref}: clears unknown suspect ${c}`);
    for (const t of e.tags ?? []) tags.add(t);
  }
  const facts = new Set();
  for (const f of config.facts ?? []) {
    if (!f.id || facts.has(f.id)) errors.push(`bad or duplicate fact ${f.id}`);
    facts.add(f.id);
    const kinds = Object.keys(f.when ?? {}).filter((k) => k !== 'min');
    if (kinds.length !== 1 || !FACT_KINDS.includes(kinds[0])) errors.push(`${f.id}: when needs exactly one of ${FACT_KINDS.join(', ')}`);
    checkPoints(f.id, f.points);
  }
  const checkCond = (where, cond) => {
    for (const [k, v] of Object.entries(cond ?? {})) {
      if (!COND_KEYS.includes(k)) errors.push(`${where}: unknown condition ${k}`);
      if (['verdict', 'player', 'intern'].includes(k)) for (const id of v) if (!suspects.has(id) && id !== 'none') errors.push(`${where}: unknown suspect ${id}`);
      if (k === 'tags') for (const t of Object.keys(v)) if (!tags.has(t)) errors.push(`${where}: no evidence has tag ${t}`);
      if (k === 'facts') for (const id of v) if (!facts.has(id)) errors.push(`${where}: unknown fact ${id}`);
      if (k === 'any') v.forEach((c) => checkCond(where, c));
    }
  };
  const endings = new Set();
  for (const e of config.endings ?? []) {
    if (!e.id || endings.has(e.id)) errors.push(`bad or duplicate ending ${e.id}`);
    endings.add(e.id);
    if (!e.title || e.title.length > ENDING_TITLE_MAX) errors.push(`${e.id}: title must be 1-${ENDING_TITLE_MAX} characters`);
    if (!e.text || e.text.length > ENDING_TEXT_MAX) errors.push(`${e.id}: text must be 1-${ENDING_TEXT_MAX} characters`);
    checkCond(e.id, e.when);
  }
  if (endings.size < 3) errors.push('needs at least 3 endings');
  if (config.endings?.at(-1)?.when) errors.push('the last ending is the default and must have no when');
  for (const [i, v] of (config.scripted ?? []).entries()) {
    if (!suspects.has(v.suspect)) errors.push(`scripted ${i}: unknown suspect ${v.suspect}`);
    (v.evidence ?? []).forEach((ref) => checkRef(`scripted ${i}`, ref));
    if ((v.evidence ?? []).length > (config.maxEvidence ?? 3)) errors.push(`scripted ${i}: too much evidence`);
    if (!v.statement || v.statement.length > (config.statementMax ?? 140)) errors.push(`scripted ${i}: statement must be 1-${config.statementMax ?? 140} characters`);
    for (const f of v.facts ?? []) if (!facts.has(f)) errors.push(`scripted ${i}: unknown fact ${f}`);
  }
  if (!(config.scripted ?? []).length) errors.push('needs at least one scripted statement');
  return errors;
};
