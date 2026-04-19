// Smoke test for rules.js — verifies Standard-Submittal-Items.md parses
// and applyRules produces a sensible merged list. No API calls.

const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('../src/config.js');
const { loadRules, applyRules } = require('../src/rules.js');

const config = loadConfig();
const rulesPath = path.join(config.referencePath, 'Standard-Submittal-Items.md');
const rules = loadRules(rulesPath);

console.log(`Loaded rules for ${Object.keys(rules.sections).length} section IDs:\n`);
for (const id of Object.keys(rules.sections).sort()) {
  const s = rules.sections[id];
  console.log(`  ${id.padEnd(12)} ${String(s.numbered.length).padStart(2)}N / ${String(s.unnumbered.length).padStart(2)}U / ${String(s.excluded.length).padStart(2)}X   (${s.name})`);
}

// Exercise applyRules using an existing parse output.
const parsePath = path.join(
  config.projectsPath,
  'TEST-TPO-PARSE', 'drafts', 'parse-sonnet.json'
);
if (!fs.existsSync(parsePath)) {
  console.log(`\n(skipping applyRules test — no parse file at ${parsePath})`);
  process.exit(0);
}

const parseResult = JSON.parse(fs.readFileSync(parsePath, 'utf8'));

for (const section of ['075423', '076200']) {
  const req = applyRules(parseResult, rules, { section });
  console.log(
    `\n[applyRules section=${section}]  ` +
    `${req.items.length} numbered, ${req.unnumbered_items.length} unnumbered, ` +
    `${req.rule_exclusions.length} rule-excluded, section_rules_applied=${req.section_rules_applied}`
  );
  if (req.warnings.length) console.log(`  warn: ${req.warnings[0]}`);
  console.log(`  first 3 items:`);
  req.items.slice(0, 3).forEach((i, idx) => {
    console.log(`    ${idx + 1}. [${i.source}] ${i.name.slice(0, 80)}`);
  });
}
