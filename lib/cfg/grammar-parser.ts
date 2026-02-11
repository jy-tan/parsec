import type { GrammarDerivationNode } from "@/lib/types";

/*
 * Grammar Parser - Recursive Descent
 *
 * Parses a SQL string produced by the CFG-constrained model back
 * against the grammar to extract a derivation tree. This tree
 * is rendered in the frontend as a collapsible visualization.
 *
 * Since the grammar is known and fixed, this parser mirrors the
 * grammar's production rules exactly.
 */

/**
 * Parser state: tracks position in the input string.
 */
class ParseState {
  constructor(
    public readonly input: string,
    public pos: number = 0
  ) {}

  get remaining(): string {
    return this.input.slice(this.pos);
  }

  get isAtEnd(): boolean {
    return this.pos >= this.input.length;
  }

  /**
   * Try to match a literal string at the current position.
   */
  matchLiteral(str: string): boolean {
    if (this.input.startsWith(str, this.pos)) {
      this.pos += str.length;
      return true;
    }
    return false;
  }

  /**
   * Try to match a regex at the current position.
   * Returns the matched string or null.
   */
  matchRegex(pattern: RegExp): string | null {
    const re = new RegExp(`^(?:${pattern.source})`, pattern.flags.replace("g", ""));
    const match = re.exec(this.remaining);
    if (match) {
      this.pos += match[0].length;
      return match[0];
    }
    return null;
  }

  /**
   * Save current position for backtracking.
   */
  save(): number {
    return this.pos;
  }

  /**
   * Restore to a saved position.
   */
  restore(saved: number): void {
    this.pos = saved;
  }
}

/**
 * Helper to create a derivation node.
 */
function node(
  rule: string,
  matchedText: string,
  children: GrammarDerivationNode[] = []
): GrammarDerivationNode {
  return { rule, matchedText, children };
}

// ============================================================
// Known terminals for matching
// ============================================================

const AGG_FUNCS = ["count", "sum", "avg", "min", "max", "uniq", "uniqExact"];

const DATE_TRUNC_EXPRS = [
  "toStartOfHour(created_at)",
  "toStartOfDay(created_at)",
  "toStartOfWeek(created_at)",
  "toStartOfMonth(created_at)",
  "toDate(created_at)",
];

const COMPARE_OPS = ["!=", ">=", "<=", "=", ">", "<"];
const TIME_UNITS = ["HOUR", "DAY", "WEEK", "MONTH"];

const KNOWN_COLUMNS = [
  "actor_login",
  "repo_name",
  "title",
  "body",
  "ref",
  "id",
  "number",
  "is_private",
  "created_at",
  "type",
  "action",
];

const STRING_COLS = ["actor_login", "repo_name", "title", "body", "ref"];
const NUMERIC_COLS = ["id", "number", "is_private"];

// ============================================================
// Recursive descent parser functions
// ============================================================

function parseNumber(state: ParseState): GrammarDerivationNode | null {
  const matched = state.matchRegex(/[0-9]{1,6}/);
  if (matched) return node("number", matched);
  return null;
}

function parseAlias(state: ParseState): GrammarDerivationNode | null {
  const matched = state.matchRegex(/[a-z_][a-z0-9_]{0,29}/);
  if (matched) return node("alias", matched);
  return null;
}

function parseStringValue(state: ParseState): GrammarDerivationNode | null {
  const matched = state.matchRegex(/[a-zA-Z0-9_.\-/]{1,100}/);
  if (matched) return node("string_value", matched);
  return null;
}

function parseDateLiteral(state: ParseState): GrammarDerivationNode | null {
  const matched = state.matchRegex(/[0-9]{4}-[0-9]{2}-[0-9]{2}/);
  if (matched) return node("date_literal", matched);
  return null;
}

function parseColumnRef(state: ParseState): GrammarDerivationNode | null {
  const saved = state.save();
  // Try longest column names first to avoid partial matches
  const sorted = [...KNOWN_COLUMNS].sort((a, b) => b.length - a.length);
  for (const col of sorted) {
    if (state.matchLiteral(col)) {
      return node("column_ref", col);
    }
  }
  state.restore(saved);
  return null;
}

