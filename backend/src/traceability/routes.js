// REST endpoints for the traceability tree and the level-by-level coverage of a project.
export function mountTraceabilityRoutes(api, { trace, find, id, access }) {
  api.get("/projects/:id/trace-tree", (req, res) => {
    const p = find("projects", "Project", id(req));
    access(req, p.id, "read");
    res.json(trace.tree(p.id));
  });

  api.get("/projects/:id/trace-coverage", (req, res) => {
    const p = find("projects", "Project", id(req));
    access(req, p.id, "read");
    res.json(trace.coverage(p.id));
  });
}
