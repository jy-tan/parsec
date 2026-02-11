#!/bin/bash
set -euo pipefail

# Ingest GH Archive JSON data into local ClickHouse
# Requires: ClickHouse running via docker-compose, data downloaded via seed-data.sh

CLICKHOUSE_HOST="${CLICKHOUSE_HOST:-localhost}"
CLICKHOUSE_PORT="${CLICKHOUSE_PORT:-8123}"
DATA_DIR="$(dirname "$0")/../data"

shopt -s nullglob
FILES=("$DATA_DIR"/*.json)
shopt -u nullglob

if [ ${#FILES[@]} -eq 0 ]; then
  echo "Error: No JSON files found in $DATA_DIR. Run ./scripts/seed-data.sh first."
  exit 1
fi

echo "Ingesting GH Archive data into ClickHouse at ${CLICKHOUSE_HOST}:${CLICKHOUSE_PORT}..."
echo "  Found ${#FILES[@]} file(s) in $DATA_DIR"

# Transform each JSON file: extract relevant fields and insert into ClickHouse
# GH Archive events have nested structure; we extract the fields we need with jq
for FILE in "${FILES[@]}"; do
  BASENAME=$(basename "$FILE")
  echo "  Processing $BASENAME..."

  # Use jq to extract and reshape fields, then pipe to ClickHouse
  # GH Archive schema: { id, type, actor: { login }, repo: { name }, created_at, payload: { action, number, pull_request: { title, body }, issue: { title, body }, ref } }
  cat "$FILE" | jq -c '{
    id: (.id | tonumber // 0),
    type: .type,
    actor_login: (.actor.login // ""),
    repo_name: (.repo.name // ""),
    created_at: (.created_at | sub("T"; " ") | sub("Z$"; "")),
    action: (.payload.action // ""),
    number: (.payload.number // 0),
    title: (.payload.pull_request.title // .payload.issue.title // ""),
    body: "",
    ref: (.payload.ref // ""),
    is_private: (if .public == false then 1 else 0 end)
  }' | curl -s \
    "http://${CLICKHOUSE_HOST}:${CLICKHOUSE_PORT}/?query=INSERT+INTO+github_events+FORMAT+JSONEachRow" \
    --data-binary @-

  echo "    Done."
done

ROW_COUNT=$(curl -s "http://${CLICKHOUSE_HOST}:${CLICKHOUSE_PORT}/?query=SELECT+count()+FROM+github_events")
echo ""
echo "Ingestion complete. Total rows: ${ROW_COUNT}"
