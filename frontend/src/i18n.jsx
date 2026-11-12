import { createContext, useContext } from "react";

// All user-visible text goes through t(key). Dictionaries live in ./locales.
const en = {
  "app.name": "TRAQS",
  "topbar.project": "Project",
  "topbar.selectProject": "Select project…",
  "topbar.search": "Search requirements",
  "topbar.searchPlaceholder": "Search…",
  "topbar.language": "Language",
  "topbar.userMenu": "User menu",
  "topbar.logout": "Log out",
  "login.title": "Sign in",
  "login.username": "User name",
  "login.password": "Password",
  "login.submit": "Sign in",
  "login.failed": "Wrong user name or password.",
  "login.locked": "Account is locked after too many failed attempts. Try again later.",
  "login.error": "Could not sign in. Please try again.",
  "projects.title": "Projects",
  "projects.empty": "No projects yet.",
  "projects.create": "New project",
  "projects.name": "Project name",
  "projects.add": "Create",
  "projects.role": "Role",
  "role.admin": "Admin",
  "role.author": "Author",
  "role.reviewer": "Reviewer",
  "role.viewer": "Viewer",
  "nav.modules": "Modules and objects",
  "nav.traceability": "Traceability",
  "nav.changes": "Change requests",
  "nav.baselines": "Baselines",
  "nav.importExport": "Import and export",
  "nav.tests": "Test cases",
  "nav.analysis": "Analysis",
  "nav.admin": "Administration",
  "nav.label": "Project navigation",
  "modules.title": "Modules and objects",
  "modules.empty": "No modules yet.",
  "modules.add": "Add module",
  "modules.name": "Module name",
  "modules.noObjects": "No objects in this module.",
  "modules.addObject": "Add object",
  "modules.objectHeading": "Heading",
  "modules.expand": "Expand",
  "modules.collapse": "Collapse",
  "page.comingSoon": "This screen is not built yet.",
  "common.loading": "Loading…",
  "common.error": "Something went wrong.",
  "common.notFound": "Page not found.",
};

export const dictionaries = { en };
export const LANGUAGES = [{ code: "en", label: "English" }];

const I18nContext = createContext({ lang: "en", setLang: () => {}, t: (k) => en[k] ?? k });

export function I18nProvider({ children, lang = "en" }) {
  const dict = dictionaries[lang] ?? en;
  const t = (key) => dict[key] ?? en[key] ?? key;
  return <I18nContext.Provider value={{ lang, setLang: () => {}, t }}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
