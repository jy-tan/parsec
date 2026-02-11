/*
 * Intent Classifier
 * A lightweight GPT-5 call (no CFG constraint) that determines
 * whether a user's query can be answered, needs clarification,
 * is impossible given the schema, or is out of scope entirely.
 *
 * Runs BEFORE CFG-constrained SQL generation to provide
 * graceful failure paths instead of forcing bad queries through
 * the grammar.
 */

import OpenAI from "openai";
import {
  getTableSchema,
  buildSchemaSummary,
  KNOWN_EVENT_TYPES,
  KNOWN_ACTION_VALUES,
} from "@/lib/clickhouse/schema";
import type { IntentResult, IntentClassification } from "@/lib/types";

const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-5-mini";

function buildIntentSystemPrompt(schemaSummary: string): string {
  return `You are a query intent classifier for a GitHub events database.

DATABASE SCHEMA:
${schemaSummary}

AVAILABLE EVENT TYPES: ${[...KNOWN_EVENT_TYPES].join(", ")}
AVAILABLE ACTIONS: ${[...KNOWN_ACTION_VALUES].join(", ")}

NOTE: This database contains GitHub event data from a few hours on 2025-11-01. It does NOT contain:
- Star counts (but WatchEvent is GitHub's star event)
- Code content or file contents
- User profiles, emails, or personal data
- Financial, revenue, or billing data
- Repository metadata like language, license, or description

CLASSIFY the user's query into exactly one of:

1. ANSWERABLE - The query can be directly translated to a SQL SELECT against this schema.
   Even if the user uses informal language or slight misspellings/typos, if the intent clearly maps
   to available columns and event types or can be answered by the dataset, classify as ANSWERABLE.

2. AMBIGUOUS - The query could mean multiple things, or is missing key specifics.
   Provide 2-3 clarifying questions or interpretations.
   Example: "top repos by stars" -> ambiguous because we have WatchEvents not star counts.

3. IMPOSSIBLE - The query references data that simply does not exist in this schema.
   Explain what's missing and suggest what CAN be queried instead.
   Example: "show me revenue by quarter" -> no financial data exists.

4. OUT_OF_SCOPE - Not a data query at all (greetings, jokes, general questions, etc).
   Politely redirect to what the system can do.

RESPOND AS JSON with this exact structure:
{
  "classification": "ANSWERABLE" | "AMBIGUOUS" | "IMPOSSIBLE" | "OUT_OF_SCOPE",
  "reasoning": "One sentence explaining why this classification was chosen",
  "clarifications": ["short query 1", "short query 2"],
  "suggestion": ""
}

IMPORTANT RULES FOR clarifications:
- For AMBIGUOUS: provide 2-3 SHORT, specific queries the user can ask instead (e.g. "top 10 repos by WatchEvents", "most active repos by total events")
- For IMPOSSIBLE: provide 2-3 SHORT alternative queries that CAN be answered with this data
- For OUT_OF_SCOPE: provide 2-3 example queries showing what the system can do
- Each clarification must be a CONCISE natural language query (under 15 words), NOT a paragraph of explanation
- These will be shown as clickable buttons in the UI

IMPORTANT RULES FOR reasoning:
- Keep it to ONE short sentence explaining the issue
- For IMPOSSIBLE: briefly say what data is missing

Be generous with ANSWERABLE - if there's a reasonable interpretation that maps to the schema,
prefer ANSWERABLE over AMBIGUOUS. Handle typos and informal language gracefully.`;
}

/**
 * Classify a user's natural language query intent.
 *
 * Uses GPT-5 with structured JSON output (no CFG constraint needed).
 * Returns the classification, reasoning, and optional clarifications/suggestions.
 */
export async function classifyIntent(
  naturalLanguageQuery: string
): Promise<IntentResult> {
  const client = new OpenAI();
  const schema = await getTableSchema();
  const schemaSummary = buildSchemaSummary(schema);
  const systemPrompt = buildIntentSystemPrompt(schemaSummary);

  const response = await client.responses.create({
    model: OPENAI_MODEL,
    input: [
      {
        role: "developer",
        content: systemPrompt,
      },
      {
        role: "user",
        content: naturalLanguageQuery,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "intent_classification",
        strict: true,
        schema: {
          type: "object",
          properties: {
            classification: {
              type: "string",
              enum: ["ANSWERABLE", "AMBIGUOUS", "IMPOSSIBLE", "OUT_OF_SCOPE"],
            },
            reasoning: { type: "string" },
            clarifications: {
              type: "array",
              items: { type: "string" },
            },
            suggestion: { type: "string" },
          },
          required: ["classification", "reasoning", "clarifications", "suggestion"],
          additionalProperties: false,
        },
      },
    },
    reasoning: { effort: "low" },
  });

  // Extract text from the response
  const textOutput = response.output.find(
    (item): item is OpenAI.Responses.ResponseOutputMessage =>
      item.type === "message"
  );

  if (!textOutput) {
    // Fallback: assume answerable if classification fails
    return {
      classification: "ANSWERABLE",
      reasoning: "Intent classification did not return a response; defaulting to ANSWERABLE",
    };
  }

  const rawText = textOutput.content
    .map((c) => ("text" in c ? c.text : ""))
    .join("");

  try {
    const parsed = JSON.parse(rawText) as {
      classification: string;
      reasoning: string;
      clarifications: string[];
      suggestion: string;
    };

    // Validate the classification value
    const validClassifications: IntentClassification[] = [
      "ANSWERABLE",
      "AMBIGUOUS",
      "IMPOSSIBLE",
      "OUT_OF_SCOPE",
    ];
    const classification = validClassifications.includes(
      parsed.classification as IntentClassification
    )
      ? (parsed.classification as IntentClassification)
      : "ANSWERABLE";

    return {
      classification,
      reasoning: parsed.reasoning || "",
      clarifications:
        parsed.clarifications?.length > 0
          ? parsed.clarifications
          : undefined,
      suggestion: parsed.suggestion || undefined,
    };
  } catch {
    // JSON parse failed - default to answerable
    return {
      classification: "ANSWERABLE",
      reasoning: "Failed to parse intent classification response; defaulting to ANSWERABLE",
    };
  }
}
