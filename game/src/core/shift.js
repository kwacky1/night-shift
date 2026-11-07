// End of shift: 06:00 or a blackout. Pure helpers used by the reducer and the save migration.
import { clockMinutes, formatClock } from './selectors.js';

export const END_REASONS = ['clock', 'blackout', 'audit'];

const END_TEXT = { clock: '06:00. Shift over.', blackout: 'BLACKOUT. Mainframe down. Shift over.', audit: 'Audit complete. Shift over.' };

// How the intern was used this shift: a real agent, the scripted fallback, or not at all.
export const internUsage = (stats) => {
  const aiActions = (stats.internOps ?? 0) + (stats.internKeys ?? 0) + (stats.internMessages ?? 0);
  if (aiActions > 0) return { mode: 'ai', count: aiActions };
  const scripted = (stats.scriptedReplies ?? 0) + (stats.scriptedOps ?? 0);
  if (scripted > 0) return { mode: 'scripted', count: scripted };
  return { mode: 'none', count: 0 };
};

export const shiftSummary = (state) => {
  const puzzles = Object.values(state.puzzles);
  const stats = state.stats ?? {};
  return {
    puzzlesSolved: puzzles.filter((p) => p.solved).length,
    puzzlesTotal: puzzles.length,
    power: Math.round(state.power?.level ?? 0),
    lowestPower: Math.round(state.power?.lowest ?? 0),
    distanceKm: Math.round((stats.distance ?? 0) / 100) / 10,
    stalls: stats.stalls ?? 0,
    internLevel: state.intern?.level ?? 0,
    intern: internUsage(stats),
  };
};

// 06:00 audit: the day crew take Generator 2. GEARGRIND.EXE shows this card; the figures are the
// end screen's (driving stops with the audit, so they can't drift before the verdict).
export const GENERATOR_PARKED = { title: '06:00. DAY CREW HAS THE GENERATOR.', pointer: 'Head Office is waiting in BLAME.EXE.' };
export const generatorWrapUp = (state) => {
  const { distanceKm, stalls, lowestPower } = shiftSummary(state);
  return { ...GENERATOR_PARKED, distanceKm, stalls, lowestPower };
};

// extra: anything to keep with the end (the audit passes its ending).
export const endShift = (state, reason, extra = {}) => {
  if (state.phase === 'over') return state;
  const at = formatClock(clockMinutes(state));
  const text = END_TEXT[reason] ?? END_TEXT.clock;
  const next = {
    ...state,
    phase: 'over',
    alert: null,
    log: [...state.log, { at, text }].slice(-100),
    power: { ...state.power, generator: { ...state.power.generator, running: false, rpm: 0 } },
  };
  return { ...next, shiftEnd: { reason, at, summary: shiftSummary(next), ...extra } };
};
