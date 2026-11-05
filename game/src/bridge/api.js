// The game side of the intern bridge.
//
// 1. window.NIGHT_SHIFT exposes the same store API the UI uses (handy from DevTools too).
// 2. connectIntern() opens an optional WebSocket to the local MCP server (`npx night-shift-mcp`).
//    It is used when the page is loaded with ?intern=ws://localhost:PORT or when the player dials
//    in from INTERN.EXE. Only localhost URLs are accepted. Protocol (JSON messages, protocol 2):
//      game -> bridge  { type: 'hello', protocol, version, state }
//      game -> bridge  { type: 'state', action: '<ACTION_TYPE>', state }   after every state change
//                      (TICK and DRIVE_REPORT are coalesced to about one a second)
//      bridge -> game  { type: 'dispatch', id, action }                     ask the game to run an action
//      game -> bridge  { type: 'result', id, ok, error? }
//    The game is authoritative. The bridge projects state per role (the intern sees a different
//    view than the player) and can only ask for the few actions in REMOTE_ACTIONS. Every remote
//    action is rebuilt field by field and stamped actor: 'intern', so the reducer applies intern
//    permissions no matter what the bridge sends.
import { actions, ActionTypes } from '../core/actions.js';
import * as selectors from '../core/selectors.js';
import { internActionError } from '../core/permissions.js';

export const PROTOCOL_VERSION = 2;
const MAX_INBOUND_CHARS = 8 * 1024;
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 10000;
// Close codes from the bridge that mean "stop retrying". 4000 = another game window took the line.
const FINAL_CLOSE_CODES = new Set([4000, 4003]);
export const LINE_TAKEN_CODE = 4000;
// A quiet (automatic, on page load) dial gives up after this many failed attempts.
export const QUIET_ATTEMPTS = 4;
// Actions that fire constantly. Their state updates to the bridge are coalesced (at most one a second).
export const NOISY_ACTIONS = new Set([ActionTypes.TICK, ActionTypes.DRIVE_REPORT]);
const COALESCE_MS = 1000;

const isId = (v) => typeof v === 'string' && /^[a-z0-9_-]{1,32}$/i.test(v);
const isIndex = (v) => Number.isInteger(v) && v >= 0 && v < 16;

// Allowlist of remote actions. Each entry rebuilds a clean action from untrusted input or throws.
const REMOTE_ACTIONS = {
  [ActionTypes.PUZZLE_APPLY_OP]: (a) => {
    if (!isId(a.puzzleId) || !isIndex(a.opIndex)) throw new Error('Bad PUZZLE_APPLY_OP');
    return { type: ActionTypes.PUZZLE_APPLY_OP, puzzleId: a.puzzleId, opIndex: a.opIndex };
  },
  [ActionTypes.PUZZLE_ENTER_KEY]: (a) => {
    if (!isId(a.puzzleId) || !isIndex(a.opIndex) || typeof a.mask !== 'string' || a.mask.length > 64) throw new Error('Bad PUZZLE_ENTER_KEY');
    return { type: ActionTypes.PUZZLE_ENTER_KEY, puzzleId: a.puzzleId, opIndex: a.opIndex, mask: a.mask };
  },
  [ActionTypes.CHAT_SEND]: (a) => {
    if (typeof a.text !== 'string' || !a.text.trim()) throw new Error('Bad CHAT_SEND');
    return { type: ActionTypes.CHAT_SEND, from: 'intern', text: a.text.slice(0, 1000) };
  },
};

export const REMOTE_ACTION_TYPES = Object.freeze(Object.keys(REMOTE_ACTIONS));

export const sanitiseRemoteAction = (action) => {
  if (!action || typeof action !== 'object' || Array.isArray(action)) throw new Error('Action must be an object');
  const build = Object.hasOwn(REMOTE_ACTIONS, action.type) ? REMOTE_ACTIONS[action.type] : null;
  if (!build) throw new Error(`${String(action.type).slice(0, 40)} is not allowed remotely`);
  return { ...build(action), actor: 'intern' };
};

