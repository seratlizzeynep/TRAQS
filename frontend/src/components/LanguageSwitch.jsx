import { LANGUAGES, useI18n } from "../i18n.jsx";

// Shown on the login screen and in the top bar (NFR-03).
export default function LanguageSwitch() {
  const { lang, setLang, t } = useI18n();
  return (
    <label className="lang">
      <span className="sr-only">{t("topbar.language")}</span>
      <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label={t("topbar.language")}>
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>{l.label}</option>
        ))}
      </select>
    </label>
  );
}
