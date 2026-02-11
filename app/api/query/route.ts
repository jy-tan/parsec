import { NextRequest, NextResponse } from "next/server";
import { classifyIntent } from "@/lib/intent/classifier";
import { generateSQL } from "@/lib/sql/generator";
import { validateSQL } from "@/lib/sql/validator";
import { checkResultAdequacy } from "@/lib/sql/result-checker";
import { executeQuery } from "@/lib/clickhouse/client";
import { getTableSchema } from "@/lib/clickhouse/schema";
import { parseQuery } from "@/lib/cfg/grammar-parser";
import { detectVisualization } from "@/lib/viz/detect";
import { generateAnswer } from "@/lib/viz/summarize";
import type { QueryResponse } from "@/lib/types";

// Hardcoded suggestion pool for impossible / out-of-scope queries
const SUGGESTION_POOL = [
  "Top 10 repos by push events",
  "Most active contributors today",
  "Hourly event counts on 2025-11-01",
  "Repos with the most pull requests",
  "Number of issues opened per hour",
  "Top repos by WatchEvent (stars)",
  "Most commented issues",
  "Push vs pull request activity over time",
  "Repos with the most forks (ForkEvent)",
  "Which users opened the most pull requests",
];

function sampleSuggestions(n = 3): string[] {
  const shuffled = [...SUGGESTION_POOL].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

/**
 * POST /api/query
 *
 * Main query pipeline endpoint.
 *
 * Pipeline:
 *   1. Intent classification (ANSWERABLE / AMBIGUOUS / IMPOSSIBLE / OUT_OF_SCOPE)
 *   2. Generate SQL via GPT-5 + CFG grammar constraint (only if ANSWERABLE)
 *   3. Semantic validation (GROUP BY consistency, LIMIT, date range)
 *   4. Execute against ClickHouse
 *   5. Detect result shape for visualization
 *   6. Parse grammar derivation tree
 *   7. Generate natural language answer
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query } = body;

    if (!query || typeof query !== "string") {
      return NextResponse.json(
        { status: "error", message: "Missing or invalid 'query' field" } satisfies QueryResponse,
        { status: 400 }
      );
    }

    // ── Step 1: Intent classification ─────────────────────────

    let intentResult;
    try {
      intentResult = await classifyIntent(query);
    } catch (err) {
      console.warn("[query] Intent classification failed, defaulting to ANSWERABLE:", err);
      intentResult = {
        classification: "ANSWERABLE" as const,
        reasoning: "Intent classification unavailable",
      };
    }

    // Handle non-answerable intents
    if (intentResult.classification === "AMBIGUOUS") {
      // For ambiguous queries, prefer LLM-generated clarifications since they're contextual
      const suggestions = intentResult.clarifications?.length
        ? intentResult.clarifications
        : sampleSuggestions();
      return NextResponse.json({
        status: "clarification_needed",
        intentClassification: "AMBIGUOUS",
        message: intentResult.reasoning,
        suggestions,
      } satisfies QueryResponse);
    }

    if (intentResult.classification === "IMPOSSIBLE") {
      return NextResponse.json({
        status: "impossible",
        intentClassification: "IMPOSSIBLE",
        message: intentResult.reasoning,
        suggestions: sampleSuggestions(),
      } satisfies QueryResponse);
    }

    if (intentResult.classification === "OUT_OF_SCOPE") {
      return NextResponse.json({
        status: "out_of_scope",
        intentClassification: "OUT_OF_SCOPE",
        message: intentResult.reasoning,
        suggestions: sampleSuggestions(),
      } satisfies QueryResponse);
    }

    // ── Steps 2-4: Generate SQL -> Validate -> Execute (with retry) ──

    const MAX_ATTEMPTS = 3;
    let sql = "";
    let rows: Record<string, unknown>[] = [];
    let columns: { name: string; type: string }[] = [];
    let executionTimeMs = 0;
    let feedback: string | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // Step 2: Generate SQL via GPT-5 + CFG
      try {
        const genResult = await generateSQL(query, feedback);
        sql = genResult.sql;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "SQL generation failed";
        return NextResponse.json({
          status: "error",
          message: `SQL generation failed: ${message}`,
        } satisfies QueryResponse);
      }

      // Step 3: Semantic validation
      const schema = await getTableSchema();
      const validation = validateSQL(sql, schema);

      if (validation.warnings.length > 0) {
        console.warn(
          `[query] Attempt ${attempt} validation warnings:`,
          validation.warnings.map((w) => w.message),
        );
      }

      if (!validation.valid) {
        if (attempt < MAX_ATTEMPTS) {
          feedback = `SQL "${sql}" failed semantic validation: ${validation.errors.map((e) => e.message).join("; ")}. Fix these issues.`;
          console.log(`[query] Attempt ${attempt} failed validation, retrying...`);
          continue;
        }
        return NextResponse.json({
          status: "error",
          message: `Semantic validation failed: ${validation.errors.map((e) => e.message).join("; ")}`,
          sql,
        } satisfies QueryResponse);
      }

      // Step 4: Execute against ClickHouse
      try {
        const result = await executeQuery(sql);
        rows = result.rows;
        columns = result.columns;
        executionTimeMs = result.executionTimeMs;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Query execution failed";
        if (attempt < MAX_ATTEMPTS) {
          feedback = `SQL "${sql}" failed to execute: ${message}. Generate a corrected query.`;
          console.log(`[query] Attempt ${attempt} execution failed, retrying...`);
          continue;
        }
        return NextResponse.json({
          status: "error",
          message: `ClickHouse execution failed: ${message}`,
          sql,
        } satisfies QueryResponse);
      }

      // Step 4b: LLM result adequacy check
      // Skip on final attempt (just return the result)
      if (attempt < MAX_ATTEMPTS) {
        try {
          const check = await checkResultAdequacy(query, sql, columns, rows);
          if (!check.adequate) {
            feedback = `SQL "${sql}" returned ${rows.length} row(s) but the result doesn't answer the question. Issue: ${check.feedback}`;
            console.log(`[query] Attempt ${attempt} inadequate result: ${check.feedback}. Retrying...`);
            continue;
          }
        } catch (err) {
          console.warn("[query] Result adequacy check failed, proceeding:", err);
        }
      }

      // If we get here, the result is acceptable
      break;
    }

    // ── Step 5: Detect visualization type ─────────────────────

    const visualizationHint = detectVisualization(columns, rows);

    // ── Step 6: Parse grammar derivation tree ─────────────────

    const grammarDerivation = parseQuery(sql);

    // ── Step 7: Generate NL summary (GPT-5 mini) ────────────────

    const answer = await generateAnswer(query, sql, columns, rows, visualizationHint);

    const response: QueryResponse = {
      status: "success",
      answer,
      sql,
      result: {
        columns,
        rows,
        rowCount: rows.length,
        executionTimeMs,
      },
      visualizationHint,
      grammarDerivation,
      intentClassification: "ANSWERABLE",
    };

    return NextResponse.json(response);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json(
      { status: "error", message } satisfies QueryResponse,
      { status: 500 }
    );
  }
}
