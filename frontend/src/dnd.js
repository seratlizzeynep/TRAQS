// Pure helpers for drag-and-drop reordering of the object tree.
// `tree` is the nested list returned by GET /modules/{id}/objects.

function index(nodes, parent = null, map = new Map()) {
  nodes.forEach((n, i) => {
    map.set(n.id, { node: n, parent, siblings: nodes, pos: i });
    index(n.children, n, map);
  });
  return map;
}

function isDescendant(map, id, ancestorId) {
  for (let cur = map.get(id)?.parent; cur; cur = map.get(cur.id)?.parent) {
    if (cur.id === ancestorId) return true;
  }
  return false;
}

// Where does `dragId` go when dropped on `targetId`?
//   zone "before" / "after": becomes a sibling of the target, just above / below it
//   zone "child": becomes the last child of the target
// Returns the body for POST /objects/{id}/move, or null when nothing would change
// (dropped on itself or on its own subtree, or onto the position it already has).
export function dropTarget(tree, dragId, targetId, zone) {
  const map = index(tree);
  const drag = map.get(dragId);
  const target = map.get(targetId);
  if (!drag || !target || dragId === targetId || isDescendant(map, targetId, dragId)) return null;

  if (zone === "child") {
    if (target.node.children.at(-1)?.id === dragId) return null; // already the last child
    return { parent_id: targetId, position: null };
  }

  const parentId = target.parent ? target.parent.id : null;
  const siblings = target.siblings.filter((n) => n.id !== dragId); // the position counts without the dragged node
  const at = siblings.findIndex((n) => n.id === targetId);
  const position = zone === "before" ? at : at + 1;
  const sameParent = (drag.parent ? drag.parent.id : null) === parentId;
  if (sameParent && position === drag.pos) return null;
  return { parent_id: parentId, position };
}
