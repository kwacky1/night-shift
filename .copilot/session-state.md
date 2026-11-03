# Session state - NIGHT_SHIFT.EXE

_Last updated: 03/11/2026_

## Status
- Week 1 vertical slice done on branch `kwacky1-week-1-os-shell-bit-rot`, with a PR open against `main`.
- Playable path: boot, clock in at 22:00, desktop, PAYROLL.DAT Bit Rot puzzle, then the story hook (badge #0117 was terminated on 13/10/1997 but clocked in tonight).
- Extra hook: renaming `C_DRIVE\SHIFTLOG.BAK` to `SHIFTLOG.TXT` restores the shift log.
- 34 node:test tests cover bits, the puzzle engine, the reducer, the store, data validation and the bridge URL guard.

## Architecture notes
- Single JSON state, `dispatch(action)`, pure reducer with structural sharing (`game/src/core`).
- `window.NIGHT_SHIFT` exposes the store API. `?intern=ws://localhost:PORT` connects an optional WebSocket bridge (`game/src/bridge/api.js`). The protocol is in that file's header.
- UI-only ephemeral state (rename in progress, start menu, intern online) lives in `ui/dom.js`, never in game state.

## Next (week 2)
- `mcp/` Node MCP server exposing the actions as tools and projecting state per role (asymmetric info).
- Scripted fallback intern.
- More puzzles in `game/data/puzzles.json`.
