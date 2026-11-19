import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ATTRIBUTES, setup } from "./helpers.js";

// shipped rules and attributes; returns helpers to build a small chain
const withApp = (fn) => async () => {
  const c = await setup({ defaultAttributes: DEFAULT_ATTRIBUTES });
  try {
    const p = (await c.post("/projects", { name: "P" })).body;
    const m = (await c.post(`/projects/${p.id}/modules`, { name: "M" })).body;
    const obj = (level, heading) => c.post(`/modules/${m.id}/objects`, { heading, attributes: level ? { level } : {} }).then((r) => r.body);
    const link = async (from, to, type) => {
      const r = await c.post(`/objects/${from.id}/links`, { target_id: to.id, type });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      return r.body;
    };
    await fn(c, p, { obj, link });
  } finally { c.close(); }
};
const cov = (c, p) => c.get(`/projects/${p.id}/trace-coverage`).then((r) => r.body);
const tree = (c, p) => c.get(`/projects/${p.id}/trace-tree`).then((r) => r.body);

test("the tree runs UR -> SR -> SW -> test, with Satisfies and Derives giving the same branch", withApp(async (c, p, { obj, link }) => {
  const ur = await obj("UR", "ur"), sr = await obj("SR", "sr"), sw = await obj("SW", "sw"), tc = await obj("TC", "tc");
  await link(ur, sr, "Derives");
  await link(sw, sr, "Satisfies"); // SW satisfies SR = SR has SW below it
  await link(tc, sw, "Verifies");
  const t = await tree(c, p);
  assert.deepEqual(t.levels, ["UR", "SR", "SW"]);
  assert.equal(t.roots.length, 1);
  const [r] = t.roots;
  assert.equal(r.heading, "ur");
  assert.equal(r.children[0].heading, "sr");
  assert.equal(r.children[0].children[0].heading, "sw");
  assert.equal(r.children[0].children[0].children[0].heading, "tc");
  assert.deepEqual(r.rollup, { total: 3, covered: 3, percent: 100 });
}));

test("a missing level is a gap row; a skipped level is marked on the child", withApp(async (c, p, { obj, link }) => {
  const lonely = await obj("UR", "lonely"); // no SR at all
  const ur = await obj("UR", "ur"), sw = await obj("SW", "sw");
  await link(ur, sw, "Derives"); // UR -> SW skips SR (allowed, a gap)
  const t = await tree(c, p);
  const byName = Object.fromEntries(t.roots.map((r) => [r.heading, r]));
  assert.deepEqual(byName.lonely.gaps, [{ type: "missing_child", expected: "SR" }]);
  assert.equal(byName.ur.children[0].skipped, true);
  assert.deepEqual(byName.ur.gaps, []); // it has a child, the skip is reported on the child
  assert.deepEqual(byName.ur.children[0].gaps, [{ type: "missing_test", expected: "TC" }]);
  assert.equal(lonely.id, byName.lonely.id);
}));

test("a suspect link marks its child; a requirement with two parents is shared", withApp(async (c, p, { obj, link }) => {
  const u1 = await obj("UR", "u1"), u2 = await obj("UR", "u2"), sr = await obj("SR", "sr");
  const l = await link(u1, sr, "Derives");
  await link(u2, sr, "Derives");
  c.db.prepare("UPDATE links SET suspect = 1 WHERE id = ?").run(l.id);
  const t = await tree(c, p);
  const n1 = t.roots.find((r) => r.heading === "u1").children[0];
  const n2 = t.roots.find((r) => r.heading === "u2").children[0];
  assert.equal(n1.suspect, true);
  assert.equal(n2.suspect, false);
  assert.equal(n1.shared, true);
}));

test("coverage compares neighbouring levels with counts and percentages", withApp(async (c, p, { obj, link }) => {
  const u1 = await obj("UR", "u1"), u2 = await obj("UR", "u2");
  const s1 = await obj("SR", "s1"), s2 = await obj("SR", "s2"), s3 = await obj("SR", "s3"); // s3 has no parent
  const w1 = await obj("SW", "w1");
  const t1 = await obj("TC", "t1"), t2 = await obj("TC", "t2"); // t2 unused
  await link(u1, s1, "Derives");
  await link(u1, s2, "Derives");
  await link(s1, w1, "Derives");
  await link(t1, w1, "Verifies");
  const r = await cov(c, p);
  const [urSr, srSw, swTc] = r.pairs;
  assert.equal(urSr.upper_total, 2);
  assert.equal(urSr.upper_covered, 1);
  assert.equal(urSr.downward_percent, 50);
  assert.deepEqual(urSr.uncovered.map((o) => o.heading), ["u2"]);
  assert.equal(urSr.lower_total, 3);
  assert.equal(urSr.lower_with_parent, 2);
  assert.deepEqual(urSr.orphans.map((o) => o.heading), ["s3"]);
  assert.equal(srSw.downward_percent, 33.3); // only s1 of s1, s2, s3 has an SW
  assert.equal(swTc.downward_percent, 100);
  assert.deepEqual(r.end_to_end, { from: "UR", to: "TC", total: 2, covered: 1, percent: 50, uncovered: [r.end_to_end.uncovered[0]] });
  assert.equal(r.end_to_end.uncovered[0].heading, "u2");
  assert.deepEqual(r.tests.unused.map((o) => o.heading), ["t2"]);
  assert.equal(r.tests.used, 1);
  assert.equal(t2.id, r.tests.unused[0].id);
}));

