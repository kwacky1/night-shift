// Boot sequence and the clock-in time card. Purely presentational; the only state changes
// are BOOT_COMPLETE and CLOCK_IN.
import { actions } from '../core/actions.js';
import { el } from './dom.js';

const LOGO = String.raw`
  _   _ ___ ____ _   _ _____     ____  _   _ ___ _____ _____
 | \ | |_ _/ ___| | | |_   _|   / ___|| | | |_ _|  ___|_   _|
 |  \| || | |  _| |_| | | |     \___ \| |_| || || |_    | |
 | |\  || | |_| |  _  | | |      ___) |  _  || ||  _|   | |
 |_| \_|___\____|_| |_| |_|_____|____/|_| |_|___|_|     |_|
                          |_____|                    .EXE`;

const LINES = [
  ['ACME DATAWORKS BIOS v4.51PG  (C) 1994', false],
  ['CPU: 486DX2-66   MEMORY TEST: 16384K', true],
  ['Detecting IDE drives ... C: 540MB', true],
  ['Loading HIMEM.SYS', true],
  ['Mounting PAYROLL volume ... 1 bad sector', false],
  ['Starting generator watchdog', true],
  ['Loading NIGHTOS shell', true],
];

let bootTimers = [];
let bootStarted = false;
let skipHandler = null;

const stopSkipListening = () => {
  if (!skipHandler) return;
  window.removeEventListener('keydown', skipHandler);
  window.removeEventListener('pointerdown', skipHandler);
  skipHandler = null;
};

const finishBoot = (dispatch) => {
  bootTimers.forEach(clearTimeout);
  bootTimers = [];
  stopSkipListening();
  dispatch(actions.bootComplete());
};

export const renderBoot = (root, state, dispatch) => {
  // Boot can also end without finishBoot (a loaded save, DevTools); don't keep eating keys.
  if (state.phase !== 'boot') {
    bootTimers.forEach(clearTimeout);
    bootTimers = [];
    stopSkipListening();
    return;
  }
  if (bootStarted) return;
  bootStarted = true;
  root.innerHTML = '';
  let t = 200;
  for (const [text, ok] of LINES) {
    bootTimers.push(setTimeout(() => root.append(el('div', `boot-line${ok ? ' ok' : ''}`, text)), t));
    t += 260 + Math.random() * 200;
  }
  bootTimers.push(setTimeout(() => root.append(el('pre', 'boot-logo', LOGO)), t));
  bootTimers.push(setTimeout(() => root.append(el('div', 'boot-line cursor', 'C:\\> ')), t + 300));
  bootTimers.push(setTimeout(() => finishBoot(dispatch), t + 1400));
  root.append(el('div', 'boot-skip', 'press any key to skip'));
  skipHandler = (e) => {
    e.preventDefault();
    finishBoot(dispatch);
  };
  window.addEventListener('keydown', skipHandler);
  window.addEventListener('pointerdown', skipHandler);
};

export const renderClockIn = (root, state, dispatch) => {
  if (state.phase !== 'clockin' || root.dataset.ready) return;
  root.dataset.ready = '1';
  root.innerHTML = `
    <div class="timecard">
      <h1>ACME DATAWORKS - TIME CARD</h1>
      <dl>
        <dt>BADGE</dt><dd>#0117</dd>
        <dt>ROLE</dt><dd>NIGHT SYSADMIN</dd>
        <dt>DATE</dt><dd>MON 03/11/1997</dd>
        <dt>SHIFT</dt><dd>22:00 - 06:00</dd>
      </dl>
      <div class="punch">22:00</div>
      <button type="button" class="clock-in">[ CLOCK IN ]</button>
    </div>`;
  const btn = root.querySelector('.clock-in');
  btn.addEventListener('click', () => dispatch(actions.clockIn()));
  // Let the boot "any key" release first so it does not punch the card straight away.
  setTimeout(() => btn.focus(), 50);
};
