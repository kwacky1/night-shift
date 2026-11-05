// The night's story arc: data-driven beats (data/story.json) keyed to the shift clock and/or game
// flags. Pure. The reducer calls advanceStory after the actions in STORY_TRIGGERS; each beat fires
// at most once per shift.
//
// Beat: { id, at?: "HH:MM", when?: {...}, effects: [{ do, ... }] }
//   at         fires at or after this clock time (22:00 to 06:00)
//   when       every condition must hold:
//                solved: [puzzleIds]     unsolved: [puzzleIds]
//                flag: name              notFlag: name
//                unlocked: fileId        locked: fileId          (file.locked)
//                powerBelow: n           level: n                (intern level at least n)
//                fired: beatId           notFired: beatId
//   effects    { do: 'post', from: 'system' | 'intern' | 'ghost', text }
//              { do: 'log', text }       { do: 'alert', title, text }
//              { do: 'reveal', file }    { do: 'flag', name }
//              { do: 'internLevel', level, message? }
//              { do: 'drain', amount }   (a power surge: the screen flickers)
//              { do: 'stall' }           (the generator stalls, wherever it is)
import { ActionTypes as T } from './actions.js';
import { gridSlot } from './initialState.js';
import { drainPower, powerLevel } from './power.js';
import { endShift } from './shift.js';
import { MAX_LEVEL } from './permissions.js';

export const STORY_TRIGGERS = new Set([T.CLOCK_IN, T.TICK, T.PUZZLE_APPLY_OP, T.PUZZLE_ENTER_KEY, T.RENAME_FILE, T.DRIVE_REPORT, T.OPEN_FILE]);

export const SHIFT_START_MINUTES = 22 * 60;
export const POST_FROM = ['system', 'intern', 'ghost'];
const EFFECTS = ['post', 'log', 'alert', 'reveal', 'flag', 'internLevel', 'drain', 'stall'];
const WHEN_KEYS = ['solved', 'unsolved', 'flag', 'notFlag', 'unlocked', 'locked', 'powerBelow', 'level', 'fired', 'notFired'];

// "HH:MM" -> minutes into the shift (22:00 = 0, 06:00 = 480). NaN for junk.
export const shiftMinutes = (hhmm) => {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm));
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return NaN;
  return (Number(m[1]) * 60 + Number(m[2]) - SHIFT_START_MINUTES + 24 * 60) % (24 * 60);
};

const conditionsHold = (state, beat) => {
  if (beat.at !== undefined && state.clock.elapsed < shiftMinutes(beat.at)) return false;
  const w = beat.when ?? {};
  const fired = state.story.fired;
  if (w.solved && !w.solved.every((id) => state.puzzles[id]?.solved)) return false;
  if (w.unsolved && !w.unsolved.every((id) => state.puzzles[id] && !state.puzzles[id].solved)) return false;
  if (w.flag && !state.flags[w.flag]) return false;
  if (w.notFlag && state.flags[w.notFlag]) return false;
  if (w.unlocked && !(state.files[w.unlocked] && !state.files[w.unlocked].locked)) return false;
  if (w.locked && !state.files[w.locked]?.locked) return false;
  if (w.powerBelow !== undefined && !(powerLevel(state) < w.powerBelow)) return false;
  if (w.level !== undefined && !((state.intern?.level ?? 0) >= w.level)) return false;
  if (w.fired && !fired.includes(w.fired)) return false;
  if (w.notFired && fired.includes(w.notFired)) return false;
  return true;
};

const freeDesktopSlot = (state) => {
  const taken = Object.values(state.desktop.positions);
  for (let i = 0; i < 60; i++) {
    const slot = gridSlot(i);
    if (!taken.some((p) => Math.abs(p.x - slot.x) < 40 && Math.abs(p.y - slot.y) < 40)) return slot;
  }
  return gridSlot(0);
};

const reveal = (state, id) => {
  const f = state.files[id];
  if (!f || !f.dormant) return state;
  let s = { ...state, files: { ...state.files, [id]: { ...f, dormant: false } } };
  if (f.parent === 'desktop' && !f.hidden && !s.desktop.positions[id]) {
    s = { ...s, desktop: { ...s.desktop, positions: { ...s.desktop.positions, [id]: freeDesktopSlot(s) } } };
  }
  return s;
};

const applyEffect = (state, e, h) => {
  switch (e.do) {
    case 'post':
      return h.post(state, e.from ?? 'system', e.text);
    case 'log':
      return h.log(state, e.text);
    case 'alert':
      return h.alert(state, e.title ?? 'NightOS', e.text);
    case 'reveal':
      return reveal(state, e.file);
    case 'flag':
      return { ...state, flags: { ...state.flags, [e.name]: true } };
    case 'internLevel':
      return h.setInternLevel(state, e.level, e.message);
    case 'drain': {
      const s = drainPower(state, e.amount ?? 0);
      return { ...s, power: { ...s.power, surgeSeq: (s.power.surgeSeq ?? 0) + 1 } };
    }
    case 'stall':
      return { ...state, power: { ...state.power, stallSeq: (state.power.stallSeq ?? 0) + 1 } };
    default:
      return state;
  }
};

