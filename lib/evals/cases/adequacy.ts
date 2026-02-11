/*
 * Response adequacy evals (accuracy).
 *
 * Tests whether the LLM result-adequacy checker correctly
 * identifies when SQL query results do or don't answer
 * the user's question.
 *
 * Each case provides a frozen (user query, SQL, columns, rows)
 * tuple. The checker is called directly - no pipeline, no
 * ClickHouse. Only OpenAI is required.

 * Two axes:
 *   - True positive: checker flags bad results as inadequate
 *   - True negative: checker accepts good results as adequate
 *
 * Metric: accuracy = correct / total
 * Target: >= 80%
 *
 * Note: Requires a valid OPENAI_API_KEY.
 */

export interface AdequacyCase {
  id: string;
  description: string;
  userQuery: string;
  sql: string;
  columns: { name: string; type: string }[];
  rows: Record<string, unknown>[];
  expectedAdequate: boolean;
}

export const ADEQUACY_CASES: AdequacyCase[] = [
  // ── Should be INADEQUATE (true positives) ─────────────────────

  {
    id: "adq_narrow_date",
    description: "Midnight-only date range returns 1 row instead of 24 hourly rows",
    userQuery: "Hourly event breakdown on 2025-11-01",
    sql: "SELECT toStartOfHour(created_at) AS hour, count() AS events FROM github_events WHERE created_at BETWEEN '2025-11-01' AND '2025-11-01' GROUP BY hour ORDER BY hour ASC LIMIT 24",
    columns: [
      { name: "hour", type: "DateTime" },
      { name: "events", type: "UInt64" },
    ],
    rows: [{ hour: "2025-11-01 00:00:00", events: 46 }],
    expectedAdequate: false,
  },
  {
    id: "adq_too_few_rows",
    description: "Asked for top 10 but only 3 rows returned",
    userQuery: "Top 10 repos by push events",
    sql: "SELECT repo_name, count() AS pushes FROM github_events WHERE type = 'PushEvent' GROUP BY repo_name ORDER BY pushes DESC LIMIT 3",
    columns: [
      { name: "repo_name", type: "LowCardinality(String)" },
      { name: "pushes", type: "UInt64" },
    ],
    rows: [
      { repo_name: "oss333ulf/Projcts9", pushes: 10112 },
      { repo_name: "oss333ulf/Projcts10", pushes: 10075 },
      { repo_name: "inse2233tto/Projcts4", pushes: 10069 },
    ],
    expectedAdequate: false,
  },
  {
    id: "adq_missing_grouping",
    description: "Asked for breakdown by type but result has no type column",
    userQuery: "Events by type",
    sql: "SELECT count() AS total_events FROM github_events",
    columns: [{ name: "total_events", type: "UInt64" }],
    rows: [{ total_events: 791263 }],
    expectedAdequate: false,
  },
  {
    id: "adq_wrong_column",
    description: "Asked about users but result shows repos instead",
    userQuery: "Most active users by push events",
    sql: "SELECT repo_name, count() AS pushes FROM github_events WHERE type = 'PushEvent' GROUP BY repo_name ORDER BY pushes DESC LIMIT 10",
    columns: [
      { name: "repo_name", type: "LowCardinality(String)" },
      { name: "pushes", type: "UInt64" },
    ],
    rows: [
      { repo_name: "oss333ulf/Projcts9", pushes: 10112 },
      { repo_name: "oss333ulf/Projcts10", pushes: 10075 },
      { repo_name: "inse2233tto/Projcts4", pushes: 10069 },
    ],
    expectedAdequate: false,
  },
  {
    id: "adq_empty_result",
    description: "Non-empty query returns 0 rows unexpectedly",
    userQuery: "Push events on January 15, 2024",
    sql: "SELECT count() AS total FROM github_events WHERE type = 'PushEvent' AND toDate(created_at) = '2025-01-15'",
    columns: [{ name: "total", type: "UInt64" }],
    rows: [{ total: 0 }],
    expectedAdequate: false,
  },
  {
    id: "adq_wrong_aggregation",
    description: "Asked for average but got raw count",
    userQuery: "Average events per hour on Jan 15",
    sql: "SELECT toStartOfHour(created_at) AS hour, count() AS events FROM github_events WHERE toDate(created_at) = '2025-11-01' GROUP BY hour ORDER BY hour ASC",
    columns: [
      { name: "hour", type: "DateTime" },
      { name: "events", type: "UInt64" },
    ],
    rows: [
      { hour: "2025-11-01 00:00:00", events: 32971 },
      { hour: "2025-11-01 01:00:00", events: 29485 },
      { hour: "2025-11-01 02:00:00", events: 27133 },
    ],
    expectedAdequate: false,
  },

  // ── Should be ADEQUATE (true negatives) ───────────────────────

  {
    id: "adq_correct_scalar",
    description: "Correct scalar count for total events",
    userQuery: "How many push events total?",
    sql: "SELECT count() AS total FROM github_events WHERE type = 'PushEvent'",
    columns: [{ name: "total", type: "UInt64" }],
    rows: [{ total: 497218 }],
    expectedAdequate: true,
  },
  {
    id: "adq_correct_top10",
    description: "Correct top 10 repos by push events",
    userQuery: "Top 10 repos by push events",
    sql: "SELECT repo_name, count() AS pushes FROM github_events WHERE type = 'PushEvent' GROUP BY repo_name ORDER BY pushes DESC LIMIT 10",
    columns: [
      { name: "repo_name", type: "LowCardinality(String)" },
      { name: "pushes", type: "UInt64" },
    ],
    rows: [
      { repo_name: "oss333ulf/Projcts9", pushes: 10112 },
      { repo_name: "oss333ulf/Projcts10", pushes: 10075 },
      { repo_name: "inse2233tto/Projcts4", pushes: 10069 },
      { repo_name: "inse2233tto/Projcts5", pushes: 10060 },
      { repo_name: "inse2233tto/Projcts2", pushes: 10057 },
      { repo_name: "ion561sdag/Projcts15", pushes: 10048 },
      { repo_name: "inse2233tto/Projcts7", pushes: 10047 },
      { repo_name: "inse2233tto/Projcts1", pushes: 10037 },
      { repo_name: "ion561sdag/Projcts13", pushes: 10034 },
      { repo_name: "inse2233tto/Projcts8", pushes: 10028 },
    ],
    expectedAdequate: true,
  },
  {
    id: "adq_correct_hourly",
    description: "Correct 4-hour breakdown with multiple rows",
    userQuery: "Hourly event count on Nov 1 2025 after 12am and before 4am",
    sql: "SELECT toStartOfHour(created_at) AS hour, count() AS events FROM github_events WHERE created_at >= '2025-11-01 00:00:00' AND created_at < '2025-11-01 04:00:00' GROUP BY hour ORDER BY hour ASC",
    columns: [
      { name: "hour", type: "DateTime" },
      { name: "events", type: "UInt64" },
    ],
    rows: [
      { hour: "2025-11-01 00:00:00", events: 32971 },
      { hour: "2025-11-01 01:00:00", events: 29485 },
      { hour: "2025-11-01 02:00:00", events: 27133 },
      { hour: "2025-11-01 03:00:00", events: 26508 },
    ],
    expectedAdequate: true,
  },
  {
    id: "adq_correct_type_breakdown",
    description: "Correct event type breakdown with type column",
    userQuery: "Events by type",
    sql: "SELECT type, count() AS event_count FROM github_events GROUP BY type ORDER BY event_count DESC",
    columns: [
      { name: "type", type: "Enum8" },
      { name: "event_count", type: "UInt64" },
    ],
    rows: [
      { type: "PushEvent", event_count: 497218 },
      { type: "CreateEvent", event_count: 72134 },
      { type: "PullRequestEvent", event_count: 51230 },
      { type: "WatchEvent", event_count: 28416 },
      { type: "IssueCommentEvent", event_count: 27893 },
    ],
    expectedAdequate: true,
  },
  {
    id: "adq_correct_users",
    description: "Correct top users by activity",
    userQuery: "Most active users by push events",
    sql: "SELECT actor_login, count() AS pushes FROM github_events WHERE type = 'PushEvent' GROUP BY actor_login ORDER BY pushes DESC LIMIT 10",
    columns: [
      { name: "actor_login", type: "LowCardinality(String)" },
      { name: "pushes", type: "UInt64" },
    ],
    rows: [
      { actor_login: "dependabot[bot]", pushes: 15234 },
      { actor_login: "oss333ulf", pushes: 10112 },
      { actor_login: "inse2233tto", pushes: 9847 },
    ],
    expectedAdequate: true,
  },
  {
    id: "adq_correct_filtered",
    description: "Correct filtered result with proper WHERE clause",
    userQuery: "How many fork events on Nov 1?",
    sql: "SELECT count() AS forks FROM github_events WHERE type = 'ForkEvent' AND toDate(created_at) = '2025-11-01'",
    columns: [{ name: "forks", type: "UInt64" }],
    rows: [{ forks: 5892 }],
    expectedAdequate: true,
  },
];
