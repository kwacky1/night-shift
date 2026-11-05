import { test } from 'node:test';
import assert from 'node:assert/strict';
import { desktopState } from './fake-game.js';
import { GameState } from '../src/schema.js';
import * as view from '../src/projection.js';

const promoted = (s) => ({ ...s, intern: { ...s.intern, level: 2 } });

test('a real game state passes the inbound schema', () => {
  const parsed = GameState.safeParse(desktopState());
  assert.ok(parsed.success, parsed.error?.message);
});

test('whoami reports badge, clearance and allowed ops', () => {
  const w = view.whoami(desktopState());
  assert.equal(w.badge, '#0118');
  assert.equal(w.clearance, 'PROBATION');
  assert.deepEqual(w.allowedOps, ['shl', 'shr']);
  assert.equal(w.clock, '22:00');
});

test('the intern sees hidden files the player cannot', () => {
  const s = desktopState();
  const paths = view.listFiles(s).map((f) => f.path);
  assert.ok(paths.includes('C:\\C_DRIVE\\SYSTEM'));
  assert.ok(paths.includes('C:\\C_DRIVE\\SYSTEM\\NS-02.LOG'));
  const ns02 = view.listFiles(s).find((f) => f.name === 'NS-02.LOG');
  assert.deepEqual(ns02.tags, ['hidden', 'needs OPERATOR']);
  assert.deepEqual(
    view.listFiles(s, 'system').map((f) => f.name),
    ['0117.SEC', 'BOOTLOG.TXT', 'NS-02.LOG'],
  );
});

test('resolveFile accepts ids, paths with either slash, and unique names', () => {
  const s = desktopState();
  assert.equal(view.resolveFile(s, 'C:\\C_DRIVE\\AUTOEXEC.BAT').file.id, 'autoexec');
  assert.equal(view.resolveFile(s, 'c:/c_drive/autoexec.bat').file.id, 'autoexec');
  assert.equal(view.resolveFile(s, 'autoexec.bat').file.id, 'autoexec');
  assert.equal(view.resolveFile(s, 'ns02log').file.id, 'ns02log');
  assert.match(view.resolveFile(s, 'NOPE.TXT').error, /not found/);
});

test('reading respects clearance, Bit Rot and locks', () => {
  const s = desktopState();
  const read = (state, q) => view.readFile(state, view.resolveFile(state, q).file);
  assert.match(read(s, 'NS-02.LOG').error, /ACCESS DENIED.*OPERATOR.*PROBATION/);
  assert.match(read(promoted(s), 'NS-02.LOG').text, /zero, one, one, seven/);
  assert.match(read(s, 'BOOTLOG.TXT').text, /NS-02.LOG/);
  assert.match(read(s, 'PAYROLL.DAT').error, /Bit Rot/);
  assert.doesNotMatch(read(s, 'PAYROLL.DAT').error, /TERMINATED/);
  assert.match(read(s, 'SHIFTLOG.BAK').error, /will not open/);
  assert.match(read(s, 'C_DRIVE').error, /folder/);
});

test('puzzle view: numbers yes, target and keyed masks no', () => {
  const s = desktopState();
  const badge = view.puzzleView(s, s.puzzles.badge);
  assert.equal(badge.current.hex, '0x0118');
  assert.equal(badge.current.binary, '0000 0001 0001 1000');
  assert.match(badge.target, /NOT VISIBLE/);
  assert.equal(badge.sysadminSeesNumbers, false);
  const keyed = badge.ops.find((o) => o.keyed);
  assert.equal(keyed.mask, null);
  assert.match(keyed.label, /REDACTED/);
  const json = JSON.stringify(view.projectForIntern(s));
  assert.ok(!json.includes('0x0FF0'), 'badge target must not leak');
  assert.ok(!json.includes('0x3C3C'), 'payroll target must not leak');
  assert.ok(!JSON.stringify(badge).includes('0x0117') && !json.includes('"mask":279'), 'keyed mask must not leak');
  assert.ok(!json.includes('TERMINATED'), 'locked file contents must not leak');
});

test('unlocked keyed ops are revealed', () => {
  const s = desktopState();
  const unlocked = { ...s, puzzles: { ...s.puzzles, badge: { ...s.puzzles.badge, unlocked: [3] } } };
  assert.equal(view.puzzleView(unlocked, unlocked.puzzles.badge).ops[3].mask, '0x0117');
});

