import { ValidationError } from "../registry.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

export default {
  name: "number",
  label: "Number",
  input: "number",
  optionFields: [
    { key: "integer", label: "Whole numbers only", kind: "boolean" },
    { key: "min", label: "Minimum", kind: "number" },
    { key: "max", label: "Maximum", kind: "number" },
    { key: "unit", label: "Unit", kind: "string" },
  ],
  validateOptions(o = {}) {
    const out = {};
    if (o.integer !== undefined && o.integer !== null) {
      if (typeof o.integer !== "boolean") throw new ValidationError("integer must be true or false");
      out.integer = o.integer;
    }
    for (const k of ["min", "max"]) {
      if (o[k] !== undefined && o[k] !== null) {
        if (!isNum(o[k])) throw new ValidationError(`${k} must be a number`);
        out[k] = o[k];
      }
    }
    if (out.min !== undefined && out.max !== undefined && out.min > out.max) {
      throw new ValidationError("min must not be greater than max");
    }
    if (o.unit !== undefined && o.unit !== null && o.unit !== "") {
      if (typeof o.unit !== "string" || o.unit.length > 20) throw new ValidationError("unit must be a short string");
      out.unit = o.unit;
    }
    return out;
  },
  parse(value, options) {
    if (!isNum(value)) throw new ValidationError("value must be a number");
    if (options.integer && !Number.isInteger(value)) throw new ValidationError("value must be a whole number");
    if (options.min !== undefined && value < options.min) throw new ValidationError(`value must be at least ${options.min}`);
    if (options.max !== undefined && value > options.max) throw new ValidationError(`value must be at most ${options.max}`);
    return value;
  },
  toStorage: (v) => ({ text: null, number: v }),
  fromStorage: ({ number }) => number,
};
