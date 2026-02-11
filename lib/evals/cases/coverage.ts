/*
 * Grammar coverage evals (recall)

 * Tests whether the grammar can express all query patterns we
 * claim to support. Each case contains a target SQL string
 * that should successfully parse against the grammar.
 * 
 * A parse failure = recall miss.
 * Metric: recall = passed / total
 * Target: 100%
 */
export interface CoverageCase {
  id: string;
  description: string;
  targetSQL: string;
  shouldParse: true;
}

export const COVERAGE_CASES: CoverageCase[] = [
  {
    id: "basic_count",
    description: "Simple count with filter",
    targetSQL:
      "SELECT count() AS total FROM github_events WHERE type = 'PushEvent'",
    shouldParse: true,
  },
  {
    id: "count_with_column",
    description: "Count with a column argument",
    targetSQL:
      "SELECT count(id) AS cnt FROM github_events WHERE type = 'PushEvent'",
    shouldParse: true,
  },
  {
    id: "time_series_hourly",
    description: "Hourly event breakdown",
    targetSQL:
      "SELECT toStartOfHour(created_at) AS hour, count() AS events FROM github_events GROUP BY hour ORDER BY hour ASC",
    shouldParse: true,
  },
  {
    id: "time_series_daily",
    description: "Daily event counts",
    targetSQL:
      "SELECT toStartOfDay(created_at) AS day, count() AS events FROM github_events GROUP BY day ORDER BY day ASC",
    shouldParse: true,
  },
  {
    id: "time_series_weekly",
    description: "Weekly aggregation",
    targetSQL:
      "SELECT toStartOfWeek(created_at) AS week, count() AS events FROM github_events GROUP BY week ORDER BY week ASC",
    shouldParse: true,
  },
  {
    id: "time_series_monthly",
    description: "Monthly aggregation",
    targetSQL:
      "SELECT toStartOfMonth(created_at) AS month, count() AS events FROM github_events GROUP BY month ORDER BY month ASC",
    shouldParse: true,
  },
  {
    id: "to_date_truncation",
    description: "Date truncation with toDate",
    targetSQL:
      "SELECT toDate(created_at) AS day, count() AS events FROM github_events GROUP BY day ORDER BY day ASC",
    shouldParse: true,
  },
  {
    id: "having_clause",
    description: "Filter on aggregate with HAVING",
    targetSQL:
      "SELECT actor_login, count() AS prs FROM github_events WHERE type = 'PullRequestEvent' GROUP BY actor_login HAVING count() > 10 ORDER BY prs DESC LIMIT 20",
    shouldParse: true,
  },
  {
    id: "multi_condition_where",
    description: "Multiple WHERE conditions with AND",
    targetSQL:
      "SELECT repo_name, count() AS issues FROM github_events WHERE type = 'IssuesEvent' AND action = 'opened' GROUP BY repo_name ORDER BY issues DESC LIMIT 10",
    shouldParse: true,
  },
  {
    id: "unique_contributors",
    description: "Count distinct users with uniqExact",
    targetSQL:
      "SELECT repo_name, uniqExact(actor_login) AS contributors FROM github_events WHERE type = 'PushEvent' GROUP BY repo_name ORDER BY contributors DESC LIMIT 10",
    shouldParse: true,
  },
  {
    id: "interval_filter",
    description: "Relative date filter with INTERVAL",
    targetSQL:
      "SELECT repo_name, count() AS events FROM github_events WHERE created_at >= now() - INTERVAL 7 DAY GROUP BY repo_name ORDER BY events DESC LIMIT 10",
    shouldParse: true,
  },
  {
    id: "between_dates",
    description: "Date BETWEEN with literal dates",
    targetSQL:
      "SELECT repo_name, count() AS events FROM github_events WHERE created_at BETWEEN '2025-11-01' AND '2025-11-01' GROUP BY repo_name ORDER BY events DESC LIMIT 10",
    shouldParse: true,
  },
  {
    id: "enum_in_list",
    description: "Type IN list with multiple event types",
    targetSQL:
      "SELECT type, count() AS cnt FROM github_events WHERE type IN ('PushEvent', 'PullRequestEvent') GROUP BY type ORDER BY cnt DESC",
    shouldParse: true,
  },
  {
    id: "bare_aggregation",
    description: "Aggregation without GROUP BY (global aggregate)",
    targetSQL: "SELECT count() AS total FROM github_events",
    shouldParse: true,
  },
  {
    id: "sum_aggregation",
    description: "SUM aggregation function",
    targetSQL:
      "SELECT repo_name, sum(number) AS total_issues FROM github_events WHERE type = 'IssuesEvent' GROUP BY repo_name ORDER BY total_issues DESC LIMIT 10",
    shouldParse: true,
  },
  {
    id: "avg_aggregation",
    description: "AVG aggregation function",
    targetSQL:
      "SELECT type, avg(number) AS avg_num FROM github_events GROUP BY type ORDER BY avg_num DESC LIMIT 10",
    shouldParse: true,
  },
  {
    id: "min_max_aggregation",
    description: "MIN and MAX in same query",
    targetSQL:
      "SELECT min(number) AS lowest, max(number) AS highest FROM github_events WHERE type = 'IssuesEvent'",
    shouldParse: true,
  },
  {
    id: "like_filter",
    description: "String LIKE filter",
    targetSQL:
      "SELECT repo_name, count() AS events FROM github_events WHERE repo_name LIKE '%kubernetes%' GROUP BY repo_name ORDER BY events DESC LIMIT 10",
    shouldParse: true,
  },
  {
    id: "numeric_comparison",
    description: "Numeric comparison in WHERE",
    targetSQL:
      "SELECT repo_name, count() AS events FROM github_events WHERE number > 100 GROUP BY repo_name ORDER BY events DESC LIMIT 10",
    shouldParse: true,
  },
  {
    id: "order_asc",
    description: "ORDER BY ascending",
    targetSQL:
      "SELECT actor_login, count() AS events FROM github_events GROUP BY actor_login ORDER BY events ASC LIMIT 10",
    shouldParse: true,
  },
  {
    id: "action_filter",
    description: "Action value filter",
    targetSQL:
      "SELECT repo_name, count() AS opened FROM github_events WHERE action = 'opened' GROUP BY repo_name ORDER BY opened DESC LIMIT 10",
    shouldParse: true,
  },
  {
    id: "uniq_function",
    description: "uniq (non-exact) aggregation",
    targetSQL:
      "SELECT type, uniq(actor_login) AS users FROM github_events GROUP BY type ORDER BY users DESC LIMIT 10",
    shouldParse: true,
  },
  {
    id: "string_equality",
    description: "String equality filter on actor_login",
    targetSQL:
      "SELECT type, count() AS events FROM github_events WHERE actor_login = 'torvalds' GROUP BY type ORDER BY events DESC",
    shouldParse: true,
  },
  {
    id: "multiple_select_cols",
    description: "Multiple columns in SELECT with mix of refs and aggregates",
    targetSQL:
      "SELECT type, repo_name, count() AS cnt FROM github_events GROUP BY type, repo_name ORDER BY cnt DESC LIMIT 20",
    shouldParse: true,
  },
  {
    id: "interval_hour",
    description: "INTERVAL with HOUR unit",
    targetSQL:
      "SELECT count() AS events FROM github_events WHERE created_at >= now() - INTERVAL 12 HOUR",
    shouldParse: true,
  },
];
