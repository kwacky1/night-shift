// Mainframe power. Pure helpers shared by the reducer, the UI, the bridge and the MCP projection.
// Power drains with the clock and is recharged by driving GEARGRIND.EXE (DRIVE_REPORT actions).
//
//   ok        all good
//   flicker   below thresholds.flicker: the screen dims and flickers
//   brownout  below thresholds.brownout: the intern line browns out (no remote ops or keys)
//   critical  below thresholds.critical: Bit Rot ops are disabled for everyone
//   blackout  0: the mainframe goes down and the shift ends

export const POWER_MAX = 100;

// Without data/night.json there is no drain, so bare test fixtures behave like week 2.
export const DEFAULT_POWER_CONFIG = Object.freeze({
  start: POWER_MAX,
  drainPerMinute: 0,
  chargeCapPerReport: 2,
  thresholds: Object.freeze({ flicker: 50, brownout: 30, critical: 15 }),
  nagBelow: 40,
});

export const POWER_STATUSES = ['ok', 'flicker', 'brownout', 'critical', 'blackout'];

const clamp = (v) => Math.max(0, Math.min(POWER_MAX, v));
const round = (v) => Math.round(v * 100) / 100;

export const createPower = (config = {}) => {
  const cfg = {
    ...DEFAULT_POWER_CONFIG,
    ...config,
    thresholds: { ...DEFAULT_POWER_CONFIG.thresholds, ...(config.thresholds ?? {}) },
  };
  const level = clamp(cfg.start);
  return {
    level,
    lowest: level,
    drainScale: 1,
    generator: { running: false, stalled: false, gear: 0, rpm: 0 },
    stallSeq: 0,
    surgeSeq: 0,
    config: cfg,
  };
};

export const powerConfig = (state) => state.power?.config ?? DEFAULT_POWER_CONFIG;

export const powerLevel = (state) => state.power?.level ?? POWER_MAX;

export const powerStatus = (state) => {
  const level = powerLevel(state);
  const t = powerConfig(state).thresholds;
  if (level <= 0) return 'blackout';
  if (level < t.critical) return 'critical';
  if (level < t.brownout) return 'brownout';
  if (level < t.flicker) return 'flicker';
  return 'ok';
};

// The intern line browns out below the brownout threshold: no remote ops or keys, chat still works.
export const isBrownout = (state) => ['brownout', 'critical', 'blackout'].includes(powerStatus(state));

// Bit Rot needs a minimum of power to run at all.
export const isBitrotPowered = (state) => !['critical', 'blackout'].includes(powerStatus(state));

const setLevel = (state, level) => {
  const next = round(clamp(level));
  if (next === state.power.level) return state;
  return { ...state, power: { ...state.power, level: next, lowest: Math.min(state.power.lowest, next) } };
};

export const drainPower = (state, amount) => setLevel(state, state.power.level - Math.max(0, amount));

export const drainForMinutes = (state, minutes) =>
  drainPower(state, Math.max(0, minutes) * powerConfig(state).drainPerMinute * (state.power.drainScale ?? 1));

// Applies a DRIVE_REPORT. The charge is clamped per report so nothing can top up the mainframe in one go.
export const chargePower = (state, charge) => {
  const amount = Number.isFinite(charge) ? Math.max(0, Math.min(powerConfig(state).chargeCapPerReport, charge)) : 0;
  return setLevel(state, state.power.level + amount);
};

export const generatorSummary = (state) => {
  const g = state.power?.generator ?? {};
  if (g.stalled) return 'STALLED';
  if (!g.running) return 'OFF';
  return g.gear ? `RUNNING in gear ${g.gear} at ${Math.round(g.rpm)} rpm` : `IDLING in neutral`;
};
