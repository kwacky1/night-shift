// Desktop icons: click / Shift+click / Ctrl+click selection, drag to move one icon,
// Shift+drag to move the whole selection, drag on empty space for a marquee.
import { actions } from '../core/actions.js';
import { childrenOf } from '../core/selectors.js';
import { iconFor, iconSvg } from './icons.js';
import { esc, ui, isDoubleDown } from './dom.js';
import { bindRename, renameInputHtml } from './rename.js';

const DRAG_THRESHOLD = 4;

export const renderDesktop = (root, state, prev) => {
  if (prev && state.files === prev.files && state.desktop === prev.desktop && state.selection === prev.selection) return;
  const selected = state.selection.folderId === 'desktop' ? new Set(state.selection.ids) : new Set();
  root.innerHTML = childrenOf(state, 'desktop')
    .map((f) => {
      const pos = state.desktop.positions[f.id] ?? { x: 0, y: 0 };
      const label = ui.renamingId === f.id ? renameInputHtml(f) : `<span class="label">${esc(f.name)}</span>`;
      return `<div class="icon${selected.has(f.id) ? ' selected' : ''}" data-id="${esc(f.id)}" style="left:${pos.x}px;top:${pos.y}px" title="${esc(f.name)}">${iconSvg(iconFor(f))}${label}</div>`;
    })
    .join('');
};

export const initDesktop = (root, marquee, ctx) => {
  bindRename(root, ctx);

  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.rename-input')) return;
    const icon = e.target.closest('.icon');
    const mods = { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
    if (icon && !mods.shift && !mods.ctrl && isDoubleDown(`desktop:${icon.dataset.id}`)) {
      ctx.dispatch(actions.openFile(icon.dataset.id));
      return;
    }
    if (icon) startIconDrag(e, icon.dataset.id, mods, root, ctx);
    else startMarquee(e, mods, root, marquee, ctx);
  });
};

const startIconDrag = (e, id, mods, root, ctx) => {
  const sel = ctx.getState().selection;
  const alreadySelected = sel.folderId === 'desktop' && sel.ids.includes(id);
  if (!(mods.shift && alreadySelected)) ctx.dispatch(actions.selectFile('desktop', id, mods));
  const groupIds = mods.shift ? ctx.getState().selection.ids : [id];
  const els = groupIds.map((gid) => root.querySelector(`.icon[data-id="${CSS.escape(gid)}"]`)).filter(Boolean);
  const start = { x: e.clientX, y: e.clientY };
  let moved = false;

  const move = (ev) => {
    const dx = ev.clientX - start.x;
    const dy = ev.clientY - start.y;
    if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    moved = true;
    for (const node of els) {
      node.classList.add('dragging');
      node.style.transform = `translate(${dx}px, ${dy}px)`;
    }
  };
  const up = (ev) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    if (!moved) return;
    for (const node of els) {
      node.classList.remove('dragging');
      node.style.transform = '';
    }
    const bounds = root.getBoundingClientRect();
    const dx = Math.max(-bounds.width, Math.min(bounds.width, ev.clientX - start.x));
    const dy = ev.clientY - start.y;
    ctx.dispatch(actions.moveIcons(groupIds, dx, dy));
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
};

const startMarquee = (e, mods, root, marquee, ctx) => {
  const keep = mods.shift || mods.ctrl;
  const base = keep && ctx.getState().selection.folderId === 'desktop' ? ctx.getState().selection.ids : [];
  if (!keep) ctx.dispatch(actions.selectFile('desktop', null));
  const origin = { x: e.clientX, y: e.clientY };
  let rect = null;

  const move = (ev) => {
    rect = {
      left: Math.min(origin.x, ev.clientX),
      top: Math.min(origin.y, ev.clientY),
      right: Math.max(origin.x, ev.clientX),
      bottom: Math.max(origin.y, ev.clientY),
    };
    Object.assign(marquee.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.right - rect.left}px`,
      height: `${rect.bottom - rect.top}px`,
    });
    marquee.hidden = false;
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    marquee.hidden = true;
    if (!rect) return;
    const hits = [...root.querySelectorAll('.icon')]
      .filter((node) => {
        const r = node.getBoundingClientRect();
        return r.left < rect.right && r.right > rect.left && r.top < rect.bottom && r.bottom > rect.top;
      })
      .map((node) => node.dataset.id);
    ctx.dispatch(actions.selectSet('desktop', [...new Set([...base, ...hits])]));
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
};
