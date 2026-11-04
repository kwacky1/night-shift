// Inline rename field shared by the desktop and the explorer.
import { actions } from '../core/actions.js';
import { ui, esc } from './dom.js';

export const startRename = (id, ctx) => {
  ui.renamingId = id;
  ctx.rerender();
  const input = document.querySelector('.rename-input');
  if (input) {
    input.focus();
    const dot = input.value.lastIndexOf('.');
    input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
  }
};

export const renameInputHtml = (file) =>
  `<input class="rename-input" data-rename="${esc(file.id)}" value="${esc(file.name)}" maxlength="12" spellcheck="false" autocomplete="off" />`;

// Wire once on a container; handles any rename input rendered inside it.
export const bindRename = (container, ctx) => {
  let committing = false;
  const finish = (input, commit) => {
    if (committing) return;
    committing = true;
    const id = input.dataset.rename;
    ui.renamingId = null;
    if (commit) ctx.dispatch(actions.renameFile(id, input.value));
    ctx.rerender();
    committing = false;
  };
  container.addEventListener('keydown', (e) => {
    const input = e.target.closest?.('.rename-input');
    if (!input) return;
    e.stopPropagation();
    if (e.key === 'Enter' || e.key === 'Escape') e.preventDefault();
    if (e.key === 'Enter') finish(input, true);
    else if (e.key === 'Escape') finish(input, false);
  });
  container.addEventListener(
    'blur',
    (e) => {
      const input = e.target.closest?.('.rename-input');
      if (input && ui.renamingId) finish(input, true);
    },
    true,
  );
  container.addEventListener('pointerdown', (e) => {
    if (e.target.closest?.('.rename-input')) e.stopPropagation();
  });
};
