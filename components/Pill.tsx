"use client";

import * as Tooltip from "@radix-ui/react-tooltip";

interface PillProps {
  label: string;
  tip: string;
  variant?: "default" | "dim";
}

export default function Pill({ label, tip, variant = "default" }: PillProps) {
  const border =
    variant === "default"
      ? "border-zinc-800/80 hover:border-zinc-700"
      : "border-zinc-800/50 hover:border-zinc-700";
  const bg =
    variant === "default" ? "bg-zinc-900/60" : "bg-zinc-900/30";
  const text =
    variant === "default"
      ? "text-zinc-500 hover:text-zinc-400"
      : "text-zinc-600 hover:text-zinc-400";

  return (
    <Tooltip.Root delayDuration={200}>
      <Tooltip.Trigger asChild>
        <span
          className={`cursor-default rounded border ${border} ${bg} px-2 py-0.5 text-[11px] transition ${text}`}
        >
          {label}
        </span>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="top"
          sideOffset={5}
          className="z-50 rounded-md border border-zinc-800/60 bg-zinc-900/95 px-2.5 py-1.5 text-[11px] leading-snug text-zinc-400 shadow-lg backdrop-blur-sm animate-fade-in"
        >
          {tip}
          <Tooltip.Arrow className="fill-zinc-900/95" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
