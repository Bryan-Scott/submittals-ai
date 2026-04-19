# Submittals AI — Roadmap

This file is the **bridge between sessions**. It records what's built, what's next, and every locked design decision with its reasoning. If a new Claude Code session opens tomorrow, reading this file plus `README.md` + `MEMORY.md` should be enough to pick up without re-deriving decisions.

**Update discipline:**
- Tick a checkbox the moment a task is actually done (not "done-ish").
- When a design decision changes, edit the relevant entry in §4 and note the change in §6.
- Append a short note to §6 at the end of each working session.

---

## 1. Current state

**Last updated:** 2026-04-19

**Built:**
- Repo scaffolded at `c:\Users\Bryan\projects\submittals-ai`
- `README.md`, `ROADMAP.md`, `.env.example`, `config.example.json`, `.gitignore`
- Git initialized, pushed to private `github.com/Bryan-Scott/submittals-ai`, `main` branch
- Claude API key saved in `.env` (gitignored)
- `package.json` with `@anthropic-ai/sdk` installed (0 vulnerabilities)
- `config.json` created with Bryan's workspace path (gitignored)
- `src/config.js` — loads `.env` + `config.json`, validates required fields, exports `loadConfig()`
- `src/cli.js` — CLI entry point with `generate-outline` plumbing, input validation (path-traversal safe), subcommand dispatch, help text
- End-to-end plumbing verified: `Projects/TEST-PLUMBING/` was created, spec PDF copied to `inputs/075423-spec.pdf`, log entry written
- Memory files under `C:\Users\Bryan\.claude\projects\c--Users-Bryan-projects-submittals-ai\memory\`

**Not yet built:**
- No reconcile command
- No substitution logic or Manufacturer-Preferences.md integration
- Library search has known tuning levers deferred (manufacturer-weighted boost, wider archive penalty, filename > folder weight)
- No accuracy-gate testing across multiple past TRC projects yet

**Immediate next step:**
Build the `reconcile` command (ROADMAP §4.10). This is the highest priority of the four-item plan Bryan approved after reviewing the first draft. Without reconcile, corrections to the draft don't flow back into the companion JSON, which means the learning loop is broken — the very failure mode this tool's architecture exists to prevent.

**Planned work queue (in order):**
1. **Reconcile command** — handle the five sync failure modes (text-wrong + file-wrong, text-right + file-wrong, extra item, missing item, reorder). v0.1's flow is the terminal `reconcile --job ... --section ...` command that diffs the edited markdown vs the original, re-runs library search for changed items, and prompts in the terminal for ambiguous mappings.
2. **Accuracy-gate testing** across 3–5 past TRC projects Bryan has completed manually. Compare tool output vs. known-correct submittal. Measure hit rates in three buckets per §2 gates: 100% always-items, ≥90% primary products, ≥75% accessories. This is the promotion gate from v0.1 → v0.2.
3. **Polish draft rendering** — collapse Needs-review boilerplate when many items share the "no confident library match" message; request parse_spec to keep product names short (detail → `note` field); clean rule-item parenthetical guidance like "(or Sample McElroy if McElroy project)" out of displayed names.
4. **Tune library search** — apply the three deferred levers (manufacturer-weighted boost, wider archive patterns, filename > folder weight). Re-run searches on the same sections to measure lift.

---

## 2. Build phases

Each phase ships a working tool. We can stop at any phase and still have something useful.

### v0.1 — Outline Generator CLI

Goal: given a spec section PDF + job number + section number, produce a draft markdown outline + companion JSON.

- [x] `npm init -y` and commit `package.json`
- [x] Install `@anthropic-ai/sdk`
- [x] Create `src/config.js` — loads `config.json` + `.env`, validates required fields
- [x] Create `src/cli.js` — arg parsing, subcommand dispatch
- [x] Implement `generate-outline` plumbing (no AI yet): validate args, create `Projects/{JobNumber}/inputs/` and `drafts/`, copy spec PDF in, write `log.md` entry
- [x] Implement `src/tools/parse_spec.js` — sends PDF to Claude via SDK document API, extracts section number + product candidates with spec refs
- [x] Implement `src/rules.js` — reads `Standard-Submittal-Items.md` from workspace, applies per-section rules (e.g., TRC Warranty always #1, ES1 in 076200, WIP 300HT under sheet metal)
- [x] Implement `src/tools/search_library.js` — matches product candidates to MSDS Library files (MVP: token-overlap F1 scoring, archive penalty; known tuning levers deferred); returns opaque refs
- [x] Implement `src/draft_writer.js` — composes markdown in the locked format, generates line hashes, writes companion JSON
- [ ] Implement `reconcile` subcommand — handles the five sync failure modes
- [ ] Test on 3–5 past TRC projects; measure against accuracy gates

**Accuracy gates for v0.1 → v0.2:**
- **100%** on "always" items (TRC Warranty #1, ES1 in 076200, WIP 300HT under sheet metal, etc.) — pure rules
- **≥90%** on primary products per section (main membrane, main fasteners, main insulation) — spec-derived extraction
- **≥75%** on accessory items (specific sealant tapes, specific rivets) — where the feedback loop learns fastest

### v0.2 — PDF Compiler CLI

Goal: given an approved draft + companion JSON, pull the mapped library PDFs and produce the deliverable.

- [ ] Install `pdf-lib`
- [ ] Implement `src/tools/compile_pdf.js` — reads companion JSON, pulls files in order, merges
- [ ] Implement `compile-package` subcommand
- [ ] Handle missing-file errors with clear reporting
- [ ] Verify output opens cleanly in Adobe / browser / Bluebeam

### v0.3 — Local Web UI

Goal: browser wrapper around v0.1 and v0.2, running on Bryan's machine. No workspace management yet — still reads/writes files on disk.

- [ ] Local HTTP server (Node built-in `http` module, no Express)
- [ ] Render draft markdown in browser with section collapsing
- [ ] Click-to-preview mapped PDFs via served local file route
- [ ] Library picker UI for correcting mappings
- [ ] Inline edit mode for draft items
- [ ] Auto-`reconcile` on save

### v1 — Workspace Manager

Goal: Obsidian replacement. Full browser-based workspace — project navigation, rule-file editing, cross-project search, correction history, PDF preview. Built only after v0.3 has been used on 2–3 live jobs.

- [ ] TBD — detail after v0.3 use reveals real needs

---

## 3. Accuracy gate measurement method

To be defined before v0.1 testing. Placeholder approach: pick 3–5 past TRC projects with known-correct outlines. Run v0.1 on each spec section; diff output against the known-correct. Categorize misses as always-item / primary / accessory. Compute percentages.

---

## 4. Locked design decisions

Each entry: **what** + **why**. Never delete entries — if a decision changes, update it and note the date + new rationale.

### 4.1 Code / data split
**What:** Code lives in `c:\Users\Bryan\projects\submittals-ai`. Operational data (MSDS Library, Reference rules files) lives in `C:\Users\Bryan\Documents\claude workspace`. `Projects/{JobNumber}/` outputs live in the code repo.
**Why:** Code cannot corrupt operational data. Multi-tenant shape is built in from day one — each customer gets their own workspace; the code is identical.

### 4.2 No database until needed
**What:** Files on disk, human-readable, portable. A workspace can be zipped and moved.
**Why:** Premature database adds learning surface and opacity without enabling anything v0.1 needs.

### 4.3 Rules live in markdown, not code
**What:** `Standard-Submittal-Items.md` and `Manufacturer-Preferences.md` are the source of truth for rules. Code reads them at runtime.
**Why:** Corrections from reviewers should update rules files directly. The code stays small; the rules grow. This is the moat.

### 4.4 Every core operation is a standalone callable tool
**What:** `parse_spec`, `generate_outline`, `search_library`, `compile_pdf`, `apply_correction`. Each takes a workspace path + inputs, returns outputs. CLI, web UI, and AI agents all call the same functions.
**Why:** Adding a new frontend never means rewriting the backend. Also: `search_library`'s implementation can swap from local filesystem to database later without touching callers.

### 4.5 Markdown is the interchange format
**What:** Drafts are markdown. Browser UI renders markdown; no separate data format.
**Why:** Diffable in git, viewable in any editor, parseable by anything.

### 4.6 Versioned outputs
**What:** Every draft gets a version number and timestamp. New versions never overwrite old ones.
**Why:** "What changed" is always answerable. Correction diffs are the training signal.

### 4.7 Draft markdown format (locked)

**What:** Each spec section draft follows this structure:

```markdown
# 25049 — Dripping Springs HS 2
Generated 2026-04-19 · Draft v01 · Spec Rev 2

