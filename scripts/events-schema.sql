CREATE TABLE IF NOT EXISTS ingest_state (
  file TEXT PRIMARY KEY,
  byte_offset INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS games (
  game_id TEXT PRIMARY KEY,
  room_id TEXT,
  started_at TEXT,
  ended_at TEXT,
  duration_s REAL,
  format TEXT,
  engine TEXT,
  hosted INTEGER,
  official INTEGER,
  starting_life INTEGER,
  player_count INTEGER,
  end_reason TEXT,
  game_over INTEGER,
  winner TEXT,
  source TEXT,
  reported_at TEXT,
  reported INTEGER,
  turns INTEGER,
  direct_seats INTEGER
);
CREATE TABLE IF NOT EXISTS game_players (
  game_id TEXT NOT NULL,
  username TEXT NOT NULL,
  is_bot INTEGER,
  deck_name TEXT,
  commander TEXT,
  published_deck_id TEXT,
  deck_fingerprint TEXT,
  PRIMARY KEY (game_id, username)
);
CREATE TABLE IF NOT EXISTS decks (
  deck_id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT,
  room_id TEXT,
  username TEXT,
  is_bot INTEGER,
  deck_name TEXT,
  commander TEXT,
  sideboard_count INTEGER
);
CREATE TABLE IF NOT EXISTS deck_cards (
  deck_id INTEGER NOT NULL REFERENCES decks(deck_id),
  name TEXT NOT NULL,
  set_code TEXT,
  count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT,
  event TEXT,
  room_id TEXT,
  payload TEXT,
  event_id TEXT
);
CREATE TABLE IF NOT EXISTS client_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  username TEXT NOT NULL,
  platform TEXT NOT NULL,
  reconnected INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_client_connections_ts ON client_connections(ts);
CREATE TABLE IF NOT EXISTS plane_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  room_id TEXT,
  username TEXT NOT NULL,
  peer TEXT NOT NULL,
  plane TEXT NOT NULL,
  outcome TEXT NOT NULL,
  phase TEXT NOT NULL,
  connect_ms INTEGER,
  rtt_ms INTEGER,
  relay_rtt_ms INTEGER,
  candidate_pair TEXT
);
CREATE INDEX IF NOT EXISTS idx_plane_attempts_ts ON plane_attempts(ts);
CREATE INDEX IF NOT EXISTS idx_games_started ON games(started_at);
CREATE INDEX IF NOT EXISTS idx_games_ranking ON games(official, format, started_at);
CREATE INDEX IF NOT EXISTS idx_game_players_user ON game_players(username);
CREATE INDEX IF NOT EXISTS idx_game_players_publication
  ON game_players(published_deck_id, deck_fingerprint)
  WHERE is_bot = 0 AND published_deck_id IS NOT NULL AND deck_fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deck_cards_name ON deck_cards(name);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE TABLE IF NOT EXISTS engine_stats (
  report_id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  source TEXT NOT NULL,
  game_id TEXT,
  engine TEXT NOT NULL,
  client_version TEXT,
  platform TEXT,
  format TEXT,
  seats INTEGER,
  multiplayer INTEGER,
  duration_s INTEGER,
  end_reason TEXT,
  decisions INTEGER,
  turnaround_p50 INTEGER,
  turnaround_p90 INTEGER,
  turnaround_max INTEGER,
  engine_p50 INTEGER,
  engine_p90 INTEGER,
  engine_max INTEGER,
  engine_same_p50 INTEGER,
  engine_same_p90 INTEGER,
  engine_same_max INTEGER,
  engine_cross_p50 INTEGER,
  engine_cross_p90 INTEGER,
  engine_cross_max INTEGER,
  think_hidden INTEGER NOT NULL DEFAULT 0,
  reply_wait_p50 INTEGER,
  reply_wait_p90 INTEGER,
  reply_wait_max INTEGER,
  client_work_p50 INTEGER,
  client_work_p90 INTEGER,
  client_work_max INTEGER,
  engine_bot_p50 INTEGER,
  engine_bot_p90 INTEGER,
  engine_bot_max INTEGER,
  engine_rules_p50 INTEGER,
  engine_rules_p90 INTEGER,
  engine_rules_max INTEGER,
  checkpoints TEXT
);
CREATE INDEX IF NOT EXISTS idx_engine_stats_ts ON engine_stats(ts);
CREATE INDEX IF NOT EXISTS idx_engine_stats_engine ON engine_stats(engine, ts);
CREATE TABLE IF NOT EXISTS hub_sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  synced_at TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS hub_metric_snapshots (
  snapshot_at TEXT NOT NULL,
  metric TEXT NOT NULL,
  dimension TEXT NOT NULL DEFAULT '',
  value REAL NOT NULL,
  PRIMARY KEY (snapshot_at, metric, dimension)
);
CREATE INDEX IF NOT EXISTS idx_hub_metric_snapshots_metric
  ON hub_metric_snapshots(metric, snapshot_at);
CREATE TABLE IF NOT EXISTS hub_daily_metrics (
  day TEXT NOT NULL,
  metric TEXT NOT NULL,
  dimension TEXT NOT NULL DEFAULT '',
  value REAL NOT NULL,
  PRIMARY KEY (day, metric, dimension)
);
CREATE INDEX IF NOT EXISTS idx_hub_daily_metrics_metric
  ON hub_daily_metrics(metric, day);
CREATE TABLE IF NOT EXISTS hub_collection_cards (
  card_key TEXT PRIMARY KEY,
  collectors INTEGER NOT NULL,
  copies INTEGER NOT NULL,
  refreshed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS hub_public_deck_cards (
  card_name TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT '',
  zone TEXT NOT NULL,
  decks INTEGER NOT NULL,
  copies INTEGER NOT NULL,
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (card_name, format, zone)
);
CREATE INDEX IF NOT EXISTS idx_events_event_id ON events(event_id);
