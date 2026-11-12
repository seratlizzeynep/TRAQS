# TRAQS

TRAQS is a web-based requirements management tool. Users capture requirements in projects and
modules, organize them as ordered trees, and work with them according to their role.
The reports are in [`docs/`](docs/) and the project web page is [`index.html`](index.html).

## Features

- Projects, modules and hierarchical, ordered objects (parent/child with an explicit position)
- Sequential object IDs (`REQ-0001`), soft delete with an ID blacklist (an ID is never reused)
- Links between objects; links to deleted objects become *suspect*
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
| Links | `/objects/{id}/links` |
| Users | `/users`, `/users/{id}/unlock` |

The full description is served at `/api/v1/docs` (OpenAPI JSON at `/api/v1/openapi.json`).

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
