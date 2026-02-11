#!/usr/bin/env npx tsx
/**
 * CLI eval runner for Parsec.
 *
 * Runs evals directly (grammar-level) or via the dev server (model-level).
 * Grammar-level evals don't need a running server or API keys.
 *
 * Usage:
 *   npm run evals                              # Run all categories
 *   npm run evals -- --category grammar-coverage
 *   npm run evals -- --category grammar-safety
 *   npm run evals -- --category semantic       # Requires running dev server + OpenAI + ClickHouse
 *   npm run evals -- --category degradation    # Requires running dev server + OpenAI
 *   npm run evals -- --category adequacy       # Requires OpenAI only (no server needed)
 *   npm run evals -- --format json > eval-results.json
 */

import type { EvalCategory, EvalCaseResult, EvalCategorySummary } from "../lib/types/index";

// ── Argument parsing ──────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : undefined;
}

const categoryFilter = getArg("category") as EvalCategory | undefined;
const outputFormat = getArg("format") || "text";

const VALID_CATEGORIES: EvalCategory[] = [
  "grammar-coverage",
  "grammar-safety",
  "semantic",
  "degradation",
  "adequacy",
];

if (categoryFilter && !VALID_CATEGORIES.includes(categoryFilter)) {
  console.error(
    `Invalid category: ${categoryFilter}\nValid: ${VALID_CATEGORIES.join(", ")}`
  );
  process.exit(1);
}

// ── Grammar-level evals (run directly, no server needed) ──────

// Dynamic import to resolve @/ aliases — tsx handles this
async function runGrammarEvals(): Promise<EvalCaseResult[]> {
  const { isValidGrammarSQL } = await import("../lib/cfg/grammar-parser");
  const { COVERAGE_CASES } = await import("../lib/evals/cases/coverage");
  const { SAFETY_CASES } = await import("../lib/evals/cases/safety");

  const results: EvalCaseResult[] = [];

  if (!categoryFilter || categoryFilter === "grammar-coverage") {
    for (const tc of COVERAGE_CASES) {
      const start = Date.now();
      const parsed = isValidGrammarSQL(tc.targetSQL);
      results.push({
        id: tc.id,
        category: "grammar-coverage",
        description: tc.description,
        passed: parsed === tc.shouldParse,
        details: parsed
          ? "Grammar accepted the SQL (expected)"
          : `Grammar rejected: ${tc.targetSQL}`,
        durationMs: Date.now() - start,
      });
    }
  }

  if (!categoryFilter || categoryFilter === "grammar-safety") {
    for (const tc of SAFETY_CASES) {
      const start = Date.now();
      const parsed = isValidGrammarSQL(tc.dangerousSQL);
      const passed = !parsed;
      results.push({
        id: tc.id,
        category: "grammar-safety",
        description: tc.description,
        passed,
        details: passed
          ? "Grammar correctly rejected dangerous SQL"
          : `DANGER: Grammar accepted: ${tc.dangerousSQL}`,
        durationMs: Date.now() - start,
      });
    }
  }

  return results;
}

// ── Model-level evals (call running dev server) ───────────────

