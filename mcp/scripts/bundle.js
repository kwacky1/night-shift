// Bundles the server and the game modules it borrows (../game/src) into dist/server.js, so the npm
// package stands on its own. npm deps stay external. Runs on `npm pack` / `npm publish` (prepack).
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const pkg = JSON.parse(await readFile(here('package.json'), 'utf8'));

const result = await build({
  entryPoints: [here('src/server.js')],
  outfile: here('dist/server.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  external: Object.keys(pkg.dependencies ?? {}).flatMap((d) => [d, `${d}/*`]),
  legalComments: 'inline',
  banner: { js: `// night-shift-mcp ${pkg.version}: bundled from src/ and the game's pure modules. Edit those, not this.` },
  logLevel: 'warning',
  metafile: true,
});

const inputs = Object.keys(result.metafile.inputs);
console.log(`dist/server.js: ${inputs.length} modules (${inputs.filter((i) => i.includes('game/src')).length} from the game)`);
