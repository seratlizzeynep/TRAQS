import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ATTRIBUTES, LINK_RULES, setup } from "./helpers.js";
import { createApp } from "../src/app.js";
import { openDb } from "../src/db.js";
import { evaluateKinds, normalizeLinkConfig } from "../src/links/rules.js";

// The shipped rules (config/link-rules.json) with the shipped Level attribute.
const withApp = (fn, options = {}) => async () => {
  const c = await setup({ defaultAttributes: DEFAULT_ATTRIBUTES, ...options });
  try {
    const p = (await c.post("/projects", { name: "P" })).body;
    const m = (await c.post(`/projects/${p.id}/modules`, { name: "M" })).body;
    await fn(c, m);
  } finally { c.close(); }
};
// an object of a given kind (its Level)
const obj = (c, m, level, heading = level) =>
  c.post(`/modules/${m.id}/objects`, { heading, attributes: level ? { level } : {} }).then((r) => r.body);
const link = (c, from, to, type) => c.post(`/objects/${from.id}/links`, { target_id: to.id, type });

const CASES = [
  // [type, from, to, expected status code]
  ["Derives", "UR", "SR", 201], ["Derives", "SR", "SW", 201],
  ["Derives", "SW", "SR", 422], ["Derives", "SR", "UR", 422], ["Derives", "UR", "UR", 422], ["Derives", "TC", "SR", 422], ["Derives", "SR", "TC", 422], ["Derives", "DI", "SR", 422],
  ["Satisfies", "SW", "SR", 201], ["Satisfies", "SR", "UR", 201], ["Satisfies", "DI", "UR", 201], ["Satisfies", "DI", "SR", 201], ["Satisfies", "DI", "SW", 201],
  ["Satisfies", "SR", "SW", 422], ["Satisfies", "UR", "SR", 422], ["Satisfies", "SW", "UR", 422], ["Satisfies", "TC", "SR", 422], ["Satisfies", "DI", "DI", 422], ["Satisfies", "DI", "TC", 422],
  ["Verifies", "TC", "UR", 201], ["Verifies", "TC", "SR", 201], ["Verifies", "TC", "SW", 201],
  ["Verifies", "SR", "SW", 422], ["Verifies", "SW", "TC", 422], ["Verifies", "TC", "TC", 422], ["Verifies", "DI", "SR", 422], ["Verifies", "UR", "SR", 422], ["Verifies", "TC", "DI", 422],
  ["Refers", "UR", "SW", 201], ["Refers", "TC", "TC", 201], ["Refers", "DI", "UR", 201], ["Refers", "SW", "UR", 201], ["Refers", "TC", "DI", 201],
];

test("the rule table of the requirement: every kind combination is allowed or refused", withApp(async (c, m) => {
  for (const [type, from, to, expected] of CASES) {
    const a = await obj(c, m, from, `${from} source`);
    const b = await obj(c, m, to, `${to} target`);
    const r = await link(c, a, b, type);
    assert.equal(r.status, expected, `${type} ${from} -> ${to}: ${JSON.stringify(r.body)}`);
  }
}));

test("a refused link names the violated rule and what is allowed", withApp(async (c, m) => {
  const tc = await obj(c, m, "TC");
  const sr = await obj(c, m, "SR");
  const r = await link(c, sr, tc, "Verifies");
  assert.equal(r.status, 422);
  assert.match(r.body.detail, /Link rule 'Verifies'/);
  assert.match(r.body.detail, /SR to TC is not allowed/);
  assert.match(r.body.detail, /Allowed: TC to requirement/);
  assert.match(r.body.detail, /Only a test case \(TC\) can verify a requirement/); // the rule's own description
  assert.deepEqual((await c.get(`/objects/${sr.id}/links`)).body, []); // nothing was created
}));

test("Derives that skips a level is allowed, but reported as a gap", withApp(async (c, m) => {
  const ur = await obj(c, m, "UR");
  const sw = await obj(c, m, "SW");
  const r = await link(c, ur, sw, "Derives");
  assert.equal(r.status, 201);
  assert.equal(r.body.rule.status, "gap");
  assert.match(r.body.rule.message, /skips SR/);
  // listed with the links of the object and in the issues of the project
  assert.equal((await c.get(`/objects/${ur.id}/links`)).body[0].rule.status, "gap");
  const issues = (await c.get(`/projects/${m.project_id}/link-issues`)).body;
  assert.equal(issues.length, 1);
  assert.equal(issues[0].id, r.body.id);
  // a regular step is no gap
  const sr = await obj(c, m, "SR");
  assert.equal((await link(c, ur, sr, "Derives")).body.rule.status, "ok");
  assert.equal((await c.get(`/projects/${m.project_id}/link-issues`)).body.length, 1);
}));

