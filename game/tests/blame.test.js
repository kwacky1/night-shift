// BLAME.EXE: the 06:00 audit, citations, the verdict and its endings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { reducer } from '../src/core/reducer.js';
import { actions } from '../src/core/actions.js';
import { createInitialState, STATE_VERSION } from '../src/core/initialState.js';
import { shiftMinutes } from '../src/core/story.js';
import { generatorWrapUp } from '../src/core/shift.js';
import { migrateSave } from '../src/core/save.js';
import { addEnding, citableFiles, checkSubmission, parseEndings, scoreBlame, scriptedBlame, scriptedBlameDecision, validateBlame } from '../src/core/blame.js';
import { AUDIT_PING } from '../src/core/reducer.js';

const load = async (name) => JSON.parse(await readFile(new URL(`../data/${name}`, import.meta.url), 'utf8'));
const files = await load('files.json');
const puzzles = await load('puzzles.json');
const story = await load('story.json');
const night = await load('night.json');
const blame = await load('blame.json');
const data = { files, puzzles, night: { ...night, power: { ...night.power, drainPerMinute: 0 } }, story, blame };

const desktop = (d = data) => [actions.bootComplete(), actions.clockIn()].reduce(reducer, createInitialState(d));
const at = (s, hhmm) => {
  const minutes = (hhmm === '06:00' ? 480 : shiftMinutes(hhmm)) - s.clock.elapsed;
  return minutes > 0 ? reducer(s, actions.tick(minutes)) : s;
};
const unlock = (s, ...ids) => ({ ...s, files: Object.fromEntries(Object.entries(s.files).map(([id, f]) => [id, ids.includes(id) ? { ...f, locked: false, dormant: false } : f])) });
const withStats = (s, stats) => ({ ...s, stats: { ...s.stats, ...stats } });
const audit = () => at(at(desktop(), '05:00'), '06:00');
const player = (suspect, evidence = [], statement = '') => actions.blameSubmit(suspect, evidence, statement);
const intern = (suspect, evidence = [], statement = '') => ({ ...actions.blameSubmit(suspect, evidence, statement), actor: 'intern' });
const verdict = (s, p, i) => reducer(reducer(s, p), i);

test('blame.json is well formed', () => {
  assert.deepEqual(validateBlame(blame, { files }), []);
});

test('validateBlame catches broken configs', () => {
  const bad = {
    suspects: [{ id: 'a', name: 'A' }, { id: 'a', name: '' }],
    evidence: [{ ref: 'payroll:99', points: { zz: 1 } }, { ref: 'nope', clears: ['q'] }],
    facts: [{ id: 'f', when: { colour: 'red' } }],
    endings: [{ id: 'x', title: 'X'.repeat(30), text: 'ok', when: { verdict: ['ghost'], tags: { missing: 1 } } }],
    scripted: [{ suspect: 'b', evidence: ['readme:1'], statement: '' }],
  };
  const errors = validateBlame(bad, { files }).join('\n');
  for (const want of [/duplicate suspect a/, /at least 3 suspects/, /payroll has no line 99/, /unknown suspect zz/, /bad ref nope/, /clears unknown suspect q/, /f: when needs/, /title must be/, /unknown suspect ghost/, /no evidence has tag missing/, /at least 3 endings/, /default and must have no when/, /scripted 0: unknown suspect b/, /statement must be/]) {
    assert.match(errors, want);
  }
});

test('BLAME.EXE stays locked until 06:00, then the audit freezes NS-02 and opens it', () => {
  let s = at(desktop(), '05:00');
  assert.equal(s.files.blame.dormant, false);
  assert.equal(s.files.blame.type, 'app');
  s = reducer(s, actions.openFile('blame'));
  assert.match(s.alert.text, /installing/);
  s = reducer(s, actions.dismissAlert());
  s = at(s, '06:00');
  assert.equal(s.phase, 'desktop');
  assert.equal(s.blame.open, true);
  assert.equal(s.files.blame.locked, false);
  assert.ok(s.windows.some((w) => w.kind === 'blame'));
  assert.equal(s.clock.elapsed, 480);
  assert.equal(reducer(s, actions.tick(5)), s, 'the clock is frozen');
  assert.equal(reducer(s, actions.applyOp('payroll', 0)), s, 'no ops during the audit');
  assert.equal(reducer(s, actions.resetPuzzle('payroll')), s);
});

