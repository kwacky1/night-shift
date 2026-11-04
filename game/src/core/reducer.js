// Pure root reducer: (state, action) => newState. No DOM, no timers, no storage.
// Uses structural sharing so the UI can cheaply tell which slices changed.
import { ActionTypes as T } from './actions.js';
import { childrenOf, clockMinutes, formatClock, windowForFile } from './selectors.js';
import { applyOp, isSolved, opLabel } from '../logic/puzzle.js';
import { toHex } from '../logic/bits.js';

const LOG_LIMIT = 100;
const WINDOW_SIZES = {
  explorer: { w: 440, h: 300 },
  viewer: { w: 600, h: 380 },
  bitrot: { w: 500, h: 380 },
};

// 8.3 filenames, DOS style. Stored upper case.
export const FILENAME_PATTERN = /^[A-Z0-9_~!-]{1,8}(\.[A-Z0-9_~!-]{1,3})?$/;

const log = (state, text) => ({
  ...state,
  log: [...state.log, { at: formatClock(clockMinutes(state)), text }].slice(-LOG_LIMIT),
});

const alert = (state, title, text) => ({ ...state, alert: { title, text } });

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
  const size = WINDOW_SIZES[kind] ?? { w: 400, h: 300 };
  const win = { id, kind, fileId, x: 140 + offset * 28, y: 40 + offset * 24, ...size, z: state.nextZ, minimised: false };
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
  if (file.type === 'folder') return openWindow(state, 'explorer', id);
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

const applyPuzzleOp = (state, { puzzleId, opIndex }) => {
  const p = state.puzzles[puzzleId];
  const op = p?.ops[opIndex];
  if (!p || !op || p.solved || p.failed) return state;
  const value = applyOp(p.value, op);
  const history = [...p.history, p.value];
  const solved = isSolved(value, p);
  const failed = !solved && history.length >= p.moveLimit;
  let s = updatePuzzle(state, puzzleId, { value, history, solved, failed });
  if (solved) {
    const unlocked = Object.values(s.files).filter((f) => f.puzzleId === puzzleId);
    for (const f of unlocked) s = updateFile(s, f.id, { locked: false });
    s = log(s, `Bit Rot cleared: ${unlocked.map((f) => f.name).join(', ') || puzzleId} recovered in ${history.length} moves.`);
  } else if (failed) {
    s = log(s, `${opLabel(op)} -> ${toHex(value)}. Out of moves. SECTOR LOST.`);
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
      return state.phase === 'clockin' ? log({ ...state, phase: 'desktop' }, 'Badge 0117 clocked in. Night shift started.') : state;

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

    case T.DISMISS_ALERT:
      return state.alert ? { ...state, alert: null } : state;

    default:
      return state;
  }
};
