#!/usr/bin/env node
// In a repo checkout (the game sits next door) run straight from src/, so edits to the game or the
// server never need a rebuild. The npm package has no src/ or ../game, so it runs the bundle in dist/.
import { existsSync } from 'node:fs';

const inRepo = existsSync(new URL('../src/server.js', import.meta.url)) && existsSync(new URL('../../game/src/bridge/api.js', import.meta.url));
const entry = inRepo || !existsSync(new URL('../dist/server.js', import.meta.url)) ? '../src/server.js' : '../dist/server.js';

const { main } = await import(entry);
main().catch((err) => {
  process.stderr.write(`[night-shift-mcp] ${err.stack ?? err}\n`);
  process.exit(1);
});
