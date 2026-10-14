import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const html = readFileSync('scrape/page.html', 'utf8');

// 1) Extract the Techcora logo (inline base64 SVG) as a real file
const logo = html.match(/src="data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)"/);
if (logo) {
  mkdirSync('demo/public/brand', { recursive: true });
  writeFileSync('demo/public/brand/techcora-logo.svg', Buffer.from(logo[1], 'base64'));
  console.log('logo: saved demo/public/brand/techcora-logo.svg');
}

// 2) Dump the site CSS + palette + fonts
const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n\n');
writeFileSync('scrape/site.css', styles);

const colors = [...new Set(styles.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) || [])];
console.log('\nCOLORS USED (' + colors.length + '):');
console.log(colors.slice(0, 60).join('\n'));

const vars = [...new Set(styles.match(/--[a-zA-Z0-9-]+\s*:\s*[^;]+/g) || [])];
console.log('\nCSS VARIABLES:');
console.log(vars.slice(0, 60).join('\n'));

const fonts = [...new Set(styles.match(/font-family\s*:\s*[^;}]+/g) || [])];
console.log('\nFONT FAMILIES:');
console.log(fonts.join('\n'));