// Handles one inbound message. Returns the reply to send (or null). Never throws.
export const handleBridgeMessage = (store, raw) => {
  if (typeof raw === 'string' && raw.length > MAX_INBOUND_CHARS) return null;
  let msg;
  try {
    msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (msg?.type !== 'dispatch') return null;
  const id = typeof msg.id === 'string' || Number.isInteger(msg.id) ? msg.id : null;
  if (id === null) return null;
  try {
    const action = sanitiseRemoteAction(msg.action);
    const denied = internActionError(store.getState(), action);
    if (denied) throw new Error(denied);
    store.dispatch(action);
    return { type: 'result', id, ok: true };
  } catch (err) {
    return { type: 'result', id, ok: false, error: err.message };
  }
};

export const exposeApi = (store) => {
  const api = Object.freeze({
    getState: store.getState,
    dispatch: store.dispatch,
    subscribe: store.subscribe,
    serialise: store.serialise,
    actions,
    ActionTypes,
    selectors,
  });
  window.NIGHT_SHIFT = api;
  return api;
};

export const isLocalSocketUrl = (url) => {
  try {
    const u = new URL(url);
    return (u.protocol === 'ws:' || u.protocol === 'wss:') && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  } catch {
    return false;
  }
};

// Connects (and keeps reconnecting) to a local bridge. onStatus receives
// 'connecting' | 'online' | 'offline' | 'taken'. Returns { url, close } or null for non-local URLs.
//
// options.quiet: an automatic dial (a saved address on page load). It reports 'offline' rather than
// 'connecting' until it gets through, backs off (1, 2, 4, 8 s) and gives up after QUIET_ATTEMPTS, so
// the scripted intern carries on. Once connected it behaves like a normal dial.
// 'taken' means another game window dialled in and the bridge dropped this one (close code 4000).
// The game does not redial by itself after that; the player has to press Redial.
export const connectIntern = (url, store, onStatus = () => {}, options = {}) => {
  if (!isLocalSocketUrl(url)) {
    console.warn(`[NIGHT_SHIFT] Refusing non-local intern bridge: ${url}`);
    return null;
  }
  const {
    quiet = false,
    WebSocketImpl = globalThis.WebSocket,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    now = Date.now,
    coalesceMs = COALESCE_MS,
  } = options;
  const OPEN = WebSocketImpl.OPEN ?? 1;
  let ws = null;
  let unsubscribe = null;
  let retryMs = RECONNECT_MIN_MS;
  let retryTimer = null;
  let trailing = null;
  let closed = false;
  let everOnline = false;
  let attempts = 0;
  const status = (s) => onStatus(s === 'connecting' && quiet && !everOnline ? 'offline' : s);

  const open = () => {
    attempts++;
    status('connecting');
    ws = new WebSocketImpl(url);
    const sock = ws;
    const send = (msg) => sock.readyState === OPEN && sock.send(JSON.stringify(msg));
    let lastSent = 0;
    const flush = (type) => {
      clearTimer(trailing);
      trailing = null;
      lastSent = now();
      send({ type: 'state', action: type, state: store.getState() });
    };

    sock.addEventListener('open', () => {
      retryMs = RECONNECT_MIN_MS;
      everOnline = true;
      onStatus('online');
      send({ type: 'hello', protocol: PROTOCOL_VERSION, version: store.getState().version, state: store.getState() });
      lastSent = now();
      unsubscribe = store.subscribe((state, prev, action) => {
        if (!NOISY_ACTIONS.has(action.type)) return flush(action.type);
        const wait = coalesceMs - (now() - lastSent);
        if (wait <= 0) flush(action.type);
        else if (!trailing) trailing = setTimer(() => flush(action.type), wait);
      });
    });
    sock.addEventListener('message', (event) => {
      const reply = handleBridgeMessage(store, event.data);
      if (reply) send(reply);
    });
    sock.addEventListener('close', (event) => {
      unsubscribe?.();
      unsubscribe = null;
      clearTimer(trailing);
      trailing = null;
      if (closed) return;
      if (event.code === LINE_TAKEN_CODE) {
        console.info('[NIGHT_SHIFT] Another game window took over the intern.');
        onStatus('taken');
        return;
      }
      if (FINAL_CLOSE_CODES.has(event.code) || (quiet && !everOnline && attempts >= QUIET_ATTEMPTS)) {
        onStatus('offline');
        return;
      }
      status('connecting');
      retryTimer = setTimer(open, retryMs);
      retryMs = Math.min(RECONNECT_MAX_MS, retryMs * 2);
    });
  };

  open();
  return {
    url,
    quiet,
    close() {
      closed = true;
      clearTimer(retryTimer);
      clearTimer(trailing);
      ws?.close(1000, 'Hung up');
      onStatus('offline');
    },
  };
};
