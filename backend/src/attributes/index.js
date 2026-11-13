import date from "./types/date.js";
import enumeration from "./types/enumeration.js";
import number from "./types/number.js";
import text from "./types/text.js";
import { registerType } from "./registry.js";

// Built-in types. Further types can be registered with registerType() before the app starts.
for (const t of [text, enumeration, number, date]) registerType(t);

export { ValidationError, getType, listTypes, registerType } from "./registry.js";