---

## 075423 — TPO Membrane Roofing

1. TRC Workmanship Warranty  ·  TRC rule  <!-- #a7f3 -->
2. GAF EverGuard TPO 60-mil — Membrane  ·  §2.03.C  <!-- #b2c9 -->
3. GAF Drill-Tec HD Fasteners — Fasteners  ·  §2.03.E  <!-- #c4d1 -->
4. Carlisle WIP 300HT — Self-Adhered Underlayment  ·  TRC rule  <!-- #d8a2 -->

**Needs review**
- Fastener density: spec says "per manufacturer recommendation" — which pattern did you quote?

**Not included**
- Vapor barrier — *excluded per §2.4.B*
- Roof coping primer — *coping by GC per §076200.2.6; not in TRC scope*
```

Format rules:
- `H1` = project name, one line below it is metadata (generated date, draft version, spec rev)
- `H2` = spec section number + title
- Numbered list = items in submittal order
- Every item line: `{product} — {role}  ·  {citation}  <!-- #hash -->`
- Citation: `§X.XX.X` for spec-derived, `TRC rule` for rule-derived
- `**Needs review**` block — only present when non-empty
- `**Not included**` block — italicized reason, prose-grade ("reads cleanly to an architect with no follow-up channel")

**Why:**
- Per-line spec citation is essential for human review — without it, verifying every product against the spec is the bottleneck we're trying to eliminate
- HTML comments for hashes render invisibly; survive text edits and reorders
- `Not included` items are a **written position to the architect** (see memory: `project_communication_barrier.md`) — silent omissions trigger revise-and-resubmit cycles

