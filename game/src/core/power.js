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

// Linear interpolation over [[x, y], ...] sorted by x, clamped at the ends. Empty or missing tables give 1.
const curve = (table, x) => {
  if (!Array.isArray(table) || !table.length) return 1;
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i];
    if (x <= x1) {
      const [x0, y0] = table[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return table.at(-1)[1];
};

// Drain per game minute right now: the base rate, scaled by the night's drain curve (keyed by minutes
// into the shift, so the small hours bite harder) and by any story drainScale.
export const drainRate = (state) => {
  if (state.clock?.waiting) return 0; // generator parked, waiting for the audit
  const cfg = powerConfig(state);
  return cfg.drainPerMinute * curve(cfg.drainCurve, state.clock?.elapsed ?? 0) * (state.power?.drainScale ?? 1);
};

export const drainForMinutes = (state, minutes) => drainPower(state, Math.max(0, minutes) * drainRate(state));

// How well charge lands at a given level (0..1). The top of the tank is hard to fill.
export const chargeTaper = (state, level = powerLevel(state)) => Math.max(0, curve(powerConfig(state).chargeTaper, level));

// Applies a DRIVE_REPORT. The charge is tapered near full and clamped per report so nothing can top up
// the mainframe in one go.
export const chargePower = (state, charge) => {
  const raw = Number.isFinite(charge) ? Math.max(0, Math.min(powerConfig(state).chargeCapPerReport, charge)) : 0;
  return setLevel(state, state.power.level + raw * chargeTaper(state));
};

// Checks the power block of data/night.json. Returns a list of problems (empty when fine).
export const validatePowerConfig = (cfg = {}) => {
  const errors = [];
  if (!(cfg.start > 0 && cfg.start <= POWER_MAX)) errors.push('power.start must be in (0, 100]');
  if (!(cfg.drainPerMinute >= 0)) errors.push('power.drainPerMinute must be >= 0');
  if (!(cfg.chargeCapPerReport > 0)) errors.push('power.chargeCapPerReport must be positive');
  const t = cfg.thresholds ?? {};
  if (!(t.critical < t.brownout && t.brownout < t.flicker && t.flicker < POWER_MAX)) errors.push('power.thresholds need critical < brownout < flicker < 100');
  for (const key of ['drainCurve', 'chargeTaper']) {
    const table = cfg[key];
    if (table === undefined) continue;
    if (!Array.isArray(table) || !table.length || table.some((p, i) => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite) || p[1] < 0 || (i && p[0] <= table[i - 1][0]))) {
      errors.push(`power.${key} must be [[x, factor >= 0], ...] with rising x`);
    }
  }
  return errors;
};

export const generatorSummary = (state) => {
  const g = state.power?.generator ?? {};
  if (g.stalled) return 'STALLED';
  if (!g.running) return 'OFF';
  return g.gear ? `RUNNING in gear ${g.gear} at ${Math.round(g.rpm)} rpm` : `IDLING in neutral`;
};
