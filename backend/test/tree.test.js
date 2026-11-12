import { test } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";

const withApp = (fn) => async () => {
  const c = await setup();
  try { await fn(c, await c.module()); } finally { c.close(); }
};

test("append order and nesting", withApp(async (c, m) => {
  const a = await c.add(m, "A");
  await c.add(m, "B");
  await c.add(m, "A.1", a.id);
  await c.add(m, "A.2", a.id);
  assert.deepEqual(await c.tree(m), [["A", ["A.1", "A.2"]], "B"]);
}));

test("insert at position shifts siblings", withApp(async (c, m) => {
  await c.add(m, "A");
  await c.add(m, "B");
  await c.add(m, "X", null, 1);
  await c.add(m, "F", null, 0);
  await c.add(m, "Z", null, 99); // clamped to the end
  assert.deepEqual(await c.tree(m), ["F", "A", "X", "B", "Z"]);
  const flat = (await c.get(`/modules/${m.id}/objects?flat=true`)).body;
  assert.deepEqual(flat.map((o) => o.position).sort(), [0, 1, 2, 3, 4]);
}));

test("parent must be in the same module", withApp(async (c, m) => {
  const other = (await c.post(`/projects/${m.project_id}/modules`, { name: "M2" })).body;
  const foreign = await c.add(other, "foreign");
  assert.equal((await c.post(`/modules/${m.id}/objects`, { parent_id: foreign.id })).status, 422);
  assert.equal((await c.post(`/modules/${m.id}/objects`, { parent_id: 999 })).status, 422);
}));

test("delete closes the gap and removes the subtree", withApp(async (c, m) => {
  const a = await c.add(m, "A");
  const b = await c.add(m, "B");
  await c.add(m, "C");
  const b1 = await c.add(m, "B.1", b.id);
  assert.equal((await c.del(`/objects/${b.id}`)).status, 204);
  assert.deepEqual(await c.tree(m), ["A", "C"]);
  const flat = (await c.get(`/modules/${m.id}/objects?flat=true`)).body;
  assert.deepEqual(flat.map((o) => [o.heading, o.position]), [["A", 0], ["C", 1]]);
  assert.equal((await c.get(`/objects/${a.id}`)).status, 200);
  assert.equal((await c.get(`/objects/${b1.id}`)).status, 404);
}));

test("move reorders within the same parent", withApp(async (c, m) => {
  const a = await c.add(m, "A");
  await c.add(m, "B");
  const cc = await c.add(m, "C");
  await c.post(`/objects/${cc.id}/move`, { position: 0 });
  assert.deepEqual(await c.tree(m), ["C", "A", "B"]);
  await c.post(`/objects/${cc.id}/move`, { position: 1 });
  assert.deepEqual(await c.tree(m), ["A", "C", "B"]);
  await c.post(`/objects/${a.id}/move`, {}); // append
  assert.deepEqual(await c.tree(m), ["C", "B", "A"]);
}));

test("move to another parent and back to root", withApp(async (c, m) => {
  const a = await c.add(m, "A");
  const b = await c.add(m, "B");
  const cc = await c.add(m, "C");
  const r = await c.post(`/objects/${cc.id}/move`, { parent_id: a.id });
  assert.equal(r.status, 200);
  assert.equal(r.body.parent_id, a.id);
  await c.post(`/objects/${b.id}/move`, { parent_id: a.id, position: 0 });
  assert.deepEqual(await c.tree(m), [["A", ["B", "C"]]]);
  await c.post(`/objects/${cc.id}/move`, { parent_id: null, position: 0 });
  assert.deepEqual(await c.tree(m), ["C", ["A", ["B"]]]);
}));

test("move rejects cycles", withApp(async (c, m) => {
  const a = await c.add(m, "A");
  const b = await c.add(m, "B", a.id);
  const cc = await c.add(m, "C", b.id);
  assert.equal((await c.post(`/objects/${a.id}/move`, { parent_id: cc.id })).status, 422);
  assert.equal((await c.post(`/objects/${a.id}/move`, { parent_id: a.id })).status, 422);
  assert.deepEqual(await c.tree(m), [["A", [["B", ["C"]]]]]);
}));
