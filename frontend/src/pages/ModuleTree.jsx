import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { del, get, post } from "../api.js";
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

function ModuleTable({ module, tree, q, writable, onChanged, onError }) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(new Set());
  const [adding, setAdding] = useState(false);
  const [heading, setHeading] = useState("");
  const [text, setText] = useState("");
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
      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              {["col.tree", "col.id", "col.text", "col.priority", "col.status", "col.flags"].map((k) => (
                <th key={k} scope="col">{t(k)}</th>
              ))}
              {writable && <th scope="col"><span className="sr-only">{t("admin.actions")}</span></th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr className="empty-row"><td colSpan={writable ? 7 : 6}>{t("modules.noObjects")}</td></tr>
            )}
            {rows.map(({ node, depth }) => {
              const has = node.children.length > 0;
              const open = !collapsed.has(node.id);
              return (
                <tr
                  key={node.id}
                  draggable={writable}
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
                    <span>{node.heading}</span>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}><Link to={`../objects/${node.id}`}>{node.display_id}</Link></td>
                  <td>{node.text}</td>
                  <td className="muted">—</td>
                  <td><span className="badge yellow">{t("status.notReviewed")}</span></td>
                  <td className="muted">—</td>
                  {writable && (
                    <td>
                      <button type="button" className="danger" aria-label={`${t("modules.delete")} ${node.display_id}`} title={t("modules.delete")} onClick={() => remove(node)}>✕</button>
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
        <p>{t("common.loading")}</p>
      ) : modules.length === 0 ? (
        <p>{t("modules.empty")}</p>
      ) : (
        modules.map((m) => (
          <ModuleTable key={m.id} module={m} tree={trees[m.id] ?? []} q={q} writable={writable} onChanged={load} onError={fail} />
        ))
      )}
    </section>
  );
}
