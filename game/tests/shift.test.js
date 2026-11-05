import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { reducer } from '../src/core/reducer.js';
import { actions } from '../src/core/actions.js';
import { createInitialState, STATE_VERSION } from '../src/core/initialState.js';
import { migrateSave } from '../src/core/save.js';
import { internUsage } from '../src/core/shift.js';

const load = async (name) => JSON.parse(await readFile(new URL(`../data/${name}`, import.meta.url), 'utf8'));
const data = { files: await load('files.json'), puzzles: await load('puzzles.json'), night: await load('night.json'), story: await load('story.json') };

const desktop = (d = data) => [actions.bootComplete(), actions.clockIn()].reduce(reducer, createInitialState(d));
const noDrain = { ...data, night: { ...data.night, power: { ...data.night.power, drainPerMinute: 0 } } };

test('06:00 ends the shift on a summary screen', () => {
  let s = desktop(noDrain);
  s = reducer(s, actions.applyOp('payroll', 1));
  s = reducer(s, actions.tick(480));
  assert.equal(s.phase, 'over');
  assert.equal(s.shiftEnd.reason, 'clock');
  assert.equal(s.shiftEnd.at, '06:00');
  assert.equal(s.shiftEnd.summary.puzzlesSolved, 0);
  assert.equal(s.shiftEnd.summary.puzzlesTotal, data.puzzles.length);
  assert.deepEqual(s.shiftEnd.summary.intern, { mode: 'none', count: 0 });
  assert.equal(s.alert, null);
});

test('nothing but a new shift moves an ended shift', () => {
  const over = reducer(desktop(noDrain), actions.tick(480));
  for (const a of [actions.tick(), actions.applyOp('payroll', 0), actions.openFile('readme'), actions.chatSend('hello?'), actions.driveReport({ charge: 2 })]) {
    assert.equal(reducer(over, a), over, a.type);
  }
});

test('clock in for another shift gives a fresh, playable game', () => {
  let s = desktop(noDrain);
  s = reducer(s, actions.chatSend('hi'));
  s = reducer(s, actions.tick(480));
  const fresh = createInitialState(data);
  s = reducer(s, actions.newShift(fresh));
  assert.equal(s.phase, 'clockin');
  assert.equal(s.shiftNumber, 2);
  assert.equal(s.clock.elapsed, 0);
  assert.equal(s.intern.messages.length, 0);
  assert.equal(s.shiftEnd, null);
  s = reducer(s, actions.clockIn());
  assert.equal(s.phase, 'desktop');
  s = reducer(s, actions.tick());
  assert.equal(s.clock.elapsed, 1);
});

test('a new shift is refused mid-shift', () => {
  const s = desktop();
  assert.equal(reducer(s, actions.newShift(createInitialState(data))), s);
  const over = reducer(desktop(noDrain), actions.tick(480));
  assert.equal(reducer(over, actions.newShift(null)), over);
});

test('intern usage is reported as ai, scripted or none', () => {
  assert.deepEqual(internUsage({ internOps: 2, internMessages: 3 }), { mode: 'ai', count: 5 });
  assert.deepEqual(internUsage({ scriptedReplies: 4 }), { mode: 'scripted', count: 4 });
  assert.deepEqual(internUsage({}), { mode: 'none', count: 0 });
  let s = desktop(noDrain);
  s = reducer(s, actions.chatSend('Sorry, was on smoko.', 'intern', { scripted: true, topic: 'default' }));
  s = reducer(s, actions.tick(480));
  assert.equal(s.shiftEnd.summary.intern.mode, 'scripted');
});

test('migrateSave: a finished week 2 save becomes the end-of-shift screen, never a dead save', () => {
  const v2 = {
    version: 2,
    phase: 'desktop',
    clock: { elapsed: 480, length: 480 },
    files: { payroll: { id: 'payroll', name: 'PAYROLL.DAT', locked: false } },
    puzzles: { payroll: { id: 'payroll', value: 0x3c3c, history: [3, 0, 0x0f0f, 0x1e1e], unlocked: [], solved: true, failed: false } },
    desktop: { positions: {} },
    flags: { shiftOver: true },
    log: [{ at: '06:00', text: 'Shift over.' }],
    alert: { title: 'SHIFT OVER', text: 'That is the end of this build.' },
    intern: { level: 2, messages: [], nextMsgId: 5, playerReadId: 4, pester: {} },
  };
  const s = migrateSave(v2, data);
  assert.equal(s.version, STATE_VERSION);
  assert.equal(s.phase, 'over');
  assert.equal(s.alert, null);
  assert.equal(s.flags.shiftOver, undefined);
  assert.equal(s.puzzles.payroll.solved, true);
  assert.equal(s.files.payroll.locked, false);
  assert.equal(s.intern.level, 2);
  assert.ok(s.power, 'migrated saves get power');
  assert.equal(s.shiftEnd.summary.puzzlesSolved, 1);
  const next = reducer(s, actions.newShift(createInitialState(data)));
  assert.equal(next.phase, 'clockin');
});

test('migrateSave: a mid-shift week 2 save carries on with the new content', () => {
  const v2 = { version: 2, phase: 'desktop', clock: { elapsed: 30, length: 480 }, files: {}, puzzles: {}, desktop: { positions: {} }, flags: {}, log: [], intern: { level: 1, messages: [], nextMsgId: 1 } };
  const s = migrateSave(v2, data);
  assert.equal(s.phase, 'desktop');
  assert.equal(s.clock.elapsed, 30);
  assert.equal(s.clock.msPerMinute, data.night.msPerMinute);
});

test('migrateSave: junk, unknown versions and pre-desktop saves start fresh', () => {
  for (const junk of [null, 'nope', 42, {}, { version: 1, phase: 'desktop' }, { version: STATE_VERSION, phase: 'boot' }, { version: STATE_VERSION, phase: 'desktop' }]) {
    assert.equal(migrateSave(junk, data), null, JSON.stringify(junk));
  }
});

test('migrateSave: a current save past 06:00 or at zero power is closed out', () => {
  const s = desktop();
  assert.deepEqual(migrateSave(s, data), s, 'a healthy save is used as is');
  assert.equal(migrateSave({ ...s, clock: { ...s.clock, elapsed: 480 } }, data).phase, 'over');
  const dead = migrateSave({ ...s, power: { ...s.power, level: 0 } }, data);
  assert.equal(dead.phase, 'over');
  assert.equal(dead.shiftEnd.reason, 'blackout');
  const over = reducer(desktop(noDrain), actions.tick(480));
  const reloaded = migrateSave(JSON.parse(JSON.stringify(over)), data);
  assert.equal(reloaded.phase, 'over');
  assert.deepEqual(reloaded.shiftEnd, over.shiftEnd);
});
