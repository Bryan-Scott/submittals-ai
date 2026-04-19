// draft_writer — composes the final v0.1 artifacts for a section:
//   outline-{section}-v{NN}.md                the reviewer-facing markdown draft
//   outline-{section}-v{NN}.mappings.json     the companion JSON (per §4.9)
//
// Consumes the merged requirements (from rules.js) and the search results
// (from search_library.js). No LLM, no external I/O except writing the two files.
//
// All locked design decisions enforced here:
//   §4.6  Versioned outputs — never overwrite, auto-increment version number
//   §4.7  Draft markdown format (H2 section, numbered items, Needs review, Not included)
//   §4.8  Line hashes — 4-char hex in HTML comments, stable across text edits
//   §4.9  Companion JSON keyed by line hash, values are opaque file refs
//   §4.15 Not-included items rendered as written positions (italicized reason)

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// --- Helpers -----------------------------------------------------------------

function generateLineHash(existing) {
  // crypto.randomBytes is cryptographically strong random — overkill for hash
  // uniqueness here but fine, it's already built in and has no dependency cost.
  let h;
  do {
    h = crypto.randomBytes(2).toString('hex'); // 4 hex chars → 65,536 possibilities
  } while (existing.has(h));
  existing.add(h);
  return h;
}

function findNextVersion(draftsDir, section) {
  // Loop up to 99 and return the first unused version string, zero-padded.
  for (let v = 1; v < 100; v++) {
    const vStr = String(v).padStart(2, '0');
    const mdPath = path.join(draftsDir, `outline-${section}-v${vStr}.md`);
    if (!fs.existsSync(mdPath)) return vStr;
  }
  throw new Error(`Cannot find unused version slot for section ${section} (99 existing).`);
}

