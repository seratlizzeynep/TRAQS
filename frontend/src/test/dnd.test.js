import { describe, expect, it } from "vitest";
import { dropTarget } from "../dnd.js";
import { zoneOf } from "../pages/ModuleTree.jsx";

const n = (id, children = []) => ({ id, children });
// 1 ─ 2, 3      4 ─ 5
const tree = [n(1, [n(2), n(3)]), n(4, [n(5)]), n(6)];

describe("dropTarget", () => {
  it("drop as child appends to the target", () => {
    expect(dropTarget(tree, 6, 4, "child")).toEqual({ parent_id: 4, position: null });
  });
  it("drop before a sibling inserts above it", () => {
    expect(dropTarget(tree, 6, 1, "before")).toEqual({ parent_id: null, position: 0 });
    expect(dropTarget(tree, 3, 2, "before")).toEqual({ parent_id: 1, position: 0 });
  });
  it("drop after inserts below it", () => {
    expect(dropTarget(tree, 6, 1, "after")).toEqual({ parent_id: null, position: 1 });
    expect(dropTarget(tree, 5, 2, "after")).toEqual({ parent_id: 1, position: 1 });
  });
  it("moving down within the same parent counts positions without the dragged node", () => {
    // roots are 1,4,6: moving 1 after 4 gives 4,1,6 -> position 1
    expect(dropTarget(tree, 1, 4, "after")).toEqual({ parent_id: null, position: 1 });
    expect(dropTarget(tree, 1, 6, "after")).toEqual({ parent_id: null, position: 2 });
  });
  it("can move a nested object to the root", () => {
    expect(dropTarget(tree, 2, 6, "before")).toEqual({ parent_id: null, position: 2 });
  });
  it("refuses to drop onto itself or its own subtree", () => {
    expect(dropTarget(tree, 1, 1, "child")).toBeNull();
    expect(dropTarget(tree, 1, 2, "child")).toBeNull();
    expect(dropTarget(tree, 1, 3, "before")).toBeNull();
  });
  it("returns null when nothing would change", () => {
    expect(dropTarget(tree, 4, 1, "after")).toBeNull(); // already right after 1
    expect(dropTarget(tree, 6, 4, "after")).toBeNull();
    expect(dropTarget(tree, 3, 1, "child")).toBeNull(); // already last child
  });
  it("unknown ids are ignored", () => {
    expect(dropTarget(tree, 99, 1, "child")).toBeNull();
    expect(dropTarget(tree, 1, 99, "child")).toBeNull();
  });
});

describe("zoneOf", () => {
  const rect = { top: 100, height: 40 };
  it("splits a row into before / child / after", () => {
    expect(zoneOf(102, rect)).toBe("before");
    expect(zoneOf(120, rect)).toBe("child");
    expect(zoneOf(138, rect)).toBe("after");
  });
  it("falls back to child without a layout", () => {
    expect(zoneOf(0, { top: 0, height: 0 })).toBe("child");
  });
});
