const subscribers = new Set();

export function subscribe(res) {
  subscribers.add(res);
}

export function unsubscribe(res) {
  subscribers.delete(res);
}

export function emit(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of subscribers) {
    try { res.write(payload); } catch {}
  }
}

export function eventsHandler(req, res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(`event: hello\ndata: {"ok":true}\n\n`);

  subscribe(res);

  // Heartbeat every 25s to keep proxies/browsers from closing
  const heartbeat = setInterval(() => {
    try { res.write(`: heartbeat\n\n`); } catch {}
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe(res);
  });
}
