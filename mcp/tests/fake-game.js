// A fake browser game for tests: the real game store and reducer, driven over a real WebSocket
// using the game's own bridge message handler. Exactly what the browser does, minus the DOM.
import { readFile } from 'node:fs/promises';
import WebSocket from 'ws';
import { createStore } from '../../game/src/core/store.js';
import { reducer } from '../../game/src/core/reducer.js';
import { actions } from '../../game/src/core/actions.js';
import { createInitialState, STATE_VERSION } from '../../game/src/core/initialState.js';
import { handleBridgeMessage, PROTOCOL_VERSION } from '../../game/src/bridge/api.js';

const load = async (name) => JSON.parse(await readFile(new URL(`../../game/data/${name}`, import.meta.url), 'utf8'));
export const gameData = { files: await load('files.json'), puzzles: await load('puzzles.json'), night: await load('night.json'), story: await load('story.json') };

export const newStore = ({ clockIn = true } = {}) => {
  const store = createStore(reducer, createInitialState(gameData));
  if (clockIn) {
    store.dispatch(actions.bootComplete());
    store.dispatch(actions.clockIn());
  }
  return store;
};

export const desktopState = () => newStore().getState();

export class FakeGame {
  constructor(store = newStore()) {
    this.store = store;
    this.ws = null;
  }

  connect(port, { origin, hello = {} } = {}) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`, origin ? { origin } : {});
      this.ws = ws;
      this.received = [];
      const send = (msg) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));
      this.send = send;
      ws.on('open', () => {
        send({ type: 'hello', protocol: PROTOCOL_VERSION, version: STATE_VERSION, state: this.store.getState(), ...hello });
        this.unsubscribe = this.store.subscribe((state, prev, action) => send({ type: 'state', action: action.type, state }));
        resolve(this);
      });
      ws.on('message', (data) => {
        const text = data.toString();
        try {
          this.received.push(JSON.parse(text));
        } catch {}
        const reply = handleBridgeMessage(this.store, text);
        if (reply) send(reply);
      });
      ws.on('close', (code) => {
        this.closeCode = code;
        this.unsubscribe?.();
      });
      ws.on('error', reject);
      ws.on('unexpected-response', (req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    });
  }

  close() {
    this.ws?.close();
  }

  playerSays(text) {
    this.store.dispatch(actions.chatSend(text));
  }
}

export const waitFor = async (cond, ms = 2000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('Timed out waiting');
    await new Promise((r) => setTimeout(r, 10));
  }
};
