import { test } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";
import { createUser } from "../src/auth.js";
import { hashPassword, verifyPassword } from "../src/password.js";
import { can } from "../src/permissions.js";

async function app(options) {
  const c = await setup(options);
  await createUser(c.db, { username: "elif", password: "correct-horse" });
  const anon = c.withToken(null);
  return { c, anon, login: (password, username = "elif") => anon.post("/auth/login", { username, password }) };
}
const run = (opts, fn) => async () => {
  const ctx = await app(opts);
  try { await fn(ctx); } finally { ctx.c.close(); }
};

test("passwords are stored salted and hashed", async () => {
  const a = await hashPassword("secret-password");
  const b = await hashPassword("secret-password");
  assert.notEqual(a, b); // different salts
  assert.ok(!a.includes("secret-password"));
  assert.equal(await verifyPassword("secret-password", a), true);
  assert.equal(await verifyPassword("other", a), false);
});

test("stored hash is not the plain password and is never returned", run({}, async ({ c }) => {
  const row = c.db.prepare("SELECT password_hash FROM users WHERE username = 'elif'").get();
  assert.match(row.password_hash, /^scrypt\$/);
  assert.ok(!row.password_hash.includes("correct-horse"));
  const list = JSON.stringify((await c.get("/users")).body);
  assert.ok(!list.includes("scrypt"));
}));

test("login returns a JWT that works; wrong password and unknown user give 401", run({}, async ({ login, anon }) => {
  assert.equal((await login("nope")).status, 401);
  assert.equal((await login("x", "ghost")).status, 401);
  assert.equal((await anon.post("/auth/login", {})).status, 422);
  const ok = await login("correct-horse");
  assert.equal(ok.status, 200);
  assert.equal(ok.body.inactivity_timeout_sec, 1800);
  const me = await anon.withToken(ok.body.token).get("/auth/me");
  assert.equal(me.body.username, "elif");
}));

test("session expires after 30 minutes of inactivity but activity keeps it alive", async () => {
  let t = 1_700_000_000_000;
  const c = await setup({ now: () => t });
  try {
    await createUser(c.db, { username: "elif", password: "correct-horse" });
    const anon = c.withToken(null);
    const { body } = await anon.post("/auth/login", { username: "elif", password: "correct-horse" });
    const user = anon.withToken(body.token);
    t += 29 * 60_000;
    assert.equal((await user.get("/auth/me")).status, 200); // activity resets the timer
    t += 29 * 60_000;
    assert.equal((await user.get("/auth/me")).status, 200);
    t += 31 * 60_000; // idle too long
    assert.equal((await user.get("/auth/me")).status, 401);
    t += 1000;
    assert.equal((await user.get("/auth/me")).status, 401); // stays dead
  } finally { c.close(); }
});

test("inactivity timeout is configurable", async () => {
  let t = 1_700_000_000_000;
  const c = await setup({ now: () => t, sessionTimeoutMs: 60_000 });
  try {
    await createUser(c.db, { username: "elif", password: "correct-horse" });
    const anon = c.withToken(null);
    const { body } = await anon.post("/auth/login", { username: "elif", password: "correct-horse" });
    t += 61_000;
    assert.equal((await anon.withToken(body.token).get("/auth/me")).status, 401);
  } finally { c.close(); }
});

test("logout ends the session", run({}, async ({ login, anon }) => {
  const { body } = await login("correct-horse");
  const user = anon.withToken(body.token);
  assert.equal((await user.post("/auth/logout")).status, 204);
  assert.equal((await user.get("/auth/me")).status, 401);
}));

test("account locks after 5 failed logins, even for the right password", run({}, async ({ c, login }) => {
  for (let i = 0; i < 4; i++) assert.equal((await login("bad")).status, 401);
  assert.equal((await login("bad")).status, 423); // 5th failure locks
  assert.equal((await login("correct-horse")).status, 423);
  // administrator can unlock
  const uid = c.db.prepare("SELECT id FROM users WHERE username = 'elif'").get().id;
  assert.equal((await c.post(`/users/${uid}/unlock`)).status, 200);
  assert.equal((await login("correct-horse")).status, 200);
}));

