/*
 * Base CFG Grammar Template (Lark syntax)
 *
 * This template defines the structural grammar rules that are
 * independent of the specific table schema. Schema-dependent
 * rules (column names, enum values) are injected by the grammar
 * builder at runtime via {{PLACEHOLDER}} tokens.
 *
 * Syntax: Lark (https://lark-parser.readthedocs.io/en/stable/)
 * Target: OpenAI GPT-5 CFG constrained decoding via custom tools
 *
 * Key Lark conventions:
 *   - Rules are lowercase (parsed by parser)
 *   - Terminals are UPPERCASE (matched by lexer, greedy/longest)
 *   - String literals in "double quotes" become anonymous terminals
 *   - Regex terminals use /pattern/ syntax
 *   - Whitespace must be threaded explicitly
 *   - No %ignore directives (all whitespace is explicit)
 */

/**
 * The static (schema-independent) portion of the grammar.
 *
 * Placeholder tokens like {{STRING_COLS}}, {{NUMERIC_COLS}}, etc.
 * are replaced by the grammar builder with schema-derived Lark
 * alternatives before being sent to the OpenAI API.
 */
export const GRAMMAR_TEMPLATE = `
// Parsec ClickHouse SQL Grammar (Lark)
// Generates read-only SELECT queries against a single table.

start: select_clause from_clause where_clause? group_clause? having_clause? order_clause? limit_clause?

// ── SELECT ──────────────────────────────────────────────────

select_clause: "SELECT " select_list
select_list: select_item (", " select_item)*
select_item: agg_expr " AS " ALIAS
           | date_trunc_expr " AS " ALIAS
           | column_ref

// ── Aggregation ─────────────────────────────────────────────

agg_expr: agg_func "(" column_ref? ")"
agg_func: "count" | "sum" | "avg" | "min" | "max" | "uniq" | "uniqExact"

// ── Date truncation ─────────────────────────────────────────

date_trunc_expr: "toStartOfHour(created_at)"
               | "toStartOfDay(created_at)"
               | "toStartOfWeek(created_at)"
               | "toStartOfMonth(created_at)"
               | "toDate(created_at)"

// ── FROM ────────────────────────────────────────────────────

from_clause: " FROM {{TABLE_NAME}}"

// ── WHERE ───────────────────────────────────────────────────

where_clause: " WHERE " condition (" AND " condition)*
condition: string_condition | numeric_condition | datetime_condition | enum_condition

string_condition: string_col " = '" STRING_VALUE "'"
                | string_col " LIKE '%" STRING_VALUE "%'"
                | string_col " IN (" string_list ")"

numeric_condition: numeric_col " " compare_op " " NUMBER

datetime_condition: "created_at >= now() - INTERVAL " NUMBER " " time_unit
                  | "created_at BETWEEN '" DATE_LITERAL "' AND '" DATE_LITERAL "'"

enum_condition: "type = '" event_type "'"
              | "type IN (" event_type_list ")"
              | "action = '" action_value "'"

// ── GROUP BY ────────────────────────────────────────────────

group_clause: " GROUP BY " group_list
group_list: group_item (", " group_item)*
group_item: column_ref | date_trunc_expr

// ── HAVING ──────────────────────────────────────────────────

having_clause: " HAVING " agg_expr " " compare_op " " NUMBER

// ── ORDER BY ────────────────────────────────────────────────

order_clause: " ORDER BY " order_list
order_list: order_item (", " order_item)*
order_item: order_expr order_dir?
order_expr: column_ref | ALIAS | agg_expr
order_dir: " ASC" | " DESC"

// ── LIMIT ───────────────────────────────────────────────────

limit_clause: " LIMIT " NUMBER

// ── Operators ───────────────────────────────────────────────

compare_op: "!=" | ">=" | "<=" | "=" | ">" | "<"
time_unit: "HOUR" | "DAY" | "WEEK" | "MONTH"

// ── Schema-derived rules (injected by grammar builder) ──────

string_col: {{STRING_COLS}}
numeric_col: {{NUMERIC_COLS}}
column_ref: {{COLUMN_REF}}

event_type: {{EVENT_TYPES}}
action_value: {{ACTION_VALUES}}

event_type_list: "'" event_type "'" (", '" event_type "'")*
string_list: "'" STRING_VALUE "'" (", '" STRING_VALUE "'")*

// ── Terminals (regex, matched by lexer) ─────────────────────

ALIAS: /[a-z_][a-z0-9_]{0,29}/
STRING_VALUE: /[a-zA-Z0-9_.\\-\\/]{1,100}/
DATE_LITERAL: /[0-9]{4}-[0-9]{2}-[0-9]{2}/
NUMBER: /[0-9]{1,6}/
`.trim();

/**
 * List of placeholder tokens in the grammar template.
 * Each maps to a function in the grammar builder that provides schema-derived values.
 */
export const TEMPLATE_PLACEHOLDERS = [
  "{{TABLE_NAME}}",
  "{{STRING_COLS}}",
  "{{NUMERIC_COLS}}",
  "{{COLUMN_REF}}",
  "{{EVENT_TYPES}}",
  "{{ACTION_VALUES}}",
] as const;

export type TemplatePlaceholder = (typeof TEMPLATE_PLACEHOLDERS)[number];
