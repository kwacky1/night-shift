// Entry point: load data, build the store, wire the UI. Side effects (timers, storage) live here,
// never in the reducer.
import { createStore } from './core/store.js';
import { reducer } from './core/reducer.js';
import { actions, ActionTypes } from './core/actions.js';
import { createInitialState, DEFAULT_MS_PER_MINUTE } from './core/initialState.js';
import { migrateSave } from './core/save.js';
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
import { renderShiftEnd } from './ui/shiftend.js';
import { geargrindView } from './ui/geargrind.js';
import { powerStatus } from './core/power.js';
import { connectIntern, exposeApi, isLocalSocketUrl } from './bridge/api.js';
import { fallbackNag, fallbackReply } from './intern/fallback.js';
import { unreadForPlayer } from './core/selectors.js';

const SAVE_KEY = 'night-shift:save';
const INTERN_URL_KEY = 'night-shift:intern-url';
const SAVED_PHASES = ['desktop', 'over'];
const SAVE_THROTTLE_MS = 500;

const loadJson = async (path) => {
  const res = await fetch(new URL(path, import.meta.url));
  if (!res.ok) throw new Error(`Could not load ${path}`);
  return res.json();
};

// A saved shift, migrated if it's from an older build. Anything unplayable starts a fresh game.
const loadSave = (data) => {
  try {
    return migrateSave(JSON.parse(localStorage.getItem(SAVE_KEY)), data);
  } catch {
    return null;
  }
};

