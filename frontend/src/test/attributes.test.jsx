import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App.jsx";
import { registerInput } from "../attributes/inputs.jsx";
import { AuthProvider } from "../auth.jsx";
import { I18nProvider } from "../i18n.jsx";

const json = (status, body) => ({ ok: status < 400, status, statusText: "x", text: async () => (body === null ? "" : JSON.stringify(body)) });
const mount = (path = "/projects/1/attributes") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <I18nProvider>
        <AuthProvider>
          <Routes><Route path="*" element={<App />} /></Routes>
        </AuthProvider>
      </I18nProvider>
    </MemoryRouter>
  );

const TYPES = [
  { type: "text", label: "Text", input: "text", option_fields: [{ key: "max_length", label: "Maximum length", kind: "integer" }] },
  { type: "enumeration", label: "Enumeration", input: "select", option_fields: [{ key: "values", label: "Allowed values", kind: "string-list" }] },
  { type: "number", label: "Number", input: "number", option_fields: [
    { key: "integer", label: "Whole numbers only", kind: "boolean" }, { key: "min", label: "Minimum", kind: "number" }, { key: "unit", label: "Unit", kind: "string" }] },
  { type: "date", label: "Date", input: "date", option_fields: [] },
];
const def = (id, name, type, options = {}) => ({ id, project_id: 1, key: name.toLowerCase(), name, description: "", type, options, position: id });
const author = { id: 2, username: "au", is_admin: false, memberships: [{ project_id: 1, role: "author" }] };
const viewer = { id: 3, username: "vi", is_admin: false, memberships: [{ project_id: 1, role: "viewer" }] };

