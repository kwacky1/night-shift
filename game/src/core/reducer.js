// Pure root reducer: (state, action) => newState. No DOM, no timers, no storage.
// Uses structural sharing so the UI can cheaply tell which slices changed.
import { ActionTypes as T } from './actions.js';
import { childrenOf, clockMinutes, formatClock, windowForFile } from './selectors.js';
import { applyOp, isSolved, opLabel } from '../logic/puzzle.js';
import { toHex, toWord } from '../logic/bits.js';
import { parseKey } from '../logic/words.js';
import { clampLevel, internActionError, internLevel, isOpUnlocked, levelInfo } from './permissions.js';

const LOG_LIMIT = 100;
const MESSAGE_LIMIT = 200;
export const MESSAGE_MAX_LENGTH = 280;
const WINDOW_SIZES = {
  explorer: { w: 440, h: 300 },
  viewer: { w: 600, h: 380 },
  bitrot: { w: 500, h: 420 },
  intern: { w: 380, h: 420, x: 680, y: 40 },
};

// 8.3 filenames, DOS style. Stored upper case.
export const FILENAME_PATTERN = /^[A-Z0-9_~!-]{1,8}(\.[A-Z0-9_~!-]{1,3})?$/;

const log = (state, text) => ({
  ...state,
  log: [...state.log, { at: formatClock(clockMinutes(state)), text }].slice(-LOG_LIMIT),
});

const alert = (state, title, text) => ({ ...state, alert: { title, text } });

// Append a line to the INTERN.EXE chat. from: 'player' | 'intern' | 'system'.
const post = (state, from, text, extra = {}) => {
  const intern = state.intern;
  const msg = { id: intern.nextMsgId, from, at: formatClock(clockMinutes(state)), text, ...extra };
  return {
    ...state,
    intern: { ...intern, messages: [...intern.messages, msg].slice(-MESSAGE_LIMIT), nextMsgId: intern.nextMsgId + 1 },
  };
};

const setInternLevel = (state, level, message) => {
  const next = clampLevel(level);
  if (next <= internLevel(state)) return state;
  const name = levelInfo(next).name;
  const s = log({ ...state, intern: { ...state.intern, level: next } }, `Intern #0118 promoted to ${name}.`);
  return post(s, 'system', message ?? `Head Office: intern #0118 is now ${name}. ${levelInfo(next).summary}`);
};

const updateFile = (state, id, patch) => ({ ...state, files: { ...state.files, [id]: { ...state.files[id], ...patch } } });

const updatePuzzle = (state, id, patch) => ({ ...state, puzzles: { ...state.puzzles, [id]: { ...state.puzzles[id], ...patch } } });

const focus = (state, id) => ({
  ...state,
  windows: state.windows.map((w) => (w.id === id ? { ...w, z: state.nextZ, minimised: false } : w)),
  nextZ: state.nextZ + 1,
  focusedWindowId: id,
});

const openWindow = (state, kind, fileId) => {
  const existing = windowForFile(state, fileId, kind);
  if (existing) return focus(state, existing.id);
  const id = `w${state.nextWindowId}`;
  const offset = (state.nextWindowId - 1) % 8;
  const { x = 140 + offset * 28, y = 40 + offset * 24, ...size } = WINDOW_SIZES[kind] ?? { w: 400, h: 300 };
  const win = { id, kind, fileId, x, y, ...size, z: state.nextZ, minimised: false };
  return {
    ...state,
    windows: [...state.windows, win],
    nextWindowId: state.nextWindowId + 1,
    nextZ: state.nextZ + 1,
    focusedWindowId: id,
  };
};

const openFile = (state, id) => {
  const file = state.files[id];
  if (!file) return state;
  if (file.hidden) return alert(state, 'Open', `Cannot find '${id}'. Make sure the path and file name are correct.`);
  if (file.type === 'folder') return openWindow(state, 'explorer', id);
  if (file.type === 'app' && file.app && WINDOW_SIZES[file.app]) return openWindow(state, file.app, id);
  if (file.locked && file.puzzleId && state.puzzles[file.puzzleId]) {
    const s = openWindow(state, 'bitrot', id);
    return s.flags[`seen:${id}`] ? s : log({ ...s, flags: { ...s.flags, [`seen:${id}`]: true } }, `${file.name} is corrupted. Bit Rot detected.`);
  }
  if (file.locked) return alert(state, file.name, file.lockedMessage ?? `${file.name} cannot be opened.`);
  return openWindow(state, 'viewer', id);
};

const sameSelection = (a, b) =>
  a.folderId === b.folderId && a.anchorId === b.anchorId && a.ids.length === b.ids.length && a.ids.every((id, i) => id === b.ids[i]);

const withSelection = (state, selection) => (sameSelection(state.selection, selection) ? state : { ...state, selection });

