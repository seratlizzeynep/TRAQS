import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { del, get, patch, post, put } from "../api.js";
import { inputFor, ValueDisplay } from "../attributes/inputs.jsx";
import { useAttributes } from "../attributes/useAttributes.js";
import { dropTarget } from "../dnd.js";
import { useAuth } from "../auth.jsx";
import { useI18n } from "../i18n.jsx";
import { can, roleIn } from "../permissions.js";

// Keeps a node if it or any descendant matches the search text.
export function filterTree(nodes, q) {
  if (!q) return nodes;
  const needle = q.toLowerCase();
  return nodes.flatMap((n) => {
    const kids = filterTree(n.children, q);
    const hit = `${n.display_id} ${n.heading} ${n.text}`.toLowerCase().includes(needle);
    return hit || kids.length ? [{ ...n, children: hit ? n.children : kids }] : [];
  });
}

// Outline numbers (1, 1.1, 1.2, 2, ...) computed on the full tree so they stay stable while filtering.
export function outlineNumbers(nodes, prefix = "", map = new Map()) {
  nodes.forEach((n, i) => {
    const num = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
    map.set(n.id, num);
    outlineNumbers(n.children, num, map);
  });
  return map;
}

// Visible rows in display order; children of collapsed nodes are skipped.
export function visibleRows(nodes, collapsed, depth = 0, out = []) {
  for (const node of nodes) {
    out.push({ node, depth });
    if (node.children.length && !collapsed.has(node.id)) visibleRows(node.children, collapsed, depth + 1, out);
  }
  return out;
}

// Where on a row the pointer is: top quarter = before, bottom quarter = after, middle = as child.
export function zoneOf(clientY, rect) {
  if (!rect || !rect.height) return "child";
  const r = (clientY - rect.top) / rect.height;
  return r < 0.25 ? "before" : r > 0.75 ? "after" : "child";
}

