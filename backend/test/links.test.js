import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { LINK_TYPES, setup } from "./helpers.js";
import { createApp } from "../src/app.js";
import { openDb } from "../src/db.js";

const withApp = (fn, options) => async () => {
  const c = await setup(options);
  try { await fn(c, await c.module()); } finally { c.close(); }
};
const link = (c, from, to, type) => c.post(`/objects/${from.id}/links`, { target_id: to.id, type });

test("link types come from the configuration", withApp(async (c) => {
  const r = await c.get("/link-types");
  assert.deepEqual(r.body.map((t) => t.name), ["Derives", "Satisfies", "Verifies", "Refers"]);
  assert.equal(r.body.find((t) => t.name === "Derives").inverse, "Derived from");
  assert.equal(r.body.find((t) => t.name === "Refers").informative, true);
  assert.equal(r.body.find((t) => t.name === "Verifies").informative, false);
}));

test("every configured type can be used to create a link", withApp(async (c, m) => {
  const a = await c.add(m, "A");
  const b = await c.add(m, "B");
  for (const type of ["Derives", "Satisfies", "Verifies", "Refers"]) {
    const r = await link(c, a, b, type);
    assert.equal(r.status, 201, type);
    assert.equal(r.body.type, type);
    assert.equal(r.body.source_id, a.id);
    assert.equal(r.body.target_id, b.id);
    assert.equal(r.body.suspect, 0);
  }
}));

test("the link type is required and must be a configured one", withApp(async (c, m) => {
  const a = await c.add(m, "A");
  const b = await c.add(m, "B");
  for (const type of [undefined, null, "", "derives", "Implements", 5, ["Derives"]]) {
    const r = await c.post(`/objects/${a.id}/links`, { target_id: b.id, type });
    assert.equal(r.status, 422, JSON.stringify(type));
  }
  const r = await c.post(`/objects/${a.id}/links`, { target_id: b.id, type: "Nope" });
  assert.match(r.body.detail, /Derives, Satisfies, Verifies, Refers/); // tells what is allowed
  assert.equal((await c.get(`/objects/${a.id}/links`)).body.length, 0);
}));

test("links work within a module and across modules of the same project", withApp(async (c, m) => {
  const m2 = (await c.post(`/projects/${m.project_id}/modules`, { name: "Tests" })).body;
  const req = await c.add(m, "Requirement");
  const sibling = await c.add(m, "Sibling");
  const test1 = await c.add(m2, "Test case");
  assert.equal((await link(c, req, sibling, "Derives")).status, 201); // same module
  const cross = await link(c, test1, req, "Verifies"); // across modules
  assert.equal(cross.status, 201);
  assert.equal(cross.body.source.module_name, "Tests");
  assert.equal(cross.body.target.module_name, "M");
}));

test("links never leave the project and never point to the object itself", withApp(async (c, m) => {
  const other = await c.module();
  const a = await c.add(m, "A");
  const foreign = await c.add(other, "Foreign");
  assert.equal((await link(c, a, foreign, "Refers")).status, 422);
  assert.equal((await link(c, a, a, "Refers")).status, 422);
  assert.equal((await c.post(`/objects/${a.id}/links`, { target_id: 999, type: "Refers" })).status, 404);
  assert.equal((await c.post(`/objects/${a.id}/links`, { target_id: "x", type: "Refers" })).status, 422);
}));

test("the same pair may have several types, but not the same type twice", withApp(async (c, m) => {
  const a = await c.add(m, "A");
  const b = await c.add(m, "B");
  assert.equal((await link(c, a, b, "Derives")).status, 201);
  assert.equal((await link(c, a, b, "Refers")).status, 201);
  assert.equal((await link(c, a, b, "Derives")).status, 409);
  assert.equal((await link(c, b, a, "Derives")).status, 201); // the other direction is a different link
}));

test("both ends see a link, with the details the UI needs", withApp(async (c, m) => {
  const a = await c.add(m, "Alpha");
  const b = await c.add(m, "Beta");
  await link(c, a, b, "Derives");
  const fromA = (await c.get(`/objects/${a.id}/links`)).body;
  const fromB = (await c.get(`/objects/${b.id}/links`)).body;
  assert.equal(fromA.length, 1);
  assert.deepEqual(fromA, fromB);
  const l = fromA[0];
  assert.deepEqual([l.source.display_id, l.source.heading, l.target.display_id, l.target.heading], ["REQ-0001", "Alpha", "REQ-0002", "Beta"]);
  assert.equal(l.target.deleted, false);
}));

test("deleting an end keeps the link, marks it suspect and shows the end as deleted", withApp(async (c, m) => {
  const a = await c.add(m, "A");
  const b = await c.add(m, "B");
  await link(c, a, b, "Verifies");
  await c.del(`/objects/${b.id}`);
  const l = (await c.get(`/objects/${a.id}/links`)).body[0];
  assert.equal(l.suspect, 1);
  assert.equal(l.target.deleted, true);
  assert.equal(l.target.display_id, "REQ-0002");
  assert.equal((await link(c, a, b, "Refers")).status, 404); // cannot link to a deleted object
}));

