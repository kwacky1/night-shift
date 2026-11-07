// Builds the itch.io HTML upload: copies the runtime parts of game/ into dist/html/ with index.html
// at the root, then checks every path in the output is relative (itch serves the game from a
// subpath inside an iframe, so a leading `/` or an absolute URL would break).
//
//   npm run build                 -> dist/html/
//   node scripts/build.js <dir>   -> <dir>
import { cp, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const GAME_DIR = join(repo, 'game');
export const DEFAULT_OUT = join(repo, 'dist', 'html');
// Everything the browser needs. tests/ (and anything else dev-only) stays behind.
export const RUNTIME = ['index.html', 'styles', 'src', 'data'];

const walk = async (dir) => {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out.sort();
};

// Every path a file in the build asks the browser to load, as written in the source.
const PATTERNS = {
  '.html': [/\b(?:src|href)\s*=\s*["']([^"']+)["']/g],
  '.css': [/url\(\s*["']?([^"')]+)["']?\s*\)/g, /@import\s+["']([^"']+)["']/g],
  '.js': [
    /\bimport\s+(?:[^'"`;]*?\s+from\s+)?["']([^"']+)["']/g,
    /\bexport\s+[^'"`;]*?\s+from\s+["']([^"']+)["']/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
    /\bfetch\(\s*["']([^"']+)["']/g,
    /\bnew URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url/g,
    /\bloadJson\(\s*["']([^"']+)["']/g,
  ],
};

export const refsIn = (text, ext) => (PATTERNS[ext] ?? []).flatMap((re) => [...text.matchAll(re)].map((m) => m[1]));

const isInline = (ref) => /^(data:|#|javascript:|mailto:)/i.test(ref);
export const isAbsolute = (ref) => ref.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(ref);

// The base a reference resolves against. main.js resolves data paths against its own URL
// (fetch(new URL(path, import.meta.url))), so those count as relative to the module too.
const target = (file, ref) => join(dirname(file), ref.split(/[?#]/)[0]);

export const check = async (outDir) => {
  const problems = [];
  const files = await walk(outDir);
  for (const file of files) {
    const ext = file.slice(file.lastIndexOf('.'));
    if (!PATTERNS[ext]) continue;
    const text = await readFile(file, 'utf8');
    for (const ref of refsIn(text, ext)) {
      if (isInline(ref)) continue;
      const where = relative(outDir, file).split(sep).join('/');
      if (isAbsolute(ref)) problems.push(`${where}: absolute path "${ref}"`);
      else if (!existsSync(target(file, ref))) problems.push(`${where}: "${ref}" does not exist in the build`);
    }
  }
  return { files, problems };
};

export const build = async (outDir = DEFAULT_OUT) => {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  for (const part of RUNTIME) await cp(join(GAME_DIR, part), join(outDir, part), { recursive: true });
  const { files, problems } = await check(outDir);
  if (problems.length) throw new Error(`Build has bad paths:\n  ${problems.join('\n  ')}`);
  let total = 0;
  const listing = [];
  for (const file of files) {
    const { size } = await stat(file);
    total += size;
    listing.push({ path: posix.join(...relative(outDir, file).split(sep)), size });
  }
  return { outDir, files: listing, total };
};

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_OUT;
  build(out)
    .then(({ files, total }) => {
      for (const f of files) console.log(`  ${f.path.padEnd(32)} ${kb(f.size).padStart(9)}`);
      console.log(`\n${files.length} files, ${kb(total)} in ${relative(process.cwd(), out) || '.'}`);
    })
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    });
}
