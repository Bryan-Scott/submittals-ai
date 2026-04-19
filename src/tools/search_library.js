// search_library — deterministic, no-LLM file matching against the MSDS Library.
//
// API:
//   loadLibrary(libraryRoot)           → { root, files: FileEntry[] }
//   searchLibrary(library, query, opts)→ { query, matches: Match[], topMatch, confidence, reason? }
//   resolveLibraryFile(fileRef, root)  → absolute filesystem path
//
// The FILE REFERENCE is an OPAQUE scheme-prefixed string (ROADMAP §4.9 and §4.4):
// callers never parse it. It looks like "msds:GAF/TPO/60 mil TPO.pdf" today;
// tomorrow it might be "pds:7a3f..." when the library backend is a database.

const fs = require('node:fs');
const path = require('node:path');

const FILE_REF_PREFIX = 'msds:';

// Path segments that mark a file as archived / deprecated / not-for-use.
// Case-insensitive. Archived files get a score penalty, not an outright filter —
// they're still returned for context if nothing else matches.
const ARCHIVED_FOLDER_PATTERNS = [
  /^old$/i,
  /^x[- ]?old$/i,
  /^x$/i,
  /don.?t use/i,
  /^archive$/i,
  /^older/i,
];

// Confidence thresholds tuned from first-test F1 score distribution. Revisit
// after we see real performance across a broader set of queries.
const CONFIDENCE_THRESHOLDS = { high: 0.7, medium: 0.4, low: 0.15 };

// --- Tokenization ------------------------------------------------------------

// Lowercase, split on any non-alphanumeric run. Produces e.g.
//   "GAF EverGuard TPO 60-mil" → ["gaf", "everguard", "tpo", "60", "mil"]
//   "PAC-CLAD Sheet & Coil PDS" → ["pac", "clad", "sheet", "coil", "pds"]
function tokenize(text) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

function isArchivedPath(displayPath) {
  const segments = displayPath.split('/');
  return segments.some((seg) =>
    ARCHIVED_FOLDER_PATTERNS.some((re) => re.test(seg))
  );
}

// --- Library loading ---------------------------------------------------------

// Manually recurse with readdirSync + withFileTypes for broad Node compatibility.
// The built-in { recursive: true } option was added in Node 20.1 — fine but this
// version works everywhere and only adds a few lines.
function walkPdfs(rootDir, currentDir, results) {
  let entries;
  try {
    entries = fs.readdirSync(currentDir, { withFileTypes: true });
  } catch {
    // Permission errors on obscure subfolders — skip them rather than fail the whole walk.
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      walkPdfs(rootDir, fullPath, results);
    } else if (entry.isFile() && /\.pdf$/i.test(entry.name)) {
      results.push(path.relative(rootDir, fullPath));
    }
  }
  return results;
}

function loadLibrary(libraryRoot) {
  if (!fs.existsSync(libraryRoot)) {
    throw new Error(
      `MSDS Library not found at: ${libraryRoot}\n` +
      `  Fix: confirm the workspace contains an "MSDS Library" subfolder.`
    );
  }

  const relPaths = walkPdfs(libraryRoot, libraryRoot, []);
  const files = relPaths.map((relPath) => {
    // Normalize to forward slashes for display and tokenization stability.
    const displayPath = relPath.replace(/\\/g, '/');
    const tokens = tokenize(displayPath);
    return {
      fileRef: FILE_REF_PREFIX + displayPath,
      displayPath,
      tokens: new Set(tokens),
      tokenCount: tokens.length,
      isArchived: isArchivedPath(displayPath),
    };
  });

  return { root: libraryRoot, files };
}

// --- Scoring -----------------------------------------------------------------

// F1 = harmonic mean of precision (matches / file tokens) and recall
// (matches / query tokens). Naturally punishes files with extra path segments
// that don't match the query, and naturally punishes queries that only match
// one tiny corner of a broad file path.
function f1Score(queryTokens, fileTokens, fileTokenCount) {
  if (queryTokens.length === 0 || fileTokenCount === 0) return 0;
  let matched = 0;
  for (const qt of queryTokens) {
    if (fileTokens.has(qt)) matched++;
  }
  if (matched === 0) return 0;
  const precision = matched / fileTokenCount;
  const recall = matched / queryTokens.length;
  return (2 * precision * recall) / (precision + recall);
}

function bucketConfidence(score) {
  if (score >= CONFIDENCE_THRESHOLDS.high) return 'high';
  if (score >= CONFIDENCE_THRESHOLDS.medium) return 'medium';
  if (score >= CONFIDENCE_THRESHOLDS.low) return 'low';
  return 'no_match';
}

function hasPlaceholder(query) {
  // Rule items like "Sample [Manufacturer] 20-Year Warranty" are templates —
  // they need the reviewer to fill in before a library search makes sense.
  return /\[[^\]]+\]/.test(query);
}

// --- Search ------------------------------------------------------------------

function searchLibrary(library, query, options = {}) {
  const maxResults = options.maxResults ?? 5;

  if (!query || query.trim() === '') {
    return { query, matches: [], topMatch: null, confidence: 'no_match', reason: 'empty query' };
  }
  if (hasPlaceholder(query)) {
    return {
      query,
      matches: [],
      topMatch: null,
      confidence: 'no_match',
      reason: 'query contains placeholder — reviewer must resolve before mapping',
    };
  }

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return { query, matches: [], topMatch: null, confidence: 'no_match', reason: 'no searchable tokens in query' };
  }

  const scored = [];
  for (const file of library.files) {
    let score = f1Score(queryTokens, file.tokens, file.tokenCount);
    if (score === 0) continue;
    if (file.isArchived) score -= 0.2;
    if (score <= 0) continue;
    scored.push({
      fileRef: file.fileRef,
      displayPath: file.displayPath,
      score: Number(score.toFixed(4)),
      isArchived: file.isArchived,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  const matches = scored.slice(0, maxResults);
  const topMatch = matches[0] || null;
  const confidence = topMatch ? bucketConfidence(topMatch.score) : 'no_match';

  return { query, matches, topMatch, confidence };
}

// --- Resolving references to real filesystem paths ---------------------------

function resolveLibraryFile(fileRef, libraryRoot) {
  if (!fileRef || typeof fileRef !== 'string' || !fileRef.startsWith(FILE_REF_PREFIX)) {
    throw new Error(`Unknown file reference scheme: ${fileRef}`);
  }
  // Convert the forward-slash-normalized ref back to a platform-native path.
  return path.join(libraryRoot, fileRef.slice(FILE_REF_PREFIX.length));
}

module.exports = { loadLibrary, searchLibrary, resolveLibraryFile, tokenize };
