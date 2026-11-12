import { LANGUAGES, useI18n } from "../i18n.jsx";

export default function LanguageSwitch() {
  const { lang, setLang, t } = useI18n();
  return (
    <label className="lang">
      <span className="sr-only">{t("topbar.language")}</span>
      <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label={t("topbar.language")}>
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>{l.code.toUpperCase()}</option>
        ))}
      </select>
    </label>
  );
}
