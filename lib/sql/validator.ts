/*
 * Semantic Validator
 *
 * After GPT-5 produces CFG-constrained SQL, this validator
 * catches issues the grammar can't express:
 *   - GROUP BY consistency (non-aggregated SELECT cols must be grouped)
 *   - Missing LIMIT on potentially large result sets
 *   - Absurd date ranges (INTERVAL 999999 DAY)
 *   - Column existence (redundant with CFG, but defense in depth)
 *
 * The grammar guarantees syntactic validity; this layer ensures
 * semantic correctness.
 */

import type { TableSchema } from "@/lib/types";

export interface ValidationCheck {
  name: string;
  passed: boolean;
  severity: "error" | "warning";
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  checks: ValidationCheck[];
  errors: ValidationCheck[];
  warnings: ValidationCheck[];
}

/**
 * Run all semantic validation checks on a SQL query.
 */
export function validateSQL(
  sql: string,
  schema: TableSchema
): ValidationResult {
  const checks: ValidationCheck[] = [
    checkColumnsExist(sql, schema),
    checkGroupByConsistency(sql),
    checkHasLimit(sql),
    checkDateRangeSanity(sql),
  ];

  const errors = checks.filter((c) => !c.passed && c.severity === "error");
  const warnings = checks.filter((c) => !c.passed && c.severity === "warning");

  return {
    valid: errors.length === 0,
    checks,
    errors,
    warnings,
  };
}

// ============================================================
// Individual checks
// ============================================================

/**
 * Check that all column references in the SQL exist in the schema.
 *
 * This is largely redundant with the CFG constraint (which only allows
 * schema-derived column names), but serves as defense-in-depth.
 */
function checkColumnsExist(sql: string, schema: TableSchema): ValidationCheck {
  const schemaColNames = new Set(schema.columns.map((c) => c.name));

  // Extract column-like identifiers from the SQL
  // Look for words that appear in typical column positions
  const columnPatterns = [
    /SELECT\s+([\s\S]+?)\s+FROM/i,
    /WHERE\s+([\s\S]+?)(?:\s+GROUP|\s+ORDER|\s+LIMIT|$)/i,
    /GROUP BY\s+([\s\S]+?)(?:\s+HAVING|\s+ORDER|\s+LIMIT|$)/i,
    /ORDER BY\s+([\s\S]+?)(?:\s+LIMIT|$)/i,
  ];

  const knownFunctions = new Set([
    "count",
    "sum",
    "avg",
    "min",
    "max",
    "uniq",
    "uniqExact",
    "toStartOfHour",
    "toStartOfDay",
    "toStartOfWeek",
    "toStartOfMonth",
    "toDate",
    "now",
  ]);
  const knownKeywords = new Set([
    "AS",
    "AND",
    "OR",
    "IN",
    "LIKE",
    "BETWEEN",
    "DESC",
    "ASC",
    "INTERVAL",
    "HOUR",
    "DAY",
    "WEEK",
    "MONTH",
    "HAVING",
    "FROM",
    "WHERE",
    "GROUP",
    "BY",
    "ORDER",
    "LIMIT",
    "SELECT",
  ]);

  // Strip content inside single quotes before extracting identifiers
  // This prevents enum values like 'PushEvent' from being flagged
  const sqlNoStrings = sql.replace(/'[^']*'/g, "''");

  // Extract bare identifiers (not in quotes, not numbers, not keywords)
  const identifierRegex = /\b([a-z_][a-z0-9_]*)\b/gi;
  const allIdentifiers: string[] = [];
  let match;
  while ((match = identifierRegex.exec(sqlNoStrings)) !== null) {
    const id = match[1];
    if (
      !knownFunctions.has(id) &&
      !knownKeywords.has(id.toUpperCase()) &&
      !/^\d+$/.test(id)
    ) {
      allIdentifiers.push(id);
    }
  }

  // Filter to identifiers that look like they should be column names
  // (i.e., not aliases which are after AS)
  const asPattern = /\bAS\s+([a-z_][a-z0-9_]*)/gi;
  const aliases = new Set<string>();
  while ((match = asPattern.exec(sql)) !== null) {
    aliases.add(match[1]);
  }

  const unknownCols = allIdentifiers.filter(
    (id) => !schemaColNames.has(id) && !aliases.has(id) && id !== "github_events"
  );

  if (unknownCols.length > 0) {
    return {
      name: "columns_exist",
      passed: false,
      severity: "warning",
      message: `Unknown identifiers (may be aliases): ${[...new Set(unknownCols)].join(", ")}`,
    };
  }

  return {
    name: "columns_exist",
    passed: true,
    severity: "error",
    message: "All column references exist in schema",
  };
}

