// parseSpec — first real AI call in the pipeline.
//
// Takes a single spec section PDF and returns a structured extraction:
// section header, named products with citations, explicit exclusions,
// and flagged ambiguities. Nothing is decided here — this is pure
// spec-to-data (no TRC rules, no library matching, no preferences).
//
// Design decisions live in ROADMAP.md §4.13 (PDF via SDK document input),
// §4.14 (per-section input), and §4.4 (standalone callable tool).

const fs = require('node:fs');
const { Anthropic } = require('@anthropic-ai/sdk');

// Sonnet 4.6 — capable enough for structured extraction, much cheaper/faster
// than Opus. Revisit if accuracy-gate testing shows we need more.
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4096;

const SYSTEM_PROMPT = `You are extracting structured product information from a single section of a construction specification document. Your output feeds a deterministic pipeline that matches each product to a data sheet in a curated library. Accuracy and precision matter more than completeness — when in doubt, omit or flag rather than guess.

Core rules:
1. Only extract NAMED products and materials. Do not extract generic terms ("fasteners" alone), execution steps, quality assurance requirements, or warranty language unless a specific product is named.
2. Cite every product by its paragraph reference (e.g., "§2.03.C"). If you cannot locate a citation, do not extract the item.
3. Prefer Part 2 (Products) citations over Part 3 (Execution). If a product is only mentioned in Part 3, still cite it but lower the confidence.
4. Never invent ASTM numbers, product codes, model numbers, or manufacturer names. If the spec does not state it, do not emit it.
5. Flag ambiguity. If the spec says "per manufacturer recommendation", "as selected by architect", "or approved equal" without a basis of design, or similar deferring language, add an entry to ambiguities with the exact citation.
6. Capture explicit exclusions. If the spec states something is NOT required or NOT included (e.g., "no vapor barrier per 2.4.B"), add it to exclusions with the citation.
7. Do not apply any external rules (TRC preferences, standard warranty items, etc.). Those are applied downstream. Extract only what this spec section says.
8. Infer product role (Membrane, Fastener, Cover Board, etc.) when clear from context. If unclear, leave role null rather than guess.
9. Acceptable-manufacturer lists are NOT products. When the spec lists acceptable manufacturers for the whole system (e.g., "Acceptable Manufacturers: Carlisle Roofing Systems, GAF, GenFlex"), these are substitution policy for the system, not products in their own right. Put them in the top-level acceptable_system_manufacturers field. Do NOT create a product entry for each listed manufacturer.

Call record_section_parse exactly once with your extraction. Do not narrate.`;

const USER_MESSAGE = `Please extract the structured product information from the attached spec section PDF. Call record_section_parse with:
- The section number and title as stated in the section header
- All named products, primarily from Part 2 (Products), with spec citations
- Any acceptable system manufacturers listed as substitution options (NOT as products)
- Any explicit exclusions the spec calls out
- Any ambiguities a reviewer should resolve`;

// Tool schema — Claude is forced to call this via tool_choice below.
// The input_schema is the contract for what the pipeline gets back.
const TOOL_DEFINITION = {
  name: 'record_section_parse',
  description: 'Record the structured extraction from the spec section.',
  input_schema: {
    type: 'object',
    properties: {
      section_number: {
        type: 'string',
        description: 'The CSI section number as stated in the section header (e.g., "075423").',
      },
      section_title: {
        type: 'string',
        description: 'The section title as stated in the section header (e.g., "TPO Membrane Roofing").',
      },
      acceptable_system_manufacturers: {
        type: 'array',
        items: { type: 'string' },
        description: 'Manufacturer names listed as acceptable for the overall system (typically in §2.01 "Acceptable Manufacturers"). These are substitution policy for the whole system, NOT individual products. Empty array if none listed.',
      },
      products: {
        type: 'array',
        description: 'All named products and materials extracted from this section, with citations.',
        items: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'The product name as stated in the spec (e.g., "GAF EverGuard TPO 60-mil").',
            },
            role: {
              type: ['string', 'null'],
              description: 'The role of this product in the assembly (e.g., "Membrane", "Fastener", "Cover Board"). Null if unclear — do not guess.',
            },
            citation: {
              type: 'string',
              description: 'The paragraph citation in the spec (e.g., "§2.03.C").',
            },
            or_approved_equal: {
              type: 'boolean',
              description: 'True if the spec allows "or approved equal" or similar substitution language for this product.',
            },
            named_alternates: {
              type: 'array',
              items: { type: 'string' },
              description: 'Other specifically-named products accepted as alternates by the spec. Empty array if none.',
            },
            confidence: {
              type: 'string',
              enum: ['high', 'medium', 'low'],
              description: 'high = clear citation in Part 2, product fully named. medium = cited but some ambiguity. low = inferred or only mentioned in Part 3.',
            },
            note: {
              type: ['string', 'null'],
              description: 'Optional note — e.g., "only mentioned in Part 3" or "manufacturer name missing". Null if none.',
            },
          },
          required: ['name', 'citation', 'or_approved_equal', 'named_alternates', 'confidence'],
        },
      },
      exclusions: {
        type: 'array',
        description: 'Items the spec explicitly states are NOT required or NOT included.',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string', description: 'What is excluded (e.g., "Vapor barrier").' },
            citation: { type: 'string', description: 'Spec paragraph citation for the exclusion.' },
            reason: { type: 'string', description: 'Quote or paraphrase of the spec language establishing the exclusion.' },
          },
          required: ['description', 'citation', 'reason'],
        },
      },
      ambiguities: {
        type: 'array',
        description: 'Items where the spec defers or is unclear — reviewer must resolve.',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string', description: 'What is ambiguous (e.g., "Fastener density").' },
            citation: { type: 'string', description: 'Spec paragraph citation.' },
            reason: { type: 'string', description: 'The specific deferring or ambiguous language.' },
          },
          required: ['description', 'citation', 'reason'],
        },
      },
    },
    required: ['section_number', 'section_title', 'acceptable_system_manufacturers', 'products', 'exclusions', 'ambiguities'],
  },
};

async function parseSpec({ pdfPath, apiKey, model }) {
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`Spec PDF not found: ${pdfPath}`);
  }

  const modelId = model || DEFAULT_MODEL;

  // Claude's PDF document input expects base64 (data URL alternative).
  // Node's Buffer handles binary → base64 conversion natively.
  const pdfBase64 = fs.readFileSync(pdfPath).toString('base64');

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: modelId,
    max_tokens: MAX_TOKENS,
    temperature: 0,
    system: SYSTEM_PROMPT,
    tools: [TOOL_DEFINITION],
    // tool_choice with type: 'tool' forces Claude to call exactly this tool.
    // Without this, Claude might answer in prose. With it, we always get structured output.
    tool_choice: { type: 'tool', name: 'record_section_parse' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdfBase64,
            },
          },
          { type: 'text', text: USER_MESSAGE },
        ],
      },
    ],
  });

  // The response content is an array of blocks. With forced tool_choice,
  // there should be exactly one tool_use block containing the input we want.
  const toolUse = response.content.find((b) => b.type === 'tool_use');
  if (!toolUse) {
    throw new Error(
      `Claude did not return a tool_use block. stop_reason=${response.stop_reason}. ` +
      `Response: ${JSON.stringify(response.content).slice(0, 500)}`
    );
  }

  return {
    extraction: toolUse.input,
    usage: response.usage,
    model: modelId,
  };
}

module.exports = { parseSpec };
