// End-to-end smoke test: real MCP client -> night-shift-mcp (stdio) -> WebSocket -> the real game
// running in headless Chrome. Plays the two-sided puzzles, the 06:00 BLAME.EXE audit (with the AI
// and with the scripted intern), a driver version mismatch, and the itch.io iframe with a blocked line.
//
//   npm run smoke            (from the repo root)
//   CHROME_PATH=... npm run smoke   if Chrome is not in a standard location
//   SMOKE_MCP_BIN=...               run another night-shift-mcp bin (npm run verify-pack uses the packed one)
//   SMOKE_GAME_ROOT=dist/html       play the itch.io build instead of game/
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { chromium } from 'playwright-core';

const HTTP_PORT = Number(process.env.SMOKE_HTTP_PORT) || 8097;
const WS_PORT = Number(process.env.SMOKE_WS_PORT) || 7118;
const root = (p) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const SHOTS = process.env.SMOKE_SHOTS ?? root('.playwright-mcp');
const MCP_BIN = process.env.SMOKE_MCP_BIN || root('mcp/bin/night-shift-mcp.js');

const chromePath = () =>
  [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].find((p) => p && existsSync(p));

let step = 0;
const ok = (msg) => console.log(`  ok ${++step} - ${msg}`);
const expect = (cond, msg, detail = '') => {
  if (!cond) throw new Error(`${msg}${detail ? `\n${detail}` : ''}`);
  ok(msg);
};

