# Session state - NIGHT_SHIFT.EXE

_Last updated: 05/11/2026_

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

## Playtest handover (04/11/2026)
- Local game server and MCP bridge were running at `http://localhost:8080` and `ws://localhost:7117`.
- Multiple open game windows competed for the single intern connection; the newest window to click **Dial** takes over.
- Active playtest state: PAYROLL.DAT recovered, intern #0118 promoted to OPERATOR, BADGE.DB still corrupted.
- BADGE.DB current value was `0x0118`; player described target as `0000 1111 1111 0000` (`0x0FF0`).
- Hidden audit revealed the keyed XOR override `0x0117`.
- Verified four-move solution, not yet applied: `XOR 0xFF00` -> keyed `XOR 0x0117` -> `<< 4` -> `XOR 0xFF00`.
- The intern line dropped before the player could approve execution. Resume by opening INTERN.EXE, dialling `ws://localhost:7117`, checking current state, and agreeing the move plan before applying it.


## Fallback playtest fixes (05/11/2026)
- Override keys are always hex: `parseKey` (game/src/logic/words.js) accepts `0x0117`, `0117`, `117` and words. The reducer and the MCP enter_key/xor tools both use it.
- The scripted intern tracks `intern.lastTopic`, so follow-ups (please, go on, ?) and unmatched messages continue the thread. Readout and policy questions go to the key topic, and 'you' no longer means #0117.
- A `solve` topic (only after the key is unlocked) gives escalating hints, then op types from the BFS route.
- The `pattern` detector reads 16-bit rows as CURRENT or TARGET from nearby words. A heard target (`intern.heardTargets`) gets a full route from the real current value. A mismatched current gets an in-character correction.
- Fixed: the boot skip handler kept eating the first key when boot ended without a skip (DevTools or hydrate).
- 102 unit tests pass. `npm run smoke` passes 30 checks, including a scripted-intern replay of the playtest.
