import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { getDb, getList, todayLocal } from '../db/client.js';

const LOG_PATH = path.join(config.stateDir, 'claude-pull.log');

function buildPrompt(port, today, layer2Notes, lastRefreshedAt) {
  const notesBlock = layer2Notes.length === 0
    ? 'NONE'
    : layer2Notes.map((n) => `[id=${n.id}] ${n.notes}`).join('\n');

  const slackCutoff = lastRefreshedAt
    ? lastRefreshedAt
    : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const projects = config.activeProjects.length ? config.activeProjects.join(', ') : '(none configured)';
  const excludeLine = config.excludeKeywords.length
    ? `\n- Always exclude items related to: ${config.excludeKeywords.join(', ')}`
    : '';
  const slackBase = config.slackWorkspaceUrl || 'https://YOUR-WORKSPACE.slack.com';
  const gmailSkipLine = config.guidecx.enabled
    ? 'skip marketing, automated notifications, and anything from your project-management tool (queried directly elsewhere), etc.'
    : 'skip marketing and automated notifications, etc.';

  return `You are pulling ${config.userName}'s daily todo items from their Slack, Gmail, and Google Calendar via your MCP connectors, then writing them back to their local todo app via HTTP.

CONTEXT:
- Today's date (${config.timezone}): ${today}
- User's Slack user ID: ${config.userSlackId}
- User's email: ${config.userEmail}
- Active projects: ${projects}
- Local todo app REST API: http://localhost:${port}
- Slack cutoff (last refresh): ${slackCutoff}${excludeLine}

YOUR JOB IS TO USE THESE MCP TOOLS TO READ DATA:
- Google Calendar: gcal_list_events
- Slack: slack_search_public_and_private, slack_search_public, slack_read_thread, slack_search_users
- Gmail: gmail_search_messages, gmail_read_message

THEN USE Bash + curl TO WRITE RESULTS BACK. Do not look for an MCP tool called todo_add_task; that does not exist in your context. Use curl ONLY to write back.

============================================================
STEP 1: GOOGLE CALENDAR
============================================================
Call gcal_list_events for today (start of day to end of day in ${config.timezone}). Then PUT the meetings as a single batch:

curl -s -X PUT http://localhost:${port}/api/meetings \\
  -H 'Content-Type: application/json' \\
  -d '{"meetings":[{"title":"...","start_time":"<ISO>","end_time":"<ISO>","duration_min":N,"needs_prep":1}, ...]}'

For each recurring meeting tied to an active project (meeting title contains an active project name), also POST a 15-min prep task:

curl -s -X POST http://localhost:${port}/api/tasks \\
  -H 'Content-Type: application/json' \\
  -d '{"task":"Prep for <project> meeting","priority":"should_do","project":"<project>","source":"calendar","est_minutes":15}'

============================================================
STEP 2: SLACK
============================================================
Find every DM or @mention directed at the user since the cutoff timestamp above (${slackCutoff}). Be exhaustive on the search step. Do NOT pre-filter by "actionableness" here. Cast a wide net, then filter via the thread-read step below.

Searches to run:
- DMs/group DMs to the user: slack_search_public_and_private with channel_types=im,mpim and to:<@${config.userSlackId}>
- Channel @mentions: search for <@${config.userSlackId}> across channels
- Unanswered threads in channels related to the active projects

For EACH candidate message, you MUST use slack_read_thread to pull the full thread and then decide:
1. Has the user (<@${config.userSlackId}>) already posted a reply in that thread AFTER the message? Then SKIP; they handled it.
2. Is the message a bot/automation notification, a broadcast announcement, or something not needing a response from the user specifically? Then SKIP.
3. Otherwise the item is still open. Create a task.

Do NOT apply an artificial cap. If 15 threads are genuinely still open, create 15 tasks. If zero are open, create zero. The goal is accuracy, not brevity.

For each open item, POST a task:

curl -s -X POST http://localhost:${port}/api/tasks \\
  -H 'Content-Type: application/json' \\
  -d '{"task":"<short description>","priority":"<must_do or should_do>","project":"<project or null>","source":"slack","est_minutes":10,"notes":"<channel/thread context>","external_id":"<channel_id>:<message_ts>","source_url":"${slackBase}/archives/<channel_id>/p<ts_without_dot>"}'

IMPORTANT: For each Slack item, extract the channel_id and message_ts from the search/read result.
Build external_id as: {channel_id}:{message_ts}
Build source_url as: ${slackBase}/archives/{channel_id}/p{ts_without_dot}
where ts_without_dot is the message_ts with the period removed (e.g., 1234567890.123456 becomes 1234567890123456).

Use must_do priority if the message has been waiting >24h or is a direct question from a project contact. Otherwise should_do.

In your final response, briefly list the Slack candidates you considered and the skip/keep decision for each, so the reason is auditable in the log.

============================================================
STEP 3: GMAIL
============================================================
Call gmail_search_messages with query "is:unread in:inbox". For each genuinely actionable email (${gmailSkipLine}), POST a task:

curl -s -X POST http://localhost:${port}/api/tasks \\
  -H 'Content-Type: application/json' \\
  -d '{"task":"Reply to <sender> re: <subject snippet>","priority":"<must_do or should_do>","project":"<project if applicable>","source":"email","est_minutes":15,"notes":"<context>","external_id":"<threadId>","source_url":"https://mail.google.com/mail/u/0/#inbox/<threadId>"}'

IMPORTANT: For each Gmail item, extract the threadId from the search result.
Build external_id as the threadId value.
Build source_url as: https://mail.google.com/mail/u/0/#inbox/{threadId}

Use must_do if email is from yesterday or earlier; should_do if from today.

============================================================
STEP 4: CARRYOVER NOTE CLASSIFICATION
============================================================
For each note below, determine status ("active", "blocked", "deferred", or "in_progress") and resurface_date (ISO date YYYY-MM-DD or null).

Notes to classify:
${notesBlock}

============================================================
FINAL OUTPUT
============================================================
At the very end of your response, output these two lines (each on its own line):

CLASSIFICATIONS_JSON: [{"id":<id>,"status":"...","resurface_date":"..."}, ...]
SUMMARY: {"meetings_added":N,"slack_tasks":N,"gmail_tasks":N,"call_prep_tasks":N}

If a category had no items, use 0. If there are no notes to classify, output: CLASSIFICATIONS_JSON: []

Both lines are required so the calling Node process can parse your work.
`;
}

