import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

const NAMES = ['Tünde', 'Dóri', 'Sári'];
const MARK = /[\u00e1\u00e9\u00ed\u00f3\u00f6\u0151\u00fa\u00fc\u0171\u00c1\u00c9\u00cd\u00d3\u00d6\u0150\u00da\u00dc\u0170]/;

function visibleSource(text) {
  let out = text;
  for (const name of NAMES) out = out.split(name).join('');
  return out;
}

test('the pages and scripts do not keep Hungarian UI text', () => {
  const files = [
    new URL('../index.html', import.meta.url),
    ...readdirSync(new URL('../js/', import.meta.url))
      .filter((name) => name.endsWith('.js'))
      .map((name) => new URL(`../js/${name}`, import.meta.url)),
  ];
  const hits = [];
  for (const file of files) {
    const text = visibleSource(readFileSync(file, 'utf8'));
    if (MARK.test(text)) hits.push(file.pathname.split('/').pop());
  }
  assert.deepEqual(hits, []);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /lang="en"/);
  assert.match(html, /<title>Agona<\/title>/);
});
