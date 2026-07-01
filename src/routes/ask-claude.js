import { Router } from 'express';
import { getTask } from '../db/client.js';
import { buildPrompt, buildLaunchUri } from '../ask-claude.js';

export const askClaudeRouter = Router();

askClaudeRouter.post('/:id', (req, res) => {
  const id = Number(req.params.id);
  const task = getTask(id);
  if (!task) return res.status(404).json({ error: 'not found' });
  const prompt = buildPrompt(task);
  const launch_uri = buildLaunchUri(prompt);
  res.json({ prompt, launch_uri });
});
