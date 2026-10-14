export function nowIso() {
  return new Date().toISOString();
}

/** Tolerant number parse: the vendor export mixes "5", 5 and "" in quantity/price fields. */
export function num(x, fallback = 0) {
  if (typeof x === 'number' && Number.isFinite(x)) return x;
  const n = parseFloat(String(x ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

export function numOrNull(x) {
  if (x === null || x === undefined || x === '') return null;
  const n = parseFloat(String(x).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function addDays(dateIso, days) {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
