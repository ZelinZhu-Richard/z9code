import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { Z9_PROJECT_FILE_NAME, type Z9ProjectFile } from "@z9code/contracts";
import { Z9ProjectFileFromJson } from "@z9code/shared/t3ProjectFile";

const decodeT3ProjectFileJson = Schema.decodeEffect(Z9ProjectFileFromJson);

export class Z9ProjectFileLoadError extends Schema.TaggedError<Z9ProjectFileLoadError>()(
  "Z9ProjectFileLoadError",
  {
    operation: Schema.Literals(["read", "decode"]),
    workspaceRoot: Schema.String,
    filePath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} ${Z9_PROJECT_FILE_NAME} at ${this.filePath}.`;
  }
}

export class Z9ProjectFileLoader extends Context.Service<
  Z9ProjectFileLoader,
  {
    /** Never fails; missing/unreadable/invalid files return none, with warnings for invalid files. */
    readonly load: (workspaceRoot: string) => Effect.Effect<Option.Option<Z9ProjectFile>>;
  }
>()("z9/project/Z9ProjectFileLoader") {}

const logT3ProjectFileLoadError = (error: Z9ProjectFileLoadError) =>
  Effect.logWarning(error).pipe(
    Effect.annotateLogs({
      operation: error.operation,
      workspaceRoot: error.workspaceRoot,
      filePath: error.filePath,
      errorTag: error._tag,
    }),
  );

/** @public */
export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const load: Z9ProjectFileLoader["Service"]["load"] = Effect.fn("Z9ProjectFileLoader.load")(
    function* (workspaceRoot) {
      const filePath = path.join(workspaceRoot, Z9_PROJECT_FILE_NAME);
      const raw = yield* fileSystem.readFileString(filePath).pipe(
        Effect.asSome,
        Effect.catchTags({
          PlatformError: (error) =>
            error.reason._tag === "NotFound"
              ? Effect.succeed(Option.none<string>())
              : logT3ProjectFileLoadError(
                  new Z9ProjectFileLoadError({
                    operation: "read",
                    workspaceRoot,
                    filePath,
                    cause: error,
                  }),
                ).pipe(Effect.as(Option.none<string>())),
        }),
      );
      if (Option.isNone(raw)) {
        return Option.none<Z9ProjectFile>();
      }
      return yield* decodeT3ProjectFileJson(raw.value).pipe(
        Effect.asSome,
        Effect.catchTags({
          SchemaError: (error) =>
            logT3ProjectFileLoadError(
              new Z9ProjectFileLoadError({
                operation: "decode",
                workspaceRoot,
                filePath,
                cause: error,
              }),
            ).pipe(Effect.as(Option.none<Z9ProjectFile>())),
        }),
      );
    },
  );

  return Z9ProjectFileLoader.of({ load });
});

export const layer = Layer.effect(Z9ProjectFileLoader, make);
