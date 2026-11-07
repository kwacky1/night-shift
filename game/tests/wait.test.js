// WAIT FOR THE AUDIT: with every sector recovered, park the generator and fast-forward to 06:00.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { reducer, WAIT_PING } from '../src/core/reducer.js';
import { actions } from '../src/core/actions.js';
import { createInitialState } from '../src/core/initialState.js';
import { shiftMinutes } from '../src/core/story.js';
import { migrateSave } from '../src/core/save.js';
import { canWaitForAudit, FAST_FORWARD, isWaitingForAudit, tickMs } from '../src/core/selectors.js';

const load = async (name) => JSON.parse(await readFile(new URL(`../data/${name}`, import.meta.url), 'utf8'));
const files = await load('files.json');
const puzzles = await load('puzzles.json');
const story = await load('story.json');
const night = await load('night.json');
const blame = await load('blame.json');
const data = { files, puzzles, night: { ...night, power: { ...night.power, drainPerMinute: 0 } }, story, blame };

const desktop = () => [actions.bootComplete(), actions.clockIn()].reduce(reducer, createInitialState(data));
const solveAll = (s, except = null) => ({ ...s, puzzles: Object.fromEntries(Object.entries(s.puzzles).map(([id, p]) => [id, id === except ? p : { ...p, solved: true }])) });
const tickTo = (s, hhmm) => {
  while (s.clock.elapsed < shiftMinutes(hhmm) && s.phase === 'desktop' && !s.blame?.open) {
    s = reducer(s, actions.tick(1));
    if (s.alert) s = reducer(s, actions.dismissAlert());
  }
  return s;
};
const draining = (s, rate = 0.2) => ({ ...s, power: { ...s.power, config: { ...s.power.config, drainPerMinute: rate } } });

test('WAIT FOR THE AUDIT is only offered once all 4 sectors are recovered', () => {
  const s = tickTo(desktop(), '03:00');
  assert.equal(Object.keys(s.puzzles).length, 4);
  assert.equal(canWaitForAudit(s), false);
  const three = solveAll(s, 'timeclk');
  assert.equal(canWaitForAudit(three), false, 'three of four is not enough');
  const ignored = reducer(three, actions.waitForAudit());
  assert.ok(!ignored.clock.waiting && ignored.intern.messages.length === three.intern.messages.length, 'the action is ignored too');
  const ready = solveAll(s);
  assert.equal(canWaitForAudit(ready), true);
  const waiting = reducer(ready, actions.waitForAudit());
  assert.equal(canWaitForAudit(waiting), false, 'one way: no second press');
  assert.equal(reducer(waiting, actions.waitForAudit()).intern.messages.length, waiting.intern.messages.length);
});

test('waiting parks the generator: no drain, no stalls, no driving, and #0118 is told', () => {
  let s = solveAll(draining(tickTo(desktop(), '03:00')));
  s = reducer(s, actions.driveReport({ stalls: 1, stalled: true }));
  assert.equal(s.power.generator.stalled, true);
  s = reducer(s, actions.waitForAudit());
  assert.equal(isWaitingForAudit(s), true);
  assert.deepEqual(s.power.generator, { running: false, stalled: false, gear: 0, rpm: 0 });
  const ping = s.intern.messages.at(-1);
  assert.deepEqual([ping.from, ping.text, ping.ping], ['system', WAIT_PING, true]);
  const level = s.power.level;
  const later = tickTo(s, '04:30');
  assert.equal(later.power.level, level, 'no drain while waiting');
  assert.equal(later.power.stallSeq ?? 0, s.power.stallSeq ?? 0, 'no story stalls');
  assert.equal(reducer(later, actions.driveReport({ charge: 3, distance: 100, running: true, gear: 2, rpm: 4000 })), later, 'no gear input');
});

test('the clock runs 8x while waiting, one minute per tick', () => {
  const s = solveAll(tickTo(desktop(), '03:00'));
  const ms = s.clock.msPerMinute;
  assert.equal(tickMs(s), ms);
  const w = reducer(s, actions.waitForAudit());
  assert.equal(FAST_FORWARD, 8);
  assert.equal(tickMs(w), ms / 8);
  assert.equal(reducer(w, actions.tick(1)).clock.elapsed, w.clock.elapsed + 1);
});

test('fast-forward still fires the 05:00 beat in order and opens the audit at 06:00 as normal', () => {
  let s = reducer(solveAll(tickTo(desktop(), '03:00')), actions.waitForAudit());
  const order = [];
  while (!s.blame?.open && s.phase === 'desktop') {
    s = reducer(s, actions.tick(1));
    for (const id of s.story.fired) if (!order.includes(id)) order.push(id);
    if (s.alert) s = reducer(s, actions.dismissAlert());
  }
  assert.ok(order.includes('audit-0500') && order.includes('last-call'));
  assert.ok(order.indexOf('audit-0500') < order.indexOf('last-call'));
  assert.equal(s.blame.open, true, 'BLAME.EXE opens');
  assert.equal(s.clock.elapsed, s.clock.length);
  assert.equal(isWaitingForAudit(s), false, 'normal speed again: the clock freezes for the audit');
  assert.equal(tickMs(s), s.clock.msPerMinute);
  assert.equal(reducer(s, actions.tick(5)), s);
});

test('a reload mid-wait keeps fast-forwarding with the generator parked', () => {
  const s = tickTo(reducer(solveAll(tickTo(desktop(), '03:00')), actions.waitForAudit()), '04:00');
  const back = migrateSave(JSON.parse(JSON.stringify(s)), data);
  assert.equal(isWaitingForAudit(back), true);
  assert.equal(back.power.generator.running, false);
});
