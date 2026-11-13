import { test } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";

const withApp = (fn) => async () => {
  const c = await setup();
  try { await fn(c); } finally { c.close(); }
};
const login = (c, username, password) => c.withToken(null).post("/auth/login", { username, password });

test("administrator resets a password: old one stops working, new one works", withApp(async (c) => {
  const u = (await c.post("/users", { username: "ali", password: "old-password-1" })).body;
  assert.equal((await login(c, "ali", "old-password-1")).status, 200);
  assert.equal((await c.put(`/users/${u.id}/password`, { password: "new-password-2" })).status, 204);
  assert.equal((await login(c, "ali", "old-password-1")).status, 401);
  assert.equal((await login(c, "ali", "new-password-2")).status, 200);
}));

test("a password reset ends open sessions and unlocks the account", withApp(async (c) => {
  const u = (await c.post("/users", { username: "ali", password: "old-password-1" })).body;
  const session = c.withToken((await login(c, "ali", "old-password-1")).body.token);
  assert.equal((await session.get("/auth/me")).status, 200);
  for (let i = 0; i < 5; i++) await login(c, "ali", "wrong");
  assert.equal((await login(c, "ali", "old-password-1")).status, 423); // locked
  await c.put(`/users/${u.id}/password`, { password: "new-password-2" });
  assert.equal((await session.get("/auth/me")).status, 401); // old session is gone
  assert.equal((await login(c, "ali", "new-password-2")).status, 200); // no longer locked
}));

test("password reset validation and permissions", withApp(async (c) => {
  const u = (await c.post("/users", { username: "ali", password: "old-password-1" })).body;
  assert.equal((await c.put(`/users/${u.id}/password`, { password: "short" })).status, 422);
  assert.equal((await c.put(`/users/${u.id}/password`, {})).status, 422);
  assert.equal((await c.put("/users/999/password", { password: "long-enough-pw" })).status, 404);
  const m = await c.module();
  for (const role of ["author", "reviewer", "viewer", "admin"]) {
    const other = await c.as({ [m.project_id]: role }); // not a global administrator
    assert.equal((await other.put(`/users/${u.id}/password`, { password: "long-enough-pw" })).status, 403, role);
  }
  assert.equal((await login(c, "ali", "old-password-1")).status, 200); // unchanged
}));

test("members of a project are listed with user names", withApp(async (c) => {
  const m = await c.module();
  const a = (await c.post("/users", { username: "zeynep", password: "long-enough-pw" })).body;
  const b = (await c.post("/users", { username: "ali", password: "long-enough-pw" })).body;
  await c.put(`/projects/${m.project_id}/members/${a.id}`, { role: "author" });
  await c.put(`/projects/${m.project_id}/members/${b.id}`, { role: "reviewer" });
  const list = (await c.get(`/projects/${m.project_id}/members`)).body;
  assert.deepEqual(list.map((x) => [x.username, x.role]), [["ali", "reviewer"], ["zeynep", "author"]]);
}));

test("a user can hold different roles in different projects", withApp(async (c) => {
  const m1 = await c.module();
  const m2 = await c.module();
  const u = (await c.post("/users", { username: "elif", password: "long-enough-pw" })).body;
  await c.put(`/projects/${m1.project_id}/members/${u.id}`, { role: "author" });
  await c.put(`/projects/${m2.project_id}/members/${u.id}`, { role: "reviewer" });
  await c.put(`/projects/${m1.project_id}/members/${u.id}`, { role: "viewer" }); // role change
  const elif = c.withToken((await login(c, "elif", "long-enough-pw")).body.token);
  const me = (await elif.get("/auth/me")).body;
  assert.deepEqual(me.memberships.map((x) => [x.project_id, x.role]), [[m1.project_id, "viewer"], [m2.project_id, "reviewer"]]);
  await c.del(`/projects/${m2.project_id}/members/${u.id}`);
  assert.equal((await elif.get(`/projects/${m2.project_id}`)).status, 403);
}));

test("only project administrators manage members of their project", withApp(async (c) => {
  const m = await c.module();
  const other = await c.module();
  const u = (await c.post("/users", { username: "ali", password: "long-enough-pw" })).body;
  const padmin = await c.as({ [m.project_id]: "admin" });
  assert.equal((await padmin.put(`/projects/${m.project_id}/members/${u.id}`, { role: "viewer" })).status, 200);
  assert.equal((await padmin.put(`/projects/${other.project_id}/members/${u.id}`, { role: "viewer" })).status, 403);
  const author = await c.as({ [m.project_id]: "author" });
  assert.equal((await author.put(`/projects/${m.project_id}/members/${u.id}`, { role: "viewer" })).status, 403);
  assert.equal((await padmin.put(`/projects/${m.project_id}/members/${u.id}`, { role: "boss" })).status, 422);
}));
