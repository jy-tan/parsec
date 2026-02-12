"use client";

import { useState, useCallback } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import type { EvalCaseResult, EvalCategorySummary, EvalCategory } from "@/lib/types";

interface EvalRunResult {
  summary: {
    total: number;
    passed: number;
    failed: number;
    byCategory: Record<string, EvalCategorySummary>;
  };
  results: EvalCaseResult[];
}

const CATEGORY_META: Record<
  EvalCategory,
  { label: string; level: string; color: string; tip: string }
> = {
  "grammar-coverage": {
    label: "Grammar Coverage",
    level: "Grammar",
    color: "text-cyan-400",
    tip: "Recall — can the CFG grammar express all supported query patterns? Deterministic, no API calls.",
  },
  "grammar-safety": {
    label: "Grammar Safety",
    level: "Grammar",
    color: "text-amber-400",
    tip: "Precision — does the grammar reject all dangerous SQL (injection, DDL, system access)? Deterministic, no API calls.",
  },
  semantic: {
    label: "Semantic Correctness",
    level: "Pipeline",
    color: "text-emerald-400",
    tip: "Accuracy — does the full NL → CFG → SQL → execution pipeline produce correct results? End-to-end. Requires dev server + OpenAI + ClickHouse.",
  },
  degradation: {
    label: "Graceful Degradation",
    level: "Model",
    color: "text-violet-400",
    tip: "Accuracy — does the intent classifier correctly route ambiguous, impossible, and out-of-scope queries? Requires OpenAI.",
  },
  adequacy: {
    label: "Response Adequacy",
    level: "Model",
    color: "text-rose-400",
    tip: "Accuracy — does the LLM result-checker correctly identify when SQL results do or don't answer the user's question? Requires OpenAI.",
  },
};

const ALL_CATEGORIES: EvalCategory[] = [
  "semantic",
  "grammar-coverage",
  "grammar-safety",
  "degradation",
  "adequacy",
];

