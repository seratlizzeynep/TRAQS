import { randomBytes } from "node:crypto";
import { createApp } from "./app.js";
import { openDb } from "./db.js";

let jwtSecret = process.env.TRAQS_JWT_SECRET;
if (!jwtSecret) {
  jwtSecret = randomBytes(32).toString("hex");
  console.warn("TRAQS_JWT_SECRET is not set: using a random secret, tokens become invalid on restart.");
}

const port = Number(process.env.PORT ?? 8000);
createApp(openDb(), { jwtSecret }).listen(port, () =>
  console.log(`TRAQS API listening on http://localhost:${port}/api/v1 (docs: /api/v1/docs)`)
);
