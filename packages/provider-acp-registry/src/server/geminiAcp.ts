import type { ResolvedProviderInstanceEnvironment } from "@z9code/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import type { AcpRegistrySettings } from "../settings.ts";

/**
 * Gemini CLI's own settings file at its lowest precedence (system defaults): user and
 * workspace settings still override it, so someone who deliberately opts back in wins.
 */
export const GEMINI_PRIVACY_DEFAULTS_JSON =
  '{"privacy":{"usageStatisticsEnabled":false},"telemetry":{"enabled":false}}\n';

const GEMINI_COMMAND = /^gemini(\.exe|\.cmd)?$/i;

export function isGeminiCliAgent(settings: AcpRegistrySettings): boolean {
  return settings.source === "local"
    ? GEMINI_COMMAND.test(settings.commandPath.split(/[\\/]/).pop() ?? "")
    : settings.agentId === "gemini";
}

/**
 * Gemini CLI reports usage statistics to Google unless told otherwise. The defaults file lives
 * in the server's own state directory, never a shared temp path another user could pre-create.
 */
export const withGeminiPrivacyEnvironment = Effect.fn("GeminiAcp.withPrivacyEnvironment")(
  function* (input: {
    readonly environment: ResolvedProviderInstanceEnvironment | undefined;
    readonly hostEnvironment: NodeJS.ProcessEnv;
    readonly stateDir: string;
  }) {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const configured = new Set([
      ...(input.environment ?? []).map((variable) => variable.name.toUpperCase()),
      ...Object.keys(input.hostEnvironment).map((name) => name.toUpperCase()),
    ]);
    const added: Array<ResolvedProviderInstanceEnvironment[number]> = [];
    if (!configured.has("GEMINI_TELEMETRY_ENABLED")) {
      added.push({ name: "GEMINI_TELEMETRY_ENABLED", value: "false", sensitive: false });
    }
    if (!configured.has("GEMINI_CLI_SYSTEM_DEFAULTS_PATH")) {
      const directory = path.join(input.stateDir, "gemini-cli");
      const defaultsPath = path.join(directory, "system-defaults.json");
      const written = yield* fileSystem
        .makeDirectory(directory, { recursive: true, mode: 0o700 })
        .pipe(
          Effect.andThen(
            fileSystem.writeFileString(defaultsPath, GEMINI_PRIVACY_DEFAULTS_JSON, {
              mode: 0o600,
            }),
          ),
          Effect.as(true),
          Effect.catchCause((cause) =>
            Effect.logWarning("could not write Gemini CLI privacy defaults", { cause }).pipe(
              Effect.as(false),
            ),
          ),
        );
      if (written) {
        added.push({
          name: "GEMINI_CLI_SYSTEM_DEFAULTS_PATH",
          value: defaultsPath,
          sensitive: false,
        });
      }
    }
    return [...added, ...(input.environment ?? [])];
  },
);
