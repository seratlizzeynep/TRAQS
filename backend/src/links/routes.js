import { HttpError } from "../errors.js";

// REST endpoints for typed links between objects (within and across modules of one project).
export function mountLinkRoutes(api, { links, db, find, id, access, projectOfObject }) {
  // Which link types exist and which rule applies to each (config/link-rules.json).
  api.get("/link-types", (_req, res) => res.json(links.types));

  // Links of a project that skip a level (gap) or break the rules (e.g. a Level was changed later).
  api.get("/projects/:id/link-issues", (req, res) => {
    const p = find("projects", "Project", id(req));
    access(req, p.id, "read");
    res.json(links.issues(p.id));
  });

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
    // the link rules (config/link-rules.json): a broken rule refuses the link and names the rule
    const verdict = links.evaluate(src.id, tgt.id, type);
    if (verdict.status === "violation") throw new HttpError(422, verdict.message);
    if (links.wouldCycle(src.id, tgt.id, type)) {
      throw new HttpError(422, `Link rule '${type}': ${src.display_id} to ${tgt.display_id} would create a cycle, but ${type} links must not form a cycle.`);
    }
    res.status(201).json(links.create(src.id, tgt.id, type)); // a gap (skipped level) is allowed and reported in `rule`
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
