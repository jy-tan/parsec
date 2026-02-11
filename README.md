# Parsec

A project to demonstrate natural language to safe ClickHouse SQL using GPT-5 with CFG-constrained generation.

Parsec lets you query a GitHub events dataset in plain English and returns:

- validated SQL
- table/chart/scalar results
- a concise natural-language answer
- clarification prompts for ambiguous or impossible questions

## Core Features

- GPT-5 SQL generation via OpenAI Responses API + Lark grammar tool format
- Intent classification (`ANSWERABLE`, `AMBIGUOUS`, `IMPOSSIBLE`, `OUT_OF_SCOPE`)
- Retry loop with result adequacy checks
- Auto visualization (`line_chart`, `bar_chart`, `table`, `scalar`, `empty`)
- Grammar derivation tree viewer in the UI
- Built-in eval framework (coverage, safety, semantic, degradation, adequacy)

Architecture: [`docs/design.md`](./docs/design.md).

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env.local
```

Set at least:

- `OPENAI_API_KEY`
- `CLICKHOUSE_URL` (defaults to `http://localhost:8123` if omitted in code, but set explicitly for clarity)

### 3. Start ClickHouse (local)

```bash
docker compose up -d
```

### 4. Seed data (optional but recommended)

```bash
# Default sample (4 hours)
./scripts/seed-data.sh

# One week (168 hours) starting at 2025-11-01 00:00
START_DATE=2025-11-01 START_HOUR=0 TOTAL_HOURS=168 ./scripts/seed-data.sh
```

Ingest options:

```bash
# Local ClickHouse
./scripts/ingest.sh

# Tinybird (requires TINYBIRD_HOST + TINYBIRD_TOKEN env vars)
./scripts/ingest-tinybird.sh
```

### 5. Run the app

```bash
npm run dev
```

Open `http://localhost:3000`.

## Running Evals

```bash
# all categories
npm run evals

# specific category
npm run evals -- --category grammar-safety
npm run evals -- --category semantic
npm run evals -- --category adequacy
```

Eval UI is available at `http://localhost:3000/evals`.
