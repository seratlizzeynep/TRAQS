import { randomBytes } from "node:crypto";
import { HttpError } from "./errors.js";
import { signJwt, verifyJwt } from "./jwt.js";
import { hashPassword, verifyPassword } from "./password.js";
import { can, ROLES } from "./permissions.js";

const DUMMY_HASH =
  "scrypt$00000000000000000000000000000000$" + "00".repeat(64); // used to equalise timing for unknown users

export const DEFAULTS = {
  sessionTimeoutMs: 30 * 60 * 1000, // inactivity timeout (NFR-11)
  maxFailedLogins: 5, // lock the account after this many failures (NFR-11)
  lockMs: 15 * 60 * 1000, // how long a locked account stays locked
  tokenLifetimeSec: 12 * 60 * 60, // absolute cap on a token, independent of activity
};

export async function createUser(db, { username, password, isAdmin = false }) {
  const hash = await hashPassword(password);
  const r = db
    .prepare("INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)")
    .run(username, hash, isAdmin ? 1 : 0);
  return r.lastInsertRowid;
}

// Express 4 does not catch rejected promises, so async handlers forward errors explicitly.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const publicUser = (u) => ({ id: u.id, username: u.username, is_admin: !!u.is_admin, locked: !!u.locked_until });

export function createAuth(db, { jwtSecret, now = () => Date.now(), ...opts }) {
  const cfg = { ...DEFAULTS, ...Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined)) };

  const grantsOf = (user) => {
    if (user.is_admin) return { "*": "admin" };
    const g = {};
    for (const m of db.prepare("SELECT project_id, role FROM memberships WHERE user_id = ?").all(user.id)) {
      g[m.project_id] = m.role;
    }
    return g;
  };

  // ------------------------------------------------- middleware
  const authenticate = (req, _res, next) => {
    const m = /^Bearer (.+)$/.exec(req.get("authorization") ?? "");
    if (!m) throw new HttpError(401, "missing bearer token");
    let claims;
    try {
      claims = verifyJwt(m[1], jwtSecret, Math.floor(now() / 1000));
    } catch (e) {
      throw new HttpError(401, e.message);
    }
    const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(claims.sid);
    if (!session || session.revoked || session.user_id !== claims.sub) throw new HttpError(401, "invalid session");
    if (now() - session.last_activity > cfg.sessionTimeoutMs) {
      db.prepare("UPDATE sessions SET revoked = 1 WHERE id = ?").run(session.id);
      throw new HttpError(401, "session expired due to inactivity");
    }
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(session.user_id);
    if (!user) throw new HttpError(401, "invalid session");
    db.prepare("UPDATE sessions SET last_activity = ? WHERE id = ?").run(now(), session.id);
    req.auth = { user, sid: session.id, grants: grantsOf(user) };
    next();
  };

  // Rejects calls without the needed permission (role matrix) for the project (project isolation).
  // projectId === null means "all projects" and needs an administrator.
  const access = (req, projectId, action) => {
    const g = req.auth.grants;
    if (projectId === null) {
      if (!can(g["*"], action)) throw new HttpError(403, "forbidden");
      return;
    }
    const role = g[projectId] ?? g["*"];
    if (!role) throw new HttpError(403, "no access to this project");
    if (!can(role, action)) throw new HttpError(403, `role '${role}' may not ${action}`);
  };
  const canSeeProject = (req, projectId) => !!(req.auth.grants[projectId] ?? req.auth.grants["*"]);

  // ----------------------------------------------- public routes
  const mountPublic = (api) => {
    api.post("/auth/login", wrap(async (req, res) => {
      const { username, password } = req.body ?? {};
      if (typeof username !== "string" || typeof password !== "string") {
        throw new HttpError(422, "username and password are required");
      }
      const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
      if (!user) {
        await verifyPassword(password, DUMMY_HASH);
        throw new HttpError(401, "invalid credentials");
      }
      if (user.locked_until && user.locked_until > now()) {
        throw new HttpError(423, "account is locked after too many failed logins");
      }
      if (user.locked_until) {
        // lock has run out: start counting again
        db.prepare("UPDATE users SET locked_until = NULL, failed_attempts = 0 WHERE id = ?").run(user.id);
        user.failed_attempts = 0;
      }
      if (!(await verifyPassword(password, user.password_hash))) {
        const failed = user.failed_attempts + 1;
        const lock = failed >= cfg.maxFailedLogins ? now() + cfg.lockMs : null;
        db.prepare("UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?").run(failed, lock, user.id);
        if (lock) throw new HttpError(423, "account is locked after too many failed logins");
        throw new HttpError(401, "invalid credentials");
      }
      db.prepare("UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?").run(user.id);
      const sid = randomBytes(16).toString("hex");
      db.prepare("INSERT INTO sessions (id, user_id, last_activity) VALUES (?, ?, ?)").run(sid, user.id, now());
      const exp = Math.floor(now() / 1000) + cfg.tokenLifetimeSec;
      res.json({
        token: signJwt({ sub: user.id, sid, exp }, jwtSecret),
        token_type: "Bearer",
        inactivity_timeout_sec: Math.floor(cfg.sessionTimeoutMs / 1000),
        user: publicUser(user),
      });
    }));
  };

  // ---------------------------------------- authenticated routes
  const mountProtected = (api, { find, id }) => {
    api.post("/auth/logout", (req, res) => {
      db.prepare("UPDATE sessions SET revoked = 1 WHERE id = ?").run(req.auth.sid);
      res.status(204).end();
    });
    api.get("/auth/me", (req, res) => {
      const memberships = db
        .prepare("SELECT project_id, role FROM memberships WHERE user_id = ? ORDER BY project_id")
        .all(req.auth.user.id);
      res.json({ ...publicUser(req.auth.user), memberships });
    });

    api.post("/users", wrap(async (req, res) => {
      access(req, null, "manage");
      const { username, password, is_admin = false } = req.body ?? {};
      if (typeof username !== "string" || username.trim() === "" || username.length > 100) {
        throw new HttpError(422, "username is invalid");
      }
      if (typeof password !== "string" || password.length < 8) {
        throw new HttpError(422, "password must have at least 8 characters");
      }
      if (typeof is_admin !== "boolean") throw new HttpError(422, "is_admin must be a boolean");
      try {
        const uid = await createUser(db, { username, password, isAdmin: is_admin });
        res.status(201).json(publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(uid)));
      } catch (e) {
        if (String(e.code).startsWith("SQLITE_CONSTRAINT")) throw new HttpError(409, "username already exists");
        throw e;
      }
    }));
    api.get("/users", (req, res) => {
      access(req, null, "manage");
      res.json(db.prepare("SELECT * FROM users ORDER BY id").all().map(publicUser));
    });
    api.post("/users/:id/unlock", (req, res) => {
      access(req, null, "manage");
      const u = find("users", "User", id(req));
      db.prepare("UPDATE users SET locked_until = NULL, failed_attempts = 0 WHERE id = ?").run(u.id);
      res.json(publicUser(find("users", "User", u.id)));
    });

    // Role of a user in a project (project administrators manage their own project).
    api.get("/projects/:id/members", (req, res) => {
      const p = find("projects", "Project", id(req));
      access(req, p.id, "manage");
      res.json(db.prepare("SELECT user_id, role FROM memberships WHERE project_id = ? ORDER BY user_id").all(p.id));
    });
    api.put("/projects/:id/members/:userId", (req, res) => {
      const p = find("projects", "Project", id(req));
      access(req, p.id, "manage");
      const u = find("users", "User", Number(req.params.userId));
      const role = req.body?.role;
      if (!ROLES.includes(role)) throw new HttpError(422, `role must be one of ${ROLES.join(", ")}`);
      db.prepare(
        "INSERT INTO memberships (user_id, project_id, role) VALUES (?, ?, ?) ON CONFLICT(user_id, project_id) DO UPDATE SET role = excluded.role"
      ).run(u.id, p.id, role);
      res.json({ user_id: u.id, project_id: p.id, role });
    });
    api.delete("/projects/:id/members/:userId", (req, res) => {
      const p = find("projects", "Project", id(req));
      access(req, p.id, "manage");
      db.prepare("DELETE FROM memberships WHERE project_id = ? AND user_id = ?").run(p.id, Number(req.params.userId));
      res.status(204).end();
    });
  };

  return { authenticate, access, canSeeProject, mountPublic, mountProtected, config: cfg };
}

// Creates the first administrator from the environment if the database has no users yet.
export async function ensureAdmin(db, username, password) {
  if (db.prepare("SELECT COUNT(*) c FROM users").get().c > 0) return false;
  if (!username || !password) return false;
  await createUser(db, { username, password, isAdmin: true });
  return true;
}
