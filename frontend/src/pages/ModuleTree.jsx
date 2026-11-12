import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { get, post } from "../api.js";
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

function Node({ node }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  const has = node.children.length > 0;
  return (
    <li>
      <div className="node">
        {has ? (
          <button
            type="button"
            className="twisty"
            aria-expanded={open}
            aria-label={`${open ? t("modules.collapse") : t("modules.expand")} ${node.display_id}`}
            onClick={() => setOpen(!open)}
          >
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="twisty" />
        )}
        <code>{node.display_id}</code> <strong>{node.heading}</strong>
        {node.text && <span className="muted"> {node.text}</span>}
      </div>
      {has && open && (
        <ul>
          {node.children.map((c) => (
            <Node key={c.id} node={c} />
          ))}
        </ul>
      )}
    </li>
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
  const [headings, setHeadings] = useState({});
  const [error, setError] = useState(false);

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
    await post(`/projects/${projectId}/modules`, { name: moduleName }).catch(() => setError(true));
    setModuleName("");
    load();
  };
  const addObject = async (e, id) => {
    e.preventDefault();
    await post(`/modules/${id}/objects`, { heading: headings[id] ?? "" }).catch(() => setError(true));
    setHeadings({ ...headings, [id]: "" });
    load();
  };

  return (
    <section>
      <h1>{t("modules.title")}</h1>
      {error && <p role="alert" className="error">{t("common.error")}</p>}
      {writable && (
        <form onSubmit={addModule} className="inline-form">
          <input
            aria-label={t("modules.name")}
            placeholder={t("modules.name")}
            value={moduleName}
            onChange={(e) => setModuleName(e.target.value)}
            required
          />
          <button type="submit">{t("modules.add")}</button>
        </form>
      )}
      {modules === null ? (
        <p>{t("common.loading")}</p>
      ) : modules.length === 0 ? (
        <p>{t("modules.empty")}</p>
      ) : (
        modules.map((m) => {
          const tree = filterTree(trees[m.id] ?? [], q);
          return (
            <article key={m.id} className="card">
              <h2>{m.name}</h2>
              {tree.length === 0 ? <p className="muted">{t("modules.noObjects")}</p> : (
                <ul className="tree">{tree.map((n) => <Node key={n.id} node={n} />)}</ul>
              )}
              {writable && (
                <form onSubmit={(e) => addObject(e, m.id)} className="inline-form">
                  <input
                    aria-label={t("modules.objectHeading")}
                    placeholder={t("modules.objectHeading")}
                    value={headings[m.id] ?? ""}
                    onChange={(e) => setHeadings({ ...headings, [m.id]: e.target.value })}
                  />
                  <button type="submit">{t("modules.addObject")}</button>
                </form>
              )}
            </article>
          );
        })
      )}
    </section>
  );
}
