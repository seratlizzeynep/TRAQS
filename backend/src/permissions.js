// Role permission matrix. Roles apply per project; a user flagged as administrator
// holds the Admin role in every project.
//
//   action   what it covers
//   read     view projects, modules, objects, links
//   write    create / edit / move / delete modules, objects and links
//   review   review and validate requirements
//   manage   edit or delete the project, manage its members
//
//              read  write  review  manage
//   Admin       x      x      x       x
//   Author      x      x
//   Reviewer    x             x
//   Viewer      x
export const ROLES = ["admin", "author", "reviewer", "viewer"];
export const ACTIONS = ["read", "write", "review", "manage"];

const MATRIX = {
  admin: ["read", "write", "review", "manage"],
  author: ["read", "write"],
  reviewer: ["read", "review"],
  viewer: ["read"],
};

export const can = (role, action) => (MATRIX[role] ?? []).includes(action);
