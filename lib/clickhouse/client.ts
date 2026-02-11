import { createClient, type ClickHouseClient } from "@clickhouse/client";

/*
 * ClickHouse client singleton.
 *
 * Connects to local Docker instance by default (http://localhost:8123).
 * Set CLICKHOUSE_URL env var to point at Tinybird or other remote instance.
 */

const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";

let clientInstance: ClickHouseClient | null = null;

export function getClickHouseClient(): ClickHouseClient {
  if (!clientInstance) {
    clientInstance = createClient({
      url: CLICKHOUSE_URL,
      request_timeout: 30_000,
      clickhouse_settings: {
        // Safety: limit result size to prevent accidental huge scans
        max_result_rows: "10000",  // UInt64 (string type in client)
        max_execution_time: 30,     // Seconds (number type in client)
      },
    });
  }
  return clientInstance;
}

/**
 * Infer a ClickHouse type from a JavaScript value.
 * Used for computed/aliased columns not in system.columns.
 */
function inferTypeFromValue(value: unknown): string {
  if (typeof value === "number") {
    return Number.isInteger(value) ? "UInt64" : "Float64";
  }
  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}/.test(value)
  ) {
    return "DateTime";
  }
  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return "Date";
  }
  return "String";
}

/**
 * Execute a read-only SQL query and return typed results.
 */
export async function executeQuery(sql: string): Promise<{
  rows: Record<string, unknown>[];
  columns: { name: string; type: string }[];
  executionTimeMs: number;
}> {
  const client = getClickHouseClient();
  const start = performance.now();

  const result = await client.query({
    query: sql,
    format: "JSONEachRow",
  });

  const rows = await result.json<Record<string, unknown>>();
  const elapsed = Math.round(performance.now() - start);

  // Get base table column types for lookups
  const describeResult = await client.query({
    query: `SELECT name, type FROM system.columns WHERE table = 'github_events' AND database = currentDatabase()`,
    format: "JSONEachRow",
  });
  const schemaColumns = await describeResult.json<{
    name: string;
    type: string;
  }>();

  // Infer which columns are in the result from the first row's keys
  const resultColumnNames =
    rows.length > 0 ? Object.keys(rows[0]) : [];

  const columns = resultColumnNames.map((name) => {
    // 1. Try schema lookup (works for base table columns like repo_name)
    const schemaMeta = schemaColumns.find((c) => c.name === name);
    if (schemaMeta) {
      return { name, type: schemaMeta.type };
    }

    // 2. Infer from actual values (works for aliases like count() AS pushes)
    const sampleValue = rows.length > 0 ? rows[0][name] : undefined;
    return { name, type: inferTypeFromValue(sampleValue) };
  });

  return { rows, columns, executionTimeMs: elapsed };
}

/**
 * Verify ClickHouse is reachable.
 */
export async function healthCheck(): Promise<boolean> {
  try {
    const client = getClickHouseClient();
    const result = await client.query({
      query: "SELECT 1",
      format: "JSONEachRow",
    });
    await result.json();
    return true;
  } catch {
    return false;
  }
}
