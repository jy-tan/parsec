import OpenAI from "openai";
import type { QueryColumn, VisualizationType } from "@/lib/types";

const OPENAI_MODEL = process.env.OPENAI_SUMMARIZE_MODEL ?? "gpt-5-mini";

/**
 * Generate a concise NL answer from query results using GPT-5 mini.
 *
 * Falls back to a simple deterministic summary if the LLM call fails.
 */
export async function generateAnswer(
  userQuery: string,
  sql: string,
  columns: QueryColumn[],
  rows: Record<string, unknown>[],
  vizHint: VisualizationType,
): Promise<string> {
  if (rows.length === 0) return "No results found.";

  // Build a compact representation of the result for the prompt
  const preview = rows.slice(0, 15).map((r) => {
    const obj: Record<string, unknown> = {};
    for (const col of columns) {
      obj[col.name] = r[col.name];
    }
    return obj;
  });

  const prompt = `You are a data analyst assistant. The user asked: "${userQuery}"

The SQL query was:
${sql}

The result has ${rows.length} row(s) and ${columns.length} column(s): ${columns.map((c) => c.name).join(", ")}.
Visualization type: ${vizHint}.

First ${Math.min(rows.length, 15)} rows:
${JSON.stringify(preview, null, 0)}

Write a single concise sentence (under 30 words) summarizing the key finding. Be specific with numbers. No preamble, no markdown, no period at the end unless it's a full sentence. Don't repeat the question.`;

  try {
    const client = new OpenAI();
    const response = await client.responses.create({
      model: OPENAI_MODEL,
      input: [
        {
          role: "developer",
          content:
            "You produce ultra-concise data summaries. One sentence, specific numbers, no fluff. Never start with 'The query shows' or similar preamble. Just state the finding.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      reasoning: { effort: "minimal" },
      text: { format: { type: "text" } },
    });

    const textOutput = response.output.find(
      (item): item is OpenAI.Responses.ResponseOutputMessage =>
        item.type === "message",
    );

    const text = textOutput?.content
      ?.map((c) => ("text" in c ? c.text : ""))
      .join("")
      .trim();

    if (text) return text;
  } catch (err) {
    console.warn("[summarize] LLM summary failed, using fallback:", err);
  }

  // Deterministic fallback
  return fallbackAnswer(columns, rows, vizHint);
}

// ── Deterministic fallback (original logic) ──

function fmt(v: unknown): string {
  if (typeof v === "number") return v.toLocaleString("en-US");
  if (typeof v === "bigint") return v.toLocaleString("en-US");
  return String(v ?? "");
}

function fallbackAnswer(
  columns: QueryColumn[],
  rows: Record<string, unknown>[],
  vizHint: VisualizationType,
): string {
  if (rows.length === 0) return "No results found.";

  const numericCol = columns.find(
    (c) =>
      c.type.startsWith("UInt") ||
      c.type.startsWith("Int") ||
      c.type.startsWith("Float") ||
      c.type.startsWith("Decimal") ||
      c.type === "number",
  );
  const labelCol = columns.find(
    (c) =>
      c.type === "String" ||
      c.type.startsWith("LowCardinality(String") ||
      c.type.startsWith("Nullable(String") ||
      c.type === "string",
  );

  if (vizHint === "scalar" || (rows.length === 1 && columns.length === 1)) {
    return `${fmt(rows[0][columns[0].name])}.`;
  }

  if (rows.length === 1 && columns.length === 2 && labelCol && numericCol) {
    return `${rows[0][labelCol.name]}: ${fmt(rows[0][numericCol.name])}.`;
  }

  if (
    (vizHint === "bar_chart" || vizHint === "table") &&
    labelCol &&
    numericCol
  ) {
    const top = rows[0];
    const topLabel = String(top[labelCol.name] ?? "");
    const topVal = fmt(top[numericCol.name]);
    if (rows.length === 1) return `${topLabel} with ${topVal}.`;
    const second = rows[1];
    let s = `${topLabel} leads with ${topVal}`;
    if (second)
      s += `, followed by ${second[labelCol.name]} (${fmt(second[numericCol.name])})`;
    if (rows.length > 2) s += ` and ${rows.length - 2} more`;
    return s + ".";
  }

  if (vizHint === "line_chart" && numericCol) {
    const vals = rows.map((r) => Number(r[numericCol.name] ?? 0));
    return `${rows.length} data points, ranging from ${fmt(Math.min(...vals))} to ${fmt(Math.max(...vals))}.`;
  }

  return `${rows.length} result${rows.length === 1 ? "" : "s"} across ${columns.length} column${columns.length === 1 ? "" : "s"}.`;
}
