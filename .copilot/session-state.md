# Session state - NIGHT_SHIFT.EXE

_Last updated: week 4, intern line fallback on itch_

## Status
- Weeks 1 to 3 are merged to `main`, and so are week 4 PRs #1 to #5 (itch CI upload via butler works; page is goosey-games.itch.io/night-shift, draft).
- Branch `kwacky1-intern-line-fallback-on-itch`: INTERN.EXE handles the itch iframe (see below). PR open against `main`.
- Tests: `npm test` runs 264 game + MCP tests. `npm run smoke` passes 81 E2E checks in headless Chrome (both finales, a driver mismatch and the itch frame included).
- Milestones 2 and 3 (audio, polish) are still proposed below. Ask Simon before starting each one.

## Intern line on itch.io
- **Why**: Chrome/Edge Local Network Access blocks a public page from `ws://localhost` until allowed, and in a cross-origin iframe the parent must delegate `local-network-access`. itch's iframe doesn't, so the dial fails silently with no prompt. As a top-level tab, html-classic.itch.zone gets Edge's "access other apps and services on this device" prompt and connects after Allow.
- **Dial cap** (`bridge/api.js`): `connectIntern` takes `maxAttempts` (default `DIAL_ATTEMPTS` 5, counted as failed opens in a row, reset on open) and then reports `'failed'` `{ attempts }` with no more redials. Backoff 1 to 10 s is unchanged. Quiet auto-dials still go silent (`'offline'`) after `QUIET_ATTEMPTS` and never show failed. main.js passes `maxAttempts: 1` when framed.
- **`bridge/line.js`** (pure, `line.test.js`): `isFramed` (try/catch, a throw counts as framed), `localNetworkPermission` (feature-detects `local-network-access` then `loopback-network`, errors ignored), `dialFailure` (LINE BLOCKED BY YOUR BROWSER + own tab when framed, DIAL FAILED otherwise; the hint points at site settings when the permission is `denied`), `ownTabUrl` (same page with `?intern=` set to the dialled address).
- **UI**: INTERN.EXE `.dial-failed` banner with Retry and OPEN IN ITS OWN TAB (`window.open(..., '_blank', 'noopener')`), status "Dial failed. Scripted intern on duty.", tray `NO LINE`. The scripted intern keeps working.
- **Saves**: verified in real Chrome 156 / Edge 156 (Playwright disables `ThirdPartyStoragePartitioning` by default, so the check used plain launch args) that iframe localStorage is partitioned from the same origin as a top-level tab. The new tab starts its own save; the hint says so. Simon chose warn-only (no save transfer).
- **Smoke**: a real 127.0.0.1 server frames the game on localhost with `?intern=` at a closed port. A `page.route()` parent counts as public and LNA blocks the frame itself, hence the real server.

## Earlier status
- Week 4 milestone 1 (BLAME.EXE finale, intern balance, NO CHANGE, version handshake) was on branch `kwacky1-week-4-blame-finale`, now merged.
- Week 4 milestone 4 (ship) was on branch `kwacky1-week-4-ship-milestone`, now merged.

