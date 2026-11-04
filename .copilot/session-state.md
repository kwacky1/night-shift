# Session state - NIGHT_SHIFT.EXE

_Last updated: 04/11/2026_

## Status
- Week 1 (OS shell + PAYROLL.DAT Bit Rot) is merged to `main`.
- Week 2 MCP bridge is on branch `kwacky1-week-2-mcp-intern-bridge`, with a PR open against `main`.
  - `mcp/` = `night-shift-mcp` (npm workspace): stdio MCP server plus a WebSocket on 127.0.0.1:7117 (`--port`, `NIGHT_SHIFT_PORT`, `--allow-origin`).
  - Intern tools: whoami, list_files, read_file, read_logs, inspect_puzzle, shift_left, shift_right, xor, enter_key, message_player, read_messages, wait_for_player. There is no raw dispatch tool.
  - Clearance: PROBATION (shl, shr) -> OPERATOR (+xor, minLevel 2 files) when PAYROLL.DAT is solved (`onSolve.internLevel`).
  - BADGE.DB is two-sided. The player sees bits but no hex, and the intern sees hex but no target. The keyed XOR 0x0117 is written in words in the hidden `C_DRIVE\SYSTEM\NS-02.LOG` (OPERATOR only).
  - INTERN.EXE chat window, tray status, dial-in field (URL saved in localStorage). The scripted fallback intern (`game/data/intern.json`) leaks the key on the 4th ask once promoted.
- Tests: `npm test` runs game + mcp suites (85+). `npm run smoke` runs the full E2E with headless Chrome via playwright-core.

## Architecture notes
- The game is authoritative and streams full state. The MCP server projects the intern view (`mcp/src/projection.js`).
- The game bridge only accepts PUZZLE_APPLY_OP / PUZZLE_ENTER_KEY / CHAT_SEND, rebuilt and stamped `actor: 'intern'`. The reducer enforces `core/permissions.js`.
- `mcp/` imports pure game modules from `../game/src`, so publishing to npm needs a copy step.

## Next (week 3)
- Gear Grind power mechanic + story arc. More permission escalations over the night.
- Consider publishing night-shift-mcp (bundle the game modules).