test("test usage: shared tests, requirements without a test, per level", withApp(async (c, p, { obj, link }) => {
  const s1 = await obj("SR", "s1"), s2 = await obj("SR", "s2"), w1 = await obj("SW", "w1");
  const t = await obj("TC", "t");
  await link(t, s1, "Verifies");
  await link(t, s2, "Verifies");
  const r = (await cov(c, p)).tests;
  assert.deepEqual(r.shared.map((o) => [o.heading, o.verifies]), [["t", 2]]);
  assert.equal(r.requirements_total, 3);
  assert.equal(r.requirements_with_test, 2);
  assert.deepEqual(r.by_level.map((l) => [l.level, l.with_test, l.total]), [["UR", 0, 0], ["SR", 2, 2], ["SW", 0, 1]]);
  assert.equal(w1.id > 0, true);
}));

test("a level skipped on the way down is neither an orphan nor lost", withApp(async (c, p, { obj, link }) => {
  const ur = await obj("UR", "ur"), sw = await obj("SW", "sw");
  await link(ur, sw, "Derives");
  const [, srSw] = (await cov(c, p)).pairs;
  assert.equal(srSw.orphans.length, 0);
  assert.deepEqual(srSw.skipped_level.map((o) => o.heading), ["sw"]);
}));

test("deleted objects and informative links are left out; objects without a Level are counted", withApp(async (c, p, { obj, link }) => {
  const ur = await obj("UR", "ur"), sr = await obj("SR", "sr"), gone = await obj("SR", "gone"), none = await obj(null, "none");
  await link(ur, sr, "Derives");
  await link(ur, gone, "Derives");
  await link(ur, none, "Refers");
  await c.del(`/objects/${gone.id}`);
  const t = await tree(c, p);
  assert.deepEqual(t.roots[0].children.map((n) => n.heading), ["sr"]);
  const r = await cov(c, p);
  assert.equal(r.pairs[0].lower_total, 1);
  assert.equal(r.unclassified, 1);
  assert.equal(none.id > 0, true);
}));

test("cycles in the links do not hang the tree", withApp(async (c, p, { obj }) => {
  const u = await obj("UR", "u"), a = await obj("SR", "a"), b = await obj("SR", "b");
  const ins = (s, t, type) => c.db.prepare("INSERT INTO links (source_id, target_id, type) VALUES (?, ?, ?)").run(s, t, type);
  ins(u.id, a.id, "Derives");
  ins(a.id, b.id, "Derives"); // not allowed through the API; written directly
  ins(b.id, a.id, "Derives");
  const t = await tree(c, p);
  assert.equal(t.roots.length, 1);
}));

test("access: read for every role, never across projects, and an unknown project is 404", async () => {
  const c = await setup({ defaultAttributes: DEFAULT_ATTRIBUTES });
  try {
    const p = (await c.post("/projects", { name: "P" })).body;
    const q = (await c.post("/projects", { name: "Q" })).body;
    const viewer = await c.as({ [p.id]: "viewer" });
    assert.equal((await viewer.get(`/projects/${p.id}/trace-tree`)).status, 200);
    assert.equal((await viewer.get(`/projects/${p.id}/trace-coverage`)).status, 200);
    for (const path of ["trace-tree", "trace-coverage"]) {
      assert.ok([403, 404].includes((await viewer.get(`/projects/${q.id}/${path}`)).status));
    }
    assert.equal((await c.as(null).then((x) => x.get(`/projects/${p.id}/trace-tree`))).status, 401);
    assert.equal((await c.get("/projects/9999/trace-tree")).status, 404);
  } finally { c.close(); }
});

test("5,000 objects: tree and coverage answer within 2 seconds", async () => {
  const c = await setup({ defaultAttributes: DEFAULT_ATTRIBUTES });
  try {
    const p = (await c.post("/projects", { name: "P" })).body;
    const m = (await c.post(`/projects/${p.id}/modules`, { name: "M" })).body;
    const defId = c.db.prepare("SELECT id FROM attribute_definitions WHERE project_id = ? AND key = 'level'").get(p.id).id;
    const insO = c.db.prepare("INSERT INTO objects (module_id, heading, display_id) VALUES (?, ?, ?)");
    const insV = c.db.prepare("INSERT INTO attribute_values (object_id, definition_id, value_text) VALUES (?, ?, ?)");
    const insL = c.db.prepare("INSERT INTO links (source_id, target_id, type) VALUES (?, ?, ?)");
    c.db.transaction(() => {
      const ids = [];
      for (let i = 0; i < 5000; i++) {
        const lvl = ["UR", "SR", "SW", "TC"][i % 4];
        const id = insO.run(m.id, `o${i}`, `REQ-${i}`).lastInsertRowid;
        insV.run(id, defId, lvl);
        ids.push(id);
      }
      for (let i = 0; i + 3 < 5000; i += 4) {
        insL.run(ids[i], ids[i + 1], "Derives");
        insL.run(ids[i + 1], ids[i + 2], "Derives");
        insL.run(ids[i + 3], ids[i + 2], "Verifies");
      }
    })();
    const t0 = Date.now();
    assert.equal((await c.get(`/projects/${p.id}/trace-tree`)).status, 200);
    assert.equal((await c.get(`/projects/${p.id}/trace-coverage`)).status, 200);
    assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`);
  } finally { c.close(); }
});
