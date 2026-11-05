import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reducer } from '../src/core/reducer.js';
import { actions } from '../src/core/actions.js';
import { createInitialState } from '../src/core/initialState.js';
import { createSim } from '../src/logic/gearbox.js';
import { chargeStatus } from '../src/logic/gearStatus.js';

const load = (name) => JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url)));
const cfg = load('gearbox.json');
const state = [actions.bootComplete(), actions.clockIn()].reduce(reducer, createInitialState({ files: [], puzzles: [], night: load('night.json'), story: { beats: [] } }));
const at = (level) => ({ ...state, power: { ...state.power, level } });
const sim = (patch) => ({ ...createSim(cfg), running: true, ...patch });

test('the status line says why the generator is not charging', () => {
  assert.deepEqual(chargeStatus(cfg, sim({}), true, state), ['no', 'PAUSED']);
  assert.match(chargeStatus(cfg, sim({ running: false, stalled: true, gear: 2 }), false, state)[1], /^NOT CHARGING: stalled/);
  assert.match(chargeStatus(cfg, sim({ gear: 0 }), false, state)[1], /^NOT CHARGING: neutral/);
  assert.match(chargeStatus(cfg, sim({ gear: 3, rpm: 4000, clutch: true }), false, state)[1], /^NOT CHARGING: clutch in/);
  assert.match(chargeStatus(cfg, sim({ gear: 4, rpm: 1500 }), false, state)[1], /^NOT CHARGING: wrong gear - revs too low, change down/);
  assert.match(chargeStatus(cfg, sim({ gear: 1, rpm: 6200 }), false, state)[1], /revs too high, change up/);
});

test('in the CHARGE ZONE it shows the rate against the drain, per game minute', () => {
  const rpm = (cfg.sweetBand[0] + cfg.sweetBand[1]) / 2;
  const [kind, text] = chargeStatus(cfg, sim({ gear: 3, rpm, v: 1 }), false, at(40));
  assert.equal(kind, 'yes');
  const perMinute = (cfg.chargePerSecond * state.clock.msPerMinute) / 1000;
  assert.ok(text.startsWith(`CHARGING +${perMinute.toFixed(1)}%/min`), text);
  assert.match(text, /drain -\d+\.\d%\/min/);
  assert.match(chargeStatus(cfg, sim({ gear: 3, rpm }), false, at(97))[1], /nearly full/);
  const edge = chargeStatus(cfg, sim({ gear: 3, rpm: cfg.sweetBand[0] - 250 }), false, state);
  assert.equal(edge[0], 'slow');
  assert.match(edge[1], /change down for the CHARGE ZONE/);
});
