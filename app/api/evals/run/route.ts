import { NextRequest, NextResponse } from "next/server";
import { runEvals } from "@/lib/evals/runner";
import type { EvalCategory } from "@/lib/types";

const VALID_CATEGORIES: EvalCategory[] = [
  "grammar-coverage",
  "grammar-safety",
  "semantic",
  "degradation",
  "adequacy",
];

/**
 * POST /api/evals/run
 *
 * Triggers eval execution and returns results.
 *
 * Request body (optional):
 *   { "categories": ["grammar-coverage", "grammar-safety"] }
 *   Omit categories to run all.
 *
 * Response:
 *   { summary: { total, passed, failed, byCategory }, results: [...] }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const requestedCategories: string[] | undefined = body.categories;

    // Validate categories if provided
    let categories: EvalCategory[] | undefined;
    if (requestedCategories && Array.isArray(requestedCategories)) {
      const invalid = requestedCategories.filter(
        (c) => !VALID_CATEGORIES.includes(c as EvalCategory)
      );
      if (invalid.length > 0) {
        return NextResponse.json(
          {
            status: "error",
            message: `Invalid categories: ${invalid.join(", ")}. Valid: ${VALID_CATEGORIES.join(", ")}`,
          },
          { status: 400 }
        );
      }
      categories = requestedCategories as EvalCategory[];
    }

    const result = await runEvals({ categories, concurrency: 5 });

    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Eval run failed";
    return NextResponse.json(
      { status: "error", message },
      { status: 500 }
    );
  }
}
