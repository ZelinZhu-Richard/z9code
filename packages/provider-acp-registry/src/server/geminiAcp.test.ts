import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { AcpRegistrySettings } from "../settings.ts";
import {
  GEMINI_PRIVACY_DEFAULTS_JSON,
  isGeminiCliAgent,
  withGeminiPrivacyEnvironment,
} from "./geminiAcp.ts";

const decodeSettings = Schema.decodeSync(AcpRegistrySettings);
const settings = (input: Partial<typeof AcpRegistrySettings.Encoded>) => decodeSettings(input);

it("recognizes Gemini CLI from the registry id or a local gemini command", () => {
  assert.isTrue(isGeminiCliAgent(settings({ source: "registry", agentId: "gemini" })));
  assert.isTrue(isGeminiCliAgent(settings({ source: "local", commandPath: "gemini" })));
  assert.isTrue(
    isGeminiCliAgent(settings({ source: "local", commandPath: "C:\\npm\\gemini.cmd" })),
  );
  assert.isFalse(isGeminiCliAgent(settings({ source: "local", commandPath: "agy" })));
  assert.isFalse(isGeminiCliAgent(settings({ source: "registry", agentId: "devin" })));
});

it.effect("starts Gemini CLI with its usage statistics and telemetry off", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const stateDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "z9-gemini-acp-" });

    const environment = yield* withGeminiPrivacyEnvironment({
      environment: [{ name: "GEMINI_API_KEY", value: "key", sensitive: true }],
      hostEnvironment: {},
      stateDir,
    });
    const byName = new Map(environment.map((variable) => [variable.name, variable.value]));
    assert.strictEqual(byName.get("GEMINI_TELEMETRY_ENABLED"), "false");
    assert.strictEqual(byName.get("GEMINI_API_KEY"), "key");
    const defaultsPath = byName.get("GEMINI_CLI_SYSTEM_DEFAULTS_PATH");
    assert.strictEqual(defaultsPath, path.join(stateDir, "gemini-cli", "system-defaults.json"));
    assert.strictEqual(
      yield* fileSystem.readFileString(defaultsPath!),
      GEMINI_PRIVACY_DEFAULTS_JSON,
    );
    assert.deepStrictEqual(JSON.parse(GEMINI_PRIVACY_DEFAULTS_JSON), {
      privacy: { usageStatisticsEnabled: false },
      telemetry: { enabled: false },
    });
    assert.strictEqual((yield* fileSystem.stat(defaultsPath!)).mode & 0o077, 0);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("leaves a user's own Gemini telemetry choices alone", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const stateDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "z9-gemini-acp-" });

    const environment = yield* withGeminiPrivacyEnvironment({
      environment: [{ name: "GEMINI_TELEMETRY_ENABLED", value: "true", sensitive: false }],
      hostEnvironment: { GEMINI_CLI_SYSTEM_DEFAULTS_PATH: "/etc/gemini/defaults.json" },
      stateDir,
    });
    assert.deepStrictEqual(environment, [
      { name: "GEMINI_TELEMETRY_ENABLED", value: "true", sensitive: false },
    ]);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
