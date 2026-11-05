import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { reducer } from '../src/core/reducer.js';
import { actions } from '../src/core/actions.js';
import { createInitialState } from '../src/core/initialState.js';
import { childrenOf } from '../src/core/selectors.js';
import { shiftMinutes, validateStory } from '../src/core/story.js';
import { canInternReadFile } from '../src/core/permissions.js';
import { solve } from '../src/logic/puzzle.js';

const load = async (name) => JSON.parse(await readFile(new URL(`../data/${name}`, import.meta.url), 'utf8'));
const files = await load('files.json');
const puzzles = await load('puzzles.json');
const story = await load('story.json');
const night = await load('night.json');
const noDrain = { ...night, power: { ...night.power, drainPerMinute: 0 } };
const data = { files, puzzles, night: noDrain, story };

const desktop = (d = data) => [actions.bootComplete(), actions.clockIn()].reduce(reducer, createInitialState(d));
const at = (s, hhmm) => {
  const minutes = shiftMinutes(hhmm) - s.clock.elapsed;
  return minutes > 0 ? reducer(s, actions.tick(minutes)) : s;
};
const fired = (s) => s.story.fired;
const lastPost = (s) => s.intern.messages.at(-1);
const solveWith = (s, id) => {
  const path = solve(s.puzzles[id]);
  for (const op of s.puzzles[id].ops.keys()) if (s.puzzles[id].ops[op].keyed) s = reducer(s, actions.enterKey(id, op, `0x${s.puzzles[id].ops[op].mask.toString(16)}`));
  return path.reduce((acc, i) => reducer(acc, actions.applyOp(id, i)), s);
};

test('story.json is well formed and reveals every dormant file', () => {
  const errors = validateStory(story, {
    fileIds: files.map((f) => f.id),
    puzzleIds: puzzles.map((p) => p.id),
    dormantIds: files.filter((f) => f.dormant).map((f) => f.id),
  });
  assert.deepEqual(errors, []);
});

test('validateStory catches broken beats', () => {
  const bad = {
    beats: [
      { id: 'a', effects: [{ do: 'post', text: 'x' }] },
      { id: 'a', at: '07:00', effects: [{ do: 'explode' }] },
      { id: 'b', at: '23:00', when: { solved: ['nope'], fired: 'zzz' }, effects: [{ do: 'reveal', file: 'readme' }, { do: 'drain', amount: 500 }, { do: 'post', from: 'boss', text: 'hi' }] },
    ],
  };
  const errors = validateStory(bad, { fileIds: ['readme'], puzzleIds: [], dormantIds: ['ghostfile'] }).join('\n');
  for (const want of [/a: needs at/, /duplicate beat id: a/, /inside the shift/, /unknown effect explode/, /unknown puzzle nope/, /unknown beat zzz/, /not dormant/, /drain amount/, /post needs from/, /ghostfile is never revealed/]) {
    assert.match(errors, want);
  }
});

test('shiftMinutes maps the clock to minutes into the shift', () => {
  assert.equal(shiftMinutes('22:00'), 0);
  assert.equal(shiftMinutes('23:15'), 75);
  assert.equal(shiftMinutes('01:13'), 193);
  assert.equal(shiftMinutes('05:59'), 479);
  assert.ok(Number.isNaN(shiftMinutes('25:00')));
});

test('dormant files are not on the drive until revealed', () => {
  const s = desktop();
  for (const id of ['genset', 'timeclk', 'timeaud', 'blame']) {
    assert.equal(s.files[id].dormant, true, id);
    assert.ok(!childrenOf(s, s.files[id].parent, { includeHidden: true }).some((f) => f.id === id), `${id} listed`);
    assert.equal(reducer(s, actions.openFile(id)).windows.length, s.windows.length, `${id} opens`);
  }
  assert.equal(s.desktop.positions.blame, undefined);
});

test('timed beats fire once, at their time', () => {
  let s = desktop();
  assert.deepEqual(fired(s), []);
  s = at(s, '22:04');
  assert.ok(!fired(s).includes('facilities-generator'));
  s = at(s, '22:05');
  assert.ok(fired(s).includes('facilities-generator'));
  assert.equal(lastPost(s).from, 'system');
  const messages = s.intern.messages.length;
  s = reducer(s, actions.tick(1));
  assert.equal(s.intern.messages.length, messages, 'no repeat');
  s = at(s, '23:15');
  assert.equal(s.files.genset.dormant, false);
  assert.ok(childrenOf(s, 'drive').some((f) => f.id === 'genset'));
});

