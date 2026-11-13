// Link rules. Everything that decides which links are allowed lives in ONE configuration file
// (config/link-rules.json); this module only reads and applies it.
//
//   kind_attribute   key of the attribute that tells what kind an object is (e.g. "level": UR, SR, SW, DI, TC)
//   levels           the requirement levels, from top to bottom (used to report skipped levels)
//   groups           names for sets of kinds, usable in rules ("requirement": ["UR", "SR", "SW"])
//   unknown_kind     what to do when a rule needs the kind of an object that has none: "refuse" | "allow"
//   types            the link types: { name, inverse, description, informative }
//   rules            per link type: { description, allow, allow_skip_levels, acyclic }
//                    allow is "any" or a list of [from, to] pairs; each side is a kind, a group or "*"

const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
const isStr = (v) => typeof v === "string" && v.trim() !== "";

export function normalizeLinkTypes(list) {
  if (!Array.isArray(list)) throw new Error("link types must be a list");
  const seen = new Set();
  return list.map((t) => {
    if (typeof t?.name !== "string" || t.name.trim() === "" || t.name.length > 30) throw new Error("every link type needs a name (max. 30 characters)");
    const name = t.name.trim();
    if (seen.has(name.toLowerCase())) throw new Error(`link type '${name}' is defined twice`);
    seen.add(name.toLowerCase());
    for (const k of ["inverse", "description"]) {
      if (t[k] !== undefined && typeof t[k] !== "string") throw new Error(`link type '${name}': ${k} must be a string`);
    }
    return { name, inverse: t.inverse?.trim() || name, description: t.description ?? "", informative: t.informative === true };
  });
}

export function normalizeLinkConfig(raw = {}) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("the link configuration must be an object");
  const types = normalizeLinkTypes(raw.types ?? []);
  const names = new Set(types.map((t) => t.name));

  const kindAttribute = raw.kind_attribute ?? null;
  if (kindAttribute !== null && !KEY_RE.test(kindAttribute)) throw new Error("kind_attribute must be an attribute key such as 'level'");

  const levels = raw.levels ?? [];
  if (!Array.isArray(levels) || !levels.every(isStr) || new Set(levels).size !== levels.length) throw new Error("levels must be a list of unique names");

  const groups = raw.groups ?? {};
  if (typeof groups !== "object" || Array.isArray(groups) || groups === null) throw new Error("groups must be an object");
  for (const [g, kinds] of Object.entries(groups)) {
    if (!Array.isArray(kinds) || !kinds.every(isStr)) throw new Error(`group '${g}' must be a list of kinds`);
  }

  const unknownKind = raw.unknown_kind ?? "refuse";
  if (unknownKind !== "refuse" && unknownKind !== "allow") throw new Error("unknown_kind must be 'refuse' or 'allow'");

  const rules = {};
  for (const [type, r] of Object.entries(raw.rules ?? {})) {
    if (!names.has(type)) throw new Error(`rule for '${type}', which is not a configured link type`);
    if (r === null || typeof r !== "object") throw new Error(`rule '${type}' must be an object`);
    const allow = r.allow ?? "any";
    if (allow !== "any") {
      if (!Array.isArray(allow) || !allow.every((p) => Array.isArray(p) && p.length === 2 && p.every(isStr))) {
        throw new Error(`rule '${type}': allow must be "any" or a list of [from, to] pairs`);
      }
      if (!kindAttribute) throw new Error(`rule '${type}' needs a kind_attribute`);
    }
    if (r.allow_skip_levels && levels.length === 0) throw new Error(`rule '${type}': allow_skip_levels needs levels`);
    rules[type] = { description: r.description ?? "", allow, allow_skip_levels: r.allow_skip_levels === true, acyclic: r.acyclic === true };
  }
  return { kind_attribute: kindAttribute, levels, groups, unknown_kind: unknownKind, types, rules };
}

const OK = { status: "ok", message: "" };

// Applies the rules to the kinds of two objects: { status: "ok" | "gap" | "violation", message }.
export function evaluateKinds(config, type, sourceKind, targetKind) {
  const rule = config.rules[type];
  if (!rule || rule.allow === "any") return OK;

  const attr = config.kind_attribute;
  if (!sourceKind || !targetKind) {
    if (config.unknown_kind === "allow") return OK;
    return {
      status: "violation",
      message: `Link rule '${type}': the '${attr}' of both objects must be set (source: ${sourceKind ?? "not set"}, target: ${targetKind ?? "not set"}). ${rule.description}`.trim(),
    };
  }

  const match = (spec, kind) => spec === "*" || spec === kind || (config.groups[spec]?.includes(kind) ?? false);
  if (rule.allow.some(([from, to]) => match(from, sourceKind) && match(to, targetKind))) return OK;

  if (rule.allow_skip_levels) {
    const i = config.levels.indexOf(sourceKind);
    const j = config.levels.indexOf(targetKind);
    if (i >= 0 && j > i + 1) {
      return { status: "gap", message: `Link rule '${type}': this link skips ${config.levels.slice(i + 1, j).join(", ")} (${sourceKind} to ${targetKind}).` };
    }
  }
  const allowed = rule.allow.map(([f, t]) => `${f} to ${t}`).join(", ");
  return {
    status: "violation",
    message: `Link rule '${type}': ${sourceKind} to ${targetKind} is not allowed. Allowed: ${allowed}. ${rule.description}`.trim(),
  };
}
