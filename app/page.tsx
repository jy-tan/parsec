"use client";

import { Suspense, useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { format as formatSQL } from "sql-formatter";
import ClarificationCard from "@/components/ClarificationCard";
import ResultChart from "@/components/ResultChart";
import ResultTable from "@/components/ResultTable";
import ScalarResult from "@/components/ScalarResult";
import GrammarTree from "@/components/GrammarTree";
import SQLHighlight from "@/components/SQLHighlight";
import Pill from "@/components/Pill";
import * as Tooltip from "@radix-ui/react-tooltip";
import type {
  VisualizationType,
  QueryColumn,
  GrammarDerivationNode,
} from "@/lib/types";

// ── Response shapes from /api/query ──

interface SuccessResult {
  status: "success";
  answer: string;
  sql: string;
  result: {
    columns: QueryColumn[];
    rows: Record<string, unknown>[];
    rowCount: number;
    executionTimeMs: number;
  };
  visualizationHint: VisualizationType;
  grammarDerivation: GrammarDerivationNode | null;
  intentClassification: string;
}

interface ClarificationResult {
  status: "clarification_needed" | "impossible" | "out_of_scope";
  message: string;
  suggestions?: string[];
}

interface ErrorResult {
  status: "error";
  message: string;
  sql?: string;
}

type ApiResult = SuccessResult | ClarificationResult | ErrorResult;

function isSuccess(r: ApiResult): r is SuccessResult {
  return r.status === "success";
}
function isClarification(r: ApiResult): r is ClarificationResult {
  return (
    r.status === "clarification_needed" ||
    r.status === "impossible" ||
    r.status === "out_of_scope"
  );
}
function isError(r: ApiResult): r is ErrorResult {
  return r.status === "error";
}

// ── Schema columns for display ──

const SCHEMA_COLS: { name: string; tip: string }[] = [
  { name: "type", tip: "Event type (PushEvent, WatchEvent, IssuesEvent, …)" },
  { name: "actor_login", tip: "GitHub username who triggered the event" },
  { name: "repo_name", tip: "Repository in owner/name format" },
  { name: "created_at", tip: "UTC timestamp of the event" },
  { name: "action", tip: "Sub-action: opened, closed, created, edited, …" },
  { name: "number", tip: "Issue or pull request number" },
  { name: "title", tip: "Issue or pull request title" },
  { name: "ref", tip: "Git ref or branch name" },
];

const EVENT_TYPES: { name: string; tip: string }[] = [
  { name: "PushEvent", tip: "Commits pushed to a branch" },
  { name: "WatchEvent", tip: "User starred a repo (not 'watching')" },
  { name: "CreateEvent", tip: "Branch, tag, or repo created" },
  { name: "DeleteEvent", tip: "Branch or tag deleted" },
  { name: "IssuesEvent", tip: "Issue opened, closed, or edited" },
  { name: "IssueCommentEvent", tip: "Comment on an issue" },
  { name: "PullRequestEvent", tip: "PR opened, closed, or merged" },
  { name: "PullRequestReviewCommentEvent", tip: "Comment on a PR review" },
  { name: "PullRequestReviewEvent", tip: "PR review submitted" },
  { name: "ForkEvent", tip: "Repo forked" },
  { name: "ReleaseEvent", tip: "Release published" },
  { name: "CommitCommentEvent", tip: "Comment on a commit" },
  { name: "GollumEvent", tip: "Wiki page created or updated" },
  { name: "MemberEvent", tip: "Collaborator added to a repo" },
  { name: "PublicEvent", tip: "Repo made public" },
  { name: "SponsorshipEvent", tip: "Sponsorship started" },
];

function formatDateRange(minDate: string, maxDate: string): string {
  const fmt = (d: string) => {
    const date = new Date(d);
    if (isNaN(date.getTime())) return d;
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };
  const min = fmt(minDate);
  const max = fmt(maxDate);
  return min === max ? min : `${min} – ${max}`;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString("en-US");
}

const EXAMPLE_QUERIES = [
  "Top 10 repos by push events",
  "Hourly event breakdown on 2025-11-01",
  "Who opened the most pull requests?",
  "Issues vs PRs — which has more activity?",
];

// ── Page ──

function HomeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sqlOpen, setSqlOpen] = useState(false);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [stats, setStats] = useState<{
    totalEvents: number;
    minDate: string;
    maxDate: string;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const didAutoRun = useRef(false);

  const submitQuery = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    setResult(null);
    setSqlOpen(false);

    // Sync query to URL
    const url = new URL(window.location.href);
    url.searchParams.set("q", q);
    router.replace(url.pathname + url.search, { scroll: false });

    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const data = await res.json();
      setResult(data as ApiResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    inputRef.current?.focus();
    fetch("/api/stats")
      .then((r) => r.json())
      .then((d) => setStats(d))
      .catch(() => {});
  }, []);

  // Auto-run query from URL on first load
  useEffect(() => {
    const q = searchParams.get("q");
    if (q && !didAutoRun.current) {
      didAutoRun.current = true;
      setQuery(q);
      submitQuery(q);
    }
  }, [searchParams, submitQuery]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    submitQuery(query);
  }

  function handleReset() {
    setQuery("");
    setResult(null);
    setError(null);
    setSqlOpen(false);
    router.replace("/", { scroll: false });
    inputRef.current?.focus();
  }

  function handleSuggestionClick(s: string) {
    setQuery(s);
    submitQuery(s);
  }

  const success = result && isSuccess(result) ? result : null;
  const clarification = result && isClarification(result) ? result : null;
  const apiError = result && isError(result) ? result : null;

  return (
    <Tooltip.Provider delayDuration={200}>
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-3xl px-6 py-14">

        {/* ── Header ── */}
        <header className="mb-12">
          <div className="flex items-baseline gap-3">
            <h1>
              <button
                onClick={handleReset}
                className="cursor-pointer text-2xl font-bold tracking-tight text-emerald-400 transition hover:text-emerald-300"
              >
                PARSEC
              </button>
            </h1>
            <span className="text-xs text-zinc-500">v0.1</span>
            <a
              href="/evals"
              className="ml-auto text-xs text-zinc-500 transition hover:text-emerald-400"
            >
              evals →
            </a>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            Natural language queries against GitHub event data,
            translated to provably valid ClickHouse SQL via CFG-constrained generation.
          </p>

          {/* Dataset info */}
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
            <span>{stats ? `${formatCount(stats.totalEvents)} events` : "loading…"}</span>
            <span className="text-zinc-700">|</span>
            <span>{stats ? formatDateRange(stats.minDate, stats.maxDate) : "–"}</span>
            <span className="text-zinc-700">|</span>
            <span>1 table, 10 columns</span>
            <span className="text-zinc-700">|</span>
            <button
              onClick={() => setEventsOpen(!eventsOpen)}
              className="cursor-pointer text-emerald-600 underline decoration-emerald-800 underline-offset-2 transition hover:text-emerald-400 hover:decoration-emerald-600"
            >
              16 event types
            </button>
          </div>

          {/* Schema pills */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {SCHEMA_COLS.map((col) => (
              <Pill key={col.name} label={col.name} tip={col.tip} />
            ))}
          </div>

          {/* Event type pills (toggled) */}
          {eventsOpen && (
            <div className="animate-fade-in mt-2 flex flex-wrap gap-1.5">
              {EVENT_TYPES.map((evt) => (
                <Pill key={evt.name} label={evt.name} tip={evt.tip} variant="dim" />
              ))}
            </div>
          )}
        </header>

        {/* ── Input ── */}
        <form onSubmit={handleSubmit} className="mb-10">
          <div className="relative flex items-center gap-2">
            <span className="pointer-events-none absolute left-4 text-sm text-emerald-600/60">
              &gt;
            </span>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ask about github events…"
              className="input-glow flex-1 rounded-lg border border-zinc-800 bg-zinc-900/80 py-3 pl-8 pr-4 text-sm text-zinc-100 placeholder-zinc-500 transition focus:border-emerald-700 focus:outline-none"
            />
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="flex h-[46px] items-center rounded-lg bg-emerald-600 px-5 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-30"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="animate-pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-white" />
                  <span className="animate-pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-white [animation-delay:0.2s]" />
                  <span className="animate-pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-white [animation-delay:0.4s]" />
                </span>
              ) : (
                "Run"
              )}
            </button>
          </div>
        </form>

        {/* ── Network error ── */}
        {error && (
          <div className="animate-fade-in mb-6 rounded-lg border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* ── API error ── */}
        {apiError && (
          <div className="animate-fade-in mb-6 rounded-lg border border-red-900/60 bg-red-950/40 p-4">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-red-500/80">
              Error
            </div>
            <p className="text-sm text-red-400">{apiError.message}</p>
            {apiError.sql && (
              <pre className="mt-2 overflow-x-auto text-xs text-red-500/40">
                {apiError.sql}
              </pre>
            )}
          </div>
        )}

        {/* ── Clarification / Impossible / Out of Scope ── */}
        {clarification && (
          <div className="animate-fade-in">
            <ClarificationCard
              status={clarification.status as "clarification_needed" | "impossible" | "out_of_scope"}
              message={clarification.message}
              suggestions={clarification.suggestions}
              onSuggestionClick={handleSuggestionClick}
            />
          </div>
        )}

        {/* ── Success ── */}
        {success && (
          <div className="animate-fade-in space-y-5">
            {/* NL Answer */}
            <p className="text-base leading-relaxed text-zinc-300">
              {success.answer}
            </p>

            {/* Visualization */}
            {success.visualizationHint === "scalar" &&
              success.result.rows.length === 1 && (
                <ScalarResult
                  label={success.result.columns[0]?.name ?? "value"}
                  value={success.result.rows[0]?.[success.result.columns[0]?.name]}
                />
              )}

            {(success.visualizationHint === "bar_chart" ||
              success.visualizationHint === "line_chart") && (
              <ResultChart
                columns={success.result.columns}
                rows={success.result.rows}
                vizHint={success.visualizationHint}
              />
            )}

            {/* Data table */}
            {success.visualizationHint !== "scalar" &&
              success.visualizationHint !== "empty" && (
                <ResultTable
                  columns={success.result.columns}
                  rows={success.result.rows}
                />
              )}

            {/* Empty */}
            {success.visualizationHint === "empty" && (
              <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/30 py-8 text-center text-sm text-zinc-600">
                No rows returned.
              </div>
            )}

            {/* SQL (collapsible) */}
            <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/30">
              <button
                onClick={() => setSqlOpen(!sqlOpen)}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-widest text-zinc-600 transition hover:text-zinc-400"
              >
                <span>Generated SQL</span>
                <span className="flex items-center gap-3 text-[10px] font-normal normal-case tracking-normal">
                  <span className="text-zinc-700">
                    {success.result.rowCount} rows · {success.result.executionTimeMs}ms
                  </span>
                  <span className="text-zinc-600">{sqlOpen ? "−" : "+"}</span>
                </span>
              </button>
              {sqlOpen && (
                <div className="border-t border-zinc-800/60 px-4 py-3">
                  <SQLHighlight code={formatSQL(success.sql, { language: "sql", tabWidth: 2, keywordCase: "upper" })} />
                </div>
              )}
            </div>

            {/* Grammar tree */}
            {success.grammarDerivation && (
              <GrammarTree tree={success.grammarDerivation} />
            )}
          </div>
        )}

        {/* ── Empty state ── */}
        {!result && !error && !loading && (
          <div className="space-y-6">
            <div className="text-sm text-zinc-500">
              Try a query:
            </div>
            <div className="flex flex-col gap-1.5">
              {EXAMPLE_QUERIES.map((q) => (
                <button
                  key={q}
                  onClick={() => {
                    setQuery(q);
                    submitQuery(q);
                  }}
                  className="group flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-zinc-400 transition hover:bg-zinc-900/60 hover:text-zinc-200"
                >
                  <span className="text-emerald-700 transition group-hover:text-emerald-500">
                    &gt;
                  </span>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Footer ── */}
        <footer className="mt-20 border-t border-zinc-900 pt-6 text-center text-[10px] tracking-wide text-zinc-600">
          Built by <a href="https://github.com/jy-tan" target="_blank" rel="noopener noreferrer" className="text-zinc-500 underline decoration-zinc-700 underline-offset-2 transition hover:text-emerald-400 hover:decoration-emerald-600">JY Tan</a> with GPT-5.2 w/ CFG, ClickHouse, and <a href="https://www.gharchive.org/" target="_blank" rel="noopener noreferrer" className="text-zinc-500 underline decoration-zinc-700 underline-offset-2 transition hover:text-emerald-400 hover:decoration-emerald-600">GH Archive</a>.
        </footer>
      </div>
    </main>
    </Tooltip.Provider>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-zinc-950 text-zinc-100" />}>
      <HomeContent />
    </Suspense>
  );
}
