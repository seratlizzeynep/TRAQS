import { createHmac, timingSafeEqual } from "node:crypto";

// Minimal HS256 JWT implementation (RFC 7519) so no extra dependency is needed.
const b64 = (buf) => Buffer.from(buf).toString("base64url");
const mac = (data, secret) => createHmac("sha256", secret).update(data).digest();

export function signJwt(payload, secret) {
  const head = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64(JSON.stringify(payload));
  return `${head}.${body}.${b64(mac(`${head}.${body}`, secret))}`;
}

// Returns the payload, or throws Error when the token is malformed, forged or expired.
export function verifyJwt(token, secret, nowSec = Math.floor(Date.now() / 1000)) {
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 3) throw new Error("malformed token");
  const [head, body, sig] = parts;
  let header, payload;
  try {
    header = JSON.parse(Buffer.from(head, "base64url").toString());
    payload = JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    throw new Error("malformed token");
  }
  if (header.alg !== "HS256") throw new Error("unsupported algorithm");
  const expected = mac(`${head}.${body}`, secret);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new Error("bad signature");
  if (typeof payload.exp !== "number" || payload.exp <= nowSec) throw new Error("token expired");
  return payload;
}
