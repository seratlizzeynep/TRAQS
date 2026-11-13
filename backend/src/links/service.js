import { HttpError } from "../errors.js";

// Link types come from a configuration file (config/link-types.json), not from code.
// Each: { name, inverse, description, informative }
export function normalizeLinkTypes(list) {
  if (!Array.isArray(list)) throw new Error("link types must be a list");
  const seen = new Set();
  return list.map((t) => {
    if (typeof t?.name !== "string" || t.name.trim() === "" || t.name.length > 30) throw new Error("every link type needs a name (max. 30 characters)");
    const name = t.name.trim();
    if (seen.has(name.toLowerCase())) throw new Error(`link type '${name}' is defined twice`);
    seen.add(name.toLowerCase());
    for (const k of ["inverse", "description"]) {
      if (t[k] !== undefined && typeof t[k] !== "string") throw new Error(`link type '${name}': ${k} must be a string`);
    }
    return { name, inverse: t.inverse?.trim() || name, description: t.description ?? "", informative: t.informative === true };
  });
}

// What the UI needs to show one end of a link; also for objects that were deleted since.
const END = `o.id AS id, o.display_id AS display_id, o.heading AS heading, o.module_id AS module_id,
             m.name AS module_name, (o.deleted_at IS NOT NULL) AS deleted`;

export function createLinkService(db, { types = [] } = {}) {
  const linkTypes = normalizeLinkTypes(types);
  const byName = new Map(linkTypes.map((t) => [t.name, t]));

  const end = (objectId) => {
    const r = db.prepare(`SELECT ${END} FROM objects o JOIN modules m ON m.id = o.module_id WHERE o.id = ?`).get(objectId);
    return { ...r, deleted: !!r.deleted };
  };
  const full = (row) => ({ ...row, source: end(row.source_id), target: end(row.target_id) });

  return {
    types: linkTypes,

    // The type must be one of the configured ones.
    checkType(name) {
      if (typeof name !== "string" || !byName.has(name)) {
        throw new HttpError(422, `type must be one of: ${linkTypes.map((t) => t.name).join(", ") || "(no link types configured)"}`);
      }
      return byName.get(name);
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

    remove: (id) => db.prepare("DELETE FROM links WHERE id = ?").run(id),
  };
}
