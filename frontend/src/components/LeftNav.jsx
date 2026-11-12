import { NavLink } from "react-router-dom";
import { useAuth } from "../auth.jsx";
import { useI18n } from "../i18n.jsx";
import { navFor } from "../nav.js";
import { roleIn } from "../permissions.js";

export default function LeftNav({ projectId }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const items = navFor(roleIn(user, projectId));
  return (
    <nav className="leftnav" aria-label={t("nav.label")}>
      <ul>
        {items.map((i) => (
          <li key={i.key}>
            <NavLink to={`/projects/${projectId}/${i.path}`}>{t(i.labelKey)}</NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