function parseAggFunc(state: ParseState): GrammarDerivationNode | null {
  const sorted = [...AGG_FUNCS].sort((a, b) => b.length - a.length);
  for (const func of sorted) {
    if (state.matchLiteral(func)) {
      return node("agg_func", func);
    }
  }
  return null;
}

function parseAggExpr(state: ParseState): GrammarDerivationNode | null {
  const saved = state.save();
  const func = parseAggFunc(state);
  if (!func) return null;

  if (!state.matchLiteral("(")) {
    state.restore(saved);
    return null;
  }

  const colRef = parseColumnRef(state); // optional

  if (!state.matchLiteral(")")) {
    state.restore(saved);
    return null;
  }

  const children = [func];
  if (colRef) children.push(colRef);
  const text = colRef
    ? `${func.matchedText}(${colRef.matchedText})`
    : `${func.matchedText}()`;

  return node("agg_expr", text, children);
}

function parseDateTruncExpr(state: ParseState): GrammarDerivationNode | null {
  // Try longest expressions first
  const sorted = [...DATE_TRUNC_EXPRS].sort((a, b) => b.length - a.length);
  for (const expr of sorted) {
    if (state.matchLiteral(expr)) {
      return node("date_trunc_expr", expr);
    }
  }
  return null;
}

function parseSelectItem(state: ParseState): GrammarDerivationNode | null {
  const saved = state.save();

  // Try: agg_expr " AS " alias
  const aggExpr = parseAggExpr(state);
  if (aggExpr && state.matchLiteral(" AS ")) {
    const alias = parseAlias(state);
    if (alias) {
      return node(
        "select_item",
        `${aggExpr.matchedText} AS ${alias.matchedText}`,
        [aggExpr, alias]
      );
    }
  }
  state.restore(saved);

  // Try: date_trunc_expr " AS " alias
  const dtExpr = parseDateTruncExpr(state);
  if (dtExpr && state.matchLiteral(" AS ")) {
    const alias = parseAlias(state);
    if (alias) {
      return node(
        "select_item",
        `${dtExpr.matchedText} AS ${alias.matchedText}`,
        [dtExpr, alias]
      );
    }
  }
  state.restore(saved);

  // Try: column_ref
  const colRef = parseColumnRef(state);
  if (colRef) {
    return node("select_item", colRef.matchedText, [colRef]);
  }

  return null;
}

function parseSelectClause(state: ParseState): GrammarDerivationNode | null {
  const saved = state.save();
  if (!state.matchLiteral("SELECT ")) {
    state.restore(saved);
    return null;
  }

  const items: GrammarDerivationNode[] = [];
  const first = parseSelectItem(state);
  if (!first) {
    state.restore(saved);
    return null;
  }
  items.push(first);

  while (state.matchLiteral(", ")) {
    const next = parseSelectItem(state);
    if (!next) break;
    items.push(next);
  }

  const text = "SELECT " + items.map((i) => i.matchedText).join(", ");
  return node("select_clause", text, items);
}

function parseFromClause(state: ParseState): GrammarDerivationNode | null {
  if (state.matchLiteral(" FROM github_events")) {
    return node("from_clause", "FROM github_events");
  }
  return null;
}

function parseCompareOp(state: ParseState): GrammarDerivationNode | null {
  // Try longest operators first (!=, >=, <=) before single-char (=, >, <)
  for (const op of COMPARE_OPS) {
    if (state.matchLiteral(op)) {
      return node("compare_op", op);
    }
  }
  return null;
}

