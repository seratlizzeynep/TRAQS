import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { get } from "../api.js";
import { useAuth } from "../auth.jsx";
import { useI18n } from "../i18n.jsx";
import { roleIn } from "../permissions.js";
import LanguageSwitch from "./LanguageSwitch.jsx";

export default function TopBar({ projects: given }) {
  const { t } = useI18n();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { projectId } = useParams();
  const [params] = useSearchParams();
  const [projects, setProjects] = useState(given ?? []);
  const [q, setQ] = useState(params.get("q") ?? "");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (given) return;
    get("/projects").then(setProjects).catch(() => setProjects([]));
  }, [given]);

  const role = roleIn(user, projectId);
  const search = (e) => {
    e.preventDefault();
    if (projectId) navigate(`/projects/${projectId}/modules${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  };

  return (
    <header className="topbar" role="banner">
      <Link to="/projects" className="brand">{t("app.name")}</Link>

      <label className="project-switch">
        <span className="sr-only">{t("topbar.project")}</span>
        <select
          aria-label={t("topbar.project")}
          value={projectId ?? ""}
          onChange={(e) => e.target.value && navigate(`/projects/${e.target.value}/modules`)}
        >
          <option value="">{t("topbar.selectProject")}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>

      <form className="search" role="search" onSubmit={search}>
        <input
          type="search"
          aria-label={t("topbar.search")}
          placeholder={t("topbar.searchPlaceholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </form>

      <LanguageSwitch />

      <div className="user-menu">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={t("topbar.userMenu")}
          onClick={() => setMenuOpen((o) => !o)}
        >
          {user?.username}
          {role && <span className="badge">{t(`role.${role}`)}</span>}
        </button>
        {menuOpen && (
          <div role="menu" className="menu">
            <button type="button" role="menuitem" onClick={logout}>{t("topbar.logout")}</button>
          </div>
        )}
      </div>
    </header>
  );
}
