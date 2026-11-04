// GameLink: the WebSocket side of night-shift-mcp. The browser game connects here.
// - Binds to 127.0.0.1 only, checks Host and Origin, caps payload size.
// - One game client at a time: the newest connection wins (page reloads just work).
// - Every inbound message is validated with zod; anything else is dropped.
// - The game is authoritative. We keep the latest state snapshot and send dispatch requests.
import { EventEmitter } from 'node:events';
import { WebSocketServer } from 'ws';
import { InboundMessage } from './schema.js';

export const DEFAULT_PORT = 7117;
const MAX_PAYLOAD = 2 * 1024 * 1024;
const HEARTBEAT_MS = 15000;
const DISPATCH_TIMEOUT_MS = 5000;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const DEFAULT_ORIGIN_PATTERNS = [
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/,
  /^https:\/\/([a-z0-9-]+\.)*itch\.zone$/,
  /^https:\/\/([a-z0-9-]+\.)*itch\.io$/,
];

export class NotConnectedError extends Error {
  constructor() {
    super('No game connected');
    this.name = 'NotConnectedError';
  }
}

export const isAllowedOrigin = (origin, extra = []) => {
  // Non-browser clients (tests, scripts on this machine) send no Origin header.
  if (origin === undefined) return true;
  if (extra.includes(origin)) return true;
  return DEFAULT_ORIGIN_PATTERNS.some((re) => re.test(origin));
};

export const isLocalHostHeader = (host) => {
  if (typeof host !== 'string') return false;
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
  return LOCAL_HOSTS.has(name.toLowerCase());
};

export class GameLink extends EventEmitter {
  constructor({ port = DEFAULT_PORT, host = '127.0.0.1', allowOrigins = [], log = () => {} } = {}) {
    super();
    this.options = { port, host, allowOrigins };
    this.log = log;
    this.socket = null;
    this.state = null;
    this.pending = new Map();
    this.nextId = 1;
    this.wss = null;
    this.heartbeat = null;
  }

  get connected() {
    return Boolean(this.socket && this.state);
  }

  get port() {
    return this.wss?.address()?.port ?? this.options.port;
  }

  start() {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({
        host: this.options.host,
        port: this.options.port,
        maxPayload: MAX_PAYLOAD,
        verifyClient: ({ origin, req }, done) => {
          if (!isLocalHostHeader(req.headers.host)) return done(false, 403, 'Bad Host');
          if (!isAllowedOrigin(origin, this.options.allowOrigins)) {
            this.log(`Rejected game connection from origin ${origin}`);
            return done(false, 403, 'Origin not allowed');
          }
          done(true);
        },
      });
      wss.once('error', (err) => {
        if (err.code === 'EADDRINUSE') err.message = `Port ${this.options.port} is already in use. Pick another with --port or NIGHT_SHIFT_PORT.`;
        reject(err);
      });
      wss.once('listening', () => {
        this.wss = wss;
        this.heartbeat = setInterval(() => this.#beat(), HEARTBEAT_MS);
        this.heartbeat.unref?.();
        resolve(this);
      });
      wss.on('connection', (ws) => this.#accept(ws));
    });
  }

  async stop() {
    clearInterval(this.heartbeat);
    this.#drop(new NotConnectedError());
    this.socket?.terminate();
    this.socket = null;
    await new Promise((resolve) => (this.wss ? this.wss.close(() => resolve()) : resolve()));
  }

  // Ask the game to run an action. Resolves { ok, error? } from the game's result message.
  dispatch(action, timeoutMs = DISPATCH_TIMEOUT_MS) {
    if (!this.connected) return Promise.reject(new NotConnectedError());
    const id = `r${this.nextId++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('The game did not answer in time.'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ type: 'dispatch', id, action }));
    });
  }

  #accept(ws) {
    if (this.socket) {
      this.log('A newer game window connected; dropping the old one.');
      const old = this.socket;
      this.#detach(old);
      old.close(4000, 'Replaced by a newer game window');
    }
    this.socket = ws;
    this.state = null;
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      this.#receive(ws, data.toString('utf8'));
    });
    ws.on('close', () => {
      if (this.socket !== ws) return;
      this.#detach(ws);
      this.log('Game disconnected.');
      this.emit('disconnected');
    });
    ws.on('error', (err) => this.log(`Game socket error: ${err.message}`));
  }

  #detach(ws) {
    if (this.socket !== ws) return;
    this.socket = null;
    this.state = null;
    this.#drop(new NotConnectedError());
  }

  #drop(err) {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(err);
    }
    this.pending.clear();
  }

  #receive(ws, text) {
    if (ws !== this.socket) return;
    let parsed;
    try {
      parsed = InboundMessage.safeParse(JSON.parse(text));
    } catch {
      this.log('Dropped non-JSON message from the game.');
      return;
    }
    if (!parsed.success) {
      this.log(`Dropped invalid message from the game: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
      return;
    }
    const msg = parsed.data;
    if (msg.type === 'hello' || msg.type === 'state') {
      const first = !this.state;
      this.state = msg.state;
      if (msg.type === 'hello' || first) {
        this.log('Game connected.');
        this.emit('connected', msg.state);
      }
      this.emit('state', msg.state, msg.type === 'state' ? msg.action : 'HELLO');
    } else if (msg.type === 'result') {
      const p = this.pending.get(msg.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(msg.id);
      p.resolve({ ok: msg.ok, error: msg.error });
    }
  }

  #beat() {
    const ws = this.socket;
    if (!ws) return;
    if (!ws.isAlive) {
      this.log('Game stopped answering pings.');
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  }
}
