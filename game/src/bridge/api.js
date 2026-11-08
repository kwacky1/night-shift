// The game side of the intern bridge.
//
// 1. window.NIGHT_SHIFT exposes the same store API the UI uses (handy from DevTools too).
// 2. connectIntern() opens an optional WebSocket to the local MCP server (`npx -y @kwacky1/night-shift-mcp`).
//    It is used when the page is loaded with ?intern=ws://localhost:PORT or when the player dials
//    in from INTERN.EXE. Only localhost URLs are accepted. Protocol (JSON messages, protocol 3):
//      game -> bridge  { type: 'hello', protocol, version, state }        version = STATE_VERSION
//      bridge -> game  { type: 'welcome', protocol, version, driver }      the driver speaks our dialect
//      bridge -> game  { type: 'reject', reason: 'version', game, driver } then closes with 4003
//      game -> bridge  { type: 'state', action: '<ACTION_TYPE>', state }   after every state change
//                      (TICK and DRIVE_REPORT are coalesced to about one a second)
//      bridge -> game  { type: 'warn', reason }                            a state it could not read
//      bridge -> game  { type: 'dispatch', id, action }                     ask the game to run an action
//      game -> bridge  { type: 'result', id, ok, error? }
//    No welcome within WELCOME_TIMEOUT_MS means an older driver that silently drops our hello: the
//    game reports 'outdated' instead of pretending the intern is listening.
//    The game is authoritative. The bridge projects state per role (the intern sees a different
//    view than the player) and can only ask for the few actions in REMOTE_ACTIONS. Every remote
//    action is rebuilt field by field and stamped actor: 'intern', so the reducer applies intern
//    permissions no matter what the bridge sends.
import { actions, ActionTypes } from '../core/actions.js';
import * as selectors from '../core/selectors.js';
import { internActionError } from '../core/permissions.js';
import { checkSubmission } from '../core/blame.js';
import { STATE_VERSION } from '../core/initialState.js';

