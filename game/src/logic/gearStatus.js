// The live "is this working?" line under GEARGRIND.EXE's road. Pure, so it can be tested.
import { chargeTaper, drainRate } from '../core/power.js';
import { chargeBand, gradeAt, roadLength } from './gearbox.js';

const perMinute = (state, perSecond) => (perSecond * (state.clock?.msPerMinute ?? 2000)) / 1000;
const fmt = (v) => v.toFixed(1);

const CRAWL_KMH = 10;

// Text budgets, in characters. The canvas HUD column and the overlay are measured and wrapped
// as well, but keeping the strings short means they rarely need to.
export const HUD_CHARS = 24; // each look-ahead line
export const STATUS_CHARS = 60; // the status line before " | drain ..."
export const OVERLAY_CHARS = 32; // the big flash/warning text across the road

export const STALL_WORDS = { bog: 'BOGGED DOWN', 'over-rev': 'OVER-REVVED', surge: 'POWER SURGE' };
export const FLASHES = {
  clash: 'KEYS CLASH - DEFAULTS RESTORED',
  grind: 'GRRRIND! CLUTCH FIRST',
  start: 'ENGINE STARTED',
  stall: (why) => `STALLED: ${STALL_WORDS[why] ?? String(why).toUpperCase()}`,
};

// The big text across the road, or '' for none. flash is the text of a live flash, if any.
export const overlayStatus = (sim, { paused = false, flash = '', clutchHeld = false } = {}) => {
  if (paused) return 'PAUSED';
  if (flash) return flash;
  if (sim.stalled) return clutchHeld ? 'CRANKING...' : 'STALLED - HOLD CLUTCH TO RESTART';
  if (!sim.gear) return 'NEUTRAL - CLUTCH IN, SHIFT UP';
  if (sim.lug > 0.2) return 'BOGGING - CHANGE DOWN';
  if (sim.overRev > 0.3) return 'LIMITER - CHANGE UP';
  return '';
};

// Greedy word wrap to maxWidth, measured by measure(text) (characters by default, or pass
// ctx.measureText(t).width for pixels). A word too long for a line is split.
export const wrapText = (text, maxWidth, measure = (t) => t.length) => {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const tryLine = line ? `${line} ${word}` : word;
    if (measure(tryLine) <= maxWidth) {
      line = tryLine;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    while (measure(line) > maxWidth && line.length > 1) {
      let cut = line.length - 1;
      while (cut > 1 && measure(line.slice(0, cut)) > maxWidth) cut--;
      lines.push(line.slice(0, cut));
      line = line.slice(cut);
    }
  }
  if (line) lines.push(line);
  return lines;
};

// Returns [kind, text]. kind is 'yes' (charging), 'slow' (charging, out of the zone) or 'no'.
// Rates are per game minute, the same unit as the drain. Advice always fits the gear you're in:
// never "change down" in 1st, never "change up" in top.
export const chargeStatus = (cfg, sim, paused, state) => {
  if (paused) return ['no', 'PAUSED'];
  const drain = ` | drain -${fmt(drainRate(state))}%/min`;
  if (sim.stalled) return ['no', `NOT CHARGING: stalled - hold the clutch to restart${drain}`];
  if (!sim.gear) return ['no', `NOT CHARGING: neutral - clutch in, change up${drain}`];
  if (sim.clutch) return ['no', `NOT CHARGING: clutch in${drain}`];
  const band = chargeBand(cfg, sim.rpm);
  const low = sim.rpm < cfg.sweetBand[0];
  const top = sim.gear === cfg.gears.length;
  const fix = low
    ? sim.gear === 1
      ? sim.v * 3.6 < CRAWL_KMH
        ? "stay in 1st, it'll pull away"
        : "stay in 1st, it's climbing"
      : 'change down'
    : top
      ? 'dip the clutch'
      : 'change up';
  const level = band;
  const why = sim.gear === 1 && low ? 'revs too low' : top && !low ? 'revs too high in top gear' : `wrong gear - revs too ${low ? 'low' : 'high'}`;
  if (level < 0.2) return ['no', `NOT CHARGING: ${why}${sim.gear === 1 && low || top && !low ? ' - ' : ', '}${fix}${drain}`];
  const taper = chargeTaper(state);
  const rate = `+${fmt(perMinute(state, level * cfg.chargePerSecond * taper))}%/min`;
  if (level < 0.95) return ['slow', `CHARGING SLOWLY ${rate} - ${low && sim.gear > 1 ? 'change down for the CHARGE ZONE' : !low && !top ? 'change up for the CHARGE ZONE' : fix}${drain}`];
  return ['yes', `CHARGING ${rate}${taper < 0.6 ? ' (nearly full: slow)' : ''}${drain}`];
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
    if (steeper > 0.03 && sim.gear > 1) advice = 'change down soon';
    else if (steeper < -0.03 && sim.gear < cfg.gears.length) advice = 'change up soon';
  }
  return { text: `${word} ${pct} in ${dist} m`, advice, steeper, grade: next.grade };
};
