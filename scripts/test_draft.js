// Produces a draft by running search + writeDraft against saved requirements.
// No API calls — exercises rules output through the final markdown.
//
// Usage: node scripts/test_draft.js <requirements.json path>

const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('../src/config.js');
const { loadLibrary, searchLibrary } = require('../src/tools/search_library.js');
const { writeDraft } = require('../src/draft_writer.js');

const reqPath = process.argv[2];
if (!reqPath || !fs.existsSync(reqPath)) {
  console.error('Usage: node scripts/test_draft.js <requirements.json path>');
  process.exit(1);
}

const requirements = JSON.parse(fs.readFileSync(reqPath, 'utf8'));
const config = loadConfig();
const draftsDir = path.dirname(reqPath);
// Job name inferred from the Projects subfolder name.
const jobName = path.basename(path.dirname(draftsDir));
const section = requirements.section_number.replace(/\D/g, '');

console.log(`Loading library...`);
const library = loadLibrary(config.msdsLibraryPath);

const allItems = [
  ...requirements.items.map((item, idx) => ({ ...item, _group: 'numbered', _index: idx })),
  ...requirements.unnumbered_items.map((item, idx) => ({ ...item, _group: 'unnumbered', _index: idx })),
];

const searchByItem = allItems.map((item) => {
  const result = searchLibrary(library, item.name);
  return {
    group: item._group,
    index: item._index,
    item_name: item.name,
    source: item.source,
    citation: item.citation,
    search: result,
  };
});

const result = writeDraft({
  jobName,
  section,
  requirements,
  searchByItem,
  draftsDir,
  generatedAt: new Date(),
});

console.log(`\nDraft:    ${result.draftPath}`);
console.log(`Mappings: ${result.mappingsPath}`);
console.log(`Stats:    v${result.version} — ${result.numberedCount}N / ${result.unnumberedCount}U / ${result.needsReviewCount} needs-review / ${result.notIncludedCount} not-included\n`);
console.log(`----- DRAFT MARKDOWN -----\n`);
console.log(fs.readFileSync(result.draftPath, 'utf8'));
