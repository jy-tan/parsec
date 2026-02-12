/*
 * Runs eval cases across all five categories and collects
 * results. Grammar-level evals are deterministic and fast
 * (no API calls). Model-level evals require OpenAI + ClickHouse
 * (or OpenAI only for adequacy).
 * 
 * Can run all categories or a filtered subset.
 * Model-level evals run concurrently (configurable limit).
 */

import type { EvalCategory, EvalCaseResult, EvalRunResult } from "@/lib/types";
import { computeFullSummary } from "./metrics";

// Grammar-level imports (deterministic, no network)
import { isValidGrammarSQL } from "@/lib/cfg/grammar-parser";
import { COVERAGE_CASES } from "./cases/coverage";
import { SAFETY_CASES } from "./cases/safety";

// Model-level imports (require OpenAI + ClickHouse)
import { SEMANTIC_CASES } from "./cases/semantic";
import { DEGRADATION_CASES } from "./cases/degradation";

// Model-level imports (require OpenAI only)
import { ADEQUACY_CASES } from "./cases/adequacy";
import { checkResultAdequacy } from "@/lib/sql/result-checker";

// ============================================================
// Concurrency helper — worker-pool pattern
// ============================================================

async function runConcurrent<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIdx = 0;

  async function worker() {
    while (true) {
      const i = nextIdx++;
      if (i >= tasks.length) return;
      results[i] = await tasks[i]();
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, () => worker()),
  );
  return results;
}

// ============================================================
// Grammar Coverage Runner (Recall)
// ============================================================

function runCoverageCases(): EvalCaseResult[] {
  return COVERAGE_CASES.map((tc) => {
    const start = Date.now();
    const parsed = isValidGrammarSQL(tc.targetSQL);
    const durationMs = Date.now() - start;

    return {
      id: tc.id,
      category: "grammar-coverage" as EvalCategory,
      description: tc.description,
      passed: parsed === tc.shouldParse,
      details: parsed
        ? "Grammar accepted the SQL (expected)"
        : `Grammar rejected the SQL — parse failed for: ${tc.targetSQL}`,
      durationMs,
    };
  });
}

// ============================================================
// Grammar Safety Runner (Precision)
// ============================================================

function runSafetyCases(): EvalCaseResult[] {
  return SAFETY_CASES.map((tc) => {
    const start = Date.now();
    const parsed = isValidGrammarSQL(tc.dangerousSQL);
    const durationMs = Date.now() - start;

    // Safety: should NOT parse. parsed=false means the grammar rejected it (good).
    const passed = !parsed;

    return {
      id: tc.id,
      category: "grammar-safety" as EvalCategory,
      description: tc.description,
      passed,
      details: passed
        ? "Grammar correctly rejected the dangerous SQL"
        : `DANGER: Grammar accepted dangerous SQL: ${tc.dangerousSQL}`,
      durationMs,
    };
  });
}

// ============================================================
// Semantic Correctness — Task Factory (Model-Level)
// ============================================================

