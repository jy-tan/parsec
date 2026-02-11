"use client";

import { useState } from "react";
import type { GrammarDerivationNode } from "@/lib/types";

interface GrammarTreeProps {
  tree: GrammarDerivationNode;
}

function TreeNode({ node, depth = 0 }: { node: GrammarDerivationNode; depth?: number }) {
  const hasChildren = node.children.length > 0;
  const [open, setOpen] = useState(depth < 2);

  return (
    <div className={depth > 0 ? "ml-4 border-l border-zinc-800/50 pl-3" : ""}>
      <button
        onClick={() => hasChildren && setOpen(!open)}
        className={`group flex items-start gap-1.5 py-0.5 text-left text-xs ${
          hasChildren ? "cursor-pointer" : "cursor-default"
        }`}
      >
        {hasChildren ? (
          <span className="mt-px text-[10px] text-zinc-700 transition group-hover:text-zinc-400">
            {open ? "▼" : "▶"}
          </span>
        ) : (
          <span className="mt-px text-[10px] text-zinc-800">·</span>
        )}
        <span className="text-emerald-600">{node.rule}</span>
        {!hasChildren && node.matchedText && (
          <span className="ml-1 text-zinc-600">&quot;{node.matchedText}&quot;</span>
        )}
      </button>
      {open &&
        hasChildren &&
        node.children.map((child, i) => (
          <TreeNode key={i} node={child} depth={depth + 1} />
        ))}
    </div>
  );
}

export default function GrammarTree({ tree }: GrammarTreeProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/30">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-widest text-zinc-600 transition hover:text-zinc-400"
      >
        <span>Grammar Derivation Tree</span>
        <span>{expanded ? "−" : "+"}</span>
      </button>
      {expanded && (
        <div className="border-t border-zinc-800/60 px-4 py-3">
          <TreeNode node={tree} />
        </div>
      )}
    </div>
  );
}
