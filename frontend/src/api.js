// Thin fetch wrapper for the TRAQS REST API (/api/v1). The JWT is kept in sessionStorage.
const BASE = "/api/v1";
const KEY = "traqs.token";

export const getToken = () => {
  try { return sessionStorage.getItem(KEY); } catch { return null; }
};
export const setToken = (t) => {
  try { t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY); } catch { /* storage unavailable */ }
};

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export async function api(method, path, body) {
  const token = getToken();
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized();
    throw new ApiError(res.status, data?.detail ?? res.statusText);
  }
  return data;
}

export const get = (p) => api("GET", p);
export const post = (p, b = {}) => api("POST", p, b);
