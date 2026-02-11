"use client";

interface ScalarResultProps {
  label: string;
  value: unknown;
}

function fmt(v: unknown): string {
  if (typeof v === "number") return v.toLocaleString("en-US");
  if (typeof v === "bigint") return v.toLocaleString("en-US");
  return String(v ?? "—");
}

export default function ScalarResult({ label, value }: ScalarResultProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-zinc-800/60 bg-zinc-900/30 px-8 py-10">
      <div className="text-5xl font-bold tabular-nums text-emerald-400">
        {fmt(value)}
      </div>
      <div className="mt-3 text-[10px] font-medium uppercase tracking-widest text-zinc-600">
        {label}
      </div>
    </div>
  );
}
