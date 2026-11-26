import { type ServerConfig, ServerCliReleaseError } from "@z9code/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";
import { msg } from "gt-react";

import { m, type MessageResolver } from "../i18n/messages";

import { environmentSummaries } from "./presentation";
import { primaryEnvironmentIdAtom } from "./primaryEnvironment";
import { serverEnvironment } from "./server";

const isServerCliReleaseError = Schema.is(ServerCliReleaseError);

function unsupportedLookup(config: ServerConfig | null): ServerCliReleaseError | null {
  if (config === null) {
    return new ServerCliReleaseError({
      reason: m(msg("Connect to this server to check releases.")),
    });
  }
  return config.environment.capabilities.cliReleaseLookup === true
    ? null
    : new ServerCliReleaseError({
        reason: m(msg("This server cannot look up releases. Update it before switching tracks.")),
      });
}

export function cliReleaseFailureMessage(
  cause: Cause.Cause<unknown>,
  resolve: MessageResolver = m,
): string {
  const error = Option.getOrUndefined(Cause.findErrorOption(cause));
  return isServerCliReleaseError(error)
    ? error.message
    : resolve(
        msg("Could not check z9code's GitHub releases. Check this environment's connection."),
      );
}

export const cliReleaseAtom = Atom.family((spec: string) =>
  Atom.make((get) => {
    const primary = get(primaryEnvironmentIdAtom);
    // With the desktop's local server turned off there is no primary, so a connected server answers.
    const candidates =
      primary === null ? get(environmentSummaries.connectedEnvironmentIdsAtom) : [primary];
    const environmentId =
      candidates.find(
        (id) => unsupportedLookup(get(serverEnvironment.configValueAtom(id))) === null,
      ) ?? candidates[0];
    if (environmentId === undefined) {
      return Effect.fail(
        new ServerCliReleaseError({ reason: m(msg("Connect to a server to check releases.")) }),
      );
    }
    const unsupported = unsupportedLookup(get(serverEnvironment.configValueAtom(environmentId)));
    if (unsupported !== null) return Effect.fail(unsupported);
    return get
      .result(serverEnvironment.cliRelease({ environmentId, input: { spec } }))
      .pipe(
        Effect.map((release) =>
          release === null
            ? null
            : { version: release.version, databaseMigration: release.databaseMigration },
        ),
      );
  }).pipe(Atom.withLabel(`cli-release:${spec}`)),
);