export default function EvalsPage() {
  const [result, setResult] = useState<EvalRunResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategories, setSelectedCategories] =
    useState<EvalCategory[]>(ALL_CATEGORIES);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const runEvals = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const body: Record<string, unknown> = {};
      if (selectedCategories.length < ALL_CATEGORIES.length) {
        body.categories = selectedCategories;
      }

      const response = await fetch("/api/evals/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (data.status === "error") {
        setError(data.message);
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run evals");
    } finally {
      setLoading(false);
    }
  }, [selectedCategories]);

  const toggleCategory = (cat: EvalCategory) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const totalDuration = result
    ? result.results.reduce((sum, r) => sum + r.durationMs, 0)
    : 0;

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-5xl px-6 py-16">
        {/* ── Header ────────────────────────────────────── */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">
            <a href="/" className="text-emerald-400 hover:text-emerald-300">
              PARSEC
            </a>{" "}
            <span className="text-zinc-500 text-lg font-normal">
              / eval dashboard
            </span>
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            Pipeline, grammar, and model-level evaluations for correctness,
            safety, and robustness.
          </p>
        </div>

        {/* ── Category selector ─────────────────────────── */}
        <Tooltip.Provider delayDuration={250}>
          <div className="mb-6 flex flex-col gap-5">
            {/* Pipeline-level (end-to-end) */}
            <div className="flex items-start gap-4">
              <div className="w-24 shrink-0 pt-1.5">
                <span className="text-xs font-medium uppercase tracking-widest text-zinc-400">
                  Pipeline
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {(["semantic"] as EvalCategory[]).map((cat) => {
                  const meta = CATEGORY_META[cat];
                  const active = selectedCategories.includes(cat);
                  return (
                    <Tooltip.Root key={cat}>
                      <Tooltip.Trigger asChild>
                        <button
                          onClick={() => toggleCategory(cat)}
                          className={`rounded border px-3 py-1.5 text-xs tracking-wide transition-colors cursor-pointer ${
                            active
                              ? "border-zinc-600 bg-zinc-800 text-zinc-200"
                              : "border-zinc-800 bg-zinc-900 text-zinc-600"
                          }`}
                        >
                          <span
                            className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${
                              active ? "bg-emerald-400" : "bg-zinc-700"
                            }`}
                          />
                          {meta.label}
                        </button>
                      </Tooltip.Trigger>
                      <Tooltip.Portal>
                        <Tooltip.Content
                          side="bottom"
                          sideOffset={6}
                          className="z-50 max-w-xs rounded-md border border-zinc-800/60 bg-zinc-900/95 px-2.5 py-1.5 text-[11px] leading-snug text-zinc-400 shadow-lg backdrop-blur-sm animate-fade-in"
                        >
                          {meta.tip}
                          <Tooltip.Arrow className="fill-zinc-900/95" />
                        </Tooltip.Content>
                      </Tooltip.Portal>
                    </Tooltip.Root>
                  );
                })}
              </div>
            </div>

            {/* Grammar-level (deterministic) */}
            <div className="flex items-start gap-4">
              <div className="w-24 shrink-0 pt-1.5">
                <span className="text-xs font-medium uppercase tracking-widest text-zinc-400">
                  Grammar
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {(["grammar-coverage", "grammar-safety"] as EvalCategory[]).map((cat) => {
                  const meta = CATEGORY_META[cat];
                  const active = selectedCategories.includes(cat);
                  return (
                    <Tooltip.Root key={cat}>
                      <Tooltip.Trigger asChild>
                        <button
                          onClick={() => toggleCategory(cat)}
                          className={`rounded border px-3 py-1.5 text-xs tracking-wide transition-colors cursor-pointer ${
                            active
                              ? "border-zinc-600 bg-zinc-800 text-zinc-200"
                              : "border-zinc-800 bg-zinc-900 text-zinc-600"
                          }`}
                        >
                          <span
                            className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${
                              active ? "bg-emerald-400" : "bg-zinc-700"
                            }`}
                          />
                          {meta.label}
                        </button>
                      </Tooltip.Trigger>
                      <Tooltip.Portal>
                        <Tooltip.Content
                          side="bottom"
                          sideOffset={6}
                          className="z-50 max-w-xs rounded-md border border-zinc-800/60 bg-zinc-900/95 px-2.5 py-1.5 text-[11px] leading-snug text-zinc-400 shadow-lg backdrop-blur-sm animate-fade-in"
                        >
                          {meta.tip}
                          <Tooltip.Arrow className="fill-zinc-900/95" />
                        </Tooltip.Content>
                      </Tooltip.Portal>
                    </Tooltip.Root>
                  );
                })}
              </div>
            </div>

            {/* Model-level (LLM component tests) */}
            <div className="flex items-start gap-4">
              <div className="w-24 shrink-0 pt-1.5">
                <span className="text-xs font-medium uppercase tracking-widest text-zinc-400">
                  Model
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {(["degradation", "adequacy"] as EvalCategory[]).map((cat) => {
                  const meta = CATEGORY_META[cat];
                  const active = selectedCategories.includes(cat);
                  return (
                    <Tooltip.Root key={cat}>
                      <Tooltip.Trigger asChild>
                        <button
                          onClick={() => toggleCategory(cat)}
                          className={`rounded border px-3 py-1.5 text-xs tracking-wide transition-colors cursor-pointer ${
                            active
                              ? "border-zinc-600 bg-zinc-800 text-zinc-200"
                              : "border-zinc-800 bg-zinc-900 text-zinc-600"
                          }`}
                        >
                          <span
                            className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${
                              active ? "bg-emerald-400" : "bg-zinc-700"
                            }`}
                          />
                          {meta.label}
                        </button>
                      </Tooltip.Trigger>
                      <Tooltip.Portal>
                        <Tooltip.Content
                          side="bottom"
                          sideOffset={6}
                          className="z-50 max-w-xs rounded-md border border-zinc-800/60 bg-zinc-900/95 px-2.5 py-1.5 text-[11px] leading-snug text-zinc-400 shadow-lg backdrop-blur-sm animate-fade-in"
                        >
                          {meta.tip}
                          <Tooltip.Arrow className="fill-zinc-900/95" />
                        </Tooltip.Content>
                      </Tooltip.Portal>
                    </Tooltip.Root>
                  );
                })}
              </div>
            </div>
          </div>
        </Tooltip.Provider>

        {/* ── Run button ────────────────────────────────── */}
        <button
          onClick={runEvals}
          disabled={loading || selectedCategories.length === 0}
          className="mb-8 rounded bg-emerald-600 px-6 py-2.5 text-sm font-medium tracking-wider text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
              RUNNING EVALS
              <span className="animate-pulse">...</span>
            </span>
          ) : (
            "RUN EVALS"
          )}
        </button>

        {/* ── Error ─────────────────────────────────────── */}
        {error && (
          <div className="mb-6 rounded border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
            {error}
          </div>
        )}

        {/* ── Results ───────────────────────────────────── */}
        {result && (
          <div className="animate-fade-in space-y-6">
            {/* Summary bar */}
            <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/80 p-6">
              <div className="mb-4 flex items-baseline justify-between">
                <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">
                  SUMMARY
                </h2>
                <span className="text-xs text-zinc-600">
                  {totalDuration > 1000
                    ? `${(totalDuration / 1000).toFixed(1)}s`
                    : `${totalDuration}ms`}
                </span>
              </div>

              <div className="flex items-center gap-6">
                <div className="text-4xl font-bold tabular-nums">
                  <span className="text-emerald-400">
                    {result.summary.passed}
                  </span>
                  <span className="text-zinc-600">/{result.summary.total}</span>
                </div>

                {result.summary.failed > 0 && (
                  <span className="text-sm text-rose-400">
                    {result.summary.failed} failed
                  </span>
                )}
              </div>

              {/* Per-category metrics */}
              <div className="mt-6 space-y-3">
                {Object.entries(result.summary.byCategory).map(
                  ([cat, summary]) => {
                    const meta =
                      CATEGORY_META[cat as EvalCategory] ?? CATEGORY_META["semantic"];
                    const pct = Math.round(summary.metric * 100);
                    return (
                      <div key={cat} className="flex items-center gap-3">
                        <span
                          className={`w-44 text-xs font-medium ${meta.color}`}
                        >
                          {meta.label}
                        </span>
                        <div className="flex-1">
                          <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${
                                pct === 100
                                  ? "bg-emerald-500"
                                  : pct >= 80
                                    ? "bg-amber-500"
                                    : "bg-rose-500"
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                        <span className="w-20 text-right text-xs tabular-nums text-zinc-400">
                          {pct}% {summary.metricName}
                        </span>
                        <span className="w-12 text-right text-xs tabular-nums text-zinc-600">
                          {summary.passed}/{summary.total}
                        </span>
                      </div>
                    );
                  }
                )}
              </div>
            </div>

            {/* Per-category details (collapsible) */}
            {Object.entries(result.summary.byCategory).map(([cat]) => {
              const meta =
                CATEGORY_META[cat as EvalCategory] ?? CATEGORY_META["semantic"];
              const catResults = result.results.filter(
                (r) => r.category === cat
              );
              const isExpanded = expandedCategories.has(cat);

              return (
                <div
                  key={cat}
                  className="rounded-lg border border-zinc-700/50 bg-zinc-900/80"
                >
                  <button
                    onClick={() =>
                      setExpandedCategories((prev) => {
                        const next = new Set(prev);
                        if (next.has(cat)) {
                          next.delete(cat);
                        } else {
                          next.add(cat);
                        }
                        return next;
                      })
                    }
                    className="flex w-full items-center justify-between p-4 text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-zinc-600">
                        {isExpanded ? "−" : "+"}
                      </span>
                      <span
                        className={`text-sm font-medium ${meta.color}`}
                      >
                        {meta.label}
                      </span>
                      <span className="text-xs text-zinc-600">
                        {meta.level}-level
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {catResults.filter((r) => !r.passed).length > 0 && (
                        <span className="text-xs text-rose-400">
                          {catResults.filter((r) => !r.passed).length} failed
                        </span>
                      )}
                      <span className="text-xs tabular-nums text-zinc-500">
                        {catResults.filter((r) => r.passed).length}/
                        {catResults.length}
                      </span>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-zinc-800 px-4 pb-4">
                      <table className="mt-3 w-full text-xs">
                        <thead>
                          <tr className="text-left text-zinc-600 uppercase tracking-widest">
                            <th className="pb-2 pr-3 w-6"></th>
                            <th className="pb-2 pr-3">ID</th>
                            <th className="pb-2 pr-3">Description</th>
                            <th className="pb-2 pr-3 text-right">Time</th>
                          </tr>
                        </thead>
                        <tbody>
                          {catResults.map((r) => (
                            <tr
                              key={r.id}
                              className="border-t border-zinc-800/50"
                            >
                              <td className="py-2 pr-3">
                                {r.passed ? (
                                  <span className="text-emerald-400">✓</span>
                                ) : (
                                  <span className="text-rose-400">✗</span>
                                )}
                              </td>
                              <td className="py-2 pr-3 font-mono text-zinc-300">
                                {r.id}
                              </td>
                              <td className="py-2 pr-3 text-zinc-400">
                                {r.description}
                                {!r.passed && (
                                  <div className="mt-1 text-rose-400/80">
                                    {r.details}
                                  </div>
                                )}
                              </td>
                              <td className="py-2 text-right tabular-nums text-zinc-600">
                                {r.durationMs}ms
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── CLI hint ──────────────────────────────────── */}
        {!result && !loading && (
          <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/80 p-8 text-center text-zinc-500">
            <p className="text-sm">
              Select categories and click{" "}
              <span className="text-emerald-400">RUN EVALS</span> to start.
            </p>
            <p className="mt-3 text-xs text-zinc-600">
              Or run from the CLI:{" "}
              <code className="text-emerald-400/80">npm run evals</code>
            </p>
            <p className="mt-1 text-xs text-zinc-600">
              Grammar evals are deterministic and fast. Pipeline evals require
              dev server + OpenAI + ClickHouse. Model evals require OpenAI only.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
