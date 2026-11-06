// GEARGRIND.EXE: drive the generator to charge the mainframe.
// The simulation is pure (logic/gearbox.js). This file only does input, the canvas, audio, and
// a DRIVE_REPORT to the store four times a second. The 60 Hz sim never touches the store.
import { actions } from '../core/actions.js';
import { powerConfig, powerLevel, powerStatus } from '../core/power.js';
import { chargeStatus, FLASHES, gradeChanges, lookAhead, overlayStatus, wrapText } from '../logic/gearStatus.js';
import { advance, chargeBand, createSim, DEFAULT_GEAR_KEYS, forceStall, gradeAt, heightProfile, roadLength, sanitiseGearKeys } from '../logic/gearbox.js';

const KEYS_KEY = 'night-shift:gear-keys';
const HINT_KEY = 'night-shift:gg-hint-seen';
const REPORT_MS = 250;
const W = 500;
const H = 200;
const AHEAD_M = 240;
const BEHIND_M = 60;

const keyName = (code) =>
  ({ Space: 'Space', ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl', ArrowUp: 'Up', ArrowDown: 'Down' })[code] ??
  code.replace(/^(Key|Digit|Numpad)/, '');

const loadKeys = () => {
  try {
    return sanitiseGearKeys(JSON.parse(localStorage.getItem(KEYS_KEY)));
  } catch {
    return { ...DEFAULT_GEAR_KEYS };
  }
};

// Engine audio: one sawtooth oscillator pitched by rpm (two firing pulses per rev) through a low-pass.
const createEngineAudio = () => {
  const Ctx = window.AudioContext ?? window.webkitAudioContext;
  if (!Ctx) return null;
  const ac = new Ctx();
  const osc = ac.createOscillator();
  osc.type = 'sawtooth';
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  const gain = ac.createGain();
  gain.gain.value = 0;
  osc.connect(filter).connect(gain).connect(ac.destination);
  osc.start();
  return {
    update(rpm, running) {
      const t = ac.currentTime;
      osc.frequency.setTargetAtTime(Math.max(20, (rpm / 60) * 2), t, 0.03);
      filter.frequency.setTargetAtTime(300 + rpm / 5, t, 0.05);
      gain.gain.setTargetAtTime(running ? 0.05 : 0, t, 0.06);
    },
    grind() {
      const t = ac.currentTime;
      osc.detune.cancelScheduledValues(t);
      osc.detune.setValueAtTime(900, t);
      osc.detune.setTargetAtTime(0, t + 0.08, 0.04);
      gain.gain.setValueAtTime(0.1, t);
    },
    close() {
      ac.close().catch(() => {});
    },
  };
};

const controllers = new Map();


export const geargrindView = {
  title: () => 'GEARGRIND.EXE - Generator 2',
  icon: () => 'gear',

  init(body, win, ctx) {
    const cfg = ctx.gearbox;
    body.innerHTML = `
      <div class="geargrind" tabindex="0" data-clutch="out">
        <canvas width="${W}" height="${H}" aria-label="Generator road view"></canvas>
        <div class="gg-status" role="status" data-charging="no"></div>
        <div class="gg-power"><span class="lbl">MAINFRAME</span><div class="meter"><div class="fill"></div></div><span class="pct"></span></div>
        <div class="gg-controls">
          <button type="button" data-ctl="down">&#9660; Down <kbd data-key="down"></kbd></button>
          <button type="button" data-ctl="clutch">Clutch <kbd data-key="clutch"></kbd></button>
          <button type="button" data-ctl="up">&#9650; Up <kbd data-key="up"></kbd></button>
          <span class="spacer"></span>
          <button type="button" data-ctl="audio" aria-pressed="false">Sound: OFF</button>
          <button type="button" data-ctl="keys">Keys...</button>
          <button type="button" data-ctl="help" title="How to drive">?</button>
        </div>
        <div class="gg-help">Throttle is stuck open. Hold the clutch and tap up/down to change gear. Stalled? Hold the clutch to restart.</div>
        <div class="gg-hint" hidden>
          <div class="card">
            <b>GENERATOR 2: HOW TO CHARGE THE MAINFRAME</b>
            <p>Keep the rev needle in the green <b>CHARGE ZONE</b> and the mainframe charges. Out of the zone, it doesn't.</p>
            <ul>
              <li>The throttle is stuck open. You only work the clutch and gears.</li>
              <li>Hold <kbd data-key="clutch"></kbd> (clutch) and tap <kbd data-key="up"></kbd> to change up, <kbd data-key="down"></kbd> to change down.</li>
              <li>Climb ahead? Change down before you bog. Downhill? Change up before the limiter.</li>
              <li>Stalled? Hold the clutch to restart.</li>
            </ul>
            <p>The road keeps changing, so keep an eye on it while you work.</p>
            <button type="button" data-ctl="hint-ok">Got it</button>
          </div>
        </div>
      </div>`;
    const root = body.querySelector('.geargrind');
    const canvas = body.querySelector('canvas');
    const g = canvas.getContext('2d');
    const help = body.querySelector('.gg-help');
    const hint = body.querySelector('.gg-hint');
    const statusEl = body.querySelector('.gg-status');
    const c = {
      sim: createSim(cfg),
      carry: 0,
      keys: loadKeys(),
      clutchKey: false,
      clutchMouse: false,
      pending: { up: false, down: false },
      acc: { charge: 0, distance: 0, stalls: 0 },
      lastReport: 0,
      lastSent: '',
      lastStatus: 0,
      stallSeq: ctx.getState().power?.stallSeq ?? 0,
      flash: { text: '', until: 0 },
      rebinding: null,
      audio: null,
      paused: true,
      raf: 0,
      last: performance.now(),
      grab: null,
    };
    controllers.set(win.id, c);

    const showKeys = () => {
      body.querySelectorAll('kbd[data-key]').forEach((k) => (k.textContent = keyName(c.keys[k.dataset.key])));
      help.textContent = c.rebinding
        ? `Press a key for ${c.rebinding[0].toUpperCase()}... (Esc cancels)`
        : `Throttle is stuck open. Hold ${keyName(c.keys.clutch)} (clutch) and tap ${keyName(c.keys.up)} / ${keyName(c.keys.down)} to change gear. Keep the needle in the CHARGE ZONE. Stalled? Hold the clutch to restart.`;
    };
    showKeys();
    const flash = (text, ms = 1200) => (c.flash = { text, until: performance.now() + ms });

    let seenHint = false;
    try {
      seenHint = localStorage.getItem(HINT_KEY) === '1';
    } catch {}
    const showHint = (show) => {
      hint.hidden = !show;
      if (!show) {
        try {
          localStorage.setItem(HINT_KEY, '1');
        } catch {}
      }
    };
    showHint(!seenHint);

    // Keyboard goes wherever the player last clicked. Clicking anywhere on this window (title bar
    // included, which doesn't move focus by itself) takes it off any text box in another window.
    c.grab = () => {
      const active = document.activeElement;
      if (active && active !== root && !root.contains(active) && active.matches?.('input, textarea, [contenteditable="true"]')) active.blur();
      if (!root.contains(document.activeElement)) root.focus({ preventScroll: true });
    };
    const frameEl = body.closest('.window') ?? body;
    frameEl.addEventListener('pointerdown', (e) => {
      if (e.button === 0) queueMicrotask(c.grab);
    }, true);

    const focused = () => {
      const st = ctx.getState();
      return st.focusedWindowId === win.id && st.phase === 'desktop' && !st.alert;
    };
    const isGearKey = (code) => code === c.keys.clutch || code === c.keys.up || code === c.keys.down;
    const onKeyDown = (e) => {
      if (c.rebinding) {
        if (!focused()) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.code === 'Escape') c.rebinding = null;
        else {
          c.rebinding.keys[c.rebinding[0]] = e.code;
          c.rebinding.shift();
          if (!c.rebinding.length) {
            const next = sanitiseGearKeys(c.rebinding.keys);
            if (next.clutch !== c.rebinding.keys.clutch || next.up !== c.rebinding.keys.up || next.down !== c.rebinding.keys.down) flash(FLASHES.clash, 2000);
            c.keys = next;
            localStorage.setItem(KEYS_KEY, JSON.stringify(next));
            c.rebinding = null;
          }
        }
        showKeys();
        return;
      }
      // While this window has focus its keys are ours, even if a text box elsewhere still has the caret.
      if (!focused() || !isGearKey(e.code)) return;
      e.preventDefault();
      e.stopPropagation();
      if (document.activeElement?.matches?.('input, textarea') && !root.contains(document.activeElement)) c.grab();
      if (!hint.hidden) {
        showHint(false);
        return;
      }
      if (e.code === c.keys.clutch) c.clutchKey = true;
      else if (e.code === c.keys.up) !e.repeat && (c.pending.up = true);
      else if (e.code === c.keys.down) !e.repeat && (c.pending.down = true);
    };
    const onKeyUp = (e) => {
      if (!isGearKey(e.code)) return;
      if (e.code === c.keys.clutch) c.clutchKey = false;
      if (focused()) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onBlur = () => {
      c.clutchKey = false;
      c.clutchMouse = false;
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);

    const clutchBtn = body.querySelector('[data-ctl="clutch"]');
    clutchBtn.addEventListener('pointerdown', (e) => {
      c.clutchMouse = true;
      clutchBtn.setPointerCapture?.(e.pointerId);
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) clutchBtn.addEventListener(ev, () => (c.clutchMouse = false));
    body.querySelector('.gg-controls').addEventListener('click', (e) => {
      const ctl = e.target.closest('button')?.dataset.ctl;
      if (ctl === 'up' || ctl === 'down') c.pending[ctl] = true;
      else if (ctl === 'audio') {
        if (c.audio) {
          c.audio.close();
          c.audio = null;
        } else c.audio = createEngineAudio();
        e.target.closest('button').textContent = `Sound: ${c.audio ? 'ON' : 'OFF'}`;
        e.target.closest('button').setAttribute('aria-pressed', String(!!c.audio));
      } else if (ctl === 'keys') {
        c.rebinding = Object.assign(['clutch', 'down', 'up'], { keys: { ...c.keys } });
        showKeys();
      } else if (ctl === 'help') showHint(true);
      // Keep the keyboard on the window, not the button (Space would click it again).
      root.focus({ preventScroll: true });
    });
    hint.querySelector('[data-ctl="hint-ok"]').addEventListener('click', () => {
      showHint(false);
      root.focus({ preventScroll: true });
    });

    const report = (now, force = false) => {
      const s = c.sim;
      const gen = { running: s.running && !c.paused, stalled: s.stalled, gear: s.gear, rpm: s.running && !c.paused ? Math.round(s.rpm / 50) * 50 : 0 };
      const sig = JSON.stringify(gen);
      const { charge, distance, stalls } = c.acc;
      if (!force && !charge && !distance && !stalls && sig === c.lastSent) return;
      c.lastReport = now;
      c.lastSent = sig;
      c.acc = { charge: 0, distance: 0, stalls: 0 };
      ctx.dispatch(actions.driveReport({ charge, distance, stalls, ...gen }));
    };

    const stop = () => {
      cancelAnimationFrame(c.raf);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
      c.audio?.close();
      controllers.delete(win.id);
      c.sim = { ...c.sim, running: false, stalled: false, gear: 0, rpm: 0 };
      c.paused = true;
      report(performance.now(), true);
    };

    const frame = (now) => {
      if (!body.isConnected) return stop();
      const dt = (now - c.last) / 1000;
      c.last = now;
      const st = ctx.getState();
      c.paused = st.phase !== 'desktop' || !!st.alert || document.hidden || !!body.closest('.window')?.hidden || !hint.hidden;
      const clutch = c.clutchKey || c.clutchMouse;
      if (!c.paused) {
        const before = c.sim;
        const r = advance(before, { clutch, ...c.pending }, dt, cfg, c.carry);
        if (r.applied) c.pending = { up: false, down: false };
        c.sim = r.sim;
        c.carry = r.carry;
        c.acc.charge += r.sim.charge - before.charge;
        c.acc.distance += r.sim.x - before.x;
        c.acc.stalls += r.sim.stalls - before.stalls;
        for (const ev of r.events) {
          if (ev.type === 'grind') {
            flash(FLASHES.grind);
            c.audio?.grind();
          } else if (ev.type === 'stall') flash(FLASHES.stall(ev.why), 2000);
          else if (ev.type === 'start') flash(FLASHES.start);
        }
      } else c.pending = { up: false, down: false };
      if (now - c.lastReport >= REPORT_MS) report(now);
      const clutchAttr = clutch ? 'in' : 'out';
      if (root.dataset.clutch !== clutchAttr) root.dataset.clutch = clutchAttr;
      clutchBtn.classList.toggle('pressed', clutch);
      if (now - c.lastStatus >= 200) {
        c.lastStatus = now;
        const [kind, text] = chargeStatus(cfg, c.sim, c.paused, st);
        c.statusKind = kind;
        if (statusEl.dataset.text !== text) {
          // The drain half wraps as one piece, so a narrow window breaks the line at the bar.
          const [main, drain] = text.split(' | ');
          statusEl.dataset.text = text;
          statusEl.textContent = main;
          if (drain) {
            const span = document.createElement('span');
            span.className = 'drain';
            span.textContent = ` | ${drain}`;
            statusEl.append(' ', span);
          }
        }
        if (statusEl.dataset.charging !== kind) statusEl.dataset.charging = kind;
      }
      draw(g, cfg, c, now);
      c.audio?.update(c.sim.rpm, c.sim.running && !c.paused);
      c.raf = requestAnimationFrame(frame);
    };
    c.raf = requestAnimationFrame(frame);
  },

  render(body, state, prev, win) {
    const c = controllers.get(win.id);
    // Focused from anywhere (taskbar, opening it, a click): take the keyboard.
    if (c && state.focusedWindowId === win.id && prev?.focusedWindowId !== win.id) queueMicrotask(() => c.grab?.());
    const seq = state.power?.stallSeq ?? 0;
    if (c && seq !== c.stallSeq) {
      c.stallSeq = seq;
      if (c.sim.running) {
        c.sim = forceStall(c.sim, 'surge');
        c.acc.stalls++;
        c.flash = { text: FLASHES.stall('surge'), until: performance.now() + 2500 };
      }
    }
    if (prev && prev.power === state.power) return;
    const level = powerLevel(state);
    const fill = body.querySelector('.gg-power .fill');
    fill.style.width = `${Math.max(0, Math.min(100, level))}%`;
    body.querySelector('.gg-power').dataset.status = powerStatus(state);
    body.querySelector('.gg-power .pct').textContent = `${Math.ceil(level)}%`;
  },
};

const draw = (g, cfg, c, now) => {
  const s = c.sim;
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  const pxPerM = W / (AHEAD_M + BEHIND_M);
  const vScale = pxPerM * 1.5;
  const baseY = 128;
  const prof = heightProfile(cfg.road, s.x - BEHIND_M, s.x + AHEAD_M, 61);
  const carIdx = Math.round((BEHIND_M / (AHEAD_M + BEHIND_M)) * 60);
  const h0 = prof[carIdx].h;
  const pts = prof.map((p) => [(p.x - (s.x - BEHIND_M)) * pxPerM, baseY - (p.h - h0) * vScale]);

  // Road.
  g.beginPath();
  g.moveTo(0, H);
  pts.forEach(([x, y]) => g.lineTo(x, y));
  g.lineTo(W, H);
  g.closePath();
  g.fillStyle = '#062010';
  g.fill();
  // Road surface coloured by grade: amber climbs, cyan descents.
  g.lineWidth = 3;
  for (let i = 1; i < pts.length; i++) {
    const gr = gradeAt(cfg.road, prof[i].x);
    g.strokeStyle = gradeColour(gr);
    g.beginPath();
    g.moveTo(...pts[i - 1]);
    g.lineTo(...pts[i]);
    g.stroke();
  }

  // Signposts where the grade changes ahead.
  const changes = gradeChanges(cfg.road, s.x + 4, s.x + AHEAD_M);
  g.font = 'bold 11px "Courier New", monospace';
  g.textBaseline = 'bottom';
  for (const ch of changes) {
    const px = (ch.x - (s.x - BEHIND_M)) * pxPerM;
    const i = Math.max(0, Math.min(pts.length - 1, Math.round(px / (W / (pts.length - 1)))));
    const py = pts[i][1];
    g.fillStyle = '#808080';
    g.fillRect(px, py - 22, 1, 22);
    g.fillStyle = gradeColour(ch.grade);
    const label = `${ch.grade > 0.005 ? '\u25B2' : ch.grade < -0.005 ? '\u25BC' : '\u25B6'}${Math.round(Math.abs(ch.grade) * 100)}%`;
    g.fillText(label, Math.max(2, Math.min(px + 3, W - g.measureText(label).width - 2)), py - 12);
  }
  g.textBaseline = 'top';

  // The cart.
  const [cx, cy] = pts[carIdx];
  g.save();
  g.translate(cx, cy);
  g.rotate(-Math.atan(s.grade * 1.5));
  g.fillStyle = s.stalled ? '#ffb000' : '#c0c0c0';
  g.fillRect(-16, -14, 32, 10);
  g.fillStyle = '#808080';
  g.fillRect(-8, -20, 14, 6);
  g.fillStyle = '#000';
  g.strokeStyle = '#c0c0c0';
  for (const wx of [-10, 10]) {
    g.beginPath();
    g.arc(wx, -4, 4, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  g.restore();

  // HUD.
  g.font = 'bold 34px "Courier New", monospace';
  g.fillStyle = '#33ff66';
  g.textBaseline = 'top';
  g.fillText(s.gear ? String(s.gear) : 'N', 10, 6);
  g.font = '13px "Courier New", monospace';
  const pct = (gr) => `${gr > 0 ? '+' : ''}${Math.round(gr * 100)}%`;
  const band = s.running && !s.clutch && s.gear ? chargeBand(cfg, s.rpm) : 0;
  const left = [`${Math.round(s.v * 3.6)} km/h`, `grade ${pct(s.grade)}`, `charge ${'#'.repeat(Math.round(band * 5)).padEnd(5, '.')}`];
  left.slice(0, 2).forEach((t, i) => g.fillText(t, 44, 10 + i * 16));
  g.fillStyle = band > 0.8 ? '#33ff66' : band > 0.3 ? '#ffb000' : '#6a3c00';
  g.fillText(left[2], 44, 42);
  const ahead = lookAhead(cfg, s, c.statusKind);
  if (ahead) {
    const right = W - 8;
    const room = right - (44 + Math.max(...left.map((t) => g.measureText(t).width)) + 16);
    const lines = [ahead.text, ...(ahead.advice ? [`-> ${ahead.advice}`] : [])].flatMap((t) => wrapText(t, room, (x) => g.measureText(x).width));
    g.fillStyle = Math.abs(ahead.steeper) > 0.03 ? gradeColour(ahead.grade) : '#1d6a35';
    g.textAlign = 'right';
    lines.slice(0, 3).forEach((t, i) => g.fillText(t, right, 10 + i * 16));
    g.textAlign = 'left';
  }

  // Tachometer with the CHARGE ZONE marked.
  const tx = 10;
  const ty = H - 18;
  const tw = W - 20;
  const max = cfg.blowRpm;
  const at = (rpm) => tx + (Math.min(rpm, max) / max) * tw;
  const [zlo, zhi] = cfg.sweetBand;
  const inZone = band >= 0.95;
  g.fillStyle = '#111';
  g.fillRect(tx, ty, tw, 14);
  g.fillStyle = inZone ? '#1f7a3a' : '#145c2c';
  g.fillRect(at(zlo), ty, at(zhi) - at(zlo), 14);
  g.fillStyle = '#5a0000';
  g.fillRect(at(cfg.redline), ty, tx + tw - at(cfg.redline), 14);
  g.fillStyle = s.rpm >= cfg.redline ? '#ff3030' : s.lug > 0 ? '#ffb000' : inZone ? '#a0ffb8' : '#33ff66';
  g.fillRect(tx, ty + 4, Math.max(0, at(s.rpm) - tx), 6);
  g.fillStyle = '#fff';
  g.fillRect(at(s.rpm) - 1, ty - 2, 2, 18);
  g.font = 'bold 10px "Courier New", monospace';
  g.textBaseline = 'bottom';
  g.fillStyle = inZone ? '#a0ffb8' : '#33ff66';
  const zl = 'CHARGE ZONE';
  g.fillText(zl, (at(zlo) + at(zhi) - g.measureText(zl).width) / 2, ty - 1);
  g.fillStyle = '#a04040';
  g.fillText('REDLINE', at(cfg.redline) + 2, ty - 1);
  g.fillStyle = '#808080';
  g.fillText(`${Math.round(s.rpm)} rpm`, tx, ty - 1);
  g.textBaseline = 'top';

  // Status line.
  const status = overlayStatus(s, { paused: c.paused, flash: now < c.flash.until ? c.flash.text : '', clutchHeld: c.clutchKey || c.clutchMouse });
  if (status) {
    g.font = 'bold 16px "Courier New", monospace';
    const lines = wrapText(status, W - 24, (x) => g.measureText(x).width);
    const w = Math.max(...lines.map((t) => g.measureText(t).width));
    g.fillStyle = 'rgba(0,0,0,0.7)';
    g.fillRect((W - w) / 2 - 6, 60, w + 12, 4 + lines.length * 18);
    g.fillStyle = /STALL|GRIND|BOG|LIMIT|CLASH/.test(status) ? '#ffb000' : '#33ff66';
    lines.forEach((t, i) => g.fillText(t, (W - g.measureText(t).width) / 2, 63 + i * 18));
  }
};


const gradeColour = (gr) => (gr >= 0.1 ? '#ff7a30' : gr >= 0.05 ? '#ffb000' : gr <= -0.08 ? '#30c8ff' : gr <= -0.03 ? '#80e0ff' : '#33ff66');

