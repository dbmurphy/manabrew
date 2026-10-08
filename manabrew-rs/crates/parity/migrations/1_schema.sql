CREATE TABLE IF NOT EXISTS runs (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id              INTEGER NOT NULL,
    deck1                 TEXT NOT NULL,
    deck2                 TEXT NOT NULL,
    seed                  INTEGER NOT NULL,
    status                TEXT NOT NULL,
    snapshots_compared    INTEGER NOT NULL,
    divergence_count      INTEGER NOT NULL,
    first_divergence_field TEXT,
    first_divergence_rust  TEXT,
    first_divergence_java  TEXT,
    covered_cards         TEXT NOT NULL DEFAULT '[]',
    duration_ms           INTEGER NOT NULL,
    error_message         TEXT,
    rust_trace            TEXT,
    java_trace            TEXT,
    is_fuzz               INTEGER NOT NULL DEFAULT 0,
    commit_sha            TEXT,
    timestamp             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_runs_timestamp ON runs(timestamp);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_batch ON runs(batch_id);
CREATE INDEX IF NOT EXISTS idx_runs_deck_pair ON runs(deck1, deck2);

CREATE TABLE IF NOT EXISTS analysis_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS known_clusters (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    cluster_key     TEXT NOT NULL UNIQUE,
    failure_count   INTEGER NOT NULL DEFAULT 0,
    first_seen      TEXT NOT NULL,
    last_seen       TEXT NOT NULL,
    github_issue    INTEGER,
    last_discord_ts TEXT,
    llm_analysis    TEXT
);
