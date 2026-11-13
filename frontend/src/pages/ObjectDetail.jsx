import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, get } from "../api.js";
import { ValueDisplay } from "../attributes/inputs.jsx";
import { useAttributes } from "../attributes/useAttributes.js";
import { useI18n } from "../i18n.jsx";

// S4 (object detail) with S5 (AI assistant panel). The AI actions are not available yet.
export default function ObjectDetail() {
  const { t } = useI18n();
  const { projectId, objectId } = useParams();
  const { types, definitions } = useAttributes(projectId);
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const obj = await get(`/objects/${objectId}`);
        const links = await get(`/objects/${objectId}/links`);
        const resolved = await Promise.all(
          links.map(async (l) => {
            const otherId = l.source_id === obj.id ? l.target_id : l.source_id;
            const other = await get(`/objects/${otherId}`).catch((e) => {
              if (e instanceof ApiError && e.status === 404) return null; // deleted
              throw e;
            });
            return { ...l, outgoing: l.source_id === obj.id, otherId, other };
          })
        );
        if (!cancelled) setState({ obj, links: resolved });
      } catch (e) {
        if (!cancelled) setState({ error: e });
      }
    })();
    return () => { cancelled = true; };
  }, [objectId]);

  if (state.loading) return <p>{t("common.loading")}</p>;
  if (state.error) return <p role="alert" className="error">{t(state.error.status === 404 ? "detail.notFound" : "common.error")}</p>;
  const { obj, links } = state;
  const off = { disabled: true, title: t("common.unavailable") };

  return (
    <section>
      <h1 className="screen-title">
        <span>S4 · {obj.display_id}</span>
        <span className="badge yellow">{t("status.notReviewed")}</span>
        <Link to={`/projects/${projectId}/modules`} className="muted">← {t("nav.modules")}</Link>
      </h1>
      <div className="cols">
        <div>
          <div className="card"><div className="label">{t("detail.text")}</div>{obj.heading && <strong>{obj.heading}</strong>}{obj.text && <div>{obj.text}</div>}</div>
          <div className="card">
            <div className="label">{t("detail.attributes")}</div>
            {definitions.length === 0 ? <span className="muted">{t("detail.noAttributes")}</span> : definitions.map((d) => (
              <div key={d.id}>{d.name}: <ValueDisplay def={d} types={types} value={obj.attributes?.[d.key]} /></div>
            ))}
          </div>
          <div className="card">
            <div className="label">{t("detail.links")}</div>
            {links.length === 0 ? <span className="muted">{t("detail.noLinks")}</span> : links.map((l) => (
              <div key={l.id}>
                {l.outgoing ? "→" : "←"}{" "}
                {l.other ? <Link to={`../objects/${l.otherId}`}>{l.other.display_id}</Link> : <span className="muted">{t("detail.deleted")}</span>}
                {l.suspect ? <> <span className="badge red">{t("detail.suspect")}</span></> : null}
              </div>
            ))}
          </div>
          <div className="card"><div className="label">{t("detail.comments")}</div><span className="muted">{t("detail.noComments")}</span></div>
          <div className="toolbar">
            <button type="button" {...off}>{t("detail.classify")}</button>
            <button type="button" {...off}>{t("detail.checkQuality")}</button>
            <button type="button" {...off}>{t("detail.rewrite")}</button>
          </div>
        </div>
        <aside>
          <h2 className="screen-title">S5 · {t("ai.title")}</h2>
          <div className="card"><span className="muted">{t("ai.empty")}</span></div>
          <div className="toolbar">
            <button type="button" className="primary" {...off}>{t("common.accept")}</button>
            <button type="button" {...off}>{t("common.edit")}</button>
            <button type="button" {...off}>{t("common.reject")}</button>
          </div>
        </aside>
      </div>
    </section>
  );
}
