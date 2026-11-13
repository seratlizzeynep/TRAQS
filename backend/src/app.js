import express from "express";
import { nextDisplayId } from "./db.js";
import { createAuth } from "./auth.js";
import { HttpError } from "./errors.js";
import { createAttributeService } from "./attributes/service.js";
import { mountAttributeRoutes } from "./attributes/routes.js";
import { createLinkService } from "./links/service.js";
import { mountLinkRoutes } from "./links/routes.js";
import { openapi, docsHtml } from "./openapi.js";

const isInt = (v) => Number.isInteger(v);

function str(body, key, { required = false, max = 1000000 } = {}) {
  const v = body[key];
  if (v === undefined) {
    if (required) throw new HttpError(422, `${key} is required`);
    return undefined;
  }
  if (typeof v !== "string" || v.length > max || (required && v.trim() === "")) {
    throw new HttpError(422, `${key} is invalid`);
  }
  return v;
}

function pos(body) {
  const v = body.position;
  if (v === undefined || v === null) return null;
  if (!isInt(v) || v < 0) throw new HttpError(422, "position must be an integer >= 0");
  return v;
}

function parentId(body) {
  const v = body.parent_id;
  if (v === undefined || v === null) return null;
  if (!isInt(v)) throw new HttpError(422, "parent_id must be an integer or null");
  return v;
}

