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
      description TEXT NOT NULL DEFAULT ''
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
      text TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_modules_project ON modules(project_id);
    CREATE INDEX IF NOT EXISTS idx_objects_module ON objects(module_id);
    CREATE INDEX IF NOT EXISTS idx_objects_parent ON objects(parent_id);
  `);
  return db;
}
