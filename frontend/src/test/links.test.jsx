import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App.jsx";
import { AuthProvider } from "../auth.jsx";
import { I18nProvider } from "../i18n.jsx";

const json = (status, body) => ({ ok: status < 400, status, statusText: "x", text: async () => (body === null ? "" : JSON.stringify(body)) });
const mount = (path = "/projects/1/objects/2") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <I18nProvider>
        <AuthProvider>
          <Routes><Route path="*" element={<App />} /></Routes>
        </AuthProvider>
      </I18nProvider>
    </MemoryRouter>
  );

const LINK_TYPES = [
  { name: "Derives", inverse: "Derived from", description: "", informative: false, rule: { description: "UR derives SR and SR derives SW.", allow: [["UR", "SR"], ["SR", "SW"]] } },
  { name: "Satisfies", inverse: "Satisfied by", description: "", informative: false, rule: { description: "SW satisfies SR.", allow: [["SW", "SR"]] } },
  { name: "Verifies", inverse: "Verified by", description: "", informative: false, rule: { description: "Only a test case (TC) can verify a requirement.", allow: [["TC", "requirement"]] } },
  { name: "Refers", inverse: "Referred by", description: "", informative: true, rule: { description: "Informative: any object may refer to any object.", allow: "any" } },
];
const end = (id, heading, over = {}) => ({ id, display_id: `REQ-000${id}`, heading, module_id: 7, module_name: "System", deleted: false, ...over });
const obj = { id: 2, display_id: "REQ-0002", heading: "Battery", text: "", module_id: 7, attributes: {} };
const author = { id: 2, username: "au", is_admin: false, memberships: [{ project_id: 1, role: "author" }] };
const viewer = { id: 3, username: "vi", is_admin: false, memberships: [{ project_id: 1, role: "viewer" }] };

let calls;
function backend(me, links, extra = {}) {
  sessionStorage.setItem("traqs.token", "t");
  calls = [];
  const routes = {
    "GET /auth/me": json(200, me),
    "GET /projects": json(200, [{ id: 1, name: "Alpha", description: "" }]),
    "GET /projects/1": json(200, { id: 1, name: "Alpha", description: "" }),
    "GET /attribute-types": json(200, []),
    "GET /projects/1/attributes": json(200, []),
    "GET /link-types": json(200, LINK_TYPES),
    "GET /objects/2": json(200, obj),
    "GET /objects/2/links": () => json(200, links),
    ...extra,
  };
  global.fetch = vi.fn(async (url, opts = {}) => {
    const key = `${opts.method ?? "GET"} ${String(url).replace("/api/v1", "")}`;
    calls.push([key, opts.body ? JSON.parse(opts.body) : undefined]);
    const r = routes[key];
    return typeof r === "function" ? r(opts) : r ?? json(204, null);
  });
}
const sent = (key) => calls.filter(([k]) => k === key).map(([, b]) => b);
const card = async () => {
  const c = (await screen.findByText("Links")).closest(".card");
  await waitFor(() => expect(within(c).queryByText("Loading…")).not.toBeInTheDocument());
  return c;
};
const list = (c) => within(c.querySelector(".link-list"));

beforeEach(() => sessionStorage.clear());

