import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import type { ServerInstallation } from "@z9code/contracts";
import * as HostProcess from "@z9code/shared/HostProcess";
import { resolveCommandPath } from "@z9code/shared/shell";

import {
  findPosixLauncher,
  readPosixLauncherTarget,
  resolveLauncherPath,
} from "../service/pinnedRuntime.ts";

const PINNED_RUNTIME_ENTRY = /^(.*)\/runtime\/versions\/[^/]+\/z9$/;

export type CliRunner = "npx" | "pnpm dlx" | "bunx";

/** Best-effort: z9code is not published to npm, so a runner cache only explains a stray install. */
export function detectCliRunner(entryPath: string): CliRunner | null {
  const path = entryPath.replaceAll("\\", "/");
  if (path.includes("/_npx/")) {
    return "npx";
  }
  if (
    path.includes("/pnpm/dlx/") ||
    path.includes("/.pnpm/dlx/") ||
    path.includes("/pnpm-cache/dlx/")
  ) {
    return "pnpm dlx";
  }
  if (path.includes("/.bun/install/cache/") || path.includes("/bunx-")) {
    return "bunx";
  }
  return null;
}

export const resolveEntryPath = Effect.gen(function* () {
  if (yield* HostProcess.IsExecutable) return yield* HostProcess.ExecutablePath;
  return (yield* HostProcess.Arguments)[1] ?? "";
});

export const resolveServerInstallation = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const entry = yield* fs.realPath(yield* resolveEntryPath);
  const runtime = PINNED_RUNTIME_ENTRY.exec(entry);
  if (runtime) {
    const launchedAs = yield* resolveLauncherPath;
    if (launchedAs === undefined) return null;
    const link = yield* fs.readLink(launchedAs).pipe(Effect.option);
    // A launcher script execs the runtime itself, so look for the script that runs it.
    const launcher = Option.isSome(link)
      ? launchedAs
      : yield* findPosixLauncher({
          launchedAs,
          versionsDir: path.join(runtime[1] || "/", "runtime/versions"),
        });
    // None for a runtime started directly, as SSH launches do, or through a copy.
    if (launcher === undefined) return null;
    const target = Option.isSome(link)
      ? path.resolve(path.dirname(launcher), link.value)
      : yield* readPosixLauncherTarget(launcher);
    // Keep the home as the launcher spells it; `z9 update` only repoints launchers into that spelling.
    const linked = target === undefined ? null : PINNED_RUNTIME_ENTRY.exec(target);
    if (!linked || (yield* fs.realPath(linked[1] || "/")) !== (runtime[1] || "/")) return null;
    return {
      kind: "t3-launcher",
      launcher,
      baseDir: linked[1] || "/",
    } satisfies ServerInstallation;
  }
  const runner = detectCliRunner(entry);
  return runner === null
    ? null
    : ({ kind: runner === "pnpm dlx" ? "pnpm-dlx" : runner } satisfies ServerInstallation);
}).pipe(Effect.orElseSucceed(() => null));

const shellWord = (value: string) =>
  /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", `'"'"'`)}'`;

