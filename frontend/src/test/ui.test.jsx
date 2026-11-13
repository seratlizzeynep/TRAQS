import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App.jsx";
import { AuthProvider } from "../auth.jsx";
import { I18nProvider } from "../i18n.jsx";

const json = (status, body) => ({ ok: status < 400, status, statusText: "x", text: async () => JSON.stringify(body) });

// Tiny fake backend: routes -> responder
function fakeApi(routes) {
  global.fetch = vi.fn(async (url, opts = {}) => {
    const key = `${opts.method ?? "GET"} ${String(url).replace("/api/v1", "")}`;
    const r = routes[key];
    if (!r) return json(404, { detail: `no route ${key}` });
    return typeof r === "function" ? r(opts) : r;
  });
}

const mount = (path = "/") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <I18nProvider>
        <AuthProvider>
          <Routes>
            <Route path="*" element={<App />} />
          </Routes>
        </AuthProvider>
      </I18nProvider>
    </MemoryRouter>
  );

// attribute types and definitions as the server describes them
const TYPES = [
  { type: "text", label: "Text", input: "text", option_fields: [] },
  { type: "enumeration", label: "Enumeration", input: "select", option_fields: [{ key: "values", label: "Allowed values", kind: "string-list" }] },
  { type: "number", label: "Number", input: "number", option_fields: [] },
];
const DEFS = [
  { id: 1, project_id: 1, key: "priority", name: "Priority", description: "", type: "enumeration", options: { values: ["Must", "Should", "Could"] }, position: 0 },
  { id: 2, project_id: 1, key: "weight", name: "Weight", description: "", type: "number", options: { unit: "kg" }, position: 1 },
];
const projects = [{ id: 1, name: "Alpha", description: "first" }];
const me = (over) => ({ id: 1, username: "elif", is_admin: false, memberships: [{ project_id: 1, role: "viewer" }], ...over });

afterEach(() => vi.restoreAllMocks());
beforeEach(() => sessionStorage.clear());