test('without BLAME.EXE (or its data) the shift just ends at 06:00', () => {
  const noBlame = at(desktop({ ...data, blame: null }), '06:00');
  assert.equal(noBlame.phase, 'over');
  assert.equal(noBlame.shiftEnd.reason, 'clock');
});

test('citations: each side can only quote what it can open, unlocked, within range', () => {
  const s = audit();
  assert.match(checkSubmission(s, 'player', { suspect: '0117', evidence: ['bootlog:4'] }).error, /No such file/);
  assert.match(checkSubmission(s, 'player', { suspect: '0117', evidence: ['payroll:8'] }).error, /locked/);
  assert.match(checkSubmission(s, 'player', { suspect: '0117', evidence: ['readme:99'] }).error, /lines 1-17/);
  assert.match(checkSubmission(s, 'player', { suspect: 'santa' }).error, /Unknown suspect/);
  assert.match(checkSubmission(s, 'player', { suspect: '0117', evidence: ['readme:1', 'readme:2', 'readme:3', 'readme:4'] }).error, /at most 3/);
  assert.match(checkSubmission(s, 'player', { suspect: '0117', statement: 'x'.repeat(141) }).error, /140/);
  assert.match(checkSubmission(s, 'intern', { suspect: '0117', evidence: ['sealed:5'] }).error, /clearance/);
  assert.ok(checkSubmission(s, 'intern', { suspect: '0117', evidence: ['bootlog:4'] }).submission);
  assert.ok(citableFiles(s, 'player').some((f) => f.id === 'readme'));
  assert.ok(!citableFiles(s, 'player').some((f) => f.id === 'bootlog'));
  const bad = reducer(s, player('0117', ['bootlog:4']));
  assert.equal(bad.blame.player, null);
  assert.match(bad.alert.text, /No such file/);
});

test('one statement each; the shift ends with an ending once both are in', () => {
  let s = audit();
  s = reducer(s, player('0117', ['readme:17'], '  it was   them  '));
  assert.deepEqual(s.blame.player.evidence, ['readme:17']);
  assert.equal(s.blame.player.statement, 'it was them');
  assert.equal(reducer(s, player('sysadmin')).blame.player.suspect, '0117', 'no second statement');
  s = reducer(s, intern('0117'));
  assert.equal(s.phase, 'over');
  assert.equal(s.shiftEnd.reason, 'audit');
  assert.equal(s.shiftEnd.ending.id, 'again');
  assert.match(s.log.at(-1).text, /Audit complete/);
});

test('every ending is reachable', () => {
  const base = unlock(audit(), 'payroll', 'badge', 'timeclk', 'shiftlog', 'genset');
  const ending = (s, p, i) => verdict(s, p, i).shiftEnd.ending;

  const typing = ending(withStats(base, { internOps: 2 }), player('0118', ['timeclk:12', 'timeclk:13', 'shiftlog:8']), intern('sysadmin', ['badge:12']));
  assert.equal(typing.id, 'typing');

  assert.equal(ending(base, player('0118'), intern('sysadmin')).id, 'both');
  assert.equal(ending(base, player('sysadmin'), intern('sysadmin')).id, 'yourname');
  const badge = ending(base, player('0117', ['badge:7', 'payroll:8']), intern('0117'));
  assert.equal(badge.id, 'yourname', 'blaming #0117 with the badge record names you');
  assert.match(badge.text, /badge on record for NS-02 tonight: 0117/);
  assert.equal(ending(base, player('0117', ['payroll:8']), intern('0117')).id, 'again');
  const mgmt = ending(base, player('headoffice', ['memo1:4']), intern('patterson'));
  assert.equal(mgmt.id, 'management');
  assert.match(mgmt.text, /Head Office/);
  assert.equal(ending(base, player('patterson'), intern('headoffice')).id, 'equipment');
});

