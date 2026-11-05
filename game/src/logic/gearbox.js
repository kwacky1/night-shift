// GEARGRIND.EXE simulation: a manual-gearbox runner that charges the mainframe.
// Pure and deterministic: step(sim, input, dt, cfg) -> new sim. No DOM, no clock, no randomness.
// The throttle is always on. The player only works the clutch and shifts up/down.
//
//   engaged     clutch out and in gear: engine rpm follows road speed (rpm = km/h / kmhPer1000 * 1000).
//               Below idle the clutch slips and holds the engine at idle.
//   lugging     in 2nd or higher below lugRpm: the engine bogs. Too long and it stalls.
//   limiter     at the redline the limiter cuts drive. Sitting on it too long (or over-revving far past
//               it, e.g. dropping into 1st at speed) stalls the engine.
//   free-rev    clutch in or in neutral: the engine revs towards freeRevRpm.
//   grind       shifting without the clutch while the engine runs: nothing happens but a nasty noise.
//   restart     when stalled, hold the clutch for crankSeconds.
//
// Charge comes only from driving in gear, scaled by how close the rpm is to the sweet band.

export const STEP_DT = 1 / 60;
const KMH = 3.6;

// Linear interpolation over [[x, y], ...] sorted by x. Clamps at the ends.
export const lookup = (table, x) => {
  if (!table.length) return 0;
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

export const roadLength = (road) => road.segments.reduce((sum, s) => sum + s.length, 0);

// Grade (rise over run, 0.1 = 10%) at distance x. The road loops. Each segment ramps in from the
// previous segment's grade over road.ramp metres.
export const gradeAt = (road, x) => {
  const segs = road.segments;
  const total = roadLength(road);
  let pos = ((x % total) + total) % total;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    if (pos < seg.length) {
      const prev = segs[(i - 1 + segs.length) % segs.length].grade;
      const ramp = Math.min(road.ramp ?? 0, seg.length);
      return ramp && pos < ramp ? prev + ((seg.grade - prev) * pos) / ramp : seg.grade;
    }
    pos -= seg.length;
  }
  return segs.at(-1).grade;
};

// Road height relative to the start, for drawing. Integrates the grade.
export const heightProfile = (road, from, to, samples) => {
  const out = [];
  let h = 0;
  const step = (to - from) / Math.max(1, samples - 1);
  for (let i = 0; i < samples; i++) {
    const x = from + i * step;
    if (i) h += gradeAt(road, x - step / 2) * step;
    out.push({ x, h });
  }
  return out;
};

export const wheelRpm = (cfg, gear, v) => (gear > 0 ? ((v * KMH) / cfg.gears[gear - 1].kmhPer1000) * 1000 : 0);

// 0..1: how well this rpm charges the mainframe.
export const chargeBand = (cfg, rpm) => {
  const [lo, hi] = cfg.sweetBand;
  if (rpm < cfg.idleRpm || rpm >= cfg.redline) return 0;
  if (rpm < lo) return (rpm - cfg.idleRpm) / (lo - cfg.idleRpm);
  if (rpm <= hi) return 1;
  return 1 - (0.7 * (rpm - hi)) / (cfg.redline - hi);
};

export const createSim = (cfg) => ({
  t: 0,
  x: 0,
  v: 0,
  rpm: cfg.idleRpm,
  gear: 0,
  clutch: false,
  running: true,
  stalled: false,
  crank: 0,
  lug: 0,
  overRev: 0,
  grade: gradeAt(cfg.road, 0),
  charge: 0,
  stalls: 0,
  events: [],
});

const stall = (sim, why, events) => {
  events.push({ type: 'stall', why });
  return { ...sim, running: false, stalled: true, rpm: 0, lug: 0, overRev: 0, crank: 0, stalls: sim.stalls + 1 };
};

// Force the engine to stall (a story beat). Pure.
export const forceStall = (sim, why = 'surge') => {
  if (!sim.running) return sim;
  const events = [];
  return { ...stall(sim, why, events), events };
};