### 4.8 Line hash convention
**What:** Each item gets a 4-char hex hash in an HTML comment (`<!-- #a7f3 -->`). Hash is stable — assigned when the line is created, never changes for text edits or reorders. Hash is draft-scoped (not global).
**Why:** The hash is a join key between the draft line and the companion JSON. Stable keys mean reorders are free and text edits don't orphan mappings. Regenerating a draft creates new hashes (per-version independence).

### 4.9 Companion JSON schema
**What:** Each draft has a sibling JSON file: `outline-{section}-v{NN}.mappings.json`. Keys are line hashes; values are opaque references.

```json
{
  "section": "075423",
  "generatedAt": "2026-04-19T14:23:00Z",
  "items": {
    "a7f3": {
      "productRef": "rule:trc-warranty",
      "file": null,
      "source": "rule"
    },
    "b2c9": {
      "productRef": "pds_gaf_everguard_60mil_v2",
      "file": "msds/gaf/everguard-tpo-60mil.pdf",
      "source": "spec",
      "confidence": "high",
      "mappingReason": "exact product name match"
    }
  }
}
```

**Why:**
- Companion value is an **opaque reference** — code that touches it must go through `search_library` / `resolve_library_file`, never read raw paths. Future DB-backed library swaps without breaking anything.
- Per-version companion files (not shared across v01/v02) keep versions independent.

### 4.10 Reconcile sync model
**What:** `reconcile` is the v0.1 mechanism for keeping draft and companion in sync after reviewer edits. It handles five failure modes:

| # | Mode | Reviewer action | Companion update |
|---|---|---|---|
| 1 | Text wrong + file wrong | Edit draft text | Auto re-search library, re-map |
| 2 | Text right + file wrong | Open library picker (v0.3) or manual edit (v0.1) | Update mapping only |
| 3 | Extra item | Delete line in draft | Remove entry by hash |
| 4 | Missing item | Add line in draft (no hash) | Auto-search, propose mapping, reviewer confirms, assign new hash |
| 5 | Reorder | Move line in draft | No change — mappings track hash, not position |

**Why:** Text edits and mapping corrections are *different operations* on *different data* — a reviewer can get the text right but the file wrong, or vice versa. Conflating them into one "correction" flow loses that distinction.

