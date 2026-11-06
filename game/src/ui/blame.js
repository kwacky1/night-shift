// BLAME.EXE: the sysadmin's side of the 06:00 Head Office audit. Pick a suspect, cite up to three
// lines from files you've opened tonight, add a sentence, file it. #0118 files its own statement
// down the line (or the scripted intern does). The draft is form state, so it lives here, not in
// the game state; only the filed statement goes through the reducer.
import { actions } from '../core/actions.js';
import { citableFiles, maxEvidence, statementMax } from '../core/blame.js';
import { esc } from './dom.js';

const drafts = new Map();
const draftFor = (win) => {
  if (!drafts.has(win.id)) drafts.set(win.id, { suspect: null, evidence: [], fileId: null });
  return drafts.get(win.id);
};

const refLabel = (state, ref) => {
  const [id, line] = ref.split(':');
  return `${state.files[id]?.name ?? id}:${line}`;
};

const paint = (body, state, win) => {
  const b = state.blame;
  const root = body.querySelector('.blame-app');
  if (!b?.config) {
    root.innerHTML = '<p>BLAME.EXE: configuration missing. Head Office regrets nothing.</p>';
    return;
  }
  const config = b.config;
  const draft = draftFor(win);
  const filed = b.player;
  const files = citableFiles(state, 'player');
  if (!files.some((f) => f.id === draft.fileId)) draft.fileId = files[0]?.id ?? null;
  const file = files.find((f) => f.id === draft.fileId);
  const max = maxEvidence(config);
  const internLine = b.intern ? '#0118: statement filed.' : '#0118: thinking about it.';

  root.querySelector('.status').textContent = !b.open ? 'Audit closed.' : filed ? `Your statement is filed. ${internLine} Waiting for Head Office.` : internLine;
  const form = root.querySelector('.blame-form');
  form.hidden = Boolean(filed) || !b.open;
  const done = root.querySelector('.blame-filed');
  done.hidden = !filed;
  if (filed) {
    done.innerHTML = `<b>FILED ${esc(filed.at)}</b><span>Suspect: ${esc(config.suspects.find((s) => s.id === filed.suspect)?.name ?? filed.suspect)}</span>
      <span>Evidence: ${filed.evidence.length ? filed.evidence.map((r) => esc(refLabel(state, r))).join(', ') : 'none'}</span>
      ${filed.statement ? `<q>${esc(filed.statement)}</q>` : ''}`;
    return;
  }
  root.querySelector('.suspects').innerHTML = config.suspects
    .map((s) => `<label><input type="radio" name="suspect" value="${esc(s.id)}" ${draft.suspect === s.id ? 'checked' : ''} /> ${esc(s.name)}</label>`)
    .join('');
  root.querySelector('.file-pick').innerHTML = files.map((f) => `<option value="${esc(f.id)}" ${f.id === draft.fileId ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
  root.querySelector('.lines').innerHTML = file
    ? file.lines
        .map((text, i) => {
          const ref = `${file.id}:${i + 1}`;
          const on = draft.evidence.includes(ref);
          return `<li data-ref="${ref}" class="${on ? 'cited' : ''}" role="option" aria-selected="${on}"><span class="n">${i + 1}</span>${esc(text) || '&nbsp;'}</li>`;
        })
        .join('')
    : '<li>Nothing you can open.</li>';
  root.querySelector('.chips').innerHTML =
    draft.evidence.map((r) => `<button type="button" class="chip" data-ref="${r}" title="Remove">${esc(refLabel(state, r))} &times;</button>`).join('') ||
    `<span class="none">No evidence cited (up to ${max}). Click a line to cite it.</span>`;
  root.querySelector('.file-statement').disabled = !draft.suspect;
};

export const blameView = {
  title: () => 'BLAME.EXE - Head Office audit',
  icon: () => 'system',

  init(body, win, ctx) {
    const config = ctx.getState().blame?.config;
    body.innerHTML = `
      <div class="blame-app">
        <header><b>HEAD OFFICE AUDIT - TERMINAL NS-02</b><span>Somebody's name goes in the report. Pick carefully.</span></header>
        <div class="status" aria-live="polite"></div>
        <form class="blame-form">
          <fieldset><legend>WHO DID IT?</legend><div class="suspects"></div></fieldset>
          <fieldset class="evidence"><legend>EVIDENCE</legend>
            <div class="pick"><label>File <select class="file-pick"></select></label><div class="chips"></div></div>
            <ol class="lines sunken" role="listbox" aria-label="Lines (click to cite)"></ol>
          </fieldset>
          <label class="why">STATEMENT <input name="statement" maxlength="${statementMax(config)}" autocomplete="off" placeholder="In your own words..." /></label>
          <div class="actions"><button type="submit" class="file-statement">File statement</button></div>
        </form>
        <div class="blame-filed" hidden></div>
      </div>`;
    const redraw = () => paint(body, ctx.getState(), win);
    body.addEventListener('change', (e) => {
      const draft = draftFor(win);
      if (e.target.name === 'suspect') draft.suspect = e.target.value;
      else if (e.target.classList.contains('file-pick')) draft.fileId = e.target.value;
      else return;
      redraw();
    });
    body.addEventListener('click', (e) => {
      const hit = e.target.closest('[data-ref]');
      if (!hit) return;
      const draft = draftFor(win);
      const { ref } = hit.dataset;
      const max = maxEvidence(ctx.getState().blame?.config);
      if (draft.evidence.includes(ref)) draft.evidence = draft.evidence.filter((r) => r !== ref);
      else if (draft.evidence.length < max) draft.evidence = [...draft.evidence, ref];
      redraw();
    });
    body.addEventListener('submit', (e) => {
      e.preventDefault();
      const draft = draftFor(win);
      if (!draft.suspect) return;
      ctx.dispatch(actions.blameSubmit(draft.suspect, draft.evidence, body.querySelector('input[name="statement"]').value));
    });
  },

  render(body, state, prev, win) {
    if (prev && prev.blame === state.blame && prev.files === state.files) return;
    paint(body, state, win);
  },
};
