import { HttpError } from "../errors.js";
import { ValidationError, getType } from "./index.js";

const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

export function slugify(name) {
  let k = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40).replace(/_+$/, "");
  if (k === "") k = "attribute";
  if (!/^[a-z]/.test(k)) k = `a_${k}`.slice(0, 40);
  return k;
}

const publicDef = (r) => ({
  id: r.id,
  project_id: r.project_id,
  key: r.key,
  name: r.name,
  description: r.description,
  type: r.type,
  options: JSON.parse(r.options),
  position: r.position,
});

// Definitions and values of attributes. Type-specific behaviour lives in the type registry.
export function createAttributeService(db, { defaults = [] } = {}) {
  const typeOf = (name) => {
    const t = getType(name);
    if (!t) throw new HttpError(422, `unknown attribute type '${name}'`);
    return t;
  };
  const check = (fn) => {
    try {
      return fn();
    } catch (e) {
      if (e instanceof ValidationError) throw new HttpError(422, e.message);
      throw e;
    }
  };

  // Fail fast when the configured defaults are invalid.
  for (const d of defaults) {
    if (typeof d?.name !== "string" || d.name.trim() === "") throw new Error("default attribute without a name");
    check(() => typeOf(d.type).validateOptions(d.options ?? {}));
  }

  const rows = (projectId) =>
    db.prepare("SELECT * FROM attribute_definitions WHERE project_id = ? ORDER BY position, id").all(projectId);

  const svc = {
    definitions: (projectId) => rows(projectId).map(publicDef),

    getDefinition(defId) {
      const r = db.prepare("SELECT * FROM attribute_definitions WHERE id = ?").get(defId);
      if (!r) throw new HttpError(404, `Attribute ${defId} not found`);
      return publicDef(r);
    },

    createDefinition(projectId, input) {
      const { name, type, description = "", key: wanted } = input ?? {};
      if (typeof name !== "string" || name.trim() === "" || name.length > 100) throw new HttpError(422, "name is required (max. 100 characters)");
      if (typeof description !== "string" || description.length > 1000) throw new HttpError(422, "description is invalid");
      if (typeof type !== "string") throw new HttpError(422, "type is required");
      const options = check(() => typeOf(type).validateOptions(input.options ?? {}));

      const taken = new Set(rows(projectId).map((r) => r.key));
      let key = wanted;
      if (key !== undefined) {
        if (typeof key !== "string" || !KEY_RE.test(key)) throw new HttpError(422, "key must match [a-z][a-z0-9_]{0,39}");
        if (taken.has(key)) throw new HttpError(409, `attribute key '${key}' already exists`);
      } else {
        const base = slugify(name);
        key = base;
        for (let i = 2; taken.has(key); i++) key = `${base.slice(0, 36)}_${i}`;
      }
      const position = (db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM attribute_definitions WHERE project_id = ?").get(projectId).p);
      const r = db
        .prepare("INSERT INTO attribute_definitions (project_id, key, name, description, type, options, position) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(projectId, key, name.trim(), description, type, JSON.stringify(options), position);
      return svc.getDefinition(r.lastInsertRowid);
    },

    // The type and key never change (stored values depend on them). Changed options must still
    // accept every value that is already stored.
    updateDefinition(def, patch) {
      const name = patch.name ?? def.name;
      const description = patch.description ?? def.description;
      if (typeof name !== "string" || name.trim() === "" || name.length > 100) throw new HttpError(422, "name is invalid");
      if (typeof description !== "string" || description.length > 1000) throw new HttpError(422, "description is invalid");
      for (const k of ["type", "key"]) {
        if (patch[k] !== undefined && patch[k] !== def[k]) throw new HttpError(422, `${k} cannot be changed`);
      }
      let options = def.options;
      if (patch.options !== undefined) {
        const t = typeOf(def.type);
        options = check(() => t.validateOptions(patch.options));
        const stored = db
          .prepare(
            `SELECT v.value_text, v.value_number, o.display_id FROM attribute_values v
             JOIN objects o ON o.id = v.object_id WHERE v.definition_id = ? AND o.deleted_at IS NULL`
          )
          .all(def.id);
        for (const s of stored) {
          try {
            t.parse(t.fromStorage({ text: s.value_text, number: s.value_number }), options);
          } catch (e) {
            if (e instanceof ValidationError) throw new HttpError(409, `the existing value of ${s.display_id} would become invalid: ${e.message}`);
            throw e;
          }
        }
      }
      db.prepare("UPDATE attribute_definitions SET name = ?, description = ?, options = ? WHERE id = ?").run(
        name.trim(),
        description,
        JSON.stringify(options),
        def.id
      );
      return svc.getDefinition(def.id);
    },

    // Swap-free ordering: ids in the new order get positions 0..n-1.
    reorder(projectId, ids) {
      const current = rows(projectId).map((r) => r.id);
      if (!Array.isArray(ids) || ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every((i) => current.includes(i))) {
        throw new HttpError(422, "ids must list every attribute of the project exactly once");
      }
      db.transaction(() => ids.forEach((i, pos) => db.prepare("UPDATE attribute_definitions SET position = ? WHERE id = ?").run(pos, i)))();
      return svc.definitions(projectId);
    },

    deleteDefinition: (defId) => db.prepare("DELETE FROM attribute_definitions WHERE id = ?").run(defId),

    // Adds the configured default attributes the project does not have yet (matched by key).
    applyDefaults(projectId) {
      const have = new Set(rows(projectId).map((r) => r.key));
      const added = [];
      for (const d of defaults) {
        const key = d.key ?? slugify(d.name);
        if (have.has(key)) continue;
        added.push(svc.createDefinition(projectId, { ...d, key }));
        have.add(key);
      }
      return added;
    },

    // Validates {key: value | null} against the project's definitions; returns entries ready to write.
    parseValues(projectId, input) {
      if (input === null || typeof input !== "object" || Array.isArray(input)) throw new HttpError(422, "attributes must be an object");
      const byKey = new Map(rows(projectId).map((r) => [r.key, publicDef(r)]));
      const entries = [];
      const problems = [];
      for (const [key, value] of Object.entries(input)) {
        const def = byKey.get(key);
        if (!def) { problems.push(`unknown attribute '${key}'`); continue; }
        if (value === null || value === "") { entries.push({ def, value: null }); continue; } // clears the value
        try {
          const t = typeOf(def.type);
          entries.push({ def, value: t.parse(value, def.options) });
        } catch (e) {
          if (!(e instanceof ValidationError || e instanceof HttpError)) throw e;
          problems.push(`attribute '${key}': ${e.message}`);
        }
      }
      if (problems.length) throw new HttpError(422, problems.join("; "));
      return entries;
    },

    writeValues(objectId, entries) {
      for (const { def, value } of entries) {
        if (value === null) {
          db.prepare("DELETE FROM attribute_values WHERE object_id = ? AND definition_id = ?").run(objectId, def.id);
        } else {
          const { text, number } = typeOf(def.type).toStorage(value);
          db.prepare(
            `INSERT INTO attribute_values (object_id, definition_id, value_text, value_number) VALUES (?, ?, ?, ?)
             ON CONFLICT(object_id, definition_id) DO UPDATE SET value_text = excluded.value_text, value_number = excluded.value_number`
          ).run(objectId, def.id, text, number);
        }
      }
    },

    valuesForObject(objectId) {
      const out = {};
      const rs = db
        .prepare(
          `SELECT d.key, d.type, v.value_text, v.value_number FROM attribute_values v
           JOIN attribute_definitions d ON d.id = v.definition_id WHERE v.object_id = ? ORDER BY d.position, d.id`
        )
        .all(objectId);
      for (const r of rs) {
        const t = getType(r.type);
        if (t) out[r.key] = t.fromStorage({ text: r.value_text, number: r.value_number });
      }
      return out;
    },

    // One query for the whole module (used by the tree): Map(objectId -> { key: value }).
    valuesForModule(moduleId) {
      const map = new Map();
      const rs = db
        .prepare(
          `SELECT v.object_id, d.key, d.type, v.value_text, v.value_number FROM attribute_values v
           JOIN attribute_definitions d ON d.id = v.definition_id
           JOIN objects o ON o.id = v.object_id WHERE o.module_id = ?`
        )
        .all(moduleId);
      for (const r of rs) {
        const t = getType(r.type);
        if (!t) continue;
        if (!map.has(r.object_id)) map.set(r.object_id, {});
        map.get(r.object_id)[r.key] = t.fromStorage({ text: r.value_text, number: r.value_number });
      }
      return map;
    },
  };
  return svc;
}
