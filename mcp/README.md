# night-shift-mcp

An MCP server that lets an AI agent play **intern #0118** in [NIGHT_SHIFT.EXE](https://goosey-games.itch.io/night-shift), a fake 1997 operating system and a [GitHub Game Off 2026](https://itch.io/jam/game-off-2026) entry.

You're the only sysadmin on the night shift at ACME Dataworks, Brisbane. Your intern is on another terminal. Plug in any MCP-capable agent (GitHub Copilot, Claude, anything that speaks MCP) and it plays the intern for real: it reads the hidden SYSTEM files and the event log, sees corrupted sectors as numbers, and has to talk you through the rest, because you can see things it can't. Neither of you can finish the night alone.

No agent? The game has a scripted intern built in. This package is optional.

## How it works

```
your agent  <-- MCP (stdio) -->  night-shift-mcp  <-- ws://localhost:7117 -->  the game in your browser
```

- Runs on your machine. The WebSocket binds to `127.0.0.1` only and checks `Host` and `Origin`.
- The agent only gets the intern's view (an allowlisted projection of game state) and a handful of intern actions. It can't see the puzzle targets, undo, rename files or drive the generator.
- It never touches your filesystem. "Files" are the game's fake drive.

## Set it up

Needs Node 20+. Your agent starts the server; you don't run it by hand.

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

**VS Code**: `.vscode/mcp.json` (or *MCP: Add Server*)

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

Then tell your agent something like *"You're the intern in NIGHT_SHIFT.EXE. Clock in and help me."* The server ships its own persona instructions, without spoilers.

## Dial in from the game

Open the game, open **INTERN.EXE**, check the address (`ws://localhost:7117`) and click **Dial**. The tray says `INTERN: ONLINE` when your agent is on the line.

Playing on itch.io (https) and dialling `ws://localhost` is fine in Chrome, Edge and Firefox. Chrome may ask to allow access to your local network: click **Allow**. Safari blocks it as mixed content, so use another browser.

## Options

| Option | Default | |
| --- | --- | --- |
| `--port`, `-p` / `NIGHT_SHIFT_PORT` | `7117` | WebSocket port the game dials. Add `"--port", "7200"` to `args` if 7117 is taken, and dial `ws://localhost:7200`. |
| `--allow-origin <url>` | localhost, `*.itch.zone`, `*.itch.io` | Extra page origin allowed to connect (repeatable) |
| `--version`, `--help` | | |

The game and the server check each other's protocol version when they connect. If the game has been updated and your server is older, INTERN.EXE says **INTERN DRIVER OUT OF DATE**. `npx -y night-shift-mcp@latest` (or restarting your agent) fixes it.

## Tools

`whoami`, `list_files`, `read_file`, `read_logs`, `inspect_puzzle`, `shift_left`, `shift_right`, `xor`, `enter_key`, `message_player`, `read_messages`, `wait_for_player`, `audit_status`, `submit_blame`.

## Links

- Play: https://goosey-games.itch.io/night-shift
- Source, full docs and issues: https://github.com/kwacky1/night-shift

MIT licence.
