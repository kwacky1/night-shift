// File explorer window: list view with Shift+click range select, Ctrl+click toggle,
// double-click to open, F2 to rename (handled globally in main.js).
import { actions } from '../core/actions.js';
import { childrenOf, pathOf } from '../core/selectors.js';
import { esc, ui, isDoubleDown } from './dom.js';
import { iconFor, iconSvg, typeLabel } from './icons.js';
import { bindRename, renameInputHtml } from './rename.js';

const sizeOf = (f) => (f.type === 'folder' ? '' : `${Math.max(1, Math.ceil(f.content.length / 1024))}KB`);

export const explorerView = {
  title: (state, win) => `Exploring - ${pathOf(state, win.fileId)}`,
  icon: (state, win) => (win.fileId === 'drive' ? 'drive' : win.fileId === 'recycled' ? 'bin' : 'folder'),

  init(body, win, ctx) {
    body.innerHTML = `
      <div class="addressbar"><span>Address</span><span class="path sunken"></span></div>
      <div class="filelist sunken"></div>
      <div class="statusbar"><span class="count"></span><span class="selcount"></span></div>`;
    const list = body.querySelector('.filelist');
    bindRename(list, ctx);
    list.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.rename-input')) return;
      const row = e.target.closest('tr[data-id]');
      const mods = { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
      if (!row) {
        if (!mods.shift && !mods.ctrl) ctx.dispatch(actions.selectFile(win.fileId, null));
        return;
      }
      e.preventDefault();
      if (!mods.shift && !mods.ctrl && isDoubleDown(`${win.id}:${row.dataset.id}`)) {
        ctx.dispatch(actions.openFile(row.dataset.id));
        return;
      }
      ctx.dispatch(actions.selectFile(win.fileId, row.dataset.id, mods));
    });
  },

  render(body, state, prev, win) {
    if (prev && prev.files === state.files && prev.selection === state.selection) return;
    const kids = childrenOf(state, win.fileId);
    const sel = state.selection.folderId === win.fileId ? new Set(state.selection.ids) : new Set();
    body.querySelector('.path').textContent = `${pathOf(state, win.fileId)}\\`;
    body.querySelector('.filelist').innerHTML = kids.length
      ? `<table><thead><tr><th>Name</th><th>Size</th><th>Type</th></tr></thead><tbody>${kids
          .map((f) => {
            const name = ui.renamingId === f.id ? renameInputHtml(f) : `<span class="label">${esc(f.name)}</span>`;
            const cls = [sel.has(f.id) && 'selected', f.locked && 'locked'].filter(Boolean).join(' ');
            return `<tr data-id="${esc(f.id)}" class="${cls}"><td class="name">${iconSvg(iconFor(f))}${name}</td><td class="size">${sizeOf(f)}</td><td class="type">${esc(typeLabel(f))}</td></tr>`;
          })
          .join('')}</tbody></table>`
      : '<div class="empty">This folder is empty.</div>';
    body.querySelector('.count').textContent = `${kids.length} object(s)`;
    body.querySelector('.selcount').textContent = sel.size ? `${sel.size} selected` : '';
  },
};
