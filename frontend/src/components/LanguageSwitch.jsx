import { LANGUAGES, useI18n } from "../i18n.jsx";

// "TR | EN" toggle, shown on the login screen and in the top bar (NFR-03).
export default function LanguageSwitch() {
  const { lang, setLang, t } = useI18n();
  const order = [...LANGUAGES].reverse(); // TR | EN
  return (
    <div className="lang" role="group" aria-label={t("topbar.language")}>
      {order.map((l, i) => (
        <span key={l.code}>
          {i > 0 && <span className="sep" aria-hidden="true"> | </span>}
          <button type="button" aria-pressed={lang === l.code} lang={l.code} aria-label={l.label} title={l.label} onClick={() => setLang(l.code)}>
            {l.code.toUpperCase()}
          </button>
        </span>
      ))}
    </div>
  );
}
