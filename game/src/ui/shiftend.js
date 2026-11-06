// End-of-shift screen (the audit, 06:00 or a blackout): a summary and a way back in. Never a dead end.
// After the audit it shows the ending reached and the endings found across every shift.
import { esc } from './dom.js';
import { suspectName } from '../core/blame.js';

const INTERN_LINE = {
  ai: (n) => `AI intern on the line (${n} action${n === 1 ? '' : 's'})`,
  scripted: (n) => `Scripted intern (${n} line${n === 1 ? '' : 's'} and favour${n === 1 ? '' : 's'})`,
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
  const ending = end.reason === 'audit' ? end.ending : null;
  const b = state.blame;
  const blamed = (side, who) => {
    const sub = b?.[side];
    if (!sub) return '';
    return `<dt>${who} BLAMED</dt><dd>${esc(suspectName(b.config, sub.suspect))}${sub.statement ? ` <q>${esc(sub.statement)}</q>` : ''}${sub.scripted ? ' (scripted)' : ''}</dd>`;
  };
  const found = ctx.endings?.() ?? { found: [], all: [] };
  const tally = found.all.length
    ? `<div class="endings"><b>ENDINGS FOUND ${found.found.length}/${found.all.length}</b><ul>${found.all
        .map((e) => `<li class="${found.found.includes(e.id) ? 'got' : ''}${ending?.id === e.id ? ' now' : ''}">${found.found.includes(e.id) ? esc(e.title) : '????'}</li>`)
        .join('')}</ul></div>`
    : '';
  root.innerHTML = `
    <div class="shiftend-card${blackout ? ' blackout' : ''}">
      <h1>${ending ? esc(ending.title) : blackout ? 'BLACKOUT' : 'SHIFT OVER'}</h1>
      <p class="why">${
        ending
          ? esc(ending.text)
          : blackout
          ? `${esc(end.at)}. The generator ran dry and the mainframe went down with it. Facilities will want a word.`
          : '06:00. The day crew are pulling into the car park.'
      }</p>
      <dl>
        <dt>SHIFT</dt><dd>#${esc(state.shiftNumber ?? 1)}, ended ${esc(end.at)}</dd>
        <dt>SECTORS RECOVERED</dt><dd>${esc(s.puzzlesSolved ?? 0)} / ${esc(s.puzzlesTotal ?? 0)}</dd>
        <dt>MAINFRAME POWER</dt><dd>${esc(s.power ?? 0)}% (lowest ${esc(s.lowestPower ?? 0)}%)</dd>
        <dt>GENERATOR</dt><dd>${esc(s.distanceKm ?? 0)} km driven, ${esc(s.stalls ?? 0)} stall${s.stalls === 1 ? '' : 's'}</dd>
        <dt>INTERN #0118</dt><dd>${esc(internLine)}, cleared to ${esc(LEVEL_NAMES[s.internLevel] ?? '?')}</dd>
        ${ending ? blamed('player', 'YOU') + blamed('intern', '#0118') : ''}
      </dl>
      ${ending ? tally : '<p class="teaser">PAYROLL RUN: 06:00. HEAD OFFICE AUDIT: PENDING.<br />Somebody is going to have to explain tonight.</p>'}
      <button type="button" class="new-shift">[ CLOCK IN FOR ANOTHER SHIFT ]</button>
    </div>`;
  const btn = root.querySelector('.new-shift');
  btn.addEventListener('click', () => ctx.newShift());
  setTimeout(() => btn.isConnected && btn.focus(), 50);
};
