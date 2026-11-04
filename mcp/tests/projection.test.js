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
    ['BOOTLOG.TXT', 'NS-02.LOG'],
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
