"use client";

import { useEffect, useState, useRef } from "react";

interface SQLHighlightProps {
  code: string;
}

// Lazy singleton — created once, reused across renders
let highlighterPromise: Promise<import("shiki").Highlighter> | null = null;

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = import("shiki").then((shiki) =>
      shiki.createHighlighter({
        themes: ["vitesse-dark"],
        langs: ["sql"],
      }),
    );
  }
  return highlighterPromise;
}

export default function SQLHighlight({ code }: SQLHighlightProps) {
  const [html, setHtml] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    getHighlighter().then((hl) => {
      if (cancelled) return;
      const result = hl.codeToHtml(code, {
        lang: "sql",
        theme: "vitesse-dark",
      });
      setHtml(result);
    });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (!html) {
    // Fallback while shiki loads
    return (
      <pre className="whitespace-pre-wrap text-xs leading-relaxed text-emerald-500/80">
        {code}
      </pre>
    );
  }

  return (
    <div
      ref={ref}
      className="sql-highlight text-xs leading-relaxed [&_pre]:bg-transparent! [&_pre]:p-0! [&_code]:bg-transparent!"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