let calls;
function backend(me, defs, extra = {}) {
  sessionStorage.setItem("traqs.token", "t");
  calls = [];
  const routes = {
    "GET /auth/me": json(200, me),
    "GET /projects": json(200, [{ id: 1, name: "Alpha", description: "" }]),
    "GET /projects/1": json(200, { id: 1, name: "Alpha", description: "" }),
    "GET /attribute-types": json(200, TYPES),
    "GET /projects/1/attributes": () => json(200, defs),
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

beforeEach(() => sessionStorage.clear());

describe("Attribute definition screen", () => {
  it("lists definitions with type and a summary of the options", async () => {
    backend(author, [def(1, "Priority", "enumeration", { values: ["Must", "Should"] }), def(2, "Weight", "number", { integer: true, unit: "kg" })]);
    mount();
    const row = (await screen.findByText("Priority")).closest("tr");
    expect(within(row).getByText("Enumeration")).toBeInTheDocument();
    expect(within(row).getByText("Must, Should")).toBeInTheDocument();
    const w = screen.getByText("Weight").closest("tr");
    expect(within(w).getByText(/Whole numbers only · Unit: kg/)).toBeInTheDocument();
  });

  it("builds the option form from the type the server describes", async () => {
    backend(author, []);
    mount();
    const form = await screen.findByRole("form", { name: "New attribute" });
    // default type is the first one: text with its single option field
    expect(within(form).getByLabelText("Maximum length")).toBeInTheDocument();
    await userEvent.selectOptions(within(form).getByLabelText("Type"), "enumeration");
    expect(within(form).getByLabelText("Allowed values (one per line)")).toBeInTheDocument();
    expect(within(form).queryByLabelText("Maximum length")).not.toBeInTheDocument();
    await userEvent.selectOptions(within(form).getByLabelText("Type"), "number");
    expect(within(form).getByLabelText("Whole numbers only")).toHaveAttribute("type", "checkbox");
    expect(within(form).getByLabelText("Minimum")).toHaveAttribute("type", "number");
    expect(within(form).getByLabelText("Unit")).toHaveAttribute("type", "text");
    await userEvent.selectOptions(within(form).getByLabelText("Type"), "date");
    expect(within(form).queryByLabelText("Unit")).not.toBeInTheDocument(); // a type without options
  });

  it("creates an enumeration with its values", async () => {
    backend(author, [], { "POST /projects/1/attributes": json(201, def(5, "Risk", "enumeration")) });
    mount();
    const form = await screen.findByRole("form", { name: "New attribute" });
    await userEvent.type(within(form).getByLabelText("Name"), "Risk");
    await userEvent.selectOptions(within(form).getByLabelText("Type"), "enumeration");
    await userEvent.type(within(form).getByLabelText("Allowed values (one per line)"), "Low{enter}Medium{enter}High");
    await userEvent.click(within(form).getByRole("button", { name: "Create attribute" }));
    await waitFor(() => expect(sent("POST /projects/1/attributes")).toEqual([
      { name: "Risk", description: "", type: "enumeration", options: { values: ["Low", "Medium", "High"] } },
    ]));
  });

  it("sends numbers as numbers and leaves empty options out", async () => {
    backend(author, [], { "POST /projects/1/attributes": json(201, def(5, "W", "number")) });
    mount();
    const form = await screen.findByRole("form", { name: "New attribute" });
    await userEvent.type(within(form).getByLabelText("Name"), "Weight");
    await userEvent.selectOptions(within(form).getByLabelText("Type"), "number");
    await userEvent.click(within(form).getByLabelText("Whole numbers only"));
    await userEvent.type(within(form).getByLabelText("Minimum"), "0");
    await userEvent.click(within(form).getByRole("button", { name: "Create attribute" }));
    await waitFor(() => expect(sent("POST /projects/1/attributes")).toEqual([
      { name: "Weight", description: "", type: "number", options: { integer: true, min: 0 } },
    ]));
  });

  it("shows why the server rejected an attribute", async () => {
    backend(author, [], { "POST /projects/1/attributes": json(422, { detail: "values must be a non-empty list" }) });
    mount();
    const form = await screen.findByRole("form", { name: "New attribute" });
    await userEvent.type(within(form).getByLabelText("Name"), "Risk");
    await userEvent.selectOptions(within(form).getByLabelText("Type"), "enumeration");
    await userEvent.click(within(form).getByRole("button", { name: "Create attribute" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("values must be a non-empty list");
  });

  it("edits name and options; type and key stay fixed", async () => {
    backend(author, [def(1, "Priority", "enumeration", { values: ["Must", "Should"] })], { "PATCH /attributes/1": json(200, {}) });
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Edit Priority" }));
    const form = screen.getByRole("form", { name: "Edit attribute" });
    expect(within(form).queryByLabelText("Type")).not.toBeInTheDocument();
    const values = within(form).getByLabelText("Allowed values (one per line)");
    expect(values).toHaveValue("Must\nShould");
    await userEvent.type(values, "{enter}Could");
    await userEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent("PATCH /attributes/1")).toEqual([{ name: "Priority", description: "", options: { values: ["Must", "Should", "Could"] } }]));
  });

  it("deletes after confirmation and reorders", async () => {
    backend(author, [def(1, "Priority", "text"), def(2, "Level", "text")], {
      "DELETE /attributes/2": json(204, null),
      "PUT /projects/1/attributes/order": json(200, []),
    });
    const confirm = vi.spyOn(window, "confirm");
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Move down Priority" }));
    await waitFor(() => expect(sent("PUT /projects/1/attributes/order")).toEqual([{ ids: [2, 1] }]));
    confirm.mockReturnValueOnce(false);
    await userEvent.click(screen.getByRole("button", { name: "Delete Level" }));
    expect(sent("DELETE /attributes/2")).toEqual([]);
    confirm.mockReturnValueOnce(true);
    await userEvent.click(screen.getByRole("button", { name: "Delete Level" }));
    await waitFor(() => expect(sent("DELETE /attributes/2")).toHaveLength(1));
  });

  it("adds the configured default attributes on request", async () => {
    backend(author, [], { "POST /projects/1/attributes/defaults": json(201, []) });
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Add default attributes" }));
    await waitFor(() => expect(sent("POST /projects/1/attributes/defaults")).toHaveLength(1));
  });

  it("viewers see the definitions but no forms or buttons", async () => {
    backend(viewer, [def(1, "Priority", "text")]);
    mount();
    // viewers do not even get the navigation entry; the screen itself is read-only if opened
    await screen.findByText("Priority");
    expect(screen.queryByRole("form", { name: "New attribute" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit|Delete|Move/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Attributes" })).not.toBeInTheDocument();
  });
});

describe("Modularity: nothing about attributes is hard-coded", () => {
  it("a type the UI has never seen still gets a form and a text-style input", async () => {
    const custom = { type: "tags", label: "Tags", input: "tags-widget", option_fields: [{ key: "colour", label: "Colour", kind: "string" }] };
    backend(author, [def(1, "Labels", "tags")], { "GET /attribute-types": json(200, [...TYPES, custom]) });
    mount();
    expect((await screen.findByText("Labels")).closest("tr")).toHaveTextContent("Tags"); // label sent by the server
    const form = screen.getByRole("form", { name: "New attribute" });
    await userEvent.selectOptions(within(form).getByLabelText("Type"), "tags");
    expect(within(form).getByLabelText("Colour")).toBeInTheDocument(); // field text comes from the server
    expect(within(form).getByRole("option", { name: "Tags" })).toBeInTheDocument();
  });

  it("a new input kind can be plugged in with registerInput", async () => {
    registerInput("stars", {
      Display: ({ value }) => <>{"★".repeat(value)}</>,
      Editor: ({ value, onChange, label }) => <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />,
      initial: (v) => (v ? String(v) : ""),
      parse: (raw) => (raw === "" ? null : Number(raw)),
    });
    const types = [...TYPES, { type: "rating", label: "Rating", input: "stars", option_fields: [] }];
    backend(author, [def(1, "Quality", "rating")], {
      "GET /attribute-types": json(200, types),
      "GET /projects/1/modules": json(200, [{ id: 7, project_id: 1, name: "S" }]),
      "GET /modules/7/objects": json(200, [{ id: 1, display_id: "REQ-0001", heading: "Power", text: "", attributes: { quality: 3 }, children: [] }]),
    });
    mount("/projects/1/modules");
    expect(await screen.findByText("★★★")).toBeInTheDocument();
  });
});