test("Derives links must not form a cycle", async () => {
  // with the shipped levels a cycle is impossible by the kinds alone, so use a rule set that allows the same level
  const rules = { ...LINK_RULES, rules: { ...LINK_RULES.rules, Derives: { ...LINK_RULES.rules.Derives, allow: [["*", "*"]] } } };
  const c = await setup({ defaultAttributes: DEFAULT_ATTRIBUTES, linkRules: rules });
  try {
    const p = (await c.post("/projects", { name: "P" })).body;
    const m = (await c.post(`/projects/${p.id}/modules`, { name: "M" })).body;
    const [a, b, d] = [await obj(c, m, "SR", "A"), await obj(c, m, "SR", "B"), await obj(c, m, "SR", "C")];
    assert.equal((await link(c, a, b, "Derives")).status, 201);
    assert.equal((await link(c, b, d, "Derives")).status, 201);
    const back = await link(c, d, a, "Derives"); // closes A -> B -> C -> A
    assert.equal(back.status, 422);
    assert.match(back.body.detail, /cycle/);
    assert.equal((await link(c, b, a, "Derives")).status, 422); // direct back link
    assert.equal((await link(c, a, d, "Derives")).status, 201); // a shortcut is no cycle
    assert.equal((await link(c, d, a, "Refers")).status, 201); // other types are not part of the check
  } finally { c.close(); }
});

test("links never leave the project and never point to the object itself (rules come on top)", withApp(async (c, m) => {
  const other = (await c.post("/projects", { name: "Other" })).body;
  const m2 = (await c.post(`/projects/${other.id}/modules`, { name: "M2" })).body;
  const a = await obj(c, m, "UR");
  const foreign = await obj(c, m2, "SR");
  assert.equal((await link(c, a, foreign, "Derives")).status, 422);
  assert.equal((await link(c, a, a, "Refers")).status, 422);
}));

test("objects without a Level: rules that need it refuse the link, Refers does not", withApp(async (c, m) => {
  const none = await obj(c, m, null, "No level");
  const sr = await obj(c, m, "SR");
  const r = await link(c, sr, none, "Derives");
  assert.equal(r.status, 422);
  assert.match(r.body.detail, /the 'level' of both objects must be set/);
  assert.match(r.body.detail, /target: not set/);
  assert.equal((await link(c, none, sr, "Verifies")).status, 422);
  assert.equal((await link(c, none, sr, "Refers")).status, 201);
}));

test("without a Level attribute in the project only Refers works", async () => {
  const c = await setup(); // no default attributes: the project has no Level
  try {
    const m = await c.module();
    const a = await c.add(m, "A");
    const b = await c.add(m, "B");
    assert.equal((await link(c, a, b, "Derives")).status, 422);
    assert.equal((await link(c, a, b, "Refers")).status, 201);
  } finally { c.close(); }
});

test("when the Level of an object changes later, links that now break the rules are reported", withApp(async (c, m) => {
  const ur = await obj(c, m, "UR");
  const sr = await obj(c, m, "SR");
  const l = (await link(c, ur, sr, "Derives")).body;
  assert.equal((await c.get(`/projects/${m.project_id}/link-issues`)).body.length, 0);
  await c.put(`/objects/${sr.id}/attributes`, { level: "TC" }); // the SR became a test case
  const issues = (await c.get(`/projects/${m.project_id}/link-issues`)).body;
  assert.equal(issues.length, 1);
  assert.equal(issues[0].id, l.id);
  assert.equal(issues[0].rule.status, "violation");
  assert.match(issues[0].rule.message, /UR to TC is not allowed/);
  assert.equal((await c.get(`/objects/${ur.id}/links`)).body[0].rule.status, "violation");
}));

test("link issues need read access and stay inside the project", withApp(async (c, m) => {
  const other = (await c.post("/projects", { name: "Other" })).body;
  const viewer = await c.as({ [m.project_id]: "viewer" });
  assert.equal((await viewer.get(`/projects/${m.project_id}/link-issues`)).status, 200);
  assert.equal((await viewer.get(`/projects/${other.id}/link-issues`)).status, 403);
  assert.equal((await c.withToken(null).get(`/projects/${m.project_id}/link-issues`)).status, 401);
}));

test("GET /link-types tells which rule applies to each type", withApp(async (c) => {
  const types = (await c.get("/link-types")).body;
  const v = types.find((t) => t.name === "Verifies");
  assert.match(v.rule.description, /test case/);
  assert.deepEqual(v.rule.allow, [["TC", "requirement"]]);
  assert.equal(types.find((t) => t.name === "Refers").rule.allow, "any");
}));

