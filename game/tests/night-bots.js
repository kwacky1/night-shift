// Balance harness (not a test file): plays a whole night with a scripted driver.
// Mirrors the browser: a 60 Hz gearbox sim, a DRIVE_REPORT every 250 ms, a TICK every game minute,
// story alerts dismissed straight away and story stalls applied to the sim. Pure and deterministic.
import { reducer } from '../src/core/reducer.js';
import { actions } from '../src/core/actions.js';
import { createInitialState } from '../src/core/initialState.js';
import { createSim, forceStall, step, STEP_DT, wheelRpm } from '../src/logic/gearbox.js';

const REPORT_STEPS = 15; // 250 ms

// Restart drill shared by the bots: hold the clutch to crank, and pick a gear that suits the road
// speed while it's in (1st from a standstill).
const restart = (sim, cfg, top = cfg.gears.length) => {
  if (!sim.stalled) return null;
  let want = 1;
  for (let g = top; g > 1; g--) if (wheelRpm(cfg, g, sim.v) >= 2000) { want = g; break; }
  return { clutch: true, down: sim.gear > want, up: sim.gear < want };
};

// Holds the clutch for a beat after each shift, like a person would.
const shiftWith = (mem, dir) => {
  mem.hold = 0.15;
  return { clutch: true, [dir]: true };
};

// Holds one gear all night. It has to launch through the lower gears from a standstill (after a
// stall it's back in 1st), but once it reaches its gear it never changes down.
export const fixedGearBot = (gear) => (sim, cfg, mem) => {
  const r = restart(sim, cfg, gear);
  if (r) return r;
  if (mem.hold > 0) {
    mem.hold -= STEP_DT;
    return { clutch: true };
  }
  if (sim.gear === 0) return shiftWith(mem, 'up');
  if (sim.gear < gear && sim.rpm >= 5000) return shiftWith(mem, 'up');
  return {};
};

// Shifts on rpm thresholds: up near the top of the charge zone, down when the revs sag or it lugs.
export const shifterBot = ({ up = 5000, down = 2700 } = {}) => (sim, cfg, mem) => {
  const r = restart(sim, cfg);
  if (r) return r;
  if (mem.hold > 0) {
    mem.hold -= STEP_DT;
    return { clutch: true };
  }
  if (sim.gear === 0) return shiftWith(mem, 'up');
  if (sim.gear < cfg.gears.length && sim.rpm >= up) return shiftWith(mem, 'up');
  if (sim.gear > 1 && (sim.rpm <= down || sim.lug > 0) && wheelRpm(cfg, sim.gear - 1, sim.v) < cfg.redline * 0.92) return shiftWith(mem, 'down');
  return {};
};

// Never touches the generator.
export const idleBot = () => () => ({});

// Plays one night. Returns a summary of the power over the shift.
export const playNight = (data, gearbox, bot) => {
  let state = [actions.bootComplete(), actions.clockIn()].reduce(reducer, createInitialState(data));
  let sim = createSim(gearbox);
  const mem = { hold: 0 };
  const stepsPerMinute = Math.round(state.clock.msPerMinute / 1000 / STEP_DT);
  let acc = { charge: 0, distance: 0, stalls: 0 };
  let stallSeq = state.power.stallSeq;
  let shifts = 0;
  const levels = [];
  for (let n = 1; state.phase === 'desktop'; n++) {
    const before = sim;
    sim = step(sim, bot(sim, gearbox, mem), STEP_DT, gearbox);
    shifts += sim.events.filter((e) => e.type === 'shift').length;
    acc.charge += sim.charge - before.charge;
    acc.distance += sim.x - before.x;
    acc.stalls += sim.stalls - before.stalls;
    if (n % REPORT_STEPS === 0) {
      state = reducer(state, actions.driveReport({ ...acc, running: sim.running, stalled: sim.stalled, gear: sim.gear, rpm: sim.rpm }));
      acc = { charge: 0, distance: 0, stalls: 0 };
    }
    if (n % stepsPerMinute === 0) {
      state = reducer(state, actions.tick(1));
      levels.push(state.power.level);
      if (state.alert) state = reducer(state, actions.dismissAlert());
      if (state.power.stallSeq !== stallSeq) {
        stallSeq = state.power.stallSeq;
        const forced = forceStall(sim);
        acc.stalls += forced.stalls - sim.stalls;
        sim = forced;
      }
    }
  }
  const minutes = levels.length;
  const above = (x) => levels.filter((l) => l > x).length / Math.max(1, minutes);
  const secondHalf = levels.slice(Math.floor(minutes / 2));
  return {
    end: state.shiftEnd?.reason ?? state.phase,
    minutes,
    final: state.power.level,
    lowest: state.power.lowest,
    mean: levels.reduce((a, b) => a + b, 0) / Math.max(1, minutes),
    lateMean: secondHalf.reduce((a, b) => a + b, 0) / Math.max(1, secondHalf.length),
    above70: above(70),
    stalls: state.stats.stalls,
    shifts,
    km: state.stats.distance / 1000,
    shiftEvery: shifts ? (minutes * state.clock.msPerMinute) / 1000 / shifts : Infinity,
  };
};
