import { NextResponse } from "next/server";
import { getClickHouseClient } from "@/lib/clickhouse/client";

/**
 * GET /api/stats
 *
 * Returns dataset summary stats (total events, date range).
 * Cached for the lifetime of the server process.
 */

let cached: { totalEvents: number; minDate: string; maxDate: string } | null = null;

export async function GET() {
  try {
    if (cached) {
      return NextResponse.json(cached);
    }

    const client = getClickHouseClient();
    const result = await client.query({
      query: `SELECT count() AS total_events, min(created_at) AS min_date, max(created_at) AS max_date FROM github_events`,
      format: "JSONEachRow",
    });
    const rows = await result.json<{
      total_events: number;
      min_date: string;
      max_date: string;
    }>();

    const row = rows[0];
    cached = {
      totalEvents: Number(row.total_events),
      minDate: row.min_date,
      maxDate: row.max_date,
    };

    return NextResponse.json(cached);
  } catch {
    return NextResponse.json(
      { totalEvents: 0, minDate: "", maxDate: "" },
      { status: 500 },
    );
  }
}