test("the rules are configuration, not code", async () => {
  // another rule set: "Implements" from code (CODE) to a requirement (REQ), nothing else
  const rules = {
    kind_attribute: "kind",
    unknown_kind: "refuse",
    groups: { thing: ["REQ", "CODE"] },
    types: [{ name: "Implements", inverse: "Implemented by" }],
    rules: { Implements: { description: "Code implements a requirement.", allow: [["CODE", "REQ"]] } },
  };
  const defaults = [{ name: "Kind", type: "enumeration", options: { values: ["REQ", "CODE"] } }];
  const c = await setup({ linkRules: rules, defaultAttributes: defaults });
  try {
    const p = (await c.post("/projects", { name: "P" })).body;
    const m = (await c.post(`/projects/${p.id}/modules`, { name: "M" })).body;
    const make = (kind) => c.post(`/modules/${m.id}/objects`, { heading: kind, attributes: { kind } }).then((r) => r.body);
    const code = await make("CODE");
    const req = await make("REQ");
    assert.equal((await link(c, code, req, "Implements")).status, 201);
    const bad = await link(c, req, code, "Implements");
    assert.equal(bad.status, 422);
    assert.match(bad.body.detail, /Code implements a requirement/);
    assert.equal((await link(c, code, req, "Derives")).status, 422); // not a configured type here
  } finally { c.close(); }
});

test("'unknown_kind: allow' lets links without a kind through", async () => {
  const c = await setup({ linkRules: { ...LINK_RULES, unknown_kind: "allow" }, defaultAttributes: DEFAULT_ATTRIBUTES });
  try {
    const p = (await c.post("/projects", { name: "P" })).body;
    const m = (await c.post(`/projects/${p.id}/modules`, { name: "M" })).body;
    const a = await obj(c, m, null, "A");
    const b = await obj(c, m, null, "B");
    assert.equal((await link(c, a, b, "Derives")).status, 201);
    const sr = await obj(c, m, "SR");
    assert.equal((await link(c, sr, a, "Verifies")).status, 201); // only unknown kinds are let through
  } finally { c.close(); }
});

test("rule evaluation as a pure function", () => {
  const cfg = normalizeLinkConfig(LINK_RULES);
  assert.equal(evaluateKinds(cfg, "Derives", "UR", "SR").status, "ok");
  assert.equal(evaluateKinds(cfg, "Derives", "UR", "SW").status, "gap");
  assert.equal(evaluateKinds(cfg, "Derives", "SW", "UR").status, "violation"); // upwards is not a skip
  assert.equal(evaluateKinds(cfg, "Unknown", "UR", "SR").status, "ok"); // a type without a rule is unrestricted
  assert.equal(evaluateKinds(cfg, "Verifies", undefined, "SR").status, "violation");
});

test("invalid rule configuration stops the app at start-up", () => {
  const start = (linkRules) => createApp(openDb(":memory:"), { jwtSecret: "s", linkRules });
  const base = { kind_attribute: "level", types: [{ name: "A" }] };
  assert.throws(() => start({ ...base, rules: { B: { allow: "any" } } }), /not a configured link type/);
  assert.throws(() => start({ ...base, rules: { A: { allow: [["X"]] } } }), /pairs/);
  assert.throws(() => start({ ...base, rules: { A: { allow: "some" } } }), /pairs/);
  assert.throws(() => start({ types: [{ name: "A" }], rules: { A: { allow: [["X", "Y"]] } } }), /kind_attribute/);
  assert.throws(() => start({ ...base, rules: { A: { allow: "any", allow_skip_levels: true } } }), /levels/);
  assert.throws(() => start({ ...base, kind_attribute: "Bad Key" }), /kind_attribute/);
  assert.throws(() => start({ ...base, unknown_kind: "maybe" }), /unknown_kind/);
  assert.throws(() => start({ ...base, levels: ["UR", "UR"] }), /unique/);
  assert.throws(() => start({ ...base, groups: { g: "UR" } }), /group/);
  assert.doesNotThrow(() => start({ ...base, rules: { A: { allow: [["X", "Y"]] } } }));
  assert.doesNotThrow(() => start(LINK_RULES));
});

test("rule texts can be given per language and are served with the types", async () => {
  const c = await setup();
  try {
    const verifies = (await c.get("/link-types")).body.find((t) => t.name === "Verifies");
    assert.match(verifies.rule.description, /test case/); // default text
    assert.match(verifies.rule.descriptions.tr, /test senaryosu/); // Turkish text of the shipped file
  } finally { c.close(); }
  const start = (rules) => createApp(openDb(":memory:"), { jwtSecret: "s", linkRules: { kind_attribute: "level", types: [{ name: "A" }], rules } });
  assert.throws(() => start({ A: { allow: "any", descriptions: "tr" } }), /descriptions/);
  assert.throws(() => start({ A: { allow: "any", descriptions: { tr: 5 } } }), /descriptions/);
  assert.doesNotThrow(() => start({ A: { allow: "any", descriptions: { tr: "metin" } } }));
});
