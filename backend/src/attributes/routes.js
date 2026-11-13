import { listTypes } from "./index.js";

// REST endpoints for attribute definitions and the attribute values of an object.
export function mountAttributeRoutes(api, { svc, db, find, id, access, projectOfObject, objOut }) {
  const defOf = (req) => svc.getDefinition(id(req));

  // Which attribute types exist (the UI builds its forms from this).
  api.get("/attribute-types", (_req, res) => res.json(listTypes()));

  api.get("/projects/:id/attributes", (req, res) => {
    const p = find("projects", "Project", id(req));
    access(req, p.id, "read");
    res.json(svc.definitions(p.id));
  });
  api.post("/projects/:id/attributes", (req, res) => {
    const p = find("projects", "Project", id(req));
    access(req, p.id, "write");
    res.status(201).json(svc.createDefinition(p.id, req.body));
  });
  // Adds the configured default attributes that are missing in this project.
  api.post("/projects/:id/attributes/defaults", (req, res) => {
    const p = find("projects", "Project", id(req));
    access(req, p.id, "write");
    res.status(201).json(svc.applyDefaults(p.id));
  });
  api.put("/projects/:id/attributes/order", (req, res) => {
    const p = find("projects", "Project", id(req));
    access(req, p.id, "write");
    res.json(svc.reorder(p.id, req.body?.ids));
  });

  api.get("/attributes/:id", (req, res) => {
    const d = defOf(req);
    access(req, d.project_id, "read");
    res.json(d);
  });
  api.patch("/attributes/:id", (req, res) => {
    const d = defOf(req);
    access(req, d.project_id, "write");
    res.json(svc.updateDefinition(d, req.body ?? {}));
  });
  api.delete("/attributes/:id", (req, res) => {
    const d = defOf(req);
    access(req, d.project_id, "write");
    svc.deleteDefinition(d.id);
    res.status(204).end();
  });

  // Set (or, with null, clear) attribute values of an object.
  api.put("/objects/:id/attributes", (req, res) => {
    const o = find("objects", "Object", id(req));
    const projectId = projectOfObject(o);
    access(req, projectId, "write");
    const entries = svc.parseValues(projectId, req.body);
    db.transaction(() => svc.writeValues(o.id, entries))();
    res.json(objOut(o));
  });
}