function parseStringCondition(state: ParseState): GrammarDerivationNode | null {
  const saved = state.save();
  const sorted = [...STRING_COLS].sort((a, b) => b.length - a.length);

  for (const col of sorted) {
    state.restore(saved);

    // Try: col = 'value'
    if (state.matchLiteral(col + " = '")) {
      const val = parseStringValue(state);
      if (val && state.matchLiteral("'")) {
        return node(
          "string_condition",
          `${col} = '${val.matchedText}'`,
          [node("string_col", col), val]
        );
      }
    }
    state.restore(saved);

    // Try: col LIKE '%value%'
    if (state.matchLiteral(col + " LIKE '%")) {
      const val = parseStringValue(state);
      if (val && state.matchLiteral("%'")) {
        return node(
          "string_condition",
          `${col} LIKE '%${val.matchedText}%'`,
          [node("string_col", col), val]
        );
      }
    }
    state.restore(saved);

    // Try: col IN ('val1', 'val2', ...)
    if (state.matchLiteral(col + " IN (")) {
      const values: GrammarDerivationNode[] = [];
      if (state.matchLiteral("'")) {
        const v = parseStringValue(state);
        if (v && state.matchLiteral("'")) {
          values.push(v);
          while (state.matchLiteral(", '")) {
            const next = parseStringValue(state);
            if (next && state.matchLiteral("'")) {
              values.push(next);
            } else break;
          }
        }
      }
      if (state.matchLiteral(")") && values.length > 0) {
        const valStr = values.map((v) => `'${v.matchedText}'`).join(", ");
        return node(
          "string_condition",
          `${col} IN (${valStr})`,
          [node("string_col", col), ...values]
        );
      }
    }
    state.restore(saved);
  }

  return null;
}

function parseNumericCondition(state: ParseState): GrammarDerivationNode | null {
  const saved = state.save();
  const sorted = [...NUMERIC_COLS].sort((a, b) => b.length - a.length);

  for (const col of sorted) {
    state.restore(saved);
    if (state.matchLiteral(col + " ")) {
      const op = parseCompareOp(state);
      if (op && state.matchLiteral(" ")) {
        const num = parseNumber(state);
        if (num) {
          return node(
            "numeric_condition",
            `${col} ${op.matchedText} ${num.matchedText}`,
            [node("numeric_col", col), op, num]
          );
        }
      }
    }
  }
  state.restore(saved);
  return null;
}

function parseDatetimeCondition(state: ParseState): GrammarDerivationNode | null {
  const saved = state.save();

  // Try: created_at >= now() - INTERVAL N UNIT
  if (state.matchLiteral("created_at >= now() - INTERVAL ")) {
    const num = parseNumber(state);
    if (num && state.matchLiteral(" ")) {
      for (const unit of TIME_UNITS) {
        if (state.matchLiteral(unit)) {
          return node(
            "datetime_condition",
            `created_at >= now() - INTERVAL ${num.matchedText} ${unit}`,
            [num, node("time_unit", unit)]
          );
        }
      }
    }
  }
  state.restore(saved);

  // Try: created_at BETWEEN 'date' AND 'date'
  if (state.matchLiteral("created_at BETWEEN '")) {
    const d1 = parseDateLiteral(state);
    if (d1 && state.matchLiteral("' AND '")) {
      const d2 = parseDateLiteral(state);
      if (d2 && state.matchLiteral("'")) {
        return node(
          "datetime_condition",
          `created_at BETWEEN '${d1.matchedText}' AND '${d2.matchedText}'`,
          [d1, d2]
        );
      }
    }
  }
  state.restore(saved);
  return null;
}

