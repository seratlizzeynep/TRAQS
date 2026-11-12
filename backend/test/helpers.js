import { createApp } from "../src/app.js";
import { openDb } from "../src/db.js";
import { signJwt } from "../src/jwt.js";

export const API = "/api/v1";
export const SECRET = "test-secret";
export const token = (grants, extra = {}) =>
  signJwt({ sub: "tester", grants, exp: Math.floor(Date.now() / 1000) + 3600, ...extra }, SECRET);

function client(base, tok, server) {
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
    del: (p) => call("DELETE", p),
    close: () => server.close(),
    // Same server, different credentials.
    as: (grants) => client(base, grants === null ? null : token(grants), server),
    withToken: (t) => client(base, t, server),
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
export async function setup() {
  const server = createApp(openDb(":memory:"), { jwtSecret: SECRET }).listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}${API}`;
  return client(base, token({ "*": "admin" }), server);
}
