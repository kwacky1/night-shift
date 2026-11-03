// The seam for week 2's MCP server.
//
// 1. window.NIGHT_SHIFT exposes the same store API the UI uses (handy from DevTools too).
// 2. connectIntern() opens an optional WebSocket to a local MCP bridge. It is only used when the
//    page is loaded with ?intern=ws://localhost:PORT. Protocol (JSON messages):
//      game -> bridge  { type: 'hello', version, actions: [...types], state }
//      game -> bridge  { type: 'state', action, state }            after every state change
//      bridge -> game  { type: 'dispatch', id, action }            run an action
//      game -> bridge  { type: 'result', id, ok, error? }
//    Week 2 will project the state per role (asymmetric info) on the server side.
import { actions, ActionTypes, ACTION_TYPE_LIST } from '../core/actions.js';
import * as selectors from '../core/selectors.js';

const REMOTE_BLOCKED = new Set([ActionTypes.HYDRATE]);

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

export const connectIntern = (url, store, onStatus = () => {}) => {
  if (!isLocalSocketUrl(url)) {
    console.warn(`[NIGHT_SHIFT] Refusing non-local intern bridge: ${url}`);
    return null;
  }
  const ws = new WebSocket(url);
  let unsubscribe = null;
  const send = (msg) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));

  ws.addEventListener('open', () => {
    onStatus(true);
    send({ type: 'hello', version: store.getState().version, actions: ACTION_TYPE_LIST, state: store.getState() });
    unsubscribe = store.subscribe((state, prev, action) => send({ type: 'state', action, state }));
  });
  ws.addEventListener('message', (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg?.type !== 'dispatch') return;
    try {
      if (REMOTE_BLOCKED.has(msg.action?.type)) throw new Error(`${msg.action.type} is not allowed remotely`);
      store.dispatch(msg.action);
      send({ type: 'result', id: msg.id, ok: true });
    } catch (err) {
      send({ type: 'result', id: msg.id, ok: false, error: err.message });
    }
  });
  ws.addEventListener('close', () => {
    unsubscribe?.();
    onStatus(false);
  });
  ws.addEventListener('error', () => onStatus(false));
  return ws;
};
