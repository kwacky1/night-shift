// The live "is this working?" line under GEARGRIND.EXE's road. Pure, so it can be tested.
import { chargeTaper, drainRate } from '../core/power.js';
import { chargeBand, gradeAt, roadLength } from './gearbox.js';

const perMinute = (state, perSecond) => (perSecond * (state.clock?.msPerMinute ?? 2000)) / 1000;
const fmt = (v) => v.toFixed(1);

const CRAWL_KMH = 10;

// Returns [kind, text]. kind is 'yes' (charging), 'slow' (charging, out of the zone) or 'no'.
// Rates are per game minute, the same unit as the drain. Advice always fits the gear you're in:
// never "change down" in 1st, never "change up" in top.
export const chargeStatus = (cfg, sim, paused, state) => {
  if (paused) return ['no', 'PAUSED'];
  const drain = ` | drain -${fmt(drainRate(state))}%/min`;
  if (sim.stalled) return ['no', `NOT CHARGING: stalled - hold the clutch to restart${drain}`];
  if (!sim.gear) return ['no', `NOT CHARGING: neutral - hold the clutch and change up${drain}`];
  if (sim.clutch) return ['no', `NOT CHARGING: clutch in${drain}`];
  const band = chargeBand(cfg, sim.rpm);
  const low = sim.rpm < cfg.sweetBand[0];
  const top = sim.gear === cfg.gears.length;
  const fix = low
    ? sim.gear === 1
      ? sim.v * 3.6 < CRAWL_KMH
        ? "keep it in 1st, it'll pull away (or hold the clutch, let it rev, release)"
        : "keep it in 1st, it's climbing"
      : 'change down'
    : top
      ? 'dip the clutch if it sits on the limiter'
      : 'change up';
  const level = band;
  const why = sim.gear === 1 && low ? 'revs too low' : top && !low ? 'revs too high in top gear' : `wrong gear - revs too ${low ? 'low' : 'high'}`;
  if (level < 0.2) return ['no', `NOT CHARGING: ${why}${sim.gear === 1 && low || top && !low ? ' - ' : ', '}${fix}${drain}`];
  const taper = chargeTaper(state);
  const rate = `+${fmt(perMinute(state, level * cfg.chargePerSecond * taper))}%/min`;
  if (level < 0.95) return ['slow', `CHARGING SLOWLY ${rate} - ${low && sim.gear > 1 ? 'change down for the CHARGE ZONE' : !low && !top ? 'change up for the CHARGE ZONE' : fix}${drain}`];
  return ['yes', `CHARGING ${rate}${taper < 0.6 ? ' (nearly full, tops up slowly)' : ''}${drain}`];
};

// Points ahead where the grade changes noticeably (segment starts), looping with the road.
export const gradeChanges = (road, from, to) => {
  const total = roadLength(road);
  const out = [];
  const segs = road.segments;
  for (let lap = Math.floor(from / total) * total; lap < to; lap += total) {
    let pos = lap;
    segs.forEach((seg, i) => {
      const prev = segs[(i - 1 + segs.length) % segs.length].grade;
      if (pos >= from && pos <= to && Math.abs(seg.grade - prev) > 0.03) out.push({ x: pos, grade: seg.grade });
      pos += seg.length;
    });
  }
  return out;
};

// The HUD's look-ahead: { text, advice, steeper } for the next grade change within range, or null.
// It only advises when the current situation is fine (statusKind 'yes'), the cart is actually
// moving, and the gear can go that way, so it never contradicts the status line.
export const lookAhead = (cfg, sim, statusKind, range = 400) => {
  const next = gradeChanges(cfg.road, sim.x + 4, sim.x + range)[0];
  if (!next) return null;
  const dist = Math.max(0, Math.round((next.x - sim.x) / 10) * 10);
  const steeper = next.grade - gradeAt(cfg.road, sim.x);
  const word = next.grade >= 0.06 ? 'CLIMB' : next.grade <= -0.04 ? 'DESCENT' : steeper > 0 ? 'RISE' : 'EASING';
  const pct = `${next.grade > 0 ? '+' : ''}${Math.round(next.grade * 100)}%`;
  let advice = '';
  const moving = sim.running && sim.gear > 0 && sim.v * 3.6 >= CRAWL_KMH;
  if (statusKind === 'yes' && moving) {
    if (steeper > 0.03 && sim.gear > 1) advice = 'change down as the revs drop';
    else if (steeper < -0.03 && sim.gear < cfg.gears.length) advice = 'change up as the revs rise';
  }
  return { text: `${word} ${pct} in ${dist} m`, advice, steeper, grade: next.grade };
};
