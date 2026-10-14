import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync(new URL('./page.html', import.meta.url), 'utf8');
let s = html.replace(/data:[^"')\s]+/g, '[DATA_URI_REMOVED]');
s = s.replace(/<script[\s\S]*?<\/script>/gi, '\n[SCRIPT]\n');
s = s.replace(/<style[\s\S]*?<\/style>/gi, '\n[STYLE]\n');
s = s.replace(/<svg[\s\S]*?<\/svg>/gi, '\n[SVG]\n');
s = s.replace(/<!--[\s\S]*?-->/g, '');
s = s.replace(/<br\s*\/?>/gi, '\n');
s = s.replace(/<\/(p|div|h1|h2|h3|h4|h5|li|tr|section|header|footer|article|table|ul|ol|details|summary)>/gi, '\n');
s = s.replace(/<[^>]+>/g, ' ');
s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&middot;/g, '*');
s = s.split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
writeFileSync(new URL('./page.txt', import.meta.url), s);
console.log('lines:', s.split('\n').length, 'chars:', s.length);