function formatDate(d) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function stripSurroundingQuotes(s) {
  // Exclusion reasons from parse_spec often come wrapped in quotes (the literal
  // spec language). Strip them so the italicized reason reads cleanly in prose.
  return String(s || '').replace(/^["“”']+|["“”']+$/g, '').trim();
}

function formatItemLine(item, hash) {
  // Locked format §4.7:  {name} — {role}  ·  {citation}  <!-- #hash -->
  // Role is optional. Citation falls back to "TRC rule" for rule-derived items.
  const rolePart = item.role ? ` — ${item.role}` : '';
  const citation = item.citation || 'TRC rule';
  return `${item.name}${rolePart}  ·  ${citation}  <!-- #${hash} -->`;
}

function isPlaceholderItem(item) {
  // Rule items like "Sample [Manufacturer] 20-Year Warranty" need reviewer input.
  return /\[[^\]]+\]/.test(item.name);
}

// --- Mapping JSON entry ------------------------------------------------------

function buildMapping(item, searchResult) {
  const top = searchResult?.search?.topMatch;
  const confidence = searchResult?.search?.confidence || 'no_match';
  return {
    source: item.source,
    name: item.name,
    citation: item.citation || null,
    file_ref: top?.fileRef || null,
    confidence,
    mapping_reason: top
      ? `token-overlap F1 ${top.score.toFixed(3)}`
      : searchResult?.search?.reason || 'no match',
  };
}

// --- Needs-review collector --------------------------------------------------

function buildNeedsReview({ item, searchResult }) {
  // Returns a string to append to Needs review, or null if nothing to flag.
  if (isPlaceholderItem(item)) {
    return `${item.name} — contains placeholder; fill in manually.`;
  }
  const confidence = searchResult?.search?.confidence || 'no_match';
  if (confidence === 'no_match' || confidence === 'low') {
    const reason = searchResult?.search?.reason || 'no confident library match';
    return `${item.name}: ${reason} — manually pick the correct library file or mark as TRC shop-fabricated.`;
  }
  return null;
}

// --- Main --------------------------------------------------------------------

function writeDraft({ jobName, section, requirements, searchByItem, draftsDir, generatedAt }) {
  const now = generatedAt || new Date();
  const version = findNextVersion(draftsDir, section);
  const date = formatDate(now);

  const usedHashes = new Set();
  const mappings = {};
  const needsReview = [];

  // Build a lookup so each item can find its search result by group + index.
  const searchByKey = new Map();
  for (const s of searchByItem) {
    searchByKey.set(`${s.group}:${s.index}`, s);
  }

  // --- Numbered items ---
  const numberedLines = [];
  requirements.items.forEach((item, idx) => {
    const hash = generateLineHash(usedHashes);
    numberedLines.push(`${idx + 1}. ${formatItemLine(item, hash)}`);

    const searchResult = searchByKey.get(`numbered:${idx}`);
    mappings[hash] = buildMapping(item, searchResult);

    const flag = buildNeedsReview({ item, searchResult });
    if (flag) needsReview.push(flag);
  });

  // --- Unnumbered items (rule-derived accessories, certifications, etc.) ---
  const unnumberedLines = [];
  requirements.unnumbered_items.forEach((item, idx) => {
    const hash = generateLineHash(usedHashes);
    unnumberedLines.push(`- ${formatItemLine(item, hash)}`);

    const searchResult = searchByKey.get(`unnumbered:${idx}`);
    mappings[hash] = buildMapping(item, searchResult);

    const flag = buildNeedsReview({ item, searchResult });
    if (flag) needsReview.push(flag);
  });

  // --- Spec ambiguities → also go into Needs review ---
  for (const amb of requirements.ambiguities || []) {
    // Don't strip quotes from ambiguity reasons — they're often multi-clause
    // ("quoted spec language" — Claude's commentary) and stripping only the
    // leading quote produces an orphaned closing quote mid-string.
    needsReview.push(`${amb.description} (${amb.citation}): ${amb.reason}`);
  }

  // --- Not included block (spec exclusions + rule exclusions) ---
  const notIncluded = [];
  for (const exc of requirements.exclusions || []) {
    const reason = stripSurroundingQuotes(exc.reason);
    notIncluded.push(`${exc.description} — *${reason}* (${exc.citation})`);
  }
  for (const re of requirements.rule_exclusions || []) {
    notIncluded.push(`${re.text} — *per TRC rule*`);
  }

  // --- Assemble markdown ---
  const md = [];
  md.push(`# ${jobName}`);
  md.push(`Generated ${date} · Draft v${version}`);
  md.push('');
  md.push('---');
  md.push('');
  md.push(`## ${section} — ${requirements.section_title || ''}`);
  md.push('');
  numberedLines.forEach((line) => md.push(line));

  if (unnumberedLines.length > 0) {
    md.push('');
    md.push('**Unnumbered items**');
    unnumberedLines.forEach((line) => md.push(line));
  }

  if (needsReview.length > 0) {
    md.push('');
    md.push('**Needs review**');
    needsReview.forEach((r) => md.push(`- ${r}`));
  }

  if (notIncluded.length > 0) {
    md.push('');
    md.push('**Not included**');
    notIncluded.forEach((n) => md.push(`- ${n}`));
  }

  md.push(''); // trailing newline

  // --- Write files ---
  const draftPath = path.join(draftsDir, `outline-${section}-v${version}.md`);
  const mappingsPath = path.join(draftsDir, `outline-${section}-v${version}.mappings.json`);

  fs.writeFileSync(draftPath, md.join('\n'), 'utf8');
  fs.writeFileSync(
    mappingsPath,
    JSON.stringify(
      {
        section,
        version,
        generated_at: now.toISOString(),
        items: mappings,
        // Preserve parse_spec's acceptable manufacturer list here. Not rendered
        // in the markdown (§4.7 didn't spec a location for it), but retained
        // for the substitution layer (v0.2+) and future library picker UI.
        acceptable_system_manufacturers: requirements.acceptable_system_manufacturers || [],
      },
      null,
      2
    ),
    'utf8'
  );

  return {
    draftPath,
    mappingsPath,
    version,
    numberedCount: numberedLines.length,
    unnumberedCount: unnumberedLines.length,
    needsReviewCount: needsReview.length,
    notIncludedCount: notIncluded.length,
  };
}

module.exports = { writeDraft };
