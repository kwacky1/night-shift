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

// WAIT FOR THE AUDIT: once every sector is recovered the sysadmin can park the generator and run
// the clock at FAST_FORWARD x until 06:00. One way: there is no un-wait.
export const FAST_FORWARD = 8;
export const allSectorsRecovered = (state) => {
  const all = Object.values(state.puzzles ?? {});
  return all.length > 0 && all.every((p) => p.solved);
};
export const canWaitForAudit = (state) =>
  state.phase === 'desktop' && !state.blame?.open && !state.clock?.waiting && state.clock.elapsed < state.clock.length && allSectorsRecovered(state);
export const isWaitingForAudit = (state) => state.phase === 'desktop' && Boolean(state.clock?.waiting) && !state.blame?.open;
// Real milliseconds per game minute right now.
export const tickMs = (state, fallback = 2000) => (state.clock?.msPerMinute || fallback) / (isWaitingForAudit(state) ? FAST_FORWARD : 1);

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
