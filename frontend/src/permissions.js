// Mirrors backend/src/permissions.js: which role may do which action.
const MATRIX = {
  admin: ["read", "write", "review", "manage"],
  author: ["read", "write"],
  reviewer: ["read", "review"],
  viewer: ["read"],
};
export const can = (role, action) => (MATRIX[role] ?? []).includes(action);

// Role of the user in a project; administrators hold the Admin role everywhere.
export function roleIn(user, projectId) {
  if (!user) return null;
  if (user.is_admin) return "admin";
  const m = (user.memberships ?? []).find((x) => String(x.project_id) === String(projectId));
  return m ? m.role : null;
}
