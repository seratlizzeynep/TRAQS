import { randomBytes } from "node:crypto";
import { createApp } from "./app.js";
import { ensureAdmin } from "./auth.js";
import { openDb } from "./db.js";

let jwtSecret = process.env.TRAQS_JWT_SECRET;
if (!jwtSecret) {
  jwtSecret = randomBytes(32).toString("hex");
  console.warn("TRAQS_JWT_SECRET is not set: using a random secret, tokens become invalid on restart.");
}

const db = openDb();
if (await ensureAdmin(db, process.env.TRAQS_ADMIN_USER, process.env.TRAQS_ADMIN_PASSWORD)) {
  console.log(`Created administrator '${process.env.TRAQS_ADMIN_USER}'.`);
} else if (db.prepare("SELECT COUNT(*) c FROM users").get().c === 0) {
  console.warn("No users exist. Set TRAQS_ADMIN_USER and TRAQS_ADMIN_PASSWORD to create the first administrator.");
}

// Optional tuning (NFR-11): inactivity timeout in minutes, failed logins before lock, lock duration in minutes.
const num = (name) => (process.env[name] ? Number(process.env[name]) : undefined);
const minutes = (v) => (v === undefined ? undefined : v * 60_000);
const port = Number(process.env.PORT ?? 8000);

createApp(db, {
  jwtSecret,
  sessionTimeoutMs: minutes(num("TRAQS_SESSION_TIMEOUT_MIN")),
  maxFailedLogins: num("TRAQS_MAX_FAILED_LOGINS"),
  lockMs: minutes(num("TRAQS_LOCK_MIN")),
}).listen(port, () => console.log(`TRAQS API listening on http://localhost:${port}/api/v1 (docs: /api/v1/docs)`));
