// The game side of the intern bridge.
//
// 1. window.NIGHT_SHIFT exposes the same store API the UI uses (handy from DevTools too).
// 2. connectIntern() opens an optional WebSocket to the local MCP server (`npx night-shift-mcp`).
//    It is used when the page is loaded with ?intern=ws://localhost:PORT or when the player dials
//    in from INTERN.EXE. Only localhost URLs are accepted. Protocol (JSON messages, protocol 2):
//      game -> bridge  { type: 'hello', protocol, version, state }
//      game -> bridge  { type: 'state', action: '<ACTION_TYPE>', state }   after every state change
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
// Close codes from the bridge that mean "stop retrying".
const FINAL_CLOSE_CODES = new Set([4000, 4003]);

const isId = (v) => typeof v === 'string' && /^[a-z0-9_-]{1,32}$/i.test(v);
const isIndex = (v) => Number.isInteger(v) && v >= 0 && v < 16;

// Allowlist of remote actions. Each entry rebuilds a clean action from untrusted input or throws.
const REMOTE_ACTIONS = {
  [ActionTypes.PUZZLE_APPLY_OP]: (a) => {
    if (!isId(a.puzzleId) || !isIndex(a.opIndex)) throw new Error('Bad PUZZLE_APPLY_OP');
    return { type: ActionTypes.PUZZLE_APPLY_OP, puzzleId: a.puzzleId, opIndex: a.opIndex };
  },
  [ActionTypes.PUZZLE_ENTER_KEY]: (a) => {
    if (!isId(a.puzzleId) || !isIndex(a.opIndex) || typeof a.mask !== 'string' || a.mask.length > 18) throw new Error('Bad PUZZLE_ENTER_KEY');
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
// 'connecting' | 'online' | 'offline'. Returns { url, close } or null for non-local URLs.
export const connectIntern = (url, store, onStatus = () => {}) => {
  if (!isLocalSocketUrl(url)) {
    console.warn(`[NIGHT_SHIFT] Refusing non-local intern bridge: ${url}`);
    return null;
  }
  let ws = null;
  let unsubscribe = null;
  let retryMs = RECONNECT_MIN_MS;
  let retryTimer = null;
  let closed = false;

  const open = () => {
    onStatus('connecting');
    ws = new WebSocket(url);
    const sock = ws;
    const send = (msg) => sock.readyState === WebSocket.OPEN && sock.send(JSON.stringify(msg));

    sock.addEventListener('open', () => {
      retryMs = RECONNECT_MIN_MS;
      onStatus('online');
      send({ type: 'hello', protocol: PROTOCOL_VERSION, version: store.getState().version, state: store.getState() });
      unsubscribe = store.subscribe((state, prev, action) => send({ type: 'state', action: action.type, state }));
    });
    sock.addEventListener('message', (event) => {
      const reply = handleBridgeMessage(store, event.data);
      if (reply) send(reply);
    });
    sock.addEventListener('close', (event) => {
      unsubscribe?.();
      unsubscribe = null;
      if (closed || FINAL_CLOSE_CODES.has(event.code)) {
        if (event.code === 4000) console.info('[NIGHT_SHIFT] Another game window took over the intern.');
        onStatus('offline');
        return;
      }
      onStatus('connecting');
      retryTimer = setTimeout(open, retryMs);
      retryMs = Math.min(RECONNECT_MAX_MS, retryMs * 2);
    });
  };

  open();
  return {
    url,
    close() {
      closed = true;
      clearTimeout(retryTimer);
      ws?.close(1000, 'Hung up');
      onStatus('offline');
    },
  };
};
