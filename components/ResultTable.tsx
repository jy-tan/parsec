"use client";

import { useState, useMemo } from "react";
import type { QueryColumn } from "@/lib/types";

interface ResultTableProps {
  columns: QueryColumn[];
  rows: Record<string, unknown>[];
}

type SortDir = "asc" | "desc" | null;

function isNumeric(type: string): boolean {
  return (
    type.startsWith("UInt") ||
    type.startsWith("Int") ||
    type.startsWith("Float") ||
    type.startsWith("Decimal") ||
    type === "number"
  );
}

function fmtCell(value: unknown, type: string): string {
  if (value === null || value === undefined) return "—";
  if (isNumeric(type) && typeof value === "number") {
    return value.toLocaleString("en-US");
  }
  return String(value);
}

export default function ResultTable({ columns, rows }: ResultTableProps) {
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);

  function handleSort(colName: string) {
    if (sortCol === colName) {
      if (sortDir === "asc") setSortDir("desc");
      else if (sortDir === "desc") {
        setSortCol(null);
        setSortDir(null);
      }
    } else {
      setSortCol(colName);
      setSortDir("asc");
    }
  }

  const sorted = useMemo(() => {
    if (!sortCol || !sortDir) return rows;
    return [...rows].sort((a, b) => {
      const av = a[sortCol];
      const bv = b[sortCol];
      if (av === bv) return 0;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rows, sortCol, sortDir]);

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-800/60">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-zinc-800/60 bg-zinc-900/40">
            {columns.map((col) => (
              <th
                key={col.name}
                onClick={() => handleSort(col.name)}
                className={`cursor-pointer select-none px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-widest text-zinc-500 transition hover:text-zinc-300 ${
                  isNumeric(col.type) ? "text-right" : ""
                }`}
              >
                <span className="inline-flex items-center gap-1">
                  {col.name}
                  {sortCol === col.name && (
                    <span className="text-emerald-500">
                      {sortDir === "asc" ? "↑" : "↓"}
                    </span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, ri) => (
            <tr
              key={ri}
              className="border-b border-zinc-800/30 transition hover:bg-zinc-900/40"
            >
              {columns.map((col) => (
                <td
                  key={col.name}
                  className={`px-4 py-2 text-zinc-400 ${
                    isNumeric(col.type)
                      ? "text-right tabular-nums text-zinc-300"
                      : ""
                  }`}
                >
                  {fmtCell(row[col.name], col.type)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
