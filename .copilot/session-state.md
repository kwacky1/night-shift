# Session state - NIGHT_SHIFT.EXE

_Last updated: 07/11/2026_

## Status
- Weeks 1 and 2 are merged to `main`.
- Week 3 (Gear Grind + story arc + playtest fixes) is on branch `kwacky1-week-3-gear-grind-story-arc`, with a PR open against `main`.
- Tests: `npm test` runs 178 game + MCP tests. `npm run smoke` passes 42 E2E checks in headless Chrome.

## Week 3 summary
- **State v3** (`core/initialState.js`, `core/save.js`): adds `power`, `stats`, `story`, `shiftEnd` and `shiftNumber`. `migrateSave` upgrades week 2 saves. A save that is past 06:00 or at zero power is closed out to the end-of-shift screen, so there is never a dead save.
- **Clock**: 2 s per game minute (`data/night.json` `msPerMinute`). The tick loop pauses while an alert is up or the tab is hidden. A long TICK that runs power dry stops the clock at the blackout.
- **Power** (`core/power.js`): starts at 80 and drains 0.7 per minute × `drainScale`. Statuses are ok, flicker <50, brownout <30, critical <15, blackout 0.
  - Brownout: the intern can chat, but its ops and keys are refused (`internActionError`).
  - Critical: Bit Rot ops are refused for everyone.
  - Blackout: `endShift('blackout')`.
  - DRIVE_REPORT charge is capped at 2 per report. DRIVE_REPORT is NOT in the bridge allowlist.
- **Gear Grind** (`logic/gearbox.js`, `data/gearbox.json`, `ui/geargrind.js`): a pure fixed-step sim, `advance(sim, input, elapsed, cfg, carry)`. The UI runs a rAF loop and sends 4 Hz reports.
  - Default keys: Space clutch, ShiftLeft down, ShiftRight up. Rebindable with **Keys...** and saved in localStorage.
  - Audio is a sawtooth through a lowpass, off by default.
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
- Playtest Gear Grind difficulty: drain 0.7/min vs charge 2.5/s in the sweet band. Tune `night.json` / `gearbox.json` if driving feels like a chore or too easy.
- Consider publishing night-shift-mcp (bundle the game modules).