async function runModelEvals(): Promise<EvalCaseResult[]> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const results: EvalCaseResult[] = [];

  // Check if server is reachable
  try {
    await fetch(`${baseUrl}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "test" }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    console.error(
      `\nCannot reach dev server at ${baseUrl}.`
    );
    console.error(
      "Model-level evals (semantic, degradation) require a running dev server."
    );
    console.error("Start it with: npm run dev\n");
    return [];
  }

  if (!categoryFilter || categoryFilter === "semantic") {
    const { SEMANTIC_CASES } = await import("../lib/evals/cases/semantic");
    for (const tc of SEMANTIC_CASES) {
      const start = Date.now();
      try {
        const response = await fetch(`${baseUrl}/api/query`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: tc.nlQuery }),
        });
        const data = await response.json();
        const durationMs = Date.now() - start;

        if (data.status !== "success") {
          results.push({
            id: tc.id,
            category: "semantic",
            description: tc.description,
            passed: false,
            details: `Pipeline returned: ${data.status} — ${data.message || ""}`,
            durationMs,
          });
          continue;
        }

        const sql: string = data.sql || "";
        const sqlUpper = sql.toUpperCase();
        const columns: { name: string; type: string }[] = data.result?.columns || [];
        const rows: Record<string, unknown>[] = data.result?.rows || [];
        const issues: string[] = [];

        // SQL fragment checks
        for (const frag of tc.expectedSQLContains) {
          if (!sqlUpper.includes(frag.toUpperCase())) {
            issues.push(`Missing SQL fragment: "${frag}"`);
          }
        }

        // Result shape checks
        const exp = tc.expectedResult;
        if (exp.minRows !== undefined && rows.length < exp.minRows)
          issues.push(`Expected ≥${exp.minRows} rows, got ${rows.length}`);
        if (exp.maxRows !== undefined && rows.length > exp.maxRows)
          issues.push(`Expected ≤${exp.maxRows} rows, got ${rows.length}`);
        if (exp.requiredColumns) {
          const names = columns.map((c) => c.name.toLowerCase());
          for (const req of exp.requiredColumns) {
            if (!names.includes(req.toLowerCase()))
              issues.push(`Missing column: ${req}`);
          }
        }
        if (exp.hasNumericColumn) {
          const hasNum = columns.some((c) =>
            /^(UInt|Int|Float|Decimal)/.test(c.type)
          );
          if (!hasNum) issues.push("Expected numeric column");
        }
        if (exp.hasDateColumn) {
          const hasDate = columns.some((c) => c.type.includes("Date"));
          if (!hasDate) issues.push("Expected date column");
        }

        results.push({
          id: tc.id,
          category: "semantic",
          description: tc.description,
          passed: issues.length === 0,
          details:
            issues.length === 0
              ? `OK | ${rows.length} row(s) | SQL: ${sql}`
              : `${issues.join("; ")} | SQL: ${sql}`,
          durationMs,
        });
      } catch (err) {
        results.push({
          id: tc.id,
          category: "semantic",
          description: tc.description,
          passed: false,
          details: `Error: ${err instanceof Error ? err.message : String(err)}`,
          durationMs: Date.now() - start,
        });
      }
    }
  }

  if (!categoryFilter || categoryFilter === "degradation") {
    const { DEGRADATION_CASES } = await import(
      "../lib/evals/cases/degradation"
    );
    for (const tc of DEGRADATION_CASES) {
      const start = Date.now();
      try {
        const response = await fetch(`${baseUrl}/api/query`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: tc.nlQuery }),
        });
        const data = await response.json();
        const durationMs = Date.now() - start;

        let actual = "UNKNOWN";
        if (data.status === "success") actual = "ANSWERABLE";
        else if (data.intentClassification) actual = data.intentClassification;
        else if (data.status === "clarification_needed") actual = "AMBIGUOUS";
        else if (data.status === "impossible") actual = "IMPOSSIBLE";
        else if (data.status === "out_of_scope") actual = "OUT_OF_SCOPE";
        else if (data.status === "error") actual = "ANSWERABLE";

        const acceptable = [
          tc.expectedBehavior,
          ...(tc.acceptableAlternatives || []),
        ];
        const passed = acceptable.includes(actual);

        results.push({
          id: tc.id,
          category: "degradation",
          description: tc.description,
          passed,
          details: passed
            ? `Correctly classified as ${actual}`
            : `Expected ${acceptable.join(" or ")}, got ${actual}`,
          durationMs,
        });
      } catch (err) {
        results.push({
          id: tc.id,
          category: "degradation",
          description: tc.description,
          passed: false,
          details: `Error: ${err instanceof Error ? err.message : String(err)}`,
          durationMs: Date.now() - start,
        });
      }
    }
  }

  return results;
}

// ── Adequacy evals (require OpenAI only, no server) ───────────

async function runAdequacyEvals(): Promise<EvalCaseResult[]> {
  if (categoryFilter && categoryFilter !== "adequacy") return [];
  if (!categoryFilter && !VALID_CATEGORIES.includes("adequacy")) return [];

  const { ADEQUACY_CASES } = await import("../lib/evals/cases/adequacy");
  const { checkResultAdequacy } = await import("../lib/sql/result-checker");

  const results: EvalCaseResult[] = [];

  for (const tc of ADEQUACY_CASES) {
    const start = Date.now();
    try {
      const result = await checkResultAdequacy(
        tc.userQuery,
        tc.sql,
        tc.columns,
        tc.rows,
      );
      const durationMs = Date.now() - start;
      const passed = result.adequate === tc.expectedAdequate;

      results.push({
        id: tc.id,
        category: "adequacy",
        description: tc.description,
        passed,
        details: passed
          ? tc.expectedAdequate
            ? "Checker correctly accepted adequate result"
            : `Checker correctly rejected: ${result.feedback}`
          : tc.expectedAdequate
            ? `Checker incorrectly rejected: ${result.feedback}`
            : "Checker incorrectly accepted inadequate result",
        durationMs,
      });
    } catch (err) {
      results.push({
        id: tc.id,
        category: "adequacy",
        description: tc.description,
        passed: false,
        details: `Error: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: Date.now() - start,
      });
    }
  }

  return results;
}

