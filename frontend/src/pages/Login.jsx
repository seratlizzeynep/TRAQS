import { useState } from "react";
import { useAuth } from "../auth.jsx";
import LanguageSwitch from "../components/LanguageSwitch.jsx";
import { useI18n } from "../i18n.jsx";

export default function Login() {
  const { t } = useI18n();
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
    } catch (err) {
      setError(err.status === 401 ? "login.failed" : err.status === 423 ? "login.locked" : "login.error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <form onSubmit={submit} className="card">
        <div className="login-head">
          <h1>{t("app.name")}</h1>
          <LanguageSwitch />
        </div>
        <h2>{t("login.title")}</h2>
        <label>
          {t("login.username")}
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
        </label>
        <label>
          {t("login.password")}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && <p role="alert" className="error">{t(error)}</p>}
        <button type="submit" disabled={busy}>{t("login.submit")}</button>
      </form>
    </main>
  );
}
