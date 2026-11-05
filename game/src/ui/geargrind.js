// GEARGRIND.EXE: drive the generator to charge the mainframe.
// The simulation is pure (logic/gearbox.js). This file only does input, the canvas, audio, and
// a DRIVE_REPORT to the store four times a second. The 60 Hz sim never touches the store.
import { actions } from '../core/actions.js';
import { powerLevel, powerStatus } from '../core/power.js';
import { advance, chargeBand, createSim, DEFAULT_GEAR_KEYS, forceStall, gradeAt, heightProfile, sanitiseGearKeys } from '../logic/gearbox.js';

const KEYS_KEY = 'night-shift:gear-keys';
const REPORT_MS = 250;
const W = 500;
const H = 200;
const AHEAD_M = 240;
const BEHIND_M = 60;
const STALL_WORDS = { bog: 'BOGGED DOWN', 'over-rev': 'OVER-REVVED', surge: 'POWER SURGE' };

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
      <div class="geargrind">
        <canvas width="${W}" height="${H}" aria-label="Generator road view"></canvas>
        <div class="gg-power"><span class="lbl">MAINFRAME</span><div class="meter"><div class="fill"></div></div><span class="pct"></span></div>
        <div class="gg-controls">
          <button type="button" data-ctl="down">&#9660; Down <kbd data-key="down"></kbd></button>
          <button type="button" data-ctl="clutch">Clutch <kbd data-key="clutch"></kbd></button>
          <button type="button" data-ctl="up">&#9650; Up <kbd data-key="up"></kbd></button>
          <span class="spacer"></span>
          <button type="button" data-ctl="audio" aria-pressed="false">Sound: OFF</button>
          <button type="button" data-ctl="keys">Keys...</button>
        </div>
        <div class="gg-help">Throttle is stuck open. Hold the clutch and tap up/down to change gear. Stalled? Hold the clutch to restart.</div>
      </div>`;
    const canvas = body.querySelector('canvas');
    const g = canvas.getContext('2d');
    const help = body.querySelector('.gg-help');
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
      stallSeq: ctx.getState().power?.stallSeq ?? 0,
      flash: { text: '', until: 0 },
      rebinding: null,
      audio: null,
      paused: true,
      raf: 0,
      last: performance.now(),
    };
    controllers.set(win.id, c);

    const showKeys = () => {
      body.querySelectorAll('kbd[data-key]').forEach((k) => (k.textContent = keyName(c.keys[k.dataset.key])));
      help.textContent = c.rebinding
        ? `Press a key for ${c.rebinding[0].toUpperCase()}... (Esc cancels)`
        : `Throttle is stuck open. Hold ${keyName(c.keys.clutch)} (clutch) and tap ${keyName(c.keys.up)} / ${keyName(c.keys.down)} to change gear. Stalled? Hold the clutch to restart.`;
    };
    showKeys();
    const flash = (text, ms = 1200) => (c.flash = { text, until: performance.now() + ms });

    const focused = () => {
      const st = ctx.getState();
      return st.focusedWindowId === win.id && st.phase === 'desktop' && !st.alert;
    };
    const onKeyDown = (e) => {
      if (c.rebinding) {
        e.preventDefault();
        e.stopPropagation();
        if (e.code === 'Escape') c.rebinding = null;
        else {
          c.rebinding.keys[c.rebinding[0]] = e.code;
          c.rebinding.shift();
          if (!c.rebinding.length) {
            const next = sanitiseGearKeys(c.rebinding.keys);
            if (next.clutch !== c.rebinding.keys.clutch || next.up !== c.rebinding.keys.up || next.down !== c.rebinding.keys.down) flash('KEYS CLASH - DEFAULTS RESTORED', 2000);
            c.keys = next;
            localStorage.setItem(KEYS_KEY, JSON.stringify(next));
            c.rebinding = null;
          }
        }
        showKeys();
        return;
      }
      if (!focused() || e.target.closest?.('input, textarea')) return;
      if (e.code === c.keys.clutch) c.clutchKey = true;
      else if (e.code === c.keys.up) !e.repeat && (c.pending.up = true);
      else if (e.code === c.keys.down) !e.repeat && (c.pending.down = true);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onKeyUp = (e) => {
      if (e.code !== c.keys.clutch) return;
      c.clutchKey = false;
      if (focused()) e.preventDefault();
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
      }
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
      c.paused = st.phase !== 'desktop' || !!st.alert || document.hidden || !!body.closest('.window')?.hidden;
      if (!c.paused) {
        const before = c.sim;
        const r = advance(before, { clutch: c.clutchKey || c.clutchMouse, ...c.pending }, dt, cfg, c.carry);
        if (r.applied) c.pending = { up: false, down: false };
        c.sim = r.sim;
        c.carry = r.carry;
        c.acc.charge += r.sim.charge - before.charge;
        c.acc.distance += r.sim.x - before.x;
        c.acc.stalls += r.sim.stalls - before.stalls;
        for (const ev of r.events) {
          if (ev.type === 'grind') {
            flash('GRRRIND! CLUTCH FIRST');
            c.audio?.grind();
          } else if (ev.type === 'stall') flash(`STALLED: ${STALL_WORDS[ev.why] ?? ev.why}`, 2000);
          else if (ev.type === 'start') flash('ENGINE STARTED');
        }
      } else c.pending = { up: false, down: false };
      if (now - c.lastReport >= REPORT_MS) report(now);
      draw(g, cfg, c, now);
      c.audio?.update(c.sim.rpm, c.sim.running && !c.paused);
      c.raf = requestAnimationFrame(frame);
    };
    c.raf = requestAnimationFrame(frame);
  },

  render(body, state, prev, win) {
    const c = controllers.get(win.id);
    const seq = state.power?.stallSeq ?? 0;
    if (c && seq !== c.stallSeq) {
      c.stallSeq = seq;
      if (c.sim.running) {
        c.sim = forceStall(c.sim, 'surge');
        c.acc.stalls++;
        c.flash = { text: 'STALLED: POWER SURGE', until: performance.now() + 2500 };
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
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.strokeStyle = '#33ff66';
  g.lineWidth = 2;
  g.stroke();

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
  g.fillText(`${Math.round(s.v * 3.6)} km/h`, 44, 10);
  const pct = (gr) => `${gr > 0 ? '+' : ''}${Math.round(gr * 100)}%`;
  g.fillText(`grade ${pct(s.grade)}`, 44, 26);
  const ahead = gradeAt(cfg.road, s.x + 120);
  g.fillStyle = Math.abs(ahead - s.grade) > 0.04 ? '#ffb000' : '#1d6a35';
  g.fillText(`ahead ${pct(ahead)}`, W - 110, 10);
  const band = s.running && !s.clutch && s.gear ? chargeBand(cfg, s.rpm) : 0;
  g.fillStyle = band > 0.8 ? '#33ff66' : band > 0.3 ? '#ffb000' : '#6a3c00';
  g.fillText(`charge ${'#'.repeat(Math.round(band * 5)).padEnd(5, '.')}`, W - 110, 26);

  // Tachometer.
  const tx = 10;
  const ty = H - 22;
  const tw = W - 20;
  const max = cfg.blowRpm;
  const at = (rpm) => tx + (Math.min(rpm, max) / max) * tw;
  g.fillStyle = '#111';
  g.fillRect(tx, ty, tw, 12);
  g.fillStyle = '#0d3a1c';
  g.fillRect(at(cfg.sweetBand[0]), ty, at(cfg.sweetBand[1]) - at(cfg.sweetBand[0]), 12);
  g.fillStyle = '#5a0000';
  g.fillRect(at(cfg.redline), ty, tx + tw - at(cfg.redline), 12);
  g.fillStyle = s.rpm >= cfg.redline ? '#ff3030' : s.lug > 0 ? '#ffb000' : '#33ff66';
  g.fillRect(tx, ty + 3, at(s.rpm) - tx, 6);
  g.fillStyle = '#808080';
  g.font = '10px "Courier New", monospace';
  g.fillText(`${Math.round(s.rpm)} rpm`, tx, ty - 12);

  // Status line.
  let status = '';
  if (c.paused) status = 'PAUSED';
  else if (now < c.flash.until) status = c.flash.text;
  else if (s.stalled) status = c.clutchKey || c.clutchMouse ? 'CRANKING...' : 'STALLED - HOLD CLUTCH TO RESTART';
  else if (!s.gear) status = 'NEUTRAL - CLUTCH IN, SHIFT UP';
  else if (s.lug > 0.2) status = 'BOGGING - CHANGE DOWN';
  else if (s.overRev > 0.3) status = 'LIMITER - CHANGE UP';
  if (status) {
    g.font = 'bold 16px "Courier New", monospace';
    const w = g.measureText(status).width;
    g.fillStyle = 'rgba(0,0,0,0.7)';
    g.fillRect((W - w) / 2 - 6, 52, w + 12, 22);
    g.fillStyle = /STALL|GRIND|BOG|LIMIT|CLASH/.test(status) ? '#ffb000' : '#33ff66';
    g.fillText(status, (W - w) / 2, 55);
  }
};

