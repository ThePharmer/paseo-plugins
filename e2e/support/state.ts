import type { FixtureTree } from "./fixtures";

/** What global setup hands to every test worker, through the PASEO_E2E_STATE variable. */
export interface E2EState {
  cliVersion: string;
  daemonVersion: string;
  home: string;
  port: number;
  origin: string;
  serverId: string;
  pluginId: string;
  fixtures: FixtureTree;
  workspaceId: string;
  workspaceTitle: string;
}

export const STATE_ENV = "PASEO_E2E_STATE";

// Allowed-folders list that global setup writes and every spec restores.
export function defaultFolders(state: Pick<E2EState, "fixtures">) {
  return [{ path: state.fixtures.allowed, label: "QA" }, { path: state.fixtures.missing }];
}

export function readState(): E2EState {
  const raw = process.env[STATE_ENV];
  if (!raw) throw new Error(`${STATE_ENV} is not set; run the suite through playwright test`);
  return JSON.parse(raw) as E2EState;
}
