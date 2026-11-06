// Bit Rot puzzle window. Shows the current 16-bit word as lit cells against the target pattern.
import { actions } from '../core/actions.js';
import { toBits, toHex } from '../logic/bits.js';
import { opLabel } from '../logic/puzzle.js';
import { internOpsLeft, isOpUnlocked, opHands } from '../core/permissions.js';
import { isBitrotPowered } from '../core/power.js';
import { esc } from './dom.js';

const puzzleFor = (state, win) => state.puzzles[state.files[win.fileId]?.puzzleId];

const HANDS_TAG = { player: ['CONSOLE', 'Console only: #0118 cannot run this from the line'], intern: ['#0118', 'Remote only: press to ask #0118 to run it'] };

// Pressing an op: the console runs its own ops; remote-only ones are a request down the line.
const pressOp = (p, i, ctx) => {
  if (opHands(p.ops[i]) === 'intern') ctx.intern?.ask?.(p.id, i);
  else ctx.dispatch(actions.applyOp(p.id, i));
};

const NOOP_MS = 900;

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
      if (cmd === 'op') pressOp(p, Number(op), ctx);
      else if (cmd === 'undo') ctx.dispatch(actions.undo(p.id));
      else if (cmd === 'reset') ctx.dispatch(actions.resetPuzzle(p.id));
      else if (cmd === 'open') ctx.dispatch(actions.openFile(win.fileId));
    });
    body.addEventListener('submit', (e) => {
      const form = e.target.closest('form.keyrow');
      if (!form) return;
      e.preventDefault();
      const p = puzzleFor(ctx.getState(), win);
      const key = form.elements.key.value.trim();
      if (!p || !key) return;
      form.elements.key.value = '';
      ctx.dispatch(actions.enterKey(p.id, Number(form.dataset.op), key));
    });
  },

  render(body, state, prev, win) {
    const powered = isBitrotPowered(state);
    const frozen = Boolean(state.blame?.open);
    if (prev && prev.puzzles === state.puzzles && prev.files === state.files && isBitrotPowered(prev) === powered && Boolean(prev.blame?.open) === frozen) return;
    const p = puzzleFor(state, win);
    const root = body.querySelector('.bitrot');
    if (!p) {
      root.innerHTML = '<p>No corruption found.</p>';
      return;
    }
    const used = p.history.length;
    const locked = p.solved || p.failed || !powered || frozen;
    const remote = internOpsLeft(p);
    const hideHex = (p.playerHides ?? []).includes('hex');
    const hex = (v) => (hideHex ? '????' : toHex(v));
    const trail = hideHex ? 'TRACE SUPPRESSED - ASK #0118 FOR A READOUT' : [...p.history, p.value].map(toHex).join(' &rarr; ');
    const keyedLocked = p.ops.map((op, i) => (isOpUnlocked(p, i) ? null : i)).filter((i) => i !== null);
    const typedKey = root.querySelector('input[name="key"]')?.value ?? '';
    root.classList.toggle('solved', p.solved);
    root.innerHTML = `
      <h2>${esc(p.title ?? p.id)}</h2>
      ${p.hint ? `<div class="hint">${esc(p.hint)}</div>` : ''}
      <div class="bitrow"><span class="lbl">CURRENT</span><div class="bits">${bitsHtml(p.value, p.target, false)}</div><span class="hex">${hex(p.value)}</span></div>
      <div class="bitrow"><span class="lbl">TARGET</span><div class="bits target">${bitsHtml(p.target, p.target, true)}</div><span class="hex">${hex(p.target)}</span></div>
      <div class="legend" aria-label="Cell colours"><span><i class="on"></i>lit, correct</span><span><i class="on wrong"></i>lit, should be off</span><span><i class="off-wrong"></i>should be lit</span></div>
      <div class="moves"><span>MOVES ${used}/${p.moveLimit}</span>${Number.isFinite(remote) ? `<span class="remote" title="Remote ops #0118 may run on this attempt (undo or reset gives them back)">REMOTE ${remote}/${p.internMoves}</span>` : ''}<span class="pips">${Array.from({ length: p.moveLimit }, (_, i) => `<span class="${i < used ? 'used' : ''}"></span>`).join('')}</span></div>
      <div class="ops">${p.ops
        .map((op, i) => {
          const keyed = keyedLocked.includes(i);
          const label = keyed ? 'XOR ????' : opLabel(op);
          const hands = opHands(op);
          const [tag, tip] = HANDS_TAG[hands] ?? [];
          const title = keyed ? 'Keyed op: enter the override key' : tip;
          return `<button type="button" data-cmd="op" data-op="${i}" class="${hands === 'both' ? '' : `hands-${hands}`}" ${locked || keyed ? 'disabled' : ''} ${title ? `title="${esc(title)}"` : ''}>${esc(label)}${tag ? `<small>${tag}</small>` : ''}<kbd>${i + 1}</kbd></button>`;
        })
        .join('')}</div>
      ${
        keyedLocked.length && !p.solved
          ? `<form class="keyrow" data-op="${keyedLocked[0]}"><label>OVERRIDE KEY</label><input name="key" maxlength="32" placeholder="0x...." autocomplete="off" spellcheck="false" value="${esc(typedKey)}" /><button type="submit" ${powered ? '' : 'disabled'}>Enter</button></form>`
          : ''
      }
      <div class="trail">${trail}</div>`;
    root.insertAdjacentHTML(
      'beforeend',
      `${p.solved ? '<div class="banner ok">SECTOR RECOVERED</div>' : ''}
      ${!powered && !p.solved ? '<div class="banner lost">INSUFFICIENT POWER - DRIVE GEARGRIND.EXE</div>' : ''}
      ${p.failed ? '<div class="banner lost">SECTOR LOST - UNDO OR RESET</div>' : ''}
      ${frozen && !p.solved ? '<div class="banner lost">FROZEN FOR AUDIT</div>' : ''}
      <div class="banner noop" aria-live="polite">NO CHANGE - NO MOVE USED</div>
      <div class="actions">
        ${p.solved
          ? `<button type="button" data-cmd="open">Open ${esc(state.files[win.fileId].name)}</button>`
          : `<button type="button" data-cmd="undo" ${used && powered && !frozen ? '' : 'disabled'}>Undo <kbd>Z</kbd></button><button type="button" data-cmd="reset" ${used && powered && !frozen ? '' : 'disabled'}>Reset <kbd>R</kbd></button>`}
      </div>`,
    );
    // An op that changed nothing flashes the board (keyed on noop.seq, so each one flashes once).
    const seq = p.noop?.seq ?? 0;
    const seen = Number(root.dataset.noopSeq ?? seq);
    root.dataset.noopSeq = String(seq);
    if (seq > seen) {
      clearTimeout(root._noopTimer);
      root.classList.remove('noop');
      void root.offsetWidth;
      root.classList.add('noop');
      root._noopTimer = setTimeout(() => root.classList.remove('noop'), NOOP_MS);
    }
  },
};

// Keyboard shortcuts while a Bit Rot window is focused.
export const bitrotKey = (e, state, win, dispatch, ctx) => {
  const p = puzzleFor(state, win);
  if (!p) return false;
  const n = Number(e.key);
  if (Number.isInteger(n) && n >= 1 && n <= p.ops.length) pressOp(p, n - 1, { dispatch, intern: ctx?.intern });
  else if (e.key === 'z' || e.key === 'Z' || e.key === 'Backspace') dispatch(actions.undo(p.id));
  else if (e.key === 'r' || e.key === 'R') dispatch(actions.resetPuzzle(p.id));
  else return false;
  return true;
};
