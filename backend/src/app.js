import express from "express";

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

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

export function createApp(db) {
  const app = express();
  app.use(express.json());
  const api = express.Router();

  const id = (req) => {
    const n = Number(req.params.id);
    if (!Number.isInteger(n)) throw new HttpError(404, "not found");
    return n;
  };
  const find = (table, label, n) => {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(n);
    if (!row) throw new HttpError(404, `${label} ${n} not found`);
    return row;
  };

  // ------------------------------------------------ projects & modules
  // Both share the {name, description} shape.
  api.post("/projects", (req, res) => {
    const name = str(req.body, "name", { required: true, max: 200 });
    const description = str(req.body, "description") ?? "";
    const r = db.prepare("INSERT INTO projects (name, description) VALUES (?, ?)").run(name, description);
    res.status(201).json(find("projects", "Project", r.lastInsertRowid));
  });
  api.get("/projects", (_req, res) => res.json(db.prepare("SELECT * FROM projects ORDER BY id").all()));
  api.get("/projects/:id", (req, res) => res.json(find("projects", "Project", id(req))));
  api.patch("/projects/:id", (req, res) => {
    const p = find("projects", "Project", id(req));
    const name = str(req.body, "name", { required: req.body.name !== undefined, max: 200 }) ?? p.name;
    const description = str(req.body, "description") ?? p.description;
    db.prepare("UPDATE projects SET name = ?, description = ? WHERE id = ?").run(name, description, p.id);
    res.json(find("projects", "Project", p.id));
  });
  api.delete("/projects/:id", (req, res) => {
    const p = find("projects", "Project", id(req));
    db.prepare("DELETE FROM projects WHERE id = ?").run(p.id);
    res.status(204).end();
  });

  api.post("/projects/:id/modules", (req, res) => {
    const p = find("projects", "Project", id(req));
    const name = str(req.body, "name", { required: true, max: 200 });
    const description = str(req.body, "description") ?? "";
    const r = db
      .prepare("INSERT INTO modules (project_id, name, description) VALUES (?, ?, ?)")
      .run(p.id, name, description);
    res.status(201).json(find("modules", "Module", r.lastInsertRowid));
  });
  api.get("/projects/:id/modules", (req, res) => {
    const p = find("projects", "Project", id(req));
    res.json(db.prepare("SELECT * FROM modules WHERE project_id = ? ORDER BY id").all(p.id));
  });
  api.get("/modules/:id", (req, res) => res.json(find("modules", "Module", id(req))));
  api.patch("/modules/:id", (req, res) => {
    const m = find("modules", "Module", id(req));
    const name = str(req.body, "name", { required: req.body.name !== undefined, max: 200 }) ?? m.name;
    const description = str(req.body, "description") ?? m.description;
    db.prepare("UPDATE modules SET name = ?, description = ? WHERE id = ?").run(name, description, m.id);
    res.json(find("modules", "Module", m.id));
  });
  api.delete("/modules/:id", (req, res) => {
    const m = find("modules", "Module", id(req));
    db.prepare("DELETE FROM modules WHERE id = ?").run(m.id);
    res.status(204).end();
  });

  // --------------------------------------------------------- objects
  const sibCond = (parent) => (parent === null ? "parent_id IS NULL" : "parent_id = ?");
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
    const heading = str(req.body, "heading", { max: 300 }) ?? "";
    const text = str(req.body, "text") ?? "";
    const parent = parentId(req.body);
    const requested = pos(req.body);
    const created = db.transaction(() => {
      checkParent(m.id, parent);
      const n = countSiblings(m.id, parent);
      const position = requested === null ? n : Math.min(requested, n);
      makeRoom(m.id, parent, position);
      const r = db
        .prepare("INSERT INTO objects (module_id, parent_id, position, heading, text) VALUES (?, ?, ?, ?, ?)")
        .run(m.id, parent, position, heading, text);
      return r.lastInsertRowid;
    })();
    res.status(201).json(find("objects", "Object", created));
  });

  // Nested, ordered tree; `?flat=true` returns a flat list.
  api.get("/modules/:id/objects", (req, res) => {
    const m = find("modules", "Module", id(req));
    const rows = db.prepare("SELECT * FROM objects WHERE module_id = ? ORDER BY position, id").all(m.id);
    const nodes = new Map(rows.map((r) => [r.id, { ...r, children: [] }]));
    if (req.query.flat === "true") return res.json([...nodes.values()]);
    const roots = [];
    for (const r of rows) (r.parent_id === null ? roots : nodes.get(r.parent_id).children).push(nodes.get(r.id));
    res.json(roots);
  });

  api.get("/objects/:id", (req, res) => res.json(find("objects", "Object", id(req))));

  api.patch("/objects/:id", (req, res) => {
    const o = find("objects", "Object", id(req));
    const heading = str(req.body, "heading", { max: 300 }) ?? o.heading;
    const text = str(req.body, "text") ?? o.text;
    db.prepare("UPDATE objects SET heading = ?, text = ? WHERE id = ?").run(heading, text, o.id);
    res.json(find("objects", "Object", o.id));
  });

  // Re-parent and/or reorder within the module. Omitted position = append.
  api.post("/objects/:id/move", (req, res) => {
    const o = find("objects", "Object", id(req));
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
    res.json(find("objects", "Object", o.id));
  });

  // Deletes the object and its subtree; remaining siblings are renumbered gap-free.
  api.delete("/objects/:id", (req, res) => {
    const o = find("objects", "Object", id(req));
    db.transaction(() => {
      db.prepare("DELETE FROM objects WHERE id = ?").run(o.id);
      closeGap(o.module_id, o.parent_id, o.position);
    })();
    res.status(204).end();
  });

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
