interface ClarificationCardProps {
  status: "clarification_needed" | "impossible" | "out_of_scope";
  message: string;
  suggestions?: string[];
  onSuggestionClick?: (suggestion: string) => void;
}

export default function ClarificationCard({
  status,
  message,
  suggestions,
  onSuggestionClick,
}: ClarificationCardProps) {
  const config = {
    clarification_needed: {
      label: "Clarification Needed",
      border: "border-amber-800/50",
      bg: "bg-amber-950/30",
      label_color: "text-amber-500/80",
      msg_color: "text-amber-300/80",
      btn_border: "border-amber-800/40 hover:border-amber-600/60",
      btn_text: "text-zinc-400 hover:text-amber-300",
    },
    impossible: {
      label: "Cannot Answer",
      border: "border-rose-800/50",
      bg: "bg-rose-950/30",
      label_color: "text-rose-500/80",
      msg_color: "text-rose-300/80",
      btn_border: "border-rose-800/40 hover:border-rose-600/60",
      btn_text: "text-zinc-400 hover:text-rose-300",
    },
    out_of_scope: {
      label: "Out of Scope",
      border: "border-zinc-700/50",
      bg: "bg-zinc-900/40",
      label_color: "text-zinc-500",
      msg_color: "text-zinc-400",
      btn_border: "border-zinc-700/40 hover:border-zinc-500/60",
      btn_text: "text-zinc-500 hover:text-zinc-300",
    },
  };

  const c = config[status];
  const allSuggestions = suggestions ?? [];

  return (
    <div className={`rounded-lg border ${c.border} ${c.bg} p-5`}>
      <div className={`mb-1.5 text-[10px] font-semibold uppercase tracking-widest ${c.label_color}`}>
        {c.label}
      </div>
      <p className={`text-sm leading-relaxed ${c.msg_color}`}>{message}</p>

      {allSuggestions.length > 0 && (
        <div className="mt-4 flex flex-col gap-1.5">
          <div className="text-[10px] font-medium uppercase tracking-widest text-zinc-600">
            {status === "clarification_needed" ? "Did you mean:" : "Try instead:"}
          </div>
          {allSuggestions.map((s, i) => (
            <button
              key={i}
              onClick={() => onSuggestionClick?.(s)}
              className={`flex items-center gap-2 rounded-md border ${c.btn_border} px-3 py-2 text-left text-sm transition ${c.btn_text}`}
            >
              <span className="text-emerald-700">&gt;</span>
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
