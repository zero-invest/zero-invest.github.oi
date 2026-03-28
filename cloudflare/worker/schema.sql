-- D1 数据库迁移脚本
-- 创建基金运行时数据表

-- 运行时同步记录表
CREATE TABLE IF NOT EXISTS runtime_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  synced_at TEXT NOT NULL,
  fund_count INTEGER DEFAULT 0,
  source_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 基金运行时数据表（最新快照）
CREATE TABLE IF NOT EXISTS latest_fund_runtime (
  code TEXT PRIMARY KEY,
  synced_at TEXT NOT NULL,
  runtime_json TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 手动溢价率记录表
CREATE TABLE IF NOT EXISTS manual_premium_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  date TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'manual',
  premium_rate REAL NOT NULL,
  source_url TEXT,
  status TEXT DEFAULT 'manual-input',
  time TEXT DEFAULT '15:00:00',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(code, date, provider)
);

-- 第三方溢价率历史快照（用于云端 premium-compare 统计）
CREATE TABLE IF NOT EXISTS premium_compare_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  provider TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL DEFAULT '15:00:00',
  market_price REAL,
  our_premium_rate REAL,
  provider_premium_rate REAL NOT NULL,
  source_url TEXT,
  status TEXT DEFAULT '',
  updated_at TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(code, provider, date, time)
);

-- premium-compare 聚合缓存
CREATE TABLE IF NOT EXISTS premium_compare_cache (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  generated_at TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 自主同步引擎游标（分批轮巡全基金）
CREATE TABLE IF NOT EXISTS sync_engine_cursor (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  next_index INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- 用户账户表
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL UNIQUE,
  account_type TEXT NOT NULL DEFAULT 'username',
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  invited_by_user_id INTEGER,
  invite_bound_at TEXT,
  invite_reward_deadline_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TEXT,
  FOREIGN KEY (invited_by_user_id) REFERENCES users(id)
);

-- 用户会话表
CREATE TABLE IF NOT EXISTS user_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  session_token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 会员状态表
CREATE TABLE IF NOT EXISTS memberships (
  user_id INTEGER PRIMARY KEY,
  member_expires_at TEXT,
  trial_granted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 会员变更流水
CREATE TABLE IF NOT EXISTS membership_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  days INTEGER NOT NULL,
  source_type TEXT NOT NULL DEFAULT '',
  source_id TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 兑换码表
CREATE TABLE IF NOT EXISTS redeem_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code_hash TEXT NOT NULL UNIQUE,
  code_mask TEXT NOT NULL,
  batch_no TEXT NOT NULL DEFAULT '',
  days INTEGER NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 1,
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  disabled_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT NOT NULL DEFAULT 'system'
);

-- 兑换码使用记录
CREATE TABLE IF NOT EXISTS redeem_code_usages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  redeem_code_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  request_ip TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (redeem_code_id) REFERENCES redeem_codes(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 赞赏/订单记录
CREATE TABLE IF NOT EXISTS reward_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  channel TEXT NOT NULL,
  amount_fen INTEGER NOT NULL,
  days INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_review',
  screenshot_url TEXT NOT NULL DEFAULT '',
  screenshot_hash TEXT NOT NULL DEFAULT '',
  ocr_status TEXT NOT NULL DEFAULT 'pending',
  ocr_summary TEXT NOT NULL DEFAULT '',
  external_order_no TEXT NOT NULL DEFAULT '',
  paid_at TEXT,
  reviewed_at TEXT,
  reviewer_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 邀请奖励记录
CREATE TABLE IF NOT EXISTS invite_rewards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inviter_user_id INTEGER NOT NULL,
  invitee_user_id INTEGER NOT NULL,
  reward_order_id INTEGER NOT NULL,
  days INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(invitee_user_id, reward_order_id),
  FOREIGN KEY (inviter_user_id) REFERENCES users(id),
  FOREIGN KEY (invitee_user_id) REFERENCES users(id),
  FOREIGN KEY (reward_order_id) REFERENCES reward_orders(id)
);

-- 风控请求日志
CREATE TABLE IF NOT EXISTS risk_request_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  target_key TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 风控异常标记
CREATE TABLE IF NOT EXISTS risk_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  order_id INTEGER,
  flag_type TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (order_id) REFERENCES reward_orders(id)
);

-- 创建索引以优化查询
CREATE INDEX IF NOT EXISTS idx_runtime_runs_synced_at ON runtime_runs(synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_latest_fund_runtime_code ON latest_fund_runtime(code);
CREATE INDEX IF NOT EXISTS idx_manual_premium_code_date ON manual_premium_entries(code, date DESC);
CREATE INDEX IF NOT EXISTS idx_premium_compare_history_lookup ON premium_compare_history(code, provider, date DESC, time DESC);
CREATE INDEX IF NOT EXISTS idx_users_account_id ON users(account_id);
CREATE INDEX IF NOT EXISTS idx_users_invite_code ON users(invite_code);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_membership_events_user_id ON membership_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_redeem_codes_batch_no ON redeem_codes(batch_no, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_redeem_code_usages_user_id ON redeem_code_usages(user_id, used_at DESC);
CREATE INDEX IF NOT EXISTS idx_reward_orders_user_id ON reward_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reward_orders_status ON reward_orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invite_rewards_inviter_user_id ON invite_rewards(inviter_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_risk_request_logs_target ON risk_request_logs(scope, target_key, action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_risk_flags_user_id ON risk_flags(user_id, created_at DESC);

-- 插入初始测试数据（可选）
INSERT OR IGNORE INTO runtime_runs (synced_at, fund_count, source_url) 
VALUES (datetime('now'), 0, 'initial-setup');
