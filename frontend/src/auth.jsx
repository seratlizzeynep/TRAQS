import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ApiError, get, getToken, post, setToken, setUnauthorizedHandler } from "./api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // { id, username, is_admin, memberships }
  const [ready, setReady] = useState(!getToken()); // false while restoring a stored session

  const logout = useCallback(async () => {
    try { if (getToken()) await post("/auth/logout"); } catch { /* session already gone */ }
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => { setToken(null); setUser(null); });
    if (!getToken()) return;
    get("/auth/me")
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setReady(true));
  }, []);

  const login = useCallback(async (username, password) => {
    const res = await post("/auth/login", { username, password });
    setToken(res.token);
    setUser(await get("/auth/me"));
  }, []);

  return <AuthContext.Provider value={{ user, ready, login, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
export { ApiError };