// ── Output formatting ─────────────────────────────────────────

function computeSummary(results: EvalCaseResult[]) {
  const categories = [...new Set(results.map((r) => r.category))];
  const byCategory: Record<string, EvalCategorySummary> = {};

  const metricNames: Record<string, string> = {
    "grammar-coverage": "recall",
    "grammar-safety": "precision",
    semantic: "accuracy",
    degradation: "accuracy",
    adequacy: "accuracy",
  };

  for (const cat of categories) {
    const catResults = results.filter((r) => r.category === cat);
    const total = catResults.length;
    const passed = catResults.filter((r) => r.passed).length;
    byCategory[cat] = {
      total,
      passed,
      metric: total > 0 ? passed / total : 0,
      metricName: metricNames[cat] || "accuracy",
    };
  }

  return {
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    byCategory,
  };
}

function printTextOutput(results: EvalCaseResult[]) {
  const summary = computeSummary(results);

  console.log("╔══════════════════════════════════════════╗");
  console.log("║          PARSEC EVAL RESULTS             ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log();

  // Per-category breakdown
  for (const [cat, catSummary] of Object.entries(summary.byCategory)) {
    const pct = (catSummary.metric * 100).toFixed(0);
    const bar = "█".repeat(Math.round(catSummary.metric * 20)).padEnd(20, "░");
    console.log(
      `  ${cat.padEnd(20)} ${bar} ${pct}% ${catSummary.metricName} (${catSummary.passed}/${catSummary.total})`
    );
  }

  console.log();
  console.log(
    `  TOTAL: ${summary.passed}/${summary.total} passed, ${summary.failed} failed`
  );
  console.log();

  // Show failures
  const failures = results.filter((r) => !r.passed);
  if (failures.length > 0) {
    console.log("  FAILURES:");
    console.log("  ─────────");
    for (const f of failures) {
      console.log(`  ✗ [${f.category}] ${f.id}: ${f.description}`);
      console.log(`    ${f.details}`);
      console.log();
    }
  }

  // Show all results
  console.log("  ALL RESULTS:");
  console.log("  ────────────");
  for (const r of results) {
    const icon = r.passed ? "✓" : "✗";
    const timeStr = r.durationMs > 0 ? ` (${r.durationMs}ms)` : "";
    console.log(`  ${icon} [${r.category}] ${r.id}${timeStr}`);
    if (!r.passed) {
      console.log(`    ${r.details}`);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  const needsGrammar =
    !categoryFilter ||
    categoryFilter === "grammar-coverage" ||
    categoryFilter === "grammar-safety";
  const needsModel =
    !categoryFilter ||
    categoryFilter === "semantic" ||
    categoryFilter === "degradation";
  const needsAdequacy =
    !categoryFilter || categoryFilter === "adequacy";

  const allResults: EvalCaseResult[] = [];

  if (needsGrammar) {
    const grammarResults = await runGrammarEvals();
    allResults.push(...grammarResults);
  }

  if (needsAdequacy) {
    const adequacyResults = await runAdequacyEvals();
    allResults.push(...adequacyResults);
  }

  if (needsModel) {
    const modelResults = await runModelEvals();
    allResults.push(...modelResults);
  }

  if (outputFormat === "json") {
    const summary = computeSummary(allResults);
    console.log(JSON.stringify({ summary, results: allResults }, null, 2));
  } else {
    printTextOutput(allResults);
  }

  // Exit with non-zero if any failures
  const failures = allResults.filter((r) => !r.passed);
  if (failures.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Eval runner crashed:", err);
  process.exit(2);
});
