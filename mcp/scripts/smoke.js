// End-to-end smoke test: real MCP client -> night-shift-mcp (stdio) -> WebSocket -> the real game
// running in headless Chrome. Plays the whole two-sided badge puzzle.
//
//   npm run smoke            (from the repo root)
//   CHROME_PATH=... npm run smoke   if Chrome is not in a standard location
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { chromium } from 'playwright-core';

const HTTP_PORT = Number(process.env.SMOKE_HTTP_PORT) || 8097;
const WS_PORT = Number(process.env.SMOKE_WS_PORT) || 7118;
const root = (p) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const SHOTS = process.env.SMOKE_SHOTS ?? root('.playwright-mcp');

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
  const serve = spawn(process.execPath, [root('scripts/serve.js')], { env: { ...process.env, PORT: String(HTTP_PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
  cleanup.push(() => serve.kill());
  await new Promise((resolve, reject) => {
    serve.stdout.once('data', resolve);
    serve.once('exit', (code) => reject(new Error(`static server exited (${code})`)));
  });

  const transport = new StdioClientTransport({ command: process.execPath, args: [root('mcp/bin/night-shift-mcp.js'), '--port', String(WS_PORT)], stderr: 'inherit' });
  const client = new Client({ name: 'night-shift-smoke', version: '0.0.0' });
  await client.connect(transport);
  cleanup.push(() => client.close());
  const tool = async (name, args = {}) => {
    const res = await client.callTool({ name, arguments: args });
    const text = res.content.map((c) => c.text).join('\n');
    if (process.env.SMOKE_VERBOSE) console.log(`    > ${name} ${JSON.stringify(args)}\n${text.replace(/^/gm, '    | ')}`);
    return text;
  };

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

  // Payroll: intern shifts, player XORs (intern is not cleared yet), intern finishes.
  expect(/CURRENT is now 0x0000/.test(await tool('shift_right', { puzzle: 'payroll' })), 'agent applies >> 3 on payroll');
  expect(/cannot use XOR/.test(await tool('xor', { puzzle: 'payroll', mask: '0x0F0F' })), 'XOR denied at PROBATION');
  await page.evaluate(() => window.NIGHT_SHIFT.dispatch(window.NIGHT_SHIFT.actions.applyOp('payroll', 2)));
  await tool('shift_left', { puzzle: 'payroll' });
  expect(/SECTOR RECOVERED/.test(await tool('shift_left', { puzzle: 'payroll' })), 'payroll recovered together');
  expect(/"clearance": "OPERATOR"/.test(await tool('whoami')), 'escalation: promoted to OPERATOR');
  const log = await tool('read_file', { path: 'NS-02.LOG' });
  expect(/zero, one, one, seven/.test(log), 'NS-02.LOG now readable: key in words');

  // Badge: the player sees no hex, the agent has the key.
  await page.evaluate(() => window.NIGHT_SHIFT.dispatch(window.NIGHT_SHIFT.actions.openFile('badge')));
  await page.waitForSelector('.bitrot .keyrow');
  const playerHex = await page.$$eval('.bitrot .hex', (els) => els.map((e) => e.textContent.trim()));
  expect(playerHex.length === 2 && playerHex.every((h) => h === '????'), 'player sees the badge pattern but no hex', playerHex.join(','));
  await tool('xor', { puzzle: 'badge', mask: '0xFF00' });
  expect(/Applied XOR 0x0117/.test(await tool('xor', { puzzle: 'badge', mask: '0x0117' })), 'agent unlocks and applies the keyed XOR');
  await tool('shift_left', { puzzle: 'badge', n: 4 });
  expect(/SECTOR RECOVERED/.test(await tool('xor', { puzzle: 'badge', mask: '0xFF00' })), 'BADGE.DB recovered');
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

  // 06:00: the end-of-shift screen, then a fresh shift. Never a dead save.
  await solo.evaluate(() => {
    const { dispatch, actions, getState } = window.NIGHT_SHIFT;
    const s = getState();
    // Keep the lights on so the shift ends at 06:00 rather than in a blackout.
    dispatch(actions.hydrate({ ...s, power: { ...s.power, config: { ...s.power.config, drainPerMinute: 0 } } }));
    dispatch(actions.tick(480));
  });
  await solo.waitForSelector('#shiftend:not([hidden]) .new-shift');
  const card = await solo.textContent('#shiftend');
  expect(/06:00/.test(card) && /scripted/i.test(card), 'end-of-shift screen shows the summary', card.replace(/\s+/g, ' '));
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
