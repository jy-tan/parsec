// ============================================================
// Shared types for the parsec query engine
// ============================================================

// --- Schema types ---

export interface ColumnInfo {
  name: string;
  type: string;
  enumValues?: string[];
}

export interface TableSchema {
  tableName: string;
  columns: ColumnInfo[];
}

// --- Intent classification ---

export type IntentClassification =
  | "ANSWERABLE"
  | "AMBIGUOUS"
  | "IMPOSSIBLE"
  | "OUT_OF_SCOPE";

export interface IntentResult {
  classification: IntentClassification;
  reasoning: string;
  clarifications?: string[];
  suggestion?: string;
}

// --- Query pipeline ---

export interface QueryRequest {
  query: string;
}

export interface QueryColumn {
  name: string;
  type: string;
}

export interface QueryResultData {
  columns: QueryColumn[];
  rows: Record<string, unknown>[];
  rowCount: number;
  executionTimeMs: number;
}

export type VisualizationType =
  | "line_chart"
  | "bar_chart"
  | "scalar"
  | "table"
  | "empty";

export interface GrammarDerivationNode {
  rule: string;
  matchedText: string;
  children: GrammarDerivationNode[];
}

// Success response
export interface QuerySuccessResponse {
  status: "success";
  answer: string; // concise NL summary of the result
  sql: string;
  result: QueryResultData;
  visualizationHint: VisualizationType;
  grammarDerivation: GrammarDerivationNode | null;
  intentClassification: "ANSWERABLE";
}

// Clarification response
export interface QueryClarificationResponse {
  status: "clarification_needed";
  intentClassification: "AMBIGUOUS";
  message: string;
  suggestions: string[];
}

// Impossible response
export interface QueryImpossibleResponse {
  status: "impossible";
  intentClassification: "IMPOSSIBLE";
  message: string;
  suggestion?: string;
  suggestions?: string[];
}

// Out-of-scope response
export interface QueryOutOfScopeResponse {
  status: "out_of_scope";
  intentClassification: "OUT_OF_SCOPE";
  message: string;
  suggestions?: string[];
}

// Error response
export interface QueryErrorResponse {
  status: "error";
  message: string;
  sql?: string;
}

export type QueryResponse =
  | QuerySuccessResponse
  | QueryClarificationResponse
  | QueryImpossibleResponse
  | QueryOutOfScopeResponse
  | QueryErrorResponse;

// --- Eval types ---

export type EvalCategory =
  | "grammar-coverage"
  | "grammar-safety"
  | "semantic"
  | "degradation"
  | "adequacy";

export interface EvalCaseResult {
  id: string;
  category: EvalCategory;
  description: string;
  passed: boolean;
  details: string;
  durationMs: number;
}

export interface EvalCategorySummary {
  total: number;
  passed: number;
  metric: number; // recall, precision, or accuracy depending on category
  metricName: string;
}

export interface EvalRunResult {
  summary: {
    total: number;
    passed: number;
    failed: number;
    byCategory: Record<string, EvalCategorySummary>;
  };
  results: EvalCaseResult[];
}
