import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reducer } from '../src/core/reducer.js';
import { actions } from '../src/core/actions.js';
import { createInitialState } from '../src/core/initialState.js';
import { createSim, roadLength } from '../src/logic/gearbox.js';
import { chargeStatus, gradeChanges, lookAhead } from '../src/logic/gearStatus.js';

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

const moving = (gear, kmh, rpm) => sim({ gear, v: kmh / 3.6, rpm });

test('in 1st it never says "change down"', () => {
  const crawl = chargeStatus(cfg, moving(1, 2, cfg.launchRpm), false, state)[1];
  assert.doesNotMatch(crawl, /change down/);
  assert.match(crawl, /keep it in 1st, it'll pull away|hold the clutch, let it rev, release/);
  const climbing = chargeStatus(cfg, moving(1, 15, 2400), false, state)[1];
  assert.doesNotMatch(climbing, /change down/);
  assert.match(climbing, /keep it in 1st/);
  for (let rpm = 900; rpm < cfg.sweetBand[0]; rpm += 100) {
    assert.doesNotMatch(chargeStatus(cfg, moving(1, 10, rpm), false, state)[1], /change down/);
  }
});

test('in top gear it never says "change up"', () => {
  const top = cfg.gears.length;
  for (let rpm = cfg.sweetBand[1]; rpm <= cfg.redline; rpm += 100) {
    assert.doesNotMatch(chargeStatus(cfg, moving(top, 150, rpm), false, state)[1], /change up/);
  }
});

const onRoad = (patch) => {
  // Just before the first climb that starts after a flatter stretch.
  const changes = gradeChanges(cfg.road, 1, roadLength(cfg.road));
  const climb = changes.find((c) => c.grade >= 0.1);
  const descent = changes.find((c) => c.grade <= -0.08);
  return { climb, descent, at: (c) => sim({ x: c.x - 150, ...patch }) };
};

test('look-ahead only advises when moving, the zone is fine and the gear can go that way', () => {
  const { climb, descent, at } = onRoad({});
  const mid = (cfg.sweetBand[0] + cfg.sweetBand[1]) / 2;
  const go = (c, gear, kmh) => lookAhead(cfg, { ...at(c), gear, v: kmh / 3.6, rpm: mid }, 'yes');
  assert.match(go(climb, 3, 50).text, /^CLIMB \+\d+% in \d+ m$/);
  assert.equal(go(climb, 3, 50).advice, 'change down as the revs drop');
  assert.equal(go(climb, 1, 20).advice, '');
  assert.equal(go(descent, 3, 50).advice, 'change up as the revs rise');
  assert.equal(go(descent, cfg.gears.length, 120).advice, '');
  // Stopped or crawling: no advice at all, whatever is ahead.
  assert.equal(go(descent, 1, 0).advice, '');
  assert.equal(go(climb, 2, 3).advice, '');
  // The status line has priority: when it is not 'yes', look-ahead stays quiet.
  for (const kind of ['no', 'slow']) {
    assert.equal(lookAhead(cfg, { ...at(descent), gear: 2, v: 50 / 3.6, rpm: mid }, kind).advice, '');
  }
});

test('the stuck-on-a-hill case from the playtest gets one actionable line', () => {
  // 1st, 0 km/h, +15%, with an easier +8% ahead.
  const s = sim({ gear: 1, v: 0, rpm: cfg.launchRpm, x: 0 });
  const [kind, text] = chargeStatus(cfg, s, false, state);
  assert.equal(kind, 'no');
  assert.doesNotMatch(text, /change (down|up)/);
  const changes = gradeChanges(cfg.road, 1, roadLength(cfg.road));
  const easing = changes.find((c, i) => i > 0 && c.grade < changes[i - 1].grade && c.grade > 0) ?? changes[0];
  const ahead = lookAhead(cfg, { ...s, x: easing.x - 100 }, kind);
  assert.equal(ahead?.advice ?? '', '');
});
