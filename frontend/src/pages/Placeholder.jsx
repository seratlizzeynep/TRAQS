import { useI18n } from "../i18n.jsx";

// Screens that belong to later requirements (traceability, baselines, ...).
export default function Placeholder({ titleKey }) {
  const { t } = useI18n();
  return (
    <section>
      <h1>{t(titleKey)}</h1>
      <p>{t("page.comingSoon")}</p>
    </section>
  );
}
