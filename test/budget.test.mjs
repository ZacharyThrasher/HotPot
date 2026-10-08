// Performance budget: the page, sounds and icons must stay small enough to load fast on a phone.
// Music streams (and is cached after its first play), so it only has a per-track cap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';

const pub = new URL('../public/', import.meta.url);
const size = (p) => statSync(new URL(p, pub)).size;
const dirTotal = (d) => readdirSync(new URL(d, pub)).reduce((n, f) => n + size(d + f), 0);
const KB = 1024;

test('page stays under 320 KB', () => {
  assert.ok(size('index.html') < 320 * KB, `index.html is ${(size('index.html') / KB) | 0} KB`);
});

test('sound effects stay under 400 KB in total, 40 KB each (80 KB for the simmer loop)', () => {
  assert.ok(dirTotal('sfx/') < 400 * KB);
  for (const f of readdirSync(new URL('sfx/', pub))) assert.ok(size('sfx/' + f) < (f === 'simmer.mp3' ? 80 : 40) * KB, f);
});

test('icons stay under 200 KB in total', () => {
  assert.ok(dirTotal('icons/') < 200 * KB);
});

test('each music track stays under 9 MB', () => {
  for (const f of readdirSync(new URL('music/', pub)).filter((f) => f.endsWith('.mp3'))) assert.ok(size('music/' + f) < 9 * 1024 * KB, f);
});

test('the offline cache lists only files that exist', () => {
  const sw = readFileSync(new URL('sw.js', pub), 'utf8');
  const list = JSON.parse(sw.match(/const SHELL=(\[.*?\]);/)[1]);
  for (const f of list) if (f !== './') assert.ok(statSync(new URL(f, pub)).isFile(), f);
});
