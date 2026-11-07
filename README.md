# NIGHT_SHIFT.EXE

> You're the only sysadmin on the night shift at a failing 1990s company. Your AI intern is real.

A [GitHub Game Off 2026](https://itch.io/jam/game-off-2026) entry for the theme **SHIFT**.

## Play

**https://goosey-games.itch.io/night-shift** (in the browser; the slug may still change before launch)

Want a real AI as your intern? Add `npx -y night-shift-mcp` to your agent's MCP config and click **Dial** in INTERN.EXE. See [Connect your intern](#connect-your-intern).

## Concept

A fake retro operating system you navigate with Shift-click, Shift-drag and renaming files.

- **Bit Rot**: corrupted files open with bitwise puzzles (`<<`, `>>`, XOR).
- **Gear Grind**: the mainframe runs on a generator with a manual gearbox and a throttle that's stuck open. If you stop driving, the power drops. The intern can't drive.
- **The intern (MCP)**: connect a real AI agent through a local MCP server. The agent reads hidden files and logs, you see the visual clues, and you solve puzzles together. In the finale, you both try to pin the blame on each other.
- **No agent?** A built-in scripted intern (deliberately unhelpful) fills in.

## Tech

- `game/`: browser game (HTML/CSS/JS ES modules, no engine). `npm run build` copies it into `dist/html/` for itch.io; there's no bundling or transpiling.
- `mcp/`: Node MCP server ([`night-shift-mcp`](mcp/README.md) on npm) that talks to the game over `ws://localhost`

## Running it

Needs Node 20+. The game itself has no dependencies; `npm install` is only for the MCP server and its tests.

```sh
npm install
npm start       # serves game/ at http://localhost:8080
npm test        # node:test suites for the game and the MCP server
npm run smoke   # end to end: MCP client -> server -> the game in headless Chrome (needs Chrome or Edge)
npm run build   # the itch.io upload, in dist/html/
```

The dev server sends `Cache-Control: no-store` on every response, so after editing code just refresh the page; no restart needed. Restart it only when you switch worktrees (it serves the `game/` folder of the checkout it was started from). `SERVE_ROOT=dist/html npm start` serves the build instead.

### Controls

| Input | Does |
| --- | --- |
| Double-click / Enter | Open the selected file(s) |
| Shift+click | Select a range (desktop or explorer) |
| Ctrl+click | Add or remove one file from the selection |
| Drag on empty desktop | Marquee select |
| Drag an icon | Move that icon |
| Shift+drag an icon | Move the whole selection |
| F2 | Rename the selected file (8.3 names; Enter to save, Esc to cancel) |
| `1`-`9`, `Z`, `R` | Bit Rot: apply an op, undo, reset (when its window is focused) |
| Space | Gear Grind: clutch (hold) |
| Right Shift / Left Shift | Gear Grind: shift up / shift down (only with the clutch in) |

Gear Grind keys only work while GEARGR~1.EXE is the focused window. Clicking anywhere on it (title bar, road, buttons) gives it the keyboard, even if you were just typing to the intern, so Space never ends up in the chat box. Click **Keys...** in its window to rebind them (press clutch, down, up in turn; Esc cancels; clashing keys fall back to the defaults). The bindings are saved per browser. The on-screen Clutch / Down / Up buttons work with a mouse or touch too. Engine sound is **off** by default: click **Sound** to toggle it.

Progress is saved to `localStorage`. **Start > Shut Down** wipes the save.

## The shift

A shift runs from 22:00 to 06:00 at two real seconds per game minute (about 16 minutes). The clock pauses while an alert box is up or the tab is hidden.

### Power and GEARGRIND.EXE

Mainframe power (the `PWR` meter in the tray, amber when LOW, orange at BROWNOUT, red when CRITICAL) drains every game minute. The only way to charge it is to drive Generator 2 in **GEARGR~1.EXE**:

- The throttle is stuck open, so all you do is work the clutch and pick gears. There is no steering.
- The road has hills. Each gear has its own torque curve: too high a gear for the slope and the engine bogs and stalls; too low and it screams into the limiter and stalls. Grinding (shifting without the clutch) does nothing useful.
- Keep the rev needle in the green **CHARGE ZONE** on the tacho. Outside it, charging drops away fast. The line under the road says what's happening right now (`CHARGING +1.6%/min | drain -0.9%/min`, or `NOT CHARGING: wrong gear - revs too low, change down`).
- The road is coloured by grade (amber climbs, blue descents) with signposts where it changes, and the HUD warns you ("15% CLIMB IN 120 m -> change down soon"). Expect to change gear every 10 to 20 seconds; no single gear works for long.
- If it stalls, hold the clutch to crank it back to life.
- Stopped on a hill? Hold the clutch, drop to 1st and let go. 1st slips the clutch so it always pulls away, even on the steepest climb; letting it in from high revs dumps the clutch for a short extra shove.
- The status line always comes first and gives one bit of advice that fits your gear (it never says "change down" in 1st). The HUD look-ahead only adds advice when you're already charging and moving.
- The first time you open it, a card explains the controls. **?** brings it back.

The top of the tank is hard to fill: charging tapers off above 50% and is slow above 80%. The drain also gets meaner after 02:00. With nobody driving, a full mainframe lasts about four real minutes.

Low power bites:

| Power | |
| --- | --- |
| under 50% | The screen dims and flickers |
| under 30% | **Brownout**: the intern line browns out. Chat still works, but the intern can't run ops or enter keys |
| under 15% | **Critical**: Bit Rot is offline for everyone |
| 0% | **Blackout**: the shift is over |

So you're always splitting your attention: a puzzle needs solving, the intern needs your eyes, and the needle keeps dropping. The intern can see the power in `whoami`, and it will nag.

### The story

Things happen during the night: messages from Facilities, files that weren't there an hour ago, a generator that has opinions about 03:40, and a colleague called #0117 who payroll says doesn't work here any more. There are more sectors to recover after PAYROLL.DAT and BADGE.DB, and the intern's clearance keeps going up. No spoilers here: read the logs.

### 06:00: the audit

Head Office has questions about NS-02. If BLAME.EXE has made it onto your desktop by 06:00, the clock stops, NS-02 freezes and **BLAME.EXE** opens. You and #0118 each file one statement: who did it (#0117, you, the intern, Facilities or Head Office), up to three `file:line` citations from things you've been able to open tonight, and a sentence of why. The intern files through its own tool: the moment the audit opens, #0118 gets a **06:00 AUDIT OPEN** ping in `read_messages`, and every tool result reminds it until it has filed. While an AI intern is on the line, BLAME.EXE shows **WAITING FOR #0118...** for as long as it takes, with a **FILE WITHOUT THE INTERN** button if you give up on it. With no AI (or if it hangs up while you wait), the scripted intern files after you, and it is not on your side. Recovered all four sectors early? A **WAIT FOR THE AUDIT ⏩** button appears on the taskbar. It's one way: Generator 2 parks (no drain, no stalls, no driving), #0118 gets a SYSTEM line saying you're waiting, and the clock runs 8x until 06:00. Every story beat still fires in order, and a reload carries on fast-forwarding. Generator 2 goes to the day crew at 06:00: GEARGRIND.EXE parks, stops draining and stalling, and shows a wrap-up card (km driven, stalls, lowest mainframe power) pointing you at BLAME.EXE. Head Office weighs the accusations, the evidence and what actually happened on the night, then writes a name in the report. There are several endings. Some of them are not good for you. The end screen keeps an **ENDINGS FOUND** tally across shifts (in `localStorage` under `night-shift:endings`, separate from the save).

### End of shift

At 06:00 (or at a blackout, or after the audit) the shift ends on a summary screen: sectors recovered, power, kilometres driven, stalls and whether you used the intern (a real agent, the scripted one, or nobody). **Clock in for another shift** starts a fresh game. A finished shift is never left as a save you can't play.

### Bit Rot legend

Each puzzle window has a legend: **green** squares are lit and correct, **amber** squares are lit but should be off, and a **dashed amber outline** is a square that should be lit but isn't.

### Two pairs of hands

Some ops only work from one side. A small **CONSOLE** tag means only you can run it at NS-02; **REMOTE** means only the intern can, down the line (clicking it asks #0118 to do it). The intern also has a small remote op quota per sector (**REMOTE n/N** on the board); undo or reset gives ops back. Neither of you can recover a sector alone.

Remote-only ops are requests: the button reads **ASK #0118** and, with an AI on the line, sends one chat request and then shows **ASKED** until the sector changes (or 45 s pass), so a double click doesn't nag. Under the buttons, **NEXT: YOU [1 3] or #0118 [2]** shows whose hands can apply which op right now, given clearance, keys and the remote quota. It never says which op is right.

An op that wouldn't change the value (`>> 3` on `0x0000`, say) flashes **NO CHANGE** and doesn't cost a move or any remote quota. The intern's tools say NO CHANGE too.

## Connect your intern

The intern is badge #0118. Plug in any MCP-capable agent and it plays #0118 for real. It can read hidden SYSTEM files and the event log, and it sees Bit Rot sectors as numbers. You see the target patterns as pictures. Neither of you can finish the night alone, so you have to talk.

### 1. Tell your agent about it

You need Node 20+. Your agent starts the server itself with `npx -y night-shift-mcp` ([npm package](mcp/README.md)). It speaks MCP over stdio and opens a WebSocket for the game on `127.0.0.1:7117`.

**GitHub Copilot CLI**: `~/.copilot/mcp-config.json` (or `/mcp add`)

```json
{
  "mcpServers": {
    "night-shift": {
      "type": "local",
      "command": "npx",
      "args": ["-y", "night-shift-mcp"],
      "tools": ["*"]
    }
  }
}
```

**VS Code**: `.vscode/mcp.json` in your workspace (or *MCP: Add Server*)

```json
{
  "servers": {
    "night-shift": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "night-shift-mcp"]
    }
  }
}
```

**Claude Desktop**: `claude_desktop_config.json` (*Settings > Developer > Edit Config*)

```json
{
  "mcpServers": {
    "night-shift": {
      "command": "npx",
      "args": ["-y", "night-shift-mcp"]
    }
  }
}
```

Add `"--port", "7200"` to `args` if 7117 is taken (and dial `ws://localhost:7200`).

| Option | Default | |
| --- | --- | --- |
| `--port` / `NIGHT_SHIFT_PORT` | `7117` | WebSocket port the game dials |
| `--allow-origin <url>` | localhost, `*.itch.zone`, `*.itch.io` | Extra page origin allowed to connect (repeatable) |

Then say something like *"You're the intern in NIGHT_SHIFT.EXE. Clock in and help me."* The server ships persona instructions, so the agent knows the rules without being told the answers.

### 2. Or run it from a clone

If you're hacking on the game, point your agent at the checkout instead, so the server and the game always match:

```sh
npm install
```

```json
"command": "node",
"args": ["/path/to/night-shift/mcp/bin/night-shift-mcp.js"]
```

On Windows, use escaped backslashes in JSON paths (`"C:\\code\\night-shift\\mcp\\bin\\night-shift-mcp.js"`). From a clone the bin runs `mcp/src/` directly against `game/src/`, so there's nothing to rebuild.

### 3. Dial in from the game

Open **INTERN.EXE** (desktop, Start menu or the `INTERN:` tray button), check the address (`ws://localhost:7117`) and click **Dial**. The tray shows `INTERN: ONLINE` when the agent is on the line. Locally you can also load `http://localhost:8080/?intern=ws://localhost:7117`. The game remembers the address and quietly redials it whenever the game loads (a few tries with backoff). If nothing answers, the scripted intern stays on duty.

The game and the driver check each other's protocol and state version on `hello`. If they don't match (say you updated the game but your agent is still running an old `night-shift-mcp`), the line is refused out loud: INTERN.EXE and the tray say **INTERN DRIVER OUT OF DATE (game vN, driver vM)** / `DRIVER OLD`, and every tool tells the agent the same. Update the server (
px -y night-shift-mcp@latest, or restart it from the same checkout as the game) and Redial. A state message the driver can't read shows **LINE NOISE** rather than going quietly deaf.

Only one game window can hold the line. If you open the game in a second tab, that tab takes the line and the first one shows **LINE TAKEN BY ANOTHER TERMINAL** in INTERN.EXE and the tray, with a **Redial** button to take it back.

### What the intern can do

| Tool | |
| --- | --- |
| `whoami` | Badge, clearance, allowed ops, the clock and mainframe power |
| `list_files`, `read_file` | The whole drive, including hidden SYSTEM files, subject to clearance. Lines are numbered for citing. |
| `read_logs` | The system event log (never shown on your screen) |
| `inspect_puzzle` | A sector's value in hex/binary and its ops. **Never the target.** Keyed masks are redacted. |
| `shift_left`, `shift_right`, `xor`, `enter_key` | Apply ops (costs your moves) or enter an override key |
| `message_player`, `read_messages`, `wait_for_player` | Talk to you through INTERN.EXE |
| `audit_status`, `submit_blame` | The 06:00 audit: suspects, files it has read, and its one statement (`suspect`, `evidence: ["PATH:LINE"]`, `statement`). It can only cite files it has actually read that shift. |

There is deliberately no "dispatch anything" tool. The intern can't undo, reset, rename, open windows or load a save. Clearance starts at **PROBATION** (shifts only), goes up to **OPERATOR** (XOR and restricted SYSTEM files) when PAYROLL.DAT is recovered, and to **SUPERVISOR** (sealed files) later in the night. During a brownout the intern can still chat, but ops and keys are refused. The intern can never drive the generator. Console-only ops and a spent remote quota are refused in character.

### No agent? No worries

With nothing connected, INTERN.EXE runs a scripted intern. It's keen, useless and easily distracted (and it moans when the power is low), but if you keep asking the right question it will eventually, grudgingly, cough up what you need. Short follow-ups ("please", "go on", "?") keep the current thread going. Read it a Bit Rot row as 1s and 0s ("the target is 0000 1111 1111 0000") and it will work out a route from wherever the sector is now. Override keys are always hex, so the key box takes `0x0117`, `0117` or "zero, one, one, seven". The game is completable without an agent.

### Playing on itch.io (https) with a local intern

The itch.io page is served over https, and the game still dials `ws://localhost` on your own machine. Nothing leaves your computer.

- **Chrome, Edge, Firefox**: allowed. Browsers treat `localhost` as a potentially trustworthy origin, so it isn't blocked as mixed content. Recent Chrome may ask to allow access to devices on your local network: click **Allow**. If you clicked Block, the padlock's site settings (for html.itch.zone) let you change it back.
- **Safari**: blocks `ws://` from https pages as mixed content. Use another browser, or run the game locally with `npm start`.
- itch.io runs the game in an iframe that doesn't receive query parameters, so use the **Dial** field in INTERN.EXE rather than `?intern=`.
- The server accepts `*.itch.zone` and `*.itch.io` origins by default. If you host the game somewhere else, add `--allow-origin https://your.host`.

### Security

- The WebSocket binds to `127.0.0.1` only, checks the `Host` and `Origin` headers, and accepts one game at a time (a new window replaces the old one).
- Every message is validated on both sides. The game only accepts `PUZZLE_APPLY_OP`, `PUZZLE_ENTER_KEY`, `CHAT_SEND` and `BLAME_SUBMIT` from the bridge, rebuilds each one field by field, and stamps it `actor: 'intern'` so the reducer enforces clearance. `HYDRATE` and everything else are refused.
- The server strips everything it doesn't need on the way in (zod schema), so audit weights and ending rules never reach a tool. The intern sees the suspects, its own statement and whether you've filed, not what you said.
- The server never touches your filesystem. "Files" are the game's fake drive, projected from game state.

## Structure

```
game/
  index.html, styles/os.css
  data/
    files.json        the fake file system (8.3 names, locked files, rename unlocks)
    puzzles.json      Bit Rot puzzles: start, target, moveLimit, ops (keyed, playerHides, onSolve)
    intern.json       the scripted fallback intern's lines and power nags
    story.json        the night's story beats
    blame.json        BLAME.EXE: suspects, evidence weights, facts, endings, the scripted statement
    night.json        clock speed and mainframe power (drain, thresholds)
    gearbox.json      Gear Grind: gears, torque curves, the road
  src/
    core/             single serialisable state + dispatch(action)
      actions.js      action types and creators (the public API, and future MCP tools)
      reducer.js      pure (state, action) => state
      store.js        getState / dispatch / subscribe / serialise / hydrate
      initialState.js builds state from the JSON data
      selectors.js    pure read helpers
      permissions.js  intern clearance levels (shared by reducer, bridge and MCP server)
      power.js        mainframe power: drain, charge, brownout and friends
      story.js        the story beat engine
      shift.js        end of shift and the summary
      blame.js        the 06:00 audit: citations, scoring, the verdict, the endings tally
      save.js         save migration (never a dead save)
    logic/            pure 16-bit ops, the puzzle engine (BFS solver, validation), hex in words,
                      gearbox.js (the Gear Grind sim: step(sim, input, dt))
    intern/           the scripted fallback intern
    ui/               DOM rendering: boot, desktop, windows, explorer, viewer, bitrot, intern,
                      geargrind (canvas + Web Audio), taskbar, shiftend, blame
    bridge/api.js     window.NIGHT_SHIFT + the ws:// intern bridge (allowlist, reconnect)
    main.js           wires store to UI; timers and saving live here, not in the reducer
  tests/              node:test suites
mcp/                  night-shift-mcp (npm workspace, published to npm)
  bin/                CLI entry: runs src/ in a clone, the bundle in dist/ when installed from npm
  src/
    server.js         McpServer, persona instructions, CLI flags
    link.js           localhost WebSocket server the game dials
    schema.js         zod validation for everything the game sends
    projection.js     the intern's view of game state (hidden files yes, targets no)
    tools.js          intern tools
  tests/              node:test suites (fake game over a real socket)
  scripts/smoke.js    end-to-end test with headless Chrome
  scripts/bundle.js   esbuild: src/ + the game modules it uses -> dist/server.js (prepack)
  README.md           the npm page
scripts/
  serve.js            tiny static dev server (SERVE_ROOT to serve another folder)
  build.js            npm run build: game/ -> dist/html/ for itch.io, relative paths checked
  verify-pack.js      npm run verify-pack: pack + install night-shift-mcp, smoke the tarball
  screenshots.js      npm run screenshots: the itch.io page images in docs/itch/
  balance.js          plays a night with scripted drivers and prints the power table
docs/
  itch/               itch.io page copy, settings, cover and screenshots
  ai-disclosure.md    the jam's AI disclosure
.github/workflows/ci.yml   test + build + artefact on every push/PR; itch.io upload from main
```

### Adding a Bit Rot puzzle

1. Add an entry to `game/data/puzzles.json`. Values can be `"0xBEEF"`, `"0b1010"` or numbers. Ops are `{ "type": "shl" | "shr", "n": 1-15 }` or `{ "type": "xor", "mask": "0x0F0F" }`.
2. Point a file at it in `game/data/files.json` with `"locked": true, "puzzleId": "your-id"`.
3. Run `npm test`. The data test fails if the puzzle can't be solved within its `moveLimit`.

Two-sided puzzles use a few extras:

- `"keyed": true` on an XOR op hides its mask from both sides until someone enters it as an override key. Put the key somewhere only the intern can read (a file with `"hidden": true`, optionally `"minLevel": 2`).
- `"playerHides": ["hex"]` shows the player bit patterns only. The intern never sees targets, so together you have the whole picture.
- `"onSolve": { "internLevel": 2, "message": "..." }` promotes the intern when the sector is recovered.

- `"onSolve": { "drainScale": 0.6 }` makes the mainframe drain slower from then on.
- `"hands": "player" | "intern"` on an op makes it console-only or remote-only (default `"both"`).
- `"internMoves": 2` caps the intern's remote ops per attempt on the sector.

The data test checks that keyed puzzles can't be solved without their key and that the key is written down in a hidden file. `game/tests/hands.test.js` checks that, for every sector, the intern alone can't solve it, the player alone can't solve keyed or remote-only ones, and the two of you together can within the quota (`solveTogether` in `logic/puzzle.js`).

### Tuning the audit

`game/data/blame.json` (validated by `validateBlame`, checked in `game/tests/blame.test.js`):

- `suspects`: `{ id, name }`. Each accusation is worth `accusationWeight` to the accused, unless the accuser's own evidence clears them (a contradiction, which forfeits it).
- `evidence`: `{ ref: "fileId:line", points: { suspect: n }, clears: [suspect], tags: [...] }`. Cited lines add points; `clears` takes one off a suspect. Uncited lines count for nothing.
- `facts`: things the night itself proves (`stat`, `solved`, `solvedBy`, `movesBy` intern/player), with points of their own.
- `endings`: checked in order, the first whose `when` holds wins (`verdict`, `player`/`intern` suspect, `tags` counts, `facts`, `any` of several); the last has no `when` and is the default. Titles 24 characters, text 280.
- `scripted`: the scripted intern's statements. It only cites what it could read.

The verdict is the unique top score, or nobody on a tie. Each ending is reachable in the tests.

### Adding a story beat

Add a beat to `game/data/story.json`:

```json
{ "id": "my-beat", "at": "01:30", "when": { "solved": ["payroll"] }, "effects": [{ "do": "post", "from": "system", "text": "..." }] }
```

- `at` is a clock time between 22:00 and 06:00. `when` conditions (all must hold): `solved`, `unsolved`, `flag`, `notFlag`, `unlocked`, `locked`, `powerBelow`, `level`, `fired`, `notFired`. A beat needs at least one of `at` or `when`.
- Effects: `post` (from `system` or `ghost`), `log`, `alert`, `reveal` (a `"dormant": true` file), `flag`, `internLevel`, `drain`, `stall`.
- Each beat fires once per shift. Files marked `"dormant": true` in `files.json` don't exist for anyone (player or intern) until a beat reveals them, and the data test fails if one never is.
- The full reference is at the top of `game/src/core/story.js`.

### Tuning Gear Grind

`game/data/gearbox.json` holds the idle, lug, redline and blow-up revs, each gear's ratio (km/h per 1000 rpm) and torque table, the road profile, the CHARGE ZONE (`sweetBand`), the 1st-gear `launchRpm` (where the clutch slips when pulling away) and the `dumpTorque`/`dumpSeconds` clutch-dump shove, the `chargeCurve` (rpm to 0..1) and the charge rate. `game/data/night.json` holds the drain, the `drainCurve` (minutes into the shift to a drain multiplier) and the `chargeTaper` (power level to a charge multiplier). The sim is pure (`step(sim, input, dt)`) and runs at a fixed 60 Hz step.

`node scripts/balance.js` plays a whole night with scripted drivers (nobody, each gear held all night, and a driver that shifts on the revs) and prints how the power fares. `game/tests/balance.test.js` holds the line: no single gear can keep the mainframe above 70%, and the rev-shifter keeps the lights on all night. HUD and status text is drawn into a fixed 500x200 canvas (scaled to the window), measured with `measureText` and word-wrapped; `game/tests/gearstatus.test.js` also holds every status, look-ahead and flash string to a character budget (`HUD_CHARS`, `STATUS_CHARS`, `OVERLAY_CHARS` in `logic/gearStatus.js`). `game/tests/gearbox.test.js` checks that 1st pulls away from a standstill on the steepest grade on the road plus 3% and that a stall on that climb can be recovered.

### The MCP seam

All game state is one JSON object and every change is a `dispatch(action)`. The game is authoritative: it streams its state to the MCP server, which projects an intern-only view and asks the game to run a handful of allowlisted actions.

- In DevTools: `NIGHT_SHIFT.getState()`, `NIGHT_SHIFT.dispatch(NIGHT_SHIFT.actions.openFile('payroll'))`.
- The WebSocket protocol (`hello` with `protocol` + `version`, `welcome` / `reject`, `state`, `dispatch`, `result`, `warn`; protocol 3) is documented at the top of `game/src/bridge/api.js`. Bump `STATE_VERSION` (and add a save migration) when the state shape changes; the handshake will then refuse an old driver out loud.
- `mcp/src` imports the game's pure modules (reducer rules, permissions, puzzle logic) from `../game/src`, so there's one copy of the rules. The npm package bundles them into `mcp/dist/server.js` (see [Building and releasing](#building-and-releasing)).

## Building and releasing

### The itch.io build

```sh
npm run build        # dist/html/: index.html, styles/, src/, data/ (no tests)
```

It's a straight copy of `game/` minus the tests, and it fails if any `src`, `href`, `import` or `fetch` path is absolute or points at something that isn't in the build. itch.io serves the game from a subpath inside an iframe, so everything is relative (the JSON data is fetched relative to `main.js`). `game/tests/build.test.js` checks the same in `npm test`. `SMOKE_GAME_ROOT=dist/html npm run smoke` plays the full smoke test against the build.

### CI and the itch.io upload

`.github/workflows/ci.yml`:

- **test** (every push and PR): `npm ci`, `npm test`, `npm run build`, then uploads `dist/html` as the artefact `night-shift-html-<sha>`. Download it from the run to try a build.
- **itch** (push to `main`, or **Run workflow** by hand): pushes that artefact to itch.io with butler, on the `html` channel of `goosey-games/<ITCH_GAME>`, versioned `<package.json version>+<short sha>`.
  - Needs the repo secret **`ITCH_TOKEN`**: a butler API key from itch.io > Settings > API keys.
  - The repo variable **`ITCH_GAME`** sets the project slug (default `night-shift`).
  - Without the secret the job skips with a notice rather than failing.

The first time, create the itch.io project (Kind: HTML) before the upload, then tick **This file will be played in the browser** on the `html` upload and set the embed size. Suggested settings and the page copy are in [`docs/itch/page.md`](docs/itch/page.md). `npm run screenshots` retakes the page images.

### Publishing night-shift-mcp to npm

`mcp/src` imports the game's rules from `../game/src`, which doesn't exist in an npm install. So `prepack` (`mcp/scripts/bundle.js`) bundles `src/server.js` and the game modules it uses into `mcp/dist/server.js` with esbuild (npm deps stay external), and the package ships only `bin/`, `dist/`, `README.md` and `LICENSE`. The bin runs `src/` when it finds the game next door (a clone: tests and the smoke always use the live source) and `dist/` otherwise. `mcp/dist/` is gitignored.

1. Bump `version` in `mcp/package.json` **and** `VERSION` in `mcp/src/server.js` (a test checks they match). If the game's `PROTOCOL_VERSION` or `STATE_VERSION` changed, the old driver will be refused by the new game (and the other way round), so ship the game and the package together.
2. `npm run verify-pack`: packs the workspace, installs the tarball into a fresh temp project, checks nothing in it imports `../game`, and runs the full smoke test against the installed bin. It must pass.
3. `npm login` (with 2FA), then `npm publish --workspace mcp` (or `cd mcp && npm publish`).

## Roadmap

1. **Week 1:** OS shell + first Bit Rot puzzle *(done: playable slice in `game/`)*
2. **Week 2:** MCP bridge, two-way play working *(done: `night-shift-mcp`, INTERN.EXE, clearance, BADGE.DB)*
3. **Week 3:** Gear Grind power mechanic + story arc *(done: GEARGR~1.EXE, mainframe power and brownouts, the night's story, SUPERVISOR clearance, end-of-shift screen)*
4. **Week 4:** blame-game finale and intern balance *(milestone 1: BLAME.EXE, two pairs of hands, NO CHANGE, the version handshake)*; shipping *(milestone 4: the itch.io build and CI upload, `night-shift-mcp` on npm, page copy, screenshots and the AI disclosure)*; audio and polish still to come (milestones 2 and 3)

Deadline: 1 December 2026, 13:37 PST.

## Licence

MIT
