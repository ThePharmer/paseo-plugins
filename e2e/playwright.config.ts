import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);

// Every spec shares the single daemon started in global setup, and the web flows mutate plugin
// settings, so specs run one at a time.
export default defineConfig({
  testDir: "./tests",
  globalSetup: "./support/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: "./test-results",
  reporter: isCI
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }], ["github"]]
    : [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "rpc", testMatch: /rpc\.spec\.ts$/ },
    {
      name: "web",
      testMatch: /web\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
});
