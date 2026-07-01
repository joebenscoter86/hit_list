import express from 'express';
import { getDb } from '../db/client.js';

const router = express.Router();

function resolveWindow(label) {
  const end = new Date();
  const endStr = end.toISOString().slice(0, 10);
  let start;
  if (label === '30d') {
    start = new Date(end);
    start.setDate(start.getDate() - 30);
  } else if (label === 'ytd') {
    start = new Date(end.getFullYear(), 0, 1);
  } else {
    start = new Date(end);
    start.setDate(start.getDate() - 7);
  }
  const startStr = start.toISOString().slice(0, 10);
  const pretty = label === '30d' ? 'Last 30 days'
              : label === 'ytd' ? 'Year to date'
              : 'Last 7 days';
  return { label: pretty, start: startStr, end: endStr };
}

function fetchDoneTasks(start, end) {
  return getDb().prepare(`
    SELECT id, task, project, source, original_source, est_minutes, done_at
    FROM tasks
    WHERE id IN (
      SELECT MIN(id) FROM tasks
      WHERE done = 1
        AND (status IS NULL OR status NOT IN ('dismissed', 'deferred', 'blocked'))
        AND done_at IS NOT NULL
        AND est_minutes IS NOT NULL
        AND substr(done_at, 1, 10) >= ?
        AND substr(done_at, 1, 10) <= ?
      GROUP BY COALESCE(identity_hash, 'r' || id)
    )
    ORDER BY done_at DESC
  `).all(start, end);
}

function fetchMeetingMinutes(start, end) {
  const row = getDb().prepare(`
    SELECT COALESCE(SUM(duration_min), 0) AS total
    FROM meetings
    WHERE list_date >= ?
      AND list_date <= ?
  `).get(start, end);
  return row.total || 0;
}

function bucketize(rows, keyFn) {
  const buckets = new Map();
  for (const r of rows) {
    const key = keyFn(r);
    if (!buckets.has(key)) buckets.set(key, { label: key, minutes: 0, task_count: 0, tasks: [] });
    const b = buckets.get(key);
    b.minutes += r.est_minutes;
    b.task_count += 1;
    b.tasks.push({
      id: r.id,
      task: r.task,
      done_at: r.done_at,
      est_minutes: r.est_minutes,
    });
  }
  return Array.from(buckets.values()).sort((a, b) => b.minutes - a.minutes);
}

router.get('/', (req, res) => {
  const window = resolveWindow(req.query.window);
  const rows = fetchDoneTasks(window.start, window.end);
  const meetingMinutes = fetchMeetingMinutes(window.start, window.end);

  const totalMinutes = rows.reduce((sum, r) => sum + r.est_minutes, 0);
  const byProject = bucketize(rows, r => r.project && r.project.trim() ? r.project : 'Unassigned');
  const bySource = bucketize(rows, r => {
    const s = r.original_source || r.source;
    if (s === 'carried_over' || !s) return 'Unknown (legacy)';
    return s;
  });

  res.json({
    window: { label: window.label, start: window.start, end: window.end },
    headline: {
      hours: Math.round(totalMinutes / 6) / 10,
      task_count: rows.length,
      meeting_hours: Math.round(meetingMinutes / 6) / 10,
    },
    by_project: byProject,
    by_source: bySource,
  });
});

export default router;
