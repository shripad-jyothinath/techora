import Database from 'better-sqlite3';
const db = new Database('data/erp.sqlite', { readonly: true });
const invs = db.prepare('SELECT invoice_number FROM idx_invoice').all().map((r) => r.invoice_number);
const byTrailing = [...invs].sort((a, b) => {
  const ta = Number(String(a).match(/([0-9]+)$/)?.[1] ?? 0);
  const tb = Number(String(b).match(/([0-9]+)$/)?.[1] ?? 0);
  return tb - ta;
});
console.log('top by trailing number:', byTrailing.slice(0, 10));
const long = invs.filter((n) => String(n).length > 12);
console.log('long numbers:', long.slice(0, 12), 'count', long.length);
const weird = invs.filter((n) => Number(String(n).match(/([0-9]+)$/)?.[1] ?? 0) > 1000000);
console.log('trailing > 1e6:', weird.slice(0, 12), 'count', weird.length);
console.log('max INV- suffix:', Math.max(...invs.filter((n) => n.startsWith('INV-')).map((n) => Number(n.slice(4))).filter((n) => Number.isFinite(n))));
console.log('total invoices:', invs.length);
