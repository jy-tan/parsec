#!/usr/bin/env npx tsx
/**
 * Quick test script for CFG grammar generation and parsing.
 *
 * Usage:
 *   npx tsx scripts/test-cfg.ts
 */

import { buildGrammar, buildGrammarForOpenAI, describeGrammarCapabilities } from "../lib/cfg/grammar-builder";
import { parseQuery, isValidGrammarSQL, formatDerivationTree } from "../lib/cfg/grammar-parser";
import { KNOWN_EVENT_TYPES } from "../lib/clickhouse/schema";
import type { TableSchema } from "../lib/types";

// Use the static schema (no ClickHouse connection needed)
const schema: TableSchema = {
  tableName: "github_events",
  columns: [
    { name: "id", type: "UInt64" },
    { name: "type", type: "Enum8", enumValues: [...KNOWN_EVENT_TYPES] },
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

// ── Section 1: Grammar Generation ──────────────────────────

console.log("═══════════════════════════════════════════════════");
console.log(" CFG Grammar Test");
console.log("═══════════════════════════════════════════════════\n");

console.log("── Grammar Capabilities ──\n");
console.log(describeGrammarCapabilities(schema));

console.log("\n── Generated Lark Grammar ──\n");
const grammar = buildGrammar(schema);
console.log(grammar);

console.log("\n── OpenAI Tool Format ──\n");
const openaiFormat = buildGrammarForOpenAI(schema);
console.log(JSON.stringify(openaiFormat, null, 2).slice(0, 200) + "...\n");

// ── Section 2: Parse Valid Queries ─────────────────────────

const VALID_QUERIES = [
  "SELECT count() AS total FROM github_events WHERE type = 'PushEvent'",
  "SELECT repo_name, count() AS pushes FROM github_events WHERE type = 'PushEvent' GROUP BY repo_name ORDER BY pushes DESC LIMIT 10",
  "SELECT toStartOfHour(created_at) AS hour, count() AS events FROM github_events GROUP BY hour ORDER BY hour ASC",
  "SELECT actor_login, count() AS prs FROM github_events WHERE type = 'PullRequestEvent' AND action = 'opened' AND created_at >= now() - INTERVAL 30 DAY GROUP BY actor_login ORDER BY prs DESC LIMIT 20",
  "SELECT repo_name, uniqExact(actor_login) AS contributors FROM github_events WHERE type = 'PushEvent' GROUP BY repo_name ORDER BY contributors DESC LIMIT 10",
  "SELECT actor_login, count() AS prs FROM github_events WHERE type = 'PullRequestEvent' GROUP BY actor_login HAVING count() > 10 ORDER BY prs DESC LIMIT 20",
  "SELECT repo_name, count() AS issues FROM github_events WHERE type = 'IssuesEvent' AND action = 'opened' AND created_at >= now() - INTERVAL 30 DAY GROUP BY repo_name ORDER BY issues DESC LIMIT 10",
];

console.log("\n\n── Parsing Valid Queries ──\n");
let passed = 0;
let failed = 0;

for (const sql of VALID_QUERIES) {
  const valid = isValidGrammarSQL(sql);
  const status = valid ? "PASS" : "FAIL";
  const icon = valid ? "✓" : "✗";
  if (valid) passed++;
  else failed++;
  console.log(`  ${icon} [${status}] ${sql.slice(0, 90)}${sql.length > 90 ? "..." : ""}`);

  if (!valid) {
    // Show partial parse for debugging
    const tree = parseQuery(sql);
    if (tree) {
      console.log(`    Partial parse (rule: ${tree.rule}):`);
      console.log(`    Matched: "${tree.matchedText.slice(0, 80)}..."`);
    } else {
      console.log("    No parse at all.");
    }
  }
}

// ── Section 3: Reject Dangerous Queries ────────────────────

const DANGEROUS_QUERIES = [
  "DROP TABLE github_events",
  "SELECT repo_name FROM github_events UNION SELECT password FROM users",
  "SELECT * FROM system.processes",
  "INSERT INTO github_events (type) VALUES ('MaliciousEvent')",
  "SELECT 1; DROP TABLE github_events",
];

console.log("\n── Rejecting Dangerous Queries ──\n");

for (const sql of DANGEROUS_QUERIES) {
  const valid = isValidGrammarSQL(sql);
  const status = !valid ? "PASS" : "FAIL";
  const icon = !valid ? "✓" : "✗";
  if (!valid) passed++;
  else failed++;
  console.log(`  ${icon} [${status}] Rejected: ${sql}`);
}

// ── Section 4: Derivation Tree Example ─────────────────────

console.log("\n── Derivation Tree Example ──\n");
const exampleSQL =
  "SELECT repo_name, count() AS event_count FROM github_events WHERE type = 'PushEvent' GROUP BY repo_name ORDER BY event_count DESC LIMIT 10";
console.log(`SQL: ${exampleSQL}\n`);

const tree = parseQuery(exampleSQL);
if (tree) {
  console.log(formatDerivationTree(tree));
} else {
  console.log("  (failed to parse)");
}

// ── Summary ────────────────────────────────────────────────

console.log("\n═══════════════════════════════════════════════════");
console.log(` Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log("═══════════════════════════════════════════════════\n");

process.exit(failed > 0 ? 1 : 0);
