// Rules engine — deterministic processing of TRC's Standard-Submittal-Items.md
// plus parse_spec output, producing an ordered requirements list for one section.
//
// This is the first layer in the pipeline that is NOT an LLM call — it's pure
// markdown parsing + list merging. See ROADMAP.md §4.3 (rules live in markdown).
//
// v0.1 scope is intentionally narrow:
//   - Parses section-specific blocks from Standard-Submittal-Items.md
//   - Hardcodes one universal rule (TRC Warranty always #1)
//   - Merges rule items + spec items into an ordered list
//   - Does NOT dedup, substitute, or resolve [Manufacturer] placeholders
// Those behaviors come later.

const fs = require('node:fs');

// Universal rule: TRC Workmanship Warranty is ALWAYS the first item in every
// submittal section, with zero exceptions. Authoritative source is
// `Reference/Standard-Submittal-Items.md`, subsection "Warranty Items (always first)".
// Hardcoded here for v0.1 because parsing the prose-heavy "always first" subsection
// reliably is more fragile than this one-line duplication is worth.
// TODO v0.2: lift into markdown-driven config.
const UNIVERSAL_FIRST_ITEM = {
  source: 'rule',
  rule_reference: 'universal:trc-warranty-always-first',
  name: 'Sample Texas Roofing 2-Year Workmanship Warranty',
  citation: 'TRC rule',
  role: 'Warranty',
  note: 'TRC rule — always position 1. Default 2-Year term; use 5-Year if contract/LOI requires.',
};

// --- Parser -----------------------------------------------------------------

