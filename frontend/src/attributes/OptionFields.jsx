import { useI18n } from "../i18n.jsx";

// Builds the option form of an attribute type from the field descriptions the server sends
// (type.option_fields), so a new type needs no UI code. `value` holds the raw form values.
const EMPTY = { integer: "", number: "", string: "", boolean: false, "string-list": "" };

export const initialOptions = (fields, options = {}) =>
  Object.fromEntries(
    fields.map((f) => {
      const v = options[f.key];
      if (f.kind === "string-list") return [f.key, Array.isArray(v) ? v.join("\n") : ""];
      if (f.kind === "boolean") return [f.key, v === true];
      return [f.key, v === undefined || v === null ? EMPTY[f.kind] : String(v)];
    })
  );

// Raw form values -> the options object for the API (empty fields are left out).
export function toOptions(fields, raw) {
  const out = {};
  for (const f of fields) {
    const v = raw[f.key];
    if (f.kind === "string-list") {
      const list = String(v ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
      if (list.length) out[f.key] = list;
    } else if (f.kind === "boolean") {
      if (v) out[f.key] = true;
    } else if (v !== "" && v !== undefined) {
      out[f.key] = f.kind === "integer" || f.kind === "number" ? Number(v) : v;
    }
  }
  return out;
}

export default function OptionFields({ fields, value, onChange }) {
  const { t } = useI18n();
  return fields.map((f) => {
    const label = t(`attropt.${f.key}`, f.label);
    const set = (v) => onChange({ ...value, [f.key]: v });
    return (
      <label key={f.key} className="opt">
        {f.kind === "boolean" ? (
          <>
            <input type="checkbox" checked={!!value[f.key]} onChange={(e) => set(e.target.checked)} /> {label}
          </>
        ) : f.kind === "string-list" ? (
          <>
            <span>{label}</span>
            <textarea rows={3} value={value[f.key] ?? ""} onChange={(e) => set(e.target.value)} />
          </>
        ) : (
          <>
            <span>{label}</span>
            <input type={f.kind === "integer" || f.kind === "number" ? "number" : "text"} step={f.kind === "integer" ? 1 : "any"}
              value={value[f.key] ?? ""} onChange={(e) => set(e.target.value)} />
          </>
        )}
      </label>
    );
  });
}

// Short text for the options column of the definition table.
export function summarize(def, fields, t) {
  return fields
    .map((f) => {
      const v = def.options?.[f.key];
      if (v === undefined || v === null || v === false) return null;
      const label = t(`attropt.${f.key}`, f.label).replace(/ \(.*\)$/, "");
      return f.kind === "string-list" ? v.join(", ") : f.kind === "boolean" ? label : `${label}: ${v}`;
    })
    .filter(Boolean)
    .join(" · ");
}
