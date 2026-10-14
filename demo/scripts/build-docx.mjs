/**
 * DIAGNOSIS.md → DIAGNOSIS.docx
 *
 *   node scripts/build-docx.mjs [in.md] [out.docx]
 *
 * A small, purpose-built renderer for the subset of markdown the diagnosis
 * uses: headings, paragraphs with **bold** and `code`, bullet and numbered
 * lists, blockquotes, pipe tables and HTML comments (skipped — they are
 * work-in-progress markers). The markdown stays the single source of truth.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  AlignmentType, Document, HeadingLevel, Packer, Paragraph, ShadingType,
  Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx';

const inPath = process.argv[2] ?? fileURLToPath(new URL('../DIAGNOSIS.md', import.meta.url));
const outPath = process.argv[3] ?? fileURLToPath(new URL('../DIAGNOSIS.docx', import.meta.url));
const md = readFileSync(inPath, 'utf8');

/* ------------------------------------------------------------- inline runs */

function runs(text) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(new TextRun(text.slice(last, m.index)));
    const tok = m[0];
    if (tok.startsWith('**')) out.push(new TextRun({ text: tok.slice(2, -2), bold: true }));
    else out.push(new TextRun({ text: tok.slice(1, -1), font: 'Consolas', size: 19, color: '7A3B12' }));
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(new TextRun(text.slice(last)));
  return out.length ? out : [new TextRun('')];
}

const para = (text, opts = {}) =>
  new Paragraph({ children: runs(text), spacing: { after: 140 }, ...opts });

/* ------------------------------------------------------------- block parse */

const children = [];
const lines = md.split('\n');
let i = 0;

while (i < lines.length) {
  const line = lines[i];

  // html comments / placeholder markers
  if (/^\s*<!--/.test(line)) {
    while (i < lines.length && !/-->/.test(lines[i])) i += 1;
    i += 1;
    continue;
  }

  const trimmed = line.trim();

  if (trimmed === '') { i += 1; continue; }
  if (/^-{3,}$/.test(trimmed)) { i += 1; continue; } // horizontal rule

  // headings
  if (trimmed.startsWith('```')) {
    i += 1;
    const code = [];
    while (i < lines.length && !lines[i].trim().startsWith('```')) {
      code.push(lines[i]);
      i += 1;
    }
    i += 1; // closing fence
    children.push(
      new Paragraph({
        children: code.map(
          (l, idx) => new TextRun({ text: l || ' ', font: 'Consolas', size: 19, break: idx ? 1 : 0 })
        ),
        shading: { type: ShadingType.CLEAR, fill: 'F6F1EA' },
        spacing: { before: 60, after: 160 },
      })
    );
    continue;
  }
  if (trimmed.startsWith('# ')) {
    children.push(new Paragraph({ text: trimmed.slice(2), heading: HeadingLevel.TITLE, spacing: { after: 120 } }));
    i += 1;
    continue;
  }
  if (trimmed.startsWith('## ')) {
    children.push(new Paragraph({ text: trimmed.slice(3), heading: HeadingLevel.HEADING_1, spacing: { before: 260, after: 120 } }));
    i += 1;
    continue;
  }
  if (trimmed.startsWith('### ')) {
    children.push(new Paragraph({ text: trimmed.slice(4), heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 90 } }));
    i += 1;
    continue;
  }

  // tables
  if (trimmed.startsWith('|')) {
    const tableLines = [];
    while (i < lines.length && lines[i].trim().startsWith('|')) {
      tableLines.push(lines[i].trim());
      i += 1;
    }
    const rows = tableLines
      .filter((l) => !/^\|[\s:|-]+\|$/.test(l)) // separator row
      .map((l) => l.slice(1, -1).split('|').map((c) => c.trim()));
    const header = rows.shift();
    const toRow = (cells, isHeader) =>
      new TableRow({
        tableHeader: isHeader,
        children: cells.map(
          (c) =>
            new TableCell({
              shading: isHeader ? { type: ShadingType.CLEAR, fill: 'F2EDE6' } : undefined,
              margins: { top: 60, bottom: 60, left: 90, right: 90 },
              children: [new Paragraph({ children: runs(c).map((r) => (isHeader ? new TextRun({ ...r, bold: true }) : r)), spacing: { after: 40 } })],
            })
        ),
      });
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [toRow(header, true), ...rows.map((r) => toRow(r, false))],
      })
    );
    children.push(new Paragraph({ text: '', spacing: { after: 120 } }));
    continue;
  }

  // blockquote (collect consecutive)
  if (trimmed.startsWith('>')) {
    const quote = [];
    while (i < lines.length && lines[i].trim().startsWith('>')) {
      quote.push(lines[i].trim().replace(/^>\s?/, ''));
      i += 1;
    }
    for (const q of quote) {
      children.push(
        new Paragraph({
          children: runs(q).map((r) => new TextRun({ ...r, italics: true, color: '3F3A34' })),
          indent: { left: 360 },
          spacing: { after: 100 },
        })
      );
    }
    continue;
  }

  // bullets
  if (/^- /.test(trimmed)) {
    const items = [];
    while (i < lines.length && /^- /.test(lines[i].trim())) {
      items.push(lines[i].trim().slice(2));
      i += 1;
    }
    for (const it of items) children.push(new Paragraph({ children: runs(it), bullet: { level: 0 }, spacing: { after: 70 } }));
    continue;
  }

  // numbered list
  if (/^\d+\.\s/.test(trimmed)) {
    const items = [];
    while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
      items.push(lines[i].trim().replace(/^\d+\.\s/, ''));
      i += 1;
    }
    for (const it of items) children.push(new Paragraph({ children: runs(it), numbering: { reference: 'ordered', level: 0 }, spacing: { after: 70 } }));
    continue;
  }

  // paragraph (collect until blank / block start)
  const paraLines = [trimmed];
  i += 1;
  while (
    i < lines.length &&
    lines[i].trim() !== '' &&
    !/^(#|>|-\s|\d+\.\s|\||-{3,}$|<!--)/.test(lines[i].trim())
  ) {
    paraLines.push(lines[i].trim());
    i += 1;
  }
  children.push(para(paraLines.join(' ')));
}

/* -------------------------------------------------------------- document */

const doc = new Document({
  creator: 'Shripad J',
  title: 'DIAGNOSIS — The ERP that freezes',
  numbering: {
    config: [
      {
        reference: 'ordered',
        levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START }],
      },
    ],
  },
  styles: {
    default: {
      document: { run: { font: 'Calibri', size: 22, color: '1C1712' } },
      heading1: { run: { font: 'Calibri', size: 30, bold: true, color: 'C23D0C' } },
      heading2: { run: { font: 'Calibri', size: 26, bold: true, color: '1C1712' } },
      title: { run: { font: 'Calibri', size: 44, bold: true, color: '1C1712' } },
    },
  },
  sections: [{ children }],
});

const buffer = await Packer.toBuffer(doc);
writeFileSync(outPath, buffer);
console.log(`wrote ${outPath} (${(buffer.length / 1024).toFixed(0)} KB, ${children.length} blocks)`);
