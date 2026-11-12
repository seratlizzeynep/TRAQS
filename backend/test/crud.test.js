import { test } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";

test("project CRUD", async () => {
  const c = await setup();
  try {
    const r = await c.post("/projects", { name: "Alpha", description: "d" });
    assert.equal(r.status, 201);
    const pid = r.body.id;
    assert.equal((await c.get(`/projects/${pid}`)).body.name, "Alpha");
    assert.deepEqual((await c.get("/projects")).body.map((p) => p.id), [pid]);
    assert.deepEqual((await c.patch(`/projects/${pid}`, { name: "Beta" })).body, { id: pid, name: "Beta", description: "d" });
    assert.equal((await c.del(`/projects/${pid}`)).status, 204);
    assert.equal((await c.get(`/projects/${pid}`)).status, 404);
  } finally { c.close(); }
});

test("project validation", async () => {
  const c = await setup();
  try {
    assert.equal((await c.post("/projects", { name: "" })).status, 422);
    assert.equal((await c.post("/projects", {})).status, 422);
    assert.equal((await c.post("/projects", { name: 5 })).status, 422);
  } finally { c.close(); }
});

test("module CRUD", async () => {
  const c = await setup();
  try {
    const pid = (await c.post("/projects", { name: "P" })).body.id;
    const r = await c.post(`/projects/${pid}/modules`, { name: "Mod" });
    assert.equal(r.status, 201);
    assert.equal(r.body.project_id, pid);
    const mid = r.body.id;
    assert.equal((await c.get(`/projects/${pid}/modules`)).body.length, 1);
    assert.equal((await c.patch(`/modules/${mid}`, { description: "x" })).body.description, "x");
    assert.equal((await c.del(`/modules/${mid}`)).status, 204);
    assert.equal((await c.get(`/modules/${mid}`)).status, 404);
    assert.equal((await c.post("/projects/999/modules", { name: "x" })).status, 404);
  } finally { c.close(); }
});

test("object CRUD", async () => {
  const c = await setup();
  try {
    const m = await c.module();
    const r = await c.post(`/modules/${m.id}/objects`, { heading: "H", text: "T" });
    assert.equal(r.status, 201);
    const o = r.body;
    assert.deepEqual([o.parent_id, o.position, o.heading, o.text], [null, 0, "H", "T"]);
    assert.deepEqual((await c.get(`/objects/${o.id}`)).body, o);
    const u = (await c.patch(`/objects/${o.id}`, { text: "T2" })).body;
    assert.deepEqual([u.text, u.heading], ["T2", "H"]);
    assert.equal((await c.del(`/objects/${o.id}`)).status, 204);
    assert.equal((await c.get(`/objects/${o.id}`)).status, 404);
  } finally { c.close(); }
});

test("deleting a project cascades to modules and objects", async () => {
  const c = await setup();
  try {
    const m = await c.module();
    const a = await c.add(m, "A");
    const b = await c.add(m, "B", a.id);
    assert.equal((await c.del(`/projects/${m.project_id}`)).status, 204);
    assert.equal((await c.get(`/objects/${a.id}`)).status, 404);
    assert.equal((await c.get(`/objects/${b.id}`)).status, 404);
  } finally { c.close(); }
});
