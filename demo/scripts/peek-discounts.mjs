import Database from 'better-sqlite3';
const db = new Database('data/erp.sqlite', { readonly: true });
const one = (s) => db.prepare(s).get();
const all = (s) => db.prepare(s).all();

const totalVsLines = one(`
  SELECT COUNT(*) AS n FROM idx_invoice i
  WHERE i.line_count > 0
    AND ABS(i.total - (SELECT COALESCE(SUM(total_price),0) FROM idx_invoice_line l WHERE l.invoice_id = i.id)) > 0.02`).n;

const totalVsDiscounted = one(`
  SELECT COUNT(*) AS n FROM idx_invoice i
  JOIN documents d ON d.path = 'sales/invoices/' || i.id
  WHERE i.line_count > 0
    AND ABS(i.total - ((SELECT COALESCE(SUM(total_price),0) FROM idx_invoice_line l WHERE l.invoice_id = i.id) - COALESCE(json_extract(d.value,'$.discountTotal'),0))) < 0.02`).n;

console.log(`mismatch vs sum(lines): ${totalVsLines}  ·  matches sum(lines) - discountTotal: ${totalVsDiscounted}`);

const samples = all(`
  SELECT i.invoice_number, i.total,
         ROUND((SELECT SUM(total_price) FROM idx_invoice_line l WHERE l.invoice_id = i.id), 2) AS sum_lines,
         json_extract(d.value, '$.subtotal') AS subtotal,
         json_extract(d.value, '$.discountTotal') AS discount_total
  FROM idx_invoice i JOIN documents d ON d.path = 'sales/invoices/' || i.id
  WHERE i.line_count > 0
    AND ABS(i.total - (SELECT COALESCE(SUM(total_price),0) FROM idx_invoice_line l WHERE l.invoice_id = i.id)) > 0.02
  LIMIT 5`);
console.log(samples);