### 4.11 Folder layout inside `Projects/{JobNumber}/`
**What:**
```
Projects/25049 - Dripping Springs HS 2/
  inputs/
    project-info.json
    075423-spec.pdf
    076200-spec.pdf
  drafts/
    outline-075423-v01.md
    outline-075423-v01.mappings.json
    outline-076200-v01.md
    outline-076200-v01.mappings.json
  deliverables/                       (v0.2+)
    submittal-package-075423-v01.pdf
  log.md
```
**Why:** One draft per spec section (see §4.14). `log.md` is append-only — every `generate-outline` and `reconcile` run writes a line. Separate folders prevent mixing inputs/drafts/deliverables and keep the workspace clean when a job has many sections.

### 4.12 CLI command shape
**What:**
```
node src/cli.js generate-outline --job "25049 - Dripping Springs HS 2" --spec path/to/075423.pdf --section 075423
node src/cli.js reconcile        --job "25049 - Dripping Springs HS 2" --section 075423
node src/cli.js compile-package  --job "..." --section 075423    (v0.2+)
```
**Why:** Subcommand-style is predictable and extensible. Explicit `--section` flag lets the tool verify the supplied PDF matches the claimed section (catches wrong file uploads).

### 4.13 PDF handling — Claude SDK document input
**What:** PDFs are sent to Claude directly via the SDK's document input feature. No local text extraction with `pdf-parse` or similar.
**Why:** Accuracy is the whole product — if PDF handling is lossy, the LLM is making decisions on incomplete input and the tool becomes useless. SDK direct preserves layout, images, tables, and scanned content. Higher token cost is the right tradeoff.

### 4.14 Per-section spec input
**What:** The tool requires *one spec section per PDF file*, not a giant multi-section spec package. Explicit `--section` flag verifies the claim.
**Why:** Token efficiency (specs can be 2000+ pages) and accuracy (scoped input means scoped reasoning). Users extract the relevant section from their full spec before supplying it.

### 4.15a Acceptable-manufacturer lists are a top-level field, not products
**What:** When a spec lists acceptable manufacturers for the system (typically in §2.01 "Acceptable Manufacturers"), they are captured in a top-level `acceptable_system_manufacturers: string[]` field in the parse_spec output, NOT as entries in `products[]`.
**Why:** These are system-level substitution policy, not products in their own right. Downstream, the rules engine + Manufacturer-Preferences.md uses this list to decide whether TRC can submit its preferred manufacturer's equivalent rather than the spec's basis-of-design product. Putting them in `products[]` muddied both semantics and downstream processing.

### 4.16 Default model: Sonnet 4.6, no batching
**What:** `parse_spec` (and future AI tools) default to `claude-sonnet-4-6`. Batch API not used — real-time processing required. `parseSpec({ model })` stays overridable so future testing is cheap.
**Why:** Head-to-head test on Pflugerville §075423 TPO showed Haiku 4.5 missed an architect-facing exclusion ("do not install walkway pads within 10 feet of any roof edge", §3.08.A.2) that Sonnet caught. Haiku also missed medium-confidence gap items (seam plates, curb/parapet flashing described by material only) and a drafting-gap ambiguity (cover board thickness). Missing exclusions directly triggers the revise-and-resubmit cycle this tool exists to prevent (see `project_communication_barrier.md`). $0.09/section savings is not worth that failure mode. Overnight batch processing doesn't fit the TRC workflow, so the batch-API 50% discount isn't available.
**How to apply:** `DEFAULT_MODEL = 'claude-sonnet-4-6'` in `parse_spec.js`. Re-test on additional spec sections during accuracy-gate testing. If Haiku misses prove isolated to this one spec across 3–5 sections, revisit.

### 4.15 `Not included` items are a written position, not debug output
**What:** Every `Not included` entry has a prose-grade reason in italics, sourced from (a) tool auto-detection of spec-explicit exclusions, (b) reviewer-added out-of-scope calls, or (c) reviewer-added constructability exceptions.
**Why:** See `project_communication_barrier.md`. Subcontractors cannot phone the architect — the submittal document *is* the written channel. Silent omissions trigger revise-and-resubmit cycles that cost weeks.

---

## 5. Open questions

