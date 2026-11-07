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
import { blameView } from './ui/blame.js';
import { addEnding, ENDINGS_KEY, parseEndings, scriptedBlame, scriptedBlameDecision } from './core/blame.js';
import { askKey, askPending } from './core/permissions.js';
import { powerStatus } from './core/power.js';
import { connectIntern, exposeApi, isLocalSocketUrl } from './bridge/api.js';
import { dialFailure, isFramed, localNetworkPermission, ownTabUrl } from './bridge/line.js';
import { fallbackAsk, fallbackNag, fallbackReply } from './intern/fallback.js';
import { opLabel } from './logic/puzzle.js';
import { tickMs, unreadForPlayer } from './core/selectors.js';

const SAVE_KEY = 'night-shift:save';
const INTERN_URL_KEY = 'night-shift:intern-url';
const SAVED_PHASES = ['desktop', 'over'];
const SAVE_THROTTLE_MS = 500;
// The scripted intern files its audit statement this long after the sysadmin when nobody's on the
// line, or this long after 06:00 if an AI intern is on the line but hasn't filed.
const SCRIPTED_BLAME_MS = 2000;

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
  const [files, puzzles, night, story, internScript, gearbox, blame] = await Promise.all([
    loadJson('../data/files.json'),
    loadJson('../data/puzzles.json'),
    loadJson('../data/night.json'),
    loadJson('../data/story.json'),
    loadJson('../data/intern.json'),
    loadJson('../data/gearbox.json'),
    loadJson('../data/blame.json'),
  ]);
  const data = { files, puzzles, night, story, blame };
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
  const framed = isFramed(window);
  const setInternStatus = (status, detail = null) => {
    const driver = status === 'outdated' ? detail : null;
    const warning = status === 'online' ? (detail?.warning ?? (ui.internStatus === 'online' ? ui.internWarning : null)) : null;
    const failure = status === 'failed' ? dialFailure({ framed, attempts: detail?.attempts }) : null;
    if (ui.internStatus === status && ui.internDriver === driver && ui.internWarning === warning && !failure) return;
    ui.internStatus = status;
    ui.internDriver = driver;
    ui.internWarning = warning;
    ui.internFailure = failure;
    ctx.rerender();
    // Word the hint with the browser's Local Network Access permission, if it will tell us.
    if (failure) {
      localNetworkPermission(navigator).then((permission) => {
        if (ui.internStatus !== 'failed' || permission === null) return;
        ui.internFailure = dialFailure({ framed, permission, attempts: detail?.attempts });
        ctx.rerender();
      });
    }
    // A real intern that drops off the line mid-audit hands back to the scripted one.
    setTimeout(() => scriptedBlameCheck(), 0);
  };
  const aiOnLine = () => ui.internStatus === 'online' || ui.internStatus === 'taken';
  // Remote-only ops already asked for, so a second click doesn't nag the intern again.
  const asks = new Map();

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
    // Endings found across every shift. Kept apart from the save, so a new game keeps them.
    endings: () => ({ found: loadEndings(), all: blame.endings.map(({ id, title }) => ({ id, title })) }),
    blame: {
      aiOnLine,
      waiting: () => scriptedBlameDecision(store.getState(), { aiOnLine: aiOnLine() }) === 'wait',
      // FILE WITHOUT THE INTERN: the scripted intern files now, even with a real one on the line.
      fileWithoutIntern: () => scriptedBlameCheck(true),
    },
    intern: {
      url: () => bridge?.url ?? savedUrl() ?? DEFAULT_INTERN_URL,
      dial: (url, { quiet = false } = {}) => {
        bridge?.close();
        // In itch's iframe the browser blocks the line outright: say so on the first failure.
        bridge = connectIntern(url, store, setInternStatus, { quiet, ...(framed && { maxAttempts: 1 }) });
        if (!bridge) {
          store.dispatch(actions.chatSend(`Refusing to dial ${url}. Only ws://localhost or ws://127.0.0.1 addresses are allowed.`, 'intern', { scripted: true }));
          return;
        }
        localStorage.setItem(INTERN_URL_KEY, url);
      },
      // The sysadmin pressed a remote-only op. A real intern gets asked on the line; the scripted
      // one runs it itself (counted as scriptedOps, not AI help) after a grumble.
      ask: (puzzleId, opIndex) => {
        const state = store.getState();
        const op = state.puzzles[puzzleId]?.ops[opIndex];
        if (!op || state.phase !== 'desktop') return;
        if (aiOnLine()) {
          const p = state.puzzles[puzzleId];
          if (askPending(asks, p, opIndex, Date.now())) return;
          asks.set(askKey(puzzleId, opIndex), { moves: p.history.length, at: Date.now() });
          const where = Object.values(state.files).find((f) => f.puzzleId === puzzleId)?.name ?? puzzleId;
          store.dispatch(actions.chatSend(`#0118, can you run ${opLabel(op)} on ${where}? It's on your side of the line.`));
          ctx.rerender();
          return;
        }
        ui.internTyping = true;
        ctx.rerender();
        setTimeout(() => {
          ui.internTyping = false;
          const { text, apply } = fallbackAsk(store.getState(), puzzleId, opIndex, internScript);
          store.dispatch(actions.chatSend(text, 'intern', { topic: 'ask', scripted: true }));
          if (apply) store.dispatch({ ...actions.applyOp(puzzleId, opIndex), actor: 'intern', scripted: true });
          else ctx.rerender();
        }, 600 + Math.random() * 600);
      },
      asked: (puzzle, opIndex) => aiOnLine() && askPending(asks, puzzle, opIndex, Date.now()),
      hangUp: () => {
        bridge?.close();
        bridge = null;
        localStorage.removeItem(INTERN_URL_KEY);
      },
      framed: () => framed,
      // The frame's own page in a new top-level tab, where the browser can ask for local network access.
      openOwnTab: (url) => window.open(ownTabUrl(location.href, url), '_blank', 'noopener'),
    },
  };

  registerView('explorer', explorerView);
  registerView('viewer', viewerView);
  registerView('bitrot', bitrotView);
  registerView('intern', internView);
  registerView('geargrind', geargrindView);
  registerView('blame', blameView);
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
    if (state.phase === 'over' && prev.phase !== 'over' && state.shiftEnd?.ending) saveEnding(state.shiftEnd.ending.id);
    render(state, prev);
    scriptedBlameCheck();
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

  const loadEndings = () => {
    try {
      return parseEndings(localStorage.getItem(ENDINGS_KEY), blame);
    } catch {
      return [];
    }
  };
  const saveEnding = (id) => {
    try {
      localStorage.setItem(ENDINGS_KEY, JSON.stringify(addEnding(loadEndings(), id)));
    } catch {
      // Private mode: the tally just won't persist.
    }
  };

  // The audit: with no real intern on the line, the scripted one files after the sysadmin (it blames
  // you, naturally). A real intern is waited for however long it takes, unless the sysadmin presses
  // FILE WITHOUT THE INTERN.
  let blameTimer = null;
  const scriptedBlameCheck = (forced = false) => {
    if (blameTimer || scriptedBlameDecision(store.getState(), { aiOnLine: aiOnLine(), forced }) !== 'file') return;
    ui.internTyping = true;
    ctx.rerender();
    blameTimer = setTimeout(() => {
      blameTimer = null;
      ui.internTyping = false;
      const s = store.getState();
      if (scriptedBlameDecision(s, { aiOnLine: aiOnLine(), forced }) !== 'file') return ctx.rerender();
      const pick = scriptedBlame(s);
      if (pick) store.dispatch({ ...actions.blameSubmit(pick.suspect, pick.evidence, pick.statement), actor: 'intern', scripted: true });
    }, SCRIPTED_BLAME_MS);
  };

  // Unprompted: the scripted intern nags about mainframe power (a real intern does its own nagging).
  const scriptedNag = (state, prev) => {
    if (ui.internStatus === 'online' || ui.internStatus === 'taken') return;
    const nag = fallbackNag(prev, state, internScript);
    if (nag) setTimeout(() => store.dispatch(actions.chatSend(nag.text, 'intern', { topic: nag.topic, scripted: true })), 0);
  };

  // One game minute every clock.msPerMinute real milliseconds (data/night.json).
  // WAIT FOR THE AUDIT runs it FAST_FORWARD x (still one minute per tick, so every beat fires in order).
  const minuteMs = () => tickMs(store.getState(), DEFAULT_MS_PER_MINUTE);
  let tickTimer = 0;
  const tickLoop = () => {
    const s = store.getState();
    if (s.phase === 'desktop' && !document.hidden && !s.alert) store.dispatch(actions.tick(1));
    scriptedBlameCheck();
    tickTimer = setTimeout(tickLoop, minuteMs());
  };
  tickTimer = setTimeout(tickLoop, minuteMs());
  ctx.waitForAudit = () => {
    const before = store.getState();
    store.dispatch(actions.waitForAudit());
    if (store.getState() === before) return;
    clearTimeout(tickTimer);
    tickTimer = setTimeout(tickLoop, minuteMs());
  };

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
    if (focused?.kind === 'bitrot' && !e.ctrlKey && !e.altKey && !e.metaKey && bitrotKey(e, state, focused, store.dispatch, ctx)) {
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
