import { createApp } from "../src/app.js";
import { openDb } from "../src/db.js";
import { signJwt } from "../src/jwt.js";
import { readFileSync } from "node:fs";
import { createUser } from "../src/auth.js";

export const API = "/api/v1";
export const SECRET = "test-secret";
// the link types of the shipped configuration
export const LINK_TYPES = JSON.parse(readFileSync(new URL("../config/link-types.json", import.meta.url), "utf8"));

// Creates a user with the given grants ({"*": "admin"} or {projectId: role}) and a live session;
// returns a JWT for it, as /auth/login would.
let counter = 0;
export async function tokenFor(db, grants) {
  const admin = grants["*"] === "admin";
  const uid = await createUser(db, { username: `user${++counter}`, password: "password123", isAdmin: admin });
  for (const [pid, role] of Object.entries(grants)) {
    if (pid !== "*") db.prepare("INSERT INTO memberships (user_id, project_id, role) VALUES (?, ?, ?)").run(uid, pid, role);
  }
  const sid = `sid${counter}`;
  db.prepare("INSERT INTO sessions (id, user_id, last_activity) VALUES (?, ?, ?)").run(sid, uid, Date.now());
  return signJwt({ sub: uid, sid, exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
}

function client(base, tok, server, db) {
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...(tok ? { authorization: `Bearer ${tok}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const c = {
    get: (p) => call("GET", p),
    post: (p, b = {}) => call("POST", p, b),
    patch: (p, b) => call("PATCH", p, b),
    put: (p, b) => call("PUT", p, b),
    token: tok,
    del: (p) => call("DELETE", p),
    close: () => server.close(),
    // Same server, different credentials.
    db,
    // Same server, different credentials. `await c.as({ [projectId]: "author" })`
    as: async (grants) => client(base, grants === null ? null : await tokenFor(db, grants), server, db),
    withToken: (t) => client(base, t, server, db),
    // Raw call without any auth header handling, for login tests.
    base,
  };
  c.module = async () => {
    const p = (await c.post("/projects", { name: "P" })).body;
    return (await c.post(`/projects/${p.id}/modules`, { name: "M" })).body;
  };
  c.add = async (mod, heading, parent = null, position) => {
    const r = await c.post(`/modules/${mod.id}/objects`, { heading, parent_id: parent, position });
    if (r.status !== 201) throw new Error(JSON.stringify(r));
    return r.body;
  };
  // Compact tree shape: "A" for leaves, [ "A", [children] ] for nodes with children.
  c.tree = async (mod) => {
    const shape = (nodes) => nodes.map((n) => (n.children.length ? [n.heading, shape(n.children)] : n.heading));
    return shape((await c.get(`/modules/${mod.id}/objects`)).body);
  };
  return c;
}

// Starts a fresh app on an in-memory database; the returned client is an all-projects admin.
export async function setup(options = {}) {
  const db = openDb(":memory:");
  const server = createApp(db, { jwtSecret: SECRET, linkTypes: LINK_TYPES, ...options }).listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}${API}`;
  return client(base, await tokenFor(db, { "*": "admin" }), server, db);
}