function makeSemanticTask(
  tc: (typeof SEMANTIC_CASES)[number],
): () => Promise<EvalCaseResult> {
  return async (): Promise<EvalCaseResult> => {
    const start = Date.now();
    try {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
      const response = await fetch(`${baseUrl}/api/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: tc.nlQuery }),
      });

      const data = await response.json();
      const durationMs = Date.now() - start;

      if (data.status !== "success") {
        return {
          id: tc.id,
          category: "semantic",
          description: tc.description,
          passed: false,
          details: `Pipeline returned non-success status: ${data.status} — ${data.message || ""}`,
          durationMs,
        };
      }

      // Check SQL structure
      const sql: string = data.sql || "";
      const sqlUpper = sql.toUpperCase();
      const missingFragments = tc.expectedSQLContains.filter(
        (frag) => !sqlUpper.includes(frag.toUpperCase())
      );

      // Check result shape
      const columns: { name: string; type: string }[] = data.result?.columns || [];
      const rows: Record<string, unknown>[] = data.result?.rows || [];
      const shapeErrors: string[] = [];

      if (tc.expectedResult.minRows !== undefined && rows.length < tc.expectedResult.minRows) {
        shapeErrors.push(`Expected ≥${tc.expectedResult.minRows} rows, got ${rows.length}`);
      }
      if (tc.expectedResult.maxRows !== undefined && rows.length > tc.expectedResult.maxRows) {
        shapeErrors.push(`Expected ≤${tc.expectedResult.maxRows} rows, got ${rows.length}`);
      }
      if (tc.expectedResult.requiredColumns) {
        const colNames = columns.map((c) => c.name.toLowerCase());
        for (const req of tc.expectedResult.requiredColumns) {
          if (!colNames.includes(req.toLowerCase())) {
            shapeErrors.push(`Missing required column: ${req}`);
          }
        }
      }
      if (tc.expectedResult.hasNumericColumn) {
        const hasNumeric = columns.some(
          (c) =>
            c.type.startsWith("UInt") ||
            c.type.startsWith("Int") ||
            c.type.startsWith("Float") ||
            c.type.startsWith("Decimal")
        );
        if (!hasNumeric) {
          shapeErrors.push("Expected at least one numeric column");
        }
      }
      if (tc.expectedResult.hasDateColumn) {
        const hasDate = columns.some(
          (c) =>
            c.type.includes("Date") || c.type.includes("DateTime")
        );
        if (!hasDate) {
          shapeErrors.push("Expected at least one date column");
        }
      }

      const allIssues = [
        ...missingFragments.map((f) => `Missing SQL fragment: "${f}"`),
        ...shapeErrors,
      ];

      const passed = allIssues.length === 0;

      return {
        id: tc.id,
        category: "semantic",
        description: tc.description,
        passed,
        details: passed
          ? `SQL: ${sql} | ${rows.length} row(s)`
          : `Issues: ${allIssues.join("; ")} | SQL: ${sql}`,
        durationMs,
      };
    } catch (err) {
      const durationMs = Date.now() - start;
      return {
        id: tc.id,
        category: "semantic",
        description: tc.description,
        passed: false,
        details: `Error: ${err instanceof Error ? err.message : String(err)}`,
        durationMs,
      };
    }
  };
}

// ============================================================
// Graceful Degradation — Task Factory (Model-Level)
// ============================================================

function makeDegradationTask(
  tc: (typeof DEGRADATION_CASES)[number],
): () => Promise<EvalCaseResult> {
  return async (): Promise<EvalCaseResult> => {
    const start = Date.now();
    try {
      const baseUrl =
        process.env.NEXT_PUBLIC_BASE_URL ||
        (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
      const response = await fetch(`${baseUrl}/api/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: tc.nlQuery }),
      });

      const data = await response.json();
      const durationMs = Date.now() - start;

      // Map response status to classification
      let actualClassification = "UNKNOWN";
      if (data.status === "success") {
        actualClassification = "ANSWERABLE";
      } else if (data.intentClassification) {
        actualClassification = data.intentClassification;
      } else if (data.status === "clarification_needed") {
        actualClassification = "AMBIGUOUS";
      } else if (data.status === "impossible") {
        actualClassification = "IMPOSSIBLE";
      } else if (data.status === "out_of_scope") {
        actualClassification = "OUT_OF_SCOPE";
      } else if (data.status === "error") {
        // Errors during ANSWERABLE pipeline still count as ANSWERABLE attempt
        actualClassification = "ANSWERABLE";
      }

      const acceptable = [
        tc.expectedBehavior,
        ...(tc.acceptableAlternatives || []),
      ];
      const passed = acceptable.includes(actualClassification);

      return {
        id: tc.id,
        category: "degradation",
        description: tc.description,
        passed,
        details: passed
          ? `Correctly classified as ${actualClassification}`
          : `Expected ${acceptable.join(" or ")}, got ${actualClassification}`,
        durationMs,
      };
    } catch (err) {
      const durationMs = Date.now() - start;
      return {
        id: tc.id,
        category: "degradation",
        description: tc.description,
        passed: false,
        details: `Error: ${err instanceof Error ? err.message : String(err)}`,
        durationMs,
      };
    }
  };
}

