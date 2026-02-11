import OpenAI from "openai";
import { buildGrammarForOpenAI } from "@/lib/cfg/grammar-builder";
import {
  getTableSchema,
  buildSchemaSummary,
  KNOWN_EVENT_TYPES,
  KNOWN_ACTION_VALUES,
} from "@/lib/clickhouse/schema";
import type { TableSchema } from "@/lib/types";

const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-5-mini";

/**
 * Build the system prompt with schema context.
 */
function buildSystemPrompt(schema: TableSchema): string {
  const schemaSummary = buildSchemaSummary(schema);

  return `You are a ClickHouse SQL query generator for a GitHub events database.

DATABASE SCHEMA:
${schemaSummary}

AVAILABLE EVENT TYPES: ${[...KNOWN_EVENT_TYPES].join(", ")}
AVAILABLE ACTIONS: ${[...KNOWN_ACTION_VALUES].join(", ")}

YOUR TASK:
Translate the user's natural language question into a single ClickHouse SQL SELECT query.
Use the sql_generator tool to output the query — it enforces a grammar that only allows valid queries.

GUIDELINES:
- GitHub "stars" are represented as WatchEvents in this dataset
- "commits" or "pushes" map to PushEvent
- "pull requests" or "PRs" map to PullRequestEvent
- "issues" map to IssuesEvent with action = 'opened' for new issues
- Use count() for counting events, uniqExact() for counting distinct values
- Always include a LIMIT clause (default to 10 if the user doesn't specify)
- Use appropriate date truncation functions for time-series queries (toStartOfDay, toStartOfHour, etc.)
- For "top N" queries, use ORDER BY ... DESC LIMIT N
- Reason carefully about which columns, filters, and aggregations match the user's intent`;
}

/**
 * Build the tool description for the CFG-constrained SQL generator.
 */
const TOOL_DESCRIPTION = `Generates a read-only ClickHouse SQL SELECT query against the github_events table.

The grammar enforces:
- Only SELECT queries (no INSERT/UPDATE/DELETE/DROP)
- Only the github_events table (no JOINs, no subqueries)
- Column references must be from the schema
- String values restricted to safe characters (no SQL injection possible)
- Aggregation functions: count, sum, avg, min, max, uniq, uniqExact
- Date truncation: toStartOfHour, toStartOfDay, toStartOfWeek, toStartOfMonth, toDate
- WHERE conditions: string equality/LIKE/IN, numeric comparison, datetime intervals/BETWEEN, enum matching
- Optional GROUP BY, HAVING, ORDER BY, LIMIT clauses

YOU MUST reason carefully about the query structure and ensure it conforms to the grammar exactly.`;

export interface GenerateSQLResult {
  sql: string;
  model: string;
}

/**
 * Generate a ClickHouse SQL query from a natural language question.
 *
 * Uses GPT-5's CFG constrained decoding via a custom tool with a Lark grammar.
 * See: https://cookbook.openai.com/examples/gpt-5/gpt-5_new_params_and_tools#3-contextfree-grammar-cfg
 *
 * @param naturalLanguageQuery - The user's question
 * @param feedback - Optional feedback from a prior attempt (for retry loops)
 */
export async function generateSQL(
  naturalLanguageQuery: string,
  feedback?: string,
): Promise<GenerateSQLResult> {
  const client = new OpenAI();

  const schema = await getTableSchema();
  const grammarFormat = buildGrammarForOpenAI(schema);
  const systemPrompt = buildSystemPrompt(schema);

  // Build the user message, optionally including retry feedback
  let userContent = naturalLanguageQuery;
  if (feedback) {
    userContent += `\n\n--- RETRY FEEDBACK ---\nA previous SQL attempt for this question was inadequate. Here is why:\n${feedback}\nPlease generate a corrected SQL query that addresses the issue.`;
  }

  const response = await client.responses.create({
    model: OPENAI_MODEL,
    input: [
      {
        role: "developer",
        content: systemPrompt,
      },
      {
        role: "user",
        content: userContent,
      },
    ],
    tools: [
      {
        type: "custom" as const,
        name: "sql_generator",
        description: TOOL_DESCRIPTION,
        format: grammarFormat,
      },
    ],
    parallel_tool_calls: false,
  });

  // Find the custom tool call in the response output
  const toolCall = response.output.find(
    (item): item is OpenAI.Responses.ResponseCustomToolCall =>
      item.type === "custom_tool_call"
  );

  if (!toolCall) {
    // The model responded with text instead of calling the tool.
    // Extract any text message for debugging.
    const textOutput = response.output.find(
      (item): item is OpenAI.Responses.ResponseOutputMessage =>
        item.type === "message"
    );
    const message = textOutput?.content
      ?.map((c) => ("text" in c ? c.text : ""))
      .join("") ?? "Unknown error";

    throw new Error(
      `Model did not generate SQL via the grammar tool. Response: ${message}`
    );
  }

  return {
    sql: toolCall.input,
    model: response.model,
  };
}