// Walks the markdown file line-by-line, tracking which ### section and which
// **Label:** we're under, accumulating bullet/numbered list items as rule text.
//
// Output shape:
//   {
//     sections: {
//       "076200": { ids: ["076200","076210"], name: "...", numbered: [...], unnumbered: [...], excluded: [...] },
//       "076210": <same object as above — same rules apply to all listed IDs>,
//       ...
//     }
//   }
function loadRules(rulesFilePath) {
  if (!fs.existsSync(rulesFilePath)) {
    throw new Error(
      `Rules file not found: ${rulesFilePath}\n` +
      `  Fix: confirm the workspace Reference folder contains Standard-Submittal-Items.md.`
    );
  }

  const content = fs.readFileSync(rulesFilePath, 'utf8');
  const lines = content.split(/\r?\n/);

  const rules = { sections: {} };

  let currentSection = null;  // accumulator for the active ### section block
  let currentLabel = null;    // 'numbered' | 'unnumbered' | 'excluded' | null (skip)

  const saveCurrent = () => {
    if (!currentSection) return;
    // Register the section under every CSI ID in its header. A single section
    // block in the markdown may apply to multiple IDs (e.g., "### 074110 / 074113").
    for (const id of currentSection.ids) {
      rules.sections[id] = currentSection;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Only ### headers start new sections (## is the top-level group header).
    if (line.startsWith('### ')) {
      saveCurrent();
      const headerText = line.slice(4).trim();
      // Extract any CSI-like numbers: 5-6 digits, optionally with a .NN suffix
      // (e.g. "074213.13"). Matches are registered as section IDs.
      const ids = [...headerText.matchAll(/\b\d{5,6}(?:\.\d+)?\b/g)].map((m) => m[0]);
      currentSection = { ids, name: headerText, numbered: [], unnumbered: [], excluded: [] };
      // Default label is 'numbered' — several sections in the rules file list
      // items directly under the header without an explicit **Numbered items:**
      // label (e.g., 074213, 074800, 061053, 077236). Treat those as numbered.
      currentLabel = 'numbered';
      continue;
    }

    if (!currentSection) continue;

    // Detect bold labels like "**Numbered items:**" or "**Items to EXCLUDE (even if in spec):**"
    const labelMatch = line.match(/^\*\*(.+?):\*\*/);
    if (labelMatch) {
      const label = labelMatch[1].toLowerCase();
      if (label.includes('numbered items') && !label.includes('unnumbered')) {
        currentLabel = 'numbered';
      } else if (label.includes('unnumbered')) {
        currentLabel = 'unnumbered';
      } else if (label.includes('exclude')) {
        currentLabel = 'excluded';
      } else {
        currentLabel = null; // skip Notes, etc., for v0.1
      }
      continue;
    }

    // Collect list items (bullet "- " or numbered "1. ") under the active label.
    if (currentLabel && /^(?:\d+\.|-)\s+/.test(line)) {
      const text = line.replace(/^(?:\d+\.|-)\s+/, '').trim();
      currentSection[currentLabel].push(text);
    }
  }

  saveCurrent();
  return rules;
}

// --- Apply ------------------------------------------------------------------

// Given the parse_spec output and loaded rules, produce the ordered requirements
// for one section. Output shape is what the draft writer will consume.
//
// Ordering (v0.1):
//   1. Universal TRC Warranty (always first)
//   2. Section-specific numbered rule items (skipping any that duplicate #1)
//   3. Spec-derived products in the order parse_spec returned them
//   4. Unnumbered rule items at the end (certifications, accessories)
function applyRules(parseResult, rules, { section }) {
  const sectionRules = rules.sections[section];

  const items = [];
  const warnings = [];

  // 1. Universal warranty always first.
  items.push({ ...UNIVERSAL_FIRST_ITEM });

  // 2. Section-specific numbered rule items.
  if (sectionRules) {
    sectionRules.numbered.forEach((text, idx) => {
      // Skip a TRC Workmanship Warranty duplicate — we already added it as #1.
      if (looksLikeTrcWarranty(text)) return;
      items.push({
        source: 'rule',
        rule_reference: `section:${section}:numbered:${idx}`,
        name: text,
        citation: 'TRC rule',
        role: null,
        note: null,
      });
    });
  } else {
    warnings.push(
      `No section-specific TRC standards for ${section} in Standard-Submittal-Items.md — ` +
      `only the universal warranty rule applied. Consider adding a rule entry once this section stabilizes.`
    );
  }

  // 3. Spec-derived products (order preserved from parse_spec).
  for (const p of parseResult.products) {
    items.push({
      source: 'spec',
      name: p.name,
      citation: p.citation,
      role: p.role,
      confidence: p.confidence,
      note: p.note,
      or_approved_equal: p.or_approved_equal,
      named_alternates: p.named_alternates,
    });
  }

  // 4. Unnumbered rule items (only — spec doesn't distinguish numbered/unnumbered).
  const unnumberedItems = [];
  if (sectionRules) {
    sectionRules.unnumbered.forEach((text, idx) => {
      unnumberedItems.push({
        source: 'rule',
        rule_reference: `section:${section}:unnumbered:${idx}`,
        name: text,
        citation: 'TRC rule',
        role: null,
        note: null,
      });
    });
  }

  return {
    section_number: parseResult.section_number,
    section_title: parseResult.section_title,
    acceptable_system_manufacturers: parseResult.acceptable_system_manufacturers || [],
    items,
    unnumbered_items: unnumberedItems,
    // Pass-through from parse_spec:
    exclusions: parseResult.exclusions || [],
    ambiguities: parseResult.ambiguities || [],
    // Rule-derived exclusions (from "**Items to EXCLUDE**" in the rules file).
    // Kept separate so the draft writer can render them under "Not included"
    // with a TRC-rule attribution rather than a spec citation.
    rule_exclusions: sectionRules
      ? sectionRules.excluded.map((text, idx) => ({
          source: 'rule',
          rule_reference: `section:${section}:excluded:${idx}`,
          text,
        }))
      : [],
    section_rules_applied: !!sectionRules,
    warnings,
  };
}

// Case-insensitive check for TRC Workmanship Warranty variants.
// Not a perfect dedup but catches the canonical forms from the rules file.
function looksLikeTrcWarranty(text) {
  const t = text.toLowerCase();
  return (t.includes('texas roofing') || t.includes('trc')) && t.includes('workmanship');
}

module.exports = { loadRules, applyRules };
