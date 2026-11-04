import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validatePuzzle, solve } from '../src/logic/puzzle.js';
import { createInitialState } from '../src/core/initialState.js';
import { FILENAME_PATTERN } from '../src/core/reducer.js';

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
  }
});

test('shipped data builds a valid initial state', () => {
  const s = createInitialState({ files, puzzles });
  assert.equal(s.files.payroll.locked, true);
  assert.ok(s.puzzles.payroll);
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
});
