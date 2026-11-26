import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as HostProcess from "@z9code/shared/HostProcess";
import * as NetService from "@z9code/shared/Net";
import * as Cause from "effect/Cause";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Terminal from "effect/Terminal";
import * as TestConsole from "effect/testing/TestConsole";
import { Command } from "effect/cli";
import { afterEach, vi } from "vite-plus/test";

import packageJson from "../../package.json" with { type: "json" };
import * as BootService from "../service/bootService.ts";
import { upsertServiceEnv } from "./service.ts";
import { statusCommand, upCommand } from "./up.ts";

const SERVICE = {
  supported: true,
  installed: true,
  current: true,
  unitPath: "/home/me/.config/systemd/user/z9code.service",
  logPath: "/home/me/.z9code/userdata/logs/boot-service.log",
} as const;

// Prompts run only when both streams are terminals.
const asTerminal = Effect.acquireRelease(
  Effect.sync(() =>
    [process.stdin, process.stdout].map((stream) => {
      const descriptor = Object.getOwnPropertyDescriptor(stream, "isTTY");
      Object.defineProperty(stream, "isTTY", { configurable: true, value: true });
      return { stream, descriptor };
    }),
  ),
  (saved) =>
    Effect.sync(() => {
      for (const { stream, descriptor } of saved) {
        if (descriptor === undefined) Reflect.deleteProperty(stream, "isTTY");
        else Object.defineProperty(stream, "isTTY", descriptor);
      }
    }),
);