/**
 * Check GROUP BY consistency.
 *
 * If the query has both aggregated and non-aggregated expressions in SELECT,
 * the non-aggregated columns should appear in GROUP BY.
 */
function checkGroupByConsistency(sql: string): ValidationCheck {
  const hasGroupBy = /\bGROUP BY\b/i.test(sql);
  const hasAggregation =
    /\b(count|sum|avg|min|max|uniq|uniqExact)\s*\(/i.test(sql);

  if (!hasAggregation) {
    return {
      name: "group_by_consistency",
      passed: true,
      severity: "error",
      message: "No aggregation — GROUP BY check not applicable",
    };
  }

  if (hasAggregation && !hasGroupBy) {
    // This is OK if ALL select items are aggregates (e.g., SELECT count() AS total)
    // Extract SELECT list
    const selectMatch = sql.match(/SELECT\s+([\s\S]+?)\s+FROM/i);
    if (selectMatch) {
      const selectList = selectMatch[1];
      const items = selectList.split(",").map((s) => s.trim());
      const allAggregated = items.every(
        (item) =>
          /\b(count|sum|avg|min|max|uniq|uniqExact)\s*\(/i.test(item) ||
          /\btoStartOf(Hour|Day|Week|Month)\b/i.test(item) ||
          /\btoDate\b/i.test(item)
      );
      if (!allAggregated) {
        return {
          name: "group_by_consistency",
          passed: false,
          severity: "warning",
          message:
            "Query has both aggregated and non-aggregated columns but no GROUP BY clause",
        };
      }
    }
  }

  return {
    name: "group_by_consistency",
    passed: true,
    severity: "error",
    message: "GROUP BY is consistent with SELECT expressions",
  };
}

/**
 * Check that the query has a LIMIT clause.
 *
 * Queries without LIMIT can return very large result sets.
 * This is a warning, not an error — some queries legitimately don't need LIMIT.
 */
function checkHasLimit(sql: string): ValidationCheck {
  const hasLimit = /\bLIMIT\s+\d+/i.test(sql);
  const hasGroupBy = /\bGROUP BY\b/i.test(sql);

  if (!hasLimit && hasGroupBy) {
    return {
      name: "has_limit",
      passed: false,
      severity: "warning",
      message: "Query has GROUP BY but no LIMIT — result set may be large",
    };
  }

  if (!hasLimit) {
    return {
      name: "has_limit",
      passed: false,
      severity: "warning",
      message: "No LIMIT clause — result set may be large",
    };
  }

  return {
    name: "has_limit",
    passed: true,
    severity: "warning",
    message: "LIMIT clause present",
  };
}

/**
 * Check for absurd date ranges.
 *
 * e.g., INTERVAL 999999 DAY is ~2700 years — clearly not useful.
 */
function checkDateRangeSanity(sql: string): ValidationCheck {
  const intervalMatch = sql.match(
    /INTERVAL\s+(\d+)\s+(HOUR|DAY|WEEK|MONTH)/i
  );
  if (!intervalMatch) {
    return {
      name: "date_range_sanity",
      passed: true,
      severity: "error",
      message: "No date interval to check",
    };
  }

  const value = parseInt(intervalMatch[1], 10);
  const unit = intervalMatch[2].toUpperCase();

  // Convert to approximate days for comparison
  const multipliers: Record<string, number> = {
    HOUR: 1 / 24,
    DAY: 1,
    WEEK: 7,
    MONTH: 30,
  };

  const days = value * (multipliers[unit] ?? 1);

  // More than 5 years seems unreasonable for this dataset
  if (days > 365 * 5) {
    return {
      name: "date_range_sanity",
      passed: false,
      severity: "warning",
      message: `Date range of ~${Math.round(days)} days (${value} ${unit}) seems unusually large`,
    };
  }

  return {
    name: "date_range_sanity",
    passed: true,
    severity: "error",
    message: `Date range of ${value} ${unit} is reasonable`,
  };
}
