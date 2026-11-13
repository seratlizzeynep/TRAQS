import { HttpError } from "../errors.js";
import { evaluateKinds, normalizeLinkConfig } from "./rules.js";

// What the UI needs to show one end of a link; also for objects that were deleted since.
const END = `o.id AS id, o.display_id AS display_id, o.heading AS heading, o.module_id AS module_id,
             m.name AS module_name, (o.deleted_at IS NOT NULL) AS deleted`;

// Links and the rules that govern them (config/link-rules.json). `attrs` gives the kind of an object.
export function createLinkService(db, { config: rawConfig = {}, attrs } = {}) {
  const config = normalizeLinkConfig(rawConfig);
  const byName = new Map(config.types.map((t) => [t.name, t]));

  const end = (objectId) => {
    const r = db.prepare(`SELECT ${END} FROM objects o JOIN modules m ON m.id = o.module_id WHERE o.id = ?`).get(objectId);
    return { ...r, deleted: !!r.deleted };
  };
  const kindOf = (objectId) => {
    const v = config.kind_attribute ? attrs.valuesForObject(objectId)[config.kind_attribute] : undefined;
    return typeof v === "string" ? v : undefined;
  };
  const evaluate = (sourceId, targetId, type) => evaluateKinds(config, type, kindOf(sourceId), kindOf(targetId));
  const full = (row) => ({ ...row, source: end(row.source_id), target: end(row.target_id), rule: evaluate(row.source_id, row.target_id, row.type) });

  return {
    config,
    // The types as the UI needs them, each with the text of its rule.
    types: config.types.map((t) => ({ ...t, rule: config.rules[t.name] ? { description: config.rules[t.name].description, descriptions: config.rules[t.name].descriptions, allow: config.rules[t.name].allow } : null })),

    // The type must be one of the configured ones.
    checkType(name) {
      if (typeof name !== "string" || !byName.has(name)) {
        throw new HttpError(422, `type must be one of: ${config.types.map((t) => t.name).join(", ") || "(no link types configured)"}`);
      }
      return byName.get(name);
    },

    evaluate,

    // Would a link of this type from source to target close a cycle? (only for rules with acyclic: true)
    wouldCycle(sourceId, targetId, type) {
      if (!config.rules[type]?.acyclic) return false;
      return !!db
        .prepare(
          `WITH RECURSIVE reach(id) AS (
             SELECT ? UNION SELECT l.target_id FROM links l JOIN reach r ON l.source_id = r.id WHERE l.type = ?
           ) SELECT 1 FROM reach WHERE id = ? LIMIT 1`
        )
        .get(targetId, type, sourceId);
    },

    create(sourceId, targetId, type) {
      try {
        const r = db.prepare("INSERT INTO links (source_id, target_id, type) VALUES (?, ?, ?)").run(sourceId, targetId, type);
        return full(db.prepare("SELECT * FROM links WHERE id = ?").get(r.lastInsertRowid));
      } catch (e) {
        if (String(e.code).startsWith("SQLITE_CONSTRAINT")) throw new HttpError(409, `a ${type} link between these objects already exists`);
        throw e;
      }
    },

    get(id) {
      const r = db.prepare("SELECT * FROM links WHERE id = ?").get(id);
      if (!r) throw new HttpError(404, `Link ${id} not found`);
      return r;
    },

    forObject: (objectId) =>
      db.prepare("SELECT * FROM links WHERE source_id = ? OR target_id = ? ORDER BY id").all(objectId, objectId).map(full),

    // Links of a project that skip a level (gap) or no longer satisfy the rules (e.g. after a Level was changed).
    issues(projectId) {
      const rows = db
        .prepare(
          `SELECT l.* FROM links l JOIN objects o ON o.id = l.source_id JOIN modules m ON m.id = o.module_id
           WHERE m.project_id = ? ORDER BY l.id`
        )
        .all(projectId);
      return rows.map(full).filter((l) => l.rule.status !== "ok");
    },

    remove: (id) => db.prepare("DELETE FROM links WHERE id = ?").run(id),
  };
}