const answering = (text: string) =>
  Terminal.make({
    columns: Effect.succeed(80),
    rows: Effect.succeed(24),
    size: Queue.unbounded<Terminal.Size, Cause.Done>(),
    readInput: Effect.gen(function* () {
      const input = yield* Queue.unbounded<Terminal.UserInput, Cause.Done>();
      yield* Queue.offer(input, {
        input: Option.some(text),
        key: { name: text, ctrl: false, meta: false, shift: false },
      });
      return input;
    }),
    readLine: Effect.succeed(text),
    display: () => Effect.void,
  });

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, NetService.layer))("z9 up", (it) => {
  afterEach(() => vi.restoreAllMocks());

  it.effect.each<{
    readonly label: string;
    readonly installed: boolean;
    readonly status?: Partial<BootService.BootServiceStatus>;
    readonly installFails?: boolean;
    readonly restartFails?: boolean;
    readonly fails?: boolean;
    readonly reportStatus?: boolean;
    /** Runs as if in a terminal, answering each question with this text. */
    readonly answer?: string;
    /** Lines the run prints, with `<baseDir>` standing for the test's home. */
    readonly prints?: ReadonlyArray<string>;
    readonly omits?: string;
    readonly json?: object;
    readonly env: string;
    readonly args: ReadonlyArray<string>;
    readonly installs: number;
    readonly restarts: number;
    readonly envAfter: string;
  }>([
    {
      label: "nothing changed",
      installed: true,
      env: "Z9CODE_LAN=false\n",
      args: ["--no-lan"],
      installs: 0,
      restarts: 0,
      envAfter: "Z9CODE_LAN=false\n",
    },
    {
      label: "the local network opens",
      prints: ["Run `z9 pair --base-dir <baseDir>`."],
      installed: true,
      env: "Z9CODE_LAN=false\n",
      args: ["--lan"],
      installs: 0,
      restarts: 1,
      envAfter: "Z9CODE_LAN=true\n",
    },
    {
      label: "a new service starts with its settings",
      installed: false,
      env: "",
      args: ["--lan"],
      installs: 1,
      restarts: 0,
      envAfter: "Z9CODE_LAN=true\n",
    },
    {
      label: "a route turns off with no service to run",
      prints: ["Run `z9 --base-dir <baseDir>` to use z9code here."],
      installed: false,
      env: "Z9CODE_LAN=true\n",
      args: ["--no-lan"],
      installs: 0,
      restarts: 0,
      envAfter: "Z9CODE_LAN=false\n",
    },
    {
      label: "a stopped newer service starts as it is",
      installed: true,
      status: { current: false, installedVersion: "999.0.0", problems: ["service-stopped"] },
      env: "Z9CODE_LAN=false\n",
      args: ["--yes"],
      installs: 0,
      restarts: 1,
      envAfter: "Z9CODE_LAN=false\n",
    },
    {
      label: "a failed update keeps service.env matching the old service",
      // The old service still runs, so no foreground server is offered.
      prints: ["Fix that, then run `z9 up --base-dir <baseDir>` again."],
      installed: true,
      status: { current: false },
      installFails: true,
      env: "",
      args: ["--no-lan"],
      installs: 0,
      restarts: 0,
      envAfter: "",
    },
    {
      label: "a failed restart puts service.env back and restarts on it",
      installed: true,
      restartFails: true,
      env: "Z9CODE_LAN=false\n",
      args: ["--lan"],
      installs: 0,
      restarts: 2,
      envAfter: "Z9CODE_LAN=false\n",
    },
    {
      label: "declining an update changes nothing",
      installed: true,
      status: { current: false },
      answer: "n",
      env: "Z9CODE_LAN=false\n",
      args: ["--lan"],
      installs: 0,
      restarts: 0,
      envAfter: "Z9CODE_LAN=false\n",
    },
    {
      label: "a service for another home is refused without a restart",
      installed: true,
      status: { current: false, otherBaseDir: "/srv/t3 home" },
      fails: true,
      answer: "y",
      env: "Z9CODE_LAN=false\n",
      args: ["--lan"],
      installs: 0,
      restarts: 0,
      envAfter: "Z9CODE_LAN=false\n",
    },
    {
      label: "another home's service supplies no local network default",
      installed: true,
      status: { current: false, otherBaseDir: "/srv/t3 home" },
      reportStatus: true,
      json: {
        service: { otherBaseDir: "/srv/t3 home" },
        lan: { enabled: false, inheritedDefault: false },
      },
      env: "",
      args: ["--json"],
      installs: 0,
      restarts: 0,
      envAfter: "",
    },
    {
      label: "status hints keep the caller's --base-dir",
      installed: true,
      reportStatus: true,
      prints: [
        "Turn it off: `z9 up --base-dir <baseDir> --no-lan`.",
        "Change access: `z9 up --base-dir <baseDir>`.",
      ],
      env: "",
      args: [],
      installs: 0,
      restarts: 0,
      envAfter: "",
    },
    {
      label: "a host override gets no --no-lan hint it would ignore",
      installed: true,
      reportStatus: true,
      prints: ["overridden · Z9CODE_HOST=0.0.0.0"],
      omits: "--no-lan",
      env: "Z9CODE_HOST=0.0.0.0\n",
      args: [],
      installs: 0,
      restarts: 0,
      envAfter: "Z9CODE_HOST=0.0.0.0\n",
    },
    {
      label: "no service manager still records the choice",
      installed: false,
      status: { supported: false },
      env: "",
      args: ["--lan"],
      installs: 0,
      restarts: 0,
      envAfter: "Z9CODE_LAN=true\n",
    },
    {
      label: "the old default is kept",
      installed: true,
      env: "",
      args: ["--yes"],
      installs: 0,
      restarts: 0,
      envAfter: "Z9CODE_LAN=true\n",
    },
  ])("keeps service changes and access settings consistent: $label", (input) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-up-test-" });
      yield* fs.writeFileString(`${baseDir}/service.env`, input.env);
      let installs = 0;
      let restarts = 0;
      const status = {
        ...SERVICE,
        installed: input.installed,
        current: input.installed,
        ...input.status,
      };
      vi.spyOn(BootService, "layer").mockReturnValue(
        Layer.succeed(
          BootService.BootService,
          BootService.BootService.of({
            status: Effect.succeed(status),
            withStopped: (operation) => operation,
            restart: Effect.sync(() => restarts++).pipe(
              Effect.andThen(
                input.restartFails === true
                  ? Effect.fail(new BootService.BootServiceCommandError({ step: "restart" }))
                  : Effect.succeed("restarted" as const),
              ),
            ),
            install: () =>
              status.otherBaseDir !== undefined
                ? Effect.fail(
                    new BootService.BootServiceOtherBaseDirError({
                      installedBaseDir: status.otherBaseDir,
                      baseDir,
                    }),
                  )
                : input.installFails === true
                  ? Effect.fail(
                      new BootService.BootServicePrerequisiteError({ problem: "linger-disabled" }),
                    )
                  : Effect.sync(() => {
                      installs++;
                      return {
                        program: ["z9"],
                        baseDir,
                        unitPath: status.unitPath,
                        logPath: status.logPath,
                      };
                    }),
            uninstall: Effect.succeed(false),
          }),
        ),
      );

      if (input.answer !== undefined) yield* asTerminal;
      const run = input.reportStatus
        ? Command.runWith(statusCommand, { version: packageJson.version })
        : Command.runWith(upCommand, { version: packageJson.version });
      const { exit, lines } = yield* run(["--base-dir", baseDir, ...input.args]).pipe(
        Effect.provideService(HostProcess.Environment, {}),
        input.answer === undefined
          ? (effect) => effect
          : Effect.provideService(Terminal.Terminal, answering(input.answer)),
        Effect.exit,
        Effect.flatMap((exit) =>
          Effect.map(TestConsole.logLines, (lines) => ({ exit, lines: lines.map(String) })),
        ),
        Effect.provide(
          Layer.mergeAll(
            ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })),
            Layer.fresh(TestConsole.layer),
          ),
        ),
      );
      for (const line of input.prints ?? []) {
        expect(lines.join("\n")).toContain(line.replace("<baseDir>", baseDir));
      }
      if (input.omits !== undefined) {
        expect(lines.join("\n")).not.toContain(input.omits);
      }
      if (input.json !== undefined) {
        expect(JSON.parse(lines.join("\n"))).toMatchObject(input.json);
      }
      expect(exit._tag).toBe(
        input.restartFails === true || input.fails === true ? "Failure" : "Success",
      );
      expect({ installs, restarts }).toEqual({
        installs: input.installs,
        restarts: input.restarts,
      });
      expect(yield* fs.readFileString(`${baseDir}/service.env`)).toBe(input.envAfter);
    }),
  );
});

