# NIGHT_SHIFT.EXE

> You're the only sysadmin on the night shift at a failing 1990s company. Your AI intern is real.

A [GitHub Game Off 2026](https://itch.io/jam/game-off-2026) entry for the theme **SHIFT**.

## Concept

A fake retro operating system you navigate with Shift-click, Shift-drag and renaming files.

- **Bit Rot**: corrupted files open with bitwise puzzles (`<<`, `>>`, XOR).
- **Gear Grind**: the mainframe runs on a manual-gearbox runner. If you stop driving, the power drops.
- **The intern (MCP)**: connect a real AI agent through a local MCP server. The agent reads hidden files and logs, you see the visual clues, and you solve puzzles together. In the finale, you both try to pin the blame on each other.
- **No agent?** A built-in scripted intern (deliberately unhelpful) fills in.

## Tech

- `game/`: browser game (HTML/CSS/JS ES modules, no engine, no build step)
- `mcp/`: Node MCP server (`npx night-shift-mcp`) that talks to the game over `ws://localhost`

## Running it

Needs Node 20+. The game itself has no dependencies; `npm install` is only for the MCP server and its tests.

```sh
npm install
npm start       # serves game/ at http://localhost:8080
npm test        # node:test suites for the game and the MCP server
npm run smoke   # end to end: MCP client -> server -> the game in headless Chrome (needs Chrome or Edge)
```

For itch.io, zip the contents of `game/` (so `index.html` is at the root of the zip) and upload it as an HTML game.

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

Progress is saved to `localStorage`. **Start > Shut Down** wipes the save.

## Connect your intern

The intern is badge #0118. Plug in any MCP-capable agent and it plays #0118 for real. It can read hidden SYSTEM files and the event log, and it sees Bit Rot sectors as numbers. You see the target patterns as pictures. Neither of you can finish the night alone, so you have to talk.

### 1. Start the server

```sh
npm install
npx night-shift-mcp          # from the repo; or `npm link` in mcp/ to put it on your PATH
```

Usually your agent starts it for you (see the configs below). It speaks MCP over stdio and opens a WebSocket for the game on `127.0.0.1:7117`.

| Option | Default | |
| --- | --- | --- |
| `--port` / `NIGHT_SHIFT_PORT` | `7117` | WebSocket port the game dials |
| `--allow-origin <url>` | localhost, `*.itch.zone`, `*.itch.io` | Extra page origin allowed to connect (repeatable) |

### 2. Tell your agent about it

Use the absolute path to `mcp/bin/night-shift-mcp.js` in your clone (or `"command": "npx", "args": ["night-shift-mcp"]` if you ran `npm link`).

**GitHub Copilot CLI**: `~/.copilot/mcp-config.json` (or `/mcp add`)

```json
{
  "mcpServers": {
    "night-shift": {
      "type": "local",
      "command": "node",
      "args": ["/path/to/night-shift/mcp/bin/night-shift-mcp.js"],
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
      "command": "node",
      "args": ["/path/to/night-shift/mcp/bin/night-shift-mcp.js"]
    }
  }
}
```

**Claude Desktop**: `claude_desktop_config.json` (*Settings > Developer > Edit Config*)

```json
{
  "mcpServers": {
    "night-shift": {
      "command": "node",
      "args": ["/path/to/night-shift/mcp/bin/night-shift-mcp.js"]
    }
  }
}
```

On Windows, use escaped backslashes in JSON paths (`"C:\\code\\night-shift\\mcp\\bin\\night-shift-mcp.js"`). Add `"--port", "7200"` to `args` if 7117 is taken.

Then say something like *"You're the intern in NIGHT_SHIFT.EXE. Clock in and help me."* The server ships persona instructions, so the agent knows the rules without being told the answers.

### 3. Dial in from the game

Open **INTERN.EXE** (desktop, Start menu or the `INTERN:` tray button), check the address (`ws://localhost:7117`) and click **Dial**. The tray shows `INTERN: ONLINE` when the agent is on the line. Locally you can also load `http://localhost:8080/?intern=ws://localhost:7117`. The game remembers the address and redials after reloads.

### What the intern can do

| Tool | |
| --- | --- |
| `whoami` | Badge, clearance and allowed ops |
| `list_files`, `read_file` | The whole drive, including hidden SYSTEM files, subject to clearance |
| `read_logs` | The system event log (never shown on your screen) |
| `inspect_puzzle` | A sector's value in hex/binary and its ops. **Never the target.** Keyed masks are redacted. |
| `shift_left`, `shift_right`, `xor`, `enter_key` | Apply ops (costs your moves) or enter an override key |
| `message_player`, `read_messages`, `wait_for_player` | Talk to you through INTERN.EXE |

There is deliberately no "dispatch anything" tool. The intern can't undo, reset, rename, open windows or load a save. Clearance starts at **PROBATION** (shifts only) and is raised to **OPERATOR** (XOR and restricted SYSTEM files) when PAYROLL.DAT is recovered.

### No agent? No worries

With nothing connected, INTERN.EXE runs a scripted intern. It's keen, useless and easily distracted, but if you keep asking the right question it will eventually, grudgingly, cough up what you need. The game is completable without an agent.

### Playing on itch.io (https) with a local intern

The itch.io page is served over https, and the game still dials `ws://localhost` on your own machine. Nothing leaves your computer.

- **Chrome, Edge, Firefox**: allowed. Browsers treat `localhost` as a potentially trustworthy origin, so it isn't blocked as mixed content. Recent Chrome may ask to allow access to devices on your local network: click **Allow**.
- **Safari**: blocks `ws://` from https pages as mixed content. Use another browser, or run the game locally with `npm start`.
- itch.io runs the game in an iframe that doesn't receive query parameters, so use the **Dial** field in INTERN.EXE rather than `?intern=`.
- The server accepts `*.itch.zone` and `*.itch.io` origins by default. If you host the game somewhere else, add `--allow-origin https://your.host`.

### Security

- The WebSocket binds to `127.0.0.1` only, checks the `Host` and `Origin` headers, and accepts one game at a time (a new window replaces the old one).
- Every message is validated on both sides. The game only accepts `PUZZLE_APPLY_OP`, `PUZZLE_ENTER_KEY` and `CHAT_SEND` from the bridge, rebuilds each one field by field, and stamps it `actor: 'intern'` so the reducer enforces clearance. `HYDRATE` and everything else are refused.
- The server never touches your filesystem. "Files" are the game's fake drive, projected from game state.

## Structure

```
game/
  index.html, styles/os.css
  data/
    files.json        the fake file system (8.3 names, locked files, rename unlocks)
    puzzles.json      Bit Rot puzzles: start, target, moveLimit, ops (keyed, playerHides, onSolve)
    intern.json       the scripted fallback intern's lines
  src/
    core/             single serialisable state + dispatch(action)
      actions.js      action types and creators (the public API, and future MCP tools)
      reducer.js      pure (state, action) => state
      store.js        getState / dispatch / subscribe / serialise / hydrate
      initialState.js builds state from the JSON data
      selectors.js    pure read helpers
      permissions.js  intern clearance levels (shared by reducer, bridge and MCP server)
    logic/            pure 16-bit ops, the puzzle engine (BFS solver, validation), hex in words
    intern/           the scripted fallback intern
    ui/               DOM rendering: boot, desktop, windows, explorer, viewer, bitrot, intern, taskbar
    bridge/api.js     window.NIGHT_SHIFT + the ws:// intern bridge (allowlist, reconnect)
    main.js           wires store to UI; timers and saving live here, not in the reducer
  tests/              node:test suites
mcp/                  night-shift-mcp (npm workspace)
  bin/                CLI entry
  src/
    server.js         McpServer, persona instructions, CLI flags
    link.js           localhost WebSocket server the game dials
    schema.js         zod validation for everything the game sends
    projection.js     the intern's view of game state (hidden files yes, targets no)
    tools.js          intern tools
  tests/              node:test suites (fake game over a real socket)
  scripts/smoke.js    end-to-end test with headless Chrome
scripts/serve.js      tiny static dev server
```

### Adding a Bit Rot puzzle

1. Add an entry to `game/data/puzzles.json`. Values can be `"0xBEEF"`, `"0b1010"` or numbers. Ops are `{ "type": "shl" | "shr", "n": 1-15 }` or `{ "type": "xor", "mask": "0x0F0F" }`.
2. Point a file at it in `game/data/files.json` with `"locked": true, "puzzleId": "your-id"`.
3. Run `npm test`. The data test fails if the puzzle can't be solved within its `moveLimit`.

Two-sided puzzles use a few extras:

- `"keyed": true` on an XOR op hides its mask from both sides until someone enters it as an override key. Put the key somewhere only the intern can read (a file with `"hidden": true`, optionally `"minLevel": 2`).
- `"playerHides": ["hex"]` shows the player bit patterns only. The intern never sees targets, so together you have the whole picture.
- `"onSolve": { "internLevel": 2, "message": "..." }` promotes the intern when the sector is recovered.

The data test checks that keyed puzzles can't be solved without their key and that the key is written down in a hidden file.

### The MCP seam

All game state is one JSON object and every change is a `dispatch(action)`. The game is authoritative: it streams its state to the MCP server, which projects an intern-only view and asks the game to run a handful of allowlisted actions.

- In DevTools: `NIGHT_SHIFT.getState()`, `NIGHT_SHIFT.dispatch(NIGHT_SHIFT.actions.openFile('payroll'))`.
- The WebSocket protocol (`hello` / `state` / `dispatch` / `result`, protocol 2) is documented at the top of `game/src/bridge/api.js`.
- `mcp/` imports the game's pure modules (reducer rules, permissions, puzzle logic) from `../game/src`, so it runs from a clone via `npx`/`npm link`. Publishing to npm will need a copy step first.

## Roadmap

1. **Week 1:** OS shell + first Bit Rot puzzle *(done: playable slice in `game/`)*
2. **Week 2:** MCP bridge, two-way play working *(done: `night-shift-mcp`, INTERN.EXE, clearance, BADGE.DB)*
3. **Week 3:** Gear Grind power mechanic + story arc
4. **Week 4:** audio, polish, blame-game finale

Deadline: 1 December 2026, 13:37 PST.

## Licence

MIT
