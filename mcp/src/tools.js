// Intern-facing MCP tools. Deliberately NOT a dispatch passthrough: each tool reads the
// projected intern view or asks the game for one specific, allowlisted action.
// Handlers take plain args and return MCP tool results, so they are easy to unit test.
import { z } from 'zod';
import { internActionError } from '../../game/src/core/permissions.js';
import { toHex } from '../../game/src/logic/bits.js';
import { NotConnectedError } from './link.js';
import * as view from './projection.js';

export const MESSAGE_MAX = 280;
const WAIT_MAX_SECONDS = 120;

const text = (t) => ({ content: [{ type: 'text', text: t }] });
const fail = (t) => ({ content: [{ type: 'text', text: t }], isError: true });
const json = (label, obj) => text(`${label}\n${JSON.stringify(obj, null, 2)}`);

export const notConnectedText = (port) =>
  [
    'NO CARRIER. The sysadmin\'s terminal is not connected to your intern line yet.',
    `Ask them to open INTERN.EXE in NIGHT_SHIFT.EXE and dial ws://localhost:${port}`,
    `(or load the game with ?intern=ws://localhost:${port}). Then try again.`,
  ].join('\n');

export const createTools = (link, { port = link.port } = {}) => {
  // read_messages cursor: the highest player message id the agent has already been shown.
  let seenId = 0;

  const withGame = (fn, { needsDesktop = true } = {}) => async (args = {}) => {
    const state = link.state;
    if (!link.connected || !state) return text(notConnectedText(port));
    if (needsDesktop && state.phase !== 'desktop') return text('The sysadmin has not clocked in yet. Nothing on the network until they do.');
    try {
      return await fn(state, args);
    } catch (err) {
      if (err instanceof NotConnectedError) return text(notConnectedText(port));
      return fail(`Something went wrong on the line: ${err.message}`);
    }
  };

  const unreadPlayerMessages = (state) => {
    const msgs = view.chat(state);
    const maxId = msgs.at(-1)?.id ?? 0;
    if (maxId < seenId) seenId = 0; // the game was reset
    return msgs.filter((m) => m.from === 'player' && m.id > seenId);
  };

  const formatMessages = (msgs) => msgs.map((m) => `[${m.at}] ${m.from === 'player' ? 'SYSADMIN' : m.from === 'intern' ? 'YOU (#0118)' : 'SYSTEM'}: ${m.text}`).join('\n');

  const takeUnread = (state) => {
    const unread = unreadPlayerMessages(state);
    if (unread.length) seenId = unread.at(-1).id;
    return unread;
  };

  // Run one allowlisted action in the game and describe the puzzle afterwards.
  const runOp = async (puzzle, opIndex, extra = []) => {
    for (const action of [...extra, { type: 'PUZZLE_APPLY_OP', puzzleId: puzzle.id, opIndex }]) {
      const denied = internActionError(link.state, { ...action, actor: 'intern' });
      if (denied) return text(denied);
      const res = await link.dispatch(action);
      if (!res.ok) return text(`The game refused: ${res.error}`);
    }
    const after = view.puzzleView(link.state, link.state.puzzles[puzzle.id]);
    const op = after.ops[opIndex];
    const lines = [`Applied ${op.label}. CURRENT is now ${after.current.hex} (${after.current.binary}). Moves ${after.moves.used}/${after.moves.limit}.`];
    if (after.status === 'RECOVERED') lines.push('SECTOR RECOVERED. Nice work. Tell the sysadmin.');
    else if (after.status.startsWith('OUT')) lines.push('Out of moves. Ask the sysadmin to undo or reset.');
    return text(lines.join('\n'));
  };

  const findPuzzle = (state, query) => {
    const r = view.resolvePuzzle(state, query);
    return r.puzzle ? r : { error: fail(r.error) };
  };

  const shift = (type) =>
    withGame(async (state, { puzzle: query, n }) => {
      const { puzzle, error } = findPuzzle(state, query);
      if (error) return error;
      const matches = puzzle.ops.map((op, i) => ({ op, i })).filter(({ op }) => op.type === type && (n === undefined || op.n === n));
      const sym = type === 'shl' ? '<<' : '>>';
      if (matches.length === 0) return text(`This sector has no ${sym}${n ? ` ${n}` : ''} op. Available: ${view.puzzleView(state, puzzle).ops.map((o) => o.label).join(', ')}.`);
      if (matches.length > 1) return text(`Several ${sym} ops here (${matches.map(({ op }) => op.n).join(', ')}). Pass n.`);
      return runOp(puzzle, matches[0].i);
    });

  const puzzleArg = z.string().min(1).max(80).describe('Puzzle id, file name (e.g. BADGE.DB) or path');

  return [
    {
      name: 'whoami',
      title: 'Who am I?',
      description: 'Your badge, clearance level, what you are allowed to do and the shift clock.',
      inputSchema: {},
      handler: withGame(async (state) => json('INTERN STATUS', view.whoami(state)), { needsDesktop: false }),
    },
    {
      name: 'list_files',
      title: 'List files',
      description: 'List files on the sysadmin\'s machine, including hidden SYSTEM files the sysadmin cannot see. Optionally pass a folder path.',
      inputSchema: { path: z.string().max(120).optional().describe('Folder path, e.g. C:\\C_DRIVE. Defaults to the whole drive.') },
      handler: withGame(async (state, { path }) => {
        const { file, error } = view.resolveFile(state, path ?? '');
        if (error) return fail(error);
        if (file.type !== 'folder') return fail(`${view.filePath(state, file)} is not a folder.`);
        const rows = view.listFiles(state, file.id);
        if (!rows.length) return text('Empty folder.');
        return text(rows.map((r) => `${'  '.repeat(r.depth - 1)}${r.path}${r.tags.length ? `  [${r.tags.join(', ')}]` : ''}`).join('\n'));
      }),
    },
    {
      name: 'read_file',
      title: 'Read a file',
      description: 'Read a file by path or name. You can read hidden files the sysadmin cannot see, subject to your clearance.',
      inputSchema: { path: z.string().min(1).max(120).describe('File path or name, e.g. C:\\C_DRIVE\\AUTOEXEC.BAT') },
      handler: withGame(async (state, { path }) => {
        const { file, error } = view.resolveFile(state, path);
        if (error) return fail(error);
        const r = view.readFile(state, file);
        return r.error ? text(r.error) : text(`--- ${view.filePath(state, file)} ---\n${r.text}`);
      }),
    },
    {
      name: 'read_logs',
      title: 'Read the system log',
      description: 'Read the system event log. The sysadmin never sees this log on screen.',
      inputSchema: { limit: z.number().int().min(1).max(100).optional().describe('How many recent lines (default 20)') },
      handler: withGame(async (state, { limit = 20 }) => {
        const lines = view.readLogs(state, limit);
        return text(lines.length ? lines.join('\n') : 'The log is empty.');
      }),
    },
    {
      name: 'inspect_puzzle',
      title: 'Inspect a Bit Rot sector',
      description:
        'See a corrupted sector as numbers: current value in hex/binary, moves left and the ops. You cannot see the TARGET; the sysadmin sees it as a picture. Omit puzzle to list all sectors.',
      inputSchema: { puzzle: puzzleArg.optional() },
      handler: withGame(async (state, { puzzle: query }) => {
        if (!query) return json('BIT ROT SECTORS', view.listPuzzles(state).map(({ id, files, title, status, moves }) => ({ id, files, title, status, moves })));
        const { puzzle, error } = findPuzzle(state, query);
        return error ?? json('SECTOR', view.puzzleView(state, puzzle));
      }),
    },
    {
      name: 'shift_left',
      title: 'Shift left (<<)',
      description: 'Apply the sector\'s << op. Costs one of the sysadmin\'s moves.',
      inputSchema: { puzzle: puzzleArg, n: z.number().int().min(1).max(15).optional().describe('Shift amount, only needed if there are several << ops') },
      handler: shift('shl'),
    },
    {
      name: 'shift_right',
      title: 'Shift right (>>)',
      description: 'Apply the sector\'s >> op. Costs one of the sysadmin\'s moves.',
      inputSchema: { puzzle: puzzleArg, n: z.number().int().min(1).max(15).optional().describe('Shift amount, only needed if there are several >> ops') },
      handler: shift('shr'),
    },
    {
      name: 'xor',
      title: 'XOR with a mask',
      description:
        'Apply one of the sector\'s XOR ops by giving its mask (e.g. "0xFF00"). For a keyed (redacted) XOR, give the override key: it is entered first, then applied. Needs OPERATOR clearance. Costs one move.',
      inputSchema: { puzzle: puzzleArg, mask: z.string().min(1).max(18).describe('Mask as hex (0x0F0F), binary (0b...) or decimal') },
      handler: withGame(async (state, { puzzle: query, mask }) => {
        const { puzzle, error } = findPuzzle(state, query);
        if (error) return error;
        const value = view.parseMask(mask);
        if (value === null) return fail(`"${mask}" is not a 16-bit value. Try hex like 0x0F0F.`);
        const i = puzzle.ops.findIndex((op) => op.type === 'xor' && op.mask === value);
        const keyedIndex = puzzle.ops.findIndex((op, j) => op.keyed && !(puzzle.unlocked ?? []).includes(j));
        if (i >= 0) {
          const extra = puzzle.ops[i].keyed && !(puzzle.unlocked ?? []).includes(i) ? [{ type: 'PUZZLE_ENTER_KEY', puzzleId: puzzle.id, opIndex: i, mask: toHex(value) }] : [];
          return runOp(puzzle, i, extra);
        }
        if (keyedIndex >= 0) {
          const denied = internActionError(state, { type: 'PUZZLE_ENTER_KEY', puzzleId: puzzle.id, opIndex: keyedIndex, actor: 'intern' });
          if (denied) return text(denied);
          await link.dispatch({ type: 'PUZZLE_ENTER_KEY', puzzleId: puzzle.id, opIndex: keyedIndex, mask: toHex(value) });
          return text(`KEY REJECTED: ${toHex(value)} is not the override key, and it matches no visible XOR on this sector.`);
        }
        return text(`No XOR with mask ${toHex(value)} on this sector.`);
      }),
    },
    {
      name: 'enter_key',
      title: 'Enter an override key',
      description: 'Unlock a keyed (redacted) XOR op without applying it, so the sysadmin can use it too. Needs OPERATOR clearance. Does not cost a move.',
      inputSchema: { puzzle: puzzleArg, key: z.string().min(1).max(18).describe('The key as hex, e.g. 0x1234') },
      handler: withGame(async (state, { puzzle: query, key }) => {
        const { puzzle, error } = findPuzzle(state, query);
        if (error) return error;
        const value = view.parseMask(key);
        if (value === null) return fail(`"${key}" is not a 16-bit value.`);
        const opIndex = puzzle.ops.findIndex((op, j) => op.keyed && !(puzzle.unlocked ?? []).includes(j));
        if (opIndex < 0) return text('Nothing on this sector needs a key.');
        const action = { type: 'PUZZLE_ENTER_KEY', puzzleId: puzzle.id, opIndex, mask: toHex(value) };
        const denied = internActionError(state, { ...action, actor: 'intern' });
        if (denied) return text(denied);
        const res = await link.dispatch(action);
        if (!res.ok) return text(`The game refused: ${res.error}`);
        const unlocked = (link.state.puzzles[puzzle.id].unlocked ?? []).includes(opIndex);
        return text(unlocked ? `Key accepted. ${view.puzzleView(link.state, link.state.puzzles[puzzle.id]).ops[opIndex].label} is unlocked for both of you.` : `KEY REJECTED: ${toHex(value)} is not it.`);
      }),
    },
    {
      name: 'message_player',
      title: 'Message the sysadmin',
      description: `Send a chat message to the sysadmin's INTERN.EXE window (max ${MESSAGE_MAX} characters). This is the only way they hear you.`,
      inputSchema: { text: z.string().min(1).max(MESSAGE_MAX).describe('What to say') },
      handler: withGame(async (state, { text: body }) => {
        const res = await link.dispatch({ type: 'CHAT_SEND', text: body });
        return res.ok ? text('Sent.') : text(`Not sent: ${res.error}`);
      }),
    },
    {
      name: 'read_messages',
      title: 'Read messages from the sysadmin',
      description: 'Read new messages the sysadmin typed into INTERN.EXE since you last checked. Pass all=true for recent history including your own and SYSTEM lines.',
      inputSchema: { all: z.boolean().optional() },
      handler: withGame(async (state, { all }) => {
        if (all) {
          takeUnread(state);
          const recent = view.chat(state).slice(-30);
          return text(recent.length ? formatMessages(recent) : 'No messages yet.');
        }
        const unread = takeUnread(state);
        return text(unread.length ? formatMessages(unread) : 'No new messages from the sysadmin.');
      }),
    },
    {
      name: 'wait_for_player',
      title: 'Wait for the sysadmin',
      description: `Wait up to timeoutSeconds (max ${WAIT_MAX_SECONDS}) for the sysadmin to send a message, then return it.`,
      inputSchema: { timeoutSeconds: z.number().int().min(1).max(WAIT_MAX_SECONDS).optional().describe('Default 60') },
      handler: withGame(async (state, { timeoutSeconds = 60 }) => {
        const now = takeUnread(state);
        if (now.length) return text(formatMessages(now));
        const got = await new Promise((resolve) => {
          const done = (value) => {
            clearTimeout(timer);
            link.off('state', onState);
            link.off('disconnected', onGone);
            resolve(value);
          };
          const onState = (s) => {
            if (unreadPlayerMessages(s).length) done(takeUnread(s));
          };
          const onGone = () => done(null);
          const timer = setTimeout(() => done([]), timeoutSeconds * 1000);
          link.on('state', onState);
          link.on('disconnected', onGone);
        });
        if (got === null) return text(notConnectedText(port));
        return text(got.length ? formatMessages(got) : `Nothing from the sysadmin in ${timeoutSeconds}s.`);
      }),
    },
  ];
};
