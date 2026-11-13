# Playbook MCP

Pull open game recipes and game-feel mechanics from [Playbook](https://rexgu9911.github.io/playbook/) into your own coding agent, and search the best AI-made web games for ideas.

What's inside: 30 game-feel mechanics (movement, combat, camera, feedback, UI, audio, generation), each with a live demo, key numbers and a single-file reference; 18 open game recipes; and an index of about 80 AI-made web games, linked and credited.

No account, no API key. Node 18+.

## Install

**Claude Code**
```bash
claude mcp add playbook -- npx -y github:rexgu9911/playbook-mcp
```

**Cursor**: `~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project), then reload Cursor
```json
{ "mcpServers": { "playbook": { "type": "stdio", "command": "npx", "args": ["-y", "github:rexgu9911/playbook-mcp"] } } }
```

**Codex**
```bash
codex mcp add playbook -- npx -y github:rexgu9911/playbook-mcp
```
or add to `~/.codex/config.toml`:
```toml
[mcp_servers.playbook]
command = "npx"
args = ["-y", "github:rexgu9911/playbook-mcp"]
```

**Claude Desktop**: in the macOS menu bar, Claude → Settings… → Developer → Edit Config. Add this to `claude_desktop_config.json`, then quit and reopen Claude:
```json
{ "mcpServers": { "playbook": { "command": "npx", "args": ["-y", "github:rexgu9911/playbook-mcp"] } } }
```

## Verified with
Claude Code 2.1 (`claude mcp list` shows it connected), Codex CLI 0.167 (`codex mcp add` / `codex mcp list`), and the official MCP SDK client (`test.mjs`, 17 checks). Cursor and Claude Desktop configs follow their official docs.

## Then ask

- "Add hit-stop to my game."
- "Remake Neon Drift, but underwater."
- "Find AI-made racing games for inspiration."

## Tools

| Tool | What it returns |
|---|---|
| `search` | Recipes, mechanics and AI-made games from the web matching your words (`kind`: all / recipes / mechanics / web). |
| `get_recipe` | A Playbook game's prompt, mechanics, art direction, palette, sound, controls, links, and (with `include_source`) its full single-file source. |
| `get_mechanic` | A game-feel mechanic's prompt, its key numbers (named, with units) and a small working reference implementation to adapt. |
| `list` | Every recipe (by genre) or mechanic (by category). |

There is also a `remake` prompt: pick a recipe id and a theme.

## What you may reuse

- Playbook recipes and mechanics are Playbook's own work, MIT licensed. Remake them freely; a credit link is appreciated.
- Games under Discover (`kind: web`) belong to their creators. The server only returns links, credits and descriptions for them. Your agent should not copy their code or assets.

## Data

The server reads the public Playbook API (static JSON): `https://rexgu9911.github.io/playbook/api/`. Set `PLAYBOOK_API` to point it elsewhere, e.g. a local copy of the site.

```bash
PLAYBOOK_API=http://localhost:4392/api node test.mjs   # run the end-to-end checks
```
