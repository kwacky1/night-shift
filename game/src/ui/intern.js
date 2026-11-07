// INTERN.EXE: the chat window between the player (sysadmin) and intern #0118.
// The intern is either a real AI agent on the MCP bridge or the scripted fallback.
import { actions } from '../core/actions.js';
import { chatMessages } from '../core/selectors.js';
import { levelInfo } from '../core/permissions.js';
import { isBrownout } from '../core/power.js';
import { esc, ui } from './dom.js';

export const DEFAULT_INTERN_URL = 'ws://localhost:7117';

const WHO = { player: 'YOU', intern: '#0118', system: 'SYSTEM', ghost: '#0117' };

const statusText = () =>
  ({
    online: 'AI intern connected',
    connecting: 'Dialling...',
    taken: 'Line lost to another terminal.',
    outdated: 'Intern driver out of date. Scripted intern on duty.',
    failed: 'Dial failed. Scripted intern on duty.',
  })[ui.internStatus] ?? 'No agent. Scripted intern on duty.';

const IDLE = new Set(['offline', 'taken', 'outdated', 'failed']);

export const internView = {
  title: () => 'INTERN.EXE - #0118',
  icon: () => 'system',

  init(body, win, ctx) {
    body.innerHTML = `
      <div class="intern-app">
        <form class="dial">
          <span class="led"></span>
          <input name="url" spellcheck="false" autocomplete="off" aria-label="Intern bridge address" />
          <button type="submit" class="dial-btn">Dial</button>
        </form>
        <div class="status"></div>
        <div class="line-taken" role="alert" hidden>
          <b>LINE TAKEN BY ANOTHER TERMINAL</b>
          <span>Another NIGHT_SHIFT window dialled the intern and this one was dropped. Nobody is answering here.</span>
          <button type="button" class="redial">Redial</button>
        </div>
        <div class="driver-old" role="alert" hidden>
          <b class="driver-text">INTERN DRIVER OUT OF DATE</b>
          <span>The intern's MCP server is from a different build of the game and can't hear this one. Restart <code>night-shift-mcp</code> from this checkout (your agent usually restarts it for you), then Redial.</span>
          <button type="button" class="redial">Redial</button>
        </div>
        <div class="dial-failed" role="alert" hidden>
          <b class="failed-title">DIAL FAILED</b>
          <span class="failed-text"></span>
          <span class="failed-hint"></span>
          <button type="button" class="open-tab" hidden>OPEN IN ITS OWN TAB</button>
          <button type="button" class="redial">Retry</button>
        </div>
        <div class="line-noise" hidden></div>
        <div class="chat sunken" role="log" aria-live="polite"></div>
        <div class="typing" hidden>#0118 is typing...</div>
        <form class="compose">
          <input name="msg" maxlength="280" autocomplete="off" placeholder="Message #0118..." aria-label="Message the intern" />
          <button type="submit">Send</button>
        </form>
      </div>`;
    const urlInput = body.querySelector('input[name="url"]');
    urlInput.value = ctx.intern.url();
    body.querySelector('.dial').addEventListener('submit', (e) => {
      e.preventDefault();
      if (IDLE.has(ui.internStatus)) ctx.intern.dial(urlInput.value.trim() || DEFAULT_INTERN_URL);
      else ctx.intern.hangUp();
    });
    body.querySelectorAll('.redial').forEach((b) => b.addEventListener('click', () => ctx.intern.dial(urlInput.value.trim() || DEFAULT_INTERN_URL)));
    body.querySelector('.open-tab').addEventListener('click', () => ctx.intern.openOwnTab(urlInput.value.trim() || DEFAULT_INTERN_URL));
    const compose = body.querySelector('.compose');
    compose.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = compose.elements.msg;
      const text = input.value.trim();
      if (!text) return;
      ctx.dispatch(actions.chatSend(text));
      input.value = '';
    });
  },

  render(body, state, prev, win) {
    const root = body.querySelector('.intern-app');
    root.dataset.status = ui.internStatus;
    const idle = IDLE.has(ui.internStatus);
    body.querySelector('.dial-btn').textContent = idle ? (ui.internStatus === 'offline' ? 'Dial' : 'Redial') : 'Hang up';
    body.querySelector('input[name="url"]').disabled = !idle;
    body.querySelector('.line-taken').hidden = ui.internStatus !== 'taken';
    const failed = body.querySelector('.dial-failed');
    const failure = ui.internStatus === 'failed' ? ui.internFailure : null;
    failed.hidden = !failure;
    if (failure) {
      failed.querySelector('.failed-title').textContent = failure.title;
      failed.querySelector('.failed-text').textContent = failure.text;
      failed.querySelector('.failed-hint').textContent = failure.hint;
      failed.querySelector('.open-tab').hidden = !failure.openTab;
    }
    const old = body.querySelector('.driver-old');
    old.hidden = ui.internStatus !== 'outdated';
    if (!old.hidden) old.querySelector('.driver-text').textContent = ui.internDriver?.text ?? 'INTERN DRIVER OUT OF DATE';
    const noise = body.querySelector('.line-noise');
    noise.hidden = !(ui.internStatus === 'online' && ui.internWarning);
    if (!noise.hidden) noise.textContent = `LINE NOISE: the intern's driver couldn't read the last update (${ui.internWarning}). It may be out of date.`;
    const brownout = isBrownout(state) ? ' | BROWNOUT: ops and keys blocked' : '';
    body.querySelector('.status').textContent = `${statusText()} | Clearance: ${levelInfo(state.intern.level).name}${brownout}`;
    root.classList.toggle('brownout', !!brownout);
    body.querySelector('.typing').hidden = !ui.internTyping;
    if (prev && prev.intern?.messages === state.intern.messages) return;
    const chat = body.querySelector('.chat');
    const atBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 24;
    chat.innerHTML = chatMessages(state)
      .map((m) => `<div class="msg ${esc(m.from)}"><span class="at">[${esc(m.at)}]</span> <b>${WHO[m.from] ?? '?'}:</b> ${esc(m.text)}</div>`)
      .join('');
    if (atBottom || !prev) chat.scrollTop = chat.scrollHeight;
  },
};