const cleanup = [];
const run = async () => {
  const serve = spawn(process.execPath, [root('scripts/serve.js')], { env: { ...process.env, PORT: String(HTTP_PORT), ...(process.env.SMOKE_GAME_ROOT && { SERVE_ROOT: process.env.SMOKE_GAME_ROOT }) }, stdio: ['ignore', 'pipe', 'inherit'] });
  cleanup.push(() => serve.kill());
  await new Promise((resolve, reject) => {
    serve.stdout.once('data', resolve);
    serve.once('exit', (code) => reject(new Error(`static server exited (${code})`)));
  });

  const transport = new StdioClientTransport({ command: process.execPath, args: [MCP_BIN, '--port', String(WS_PORT)], stderr: 'inherit' });
  const client = new Client({ name: 'night-shift-smoke', version: '0.0.0' });
  await client.connect(transport);
  cleanup.push(() => client.close());
  const tool = async (name, args = {}) => {
    const res = await client.callTool({ name, arguments: args });
    const text = res.content.map((c) => c.text).join('\n');
    if (process.env.SMOKE_VERBOSE) console.log(`    > ${name} ${JSON.stringify(args)}\n${text.replace(/^/gm, '    | ')}`);
    return text;
  };

  console.log(`# night-shift-mcp: ${MCP_BIN}`);
  expect(/intern #0118/.test(client.getInstructions()), 'MCP server exposes the intern persona');
  expect(/NO CARRIER/.test(await tool('whoami')), 'tools answer in character before the game connects');

  const executablePath = chromePath();
  if (!executablePath) throw new Error('No Chrome/Edge found. Set CHROME_PATH.');
  const browser = await chromium.launch({ executablePath, headless: true });
  cleanup.push(() => browser.close());
  const profile = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const page = await profile.newPage();
  page.on('pageerror', (err) => console.error('    page error:', err.message));
  await page.goto(`http://localhost:${HTTP_PORT}/?intern=ws://localhost:${WS_PORT}`);
  await page.waitForFunction(() => window.NIGHT_SHIFT);
  await page.evaluate(() => {
    const { dispatch, actions } = window.NIGHT_SHIFT;
    dispatch(actions.bootComplete());
    dispatch(actions.clockIn());
  });
  await page.waitForSelector('.tray .intern[data-status="online"]', { timeout: 10000 });
  ok('game dialled the intern line (tray shows ONLINE)');

  expect(/"clearance": "PROBATION"/.test(await tool('whoami')), 'whoami: PROBATION clearance');
  const files = await tool('list_files');
  expect(/NS-02\.LOG {2}\[hidden, needs OPERATOR\]/.test(files), 'list_files shows hidden SYSTEM files', files);
  expect(/NS-02\.LOG/.test(await tool('read_file', { path: 'BOOTLOG.TXT' })), 'read_file reads a hidden boot log');
  expect(/ACCESS DENIED/.test(await tool('read_file', { path: 'NS-02.LOG' })), 'NS-02.LOG is denied at PROBATION');
  const badge = await tool('inspect_puzzle', { puzzle: 'BADGE.DB' });
  expect(/0x0118/.test(badge) && /REDACTED/.test(badge) && !/0x0FF0/.test(badge), 'inspect_puzzle: numbers, no target, redacted key');

  await page.click('.tray .intern');
  await page.waitForSelector('.intern-app');
  expect((await tool('message_player', { text: 'Evening! Intern #0118 here. What does the badge pattern look like?' })) === 'Sent.', 'message_player sent');
  await page.waitForFunction(() => [...document.querySelectorAll('.intern-app .msg.intern')].some((m) => m.textContent.includes('Intern #0118 here')));
  ok('intern message shows in INTERN.EXE');

  await page.fill('.intern-app .compose input', 'Two lit bytes in the middle. Shift payroll right for me?');
  await page.press('.intern-app .compose input', 'Enter');
  const heard = await tool('wait_for_player', { timeoutSeconds: 5 });
  expect(/SYSADMIN: Two lit bytes/.test(heard), 'agent reads what the player typed', heard);
  await page.waitForTimeout(1800);
  const scriptedReplies = await page.evaluate(() => window.NIGHT_SHIFT.getState().intern.messages.filter((m) => m.from === 'intern' && m.scripted).length);
  expect(scriptedReplies === 0, 'scripted intern stays quiet while a real agent is online');

  // Payroll: >>3 is remote-only, the XOR is console-only, and the intern has 2 remote ops.
  expect(/CURRENT is now 0x0000/.test(await tool('shift_right', { puzzle: 'payroll' })), 'agent applies >> 3 on payroll (remote-only op)');
  const noop = await tool('shift_right', { puzzle: 'payroll' });
  expect(/NO CHANGE/.test(noop) && /No move used/.test(noop), 'a no-op says NO CHANGE and costs nothing', noop);
  await page.evaluate(() => window.NIGHT_SHIFT.dispatch(window.NIGHT_SHIFT.actions.openFile('payroll')));
  await page.waitForSelector('.bitrot[data-noop-seq]');
  ok('the board flashes NO CHANGE for the player too');
  const nextHint = await page.textContent('.bitrot .next');
  expect(/^NEXT: YOU \[[\d ]+\] or #0118 \[[\d ]+\]/.test(nextHint), 'the board says whose hands can make the next move', nextHint);
  const requests = () => page.evaluate(() => window.NIGHT_SHIFT.getState().intern.messages.filter((m) => m.from === 'player' && /can you run/.test(m.text)).length);
  const asked0 = await requests();
  const askBtn = page.locator('.bitrot .ops button.hands-intern').first();
  expect(/ASK #0118/.test(await askBtn.textContent()), 'a remote-only op reads as a request: ASK #0118');
  await askBtn.click();
  await page.waitForSelector('.bitrot .ops button.hands-intern.asked[disabled]');
  await page.keyboard.press(String(Number(await askBtn.getAttribute('data-op')) + 1));
  await askBtn.click({ force: true, timeout: 1000 }).catch(() => {});
  await page.waitForTimeout(200);
  expect((await requests()) === asked0 + 1 && /ASKED/.test(await askBtn.textContent()), 'asking #0118 twice sends one request (ASKED until it moves)');
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/smoke-ask.png` });
  await tool('read_messages');
  expect(/cannot use XOR|CONSOLE ONLY/i.test(await tool('xor', { puzzle: 'payroll', mask: '0x0F0F' })), 'XOR refused down the line');
  await page.evaluate(() => window.NIGHT_SHIFT.dispatch(window.NIGHT_SHIFT.actions.applyOp('payroll', 2)));
  await tool('shift_left', { puzzle: 'payroll' });
  const quota = await tool('shift_left', { puzzle: 'payroll' });
  expect(/REMOTE QUOTA/.test(quota), 'the intern runs out of remote ops: the sysadmin has to finish', quota);
  await page.evaluate(() => window.NIGHT_SHIFT.dispatch(window.NIGHT_SHIFT.actions.applyOp('payroll', 0)));
  expect(await page.evaluate(() => window.NIGHT_SHIFT.getState().puzzles.payroll.solved), 'payroll recovered together');
  expect(/"clearance": "OPERATOR"/.test(await tool('whoami')), 'escalation: promoted to OPERATOR');
  const log = await tool('read_file', { path: 'NS-02.LOG' });
  expect(/zero, one, one, seven/.test(log), 'NS-02.LOG now readable: key in words');

  // Badge: the player sees no hex, the agent has the key.
  await page.evaluate(() => window.NIGHT_SHIFT.dispatch(window.NIGHT_SHIFT.actions.openFile('badge')));
  await page.waitForSelector('.bitrot .keyrow');
  const playerHex = await page.$$eval('.bitrot:has(.keyrow) .hex', (els) => els.map((e) => e.textContent.trim()));
  expect(playerHex.length === 2 && playerHex.every((h) => h === '????'), 'player sees the badge pattern but no hex', playerHex.join(','));
  await tool('xor', { puzzle: 'badge', mask: '0xFF00' });
  expect(/Applied XOR 0x0117/.test(await tool('xor', { puzzle: 'badge', mask: '0x0117' })), 'agent unlocks and applies the keyed XOR');
  expect(/CONSOLE ONLY|sysadmin only|cannot/i.test(await tool('shift_left', { puzzle: 'badge', n: 4 })), '<< 4 on BADGE.DB is console-only');
  await page.evaluate(() => {
    const { dispatch, actions } = window.NIGHT_SHIFT;
    dispatch(actions.applyOp('badge', 0));
    dispatch(actions.applyOp('badge', 2));
  });
  expect(await page.evaluate(() => window.NIGHT_SHIFT.getState().puzzles.badge.solved), 'BADGE.DB recovered: player shifts and finishes with the key the intern entered');
  await page.waitForSelector('.bitrot .banner.ok');
  ok('game shows SECTOR RECOVERED');
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/smoke-badge.png` });

  // Reload: the game reconnects and the server swaps to the new socket.
  await page.reload();
  await page.waitForSelector('.tray .intern[data-status="online"]', { timeout: 10000 });
  expect(/OPERATOR/.test(await tool('whoami')), 'after reload the game reconnects with saved state');
  await page.screenshot({ path: `${SHOTS}/smoke-reload.png` });

  // A second window of the same game (same profile, no ?intern=) quietly re-dials the saved line
  // and takes it over. The first window says LINE TAKEN instead of pretending to be SCRIPTED.
  const rival = await profile.newPage();
  rival.on('pageerror', (err) => console.error('    page error:', err.message));
  await rival.goto(`http://localhost:${HTTP_PORT}/`);
  await rival.waitForSelector('.tray .intern[data-status="online"]', { timeout: 15000 });
  ok('a saved dial-in URL is re-dialled automatically on load');
  await page.waitForSelector('.tray .intern[data-status="taken"]', { timeout: 5000 });
  expect(/LINE TAKEN/.test(await page.textContent('.tray .intern')), 'the losing window shows LINE TAKEN in the tray');
  await page.waitForSelector('.intern-app .line-taken:not([hidden])');
  expect(/LINE TAKEN BY ANOTHER TERMINAL/i.test(await page.textContent('.intern-app .line-taken')), 'INTERN.EXE shows LINE TAKEN BY ANOTHER TERMINAL with a Redial button');
  await page.screenshot({ path: `${SHOTS}/smoke-line-taken.png` });
  await page.click('.intern-app .line-taken .redial');
  await page.waitForSelector('.tray .intern[data-status="online"]', { timeout: 10000 });
  await rival.waitForSelector('.tray .intern[data-status="taken"]', { timeout: 5000 });
  ok('Redial takes the line back');
  await rival.close();
  expect(/mainframePower/.test(await tool('whoami')), 'whoami shows mainframe power');

  // A short drive: hold the clutch to crank, select first, let it go, then grab second.
  await page.evaluate(() => {
    const { dispatch, actions, getState } = window.NIGHT_SHIFT;
    const s = getState();
    dispatch(actions.hydrate({ ...s, power: { ...s.power, level: 60 } }));
    dispatch(actions.openFile('geargrind'));
  });
  await page.waitForSelector('.geargrind canvas');
  await page.waitForSelector('.gg-hint:not([hidden])');
  expect(/CHARGE ZONE/.test(await page.textContent('.gg-hint')), 'first open shows the how-to-charge hint card');
  await page.screenshot({ path: `${SHOTS}/smoke-geargrind-hint.png` });
  await page.click('.gg-hint [data-ctl="hint-ok"]');

  // Focus: type in the intern's chat, then click Gear Grind's title bar. Space is the clutch now.
  await page.evaluate(() => window.NIGHT_SHIFT.dispatch(window.NIGHT_SHIFT.actions.openFile('intern')));
  await page.click('.intern-app .compose input');
  await page.fill('.intern-app .compose input', '');
  await page.keyboard.type('hold on');
  await page.click('.window:has(.geargrind) .titlebar .title');
  await page.keyboard.down('Space');
  await page.waitForTimeout(150);
  const focusCheck = await page.evaluate(() => ({ clutch: document.querySelector('.geargrind').dataset.clutch, chat: document.querySelector('.intern-app .compose input').value }));
  expect(focusCheck.clutch === 'in' && focusCheck.chat === 'hold on', 'clicking Gear Grind takes the keyboard: Space works the clutch, nothing typed into chat', JSON.stringify(focusCheck));
  await page.keyboard.up('Space');
  await page.click('.intern-app .compose input');
  await page.click('.geargrind canvas');
  await page.keyboard.press('Space');
  expect((await page.inputValue('.intern-app .compose input')) === 'hold on', 'clicking the road view takes the keyboard too');

  const before = await page.evaluate(() => window.NIGHT_SHIFT.getState().stats.distance ?? 0);
  await page.keyboard.down('Space');
  await page.waitForTimeout(1200);
  await page.keyboard.press('ShiftRight');
  await page.waitForTimeout(250);
  await page.keyboard.up('Space');
  await page.waitForTimeout(2500);
  await page.keyboard.down('Space');
  await page.keyboard.press('ShiftRight');
  await page.waitForTimeout(250);
  await page.keyboard.up('Space');
  await page.waitForTimeout(2500);
  const drove = await page.evaluate(() => ({ distance: window.NIGHT_SHIFT.getState().stats.distance ?? 0, gen: window.NIGHT_SHIFT.getState().power.generator }));
  expect(drove.distance > before, 'driving GEARGRIND.EXE moves the generator along', JSON.stringify(drove));
  const ggStatus = await page.textContent('.gg-status');
  expect(/CHARGING|NOT CHARGING/.test(ggStatus) && /drain/.test(ggStatus), 'Gear Grind shows a live charging status', ggStatus);
  const pwr = await tool('whoami');
  expect(/"generator": "RUNNING/.test(pwr), 'the intern sees the generator running', pwr);
  await page.screenshot({ path: `${SHOTS}/smoke-geargrind.png` });
  await page.evaluate(() => {
    const { dispatch, actions, getState } = window.NIGHT_SHIFT;
    const s = getState();
    dispatch(actions.hydrate({ ...s, power: { ...s.power, level: 25 } }));
  });
  await page.waitForSelector('.tray .power[data-status="brownout"]');
  expect(/BROWNOUT/.test(await page.textContent('.tray .power')), 'the tray power meter signposts a brownout');
  await page.evaluate(() => {
    const { dispatch, actions, getState } = window.NIGHT_SHIFT;
    const s = getState();
    dispatch(actions.hydrate({ ...s, power: { ...s.power, level: 60 } }));
  });

  // 06:00: Head Office's audit. The clock stops, BLAME.EXE opens, both sides file, a verdict ends the shift.
  // Every sector recovered at 05:56: WAIT FOR THE AUDIT parks the generator and runs the clock 8x to 06:00.
  await page.evaluate(() => {
    const { dispatch, actions, getState } = window.NIGHT_SHIFT;
    const s = getState();
    dispatch(actions.hydrate({ ...s, power: { ...s.power, level: 90, config: { ...s.power.config, drainPerMinute: 0 } }, puzzles: Object.fromEntries(Object.entries(s.puzzles).filter(([id]) => id !== 'timeclk').map(([id, p]) => [id, { ...p, solved: true }]).concat([['timeclk', s.puzzles.timeclk]])) }));
    dispatch(actions.tick(420 - getState().clock.elapsed));
    if (getState().alert) dispatch(actions.dismissAlert());
    dispatch(actions.tick(476 - getState().clock.elapsed));
    if (getState().alert) dispatch(actions.dismissAlert());
  });
  expect(/no audit running/.test(await tool('audit_status')), 'no audit before 06:00');
  expect(await page.isHidden('#taskbar .wait-audit'), 'no WAIT FOR THE AUDIT button while a sector is still corrupted');
  await page.evaluate(() => {
    const { dispatch, actions, getState } = window.NIGHT_SHIFT;
    const s = getState();
    dispatch(actions.hydrate({ ...s, puzzles: { ...s.puzzles, timeclk: { ...s.puzzles.timeclk, solved: true } } }));
  });
  await page.waitForSelector('#taskbar .wait-audit:not([hidden])');
  await page.click('#taskbar .wait-audit');
  await page.waitForSelector('.gg-parked:not([hidden])');
  const ff = await page.evaluate(() => ({ running: window.NIGHT_SHIFT.getState().power.generator.running, waiting: window.NIGHT_SHIFT.getState().clock.waiting, label: document.querySelector('#taskbar .wait-audit').textContent, card: document.querySelector('.gg-parked').textContent }));
  expect(/WAITING FOR THE AUDIT/.test(ff.card) && !ff.running && ff.waiting && /WAITING/.test(ff.label), 'WAIT FOR THE AUDIT parks Generator 2 and the clock runs fast', 'WAIT FOR THE AUDIT parks Generator 2', ff.card);
  expect(/waiting for the 06:00 audit/.test(await tool('read_messages')), 'the intern hears the sysadmin is waiting for the audit');
  await page.waitForSelector('.blame-app .blame-form:not([hidden])', { timeout: 15000 });
  ok('the clock runs fast to 06:00 and BLAME.EXE opens');
  expect(await page.evaluate(() => window.NIGHT_SHIFT.getState().phase === 'desktop' && window.NIGHT_SHIFT.getState().blame.open), 'at 06:00 the clock freezes and BLAME.EXE opens');
  const auditView = await tool('audit_status');
  expect(/"suspects"/.test(auditView) && /BOOTLOG\.TXT/.test(auditView) && !/points|weight|endings/.test(auditView), 'audit_status: suspects and files read, no verdict rules', auditView);
  expect(/audit/i.test(await tool('shift_left', { puzzle: 'payroll' })), 'ops are frozen for the audit');

  // Gear Grind was open: the day crew take the generator, the card points at BLAME.EXE.
  await page.waitForSelector('.gg-parked:not([hidden])');
  const parked = await page.evaluate(() => {
    const s = window.NIGHT_SHIFT.getState();
    return { card: document.querySelector('.gg-parked').textContent, up: document.querySelector('.gg-controls [data-ctl="up"]').disabled, top: s.windows.find((w) => w.id === s.focusedWindowId)?.kind, gen: s.power.generator, distance: s.stats.distance };
  });
  expect(/DAY CREW HAS THE GENERATOR/.test(parked.card) && /km/.test(parked.card) && /BLAME\.EXE/.test(parked.card) && parked.up && parked.top === 'blame' && !parked.gen.running, 'at 06:00 Gear Grind parks with a wrap-up card and BLAME.EXE comes to the front', JSON.stringify(parked));
  await page.evaluate(() => {
    const { dispatch, actions, getState } = window.NIGHT_SHIFT;
    dispatch(actions.focusWindow(getState().windows.find((w) => w.kind === 'geargrind').id));
  });
  await page.waitForTimeout(100);
  await page.keyboard.down('Space');
  await page.keyboard.press('ShiftRight');
  await page.waitForTimeout(800);
  await page.keyboard.up('Space');
  const stillParked = await page.evaluate(() => ({ gen: window.NIGHT_SHIFT.getState().power.generator, distance: window.NIGHT_SHIFT.getState().stats.distance, clutch: document.querySelector('.geargrind').dataset.clutch }));
  expect(!stillParked.gen.running && stillParked.distance === parked.distance && stillParked.clutch === 'out', 'no driving during the audit', JSON.stringify(stillParked));
  await page.screenshot({ path: `${SHOTS}/smoke-geargrind-parked.png` });
  await page.evaluate(() => window.NIGHT_SHIFT.dispatch(window.NIGHT_SHIFT.actions.openFile('blame')));

  // The sysadmin files first. With the AI on the line the scripted intern never steps in.
  expect(/AUDIT OPEN/.test(await tool('read_messages')), 'read_messages carries the 06:00 AUDIT OPEN ping');
  await page.check('.blame-app input[name="suspect"][value="0118"]');
  await page.click('.blame-app .lines li[data-ref]');
  await page.waitForSelector('.blame-app .chips .chip');
  await page.fill('.blame-app input[name="statement"]', 'The intern ran half the ops tonight.');
  await page.screenshot({ path: `${SHOTS}/smoke-blame.png` });
  await page.click('.blame-app .file-statement');
  await page.waitForFunction(() => /WAITING FOR #0118/.test(document.querySelector('.blame-app .status').textContent));
  await page.waitForTimeout(3000);
  const waiting = await page.evaluate(() => ({ intern: window.NIGHT_SHIFT.getState().blame.intern, status: document.querySelector('.blame-app .status').textContent, button: !document.querySelector('.blame-app .without').hidden }));
  expect(!waiting.intern && /WAITING FOR #0118/.test(waiting.status) && waiting.button, 'BLAME.EXE waits for the AI (no scripted statement) and offers FILE WITHOUT THE INTERN', JSON.stringify(waiting));
  expect(/HEAD OFFICE: 06:00 AUDIT OPEN/.test(await tool('whoami')), 'tool results remind the agent to file');
  const filedAi = await tool('submit_blame', { suspect: 'sysadmin', evidence: ['BOOTLOG.TXT:4', 'NS-02.LOG:8'], statement: 'I was on the remote line all night. Ask NS-02.' });
  expect(/Statement filed/.test(filedAi), 'the agent files its statement with submit_blame', filedAi);
  await page.waitForSelector('#shiftend:not([hidden]) .endings');
  const verdict = await page.evaluate(() => ({ end: window.NIGHT_SHIFT.getState().shiftEnd, card: document.querySelector('#shiftend').textContent, saved: localStorage.getItem('night-shift:endings') }));
  expect(verdict.end.reason === 'audit' && verdict.card.includes(verdict.end.ending.title), `the verdict ends the shift: ${verdict.end.ending?.title}`, verdict.card);
  expect(/ENDINGS FOUND 1\//.test(verdict.card) && /YOU BLAMED/.test(verdict.card) && /#0118 BLAMED/.test(verdict.card), 'end screen shows who blamed whom and the endings tally');
  expect(JSON.parse(verdict.saved).includes(verdict.end.ending.id), 'the ending is saved to the tally in localStorage');
  expect(/audit is closed/.test(await tool('whoami')), 'the agent hears the verdict');
  expect(!/\(scripted\)/.test(verdict.card), 'the AI\'s statement is on the end screen, not a scripted one');
  await page.screenshot({ path: `${SHOTS}/smoke-verdict.png` });

  // Another shift on the same line: the sysadmin gives up waiting and files without the intern.
  await page.click('#shiftend .new-shift');
  await page.waitForFunction(() => window.NIGHT_SHIFT.getState().phase === 'clockin');
  await page.evaluate(() => {
    const { dispatch, actions, getState } = window.NIGHT_SHIFT;
    dispatch(actions.clockIn());
    const s = getState();
    dispatch(actions.hydrate({ ...s, power: { ...s.power, level: 90, config: { ...s.power.config, drainPerMinute: 0 } } }));
    dispatch(actions.tick(420));
    dispatch(actions.tick(480 - getState().clock.elapsed));
  });
  await page.waitForSelector('.blame-app .without:not([hidden]) .file-without');
  await page.check('.blame-app input[name="suspect"][value="0117"]');
  await page.click('.blame-app .file-statement');
  await page.waitForFunction(() => /WAITING FOR #0118/.test(document.querySelector('.blame-app .status').textContent));
  await page.click('.blame-app .file-without');
  await page.waitForSelector('#shiftend:not([hidden]) .endings', { timeout: 10000 });
  const without = await page.evaluate(() => ({ intern: window.NIGHT_SHIFT.getState().blame.intern, card: document.querySelector('#shiftend').textContent }));
  expect(without.intern?.scripted && /\(scripted\)/.test(without.card), 'FILE WITHOUT THE INTERN files the scripted statement (marked scripted)', JSON.stringify(without.intern));

  // No agent: the scripted intern, replaying Simon's playtest in a fresh browser profile.
  const solo = await (await browser.newContext({ viewport: { width: 1024, height: 768 } })).newPage();
  solo.on('pageerror', (err) => console.error('    page error:', err.message));
  await solo.goto(`http://localhost:${HTTP_PORT}/`);
  await solo.waitForFunction(() => window.NIGHT_SHIFT);
  await solo.evaluate(() => {
    const { dispatch, actions, getState } = window.NIGHT_SHIFT;
    dispatch(actions.bootComplete());
    dispatch(actions.clockIn());
    const s = getState();
    dispatch(actions.hydrate({ ...s, intern: { ...s.intern, level: 2 } }));
    dispatch(actions.openFile('intern'));
  });
  const scripted = async (text, pattern) => {
    const before = await solo.$$eval('.intern-app .msg.intern', (els) => els.length);
    await solo.fill('.intern-app .compose input', text);
    await solo.press('.intern-app .compose input', 'Enter');
    await solo.waitForFunction((n) => document.querySelectorAll('.intern-app .msg.intern').length > n, before, { timeout: 5000 });
    const reply = await solo.$$eval('.intern-app .msg.intern', (els) => els.at(-1).textContent);
    expect(pattern.test(reply), `scripted intern: "${text}"`, reply);
  };
  await scripted('what does the key log say?', /lanyard/);
  await scripted('the key', /SYSTEM folder/);
  await scripted('it says to ask you for a readoout', /read out per policy/);
  await scripted('please', /zero, one, one, seven/);
  await scripted('current is 0000 0001 0001 1000', /matches what I've got/);
  await scripted('the target is 0000 1111 1111 0000', /XOR 0xFF00 first, then the key XOR/);
  await solo.evaluate(() => window.NIGHT_SHIFT.dispatch(window.NIGHT_SHIFT.actions.openFile('badge')));
  await solo.fill('.bitrot .keyrow input', '0117');
  await solo.press('.bitrot .keyrow input', 'Enter');
  await solo.waitForFunction(() => window.NIGHT_SHIFT.getState().puzzles.badge.unlocked.includes(3));
  ok('player types the key as read out (0117) and BADGE.DB accepts it');
  await scripted("what's the sequence?", /XOR before you shift/);
  await scripted('how do I keep the power up?', /% ?|GEARGR~1|drive/i);
  await solo.screenshot({ path: `${SHOTS}/smoke-scripted.png` });

  // 06:00 with the scripted intern: it files after the sysadmin, and it blames the sysadmin.
  await solo.evaluate(() => {
    const { dispatch, actions, getState } = window.NIGHT_SHIFT;
    const s = getState();
    // Keep the lights on so the shift reaches 06:00 rather than a blackout.
    dispatch(actions.hydrate({ ...s, power: { ...s.power, config: { ...s.power.config, drainPerMinute: 0 } } }));
    dispatch(actions.tick(420));
    dispatch(actions.tick(60));
  });
  await solo.waitForSelector('.blame-app .blame-form:not([hidden])');
  await solo.check('.blame-app input[name="suspect"][value="0117"]');
  await solo.click('.blame-app .file-statement');
  await solo.waitForSelector('#shiftend:not([hidden]) .new-shift', { timeout: 10000 });
  const card = await solo.textContent('#shiftend');
  const soloEnd = await solo.evaluate(() => window.NIGHT_SHIFT.getState().blame.intern);
  expect(soloEnd?.scripted && soloEnd.suspect === 'sysadmin' && /#0118 BLAMED/.test(card) && /scripted/i.test(card), 'the scripted intern files its statement and blames you', card.replace(/\s+/g, ' '));
  await solo.screenshot({ path: `${SHOTS}/smoke-shiftend.png` });
  await solo.reload();
  await solo.waitForSelector('#shiftend:not([hidden]) .new-shift');
  ok('a finished shift reloads to the end-of-shift screen, not a dead desktop');
  await solo.click('#shiftend .new-shift');
  await solo.waitForFunction(() => window.NIGHT_SHIFT.getState().phase === 'clockin');
  const fresh = await solo.evaluate(() => {
    const s = window.NIGHT_SHIFT.getState();
    return { shift: s.shiftNumber, elapsed: s.clock.elapsed, unlocked: s.puzzles.badge.unlocked.length, level: s.intern.level, end: s.shiftEnd };
  });
  expect(fresh.shift === 2 && fresh.elapsed === 0 && fresh.unlocked === 0 && fresh.level === 1 && !fresh.end, 'Clock in for another shift starts a fresh game', JSON.stringify(fresh));
  await solo.evaluate(() => window.NIGHT_SHIFT.dispatch(window.NIGHT_SHIFT.actions.clockIn()));
  await solo.waitForFunction(() => window.NIGHT_SHIFT.getState().phase === 'desktop');
  ok('and the new shift is playable');

  // A game from another build: the driver refuses it, out loud, on both ends.
  const old = await (await browser.newContext({ viewport: { width: 1024, height: 768 } })).newPage();
  old.on('pageerror', (err) => console.error('    page error:', err.message));
  await old.addInitScript(() => {
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'hello') return send.call(this, JSON.stringify({ ...msg, version: 1 }));
      } catch {}
      return send.call(this, data);
    };
  });
  await old.goto(`http://localhost:${HTTP_PORT}/?intern=ws://localhost:${WS_PORT}`);
  await old.waitForFunction(() => window.NIGHT_SHIFT);
  await old.evaluate(() => {
    const { dispatch, actions } = window.NIGHT_SHIFT;
    dispatch(actions.bootComplete());
    dispatch(actions.clockIn());
  });
  await old.waitForSelector('.tray .intern[data-status="outdated"]', { timeout: 10000 });
  expect(/DRIVER OLD/.test(await old.textContent('.tray .intern')), 'an old game build shows DRIVER OLD in the tray');
  await old.evaluate(() => window.NIGHT_SHIFT.dispatch(window.NIGHT_SHIFT.actions.openFile('intern')));
  await old.waitForSelector('.intern-app .driver-old:not([hidden])');
  const banner = await old.textContent('.intern-app .driver-old');
  expect(/INTERN DRIVER OUT OF DATE \(game v[\d.]+, driver v[\d.]+\)/.test(banner), 'INTERN.EXE explains the driver is out of date', banner);
  const deaf = await tool('whoami');
  expect(/INTERN DRIVER OUT OF DATE/.test(deaf), 'and the tools say so in character', deaf);
  await old.screenshot({ path: `${SHOTS}/smoke-driver-old.png` });

  // itch.io: the game in a cross-origin iframe, where the browser blocks the line (here: a closed
  // port). INTERN.EXE gives up on the first failure and offers the game's own tab. The fake itch
  // page is a real server on 127.0.0.1 (another site from localhost, but still loopback, so Local
  // Network Access lets it frame the game; a page.route() parent counts as public and is blocked).
  const closedPort = await new Promise((resolve) => {
    const probe = createNetServer().listen(0, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
  const gameUrl = `http://localhost:${HTTP_PORT}/?intern=ws://localhost:${closedPort}`;
  const embed = createHttpServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!doctype html><title>itch</title><iframe src="${gameUrl}" width="1024" height="768" allow="autoplay; fullscreen *"></iframe>`);
  });
  await new Promise((resolve) => embed.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => embed.close());
  const itch = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const parent = await itch.newPage();
  parent.on('pageerror', (err) => console.error('    page error:', err.message));
  await parent.goto(`http://127.0.0.1:${embed.address().port}/`);
  const frame = await (await parent.waitForSelector('iframe')).contentFrame();
  await frame.waitForFunction(() => window.NIGHT_SHIFT);
  await frame.evaluate(() => {
    const { dispatch, actions } = window.NIGHT_SHIFT;
    dispatch(actions.bootComplete());
    dispatch(actions.clockIn());
    dispatch(actions.openFile('intern'));
  });
  await frame.waitForSelector('.intern-app .dial-failed:not([hidden])', { timeout: 10000 });
  const blocked = await frame.evaluate(() => ({
    text: document.querySelector('.intern-app .dial-failed').textContent,
    tab: !document.querySelector('.intern-app .open-tab').hidden,
    tray: document.querySelector('.tray .intern').textContent,
  }));
  expect(/LINE BLOCKED BY YOUR BROWSER/.test(blocked.text) && /access other apps and services/.test(blocked.text) && blocked.tab, 'framed: a failed dial shows LINE BLOCKED with OPEN IN ITS OWN TAB', JSON.stringify(blocked));
  expect(/NO LINE/.test(blocked.tray), 'and the tray says NO LINE', blocked.tray);
  await parent.screenshot({ path: `${SHOTS}/smoke-itch-blocked.png` });
  const [ownTab] = await Promise.all([itch.waitForEvent('page'), frame.click('.intern-app .open-tab')]);
  await ownTab.waitForLoadState();
  const opened = new URL(ownTab.url());
  expect(opened.origin === `http://localhost:${HTTP_PORT}` && opened.searchParams.get('intern') === `ws://localhost:${closedPort}`, 'OPEN IN ITS OWN TAB opens the frame page top-level, dialling the same address', ownTab.url());
  await ownTab.close();
  const framedBefore = await frame.$$eval('.intern-app .msg.intern', (els) => els.length);
  await frame.fill('.intern-app .compose input', 'how do I keep the power up?');
  await frame.press('.intern-app .compose input', 'Enter');
  await frame.waitForFunction((n) => document.querySelectorAll('.intern-app .msg.intern')  .length > n, framedBefore, { timeout: 5000 });
  ok('the scripted intern still answers in the frame');
  console.log(`\nSmoke test passed (${step} checks). Screenshots in ${SHOTS}`);
};

run()
  .catch((err) => {
    console.error(`\nSMOKE FAILED: ${err.stack ?? err}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const fn of cleanup.reverse()) await Promise.resolve().then(fn).catch(() => {});
  });
