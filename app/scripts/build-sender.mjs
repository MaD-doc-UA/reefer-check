// Builds sender/sender.html + sender.ts into ONE self-contained file: dist-sender/reefer-sender.html
// (open it from disk in Edge/Chrome on the work PC, no install, no network).
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const res = await build({
  entryPoints: ['sender/sender.ts'],
  bundle: true, minify: true, format: 'iife', target: 'es2019', write: false, legalComments: 'none',
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = readFileSync('sender/sender.html', 'utf8').replace('/*BUNDLE*/', () => js);
mkdirSync('dist-sender', { recursive: true });
writeFileSync('dist-sender/reefer-sender.html', html);
console.log(`dist-sender/reefer-sender.html ${(html.length / 1024).toFixed(0)} KB`);