function parseEnumCondition(state: ParseState): GrammarDerivationNode | null {
  const saved = state.save();

  // Try: type = 'EventType'
  if (state.matchLiteral("type = '")) {
    const val = parseStringValue(state);
    if (val && state.matchLiteral("'")) {
      return node(
        "enum_condition",
        `type = '${val.matchedText}'`,
        [val]
      );
    }
  }
  state.restore(saved);

  // Try: type IN ('EventType1', 'EventType2')
  if (state.matchLiteral("type IN (")) {
    const values: GrammarDerivationNode[] = [];
    if (state.matchLiteral("'")) {
      const v = parseStringValue(state);
      if (v && state.matchLiteral("'")) {
        values.push(v);
        while (state.matchLiteral(", '")) {
          const next = parseStringValue(state);
          if (next && state.matchLiteral("'")) {
            values.push(next);
          } else break;
        }
      }
    }
    if (state.matchLiteral(")") && values.length > 0) {
      const valStr = values.map((v) => `'${v.matchedText}'`).join(", ");
      return node(
        "enum_condition",
        `type IN (${valStr})`,
        [...values]
      );
    }
  }
  state.restore(saved);

  // Try: action = 'value'
  if (state.matchLiteral("action = '")) {
    const val = parseStringValue(state);
    if (val && state.matchLiteral("'")) {
      return node(
        "enum_condition",
        `action = '${val.matchedText}'`,
        [val]
      );
    }
  }
  state.restore(saved);

  return null;
}

function parseCondition(state: ParseState): GrammarDerivationNode | null {
  // Try each condition type
  return (
    parseDatetimeCondition(state) ??
    parseEnumCondition(state) ??
    parseStringCondition(state) ??
    parseNumericCondition(state)
  );
}

function parseWhereClause(state: ParseState): GrammarDerivationNode | null {
  const saved = state.save();
  if (!state.matchLiteral(" WHERE ")) {
    state.restore(saved);
    return null;
  }

  const conditions: GrammarDerivationNode[] = [];
  const first = parseCondition(state);
  if (!first) {
    state.restore(saved);
    return null;
  }
  conditions.push(first);

  while (state.matchLiteral(" AND ")) {
    const next = parseCondition(state);
    if (!next) break;
    conditions.push(next);
  }

  const text = "WHERE " + conditions.map((c) => c.matchedText).join(" AND ");
  return node("where_clause", text, conditions);
}

function parseGroupItem(state: ParseState): GrammarDerivationNode | null {
  // Try date_trunc_expr first (longer match)
  const dtExpr = parseDateTruncExpr(state);
  if (dtExpr) return node("group_item", dtExpr.matchedText, [dtExpr]);

  const colRef = parseColumnRef(state);
  if (colRef) return node("group_item", colRef.matchedText, [colRef]);

  // Try alias-like identifiers
  const alias = parseAlias(state);
  if (alias) return node("group_item", alias.matchedText, [alias]);

  return null;
}

function parseGroupClause(state: ParseState): GrammarDerivationNode | null {
  const saved = state.save();
  if (!state.matchLiteral(" GROUP BY ")) {
    state.restore(saved);
    return null;
  }

  const items: GrammarDerivationNode[] = [];
  const first = parseGroupItem(state);
  if (!first) {
    state.restore(saved);
    return null;
  }
  items.push(first);

  while (state.matchLiteral(", ")) {
    const next = parseGroupItem(state);
    if (!next) break;
    items.push(next);
  }

  const text = "GROUP BY " + items.map((i) => i.matchedText).join(", ");
  return node("group_clause", text, items);
}

function parseHavingClause(state: ParseState): GrammarDerivationNode | null {
  const saved = state.save();
  if (!state.matchLiteral(" HAVING ")) {
    state.restore(saved);
    return null;
  }

  const aggExpr = parseAggExpr(state);
  if (!aggExpr) {
    state.restore(saved);
    return null;
  }

  if (!state.matchLiteral(" ")) {
    state.restore(saved);
    return null;
  }

  const op = parseCompareOp(state);
  if (!op) {
    state.restore(saved);
    return null;
  }

  if (!state.matchLiteral(" ")) {
    state.restore(saved);
    return null;
  }

  const num = parseNumber(state);
  if (!num) {
    state.restore(saved);
    return null;
  }

  const text = `HAVING ${aggExpr.matchedText} ${op.matchedText} ${num.matchedText}`;
  return node("having_clause", text, [aggExpr, op, num]);
}

