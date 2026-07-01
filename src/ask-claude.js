/**
 * ask-claude.js
 * Builds prompts and launch URIs for opening a task in Claude Code.
 */
import { config } from './config.js';

// Maps a source + external_id to a fetch hint string.
const SOURCE_HINT_MAP = {
  gcx:      (id) => `- GuideCX task ${id}: query via the GuideCX API`,
  fathom:   (id) => `- Fathom meeting ${id}: fetch summary via Fathom API`,
  slack:    (id) => `- Slack thread: ${id} (use Slack MCP to read thread)`,
  email:    (id) => `- Gmail thread: ${id} (use Gmail MCP to read thread)`,
  calendar: (id) => `- Calendar event: ${id} (use Calendar MCP)`,
};

// Regex patterns for secondary URL-based hints.
const URL_HINT_PATTERNS = [
  {
    re: /https?:\/\/[^/]*\.slack\.com\/archives\/[^\s]+/g,
    label: 'Slack thread',
  },
  {
    re: /https?:\/\/(?:app\.fathom\.video|fathom\.video)\/[^\s]+/g,
    label: 'Fathom recording',
  },
  {
    re: /https?:\/\/mail\.google\.com\/[^\s]+/g,
    label: 'Gmail message',
  },
  {
    re: /https?:\/\/app\.guidecx\.com\/[^\s]+/g,
    label: 'GCX item',
  },
];

/**
 * Build fetch hints for a task.
 * @param {object} task - Task row from SQLite.
 * @returns {string}
 */
export function buildFetchHints(task) {
  const hints = [];

  // Primary hint from source + external_id.
  const sourceKey = (task.source || '').toLowerCase();
  const externalId = task.external_id || '';
  if (externalId && SOURCE_HINT_MAP[sourceKey]) {
    hints.push(SOURCE_HINT_MAP[sourceKey](externalId));
  }

  // Secondary hints from URLs in notes.
  const notes = task.notes || '';
  if (notes) {
    for (const { re, label } of URL_HINT_PATTERNS) {
      const matches = notes.match(re) || [];
      for (const url of matches) {
        // Skip if URL contains the external_id (dedup with primary hint).
        if (externalId && url.includes(externalId)) continue;
        hints.push(`- ${label}: ${url}`);
      }
    }
  }

  if (hints.length === 0) {
    return '(No external references found. Ask the user for pointers if you need background.)';
  }

  return hints.join('\n');
}

/**
 * Build the full Claude prompt for a task.
 * @param {object} task - Task row from SQLite.
 * @returns {string}
 */
export function buildPrompt(task) {
  const fetchHints = buildFetchHints(task);

  return `You're helping ${config.userName} work a single item from their daily to-do.

TASK
- Description: ${task.task}
- Project: ${task.project || '(none)'}
- Source: ${task.source || '(manual)'}
- Due: ${task.due_date || '(no due date)'}
- Priority: ${task.priority}
- Current notes: ${task.notes || '(none)'}

RELATED CONTEXT (fetch on demand if relevant)
${fetchHints}

Start by proposing the most likely next concrete action for this task,
then ask the user if they want you to: (a) go ahead with that, (b) dig up
more context first, or (c) do something else entirely.

When the user is done working this task, offer to update or close it via the
hit-list MCP server (todo_update_task to append notes, todo_mark_done
to complete it). Keep the to-do list current.`;
}

/**
 * Build an antigravity:// launch URI from a prompt string.
 * @param {string} prompt
 * @returns {string}
 */
export function buildLaunchUri(prompt) {
  return `antigravity://anthropic.claude-code/open?prompt=${encodeURIComponent(prompt)}`;
}
