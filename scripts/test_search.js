// Runs library search against a saved requirements JSON. No API calls.
// Usage: node scripts/test_search.js <requirements.json path>

const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('../src/config.js');
const { loadLibrary, searchLibrary } = require('../src/tools/search_library.js');

const reqPath = process.argv[2];
if (!reqPath || !fs.existsSync(reqPath)) {
  console.error('Usage: node scripts/test_search.js <requirements.json path>');
  process.exit(1);
}

const requirements = JSON.parse(fs.readFileSync(reqPath, 'utf8'));
const config = loadConfig();

console.log(`Loading library from ${config.msdsLibraryPath}...`);
const libStart = Date.now();
const library = loadLibrary(config.msdsLibraryPath);
console.log(`Loaded ${library.files.length} PDFs in ${Date.now() - libStart}ms\n`);

const items = [
  ...requirements.items.map((i, idx) => ({ ...i, _group: 'N', _index: idx })),
  ...requirements.unnumbered_items.map((i, idx) => ({ ...i, _group: 'U', _index: idx })),
];

const byConfidence = { high: 0, medium: 0, low: 0, no_match: 0 };
for (const item of items) {
  const r = searchLibrary(library, item.name);
  byConfidence[r.confidence]++;
  const top = r.topMatch ? `${r.topMatch.score.toFixed(3)}  ${r.topMatch.displayPath}` : `(${r.reason || 'no match'})`;
  const label = `[${r.confidence.toUpperCase().padEnd(8)}] ${item._group}${String(item._index).padEnd(2)} (${item.source.padEnd(4)})`;
  console.log(`${label} ${item.name.slice(0, 70).padEnd(70)}  →  ${top}`);
}

console.log(`\nSummary: ${byConfidence.high} high / ${byConfidence.medium} medium / ${byConfidence.low} low / ${byConfidence.no_match} no_match`);
