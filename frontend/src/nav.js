import { can } from "./permissions.js";

// Left navigation of an opened project. `action` is the permission a role needs to see the entry.
export const NAV_ITEMS = [
  { key: "modules", path: "modules", labelKey: "nav.modules", action: "read" },
  { key: "traceability", path: "traceability", labelKey: "nav.traceability", action: "read" },
  { key: "changes", path: "changes", labelKey: "nav.changes", action: "read" },
  { key: "baselines", path: "baselines", labelKey: "nav.baselines", action: "read" },
  { key: "tests", path: "tests", labelKey: "nav.tests", action: "read" },
  { key: "analysis", path: "analysis", labelKey: "nav.analysis", action: "read" },
  { key: "importExport", path: "import-export", labelKey: "nav.importExport", action: "write" },
  { key: "attributes", path: "attributes", labelKey: "nav.attributes", action: "write" },
  { key: "admin", path: "admin", labelKey: "nav.admin", action: "manage" },
];

export const navFor = (role) => NAV_ITEMS.filter((i) => can(role, i.action));
