import {
  ServerCliReleaseError,
  ServerCliReleaseInput,
  type ServerCliRelease,
} from "@z9code/contracts";
import * as HostProcess from "@z9code/shared/HostProcess";
import {
  CLI_RELEASE_BASE_URL_ENV,
  CLI_RELEASE_CHECKSUMS_FILE,
  CLI_RELEASE_MANIFEST_FILE,
  cliReleaseAssetUrl,
  cliReleaseByTagUrl,
  cliReleaseChannelOf,
  cliReleaseIndexPageUrl,
  newestCliReleaseVersion,
  parseCliReleaseManifest,
  releaseAssetUrl,
  updateFeedFileName,
  type CliReleaseChannel,
} from "@z9code/shared/cliRelease";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import { managedUpdateMirror } from "../policy/managedUpdates.ts";
import { isExactServiceVersion } from "./serviceProtocol.ts";

class CliReleaseIndexError extends Schema.TaggedError<CliReleaseIndexError>()(
  "CliReleaseIndexError",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

const Release = Schema.Struct({
  tag_name: Schema.String,
  draft: Schema.optional(Schema.Boolean),
});
const decodeRelease = Schema.decodeUnknownEffect(Schema.fromJsonString(Release));
const decodeReleaseIndex = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Release)));
const decodeInput = Schema.decodeUnknownEffect(ServerCliReleaseInput);

const RELEASE_REQUEST_TIMEOUT = Duration.seconds(30);
const RELEASE_INDEX_MAX_PAGES = 10;

/** A body, or undefined on 404; GH_TOKEN raises the GitHub API's anonymous rate limit. */
const fetchRelease = Effect.fn("CliReleaseLookup.fetchRelease")(function* (
  url: string,
  failure: string,
  options: { readonly authenticated: boolean },
) {
  const httpClient = yield* HttpClient.HttpClient;
  const environment = yield* HostProcess.Environment;
  const githubToken = options.authenticated
    ? environment.GH_TOKEN?.trim() || environment.GITHUB_TOKEN?.trim() || undefined
    : undefined;
  const request = HttpClientRequest.get(url).pipe(
    HttpClientRequest.setHeader("Accept", "application/vnd.github+json"),
  );
  const authenticatedRequest =
    githubToken === undefined
      ? request
      : HttpClientRequest.setHeader(request, "Authorization", `Bearer ${githubToken}`);
  return yield* Effect.gen(function* () {
    const response = yield* httpClient.execute(authenticatedRequest);
    if (response.status === 404) return undefined;
    if (response.status < 200 || response.status >= 300) {
      return yield* new CliReleaseIndexError({ reason: failure });
    }
    return yield* response.text;
  }).pipe(
    Effect.mapError(() => new CliReleaseIndexError({ reason: failure })),
    Effect.timeoutOrElse({
      duration: RELEASE_REQUEST_TIMEOUT,
      orElse: () => Effect.fail(new CliReleaseIndexError({ reason: failure })),
    }),
  );
});

/** The newest published release on `channel`, paging until one matches. */
export const findNewestCliVersion = Effect.fn("CliReleaseLookup.findNewestVersion")(function* (
  channel: CliReleaseChannel,
) {
  for (let page = 1; page <= RELEASE_INDEX_MAX_PAGES; page += 1) {
    const body = yield* fetchRelease(cliReleaseIndexPageUrl(page), "Could not list z9 releases.", {
      authenticated: true,
    });
    if (body === undefined) {
      return yield* new CliReleaseIndexError({ reason: "Could not list z9 releases." });
    }
    const releases = yield* decodeReleaseIndex(body).pipe(
      Effect.mapError(
        () => new CliReleaseIndexError({ reason: "The z9 release index had an unexpected shape." }),
      ),
    );
    const version = newestCliReleaseVersion(releases, channel);
    if (version !== undefined) return version;
    if (releases.length === 0) break;
  }
  return undefined;
});

interface UpdateMirror {
  readonly organization: string;
  readonly feedUrl: string;
}

