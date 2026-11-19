// Traceability tree and level-by-level coverage of one project.
//
// The structure comes from the links (config/link-rules.json) and the kind of each object
// (the attribute named by `kind_attribute`, normally "Level": UR, SR, SW, DI, TC):
//   Derives   source -> target      parent = source, child = target   (UR derives SR)
//   Satisfies source -> target      parent = target, child = source   (SW satisfies SR)
//   Verifies  source -> target      parent = target, child = source   (TC verifies a requirement)
// Informative links (Refers) are not part of the tree.
//
// Optional keys in the same file: `test_kind` (default "TC") and `design_kind` (default "DI").

const PARENT_IS_SOURCE = new Set(["Derives"]);
const PARENT_IS_TARGET = new Set(["Satisfies", "Verifies"]);

const pct = (n, d) => (d === 0 ? null : Math.round((n / d) * 1000) / 10);

export function createTraceabilityService(db, { config }) {
  const levels = config.levels ?? [];
  const kindKey = config.kind_attribute;
  const testKind = config.test_kind ?? "TC";
  const designKind = config.design_kind ?? "DI";
  const informative = new Set((config.types ?? []).filter((t) => t.informative).map((t) => t.name));

  // All live objects of the project with their kind, and the tree edges between them.
  function load(projectId) {
    const rows = db
      .prepare(
        `SELECT o.id, o.display_id, o.heading, o.module_id, m.name AS module_name, v.value_text AS kind
         FROM objects o JOIN modules m ON m.id = o.module_id
         LEFT JOIN attribute_definitions d ON d.project_id = m.project_id AND d.key = ?
         LEFT JOIN attribute_values v ON v.object_id = o.id AND v.definition_id = d.id
         WHERE m.project_id = ? AND o.deleted_at IS NULL
         ORDER BY o.display_id`
      )
      .all(kindKey ?? "", projectId);
    const objects = new Map(rows.map((r) => [r.id, { ...r, kind: r.kind || null }]));

    const linkRows = db
      .prepare(
        `SELECT l.source_id, l.target_id, l.type, l.suspect FROM links l
         JOIN objects s ON s.id = l.source_id JOIN modules ms ON ms.id = s.module_id
         JOIN objects t ON t.id = l.target_id
         WHERE ms.project_id = ? AND s.deleted_at IS NULL AND t.deleted_at IS NULL`
      )
      .all(projectId);

    // one edge per (parent, child), even when two link types connect the same pair
    const edges = new Map();
    for (const l of linkRows) {
      if (informative.has(l.type)) continue;
      let parent, child;
      if (PARENT_IS_SOURCE.has(l.type)) [parent, child] = [l.source_id, l.target_id];
      else if (PARENT_IS_TARGET.has(l.type)) [parent, child] = [l.target_id, l.source_id];
      else continue;
      const key = `${parent}>${child}`;
      const e = edges.get(key) ?? { parent, child, suspect: false };
      e.suspect ||= l.suspect === 1;
      edges.set(key, e);
    }
    const down = new Map();
    const up = new Map();
    const push = (m, k, v) => (m.get(k)?.push(v) ?? m.set(k, [v]));
    for (const e of edges.values()) {
      push(down, e.parent, e);
      push(up, e.child, e);
    }
    return { objects, edges: [...edges.values()], down, up };
  }

  const levelIndex = (kind) => levels.indexOf(kind);
  const isRequirement = (o) => levelIndex(o.kind) >= 0;
  const brief = (o) => ({ id: o.id, display_id: o.display_id, heading: o.heading, level: o.kind, module_id: o.module_id, module_name: o.module_name });

  // The next level below `kind`, or null for the last one.
  const nextLevel = (kind) => levels[levelIndex(kind) + 1] ?? null;

  function analyse(projectId) {
    const g = load(projectId);
    const childrenOf = (id) => (g.down.get(id) ?? []).filter((e) => g.objects.has(e.child));
    const parentsOf = (id) => (g.up.get(id) ?? []).filter((e) => g.objects.has(e.parent));
    const kindOf = (id) => g.objects.get(id).kind;
    const testsOf = (id) => childrenOf(id).filter((e) => kindOf(e.child) === testKind);

    // A requirement is "covered" when its next level has a child (or, at the last level, a test).
    const covered = (o) => {
      const next = nextLevel(o.kind);
      return next ? childrenOf(o.id).some((e) => kindOf(e.child) === next) : testsOf(o.id).length > 0;
    };
    return { ...g, childrenOf, parentsOf, kindOf, testsOf, covered };
  }

  return {
    // Branches from every top-level object (UR) down to the tests, with gaps marked as rows.
    tree(projectId) {
      const a = analyse(projectId);
      const memo = new Map(); // id -> Set of requirement ids in the subtree (the node included)

      const build = (o, edge, path) => {
        const next = nextLevel(o.kind);
        const kids = a
          .childrenOf(o.id)
          .filter((e) => !path.has(e.child)) // a cycle is cut, never followed
          .sort((x, y) => {
            const lx = levelIndex(a.kindOf(x.child)), ly = levelIndex(a.kindOf(y.child));
            return (lx < 0 ? 99 : lx) - (ly < 0 ? 99 : ly) || a.objects.get(x.child).display_id.localeCompare(a.objects.get(y.child).display_id);
          });
        const inner = new Set(path).add(o.id);
        const children = kids.map((e) => build(a.objects.get(e.child), e, inner));

        const gaps = [];
        if (isRequirement(o)) {
          if (next && !a.covered(o)) {
            // a level skipped (UR -> SW directly) is already reported on that child as `skipped`
            if (!kids.some((e) => isRequirement(a.objects.get(e.child)))) gaps.push({ type: "missing_child", expected: next });
          }
          if (!next && a.testsOf(o.id).length === 0) gaps.push({ type: "missing_test", expected: testKind });
        }

        const subtree = new Set(isRequirement(o) ? [o.id] : []);
        for (const c of children) for (const id of memo.get(c.id) ?? []) subtree.add(id);
        memo.set(o.id, subtree);
        const total = subtree.size;
        const done = [...subtree].filter((id) => a.covered(a.objects.get(id))).length;

        const skipped = !!edge && levelIndex(o.kind) - levelIndex(a.kindOf(edge.parent)) > 1 && levelIndex(a.kindOf(edge.parent)) >= 0;
        return {
          ...brief(o),
          suspect: !!edge?.suspect,
          skipped,
          shared: a.parentsOf(o.id).length > 1,
          gaps,
          rollup: { total, covered: done, percent: pct(done, total) },
          children,
        };
      };

      const top = levels[0];
      const roots = [...a.objects.values()].filter((o) => o.kind === top).map((o) => build(o, null, new Set()));
      return { levels, test_kind: testKind, roots };
    },

    // Coverage between neighbouring levels, test usage, and the objects that fall out of the chain.
    coverage(projectId) {
      const a = analyse(projectId);
      const all = [...a.objects.values()];
      const ofKind = (k) => all.filter((o) => o.kind === k);
      const chain = [...levels, testKind];

      const pairs = [];
      for (let i = 0; i < chain.length - 1; i++) {
        const [upper, lower] = [chain[i], chain[i + 1]];
        const ups = ofKind(upper), lows = ofKind(lower);
        const withChild = ups.filter((o) => a.childrenOf(o.id).some((e) => a.kindOf(e.child) === lower));
        const withParent = lows.filter((o) => a.parentsOf(o.id).some((e) => a.kindOf(e.parent) === upper));
        const edgesBetween = a.edges.filter((e) => a.kindOf(e.parent) === upper && a.kindOf(e.child) === lower);
        // a lower object linked only to a level further up is not an orphan, it skipped this level
        const skippers = lows.filter((o) => !withParent.includes(o) && a.parentsOf(o.id).some((e) => levelIndex(a.kindOf(e.parent)) >= 0 && levelIndex(a.kindOf(e.parent)) < i));
        const orphans = lows.filter((o) => a.parentsOf(o.id).length === 0);
        pairs.push({
          upper,
          lower,
          upper_total: ups.length,
          upper_covered: withChild.length,
          downward_percent: pct(withChild.length, ups.length),
          lower_total: lows.length,
          lower_with_parent: withParent.length,
          upward_percent: pct(withParent.length, lows.length),
          uncovered: ups.filter((o) => !withChild.includes(o)).map(brief),
          orphans: orphans.map(brief),
          skipped_level: skippers.map(brief),
          suspect_links: edgesBetween.filter((e) => e.suspect).length,
          links: edgesBetween.length,
        });
      }

      // end to end: a top-level object that reaches at least one test through any path
      const reachesTest = (id, seen = new Set()) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return a.childrenOf(id).some((e) => a.kindOf(e.child) === testKind || reachesTest(e.child, seen));
      };
      const top = ofKind(levels[0] ?? "");
      const endToEnd = top.filter((o) => reachesTest(o.id));

      // tests: used = verifies at least one requirement; shared = verifies several
      const tests = ofKind(testKind);
      const verifies = new Map(tests.map((t) => [t.id, a.parentsOf(t.id).filter((e) => isRequirement(a.objects.get(e.parent))).length]));
      const unused = tests.filter((t) => verifies.get(t.id) === 0);
      const requirements = all.filter(isRequirement);
      const withTest = requirements.filter((o) => a.testsOf(o.id).length > 0);

      return {
        levels,
        test_kind: testKind,
        pairs,
        end_to_end: { from: levels[0] ?? null, to: testKind, total: top.length, covered: endToEnd.length, percent: pct(endToEnd.length, top.length), uncovered: top.filter((o) => !endToEnd.includes(o)).map(brief) },
        tests: {
          total: tests.length,
          used: tests.length - unused.length,
          unused: unused.map(brief),
          shared: tests.filter((t) => verifies.get(t.id) > 1).map((t) => ({ ...brief(t), verifies: verifies.get(t.id) })),
          requirements_with_test: withTest.length,
          requirements_total: requirements.length,
          requirements_with_test_percent: pct(withTest.length, requirements.length),
          by_level: levels.map((l) => {
            const ls = requirements.filter((o) => o.kind === l);
            const n = ls.filter((o) => a.testsOf(o.id).length > 0).length;
            return { level: l, total: ls.length, with_test: n, percent: pct(n, ls.length) };
          }),
        },
        unclassified: all.filter((o) => !o.kind).length, // objects without a Level are outside the chain
        other_kinds: all.filter((o) => o.kind && !isRequirement(o) && o.kind !== testKind && o.kind !== designKind).length,
      };
    },
  };
}
