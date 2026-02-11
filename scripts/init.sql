-- ClickHouse schema for GH Archive GitHub events data

DROP TABLE IF EXISTS github_events;

CREATE TABLE github_events (
    id           UInt64,
    type         LowCardinality(String),
    actor_login  LowCardinality(String),
    repo_name    LowCardinality(String),
    created_at   DateTime,
    action       LowCardinality(String),
    number       UInt32,
    title        String,
    body         String,
    ref          LowCardinality(String),
    is_private   UInt8
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(created_at)
ORDER BY (created_at, type, repo_name, id);
