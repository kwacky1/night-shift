// Window manager. Window geometry, z-order and focus live in game state;
// live dragging moves the DOM directly and commits a single WINDOW_MOVE on release.
import { actions } from '../core/actions.js';
import { el } from './dom.js';
import { iconSvg } from './icons.js';

const views = {};
export const registerView = (kind, view) => {
  views[kind] = view;
};
export const viewFor = (kind) => views[kind];

const frames = new Map();

const createFrame = (win, ctx) => {
  const frame = el(
    'div',
    'window raised',
    `<div class="titlebar"><span class="ticon"></span><span class="title"></span>
      <button type="button" data-act="min" title="Minimise" aria-label="Minimise">_</button>
      <button type="button" data-act="close" title="Close" aria-label="Close">&#215;</button></div>
     <div class="window-body"></div>`,
  );
  frame.dataset.win = win.id;
  const bar = frame.querySelector('.titlebar');
  bar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    startDrag(e, frame, win.id, ctx);
  });
  bar.querySelector('[data-act="min"]').addEventListener('click', () => ctx.dispatch(actions.minimiseWindow(win.id)));
  bar.querySelector('[data-act="close"]').addEventListener('click', () => ctx.dispatch(actions.closeWindow(win.id)));
  views[win.kind]?.init?.(frame.querySelector('.window-body'), win, ctx);
  return frame;
};

const startDrag = (e, frame, id, ctx) => {
  e.preventDefault();
  const start = { x: e.clientX, y: e.clientY, left: frame.offsetLeft, top: frame.offsetTop };
  let moved = false;
  const pos = (ev) => ({
    x: Math.max(0, Math.min(window.innerWidth - 80, start.left + ev.clientX - start.x)),
    y: Math.max(0, Math.min(window.innerHeight - 60, start.top + ev.clientY - start.y)),
  });
  const move = (ev) => {
    moved = true;
    const p = pos(ev);
    frame.style.left = `${p.x}px`;
    frame.style.top = `${p.y}px`;
  };
  const up = (ev) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    if (moved) {
      const p = pos(ev);
      ctx.dispatch(actions.moveWindow(id, p.x, p.y));
    }
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
};

export const initWindows = (root, ctx) => {
  // Any click inside a window brings it to the front.
  root.addEventListener(
    'pointerdown',
    (e) => {
      const frame = e.target.closest('.window');
      if (frame && ctx.getState().focusedWindowId !== frame.dataset.win) ctx.dispatch(actions.focusWindow(frame.dataset.win));
    },
    true,
  );
};

export const renderWindows = (root, state, prev, ctx) => {
  const live = new Set(state.windows.map((w) => w.id));
  for (const [id, frame] of frames) {
    if (!live.has(id)) {
      frame.remove();
      frames.delete(id);
    }
  }
  const prevById = new Map((prev?.windows ?? []).map((w) => [w.id, w]));
  for (const win of state.windows) {
    let frame = frames.get(win.id);
    const isNew = !frame;
    if (isNew) {
      frame = createFrame(win, ctx);
      frames.set(win.id, frame);
      root.append(frame);
    }
    if (isNew || prevById.get(win.id) !== win) {
      Object.assign(frame.style, { left: `${win.x}px`, top: `${win.y}px`, width: `${win.w}px`, height: `${win.h}px`, zIndex: win.z });
      frame.hidden = win.minimised;
    }
    frame.classList.toggle('focused', state.focusedWindowId === win.id);
    const view = views[win.kind];
    const title = view?.title(state, win) ?? win.kind;
    const titleEl = frame.querySelector('.title');
    if (titleEl.textContent !== title) titleEl.textContent = title;
    const icon = view?.icon?.(state, win) ?? 'text';
    if (frame.dataset.icon !== icon) {
      frame.dataset.icon = icon;
      frame.querySelector('.ticon').innerHTML = iconSvg(icon);
    }
    view?.render(frame.querySelector('.window-body'), state, isNew ? null : prev, win, ctx);
  }
};

export const titleFor = (state, win) => views[win.kind]?.title(state, win) ?? win.kind;
export const iconForWindow = (state, win) => views[win.kind]?.icon?.(state, win) ?? 'text';
