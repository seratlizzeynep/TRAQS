import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App.jsx";
import { AuthProvider } from "../auth.jsx";
import { I18nProvider } from "../i18n.jsx";
import { filterTrace, traceRows } from "../pages/Traceability.jsx";

const json = (status, body) => ({ ok: status < 400, status, statusText: "x", text: async () => JSON.stringify(body) });
const node = (id, level, children = [], over = {}) => ({
  id, display_id: `REQ-000${id}`, heading: `h${id}`, level, suspect: false, skipped: false, shared: false, gaps: [],
  rollup: { total: 1, covered: 1, percent: 100 }, children, ...over,
});
const LEVELS = ["UR", "SR", "SW"];
const tree = [
  node(1, "UR", [node(2, "SR", [node(3, "SW", [node(4, "TC")])], { suspect: true })]),
  node(5, "UR", [], { gaps: [{ type: "missing_child", expected: "SR" }], rollup: { total: 1, covered: 0, percent: 0 } }),
];

describe("tree helpers", () => {
  it("limits the depth and keeps only branches with a gap or a suspect link", () => {
    expect(filterTrace(tree, { levels: LEVELS, depth: 1 }).map((n) => n.children.map((c) => c.children.length))).toEqual([[0], []]);
    expect(filterTrace(tree, { levels: LEVELS, onlyGaps: true }).map((n) => n.id)).toEqual([5]);
    const s = filterTrace(tree, { levels: LEVELS, onlySuspect: true });
    expect(s.map((n) => n.id)).toEqual([1]); // the ancestors stay so the branch is readable
  });
  it("lists rows in order and skips the children of collapsed nodes", () => {
    expect(traceRows(tree, new Set()).map((r) => r.node.id)).toEqual([1, 2, 3, 4, 5]);
    expect(traceRows(tree, new Set(["/1/2"])).map((r) => r.node.id)).toEqual([1, 2, 5]);
  });
});

const me = { id: 2, username: "vi", is_admin: false, memberships: [{ project_id: 1, role: "viewer" }] };
const coverage = {
  levels: LEVELS, test_kind: "TC",
  pairs: [
    { upper: "UR", lower: "SR", upper_total: 2, upper_covered: 1, downward_percent: 50, lower_total: 1, lower_with_parent: 1, upward_percent: 100, uncovered: [{ id: 5, display_id: "REQ-0005", heading: "h5", level: "UR" }], orphans: [], skipped_level: [], suspect_links: 1, links: 1 },
    { upper: "SR", lower: "SW", upper_total: 1, upper_covered: 1, downward_percent: 100, lower_total: 1, lower_with_parent: 1, upward_percent: 100, uncovered: [], orphans: [], skipped_level: [], suspect_links: 0, links: 1 },
    { upper: "SW", lower: "TC", upper_total: 1, upper_covered: 1, downward_percent: 100, lower_total: 1, lower_with_parent: 1, upward_percent: 100, uncovered: [], orphans: [], skipped_level: [], suspect_links: 0, links: 1 },
  ],
  end_to_end: { from: "UR", to: "TC", total: 2, covered: 1, percent: 50, uncovered: [] },
  tests: { total: 2, used: 1, unused: [{ id: 9, display_id: "REQ-0009", heading: "idle test", level: "TC" }], shared: [], requirements_total: 3, requirements_with_test: 1, requirements_with_test_percent: 33.3, by_level: [{ level: "UR", total: 2, with_test: 0, percent: 0 }] },
  unclassified: 2, other_kinds: 0,
};

const mount = () => {
  sessionStorage.setItem("traqs.token", "t");
  global.fetch = vi.fn(async (url) => {
    const k = String(url).replace("/api/v1", "");
    if (k === "/auth/me") return json(200, me);
    if (k === "/projects/1") return json(200, { id: 1, name: "Alpha", description: "" });
    if (k === "/projects/1/trace-tree") return json(200, { levels: LEVELS, test_kind: "TC", roots: tree });
    if (k === "/projects/1/trace-coverage") return json(200, coverage);
    return json(200, []);
  });
  return render(
    <MemoryRouter initialEntries={["/projects/1/traceability"]}>
      <I18nProvider initialLang="en"><AuthProvider><Routes><Route path="*" element={<App />} /></Routes></AuthProvider></I18nProvider>
    </MemoryRouter>
  );
};

describe("traceability screen", () => {
  beforeEach(() => localStorage.clear());

  it("shows the coverage between levels and the tree with its gap row", async () => {
    mount();
    const cov = within(await screen.findByRole("table", { name: "Coverage between levels" }));
    expect(cov.getByText("UR → SR")).toBeInTheDocument();
    expect(within(cov.getByText("UR → SR").closest("tr")).getByText("50 %")).toBeInTheDocument();
    const treeTable = within(screen.getByRole("table", { name: "Traceability tree" }));
    expect(treeTable.getByText("Gap: no SR below")).toBeInTheDocument();
    expect(treeTable.getAllByText("suspect").length).toBe(1);
  });

  it("opens the list of uncovered objects and unused tests", async () => {
    mount();
    await screen.findByRole("table", { name: "Coverage between levels" });
    const row = within(screen.getByRole("table", { name: "Coverage between levels" })).getByText("UR → SR").closest("tr");
    await userEvent.click(within(row).getByRole("button", { name: "1" })); // the "Not covered" count
    const region = await screen.findByRole("region", { name: /UR → SR: Not covered/ });
    expect(within(region).getByText("REQ-0005")).toBeInTheDocument();
  });

  it("collapses a branch and filters to the gaps", async () => {
    mount();
    const table = await screen.findByRole("table", { name: "Traceability tree" });
    expect(within(table).getByText("h4")).toBeInTheDocument();
    await userEvent.click(within(table).getAllByRole("button", { name: "Collapse" })[1]); // under REQ-0001
    await waitFor(() => expect(within(table).queryByText("h3")).not.toBeInTheDocument());
    await userEvent.click(screen.getByLabelText("Only gaps"));
    expect(within(screen.getByRole("table", { name: "Traceability tree" })).queryByText("h1")).not.toBeInTheDocument();
  });
});
