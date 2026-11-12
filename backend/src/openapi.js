// OpenAPI 3.0 description of the TRAQS REST API (served at /api/v1/openapi.json, UI at /api/v1/docs).
const idParam = { name: "id", in: "path", required: true, schema: { type: "integer" } };
const json = (schema) => ({ "application/json": { schema } });
const ref = (n) => ({ $ref: `#/components/schemas/${n}` });
const body = (schema) => ({ required: true, content: json(schema) });
const ok = (description, schema, code = "200") => ({
  [code]: schema ? { description, content: json(schema) } : { description },
});
const errs = {
  401: { description: "Missing, invalid or expired token" },
  403: { description: "No permission for this project or action" },
  404: { description: "Not found" },
  422: { description: "Validation error" },
};
const op = (summary, tag, { params = [], requestBody, responses, secured = true } = {}) => ({
  summary,
  tags: [tag],
  parameters: params,
  ...(requestBody ? { requestBody } : {}),
  ...(secured ? { security: [{ bearerAuth: [] }] } : {}),
  responses: { ...responses, ...(secured ? errs : {}) },
});
const arr = (s) => ({ type: "array", items: s });

export const openapi = {
  openapi: "3.0.3",
  info: {
    title: "TRAQS REST API",
    version: "1.0.0",
    description:
      "Versioned REST API (all paths live under /api/v1). Authenticate with a JWT in the " +
      "`Authorization: Bearer <token>` header. Calls without a grant for the project are rejected with 403.",
  },
  servers: [{ url: "/api/v1" }],
  tags: [
    { name: "Projects" },
    { name: "Modules" },
    { name: "Objects" },
    { name: "Links" },
    { name: "Meta" },
    { name: "Auth" },
    { name: "Users" },
  ],
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
    schemas: {
      Project: {
        type: "object",
        properties: { id: { type: "integer" }, name: { type: "string" }, description: { type: "string" } },
      },
      ProjectInput: {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string", maxLength: 200 }, description: { type: "string" } },
      },
      ProjectUpdate: {
        type: "object",
        properties: { name: { type: "string", maxLength: 200 }, description: { type: "string" } },
      },
      Module: {
        type: "object",
        properties: {
          id: { type: "integer" },
          project_id: { type: "integer" },
          name: { type: "string" },
          description: { type: "string" },
        },
      },
      Object: {
        type: "object",
        properties: {
          id: { type: "integer" },
          display_id: { type: "string", example: "REQ-0001" },
          module_id: { type: "integer" },
          parent_id: { type: "integer", nullable: true },
          position: { type: "integer", description: "0-based index among siblings" },
          heading: { type: "string" },
          text: { type: "string" },
        },
      },
      ObjectNode: {
        allOf: [ref("Object"), { type: "object", properties: { children: arr({ $ref: "#/components/schemas/ObjectNode" }) } }],
      },
      ObjectInput: {
        type: "object",
        properties: {
          heading: { type: "string", maxLength: 300 },
          text: { type: "string" },
          parent_id: { type: "integer", nullable: true },
          position: { type: "integer", minimum: 0, description: "Omitted = append" },
        },
      },
      ObjectUpdate: {
        type: "object",
        properties: { heading: { type: "string", maxLength: 300 }, text: { type: "string" } },
      },
      ObjectMove: {
        type: "object",
        properties: { parent_id: { type: "integer", nullable: true }, position: { type: "integer", minimum: 0 } },
      },
      Link: {
        type: "object",
        properties: {
          id: { type: "integer" },
          source_id: { type: "integer" },
          target_id: { type: "integer" },
          suspect: { type: "integer", enum: [0, 1], description: "1 when an end of the link was deleted" },
        },
      },
      Role: { type: "string", enum: ["admin", "author", "reviewer", "viewer"] },
      LoginInput: {
        type: "object",
        required: ["username", "password"],
        properties: { username: { type: "string" }, password: { type: "string", format: "password" } },
      },
      User: {
        type: "object",
        properties: {
          id: { type: "integer" },
          username: { type: "string" },
          is_admin: { type: "boolean" },
          locked: { type: "boolean" },
        },
      },
      UserInput: {
        type: "object",
        required: ["username", "password"],
        properties: {
          username: { type: "string" },
          password: { type: "string", minLength: 8 },
          is_admin: { type: "boolean" },
        },
      },
      Member: {
        type: "object",
        properties: { user_id: { type: "integer" }, role: ref("Role") },
      },
      BlacklistEntry: {
        type: "object",
        properties: { display_id: { type: "string" }, deleted_at: { type: "string", format: "date-time" } },
      },
    },
  },
  paths: {
    "/auth/login": {
      post: op("Log in; returns a JWT (expires after 30 min of inactivity, account locks after 5 failures)", "Auth", {
        secured: false,
        requestBody: body(ref("LoginInput")),
        responses: {
          ...ok("Token", {
            type: "object",
            properties: {
              token: { type: "string" },
              token_type: { type: "string", example: "Bearer" },
              inactivity_timeout_sec: { type: "integer" },
              user: ref("User"),
            },
          }),
          401: { description: "Invalid credentials" },
          423: { description: "Account locked" },
        },
      }),
    },
    "/auth/logout": { post: op("End the session", "Auth", { responses: ok("Logged out", null, "204") }) },
    "/auth/me": {
      get: op("Current user and memberships", "Auth", {
        responses: ok("User", {
          allOf: [ref("User"), { type: "object", properties: { memberships: arr({ type: "object" }) } }],
        }),
      }),
    },
    "/users": {
      get: op("List users (administrator)", "Users", { responses: ok("Users", arr(ref("User"))) }),
      post: op("Create a user (administrator)", "Users", {
        requestBody: body(ref("UserInput")),
        responses: ok("Created", ref("User"), "201"),
      }),
    },
    "/users/{id}/unlock": {
      post: op("Unlock a locked account (administrator)", "Users", { params: [idParam], responses: ok("User", ref("User")) }),
    },
    "/projects/{id}/members": {
      get: op("Members and roles of a project", "Projects", { params: [idParam], responses: ok("Members", arr(ref("Member"))) }),
    },
    "/projects/{id}/members/{userId}": {
      put: op("Set the role of a user in a project", "Projects", {
        params: [idParam, { name: "userId", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: body({ type: "object", required: ["role"], properties: { role: ref("Role") } }),
        responses: ok("Member", ref("Member")),
      }),
      delete: op("Remove a user from a project", "Projects", {
        params: [idParam, { name: "userId", in: "path", required: true, schema: { type: "integer" } }],
        responses: ok("Removed", null, "204"),
      }),
    },
    "/openapi.json": { get: op("This document", "Meta", { secured: false, responses: ok("OpenAPI document") }) },
    "/projects": {
      get: op("List the projects the caller may access", "Projects", { responses: ok("Projects", arr(ref("Project"))) }),
      post: op("Create a project", "Projects", {
        requestBody: body(ref("ProjectInput")),
        responses: ok("Created", ref("Project"), "201"),
      }),
    },
    "/projects/{id}": {
      get: op("Read a project", "Projects", { params: [idParam], responses: ok("Project", ref("Project")) }),
      patch: op("Update a project", "Projects", {
        params: [idParam],
        requestBody: body(ref("ProjectUpdate")),
        responses: ok("Project", ref("Project")),
      }),
      delete: op("Delete a project with its modules and objects", "Projects", {
        params: [idParam],
        responses: ok("Deleted", null, "204"),
      }),
    },
    "/projects/{id}/modules": {
      get: op("List modules of a project", "Modules", { params: [idParam], responses: ok("Modules", arr(ref("Module"))) }),
      post: op("Create a module", "Modules", {
        params: [idParam],
        requestBody: body(ref("ProjectInput")),
        responses: ok("Created", ref("Module"), "201"),
      }),
    },
    "/projects/{id}/id-blacklist": {
      get: op("IDs of deleted objects that are never issued again", "Projects", {
        params: [idParam],
        responses: ok("Blacklist", arr(ref("BlacklistEntry"))),
      }),
    },
    "/modules/{id}": {
      get: op("Read a module", "Modules", { params: [idParam], responses: ok("Module", ref("Module")) }),
      patch: op("Update a module", "Modules", {
        params: [idParam],
        requestBody: body(ref("ProjectUpdate")),
        responses: ok("Module", ref("Module")),
      }),
      delete: op("Delete a module", "Modules", { params: [idParam], responses: ok("Deleted", null, "204") }),
    },
    "/modules/{id}/objects": {
      get: op("Objects of a module as an ordered tree", "Objects", {
        params: [idParam, { name: "flat", in: "query", schema: { type: "boolean" }, description: "Flat list instead of tree" }],
        responses: ok("Tree", arr(ref("ObjectNode"))),
      }),
      post: op("Create an object (optionally under a parent, at a position)", "Objects", {
        params: [idParam],
        requestBody: body(ref("ObjectInput")),
        responses: ok("Created", ref("Object"), "201"),
      }),
    },
    "/objects/{id}": {
      get: op("Read an object", "Objects", { params: [idParam], responses: ok("Object", ref("Object")) }),
      patch: op("Update heading/text", "Objects", {
        params: [idParam],
        requestBody: body(ref("ObjectUpdate")),
        responses: ok("Object", ref("Object")),
      }),
      delete: op("Soft-delete an object and its subtree; IDs are blacklisted", "Objects", {
        params: [idParam],
        responses: ok("Deleted", null, "204"),
      }),
    },
    "/objects/{id}/move": {
      post: op("Re-parent and/or reorder an object", "Objects", {
        params: [idParam],
        requestBody: body(ref("ObjectMove")),
        responses: ok("Object", ref("Object")),
      }),
    },
    "/objects/{id}/links": {
      get: op("Links of an object", "Links", { params: [idParam], responses: ok("Links", arr(ref("Link"))) }),
      post: op("Create a link to another object of the same project", "Links", {
        params: [idParam],
        requestBody: body({ type: "object", required: ["target_id"], properties: { target_id: { type: "integer" } } }),
        responses: ok("Created", ref("Link"), "201"),
      }),
    },
  },
};

// Swagger UI loaded from a pinned CDN version.
export const docsHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>TRAQS API</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css"></head>
<body><div id="ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({ url: "openapi.json", dom_id: "#ui" });</script></body></html>`;
