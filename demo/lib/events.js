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

/**
 * Recent broadcasts, so a tab that just opened can seed its activity feed with
 * what happened before it connected — the feed is global, not per-session.
 */
const history = [];
const HISTORY_MAX = 50;

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
  const record = { seq, at: nowIso(), ...event };
  history.push(record);
  if (history.length > HISTORY_MAX) history.splice(0, history.length - HISTORY_MAX);
  const payload = JSON.stringify(record);
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

/** The last `limit` broadcasts, oldest first (drives the global activity feed). */
export function getRecentEvents(limit = 12) {
  const n = Math.min(Math.max(Number(limit) || 12, 1), HISTORY_MAX);
  return history.slice(-n);
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