export async function runClaudePull(today) {
  const statePath = config.statePath;
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));

  // Collect carryover tasks needing Layer 2 (still active with date hints in notes)
  const layer2 = getDb().prepare(`
    SELECT id, notes FROM tasks
    WHERE list_date = ? AND notes IS NOT NULL AND notes != ''
      AND status = 'active' AND resurface_date IS NULL
      AND (notes LIKE '%next week%' OR notes LIKE '%monday%' OR notes LIKE '%tuesday%'
        OR notes LIKE '%wednesday%' OR notes LIKE '%thursday%' OR notes LIKE '%friday%')
  `).all(today);

  const list = getList(today);
  const lastRefreshedAt = list?.last_refreshed_at || null;
  const prompt = buildPrompt(state.port, today, layer2, lastRefreshedAt);

  // Open log file. Append session marker.
  const logHeader = `\n\n========================================\nClaude pull started: ${new Date().toISOString()}\n========================================\n`;
  fs.appendFileSync(LOG_PATH, logHeader);
  fs.appendFileSync(LOG_PATH, '--- PROMPT ---\n' + prompt + '\n--- END PROMPT ---\n--- STDOUT ---\n');

  const claudeBin = config.claudeBin;
  // --setting-sources user,project,local is REQUIRED in Claude Code 2.1+: the
  // default in headless mode no longer loads user-scoped MCP servers, which is
  // where your claude.ai connectors (Slack, Gmail, Google Calendar) live.
  // Without this flag, the headless session sees zero connector tools and the
  // refresh pipeline silently no-ops on calendar/slack/gmail pulls.
  const proc = spawn(claudeBin, [
    '-p',
    '--permission-mode', 'bypassPermissions',
    '--setting-sources', 'user,project,local',
    prompt,
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', d => {
    const s = d.toString();
    stdout += s;
    fs.appendFileSync(LOG_PATH, s);
  });
  proc.stderr.on('data', d => {
    const s = d.toString();
    stderr += s;
    fs.appendFileSync(LOG_PATH, '[stderr] ' + s);
  });

  const timeoutMs = Number(process.env.CLAUDE_PULL_TIMEOUT_MS) || 10 * 60 * 1000;
  let timedOut = false;
  const exitCode = await new Promise(resolve => {
    const timer = setTimeout(() => {
      timedOut = true;
      fs.appendFileSync(LOG_PATH, `\n--- TIMEOUT after ${timeoutMs}ms, sending SIGTERM ---\n`);
      proc.kill('SIGTERM');
      setTimeout(() => { if (proc.exitCode === null) proc.kill('SIGKILL'); }, 5000);
    }, timeoutMs);
    proc.on('close', code => { clearTimeout(timer); resolve(code); });
  });
  fs.appendFileSync(LOG_PATH, `\n--- EXIT ${exitCode}${timedOut ? ' (timed out)' : ''} ---\n`);

  if (timedOut) {
    throw new Error(`claude pull timed out after ${timeoutMs}ms`);
  }
  if (exitCode !== 0) {
    throw new Error(`claude exited ${exitCode}: ${stderr.slice(0, 500)}`);
  }

  // Parse SUMMARY and CLASSIFICATIONS_JSON with a bracket-balanced extractor
  // so nested objects / multiline payloads don't break parsing.
  const summaryJson = extractBalancedAfter(stdout, 'SUMMARY:', '{', '}');
  let added = 0;
  if (summaryJson) {
    try {
      const s = JSON.parse(summaryJson);
      added = (s.meetings_added || 0) + (s.slack_tasks || 0)
            + (s.gmail_tasks || 0) + (s.call_prep_tasks || 0);
    } catch {}
  }

  const clsJson = extractBalancedAfter(stdout, 'CLASSIFICATIONS_JSON:', '[', ']');
  if (clsJson) {
    try {
      const classifications = JSON.parse(clsJson);
      const upd = getDb().prepare(`UPDATE tasks SET status = ?, resurface_date = ? WHERE id = ?`);
      for (const c of classifications) {
        upd.run(c.status || 'active', c.resurface_date || null, c.id);
      }
    } catch {}
  }

  return added;
}

// Find `marker` in text, then extract the next balanced region beginning with
// `open` and ending at the matching `close`. Handles nesting; returns null if
// the region is malformed or not found.
function extractBalancedAfter(text, marker, open, close) {
  const i = text.indexOf(marker);
  if (i < 0) return null;
  const start = text.indexOf(open, i + marker.length);
  if (start < 0) return null;
  let depth = 0;
  for (let j = start; j < text.length; j++) {
    if (text[j] === open) depth++;
    else if (text[j] === close) {
      depth--;
      if (depth === 0) return text.slice(start, j + 1);
    }
  }
  return null;
}
