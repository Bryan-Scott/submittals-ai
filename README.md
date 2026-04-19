# Submittals AI

A tool that drafts construction submittal outlines from project specification PDFs and compiles the supporting product data into a single deliverable PDF package.

Built first for Texas Roofing Co (TRC), designed from day one to be multi-tenant so it can serve other subcontractors later.

---

## The Problem

Every roofing job starts with a Letter of Intent (LOI), moves through a stack of spec sections, and ends with a **submittal package** — a PDF assembly of product data sheets, warranties, certification letters, and accessory specs that the General Contractor and Architect must approve before construction begins.

Today this is manual. A Preconstruction Coordinator takes 2–3 weeks to compile one package. Training a new coordinator takes 6–12 months before they can draft one the Preconstruction Manager can sign off on with only minor corrections.

Prior attempts to solve this with AI failed for a consistent reason: they asked the language model to author the whole submittal. Submittals are mostly structured lookups with small amounts of generated text — so when the LLM had to invent ASTM numbers, spec references, and product names, it produced plausible-looking but unreliable output. A different architecture is required.

---

## What This Is

An **orchestration tool**, not an author. The LLM is used only for extraction and classification from unstructured spec PDFs. Everything else is deterministic:

- **Rules** live in markdown files that the tool reads at runtime.
- **Products** are looked up from a curated library of existing PDFs (the MSDS Library).
- **Outputs** are draft markdown outlines (for review) and compiled PDF packages (for delivery).
- **Corrections** applied by a reviewer flow back into the rules files, making the tool sharper with every project.

The moat is the rules and the feedback loop. The LLM is the smallest component.

---

## Architecture Principles

These shape every decision from here forward. Changing one of these should be a conscious call, not a drift.

1. **Every core operation is a standalone callable tool.** `parse_spec`, `generate_outline`, `search_library`, `compile_pdf`, `apply_correction`. Each takes a workspace path plus inputs and returns outputs. CLI, web UI, and AI agents all call the same functions. Adding a new frontend never means rewriting the backend.

2. **Workspace is configuration, never hardcoded.** The tool accepts a workspace path. Multi-tenant is built in from day one, not retrofitted later.

3. **Rules live in markdown, not code.** `Standard-Submittal-Items.md` and `Manufacturer-Preferences.md` are the source of truth. Corrections rewrite those files. The code stays small; the rules grow.

4. **Markdown is the interchange format** for drafts. Diffable in git, viewable in any editor, parseable by anything. The browser UI, when it arrives, is just a nicer renderer — not a new data format.

5. **No database until we need one.** Files on disk, human-readable, portable. A workspace can be zipped up and moved.

6. **Versioned outputs.** Every generated draft gets a version number and timestamp. New versions never overwrite old ones, so "what changed" is always answerable.

---

## Where Things Live

Code and data are deliberately separated. The tool reads from an operational workspace (owned by the customer) and writes outputs into its own repo folder (owned by the developer).

