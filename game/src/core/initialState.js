// Builds the starting state from plain data (data/files.json + data/puzzles.json).
// The result is pure JSON: safe to serialise, save, send over a socket, and hydrate.
import { normalisePuzzle } from '../logic/puzzle.js';
import { START_LEVEL } from './permissions.js';

export const STATE_VERSION = 2;
export const SHIFT_LENGTH = 8 * 60;

const ICON_W = 88;
const ICON_H = 84;
const DESKTOP_ROWS = 6;

const textOf = (content) => (Array.isArray(content) ? content.join('\n') : content ?? '');

export const createInitialState = ({ files = [], puzzles = [] } = {}) => {
  const fileMap = {
    desktop: { id: 'desktop', name: 'DESKTOP', type: 'folder', parent: null, locked: false },
  };
  for (const f of files) {
    fileMap[f.id] = {
      id: f.id,
      name: f.name,
      type: f.type ?? 'text',
      parent: f.parent ?? 'desktop',
      locked: Boolean(f.locked),
      puzzleId: f.puzzleId ?? null,
      renameUnlock: f.renameUnlock ?? null,
      lockedMessage: f.lockedMessage ?? null,
      hidden: Boolean(f.hidden),
      minLevel: f.minLevel ?? 0,
      app: f.app ?? null,
      content: textOf(f.content),
    };
  }

  const positions = {};
  files
    .filter((f) => (f.parent ?? 'desktop') === 'desktop' && !f.hidden)
    .forEach((f, i) => {
      positions[f.id] = f.pos ?? { x: 12 + Math.floor(i / DESKTOP_ROWS) * ICON_W, y: 12 + (i % DESKTOP_ROWS) * ICON_H };
    });

  const puzzleMap = {};
  for (const p of puzzles) {
    const def = normalisePuzzle(p);
    puzzleMap[def.id] = { ...def, value: def.start, history: [], unlocked: [], solved: false, failed: false };
  }

  return {
    version: STATE_VERSION,
    phase: 'boot',
    clock: { elapsed: 0, length: SHIFT_LENGTH },
    files: fileMap,
    desktop: { positions },
    selection: { folderId: null, ids: [], anchorId: null },
    windows: [],
    nextWindowId: 1,
    nextZ: 1,
    focusedWindowId: null,
    puzzles: puzzleMap,
    alert: null,
    flags: {},
    log: [],
    // Intern #0118: permission level and the INTERN.EXE chat. pester counts drive the scripted fallback.
    intern: { level: START_LEVEL, messages: [], nextMsgId: 1, playerReadId: 0, pester: {}, lastTopic: null, heardTargets: [] },
  };
};
