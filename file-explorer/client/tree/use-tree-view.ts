import { useSyncExternalStore } from "react";
import {
  createTreeViewStore,
  INITIAL_TREE_VIEW_STATE,
  type TreeViewState,
  type TreeViewStore,
} from "./view-store";

// One store per plugin installation: the app evaluates each installation's bundle separately.
export const treeViewStore: TreeViewStore = createTreeViewStore(INITIAL_TREE_VIEW_STATE);

/** Selects a reference-stable slice of the tree view state. */
export function useTreeView<Selected>(select: (state: TreeViewState) => Selected): Selected {
  return useSyncExternalStore(
    treeViewStore.subscribe,
    () => select(treeViewStore.getState()),
    () => select(treeViewStore.getState()),
  );
}
