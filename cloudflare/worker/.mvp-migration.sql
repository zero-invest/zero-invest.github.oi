ALTER TABLE reward_orders ADD COLUMN auto_review_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE reward_orders ADD COLUMN auto_review_score REAL NOT NULL DEFAULT 0;
ALTER TABLE reward_orders ADD COLUMN risk_score REAL NOT NULL DEFAULT 0;
ALTER TABLE reward_orders ADD COLUMN risk_level TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE reward_orders ADD COLUMN ocr_payload_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE reward_orders ADD COLUMN risk_payload_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE reward_orders ADD COLUMN capture_time TEXT;
ALTER TABLE reward_orders ADD COLUMN payee_account TEXT NOT NULL DEFAULT '';
ALTER TABLE reward_orders ADD COLUMN payee_account_masked TEXT NOT NULL DEFAULT '';
ALTER TABLE reward_orders ADD COLUMN review_source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE reward_orders ADD COLUMN auto_reviewed_at TEXT;

CREATE TABLE IF NOT EXISTS order_review_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  order_no TEXT NOT NULL,
  task_type TEXT NOT NULL DEFAULT 'auto-review',
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  FOREIGN KEY (order_id) REFERENCES reward_orders(id)
);

CREATE TABLE IF NOT EXISTS order_review_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  order_no TEXT NOT NULL,
  stage TEXT NOT NULL,
  action TEXT NOT NULL,
  operator_type TEXT NOT NULL DEFAULT 'system',
  operator_id TEXT NOT NULL DEFAULT '',
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES reward_orders(id)
);

CREATE TABLE IF NOT EXISTS system_configs (
  config_key TEXT PRIMARY KEY,
  config_value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT NOT NULL DEFAULT 'system'
);

CREATE INDEX IF NOT EXISTS idx_reward_orders_status_created_at ON reward_orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reward_orders_auto_review_status_created_at ON reward_orders(auto_review_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reward_orders_risk_level_created_at ON reward_orders(risk_level, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_review_tasks_status_created_at ON order_review_tasks(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_review_logs_order_created_at ON order_review_logs(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_risk_flags_order_created_at ON risk_flags(order_id, created_at DESC);

INSERT OR IGNORE INTO system_configs (config_key, config_value, updated_at, updated_by) VALUES ('auto_review_min_score', '85', CURRENT_TIMESTAMP, 'migration');
INSERT OR IGNORE INTO system_configs (config_key, config_value, updated_at, updated_by) VALUES ('manual_review_min_score', '60', CURRENT_TIMESTAMP, 'migration');
INSERT OR IGNORE INTO system_configs (config_key, config_value, updated_at, updated_by) VALUES ('max_allowed_pay_time_diff_minutes', '30', CURRENT_TIMESTAMP, 'migration');
INSERT OR IGNORE INTO system_configs (config_key, config_value, updated_at, updated_by) VALUES ('allowed_payee_accounts_json', '["利奥的笔记","微信赞赏码","leo"]', CURRENT_TIMESTAMP, 'migration');
