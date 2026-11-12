import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import en from "./locales/en.js";
import tr from "./locales/tr.js";

// All user-visible text goes through t(key). English is the fallback for missing keys.
export const dictionaries = { en, tr };
export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "tr", label: "Türkçe" },
];

const STORAGE_KEY = "traqs.lang";
const supported = (code) => LANGUAGES.some((l) => l.code === code);

// Saved choice first, then the browser language, then English.
export function detectLanguage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (supported(saved)) return saved;
  } catch { /* storage unavailable */ }
  const nav = typeof navigator !== "undefined" ? (navigator.language ?? "").slice(0, 2).toLowerCase() : "";
  return supported(nav) ? nav : "en";
}

const I18nContext = createContext({ lang: "en", setLang: () => {}, t: (k) => en[k] ?? k });

export function I18nProvider({ children, initialLang }) {
  const [lang, setLangState] = useState(() => (supported(initialLang) ? initialLang : detectLanguage()));

  const setLang = useCallback((code) => {
    if (!supported(code)) return;
    setLangState(code);
    try { localStorage.setItem(STORAGE_KEY, code); } catch { /* storage unavailable */ }
  }, []);

  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  const value = useMemo(() => {
    const dict = dictionaries[lang] ?? en;
    return { lang, setLang, t: (key) => dict[key] ?? en[key] ?? key };
  }, [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
