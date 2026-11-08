// Proves the npm package works on its own: packs mcp/, installs the tarball into a fresh project,
// checks nothing in it reaches back into ../game, then runs the full smoke test against the
// installed bin. Needs network access for the package's own deps, and Chrome/Edge for the smoke.
//
//   npm run verify-pack
import { execSync, spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const npm = (args, cwd) => execSync(`npm ${args}`, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
// An import/export/import() whose specifier points into the game's source tree.
const GAME_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)["'][^"']*(?:\.\.\/game|game\/src)[^"']*["']/;

const walk = async (dir) => {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') out.push(...(await walk(full)));
    } else out.push(full);
  }
  return out;
};

const fail = (msg) => {
  throw new Error(msg);
};

const main = async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'night-shift-pack-'));
  try {
    console.log('# npm pack --workspace mcp');
    // prepack's own output comes first on stdout; the JSON report is the last thing printed.
    const out = npm(`pack --workspace mcp --json --pack-destination "${tmp}"`, repo);
    const [packed] = JSON.parse(out.slice(out.search(/^\[/m)));
    const { name: pkgName } = JSON.parse(await readFile(join(repo, 'mcp', 'package.json'), 'utf8'));
    // npm names a scoped tarball @scope/name -> scope-name-<version>.tgz.
    const expectedTgz = `${pkgName.replace(/^@/, '').replace('/', '-')}-${packed.version}.tgz`;
    if (packed.filename !== expectedTgz) fail(`Packed ${packed.filename}, expected ${expectedTgz}`);
    const tarball = join(tmp, packed.filename);
    console.log(`  ${packed.filename}: ${packed.files.length} files, ${(packed.size / 1024).toFixed(1)} KB`);
    for (const f of packed.files) console.log(`    ${f.path}`);

    const project = join(tmp, 'project');
    await mkdir(project);
    await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'verify-night-shift-mcp', private: true, type: 'module' }));
    console.log('\n# npm install <tarball> into a fresh project');
    npm(`install "${tarball}" --no-audit --no-fund --loglevel=error`, project);

    const pkgDir = join(project, 'node_modules', ...pkgName.split('/'));
    const binLink = join(project, 'node_modules', '.bin', process.platform === 'win32' ? 'night-shift-mcp.cmd' : 'night-shift-mcp');
    if (!existsSync(binLink)) fail(`Installing ${pkgName} didn't link the night-shift-mcp bin`);
    const files = await walk(pkgDir);
    const rel = files.map((f) => relative(pkgDir, f).replaceAll('\\', '/'));
    if (rel.some((f) => f.startsWith('src/') || f.startsWith('tests/') || f.startsWith('scripts/'))) fail(`Package ships dev files:\n  ${rel.join('\n  ')}`);
    for (const need of ['bin/night-shift-mcp.js', 'dist/server.js', 'README.md', 'LICENSE']) if (!rel.includes(need)) fail(`Package is missing ${need}`);
    for (const file of files.filter((f) => f.endsWith('.js'))) {
      const hit = (await readFile(file, 'utf8')).split('\n').find((line) => GAME_IMPORT.test(line));
      if (hit) fail(`${relative(pkgDir, file)} still imports from the game: ${hit.trim()}`);
    }
    console.log(`  ok - ${rel.length} files installed, no ../game or game/src imports`);

    const bin = join(pkgDir, 'bin', 'night-shift-mcp.js');
    const pkgVersion = JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8')).version;
    const ran = spawnSync(process.execPath, [bin, '--version'], { encoding: 'utf8' });
    if (ran.status !== 0 || ran.stderr.trim() !== pkgVersion) fail(`Installed bin --version said "${ran.stderr.trim()}", package is ${pkgVersion}`);
    console.log(`  ok - installed bin runs and reports ${pkgVersion}`);

    console.log('\n# smoke test against the installed package');
    const code = await new Promise((done) => {
      const child = spawn(process.execPath, [join(repo, 'mcp', 'scripts', 'smoke.js')], { cwd: repo, env: { ...process.env, SMOKE_MCP_BIN: bin }, stdio: 'inherit' });
      child.on('exit', done);
    });
    if (code !== 0) fail(`Smoke test against the packed server failed (exit ${code})`);
    console.log('\nverify-pack passed: the npm package works without the repo.');
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
};

if (!existsSync(join(repo, 'mcp', 'package.json'))) fail('Run from the night-shift repo');
main().catch((err) => {
  console.error(`\nVERIFY-PACK FAILED: ${err.message}`);
  process.exitCode = 1;
});
