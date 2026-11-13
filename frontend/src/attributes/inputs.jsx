// Value inputs for attributes. A type tells the UI which generic input to use (its `input` field);
// this registry maps such an input kind to the code that shows, edits and parses a value.
// A new kind is one more entry (see registerInput); types of an existing kind need no UI code at all.
//
//   Display({ def, value })                     read-only rendering
//   Editor({ def, value, onChange, label })     value is the "raw" form (a string); onChange(raw)
//   initial(value)  -> raw       parse(raw) -> typed value or null (null clears the value)

const kinds = {
  text: {
    Display: ({ value }) => <>{value}</>,
    Editor: ({ value, onChange, label, def }) => (
      <input aria-label={label} value={value} maxLength={def.options?.max_length} onChange={(e) => onChange(e.target.value)} />
    ),
    initial: (v) => v ?? "",
    parse: (raw) => (raw === "" ? null : raw),
  },
  number: {
    Display: ({ def, value }) => <>{value}{def.options?.unit ? ` ${def.options.unit}` : ""}</>,
    Editor: ({ value, onChange, label, def }) => (
      <input type="number" aria-label={label} value={value} min={def.options?.min} max={def.options?.max}
        step={def.options?.integer ? 1 : "any"} onChange={(e) => onChange(e.target.value)} />
    ),
    initial: (v) => (v === null || v === undefined ? "" : String(v)),
    parse: (raw) => (raw === "" ? null : Number(raw)),
  },
  select: {
    Display: ({ value }) => <>{value}</>,
    Editor: ({ value, onChange, label, def }) => (
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {(def.options?.values ?? []).map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    ),
    initial: (v) => v ?? "",
    parse: (raw) => (raw === "" ? null : raw),
  },
  date: {
    Display: ({ value }) => <>{value}</>,
    Editor: ({ value, onChange, label }) => <input type="date" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />,
    initial: (v) => v ?? "",
    parse: (raw) => (raw === "" ? null : raw),
  },
};

export const registerInput = (kind, impl) => { kinds[kind] = impl; };

// The input implementation for a definition; unknown kinds fall back to plain text.
export const inputFor = (def, types) => kinds[types.find((t) => t.type === def.type)?.input] ?? kinds.text;

export function ValueDisplay({ def, types, value }) {
  if (value === undefined || value === null || value === "") return <span className="muted">—</span>;
  const { Display } = inputFor(def, types);
  return <Display def={def} value={value} />;
}
