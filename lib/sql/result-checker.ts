import OpenAI from "openai";

const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-5-mini";

export interface ResultCheckOutput {
  adequate: boolean;
  feedback: string;
}

/**
 * Check whether SQL query results adequately answer the user's question.
 * If not, also provides feedback for retry.
 *
 * Uses GPT-5 mini with minimal reasoning for fast evaluation (~200ms).
 * Returns { adequate: true } or { adequate: false, feedback: "..." }.
 */
export async function checkResultAdequacy(
  userQuery: string,
  sql: string,
  columns: { name: string; type: string }[],
  rows: Record<string, unknown>[],
): Promise<ResultCheckOutput> {
  const preview = rows.slice(0, 10).map((r) => {
    const obj: Record<string, unknown> = {};
    for (const col of columns) {
      obj[col.name] = r[col.name];
    }
    return obj;
  });

  const prompt = `User asked: "${userQuery}"

SQL generated:
${sql}

Result: ${rows.length} row(s), columns: ${columns.map((c) => `${c.name} (${c.type})`).join(", ")}
Preview (up to 10 rows):
${JSON.stringify(preview, null, 0)}

Does this result adequately answer the user's question?

Common problems to check:
- Date ranges that are too narrow (e.g. BETWEEN '2025-11-01' AND '2025-11-01' only matches midnight, should use datetime range or toDate())
- Too few rows when the user expects a breakdown (e.g. "hourly breakdown" should return multiple hours, not 1)
- Wrong aggregation or grouping that doesn't match the question
- Missing WHERE filters that the question implies

If the result looks wrong or insufficient, explain SPECIFICALLY what the SQL should do differently. Be concise (1-2 sentences).`;

  try {
    const client = new OpenAI();
    const response = await client.responses.create({
      model: OPENAI_MODEL,
      input: [
        {
          role: "developer",
          content: `You evaluate whether SQL query results answer a user's question. Respond as JSON: { "adequate": true } or { "adequate": false, "feedback": "concise fix description" }. Be strict — if the result clearly doesn't match what was asked (wrong row count, wrong time range, wrong grouping), mark it inadequate.`,
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      reasoning: { effort: "low" },
      text: {
        format: {
          type: "json_schema",
          name: "result_check",
          strict: true,
          schema: {
            type: "object",
            properties: {
              adequate: { type: "boolean" },
              feedback: { type: "string" },
            },
            required: ["adequate", "feedback"],
            additionalProperties: false,
          },
        },
      },
    });

    const textOutput = response.output.find(
      (item): item is OpenAI.Responses.ResponseOutputMessage =>
        item.type === "message",
    );

    const raw = textOutput?.content
      ?.map((c) => ("text" in c ? c.text : ""))
      .join("")
      .trim();

    if (raw) {
      const parsed = JSON.parse(raw) as { adequate: boolean; feedback: string };
      return {
        adequate: parsed.adequate,
        feedback: parsed.feedback || "",
      };
    }
  } catch (err) {
    console.warn("[result-checker] LLM check failed, assuming adequate:", err);
  }

  // Default: assume adequate if check fails
  return { adequate: true, feedback: "" };
}
