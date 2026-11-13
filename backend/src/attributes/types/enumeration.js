import { ValidationError } from "../registry.js";

export default {
  name: "enumeration",
  label: "Enumeration",
  input: "select",
  optionFields: [{ key: "values", label: "Allowed values", kind: "string-list" }],
  validateOptions(o = {}) {
    const values = o.values;
    if (!Array.isArray(values) || values.length === 0) throw new ValidationError("values must be a non-empty list");
    const clean = values.map((v) => {
      if (typeof v !== "string" || v.trim() === "" || v.length > 100) {
        throw new ValidationError("every allowed value must be a non-empty string (max. 100 characters)");
      }
      return v.trim();
    });
    if (new Set(clean).size !== clean.length) throw new ValidationError("allowed values must be unique");
    return { values: clean };
  },
  parse(value, options) {
    if (typeof value !== "string" || !options.values.includes(value)) {
      throw new ValidationError(`value must be one of: ${options.values.join(", ")}`);
    }
    return value;
  },
  toStorage: (v) => ({ text: v, number: null }),
  fromStorage: ({ text }) => text,
};
