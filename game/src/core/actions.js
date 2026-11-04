// The public action API. Everything that changes game state goes through dispatch(action),
// so the week 2 MCP bridge can drive the game with exactly the same vocabulary as the UI.

export const ActionTypes = Object.freeze({
  HYDRATE: 'HYDRATE',
  BOOT_COMPLETE: 'BOOT_COMPLETE',
  CLOCK_IN: 'CLOCK_IN',
  TICK: 'TICK',
  OPEN_FILE: 'OPEN_FILE',
  WINDOW_CLOSE: 'WINDOW_CLOSE',
  WINDOW_FOCUS: 'WINDOW_FOCUS',
  WINDOW_MOVE: 'WINDOW_MOVE',
  WINDOW_MINIMISE: 'WINDOW_MINIMISE',
  SELECT_FILE: 'SELECT_FILE',
  SELECT_SET: 'SELECT_SET',
  MOVE_ICONS: 'MOVE_ICONS',
  RENAME_FILE: 'RENAME_FILE',
  PUZZLE_APPLY_OP: 'PUZZLE_APPLY_OP',
  PUZZLE_UNDO: 'PUZZLE_UNDO',
  PUZZLE_RESET: 'PUZZLE_RESET',
  PUZZLE_ENTER_KEY: 'PUZZLE_ENTER_KEY',
  CHAT_SEND: 'CHAT_SEND',
  CHAT_READ: 'CHAT_READ',
  DISMISS_ALERT: 'DISMISS_ALERT',
});

export const ACTION_TYPE_LIST = Object.freeze(Object.values(ActionTypes));

const T = ActionTypes;

export const actions = Object.freeze({
  hydrate: (state) => ({ type: T.HYDRATE, state }),
  bootComplete: () => ({ type: T.BOOT_COMPLETE }),
  clockIn: () => ({ type: T.CLOCK_IN }),
  tick: (minutes = 1) => ({ type: T.TICK, minutes }),
  openFile: (id) => ({ type: T.OPEN_FILE, id }),
  closeWindow: (id) => ({ type: T.WINDOW_CLOSE, id }),
  focusWindow: (id) => ({ type: T.WINDOW_FOCUS, id }),
  moveWindow: (id, x, y) => ({ type: T.WINDOW_MOVE, id, x, y }),
  minimiseWindow: (id) => ({ type: T.WINDOW_MINIMISE, id }),
  selectFile: (folderId, id, { shift = false, ctrl = false } = {}) => ({ type: T.SELECT_FILE, folderId, id, shift, ctrl }),
  selectSet: (folderId, ids) => ({ type: T.SELECT_SET, folderId, ids }),
  moveIcons: (ids, dx, dy) => ({ type: T.MOVE_ICONS, ids, dx, dy }),
  renameFile: (id, name) => ({ type: T.RENAME_FILE, id, name }),
  applyOp: (puzzleId, opIndex) => ({ type: T.PUZZLE_APPLY_OP, puzzleId, opIndex }),
  undo: (puzzleId) => ({ type: T.PUZZLE_UNDO, puzzleId }),
  resetPuzzle: (puzzleId) => ({ type: T.PUZZLE_RESET, puzzleId }),
  enterKey: (puzzleId, opIndex, mask) => ({ type: T.PUZZLE_ENTER_KEY, puzzleId, opIndex, mask }),
  // from: 'player' | 'intern'. The scripted fallback intern passes { scripted: true, topic }.
  chatSend: (text, from = 'player', extra = {}) => ({ type: T.CHAT_SEND, text, from, ...extra }),
  chatRead: () => ({ type: T.CHAT_READ }),
  dismissAlert: () => ({ type: T.DISMISS_ALERT }),
});