function ModuleTable({ module, tree, q, writable, definitions, types, onChanged, onError }) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(new Set());
  const [adding, setAdding] = useState(false);
  const [heading, setHeading] = useState("");
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(null); // { id, heading, text }
  const [dragId, setDragId] = useState(null);
  const [hover, setHover] = useState(null); // { id, zone }
  const numbers = useMemo(() => outlineNumbers(tree), [tree]);
  const rows = visibleRows(filterTree(tree, q), collapsed);

  const toggle = (id) => {
    const next = new Set(collapsed);
    next.has(id) ? next.delete(id) : next.add(id);
    setCollapsed(next);
  };
  const add = async (e) => {
    e.preventDefault();
    await post(`/modules/${module.id}/objects`, { heading, text }).catch(onError);
    setHeading("");
    setText("");
    setAdding(false);
    onChanged();
  };
  const endDrag = () => { setDragId(null); setHover(null); };
  const onDrop = async (e, targetId) => {
    e.preventDefault();
    const zone = zoneOf(e.clientY, e.currentTarget.getBoundingClientRect());
    const move = dragId === null ? null : dropTarget(tree, dragId, targetId, zone);
    const id = dragId;
    endDrag();
    if (!move) return;
    await post(`/objects/${id}/move`, move).catch(onError);
    onChanged();
  };
  const save = async (e) => {
    e.preventDefault();
    const { id, heading: h, text: tx, attrs, original } = editing;
    await patch(`/objects/${id}`, { heading: h, text: tx }).catch(onError);
    // only attributes that were changed are sent; "" clears a value
    const changed = {};
    for (const d of definitions) {
      if (attrs[d.key] !== original[d.key]) changed[d.key] = inputFor(d, types).parse(attrs[d.key]);
    }
    if (Object.keys(changed).length) await put(`/objects/${id}/attributes`, changed).catch(onError);
    setEditing(null);
    onChanged();
  };
  const startEdit = (node) => {
    const raw = Object.fromEntries(definitions.map((d) => [d.key, inputFor(d, types).initial(node.attributes?.[d.key])]));
    setEditing({ id: node.id, heading: node.heading, text: node.text, attrs: raw, original: raw });
  };
  const onEditKey = (e) => e.key === "Escape" && setEditing(null);
  const remove = async (node) => {
    if (!window.confirm(`${node.display_id} ${node.heading}\n\n${t("modules.confirmDelete")}`)) return;
    await del(`/objects/${node.id}`).catch(onError);
    onChanged();
  };
  const unavailable = { "aria-disabled": true, title: t("common.unavailable"), onClick: (e) => e.preventDefault() };

  return (
    <article>
      <h2 className="screen-title">
        <span>S3 · {t("modules.module")}: {module.name}</span>
        <span className="badge tag">{t("modules.view")}</span>
      </h2>
      <div className="toolbar">
        {writable && (
          <button type="button" aria-expanded={adding} onClick={() => setAdding(!adding)}>{t("modules.addObjectBtn")}</button>
        )}
        <button type="button" {...unavailable}>{t("modules.filter")} ▾</button>
        <button type="button" {...unavailable}>{t("modules.columns")} ▾</button>
        <button type="button" {...unavailable}>{t("modules.import")}</button>
        <button type="button" {...unavailable}>{t("modules.export")}</button>
      </div>
      {writable && adding && (
        <form onSubmit={add} className="inline-form">
          <input aria-label={t("modules.objectHeading")} placeholder={t("modules.objectHeading")} value={heading} onChange={(e) => setHeading(e.target.value)} autoFocus />
          <input aria-label={t("modules.objectText")} placeholder={t("modules.objectText")} value={text} onChange={(e) => setText(e.target.value)} style={{ flexBasis: "24rem" }} />
          <button className="primary" type="submit">{t("modules.addObject")}</button>
        </form>
      )}
      {writable && <form id="edit-object" onSubmit={save} />}
      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              {["col.tree", "col.id", "col.text"].map((k) => <th key={k} scope="col">{t(k)}</th>)}
              {definitions.map((d) => <th key={`attr-${d.id}`} scope="col">{d.name}</th>)}
              {["col.status", "col.flags"].map((k) => <th key={k} scope="col">{t(k)}</th>)}
              {writable && <th scope="col"><span className="sr-only">{t("admin.actions")}</span></th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr className="empty-row"><td colSpan={(writable ? 6 : 5) + definitions.length}>{t("modules.noObjects")}</td></tr>
            )}
            {rows.map(({ node, depth }) => {
              const has = node.children.length > 0;
              const open = !collapsed.has(node.id);
              return (
                <tr
                  key={node.id}
                  draggable={writable && editing?.id !== node.id}
                  className={hover?.id === node.id ? `drop-${hover.zone}` : undefined}
                  onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(node.id)); setDragId(node.id); }}
                  onDragOver={(e) => {
                    if (dragId === null || dragId === node.id) return;
                    e.preventDefault();
                    const zone = zoneOf(e.clientY, e.currentTarget.getBoundingClientRect());
                    if (hover?.id !== node.id || hover.zone !== zone) setHover({ id: node.id, zone });
                  }}
                  onDragEnd={endDrag}
                  onDrop={(e) => onDrop(e, node.id)}
                >
                  <td className="tree" style={{ paddingLeft: `${0.6 + depth * 1.4}rem` }}>
                    {has ? (
                      <button type="button" className="twisty" aria-expanded={open}
                        aria-label={`${open ? t("modules.collapse") : t("modules.expand")} ${node.display_id}`}
                        onClick={() => toggle(node.id)}>{open ? "▾" : "▸"}</button>
                    ) : (
                      <span className="twisty" />
                    )}
                    <span className="num">{numbers.get(node.id)}</span>
                    {editing?.id === node.id ? (
                      <input form="edit-object" aria-label={t("modules.objectHeading")} value={editing.heading} autoFocus onKeyDown={onEditKey}
                        onChange={(e) => setEditing({ ...editing, heading: e.target.value })} />
                    ) : (
                      <span>{node.heading}</span>
                    )}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}><Link to={`../objects/${node.id}`}>{node.display_id}</Link></td>
                  <td>
                    {editing?.id === node.id ? (
                      <input form="edit-object" aria-label={t("modules.objectText")} value={editing.text} onKeyDown={onEditKey} style={{ width: "100%" }}
                        onChange={(e) => setEditing({ ...editing, text: e.target.value })} />
                    ) : (
                      node.text
                    )}
                  </td>
                  {definitions.map((d) => {
                    if (editing?.id !== node.id) {
                      return <td key={d.id}><ValueDisplay def={d} types={types} value={node.attributes?.[d.key]} /></td>;
                    }
                    const { Editor } = inputFor(d, types);
                    return (
                      <td key={d.id}>
                        <Editor def={d} label={d.name} value={editing.attrs[d.key]} onChange={(raw) => setEditing({ ...editing, attrs: { ...editing.attrs, [d.key]: raw } })} />
                      </td>
                    );
                  })}
                  <td><span className="badge yellow">{t("status.notReviewed")}</span></td>
                  <td className="muted">—</td>
                  {writable && (
                    <td style={{ whiteSpace: "nowrap" }}>
                      {/* distinct keys: otherwise React turns the clicked Edit button into the submit button
                          and the browser submits the form right after the click */}
                      {editing?.id === node.id ? (
                        <>
                          <button key="save" className="primary" type="submit" form="edit-object">{t("common.save")}</button>{" "}
                          <button key="cancel" type="button" onClick={() => setEditing(null)}>{t("common.cancel")}</button>
                        </>
                      ) : (
                        <>
                          <button key="edit" type="button" aria-label={`${t("common.edit")} ${node.display_id}`} title={t("common.edit")}
                            onClick={() => startEdit(node)}>✎</button>{" "}
                          <button key="delete" type="button" className="danger" aria-label={`${t("modules.delete")} ${node.display_id}`} title={t("modules.delete")} onClick={() => remove(node)}>✕</button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </article>
  );
}

// S3: modules and their ordered object tree.
export default function ModuleTree() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { projectId } = useParams();
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";
  const writable = can(roleIn(user, projectId), "write");

  const { types, definitions } = useAttributes(projectId);
  const [modules, setModules] = useState(null);
  const [trees, setTrees] = useState({});
  const [moduleName, setModuleName] = useState("");
  const [error, setError] = useState(false);
  const fail = useCallback(() => setError(true), []);

  const load = useCallback(async () => {
    try {
      const mods = await get(`/projects/${projectId}/modules`);
      setModules(mods);
      const entries = await Promise.all(mods.map(async (m) => [m.id, await get(`/modules/${m.id}/objects`)]));
      setTrees(Object.fromEntries(entries));
    } catch {
      setError(true);
    }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  const addModule = async (e) => {
    e.preventDefault();
    await post(`/projects/${projectId}/modules`, { name: moduleName }).catch(fail);
    setModuleName("");
    load();
  };

  return (
    <section>
      {error && <p role="alert" className="error">{t("common.error")}</p>}
      {writable && (
        <form onSubmit={addModule} className="inline-form">
          <input aria-label={t("modules.name")} placeholder={t("modules.name")} value={moduleName} onChange={(e) => setModuleName(e.target.value)} required />
          <button className="primary" type="submit">{t("modules.add")}</button>
        </form>
      )}
      {modules === null ? (
        error ? null : <p>{t("common.loading")}</p>
      ) : modules.length === 0 ? (
        <p>{t("modules.empty")}</p>
      ) : (
        modules.map((m) => (
          <ModuleTable key={m.id} module={m} tree={trees[m.id] ?? []} q={q} writable={writable} definitions={definitions} types={types} onChanged={load} onError={fail} />
        ))
      )}
    </section>
  );
}
