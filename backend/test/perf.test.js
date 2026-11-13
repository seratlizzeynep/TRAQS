import { test } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";

// NFR-01: a page with up to 5,000 objects loads within 2 seconds.
export function seed(db, moduleId, n) {
  const ins = db.prepare(
    "INSERT INTO objects (module_id, parent_id, position, heading, text, display_id) VALUES (?, ?, ?, ?, ?, ?)"
  );
  db.transaction(() => {
    // 50 top-level groups with (n/50 - 1) children each
    const groups = 50;
    const per = Math.floor(n / groups);
    let seq = 1;
    for (let g = 0; g < groups; g++) {
      const gid = ins.run(moduleId, null, g, `Group ${g}`, "x".repeat(60), `REQ-${String(seq++).padStart(4, "0")}`).lastInsertRowid;
      for (let i = 1; i < per; i++) {
        ins.run(moduleId, gid, i - 1, `Item ${g}.${i}`, "The system shall do something measurable.", `REQ-${String(seq++).padStart(4, "0")}`);
      }
    }
  })();
}

test("tree of 5,000 objects is returned within 2 seconds", async () => {
  const c = await setup();
  try {
    const m = await c.module();
    seed(c.db, m.id, 5000);
    const t0 = performance.now();
    const r = await c.get(`/modules/${m.id}/objects`);
    const ms = performance.now() - t0;
    assert.equal(r.status, 200);
    assert.equal(r.body.length, 50);
    const count = (nodes) => nodes.reduce((s, n) => s + 1 + count(n.children), 0);
    assert.equal(count(r.body), 5000);
    assert.ok(ms < 2000, `took ${Math.round(ms)} ms`);
  } finally { c.close(); }
});
