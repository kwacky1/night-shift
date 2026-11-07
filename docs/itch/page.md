# itch.io page: NIGHT_SHIFT.EXE

Copy for the itch.io project page and the settings to use. Screenshots and the cover are in this folder (`npm run screenshots` retakes them).

---

## Short description (the one-liner under the title)

You're the only sysadmin on the night shift. Your intern might be a real AI.

## Page text

It's 22:00 on 3 November 1997. You're the only sysadmin on the night shift at ACME Dataworks, Brisbane. The mainframe is falling apart, the generator's throttle is stuck open, and your intern is on a remote line two floors away.

NIGHT_SHIFT.EXE is a fake 1997 operating system. You click around a desktop, open files you probably shouldn't, and keep the place running until 06:00.

**Bit Rot.** Corrupted files open as 16-bit puzzles. Shift left, shift right, XOR. You can see what the sector should look like. You can't see everything. Some ops only work at your console. Some only work down the intern's line.

**Gear Grind.** The mainframe runs on Generator 2, and Generator 2 has a manual gearbox. Work the clutch, pick a gear, keep the needle in the CHARGE ZONE. Stop driving and the lights start to go. The intern can't drive. It will remind you.

**The intern.** Badge #0118. Plug in any AI agent that speaks MCP (GitHub Copilot, Claude, and friends) and it plays the intern for real. It reads the files you can't open, sees the sectors as numbers, and has to talk you through it in chat. No agent? A scripted intern fills in. It's keen. It's not very useful. It gets there eventually.

**06:00.** Head Office wants to know what happened to NS-02. Somebody's name goes in the report. You'd rather it wasn't yours.

Theme: SHIFT. Bit shifts, gear shifts, and a night shift. Made for GitHub Game Off 2026.

A shift is about 16 minutes. Progress saves in your browser.

### Controls

| | |
| --- | --- |
| Double-click / Enter | Open a file |
| Shift+click, Ctrl+click, drag | Select files |
| F2 | Rename a file (8.3 names) |
| `1`-`9`, `Z`, `R` | Bit Rot: run an op, undo, reset |
| Space (hold) | Gear Grind: clutch |
| Right Shift / Left Shift | Gear Grind: change up / change down (clutch in) |

Gear Grind keys can be rebound with **Keys...** in its window. Mouse and touch work for the clutch and gear buttons too. Engine sound is off until you turn it on.

### Connect your own AI intern (optional)

You need Node 20+ and an MCP-capable agent. Add this to your agent's MCP config:

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

(VS Code uses `"servers"` with `"type": "stdio"`; Copilot CLI wants `"type": "local"` and `"tools": ["*"]`. Full configs: https://www.npmjs.com/package/night-shift-mcp)

Tell your agent something like *"You're the intern in NIGHT_SHIFT.EXE. Clock in and help me."* Then in the game open **INTERN.EXE**, leave the address as `ws://localhost:7117` and click **Dial**.

- The server runs on your machine and the game talks to it over `ws://localhost`. Nothing about your game goes anywhere else (apart from whatever your agent does with what it's told, so pick an agent you trust).
- Chrome, Edge and Firefox are fine. Chrome may ask to allow access to devices on your local network: click **Allow**.
- Safari blocks `ws://localhost` from an https page. Use another browser for the AI intern.
- itch.io runs the game in a frame, so use the Dial button, not a `?intern=` link.

### Credits

- Design, direction and playtesting: Simon (goosey-games)
- Built with GitHub Copilot (see the AI disclosure below)
- Pure HTML, CSS and JavaScript. No engine, no image or audio files. The engine note is a Web Audio synth.
- Source (MIT): https://github.com/kwacky1/night-shift

### AI disclosure

This game uses AI as a mechanic (optional, bring your own agent) and AI helped build it. The full disclosure is in [`docs/ai-disclosure.md`](../ai-disclosure.md).

---

## Suggested itch.io settings

**Edit game:**

- Kind of project: **HTML**
- Classification: Games
- Release status: Released (or In development until the jam closes)
- Pricing: No payments (or $0 or donate)
- Uploads: the `html` channel from butler (CI pushes `dist/html`). Tick **This file will be played in the browser**.
- Embed options:
  - Viewport dimensions: **1024 x 768**. The biggest window (BLAME.EXE, 620 x 470) and Gear Grind (540 x 415) fit with room for the desktop icons and taskbar; the E2E smoke test plays the whole night at this size.
  - Mobile friendly: **off** (it needs a keyboard for Gear Grind and F2)
  - Automatically start on page load: on
  - Fullscreen button: **on**
  - Click to launch in fullscreen: **off**
  - Enable scrollbars: **off**
  - SharedArrayBuffer support: **off** (not needed)
- Details:
  - Genre: **Puzzle**
  - Tags: `game-off`, `retro`, `hacking`, `puzzle`, `programming`, `ai`, `mcp`, `1990s`, `fake-os`, `driving`
  - AI generation disclosure: **Yes**. Code: yes (written with GitHub Copilot). Text: yes (puzzle data and story text drafted with AI, edited by Simon). Graphics: no. Sound: no.
  - App store links / community: optional
- Cover image: `cover.png` (630 x 500)
- Screenshots: `01-desktop.png` to `05-blame.png`

**Game Off 2026 submission:**

- Join https://itch.io/jam/game-off-2026 and submit the project before **1 December 2026, 13:37 PST** (2 December 07:37 AEST).
- The source repo has to be public on GitHub (kwacky1/night-shift already is).
- Paste `docs/ai-disclosure.md` into the AI disclosure field.
