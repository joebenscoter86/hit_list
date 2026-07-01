import { Router } from 'express';
import { listMeetings, insertMeeting, clearMeetings, todayLocal } from '../db/client.js';
import { emit } from '../sse.js';

export const meetingsRouter = Router();

meetingsRouter.get('/', (req, res) => {
  const date = req.query.date || todayLocal();
  res.json(listMeetings(date));
});

// Replace meetings for a date (used by refresh pipeline)
meetingsRouter.put('/', (req, res) => {
  const date = req.body.list_date || todayLocal();
  const meetings = req.body.meetings || [];
  clearMeetings(date);
  for (const m of meetings) {
    insertMeeting({ ...m, list_date: date });
  }
  emit('meetings.replaced', { date, count: meetings.length });
  res.json({ ok: true, count: meetings.length });
});
