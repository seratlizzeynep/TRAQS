import { ValidationError } from "../registry.js";

// Calendar date as YYYY-MM-DD.
export default {
  name: "date",
  label: "Date",
  input: "date",
  optionFields: [],
  validateOptions: () => ({}),
  parse(value) {
    const m = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
    if (!m) throw new ValidationError("value must be a date in the form YYYY-MM-DD");
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) {
      throw new ValidationError("value is not a valid calendar date");
    }
    return value;
  },
  toStorage: (v) => ({ text: v, number: null }),
  fromStorage: ({ text }) => text,
};