test('the 01:13 surge drains power and the 03:40 stall stalls the generator', () => {
  let s = at(desktop(), '01:12');
  const before = s.power.level;
  s = at(s, '01:13');
  assert.equal(s.power.level, before - 8);
  assert.equal(s.power.surgeSeq, 1);
  assert.equal(lastPost(s).from, 'ghost');
  s = { ...s, power: { ...s.power, level: 90 } };
  s = at(s, '03:40');
  assert.equal(s.power.stallSeq, 1);
  assert.equal(s.power.surgeSeq, 2);
});

test('renaming SHIFTLOG.BAK reveals TIMECLK.DAT and its audit trail', () => {
  let s = desktop();
  s = reducer(s, actions.renameFile('shiftlog', 'SHIFTLOG.TXT'));
  assert.equal(s.files.shiftlog.locked, false);
  assert.ok(fired(s).includes('shiftlog-restored'));
  assert.equal(s.flags['shiftlog-read'], true);
  assert.equal(s.files.timeclk.dormant, false);
  assert.equal(s.files.timeaud.dormant, false);
  s = at(s, '02:00');
  assert.ok(!fired(s).includes('timeclk-from-tape'), 'the fallback does not fire if the player already did it');
});

test('if nobody restores the shift log, TIMECLK.DAT turns up at 02:00 anyway', () => {
  let s = at(desktop(), '00:30');
  assert.ok(fired(s).includes('shiftlog-nudge'));
  s = at(s, '01:59');
  assert.equal(s.files.timeclk.dormant, true);
  s = at(s, '02:00');
  assert.equal(s.files.timeclk.dormant, false);
  assert.ok(fired(s).includes('timeclk-from-tape'));
});

test('the night escalates the intern to SUPERVISOR, who can then read the sealed file', () => {
  let s = desktop();
  assert.equal(canInternReadFile(s.intern.level, s.files.sealed), false);
  s = solveWith(s, 'payroll');
  assert.equal(s.intern.level, 2);
  assert.equal(canInternReadFile(s.intern.level, s.files.timeaud), true);
  s = reducer(s, actions.renameFile('shiftlog', 'SHIFTLOG.TXT'));
  s = solveWith(s, 'timeclk');
  assert.equal(s.puzzles.timeclk.solved, true);
  assert.equal(s.intern.level, 3);
  assert.ok(fired(s).includes('timeclk-read'));
  assert.equal(canInternReadFile(s.intern.level, s.files.sealed), true);
});

test('GENSET.CFG lowers the drain when recovered', () => {
  let s = at(desktop(), '23:15');
  s = solveWith(s, 'genset');
  assert.equal(s.puzzles.genset.solved, true);
  assert.equal(s.power.drainScale, 0.6);
});

test('a brownout warning posts once when power drops under 30%', () => {
  let s = desktop();
  s = { ...s, power: { ...s.power, level: 29 } };
  s = reducer(s, actions.tick(1));
  assert.ok(fired(s).includes('brownout-warning'));
  assert.match(lastPost(s).text, /BROWNOUT/);
});

test('05:00 teases the finale: BLAME.EXE lands on the desktop, locked', () => {
  let s = at(desktop(), '05:00');
  assert.ok(fired(s).includes('audit-0500'));
  assert.equal(s.files.blame.dormant, false);
  assert.ok(s.desktop.positions.blame, 'gets a desktop slot');
  assert.equal(s.alert.title, 'HEAD OFFICE');
  s = reducer(s, actions.dismissAlert());
  s = reducer(s, actions.openFile('blame'));
  assert.match(s.alert.text, /installing/);
  s = at(reducer(s, actions.dismissAlert()), '05:45');
  assert.ok(fired(s).includes('last-call'));
});

test('no story before clock-in, and none after the shift ends', () => {
  const boot = createInitialState(data);
  assert.deepEqual(reducer(boot, actions.tick(10)).story.fired, []);
  const over = reducer(desktop(), actions.tick(480));
  assert.equal(over.phase, 'over');
  assert.ok(!fired(over).includes('audit-0500'), 'jumping straight to 06:00 ends the shift first');
});

test('the story survives a save', () => {
  const s = at(desktop(), '23:15');
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
});
