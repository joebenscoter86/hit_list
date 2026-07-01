import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import {
  listTasks, insertTask, updateTask, getTask, todayLocal, getDb, getList, listMeetings
} from '../db/client.js';
import { emit } from '../sse.js';
import { config } from '../config.js';

export function buildMcpServer() {
  const server = new McpServer({ name: 'hit-list', version: '0.1.0' });

  server.tool('todo_list_tasks',
    'List tasks for a date.',
    { date: z.string().optional(), filter: z.enum(['all', 'open', 'done', 'blocked', 'dismissed']).optional() },
    async ({ date, filter }) => {
      const tasks = listTasks({ date: date || todayLocal(), filter: filter || 'open' });
      return { content: [{ type: 'text', text: JSON.stringify(tasks, null, 2) }] };
    }
  );

  server.tool('todo_add_task',
    'Add a new task to today\'s list. Sets user_modified=1.',
    {
      task: z.string(),
      priority: z.enum(['must_do', 'should_do', 'could_do', 'blocked', 'personal']),
      project: z.string().optional(),
      source: z.string().optional(),
      est_minutes: z.number().int().optional(),
      due_date: z.string().optional(),
      notes: z.string().optional(),
      external_id: z.string().optional(),
      source_url: z.string().optional(),
    },
    async (args) => {
      const t = insertTask({
        ...args,
        list_date: todayLocal(),
        user_modified: 1,
        source: args.source || 'manual',
      });
      emit('task.created', t);
      return { content: [{ type: 'text', text: JSON.stringify(t) }] };
    }
  );

  server.tool('todo_update_task',
    'Update an existing task. Sets user_modified=1.',
    {
      id: z.number().int(),
      done: z.number().int().optional(),
      priority: z.string().optional(),
      notes: z.string().optional(),
      append_note: z.string().optional(),
      est_minutes: z.number().int().optional(),
      task: z.string().optional(),
      sort_order: z.number().int().optional(),
      resurface_date: z.string().optional(),
      status: z.string().optional(),
      source_url: z.string().optional(),
    },
    async (args) => {
      const { id, append_note, ...patch } = args;
      const existing = getTask(id);
      if (!existing) return { content: [{ type: 'text', text: 'not found' }], isError: true };
      if (append_note) {
        patch.notes = (existing.notes ? existing.notes + '\n' : '') + append_note;
      }
      const updated = updateTask(id, patch);
      emit('task.updated', updated);
      return { content: [{ type: 'text', text: JSON.stringify(updated) }] };
    }
  );

  server.tool('todo_mark_done',
    'Mark a task done.',
    { id: z.number().int(), note: z.string().optional() },
    async ({ id, note }) => {
      const existing = getTask(id);
      if (!existing) return { content: [{ type: 'text', text: 'not found' }], isError: true };
      const patch = { done: 1 };
      if (note) patch.notes = (existing.notes ? existing.notes + '\n' : '') + note;
      const updated = updateTask(id, patch);
      emit('task.updated', updated);
      return { content: [{ type: 'text', text: JSON.stringify(updated) }] };
    }
  );

  server.tool('todo_dismiss_task',
    "Dismiss a task — mark it 'not today'. Dismissed tasks do not carry over, but will resurface if their source (GCX/Fathom/Slack/email) re-emits the same item. Use delete for permanent removal.",
    { id: z.number().int(), note: z.string().optional() },
    async ({ id, note }) => {
      const existing = getTask(id);
      if (!existing) return { content: [{ type: 'text', text: 'not found' }], isError: true };
      const patch = { status: 'dismissed' };
      if (note) patch.notes = (existing.notes ? existing.notes + '\n' : '') + note;
      const updated = updateTask(id, patch);
      emit('task.updated', updated);
      return { content: [{ type: 'text', text: JSON.stringify(updated) }] };
    }
  );

  server.tool('todo_get_summary',
    'Today\'s summary.',
    { date: z.string().optional() },
    async ({ date }) => {
      const d = date || todayLocal();
      const list = getList(d) || {};
      const meetings = listMeetings(d);
      const meetingHours = meetings.reduce((s, m) => s + m.duration_min, 0) / 60;
      const summary = {
        date: d,
        meeting_hours: meetingHours,
        available_hours: Math.max(0, config.workHoursPerDay - meetingHours - 0.5),
        last_refreshed_at: list.last_refreshed_at || null,
      };
      for (const tier of ['must_do', 'should_do', 'could_do', 'blocked', 'personal']) {
        const row = getDb().prepare(`
          SELECT COUNT(*) AS total,
                 SUM(CASE WHEN done = 1 THEN 1 ELSE 0 END) AS done_count,
                 COALESCE(SUM(est_minutes), 0) AS est_minutes
          FROM tasks
          WHERE list_date = ? AND priority = ?
        `).get(d, tier);
        summary[tier] = { total: row.total, done: row.done_count || 0, est_minutes: row.est_minutes || 0 };
      }
      return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
    }
  );

  server.tool('todo_refresh',
    'Trigger the refresh pipeline. Same as the UI Refresh button.',
    {},
    async () => {
      const { runRefresh, isRunning } = await import('../pipeline/index.js');
      if (isRunning()) {
        return { content: [{ type: 'text', text: 'Refresh already in progress' }], isError: true };
      }
      const result = await runRefresh();
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  return server;
}

export async function mountMcp(app) {
  // Each request gets its own server+transport to avoid "Already connected" errors
  app.all('/mcp', async (req, res) => {
    const server = buildMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => transport.close().catch(() => {}));
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
}