Deferred, not dropped. Resolve when the corresponding phase arrives.

- **Correction → rules update proposal flow:** After enough corrections accumulate, the tool should propose patches to `Standard-Submittal-Items.md`. Format of proposals, approval flow, and "when to trigger" heuristic all TBD. Not needed for v0.1; revisit end of v0.1 / start of v0.3.
- **Browser UI framework (v0.3):** Default is vanilla JS + HTML + CSS per Bryan's global CLAUDE.md. Confirm before starting v0.3.
- **Accuracy gate measurement:** §3 is a placeholder. Need a real method before testing v0.1 output.
- **Library DB migration:** Current library is a filesystem full of PDFs. When it grows or goes multi-tenant, this becomes a DB. `search_library` abstraction (§4.4) protects callers, but the DB design itself is TBD.
<!-- moved to the planned work queue in §1 — was "library search tuning levers" —
     keeping the specifics here for reference when we get to it:
     (1) manufacturer-weighted boost via alias map (PAC-CLAD → PAC-CLAD, Texas Roofing → TRC,
         Carlisle → CarlisleSyntech/Carlisle) — +0.15 on matching top folder, −0.15 on mismatch;
     (2) widened archive penalty — catch `x-` prefix filenames and dedicated `SDS/` folders;
     (3) filename tokens weighted ~2× folder tokens.
-->
- **Reconcile command details.** Open sub-questions when we build it: (a) interactive terminal prompt vs. proposal file the user approves offline, (b) how to handle newly-added draft lines with no hash (auto-assign on save? on reconcile?), (c) strategy when re-searching a changed text item returns multiple plausible matches — pick top and flag, or prompt every time.
- **Hosting model for v1:** Bryan's laptop vs. server vs. hosted SaaS. Post-v0.3 question.
- **Correction-as-training-data structure:** What metadata accompanies a correction (who, when, why) when it's a candidate for rule update? TBD at v0.3.

---

## 6. Session notes

Append-only short log of what happened each session. One or two lines max per entry.

