// Save loading and migration. Pure, so it can be tested without a browser.
// The rule: never hand back a save the player can't play. Anything odd starts a fresh shift.
import { STATE_VERSION, createInitialState } from './initialState.js';
import { createPower } from './power.js';
import { endShift } from './shift.js';
import { shiftMinutes } from './story.js';

const PLAYABLE = ['desktop', 'over'];

// Week 2 (v2) saves: keep what the player did (names, locks, puzzle progress, chat), take
// everything else (new files, power, story) from the fresh data.
const fromV2 = (saved, data) => {
  const fresh = createInitialState(data);
  const files = { ...fresh.files };
  for (const [id, f] of Object.entries(saved.files ?? {})) {
    if (files[id]) files[id] = { ...files[id], name: f.name ?? files[id].name, locked: Boolean(f.locked) };
  }
  const puzzles = { ...fresh.puzzles };
  for (const [id, p] of Object.entries(saved.puzzles ?? {})) {
    if (!puzzles[id]) continue;
    const { value, history, unlocked, solved, failed } = p;
    puzzles[id] = { ...puzzles[id], value, history: history ?? [], unlocked: unlocked ?? [], solved: Boolean(solved), failed: Boolean(failed) };
  }
  const { shiftOver, ...flags } = saved.flags ?? {};
  return {
    ...fresh,
    phase: 'desktop',
    clock: { ...fresh.clock, elapsed: Math.min(fresh.clock.length, saved.clock?.elapsed ?? 0) },
    files,
    puzzles,
    desktop: { positions: { ...fresh.desktop.positions, ...(saved.desktop?.positions ?? {}) } },
    flags,
    log: saved.log ?? [],
    intern: { ...fresh.intern, ...(saved.intern ?? {}) },
    windows: [],
    nextWindowId: saved.nextWindowId ?? 1,
    nextZ: saved.nextZ ?? 1,
    // Old saves don't know which timed beats would have fired, so treat the past as done.
    story: { ...fresh.story, fired: fresh.story.beats.filter((b) => b.at && shiftMinutes(b.at) <= (saved.clock?.elapsed ?? 0)).map((b) => b.id) },
    ...(shiftOver ? { _over: true } : {}),
  };
};

// Returns a playable state (phase 'desktop' or 'over') or null for "start a fresh game".
export const migrateSave = (saved, data) => {
  try {
    if (!saved || typeof saved !== 'object' || !PLAYABLE.includes(saved.phase)) return null;
    let s;
    if (saved.version === STATE_VERSION) s = saved;
    else if (saved.version === 2) s = fromV2(saved, data);
    else return null;
    if (!s.files || !s.puzzles || !s.clock || !s.power || !s.intern) return null;
    // Power tuning lives in data, so a saved shift picks up the current balance.
    if (data?.night?.power) s = { ...s, power: { ...s.power, config: createPower(data.night.power).config } };
    const { _over, ...state } = s;
    s = state;
    if (s.phase === 'desktop' && (_over || s.clock.elapsed >= s.clock.length)) s = endShift(s, 'clock');
    else if (s.phase === 'desktop' && s.power.level <= 0) s = endShift(s, 'blackout');
    if (s.phase === 'over' && !s.shiftEnd) s = endShift({ ...s, phase: 'desktop' }, 'clock');
    return s;
  } catch {
    return null;
  }
};
