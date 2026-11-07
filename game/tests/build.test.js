import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, check, isAbsolute, refsIn } from '../../scripts/build.js';

test('the itch.io build is self-contained with relative paths only', async (t) => {
  const out = await mkdtemp(join(tmpdir(), 'night-shift-build-'));
  t.after(() => rm(out, { recursive: true, force: true }));
  const { files, total } = await build(out);

  assert.ok(existsSync(join(out, 'index.html')), 'index.html at the root');
  assert.ok(!existsSync(join(out, 'tests')), 'no tests dir');
  assert.ok(files.every((f) => !/(^|\/)tests\//.test(f.path)), 'no test files anywhere');
  for (const dir of ['src/main.js', 'styles/os.css', 'data/puzzles.json']) assert.ok(existsSync(join(out, dir)), dir);
  assert.ok(total > 0);

  const { problems } = await check(out);
  assert.deepEqual(problems, [], 'no absolute URLs and every relative import/fetch target exists');

  // The scanner really is reading the data paths main.js fetches.
  const main = await readFile(join(out, 'src/main.js'), 'utf8');
  const dataRefs = refsIn(main, '.js').filter((r) => r.endsWith('.json'));
  assert.ok(dataRefs.length >= 7, `main.js data paths: ${dataRefs}`);
  assert.ok(dataRefs.every((r) => r.startsWith('../data/')));
  assert.match(main, /fetch\(new URL\(path, import\.meta\.url\)\)/, 'data resolves against the module URL, so it works under an itch.io subpath');
});

test('the path check catches absolute and missing paths', async (t) => {
  const out = await mkdtemp(join(tmpdir(), 'night-shift-check-'));
  t.after(() => rm(out, { recursive: true, force: true }));
  await writeFile(join(out, 'index.html'), '<link href="/styles/os.css"><script src="https://cdn.example/x.js"></script><script type="module" src="main.js"></script><link rel="icon" href="data:image/svg+xml,x">');
  await writeFile(join(out, 'main.js'), "import { a } from './missing.js';\nconst d = fetch('/data/x.json');\n");
  const { problems } = await check(out);
  assert.equal(problems.length, 4, problems.join('\n'));
  assert.ok(isAbsolute('/x') && isAbsolute('https://x') && !isAbsolute('../data/x.json'));
});
