import { useState } from "react";
import { useParams } from "react-router-dom";
import { del, patch, post, put } from "../api.js";
import { useAuth } from "../auth.jsx";
import OptionFields, { initialOptions, summarize, toOptions } from "../attributes/OptionFields.jsx";
import { useAttributes } from "../attributes/useAttributes.js";
import { useI18n } from "../i18n.jsx";
import { can, roleIn } from "../permissions.js";

// Attribute definition screen (SW-05 / UC2). The type list and the option form come from the server,
// so attribute types added on the server show up here without changes.
export default function Attributes() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { projectId } = useParams();
  const { types, definitions, loading, reload } = useAttributes(projectId);
  const writable = can(roleIn(user, projectId), "write");

  const [message, setMessage] = useState(null); // { kind, text }
  const [form, setForm] = useState({ name: "", description: "", type: "", options: {} });
  const [editing, setEditing] = useState(null); // { id, name, description, options }

  const type = types.find((x) => x.type === (form.type || types[0]?.type));
  const fieldsOf = (typeName) => types.find((x) => x.type === typeName)?.option_fields ?? [];
  const typeLabel = (x) => t(`attrtype.${x.type}`, x.label);

  const run = async (fn) => {
    setMessage(null);
    try {
      await fn();
      await reload();
      return true;
    } catch (e) {
      setMessage({ kind: "error", text: `${t("attr.invalid")} ${e.message}` });
      return false;
    }
  };

  const create = async (e) => {
    e.preventDefault();
    const ok = await run(() =>
      post(`/projects/${projectId}/attributes`, {
        name: form.name,
        description: form.description,
        type: type.type,
        options: toOptions(type.option_fields, form.options),
      })
    );
    if (ok) setForm({ name: "", description: "", type: form.type, options: {} });
  };
  const save = async (e) => {
    e.preventDefault();
    const d = definitions.find((x) => x.id === editing.id);
    const ok = await run(() =>
      patch(`/attributes/${d.id}`, { name: editing.name, description: editing.description, options: toOptions(fieldsOf(d.type), editing.options) })
    );
    if (ok) setEditing(null);
  };
  const move = (index, delta) => {
    const ids = definitions.map((d) => d.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    run(() => put(`/projects/${projectId}/attributes/order`, { ids }));
  };
  const remove = (d) => {
    if (window.confirm(`${d.name}\n\n${t("attr.confirmDelete")}`)) run(() => del(`/attributes/${d.id}`));
  };

  if (!can(roleIn(user, projectId), "read")) return null;
  return (
    <section>
      <h1 className="screen-title">{t("attr.title")}</h1>
      {message && <p role="alert" className="error">{message.text}</p>}

      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              {["attr.name", "attr.key", "attr.type", "attr.options"].map((k) => <th key={k} scope="col">{t(k)}</th>)}
              {writable && <th scope="col"><span className="sr-only">{t("admin.actions")}</span></th>}
            </tr>
          </thead>
          <tbody>
            {definitions.length === 0 && <tr className="empty-row"><td colSpan={writable ? 5 : 4}>{loading ? t("common.loading") : t("attr.empty")}</td></tr>}
            {definitions.map((d, i) => {
              const tp = types.find((x) => x.type === d.type);
              return (
                <tr key={d.id}>
                  <td><strong>{d.name}</strong>{d.description && <div className="muted">{d.description}</div>}</td>
                  <td><code>{d.key}</code></td>
                  <td>{tp ? typeLabel(tp) : d.type}</td>
                  <td>{summarize(d, tp?.option_fields ?? [], t) || <span className="muted">—</span>}</td>
                  {writable && (
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button key="up" type="button" disabled={i === 0} aria-label={`${t("attr.moveUp")} ${d.name}`} title={t("attr.moveUp")} onClick={() => move(i, -1)}>↑</button>{" "}
                      <button key="down" type="button" disabled={i === definitions.length - 1} aria-label={`${t("attr.moveDown")} ${d.name}`} title={t("attr.moveDown")} onClick={() => move(i, 1)}>↓</button>{" "}
                      <button key="edit" type="button" aria-label={`${t("common.edit")} ${d.name}`} title={t("common.edit")}
                        onClick={() => setEditing({ id: d.id, name: d.name, description: d.description, options: initialOptions(tp?.option_fields ?? [], d.options) })}>✎</button>{" "}
                      <button key="delete" type="button" className="danger" aria-label={`${t("modules.delete")} ${d.name}`} title={t("modules.delete")} onClick={() => remove(d)}>✕</button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {writable && editing && (
        <form onSubmit={save} className="card form-grid" aria-label={t("attr.editing")}>
          <h2>{t("attr.editing")}</h2>
          <label><span>{t("attr.name")}</span><input value={editing.name} required onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
          <label><span>{t("attr.description")}</span><input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></label>
          <OptionFields fields={fieldsOf(definitions.find((d) => d.id === editing.id)?.type)} value={editing.options} onChange={(options) => setEditing({ ...editing, options })} />
          <p className="muted">{t("attr.typeFixed")}</p>
          <div className="toolbar">
            <button className="primary" type="submit">{t("common.save")}</button>
            <button type="button" onClick={() => setEditing(null)}>{t("common.cancel")}</button>
          </div>
        </form>
      )}

      {writable && !editing && type && (
        <form onSubmit={create} className="card form-grid" aria-label={t("attr.new")}>
          <h2>{t("attr.new")}</h2>
          <label><span>{t("attr.name")}</span><input value={form.name} required onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label><span>{t("attr.description")}</span><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <label>
            <span>{t("attr.type")}</span>
            <select value={type.type} onChange={(e) => setForm({ ...form, type: e.target.value, options: {} })}>
              {types.map((x) => <option key={x.type} value={x.type}>{typeLabel(x)}</option>)}
            </select>
          </label>
          <OptionFields fields={type.option_fields} value={{ ...initialOptions(type.option_fields), ...form.options }} onChange={(options) => setForm({ ...form, options })} />
          <div className="toolbar">
            <button className="primary" type="submit">{t("attr.create")}</button>
            <button type="button" onClick={() => run(() => post(`/projects/${projectId}/attributes/defaults`))}>{t("attr.addDefaults")}</button>
          </div>
        </form>
      )}
    </section>
  );
}
