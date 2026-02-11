#!/bin/bash
set -euo pipefail

# Chunked Tinybird ingest to avoid HTTP 413 payload-too-large errors.
#
# Required env vars:
#   TINYBIRD_HOST=https://api.us-west-2.aws.tinybird.co
#   TINYBIRD_TOKEN=tbp_...
#   TINYBIRD_DATASOURCE=github_events
#
# Optional:
#   DATA_DIR=./data
#   FILE_GLOB=*.json
#   CHUNK_LINES=10000

TINYBIRD_HOST="${TINYBIRD_HOST:-}"
TINYBIRD_TOKEN="${TINYBIRD_TOKEN:-}"
TINYBIRD_DATASOURCE="${TINYBIRD_DATASOURCE:-github_events}"
DATA_DIR="${DATA_DIR:-$(dirname "$0")/../data}"
FILE_GLOB="${FILE_GLOB:-*.json}"
CHUNK_LINES="${CHUNK_LINES:-10000}"

if [ -z "$TINYBIRD_HOST" ]; then
  echo "Error: TINYBIRD_HOST is required (e.g. https://api.us-west-2.aws.tinybird.co)."
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

if ! command -v split >/dev/null 2>&1; then
  echo "Error: split is required."
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

echo "Ingesting ${#FILES[@]} file(s) into Tinybird (chunked)..."
echo "  Host:        ${TINYBIRD_HOST}"
echo "  Datasource:  ${TINYBIRD_DATASOURCE}"
echo "  File glob:   ${FILE_GLOB}"
echo "  Chunk lines: ${CHUNK_LINES}"

total_rows=0
total_chunks=0

for FILE in "${FILES[@]}"; do
  BASENAME=$(basename "$FILE")
  rows_in_file=$(wc -l < "$FILE" | tr -d ' ')
  echo ""
  echo "Processing ${BASENAME} (${rows_in_file} row(s))..."

  TMP_DIR="$(mktemp -d)"
  TRANSFORMED="${TMP_DIR}/transformed.ndjson"

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
  }' "$FILE" > "$TRANSFORMED"

  split -l "$CHUNK_LINES" -d -a 5 "$TRANSFORMED" "${TMP_DIR}/chunk_"
  shopt -s nullglob
  CHUNKS=("${TMP_DIR}"/chunk_*)
  shopt -u nullglob

  if [ ${#CHUNKS[@]} -eq 0 ]; then
    echo "  No chunks generated for ${BASENAME}, skipping."
    rm -rf "$TMP_DIR"
    continue
  fi

  echo "  Uploading ${#CHUNKS[@]} chunk(s)..."

  for CHUNK in "${CHUNKS[@]}"; do
    chunk_name=$(basename "$CHUNK")

    for ATTEMPT in 1 2 3; do
      if curl -fsS -X POST "$API_URL" \
        -H "Authorization: Bearer ${TINYBIRD_TOKEN}" \
        -H "Content-Type: application/x-ndjson" \
        --data-binary @"$CHUNK"; then
        break
      fi

      echo "    Retry ${ATTEMPT}/3 for ${chunk_name}..."
      sleep $((ATTEMPT * 2))

      if [ "$ATTEMPT" -eq 3 ]; then
        echo "Error: Failed chunk ${chunk_name} from ${BASENAME}"
        rm -rf "$TMP_DIR"
        exit 1
      fi
    done
  done

  total_rows=$((total_rows + rows_in_file))
  total_chunks=$((total_chunks + ${#CHUNKS[@]}))
  rm -rf "$TMP_DIR"
  echo "Done ${BASENAME}"
done

echo ""
echo "Tinybird chunked ingestion complete."
echo "  Files processed: ${#FILES[@]}"
echo "  Approx rows sent: ${total_rows}"
echo "  Chunks sent: ${total_chunks}"
