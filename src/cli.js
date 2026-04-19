#!/usr/bin/env node
// Command-line entry point for Submittals AI.
// Run: node src/cli.js <command> [options]
// See USAGE below for the supported commands.

const fs = require('node:fs');
const path = require('node:path');
// parseArgs is Node's built-in argument parser (available in Node 18.3+).
// Handles --flag=value and --flag value, booleans, unknown-flag errors, etc.
const { parseArgs } = require('node:util');
const { loadConfig } = require('./config.js');
const { parseSpec } = require('./tools/parse_spec.js');
const { loadRules, applyRules } = require('./rules.js');
const { loadLibrary, searchLibrary } = require('./tools/search_library.js');
const { writeDraft } = require('./draft_writer.js');

const USAGE = `
Submittals AI — v0.1 CLI

Usage: node src/cli.js <command> [options]

Commands:
  generate-outline   Generate a draft submittal outline from a spec section PDF
  reconcile          (not yet implemented)
  compile-package    (not yet implemented, v0.2)
  help               Show this message

Options for generate-outline:
  --job       Job name, e.g. "25049 - Dripping Springs HS 2"
  --spec      Path to the spec section PDF
  --section   CSI section number, e.g. 075423

Example:
  node src/cli.js generate-outline --job "25049 - Dripping Springs HS 2" --spec ./specs/075423.pdf --section 075423
`.trim();

// --- Input validation --------------------------------------------------------
//
// All three of these validators run on user-supplied strings before we use them
// to build file paths. The job name and section number become folder/file
// segments, so they're the main path-traversal attack surface.

function validateJobName(job) {
  if (!job) throw new Error('--job is required.');
  // Reject ".." anywhere — prevents breaking out of the Projects/ folder.
  if (job.includes('..')) throw new Error('--job cannot contain ".." (path traversal).');
  // Reject path separators for the same reason.
  if (/[\\/]/.test(job)) throw new Error('--job cannot contain slashes.');
  // Whitelist: letters, digits, spaces, hyphens, underscores, dots.
  // This matches names like "25049 - Dripping Springs HS 2".
  if (!/^[A-Za-z0-9 \-_.]+$/.test(job)) {
    throw new Error('--job can only contain letters, numbers, spaces, hyphens, underscores, and dots.');
  }
  return job;
}

function validateSection(section) {
  if (!section) throw new Error('--section is required.');
  // CSI section numbers are digits only (e.g. 075423, 076200).
  if (!/^\d+$/.test(section)) {
    throw new Error('--section must be digits only, e.g. 075423.');
  }
  return section;
}

function validateSpecPath(specPath) {
  if (!specPath) throw new Error('--spec is required.');
  if (!fs.existsSync(specPath)) throw new Error(`Spec file does not exist: ${specPath}`);
  if (!/\.pdf$/i.test(specPath)) throw new Error(`--spec must be a .pdf file: ${specPath}`);
  return specPath;
}

// --- generate-outline --------------------------------------------------------
//
// Current pipeline stages (v0.1 in progress):
//   1. Validate inputs, copy spec PDF into Projects/{job}/inputs/     DONE
//   2. Parse spec PDF via Claude, save extraction JSON                DONE
//   3. Apply rules engine, produce required-items list                DONE
//   4. Search library, map items to PDF files                         DONE
//   5. Write draft markdown + companion JSON                          DONE

