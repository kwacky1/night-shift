// Bit Rot puzzle window. Shows the current 16-bit word as lit cells against the target pattern.
import { actions } from '../core/actions.js';
import { toBits, toHex } from '../logic/bits.js';
import { opLabel } from '../logic/puzzle.js';
import { esc } from './dom.js';

const puzzleFor = (state, win) => state.puzzles[state.files[win.fileId]?.puzzleId];

const bitsHtml = (value, target, isTarget) => {
  const v = toBits(value);
  const t = toBits(target);
  const cells = v.map((bit, i) => {
    const cls = [bit && 'on', !isTarget && bit !== t[i] && (bit ? 'wrong' : 'off-wrong')].filter(Boolean).join(' ');
    return `<span class="${cls}"></span>`;
  });
  return [0, 4, 8, 12].map((i) => `<div class="nib">${cells.slice(i, i + 4).join('')}</div>`).join('');
};

export const bitrotView = {
  title: (state, win) => `BITROT.EXE - ${state.files[win.fileId]?.name ?? ''}`,
  icon: (state, win) => (puzzleFor(state, win)?.solved ? 'text' : 'corrupt'),

  init(body, win, ctx) {
    body.innerHTML = '<div class="bitrot sunken"></div>';
    body.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-cmd]');
      if (!btn) return;
      const p = puzzleFor(ctx.getState(), win);
      if (!p) return;
      const { cmd, op } = btn.dataset;
      if (cmd === 'op') ctx.dispatch(actions.applyOp(p.id, Number(op)));
      else if (cmd === 'undo') ctx.dispatch(actions.undo(p.id));
      else if (cmd === 'reset') ctx.dispatch(actions.resetPuzzle(p.id));
      else if (cmd === 'open') ctx.dispatch(actions.openFile(win.fileId));
    });
  },

  render(body, state, prev, win) {
    if (prev && prev.puzzles === state.puzzles && prev.files === state.files) return;
    const p = puzzleFor(state, win);
    const root = body.querySelector('.bitrot');
    if (!p) {
      root.innerHTML = '<p>No corruption found.</p>';
      return;
    }
    const used = p.history.length;
    const locked = p.solved || p.failed;
    const trail = [...p.history, p.value].map(toHex).join(' &rarr; ');
    root.classList.toggle('solved', p.solved);
    root.innerHTML = `
      <h2>${esc(p.title ?? p.id)}</h2>
      ${p.hint ? `<div class="hint">${esc(p.hint)}</div>` : ''}
      <div class="bitrow"><span class="lbl">CURRENT</span><div class="bits">${bitsHtml(p.value, p.target, false)}</div><span class="hex">${toHex(p.value)}</span></div>
      <div class="bitrow"><span class="lbl">TARGET</span><div class="bits target">${bitsHtml(p.target, p.target, true)}</div><span class="hex">${toHex(p.target)}</span></div>
      <div class="moves"><span>MOVES ${used}/${p.moveLimit}</span><span class="pips">${Array.from({ length: p.moveLimit }, (_, i) => `<span class="${i < used ? 'used' : ''}"></span>`).join('')}</span></div>
      <div class="ops">${p.ops
        .map((op, i) => `<button type="button" data-cmd="op" data-op="${i}" ${locked ? 'disabled' : ''}>${esc(opLabel(op))}<kbd>${i + 1}</kbd></button>`)
        .join('')}</div>
      <div class="trail">${trail}</div>
      ${p.solved ? '<div class="banner ok">SECTOR RECOVERED</div>' : ''}
      ${p.failed ? '<div class="banner lost">SECTOR LOST - UNDO OR RESET</div>' : ''}
      <div class="actions">
        ${p.solved
          ? `<button type="button" data-cmd="open">Open ${esc(state.files[win.fileId].name)}</button>`
          : `<button type="button" data-cmd="undo" ${used ? '' : 'disabled'}>Undo <kbd>Z</kbd></button><button type="button" data-cmd="reset" ${used ? '' : 'disabled'}>Reset <kbd>R</kbd></button>`}
      </div>`;
  },
};

// Keyboard shortcuts while a Bit Rot window is focused.
export const bitrotKey = (e, state, win, dispatch) => {
  const p = puzzleFor(state, win);
  if (!p) return false;
  const n = Number(e.key);
  if (Number.isInteger(n) && n >= 1 && n <= p.ops.length) dispatch(actions.applyOp(p.id, n - 1));
  else if (e.key === 'z' || e.key === 'Z' || e.key === 'Backspace') dispatch(actions.undo(p.id));
  else if (e.key === 'r' || e.key === 'R') dispatch(actions.resetPuzzle(p.id));
  else return false;
  return true;
};