const boot = async () => {
  const [files, puzzles, night, story, internScript, gearbox] = await Promise.all([
    loadJson('../data/files.json'),
    loadJson('../data/puzzles.json'),
    loadJson('../data/night.json'),
    loadJson('../data/story.json'),
    loadJson('../data/intern.json'),
    loadJson('../data/gearbox.json'),
  ]);
  const data = { files, puzzles, night, story };
  const store = createStore(reducer, loadSave(data) ?? createInitialState(data));

  const dom = {
    boot: $('#boot'),
    clockin: $('#clockin'),
    shiftend: $('#shiftend'),
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
    dom.shiftend.hidden = state.phase !== 'over';
    renderBoot(dom.boot, state, store.dispatch);
    renderClockIn(dom.clockin, state, store.dispatch);
    renderShiftEnd(dom.shiftend, state, prev, ctx);
    renderDesktop(dom.icons, state, prev);
    renderWindows(dom.windows, state, prev, ctx);
    renderTaskbar(dom.taskbar, state, prev);
    renderAlert(dom.alert, state, prev, ctx);
    renderPower(state, prev);
  };

  // Low power is felt: the desktop dims and flickers (styles keyed on body[data-power]), and a
  // story surge flashes the screen.
  let surgeTimer = null;
  const renderPower = (state, prev) => {
    const status = state.phase === 'desktop' ? powerStatus(state) : 'ok';
    if (document.body.dataset.power !== status) document.body.dataset.power = status;
    if (prev && state.power && prev.power && state.power.surgeSeq !== prev.power.surgeSeq) {
      document.body.classList.add('surge');
      clearTimeout(surgeTimer);
      surgeTimer = setTimeout(() => document.body.classList.remove('surge'), 900);
    }
  };

  let bridge = null;
  const savedUrl = () => {
    try {
      return localStorage.getItem(INTERN_URL_KEY);
    } catch {
      return null;
    }
  };
  const setInternStatus = (status, detail = null) => {
    const driver = status === 'outdated' ? detail : null;
    const warning = status === 'online' ? (detail?.warning ?? (ui.internStatus === 'online' ? ui.internWarning : null)) : null;
    if (ui.internStatus === status && ui.internDriver === driver && ui.internWarning === warning) return;
    ui.internStatus = status;
    ui.internDriver = driver;
    ui.internWarning = warning;
    ctx.rerender();
  };

  const ctx = {
    dispatch: store.dispatch,
    getState: store.getState,
    gearbox,
    rerender: () => render(store.getState(), null),
    reset: () => {
      localStorage.removeItem(SAVE_KEY);
      saveEnabled = false;
      location.reload();
    },
    newShift: () => store.dispatch(actions.newShift(createInitialState(data))),
    intern: {
      url: () => bridge?.url ?? savedUrl() ?? DEFAULT_INTERN_URL,
      dial: (url, { quiet = false } = {}) => {
        bridge?.close();
        bridge = connectIntern(url, store, setInternStatus, { quiet });
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
  registerView('geargrind', geargrindView);
  initDesktop(dom.icons, dom.marquee, ctx);
  initWindows(dom.windows, ctx);
  initTaskbar(dom.taskbar, dom.startMenu, ctx);

  let saveEnabled = true;
  let saveTimer = null;
  const saveNow = () => {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (saveEnabled && SAVED_PHASES.includes(store.getState().phase)) localStorage.setItem(SAVE_KEY, store.serialise());
  };
  window.addEventListener('pagehide', () => saveTimer && saveNow());
  store.subscribe((state, prev, action) => {
    render(state, prev);
    if (action.type === ActionTypes.CHAT_SEND && !action.actor && action.from !== 'intern') scriptedIntern(action.text);
    if (action.type !== ActionTypes.HYDRATE) scriptedNag(state, prev);
    const chatOpen = state.windows.some((w) => w.kind === 'intern' && !w.minimised);
    if (chatOpen && unreadForPlayer(state) > 0) setTimeout(() => store.dispatch(actions.chatRead()), 0);
    if (action.type === ActionTypes.NEW_SHIFT) localStorage.removeItem(SAVE_KEY);
    if (!SAVED_PHASES.includes(state.phase) || !saveEnabled) return;
    // Throttled, not debounced: driving changes state several times a second and must still save.
    if (state.phase !== prev.phase) saveNow();
    else if (!saveTimer) saveTimer = setTimeout(saveNow, SAVE_THROTTLE_MS);
  });

  // The scripted fallback intern answers only when no real (MCP) intern is on the line, and stays
  // quiet when another window has taken the line (this window's INTERN.EXE says so instead).
  const scriptedIntern = (text) => {
    if (ui.internStatus === 'online' || ui.internStatus === 'taken') return;
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

  // Unprompted: the scripted intern nags about mainframe power (a real intern does its own nagging).
  const scriptedNag = (state, prev) => {
    if (ui.internStatus === 'online' || ui.internStatus === 'taken') return;
    const nag = fallbackNag(prev, state, internScript);
    if (nag) setTimeout(() => store.dispatch(actions.chatSend(nag.text, 'intern', { topic: nag.topic, scripted: true })), 0);
  };

  // One game minute every clock.msPerMinute real milliseconds (data/night.json).
  const minuteMs = () => store.getState().clock.msPerMinute || DEFAULT_MS_PER_MINUTE;
  const tickLoop = () => {
    const s = store.getState();
    if (s.phase === 'desktop' && !document.hidden && !s.alert) store.dispatch(actions.tick(1));
    setTimeout(tickLoop, minuteMs());
  };
  setTimeout(tickLoop, minuteMs());

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
  // ?intern=ws://... dials straight away. A saved address from last time is tried quietly in the
  // background (with backoff); if nothing answers, the scripted intern stays on duty.
  const queryUrl = new URLSearchParams(location.search).get('intern');
  const internUrl = queryUrl ?? savedUrl();
  if (internUrl && isLocalSocketUrl(internUrl)) ctx.intern.dial(internUrl, { quiet: !queryUrl });

  render(store.getState(), null);
};

boot().catch((err) => {
  const pre = document.createElement('pre');
  pre.style.cssText = 'color:#c0c0c0;padding:24px;font:16px monospace';
  pre.textContent = `FATAL: ${err.message}\n\nABORT, RETRY, FAIL?`;
  document.body.replaceChildren(pre);
  console.error(err);
});
