import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { advance, chargeBand, DEFAULT_GEAR_KEYS, sanitiseGearKeys, createSim, forceStall, gradeAt, lookup, roadLength, step, STEP_DT, validateGearbox, wheelRpm } from '../src/logic/gearbox.js';

const cfg = JSON.parse(readFileSync(new URL('../data/gearbox.json', import.meta.url)));
const flat = (grade = 0) => ({ ...cfg, road: { ramp: 0, segments: [{ length: 10000, grade }] } });

const run = (sim, seconds, input, c = cfg) => {
  const events = [];
  for (let i = 0; i < Math.round(seconds / STEP_DT); i++) {
    sim = step(sim, typeof input === 'function' ? input(sim, i) : input, STEP_DT, c);
    events.push(...sim.events);
  }
  return { sim, events };
};

// Put the car in a gear at a speed, clutch out.
const rolling = (gear, kmh, c = cfg) => ({ ...createSim(c), gear, v: kmh / 3.6, rpm: wheelRpm(c, gear, kmh / 3.6) });

// A sensible driver: change up near the top of the band, down when it bogs. Clutch in for a few frames.
const goodDriver = () => {
  let phase = null;
  let k = 0;
  return (s) => {
    if (phase) {
      k++;
      const input = { clutch: k < 8, up: phase === 'up' && k === 3, down: phase === 'down' && k === 3 };
      if (k >= 8) phase = null;
      return input;
    }
    if (s.gear === 0 || (s.rpm > 5200 && s.gear < cfg.gears.length)) phase = 'up';
    else if (s.rpm < 2000 && s.gear > 1) phase = 'down';
    k = 0;
    return phase ? { clutch: true } : {};
  };
};

test('gearbox.json is valid, and validateGearbox catches nonsense', () => {
  assert.deepEqual(validateGearbox(cfg), []);
  assert.ok(validateGearbox({ ...cfg, redline: 100 }).length);
  assert.ok(validateGearbox({ ...cfg, gears: [cfg.gears[1], cfg.gears[0], cfg.gears[2]] }).some((e) => /taller/.test(e)));
  assert.ok(validateGearbox({ ...cfg, road: { segments: [{ length: 10, grade: 0.9 }] } }).length);
  assert.ok(validateGearbox({ ...cfg, chargeCurve: [[1000, 0], [4000, 0.8], [6000, 0]] }).some((e) => /CHARGE ZONE/.test(e)));
  assert.ok(validateGearbox({ ...cfg, chargeCurve: [[1000, 2], [900, 0]] }).length);
});

test('charge falls away quickly outside the CHARGE ZONE', () => {
  const [lo, hi] = cfg.sweetBand;
  assert.equal(chargeBand(cfg, lo), 1);
  assert.equal(chargeBand(cfg, hi), 1);
  assert.ok(chargeBand(cfg, lo - 600) < 0.3, 'well below the zone barely charges');
  assert.ok(chargeBand(cfg, hi + 600) < 0.5, 'well above the zone barely charges');
});

test('the road needs every gear: steep climbs and long descents, no long flats', () => {
  const grades = cfg.road.segments.map((s) => s.grade);
  assert.ok(grades.some((g) => g >= 0.15), 'a climb that needs 2nd');
  assert.ok(grades.some((g) => g <= -0.1), 'a descent that needs 5th');
  const flat = cfg.road.segments.filter((s) => Math.abs(s.grade) < 0.04).reduce((a, s) => a + s.length, 0);
  assert.ok(flat / roadLength(cfg.road) < 0.2, 'mostly not flat');
});

test('torque lookup interpolates linearly and clamps at the ends', () => {
  const t = [[1000, 100], [2000, 300], [4000, 100]];
  assert.equal(lookup(t, 500), 100);
  assert.equal(lookup(t, 1500), 200);
  assert.equal(lookup(t, 3000), 200);
  assert.equal(lookup(t, 9000), 100);
});

test('the road ramps between grades and loops', () => {
  const road = { ramp: 100, segments: [{ length: 200, grade: 0 }, { length: 200, grade: 0.1 }] };
  assert.equal(gradeAt(road, 50), 0.05, 'ramping in from the previous (looped) segment');
  assert.equal(gradeAt(road, 150), 0);
  assert.ok(Math.abs(gradeAt(road, 250) - 0.05) < 1e-9);
  assert.equal(gradeAt(road, 350), 0.1);
  assert.equal(gradeAt(road, 350 + roadLength(road)), 0.1);
});

test('the sim is deterministic', () => {
  const a = run(createSim(cfg), 30, goodDriver());
  const b = run(createSim(cfg), 30, goodDriver());
  assert.deepEqual(a.sim, b.sim);
  assert.deepEqual(a.events, b.events);
});

test('launching in 1st gets moving and starts charging', () => {
  let sim = step(createSim(cfg), { clutch: true, up: true }, STEP_DT, cfg);
  assert.equal(sim.gear, 1);
  ({ sim } = run(sim, 3, {}));
  assert.ok(sim.running);
  assert.ok(sim.v > 5, `moving: ${sim.v}`);
  assert.ok(sim.charge > 0);
});

