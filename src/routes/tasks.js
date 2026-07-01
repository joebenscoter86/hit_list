import { Router } from 'express';
import {
  listTasks, insertTask, updateTask, deleteTask, getTask, todayLocal,
  findExisting, findByIdentity, computeIdentityHash, reviveRow, getDb
} from '../db/client.js';
import { emit } from '../sse.js';

export const tasksRouter = Router();

tasksRouter.get('/', (req, res) => {
  const date = req.query.date || todayLocal();
  const filter = req.query.filter || 'open';
  res.json(listTasks({ date, filter }));
});

tasksRouter.post('/', (req, res) => {
  const date = req.body.list_date || todayLocal();
  const source = req.body.source || 'manual';

  // Dedup layer 1: if (source, external_id) non-empty, check for exact match.
  // A dismissed hit is revived (un-dismissed, moved to today's list) rather
  // than blocking the insert — Dismiss means "not today," not "never again."
  if (req.body.external_id) {
    const existing = findExisting(source, req.body.external_id);
    if (existing) {
      if (existing.done === 0 && existing.status === 'dismissed') {
        const revived = reviveRow(existing.id, date);
        emit('task.updated', revived);
        return res.status(200).json(revived);
      }
      return res.status(200).json(existing);
    }
  }

  // Dedup layer 2: identity_hash match across all dates. Skip insert if the
  // task is already closed (done) or already on today's list. Dismissed
  // matches do NOT block — allow a fresh row so the source can re-surface.
  // Manual tasks opt out — user may want duplicates.
  if (source !== 'manual') {
    const hash = computeIdentityHash(req.body.task, req.body.project, source);
    const match = findByIdentity(hash);
    if (match && (match.done === 1 || match.list_date === date)) {
      return res.status(200).json(match);
    }
  }

  const task = insertTask({
    ...req.body,
    list_date: date,
    user_modified: 1,
    source,
  });
  emit('task.created', task);
  res.status(201).json(task);
});

tasksRouter.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!getTask(id)) return res.status(404).json({ error: 'not found' });
  // Reject resurface_date in the past — deferring to a past date is almost
  // always a typo and would leave the task visible today anyway.
  if ('resurface_date' in req.body && req.body.resurface_date) {
    const today = todayLocal();
    if (req.body.resurface_date <= today) {
      return res.status(400).json({
        error: `resurface_date must be in the future (got ${req.body.resurface_date}, today is ${today})`,
      });
    }
  }
  const updated = updateTask(id, req.body);
  emit('task.updated', updated);
  res.json(updated);
});

tasksRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const task = getTask(id);
  if (!task) return res.status(404).json({ error: 'not found' });
  deleteTask(id);
  emit('task.deleted', { id });
  res.json({ ok: true });
});