/** PowerShell also treats typographic quotes as delimiters; escape them and suppress expansion. */
const powershellWord = (value: string) =>
  `"${value
    .replaceAll("`", "``")
    .replaceAll("$", "`$")
    .replace(/["\u201C\u201D\u201E]/g, "$&$&")}"`;

export const hostShellWord = (platform: NodeJS.Platform, value: string) =>
  platform === "win32" ? powershellWord(value) : shellWord(value);

/** Script installs have no single launcher; desktop shims and standalone binaries do. */
const resolveInstallLauncher = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const shim = (yield* HostProcess.Environment).Z9CODE_CLI_PATH?.trim();
  if (shim && (yield* fs.exists(shim).pipe(Effect.orElseSucceed(() => false)))) {
    return Option.some(shim);
  }
  return (yield* HostProcess.IsExecutable)
    ? Option.some(yield* HostProcess.ExecutablePath)
    : Option.none<string>();
});

/**
 * Uses this install's `z9` on PATH or its absolute launcher path.
 * Arguments are quoted for POSIX shells or PowerShell on Windows.
 */
export const resolveHostCliCommand = Effect.fn("invocation.resolveHostCliCommand")(function* (
  subcommand: string,
  args: ReadonlyArray<string> = [],
) {
  const platform = yield* HostProcess.Platform;
  const withArgs = (prefix: string) =>
    // An empty subcommand names the root `z9` command.
    [prefix.trimEnd(), ...args.map((arg) => hostShellWord(platform, arg))].join(" ");
  const command = `z9 ${subcommand}`;
  const onPath = yield* resolveCommandPath("z9");
  if (onPath !== null) {
    const shim = (yield* HostProcess.Environment).Z9CODE_CLI_PATH?.trim();
    const fs = yield* FileSystem.FileSystem;
    const real = (file: string) => fs.realPath(file).pipe(Effect.orElseSucceed(() => null));
    // Windows `z9.cmd` shims are text files that never realpath to the executable they run.
    const own = shim
      ? yield* real(shim)
      : platform !== "win32" && (yield* HostProcess.IsExecutable)
        ? yield* resolveEntryPath.pipe(
            Effect.flatMap((entry) =>
              real(entry).pipe(Effect.map((resolved) => resolved ?? entry)),
            ),
          )
        : null;
    if (own === null || own === (yield* real(onPath))) {
      const path = yield* Path.Path;
      const searchPath = (yield* HostProcess.Environment).PATH ?? "";
      // With an empty or relative PATH entry, plain `z9` depends on the directory it runs from.
      const cwdDependent =
        platform !== "win32" &&
        searchPath.length > 0 &&
        searchPath.split(":").some((entry) => !path.isAbsolute(entry));
      if (!cwdDependent) return { command: withArgs(command), launcher: false };
      const quoted = hostShellWord(platform, path.resolve(onPath));
      return { command: withArgs(`${quoted} ${subcommand}`), launcher: false };
    }
  }
  const launcher = yield* resolveInstallLauncher;
  if (Option.isNone(launcher)) return { command: withArgs(command), launcher: false };
  // PowerShell runs a quoted path only through the call operator.
  const quoted = hostShellWord(platform, launcher.value);
  const call = platform === "win32" ? `& ${quoted}` : quoted;
  return { command: withArgs(`${call} ${subcommand}`), launcher: true };
});

/** A hint's command, run against the caller's `--base-dir` when one was given. */
export const resolveHostCliHint = (
  subcommand: string,
  baseDir: Option.Option<string>,
  args: ReadonlyArray<string> = [],
) =>
  resolveHostCliCommand(subcommand, [
    ...Option.match(baseDir, { onNone: () => [], onSome: (dir) => ["--base-dir", dir] }),
    ...args,
  ]).pipe(Effect.map(({ command }) => command));

/**
 * `sudo` resets PATH on most distributions, which drops a user-installed Node
 * (nvm, fnm, a tarball) and with it a `z9` installed beside it, so the command
 * carries PATH through unless Node is on root's PATH too. An absolute launcher
 * needs neither.
 */
export const resolveRootCliCommand = Effect.fn("invocation.resolveRootCliCommand")(function* (
  subcommand: string,
  args: ReadonlyArray<string> = [],
) {
  const { command, launcher } = yield* resolveHostCliCommand(subcommand, args);
  if (launcher) return `sudo ${command}`;
  const executablePath = yield* HostProcess.ExecutablePath;
  const systemNode = ROOT_PATH_DIRECTORIES.some((directory) =>
    executablePath.startsWith(`${directory}/`),
  );
  return systemNode ? `sudo ${command}` : `sudo env "PATH=$PATH" ${command}`;
});

const ROOT_PATH_DIRECTORIES = [
  "/usr/local/sbin",
  "/usr/local/bin",
  "/usr/sbin",
  "/usr/bin",
  "/sbin",
  "/bin",
];