export const step = (sim, input = {}, dt = STEP_DT, cfg) => {
  const events = [];
  const clutch = !!input.clutch;
  let s = { ...sim, clutch, t: sim.t + dt };

  // Shifting.
  const shift = (input.up ? 1 : 0) - (input.down ? 1 : 0);
  if (shift) {
    if (s.running && !clutch) events.push({ type: 'grind' });
    else {
      const gear = Math.max(0, Math.min(cfg.gears.length, s.gear + shift));
      if (gear !== s.gear) events.push({ type: 'shift', gear });
      s.gear = gear;
    }
  }

  // Restart: hold the clutch.
  if (!s.running) {
    s.crank = clutch ? s.crank + dt : 0;
    if (s.crank >= cfg.crankSeconds) {
      s = { ...s, running: true, stalled: false, crank: 0, rpm: cfg.idleRpm };
      events.push({ type: 'start' });
    }
  }

  const engaged = s.running && !clutch && s.gear > 0;
  let force = 0;
  let charge = 0;
  if (engaged) {
    const gear = cfg.gears[s.gear - 1];
    const wr = wheelRpm(cfg, s.gear, s.v);
    if (wr > cfg.blowRpm) return { ...stall(s, 'over-rev', events), events };
    s.rpm = Math.max(wr, cfg.idleRpm);
    s.lug = s.gear > 1 && wr < cfg.lugRpm ? s.lug + dt : Math.max(0, s.lug - dt);
    if (s.lug >= cfg.lugStallSeconds) return { ...stall(s, 'bog', events), events };
    const limiting = s.rpm >= cfg.redline;
    s.overRev = s.rpm >= cfg.redline * 0.98 ? s.overRev + dt : Math.max(0, s.overRev - dt);
    if (s.overRev >= cfg.overRevStallSeconds) return { ...stall(s, 'over-rev', events), events };
    force = limiting ? 0 : lookup(gear.torque, s.rpm);
    if (wr >= cfg.idleRpm) charge = chargeBand(cfg, s.rpm) * cfg.chargePerSecond * dt;
  } else {
    s.lug = 0;
    s.overRev = Math.max(0, s.overRev - dt);
    if (s.running) {
      const towards = cfg.freeRevRpm;
      const delta = cfg.revRate * dt;
      s.rpm = s.rpm < towards ? Math.min(towards, s.rpm + delta) : Math.max(towards, s.rpm - delta);
    } else s.rpm = 0;
  }

  const grade = gradeAt(cfg.road, s.x);
  const resist = cfg.mass * cfg.gravity * (grade + (s.v > 0 ? cfg.rolling : 0)) + cfg.drag * s.v * s.v;
  const v = Math.max(0, s.v + ((force - resist) / cfg.mass) * dt);
  return { ...s, v, x: s.x + v * dt, grade, charge: s.charge + charge, events };
};

// Runs whole fixed steps for an elapsed real time. Returns { sim, events, carry } where carry is the
// leftover time to pass in next frame. Edge inputs (up/down) are applied to the first step only.
export const advance = (sim, input, elapsed, cfg, carry = 0) => {
  let t = carry + Math.min(elapsed, 0.25);
  const events = [];
  let first = true;
  let s = sim;
  while (t >= STEP_DT) {
    s = step(s, first ? input : { clutch: input.clutch }, STEP_DT, cfg);
    events.push(...s.events);
    first = false;
    t -= STEP_DT;
  }
  return { sim: s, events, carry: t, applied: !first };
};

// Checks data/gearbox.json. Returns a list of problems (empty when fine).
export const validateGearbox = (cfg) => {
  const errors = [];
  const num = (k) => {
    if (!Number.isFinite(cfg[k]) || cfg[k] <= 0) errors.push(`${k} must be a positive number`);
  };
  ['mass', 'gravity', 'drag', 'idleRpm', 'lugRpm', 'redline', 'blowRpm', 'freeRevRpm', 'revRate', 'crankSeconds', 'lugStallSeconds', 'overRevStallSeconds', 'chargePerSecond'].forEach(num);
  if (!(cfg.idleRpm < cfg.lugRpm && cfg.lugRpm < cfg.redline && cfg.redline < cfg.blowRpm)) errors.push('need idleRpm < lugRpm < redline < blowRpm');
  if (cfg.freeRevRpm >= cfg.redline) errors.push('freeRevRpm must be below the redline');
  if (!Array.isArray(cfg.sweetBand) || !(cfg.idleRpm < cfg.sweetBand[0] && cfg.sweetBand[0] < cfg.sweetBand[1] && cfg.sweetBand[1] < cfg.redline)) errors.push('sweetBand must sit between idle and redline');
  if (!Array.isArray(cfg.gears) || cfg.gears.length < 3) errors.push('need at least 3 gears');
  (cfg.gears ?? []).forEach((g, i) => {
    if (!(g.kmhPer1000 > 0)) errors.push(`gear ${i + 1}: kmhPer1000 must be positive`);
    if (i && !(g.kmhPer1000 > cfg.gears[i - 1].kmhPer1000)) errors.push(`gear ${i + 1}: must be taller than gear ${i}`);
    const t = g.torque;
    if (!Array.isArray(t) || t.length < 2 || t.some((p, j) => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite) || (j && p[0] <= t[j - 1][0]))) {
      errors.push(`gear ${i + 1}: torque must be [[rpm, force], ...] with rising rpm`);
    }
  });
  const segs = cfg.road?.segments;
  if (!Array.isArray(segs) || !segs.length) errors.push('road.segments must be a non-empty list');
  else segs.forEach((s, i) => {
    if (!(s.length > 0) || !Number.isFinite(s.grade) || Math.abs(s.grade) > 0.3) errors.push(`road segment ${i}: needs length > 0 and |grade| <= 0.3`);
  });
  return errors;
};