async function generateOutline(args) {
  const { values } = parseArgs({
    args,
    options: {
      job:     { type: 'string' },
      spec:    { type: 'string' },
      section: { type: 'string' },
    },
    strict: true, // Unknown flags throw, which is what we want.
  });

  const job = validateJobName(values.job);
  const section = validateSection(values.section);
  const specPath = validateSpecPath(values.spec);

  const config = loadConfig();

  const jobDir = path.join(config.projectsPath, job);
  const inputsDir = path.join(jobDir, 'inputs');
  const draftsDir = path.join(jobDir, 'drafts');

  // { recursive: true } creates any missing parent folders too.
  fs.mkdirSync(inputsDir, { recursive: true });
  fs.mkdirSync(draftsDir, { recursive: true });

  const copiedSpecName = `${section}-spec.pdf`;
  const copiedSpecPath = path.join(inputsDir, copiedSpecName);
  fs.copyFileSync(specPath, copiedSpecPath);

  const timestamp = new Date().toISOString();
  const logPath = path.join(jobDir, 'log.md');

  console.log(`[ok] Job folder:   ${jobDir}`);
  console.log(`[ok] Spec copied:  ${copiedSpecPath}`);

  // --- Stage 2: parse the spec via Claude ---
  console.log(`[..] Parsing spec via Claude (${section}) — this can take 20–60s for a long section...`);
  const parseResult = await parseSpec({
    pdfPath: copiedSpecPath,
    apiKey: config.anthropicApiKey,
  });

  // Save extraction as a debug artifact. This is NOT the final draft —
  // it's the structured data that will feed the rules engine and library search.
  const parseOutputPath = path.join(draftsDir, `parse-${section}-v01.json`);
  fs.writeFileSync(parseOutputPath, JSON.stringify(parseResult.extraction, null, 2));

  const extraction = parseResult.extraction;

  // Section-number sanity check: warn if the header Claude extracted doesn't match
  // the --section flag. Common cause is the user supplied the wrong PDF.
  // We warn rather than fail because header formatting varies ("Section 07 54 23"
  // vs "075423" vs "07 54 23") and a downstream reviewer will catch real mismatches.
  if (!extraction.section_number.replace(/\D/g, '').includes(section)) {
    console.log(`[warn] Section header in PDF reads "${extraction.section_number}" — expected to contain "${section}". Check that the right PDF was supplied.`);
  }

  console.log(`[ok] Parse saved:  ${parseOutputPath}`);
  console.log(`[ok] Extracted:    ${extraction.products.length} products, ${extraction.exclusions.length} exclusions, ${extraction.ambiguities.length} ambiguities`);
  console.log(`[ok] Tokens used:  ${parseResult.usage.input_tokens} in / ${parseResult.usage.output_tokens} out (${parseResult.model})`);

  // --- Stage 3: apply TRC rules ---
  const rulesPath = path.join(config.referencePath, 'Standard-Submittal-Items.md');
  const rules = loadRules(rulesPath);
  const requirements = applyRules(parseResult.extraction, rules, { section });

  const requirementsPath = path.join(draftsDir, `requirements-${section}-v01.json`);
  fs.writeFileSync(requirementsPath, JSON.stringify(requirements, null, 2));

  console.log(`[ok] Rules merged: ${requirementsPath}`);
  console.log(`[ok] Requirements: ${requirements.items.length} numbered, ${requirements.unnumbered_items.length} unnumbered, ${requirements.rule_exclusions.length} rule exclusions${requirements.section_rules_applied ? '' : '  (universal rules only — no section entry)'}`);
  if (requirements.warnings.length > 0) {
    for (const w of requirements.warnings) console.log(`[warn] ${w}`);
  }

  // --- Stage 4: search library for each required item ---
  console.log(`[..] Loading MSDS Library and searching for ${requirements.items.length + requirements.unnumbered_items.length} items...`);
  const libStart = Date.now();
  const library = loadLibrary(config.msdsLibraryPath);
  const libLoadMs = Date.now() - libStart;

  const searchStart = Date.now();
  const searchByItem = [];
  const byConfidence = { high: 0, medium: 0, low: 0, no_match: 0 };

  const allItems = [
    ...requirements.items.map((item, idx) => ({ ...item, _group: 'numbered', _index: idx })),
    ...requirements.unnumbered_items.map((item, idx) => ({ ...item, _group: 'unnumbered', _index: idx })),
  ];

  for (const item of allItems) {
    const result = searchLibrary(library, item.name);
    byConfidence[result.confidence]++;
    searchByItem.push({
      group: item._group,
      index: item._index,
      item_name: item.name,
      source: item.source,
      citation: item.citation,
      search: result,
    });
  }
  const searchMs = Date.now() - searchStart;

  const searchOutputPath = path.join(draftsDir, `search-${section}-v01.json`);
  fs.writeFileSync(
    searchOutputPath,
    JSON.stringify(
      {
        section_number: section,
        library_file_count: library.files.length,
        library_load_ms: libLoadMs,
        search_ms: searchMs,
        total_queries: searchByItem.length,
        by_confidence: byConfidence,
        results: searchByItem,
      },
      null,
      2
    )
  );

  console.log(`[ok] Library loaded: ${library.files.length} PDFs indexed in ${libLoadMs}ms`);
  console.log(`[ok] Search saved:  ${searchOutputPath}`);
  console.log(`[ok] Confidence:    ${byConfidence.high} high / ${byConfidence.medium} medium / ${byConfidence.low} low / ${byConfidence.no_match} no_match  (search ${searchMs}ms)`);

  // --- Stage 5: write draft markdown + companion JSON ---
  const draftResult = writeDraft({
    jobName: job,
    section,
    requirements,
    searchByItem,
    draftsDir,
    generatedAt: new Date(),
  });

  console.log(`[ok] Draft:        ${draftResult.draftPath}`);
  console.log(`[ok] Mappings:     ${draftResult.mappingsPath}`);
  console.log(`[ok] Draft stats:  v${draftResult.version} — ${draftResult.numberedCount} numbered, ${draftResult.unnumberedCount} unnumbered, ${draftResult.needsReviewCount} needs-review, ${draftResult.notIncludedCount} not-included`);

  const logEntry = `- ${timestamp}  generate-outline  section ${section}  parsed via ${parseResult.model}  ${parseResult.usage.input_tokens}+${parseResult.usage.output_tokens} tokens  → ${extraction.products.length}P/${extraction.exclusions.length}E/${extraction.ambiguities.length}A  rules→ ${requirements.items.length}N/${requirements.unnumbered_items.length}U/${requirements.rule_exclusions.length}X  search→ ${byConfidence.high}H/${byConfidence.medium}M/${byConfidence.low}L/${byConfidence.no_match}X  draft→ v${draftResult.version}\n`;
  fs.appendFileSync(logPath, logEntry);

  console.log(`[done] Draft v${draftResult.version} ready for review.`);
}

// --- Main dispatcher ---------------------------------------------------------

async function main() {
  const subcommand = process.argv[2];
  const rest = process.argv.slice(3);

  try {
    switch (subcommand) {
      case 'generate-outline':
        await generateOutline(rest);
        break;
      case 'help':
      case '--help':
      case '-h':
      case undefined:
        console.log(USAGE);
        break;
      default:
        console.error(`Unknown command: ${subcommand}\n`);
        console.error(USAGE);
        process.exit(1);
    }
  } catch (err) {
    // Any thrown Error lands here so the user sees a clean message, not a stack trace.
    console.error(`[error] ${err.message}`);
    process.exit(1);
  }
}

main();
