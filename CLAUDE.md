# Hit List: setup runbook for an AI agent

You are helping a user set up **Hit List**, a local daily to-do dashboard, on their machine. Read `README.md` for full context. This file is your interactive runbook. Work through it with the user, one step at a time. Confirm each step before moving on. Do not put real secrets into any file that is committed to git (`config.json` is git-ignored; keep it that way).

## Step 0: Check prerequisites

Run these and report what's present:

- `node --version` (need 20+)
- `claude --version` (needed only for the Slack/Gmail/Calendar pull; fine to skip otherwise)

If Node is missing, point them to https://nodejs.org and stop until it's installed.

## Step 1: Install dependencies

From the repo root:

```bash
npm install
```

`better-sqlite3` compiles a native module, so this can take a minute.

## Step 2: Build config.json

Copy the template, then fill it in **with the user**, asking for each value you can't infer:

```bash
cp config.example.json config.json
```

Gather and write these into `config.json`:

- `userName`, `userEmail` — ask.
- `orgDomain` — derive from their email (the part after `@`).
- `timezone` — ask, or infer from `date +%Z` / their locale; use an IANA name like `America/New_York`.
- `userSlackId` — tell them how to get it: in Slack, profile → three-dot menu → **Copy member ID** (starts with `U`). Only needed if they'll use the Slack pull.
- `activeProjects` — ask which projects/clients/workstreams they want the app to track. This drives GuideCX matching, task tagging, and meeting prep.
- `excludeKeywords` — optional; anything they never want to see. Default `[]`.
- `port` — leave at 3847 unless it conflicts.

Then decide which integrations to enable. **Ask the user which of these they actually use** and only enable those:

- **Slack / Gmail / Google Calendar** (`claudePull.enabled`): requires Claude Code + those connectors enabled in their Claude account. Set `slack.workspaceUrl` to their workspace URL.
- **GuideCX** (`guidecx.enabled`): needs an API token, `webBaseUrl` (their tenant, e.g. `https://their-org.guidecx.com`), and matching `activeProjects`. Help them find the token in GuideCX account/API settings.
- **Fathom** (`fathom.enabled`): needs an API key from Fathom's API settings.

For secrets, offer the choice: paste the token into `config.json`, or keep it out of the file and set `GUIDECX_TOKEN` / `FATHOM_API_KEY` as environment variables. If unsure, environment variables are the safer default.

## Step 3: Start the server and verify

```bash
npm start
```

In another shell, confirm it's healthy (use the port from `~/.hit-list/state.json` if 3847 was busy):

```bash
curl -s http://localhost:3847/health
```

Then open http://localhost:3847 in a browser and confirm the UI loads. Add a test task through the UI or via:

```bash
curl -s -X POST http://localhost:3847/api/tasks -H 'Content-Type: application/json' \
  -d '{"task":"Setup test","priority":"must_do"}'
```

## Step 4: Register the MCP server with Claude

So Claude can read and write the same list:

```bash
claude mcp add --transport http hit-list http://localhost:3847/mcp
```

Confirm the `todo_*` tools appear in a new Claude session.

## Step 5: Test a refresh

Have the user click **Refresh** in the UI (or `curl -s -X POST http://localhost:3847/api/refresh -d '{}' -H 'Content-Type: application/json'`). The first headless pull can take 30 to 60 seconds. If Slack/Gmail/Calendar items don't appear, check `~/.hit-list/claude-pull.log` and confirm the connectors are enabled in their Claude account.

## Step 6 (optional): Auto-start at login (macOS)

```bash
npm run install:agent
```

This installs a `launchd` agent so the server starts on login. `npm run uninstall:agent` removes it.

## Guardrails

- Never commit `config.json` or any token. It is git-ignored; keep it so.
- The server binds to `127.0.0.1` only. Do not change it to bind publicly.
- The headless pull runs Claude with `--permission-mode bypassPermissions`. That is acceptable because it runs locally against the user's own accounts, but do not repurpose that pattern for anything network-facing.
