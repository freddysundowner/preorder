// Inline the demo build's CSS and JS into one HTML file: dist-demo/preorder-demo.html
import fs from 'node:fs';
import path from 'node:path';
const dir = 'dist-demo';
let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
html = html.replace(/<link rel="stylesheet"[^>]*href="\/?([^"]+)"[^>]*>/g, (_, f) =>
  `<style>${fs.readFileSync(path.join(dir, f), 'utf8')}</style>`);
html = html.replace(/<script type="module" crossorigin src="\/?([^"]+)"><\/script>/g, (_, f) =>
  `<script type="module">${fs.readFileSync(path.join(dir, f), 'utf8').replace(/<\/script/g, '<\\/script')}</script>`);
fs.writeFileSync(path.join(dir, 'preorder-demo.html'), html);
console.log('Wrote', path.join(dir, 'preorder-demo.html'), Math.round(html.length / 1024) + ' KB');
