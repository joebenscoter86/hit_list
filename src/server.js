import express from 'express';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { initDb } from './db/client.js';
import { tasksRouter } from './routes/tasks.js';
import { meetingsRouter } from './routes/meetings.js';
import { summaryRouter } from './routes/summary.js';
import { eventsHandler } from './sse.js';
import { mountMcp } from './mcp/tools.js';
import { refreshRouter } from './routes/refresh.js';
import { askClaudeRouter } from './routes/ask-claude.js';
import warpLogRouter from './routes/warp-log.js';
initDb();

async function findFreePort(start) {
  for (let p = start; p < start + 50; p++) {
    const free = await new Promise(resolve => {
      const srv = net.createServer();
      srv.once('error', () => resolve(false));
      srv.once('listening', () => srv.close(() => resolve(true)));
      srv.listen(p);
    });
    if (free) return p;
  }
  throw new Error('No free port found');
}

const port = await findFreePort(config.defaultPort);
const app = express();
app.use(express.json());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, '..', 'web')));

app.use('/api/tasks', tasksRouter);
app.use('/api/meetings', meetingsRouter);
app.use('/api/summary', summaryRouter);
app.use('/api/refresh', refreshRouter);
app.use('/api/ask-claude', askClaudeRouter);
app.use('/api/warp-log', warpLogRouter);

app.get('/api/events', eventsHandler);

app.get('/health', (req, res) => res.json({ ok: true, port }));

await mountMcp(app);

app.listen(port, '127.0.0.1', () => {
  fs.writeFileSync(config.statePath, JSON.stringify({
    port, pid: process.pid, started_at: new Date().toISOString()
  }, null, 2));
  console.log(`hit-list listening on http://localhost:${port}`);
});