test("lock ends by itself and a success resets the failure counter", async () => {
  let t = 1_700_000_000_000;
  const c = await setup({ now: () => t });
  try {
    await createUser(c.db, { username: "elif", password: "correct-horse" });
    const anon = c.withToken(null);
    const login = (p) => anon.post("/auth/login", { username: "elif", password: p });
    for (let i = 0; i < 5; i++) await login("bad");
    assert.equal((await login("correct-horse")).status, 423);
    t += 16 * 60_000;
    assert.equal((await login("correct-horse")).status, 200);
    for (let i = 0; i < 4; i++) await login("bad"); // counter restarted from 0
    assert.equal((await login("correct-horse")).status, 200);
    for (let i = 0; i < 4; i++) assert.equal((await login("bad")).status, 401);
  } finally { c.close(); }
});

test("permission matrix", () => {
  const rows = {
    admin: ["read", "write", "review", "manage"],
    author: ["read", "write"],
    reviewer: ["read", "review"],
    viewer: ["read"],
  };
  for (const [role, allowed] of Object.entries(rows)) {
    for (const action of ["read", "write", "review", "manage"]) {
      assert.equal(can(role, action), allowed.includes(action), `${role}/${action}`);
    }
  }
  assert.equal(can(undefined, "read"), false);
});

test("roles are enforced per project", run({}, async ({ c }) => {
  const m = await c.module();
  const o = await c.add(m, "A");
  const other = await c.module(); // a second project
  const as = (role) => c.as({ [m.project_id]: role });

  const viewer = await as("viewer");
  assert.equal((await viewer.get(`/objects/${o.id}`)).status, 200);
  assert.equal((await viewer.patch(`/objects/${o.id}`, { text: "x" })).status, 403);
  assert.equal((await viewer.post(`/modules/${m.id}/objects`, { heading: "n" })).status, 403);
  assert.equal((await viewer.del(`/objects/${o.id}`)).status, 403);

  const reviewer = await as("reviewer");
  assert.equal((await reviewer.get(`/modules/${m.id}/objects`)).status, 200);
  assert.equal((await reviewer.patch(`/objects/${o.id}`, { text: "x" })).status, 403);

  const author = await as("author");
  assert.equal((await author.patch(`/objects/${o.id}`, { text: "x" })).status, 200);
  assert.equal((await author.post(`/modules/${m.id}/objects`, { heading: "n" })).status, 201);
  assert.equal((await author.patch(`/projects/${m.project_id}`, { name: "renamed" })).status, 403);
  assert.equal((await author.del(`/projects/${m.project_id}`)).status, 403);
  assert.equal((await author.post("/projects", { name: "new" })).status, 403);
  assert.equal((await author.get(`/modules/${other.id}`)).status, 403); // other project

  const padmin = await as("admin");
  assert.equal((await padmin.patch(`/projects/${m.project_id}`, { name: "renamed" })).status, 200);
  assert.equal((await padmin.get(`/modules/${other.id}`)).status, 403); // still only its own project
}));

test("administrators manage users and project members", run({}, async ({ c, anon }) => {
  const m = await c.module();
  const u = (await c.post("/users", { username: "ali", password: "long-enough-pw" })).body;
  assert.equal(u.is_admin, false);
  assert.equal((await c.post("/users", { username: "ali", password: "long-enough-pw" })).status, 409);
  assert.equal((await c.post("/users", { username: "b", password: "short" })).status, 422);

  const put = await c.put(`/projects/${m.project_id}/members/${u.id}`, { role: "viewer" });
  assert.equal(put.status, 200);

  // the new user logs in and sees exactly that project, read-only
  const login = await anon.post("/auth/login", { username: "ali", password: "long-enough-pw" });
  const ali = anon.withToken(login.body.token);
  assert.deepEqual((await ali.get("/projects")).body.map((p) => p.id), [m.project_id]);
  assert.equal((await ali.post(`/projects/${m.project_id}/modules`, { name: "x" })).status, 403);
  assert.equal((await ali.get("/users")).status, 403); // not an administrator
}));