// ============================================================
// Response Adequacy — Task Factory (Model-Level, OpenAI only)
// ============================================================

function makeAdequacyTask(
  tc: (typeof ADEQUACY_CASES)[number],
): () => Promise<EvalCaseResult> {
  return async (): Promise<EvalCaseResult> => {
    const start = Date.now();
    try {
      const result = await checkResultAdequacy(
        tc.userQuery,
        tc.sql,
        tc.columns,
        tc.rows,
      );
      const durationMs = Date.now() - start;

      // The checker returns { adequate, feedback }.
      // The eval passes if the checker's judgment matches our expectation.
      const passed = result.adequate === tc.expectedAdequate;

      return {
        id: tc.id,
        category: "adequacy",
        description: tc.description,
        passed,
        details: passed
          ? tc.expectedAdequate
            ? "Checker correctly accepted adequate result"
            : `Checker correctly rejected: ${result.feedback}`
          : tc.expectedAdequate
            ? `Checker incorrectly rejected adequate result: ${result.feedback}`
            : `Checker incorrectly accepted inadequate result (expected rejection)`,
        durationMs,
      };
    } catch (err) {
      const durationMs = Date.now() - start;
      return {
        id: tc.id,
        category: "adequacy",
        description: tc.description,
        passed: false,
        details: `Error: ${err instanceof Error ? err.message : String(err)}`,
        durationMs,
      };
    }
  };
}

// ============================================================
// Main Runner
// ============================================================

export interface RunEvalsOptions {
  categories?: EvalCategory[];
  /** Max concurrent model-level tasks. Default: 1 (sequential). */
  concurrency?: number;
}

/**
 * Run evals for the specified categories (or all if not specified).
 * Grammar-level evals are synchronous; model-level evals are async.
 *
 * Model-level tasks from all selected categories are pooled together
 * and executed with the configured concurrency limit for maximum
 * throughput.
 */
export async function runEvals(
  options: RunEvalsOptions = {}
): Promise<EvalRunResult> {
  const allCategories: EvalCategory[] = [
    "grammar-coverage",
    "grammar-safety",
    "semantic",
    "degradation",
    "adequacy",
  ];
  const categoriesToRun = options.categories ?? allCategories;
  const concurrency = options.concurrency ?? 1;
  const results: EvalCaseResult[] = [];

  // Grammar-level evals (deterministic, fast)
  if (categoriesToRun.includes("grammar-coverage")) {
    results.push(...runCoverageCases());
  }
  if (categoriesToRun.includes("grammar-safety")) {
    results.push(...runSafetyCases());
  }

  // Model-level evals (async, concurrent)
  // All model tasks go into one pool for maximum throughput —
  // semantic and degradation cases run interleaved.
  const modelTasks: (() => Promise<EvalCaseResult>)[] = [];
  if (categoriesToRun.includes("semantic")) {
    modelTasks.push(...SEMANTIC_CASES.map((tc) => makeSemanticTask(tc)));
  }
  if (categoriesToRun.includes("degradation")) {
    modelTasks.push(...DEGRADATION_CASES.map((tc) => makeDegradationTask(tc)));
  }
  if (categoriesToRun.includes("adequacy")) {
    modelTasks.push(...ADEQUACY_CASES.map((tc) => makeAdequacyTask(tc)));
  }
  if (modelTasks.length > 0) {
    const modelResults = await runConcurrent(modelTasks, concurrency);
    results.push(...modelResults);
  }

  const summary = computeFullSummary(results);

  return { summary, results };
}