test('the twist needs the intern to have been at the keyboard tonight', () => {
  const base = unlock(audit(), 'timeclk', 'shiftlog');
  const s = verdict(base, player('0118', ['timeclk:12', 'timeclk:13', 'shiftlog:8']), intern('0118'));
  assert.equal(s.blame.result.suspect, '0118');
  assert.notEqual(s.shiftEnd.ending.id, 'typing');
});

test('citing a line that clears your own suspect is a contradiction', () => {
  let s = unlock(audit(), 'shiftlog');
  s = reducer(s, player('0117', ['shiftlog:6']));
  const score = scoreBlame(s);
  assert.equal(score.contradictions.player, 'shiftlog:6');
  assert.equal(score.scores['0117'], -1);
});

test('play tonight counts: stalls and the payroll edits point at the sysadmin', () => {
  let s = withStats(audit(), { stalls: 2 });
  s = { ...s, puzzles: { ...s.puzzles, payroll: { ...s.puzzles.payroll, by: ['intern', 'player'] } } };
  s = reducer(s, player('patterson'));
  const score = scoreBlame(s);
  assert.deepEqual(score.facts.sort(), ['payrollByPlayer', 'stalled']);
  assert.equal(score.scores.sysadmin, 2);
});

test('the scripted intern blames the sysadmin with whatever evidence it can read', () => {
  const s = unlock(withStats(audit(), { stalls: 1 }), 'badge');
  const pick = scriptedBlame(s);
  assert.equal(pick.suspect, 'sysadmin');
  assert.ok(pick.evidence.includes('memo2:6'));
  assert.ok(pick.evidence.includes('badge:12'));
  assert.ok(!pick.evidence.includes('genset:5'), 'GENSET.CFG is still locked');
  assert.ok(checkSubmission(s, 'intern', pick).submission);
  const quiet = scriptedBlame(audit());
  assert.equal(quiet.suspect, 'sysadmin');
  assert.ok(checkSubmission(audit(), 'intern', quiet).submission);
  const done = reducer(reducer(audit(), player('0118')), { ...intern(quiet.suspect, quiet.evidence, quiet.statement), scripted: true });
  assert.equal(done.blame.intern.scripted, true);
  assert.equal(done.shiftEnd.ending.id, 'both');
});

test('the endings tally parses defensively and only grows', () => {
  assert.deepEqual(parseEndings('["again","bogus","again"]', blame), ['again']);
  assert.deepEqual(parseEndings('not json', blame), []);
  assert.deepEqual(parseEndings('{"a":1}', blame), []);
  assert.deepEqual(addEnding(['again'], 'both'), ['again', 'both']);
  assert.deepEqual(addEnding(['again'], 'again'), ['again']);
});

test('saves: a v4 save mid-audit stays in the audit; a v3 save picks up the new data', () => {
  const mid = audit();
  const back = migrateSave(JSON.parse(JSON.stringify(mid)), data);
  assert.equal(back.phase, 'desktop');
  assert.equal(back.blame.open, true);

  const v3 = JSON.parse(JSON.stringify(at(desktop(), '01:00')));
  v3.version = 3;
  delete v3.blame;
  for (const p of Object.values(v3.puzzles)) {
    delete p.by;
    delete p.internMoves;
    delete p.noop;
    delete p.solvedBy;
    for (const op of p.ops) delete op.hands;
  }
  v3.puzzles.payroll.history = [3];
  v3.puzzles.payroll.value = 0;
  delete v3.stats.playerOps;
  v3.files.blame = { ...v3.files.blame, type: 'text', app: null };
  const up = migrateSave(v3, data);
  assert.equal(up.version, STATE_VERSION);
  assert.deepEqual(up.puzzles.payroll.by, ['player']);
  assert.equal(up.puzzles.payroll.internMoves, 2);
  assert.equal(up.puzzles.payroll.ops[2].hands, 'player');
  assert.equal(up.files.blame.app, 'blame');
  assert.equal(up.blame.open, false);
  assert.equal(up.stats.playerOps, 0);
  assert.deepEqual(up.story.fired, v3.story.fired);
});

