import { Router } from 'express';
import { getDb, getList, listMeetings, todayLocal } from '../db/client.js';
import { config } from '../config.js';

export const summaryRouter = Router();

summaryRouter.get('/', (req, res) => {
  const date = req.query.date || todayLocal();
  const list = getList(date) || {};
  const meetings = listMeetings(date);

  const meetingHours = meetings.reduce((s, m) => s + m.duration_min, 0) / 60;
  // Available = workday minus meetings minus a 30-min buffer.
  const availableHours = Math.max(0, config.workHoursPerDay - meetingHours - 0.5);

  const tiers = ['must_do', 'should_do', 'could_do', 'blocked', 'personal'];
  const summary = { date, meeting_hours: meetingHours, available_hours: availableHours,
                    last_refreshed_at: list.last_refreshed_at || null };

  for (const tier of tiers) {
    const row = getDb().prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN done = 1 THEN 1 ELSE 0 END) AS done_count,
        COALESCE(SUM(est_minutes), 0) AS est_minutes
      FROM tasks
      WHERE list_date = ? AND priority = ?
        AND (resurface_date IS NULL OR resurface_date <= date('now'))
    `).get(date, tier);
    summary[tier] = {
      total: row.total,
      done: row.done_count || 0,
      est_minutes: row.est_minutes || 0,
    };
  }
  res.json(summary);
});
