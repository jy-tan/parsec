/*
 * Dynamic CFG Grammar Builder
 *
 * Generates a complete Lark grammar from a ClickHouse table
 * schema by injecting schema-derived rules into the grammar
 * template.
 *
 * Output format: Lark syntax for OpenAI's custom tool CFG
 * constrained decoding.
 * See: https://lark-parser.readthedocs.io/en/stable/
 */

import type { TableSchema } from "@/lib/types";
import {
  isStringType,
  isNumericType,
  isDateTimeType,
  KNOWN_EVENT_TYPES,
  KNOWN_ACTION_VALUES,
} from "@/lib/clickhouse/schema";
import { GRAMMAR_TEMPLATE } from "./grammar-template";

/**
 * Format a list of string values as Lark rule alternatives.
 * e.g. ["foo", "bar"] => '"foo" | "bar"'
 *
 * In Lark, quoted strings in rules become anonymous terminals
 * matched with highest priority by the lexer.
 */
function toLarkAlternatives(values: string[]): string {
  return values.map((v) => `"${v}"`).join(" | ");
}

/**
 * Extract column names by type category from the schema.
 */
function classifyColumns(schema: TableSchema) {
  const stringCols: string[] = [];
  const numericCols: string[] = [];
  const dateTimeCols: string[] = [];
  const enumCols: { name: string; values: string[] }[] = [];
  const allCols: string[] = [];

  for (const col of schema.columns) {
    allCols.push(col.name);

    if (col.enumValues && col.enumValues.length > 0) {
      enumCols.push({ name: col.name, values: col.enumValues });
    } else if (isDateTimeType(col.type)) {
      dateTimeCols.push(col.name);
    } else if (isStringType(col.type)) {
      stringCols.push(col.name);
    } else if (isNumericType(col.type)) {
      numericCols.push(col.name);
    }
  }

  return { stringCols, numericCols, dateTimeCols, enumCols, allCols };
}

/**
 * Build a complete Lark grammar string from a table schema.
 *
 * This replaces all {{PLACEHOLDER}} tokens in the grammar template
 * with schema-derived Lark alternatives.
 */
export function buildGrammar(schema: TableSchema): string {
  const { stringCols, numericCols, dateTimeCols, enumCols, allCols } =
    classifyColumns(schema);

  // Build column_ref as the union of all queryable column types,
  // including enum column names derived from the schema.
  const enumColNames = enumCols.map((e) => e.name);
  const allColumnRef = [
    ...stringCols,
    ...numericCols,
    ...dateTimeCols,
    ...enumColNames,
  ];
  // Deduplicate (a column could appear in multiple lists, e.g. created_at)
  const uniqueColumnRef = [...new Set(allColumnRef.filter((c) => allCols.includes(c)))];

  // Get event types from schema or fallback
  const eventTypes =
    enumCols.find((e) => e.name === "type")?.values ?? [...KNOWN_EVENT_TYPES];

  // Action values are hardcoded because the `action` column is typed as
  // LowCardinality(String) in ClickHouse, not an Enum — so there are no
  // introspectable enum values. These are GH Archive domain conventions.
  // To make this generic, we'd need a `SELECT DISTINCT action` discovery query.
  const actionValues = [...KNOWN_ACTION_VALUES];

  // Perform template substitutions
  let grammar = GRAMMAR_TEMPLATE;

  grammar = grammar.replace("{{TABLE_NAME}}", schema.tableName);

  // Fallback values ensure the Lark grammar never has an empty alternative
  // (which would be a syntax error). These are only hit if the schema has
  // zero columns of that type, which shouldn't happen with github_events
  // but guards against malformed schemas.
  grammar = grammar.replace(
    "{{STRING_COLS}}",
    stringCols.length > 0 ? toLarkAlternatives(stringCols) : '"actor_login"'
  );
  grammar = grammar.replace(
    "{{NUMERIC_COLS}}",
    numericCols.length > 0 ? toLarkAlternatives(numericCols) : '"id"'
  );
  grammar = grammar.replace(
    "{{COLUMN_REF}}",
    uniqueColumnRef.length > 0
      ? toLarkAlternatives(uniqueColumnRef)
      : '"id"'
  );
  grammar = grammar.replace("{{EVENT_TYPES}}", toLarkAlternatives(eventTypes));
  grammar = grammar.replace("{{ACTION_VALUES}}", toLarkAlternatives(actionValues));

  return grammar;
}

/**
 * Build the grammar format object for an OpenAI custom tool definition.
 *
 * Usage with OpenAI Responses API:
 * ```ts
 * const tools = [{
 *   type: "custom",
 *   name: "sql_generator",
 *   description: "Generates ClickHouse SQL...",
 *   format: buildGrammarForOpenAI(schema),
 * }];
 * ```
 *
 * See: https://cookbook.openai.com/examples/gpt-5/gpt-5_new_params_and_tools#3-contextfree-grammar-cfg
 */
export function buildGrammarForOpenAI(schema: TableSchema): {
  type: "grammar";
  syntax: "lark";
  definition: string;
} {
  return {
    type: "grammar",
    syntax: "lark",
    definition: buildGrammar(schema),
  };
}

/**
 * Get a human-readable summary of what the grammar allows,
 * useful for debug/eval output.
 */
export function describeGrammarCapabilities(schema: TableSchema): string {
  const { stringCols, numericCols, dateTimeCols, enumCols } =
    classifyColumns(schema);

  const lines = [
    `Table: ${schema.tableName}`,
    `Grammar syntax: Lark (for OpenAI CFG constrained decoding)`,
    `String columns (=, LIKE, IN): ${stringCols.join(", ")}`,
    `Numeric columns (=, !=, >, <, >=, <=): ${numericCols.join(", ")}`,
    `DateTime columns (INTERVAL, BETWEEN): ${dateTimeCols.join(", ")}`,
    `Enum columns:`,
    ...enumCols.map(
      (e) => `  - ${e.name}: ${e.values.join(", ")}`
    ),
    `Aggregations: count, sum, avg, min, max, uniq, uniqExact`,
    `Date truncation: toStartOfHour, toStartOfDay, toStartOfWeek, toStartOfMonth, toDate`,
    `Clauses: SELECT, FROM, WHERE, GROUP BY, HAVING, ORDER BY, LIMIT`,
    `Blocked: DROP, ALTER, INSERT, UPDATE, DELETE, JOIN, subqueries, system tables`,
  ];

  return lines.join("\n");
}