/** The version an update mirror's feed file for this platform offers on `channel`. */
export const findMirrorCliVersion = Effect.fn("CliReleaseLookup.findMirrorVersion")(function* (
  mirror: UpdateMirror,
  channel: CliReleaseChannel,
) {
  if (channel === "preview") {
    return yield* new CliReleaseIndexError({
      reason: `${mirror.organization}'s update mirror has no preview builds.`,
    });
  }
  const fileName = updateFeedFileName(
    channel === "nightly" ? "nightly" : "latest",
    yield* HostProcess.Platform,
    yield* HostProcess.Architecture,
  );
  // Not the URL, whose query can hold the mirror's access token.
  const unreadable = new CliReleaseIndexError({
    reason: `Could not read ${fileName} from ${mirror.organization}'s update mirror.`,
  });
  const body = yield* fetchRelease(releaseAssetUrl(mirror.feedUrl, fileName), unreadable.reason, {
    authenticated: false,
  });
  const version = body === undefined ? undefined : /^version:\s*["']?([^"'\s]+)/m.exec(body)?.[1];
  if (
    version === undefined ||
    !isExactServiceVersion(version) ||
    cliReleaseChannelOf(version) !== channel
  ) {
    return yield* unreadable;
  }
  return version;
});

/** A mirror holds only approved versions, so an exact one exists when its checksums do. */
const findExactMirrorCliVersion = Effect.fn("CliReleaseLookup.findExactMirrorVersion")(function* (
  mirror: UpdateMirror,
  version: string,
) {
  const body = yield* fetchRelease(
    releaseAssetUrl(mirror.feedUrl, `v${version}`, CLI_RELEASE_CHECKSUMS_FILE),
    `Could not read z9@${version} from ${mirror.organization}'s update mirror.`,
    { authenticated: false },
  );
  return body === undefined ? undefined : version;
});

const findExactCliVersion = Effect.fn("CliReleaseLookup.findExactVersion")(function* (
  version: string,
) {
  const body = yield* fetchRelease(cliReleaseByTagUrl(version), "Could not read the z9 release.", {
    authenticated: true,
  });
  if (body === undefined) return undefined;
  const release = yield* decodeRelease(body).pipe(
    Effect.mapError(
      () => new CliReleaseIndexError({ reason: "The z9 release had an unexpected shape." }),
    ),
  );
  return release.draft === true ? undefined : version;
});

/** Undefined when the release publishes no manifest; the host then refuses to leave Nightly. */
const readDatabaseMigration = Effect.fn("CliReleaseLookup.readDatabaseMigration")(function* (
  version: string,
  baseUrl: string | undefined,
) {
  const body = yield* fetchRelease(
    cliReleaseAssetUrl(version, CLI_RELEASE_MANIFEST_FILE, baseUrl),
    "Could not read the release manifest.",
    { authenticated: false },
  );
  if (body === undefined) return undefined;
  const manifest = parseCliReleaseManifest(body);
  if (manifest === undefined || manifest.version !== version) {
    return yield* new CliReleaseIndexError({ reason: "The release manifest was invalid." });
  }
  return manifest.databaseMigration;
});

export class CliReleaseLookup extends Context.Service<
  CliReleaseLookup,
  {
    readonly get: (
      input: ServerCliReleaseInput,
    ) => Effect.Effect<ServerCliRelease | null, ServerCliReleaseError>;
  }
>()("z9/service/cliReleaseLookup") {}

export const make = Effect.fn("CliReleaseLookup.make")(function* () {
  const httpClient = yield* HttpClient.HttpClient;
  const environment = yield* HostProcess.Environment;
  const platform = yield* HostProcess.Platform;
  const architecture = yield* HostProcess.Architecture;
  const policy = yield* ManagedPolicy.ManagedPolicy;
  // Resolves tracks the way `z9 update` does, so a mirror install never reaches GitHub.
  const mirror = managedUpdateMirror(policy.document);
  const releaseBaseUrl = mirror?.feedUrl ?? environment[CLI_RELEASE_BASE_URL_ENV];
  const cache = yield* Cache.make({
    capacity: 32,
    timeToLive: Duration.minutes(1),
    lookup: Effect.fn("CliReleaseLookup.lookup")(
      function* (spec: string) {
        const track = spec === "latest" ? "stable" : spec === "nightly" ? "nightly" : undefined;
        const version = yield* mirror === undefined
          ? track === undefined
            ? findExactCliVersion(spec)
            : findNewestCliVersion(track)
          : track === undefined
            ? findExactMirrorCliVersion(mirror, spec)
            : findMirrorCliVersion(mirror, track);
        if (version === undefined) return null;
        const databaseMigration = yield* readDatabaseMigration(version, releaseBaseUrl);
        return {
          version,
          ...(databaseMigration === undefined ? {} : { databaseMigration }),
        };
      },
      (effect) =>
        effect.pipe(
          Effect.mapError((error) => new ServerCliReleaseError({ reason: error.reason })),
          Effect.provideService(HttpClient.HttpClient, httpClient),
          Effect.provideService(HostProcess.Environment, environment),
          Effect.provideService(HostProcess.Platform, platform),
          Effect.provideService(HostProcess.Architecture, architecture),
        ),
    ),
  });
  return CliReleaseLookup.of({
    get: Effect.fn("CliReleaseLookup.get")(function* (input) {
      const { spec } = yield* decodeInput(input).pipe(
        Effect.mapError(
          () => new ServerCliReleaseError({ reason: "Invalid release version or track." }),
        ),
      );
      return yield* Cache.get(cache, spec);
    }),
  });
});

export const layer = Layer.effect(CliReleaseLookup, make()).pipe(
  Layer.provide(FetchHttpClient.layer),
);
