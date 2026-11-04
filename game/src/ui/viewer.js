// Plain text viewer for recovered or readable files.
import { pathOf } from '../core/selectors.js';
import { esc } from './dom.js';

export const viewerView = {
  title: (state, win) => `${state.files[win.fileId]?.name ?? '?'} - Notepad`,
  icon: () => 'text',

  init(body) {
    body.innerHTML = `<pre class="viewer sunken" tabindex="0"></pre><div class="statusbar"><span class="path"></span></div>`;
  },

  render(body, state, prev, win) {
    if (prev && prev.files === state.files) return;
    const file = state.files[win.fileId];
    body.querySelector('.viewer').innerHTML = esc(file?.content ?? '');
    body.querySelector('.path').textContent = pathOf(state, win.fileId);
  },
};
