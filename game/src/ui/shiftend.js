// End-of-shift screen (06:00 or a blackout): a summary and a way back in. Never a dead end.
import { esc } from './dom.js';

const INTERN_LINE = {
  ai: (n) => `AI intern on the line (${n} action${n === 1 ? '' : 's'})`,
  scripted: (n) => `Scripted intern (${n} repl${n === 1 ? 'y' : 'ies'})`,
  none: () => 'Not used. #0118 sat there all night.',
};

const LEVEL_NAMES = ['GUEST', 'PROBATION', 'OPERATOR', 'SUPERVISOR'];

export const renderShiftEnd = (root, state, prev, ctx) => {
  if (state.phase !== 'over') {
    if (root.innerHTML) root.innerHTML = '';
    return;
  }
  if (prev && prev.phase === 'over' && prev.shiftEnd === state.shiftEnd) return;
  const end = state.shiftEnd ?? { reason: 'clock', at: '06:00', summary: {} };
  const s = end.summary ?? {};
  const blackout = end.reason === 'blackout';
  const internLine = (INTERN_LINE[s.intern?.mode] ?? INTERN_LINE.none)(s.intern?.count ?? 0);
  root.innerHTML = `
    <div class="shiftend-card${blackout ? ' blackout' : ''}">
      <h1>${blackout ? 'BLACKOUT' : 'SHIFT OVER'}</h1>
      <p class="why">${
        blackout
          ? `${esc(end.at)}. The generator ran dry and the mainframe went down with it. Facilities will want a word.`
          : '06:00. The day crew are pulling into the car park.'
      }</p>
      <dl>
        <dt>SHIFT</dt><dd>#${esc(state.shiftNumber ?? 1)}, ended ${esc(end.at)}</dd>
        <dt>SECTORS RECOVERED</dt><dd>${esc(s.puzzlesSolved ?? 0)} / ${esc(s.puzzlesTotal ?? 0)}</dd>
        <dt>MAINFRAME POWER</dt><dd>${esc(s.power ?? 0)}% (lowest ${esc(s.lowestPower ?? 0)}%)</dd>
        <dt>GENERATOR</dt><dd>${esc(s.distanceKm ?? 0)} km driven, ${esc(s.stalls ?? 0)} stall${s.stalls === 1 ? '' : 's'}</dd>
        <dt>INTERN #0118</dt><dd>${esc(internLine)}, cleared to ${esc(LEVEL_NAMES[s.internLevel] ?? '?')}</dd>
      </dl>
      <p class="teaser">PAYROLL RUN: 06:00. HEAD OFFICE AUDIT: PENDING.<br />Somebody is going to have to explain tonight.</p>
      <button type="button" class="new-shift">[ CLOCK IN FOR ANOTHER SHIFT ]</button>
    </div>`;
  const btn = root.querySelector('.new-shift');
  btn.addEventListener('click', () => ctx.newShift());
  setTimeout(() => btn.isConnected && btn.focus(), 50);
};
