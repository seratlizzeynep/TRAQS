import { useI18n } from "../i18n.jsx";

// S7 and S12 follow the design mock-ups. They show sample data only; the backend for
// change requests and analysis does not exist yet.
const Note = () => {
  const { t } = useI18n();
  return <p className="mock-note" role="note">{t("mock.note")}</p>;
};

export function ChangeRequest() {
  const { t } = useI18n();
  const steps = ["Draft", "Submitted", "In Review", "Approved", "Implemented", "Closed"];
  const impact = [
    ["SW-12", "Software req.", "suspect", "red"],
    ["SW-40", "Software req.", "suspect", "red"],
    ["TC-012", "Test case", "re-test", "yellow"],
  ];
  return (
    <section>
      <Note />
      <div className="cols">
        <div>
          <h1 className="screen-title">
            <span>S7 · {t("cr.title")} CR-007</span> <span className="badge purple">In Review</span>
          </h1>
          <div className="card">
            <div><strong>{t("cr.titleLabel")}</strong> Add 2 s response limit</div>
            <div><strong>{t("cr.rationale")}</strong> Safety analysis finding</div>
            <div><strong>{t("cr.priority")}</strong> High · <strong>{t("cr.affected")}</strong> REQ-0003</div>
          </div>
          <div className="card">
            <div className="label">{t("cr.lifecycle")}</div>
            <div className="steps">
              {steps.map((s, i) => (
                <span key={s}>
                  {i > 0 && <span aria-hidden="true">→ </span>}
                  <span className={`badge ${s === "In Review" ? "purple" : "gray"}`}>{s}</span>
                </span>
              ))}
            </div>
          </div>
          <div className="toolbar" style={{ alignItems: "center" }}>
            <button type="button" className="primary" disabled>{t("cr.approve")}</button>
            <button type="button" disabled>{t("cr.reject")}</button>
            <span className="muted">{t("cr.approver")}: Elif</span>
          </div>
        </div>
        <div>
          <h2 className="screen-title">{t("cr.impact")}</h2>
          <table className="grid">
            <thead><tr><th scope="col">{t("cr.item")}</th><th scope="col">{t("cr.type")}</th><th scope="col">{t("cr.status")}</th></tr></thead>
            <tbody>
              {impact.map(([item, type, status, color]) => (
                <tr key={item}><td>{item}</td><td>{type}</td><td><span className={`badge ${color}`}>{status}</span></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export function AnalysisDashboard() {
  const { t } = useI18n();
  const findings = [
    ["No test linked", "SR-22", "gap", "red"],
    ["Forbidden term “etc.”", "REQ-0017", "domain", "yellow"],
    ["Several requirements in one", "REQ-0021", "quality", "yellow"],
  ];
  return (
    <section>
      <Note />
      <h1 className="screen-title">
        <span>S12 · {t("an.title")}</span>
        <button type="button" disabled>{t("an.run")}</button>
        <button type="button" disabled>{t("an.export")}</button>
      </h1>
      <div className="stats">
        <div className="card stat"><div className="label">{t("an.coverage")}</div><div className="value">92 %</div><div className="bar"><span style={{ width: "92%" }} /></div></div>
        <div className="card stat"><div className="label">{t("an.orphans")}</div><div className="value">3</div></div>
        <div className="card stat"><div className="label">{t("an.suspect")}</div><div className="value">5</div></div>
        <div className="card stat"><div className="label">{t("an.quality")}</div><div className="value">78 / 100</div></div>
        <div className="card stat"><div className="label">{t("an.domain")}</div><div className="value">88 %</div></div>
      </div>
      <div className="cols">
        <table className="grid">
          <thead><tr><th scope="col">{t("an.finding")}</th><th scope="col">{t("an.object")}</th><th scope="col">{t("an.type")}</th></tr></thead>
          <tbody>
            {findings.map(([f, o, type, color]) => (
              <tr key={o}><td>{f}</td><td>{o}</td><td><span className={`badge ${color}`}>{type}</span></td></tr>
            ))}
          </tbody>
        </table>
        <div className="card">
          <div><strong>{t("an.summary")}</strong> {t("an.draft")}</div>
          <p>Coverage is high, but three system requirements have no test. Review five suspect links first.</p>
          <div className="toolbar">
            <button type="button" className="primary" disabled>{t("common.accept")}</button>
            <button type="button" disabled>{t("common.edit")}</button>
            <button type="button" disabled>{t("common.reject")}</button>
          </div>
        </div>
      </div>
    </section>
  );
}
