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

- `game/`: browser game (HTML/CSS/JS, no engine)
- `mcp/`: Node MCP server (`npx night-shift-mcp`) that talks to the game over `ws://localhost`

## Roadmap

1. **Week 1:** OS shell + first Bit Rot puzzle
2. **Week 2:** MCP bridge, two-way play working
3. **Week 3:** Gear Grind power mechanic + story arc
4. **Week 4:** audio, polish, blame-game finale

Deadline: 1 December 2026, 13:37 PST.

## Licence

MIT
