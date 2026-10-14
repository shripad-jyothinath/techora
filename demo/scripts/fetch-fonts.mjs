// Downloads the two fonts used by the Techcora site (Funnel Sans + Orbitron)
// from Google Fonts into public/fonts so the demo works fully offline.
// Run once; the woff2 files are committed. Falls back silently if offline.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fontsDir = join(here, '..', 'public', 'fonts');
mkdirSync(fontsDir, { recursive: true });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

const jobs = [
  { family: 'Funnel Sans', query: 'Funnel+Sans:wght@400;500;600;700', slug: 'funnel-sans' },
  { family: 'Orbitron', query: 'Orbitron:wght@500;600;700', slug: 'orbitron' },
];

let css = '/* Techcora ERP demo — local webfonts (SIL Open Font License), fetched from Google Fonts. */\n';
let downloaded = 0;

for (const job of jobs) {
  try {
    const res = await fetch(`https://fonts.googleapis.com/css2?family=${job.query}&display=swap`, {
      headers: { 'User-Agent': UA },
    });
    const text = await res.text();
    const blocks = text.split('@font-face').slice(1);
    let i = 0;
    for (const block of blocks) {
      const weight = (block.match(/font-weight:\s*([^;]+);/) || [])[1];
      const url = (block.match(/url\((https:[^)]+\.woff2)\)/) || [])[1];
      const range = (block.match(/unicode-range:\s*([^;]+);/) || [])[1] || '';
      if (!url || !weight) continue;
      // keep only latin + latin-ext subsets
      if (range && !/U\+0000-00FF/.test(range) && !/U\+0100-02AF/.test(range)) continue;
      const bin = Buffer.from(await (await fetch(url, { headers: { 'User-Agent': UA } })).arrayBuffer());
      const name = `${job.slug}-${String(weight).replace(/\s+/g, '-')}-${i}.woff2`;
      writeFileSync(join(fontsDir, name), bin);
      css += `@font-face{font-family:'${job.family}';font-style:normal;font-weight:${weight};font-display:swap;src:url('./${name}') format('woff2');}\n`;
      downloaded++;
      i++;
    }
    console.log(`${job.family}: ${i} file(s)`);
  } catch (err) {
    console.warn(`${job.family}: download skipped (${err.message}) — the UI falls back to system fonts.`);
  }
}

writeFileSync(join(fontsDir, 'fonts.css'), css);
console.log(`done: ${downloaded} woff2 file(s) in public/fonts`);