// Fires every due beat (in file order, repeating so one beat can enable the next). Pure.
export const advanceStory = (state, helpers) => {
  if (!state.story?.beats?.length || state.phase !== 'desktop') return state;
  let s = state;
  for (let pass = 0; pass < s.story.beats.length; pass++) {
    let firedAny = false;
    for (const beat of s.story.beats) {
      if (s.story.fired.includes(beat.id) || !conditionsHold(s, beat)) continue;
      s = { ...s, story: { ...s.story, fired: [...s.story.fired, beat.id] } };
      for (const e of beat.effects ?? []) s = applyEffect(s, e, helpers);
      firedAny = true;
      if (s.power.level <= 0) return endShift(s, 'blackout');
    }
    if (!firedAny) break;
  }
  return s;
};

const isText = (v) => typeof v === 'string' && v.trim().length > 0;

// Returns a list of problems with the beats; empty means they are well formed.
export const validateStory = (story, { fileIds = [], puzzleIds = [], dormantIds } = {}) => {
  const errors = [];
  const beats = story?.beats;
  if (!Array.isArray(beats)) return ['beats must be an array'];
  const ids = new Set(beats.map((b) => b.id));
  const seen = new Set();
  const revealed = new Set();
  for (const b of beats) {
    if (!isText(b.id) || seen.has(b.id)) errors.push(`bad or duplicate beat id: ${b.id}`);
    seen.add(b.id);
    for (const k of Object.keys(b)) if (!['id', 'at', 'when', 'effects', 'note'].includes(k)) errors.push(`${b.id}: unknown field ${k}`);
    if (b.at !== undefined && Number.isNaN(shiftMinutes(b.at))) errors.push(`${b.id}: at must be HH:MM`);
    if (b.at !== undefined && shiftMinutes(b.at) >= 8 * 60) errors.push(`${b.id}: at must be inside the shift (22:00 to 05:59)`);
    if (b.at === undefined && !b.when) errors.push(`${b.id}: needs at and/or when`);
    const w = b.when ?? {};
    for (const k of Object.keys(w)) if (!WHEN_KEYS.includes(k)) errors.push(`${b.id}: unknown condition ${k}`);
    for (const k of ['solved', 'unsolved']) {
      if (w[k] === undefined) continue;
      if (!Array.isArray(w[k])) errors.push(`${b.id}: when.${k} must be a list`);
      else for (const id of w[k]) if (!puzzleIds.includes(id)) errors.push(`${b.id}: unknown puzzle ${id}`);
    }
    for (const k of ['unlocked', 'locked']) if (w[k] !== undefined && !fileIds.includes(w[k])) errors.push(`${b.id}: unknown file ${w[k]}`);
    for (const k of ['fired', 'notFired']) if (w[k] !== undefined && !ids.has(w[k])) errors.push(`${b.id}: unknown beat ${w[k]}`);
    if (!Array.isArray(b.effects) || !b.effects.length) errors.push(`${b.id}: needs effects`);
    for (const e of b.effects ?? []) {
      if (!EFFECTS.includes(e?.do)) {
        errors.push(`${b.id}: unknown effect ${e?.do}`);
        continue;
      }
      if (e.do === 'post' && (!POST_FROM.includes(e.from ?? 'system') || !isText(e.text))) errors.push(`${b.id}: post needs from (${POST_FROM.join('/')}) and text`);
      if ((e.do === 'log' || e.do === 'alert') && !isText(e.text)) errors.push(`${b.id}: ${e.do} needs text`);
      if (e.do === 'post' && e.text?.length > 280) errors.push(`${b.id}: post is longer than a chat bubble`);
      if (e.do === 'reveal') {
        if (!fileIds.includes(e.file)) errors.push(`${b.id}: reveals unknown file ${e.file}`);
        else if (dormantIds && !dormantIds.includes(e.file)) errors.push(`${b.id}: reveals ${e.file}, which is not dormant`);
        revealed.add(e.file);
      }
      if (e.do === 'flag' && !isText(e.name)) errors.push(`${b.id}: flag needs a name`);
      if (e.do === 'internLevel' && !(Number.isInteger(e.level) && e.level >= 0 && e.level <= MAX_LEVEL)) errors.push(`${b.id}: internLevel must be 0-${MAX_LEVEL}`);
      if (e.do === 'drain' && !(Number.isFinite(e.amount) && e.amount > 0 && e.amount <= 50)) errors.push(`${b.id}: drain amount must be 1-50`);
    }
  }
  for (const id of dormantIds ?? []) if (!revealed.has(id)) errors.push(`dormant file ${id} is never revealed`);
  return errors;
};
