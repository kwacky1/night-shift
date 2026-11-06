// Week 4 intern balance: whose hands each op needs, the intern's remote-op quota, and no-op moves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { solve, solveTogether, validatePuzzle } from '../src/logic/puzzle.js';
import { canActorUseOp, canInternUseOp, internActionError, internOpsLeft, levelInfo } from '../src/core/permissions.js';
import { reducer } from '../src/core/reducer.js';
import { actions } from '../src/core/actions.js';
import { createInitialState } from '../src/core/initialState.js';
import { fallbackAsk, validateScript } from '../src/intern/fallback.js';

const load = async (name) => JSON.parse(await readFile(new URL(`../data/${name}`, import.meta.url), 'utf8'));
const files = await load('files.json');
const puzzles = await load('puzzles.json');
const night = await load('night.json');
const story = await load('story.json');
const script = await load('intern.json');
const data = { files, puzzles, night: { ...night, power: { ...night.power, drainPerMinute: 0 } }, story };

// The intern's clearance when each sector is meant to be tackled.
const LEVEL_AT = { payroll: 1, badge: 2, genset: 2, timeclk: 2 };
const internTypes = (id) => levelInfo(LEVEL_AT[id]).ops;

const desktop = () => [actions.bootComplete(), actions.clockIn()].reduce(reducer, createInitialState(data));
const asIntern = (a) => ({ ...a, actor: 'intern' });
const atLevel = (s, level) => ({ ...s, intern: { ...s.intern, level } });

test('every sector sets an intern quota and splits its ops between both sides', () => {
  for (const p of puzzles) {
    assert.deepEqual(validatePuzzle(p), [], p.id);
    assert.ok(Number.isInteger(p.internMoves) && p.internMoves > 0, `${p.id} has no intern quota`);
    assert.ok(p.ops.some((op) => op.hands === 'player'), `${p.id} has no console-only op`);
  }
});

test('the intern alone cannot recover any sector, even with every remote op it is allowed', () => {
  for (const p of puzzles) {
    const types = internTypes(p.id);
    const canUse = (op) => canActorUseOp('intern', op) && types.includes(op.type);
    assert.equal(solve(p, p.moveLimit, { canUse }), null, `${p.id}: the intern can solve it alone`);
  }
});

test('the sysadmin alone cannot recover a keyed sector without the key, or a sector with remote-only ops', () => {
  for (const p of puzzles) {
    if (!p.ops.some((op) => op.keyed || op.hands === 'intern')) continue;
    const canUse = (op) => canActorUseOp('player', op) && !op.keyed;
    assert.equal(solve(p, p.moveLimit, { canUse }), null, `${p.id}: the sysadmin can solve it alone`);
  }
});

test('together, every sector is solvable within its move limit and the intern quota', () => {
  for (const p of puzzles) {
    const path = solveTogether(p, { internTypes: internTypes(p.id) });
    assert.ok(path, `${p.id} cannot be solved together`);
    assert.ok(path.length <= p.moveLimit);
    assert.ok(path.filter((m) => m.by === 'intern').length <= p.internMoves);
    // The intern's part is either a remote op or reading out the key.
    assert.ok(path.some((m) => m.by === 'player'), `${p.id} leaves the sysadmin nothing to do`);
    assert.ok(path.some((m) => m.by === 'intern' || p.ops[m.op].keyed), `${p.id} leaves the intern nothing to do`);
  }
});

test('validatePuzzle checks hands and the intern quota', () => {
  const bad = { id: 'x', start: '0x0001', target: '0x0002', moveLimit: 3, internMoves: 9, ops: [{ type: 'shl', n: 1, hands: 'robot' }] };
  const errors = validatePuzzle(bad).join('\n');
  assert.match(errors, /hands/);
  assert.match(errors, /internMoves/);
});

test('the intern is refused console-only ops, and the sysadmin cannot press remote-only ones', () => {
  let s = desktop();
  assert.match(internActionError(atLevel(s, 2), asIntern(actions.applyOp('payroll', 2))), /CONSOLE ONLY/);
  const before = s.puzzles.payroll;
  s = reducer(s, actions.applyOp('payroll', 1));
  assert.equal(s.puzzles.payroll, before, 'player cannot run the intern-only >> 3');
  s = reducer(s, asIntern(actions.applyOp('payroll', 1)));
  assert.deepEqual(s.puzzles.payroll.by, ['intern']);
});

