# Session state - NIGHT_SHIFT.EXE

_Last updated: 05/11/2026_

## Status
- Weeks 1 and 2 are merged to `main`.
- Week 3 (Gear Grind + story arc + playtest fixes) is on branch `kwacky1-week-3-gear-grind-story-arc`, with a PR open against `main`.
- Tests: `npm test` runs 193 game + MCP tests. `npm run smoke` passes 47 E2E checks in headless Chrome.
- PR #3 playtest round 1 (Simon, 3 shifts) is fixed on the branch: Gear Grind focus bug, onboarding, and the hold-4th-gear dominant strategy. Not merged yet.

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
  - Onboarding: CHARGE ZONE label on the tacho, `.gg-status` line from `logic/gearStatus.js` (pure, tested), a one-time hint card (`night-shift:gg-hint-seen`; **?** reopens; the sim pauses while it's up), grade-coloured road with signposts, and a "CLIMB +15% in 120 m -> change down" HUD hint.
  - Balance (data only): a 6.2 km road of long climbs (up to 17%) and long descents (down to -12%), `chargeCurve` that drops off fast outside the CHARGE ZONE (`sweetBand` 3200 to 5000), `chargePerSecond` 0.9. `game/tests/night-bots.js` plays a full night through the real reducer with scripted drivers; `scripts/balance.js` prints the table. Current numbers: idle blackout at ~23:35; fixed gears 1-3 black out, fixed 4 ends ~16% (mean 49), fixed 5 mean 60; the rev-shifter holds 70-80% and shifts every ~12 s.
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
- The game bridge only accepts PUZZLE_APPLY_OP / PUZZLE_ENTER_KEY / CHAT_SEND, rebuilt and stamped `actor: 'intern'`. The reducer enforces `core/permissions.js`.
- `mcp/` imports pure game modules from `../game/src`, so publishing to npm needs a copy step.
- Windows has no destroy hook; geargrind stops its loop when its body is disconnected.

## Next (week 4)
- Blame-game finale at 06:00: BLAME.EXE, with the player and the intern each trying to pin #0117's mess on the other. The SHIFTLOG/TIMECLK/0117.SEC clues set it up (one terminal, two badges, one keyboard).
- Audio polish (beyond the engine), visual polish, itch.io build.
- Playtest the new Gear Grind balance with Simon: a human splitting attention should sit at 40-80%. If it is too harsh, lower the `drainCurve` tail or raise `chargePerSecond` slightly, and run `node scripts/balance.js` plus `game/tests/balance.test.js`.
- Consider publishing night-shift-mcp (bundle the game modules).