### Operational data — lives in the workspace (read mostly, written only on corrections)
- `C:\Users\Bryan\Documents\claude workspace\MSDS Library\` — product PDF library (~6,768 files)
- `C:\Users\Bryan\Documents\claude workspace\Reference\` — rules files:
  - `Standard-Submittal-Items.md` — the per-section item rules
  - `Manufacturer-Preferences.md` — substitution and preferred-manufacturer logic

### Code and outputs — live in this repo
- `src/` — tool source code
- `Projects/{JobNumber}/` — per-job outputs: input spec copy, draft outlines (versioned), compiled PDF packages, correction history
- `config.json` — which workspace paths to use (gitignored, per-machine)
- `.env` — API key (gitignored, never committed)
- `docs/` — reference docs for developers and reviewers

### Why this split matters
Operational data belongs to the customer and must not be corrupted by code changes. The code is a sandboxed program that reads inputs and writes outputs. If the tool's source is deleted tomorrow, the workspace is untouched.

---

## Build Roadmap

Each phase ships a working tool. We can stop at any phase and still have something useful.

### v0.1 — Outline Generator CLI
Given a spec PDF and a job number, produce a draft markdown outline at `Projects/{JobNumber}/submittal-outline-draft-v01.md`.

**Accuracy gates before moving to v0.2**, measured across 3–5 past TRC projects where the correct answer is known:
- **100%** on "always" items (TRC Workmanship Warranty as #1, ES1 cert in 076200, WIP 300HT under sheet metal, etc.) — these are pure rules; missing one means the rules engine is broken.
- **≥90%** on primary products per section (main membrane, main fasteners, main insulation) — the spec-derived items where extraction is doing real work.
- **≥75%** on accessory items (specific sealant tapes, specific rivet types) — these vary most per project and are where the feedback loop learns fastest.

### v0.2 — PDF Compiler CLI
Given an approved outline, read the list of required files from the MSDS Library, compile them in the documented order, produce `Projects/{JobNumber}/submittal-package-{spec}.pdf`.

### v0.3 — Local Web UI
A browser wrapper around v0.1 and v0.2. Runs on the local machine. Renders the markdown draft in-browser for review and correction. No workspace management yet — still reads and writes files on disk.

### v1 — Workspace Manager
The Obsidian replacement. Full browser-based workspace: project navigation, rule-file editing, cross-project search, correction history, PDF preview. Built only after v0.3 has been used on 2–3 live jobs and the core generator is trustworthy.

---

## Tech Stack

Chosen for simplicity and minimum learning surface area. Every addition requires a clear reason.

- **Node.js** (LTS) — the runtime. JavaScript outside the browser. One language for backend and eventual frontend.
- **`@anthropic-ai/sdk`** — official Claude SDK. Used for extraction and classification from spec PDFs.
- **`pdf-lib`** — PDF merging (added in v0.2).

Everything else uses built-in Node modules: filesystem, HTTP server, JSON parsing, command-line arguments, test runner.

### Deliberately not using
React, Vue, Svelte, TypeScript, Webpack, Vite, Express, Tailwind, any database. Each of these adds learning surface area without enabling anything we need yet. Reasons for these choices live in individual discussion — they are not random preferences.

---

## Setup

*(This section fills in as the tool develops. Keep it accurate as steps are added.)*

### First-time setup
1. Install **Node.js LTS** from [nodejs.org](https://nodejs.org).
2. Install **git** (probably already installed on your system).
3. Get a **Claude API key** from [console.anthropic.com](https://console.anthropic.com). You'll need to create an account and add a payment method — the API is pay-as-you-go, not a subscription.
4. Clone this repo.
5. Copy `.env.example` to `.env` and paste your API key.
6. Copy `config.example.json` to `config.json` and set `workspacePath` to your operational workspace folder (e.g. `C:\Users\Bryan\Documents\claude workspace`).
7. Run `npm install` to install dependencies.
8. Run `node src/cli.js --help` to verify it works.

---

## How Corrections Become Training Data

This is the loop that solves the accuracy problem over time.

1. The tool generates a draft for a new project.
2. A reviewer (today: Bryan; tomorrow: a Preconstruction Coordinator with Bryan approving) corrects the draft.
3. Corrections are captured as diffs against the original.
4. When a correction matches a pattern seen in prior corrections, the tool proposes an update to the relevant rules file.
5. The reviewer approves or rejects the proposed rule update.
6. Future drafts use the updated rules.

The tool gets sharper without code changes. The rules grow; the code stays small. This is the commercial moat — the longer a customer uses the tool, the more their rules reflect their specific expertise, and the harder that is for a competitor to replicate.

---

## Open Questions

Intentionally open — will be resolved when needed, not speculatively:

- Exact folder structure inside `Projects/{JobNumber}/` (inputs, drafts, outputs, review history)
- Format for correction diffs and the rule-update proposal flow
- How far to trust LLM classification before a human review step is required
- Where the tool runs when it's no longer local (Bryan's laptop vs a server — this is a v1+ question)

---

## For Future Claude Code Sessions

If you're an AI agent reading this to orient on the project:
- The memory files at `C:\Users\Bryan\.claude\projects\c--Users-Bryan-projects-submittals-ai\memory\` capture earlier decisions and context.
- The three reference docs in `Documents\claude workspace\Reference\` (`Standard-Submittal-Items.md`, `Manufacturer-Preferences.md`, `Submittal Outline - Master Analysis.md`) are authoritative domain knowledge — read them before proposing changes that touch rules or output format.
- Bryan's global CLAUDE.md (at `C:\Users\Bryan\.claude\CLAUDE.md`) documents his coding preferences and learning goals. Respect them.