test('the remote quota runs out per attempt, and undo or reset gives it back', () => {
  let s = desktop();
  const p = () => s.puzzles.payroll;
  s = reducer(s, asIntern(actions.applyOp('payroll', 1))); // >> 3 -> 0x0000
  s = reducer(s, actions.applyOp('payroll', 2)); // XOR -> 0x0F0F
  s = reducer(s, asIntern(actions.applyOp('payroll', 0))); // << 1
  assert.equal(internOpsLeft(p()), 0);
  assert.match(internActionError(s, asIntern(actions.applyOp('payroll', 0))), /REMOTE QUOTA/);
  const blocked = reducer(s, asIntern(actions.applyOp('payroll', 0)));
  assert.equal(blocked.puzzles.payroll, p());
  s = reducer(s, actions.undo('payroll'));
  assert.equal(internOpsLeft(p()), 1);
  assert.deepEqual(p().by, ['intern', 'player']);
  s = reducer(s, actions.applyOp('payroll', 0));
  s = reducer(s, asIntern(actions.applyOp('payroll', 0)));
  assert.equal(p().solved, true);
  assert.equal(p().solvedBy, 'intern');
  assert.equal(s.stats.playerOps, 2);
  assert.equal(s.stats.internOps, 3, 'the undone op still counts as one the intern ran');
  s = reducer(desktop(), asIntern(actions.applyOp('payroll', 1)));
  s = reducer(s, actions.resetPuzzle('payroll'));
  assert.deepEqual(s.puzzles.payroll.by, []);
});

test('scripted intern ops count separately from the AI', () => {
  const s = reducer(desktop(), { ...asIntern(actions.applyOp('payroll', 1)), scripted: true });
  assert.equal(s.stats.scriptedOps, 1);
  assert.equal(s.stats.internOps, 0);
});

test('a move that changes nothing costs nothing and says NO CHANGE', () => {
  let s = desktop();
  s = reducer(s, asIntern(actions.applyOp('payroll', 1))); // 0x0003 >> 3 = 0x0000
  const used = s.puzzles.payroll.history.length;
  s = reducer(s, asIntern(actions.applyOp('payroll', 1))); // 0x0000 >> 3 = 0x0000
  assert.equal(s.puzzles.payroll.history.length, used, 'no move used');
  assert.equal(internOpsLeft(s.puzzles.payroll), 1, 'no quota spent');
  assert.deepEqual(s.puzzles.payroll.noop, { seq: 1, op: 1, by: 'intern' });
  assert.match(s.intern.messages.at(-1).text, /NO CHANGE/);
  assert.match(s.log.at(-1).text, /NO CHANGE/);
  s = reducer(s, actions.applyOp('payroll', 0)); // 0x0000 << 1, still nothing
  assert.equal(s.puzzles.payroll.noop.seq, 2);
  assert.equal(s.puzzles.payroll.noop.by, 'player');
  assert.equal(s.puzzles.payroll.history.length, used);
});

test('OPERATOR clearance is still needed for XOR', () => {
  const s = atLevel(desktop(), 1);
  assert.equal(canInternUseOp(1, 'xor'), false);
  assert.match(internActionError(s, asIntern(actions.applyOp('badge', 2))), /cannot use XOR|No such/);
});

test('the scripted intern runs remote-only ops when asked, and explains when it cannot', () => {
  assert.deepEqual(validateScript(script).filter((e) => e.startsWith('ask')), []);
  const s = desktop();
  const ok = fallbackAsk(s, 'payroll', 1, script);
  assert.equal(ok.apply, true);
  assert.match(ok.text, />> 3/);
  const genset = fallbackAsk(s, 'genset', 2, script);
  assert.equal(genset.apply, false);
  assert.match(genset.text, /PROBATION interns cannot use XOR|No such/);
  assert.match(validateScript({ ...script, ask: { okLines: ['x {{key}}'], refusedLines: ['no'] } }).join('\n'), /placeholder \{\{key\}\}[\s\S]*reason/);
});
