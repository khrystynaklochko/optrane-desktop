CREATE DATABASE IF NOT EXISTS optrane;

CREATE TABLE IF NOT EXISTS optrane.production_facts
(
    production_id String,
    fact_type LowCardinality(String),
    entity_id String,
    state LowCardinality(String),
    payload_json String,
    updated_at DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (production_id, fact_type, entity_id);

CREATE TABLE IF NOT EXISTS optrane.production_events
(
    production_id String,
    event_id String,
    event_type LowCardinality(String),
    actor String,
    payload_json String,
    created_at DateTime64(3)
)
ENGINE = MergeTree
ORDER BY (production_id, created_at, event_id);
