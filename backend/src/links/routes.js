import { HttpError } from "../errors.js";

// REST endpoints for typed links between objects (within and across modules of one project).
export function mountLinkRoutes(api, { links, db, find, id, access, projectOfObject }) {
  // Which link types exist (configured in config/link-types.json).
  api.get("/link-types", (_req, res) => res.json(links.types));

  api.post("/objects/:id/links", (req, res) => {
    const src = find("objects", "Object", id(req));
    const projectId = projectOfObject(src);
    access(req, projectId, "write");
    const { target_id: target, type } = req.body ?? {};
    if (!Number.isInteger(target)) throw new HttpError(422, "target_id must be an integer");
    links.checkType(type);
    if (target === src.id) throw new HttpError(422, "an object cannot link to itself");
    const tgt = find("objects", "Object", target);
    if (projectOfObject(tgt) !== projectId) throw new HttpError(422, "target must be in the same project");
    res.status(201).json(links.create(src.id, tgt.id, type));
  });

  api.get("/objects/:id/links", (req, res) => {
    const o = find("objects", "Object", id(req));
    access(req, projectOfObject(o), "read");
    res.json(links.forObject(o.id));
  });

  api.delete("/links/:id", (req, res) => {
    const l = links.get(id(req));
    // the source object may have been deleted since; its row still tells the project
    const src = db.prepare("SELECT module_id FROM objects WHERE id = ?").get(l.source_id);
    const projectId = db.prepare("SELECT project_id FROM modules WHERE id = ?").get(src.module_id).project_id;
    access(req, projectId, "write");
    links.remove(l.id);
    res.status(204).end();
  });
}
