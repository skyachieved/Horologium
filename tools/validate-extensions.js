#!/usr/bin/env node
/*
 * `npm run validate`: load every bundled extension and print what is wrong. Exit code 1 on problems.
 * Same loader the app uses, so "passes here" means "loads in the app".
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadExtensions } from '../src/main/extensions.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { registry, problems } = loadExtensions({ bundledRoot: path.join(root, 'extensions') });

console.log(`themes:        ${registry.themes.map((t) => `${t.id} (${t.characters.map((c) => c.id).join(', ')})`).join('; ') || '-'}`);
console.log(`music sources: ${registry.musicSources.map((s) => s.id).join(', ') || '-'}`);
console.log(`locales:       ${Object.keys(registry.locales).join(', ') || '-'}`);

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) {
    console.error(`\n  ${p.file}${p.id ? ` [${p.id}]` : ''}`);
    for (const e of p.errors) console.error(`    - ${e}`);
  }
  process.exit(1);
}
console.log('\nAll extensions are valid.');
