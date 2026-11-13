import { useEffect, useState } from "react";
import { Link, Outlet, useParams } from "react-router-dom";
import { get } from "../api.js";
import { useAuth } from "../auth.jsx";
import LeftNav from "../components/LeftNav.jsx";
import { useI18n } from "../i18n.jsx";
import { roleIn } from "../permissions.js";

// Per-project area: left navigation + the selected screen.
export default function ProjectLayout() {
  const { projectId } = useParams();
  const { user } = useAuth();
  const { t } = useI18n();
  const [state, setState] = useState("loading"); // loading | ok | missing

  // An address can point to a project that was deleted or never existed (e.g. an old bookmark).
  useEffect(() => {
    let current = true;
    setState("loading");
    get(`/projects/${projectId}`)
      .then(() => current && setState("ok"))
      .catch(() => current && setState("missing"));
    return () => { current = false; };
  }, [projectId]);

  if (!roleIn(user, projectId) || state === "missing") {
    return (
      <div className="plain">
        <p role="alert" className="error">{t("project.notFound")}</p>
        <Link to="/projects">{t("project.back")}</Link>
      </div>
    );
  }
  return (
    <div className="project-area">
      <LeftNav projectId={projectId} />
      <div className="content">{state === "ok" ? <Outlet /> : <p>{t("common.loading")}</p>}</div>
    </div>
  );
}
