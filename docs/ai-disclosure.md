# AI disclosure: NIGHT_SHIFT.EXE

For the GitHub Game Off 2026 submission form and the itch.io page.

## AI as a game mechanic (optional)

The intern, badge #0118, can be played by any MCP-capable AI agent (GitHub Copilot, Claude, or anything else that speaks the Model Context Protocol) that the player brings themselves.

- The player runs a small local server, `night-shift-mcp` (open source, on npm), from their agent's MCP config. It runs on the player's own machine. The game in the browser connects to it over `ws://localhost`. The game doesn't call any AI service, and nothing is sent to us.
- The agent never sees the raw game state. The server projects an intern-only view through an allowlist: the files the intern's clearance can read, sector values as numbers (never the targets), the chat, and the power level. Audit scoring and ending rules are stripped before they reach any tool.
- The agent can only do what the intern can: read files and logs, run a few puzzle ops (limited by clearance, a per-sector quota and ops that only work from one side), enter override keys, chat, and file one statement at the 06:00 audit. The game rebuilds and checks every request and refuses anything else.
- No AI is needed to play. With no agent connected, a scripted intern (hand-written dialogue and rules, no AI at runtime) fills in, and the game can be finished either way.
- Which agent and model the player uses, and what that agent does with what it sees, is up to the player and their AI provider.

## AI used to build the game

- Designed and directed by Simon (goosey-games). The concept, mechanics, theme, story outline and balance calls are his.
- Most of the code, tests and documentation were written by GitHub Copilot in agent sessions (Copilot CLI and the GitHub Copilot app), working to Simon's plans. Simon set the design for each milestone, playtested every build and reviewed every pull request before it merged.
- Puzzle data (the Bit Rot sectors), story text, file contents, the scripted intern's lines and the audit endings were drafted with AI and edited by Simon. Automated tests check every puzzle is solvable, that neither side can solve one alone, and that every ending can be reached.
- No AI-generated art or audio. The visuals are hand-built HTML, CSS and canvas drawing. The only sound is Gear Grind's engine note, a Web Audio synth generated in code (off by default). There are no image or audio files in the game.
