// INTERN.EXE: the chat window between the player (sysadmin) and intern #0118.
// The intern is either a real AI agent on the MCP bridge or the scripted fallback.
import { actions } from '../core/actions.js';
import { chatMessages } from '../core/selectors.js';
import { levelInfo } from '../core/permissions.js';
import { esc, ui } from './dom.js';

export const DEFAULT_INTERN_URL = 'ws://localhost:7117';

const WHO = { player: 'YOU', intern: '#0118', system: 'SYSTEM' };

const statusText = () =>
  ({
    online: 'AI intern connected',
    connecting: 'Dialling...',
  })[ui.internStatus] ?? 'No agent. Scripted intern on duty.';

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
      if (ui.internStatus === 'offline') ctx.intern.dial(urlInput.value.trim() || DEFAULT_INTERN_URL);
      else ctx.intern.hangUp();
    });
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
    body.querySelector('.dial-btn').textContent = ui.internStatus === 'offline' ? 'Dial' : 'Hang up';
    body.querySelector('input[name="url"]').disabled = ui.internStatus !== 'offline';
    body.querySelector('.status').textContent = `${statusText()} | Clearance: ${levelInfo(state.intern.level).name}`;
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
