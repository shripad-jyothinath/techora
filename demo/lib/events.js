import { nowIso } from './util.js';

/**
 * Server-Sent Events hub.
 *
 * The old system pushed whole trees into every tab through the vendor's
 * client library. We keep the realtime UX but push *thin events* (a type +
 * ids) and let each screen refetch only what it shows. Events are advisory:
 * no correctness depends on them, which is why a lost event is harmless —
 * clients also refetch on reconnect.
 */
const clients = new Set();
let seq = 0;

export function sseHandler(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // in case someone puts nginx in front
  });
  res.write(`event: hello\ndata: ${JSON.stringify({ seq, at: nowIso() })}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
}

export function broadcast(event) {
  seq += 1;
  const payload = JSON.stringify({ seq, at: nowIso(), ...event });
  const frame = `event: message\ndata: ${payload}\n\n`;
  for (const res of clients) {
    try {
      res.write(frame);
    } catch {
      clients.delete(res);
    }
  }
  return payload;
}

export function clientCount() {
  return clients.size;
}

// Keep intermediaries (and corporate proxies) from closing idle connections.
const heartbeat = setInterval(() => {
  const frame = `: hb ${Date.now()}\n\n`;
  for (const res of clients) {
    try {
      res.write(frame);
    } catch {
      clients.delete(res);
    }
  }
}, 15000);
heartbeat.unref?.();
