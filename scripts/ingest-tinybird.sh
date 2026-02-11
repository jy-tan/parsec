#!/bin/bash
set -euo pipefail

# Ingest local GH Archive JSON files into Tinybird.
#
# Required env vars:
#   TINYBIRD_HOST=https://api.us-east.tinybird.co
#   TINYBIRD_TOKEN=<your ingest token>
#   TINYBIRD_DATASOURCE=github_events
#
# Optional:
#   DATA_DIR=./data
#   FILE_GLOB=2025-11-01-*.json

TINYBIRD_HOST="${TINYBIRD_HOST:-}"
TINYBIRD_TOKEN="${TINYBIRD_TOKEN:-}"
TINYBIRD_DATASOURCE="${TINYBIRD_DATASOURCE:-github_events}"
DATA_DIR="${DATA_DIR:-$(dirname "$0")/../data}"
FILE_GLOB="${FILE_GLOB:-*.json}"

if [ -z "$TINYBIRD_HOST" ]; then
  echo "Error: TINYBIRD_HOST is required (e.g. https://api.us-east.tinybird.co)."
  exit 1
fi

if [ -z "$TINYBIRD_TOKEN" ]; then
  echo "Error: TINYBIRD_TOKEN is required."
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required."
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "Error: curl is required."
  exit 1
fi

shopt -s nullglob
FILES=("$DATA_DIR"/$FILE_GLOB)
shopt -u nullglob

if [ ${#FILES[@]} -eq 0 ]; then
  echo "Error: No files matched $DATA_DIR/$FILE_GLOB"
  exit 1
fi

API_URL="${TINYBIRD_HOST%/}/v0/events?name=${TINYBIRD_DATASOURCE}&format=ndjson"

echo "Ingesting ${#FILES[@]} file(s) into Tinybird..."
echo "  Host:       ${TINYBIRD_HOST}"
echo "  Datasource: ${TINYBIRD_DATASOURCE}"
echo "  File glob:  ${FILE_GLOB}"

total_rows=0

for FILE in "${FILES[@]}"; do
  BASENAME=$(basename "$FILE")
  rows_in_file=$(wc -l < "$FILE" | tr -d ' ')
  echo "  Processing ${BASENAME} (${rows_in_file} row(s))..."

  jq -c '{
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
  }' "$FILE" | curl -fsS -X POST "$API_URL" \
    -H "Authorization: Bearer ${TINYBIRD_TOKEN}" \
    -H "Content-Type: application/x-ndjson" \
    --data-binary @-

  total_rows=$((total_rows + rows_in_file))
  echo "    Done."
done

echo ""
echo "Tinybird ingestion complete."
echo "  Files processed: ${#FILES[@]}"
echo "  Approx rows sent: ${total_rows}"
