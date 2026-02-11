"use client";

import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LabelList,
  ResponsiveContainer,
} from "recharts";
import type { VisualizationType, QueryColumn } from "@/lib/types";

interface ResultChartProps {
  columns: QueryColumn[];
  rows: Record<string, unknown>[];
  vizHint: VisualizationType;
}

const BAR_FILL = "rgba(52, 211, 153, 0.50)"; // emerald-400 @ 50%
const LINE_STROKE = "#34d399"; // emerald-400

// Reserved for future multi-series / grouped data
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const SERIES_PALETTE = [
  "#34d399", "#60a5fa", "#a78bfa", "#fb923c",
  "#f472b6", "#facc15", "#2dd4bf", "#818cf8",
];

function findColumns(columns: QueryColumn[]) {
  const labelCol = columns.find(
    (c) =>
      c.type === "String" ||
      c.type.startsWith("LowCardinality(String") ||
      c.type.startsWith("Nullable(String") ||
      c.type === "string" ||
      c.type.startsWith("Enum8") ||
      c.type.startsWith("Enum16") ||
      c.type === "DateTime" ||
      c.type === "Date" ||
      c.type.startsWith("DateTime64"),
  );
  const numericCol = columns.find(
    (c) =>
      c.type.startsWith("UInt") ||
      c.type.startsWith("Int") ||
      c.type.startsWith("Float") ||
      c.type.startsWith("Decimal") ||
      c.type === "number",
  );
  return { labelCol, numericCol };
}

function truncateLabel(label: string, maxLen = 20): string {
  if (label.length <= maxLen) return label;
  return label.slice(0, maxLen - 1) + "…";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-zinc-800/60 bg-zinc-900/95 px-3 py-2 text-xs shadow-lg backdrop-blur-sm">
      <div className="mb-1 text-zinc-500">{String(label)}</div>
      {payload.map((p: { name: string; value: number; color: string }, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: p.color }}
          />
          <span className="text-zinc-300 tabular-nums">
            {typeof p.value === "number" ? p.value.toLocaleString("en-US") : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function ResultChart({ columns, rows, vizHint }: ResultChartProps) {
  const { labelCol, numericCol } = findColumns(columns);
  if (!labelCol || !numericCol) return null;

  const data = rows.map((r) => ({
    label: truncateLabel(String(r[labelCol.name] ?? "")),
    fullLabel: String(r[labelCol.name] ?? ""),
    value: Number(r[numericCol.name] ?? 0),
  }));

  if (vizHint === "bar_chart") {
    // Dynamic height: 32px per bar, min 200
    const barHeight = Math.max(200, data.length * 36 + 24);
    return (
      <div style={{ height: barHeight }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 4, right: 56, bottom: 4, left: 4 }}
          >
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="fullLabel"
              tick={{ fill: "#a1a1aa", fontSize: 11 }}
              width={170}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
            <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={26} fill={BAR_FILL}>
              <LabelList
                dataKey="value"
                position="right"
                fill="#71717a"
                fontSize={11}
                formatter={(v: unknown) => typeof v === "number" ? v.toLocaleString("en-US") : String(v ?? "")}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // line_chart
  return (
    <div className="h-[350px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 48, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: "#a1a1aa", fontSize: 11 }}
            angle={-35}
            textAnchor="end"
            interval={0}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "#71717a", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => v.toLocaleString("en-US")}
          />
          <Tooltip content={<CustomTooltip />} />
          <Line
            type="monotone"
            dataKey="value"
            stroke={LINE_STROKE}
            strokeWidth={2}
            dot={{ r: 3, fill: LINE_STROKE, strokeWidth: 0 }}
            activeDot={{ r: 5, fill: LINE_STROKE }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
