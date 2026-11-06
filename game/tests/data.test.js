import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validatePuzzle, solve, parseWord } from '../src/logic/puzzle.js';
import { createInitialState } from '../src/core/initialState.js';
import { FILENAME_PATTERN } from '../src/core/reducer.js';
import { MAX_LEVEL } from '../src/core/permissions.js';
import { hexInWords } from '../src/logic/words.js';

const APP_KINDS = ['intern', 'geargrind', 'blame'];

const load = async (name) => JSON.parse(await readFile(new URL(`../data/${name}`, import.meta.url), 'utf8'));
const files = await load('files.json');
const puzzles = await load('puzzles.json');

test('every puzzle is valid and solvable within its move limit', () => {
  for (const p of puzzles) {
    assert.deepEqual(validatePuzzle(p), [], `${p.id} is invalid`);
    const path = solve(p);
    assert.ok(path, `${p.id} cannot be solved in ${p.moveLimit} moves`);
    assert.ok(path.length >= 2, `${p.id} is too easy (${path.length} move)`);
  }
});

test('puzzle ids are unique', () => {
  assert.equal(new Set(puzzles.map((p) => p.id)).size, puzzles.length);
});

test('files are well formed', () => {
  const ids = new Set(['desktop', ...files.map((f) => f.id)]);
  assert.equal(ids.size, files.length + 1, 'file ids must be unique');
  const puzzleIds = new Set(puzzles.map((p) => p.id));
  const seen = new Set();
  for (const f of files) {
    assert.match(f.name, FILENAME_PATTERN, `${f.id} has a non 8.3 name`);
    const parent = f.parent ?? 'desktop';
    assert.ok(ids.has(parent), `${f.id} has unknown parent ${parent}`);
    const key = `${parent}/${f.name}`;
    assert.ok(!seen.has(key), `duplicate name ${key}`);
    seen.add(key);
    if (f.puzzleId) assert.ok(puzzleIds.has(f.puzzleId), `${f.id} references unknown puzzle ${f.puzzleId}`);
    if (f.renameUnlock) assert.match(f.renameUnlock, FILENAME_PATTERN);
    if (f.locked && !f.puzzleId) assert.ok(f.lockedMessage, `${f.id} is locked with no puzzle and no message`);
    if (f.hidden !== undefined) assert.equal(typeof f.hidden, 'boolean', `${f.id}.hidden must be boolean`);
    if (f.minLevel !== undefined) assert.ok(Number.isInteger(f.minLevel) && f.minLevel >= 0 && f.minLevel <= MAX_LEVEL, `${f.id}.minLevel out of range`);
    if (f.type === 'app') assert.ok(APP_KINDS.includes(f.app), `${f.id} launches unknown app ${f.app}`);
    if (files.find((p) => p.id === parent)?.hidden) {
      assert.equal(f.hidden, true, `${f.id} lives in a hidden folder so it must be hidden too`);
    }
  }
});

test('keyed puzzles genuinely need both sides', () => {
  const hiddenText = files.filter((f) => f.hidden).map((f) => [f.content ?? []].flat().join('\n')).join('\n');
  for (const p of puzzles.filter((x) => x.ops.some((op) => op.keyed))) {
    assert.equal(solve(p, p.moveLimit, { withoutKeyed: true }), null, `${p.id} can be solved without its keyed op`);
    assert.ok(p.playerHides?.includes('hex'), `${p.id} should hide hex from the player so the target must be described`);
    for (const op of p.ops.filter((o) => o.keyed)) {
      assert.ok(hiddenText.includes(hexInWords(parseWord(op.mask))), `${p.id} key is not written in words in any hidden file`);
    }
  }
});

test('the night escalates the intern all the way to SUPERVISOR', () => {
  const levels = puzzles.map((p) => p.onSolve?.internLevel).filter(Boolean);
  for (let level = 2; level <= MAX_LEVEL; level++) assert.ok(levels.includes(level), `no puzzle grants level ${level}`);
  for (const f of files.filter((x) => x.minLevel)) assert.ok(levels.includes(f.minLevel) || f.minLevel <= 1, `nothing unlocks ${f.id}`);
  assert.ok(files.some((f) => f.minLevel === MAX_LEVEL), 'something is SUPERVISOR-only');
});

test('every onSolve is well formed', () => {
  for (const p of puzzles.filter((x) => x.onSolve)) {
    for (const k of Object.keys(p.onSolve)) assert.ok(['internLevel', 'drainScale', 'message'].includes(k), `${p.id}.onSolve.${k}`);
    if (p.onSolve.drainScale !== undefined) assert.ok(p.onSolve.drainScale > 0 && p.onSolve.drainScale < 1, `${p.id} drainScale`);
  }
});

test('the story only references real files and puzzles, and reveals every dormant file', async () => {
  const story = await load('story.json');
  const { validateStory } = await import('../src/core/story.js');
  const errors = validateStory(story, { fileIds: files.map((f) => f.id), puzzleIds: puzzles.map((p) => p.id), dormantIds: files.filter((f) => f.dormant).map((f) => f.id) });
  assert.deepEqual(errors, []);
  for (const f of files.filter((x) => x.dormant)) assert.ok(!f.hidden || f.parent !== 'desktop', `${f.id} would be a hidden desktop file`);
});

test('the scripted intern covers the shipped data', async () => {
  const { validateScript } = await import('../src/intern/fallback.js');
  const script = await load('intern.json');
  assert.deepEqual(validateScript(script, { puzzleIds: puzzles.map((p) => p.id), fileIds: files.map((f) => f.id) }), []);
  const mentioned = new Set(script.topics.flatMap((t) => [t.puzzle, t.leaks?.puzzle]).filter(Boolean));
  for (const p of puzzles.filter((x) => x.ops.some((op) => op.keyed))) assert.ok(mentioned.has(p.id), `no scripted topic leaks the ${p.id} key`);
  assert.ok(script.nag?.lines?.length, 'the scripted intern must nag about power');
});

test('shipped data builds a valid initial state, with the night and the story', async () => {
  const s = createInitialState({ files, puzzles, night: await load('night.json'), story: await load('story.json') });
  assert.ok(s.power.level > 0);
  assert.ok(s.clock.msPerMinute > 0);
  assert.ok(s.story.beats.length > 0);
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
});

test('shipped data builds a valid initial state', () => {
  const s = createInitialState({ files, puzzles });
  assert.equal(s.files.payroll.locked, true);
  assert.ok(s.puzzles.payroll);
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
});