const selectFile = (state, { folderId, id, shift, ctrl }) => {
  const sel = state.selection;
  if (id == null) return withSelection(state, { folderId, ids: [], anchorId: null });
  if (!state.files[id] || state.files[id].parent !== folderId) return state;
  const sameFolder = sel.folderId === folderId;
  if (shift && sameFolder && sel.anchorId) {
    const order = childrenOf(state, folderId).map((f) => f.id);
    const a = order.indexOf(sel.anchorId);
    const b = order.indexOf(id);
    const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
    const ids = ctrl ? [...new Set([...sel.ids, ...range])] : range;
    return withSelection(state, { folderId, ids, anchorId: sel.anchorId });
  }
  if (ctrl && sameFolder) {
    const ids = sel.ids.includes(id) ? sel.ids.filter((x) => x !== id) : [...sel.ids, id];
    return withSelection(state, { folderId, ids, anchorId: id });
  }
  return withSelection(state, { folderId, ids: [id], anchorId: id });
};

const renameFile = (state, { id, name }) => {
  const file = state.files[id];
  if (!file || id === 'desktop') return state;
  const newName = String(name ?? '').trim().toUpperCase();
  if (newName === file.name) return state;
  if (!FILENAME_PATTERN.test(newName))
    return alert(state, 'Rename', `"${newName}" is not a valid file name.\nUse up to 8 characters, a dot, and up to 3 more.`);
  const clash = Object.values(state.files).some((f) => f.parent === file.parent && f.id !== id && f.name === newName);
  if (clash) return alert(state, 'Rename', `A file named ${newName} already exists here.`);
  let s = log(updateFile(state, id, { name: newName }), `Renamed ${file.name} to ${newName}.`);
  if (file.locked && !file.puzzleId && file.renameUnlock && newName === file.renameUnlock) {
    s = log(updateFile(s, id, { locked: false }), `${newName} restored.`);
  }
  return s;
};

const applyPuzzleOp = (state, action) => {
  const { puzzleId, opIndex } = action;
  const p = state.puzzles[puzzleId];
  const op = p?.ops[opIndex];
  if (!p || !op || p.solved || p.failed || !isOpUnlocked(p, opIndex)) return state;
  const byIntern = action.actor === 'intern';
  if (byIntern && internActionError(state, action)) return state;
  const value = applyOp(p.value, op);
  const history = [...p.history, p.value];
  const solved = isSolved(value, p);
  const failed = !solved && history.length >= p.moveLimit;
  let s = updatePuzzle(state, puzzleId, { value, history, solved, failed });
  const fileNames = Object.values(s.files).filter((f) => f.puzzleId === puzzleId);
  if (byIntern) s = post(s, 'system', `#0118 applied ${opLabel(op)} to ${fileNames.map((f) => f.name).join(', ') || puzzleId}.`);
  if (solved) {
    for (const f of fileNames) s = updateFile(s, f.id, { locked: false });
    s = log(s, `Bit Rot cleared: ${fileNames.map((f) => f.name).join(', ') || puzzleId} recovered in ${history.length} moves.`);
    if (p.onSolve?.internLevel !== undefined) s = setInternLevel(s, p.onSolve.internLevel, p.onSolve.message);
  } else if (failed) {
    s = log(s, `${opLabel(op)} -> ${toHex(value)}. Out of moves. SECTOR LOST.`);
  }
  return s;
};

const enterKey = (state, action) => {
  const p = state.puzzles[action.puzzleId];
  const op = p?.ops[action.opIndex];
  if (!p || !op?.keyed || p.solved || isOpUnlocked(p, action.opIndex)) return state;
  if (action.actor === 'intern' && internActionError(state, action)) return state;
  const who = action.actor === 'intern' ? '#0118' : 'Sysadmin';
  const mask = parseKey(action.mask);
  if (!Number.isInteger(mask) || toWord(mask) !== op.mask) {
    const s = log(state, `${who} entered a bad key for ${p.id}.`);
    return action.actor === 'intern' ? s : alert(s, 'BITROT.EXE', 'KEY REJECTED.\n\nThat is not the override key for this sector.');
  }
  let s = updatePuzzle(state, p.id, { unlocked: [...(p.unlocked ?? []), action.opIndex] });
  s = log(s, `${who} entered the override key for ${p.id}.`);
  return post(s, 'system', `Override key accepted for ${p.title ?? p.id}. ${opLabel(op)} unlocked.`);
};

