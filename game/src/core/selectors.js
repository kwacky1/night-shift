// Pure read helpers over the state object. Shared by the UI and (later) the MCP bridge.

export const SHIFT_START = 22 * 60;

export const clockMinutes = (state) => (SHIFT_START + state.clock.elapsed) % (24 * 60);

export const formatClock = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export const clockLabel = (state) => formatClock(clockMinutes(state));

const byTypeThenName = (a, b) =>
  (a.type === 'folder' ? 0 : 1) - (b.type === 'folder' ? 0 : 1) || a.name.localeCompare(b.name);

// Children in display order. Desktop order follows icon layout (column by column),
// so Shift+click ranges on the desktop match what the player sees. Hidden (system) files are
// invisible to the player; only the intern's projection includes them. Dormant files are not on
// the drive yet for anyone.
export const childrenOf = (state, folderId, { includeHidden = false } = {}) => {
  const kids = Object.values(state.files).filter((f) => f.parent === folderId && !f.dormant && (includeHidden || !f.hidden));
  if (folderId === 'desktop') {
    const pos = state.desktop.positions;
    return kids.sort((a, b) => (pos[a.id]?.x ?? 0) - (pos[b.id]?.x ?? 0) || (pos[a.id]?.y ?? 0) - (pos[b.id]?.y ?? 0));
  }
  return kids.sort(byTypeThenName);
};

// Puzzles whose file is on the drive (not dormant). Story beats reveal the rest.
export const livePuzzles = (state) => {
  const live = new Set(Object.values(state.files ?? {}).filter((f) => f.puzzleId && !f.dormant).map((f) => f.puzzleId));
  return Object.values(state.puzzles ?? {}).filter((p) => live.has(p.id));
};

export const pathOf = (state, id) => {
  const parts = [];
  for (let f = state.files[id]; f; f = state.files[f.parent]) parts.unshift(f.id === 'desktop' ? 'C:' : f.name);
  return parts.join('\\');
};

export const isSelected = (state, id) => state.selection.ids.includes(id);

export const topWindow = (state) =>
  state.windows.filter((w) => !w.minimised).reduce((top, w) => (!top || w.z > top.z ? w : top), null);

export const windowForFile = (state, fileId, kind) =>
  state.windows.find((w) => w.fileId === fileId && (!kind || w.kind === kind));

export const chatMessages = (state) => state.intern?.messages ?? [];

// Intern/system messages the player has not seen in INTERN.EXE yet.
export const unreadForPlayer = (state) =>
  chatMessages(state).filter((m) => m.from !== 'player' && m.id > (state.intern?.playerReadId ?? 0)).length;
