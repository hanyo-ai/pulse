import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = process.env.DB_PATH || "pulse.db";

// Singleton pattern for database
let _db: Database | null = null;

export function getDb(): Database {
  if (!_db) {
    // Ensure parent dir exists — needed when DB_PATH points outside cwd
    // (e.g. ~/.pulse/pulse.db when launched via the `pulse` CLI).
    const dir = dirname(DB_PATH);
    if (dir && dir !== "." && dir !== "/") {
      try { mkdirSync(dir, { recursive: true }); } catch { /* exists */ }
    }
    _db = new Database(DB_PATH, { create: true });
    _db.run("PRAGMA journal_mode=WAL");
    _db.run("PRAGMA foreign_keys=ON");
    initSchema(_db);
    seedAdmin(_db);
  }
  return _db;
}

function initSchema(db: Database) {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      role TEXT DEFAULT 'admin',
      created_at TEXT DEFAULT (replace(datetime('now'), ' ', 'T') || 'Z'),
      updated_at TEXT DEFAULT (replace(datetime('now'), ' ', 'T') || 'Z')
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at TEXT DEFAULT (replace(datetime('now'), ' ', 'T') || 'Z'),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT DEFAULT 'live',
      tokens INTEGER DEFAULT 0,
      latency TEXT DEFAULT '0ms',
      cost TEXT DEFAULT '$0.00',
      user_id INTEGER,
      created_at TEXT DEFAULT (replace(datetime('now'), ' ', 'T') || 'Z'),
      updated_at TEXT DEFAULT (replace(datetime('now'), ' ', 'T') || 'Z'),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tokens INTEGER DEFAULT 0,
      latency TEXT DEFAULT '—',
      created_at TEXT DEFAULT (replace(datetime('now'), ' ', 'T') || 'Z'),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS request_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT UNIQUE NOT NULL,
      session_id TEXT,
      provider TEXT,
      model TEXT,
      status_code INTEGER,
      latency_ms INTEGER,
      tokens INTEGER,
      prompt_cache_hit_tokens INTEGER DEFAULT 0,
      prompt_cache_miss_tokens INTEGER DEFAULT 0,
      cost TEXT,
      created_at TEXT DEFAULT (replace(datetime('now'), ' ', 'T') || 'Z'),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS endpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_name TEXT NOT NULL,
      provider_key TEXT NOT NULL,
      endpoint_url TEXT NOT NULL,
      status TEXT DEFAULT 'healthy',
      latency_ms INTEGER DEFAULT 0,
      error_rate REAL DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (replace(datetime('now'), ' ', 'T') || 'Z'),
      updated_at TEXT DEFAULT (replace(datetime('now'), ' ', 'T') || 'Z')
    )
  `);

  // Migration: add response_body to request_logs
  try {
    db.run("ALTER TABLE request_logs ADD COLUMN response_body TEXT DEFAULT ''");
  } catch { /* column already exists */ }

  // Migration: add request_body to request_logs
  try {
    db.run("ALTER TABLE request_logs ADD COLUMN request_body TEXT DEFAULT ''");
  } catch { /* column already exists */ }

  // Migration: add new columns if they don't exist
  const newColumns = [
    { name: "display_name", def: "TEXT DEFAULT ''" },
    { name: "provider_format", def: "TEXT DEFAULT 'openai'" },
    { name: "model_name", def: "TEXT DEFAULT ''" },
    { name: "api_key", def: "TEXT DEFAULT ''" },
    { name: "gateway_key", def: "TEXT DEFAULT ''" },
    { name: "price_input_per_m", def: "REAL DEFAULT 0" },
    { name: "price_output_per_m", def: "REAL DEFAULT 0" },
    { name: "price_cache_input_per_m", def: "REAL DEFAULT 0" },
  ];
  for (const col of newColumns) {
    try {
      db.run(`ALTER TABLE endpoints ADD COLUMN ${col.name} ${col.def}`);
    } catch {
      // column already exists, ignore
    }
  }

  // Migration: scope sessions to the endpoint (gateway key) that created them,
  // so conversation-continuity matching never crosses endpoint/tenant boundaries.
  try {
    db.run("ALTER TABLE sessions ADD COLUMN endpoint_id INTEGER");
  } catch {
    // column already exists, ignore
  }

  // Migration: add cache columns to request_logs if they don't exist
  const logColumns = [
    { name: "prompt_cache_hit_tokens", def: "INTEGER DEFAULT 0" },
    { name: "prompt_cache_miss_tokens", def: "INTEGER DEFAULT 0" },
  ];
  for (const col of logColumns) {
    try {
      db.run(`ALTER TABLE request_logs ADD COLUMN ${col.name} ${col.def}`);
    } catch {
      // column already exists, ignore
    }
  }

  // Migration: add cache columns to sessions for per-session cache hit rate
  const sessCacheCols = [
    { name: "cache_hit_tokens", def: "INTEGER DEFAULT 0" },
    { name: "cache_miss_tokens", def: "INTEGER DEFAULT 0" },
  ];
  for (const col of sessCacheCols) {
    try {
      db.run(`ALTER TABLE sessions ADD COLUMN ${col.name} ${col.def}`);
    } catch {
      // column already exists, ignore
    }
  }

  // Migration: add models JSON array to endpoints (multi-model support)
  try {
    db.run("ALTER TABLE endpoints ADD COLUMN models TEXT DEFAULT '[]'");
  } catch {
    // column already exists, ignore
  }

  // ── Gateway keys: standalone access credentials, decoupled from endpoints ──
  // Each key can be restricted to a whitelist of model names; an empty/NULL
  // whitelist means "all models". Requests route: key → allowed? → endpoint
  // that declares the requested model.
  db.run(`
    CREATE TABLE IF NOT EXISTS gateway_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      name TEXT DEFAULT '',
      models TEXT DEFAULT '[]',
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (replace(datetime('now'), ' ', 'T') || 'Z'),
      updated_at TEXT DEFAULT (replace(datetime('now'), ' ', 'T') || 'Z')
    )
  `);

  // Migrate legacy per-endpoint gateway keys into the new table so existing
  // installs keep working without any manual step.
  try {
    const legacy = db.query(
      "SELECT DISTINCT gateway_key FROM endpoints WHERE gateway_key != ''"
    ).all() as { gateway_key: string }[];
    const insert = db.prepare(
      "INSERT OR IGNORE INTO gateway_keys (key, name, models) VALUES (?, ?, '[]')"
    );
    for (const row of legacy) insert.run(row.gateway_key, "legacy");
  } catch {
    // endpoints table may not have gateway_key yet on a fresh schema
  }

  // Indexes for hot query paths (log retention cleanup, dashboards, message loading)
  db.run("CREATE INDEX IF NOT EXISTS idx_request_logs_created_at ON request_logs(created_at)");
  db.run("CREATE INDEX IF NOT EXISTS idx_request_logs_session_id ON request_logs(session_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at)");
  db.run("CREATE INDEX IF NOT EXISTS idx_sessions_endpoint_id ON sessions(endpoint_id)");
}

function seedAdmin(db: Database) {
  const count = db.query("SELECT COUNT(*) as c FROM users").get() as { c: number };
  if (count.c > 0) return;

  const passwordHash = Bun.password.hashSync("admin123", "bcrypt");
  db.run(
    "INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)",
    ["admin", passwordHash, "Admin", "admin"]
  );
}