test('opening the audit pings #0118 on the line', () => {
  const s = audit();
  const ping = s.intern.messages.filter((m) => m.ping);
  assert.equal(ping.length, 1);
  assert.equal(ping[0].from, 'system');
  assert.equal(ping[0].text, AUDIT_PING);
  assert.match(ping[0].text, /AUDIT OPEN.*submit_blame.*audit_status/);
});

test('the scripted intern never files over an AI on the line', () => {
  const s = audit();
  assert.equal(scriptedBlameDecision(desktop(), { aiOnLine: false }), null, 'no audit, no statement');
  assert.equal(scriptedBlameDecision(s, { aiOnLine: false }), null, 'waits for the sysadmin to file first');
  assert.equal(scriptedBlameDecision(s, { aiOnLine: true }), null);
  const filed = reducer(s, player('0117'));
  assert.equal(scriptedBlameDecision(filed, { aiOnLine: true }), 'wait', 'AI online: WAITING FOR #0118, however long');
  assert.equal(scriptedBlameDecision(filed, { aiOnLine: false }), 'file', 'no AI (or it disconnected): the scripted statement');
  assert.equal(scriptedBlameDecision(filed, { aiOnLine: true, forced: true }), 'file', 'FILE WITHOUT THE INTERN');
  assert.equal(scriptedBlameDecision(s, { aiOnLine: true, forced: true }), 'file', 'the button works before you file too');
  const done = reducer(filed, intern('sysadmin'));
  assert.equal(scriptedBlameDecision(done, { aiOnLine: false, forced: true }), null, 'one statement each');
});

test('FILE WITHOUT THE INTERN files a statement marked scripted', () => {
  const s = reducer(audit(), player('0117'));
  assert.equal(scriptedBlameDecision(s, { aiOnLine: true, forced: true }), 'file');
  const pick = scriptedBlame(s);
  const end = reducer(s, { ...actions.blameSubmit(pick.suspect, pick.evidence, pick.statement), actor: 'intern', scripted: true });
  assert.equal(end.blame.intern.scripted, true);
  assert.ok(end.shiftEnd);
});

test('06:00: the audit parks Generator 2 and clears a stall; no drain, stalls or driving after that', () => {
  let s = at(desktop(), '05:00');
  s = reducer(s, actions.driveReport({ charge: 2, distance: 900, stalls: 1, stalled: true, gear: 0 }));
  s = { ...s, power: { ...s.power, level: 40, lowest: 22 } };
  assert.equal(s.power.generator.stalled, true);
  s = at(s, '06:00');
  assert.equal(s.blame.open, true);
  assert.deepEqual(s.power.generator, { running: false, stalled: false, gear: 0, rpm: 0 }, 'parked, stall cleared');
  assert.equal(s.focusedWindowId, s.windows.find((w) => w.kind === 'blame')?.id, 'BLAME.EXE is in front');
  s = { ...s, power: { ...s.power, config: { ...s.power.config, drainPerMinute: 5 } } };
  const level = s.power.level;
  assert.equal(reducer(s, actions.tick(30)), s, 'no drain while the clock is frozen');
  assert.equal(reducer(s, actions.driveReport({ charge: 5, distance: 900, stalls: 2, running: true, stalled: true, gear: 3, rpm: 5000 })), s, 'no gear input during the audit');
  assert.equal(s.power.level, level);

  const card = generatorWrapUp(s);
  assert.equal(card.title, '06:00. DAY CREW HAS THE GENERATOR.');
  assert.match(card.pointer, /BLAME\.EXE/);
  const end = verdict(s, player('0117'), intern('sysadmin')).shiftEnd.summary;
  assert.deepEqual({ distanceKm: card.distanceKm, stalls: card.stalls, lowestPower: card.lowestPower }, { distanceKm: end.distanceKm, stalls: end.stalls, lowestPower: end.lowestPower }, 'the card matches the end screen');
  assert.deepEqual([card.distanceKm, card.stalls], [0.9, 1]);
});