test('logs and chat are projected', () => {
  const s = desktopState();
  assert.match(view.readLogs(s).at(-1), /\[22:00\] Badge 0117 clocked in/);
  assert.equal(view.chat(s)[0].from, 'system');
});

test('parseMask accepts hex, binary and decimal 16-bit values only', () => {
  assert.equal(view.parseMask('0x0117'), 0x117);
  assert.equal(view.parseMask('0b11'), 3);
  assert.equal(view.parseMask('279'), 279);
  assert.equal(view.parseMask('0x10000'), null);
  assert.equal(view.parseMask('nope'), null);
});

// ---- week 3 -------------------------------------------------------------------------------

const reveal = (s, ...ids) => ({ ...s, files: Object.fromEntries(Object.entries(s.files).map(([id, f]) => [id, ids.includes(id) ? { ...f, dormant: false } : f])) });
const withPower = (s, level) => ({ ...s, power: { ...s.power, level } });

test('dormant files and sectors do not exist for the intern until the story reveals them', () => {
  const s = desktopState();
  const names = view.listFiles(s).map((f) => f.name);
  for (const n of ['GENSET.CFG', 'TIMECLK.DAT', 'TIMECLK.AUD', 'BLAME.EXE']) assert.ok(!names.includes(n), n);
  assert.deepEqual(view.listPuzzles(s).map((p) => p.id), ['payroll', 'badge']);
  assert.match(view.resolvePuzzle(s, 'timeclk').error, /timeclk/);
  assert.match(view.resolveFile(s, 'GENSET.CFG').error, /not found/);
  const later = reveal(s, 'genset', 'timeclk', 'timeaud');
  assert.ok(view.listFiles(later).some((f) => f.name === 'TIMECLK.AUD'));
  assert.equal(view.resolvePuzzle(later, 'TIMECLK.DAT').puzzle.id, 'timeclk');
  assert.deepEqual(view.listPuzzles(later).map((p) => p.id), ['payroll', 'badge', 'genset', 'timeclk']);
});

test('the sealed file needs SUPERVISOR', () => {
  const s = desktopState();
  const sealed = view.resolveFile(s, '0117.SEC').file;
  assert.match(view.readFile(promoted(s), sealed).error, /needs SUPERVISOR/);
  assert.match(view.readFile({ ...s, intern: { ...s.intern, level: 3 } }, sealed).text, /PERSONNEL FILE/);
});

test('whoami shows mainframe power and says who drives', () => {
  const s = desktopState();
  const w = view.whoami(s);
  assert.equal(w.mainframePower, '80%');
  assert.equal(w.powerStatus, 'OK');
  assert.equal(w.canRunOps, true);
  assert.match(w.whoDrives, /You cannot/);
  assert.doesNotMatch(w.whoDrives, /nag/);
  const low = view.whoami(withPower(s, 25));
  assert.equal(low.powerStatus, 'BROWNOUT');
  assert.equal(low.canRunOps, false);
  assert.match(low.powerNote, /chat still works/i);
  assert.match(low.whoDrives, /nag them to drive/);
});

test('ghost posts reach the intern as #0117, and the schema lets them through', () => {
  const s = desktopState();
  const ghost = { ...s, intern: { ...s.intern, messages: [...s.intern.messages, { id: 99, at: '22:40', from: 'ghost', text: "you're sitting at my desk." }] } };
  assert.equal(view.chat(ghost).at(-1).from, '#0117');
  const parsed = GameState.safeParse(withPower(ghost, 12.5));
  assert.ok(parsed.success, parsed.error?.message);
  assert.equal(parsed.data.power.level, 12.5);
  assert.equal(parsed.data.files.genset.dormant, true);
  assert.equal(parsed.data.story, undefined, 'story stays on the sysadmin side');
  assert.equal(view.whoami(parsed.data).powerStatus, 'CRITICAL');
});

test('a finished shift parses, and whoami says so', () => {
  const s = { ...desktopState(), phase: 'over', shiftEnd: { reason: 'blackout', at: '03:12', summary: {} } };
  const parsed = GameState.safeParse(s);
  assert.ok(parsed.success, parsed.error?.message);
  assert.match(view.whoami(parsed.data).shiftOver, /BLACKOUT/);
});