it("rewrites only the named service.env keys and keeps the user's lines", () => {
  const before = ["# my settings", "Z9CODE_PORT=4000", "export Z9CODE_LAN=0", "Z9CODE_LAN=1", ""];
  expect(upsertServiceEnv(before.join("\n"), { Z9CODE_LAN: "true", Z9CODE_HOST: undefined })).toBe(
    ["# my settings", "Z9CODE_PORT=4000", "Z9CODE_LAN=true", ""].join("\n"),
  );
  expect(upsertServiceEnv("", { Z9CODE_LAN: "false" })).toBe("Z9CODE_LAN=false\n");
  expect(
    upsertServiceEnv('Z9CODE_LAN="a\nb"\nCUSTOM="x\nZ9CODE_LAN=y"\nZ9CODE_LAN=true\n', {
      Z9CODE_LAN: "false",
    }),
  ).toBe('Z9CODE_LAN=false\nCUSTOM="x\nZ9CODE_LAN=y"\n');
  expect(
    upsertServiceEnv('Z9CODE_LAN=\u00a0"unused\nCUSTOM=keep\nEND="\nZ9CODE_LAN=true\n', {
      Z9CODE_LAN: "false",
    }),
  ).toBe('Z9CODE_LAN=false\nCUSTOM=keep\nEND="\n');
  const long = `CUSTOM="${"\n".repeat(130_000)}"\n`;
  expect(upsertServiceEnv(`${long}Z9CODE_LAN=true\n`, { Z9CODE_LAN: "false" })).toBe(
    `${long}Z9CODE_LAN=false\n`,
  );
});
