/*
 * Semantic correctness evals. Given a natural language query,
 * checks whether the pipeline produces the correct
 * SQL and result. Each test case runs the full e2e pipelines
 * (NL query -> intent -> SQL generation -> validation -> execution).
 *
 * Assertions check:
 *   1. SQL structure (expected fragments present)
 *   2. Execution success (no ClickHouse errors)
 *   3. Result shape (column names, row count bounds)
 * 
 * Note: These evals require a running ClickHouse instance with
 * ingested data, and a valid OPENAI_API_KEY.
 */

export interface SemanticCase {
  id: string;
  description: string;
  nlQuery: string;
  expectedSQLContains: string[];
  expectedResult: {
    minRows?: number;
    maxRows?: number;
    requiredColumns?: string[];
    hasNumericColumn?: boolean;
    hasDateColumn?: boolean;
  };
}

export const SEMANTIC_CASES: SemanticCase[] = [
  {
    id: "top_repos_by_pushes",
    description: "Top repos by push events",
    nlQuery: "What are the top 10 most pushed-to repos?",
    expectedSQLContains: ["PushEvent", "GROUP BY", "ORDER BY", "DESC", "LIMIT"],
    expectedResult: {
      minRows: 1,
      maxRows: 10,
      requiredColumns: ["repo_name"],
      hasNumericColumn: true,
    },
  },
  {
    id: "total_event_count",
    description: "Total event count (scalar)",
    nlQuery: "How many events are there in total?",
    expectedSQLContains: ["count("],
    expectedResult: {
      minRows: 1,
      maxRows: 1,
      hasNumericColumn: true,
    },
  },
  {
    id: "hourly_events",
    description: "Hourly event counts",
    nlQuery: "Show me hourly event counts on 2025-11-01",
    expectedSQLContains: ["toStartOfHour", "count(", "GROUP BY"],
    expectedResult: {
      minRows: 1,
      hasDateColumn: true,
      hasNumericColumn: true,
    },
  },
  {
    id: "top_issue_openers",
    description: "Top issue-opening users",
    nlQuery: "Which users opened the most issues?",
    expectedSQLContains: ["IssuesEvent", "actor_login", "GROUP BY"],
    expectedResult: {
      minRows: 1,
      requiredColumns: ["actor_login"],
      hasNumericColumn: true,
    },
  },
  {
    id: "pr_repos",
    description: "Repos with most pull requests",
    nlQuery: "Top 5 repos by pull request count",
    expectedSQLContains: ["PullRequestEvent", "repo_name", "GROUP BY", "LIMIT"],
    expectedResult: {
      minRows: 1,
      maxRows: 5,
      requiredColumns: ["repo_name"],
      hasNumericColumn: true,
    },
  },
  {
    id: "unique_contributors",
    description: "Repos with unique contributors",
    nlQuery: "Which repos have the most unique contributors?",
    expectedSQLContains: ["uniq", "actor_login", "repo_name", "GROUP BY"],
    expectedResult: {
      minRows: 1,
      requiredColumns: ["repo_name"],
      hasNumericColumn: true,
    },
  },
  {
    id: "event_type_breakdown",
    description: "Event type breakdown",
    nlQuery: "Show me a breakdown of events by type",
    expectedSQLContains: ["type", "count(", "GROUP BY"],
    expectedResult: {
      minRows: 2,
      hasNumericColumn: true,
    },
  },
  {
    id: "fork_count",
    description: "Fork event count",
    nlQuery: "How many forks happened?",
    expectedSQLContains: ["ForkEvent", "count("],
    expectedResult: {
      minRows: 1,
      hasNumericColumn: true,
    },
  },
];
