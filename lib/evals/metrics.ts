/*
 * Computes precision, recall, and accuracy from eval results.
 * Each eval category uses the metric most relevant to what
 * it measures:
 *   - Grammar Coverage  → Recall (did we accept all valid queries?)
 *   - Grammar Safety    → Precision (did we reject all dangerous queries?)
 *   - Semantic          → Accuracy (did the pipeline produce correct output?)
 *   - Degradation       → Accuracy (did the classifier choose correctly?)
 */

import type { EvalCaseResult, EvalCategorySummary, EvalCategory } from "@/lib/types";

/**
 * Compute the summary for a single eval category.
 */
export function computeCategorySummary(
  category: EvalCategory,
  results: EvalCaseResult[]
): EvalCategorySummary {
  const categoryResults = results.filter((r) => r.category === category);
  const total = categoryResults.length;
  const passed = categoryResults.filter((r) => r.passed).length;
  const metric = total > 0 ? passed / total : 0;

  const metricNames: Record<EvalCategory, string> = {
    "grammar-coverage": "recall",
    "grammar-safety": "precision",
    semantic: "accuracy",
    degradation: "accuracy",
    adequacy: "accuracy",
  };

  return {
    total,
    passed,
    metric,
    metricName: metricNames[category],
  };
}

/**
 * Compute the full summary across all eval categories.
 */
export function computeFullSummary(results: EvalCaseResult[]) {
  const categories: EvalCategory[] = [
    "grammar-coverage",
    "grammar-safety",
    "semantic",
    "degradation",
    "adequacy",
  ];

  const byCategory: Record<string, EvalCategorySummary> = {};
  for (const cat of categories) {
    const catResults = results.filter((r) => r.category === cat);
    if (catResults.length > 0) {
      byCategory[cat] = computeCategorySummary(cat, results);
    }
  }

  const total = results.length;
  const passed = results.filter((r) => r.passed).length;

  return {
    total,
    passed,
    failed: total - passed,
    byCategory,
  };
}
