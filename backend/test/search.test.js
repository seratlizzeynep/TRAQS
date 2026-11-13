import { test } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";

const withApp = (fn) => async () => {
  const c = await setup();
  try { await fn(c); } finally { c.close(); }
};
const add = (c, m, heading, text = "") => c.post(`/modules/${m.id}/objects`, { heading, text }).then((r) => r.body);

test("finds objects by ID and by text", withApp(async (c) => {
  const m = await c.module();
  await add(c, m, "Power", "The system shall run on 24 V.");
  await add(c, m, "Alarm", "The system should respond quickly.");
  const byId = (await c.get(`/projects/${m.project_id}/search?q=REQ-0002`)).body;
  assert.deepEqual(byId.map((o) => o.display_id), ["REQ-0002"]);
  assert.equal(byId[0].heading, "Alarm");
  assert.equal(byId[0].module_name, "M");
  const byText = (await c.get(`/projects/${m.project_id}/search?q=quickly`)).body;
  assert.deepEqual(byText.map((o) => o.display_id), ["REQ-0002"]);
  const byHeading = (await c.get(`/projects/${m.project_id}/search?q=power`)).body; // case-insensitive
  assert.deepEqual(byHeading.map((o) => o.display_id), ["REQ-0001"]);
  assert.equal((await c.get(`/projects/${m.project_id}/search?q=nothing-here`)).body.length, 0);
}));

test("an exact ID match is listed first", withApp(async (c) => {
  const m = await c.module();
  for (let i = 0; i < 12; i++) await add(c, m, `Item ${i}`);
  const r = (await c.get(`/projects/${m.project_id}/search?q=REQ-0001`)).body;
  assert.equal(r[0].display_id, "REQ-0001");
  const partial = (await c.get(`/projects/${m.project_id}/search?q=REQ-001`)).body; // REQ-0010..0012? no: REQ-001x
  assert.ok(partial.every((o) => o.display_id.includes("REQ-001")));
}));

test("results are limited to the current project", withApp(async (c) => {
  const m1 = await c.module();
  const m2 = await c.module();
  await add(c, m1, "Shared word", "battery");
  await add(c, m2, "Other", "battery in the other project");
  const r1 = (await c.get(`/projects/${m1.project_id}/search?q=battery`)).body;
  assert.equal(r1.length, 1);
  assert.equal(r1[0].module_id, m1.id);
  const only1 = await c.as({ [m1.project_id]: "viewer" });
  assert.equal((await only1.get(`/projects/${m1.project_id}/search?q=battery`)).status, 200);
  assert.equal((await only1.get(`/projects/${m2.project_id}/search?q=battery`)).status, 403);
}));

test("deleted (blacklisted) objects are not returned", withApp(async (c) => {
  const m = await c.module();
  const a = await add(c, m, "Gone", "unique-marker");
  await add(c, m, "Stays", "unique-marker");
  await c.del(`/objects/${a.id}`);
  const r = (await c.get(`/projects/${m.project_id}/search?q=unique-marker`)).body;
  assert.deepEqual(r.map((o) => o.display_id), ["REQ-0002"]);
  assert.equal((await c.get(`/projects/${m.project_id}/search?q=REQ-0001`)).body.length, 0);
}));

test("wildcards in the query are matched literally; bad queries are rejected", withApp(async (c) => {
  const m = await c.module();
  await add(c, m, "100% sure");
  await add(c, m, "Plain");
  assert.equal((await c.get(`/projects/${m.project_id}/search?q=%25`)).body.length, 1); // "%"
  assert.equal((await c.get(`/projects/${m.project_id}/search?q=_`)).body.length, 0);
  assert.equal((await c.get(`/projects/${m.project_id}/search`)).status, 422);
  assert.equal((await c.get(`/projects/${m.project_id}/search?q=%20`)).status, 422);
  assert.equal((await c.get(`/projects/999/search?q=x`)).status, 404);
  assert.equal((await c.withToken(null).get(`/projects/${m.project_id}/search?q=x`)).status, 401);
}));

test("limit is honoured", withApp(async (c) => {
  const m = await c.module();
  for (let i = 0; i < 5; i++) await add(c, m, `Thing ${i}`);
  assert.equal((await c.get(`/projects/${m.project_id}/search?q=thing&limit=3`)).body.length, 3);
}));
