import {
  nextSortOption,
  ROOT_DIRECTORY_PATH,
  setExpandedDirectoryPath,
  type SortOption,
} from "./tree";

// Tree view state lives in a module store rather than component state so a panel that unmounts
// (tab switch, Explorer toggle) comes back on the same folder with the same folders expanded.
// Each placement (the workspace panel per workspace, the browse screen) keeps its own folder,
// expansion and selection. Sort and hidden-file visibility are global, as in core.

// Dotfiles start shown, matching core's Files pane
// (packages/app/src/stores/panel-store/index.ts, explorerShowHiddenFiles: true).
export const DEFAULT_SHOW_HIDDEN_FILES = true;

export interface TreePreferences {
  sortOption: SortOption;
  showHiddenFiles: boolean;
}

export interface PlacementState {
  /** The folder the user picked, or null to follow the first ready folder. */
  root: string | null;
  expandedByRoot: Readonly<Record<string, readonly string[]>>;
  /** Path of the last pressed row per root; files stay highlighted after opening. */
  selectedByRoot: Readonly<Record<string, string>>;
}

export interface TreeViewState {
  preferences: TreePreferences;
  placements: Readonly<Record<string, PlacementState>>;
}

export type TreeViewAction =
  | { type: "select-root"; placement: string; root: string }
  | { type: "toggle-directory"; placement: string; root: string; path: string }
  | { type: "select-entry"; placement: string; root: string; path: string }
  | { type: "cycle-sort" }
  | { type: "toggle-hidden-files" };

export interface TreeViewStore {
  getState(): TreeViewState;
  dispatch(action: TreeViewAction): void;
  subscribe(listener: () => void): () => void;
}

// Shared so an untouched root yields the same array on every read and memoized consumers hold.
const ROOT_ONLY: readonly string[] = [ROOT_DIRECTORY_PATH];

export const EMPTY_PLACEMENT: PlacementState = {
  root: null,
  expandedByRoot: {},
  selectedByRoot: {},
};

export const INITIAL_TREE_VIEW_STATE: TreeViewState = {
  preferences: { sortOption: "name", showHiddenFiles: DEFAULT_SHOW_HIDDEN_FILES },
  placements: {},
};

export function placementState(state: TreeViewState, placement: string): PlacementState {
  return state.placements[placement] ?? EMPTY_PLACEMENT;
}

/** Expanded directories for one root. The root itself is always expanded. */
export function expandedPathsFor(placement: PlacementState, root: string): readonly string[] {
  return placement.expandedByRoot[root] ?? ROOT_ONLY;
}

export function reduceTreeView(state: TreeViewState, action: TreeViewAction): TreeViewState {
  switch (action.type) {
    case "cycle-sort":
      return {
        ...state,
        preferences: {
          ...state.preferences,
          sortOption: nextSortOption(state.preferences.sortOption),
        },
      };
    case "toggle-hidden-files":
      return {
        ...state,
        preferences: {
          ...state.preferences,
          showHiddenFiles: !state.preferences.showHiddenFiles,
        },
      };
    case "select-root":
      return updatePlacement(state, action.placement, (current) => ({
        ...current,
        root: action.root,
      }));
    case "toggle-directory":
      return updatePlacement(state, action.placement, (current) => {
        const expanded = expandedPathsFor(current, action.root);
        const next = setExpandedDirectoryPath({
          currentExpandedPaths: expanded,
          directoryPath: action.path,
          expanded: !expanded.includes(action.path),
        });
        return {
          ...current,
          expandedByRoot: { ...current.expandedByRoot, [action.root]: next },
        };
      });
    case "select-entry":
      return updatePlacement(state, action.placement, (current) => ({
        ...current,
        selectedByRoot: { ...current.selectedByRoot, [action.root]: action.path },
      }));
  }
}

export function createTreeViewStore(initial: TreeViewState): TreeViewStore {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    dispatch(action) {
      const next = reduceTreeView(state, action);
      if (next === state) return;
      state = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function updatePlacement(
  state: TreeViewState,
  placement: string,
  update: (current: PlacementState) => PlacementState,
): TreeViewState {
  return {
    ...state,
    placements: {
      ...state.placements,
      [placement]: update(placementState(state, placement)),
    },
  };
}