export const PROTOCOL_VERSION = 3;
export const WELCOME_TIMEOUT_MS = 5000;
export const VERSION_CLOSE_CODE = 4003;
const MAX_INBOUND_CHARS = 8 * 1024;
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 10000;
// Close codes from the bridge that mean "stop retrying". 4000 = another game window took the line.
const FINAL_CLOSE_CODES = new Set([4000, 4003]);
export const LINE_TAKEN_CODE = 4000;
// A quiet (automatic, on page load) dial gives up after this many failed attempts.
export const QUIET_ATTEMPTS = 4;
// A dial the player made gives up (DIAL FAILED) after this many failed attempts in a row.
export const DIAL_ATTEMPTS = 5;
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
  // The reducer checks the suspect and every citation against what the intern can read.
  [ActionTypes.BLAME_SUBMIT]: (a) => {
    const refs = a.evidence ?? [];
    if (!isId(a.suspect) || !Array.isArray(refs) || refs.length > 8 || !refs.every((r) => typeof r === 'string' && /^[a-z0-9_-]{1,32}:\d{1,4}$/i.test(r))) throw new Error('Bad BLAME_SUBMIT');
    if (a.statement !== undefined && (typeof a.statement !== 'string' || a.statement.length > 500)) throw new Error('Bad BLAME_SUBMIT');
    return { type: ActionTypes.BLAME_SUBMIT, suspect: a.suspect, evidence: [...refs], statement: a.statement ?? '' };
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
    const denied = internActionError(store.getState(), action) ?? (action.type === ActionTypes.BLAME_SUBMIT ? checkSubmission(store.getState(), 'intern', action).error : null);
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

// "v3.4": protocol 3, state version 4. Shared with the MCP driver so both sides word it the same.
export const versionTag = (v) => (v && Number.isInteger(v.protocol) ? `v${v.protocol}${Number.isInteger(v.version) ? `.${v.version}` : ''}` : 'older');
export const GAME_VERSION = Object.freeze({ protocol: PROTOCOL_VERSION, version: STATE_VERSION });
export const outdatedText = (game, driver) => `INTERN DRIVER OUT OF DATE (game ${versionTag(game)}, driver ${versionTag(driver)})`;

// Connects (and keeps reconnecting) to a local bridge. onStatus receives
// 'connecting' | 'online' | 'offline' | 'taken' | 'outdated' | 'failed', plus a detail object for some:
// 'outdated' -> { game, driver, text }, 'failed' -> { attempts }, and { warning } with 'online' when
// the driver couldn't read a state we sent. Returns { url, close } or null for non-local URLs.
//
// options.maxAttempts (default DIAL_ATTEMPTS): failed opens in a row (with 1, 2, 4, 8, 10 s backoff)
// before giving up with 'failed'. The count restarts whenever a socket opens. In itch's iframe the
// browser blocks the line outright, so main.js passes 1 there.
//
// options.quiet: an automatic dial (a saved address on page load). It reports 'offline' rather than
// 'connecting' until it gets through, backs off (1, 2, 4, 8 s) and gives up after QUIET_ATTEMPTS, so
// the scripted intern carries on. Once connected it behaves like a normal dial.
// 'taken' means another game window dialled in and the bridge dropped this one (close code 4000).
// 'outdated' means the driver rejected our version, or never answered the hello. No redial either way.
export const connectIntern = (url, store, onStatus = () => {}, options = {}) => {
  if (!isLocalSocketUrl(url)) {
    console.warn(`[NIGHT_SHIFT] Refusing non-local intern bridge: ${url}`);
    return null;
  }
  const {
    quiet = false,
    maxAttempts = DIAL_ATTEMPTS,
    WebSocketImpl = globalThis.WebSocket,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    now = Date.now,
    coalesceMs = COALESCE_MS,
    welcomeMs = WELCOME_TIMEOUT_MS,
  } = options;
  const OPEN = WebSocketImpl.OPEN ?? 1;
  let ws = null;
  let unsubscribe = null;
  let retryMs = RECONNECT_MIN_MS;
  let retryTimer = null;
  let welcomeTimer = null;
  let trailing = null;
  let closed = false;
  let outdated = null;
  let everOnline = false;
  let attempts = 0;
  let failures = 0;
  const status = (s) => onStatus(s === 'connecting' && quiet && !everOnline ? 'offline' : s);
  const goOutdated = (sock, driver) => {
    if (outdated) return;
    outdated = { game: GAME_VERSION, driver: driver ?? null, text: outdatedText(GAME_VERSION, driver) };
    console.warn(`[NIGHT_SHIFT] ${outdated.text}`);
    clearTimer(welcomeTimer);
    onStatus('outdated', outdated);
    sock.close(1000, 'Driver out of date');
  };

  const open = () => {
    attempts++;
    status('connecting');
    ws = new WebSocketImpl(url);
    const sock = ws;
    let opened = false;
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
      opened = true;
      failures = 0;
      onStatus('online');
      send({ type: 'hello', protocol: PROTOCOL_VERSION, version: STATE_VERSION, state: store.getState() });
      welcomeTimer = setTimer(() => goOutdated(sock, null), welcomeMs);
      lastSent = now();
      unsubscribe = store.subscribe((state, prev, action) => {
        if (!NOISY_ACTIONS.has(action.type)) return flush(action.type);
        const wait = coalesceMs - (now() - lastSent);
        if (wait <= 0) flush(action.type);
        else if (!trailing) trailing = setTimer(() => flush(action.type), wait);
      });
    });
    sock.addEventListener('message', (event) => {
      const control = parseControl(event.data);
      if (control?.type === 'welcome') {
        clearTimer(welcomeTimer);
        welcomeTimer = null;
        return;
      }
      if (control?.type === 'reject') return goOutdated(sock, control.driver);
      if (control?.type === 'warn') {
        console.warn(`[NIGHT_SHIFT] Intern driver could not read our state: ${control.reason}`);
        onStatus('online', { warning: control.reason });
        return;
      }
      const reply = handleBridgeMessage(store, event.data);
      if (reply) send(reply);
    });
    sock.addEventListener('close', (event) => {
      unsubscribe?.();
      unsubscribe = null;
      clearTimer(trailing);
      clearTimer(welcomeTimer);
      trailing = null;
      if (closed || outdated) return;
      if (event.code === LINE_TAKEN_CODE) {
        console.info('[NIGHT_SHIFT] Another game window took over the intern.');
        onStatus('taken');
        return;
      }
      if (event.code === VERSION_CLOSE_CODE) {
        // Rejected before we could read why (or by a driver that never says): still a version problem.
        goOutdated(sock, null);
        return;
      }
      const silent = quiet && !everOnline;
      if (FINAL_CLOSE_CODES.has(event.code) || (silent && attempts >= QUIET_ATTEMPTS)) {
        onStatus('offline');
        return;
      }
      if (!opened) failures++;
      if (!silent && failures >= maxAttempts) {
        onStatus('failed', { attempts: failures });
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
      clearTimer(welcomeTimer);
      ws?.close(1000, 'Hung up');
      onStatus('offline');
    },
  };
};

const CONTROL_TYPES = new Set(['welcome', 'reject', 'warn']);
const isVersion = (v) => v && typeof v === 'object' && Number.isInteger(v.protocol) && v.protocol >= 0 && v.protocol < 1000;

// Handshake and warning messages from the driver. Anything malformed is ignored (null).
export const parseControl = (raw) => {
  if (typeof raw !== 'string' || raw.length > MAX_INBOUND_CHARS) return null;
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!msg || !CONTROL_TYPES.has(msg.type)) return null;
  if (msg.type === 'reject') return { type: 'reject', driver: isVersion(msg.driver) ? { protocol: msg.driver.protocol, version: Number.isInteger(msg.driver.version) ? msg.driver.version : undefined } : null };
  if (msg.type === 'warn') return { type: 'warn', reason: String(msg.reason ?? 'unknown').slice(0, 200) };
  return { type: 'welcome' };
};
