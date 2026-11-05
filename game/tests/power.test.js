import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { reducer } from '../src/core/reducer.js';
import { actions } from '../src/core/actions.js';
import { createInitialState } from '../src/core/initialState.js';
import { internActionError } from '../src/core/permissions.js';
import { chargePower, createPower, drainForMinutes, isBitrotPowered, isBrownout, powerStatus } from '../src/core/power.js';
import { solve } from '../src/logic/puzzle.js';

const load = async (name) => JSON.parse(await readFile(new URL(`../data/${name}`, import.meta.url), 'utf8'));
const night = await load('night.json');
const data = { files: await load('files.json'), puzzles: await load('puzzles.json'), night, story: { beats: [] } };

const desktop = (d = data) => [actions.bootComplete(), actions.clockIn()].reduce(reducer, createInitialState(d));
const atPower = (s, level) => ({ ...s, power: { ...s.power, level } });

test('power drains with the clock, scaled by drainScale', () => {
  const s = desktop();
  assert.equal(s.power.level, night.power.start);
  const after = reducer(s, actions.tick(10));
  assert.equal(after.power.level, night.power.start - 10 * night.power.drainPerMinute);
  const governed = { ...s, power: { ...s.power, drainScale: 0.5 } };
  assert.equal(drainForMinutes(governed, 10).power.level, night.power.start - 5 * night.power.drainPerMinute);
});

test('power runs out a few real minutes into the shift if nobody drives', () => {
  const minutes = night.power.start / night.power.drainPerMinute;
  const realSeconds = (minutes * night.msPerMinute) / 1000;
  assert.ok(realSeconds > 150 && realSeconds < 300, `${realSeconds}s to blackout`);
});

test('driving charges, clamped per report and at 100', () => {
  let s = desktop();
  s = reducer(s, actions.driveReport({ charge: 1.5, distance: 20, running: true, gear: 3, rpm: 4000 }));
  assert.equal(s.power.level, night.power.start + 1.5);
  assert.deepEqual(s.power.generator, { running: true, stalled: false, gear: 3, rpm: 4000 });
  assert.equal(s.stats.distance, 20);
  const greedy = reducer(s, actions.driveReport({ charge: 500 }));
  assert.equal(greedy.power.level, s.power.level + night.power.chargeCapPerReport, 'clamped per report');
  assert.equal(chargePower(atPower(s, 99.5), 2).power.level, 100);
  assert.equal(reducer(s, actions.driveReport({ charge: Number.NaN })).power.level, s.power.level);
  assert.equal(reducer(s, actions.driveReport({ charge: -5 })).power.level, s.power.level);
});

test('a stall report logs once and counts', () => {
  let s = desktop();
  s = reducer(s, actions.driveReport({ stalls: 1, stalled: true }));
  assert.equal(s.stats.stalls, 1);
  assert.equal(s.log.at(-1).text, 'Generator stalled.');
  const again = reducer(s, actions.driveReport({ stalls: 0, stalled: true }));
  assert.equal(again.log.length, s.log.length);
});

test('power thresholds: flicker, brownout, critical, blackout', () => {
  const s = desktop();
  const t = night.power.thresholds;
  assert.equal(powerStatus(atPower(s, 100)), 'ok');
  assert.equal(powerStatus(atPower(s, t.flicker - 1)), 'flicker');
  assert.equal(powerStatus(atPower(s, t.brownout - 1)), 'brownout');
  assert.equal(powerStatus(atPower(s, t.critical - 1)), 'critical');
  assert.equal(powerStatus(atPower(s, 0)), 'blackout');
  assert.equal(isBrownout(atPower(s, t.flicker - 1)), false);
  assert.equal(isBrownout(atPower(s, t.brownout - 1)), true);
  assert.equal(isBitrotPowered(atPower(s, t.brownout - 1)), true);
  assert.equal(isBitrotPowered(atPower(s, t.critical - 1)), false);
});

test('brownout blocks intern ops and keys but not chat', () => {
  const s = atPower(desktop(), night.power.thresholds.brownout - 1);
  const op = { type: 'PUZZLE_APPLY_OP', puzzleId: 'payroll', opIndex: 0, actor: 'intern' };
  assert.match(internActionError(s, op), /BROWNOUT/);
  assert.match(internActionError(s, { type: 'PUZZLE_ENTER_KEY', puzzleId: 'badge', opIndex: 3, mask: 1, actor: 'intern' }), /BROWNOUT/);
  assert.equal(internActionError(s, { type: 'CHAT_SEND', text: 'drive!', from: 'intern', actor: 'intern' }), null);
  assert.equal(internActionError(atPower(s, 80), op), null);
  // The sysadmin can still work Bit Rot in a brownout.
  assert.notEqual(reducer(s, actions.applyOp('payroll', 0)).puzzles.payroll, s.puzzles.payroll);
});

test('critical power stops Bit Rot for everyone', () => {
  const s = atPower(desktop(), night.power.thresholds.critical - 1);
  assert.equal(reducer(s, actions.applyOp('payroll', 0)), s);
});

test('a blackout ends the shift', () => {
  const s = atPower(desktop(), 0.5);
  const over = reducer(s, actions.tick(1));
  assert.equal(over.phase, 'over');
  assert.equal(over.shiftEnd.reason, 'blackout');
  assert.equal(over.power.level, 0);
});

test('a puzzle can recalibrate the governor (onSolve.drainScale)', () => {
  const puzzles = [
    { id: 'gov', start: '0x0001', target: '0x0002', moveLimit: 2, ops: [{ type: 'shl', n: 1 }], onSolve: { drainScale: 0.6 } },
  ];
  const files = [...data.files, { id: 'gov', name: 'GOV.CFG', type: 'data', locked: true, puzzleId: 'gov', content: ['ok'] }];
  let s = desktop({ ...data, files, puzzles });
  assert.deepEqual(solve(puzzles[0]), [0]);
  s = reducer(s, actions.applyOp('gov', 0));
  assert.equal(s.puzzles.gov.solved, true);
  assert.equal(s.power.drainScale, 0.6);
  assert.match(s.log.at(-1).text, /60%/);
});

test('createPower fills in thresholds and clamps the start', () => {
  const p = createPower({ start: 150, thresholds: { brownout: 20 } });
  assert.equal(p.level, 100);
  assert.equal(p.config.thresholds.brownout, 20);
  assert.equal(p.config.thresholds.flicker, 50);
});
