import { ValidationError } from "../registry.js";

export default {
  name: "text",
  label: "Text",
  input: "text",
  optionFields: [{ key: "max_length", label: "Maximum length", kind: "integer" }],
  validateOptions(o = {}) {
    const out = {};
    if (o.max_length !== undefined && o.max_length !== null) {
      if (!Number.isInteger(o.max_length) || o.max_length < 1 || o.max_length > 100000) {
        throw new ValidationError("max_length must be an integer between 1 and 100000");
      }
      out.max_length = o.max_length;
    }
    return out;
  },
  parse(value, options) {
    if (typeof value !== "string") throw new ValidationError("value must be a string");
    if (options.max_length && value.length > options.max_length) {
      throw new ValidationError(`value is longer than ${options.max_length} characters`);
    }
    return value;
  },
  toStorage: (v) => ({ text: v, number: null }),
  fromStorage: ({ text }) => text,
};
