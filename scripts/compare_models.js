// Compare parse_spec output across models on the same spec PDF.
// Usage: node scripts/compare_models.js <pdf-path> <output-dir>
//
// Runs all configured models in parallel and writes each extraction to
// <output-dir>/parse-<model-short-name>.json plus a summary to stdout.

const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('../src/config.js');
const { parseSpec } = require('../src/tools/parse_spec.js');

const MODELS = [
  { id: 'claude-sonnet-4-6',         short: 'sonnet',  priceIn: 3,  priceOut: 15 },
  { id: 'claude-haiku-4-5-20251001', short: 'haiku',   priceIn: 1,  priceOut: 5  },
];

function costFor(usage, model) {
  return (usage.input_tokens  / 1_000_000) * model.priceIn
       + (usage.output_tokens / 1_000_000) * model.priceOut;
}

(async () => {
  const [pdfPath, outDir] = process.argv.slice(2);
  if (!pdfPath || !outDir) {
    console.error('Usage: node scripts/compare_models.js <pdf-path> <output-dir>');
    process.exit(1);
  }

  const config = loadConfig();

  console.log(`Running ${MODELS.length} models in parallel on ${path.basename(pdfPath)}...`);
  const started = Date.now();

  const results = await Promise.all(
    MODELS.map((m) =>
      parseSpec({ pdfPath, apiKey: config.anthropicApiKey, model: m.id })
        .then((r) => ({ model: m, result: r }))
        .catch((err) => ({ model: m, error: err }))
    )
  );

  const elapsedSec = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`Done in ${elapsedSec}s\n`);

  for (const { model, result, error } of results) {
    const outPath = path.join(outDir, `parse-${model.short}.json`);
    if (error) {
      console.log(`[${model.short}] FAILED — ${error.message}`);
      continue;
    }
    fs.writeFileSync(outPath, JSON.stringify(result.extraction, null, 2));
    const e = result.extraction;
    const cost = costFor(result.usage, model);
    console.log(
      `[${model.short}]  ` +
      `${e.products.length}P / ${e.exclusions.length}E / ${e.ambiguities.length}A / ${(e.acceptable_system_manufacturers || []).length}M  ·  ` +
      `${result.usage.input_tokens}+${result.usage.output_tokens} tokens  ·  $${cost.toFixed(4)}  →  ${outPath}`
    );
  }
})();