const chatSend = (state, action) => {
  const text = String(action.text ?? '').replace(/\s+/g, ' ').trim().slice(0, MESSAGE_MAX_LENGTH);
  if (!text) return state;
  const from = action.actor === 'intern' || action.from === 'intern' ? 'intern' : 'player';
  const extra = {};
  if (from === 'intern' && action.actor !== 'intern' && action.scripted) {
    extra.scripted = true;
  }
  let s = post(state, from, text, extra);
  if (extra.scripted && typeof action.thread === 'string' && /^[a-z0-9_-]{1,32}$/i.test(action.thread)) {
    s = { ...s, intern: { ...s.intern, lastTopic: action.thread } };
  }
  const heard = s.intern.heardTargets ?? [];
  if (extra.scripted && typeof action.heardTarget === 'string' && s.puzzles[action.heardTarget] && !heard.includes(action.heardTarget)) {
    s = { ...s, intern: { ...s.intern, heardTargets: [...heard, action.heardTarget] } };
  }
  if (extra.scripted && typeof action.topic === 'string') {
    const pester = { ...s.intern.pester, [action.topic]: (s.intern.pester[action.topic] ?? 0) + 1 };
    s = { ...s, intern: { ...s.intern, pester } };
  }
  return s;
};

export const reducer = (state, action) => {
  switch (action?.type) {
    case T.HYDRATE:
      return action.state;

    case T.BOOT_COMPLETE:
      return state.phase === 'boot' ? { ...state, phase: 'clockin' } : state;

    case T.CLOCK_IN:
      return state.phase === 'clockin'
        ? post(log({ ...state, phase: 'desktop' }, 'Badge 0117 clocked in. Night shift started.'), 'system', 'Intern #0118 has joined the night shift.')
        : state;

    case T.TICK: {
      if (state.phase !== 'desktop' || state.flags.shiftOver) return state;
      const elapsed = Math.min(state.clock.length, state.clock.elapsed + Math.max(0, action.minutes ?? 1));
      let s = { ...state, clock: { ...state.clock, elapsed } };
      if (elapsed >= state.clock.length) {
        s = alert(log({ ...s, flags: { ...s.flags, shiftOver: true } }, 'Shift over.'), 'SHIFT OVER', '06:00. The day crew will be in soon.\nThat is the end of this build.');
      }
      return s;
    }

    case T.OPEN_FILE:
      return openFile(state, action.id);

    case T.WINDOW_CLOSE: {
      if (!state.windows.some((w) => w.id === action.id)) return state;
      const windows = state.windows.filter((w) => w.id !== action.id);
      const top = windows.filter((w) => !w.minimised).sort((a, b) => b.z - a.z)[0];
      return { ...state, windows, focusedWindowId: top?.id ?? null };
    }

    case T.WINDOW_FOCUS:
      return state.windows.some((w) => w.id === action.id) ? focus(state, action.id) : state;

    case T.WINDOW_MOVE:
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.id === action.id ? { ...w, x: Math.max(0, Math.round(action.x)), y: Math.max(0, Math.round(action.y)) } : w,
        ),
      };

    case T.WINDOW_MINIMISE: {
      if (!state.windows.some((w) => w.id === action.id)) return state;
      const windows = state.windows.map((w) => (w.id === action.id ? { ...w, minimised: true } : w));
      const top = windows.filter((w) => !w.minimised).sort((a, b) => b.z - a.z)[0];
      return { ...state, windows, focusedWindowId: top?.id ?? null };
    }

    case T.SELECT_FILE:
      return selectFile(state, action);

    case T.SELECT_SET: {
      const ids = (action.ids ?? []).filter((id) => state.files[id]?.parent === action.folderId);
      return withSelection(state, { folderId: action.folderId, ids, anchorId: ids[0] ?? null });
    }

    case T.MOVE_ICONS: {
      const positions = { ...state.desktop.positions };
      for (const id of action.ids ?? []) {
        const p = positions[id];
        if (p) positions[id] = { x: Math.max(0, Math.round(p.x + action.dx)), y: Math.max(0, Math.round(p.y + action.dy)) };
      }
      return { ...state, desktop: { ...state.desktop, positions } };
    }

    case T.RENAME_FILE:
      return renameFile(state, action);

    case T.PUZZLE_APPLY_OP:
      return applyPuzzleOp(state, action);

    case T.PUZZLE_UNDO: {
      const p = state.puzzles[action.puzzleId];
      if (!p || p.solved || p.history.length === 0) return state;
      return updatePuzzle(state, p.id, { value: p.history.at(-1), history: p.history.slice(0, -1), failed: false });
    }

    case T.PUZZLE_RESET: {
      const p = state.puzzles[action.puzzleId];
      if (!p || p.solved) return state;
      return updatePuzzle(state, p.id, { value: p.start, history: [], failed: false });
    }

    case T.PUZZLE_ENTER_KEY:
      return enterKey(state, action);

    case T.CHAT_SEND:
      return chatSend(state, action);

    case T.CHAT_READ: {
      const last = state.intern.nextMsgId - 1;
      return state.intern.playerReadId === last ? state : { ...state, intern: { ...state.intern, playerReadId: last } };
    }

    case T.DISMISS_ALERT:
      return state.alert ? { ...state, alert: null } : state;

    default:
      return state;
  }
};
