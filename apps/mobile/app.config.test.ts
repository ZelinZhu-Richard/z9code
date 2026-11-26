import { afterEach, expect, it, vi } from "vite-plus/test";

// Keep config parsing independent of local env files and build credentials.
vi.mock("../../scripts/lib/public-config.ts", () => ({
  loadRepoEnv: () => ({ APP_VARIANT: process.env.APP_VARIANT }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadConfig(variant: string | undefined) {
  vi.resetModules();
  vi.stubEnv("APP_VARIANT", variant);
  return (await import("./app.config.ts")).default;
}

it.each(["prod", ""])("rejects APP_VARIANT=%j before selecting production IDs", async (value) => {
  await expect(loadConfig(value)).rejects.toThrow(
    "APP_VARIANT must be development, preview, or production.",
  );
});

it.each([
  [undefined, "com.z9code.z9code"],
  ["development", "com.z9code.z9code.dev"],
  ["preview", "com.z9code.z9code.preview"],
  ["production", "com.z9code.z9code"],
])("keeps the iOS and Android identifiers for APP_VARIANT=%j", async (value, identifier) => {
  const config = await loadConfig(value);
  expect(config.ios?.bundleIdentifier).toBe(identifier);
  expect(config.android?.package).toBe(identifier);
});

it("contacts no hosted service: no update server, EAS project or hosted app links", async () => {
  const config = await loadConfig("production");
  expect(config.updates?.url).toBeUndefined();
  expect(config.updates?.checkAutomatically).toBe("NEVER");
  expect(config.owner).toBeUndefined();
  expect(config.extra?.eas).toBeUndefined();
  expect(config.ios?.associatedDomains).toBeUndefined();
  expect(config.android?.intentFilters).toBeUndefined();
});
