import { describe, expect, it, vi } from "vitest";
import {
  createTreeViewStore,
  expandedPathsFor,
  INITIAL_TREE_VIEW_STATE,
  placementState,
  reduceTreeView,
} from "./view-store";

describe("reduceTreeView", () => {
  it("starts sorted by name with hidden files shown, like core", () => {
    expect(INITIAL_TREE_VIEW_STATE.preferences).toEqual({
      sortOption: "name",
      showHiddenFiles: true,
    });
  });

  it("expands and collapses a folder for one placement and root only", () => {
    const expanded = reduceTreeView(INITIAL_TREE_VIEW_STATE, {
      type: "toggle-directory",
      placement: "panel:w1",
      root: "/a",
      path: "src",
    });

    expect(expandedPathsFor(placementState(expanded, "panel:w1"), "/a")).toEqual([".", "src"]);
    expect(expandedPathsFor(placementState(expanded, "panel:w1"), "/b")).toEqual(["."]);
    expect(expandedPathsFor(placementState(expanded, "browse"), "/a")).toEqual(["."]);

    const collapsed = reduceTreeView(expanded, {
      type: "toggle-directory",
      placement: "panel:w1",
      root: "/a",
      path: "src",
    });
    expect(expandedPathsFor(placementState(collapsed, "panel:w1"), "/a")).toEqual(["."]);
  });

  it("remembers the picked folder and selection per placement", () => {
    let state = reduceTreeView(INITIAL_TREE_VIEW_STATE, {
      type: "select-root",
      placement: "browse",
      root: "/b",
    });
    state = reduceTreeView(state, {
      type: "select-entry",
      placement: "browse",
      root: "/b",
      path: "notes.md",
    });

    expect(placementState(state, "browse")).toEqual({
      root: "/b",
      expandedByRoot: {},
      selectedByRoot: { "/b": "notes.md" },
    });
    expect(placementState(state, "panel:w1").root).toBeNull();
  });

  it("toggles hidden files and cycles sort globally", () => {
    let state = reduceTreeView(INITIAL_TREE_VIEW_STATE, { type: "toggle-hidden-files" });
    state = reduceTreeView(state, { type: "cycle-sort" });

    expect(state.preferences).toEqual({ sortOption: "modified", showHiddenFiles: false });
  });
});

describe("createTreeViewStore", () => {
  it("notifies subscribers until they unsubscribe", () => {
    const store = createTreeViewStore(INITIAL_TREE_VIEW_STATE);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.dispatch({ type: "cycle-sort" });
    unsubscribe();
    store.dispatch({ type: "cycle-sort" });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getState().preferences.sortOption).toBe("size");
  });
});