## Week 4 milestone 4 summary (ship)
- **Build**: `npm run build` (`scripts/build.js`) copies `game/` minus tests into `dist/html/` and fails on any absolute or missing `src`/`href`/`import`/`fetch` path. `game/tests/build.test.js` builds into a temp dir and checks the same. Data is fetched relative to `import.meta.url`, so it works under itch's subpath iframe. `serve.js` takes `SERVE_ROOT`; `SMOKE_GAME_ROOT=dist/html npm run smoke` plays the build.
- **CI** (`.github/workflows/ci.yml`, replaces `test.yml`): `test` job runs npm ci/test/build and uploads `night-shift-html-<sha>`. `itch` job (push to main or manual) skips with a notice if `ITCH_TOKEN` is unset, else pushes the artefact with `Ayowel/butler-to-itch` (pinned) to `goosey-games/${vars.ITCH_GAME || 'night-shift'}`, channel `html`, version `<root version>+<sha7>`. Linted with `@action-validator/cli` and actionlint.
- **npm**: `mcp/scripts/bundle.js` (esbuild, `prepack`) bundles `src/server.js` + the game modules into `mcp/dist/server.js` (gitignored). The bin runs `src/` when `../game/src` exists (clone, tests, smoke) and `dist/` otherwise. Package ships bin, dist, README.md, LICENSE. `npm run verify-pack` packs, installs into a temp project, checks for `../game` imports and runs the full smoke with `SMOKE_MCP_BIN`. A test keeps `VERSION` in server.js equal to `mcp/package.json`. Not published yet.
- **Docs**: `docs/itch/page.md` (blurb, controls, npx config, credits, itch settings: HTML, 1024x768, fullscreen button on, mobile off), `docs/ai-disclosure.md`, `mcp/README.md` (npm page). README: Play section, npx-first Connect your intern, Building and releasing.
- **Screenshots**: `npm run screenshots` (`scripts/screenshots.js`) shoots `docs/itch/0[1-5]-*.png` at 1280x720 and `cover.png` at 630x500 with a real MCP client on the line; it refuses to shoot if a key value or ending text is on screen. Uses GENSET.CFG for Bit Rot (PAYROLL.DAT's title shows the badge key).
- **Simon to do**: create the itch.io project, add `ITCH_TOKEN` (and `ITCH_GAME` if the slug differs), tick 'played in the browser' after the first upload, `npm publish` night-shift-mcp, submit to Game Off before 1 Dec 13:37 PST with `docs/ai-disclosure.md`.

## Week 4 milestone 1 summary
- **State v4**: puzzles gain `by` (who made each move), `internMoves`, `noop`, `solvedBy`; ops gain `hands`; new `blame` slice; stats `playerOps`/`internOps`/`scriptedOps`. `migrateSave` (`fromV3`) refreshes definitions and keeps progress (old moves count as the player's). PROTOCOL_VERSION 3.
- **Handshake** (`bridge/api.js`, `mcp/src/link.js`): `hello` carries `protocol` + `version`. The driver replies `welcome`, or `reject` + close 4003. The game shows INTERN DRIVER OUT OF DATE (game vP.V, driver vP.V) in INTERN.EXE (`.driver-old`) and DRIVER OLD in the tray; tools say the same. Unreadable state gets a `warn` (LINE NOISE) instead of silence.
- **Balance** (`core/permissions.js`, `logic/puzzle.js`, `data/puzzles.json`): per-op `hands` (player = console only, intern = remote only) and a per-sector `internMoves` quota (undo/reset refund). `solveTogether` finds a joint route; `game/tests/hands.test.js` proves neither side can solve any sector alone and both can together. The Bit Rot UI tags ops CONSOLE/REMOTE, shows REMOTE n/N, and clicking a remote-only op asks #0118 (scripted intern does it via `fallbackAsk`, AI gets one chat request per op, debounced by `askPending` until the sector changes or 45 s; the button reads ASK #0118 / ASKED). A `NEXT: YOU [..] or #0118 [..]` line (`nextHands`) shows whose hands can apply which ops given clearance, keys and quota, never the route.
- **No-op**: an op that changes nothing costs no move or quota, sets `puzzle.noop`, flashes NO CHANGE on the board and the MCP tool result says NO CHANGE.
- **BLAME.EXE** (`core/blame.js`, `data/blame.json`, `ui/blame.js`): at 06:00, if BLAME.EXE has been revealed (05:00 beat), `startAudit` freezes the clock and Bit Rot, unlocks and opens BLAME.EXE. Each side files once (`BLAME_SUBMIT`: suspect, up to 3 `fileId:line` refs, statement <= 140). Player cites files it can open (not hidden); intern cites what its clearance can read AND what it has actually read (tracked server-side). Scoring: accusations, evidence points/clears/tags, facts from the night (stalls, intern ops, who solved what). Endings in order: typing (twist: one keyboard), both (blamed each other), yourname, again, management, equipment (default). Opening the audit posts a SYSTEM ping (`ping: true`, AUDIT_PING) that wakes read_messages/wait_for_player, and MCP tool results carry a HEAD OFFICE reminder until #0118 files (not on audit_status/submit_blame). `scriptedBlameDecision`: while an AI is online/taken it never auto-files (BLAME.EXE shows WAITING FOR #0118...); FILE WITHOUT THE INTERN forces the scripted statement; if the AI disconnects it falls back to the scripted statement 2 s after the player. The scripted statement always blames the sysadmin. WAIT FOR THE AUDIT (taskbar button, `canWaitForAudit`: desktop, all 4 puzzles solved, before 06:00): one-way `WAIT_FOR_AUDIT` sets `clock.waiting`, parks the generator, posts WAIT_PING (`ping: true`); `drainRate` is 0 and story drain/stall effects are skipped while waiting; `tickMs` runs the tick loop at msPerMinute / FAST_FORWARD (8), one minute per tick so beats fire in order; `clock.waiting` is saved, so a reload keeps fast-forwarding; startAudit clears it. At 06:00 Generator 2 parks (generator reset, DRIVE_REPORT ignored, no drain/stall since the clock is frozen); GEARGRIND.EXE shows a "DAY CREW HAS THE GENERATOR" card from `generatorWrapUp` (same figures as the end screen) and its controls go dead. End screen shows the ending, who blamed whom and ENDINGS FOUND (`localStorage` `night-shift:endings`, separate from the save).
- **MCP**: `audit_status`, `submit_blame` (PATH:LINE citations), numbered `read_file` lines, schema strips weights/endings and the player's statement. INSTRUCTIONS are spoiler-free (tested). night-shift-mcp 0.2.0.

## Week 3 summary
- **State v3** (`core/initialState.js`, `core/save.js`): adds `power`, `stats`, `story`, `shiftEnd` and `shiftNumber`. `migrateSave` upgrades week 2 saves. A save that is past 06:00 or at zero power is closed out to the end-of-shift screen, so there is never a dead save.
- **Clock**: 2 s per game minute (`data/night.json` `msPerMinute`). The tick loop pauses while an alert is up or the tab is hidden. A long TICK that runs power dry stops the clock at the blackout.
- **Power** (`core/power.js`): starts at 80 and drains 0.85 per minute × `drainCurve(elapsed)` (×1.2 from 03:00, ×1.3 by 06:00) × `drainScale`. `drainRate(state)` is the one place that works this out (the TICK blackout clamp uses it). Charge goes through `chargeTaper(level)` (1 up to 50%, 0.5 at 80%, 0.08 at 100%). `migrateSave` refreshes `power.config` from data, so retuning reaches old saves. Statuses are ok, flicker <50, brownout <30, critical <15, blackout 0.
  - Brownout: the intern can chat, but its ops and keys are refused (`internActionError`).
  - Critical: Bit Rot ops are refused for everyone.
  - Blackout: `endShift('blackout')`.
  - DRIVE_REPORT charge is capped at 2 per report. DRIVE_REPORT is NOT in the bridge allowlist.
- **Gear Grind** (`logic/gearbox.js`, `data/gearbox.json`, `ui/geargrind.js`): a pure fixed-step sim, `advance(sim, input, elapsed, cfg, carry)`. The UI runs a rAF loop and sends 4 Hz reports.
  - Default keys: Space clutch, ShiftLeft down, ShiftRight up. Rebindable with **Keys...** and saved in localStorage.
  - Audio is a sawtooth through a lowpass, off by default.
  - Focus: clicking anywhere on the window (the title bar's drag handler preventDefaults, so it never moved focus) or focusing it via the store calls `grab()`: blur any text input elsewhere and focus `.geargrind` (tabindex 0). While the window is focused, gear keys are handled and preventDefaulted whatever the event target. `.geargrind[data-clutch]` exposes the clutch for the smoke test.
  - Onboarding: CHARGE ZONE label on the tacho, `.gg-status` line from `logic/gearStatus.js` (pure, tested), a one-time hint card (`night-shift:gg-hint-seen`; **?** reopens; the sim pauses while it's up), grade-coloured road with signposts, and a "CLIMB +15% in 120 m -> change down soon" HUD hint (right-aligned, measured and wrapped with `wrapText` so it never clips; strings budgeted by `HUD_CHARS` 24 / `STATUS_CHARS` 60 / `OVERLAY_CHARS` 32, tested; overlay text from pure `overlayStatus`/`FLASHES`; `.gg-status` wraps with the drain as a nowrap span) (pure `lookAhead`, gear/speed aware, silent unless the status is CHARGING).
  - Hill starts: in 1st below `launchRpm` the clutch slips: the engine runs at `launchRpm`, torque comes from there and only the road speed counts towards charge. Releasing the clutch on a free-revving engine sets `dump` (`dumpSeconds` of `dumpTorque` x torque, rpm decays to launch). Tests: 1st climbs max grade + 3% from standstill, reaches the band within 10 s on the max grade, and a stall there is recoverable.
  - Balance (data only): a 6.2 km road of long climbs (up to 17%) and long descents (down to -12%), `chargeCurve` that drops off fast outside the CHARGE ZONE (`sweetBand` 3200 to 5000), `chargePerSecond` 0.9. `game/tests/night-bots.js` plays a full night through the real reducer with scripted drivers; `scripts/balance.js` prints the table. Current numbers: idle blackout at ~23:35; fixed gears 1-3 black out, fixed 4 ends ~23% (mean 53), fixed 5 mean 61; the rev-shifter holds 69-80% (1 stall) and shifts every ~12 s.
  - The app file is `GEARGR~1.EXE` (8.3 names; the MCP schema caps names at 12 characters).
- **Story** (`core/story.js`, `data/story.json`): beats keyed on `at` and/or `when`, each firing once per shift. The reducer wrapper runs `advanceStory` after the STORY_TRIGGERS actions.
  - Beats: 22:05 Facilities; 22:40 ghost; 23:15 GENSET.CFG revealed; 00:30 shift log nudge; 01:13 surge; renaming SHIFTLOG.BAK reveals TIMECLK.DAT and TIMECLK.AUD (02:00 fallback if not); brownout warning; timeclk solved; 03:40 stall; 05:00 BLAME.EXE teaser and alert; 05:45 last call.
  - Ghost posts are `from: 'ghost'` (#0117). The story never posts as the intern.
- **New sectors**:
  - `genset`: unkeyed; solving it sets `drainScale` to 0.6.
  - `timeclk`: keyed XOR 0x0600, written in words in the hidden TIMECLK.AUD (minLevel 2); `playerHides` hex. Solving it promotes the intern to **SUPERVISOR** (level 3).
  - `C_DRIVE\SYSTEM\0117.SEC` is SUPERVISOR only.
  - `BLAME.EXE` is a locked week 4 placeholder ("installing... 97%").
  - `"dormant": true` files are invisible to everyone (player, MCP) until revealed. Use `livePuzzles(state)` in selectors.
- **Bridge** (`bridge/api.js`):
  - Close code 4000 gives the `taken` status. INTERN.EXE shows a LINE TAKEN banner with Redial; the tray shows LINE TAKEN.
  - A saved URL is redialled quietly (4 tries with backoff); `?intern=` dials loudly.
  - TICK and DRIVE_REPORT state pushes are coalesced to about 1/s.
- **Scripted intern** (`intern/fallback.js`, `data/intern.json`):
  - Topics can be gated with `when: "revealed"` + `file`.
  - Matching sector topics prefer the focused puzzle, e.g. "the key" while TIMECLK.DAT is open.
  - New topics: power (with `lowLines` and `{{power}}`), timesolve, timekey, genset, shiftlog, sealed, blame.
  - `fallbackNag(prev, next, script)` gives unprompted nags: when power crosses `nagBelow` (40), when the status worsens, and every 30 game minutes while low. main.js only nags when the line isn't online or taken.
- **MCP**:
  - Schema accepts `ghost`, `dormant`, `power`, `stats`, `shiftEnd` and `shiftNumber`. Story and config are stripped, except the power thresholds.
  - whoami shows mainframePower, powerStatus, generator, powerNote, canRunOps and whoDrives (nag when low).
  - Tools say "shift over" after 06:00 or a blackout.
  - The instructions mention power without spoilers.
- **Bit Rot UI**: has a legend. The `.off-wrong` "should be lit" state is a dashed amber outline. An INSUFFICIENT POWER banner shows when critical.

## Architecture notes
- The game is authoritative and streams full state. The MCP server projects the intern view (`mcp/src/projection.js`).
- The game bridge only accepts PUZZLE_APPLY_OP / PUZZLE_ENTER_KEY / CHAT_SEND / BLAME_SUBMIT, rebuilt and stamped `actor: 'intern'`. The reducer enforces `core/permissions.js`.
- `mcp/src` imports pure game modules from `../game/src`; the npm package bundles them (`mcp/dist`).
- Windows has no destroy hook; geargrind stops its loop when its body is disconnected.

## Next (week 4, proposed; ask Simon first)
1. **Milestone 2, audio**: Web Audio SFX and ambient hum, all generated (no assets) or tiny CC0: key clicks, CRT whine, generator (reuse the Gear Grind synth), #0117 glitch sting on ghost posts, NO CHANGE buzz, a short finale cue per ending. One master volume/mute in the tray, honouring the existing Gear Grind audio toggle; off until the first user gesture. Pure "which sound for which action" mapping tested with node:test.
2. **Milestone 3, polish**: SETTINGS.EXE (audio, CRT/scanline toggle, reduced motion, colourblind-safe Bit Rot legend with shapes as well as colours, text size), a title screen before boot, CREDITS.TXT. Settings in localStorage, separate from the save. Playtest the hands/quota balance and Gear Grind numbers with Simon.
3. ~~**Milestone 4, ship**~~: done (see above).