function parseOrderItem(state: ParseState): GrammarDerivationNode | null {
  const saved = state.save();

  // Try agg_expr first
  const aggExpr = parseAggExpr(state);
  let baseNode: GrammarDerivationNode | null = aggExpr;

  // If no agg_expr, try column_ref
  if (!baseNode) {
    baseNode = parseColumnRef(state);
  }

  // If no column_ref, try alias
  if (!baseNode) {
    baseNode = parseAlias(state);
  }

  if (!baseNode) {
    state.restore(saved);
    return null;
  }

  let text = baseNode.matchedText;
  const children = [baseNode];

  // Optional ASC/DESC
  if (state.matchLiteral(" DESC")) {
    text += " DESC";
    children.push(node("direction", "DESC"));
  } else if (state.matchLiteral(" ASC")) {
    text += " ASC";
    children.push(node("direction", "ASC"));
  }

  return node("order_item", text, children);
}

function parseOrderClause(state: ParseState): GrammarDerivationNode | null {
  const saved = state.save();
  if (!state.matchLiteral(" ORDER BY ")) {
    state.restore(saved);
    return null;
  }

  const items: GrammarDerivationNode[] = [];
  const first = parseOrderItem(state);
  if (!first) {
    state.restore(saved);
    return null;
  }
  items.push(first);

  while (state.matchLiteral(", ")) {
    const next = parseOrderItem(state);
    if (!next) break;
    items.push(next);
  }

  const text = "ORDER BY " + items.map((i) => i.matchedText).join(", ");
  return node("order_clause", text, items);
}

function parseLimitClause(state: ParseState): GrammarDerivationNode | null {
  const saved = state.save();
  if (!state.matchLiteral(" LIMIT ")) {
    state.restore(saved);
    return null;
  }

  const num = parseNumber(state);
  if (!num) {
    state.restore(saved);
    return null;
  }

  return node("limit_clause", `LIMIT ${num.matchedText}`, [num]);
}

// ============================================================
// Top-level parse function
// ============================================================

/**
 * Parse a SQL query string against the CFG grammar and return
 * the derivation tree.
 *
 * Returns null if the SQL doesn't match the grammar.
 */
export function parseQuery(sql: string): GrammarDerivationNode | null {
  const state = new ParseState(sql.trim());
  const children: GrammarDerivationNode[] = [];

  // Required: SELECT clause
  const selectClause = parseSelectClause(state);
  if (!selectClause) return null;
  children.push(selectClause);

  // Required: FROM clause
  const fromClause = parseFromClause(state);
  if (!fromClause) return null;
  children.push(fromClause);

  // Optional: WHERE clause
  const whereClause = parseWhereClause(state);
  if (whereClause) children.push(whereClause);

  // Optional: GROUP BY clause
  const groupClause = parseGroupClause(state);
  if (groupClause) children.push(groupClause);

  // Optional: HAVING clause
  const havingClause = parseHavingClause(state);
  if (havingClause) children.push(havingClause);

  // Optional: ORDER BY clause
  const orderClause = parseOrderClause(state);
  if (orderClause) children.push(orderClause);

  // Optional: LIMIT clause
  const limitClause = parseLimitClause(state);
  if (limitClause) children.push(limitClause);

  // Should have consumed the entire input
  if (!state.isAtEnd) {
    // Partial parse — return what we got but flag it
    return node("query (partial)", sql, children);
  }

  return node("query", sql, children);
}

/**
 * Check if a SQL string can be fully parsed by the grammar.
 * Returns true if the grammar accepts the input.
 */
export function isValidGrammarSQL(sql: string): boolean {
  const result = parseQuery(sql);
  return result !== null && result.rule === "query";
}

/**
 * Pretty-print a derivation tree as indented text.
 * Useful for debugging and eval output.
 */
export function formatDerivationTree(
  tree: GrammarDerivationNode,
  indent: number = 0
): string {
  const prefix = indent === 0 ? "" : "│   ".repeat(indent - 1) + "├── ";
  let result = `${prefix}${tree.rule}`;

  if (tree.children.length === 0) {
    result += ` → "${tree.matchedText}"`;
  }

  for (const child of tree.children) {
    result += "\n" + formatDerivationTree(child, indent + 1);
  }

  return result;
}
