// Builds the starting state from plain data (data/files.json, puzzles.json, night.json, story.json).
// The result is pure JSON: safe to serialise, save, send over a socket, and hydrate.
import { normalisePuzzle } from '../logic/puzzle.js';
import { START_LEVEL } from './permissions.js';
import { createPower } from './power.js';

export const STATE_VERSION = 4;
export const SHIFT_LENGTH = 8 * 60;
export const DEFAULT_MS_PER_MINUTE = 2000;

const ICON_W = 88;
const ICON_H = 84;
const DESKTOP_ROWS = 6;

// Desktop icon slots fill column by column.
export const gridSlot = (i) => ({ x: 12 + Math.floor(i / DESKTOP_ROWS) * ICON_W, y: 12 + (i % DESKTOP_ROWS) * ICON_H });

const textOf = (content) => (Array.isArray(content) ? content.join('\n') : content ?? '');

export const createStats = () => ({ internOps: 0, internKeys: 0, internMessages: 0, scriptedReplies: 0, scriptedOps: 0, playerOps: 0, distance: 0, stalls: 0, charged: 0 });

// A puzzle's live progress. by[i] is who applied move i ('player' | 'intern'); noop is the last
// op that changed nothing (the board flashes NO CHANGE when its seq goes up).
export const freshProgress = (def) => ({ value: def.start, history: [], by: [], unlocked: [], solved: false, failed: false, solvedBy: null, noop: null });

export const createInitialState = ({ files = [], puzzles = [], night = {}, story = {} } = {}) => {
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
      // Dormant files are not on the drive yet (for anyone). A story beat reveals them.
      dormant: Boolean(f.dormant),
      minLevel: f.minLevel ?? 0,
      app: f.app ?? null,
      content: textOf(f.content),
    };
  }

  const positions = {};
  files
    .filter((f) => (f.parent ?? 'desktop') === 'desktop' && !f.hidden && !f.dormant)
    .forEach((f, i) => {
      positions[f.id] = f.pos ?? gridSlot(i);
    });

  const puzzleMap = {};
  for (const p of puzzles) {
    const def = normalisePuzzle(p);
    puzzleMap[def.id] = { ...def, ...freshProgress(def) };
  }

  return {
    version: STATE_VERSION,
    phase: 'boot',
    shiftNumber: 1,
    clock: { elapsed: 0, length: SHIFT_LENGTH, msPerMinute: night.msPerMinute ?? DEFAULT_MS_PER_MINUTE },
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
    // Mainframe power: drained by the clock, recharged by driving GEARGRIND.EXE.
    power: createPower(night.power),
    // Story beats (data/story.json) and which have fired. The intern's projection never sees these.
    story: { beats: structuredClone(story.beats ?? []), fired: [] },
    stats: createStats(),
    shiftEnd: null,
  };
};
