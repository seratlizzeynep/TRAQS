// Attribute type registry. Every attribute type is a small module that describes itself and knows how
// to validate and store its values. Adding a type means registering one more module; nothing else changes.
//
// A type module exports:
//   name          unique id, e.g. "number"
//   label         human readable name
//   input         which generic input the UI uses for values: "text" | "number" | "select" | "date"
//   optionFields  [{ key, label, kind }] describing the options of a definition; kind is one of
//                 "integer" | "number" | "boolean" | "string" | "string-list" (the UI builds the form from this)
//   validateOptions(options) -> normalized options          (throws ValidationError)
//   parse(value, options)    -> canonical value             (throws ValidationError)
//   toStorage(value)         -> { text, number }            (what goes into the value columns)
//   fromStorage({ text, number }) -> value

export class ValidationError extends Error {}

const types = new Map();

export function registerType(type) {
  for (const f of ["name", "label", "input", "validateOptions", "parse", "toStorage", "fromStorage"]) {
    if (!type?.[f]) throw new Error(`attribute type is missing '${f}'`);
  }
  if (types.has(type.name)) throw new Error(`attribute type '${type.name}' is already registered`);
  types.set(type.name, { optionFields: [], ...type });
}

export const getType = (name) => types.get(name);

// Description of the registered types, as served by GET /attribute-types.
export const listTypes = () =>
  [...types.values()].map(({ name, label, input, optionFields }) => ({ type: name, label, input, option_fields: optionFields }));
