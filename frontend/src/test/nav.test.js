import { describe, expect, it } from "vitest";
import { navFor } from "../nav.js";
import { can, roleIn } from "../permissions.js";
import { filterTree } from "../pages/ModuleTree.jsx";

const keys = (role) => navFor(role).map((i) => i.key);

describe("role based navigation", () => {
  it("admin sees everything", () => {
    expect(keys("admin")).toEqual(["modules", "traceability", "changes", "baselines", "tests", "analysis", "importExport", "attributes", "admin"]);
  });
  it("authors define attributes; viewers and reviewers do not", () => {
    expect(keys("author")).toContain("attributes");
    expect(keys("viewer")).not.toContain("attributes");
    expect(keys("reviewer")).not.toContain("attributes");
  });
  it("author may import/export but not administer", () => {
    expect(keys("author")).toContain("importExport");
    expect(keys("author")).not.toContain("admin");
  });
  it("viewer and reviewer get read-only screens", () => {
    for (const r of ["viewer", "reviewer"]) {
      expect(keys(r)).not.toContain("importExport");
      expect(keys(r)).not.toContain("admin");
      expect(keys(r)).toContain("modules");
    }
  });
  it("no role, no navigation", () => {
    expect(keys(null)).toEqual([]);
  });
});

describe("roleIn / can", () => {
  const user = { is_admin: false, memberships: [{ project_id: 2, role: "author" }] };
  it("resolves the role per project", () => {
    expect(roleIn(user, "2")).toBe("author");
    expect(roleIn(user, 3)).toBeNull();
    expect(roleIn({ is_admin: true, memberships: [] }, 9)).toBe("admin");
    expect(roleIn(null, 1)).toBeNull();
  });
  it("matches the backend matrix", () => {
    expect(can("author", "write")).toBe(true);
    expect(can("viewer", "write")).toBe(false);
    expect(can("reviewer", "review")).toBe(true);
  });
});

describe("filterTree", () => {
  const tree = [
    { id: 1, display_id: "REQ-0001", heading: "Power", text: "", children: [
      { id: 2, display_id: "REQ-0002", heading: "Battery life", text: "", children: [] },
    ] },
    { id: 3, display_id: "REQ-0003", heading: "Display", text: "", children: [] },
  ];
  it("returns everything without a query", () => expect(filterTree(tree, "")).toHaveLength(2));
  it("keeps ancestors of matches", () => {
    const r = filterTree(tree, "battery");
    expect(r).toHaveLength(1);
    expect(r[0].children[0].heading).toBe("Battery life");
  });
  it("matches display IDs", () => expect(filterTree(tree, "0003")[0].heading).toBe("Display"));
});
