import { test } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";

const withApp = (fn) => async () => {
  const c = await setup();
  try { await fn(c, await c.module()); } finally { c.close(); }
};

test("new objects get sequential IDs REQ-0001, REQ-0002, ...", withApp(async (c, m) => {
  const ids = [];
  for (const h of ["A", "B", "C"]) ids.push((await c.add(m, h)).display_id);
  assert.deepEqual(ids, ["REQ-0001", "REQ-0002", "REQ-0003"]);
}));

test("IDs are numbered per project", withApp(async (c, m) => {
  await c.add(m, "A");
  const p2 = (await c.post("/projects", { name: "P2" })).body;
  const m2 = (await c.post(`/projects/${p2.id}/modules`, { name: "M" })).body;
  assert.equal((await c.add(m2, "first")).display_id, "REQ-0001");
}));

test("deleted object is soft-deleted, hidden, and its ID is blacklisted", withApp(async (c, m) => {
  const a = await c.add(m, "A");
  await c.add(m, "B");
  assert.equal((await c.del(`/objects/${a.id}`)).status, 204);
  assert.equal((await c.get(`/objects/${a.id}`)).status, 404);
  assert.deepEqual(await c.tree(m), ["B"]);
  const bl = (await c.get(`/projects/${m.project_id}/id-blacklist`)).body;
  assert.deepEqual(bl.map((b) => b.display_id), ["REQ-0001"]);
}));

test("a blacklisted ID is never issued again", withApp(async (c, m) => {
  const a = await c.add(m, "A");
  const b = await c.add(m, "B");
  await c.del(`/objects/${b.id}`); // delete the newest one
  const next = await c.add(m, "C");
  assert.equal(next.display_id, "REQ-0003");
  assert.notEqual(next.display_id, a.display_id);
  assert.notEqual(next.display_id, b.display_id);
}));

test("deleting a parent blacklists the whole subtree", withApp(async (c, m) => {
  const a = await c.add(m, "A");
  await c.add(m, "A.1", a.id);
  await c.add(m, "A.2", a.id);
  await c.del(`/objects/${a.id}`);
  const bl = (await c.get(`/projects/${m.project_id}/id-blacklist`)).body.map((b) => b.display_id);
  assert.deepEqual(bl, ["REQ-0001", "REQ-0002", "REQ-0003"]);
  assert.equal((await c.add(m, "new")).display_id, "REQ-0004");
}));

test("links to deleted objects become suspect", withApp(async (c, m) => {
  const a = await c.add(m, "A");
  const b = await c.add(m, "B");
  const l = (await c.post(`/objects/${a.id}/links`, { target_id: b.id })).body;
  assert.equal(l.suspect, 0);
  await c.del(`/objects/${b.id}`);
  const links = (await c.get(`/objects/${a.id}/links`)).body;
  assert.equal(links.length, 1);
  assert.equal(links[0].suspect, 1);
}));

test("link validation", withApp(async (c, m) => {
  const a = await c.add(m, "A");
  const b = await c.add(m, "B");
  assert.equal((await c.post(`/objects/${a.id}/links`, { target_id: a.id })).status, 422);
  assert.equal((await c.post(`/objects/${a.id}/links`, { target_id: 999 })).status, 404);
  assert.equal((await c.post(`/objects/${a.id}/links`, { target_id: b.id })).status, 201);
  assert.equal((await c.post(`/objects/${a.id}/links`, { target_id: b.id })).status, 409);
}));
