# TRAQS

TRAQS is a web-based requirements management tool. Users capture requirements in projects and
modules, organize them as ordered trees, and work with them according to their role.
The reports are in [`docs/`](docs/) and the project web page is [`index.html`](index.html).

## Features

- Projects, modules and hierarchical, ordered objects (parent/child with an explicit position)
- Sequential object IDs (`REQ-0001`), soft delete with an ID blacklist (an ID is never reused)
- Typed links between objects (Derives, Satisfies, Verifies, Refers), within and across modules; links to deleted objects become *suspect*
- User-defined, typed attributes per project (text, enumeration, number, date) shown as columns in the module table
- Versioned REST API under `/api/v1` with OpenAPI documentation
- Login with salted password hashes, JWT sessions (30 min inactivity timeout), account lock after 5 failed logins
- Roles per project: Admin, Author, Reviewer, Viewer
- React single-page app with Turkish and English interface

Screens S7 (change request) and S12 (analysis dashboard) are mock-ups with sample data; the
AI assistant, baselines, traceability and import/export are not built yet.

## Repository layout

| Path | Content |
|---|---|
| `backend/` | Node.js (Express) API with SQLite, tests in `backend/test` |
| `frontend/` | React app (Vite), tests in `frontend/src/test` |
| `docker-compose.yml` | Runs API and web app together |
| `docs/` | Analysis and Specifications reports |

## Run with Docker

Requires Docker Desktop (or Docker Engine with Compose).

```bash
docker compose up --build
```

- App: <http://localhost:8080>
- API documentation: <http://localhost:8000/api/v1/docs>
- First login: user `admin`, password `12345` (change it, see below)

The administrator is created only while the database is empty. To start over with new
credentials, delete the data volume:

```bash
docker compose down -v
```

Set your own values in a `.env` file next to `docker-compose.yml`:

```
TRAQS_ADMIN_PASSWORD=choose-a-password
TRAQS_JWT_SECRET=a-long-random-string
```

## Run without Docker

Requires Node.js 22 or newer.

```bash
cd backend
npm install
TRAQS_JWT_SECRET=secret TRAQS_ADMIN_USER=admin TRAQS_ADMIN_PASSWORD=12345 npm start
```

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. The dev server proxies `/api` to the backend on port 8000.

## Tests

```bash
cd backend && npm test
cd frontend && npm test
```

## Configuration (backend)

| Variable | Default | Meaning |
|---|---|---|
| `TRAQS_JWT_SECRET` | random per start | Secret used to sign tokens. Set it, or tokens become invalid on restart |
| `TRAQS_ADMIN_USER`, `TRAQS_ADMIN_PASSWORD` | none | Creates the first administrator when no users exist |
| `TRAQS_DATABASE` | `traqs.db` | SQLite file |
| `TRAQS_LINK_RULES` | `backend/config/link-rules.json` | Link types and link rules (one file) |
| `TRAQS_DEFAULT_ATTRIBUTES` | `backend/config/default-attributes.json` | Attributes every new project starts with. Empty value = none |
| `PORT` | `8000` | API port |
| `TRAQS_SESSION_TIMEOUT_MIN` | `30` | Inactivity timeout of a session |
| `TRAQS_MAX_FAILED_LOGINS` | `5` | Failed logins before the account is locked |
| `TRAQS_LOCK_MIN` | `15` | How long a locked account stays locked |

## API in short

Authenticate with `POST /api/v1/auth/login` and send the token as `Authorization: Bearer <token>`.
Every call is checked against the user's role in the project.

| Resource | Endpoints |
|---|---|
| Projects | `/projects`, `/projects/{id}`, `/projects/{id}/members/{userId}` |
| Modules | `/projects/{id}/modules`, `/modules/{id}` |
| Objects | `/modules/{id}/objects` (tree or `?flat=true`), `/objects/{id}`, `POST /objects/{id}/move` |
| Links | `/link-types`, `/objects/{id}/links` (create with `type`), `DELETE /links/{id}`, `/projects/{id}/link-issues` |
| Attributes | `/attribute-types`, `/projects/{id}/attributes`, `/attributes/{id}`, `PUT /objects/{id}/attributes` |
| Users | `/users`, `/users/{id}/unlock` |

The full description is served at `/api/v1/docs` (OpenAPI JSON at `/api/v1/openapi.json`).

## Attributes (modular, not hard-coded)

Priority, Level and Verification are not part of the code. They are ordinary attribute definitions that
new projects receive from [`backend/config/default-attributes.json`](backend/config/default-attributes.json);
every project can change, delete or add attributes on the **Attributes** screen.

- **Types are plug-ins.** Each type is one module in `backend/src/attributes/types/` (validation, storage,
  and a description of its options and input). Register another one with `registerType()`; the API, the
  definition form and the value validation pick it up. Types needing a new kind of input register it in the
  UI with `registerInput()` (`frontend/src/attributes/inputs.jsx`).
- **The UI is built from the data**: table columns come from the project's definitions, the option form of a
  type from the field list the server sends (`GET /attribute-types`).
- Values are validated against their type; a wrong value is rejected with `422`, and options cannot be
  changed in a way that would invalidate stored values.

## Link types and link rules (configuration)

Which links exist and which are allowed is described in **one file**,
[`backend/config/link-rules.json`](backend/config/link-rules.json); no code is involved.

- `types`: the link types (name, inverse label shown at the target, description, `informative`).
- `kind_attribute`: the attribute that says what kind an object is. The shipped files use **Level**
  (UR, SR, SW, DI = design item, TC = test case).
- `rules`: per type, the allowed `[from, to]` kind pairs (`"any"` for none). A side can be a kind, a group
  (`groups`, e.g. `requirement`) or `*`. `acyclic` forbids cycles; `allow_skip_levels` allows a link that
  skips one of the `levels` and reports it as a **gap**.

Shipped rules: Derives UR→SR and SR→SW (UR→SW is a gap, no cycles); Satisfies SW→SR, SR→UR and DI→requirement;
Verifies TC→requirement only; Refers any→any (informative, not counted in coverage).

A link that breaks a rule is refused with `422` and the message names the rule and what is allowed.
Links stay inside one project, never point to the object itself, and the same pair may have several types
but not the same type twice. If a rule needs the Level of an object that has none, the link is refused
(`unknown_kind` in the file switches this to "allow"). When a Level is changed later, links that no longer
fit are listed by `GET /projects/{id}/link-issues`, together with the gaps.

## Roles

| Role | Read | Write | Review | Manage project |
|---|:-:|:-:|:-:|:-:|
| Admin | ✓ | ✓ | ✓ | ✓ |
| Author | ✓ | ✓ | | |
| Reviewer | ✓ | | ✓ | |
| Viewer | ✓ | | | |

Only a global administrator can create projects. The matrix is defined in
`backend/src/permissions.js` and mirrored in `frontend/src/permissions.js`.

## Known limitations

- HTTPS is not set up; put a TLS-terminating reverse proxy in front for real use.
- The default password in `docker-compose.yml` is for local trials only.
