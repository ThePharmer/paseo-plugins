// Runs inside Hermes. Evaluates a compiled plugin client bundle the way the Paseo app does
// (packages/app/src/plugins/evaluate.ts: globalThis.eval(bundle), factory(require),
// exports.default(client)) and prints one result line for run.mjs to check.
//
// React, zod and the plugin SDK's shared module are real, so top-level calls into them run.
// react-native, the client SDK and React Query are stubs: the smoke test checks that the bundle
// loads and registers its contributions, not that anything renders.

import * as PluginShared from "@getpaseo/plugin";
import * as React from "react";
import * as JsxRuntime from "react/jsx-runtime";
import * as Zod from "zod";
import bundle from "plugin-client-bundle";

const RESULT_PREFIX = "HERMES_SMOKE_RESULT ";
const platform = globalThis.__HERMES_SMOKE_PLATFORM__;

function stubComponent(name) {
  const Stub = () => null;
  Stub.displayName = name;
  return Stub;
}

// Any export not listed reads as a component stub, which covers the components and hooks a
// plugin can import at module scope without calling them.
function stubModule(name, members = {}) {
  return new Proxy(members, {
    get: (target, key) => {
      if (key in target) return target[key];
      if (key === "__esModule") return false;
      return stubComponent(`${name}.${String(key)}`);
    },
  });
}

const reactNative = stubModule("react-native", {
  Platform: { OS: platform, select: (options) => options[platform] ?? options.default },
  StyleSheet: {
    create: (styles) => styles,
    flatten: (style) => style,
    hairlineWidth: 1,
    absoluteFillObject: {},
  },
  Dimensions: { get: () => ({ width: 400, height: 800, scale: 3, fontScale: 1 }) },
});

const hostModules = {
  "@getpaseo/plugin": PluginShared,
  "@getpaseo/plugin/client": stubModule("@getpaseo/plugin/client"),
  "@getpaseo/plugin/client/ui": stubModule("@getpaseo/plugin/client/ui"),
  "@getpaseo/plugin/client/react-native": stubModule("@getpaseo/plugin/client/react-native"),
  "@tanstack/react-query": stubModule("@tanstack/react-query"),
  react: React,
  "react/jsx-runtime": JsxRuntime,
  "react-native": reactNative,
  zod: Zod,
};

function hostRequire(name) {
  if (Object.prototype.hasOwnProperty.call(hostModules, name)) return hostModules[name];
  throw new Error(`Module "${name}" is not available in plugin client code`);
}

const registered = [];

// Every add* call records "<method>:<id>". The rest of the client API answers like a host that
// has nothing stored yet.
const client = new Proxy(
  {
    rpc: () => Promise.resolve({ status: "ready", revision: "smoke", values: {} }),
    openPanel: () => undefined,
    openScreen: () => undefined,
    openSettings: () => undefined,
  },
  {
    get: (target, key) => {
      if (key in target) return target[key];
      if (typeof key === "string" && key.startsWith("add")) {
        return (contribution) => {
          registered.push(`${key}:${contribution?.id}`);
          return () => undefined;
        };
      }
      return undefined;
    },
  },
);

function describeError(error) {
  const stack = String(error?.stack ?? error)
    .split("\n")
    .slice(0, 12)
    .join("\n");
  return { message: String(error?.message ?? error), stack };
}

function report(result) {
  print(RESULT_PREFIX + JSON.stringify({ platform, registered, ...result }));
}

try {
  const factory = globalThis.eval(bundle);
  const pluginExports = factory(hostRequire);
  const contribute = pluginExports.default;
  if (typeof contribute !== "function") throw new Error("Bundle has no default export function");
  const cleanup = contribute(client);
  // Give async work started by contribute() a few microtask turns before cleaning up.
  let settled = Promise.resolve();
  for (let turn = 0; turn < 10; turn += 1) settled = settled.then(() => undefined);
  settled
    .then(() => {
      if (typeof cleanup === "function") cleanup();
      return report({ ok: true });
    })
    .catch((error) => report({ ok: false, error: describeError(error) }));
} catch (error) {
  report({ ok: false, error: describeError(error) });
}