### 2026-04-19 — Architecture, format design, scaffolding
- Diagnosed prior failures as LLM-as-author mismatch; committed to LLM-as-orchestrator pattern
- Locked six architecture principles and the v0.1 → v1 phase plan
- Set up repo, pushed to private GitHub, installed Claude API key
- Locked draft markdown format, line-hash convention, companion JSON schema, reconcile sync model, folder layout, CLI shape, PDF handling, per-section input model
- Saved memory on communication barrier between sub and architect — shapes every formatting decision
- Created this `ROADMAP.md` to bridge sessions
- Established that Claude keeps `ROADMAP.md` current automatically as work progresses (saved as feedback memory `feedback_roadmap_maintenance.md`)
- Built v0.1 foundation: `package.json`, SDK installed, `src/config.js`, `src/cli.js`, `config.json`. End-to-end plumbing verified by creating `Projects/TEST-PLUMBING/` with a copied spec and log entry. No AI calls yet — that's the next step.
- Designed `parse_spec` prompt (system prompt with 8 core rules, forced tool_use with strict schema, temperature 0, Sonnet 4.6). Locked tool schema: products (with name, role, citation, or_approved_equal, named_alternates, confidence, note), exclusions (with description/citation/reason), ambiguities (same shape).
- Built and tested `src/tools/parse_spec.js`. First real API call against Pflugerville §075423 TPO Roofing spec: 29,282 input / 3,075 output tokens (~$0.13), extracted 18 products, 3 exclusions, 9 ambiguities. Saved to `drafts/parse-075423-v01.json`. Output quality is strong — good product citations, architect-facing exclusions captured, ambiguities flagged correctly. One design question surfaced about handling acceptable-manufacturer lists — resolved as decision 4.15a.
- Locked decision 4.15a: acceptable-manufacturer lists captured in new top-level `acceptable_system_manufacturers` field, not as pseudo-product entries. Schema and prompt updated.
- Cost analysis: $0.13/section on Sonnet 4.6. Input tokens dominate (PDF size). Haiku 4.5 would drop to ~$0.04/section. Scaling math pencils out on either — $1,300/mo vs $440/mo at 100 customers × 20 submittals × 5 sections.
- Head-to-head Sonnet vs Haiku test (`scripts/compare_models.js`): both extracted same core 15 products, but Haiku missed the §3.08.A.2 walkway pad safety exclusion (architect-facing) plus drafting-gap ambiguities. Locked decision 4.16: stay on Sonnet 4.6, no batching (overnight workflow doesn't fit). Model parameter remains overridable for future testing.
- Built `src/rules.js` — deterministic parser for `Standard-Submittal-Items.md`. Parsed 20 section IDs (handles multi-ID headers like "074110 / 074113", handles dotted IDs like "074213.13", handles sections with and without explicit `**Numbered items:**` labels). Hardcoded the TRC Warranty universal rule for v0.1 (documented in code, lifts to markdown-driven in v0.2).
- `applyRules` merges rule items + spec products in stable order: universal warranty → section-specific rule items (dedup skip on TRC warranty duplicates) → spec products → unnumbered rule items. Overlap between rule items and spec items is intentionally left for the reviewer to resolve — visibility over automation at this stage.
- Wired into generate-outline; full pipeline now: inputs → parse → rules → requirements.json. Tested end-to-end on Pflugerville §076200 Sheet Metal (16 rule items + 12 spec products = 28 total, $0.067 parse cost). Claude caught an ASTM typo in the spec (§2.04.C "D4479/D4497M" should be "D4479/D4479M") — surfaced as an ambiguity for reviewer.
- Added `scripts/test_rules.js` for no-cost validation of rules parsing during development.
- Built `src/tools/search_library.js` — deterministic token-overlap F1 scoring against the full MSDS Library (6,524 PDFs, indexed in ~100ms). Returns top-N matches with `high/medium/low/no_match` confidence buckets. Opaque file references use `msds:` scheme prefix (callers always go through `resolveLibraryFile`, never parse the ref).
- Tested search in isolation via `scripts/test_search.js` against the Pflugerville §076200 requirements. Results: 1 high / 14 medium / 13 low / 0 no_match. Strengths: correct matches on TRC Warranty, UL Fabricator Letter, ITW Buildex Tapper, Blazer EPDM, Maze Nails, Harris Solder, Stay-Clean Flux. Failure modes identified: (a) generic word soup letting wrong manufacturer outscore right one (N1: Morin warranty beat PAC-CLAD warranty), (b) SDS vs PDS confusion (N15 ChemLink returned an SDS), (c) archived `x-` prefix files leaking past penalty (N16), (d) MEDIUM bucket mixing right and wrong.
- Decision: **ship MVP search, tune after draft writer exists.** Three known levers banked for later — manufacturer-weighted boost, wider archive patterns, filename > folder token weight. The reviewer verifies mappings in the draft; tuning an invisible artifact before that UX is visible is premature optimization.
- Built `src/draft_writer.js` — composes the locked markdown format (§4.7) + companion JSON (§4.9). Generates stable 4-char hex line hashes via `crypto.randomBytes` stored in HTML comments (§4.8). Auto-increments version number (§4.6). Tested via `scripts/test_draft.js` against the Pflugerville §076200 requirements — produced a clean 28-item numbered list + 17 needs-review entries + 0 not-included (matches input). Confirmed: TRC Warranty is #1 with "Warranty" role; PAC-CLAD template items 2–17 appear in rule order; spec-derived items 18–28 follow with §X.XX.X citations and roles; ambiguities including the ASTM typo surface as needs-review.
- Fixed one rendering bug in first pass: quote-stripping on ambiguity reasons was producing orphaned closing quotes for multi-clause reasons ("quoted spec" — Claude commentary). Now renders raw — both quote marks preserved and paired.
- **v0.1 core pipeline is complete end-to-end on one section.** Five stages work: inputs → parse → rules → search → draft. Remaining v0.1 work: reconcile command, accuracy-gate testing across 3–5 past TRC projects.
- Pause at end of session. Bryan reviewed first real draft output (`Projects/TEST-SMFT-RULES/drafts/outline-076200-v01.md`) and approved the four-item plan: (1) reconcile, (2) accuracy-gate testing, (3) polish draft rendering (Needs-review noise + long names + rule parenthetical guidance), (4) library search tuning levers. Work queue locked in §1 of this file.

---
