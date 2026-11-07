// Takes the itch.io page screenshots (docs/itch/*.png) from the real game in headless Chrome, with
// a real MCP client on the intern line so the chat is genuine. Spoiler-safe: no override keys on
// screen and no ending text.
//
//   npm run screenshots
//   SHOTS_GAME_ROOT=dist/html npm run screenshots   shoot the itch.io build instead of game/
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { chromium } from 'playwright-core';

const HTTP_PORT = Number(process.env.SHOTS_HTTP_PORT) || 8098;
const WS_PORT = Number(process.env.SHOTS_WS_PORT) || 7119;
const root = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const OUT = root('docs/itch');
const SIZE = { width: 1280, height: 720 };

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

// Never let a key value or an ending into a shot.
const SPOILERS = [/0x0117/i, /(?<!#)\b0117\b(?!\.SEC)/, /zero, one, one, seven/i, /0x0600/i, /ENDINGS FOUND/i];

const cleanup = [];
const run = async () => {
  mkdirSync(OUT, { recursive: true });
  const env = { ...process.env, PORT: String(HTTP_PORT), ...(process.env.SHOTS_GAME_ROOT && { SERVE_ROOT: process.env.SHOTS_GAME_ROOT }) };
  const serve = spawn(process.execPath, [root('scripts/serve.js')], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  cleanup.push(() => serve.kill());
  await new Promise((resolve, reject) => {
    serve.stdout.once('data', resolve);
    serve.once('exit', (code) => reject(new Error(`static server exited (${code})`)));
  });

  const client = new Client({ name: 'night-shift-screenshots', version: '0.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [root('mcp/bin/night-shift-mcp.js'), '--port', String(WS_PORT)], stderr: 'ignore' }));
  cleanup.push(() => client.close());
  const tool = async (name, args = {}) => (await client.callTool({ name, arguments: args })).content.map((c) => c.text).join('\n');

  const executablePath = chromePath();
  if (!executablePath) throw new Error('No Chrome/Edge found. Set CHROME_PATH.');
  const browser = await chromium.launch({ executablePath, headless: true });
  cleanup.push(() => browser.close());
  const context = await browser.newContext({ viewport: SIZE });
  // Gear Grind's how-to card has been seen; it'd cover the road.
  await context.addInitScript(() => localStorage.setItem('night-shift:gg-hint-seen', '1'));
  const page = await context.newPage();
  page.on('pageerror', (err) => console.error('  page error:', err.message));

  const game = (fn, arg) => page.evaluate(fn, arg);
  const shot = async (name, opts = {}) => {
    // The default port, not the one this script borrowed.
    await page.evaluate(() => document.querySelectorAll('.intern-app input').forEach((i) => /^ws:/.test(i.value) && (i.value = 'ws://localhost:7117')));
    const text = await page.evaluate(() => document.body.innerText);
    const leak = SPOILERS.find((re) => re.test(text));
    if (leak) throw new Error(`${name}: spoiler on screen (${leak}): ...${text.slice(Math.max(0, text.search(leak) - 200), text.search(leak) + 80)}`);
    const path = `${OUT}/${name}`;
    await page.screenshot({ path, ...opts });
    console.log(`  ${name.padEnd(20)} ${(statSync(path).size / 1024).toFixed(0).padStart(4)} KB`);
  };
  const closeAll = () => game(() => {
    const { dispatch, actions, getState } = window.NIGHT_SHIFT;
    for (const w of getState().windows) dispatch(actions.closeWindow(w.id));
  });
  const place = (id, x, y) => game(([id, x, y]) => {
    const { dispatch, actions, getState } = window.NIGHT_SHIFT;
    const w = getState().windows.find((w) => w.fileId === id || w.id === id);
    if (w) dispatch(actions.moveWindow(w.id, x, y));
  }, [id, x, y]);
  // Run the clock forward a minute at a time, clearing alerts as the story fires, to `minutes` in.
  const clockTo = (minutes) => game((target) => {
    const { dispatch, actions, getState } = window.NIGHT_SHIFT;
    while (getState().clock.elapsed < target && getState().phase === 'desktop') {
      dispatch(actions.tick(1));
      if (getState().alert) dispatch(actions.dismissAlert());
    }
  }, minutes);
  const steadyPower = (level) => game((level) => {
    const { dispatch, actions, getState } = window.NIGHT_SHIFT;
    const s = getState();
    dispatch(actions.hydrate({ ...s, power: { ...s.power, level, config: { ...s.power.config, drainPerMinute: 0 } } }));
  }, level);

  await page.goto(`http://localhost:${HTTP_PORT}/?intern=ws://localhost:${WS_PORT}`);
  await page.waitForFunction(() => window.NIGHT_SHIFT);
  await game(() => {
    const { dispatch, actions } = window.NIGHT_SHIFT;
    dispatch(actions.bootComplete());
    dispatch(actions.clockIn());
  });
  await page.waitForSelector('.tray .intern[data-status="online"]', { timeout: 10000 });
  const drainPerMinute = await game(() => window.NIGHT_SHIFT.getState().power.config.drainPerMinute);
  await steadyPower(78);
  // 23:20: GENSET.CFG has turned up (PAYROLL.DAT's title gives too much away for a screenshot).
  await clockTo(80);
  await steadyPower(78);

  // 01: the desktop, a memo open, the intern on the line.
  await game(() => window.NIGHT_SHIFT.dispatch(window.NIGHT_SHIFT.actions.openFile('readme')));
  await page.waitForTimeout(300);
  await place('readme', 360, 90);
  await page.mouse.click(1100, 600);
  await page.waitForTimeout(300);
  await shot('01-desktop.png');

  // 02: GENSET.CFG mid-solve: the sysadmin has made a move and the intern another.
  await closeAll();
  await game(() => window.NIGHT_SHIFT.dispatch(window.NIGHT_SHIFT.actions.openFile('genset')));
  await page.waitForSelector('.bitrot');
  await game(() => window.NIGHT_SHIFT.dispatch(window.NIGHT_SHIFT.actions.applyOp('genset', 0)));
  await tool('shift_left', { puzzle: 'genset' });
  await place('genset', 330, 60);
  await page.waitForTimeout(400);
  await shot('02-bitrot.png');

  // 04 (before Gear Grind, so the chat is fresh): a short exchange with a real MCP client.
  await closeAll();
  await game(() => window.NIGHT_SHIFT.dispatch(window.NIGHT_SHIFT.actions.openFile('intern')));
  await page.waitForSelector('.intern-app');
  await place('intern', 300, 50);
  const say = async (text) => {
    await page.fill('.intern-app .compose input', text);
    await page.press('.intern-app .compose input', 'Enter');
    await tool('wait_for_player', { timeoutSeconds: 3 });
  };
  const intern = async (text) => {
    await tool('message_player', { text });
    await page.waitForFunction((t) => [...document.querySelectorAll('.intern-app .msg.intern')].some((m) => m.textContent.includes(t)), text.slice(0, 20));
  };
  await intern("Evening! Intern #0118 on the remote line. I can see the SYSTEM folder from here, just not your screen.");
  await say("GENSET.CFG has Bit Rot. I can see the target, you can't.");
  await intern("Copy. I've got it as numbers. I did a << 1 from my end, so that's one of my three remote ops gone.");
  await say("Good. I'll do the rest from the console.");
  await intern('Done. Also PWR is under 80% and dropping. Someone should drive the generator. Not me, apparently.');
  await page.waitForTimeout(400);
  await shot('04-intern-chat.png');

  // 03: driving Generator 2, in the CHARGE ZONE if we can find it. Real drain, so the status line is honest.
  await closeAll();
  await game(([level, drain]) => {
    const { dispatch, actions, getState } = window.NIGHT_SHIFT;
    const s = getState();
    dispatch(actions.hydrate({ ...s, power: { ...s.power, level, config: { ...s.power.config, drainPerMinute: drain } } }));
  }, [64, drainPerMinute]);
  await game(() => window.NIGHT_SHIFT.dispatch(window.NIGHT_SHIFT.actions.openFile('geargrind')));
  await page.waitForSelector('.geargrind canvas');
  await place('geargrind', 250, 30);
  await page.click('.window:has(.geargrind) .titlebar .title');
  const change = async (key) => {
    await page.keyboard.down('Space');
    await page.waitForTimeout(120);
    await page.keyboard.press(key);
    await page.waitForTimeout(120);
    await page.keyboard.up('Space');
  };
  await page.keyboard.down('Space');
  await page.waitForTimeout(1200);
  await page.keyboard.press('ShiftRight');
  await page.waitForTimeout(200);
  await page.keyboard.up('Space');
  let inZone = false;
  for (let i = 0; i < 160 && !inZone; i++) {
    await page.waitForTimeout(150);
    const g = await game(() => ({
      charging: document.querySelector('.gg-status').dataset.charging,
      ...window.NIGHT_SHIFT.getState().power.generator,
    }));
    if (g.stalled) {
      await page.keyboard.down('Space');
      await page.waitForTimeout(1200);
      await page.keyboard.up('Space');
    } else if (g.charging === 'yes' && g.rpm >= 3600 && i > 20) inZone = true;
    else if (g.rpm > 4700 && g.gear < 5) await change('ShiftRight');
    else if (g.rpm < 3300 && g.gear > 1) await change('ShiftLeft');
  }
  if (!inZone) console.log('  (did not settle in the CHARGE ZONE; shooting anyway)');
  await shot('03-geargrind.png');

  // 05: 06:00, BLAME.EXE. The intern has filed; the sysadmin has picked a suspect and a line.
  await closeAll();
  await steadyPower(70);
  await clockTo(479);
  await steadyPower(70);
  await game(() => window.NIGHT_SHIFT.dispatch(window.NIGHT_SHIFT.actions.tick(1)));
  await page.waitForSelector('.blame-app .blame-form:not([hidden])', { timeout: 10000 });
  await tool('read_file', { path: 'BOOTLOG.TXT' });
  // State pushes after a TICK are coalesced, so give the line a moment to hear about the audit.
  for (let i = 0; i < 20 && /no audit running/.test(await tool('audit_status')); i++) await page.waitForTimeout(250);
  const filed = await tool('submit_blame', { suspect: 'sysadmin', evidence: ['BOOTLOG.TXT:4'], statement: 'I was on the remote line all night. Ask NS-02.' });
  if (!/Statement filed/.test(filed)) throw new Error(`submit_blame: ${filed}`);
  await page.waitForFunction(() => /#0118: statement filed/.test(document.querySelector('.blame-app .status').textContent));
  await place('blame', 300, 30);
  await page.check('.blame-app input[name="suspect"][value="0118"]');
  // Cite a line from a plain memo, never one of the logs with a key in it.
  await page.selectOption('.blame-app select', 'memo1').catch(() => {});
  await page.waitForTimeout(200);
  const lines = await page.$$('.blame-app .lines li[data-ref]');
  let cited = false;
  for (const li of lines) {
    const text = await li.textContent();
    if (text.trim().length > 24 && !SPOILERS.some((re) => re.test(text))) {
      await li.click();
      cited = true;
      break;
    }
  }
  if (!cited && lines[0]) await lines[0].click();
  await page.waitForSelector('.blame-app .chips .chip');
  await page.fill('.blame-app input[name="statement"]', 'The intern ran half the ops tonight. Check the logs.');
  await page.waitForTimeout(300);
  await shot('05-blame.png');

  // cover.png (630x500): the title over the Bit Rot shot.
  const bg = readFileSync(`${OUT}/02-bitrot.png`).toString('base64');
  const cover = await context.newPage();
  await cover.setViewportSize({ width: 630, height: 500 });
  await cover.setContent(`<!doctype html><style>
    body { margin: 0; width: 630px; height: 500px; overflow: hidden; background: #000080; font-family: 'Courier New', monospace; }
    .bg { position: absolute; inset: 0; background: url(data:image/png;base64,${bg}) 46% 20% / 1000px auto no-repeat; filter: brightness(.55) saturate(.8); }
    .scan { position: absolute; inset: 0; background: repeating-linear-gradient(transparent 0 2px, rgba(0,0,0,.25) 2px 3px); }
    .card { position: absolute; left: 0; right: 0; bottom: 0; padding: 22px 28px 26px; background: linear-gradient(transparent, rgba(0,0,40,.92) 30%); }
    h1 { margin: 0; color: #ffb000; font-size: 52px; letter-spacing: 1px; text-shadow: 3px 3px 0 #000; }
    p { margin: 6px 0 0; color: #e0e0e0; font-size: 19px; text-shadow: 2px 2px 0 #000; }
    .tag { color: #4a7; }
  </style><div class="bg"></div><div class="scan"></div><div class="card"><h1>NIGHT_SHIFT.EXE</h1>
    <p>ACME Dataworks, Brisbane. 3 Nov 1997. 22:00.</p><p class="tag">&gt;&gt; bit shifts. gear shifts. night shift.</p></div>`);
  await cover.screenshot({ path: `${OUT}/cover.png` });
  console.log(`  ${'cover.png'.padEnd(20)} ${(statSync(`${OUT}/cover.png`).size / 1024).toFixed(0).padStart(4)} KB`);
  console.log(`\nScreenshots in ${OUT}`);
};

run()
  .catch((err) => {
    console.error(`\nSCREENSHOTS FAILED: ${err.stack ?? err}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const fn of cleanup.reverse()) await Promise.resolve().then(fn).catch(() => {});
  });
