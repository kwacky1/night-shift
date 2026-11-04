// The scripted fallback intern, for players without an MCP agent. Pure: given the game state,
// the player's message and the script (data/intern.json), pick a reply. Deliberately unhelpful,
// but every topic escalates with each ask, so the key eventually leaks (grudgingly).
import { internLevel } from '../core/permissions.js';
import { hexInWords } from '../logic/words.js';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const matches = (text, keyword) => {
  const k = keyword.toLowerCase();
  // Word boundaries only make sense around word characters.
  const pre = /^\w/.test(k) ? '\\b' : '';
  const post = /\w$/.test(k) ? '\\b' : '';
  return new RegExp(`${pre}${escapeRe(k)}${post}`).test(text);
};

export const topicFor = (script, text) => {
  const lower = String(text ?? '').toLowerCase();
  return script.topics.find((t) => t.keywords.some((k) => matches(lower, k))) ?? script.topics.find((t) => t.id === 'default');
};

const keyedMask = (state, puzzleId) => state.puzzles[puzzleId]?.ops.find((op) => op.keyed)?.mask;

const fill = (line, state, topic) =>
  line.replace(/\{\{key\}\}/g, () => {
    const mask = topic.leaks ? keyedMask(state, topic.leaks.puzzle) : undefined;
    return mask === undefined ? 'something I have forgotten' : hexInWords(mask);
  });

const pick = (lines, count, cycle) => lines[cycle ? count % lines.length : Math.min(count, lines.length - 1)];

// Returns { text, topic } where topic is the pester counter to bump when the reply is posted.
export const fallbackReply = (state, text, script) => {
  const topic = topicFor(script, text);
  const pester = state.intern?.pester ?? {};
  if (topic.leaks && state.puzzles[topic.leaks.puzzle]?.solved && topic.doneLine) {
    return { text: topic.doneLine, topic: `${topic.id}:done` };
  }
  if (topic.requiresLevel !== undefined && internLevel(state) < topic.requiresLevel) {
    const key = `${topic.id}:locked`;
    return { text: fill(pick(topic.lockedLines, pester[key] ?? 0, true), state, topic), topic: key };
  }
  return { text: fill(pick(topic.lines, pester[topic.id] ?? 0, topic.cycle), state, topic), topic: topic.id };
};

// Returns a list of problems with the script; empty means it is well formed.
export const validateScript = (script) => {
  const errors = [];
  if (!Array.isArray(script?.topics)) return ['topics must be an array'];
  const ids = new Set();
  for (const t of script.topics) {
    if (!t.id || ids.has(t.id)) errors.push(`bad or duplicate topic id: ${t.id}`);
    ids.add(t.id);
    if (!Array.isArray(t.keywords)) errors.push(`${t.id}: keywords must be an array`);
    if (!Array.isArray(t.lines) || t.lines.length === 0) errors.push(`${t.id}: needs at least one line`);
    if (t.requiresLevel !== undefined && !(Array.isArray(t.lockedLines) && t.lockedLines.length)) errors.push(`${t.id}: requiresLevel needs lockedLines`);
    if (t.leaks && !t.lines.at(-1).includes('{{key}}')) errors.push(`${t.id}: last line must leak {{key}}`);
  }
  if (!ids.has('default')) errors.push('missing default topic');
  return errors;
};
