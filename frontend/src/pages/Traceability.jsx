import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { get } from "../api.js";
import { useI18n } from "../i18n.jsx";

// Prunes the tree for display. `depth` limits how many levels are shown (null = all, tests included);
// onlyGaps / onlySuspect keep the branches that lead to a gap or a suspect link.
export function filterTrace(nodes, { levels, depth = null, onlyGaps = false, onlySuspect = false }) {
  const idx = (n) => { const i = levels.indexOf(n.level); return i < 0 ? levels.length : i; };
  const filtering = onlyGaps || onlySuspect;
  const walk = (list) =>
    list.flatMap((n) => {
      if (depth !== null && idx(n) > depth) return [];
      const kids = walk(n.children);
      const hit = (onlyGaps && n.gaps.length > 0) || (onlySuspect && n.suspect);
      if (filtering && !hit && kids.length === 0) return [];
      return [{ ...n, children: kids }];
    });
  return walk(nodes);
}

// Rows in display order; the children of collapsed nodes are skipped. A node under several parents is
// listed under each of them, so the key of a row is its path.
export function traceRows(nodes, collapsed, depth = 0, path = "", out = []) {
  for (const node of nodes) {
    const key = `${path}/${node.id}`;
    out.push({ node, depth, key });
    if (!collapsed.has(key)) traceRows(node.children, collapsed, depth + 1, key, out);
  }
  return out;
}

const pctText = (p) => (p === null || p === undefined ? "–" : `${p} %`);
const tone = (p) => (p === null ? "gray" : p >= 80 ? "green" : p >= 50 ? "yellow" : "red");

