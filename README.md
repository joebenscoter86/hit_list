# Hit List

A local, single-user daily to-do dashboard that pulls your day together from the tools you already use, and gives Claude two-way access to the same list over MCP.

Every morning you hit **Refresh** and Hit List assembles today's list from:

- **Google Calendar** (today's meetings, plus auto-generated prep tasks)
- **Slack** (DMs, @mentions, and threads you haven't replied to)
- **Gmail** (unread, actionable email)
- **GuideCX** (project tasks that are overdue, due soon, or stuck) *(optional)*
- **Fathom** (action items from your recent recorded calls) *(optional)*
- **Carryover** (anything you didn't finish yesterday, with smart defer/blocked detection)

You work the list in a browser tab all day: check things off, add notes, drag to reprioritize, add your own tasks. Claude can read and write the same list through an MCP server, so after a working session it can mark a task done or add a follow-up, and the UI updates live.

There is a second page, the **Warp Log**, that shows where your time actually went (by project and by source) over the last 7 / 30 / 365 days.

> **Setting this up with Claude?** Point it at [`CLAUDE.md`](CLAUDE.md). It contains a step-by-step runbook so an AI agent can walk you through the whole setup interactively.

---

## How it works

Hit List is a single Node.js process that runs:

- an **Express REST API** and serves the web UI,
- an **MCP server** (HTTP transport) on the same port, and
- the **refresh pipeline** that gathers your data.

Everything is local. It listens on `127.0.0.1` only, never on the network. Your data stays on your machine in a SQLite file at `~/.hit-list/todo.db`.

### Two ways it reaches your data

1. **Direct API (native):** GuideCX and Fathom are called directly from Node using API tokens you provide. These are optional; leave them disabled if you don't use them.

2. **Via Claude connectors (headless):** Slack, Gmail, and Google Calendar are pulled by shelling out to a headless `claude -p` session that uses **your existing [claude.ai connectors](https://support.anthropic.com/en/articles/11175166-about-connectors)**. This means you do **not** have to register a custom OAuth app with your Slack/Google admins. If you already use the Slack, Gmail, and Google Calendar connectors in Claude, Hit List reuses them. The headless session writes results back into Hit List over HTTP.

```
   Browser tab (Web UI) ─HTTP─┐
                              ├─►  Node process  ──►  SQLite (~/.hit-list/todo.db)
   Claude Code (MCP) ────MCP──┘        │
                                       ├─ GuideCX API   (direct)
                                       ├─ Fathom API    (direct)
                                       └─ claude -p ──► Slack / Gmail / Calendar
                                                        (your claude.ai connectors)
```

---

## Prerequisites

- **Node.js 20+**
- **macOS** for the auto-start installer (`scripts/install.js` uses `launchd`). On Linux/Windows you can still run it manually with `npm start`.
- **[Claude Code](https://claude.com/claude-code)** installed, **only if** you want the Slack / Gmail / Calendar pull. You also need the Slack, Gmail, and Google Calendar connectors enabled in your Claude account.
- A **GuideCX API token** and/or a **Fathom API key**, only if you want those sources.

None of the integrations are required. With all of them off, Hit List is still a fast local to-do app with an MCP interface and a time dashboard.

---

## Quickstart

```bash
git clone <your-fork-url> hit-list
cd hit-list
npm install

# create your config
cp config.example.json config.json
$EDITOR config.json        # fill in the fields (see below)

# run it
npm start
# open http://localhost:3847
```

To have it start automatically at login (macOS):

```bash
npm run install:agent      # writes and loads a launchd agent
# to remove it later:
npm run uninstall:agent
```

---

## Configuration

Copy `config.example.json` to `config.json` and edit it. The file is git-ignored because it can hold secrets. Hit List looks for it in this order:

1. `$HIT_LIST_CONFIG` (an absolute path you set)
2. `~/.hit-list/config.json`
3. `<repo>/config.json`

| Field | What it's for |
|-------|---------------|
| `productName` | Label shown in the UI. |
| `userName` | Your name, used in prompts Claude sees. |
| `userEmail` | Your email. Used to identify tasks assigned to you (Fathom, GuideCX) and to scope the Fathom query. |
| `userSlackId` | Your Slack member ID (looks like `U0XXXXXXXXX`). Used to find DMs and @mentions. |
| `orgDomain` | Your email domain (e.g. `acme.com`). Used to tag Fathom action items as "teammate" vs "external". |
| `timezone` | IANA timezone (e.g. `America/New_York`). Determines which calendar day "today" is. |
| `workHoursPerDay` | Used to compute available hours (workday minus meetings minus a 30-min buffer). |
| `port` | Preferred port. If busy, the server walks up until it finds a free one and records the real port in `~/.hit-list/state.json`. |
| `activeProjects` | Names of the projects you care about. Used to match GuideCX projects, tag tasks, and generate meeting prep. |
| `excludeKeywords` | Task names matching any of these (case-insensitive) are never surfaced. Leave `[]` for none. |
| `claudePull.enabled` | Turn the headless Slack/Gmail/Calendar pull on or off. |
| `claudeBin` | Path to the `claude` binary. Defaults to `claude` on your `PATH`. |
| `slack.workspaceUrl` | Your Slack workspace URL (e.g. `https://acme.slack.com`), used to build clickable links. |
| `guidecx.enabled` | Turn the GuideCX source on. Also requires a token. |
| `guidecx.apiBase` | GuideCX API base. Default `https://api.guidecx.com/api/v2`. |
| `guidecx.webBaseUrl` | Your GuideCX tenant URL (e.g. `https://acme.guidecx.com`), for clickable task links. |
| `guidecx.token` | GuideCX API token (or set env `GUIDECX_TOKEN`). |
| `fathom.enabled` | Turn the Fathom source on. Also requires a key. |
| `fathom.apiBase` | Fathom API base. Default `https://api.fathom.ai/external/v1`. |
| `fathom.apiKey` | Fathom API key (or set env `FATHOM_API_KEY`). |

**Secrets:** you can put `token` / `apiKey` directly in `config.json`, or leave them blank and provide `GUIDECX_TOKEN` / `FATHOM_API_KEY` as environment variables. Environment variables win.

### Getting each credential

- **Your Slack member ID:** In Slack, click your profile → the three-dot menu → **Copy member ID**. It starts with `U`.
- **GuideCX token:** In GuideCX, go to your account/API settings and generate a token. Use the base URL and tenant URL for your org.
- **Fathom API key:** In Fathom, open Settings → API (or your workspace admin's integration settings) and create a key.

### Connecting Slack, Gmail, and Google Calendar

These are **not** configured in Hit List directly. Instead:

1. Install [Claude Code](https://claude.com/claude-code) and sign in.
2. Enable the **Slack**, **Gmail**, and **Google Calendar** connectors in your Claude account.
3. Make sure `claude` runs from your terminal (or set `claudeBin` to its full path).

When you hit Refresh, Hit List launches a short headless Claude session that uses those connectors to gather your items and write them back. The first run may take 30 to 60 seconds.

---

## Using it with Claude (MCP)

Register the MCP server with Claude Code so Claude can read and write your list:

```bash
claude mcp add --transport http hit-list http://localhost:3847/mcp
```

(Use the port from `~/.hit-list/state.json` if you changed it or the default was busy.)

Tools Claude gets:

| Tool | Does |
|------|------|
| `todo_list_tasks` | List tasks for a date (filter: open / done / blocked / dismissed / all). |
| `todo_add_task` | Add a task. |
| `todo_update_task` | Update fields, append a note, change priority, defer, etc. |
| `todo_mark_done` | Mark a task done. |
| `todo_dismiss_task` | Dismiss ("not today"). It won't carry over, but its source can re-surface it. |
| `todo_get_summary` | Counts and time estimates by priority tier. |
| `todo_refresh` | Run the refresh pipeline (same as the UI button). |

There is deliberately no delete tool. Claude can complete or dismiss tasks; only you can delete them from the UI.

---

## The web UI

- Priority tiers: **Must Do**, **Should Do**, **Could Do**, **Blocked**, **Personal**.
- Check off, edit notes inline, drag to reorder, drag between tiers, defer to a future date, dismiss, or delete.
- Add your own tasks with the **+** button.
- **Refresh** re-runs the pipeline and merges in new items without clobbering anything you've edited.
- **Warp Log** (top nav) shows tracked time by project and by source over a selectable window.

Your manual edits are protected: refresh never overwrites a task you've touched, never re-adds something you completed, and respects deferrals.

---

## Manual operations

```bash
npm start                    # run in the foreground
npm run dev                  # run with auto-reload

# macOS launchd service:
launchctl unload ~/Library/LaunchAgents/com.hitlist.server.plist   # stop
launchctl load   ~/Library/LaunchAgents/com.hitlist.server.plist   # start
tail -f ~/.hit-list/server.log                                     # logs
```

The headless-pull transcript is logged to `~/.hit-list/claude-pull.log` if you need to debug what the Slack/Gmail/Calendar step did.

---

## Troubleshooting

- **"No config.json found"** on startup: copy `config.example.json` to `config.json` and fill it in.
- **Refresh finds no Slack/Gmail/Calendar items:** confirm `claude` runs from your shell, the connectors are enabled in your Claude account, and `claudePull.enabled` is `true`. Check `~/.hit-list/claude-pull.log`.
- **GuideCX/Fathom return nothing:** confirm `enabled` is `true` and the token/key is present (in config or env). Confirm `activeProjects` names actually match your GuideCX project names.
- **MCP tools don't show up in Claude:** confirm the server is running and you registered the correct port (see `~/.hit-list/state.json`).

---

## License

MIT. See [LICENSE](LICENSE).
