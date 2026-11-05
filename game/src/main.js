// Entry point: load data, build the store, wire the UI. Side effects (timers, storage) live here,
// never in the reducer.
import { createStore } from './core/store.js';
import { reducer } from './core/reducer.js';
import { actions, ActionTypes } from './core/actions.js';
import { createInitialState, STATE_VERSION } from './core/initialState.js';
import { $, ui } from './ui/dom.js';
import { renderBoot, renderClockIn } from './ui/boot.js';
import { initDesktop, renderDesktop } from './ui/desktop.js';
import { initWindows, registerView, renderWindows } from './ui/windows.js';
import { initTaskbar, renderAlert, renderTaskbar } from './ui/taskbar.js';
import { explorerView } from './ui/explorer.js';
import { viewerView } from './ui/viewer.js';
import { bitrotView, bitrotKey } from './ui/bitrot.js';
import { internView, DEFAULT_INTERN_URL } from './ui/intern.js';
import { startRename } from './ui/rename.js';
import { connectIntern, exposeApi, isLocalSocketUrl } from './bridge/api.js';
import { fallbackReply } from './intern/fallback.js';
import { unreadForPlayer } from './core/selectors.js';

const SAVE_KEY = 'night-shift:save';
const INTERN_URL_KEY = 'night-shift:intern-url';
const TICK_MS = 1000; // one real second = one minute of night shift

const loadJson = async (path) => {
  const res = await fetch(new URL(path, import.meta.url));
  if (!res.ok) throw new Error(`Could not load ${path}`);
  return res.json();
};

const loadSave = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
    return saved?.version === STATE_VERSION && saved.phase === 'desktop' ? saved : null;
  } catch {
    return null;
  }
};

const boot = async () => {
  const [files, puzzles, internScript] = await Promise.all([
    loadJson('../data/files.json'),
    loadJson('../data/puzzles.json'),
    loadJson('../data/intern.json'),
  ]);
  const store = createStore(reducer, loadSave() ?? createInitialState({ files, puzzles }));

  const dom = {
    boot: $('#boot'),
    clockin: $('#clockin'),
    desktop: $('#desktop'),
    icons: $('#icons'),
    windows: $('#windows'),
    marquee: $('#marquee'),
    taskbar: $('#taskbar'),
    startMenu: $('#start-menu'),
    alert: $('#alert'),
  };

  const render = (state, prev) => {
    dom.boot.hidden = state.phase !== 'boot';
    dom.clockin.hidden = state.phase !== 'clockin';
    dom.desktop.hidden = state.phase !== 'desktop';
    renderBoot(dom.boot, state, store.dispatch);
    renderClockIn(dom.clockin, state, store.dispatch);
    renderDesktop(dom.icons, state, prev);
    renderWindows(dom.windows, state, prev, ctx);
    renderTaskbar(dom.taskbar, state, prev);
    renderAlert(dom.alert, state, prev, ctx);
  };

  let bridge = null;
  const savedUrl = () => {
    try {
      return localStorage.getItem(INTERN_URL_KEY);
    } catch {
      return null;
    }
  };
  const setInternStatus = (status) => {
    if (ui.internStatus === status) return;
    ui.internStatus = status;
    ctx.rerender();
  };

  const ctx = {
    dispatch: store.dispatch,
    getState: store.getState,
    rerender: () => render(store.getState(), null),
    reset: () => {
      localStorage.removeItem(SAVE_KEY);
      saveEnabled = false;
      location.reload();
    },
    intern: {
      url: () => bridge?.url ?? savedUrl() ?? DEFAULT_INTERN_URL,
      dial: (url) => {
        bridge?.close();
        bridge = connectIntern(url, store, setInternStatus);
        if (!bridge) {
          store.dispatch(actions.chatSend(`Refusing to dial ${url}. Only ws://localhost or ws://127.0.0.1 addresses are allowed.`, 'intern', { scripted: true }));
          return;
        }
        localStorage.setItem(INTERN_URL_KEY, url);
      },
      hangUp: () => {
        bridge?.close();
        bridge = null;
        localStorage.removeItem(INTERN_URL_KEY);
      },
    },
  };

  registerView('explorer', explorerView);
  registerView('viewer', viewerView);
  registerView('bitrot', bitrotView);
  registerView('intern', internView);
  initDesktop(dom.icons, dom.marquee, ctx);
  initWindows(dom.windows, ctx);
  initTaskbar(dom.taskbar, dom.startMenu, ctx);

  let saveEnabled = true;
  let saveTimer = null;
  const saveNow = () => {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (saveEnabled && store.getState().phase === 'desktop') localStorage.setItem(SAVE_KEY, store.serialise());
  };
  window.addEventListener('pagehide', () => saveTimer && saveNow());
  store.subscribe((state, prev, action) => {
    render(state, prev);
    if (action.type === ActionTypes.CHAT_SEND && !action.actor && action.from !== 'intern') scriptedIntern(action.text);
    const chatOpen = state.windows.some((w) => w.kind === 'intern' && !w.minimised);
    if (chatOpen && unreadForPlayer(state) > 0) setTimeout(() => store.dispatch(actions.chatRead()), 0);
    if (state.phase !== 'desktop' || !saveEnabled) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
  });

  // The scripted fallback intern answers only when no real (MCP) intern is on the line.
  const scriptedIntern = (text) => {
    if (ui.internStatus === 'online') return;
    ui.internTyping = true;
    ctx.rerender();
    setTimeout(() => {
      ui.internTyping = false;
      if (ui.internStatus === 'online') return ctx.rerender();
      const reply = fallbackReply(store.getState(), text, internScript);
      const { text: line, ...extra } = reply;
      store.dispatch(actions.chatSend(line, 'intern', { ...extra, scripted: true }));
    }, 700 + Math.random() * 900);
  };

  setInterval(() => {
    const s = store.getState();
    if (s.phase === 'desktop' && !document.hidden && !s.alert) store.dispatch(actions.tick(1));
  }, TICK_MS);

  window.addEventListener('keydown', (e) => {
    const state = store.getState();
    if (state.alert) {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        store.dispatch(actions.dismissAlert());
      }
      return;
    }
    if (state.phase !== 'desktop' || e.target.closest?.('input, textarea')) return;
    const focused = state.windows.find((w) => w.id === state.focusedWindowId);
    if (focused?.kind === 'bitrot' && !e.ctrlKey && !e.altKey && !e.metaKey && bitrotKey(e, state, focused, store.dispatch)) {
      e.preventDefault();
      return;
    }
    const { ids } = state.selection;
    if (e.key === 'F2' && ids.length === 1) {
      e.preventDefault();
      startRename(ids[0], ctx);
    } else if (e.key === 'Enter' && ids.length && !e.target.closest?.('button')) {
      e.preventDefault();
      ids.forEach((id) => store.dispatch(actions.openFile(id)));
    }
  });

  exposeApi(store);
  const internUrl = new URLSearchParams(location.search).get('intern') ?? savedUrl();
  if (internUrl && isLocalSocketUrl(internUrl)) ctx.intern.dial(internUrl);

  render(store.getState(), null);
};

boot().catch((err) => {
  const pre = document.createElement('pre');
  pre.style.cssText = 'color:#c0c0c0;padding:24px;font:16px monospace';
  pre.textContent = `FATAL: ${err.message}\n\nABORT, RETRY, FAIL?`;
  document.body.replaceChildren(pre);
  console.error(err);
});