describe("login", () => {
  it("shows the login screen when signed out and reports wrong credentials", async () => {
    fakeApi({ "POST /auth/login": json(401, { detail: "invalid credentials" }) });
    mount();
    await userEvent.type(screen.getByLabelText("User name"), "elif");
    await userEvent.type(screen.getByLabelText("Password"), "bad");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong user name or password.");
  });

  it("tells the user when the account is locked", async () => {
    fakeApi({ "POST /auth/login": json(423, { detail: "locked" }) });
    mount();
    await userEvent.type(screen.getByLabelText("User name"), "elif");
    await userEvent.type(screen.getByLabelText("Password"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/locked/i);
  });

  it("signs in and lands on the project list with a top bar", async () => {
    fakeApi({
      "POST /auth/login": json(200, { token: "t" }),
      "GET /auth/me": json(200, me()),
      "GET /projects": json(200, projects),
    });
    mount();
    await userEvent.type(screen.getByLabelText("User name"), "elif");
    await userEvent.type(screen.getByLabelText("Password"), "good");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Alpha" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Project" })).toBeInTheDocument(); // project switch
    expect(screen.getByRole("searchbox", { name: "Search requirements" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Language" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "User menu" })).toHaveTextContent("elif");
    expect(sessionStorage.getItem("traqs.token")).toBe("t");
  });
});

describe("signed in", () => {
  const signedIn = (user, extra = {}) => {
    sessionStorage.setItem("traqs.token", "t");
    fakeApi({
      "GET /auth/me": json(200, user),
      "GET /projects": json(200, projects),
      "GET /projects/1": json(200, projects[0]),
      "GET /attribute-types": json(200, TYPES),
      "GET /link-types": json(200, []),
      "GET /projects/1/attributes": json(200, DEFS),
      "GET /projects/1/modules": json(200, [{ id: 7, project_id: 1, name: "System" }]),
      "GET /modules/7/objects": json(200, [
        { id: 1, display_id: "REQ-0001", heading: "Power", text: "", attributes: { priority: "Must" }, children: [
          { id: 2, display_id: "REQ-0002", heading: "Battery", text: "", attributes: { weight: 2.5 }, children: [] },
        ] },
      ]),
      "POST /auth/logout": json(204, null),
      ...extra,
    });
  };

  it("viewer sees read-only navigation and no edit forms", async () => {
    signedIn(me());
    mount("/projects/1/modules");
    expect(await screen.findByRole("heading", { name: /System/ })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Project navigation" });
    expect(nav).toHaveTextContent("Traceability");
    expect(nav).not.toHaveTextContent("Administration");
    expect(nav).not.toHaveTextContent("Import / Export");
    expect(screen.queryByRole("button", { name: "Add module" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add object" })).not.toBeInTheDocument();
  });

  it("author can edit; admin also sees administration", async () => {
    signedIn(me({ memberships: [{ project_id: 1, role: "author" }] }));
    mount("/projects/1/modules");
    expect(await screen.findByRole("button", { name: "Add module" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Project navigation" })).toHaveTextContent("Import / Export");
  });

  it("admin sees all entries and can create projects", async () => {
    signedIn(me({ is_admin: true, memberships: [] }));
    mount("/projects/1/modules");
    expect(await screen.findByRole("navigation", { name: "Project navigation" })).toHaveTextContent("Administration");
  });

  it("shows the object tree and collapses a branch", async () => {
    signedIn(me());
    mount("/projects/1/modules");
    expect(await screen.findByText("Battery")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Collapse REQ-0001/ }));
    expect(screen.queryByText("Battery")).not.toBeInTheDocument();
  });

  it("top-bar search lists matches of the current project and opens the object detail", async () => {
    signedIn(me(), {
      "GET /projects/1/search?q=REQ-0002&limit=10": json(200, [
        { id: 2, display_id: "REQ-0002", heading: "Battery", text: "Lasts 8 h", module_id: 7, module_name: "System" },
      ]),
      "GET /objects/2": json(200, { id: 2, display_id: "REQ-0002", heading: "Battery", text: "Lasts 8 h", module_id: 7 }),
      "GET /objects/2/links": json(200, []),
    });
    mount("/projects/1/modules");
    await screen.findByText("Battery");
    await userEvent.type(screen.getByRole("searchbox"), "REQ-0002");
    const list = await screen.findByRole("list", { name: "Search results" });
    await userEvent.click(within(list).getByRole("button", { name: /REQ-0002/ }));
    expect(await screen.findByRole("heading", { name: /S4 · REQ-0002/ })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Search results" })).not.toBeInTheDocument();
  });

  it("top-bar search says so when nothing matches, and does not search without a project", async () => {
    signedIn(me(), { "GET /projects/1/search?q=zzz&limit=10": json(200, []) });
    mount("/projects/1/modules");
    await screen.findByText("Battery");
    await userEvent.type(screen.getByRole("searchbox"), "zzz");
    expect(await screen.findByText("No matching requirements.")).toBeInTheDocument();
  });

  it("no search request is sent on the project list (no current project)", async () => {
    signedIn(me());
    mount("/projects");
    await screen.findByRole("heading", { name: "Projects" });
    await userEvent.type(screen.getByRole("searchbox"), "abc");
    await new Promise((r) => setTimeout(r, 350));
    expect(global.fetch.mock.calls.some(([u]) => String(u).includes("/search"))).toBe(false);
  });

  it("search in the top bar filters the tree", async () => {
    signedIn(me());
    mount("/projects/1/modules");
    await screen.findByText("Battery");
    await userEvent.type(screen.getByRole("searchbox"), "zzz{enter}");
    await waitFor(() => expect(screen.queryByText("Battery")).not.toBeInTheDocument());
  });

  it("module table has the mock-up columns, outline numbers and role label in the top bar", async () => {
    signedIn(me());
    mount("/projects/1/modules");
    await screen.findByText("Battery");
    for (const h of ["Object tree", "ID", "Text", "Priority", "Weight", "Status", "Flags"]) { // Priority/Weight come from the definitions
      expect(screen.getByRole("columnheader", { name: h })).toBeInTheDocument();
    }
    expect(screen.getByText("1.1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "User menu" })).toHaveTextContent("elif (Viewer)");
  });

  it("attribute columns follow the definitions and show typed values", async () => {
    signedIn(me());
    mount("/projects/1/modules");
    await screen.findByText("Battery");
    const power = screen.getByText("Power").closest("tr");
    expect(within(power).getByText("Must")).toBeInTheDocument();
    const battery = screen.getByText("Battery").closest("tr");
    expect(within(battery).getByText("2.5 kg")).toBeInTheDocument(); // number with its unit
  });

  it("without definitions there are no attribute columns", async () => {
    signedIn(me(), { "GET /projects/1/attributes": json(200, []) });
    mount("/projects/1/modules");
    await screen.findByText("Battery");
    expect(screen.queryByRole("columnheader", { name: "Priority" })).not.toBeInTheDocument();
  });

  it("authors edit attribute values in place; only changed values are sent, empty clears", async () => {
    const puts = [];
    signedIn(me({ memberships: [{ project_id: 1, role: "author" }] }), {
      "PATCH /objects/2": json(200, {}),
      "PUT /objects/2/attributes": (opts) => { puts.push(JSON.parse(opts.body)); return json(200, {}); },
    });
    mount("/projects/1/modules");
    await screen.findByText("Battery");
    await userEvent.click(screen.getByRole("button", { name: "Edit REQ-0002" }));
    await userEvent.selectOptions(screen.getByLabelText("Priority"), "Should"); // select from the enumeration
    const weight = screen.getByLabelText("Weight");
    expect(weight).toHaveValue(2.5);
    await userEvent.clear(weight); // clearing the weight
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(puts).toEqual([{ priority: "Should", weight: null }]));
  });

  it("nothing is sent for attributes when none was changed", async () => {
    const puts = [];
    signedIn(me({ memberships: [{ project_id: 1, role: "author" }] }), {
      "PATCH /objects/2": json(200, {}),
      "PUT /objects/2/attributes": (opts) => { puts.push(opts.body); return json(200, {}); },
    });
    mount("/projects/1/modules");
    await screen.findByText("Battery");
    await userEvent.click(screen.getByRole("button", { name: "Edit REQ-0002" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument());
    expect(puts).toEqual([]);
  });

  it("object detail shows text, links with a suspect tag and the AI panel", async () => {
    signedIn(me(), {
      "GET /objects/2": json(200, { id: 2, display_id: "REQ-0002", heading: "Battery", text: "Lasts 8 h", module_id: 7, children: [] }),
      "GET /objects/2/links": json(200, [{
        id: 1, source_id: 2, target_id: 9, type: "Derives", suspect: 1,
        source: { id: 2, display_id: "REQ-0002", heading: "Battery", module_id: 7, module_name: "System", deleted: false },
        target: { id: 9, display_id: "REQ-0009", heading: "Gone", module_id: 7, module_name: "System", deleted: true },
      }]),
    });
    mount("/projects/1/objects/2");
    expect(await screen.findByRole("heading", { name: /REQ-0002/ })).toBeInTheDocument();
    expect(screen.getByText("Lasts 8 h")).toBeInTheDocument();
    expect(screen.getByText("deleted object")).toBeInTheDocument();
    expect(screen.getByText("suspect")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /AI assistant/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Classify" })).toBeDisabled();
    expect(screen.getByText(/Priority:/)).toBeInTheDocument(); // attributes come from the definitions
  });

  it("change request and analysis screens render with a sample-data note", async () => {
    signedIn(me());
    const { unmount } = mount("/projects/1/changes");
    expect(await screen.findByRole("heading", { name: /CR-007/ })).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Sample data");
    unmount();
    mount("/projects/1/analysis");
    expect(await screen.findByRole("heading", { name: /Analysis dashboard/ })).toBeInTheDocument();
    expect(screen.getByText("92 %")).toBeInTheDocument();
  });

  it("authors can drag a row onto another one and the move is sent to the API", async () => {
    const moves = [];
    signedIn(me({ memberships: [{ project_id: 1, role: "author" }] }), {
      "GET /modules/7/objects": json(200, [
        { id: 1, display_id: "REQ-0001", heading: "Power", text: "", parent_id: null, children: [] },
        { id: 2, display_id: "REQ-0002", heading: "Display", text: "", parent_id: null, children: [] },
      ]),
      "POST /objects/2/move": (opts) => { moves.push(JSON.parse(opts.body)); return json(200, {}); },
    });
    mount("/projects/1/modules");
    const rowOf = (name) => screen.getByText(name).closest("tr");
    await screen.findByText("Display");
    const dt = { setData() {}, effectAllowed: "" };
    fireEvent.dragStart(rowOf("Display"), { dataTransfer: dt });
    fireEvent.dragOver(rowOf("Power"), { dataTransfer: dt });
    fireEvent.drop(rowOf("Power"), { dataTransfer: dt });
    await waitFor(() => expect(moves).toEqual([{ parent_id: 1, position: null }]));
  });

  it("authors add an object with heading and text", async () => {
    const posts = [];
    signedIn(me({ memberships: [{ project_id: 1, role: "author" }] }), {
      "POST /modules/7/objects": (opts) => { posts.push(JSON.parse(opts.body)); return json(201, { id: 9 }); },
    });
    mount("/projects/1/modules");
    await userEvent.click(await screen.findByRole("button", { name: "+ Object" }));
    await userEvent.type(screen.getByLabelText("Heading"), "Alarm");
    await userEvent.type(screen.getByLabelText("Text (optional)"), "The system shall raise an alarm.");
    await userEvent.click(screen.getByRole("button", { name: "Add object" }));
    await waitFor(() => expect(posts).toEqual([{ heading: "Alarm", text: "The system shall raise an alarm." }]));
  });

  it("authors delete an object after confirming; cancelling does nothing", async () => {
    const deleted = [];
    signedIn(me({ memberships: [{ project_id: 1, role: "author" }] }), {
      "DELETE /objects/2": () => { deleted.push(2); return json(204, null); },
    });
    const confirm = vi.spyOn(window, "confirm");
    mount("/projects/1/modules");
    await screen.findByText("Battery");
    confirm.mockReturnValueOnce(false);
    await userEvent.click(screen.getByRole("button", { name: "Delete REQ-0002" }));
    expect(deleted).toEqual([]);
    confirm.mockReturnValueOnce(true);
    await userEvent.click(screen.getByRole("button", { name: "Delete REQ-0002" }));
    await waitFor(() => expect(deleted).toEqual([2]));
    expect(confirm.mock.calls[1][0]).toMatch(/REQ-0002/);
  });

  it("authors edit heading and text of an object in place", async () => {
    const patches = [];
    signedIn(me({ memberships: [{ project_id: 1, role: "author" }] }), {
      "PATCH /objects/2": (opts) => { patches.push(JSON.parse(opts.body)); return json(200, {}); },
    });
    mount("/projects/1/modules");
    await screen.findByText("Battery");
    await userEvent.click(screen.getByRole("button", { name: "Edit REQ-0002" }));
    const heading = screen.getByLabelText("Heading");
    expect(heading).toHaveValue("Battery");
    await userEvent.clear(heading);
    await userEvent.type(heading, "Battery life");
    await userEvent.type(screen.getByLabelText("Text (optional)"), "At least 8 h.");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patches).toEqual([{ heading: "Battery life", text: "At least 8 h." }]));
    expect(screen.queryByLabelText("Heading")).not.toBeInTheDocument(); // editing ended
  });

  it("cancel and Escape leave the object unchanged", async () => {
    const patches = [];
    signedIn(me({ memberships: [{ project_id: 1, role: "author" }] }), {
      "PATCH /objects/2": (opts) => { patches.push(opts.body); return json(200, {}); },
    });
    mount("/projects/1/modules");
    await screen.findByText("Battery");
    await userEvent.click(screen.getByRole("button", { name: "Edit REQ-0002" }));
    await userEvent.type(screen.getByLabelText("Heading"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: "Edit REQ-0002" }));
    await userEvent.type(screen.getByLabelText("Heading"), "y{Escape}");
    expect(screen.queryByLabelText("Heading")).not.toBeInTheDocument();
    expect(patches).toEqual([]);
  });

  it("viewers see no edit buttons", async () => {
    signedIn(me());
    mount("/projects/1/modules");
    await screen.findByText("Battery");
    expect(screen.queryByRole("button", { name: /^Edit REQ/ })).not.toBeInTheDocument();
  });

  it("viewers see no delete buttons", async () => {
    signedIn(me());
    mount("/projects/1/modules");
    await screen.findByText("Battery");
    expect(screen.queryByRole("button", { name: /^Delete/ })).not.toBeInTheDocument();
  });

  it("viewers cannot drag rows", async () => {
    signedIn(me());
    mount("/projects/1/modules");
    await screen.findByText("Battery");
    expect(screen.getByText("Battery").closest("tr")).not.toHaveAttribute("draggable", "true");
  });

  it("an address of a project that does not exist shows a clear message and a way back", async () => {
    signedIn(me({ is_admin: true, memberships: [] }), {
      "GET /projects/9": json(404, { detail: "Project 9 not found" }),
    });
    mount("/projects/9/modules");
    expect(await screen.findByRole("alert")).toHaveTextContent("This project does not exist, or you have no access to it.");
    expect(screen.getByRole("link", { name: "Back to projects" })).toHaveAttribute("href", "/projects");
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });

  it("a user without access to the project gets a not-found message", async () => {
    signedIn(me({ memberships: [] }));
    mount("/projects/1/modules");
    expect(await screen.findByRole("alert")).toHaveTextContent("does not exist, or you have no access");
  });

  it("log out returns to the login screen", async () => {
    signedIn(me());
    mount("/projects");
    await userEvent.click(await screen.findByRole("button", { name: "User menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Log out" }));
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(sessionStorage.getItem("traqs.token")).toBeNull();
  });
});
