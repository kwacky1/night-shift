// Taskbar (start button, window buttons, tray clock), start menu and the modal alert box.
import { actions } from '../core/actions.js';
import { clockLabel, unreadForPlayer } from '../core/selectors.js';
import { isBrownout, powerLevel, powerStatus } from '../core/power.js';
import { esc, ui } from './dom.js';
import { iconSvg } from './icons.js';
import { titleFor, iconForWindow } from './windows.js';

const MENU = [
  { id: 'readme', label: 'Read Me', icon: 'text' },
  { id: 'drive', label: 'C: Drive', icon: 'drive' },
  { id: 'payroll', label: 'PAYROLL.DAT', icon: 'corrupt' },
  { id: 'intern', label: 'INTERN.EXE', icon: 'system' },
  { id: 'geargrind', label: 'GEARGRIND.EXE', icon: 'gear' },
  { sep: true },
  { act: 'reset', label: 'Shut Down (wipe save)...', icon: 'system' },
];

export const initTaskbar = (bar, menu, ctx) => {
  bar.innerHTML = `
    <button type="button" class="start"><span class="moon">&#9790;</span>Start</button>
    <div class="tasks"></div>
    <div class="tray"><button type="button" class="power" title="Mainframe power. Open GEARGRIND.EXE to charge it.">PWR</button><button type="button" class="intern" title="Open INTERN.EXE">INTERN: SCRIPTED</button><span class="clock"></span></div>`;
  menu.className = 'raised';
  menu.innerHTML = `<div class="stripe">NightOS 3.11</div><ul>${MENU.map((m) =>
    m.sep ? '<li class="sep"></li>' : `<li data-open="${m.id ?? ''}" data-act="${m.act ?? ''}">${iconSvg(m.icon)}${esc(m.label)}</li>`,
  ).join('')}</ul>`;

  const setMenu = (open) => {
    ui.startMenuOpen = open;
    menu.hidden = !open;
    bar.querySelector('.start').classList.toggle('pressed', open);
  };
  bar.querySelector('.start').addEventListener('click', (e) => {
    e.stopPropagation();
    setMenu(!ui.startMenuOpen);
  });
  menu.addEventListener('click', (e) => {
    const item = e.target.closest('li[data-open]');
    if (!item) return;
    setMenu(false);
    if (item.dataset.act === 'reset') ctx.reset();
    else if (item.dataset.open && ctx.getState().files[item.dataset.open]) ctx.dispatch(actions.openFile(item.dataset.open));
  });
  window.addEventListener('pointerdown', (e) => {
    if (ui.startMenuOpen && !e.target.closest('#start-menu, #taskbar .start')) setMenu(false);
  });

  bar.querySelector('.tray .intern').addEventListener('click', () => {
    if (ctx.getState().files.intern) ctx.dispatch(actions.openFile('intern'));
  });
  bar.querySelector('.tray .power').addEventListener('click', () => {
    if (ctx.getState().files.geargrind) ctx.dispatch(actions.openFile('geargrind'));
  });

  bar.querySelector('.tasks').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-win]');
    if (!btn) return;
    const state = ctx.getState();
    const win = state.windows.find((w) => w.id === btn.dataset.win);
    if (!win) return;
    if (state.focusedWindowId === win.id && !win.minimised) ctx.dispatch(actions.minimiseWindow(win.id));
    else ctx.dispatch(actions.focusWindow(win.id));
  });
};

export const renderTaskbar = (bar, state, prev) => {
  const clock = bar.querySelector('.clock');
  const label = clockLabel(state);
  if (clock.textContent !== label) clock.textContent = label;
  const intern = bar.querySelector('.intern');
  const unread = unreadForPlayer(state);
  const mode = ui.internStatus === 'taken' ? 'LINE TAKEN' : isBrownout(state) ? 'BROWNOUT' : ({ online: 'ONLINE', connecting: 'DIALLING' }[ui.internStatus] ?? 'SCRIPTED');
  const text = `INTERN: ${mode}${unread ? ` (${unread})` : ''}`;
  if (intern.textContent !== text) intern.textContent = text;
  intern.dataset.status = ui.internStatus;
  intern.classList.toggle('online', ui.internStatus === 'online');
  intern.classList.toggle('taken', ui.internStatus === 'taken');
  intern.classList.toggle('unread', unread > 0);
  const power = bar.querySelector('.power');
  const status = powerStatus(state);
  const word = { flicker: ' LOW', brownout: ' BROWNOUT', critical: ' CRITICAL' }[status] ?? '';
  const powerText = `PWR ${Math.ceil(powerLevel(state))}%${word}${state.power?.generator?.stalled ? ' STALL' : ''}`;
  if (power.textContent !== powerText) power.textContent = powerText;
  if (power.dataset.status !== status) {
    power.dataset.status = status;
    power.title = {
      ok: 'Mainframe power. Open GEARGRIND.EXE to charge it.',
      flicker: 'Mainframe power is low. Drive GEARGRIND.EXE before the brownout.',
      brownout: 'BROWNOUT: the intern line is down. Drive GEARGRIND.EXE now.',
      critical: 'CRITICAL: Bit Rot is offline. Drive GEARGRIND.EXE or the mainframe goes dark.',
    }[status] ?? power.title;
  }
  if (prev && prev.windows === state.windows && prev.focusedWindowId === state.focusedWindowId && prev.files === state.files) return;
  bar.querySelector('.tasks').innerHTML = [...state.windows]
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
    .map((w) => {
      const active = state.focusedWindowId === w.id && !w.minimised;
      return `<button type="button" data-win="${esc(w.id)}" class="${active ? 'active pressed' : ''}">${iconSvg(iconForWindow(state, w))}<span>${esc(titleFor(state, w))}</span></button>`;
    })
    .join('');
};

export const renderAlert = (root, state, prev, ctx) => {
  if (prev && prev.alert === state.alert) return;
  root.hidden = !state.alert;
  if (!state.alert) {
    root.innerHTML = '';
    return;
  }
  root.innerHTML = `
    <div class="window raised focused" role="alertdialog" aria-modal="true">
      <div class="titlebar"><span class="title">${esc(state.alert.title)}</span></div>
      <div class="message"><span class="glyph">!</span><div>${esc(state.alert.text)}</div></div>
      <div class="buttons"><button type="button">OK</button></div>
    </div>`;
  const ok = root.querySelector('button');
  ok.addEventListener('click', () => ctx.dispatch(actions.dismissAlert()));
  // Defer so the keypress that raised the alert cannot also "click" OK.
  setTimeout(() => ok.isConnected && ok.focus(), 0);
};
