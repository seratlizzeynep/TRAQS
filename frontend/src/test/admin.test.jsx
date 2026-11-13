import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App.jsx";
import { AuthProvider } from "../auth.jsx";
import { I18nProvider } from "../i18n.jsx";

const json = (status, body) => ({ ok: status < 400, status, statusText: "x", text: async () => (body === null ? "" : JSON.stringify(body)) });
const mount = () =>
  render(
    <MemoryRouter initialEntries={["/projects/1/admin"]}>
      <I18nProvider>
        <AuthProvider>
          <Routes><Route path="*" element={<App />} /></Routes>
        </AuthProvider>
      </I18nProvider>
    </MemoryRouter>
  );

const globalAdmin = { id: 1, username: "root", is_admin: true, memberships: [] };
const projectAdmin = { id: 2, username: "pa", is_admin: false, memberships: [{ project_id: 1, role: "admin" }] };
const members = [{ user_id: 3, username: "ali", role: "viewer" }];
const users = [
  { id: 1, username: "root", is_admin: true, locked: false },
  { id: 3, username: "ali", is_admin: false, locked: true },
  { id: 4, username: "veli", is_admin: false, locked: false },
];

let calls;
function backend(me, extra = {}) {
  sessionStorage.setItem("traqs.token", "t");
  calls = [];
  const routes = {
    "GET /auth/me": json(200, me),
    "GET /projects": json(200, [{ id: 1, name: "Alpha", description: "" }]),
    "GET /projects/1/members": json(200, members),
    "GET /users": json(200, users),
    ...extra,
  };
  global.fetch = vi.fn(async (url, opts = {}) => {
    const key = `${opts.method ?? "GET"} ${String(url).replace("/api/v1", "")}`;
    calls.push([key, opts.body ? JSON.parse(opts.body) : undefined]);
    return routes[key] ?? json(204, null);
  });
}
const called = (key) => calls.filter(([k]) => k === key);

beforeEach(() => sessionStorage.clear());

describe("Administration (S13)", () => {
  it("global administrator sees members and users, and can reset a password", async () => {
    backend(globalAdmin);
    mount();
    expect(await screen.findByRole("heading", { name: /Administration/ })).toBeInTheDocument();
    expect(await screen.findByRole("cell", { name: "veli" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reset password veli" }));
    await userEvent.type(screen.getByLabelText("New password"), "brand-new-pass");
    await userEvent.click(screen.getByRole("button", { name: "Set password" }));
    await waitFor(() => expect(called("PUT /users/4/password")).toEqual([["PUT /users/4/password", { password: "brand-new-pass" }]]));
    expect(await screen.findByRole("status")).toHaveTextContent("Saved.");
  });

  it("creates an account and explains a too short password / duplicate user", async () => {
    backend(globalAdmin, { "POST /users": json(422, { detail: "short" }) });
    mount();
    await screen.findByRole("cell", { name: "veli" });
    const form = screen.getByRole("form", { name: "Create user" });
    await userEvent.type(within(form).getByLabelText("User name"), "newbie");
    await userEvent.type(within(form).getByLabelText("Password"), "abc");
    await userEvent.click(within(form).getByRole("button", { name: "Create" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("at least 8 characters");
    expect(called("POST /users")[0][1]).toEqual({ username: "newbie", password: "abc", is_admin: false });
  });

  it("changes the role of a member per project and removes a member", async () => {
    backend(globalAdmin);
    mount();
    await screen.findByRole("cell", { name: "veli" });
    await userEvent.selectOptions(screen.getByLabelText("Role ali"), "author");
    await waitFor(() => expect(called("PUT /projects/1/members/3")).toEqual([["PUT /projects/1/members/3", { role: "author" }]]));
    await userEvent.click(screen.getByRole("button", { name: "Remove ali" }));
    await waitFor(() => expect(called("DELETE /projects/1/members/3")).toHaveLength(1));
  });

  it("adds a user to the project with a role; admins and members are not offered", async () => {
    backend(globalAdmin);
    mount();
    await screen.findByRole("cell", { name: "veli" });
    const pick = screen.getByLabelText("Select user…");
    expect(within(pick).queryByRole("option", { name: "root" })).not.toBeInTheDocument(); // global admin
    expect(within(pick).queryByRole("option", { name: "ali" })).not.toBeInTheDocument(); // already a member
    await userEvent.selectOptions(pick, "veli");
    await userEvent.selectOptions(screen.getByLabelText("Role", { selector: "select:not([aria-label^='Role '])" }), "reviewer");
    await userEvent.click(screen.getByRole("button", { name: "Add member" }));
    await waitFor(() => expect(called("PUT /projects/1/members/4")).toEqual([["PUT /projects/1/members/4", { role: "reviewer" }]]));
  });

  it("unlocks a locked account", async () => {
    backend(globalAdmin);
    mount();
    await screen.findByText("locked");
    await userEvent.click(screen.getByRole("button", { name: "Unlock ali" }));
    await waitFor(() => expect(called("POST /users/3/unlock")).toHaveLength(1));
  });

  it("a project administrator manages members but sees no user management", async () => {
    backend(projectAdmin);
    mount();
    expect(await screen.findByText("ali")).toBeInTheDocument();
    expect(screen.getByLabelText("Role ali")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Users" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add member" })).not.toBeInTheDocument();
    expect(called("GET /users")).toHaveLength(0); // the user list is never requested
  });

  it("authors and viewers do not get the screen", async () => {
    backend({ id: 5, username: "au", is_admin: false, memberships: [{ project_id: 1, role: "author" }] });
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Page not found.");
  });
});
