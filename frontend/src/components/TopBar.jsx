import { useEffect, useRef, useState } from "react";
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
  const [results, setResults] = useState(null); // null = closed, [] = no match
  const searchBox = useRef(null);

  // Live search in the current project (SW-61): by ID and text, results open the object detail (S4).
  useEffect(() => {
    const text = q.trim();
    if (!projectId || !text) { setResults(null); return undefined; }
    let current = true;
    const timer = setTimeout(() => {
      get(`/projects/${projectId}/search?q=${encodeURIComponent(text)}&limit=10`)
        .then((r) => current && setResults(r))
        .catch(() => current && setResults([]));
    }, 200);
    return () => { current = false; clearTimeout(timer); };
  }, [q, projectId]);

  useEffect(() => {
    const close = (e) => { if (searchBox.current && !searchBox.current.contains(e.target)) setResults(null); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const open = (r) => {
    setResults(null);
    navigate(`/projects/${projectId}/objects/${r.id}`);
  };

  useEffect(() => {
    if (given) return;
    get("/projects").then(setProjects).catch(() => setProjects([]));
  }, [given]);

  const role = roleIn(user, projectId);
  const search = (e) => {
    e.preventDefault();
    setResults(null);
    if (projectId) navigate(`/projects/${projectId}/modules${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  };

  return (
    <header className="topbar" role="banner">
      <Link to="/projects" className="brand">{t("app.name")}</Link>

      <label className="project-switch pill">
        <span aria-hidden="true">{t("topbar.projectLabel")}</span>
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

      <form className="search" role="search" onSubmit={search} ref={searchBox}>
        <input
          type="search"
          aria-label={t("topbar.search")}
          placeholder={t("topbar.searchPlaceholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setResults(null)}
          autoComplete="off"
        />
        {results && (
          <ul className="results" aria-label={t("search.results")}>
            {results.length === 0 && <li className="none">{t("search.none")}</li>}
            {results.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => open(r)}>
                  <code>{r.display_id}</code> <strong>{r.heading}</strong>
                  {r.text && <span className="muted"> {r.text.slice(0, 80)}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
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
          {role && ` (${t(`role.${role}`)})`}
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
