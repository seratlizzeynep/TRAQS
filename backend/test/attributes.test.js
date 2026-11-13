import { test } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./helpers.js";
import { createApp } from "../src/app.js";
import { openDb } from "../src/db.js";
import { ValidationError, getType, listTypes, registerType } from "../src/attributes/index.js";

const withApp = (fn, options) => async () => {
  const c = await setup(options);
  try { await fn(c, await c.module()); } finally { c.close(); }
};
const def = (c, m, body) => c.post(`/projects/${m.project_id}/attributes`, body);
const prio = { name: "Priority", type: "enumeration", options: { values: ["Must", "Should", "Could"] } };

test("the four built-in types are described for the UI", withApp(async (c) => {
  const r = await c.get("/attribute-types");
  assert.deepEqual(r.body.map((t) => t.type).sort(), ["date", "enumeration", "number", "text"]);
  const num = r.body.find((t) => t.type === "number");
  assert.equal(num.input, "number");
  assert.deepEqual(num.option_fields.map((f) => f.key), ["integer", "min", "max", "unit"]);
}));

test("define attributes of every type; keys come from the names", withApp(async (c, m) => {
  const a = (await def(c, m, prio)).body;
  assert.equal(a.key, "priority");
  assert.deepEqual(a.options, { values: ["Must", "Should", "Could"] });
  const w = await def(c, m, { name: "Weight (kg)", type: "number", options: { min: 0, max: 100, unit: "kg" } });
  assert.equal(w.status, 201);
  assert.equal(w.body.key, "weight_kg");
  assert.equal((await def(c, m, { name: "Due", type: "date" })).status, 201);
  assert.equal((await def(c, m, { name: "Owner", type: "text", options: { max_length: 20 } })).status, 201);
  assert.equal((await def(c, m, { name: "Priority", type: "text" })).body.key, "priority_2"); // same name, new key
  const list = (await c.get(`/projects/${m.project_id}/attributes`)).body;
  assert.deepEqual(list.map((d) => d.key), ["priority", "weight_kg", "due", "owner", "priority_2"]);
}));

test("invalid definitions are rejected", withApp(async (c, m) => {
  const bad = [
    {},
    { name: "x" },
    { name: "x", type: "nope" },
    { name: "", type: "text" },
    { name: "E", type: "enumeration" },
    { name: "E", type: "enumeration", options: { values: [] } },
    { name: "E", type: "enumeration", options: { values: ["a", "a"] } },
    { name: "N", type: "number", options: { min: 5, max: 1 } },
    { name: "N", type: "number", options: { min: "x" } },
    { name: "T", type: "text", options: { max_length: 0 } },
    { name: "K", type: "text", key: "Bad Key" },
  ];
  for (const b of bad) assert.equal((await def(c, m, b)).status, 422, JSON.stringify(b));
  assert.equal((await def(c, m, { name: "A", type: "text", key: "same" })).status, 201);
  assert.equal((await def(c, m, { name: "B", type: "text", key: "same" })).status, 409);
}));

