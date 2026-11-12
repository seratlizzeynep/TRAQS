import Database from "better-sqlite3";

// Relational schema: projects 1-* modules 1-* objects; objects form a tree
// via parent_id, siblings are ordered by a gap-free 0-based `position`.
export function openDb(path = process.env.TRAQS_DATABASE ?? "traqs.db") {
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      next_seq INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS modules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS objects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      module_id INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
      parent_id INTEGER REFERENCES objects(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      heading TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL DEFAULT '',
      display_id TEXT,
      deleted_at TEXT
    );
    -- IDs of deleted objects; an ID listed here is never issued again.
    CREATE TABLE IF NOT EXISTS id_blacklist (
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      display_id TEXT NOT NULL,
      deleted_at TEXT NOT NULL,
      PRIMARY KEY (project_id, display_id)
    );
    CREATE TABLE IF NOT EXISTS links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
      target_id INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
      suspect INTEGER NOT NULL DEFAULT 0,
      UNIQUE (source_id, target_id)
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER
    );
    CREATE TABLE IF NOT EXISTS memberships (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('admin', 'author', 'reviewer', 'viewer')),
      PRIMARY KEY (user_id, project_id)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      last_activity INTEGER NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_modules_project ON modules(project_id);
    CREATE INDEX IF NOT EXISTS idx_objects_module ON objects(module_id);
    CREATE INDEX IF NOT EXISTS idx_objects_parent ON objects(parent_id);
  `);
  migrate(db);
  return db;
}

// Bring databases created by an earlier schema version up to date.
function migrate(db) {
  const has = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  if (!has("projects", "next_seq")) db.exec("ALTER TABLE projects ADD COLUMN next_seq INTEGER NOT NULL DEFAULT 1");
  if (!has("objects", "display_id")) db.exec("ALTER TABLE objects ADD COLUMN display_id TEXT");
  if (!has("objects", "deleted_at")) db.exec("ALTER TABLE objects ADD COLUMN deleted_at TEXT");
  // Backfill IDs for objects that were created before display IDs existed.
  const missing = db
    .prepare(
      `SELECT o.id, m.project_id FROM objects o JOIN modules m ON m.id = o.module_id
       WHERE o.display_id IS NULL ORDER BY o.id`
    )
    .all();
  for (const o of missing) {
    const display = nextDisplayId(db, o.project_id);
    db.prepare("UPDATE objects SET display_id = ? WHERE id = ?").run(display, o.id);
  }
}

export const formatDisplayId = (n) => `REQ-${String(n).padStart(4, "0")}`;

// Issues the next sequential ID of a project (REQ-0001, REQ-0002, ...).
// The counter only moves forward and blacklisted IDs are skipped, so an ID is never reused.
export function nextDisplayId(db, projectId) {
  for (;;) {
    const { next_seq } = db.prepare("SELECT next_seq FROM projects WHERE id = ?").get(projectId);
    db.prepare("UPDATE projects SET next_seq = next_seq + 1 WHERE id = ?").run(projectId);
    const candidate = formatDisplayId(next_seq);
    const blocked = db
      .prepare("SELECT 1 FROM id_blacklist WHERE project_id = ? AND display_id = ?")
      .get(projectId, candidate);
    if (!blocked) return candidate;
  }
}
