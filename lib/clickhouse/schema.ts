import { getClickHouseClient } from "./client";
import type { TableSchema, ColumnInfo } from "@/lib/types";

// ============================================================
// Schema Registry — introspects ClickHouse to build TableSchema
// ============================================================

/**
 * Known event types from the github_events Enum8 column.
 * Used as a fallback when ClickHouse is not available.
 */
export const KNOWN_EVENT_TYPES = [
  "CommitCommentEvent",
  "CreateEvent",
  "DeleteEvent",
  "ForkEvent",
  "GollumEvent",
  "IssueCommentEvent",
  "IssuesEvent",
  "MemberEvent",
  "PublicEvent",
  "PullRequestEvent",
  "PullRequestReviewCommentEvent",
  "PullRequestReviewEvent",
  "PushEvent",
  "ReleaseEvent",
  "SponsorshipEvent",
  "WatchEvent",
] as const;

/**
 * Known action values for the action column.
 */
export const KNOWN_ACTION_VALUES = [
  "opened",
  "closed",
  "reopened",
  "created",
  "edited",
  "deleted",
  "added",
  "removed",
  "published",
] as const;

/**
 * Static fallback schema (used when ClickHouse is unreachable, e.g. during build).
 */
const STATIC_SCHEMA: TableSchema = {
  tableName: "github_events",
  columns: [
    { name: "id", type: "UInt64" },
    {
      name: "type",
      type: "Enum8",
      enumValues: [...KNOWN_EVENT_TYPES],
    },
    { name: "actor_login", type: "LowCardinality(String)" },
    { name: "repo_name", type: "LowCardinality(String)" },
    { name: "created_at", type: "DateTime" },
    { name: "action", type: "LowCardinality(String)" },
    { name: "number", type: "UInt32" },
    { name: "title", type: "String" },
    { name: "body", type: "String" },
    { name: "ref", type: "LowCardinality(String)" },
    { name: "is_private", type: "UInt8" },
  ],
};

/**
 * Cached schema (refreshed once per process lifetime).
 */
let cachedSchema: TableSchema | null = null;

/**
 * Parse Enum8 definition string to extract values.
 *
 * Example: "Enum8('CommitCommentEvent' = 1, 'CreateEvent' = 2, ...)"
 * Returns: ["CommitCommentEvent", "CreateEvent", ...]
 */
function parseEnumValues(typeStr: string): string[] | undefined {
  const match = typeStr.match(/^Enum8\((.+)\)$/);
  if (!match) return undefined;

  const values: string[] = [];
  const regex = /'([^']+)'\s*=\s*\d+/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(match[1])) !== null) {
    values.push(m[1]);
  }
  return values.length > 0 ? values : undefined;
}

/**
 * Introspect ClickHouse to get the actual table schema.
 * Falls back to the static schema on failure.
 */
export async function getTableSchema(
  tableName: string = "github_events"
): Promise<TableSchema> {
  if (cachedSchema) return cachedSchema;

  try {
    const client = getClickHouseClient();
    const result = await client.query({
      query: `SELECT name, type FROM system.columns WHERE table = '${tableName}' AND database = currentDatabase() ORDER BY position`,
      format: "JSONEachRow",
    });

    const rawColumns = await result.json<{ name: string; type: string }>();

    if (rawColumns.length === 0) {
      // Table doesn't exist yet — use static schema
      cachedSchema = STATIC_SCHEMA;
      return cachedSchema;
    }

    const columns: ColumnInfo[] = rawColumns.map((col) => ({
      name: col.name,
      type: col.type,
      enumValues: parseEnumValues(col.type),
    }));

    cachedSchema = { tableName, columns };
    return cachedSchema;
  } catch {
    // ClickHouse not available — use static fallback
    cachedSchema = STATIC_SCHEMA;
    return cachedSchema;
  }
}

/**
 * Force-refresh the cached schema.
 */
export function invalidateSchemaCache(): void {
  cachedSchema = null;
}

// ============================================================
// Schema classification helpers
// ============================================================

export function isStringType(type: string): boolean {
  return (
    type === "String" ||
    type.startsWith("LowCardinality(String") ||
    type.startsWith("Nullable(String")
  );
}

export function isNumericType(type: string): boolean {
  return (
    type.startsWith("UInt") ||
    type.startsWith("Int") ||
    type.startsWith("Float") ||
    type.startsWith("Decimal")
  );
}

export function isDateTimeType(type: string): boolean {
  return type === "DateTime" || type === "Date" || type.startsWith("DateTime64");
}

export function isEnumType(type: string): boolean {
  return type.startsWith("Enum");
}

/**
 * Build a human-readable schema summary for LLM prompts.
 */
export function buildSchemaSummary(schema: TableSchema): string {
  const lines = schema.columns.map((col) => {
    let desc = `  - ${col.name}: ${col.type}`;
    if (col.enumValues) {
      desc += ` (values: ${col.enumValues.join(", ")})`;
    }
    return desc;
  });
  return `Table: ${schema.tableName}\nColumns:\n${lines.join("\n")}`;
}

/**
 * Get string columns from schema (for grammar generation).
 */
export function getStringColumns(schema: TableSchema): string[] {
  return schema.columns
    .filter((c) => isStringType(c.type))
    .map((c) => c.name);
}

/**
 * Get numeric columns from schema (for grammar generation).
 */
export function getNumericColumns(schema: TableSchema): string[] {
  return schema.columns
    .filter((c) => isNumericType(c.type))
    .map((c) => c.name);
}

/**
 * Get datetime columns from schema (for grammar generation).
 */
export function getDateTimeColumns(schema: TableSchema): string[] {
  return schema.columns
    .filter((c) => isDateTimeType(c.type))
    .map((c) => c.name);
}

/**
 * Get enum columns and their values from schema.
 */
export function getEnumColumns(
  schema: TableSchema
): { name: string; values: string[] }[] {
  return schema.columns
    .filter((c) => isEnumType(c.type) && c.enumValues)
    .map((c) => ({ name: c.name, values: c.enumValues! }));
}
