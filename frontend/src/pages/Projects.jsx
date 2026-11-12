import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { get, post } from "../api.js";
import { useAuth } from "../auth.jsx";
import { useI18n } from "../i18n.jsx";
import { can, roleIn } from "../permissions.js";

// S2: project list with role badges.
export default function Projects() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [projects, setProjects] = useState(null);
  const [name, setName] = useState("");
  const [error, setError] = useState(false);

  const load = () => get("/projects").then(setProjects).catch(() => setError(true));
  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault();
    try {
      await post("/projects", { name });
      setName("");
      load();
    } catch {
      setError(true);
    }
  };

  return (
    <section className="plain">
      <h1>{t("projects.title")}</h1>
      {error && <p role="alert" className="error">{t("common.error")}</p>}
      {can(roleIn(user, null), "manage") && (
        <form onSubmit={create} className="inline-form">
          <input
            aria-label={t("projects.name")}
            placeholder={t("projects.name")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <button className="primary" type="submit">{t("projects.add")}</button>
        </form>
      )}
      {projects === null ? (
        <p>{t("common.loading")}</p>
      ) : projects.length === 0 ? (
        <p>{t("projects.empty")}</p>
      ) : (
        <ul className="cards">
          {projects.map((p) => (
            <li key={p.id} className="card">
              <Link to={`/projects/${p.id}/modules`}>{p.name}</Link>
              <p>{p.description}</p>
              <span className="badge">{t(`role.${roleIn(user, p.id)}`)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
