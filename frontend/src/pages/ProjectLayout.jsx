import { Outlet, useParams } from "react-router-dom";
import { useAuth } from "../auth.jsx";
import LeftNav from "../components/LeftNav.jsx";
import { useI18n } from "../i18n.jsx";
import { roleIn } from "../permissions.js";

// Per-project area: left navigation + the selected screen.
export default function ProjectLayout() {
  const { projectId } = useParams();
  const { user } = useAuth();
  const { t } = useI18n();
  if (!roleIn(user, projectId)) return <p role="alert" className="error">{t("common.notFound")}</p>;
  return (
    <div className="project-area">
      <LeftNav projectId={projectId} />
      <div className="content">
        <Outlet />
      </div>
    </div>
  );
}