describe("Links card (S4)", () => {
  it("shows links in both directions with their type and the other end", async () => {
    backend(author, [
      { id: 1, source_id: 2, target_id: 3, type: "Derives", suspect: 0, source: end(2, "Battery"), target: end(3, "Cell") },
      { id: 2, source_id: 4, target_id: 2, type: "Verifies", suspect: 0, source: end(4, "Battery test"), target: end(2, "Battery") },
    ]);
    mount();
    const c = within(await card());
    const out = c.getByText("REQ-0003").closest("li");
    expect(within(out).getByText("Derives")).toBeInTheDocument(); // outgoing: the type
    expect(within(out).getByText("Cell")).toBeInTheDocument();
    const inc = c.getByText("REQ-0004").closest("li");
    expect(within(inc).getByText("Verified by")).toBeInTheDocument(); // incoming: the inverse label from the configuration
    expect(within(inc).getByRole("link", { name: "REQ-0004" })).toHaveAttribute("href", "/projects/1/objects/4");
  });

  it("names the module of an object in another module", async () => {
    backend(author, [{ id: 1, source_id: 2, target_id: 5, type: "Satisfies", suspect: 0, source: end(2, "Battery"), target: end(5, "Spec", { module_id: 8, module_name: "Tests" }) }]);
    mount();
    expect(within(await card()).getByText("(Tests)")).toBeInTheDocument();
  });

  it("marks suspect links, deleted ends and informative types", async () => {
    backend(author, [
      { id: 1, source_id: 2, target_id: 9, type: "Derives", suspect: 1, source: end(2, "Battery"), target: end(9, "Gone", { deleted: true }) },
      { id: 2, source_id: 2, target_id: 3, type: "Refers", suspect: 0, source: end(2, "Battery"), target: end(3, "Cell") },
    ]);
    mount();
    const c = within(await card());
    expect(c.getByText("deleted object")).toBeInTheDocument();
    expect(c.getByText("suspect")).toBeInTheDocument();
    expect(c.queryByRole("link", { name: "REQ-0009" })).not.toBeInTheDocument(); // nothing to open
    expect(c.getByText("informative")).toBeInTheDocument();
  });

  it("creates a link: pick the type, search the target in the project, add", async () => {
    backend(author, [], {
      "GET /projects/1/search?q=cell&limit=8": json(200, [
        { id: 2, display_id: "REQ-0002", heading: "Battery", text: "", module_id: 7, module_name: "System" }, // the object itself is not offered
        { id: 3, display_id: "REQ-0003", heading: "Cell", text: "", module_id: 8, module_name: "Tests" },
      ]),
      "POST /objects/2/links": json(201, {}),
    });
    mount();
    const form = within(await screen.findByRole("form", { name: "Add link" }));
    expect(form.getByRole("button", { name: "Add link" })).toBeDisabled(); // no target yet
    await userEvent.selectOptions(form.getByLabelText("Link type"), "Satisfies");
    await userEvent.type(form.getByLabelText("Target: ID or text…"), "cell");
    const list = await screen.findByRole("list", { name: "Search results" });
    expect(within(list).queryByText("REQ-0002")).not.toBeInTheDocument();
    expect(within(list).getByText("(Tests)")).toBeInTheDocument(); // across modules
    await userEvent.click(within(list).getByRole("button", { name: /REQ-0003/ }));
    await userEvent.click(form.getByRole("button", { name: "Add link" }));
    await waitFor(() => expect(sent("POST /objects/2/links")).toEqual([{ target_id: 3, type: "Satisfies" }]));
  });

  it("uses the first configured type by default", async () => {
    backend(author, [], {
      "GET /projects/1/search?q=cell&limit=8": json(200, [{ id: 3, display_id: "REQ-0003", heading: "Cell", text: "", module_id: 7, module_name: "System" }]),
      "POST /objects/2/links": json(201, {}),
    });
    mount();
    const form = within(await screen.findByRole("form", { name: "Add link" }));
    await userEvent.type(form.getByLabelText("Target: ID or text…"), "cell");
    await userEvent.click(await screen.findByRole("button", { name: /REQ-0003/ }));
    await userEvent.click(form.getByRole("button", { name: "Add link" }));
    await waitFor(() => expect(sent("POST /objects/2/links")).toEqual([{ target_id: 3, type: "Derives" }]));
  });

  it("shows why the server rejected a link", async () => {
    backend(author, [], {
      "GET /projects/1/search?q=cell&limit=8": json(200, [{ id: 3, display_id: "REQ-0003", heading: "Cell", text: "", module_id: 7, module_name: "System" }]),
      "POST /objects/2/links": json(409, { detail: "a Derives link between these objects already exists" }),
    });
    mount();
    const form = within(await screen.findByRole("form", { name: "Add link" }));
    await userEvent.type(form.getByLabelText("Target: ID or text…"), "cell");
    await userEvent.click(await screen.findByRole("button", { name: /REQ-0003/ }));
    await userEvent.click(form.getByRole("button", { name: "Add link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already exists");
  });

  it("reports a skipped level as a gap and a link that no longer fits as a rule violation", async () => {
    backend(author, [
      { id: 1, source_id: 2, target_id: 3, type: "Derives", suspect: 0, source: end(2, "Battery"), target: end(3, "Cell"), rule: { status: "gap", message: "Link rule 'Derives': this link skips SR (UR to SW)." } },
      { id: 2, source_id: 2, target_id: 4, type: "Derives", suspect: 0, source: end(2, "Battery"), target: end(4, "Pack"), rule: { status: "violation", message: "UR to TC is not allowed." } },
      { id: 3, source_id: 2, target_id: 5, type: "Refers", suspect: 0, source: end(2, "Battery"), target: end(5, "Note"), rule: { status: "ok", message: "" } },
    ]);
    mount();
    const raw = await card();
    const items = list(raw);
    const gap = items.getByText("REQ-0003").closest("li");
    expect(within(gap).getByText("gap")).toHaveAttribute("title", expect.stringContaining("skips SR"));
    const bad = items.getByText("REQ-0004").closest("li");
    expect(within(bad).getByText("rule broken")).toHaveAttribute("title", "UR to TC is not allowed.");
    const fine = items.getByText("REQ-0005").closest("li");
    expect(within(fine).queryByText("gap")).not.toBeInTheDocument();
    expect(within(fine).queryByText("rule broken")).not.toBeInTheDocument();
  });

  it("shows the rule of the selected link type and the server's reason when a link is refused", async () => {
    backend(author, [], {
      "GET /projects/1/search?q=cell&limit=8": json(200, [{ id: 3, display_id: "REQ-0003", heading: "Cell", text: "", module_id: 7, module_name: "System" }]),
      "POST /objects/2/links": json(422, { detail: "Link rule 'Verifies': SR to SW is not allowed. Allowed: TC to requirement." }),
    });
    mount();
    const form = within(await screen.findByRole("form", { name: "Add link" }));
    expect(form.getByText(/UR derives SR and SR derives SW/)).toBeInTheDocument(); // rule of the first type
    await userEvent.selectOptions(form.getByLabelText("Link type"), "Verifies");
    expect(form.getByText(/Only a test case \(TC\) can verify a requirement/)).toBeInTheDocument();
    await userEvent.type(form.getByLabelText("Target: ID or text…"), "cell");
    await userEvent.click(await screen.findByRole("button", { name: /REQ-0003/ }));
    await userEvent.click(form.getByRole("button", { name: "Add link" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Link rule 'Verifies'");
    expect(alert).toHaveTextContent("Allowed: TC to requirement");
  });

  it("deletes a link after confirmation", async () => {
    backend(author, [{ id: 7, source_id: 2, target_id: 3, type: "Derives", suspect: 0, source: end(2, "Battery"), target: end(3, "Cell") }], {
      "DELETE /links/7": json(204, null),
    });
    const confirm = vi.spyOn(window, "confirm");
    mount();
    await card();
    confirm.mockReturnValueOnce(false);
    await userEvent.click(screen.getByRole("button", { name: /Delete link Derives REQ-0003/ }));
    expect(sent("DELETE /links/7")).toEqual([]);
    confirm.mockReturnValueOnce(true);
    await userEvent.click(screen.getByRole("button", { name: /Delete link Derives REQ-0003/ }));
    await waitFor(() => expect(sent("DELETE /links/7")).toHaveLength(1));
  });

  it("viewers can read links but not change them", async () => {
    backend(viewer, [{ id: 7, source_id: 2, target_id: 3, type: "Derives", suspect: 0, source: end(2, "Battery"), target: end(3, "Cell") }]);
    mount();
    const c = within(await card());
    expect(c.getByText("REQ-0003")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Add link" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete link/ })).not.toBeInTheDocument();
  });

  it("link type names come from the server: a type the UI has never seen still works", async () => {
    backend(author, [{ id: 1, source_id: 2, target_id: 3, type: "Conflicts", suspect: 0, source: end(2, "Battery"), target: end(3, "Cell") }], {
      "GET /link-types": json(200, [{ name: "Conflicts", inverse: "Conflicts with", description: "", informative: false }]),
    });
    mount();
    const raw = await card();
    expect(list(raw).getByText("Conflicts")).toBeInTheDocument();
    const form = within(screen.getByRole("form", { name: "Add link" }));
    expect(form.getByRole("option", { name: "Conflicts" })).toBeInTheDocument();
  });

  it("is shown in Turkish with translated type names", async () => {
    localStorage.setItem("traqs.lang", "tr");
    backend(author, [
      { id: 1, source_id: 2, target_id: 3, type: "Verifies", suspect: 0, source: end(2, "Battery"), target: end(3, "Cell") },
      { id: 2, source_id: 4, target_id: 2, type: "Verifies", suspect: 0, source: end(4, "T"), target: end(2, "Battery") },
    ]);
    mount();
    const raw = (await screen.findByText("Bağlantılar")).closest(".card");
    await waitFor(() => expect(within(raw).queryByText("Yükleniyor…")).not.toBeInTheDocument());
    expect(list(raw).getByText("Doğrular")).toBeInTheDocument();
    expect(list(raw).getByText("Şunun tarafından doğrulanır")).toBeInTheDocument();
  });
});
