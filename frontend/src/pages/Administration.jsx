import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { del, get, post, put } from "../api.js";
import { useAuth } from "../auth.jsx";
import { useI18n } from "../i18n.jsx";
import { can, roleIn } from "../permissions.js";

const ROLES = ["admin", "author", "reviewer", "viewer"];

// S13: users, passwords and roles per project.
// Project administrators manage the members of their project; creating users, resetting passwords
// and adding people to a project needs a global administrator (users of other projects stay hidden).
export default function Administration() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { projectId } = useParams();
  const isGlobal = !!user?.is_admin;

  const [members, setMembers] = useState(null);
  const [users, setUsers] = useState([]);
  const [message, setMessage] = useState(null); // { kind: "ok" | "error", key }
  const [addUser, setAddUser] = useState("");
  const [addRole, setAddRole] = useState("viewer");
  const [newUser, setNewUser] = useState({ username: "", password: "", is_admin: false });
  const [resetFor, setResetFor] = useState(null); // user id whose password is being reset
  const [newPassword, setNewPassword] = useState("");

  const load = useCallback(async () => {
    try {
      setMembers(await get(`/projects/${projectId}/members`));
      if (isGlobal) setUsers(await get("/users"));
    } catch {
      setMessage({ kind: "error", key: "common.error" });
    }
  }, [projectId, isGlobal]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn, errors = {}) => {
    setMessage(null);
    try {
      await fn();
      setMessage({ kind: "ok", key: "admin.done" });
      await load();
      return true;
    } catch (e) {
      setMessage({ kind: "error", key: errors[e.status] ?? "common.error" });
      return false;
    }
  };

  if (!can(roleIn(user, projectId), "manage")) return <p role="alert" className="error">{t("common.notFound")}</p>;

  const memberIds = new Set((members ?? []).map((m) => m.user_id));
  const candidates = users.filter((u) => !memberIds.has(u.id) && !u.is_admin);

  const setRole = (uid, role) => run(() => put(`/projects/${projectId}/members/${uid}`, { role }));
  const addMember = async (e) => {
    e.preventDefault();
    if (addUser && (await run(() => put(`/projects/${projectId}/members/${addUser}`, { role: addRole })))) setAddUser("");
  };
  const createUser = async (e) => {
    e.preventDefault();
    if (await run(() => post("/users", newUser), { 422: "admin.passwordShort", 409: "admin.exists" })) {
      setNewUser({ username: "", password: "", is_admin: false });
    }
  };
  const resetPassword = async (e, uid) => {
    e.preventDefault();
    if (await run(() => put(`/users/${uid}/password`, { password: newPassword }), { 422: "admin.passwordShort" })) {
      setResetFor(null);
      setNewPassword("");
    }
  };

  return (
    <section>
      <h1 className="screen-title">S13 · {t("admin.title")}</h1>
      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "error" : "muted"}>
          {t(message.key)}
        </p>
      )}

      <h2>{t("admin.members")}</h2>
      {isGlobal && (
        <form onSubmit={addMember} className="inline-form">
          <select aria-label={t("admin.selectUser")} value={addUser} onChange={(e) => setAddUser(e.target.value)}>
            <option value="">{t("admin.selectUser")}</option>
            {candidates.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
          </select>
          <select aria-label={t("admin.role")} value={addRole} onChange={(e) => setAddRole(e.target.value)}>
            {ROLES.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
          </select>
          <button className="primary" type="submit" disabled={!addUser}>{t("admin.addMember")}</button>
        </form>
      )}
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th scope="col">{t("admin.username")}</th><th scope="col">{t("admin.role")}</th><th scope="col">{t("admin.actions")}</th></tr></thead>
          <tbody>
            {members === null ? (
              <tr className="empty-row"><td colSpan={3}>{t("common.loading")}</td></tr>
            ) : members.length === 0 ? (
              <tr className="empty-row"><td colSpan={3}>{t("admin.noMembers")}</td></tr>
            ) : members.map((m) => (
              <tr key={m.user_id}>
                <td>{m.username}</td>
                <td>
                  <select aria-label={`${t("admin.role")} ${m.username}`} value={m.role} onChange={(e) => setRole(m.user_id, e.target.value)}>
                    {ROLES.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
                  </select>
                </td>
                <td><button type="button" onClick={() => run(() => del(`/projects/${projectId}/members/${m.user_id}`))}>{t("admin.remove")} {m.username}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isGlobal && (
        <>
          <h2>{t("admin.users")}</h2>
          <form onSubmit={createUser} className="inline-form" aria-label={t("admin.createUser")}>
            <input aria-label={t("admin.username")} placeholder={t("admin.username")} value={newUser.username} required
              onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} autoComplete="off" />
            <input aria-label={t("admin.password")} placeholder={t("admin.password")} type="password" value={newUser.password} required
              onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} autoComplete="new-password" />
            <label><input type="checkbox" checked={newUser.is_admin} onChange={(e) => setNewUser({ ...newUser, is_admin: e.target.checked })} /> {t("admin.isAdmin")}</label>
            <button className="primary" type="submit">{t("admin.create")}</button>
          </form>
          <div className="table-wrap">
            <table className="grid">
              <thead><tr><th scope="col">{t("admin.username")}</th><th scope="col">{t("admin.isAdmin")}</th><th scope="col">{t("admin.actions")}</th></tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.username} {u.locked && <span className="badge red">{t("admin.locked")}</span>}</td>
                    <td>{u.is_admin ? <span className="badge purple">{t("admin.globalAdmin")}</span> : <span className="muted">—</span>}</td>
                    <td>
                      {resetFor === u.id ? (
                        <form onSubmit={(e) => resetPassword(e, u.id)} className="inline-form" style={{ margin: 0 }}>
                          <input type="password" aria-label={t("admin.newPassword")} placeholder={t("admin.newPassword")} value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" required autoFocus />
                          <button className="primary" type="submit">{t("admin.setPassword")}</button>
                        </form>
                      ) : (
                        <button type="button" onClick={() => { setResetFor(u.id); setNewPassword(""); }}>{t("admin.resetPassword")} {u.username}</button>
                      )}{" "}
                      {u.locked && <button type="button" onClick={() => run(() => post(`/users/${u.id}/unlock`))}>{t("admin.unlock")} {u.username}</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