test("values are stored per object and returned with it", withApp(async (c, m) => {
  await def(c, m, prio);
  await def(c, m, { name: "Weight", type: "number" });
  await def(c, m, { name: "Due", type: "date" });
  await def(c, m, { name: "Owner", type: "text" });
  const o = (await c.post(`/modules/${m.id}/objects`, { heading: "A" })).body;
  assert.deepEqual(o.attributes, {});
  const r = await c.put(`/objects/${o.id}/attributes`, { priority: "Must", weight: 2.5, due: "2026-12-31", owner: "Elif" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.attributes, { priority: "Must", weight: 2.5, due: "2026-12-31", owner: "Elif" });
  assert.deepEqual((await c.get(`/objects/${o.id}`)).body.attributes, r.body.attributes);
  const tree = (await c.get(`/modules/${m.id}/objects`)).body;
  assert.deepEqual(tree[0].attributes.priority, "Must");
  // a number stays a number
  assert.equal(typeof (await c.get(`/objects/${o.id}`)).body.attributes.weight, "number");
}));

test("setting some values keeps the others; null or empty clears", withApp(async (c, m) => {
  await def(c, m, prio);
  await def(c, m, { name: "Owner", type: "text" });
  const o = (await c.post(`/modules/${m.id}/objects`, { heading: "A" })).body;
  await c.put(`/objects/${o.id}/attributes`, { priority: "Must", owner: "Elif" });
  await c.put(`/objects/${o.id}/attributes`, { priority: "Could" });
  assert.deepEqual((await c.get(`/objects/${o.id}`)).body.attributes, { priority: "Could", owner: "Elif" });
  await c.put(`/objects/${o.id}/attributes`, { priority: null, owner: "" });
  assert.deepEqual((await c.get(`/objects/${o.id}`)).body.attributes, {});
}));

test("values of the wrong type are rejected and nothing is stored (UC2)", withApp(async (c, m) => {
  await def(c, m, prio);
  await def(c, m, { name: "Weight", type: "number", options: { integer: true, min: 0, max: 10 } });
  await def(c, m, { name: "Due", type: "date" });
  await def(c, m, { name: "Owner", type: "text", options: { max_length: 5 } });
  const o = (await c.post(`/modules/${m.id}/objects`, { heading: "A" })).body;
  const cases = [
    { priority: "Urgent" }, { priority: 1 }, { priority: ["Must"] },
    { weight: "5" }, { weight: 1.5 }, { weight: -1 }, { weight: 11 }, { weight: true }, { weight: "Infinity" },
    { due: "31.12.2026" }, { due: "2026-02-30" }, { due: "2026-13-01" }, { due: 20261231 },
    { owner: 5 }, { owner: "too long" },
    { nope: "x" },
  ];
  for (const body of cases) {
    const r = await c.put(`/objects/${o.id}/attributes`, body);
    assert.equal(r.status, 422, JSON.stringify(body));
  }
  // one bad value spoils the whole request; the good one is not written
  const mixed = await c.put(`/objects/${o.id}/attributes`, { priority: "Must", weight: "x" });
  assert.equal(mixed.status, 422);
  assert.match(mixed.body.detail, /weight/);
  assert.deepEqual((await c.get(`/objects/${o.id}`)).body.attributes, {});
  assert.equal((await c.put(`/objects/${o.id}/attributes`, [1])).status, 422);
}));

test("attributes can be given when an object is created, and are validated", withApp(async (c, m) => {
  await def(c, m, prio);
  const ok = await c.post(`/modules/${m.id}/objects`, { heading: "A", attributes: { priority: "Should" } });
  assert.equal(ok.status, 201);
  assert.deepEqual(ok.body.attributes, { priority: "Should" });
  const bad = await c.post(`/modules/${m.id}/objects`, { heading: "B", attributes: { priority: "Nope" } });
  assert.equal(bad.status, 422);
  assert.equal((await c.get(`/modules/${m.id}/objects?flat=true`)).body.length, 1); // nothing half-created
}));

test("changing options must keep stored values valid", withApp(async (c, m) => {
  const a = (await def(c, m, prio)).body;
  const o = (await c.post(`/modules/${m.id}/objects`, { heading: "A", attributes: { priority: "Could" } })).body;
  const widen = await c.patch(`/attributes/${a.id}`, { options: { values: ["Must", "Should", "Could", "Won't"] } });
  assert.equal(widen.status, 200);
  const narrow = await c.patch(`/attributes/${a.id}`, { options: { values: ["Must", "Should"] } });
  assert.equal(narrow.status, 409);
  assert.match(narrow.body.detail, /REQ-0001/);
  assert.equal((await c.get(`/objects/${o.id}`)).body.attributes.priority, "Could");
  // renaming and describing is always fine; type and key are fixed
  assert.equal((await c.patch(`/attributes/${a.id}`, { name: "Prio", description: "d" })).body.name, "Prio");
  assert.equal((await c.patch(`/attributes/${a.id}`, { type: "text" })).status, 422);
  assert.equal((await c.patch(`/attributes/${a.id}`, { key: "other" })).status, 422);
  assert.equal((await c.patch(`/attributes/${a.id}`, { options: { values: [] } })).status, 422);
}));

test("deleting a definition removes its values; reordering works", withApp(async (c, m) => {
  const a = (await def(c, m, prio)).body;
  const b = (await def(c, m, { name: "Owner", type: "text" })).body;
  const o = (await c.post(`/modules/${m.id}/objects`, { heading: "A", attributes: { priority: "Must", owner: "E" } })).body;
  const re = await c.put(`/projects/${m.project_id}/attributes/order`, { ids: [b.id, a.id] });
  assert.deepEqual(re.body.map((d) => d.key), ["owner", "priority"]);
  assert.equal((await c.put(`/projects/${m.project_id}/attributes/order`, { ids: [a.id] })).status, 422);
  assert.equal((await c.del(`/attributes/${a.id}`)).status, 204);
  assert.deepEqual((await c.get(`/objects/${o.id}`)).body.attributes, { owner: "E" });
  assert.equal((await c.get(`/attributes/${a.id}`)).status, 404);
}));

test("attributes belong to a project: other projects do not see or use them", withApp(async (c, m) => {
  await def(c, m, prio);
  const m2 = await c.module(); // second project
  assert.deepEqual((await c.get(`/projects/${m2.project_id}/attributes`)).body, []);
  const o2 = (await c.post(`/modules/${m2.id}/objects`, { heading: "X" })).body;
  assert.equal((await c.put(`/objects/${o2.id}/attributes`, { priority: "Must" })).status, 422); // unknown there
}));

test("permissions: reading needs read, defining and setting need write; no cross-project access", withApp(async (c, m) => {
  const a = (await def(c, m, prio)).body;
  const o = (await c.post(`/modules/${m.id}/objects`, { heading: "A" })).body;
  const other = await c.module();
  const as = (role) => c.as({ [m.project_id]: role });
  const viewer = await as("viewer");
  assert.equal((await viewer.get(`/projects/${m.project_id}/attributes`)).status, 200);
  assert.equal((await viewer.get(`/attributes/${a.id}`)).status, 200);
  assert.equal((await viewer.post(`/projects/${m.project_id}/attributes`, { name: "x", type: "text" })).status, 403);
  assert.equal((await viewer.patch(`/attributes/${a.id}`, { name: "x" })).status, 403);
  assert.equal((await viewer.del(`/attributes/${a.id}`)).status, 403);
  assert.equal((await viewer.put(`/objects/${o.id}/attributes`, { priority: "Must" })).status, 403);
  const reviewer = await as("reviewer");
  assert.equal((await reviewer.put(`/objects/${o.id}/attributes`, { priority: "Must" })).status, 403);
  const author = await as("author");
  assert.equal((await author.put(`/objects/${o.id}/attributes`, { priority: "Must" })).status, 200);
  assert.equal((await author.post(`/projects/${m.project_id}/attributes`, { name: "x", type: "text" })).status, 201);
  // another project's attributes stay out of reach
  assert.equal((await author.get(`/projects/${other.project_id}/attributes`)).status, 403);
  assert.equal((await c.withToken(null).get("/attribute-types")).status, 401);
}));

test("configured defaults are applied to new projects, not hard-coded", async () => {
  const defaults = [
    { name: "Priority", type: "enumeration", options: { values: ["High", "Low"] } },
    { name: "Cost", type: "number", options: { min: 0 } },
  ];
  const c = await setup({ defaultAttributes: defaults });
  try {
    const p = (await c.post("/projects", { name: "P" })).body;
    const list = (await c.get(`/projects/${p.id}/attributes`)).body;
    assert.deepEqual(list.map((d) => [d.key, d.type]), [["priority", "enumeration"], ["cost", "number"]]);
    assert.deepEqual(list[0].options.values, ["High", "Low"]);
    // they are ordinary definitions: the project can change and delete them
    assert.equal((await c.del(`/attributes/${list[1].id}`)).status, 204);
    // applying the defaults again only adds what is missing
    const added = (await c.post(`/projects/${p.id}/attributes/defaults`)).body;
    assert.deepEqual(added.map((d) => d.key), ["cost"]);
    assert.equal((await c.post(`/projects/${p.id}/attributes/defaults`)).body.length, 0);
  } finally { c.close(); }
});

test("without configured defaults a new project has no attributes", withApp(async (c, m) => {
  assert.deepEqual((await c.get(`/projects/${m.project_id}/attributes`)).body, []);
}));

test("invalid configured defaults stop the app at start-up", () => {
  assert.throws(() => createApp(openDb(":memory:"), { jwtSecret: "s", defaultAttributes: [{ name: "X", type: "enumeration" }] }));
  assert.throws(() => createApp(openDb(":memory:"), { jwtSecret: "s", defaultAttributes: [{ name: "X", type: "unknown" }] }));
});

test("the shipped default configuration file is valid", async () => {
  const { readFileSync } = await import("node:fs");
  const defaults = JSON.parse(readFileSync(new URL("../config/default-attributes.json", import.meta.url), "utf8"));
  const c = await setup({ defaultAttributes: defaults });
  try {
    const p = (await c.post("/projects", { name: "P" })).body;
    assert.deepEqual((await c.get(`/projects/${p.id}/attributes`)).body.map((d) => d.key), ["priority", "level", "verification"]);
  } finally { c.close(); }
});

test("a new type can be registered without touching the core", async () => {
  registerType({
    name: "boolean",
    label: "Yes / No",
    input: "select",
    optionFields: [],
    validateOptions: () => ({}),
    parse(v) { if (typeof v !== "boolean") throw new ValidationError("value must be true or false"); return v; },
    toStorage: (v) => ({ text: null, number: v ? 1 : 0 }),
    fromStorage: ({ number }) => number === 1,
  });
  assert.ok(getType("boolean"));
  assert.ok(listTypes().some((t) => t.type === "boolean"));
  assert.throws(() => registerType({ name: "boolean", label: "x", input: "text", validateOptions() {}, parse() {}, toStorage() {}, fromStorage() {} }), /already registered/);
  assert.throws(() => registerType({ name: "broken" }), /missing/);

  const c = await setup();
  try {
    const m = await c.module();
    assert.equal((await def(c, m, { name: "Safety relevant", type: "boolean" })).status, 201);
    const o = (await c.post(`/modules/${m.id}/objects`, { heading: "A" })).body;
    assert.deepEqual((await c.put(`/objects/${o.id}/attributes`, { safety_relevant: true })).body.attributes, { safety_relevant: true });
    assert.equal((await c.put(`/objects/${o.id}/attributes`, { safety_relevant: "yes" })).status, 422);
    assert.deepEqual((await c.put(`/objects/${o.id}/attributes`, { safety_relevant: false })).body.attributes, { safety_relevant: false });
  } finally { c.close(); }
});
