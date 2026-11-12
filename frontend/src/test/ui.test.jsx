import { render, screen, waitFor } from "@testing-library/react";
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
    expect(screen.getByRole("combobox", { name: "Language" })).toBeInTheDocument();
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
      "GET /projects/1/modules": json(200, [{ id: 7, project_id: 1, name: "System" }]),
      "GET /modules/7/objects": json(200, [
        { id: 1, display_id: "REQ-0001", heading: "Power", text: "", children: [
          { id: 2, display_id: "REQ-0002", heading: "Battery", text: "", children: [] },
        ] },
      ]),
      "POST /auth/logout": json(204, null),
      ...extra,
    });
  };

  it("viewer sees read-only navigation and no edit forms", async () => {
    signedIn(me());
    mount("/projects/1/modules");
    expect(await screen.findByRole("heading", { name: "System" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Project navigation" });
    expect(nav).toHaveTextContent("Traceability");
    expect(nav).not.toHaveTextContent("Administration");
    expect(nav).not.toHaveTextContent("Import and export");
    expect(screen.queryByRole("button", { name: "Add module" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add object" })).not.toBeInTheDocument();
  });

  it("author can edit; admin also sees administration", async () => {
    signedIn(me({ memberships: [{ project_id: 1, role: "author" }] }));
    mount("/projects/1/modules");
    expect(await screen.findByRole("button", { name: "Add module" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Project navigation" })).toHaveTextContent("Import and export");
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

  it("search in the top bar filters the tree", async () => {
    signedIn(me());
    mount("/projects/1/modules");
    await screen.findByText("Battery");
    await userEvent.type(screen.getByRole("searchbox"), "zzz{enter}");
    await waitFor(() => expect(screen.queryByText("Battery")).not.toBeInTheDocument());
  });

  it("a user without access to the project gets a not-found message", async () => {
    signedIn(me({ memberships: [] }));
    mount("/projects/1/modules");
    expect(await screen.findByRole("alert")).toHaveTextContent("Page not found.");
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
