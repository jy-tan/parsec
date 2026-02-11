import type { QueryColumn, VisualizationType } from "@/lib/types";

function isDateType(type: string): boolean {
  return (
    type === "DateTime" ||
    type === "Date" ||
    type.startsWith("DateTime64") ||
    type.includes("Date")
  );
}

function isNumericType(type: string): boolean {
  return (
    type.startsWith("UInt") ||
    type.startsWith("Int") ||
    type.startsWith("Float") ||
    type.startsWith("Decimal") ||
    type === "number"
  );
}

function isCategoricalType(type: string): boolean {
  return (
    type === "String" ||
    type.startsWith("LowCardinality(String") ||
    type.startsWith("Nullable(String") ||
    type === "string" ||
    type.startsWith("Enum8") ||
    type.startsWith("Enum16") ||
    type.startsWith("LowCardinality(Nullable(String")
  );
}

/**
 * Detect the best visualization type for a query result.
 */
export function detectVisualization(
  columns: QueryColumn[],
  rows: Record<string, unknown>[]
): VisualizationType {
  if (rows.length === 0) return "empty";
  if (rows.length === 1 && columns.length === 1) return "scalar";

  const dateCol = columns.find((c) => isDateType(c.type));
  const numericCols = columns.filter((c) => isNumericType(c.type));
  const categoricalCols = columns.filter((c) => isCategoricalType(c.type));

  // Time-series: date column + numeric column(s), but NO categorical grouping
  // If there's a categorical column alongside the date (e.g. hour + type + count),
  // the data is multi-series/grouped — fall through to table since we don't
  // support multi-line charts yet.
  if (dateCol && numericCols.length >= 1 && categoricalCols.length === 0) {
    return "line_chart";
  }

  // Bar chart: one categorical column + numeric column(s), reasonable row count,
  // and no date column (otherwise it's a grouped time-series → table)
  if (
    categoricalCols.length === 1 &&
    numericCols.length >= 1 &&
    rows.length <= 25 &&
    !dateCol
  ) {
    return "bar_chart";
  }

  return "table";
}
