import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fixedGearBot, idleBot, playNight, shifterBot } from './night-bots.js';

// Whole-night balance checks with scripted drivers (see night-bots.js and scripts/balance.js).
const load = async (name) => JSON.parse(await readFile(new URL(`../data/${name}`, import.meta.url), 'utf8'));
const data = { files: await load('files.json'), puzzles: await load('puzzles.json'), night: await load('night.json'), story: await load('story.json') };
const gearbox = await load('gearbox.json');

test('nobody driving: blackout well before 06:00', () => {
  const r = playNight(data, gearbox, idleBot());
  assert.equal(r.end, 'blackout');
  assert.ok(r.minutes < 120, `${r.minutes} game minutes`);
});

for (const gear of [1, 2, 3, 4, 5]) {
  test(`holding gear ${gear} all night can't keep the mainframe above 70%`, () => {
    const r = playNight(data, gearbox, fixedGearBot(gear));
    assert.ok(r.lowest < 70, `lowest ${r.lowest}`);
    assert.ok(r.mean < 65, `mean ${r.mean.toFixed(1)}`);
    assert.ok(r.above70 < 0.3, `${Math.round(r.above70 * 100)}% of the night above 70%`);
  });
}

test('a driver who shifts on the revs keeps the lights on all night', () => {
  const r = playNight(data, gearbox, shifterBot());
  assert.equal(r.end, 'clock');
  assert.ok(r.lowest > 50, `lowest ${r.lowest}`);
  assert.ok(r.final > 50, `final ${r.final}`);
  assert.ok(r.final < 90, `the taper keeps it off the ceiling: final ${r.final}`);
  assert.ok(r.shiftEvery >= 8 && r.shiftEvery <= 20, `a shift every ${r.shiftEvery.toFixed(1)}s`);
});

test('the shifter clearly beats every fixed gear', () => {
  const best = playNight(data, gearbox, shifterBot()).mean;
  for (const gear of [1, 2, 3, 4, 5]) {
    const r = playNight(data, gearbox, fixedGearBot(gear));
    assert.ok(best - r.mean > 12, `gear ${gear}: ${r.mean.toFixed(1)} vs shifter ${best.toFixed(1)}`);
  }
});