// Internal columns (ID counter, soft-delete marker) are removed from every JSON response below.
// options: { jwtSecret (required), now, sessionTimeoutMs, maxFailedLogins, lockMs, defaultAttributes, linkTypes }
export function createApp(db, options = {}) {
  if (!options.jwtSecret) throw new Error("createApp requires a jwtSecret");
  const auth = createAuth(db, options);
  const attrs = createAttributeService(db, { defaults: options.defaultAttributes ?? [] });
  const links = createLinkService(db, { types: options.linkTypes ?? [] });
  const { access, canSeeProject: visibleProject } = auth;
  const app = express();
  app.use(express.json());
  app.set("json replacer", (k, v) => (k === "next_seq" || k === "deleted_at" ? undefined : v));
  const api = express.Router();

  // ------------------------------------------------- docs (public)
  api.get("/openapi.json", (_req, res) => res.json(openapi));
  api.get("/docs", (_req, res) => res.type("html").send(docsHtml));

  // ------------------------------------------------- login (public)
  auth.mountPublic(api);

  // ------------------------------------------- JWT authentication
  // Everything below needs `Authorization: Bearer <jwt>` from /auth/login.
  api.use(auth.authenticate);

  const id = (req) => {
    const n = Number(req.params.id);
    if (!Number.isInteger(n)) throw new HttpError(404, "not found");
    return n;
  };
  const find = (table, label, n) => {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(n);
    if (!row || row.deleted_at) throw new HttpError(404, `${label} ${n} not found`);
    return row;
  };
  auth.mountProtected(api, { find, id });

  const projectOfModule = (m) => m.project_id;
  const projectOfObject = (o) => db.prepare("SELECT project_id FROM modules WHERE id = ?").get(o.module_id).project_id;
  // An object as returned by the API: its columns plus its attribute values.
  const objOut = (o) => ({ ...o, attributes: attrs.valuesForObject(o.id) });

  // ------------------------------------------------ projects & modules
  // Both share the {name, description} shape.
  api.post("/projects", (req, res) => {
    access(req, null, "manage");
    const name = str(req.body, "name", { required: true, max: 200 });
    const description = str(req.body, "description") ?? "";
    const r = db.prepare("INSERT INTO projects (name, description) VALUES (?, ?)").run(name, description);
    attrs.applyDefaults(r.lastInsertRowid); // configured default attributes (config/default-attributes.json)
    res.status(201).json(find("projects", "Project", r.lastInsertRowid));
  });
  api.get("/projects", (req, res) =>
    res.json(db.prepare("SELECT * FROM projects ORDER BY id").all().filter((p) => visibleProject(req, p.id)))
  );
  api.get("/projects/:id", (req, res) => {
    const p = find("projects", "Project", id(req));
    access(req, p.id, "read");
    res.json(p);
  });
  api.patch("/projects/:id", (req, res) => {
    const p = find("projects", "Project", id(req));
    access(req, p.id, "manage");
    const name = str(req.body, "name", { required: req.body.name !== undefined, max: 200 }) ?? p.name;
    const description = str(req.body, "description") ?? p.description;
    db.prepare("UPDATE projects SET name = ?, description = ? WHERE id = ?").run(name, description, p.id);
    res.json(find("projects", "Project", p.id));
  });
  api.delete("/projects/:id", (req, res) => {
    const p = find("projects", "Project", id(req));
    access(req, p.id, "manage");
    db.prepare("DELETE FROM projects WHERE id = ?").run(p.id);
    res.status(204).end();
  });

  api.post("/projects/:id/modules", (req, res) => {
    const p = find("projects", "Project", id(req));
    access(req, p.id, "write");
    const name = str(req.body, "name", { required: true, max: 200 });
    const description = str(req.body, "description") ?? "";
    const r = db
      .prepare("INSERT INTO modules (project_id, name, description) VALUES (?, ?, ?)")
      .run(p.id, name, description);
    res.status(201).json(find("modules", "Module", r.lastInsertRowid));
  });
  api.get("/projects/:id/modules", (req, res) => {
    const p = find("projects", "Project", id(req));
    access(req, p.id, "read");
    res.json(db.prepare("SELECT * FROM modules WHERE project_id = ? ORDER BY id").all(p.id));
  });
  api.get("/modules/:id", (req, res) => {
    const m = find("modules", "Module", id(req));
    access(req, projectOfModule(m), "read");
    res.json(m);
  });
  api.patch("/modules/:id", (req, res) => {
    const m = find("modules", "Module", id(req));
    access(req, projectOfModule(m), "write");
    const name = str(req.body, "name", { required: req.body.name !== undefined, max: 200 }) ?? m.name;
    const description = str(req.body, "description") ?? m.description;
    db.prepare("UPDATE modules SET name = ?, description = ? WHERE id = ?").run(name, description, m.id);
    res.json(find("modules", "Module", m.id));
  });
  api.delete("/modules/:id", (req, res) => {
    const m = find("modules", "Module", id(req));
    access(req, projectOfModule(m), "write");
    db.prepare("DELETE FROM modules WHERE id = ?").run(m.id);
    res.status(204).end();
  });

  // --------------------------------------------------------- objects
  const sibCond = (parent) =>
    (parent === null ? "parent_id IS NULL" : "parent_id = ?") + " AND deleted_at IS NULL";
  const sibArgs = (module, parent) => (parent === null ? [module] : [module, parent]);

  const countSiblings = (module, parent, excludeId = -1) =>
    db
      .prepare(`SELECT COUNT(*) c FROM objects WHERE module_id = ? AND ${sibCond(parent)} AND id != ?`)
      .get(...sibArgs(module, parent), excludeId).c;

  const makeRoom = (module, parent, position) =>
    db
      .prepare(`UPDATE objects SET position = position + 1 WHERE module_id = ? AND ${sibCond(parent)} AND position >= ?`)
      .run(...sibArgs(module, parent), position);

  const closeGap = (module, parent, position) =>
    db
      .prepare(`UPDATE objects SET position = position - 1 WHERE module_id = ? AND ${sibCond(parent)} AND position > ?`)
      .run(...sibArgs(module, parent), position);

  const checkParent = (module, parent) => {
    if (parent === null) return;
    const p = db.prepare("SELECT module_id FROM objects WHERE id = ?").get(parent);
    if (!p || p.module_id !== module) {
      throw new HttpError(422, "parent_id must reference an object in the same module");
    }
  };

  api.post("/modules/:id/objects", (req, res) => {
    const m = find("modules", "Module", id(req));
    access(req, projectOfModule(m), "write");
    const heading = str(req.body, "heading", { max: 300 }) ?? "";
    const text = str(req.body, "text") ?? "";
    const parent = parentId(req.body);
    const requested = pos(req.body);
    const entries = req.body.attributes === undefined ? [] : attrs.parseValues(m.project_id, req.body.attributes);
    const created = db.transaction(() => {
      checkParent(m.id, parent);
      const n = countSiblings(m.id, parent);
      const position = requested === null ? n : Math.min(requested, n);
      makeRoom(m.id, parent, position);
      const r = db
        .prepare(
          "INSERT INTO objects (module_id, parent_id, position, heading, text, display_id) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .run(m.id, parent, position, heading, text, nextDisplayId(db, m.project_id));
      attrs.writeValues(r.lastInsertRowid, entries);
      return r.lastInsertRowid;
    })();
    res.status(201).json(objOut(find("objects", "Object", created)));
  });

  // Nested, ordered tree; `?flat=true` returns a flat list.
  api.get("/modules/:id/objects", (req, res) => {
    const m = find("modules", "Module", id(req));
    access(req, projectOfModule(m), "read");
    const rows = db.prepare("SELECT * FROM objects WHERE module_id = ? AND deleted_at IS NULL ORDER BY position, id").all(m.id);
    const values = attrs.valuesForModule(m.id);
    const nodes = new Map(rows.map((r) => [r.id, { ...r, attributes: values.get(r.id) ?? {}, children: [] }]));
    if (req.query.flat === "true") return res.json([...nodes.values()]);
    const roots = [];
    for (const r of rows) (r.parent_id === null ? roots : nodes.get(r.parent_id).children).push(nodes.get(r.id));
    res.json(roots);
  });

  api.get("/objects/:id", (req, res) => {
    const o = find("objects", "Object", id(req));
    access(req, projectOfObject(o), "read");
    res.json(objOut(o));
  });

  api.patch("/objects/:id", (req, res) => {
    const o = find("objects", "Object", id(req));
    access(req, projectOfObject(o), "write");
    const heading = str(req.body, "heading", { max: 300 }) ?? o.heading;
    const text = str(req.body, "text") ?? o.text;
    db.prepare("UPDATE objects SET heading = ?, text = ? WHERE id = ?").run(heading, text, o.id);
    res.json(objOut(find("objects", "Object", o.id)));
  });

  // Re-parent and/or reorder within the module. Omitted position = append.
  api.post("/objects/:id/move", (req, res) => {
    const o = find("objects", "Object", id(req));
    access(req, projectOfObject(o), "write");
    const parent = parentId(req.body);
    const requested = pos(req.body);
    db.transaction(() => {
      checkParent(o.module_id, parent);
      for (let cur = parent; cur !== null; ) {
        if (cur === o.id) throw new HttpError(422, "cannot move an object under itself or its descendants");
        cur = db.prepare("SELECT parent_id FROM objects WHERE id = ?").get(cur).parent_id;
      }
      db.prepare("UPDATE objects SET position = -1 WHERE id = ?").run(o.id);
      closeGap(o.module_id, o.parent_id, o.position);
      const n = countSiblings(o.module_id, parent, o.id);
      const position = requested === null ? n : Math.min(requested, n);
      makeRoom(o.module_id, parent, position);
      db.prepare("UPDATE objects SET parent_id = ?, position = ? WHERE id = ?").run(parent, position, o.id);
    })();
    res.json(objOut(find("objects", "Object", o.id)));
  });

  // Soft-deletes the object and its subtree. Their IDs go on the blacklist, links that point to
  // (or come from) them become suspect, and the remaining siblings are renumbered gap-free.
  api.delete("/objects/:id", (req, res) => {
    const o = find("objects", "Object", id(req));
    access(req, projectOfObject(o), "write");
    db.transaction(() => {
      const subtree = db
        .prepare(
          `WITH RECURSIVE sub(id) AS (
             SELECT id FROM objects WHERE id = ?
             UNION ALL
             SELECT c.id FROM objects c JOIN sub ON c.parent_id = sub.id WHERE c.deleted_at IS NULL
           ) SELECT o.id, o.display_id FROM objects o JOIN sub ON sub.id = o.id`
        )
        .all(o.id);
      const { project_id } = db.prepare("SELECT project_id FROM modules WHERE id = ?").get(o.module_id);
      const now = new Date().toISOString();
      for (const row of subtree) {
        db.prepare("UPDATE objects SET deleted_at = ? WHERE id = ?").run(now, row.id);
        db.prepare("INSERT OR IGNORE INTO id_blacklist (project_id, display_id, deleted_at) VALUES (?, ?, ?)").run(
          project_id,
          row.display_id,
          now
        );
        db.prepare("UPDATE links SET suspect = 1 WHERE source_id = ? OR target_id = ?").run(row.id, row.id);
      }
      closeGap(o.module_id, o.parent_id, o.position);
    })();
    res.status(204).end();
  });

  // Blacklist of deleted IDs of a project (read-only).
  api.get("/projects/:id/id-blacklist", (req, res) => {
    const p = find("projects", "Project", id(req));
    access(req, p.id, "read");
    res.json(
      db.prepare("SELECT display_id, deleted_at FROM id_blacklist WHERE project_id = ? ORDER BY display_id").all(p.id)
    );
  });

  // Search objects of ONE project by ID and text (heading or text). Soft-deleted objects are never returned.
  api.get("/projects/:id/search", (req, res) => {
    const p = find("projects", "Project", id(req));
    access(req, p.id, "read");
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (q === "" || q.length > 200) throw new HttpError(422, "q is required (1-200 characters)");
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 100);
    const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    const rows = db
      .prepare(
        `SELECT o.id, o.display_id, o.heading, o.text, o.module_id, m.name AS module_name
         FROM objects o JOIN modules m ON m.id = o.module_id
         WHERE m.project_id = ? AND o.deleted_at IS NULL
           AND (o.display_id LIKE ? ESCAPE '\\' OR o.heading LIKE ? ESCAPE '\\' OR o.text LIKE ? ESCAPE '\\')
         ORDER BY (UPPER(o.display_id) = UPPER(?)) DESC, o.display_id
         LIMIT ?`
      )
      .all(p.id, like, like, like, q, limit);
    res.json(rows);
  });

  mountLinkRoutes(api, { links, db, find, id, access, projectOfObject });
  mountAttributeRoutes(api, { svc: attrs, db, find, id, access, projectOfObject, objOut });

  app.use("/api/v1", api);

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ detail: err.message });
    if (err.type === "entity.parse.failed") return res.status(400).json({ detail: "invalid JSON" });
    console.error(err);
    res.status(500).json({ detail: "internal error" });
  });
  return app;
}
