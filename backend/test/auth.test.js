import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, SECRET } from "./helpers.js";
import { signJwt } from "../src/jwt.js";

const withApp = (fn) => async () => {
  const c = await setup();
  try { await fn(c); } finally { c.close(); }
};

test("requests without a token are rejected", withApp(async (c) => {
  assert.equal((await c.withToken(null).get("/projects")).status, 401);
}));

test("garbage, forged and expired tokens are rejected", withApp(async (c) => {
  assert.equal((await c.withToken("abc").get("/projects")).status, 401);
  const forged = signJwt({ sub: 1, sid: "x", exp: Date.now() / 1000 + 60 }, "wrong-secret");
  assert.equal((await c.withToken(forged).get("/projects")).status, 401);
  const expired = signJwt({ sub: 1, sid: "x", exp: 1 }, SECRET);
  assert.equal((await c.withToken(expired).get("/projects")).status, 401);
  const noExp = signJwt({ sub: 1, sid: "x" }, SECRET);
  assert.equal((await c.withToken(noExp).get("/projects")).status, 401);
}));

test("token with alg none is rejected", withApp(async (c) => {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const t = `${b({ alg: "none", typ: "JWT" })}.${b({ sub: "x", grants: { "*": "admin" }, exp: 9999999999 })}.`;
  assert.equal((await c.withToken(t).get("/projects")).status, 401);
}));

test("a token only sees and reaches the projects it is granted", withApp(async (c) => {
  const m1 = await c.module(); // project 1
  const m2 = await c.module(); // project 2
  const o2 = await c.add(m2, "secret");
  const only1 = await c.as({ [m1.project_id]: "author" });

  assert.deepEqual((await only1.get("/projects")).body.map((p) => p.id), [m1.project_id]);
  assert.equal((await only1.get(`/projects/${m1.project_id}`)).status, 200);
  assert.equal((await only1.get(`/projects/${m2.project_id}`)).status, 403);
  assert.equal((await only1.get(`/modules/${m2.id}`)).status, 403);
  assert.equal((await only1.get(`/modules/${m2.id}/objects`)).status, 403);
  assert.equal((await only1.post(`/modules/${m2.id}/objects`, { heading: "x" })).status, 403);
  assert.equal((await only1.get(`/objects/${o2.id}`)).status, 403);
  assert.equal((await only1.patch(`/objects/${o2.id}`, { text: "x" })).status, 403);
  assert.equal((await only1.del(`/objects/${o2.id}`)).status, 403);
  assert.equal((await only1.post(`/objects/${o2.id}/move`, {})).status, 403);
  assert.equal((await only1.get(`/projects/${m2.project_id}/id-blacklist`)).status, 403);
  // nothing was changed by the rejected calls
  assert.equal((await c.get(`/objects/${o2.id}`)).body.heading, "secret");
}));

test("only an all-projects grant may create projects", withApp(async (c) => {
  const m = await c.module();
  assert.equal((await (await c.as({ [m.project_id]: "author" })).post("/projects", { name: "X" })).status, 403);
  assert.equal((await (await c.as({})).get("/projects")).body.length, 0);
}));

test("links across projects are rejected", withApp(async (c) => {
  const a = await c.add(await c.module(), "A");
  const b = await c.add(await c.module(), "B");
  assert.equal((await c.post(`/objects/${a.id}/links`, { target_id: b.id })).status, 422);
}));

test("API is documented with OpenAPI and docs are public", withApp(async (c) => {
  const spec = await c.withToken(null).get("/openapi.json");
  assert.equal(spec.status, 200);
  assert.match(spec.body.openapi, /^3\./);
  for (const path of ["/projects", "/projects/{id}/modules", "/modules/{id}/objects", "/objects/{id}/move"]) {
    assert.ok(spec.body.paths[path], path);
  }
  assert.ok(spec.body.components.securitySchemes.bearerAuth);
}));
