CREATE TABLE IF NOT EXISTS operations (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL CHECK (length(code) = 6),
  buy_date TEXT NOT NULL,
  buy_price REAL NOT NULL CHECK (buy_price > 0),
  sell_date TEXT,
  sell_price REAL CHECK (sell_price IS NULL OR sell_price > 0),
  parts REAL NOT NULL DEFAULT 1 CHECK (parts > 0),
  buy_condition TEXT NOT NULL DEFAULT '',
  sell_condition TEXT NOT NULL DEFAULT '',
  sell_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS operations_buy_date_idx ON operations (buy_date DESC);
