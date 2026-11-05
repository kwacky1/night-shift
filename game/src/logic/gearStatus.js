// The live "is this working?" line under GEARGRIND.EXE's road. Pure, so it can be tested.
import { chargeTaper, drainRate } from '../core/power.js';
import { chargeBand } from './gearbox.js';

const perMinute = (state, perSecond) => (perSecond * (state.clock?.msPerMinute ?? 2000)) / 1000;
const fmt = (v) => v.toFixed(1);

// Returns [kind, text]. kind is 'yes' (charging), 'slow' (charging, out of the zone) or 'no'.
// Rates are per game minute, the same unit as the drain.
export const chargeStatus = (cfg, sim, paused, state) => {
  if (paused) return ['no', 'PAUSED'];
  const drain = ` | drain -${fmt(drainRate(state))}%/min`;
  if (sim.stalled) return ['no', `NOT CHARGING: stalled - hold the clutch to restart${drain}`];
  if (!sim.gear) return ['no', `NOT CHARGING: neutral - hold the clutch and change up${drain}`];
  if (sim.clutch) return ['no', `NOT CHARGING: clutch in${drain}`];
  const band = chargeBand(cfg, sim.rpm);
  const low = sim.rpm < cfg.sweetBand[0];
  if (band < 0.2) return ['no', `NOT CHARGING: wrong gear - revs too ${low ? 'low, change down' : 'high, change up'}${drain}`];
  const taper = chargeTaper(state);
  const rate = `+${fmt(perMinute(state, band * cfg.chargePerSecond * taper))}%/min`;
  if (band < 0.95) return ['slow', `CHARGING SLOWLY ${rate} - change ${low ? 'down' : 'up'} for the CHARGE ZONE${drain}`];
  return ['yes', `CHARGING ${rate}${taper < 0.6 ? ' (nearly full, tops up slowly)' : ''}${drain}`];
};
