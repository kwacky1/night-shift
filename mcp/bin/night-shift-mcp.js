#!/usr/bin/env node
import { main } from '../src/server.js';

main().catch((err) => {
  process.stderr.write(`[night-shift-mcp] ${err.stack ?? err}\n`);
  process.exit(1);
});