test('shifting without the clutch grinds and does nothing', () => {
  const sim = step(rolling(2, 30), { up: true }, STEP_DT, cfg);
  assert.equal(sim.gear, 2);
  assert.deepEqual(sim.events, [{ type: 'grind' }]);
});

test('too tall a gear on a climb bogs down and stalls', () => {
  const c = flat(0.1);
  const { sim, events } = run(rolling(5, 40, c), 10, {}, c);
  assert.ok(sim.stalled);
  assert.deepEqual(events.find((e) => e.type === 'stall'), { type: 'stall', why: 'bog' });
});

test('the right gear holds the same climb', () => {
  const c = flat(0.1);
  const { sim } = run(rolling(2, 40, c), 10, {}, c);
  assert.ok(sim.running && !sim.stalled);
  assert.ok(sim.charge > 0.6 * cfg.chargePerSecond * 10, `charge ${sim.charge}`);
});

test('holding 1st on the limiter over-revs and stalls', () => {
  const { sim, events } = run(rolling(1, 10), 15, {});
  assert.ok(sim.stalled);
  assert.equal(events.find((e) => e.type === 'stall').why, 'over-rev');
});

test('dropping into 1st at speed blows it straight away', () => {
  let sim = rolling(3, 90, flat());
  sim = step(sim, { clutch: true, down: true }, STEP_DT, cfg);
  sim = step(sim, { clutch: true, down: true }, STEP_DT, cfg);
  assert.equal(sim.gear, 1);
  sim = step(sim, {}, STEP_DT, cfg);
  assert.ok(sim.stalled);
  assert.deepEqual(sim.events, [{ type: 'stall', why: 'over-rev' }]);
});

test('a stalled engine restarts after holding the clutch', () => {
  let sim = forceStall(rolling(2, 30));
  assert.ok(sim.stalled);
  assert.deepEqual(sim.events, [{ type: 'stall', why: 'surge' }]);
  ({ sim } = run(sim, cfg.crankSeconds / 2, { clutch: true }));
  assert.ok(sim.stalled, 'not yet');
  const { sim: started, events } = run(sim, cfg.crankSeconds, { clutch: true });
  assert.ok(started.running && !started.stalled);
  assert.ok(events.some((e) => e.type === 'start'));
});

test('no charge out of gear, on the limiter or while stalled', () => {
  assert.equal(chargeBand(cfg, cfg.idleRpm - 1), 0);
  assert.equal(chargeBand(cfg, cfg.redline), 0);
  assert.equal(chargeBand(cfg, (cfg.sweetBand[0] + cfg.sweetBand[1]) / 2), 1);
  const { sim } = run({ ...createSim(cfg), gear: 0 }, 5, {});
  assert.equal(sim.charge, 0);
  const { sim: stalled } = run(forceStall(rolling(3, 50)), 5, {});
  assert.equal(stalled.charge, 0);
});

test('a sensible driver lasts a minute on the real road without stalling and charges well', () => {
  const { sim, events } = run(createSim(cfg), 60, goodDriver());
  assert.equal(sim.stalls, 0, JSON.stringify(events.filter((e) => e.type === 'stall')));
  assert.ok(sim.charge > 0.75 * cfg.chargePerSecond * 60, `charge ${sim.charge}`);
});

test('leaving it in top gear stalls somewhere on the real road', () => {
  const lazy = (s, i) => (s.gear < cfg.gears.length && i % 20 < 10 ? { clutch: true, up: i % 20 === 5 } : {});
  const { events } = run(createSim(cfg), 180, lazy);
  assert.ok(events.some((e) => e.type === 'stall'));
});

test('advance runs whole fixed steps and carries the remainder', () => {
  const a = advance(createSim(cfg), { clutch: true, up: true }, 0.05, cfg);
  assert.equal(a.sim.gear, 1, 'edge input applied once');
  assert.ok(a.carry >= 0 && a.carry < STEP_DT);
  const b = advance(a.sim, { clutch: true, up: true }, 0.001, cfg, 0);
  assert.equal(b.applied, false, 'too short for a step, input not consumed');
});

test('gear key bindings: defaults, saved values, and clashes fall back', () => {
  assert.deepEqual(sanitiseGearKeys(null), DEFAULT_GEAR_KEYS);
  assert.deepEqual(sanitiseGearKeys({ clutch: 'KeyC', up: 'KeyW' }), { clutch: 'KeyC', up: 'KeyW', down: 'ShiftLeft' });
  assert.deepEqual(sanitiseGearKeys({ clutch: 'KeyC', up: 'KeyC', down: 'KeyX' }), DEFAULT_GEAR_KEYS, 'two actions on one key');
  assert.deepEqual(sanitiseGearKeys({ clutch: '<script>' }), DEFAULT_GEAR_KEYS);
});
