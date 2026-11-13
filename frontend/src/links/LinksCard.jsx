import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { del, get, post } from "../api.js";
import { useI18n } from "../i18n.jsx";

// Links of one object (S4): both directions, also across modules, with create and delete.
// The available link types come from the server (GET /link-types, config/link-types.json).
export default function LinksCard({ obj, projectId, writable }) {
  const { t, lang } = useI18n();
  const [links, setLinks] = useState(null);
  const [types, setTypes] = useState([]);
  const [message, setMessage] = useState(null);
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const [target, setTarget] = useState(null);

  const load = useCallback(() => get(`/objects/${obj.id}/links`).then(setLinks).catch(() => { setLinks([]); setMessage(t("common.error")); }), [obj.id, t]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { get("/link-types").then(setTypes).catch(() => setTypes([])); }, []);

  // target search inside the project: finds objects of every module by ID and text
  useEffect(() => {
    const text = q.trim();
    if (!text || target) { setResults(null); return undefined; }
    let current = true;
    const timer = setTimeout(() => {
      get(`/projects/${projectId}/search?q=${encodeURIComponent(text)}&limit=8`)
        .then((r) => current && setResults(r.filter((x) => x.id !== obj.id)))
        .catch(() => current && setResults([]));
    }, 200);
    return () => { current = false; clearTimeout(timer); };
  }, [q, target, projectId, obj.id]);

  const typeName = type || types[0]?.name || "";
  // the rule text in the user's language when the configuration has one, otherwise the default text
  const rule = types.find((x) => x.name === typeName)?.rule;
  const ruleText = rule?.descriptions?.[lang] ?? rule?.description;
  const rejected = (e) => setMessage(`${t("link.rejected")} ${e.message}`);

  const add = async (e) => {
    e.preventDefault();
    setMessage(null);
    try {
      await post(`/objects/${obj.id}/links`, { target_id: target.id, type: typeName });
      setTarget(null);
      setQ("");
      await load();
    } catch (err) {
      rejected(err);
    }
  };
  const remove = async (l) => {
    if (!window.confirm(t("link.confirmDelete"))) return;
    setMessage(null);
    try {
      await del(`/links/${l.id}`);
      await load();
    } catch (err) {
      rejected(err);
    }
  };

  return (
    <div className="card">
      <div className="label">{t("detail.links")}</div>
      {message && <p role="alert" className="error">{message}</p>}
      {links === null ? <span className="muted">{t("common.loading")}</span> : links.length === 0 ? (
        <span className="muted">{t("detail.noLinks")}</span>
      ) : (
        <ul className="link-list">
          {links.map((l) => {
            const outgoing = l.source_id === obj.id;
            const other = outgoing ? l.target : l.source;
            const cfg = types.find((x) => x.name === l.type);
            const label = outgoing ? t(`linktype.${l.type}`, l.type) : t(`linktype.${l.type}.inverse`, cfg?.inverse ?? l.type);
            return (
              <li key={l.id}>
                <span className="muted" aria-hidden="true">{outgoing ? "→" : "←"}</span>{" "}
                <span className="badge purple">{label}</span>{" "}
                {other.deleted ? (
                  <><code>{other.display_id}</code> <span className="muted">{t("detail.deleted")}</span></>
                ) : (
                  <>
                    <Link to={`../objects/${other.id}`}>{other.display_id}</Link> <strong>{other.heading}</strong>
                    {other.module_id !== obj.module_id && <span className="muted"> ({other.module_name})</span>}
                  </>
                )}
                {l.suspect ? <> <span className="badge red">{t("detail.suspect")}</span></> : null}
                {l.rule?.status === "gap" && <> <span className="badge yellow" title={l.rule.message}>{t("link.gap")}</span></>}
                {l.rule?.status === "violation" && <> <span className="badge red" title={l.rule.message}>{t("link.violation")}</span></>}
                {cfg?.informative && <> <span className="badge gray">{t("link.informative")}</span></>}
                {writable && (
                  <button type="button" className="danger" aria-label={`${t("link.delete")} ${label} ${other.display_id}`} title={t("link.delete")} onClick={() => remove(l)}>✕</button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {writable && types.length > 0 && (
        <form onSubmit={add} className="link-form" aria-label={t("link.add")}>
          <select aria-label={t("link.type")} value={typeName} onChange={(e) => setType(e.target.value)}>
            {types.map((x) => <option key={x.name} value={x.name} title={x.description}>{t(`linktype.${x.name}`, x.name)}</option>)}
          </select>
          {target ? (
            <span className="chosen">
              <code>{target.display_id}</code> {target.heading}{" "}
              <button type="button" aria-label={t("link.clearTarget")} title={t("link.clearTarget")} onClick={() => { setTarget(null); setQ(""); }}>✕</button>
            </span>
          ) : (
            <span className="picker">
              <input aria-label={t("link.target")} placeholder={t("link.target")} value={q} autoComplete="off" onChange={(e) => setQ(e.target.value)} />
              {results && (
                <ul className="results" aria-label={t("search.results")}>
                  {results.length === 0 && <li className="none">{t("search.none")}</li>}
                  {results.map((r) => (
                    <li key={r.id}>
                      <button type="button" onClick={() => { setTarget(r); setResults(null); }}>
                        <code>{r.display_id}</code> <strong>{r.heading}</strong>
                        {r.module_id !== obj.module_id && <span className="muted"> ({r.module_name})</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </span>
          )}
          <button className="primary" type="submit" disabled={!target}>{t("link.add")}</button>
          {ruleText && <p className="muted rule-hint">{t("link.rule")}: {ruleText}</p>}
        </form>
      )}
    </div>
  );
}
