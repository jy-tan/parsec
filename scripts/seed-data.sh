#!/bin/bash
set -euo pipefail

# Download GH Archive data files for a configurable hour range.
#
# Defaults keep current behavior:
#   START_DATE=2025-11-01 START_HOUR=0 TOTAL_HOURS=4 ./scripts/seed-data.sh
#
# Example: one week from midnight Feb 1 2026
#   START_DATE=2025-11-01 START_HOUR=0 TOTAL_HOURS=168 ./scripts/seed-data.sh

START_DATE="${START_DATE:-2025-11-01}"   # YYYY-MM-DD
START_HOUR="${START_HOUR:-0}"            # 0-23
TOTAL_HOURS="${TOTAL_HOURS:-4}"          # Number of hourly files to fetch
DATA_DIR="$(dirname "$0")/../data"

mkdir -p "$DATA_DIR"
cd "$DATA_DIR"

if ! command -v python3 >/dev/null 2>&1; then
  echo "Error: python3 is required for date/hour range generation."
  exit 1
fi

echo "Downloading GH Archive data..."
echo "  START_DATE=${START_DATE} START_HOUR=${START_HOUR} TOTAL_HOURS=${TOTAL_HOURS}"

FILES=$(START_DATE="$START_DATE" START_HOUR="$START_HOUR" TOTAL_HOURS="$TOTAL_HOURS" python3 - <<'PY'
from datetime import datetime, timedelta
import os
import sys

start_date = os.environ["START_DATE"]
start_hour = int(os.environ["START_HOUR"])
total_hours = int(os.environ["TOTAL_HOURS"])

if total_hours <= 0:
    print("TOTAL_HOURS must be > 0", file=sys.stderr)
    sys.exit(1)

start = datetime.strptime(f"{start_date} {start_hour:02d}", "%Y-%m-%d %H")
for i in range(total_hours):
    ts = start + timedelta(hours=i)
    print(f"{ts.strftime('%Y-%m-%d')}-{ts.hour}.json.gz")
PY
)

downloaded=0
skipped=0

while IFS= read -r FILE; do
  [ -z "$FILE" ] && continue
  JSON_FILE="${FILE%.gz}"

  if [ -f "$FILE" ] || [ -f "$JSON_FILE" ]; then
    echo "  Skipping $FILE (already exists)"
    skipped=$((skipped + 1))
    continue
  fi

  echo "  Downloading $FILE..."
  wget -q "https://data.gharchive.org/${FILE}"
  echo "  Decompressing $FILE..."
  gunzip "$FILE"
  downloaded=$((downloaded + 1))
done <<< "$FILES"

echo ""
echo "Download complete."
echo "  Downloaded: $downloaded file(s)"
echo "  Skipped:    $skipped file(s)"
echo "  Data dir:   $DATA_DIR"
echo ""
echo "Next step (local ClickHouse): ./scripts/ingest.sh"
echo "Next step (Tinybird):         ./scripts/ingest-tinybird.sh"