// Traceability tree with level-by-level coverage (UR -> SR -> SW -> test).
export default function Traceability() {
  const { t } = useI18n();
  const { projectId } = useParams();
  const [data, setData] = useState(null); // { tree, coverage }
  const [error, setError] = useState(null);
  const [collapsed, setCollapsed] = useState(new Set());
  const [depth, setDepth] = useState("all");
  const [onlyGaps, setOnlyGaps] = useState(false);
  const [onlySuspect, setOnlySuspect] = useState(false);
  const [detail, setDetail] = useState(null); // { title, items }

  useEffect(() => {
    let live = true;
    Promise.all([get(`/projects/${projectId}/trace-tree`), get(`/projects/${projectId}/trace-coverage`)])
      .then(([tree, coverage]) => live && setData({ tree, coverage }))
      .catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [projectId]);

  const levels = data?.tree.levels ?? [];
  const shown = useMemo(
    () => (data ? filterTrace(data.tree.roots, { levels, depth: depth === "all" ? null : Number(depth), onlyGaps, onlySuspect }) : []),
    [data, levels, depth, onlyGaps, onlySuspect]
  );
  const rows = useMemo(() => traceRows(shown, collapsed), [shown, collapsed]);

  if (error) return <p role="alert" className="msg error">{error}</p>;
  if (!data) return <p>{t("common.loading")}</p>;
  const { coverage: cov } = data;
  const toggle = (key) => setCollapsed((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const show = (title, items) => items.length > 0 && setDetail({ title, items });
  const count = (title, items) => (
    <button type="button" className="linkish" disabled={items.length === 0} onClick={() => show(title, items)}>{items.length}</button>
  );
  const gapText = (g) => (g.type === "missing_test" ? t("trace.gap.test").replace("{kind}", g.expected) : t("trace.gap.child").replace("{kind}", g.expected));

  return (
    <section>
      <h1 className="screen-title">{t("nav.traceability")}</h1>

      <div className="card">
        <h2>{t("trace.coverage")}</h2>
        <div className="table-wrap">
          <table className="grid" aria-label={t("trace.coverage")}>
            <thead>
              <tr>
                <th>{t("trace.pair")}</th>
                <th>{t("trace.downward")}</th>
                <th>{t("trace.upward")}</th>
                <th>{t("trace.uncovered")}</th>
                <th>{t("trace.orphans")}</th>
                <th>{t("trace.skipped")}</th>
                <th>{t("trace.suspect")}</th>
              </tr>
            </thead>
            <tbody>
              {cov.pairs.map((p) => {
                const name = `${p.upper} → ${p.lower}`;
                return (
                  <tr key={name}>
                    <td>{name}</td>
                    <td><span className={`badge ${tone(p.downward_percent)}`}>{pctText(p.downward_percent)}</span> {p.upper_covered}/{p.upper_total}</td>
                    <td><span className={`badge ${tone(p.upward_percent)}`}>{pctText(p.upward_percent)}</span> {p.lower_with_parent}/{p.lower_total}</td>
                    <td>{count(`${name}: ${t("trace.uncovered")}`, p.uncovered)}</td>
                    <td>{count(`${name}: ${t("trace.orphans")}`, p.orphans)}</td>
                    <td>{count(`${name}: ${t("trace.skipped")}`, p.skipped_level)}</td>
                    <td>{p.suspect_links}</td>
                  </tr>
                );
              })}
              <tr>
                <td>{cov.end_to_end.from} → {cov.end_to_end.to} ({t("trace.endToEnd")})</td>
                <td><span className={`badge ${tone(cov.end_to_end.percent)}`}>{pctText(cov.end_to_end.percent)}</span> {cov.end_to_end.covered}/{cov.end_to_end.total}</td>
                <td>–</td>
                <td>{count(`${t("trace.endToEnd")}: ${t("trace.uncovered")}`, cov.end_to_end.uncovered)}</td>
                <td>–</td><td>–</td><td>–</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2>{t("trace.tests")}</h2>
        <p>
          {t("trace.testsUsed")}: <strong>{cov.tests.used}/{cov.tests.total}</strong>
          {" · "}{t("trace.testsUnused")}: {count(t("trace.testsUnused"), cov.tests.unused)}
          {" · "}{t("trace.testsShared")}: {count(t("trace.testsShared"), cov.tests.shared)}
          {" · "}{t("trace.reqWithTest")}: <strong>{pctText(cov.tests.requirements_with_test_percent)}</strong>
        </p>
        <ul className="plain">
          {cov.tests.by_level.map((l) => (
            <li key={l.level}>{l.level}: {l.with_test}/{l.total} <span className={`badge ${tone(l.percent)}`}>{pctText(l.percent)}</span></li>
          ))}
        </ul>
        {(cov.unclassified > 0) && <p className="muted">{t("trace.unclassified").replace("{n}", cov.unclassified)}</p>}

        {detail && (
          <div className="card" role="region" aria-label={detail.title}>
            <h2>{detail.title}</h2>
            <ul className="plain">
              {detail.items.map((o) => (
                <li key={o.id}><Link to={`/projects/${projectId}/objects/${o.id}`}>{o.display_id}</Link> {o.heading} {o.level && <span className="badge gray">{o.level}</span>}</li>
              ))}
            </ul>
            <button type="button" onClick={() => setDetail(null)}>{t("trace.close")}</button>
          </div>
        )}
      </div>

      <h2>{t("trace.tree")}</h2>
      <div className="toolbar">
        <label>{t("trace.depth")}{" "}
          <select value={depth} onChange={(e) => setDepth(e.target.value)}>
            <option value="all">{t("trace.allLevels")}</option>
            {levels.map((l, i) => <option key={l} value={i}>{l}</option>)}
          </select>
        </label>
        <label><input type="checkbox" checked={onlyGaps} onChange={(e) => setOnlyGaps(e.target.checked)} /> {t("trace.onlyGaps")}</label>
        <label><input type="checkbox" checked={onlySuspect} onChange={(e) => setOnlySuspect(e.target.checked)} /> {t("trace.onlySuspect")}</label>
        <button type="button" onClick={() => setCollapsed(new Set(traceRows(shown, new Set()).filter((r) => r.node.children.length).map((r) => r.key)))}>{t("trace.collapseAll")}</button>
        <button type="button" onClick={() => setCollapsed(new Set())}>{t("trace.expandAll")}</button>
      </div>

      {rows.length === 0 ? (
        <p>{t("trace.empty")}</p>
      ) : (
        <div className="table-wrap">
          <table className="grid" aria-label={t("trace.tree")}>
            <thead>
              <tr><th>{t("trace.object")}</th><th>{t("trace.level")}</th><th>{t("trace.branchCoverage")}</th><th>{t("trace.flags")}</th></tr>
            </thead>
            <tbody>
              {rows.map(({ node: n, depth: d, key }) => (
                <Fragment key={key}>
                  <tr>
                    <td className="tree" style={{ paddingLeft: `${0.6 + d * 1.4}rem` }}>
                      {n.children.length ? (
                        <button type="button" className="twisty" aria-label={collapsed.has(key) ? t("trace.expand") : t("trace.collapse")} aria-expanded={!collapsed.has(key)} onClick={() => toggle(key)}>{collapsed.has(key) ? "▸" : "▾"}</button>
                      ) : <span className="twisty" />}
                      <Link to={`/projects/${projectId}/objects/${n.id}`}>{n.display_id}</Link> {n.heading}
                    </td>
                    <td><span className="badge purple">{n.level ?? "–"}</span></td>
                    <td>{n.level !== data.tree.test_kind && n.rollup.total > 0 ? <span className={`badge ${tone(n.rollup.percent)}`} title={`${n.rollup.covered}/${n.rollup.total}`}>{pctText(n.rollup.percent)}</span> : "–"}</td>
                    <td>
                      {n.suspect && <span className="badge red">{t("trace.suspectBadge")}</span>}{" "}
                      {n.skipped && <span className="badge yellow">{t("trace.skippedBadge")}</span>}{" "}
                      {n.shared && <span className="badge gray">{t("trace.sharedBadge")}</span>}
                    </td>
                  </tr>
                  {n.gaps.map((g) => (
                    <tr key={g.type} className="gap-row">
                      <td className="tree" style={{ paddingLeft: `${0.6 + (d + 1) * 1.4}rem` }}><span className="twisty" /><em>{gapText(g)}</em></td>
                      <td><span className="badge red">{g.expected}</span></td><td>–</td><td><span className="badge red">{t("trace.gapBadge")}</span></td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

