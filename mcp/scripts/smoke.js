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
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
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
