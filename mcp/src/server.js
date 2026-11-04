// night-shift-mcp: an MCP server (stdio) that lets an AI agent play intern #0118 in NIGHT_SHIFT.EXE.
// stdout is the MCP channel, so everything human-readable goes to stderr.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { GameLink, DEFAULT_PORT } from './link.js';
import { createTools } from './tools.js';

export const VERSION = '0.2.0';

export const INSTRUCTIONS = `You are intern #0118 on the night shift at ACME Dataworks, Brisbane, 3 November 1997. It is your first night.
Your supervisor is the sysadmin: the human playing NIGHT_SHIFT.EXE. You are on a different terminal and CANNOT see their screen.

How this works:
- You see things they cannot: hidden SYSTEM files (list_files, read_file), the system event log (read_logs), and exact numbers for corrupted "Bit Rot" sectors (inspect_puzzle).
- They see things you cannot: each sector's TARGET bit pattern, drawn as lit squares. You never get the target as a number. Ask them to describe it (for example, which of the 16 squares are lit, left to right).
- The only way to talk to them is message_player. Check read_messages often, or use wait_for_player when you are waiting on them.
- You can apply puzzle ops yourself (shift_left, shift_right, xor), but each one spends one of the sysadmin's limited moves. Agree a plan with them first. You cannot undo or reset; only they can.
- Your clearance (whoami) limits what you can do. Head Office may promote you during the night.

Rules of the shift:
- Stay in character as a slightly nervous 1997 graduate intern. Keep messages short (they are chat bubbles).
- Work it out together. Do not brute force ops or keys; moves are scarce and failed key attempts are logged.
- Only state what your tools actually show you. If a file is restricted, say so.
- Something is off about badge #0117. Notice things, but do not invent facts.`;

export const createServer = (link) => {
  const server = new McpServer({ name: 'night-shift-mcp', title: 'NIGHT_SHIFT.EXE intern line', version: VERSION }, { instructions: INSTRUCTIONS });
  for (const tool of createTools(link)) {
    server.registerTool(tool.name, { title: tool.title, description: tool.description, inputSchema: tool.inputSchema }, tool.handler);
  }
  return server;
};

export const parseArgs = (argv, env = process.env) => {
  const opts = { port: Number(env.NIGHT_SHIFT_PORT) || DEFAULT_PORT, allowOrigins: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, inline] = arg.includes('=') ? arg.split(/=(.*)/s) : [arg, undefined];
    const value = () => inline ?? argv[++i];
    if (flag === '--port' || flag === '-p') opts.port = Number(value());
    else if (flag === '--allow-origin') opts.allowOrigins.push(value());
    else if (flag === '--help' || flag === '-h') opts.help = true;
    else if (flag === '--version' || flag === '-v') opts.version = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!Number.isInteger(opts.port) || opts.port < 0 || opts.port > 65535) throw new Error('Port must be 0-65535 (0 picks a free port)');
  return opts;
};

export const HELP = `night-shift-mcp ${VERSION}
MCP server (stdio) that lets an AI agent play the intern in NIGHT_SHIFT.EXE.

Usage: night-shift-mcp [--port 7117] [--allow-origin https://example.com]

  --port, -p        WebSocket port for the game (default 7117, env NIGHT_SHIFT_PORT)
  --allow-origin    Extra browser origin allowed to connect (repeatable).
                    localhost, 127.0.0.1 and *.itch.zone / *.itch.io are allowed by default.

The game connects to ws://localhost:PORT (INTERN.EXE > Dial, or ?intern=ws://localhost:PORT).`;

export const main = async (argv = process.argv.slice(2)) => {
  const log = (msg) => process.stderr.write(`[night-shift-mcp] ${msg}\n`);
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    log(err.message);
    process.stderr.write(`${HELP}\n`);
    process.exit(2);
  }
  if (opts.help || opts.version) {
    process.stderr.write(`${opts.help ? HELP : VERSION}\n`);
    return;
  }
  const link = new GameLink({ port: opts.port, allowOrigins: opts.allowOrigins, log });
  try {
    await link.start();
  } catch (err) {
    log(err.message);
    process.exit(1);
  }
  log(`Waiting for the game on ws://localhost:${link.port}`);
  const server = createServer(link);
  await server.connect(new StdioServerTransport());
  const shutdown = async () => {
    await link.stop();
    await server.close();
    process.exit(0);
  };
  process.stdin.on('close', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};
