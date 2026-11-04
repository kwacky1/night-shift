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
- `mcp/`: Node MCP server (`npx night-shift-mcp`) that talks to the game over `ws://localhost` *(week 2)*

## Running it

Needs Node 20+. No dependencies to install.

```sh
npm start   # serves game/ at http://localhost:8080
npm test    # node:test suite for the pure logic and data
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

## Structure

```
game/
  index.html, styles/os.css
  data/
    files.json        the fake file system (8.3 names, locked files, rename unlocks)
    puzzles.json      Bit Rot puzzles: start, target, moveLimit, ops
  src/
    core/             single serialisable state + dispatch(action)
      actions.js      action types and creators (the public API, and future MCP tools)
      reducer.js      pure (state, action) => state
      store.js        getState / dispatch / subscribe / serialise / hydrate
      initialState.js builds state from the JSON data
      selectors.js    pure read helpers
    logic/            pure 16-bit ops and the puzzle engine (BFS solver, validation)
    ui/               DOM rendering: boot, desktop, windows, explorer, viewer, bitrot, taskbar
    bridge/api.js     window.NIGHT_SHIFT + optional ws:// intern bridge
    main.js           wires store to UI; timers and saving live here, not in the reducer
  tests/              node:test suites
scripts/serve.js      tiny static dev server
```

### Adding a Bit Rot puzzle

1. Add an entry to `game/data/puzzles.json`. Values can be `"0xBEEF"`, `"0b1010"` or numbers. Ops are `{ "type": "shl" | "shr", "n": 1-15 }` or `{ "type": "xor", "mask": "0x0F0F" }`.
2. Point a file at it in `game/data/files.json` with `"locked": true, "puzzleId": "your-id"`.
3. Run `npm test`. The data test fails if the puzzle can't be solved within its `moveLimit`.

### The MCP seam

All game state is one JSON object and every change is a `dispatch(action)`. The UI uses exactly the same API that the week 2 MCP server will use:

- In DevTools: `NIGHT_SHIFT.getState()`, `NIGHT_SHIFT.dispatch(NIGHT_SHIFT.actions.openFile('payroll'))`.
- Load the game with `?intern=ws://localhost:PORT` to connect a local bridge. Only `localhost`/`127.0.0.1` URLs are accepted. The protocol is documented at the top of `game/src/bridge/api.js`.

## Roadmap

1. **Week 1:** OS shell + first Bit Rot puzzle *(done: playable slice in `game/`)*
2. **Week 2:** MCP bridge, two-way play working
3. **Week 3:** Gear Grind power mechanic + story arc
4. **Week 4:** audio, polish, blame-game finale

Deadline: 1 December 2026, 13:37 PST.

## Licence

MIT
