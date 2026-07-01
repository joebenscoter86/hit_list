import { Router } from 'express';
import { runRefresh, isRunning, lastSummary } from '../pipeline/index.js';

export const refreshRouter = Router();

refreshRouter.post('/', async (req, res) => {
  if (isRunning()) return res.status(409).json({ error: 'Refresh in progress' });
  try {
    const result = await runRefresh({
      skipClaudePull: req.body?.skipClaudePull === true,
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

refreshRouter.get('/status', (req, res) => {
  res.json({ in_progress: isRunning(), last: lastSummary() });
});