test("a link can be deleted; the objects stay", withApp(async (c, m) => {
  const a = await c.add(m, "A");
  const b = await c.add(m, "B");
  const l = (await link(c, a, b, "Derives")).body;
  assert.equal((await c.del(`/links/${l.id}`)).status, 204);
  assert.deepEqual((await c.get(`/objects/${a.id}/links`)).body, []);
  assert.equal((await c.get(`/objects/${a.id}`)).status, 200);
  assert.equal((await c.del(`/links/${l.id}`)).status, 404);
  assert.equal((await link(c, a, b, "Derives")).status, 201); // can be created again
}));

test("a link whose source was deleted can still be removed by authorised users", withApp(async (c, m) => {
  const a = await c.add(m, "A");
  const b = await c.add(m, "B");
  const l = (await link(c, a, b, "Derives")).body;
  await c.del(`/objects/${a.id}`);
  const author = await c.as({ [m.project_id]: "author" });
  assert.equal((await author.del(`/links/${l.id}`)).status, 204);
}));

test("permissions: read to see, write to create and delete, no access across projects", withApp(async (c, m) => {
  const a = await c.add(m, "A");
  const b = await c.add(m, "B");
  const l = (await link(c, a, b, "Derives")).body;
  const other = await c.module();
  const as = (role) => c.as({ [m.project_id]: role });
  const viewer = await as("viewer");
  assert.equal((await viewer.get(`/objects/${a.id}/links`)).status, 200);
  assert.equal((await viewer.get("/link-types")).status, 200);
  assert.equal((await link(viewer, a, b, "Refers")).status, 403);
  assert.equal((await viewer.del(`/links/${l.id}`)).status, 403);
  const reviewer = await as("reviewer");
  assert.equal((await link(reviewer, a, b, "Refers")).status, 403);
  const author = await as("author");
  assert.equal((await link(author, a, b, "Refers")).status, 201);
  const stranger = await c.as({ [other.project_id]: "admin" });
  assert.equal((await stranger.get(`/objects/${a.id}/links`)).status, 403);
  assert.equal((await stranger.del(`/links/${l.id}`)).status, 403);
  assert.equal((await link(stranger, a, b, "Refers")).status, 403);
  assert.equal((await c.withToken(null).get("/link-types")).status, 401);
}));

test("the link types are configuration, not code", async () => {
  const custom = [{ name: "Implements", inverse: "Implemented by" }, { name: "Conflicts" }];
  const c = await setup({ linkTypes: custom });
  try {
    const m = await c.module();
    const a = await c.add(m, "A");
    const b = await c.add(m, "B");
    assert.deepEqual((await c.get("/link-types")).body.map((t) => [t.name, t.inverse]), [["Implements", "Implemented by"], ["Conflicts", "Conflicts"]]);
    assert.equal((await link(c, a, b, "Implements")).status, 201);
    assert.equal((await link(c, a, b, "Derives")).status, 422); // not configured here
  } finally { c.close(); }
});

test("invalid link type configuration stops the app at start-up", () => {
  const start = (linkTypes) => createApp(openDb(":memory:"), { jwtSecret: "s", linkTypes });
  assert.throws(() => start("nope"), /list/);
  assert.throws(() => start([{}]), /name/);
  assert.throws(() => start([{ name: "A" }, { name: "a" }]), /twice/);
  assert.throws(() => start([{ name: "A", inverse: 5 }]), /inverse/);
  assert.doesNotThrow(() => start([]));
});

test("the shipped configuration lists the four types of the requirement", () => {
  assert.deepEqual(LINK_TYPES.map((t) => t.name), ["Derives", "Satisfies", "Verifies", "Refers"]);
});

test("links of an older database become 'Refers' links", () => {
  const file = join(mkdtempSync(join(tmpdir(), "traqs-")), "old.db");
  // build a database that still has the old links table (no type column)
  const first = openDb(file);
  first.prepare("INSERT INTO projects (name) VALUES ('P')").run();
  first.prepare("INSERT INTO modules (project_id, name) VALUES (1, 'M')").run();
  for (const n of [1, 2]) first.prepare("INSERT INTO objects (module_id, parent_id, position, display_id) VALUES (1, NULL, ?, ?)").run(n, `REQ-000${n}`);
  first.exec(`DROP TABLE links; CREATE TABLE links (id INTEGER PRIMARY KEY AUTOINCREMENT, source_id INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
    target_id INTEGER NOT NULL REFERENCES objects(id) ON DELETE CASCADE, suspect INTEGER NOT NULL DEFAULT 0, UNIQUE (source_id, target_id));
    INSERT INTO links (source_id, target_id, suspect) VALUES (1, 2, 1);`);
  first.close();

  const migrated = openDb(file);
  const rows = migrated.prepare("SELECT source_id, target_id, type, suspect FROM links").all();
  assert.deepEqual(rows, [{ source_id: 1, target_id: 2, type: "Refers", suspect: 1 }]);
  // the new uniqueness rule applies: another type is fine, the same type is not
  migrated.prepare("INSERT INTO links (source_id, target_id, type) VALUES (1, 2, 'Derives')").run();
  assert.throws(() => migrated.prepare("INSERT INTO links (source_id, target_id, type) VALUES (1, 2, 'Derives')").run());
  migrated.close();
  openDb(file).close(); // opening again must not migrate twice
});
