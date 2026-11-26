import { expect, it } from "@effect/vitest";
import { ServerCliReleaseError } from "@z9code/contracts";
import type { ManagedPolicyDocument } from "@z9code/contracts";
import * as HostProcess from "@z9code/shared/HostProcess";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";
import * as Result from "effect/Result";
import * as TestClock from "effect/testing/TestClock";

import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as CliReleaseLookup from "./cliReleaseLookup.ts";

const nightly = "0.1.5-nightly.20261030.1";
const stable = "0.1.4";
const releasesApi = "https://api.github.com/repos/ZelinZhu-Richard/z9code/releases";
const downloads = "https://github.com/ZelinZhu-Richard/z9code/releases/download";

type Reply = Response | "unreachable";

const makeService = Effect.fnUntraced(function* (
  reply: (url: string) => Reply,
  environment: NodeJS.ProcessEnv = {},
  policy?: ManagedPolicyDocument,
) {
  const requests: Array<{ readonly url: string; readonly authorization: string | undefined }> = [];
  const service = yield* CliReleaseLookup.make().pipe(
    Effect.provideService(
      HttpClient.HttpClient,
      HttpClient.make((request) => {
        requests.push({ url: request.url, authorization: request.headers.authorization });
        const response = reply(request.url);
        return response === "unreachable"
          ? Effect.fail(
              new HttpClientError.HttpClientError({
                reason: new HttpClientError.TransportError({ request, description: "sensitive" }),
              }),
            )
          : Effect.succeed(HttpClientResponse.fromWeb(request, response));
      }),
    ),
    Effect.provideService(HostProcess.Environment, environment),
    Effect.provideService(HostProcess.Platform, "linux"),
    Effect.provideService(HostProcess.Architecture, "x64"),
    Effect.provide(ManagedPolicy.layerTest(policy)),
  );
  return { service, requests };
});

const manifest = (version: string, databaseMigration: number) =>
  Response.json({ version, databaseMigration });
const notFound = () => new Response("Not Found", { status: 404 });

it.effect("reads each track's newest release and its migration from release.json", () =>
  Effect.gen(function* () {
    const { service, requests } = yield* makeService(
      (url) => {
        if (url === `${releasesApi}?per_page=100&page=1`) {
          return Response.json([
            { tag_name: "v0.1.6-preview.20261101.1" },
            { tag_name: "v0.1.6-nightly.20261101.1", draft: true },
            { tag_name: `v${nightly}` },
          ]);
        }
        if (url === `${releasesApi}?per_page=100&page=2`) {
          return Response.json([{ tag_name: `v${stable}` }]);
        }
        if (url === `${downloads}/v${nightly}/release.json`) return manifest(nightly, 42);
        if (url === `${downloads}/v${stable}/release.json`) return notFound();
        return Response.json([]);
      },
      { GH_TOKEN: "gh-token" },
    );
    expect(yield* service.get({ spec: "nightly" })).toEqual({
      version: nightly,
      databaseMigration: 42,
    });
    // Without release.json the field stays absent, so the host refuses to leave Nightly.
    expect(yield* service.get({ spec: "latest" })).toEqual({ version: stable });
    expect(requests).toEqual([
      { url: `${releasesApi}?per_page=100&page=1`, authorization: "Bearer gh-token" },
      { url: `${downloads}/v${nightly}/release.json`, authorization: undefined },
      { url: `${releasesApi}?per_page=100&page=1`, authorization: "Bearer gh-token" },
      { url: `${releasesApi}?per_page=100&page=2`, authorization: "Bearer gh-token" },
      { url: `${downloads}/v${stable}/release.json`, authorization: undefined },
    ]);
  }),
);

it.effect("reads release.json from the release base URL override", () =>
  Effect.gen(function* () {
    const { service, requests } = yield* makeService(
      (url) =>
        url.endsWith("/release.json")
          ? manifest(nightly, 42)
          : Response.json([{ tag_name: `v${nightly}` }]),
      { Z9CODE_RELEASE_BASE_URL: "https://releases.example.com/z9" },
    );
    expect(yield* service.get({ spec: "nightly" })).toEqual({
      version: nightly,
      databaseMigration: 42,
    });
    expect(requests.map((request) => request.url)).toEqual([
      `${releasesApi}?per_page=100&page=1`,
      `https://releases.example.com/z9/v${nightly}/release.json`,
    ]);
  }),
);

it.effect("resolves releases only from a managed update mirror", () =>
  Effect.gen(function* () {
    const mirror = "https://updates.example.com/z9code";
    const { service, requests } = yield* makeService(
      (url) => {
        const path = url.replace(/\?token=abc$/, "");
        if (path === `${mirror}/latest-linux.yml`) return new Response(`version: ${stable}\n`);
        if (path === `${mirror}/nightly-linux.yml`) return new Response(`version: '${nightly}'\n`);
        if (path === `${mirror}/v${nightly}/release.json`) return manifest(nightly, 42);
        if (path === `${mirror}/v${stable}/SHA256SUMS`) return new Response("sums");
        return notFound();
      },
      { GH_TOKEN: "gh-token", Z9CODE_RELEASE_BASE_URL: "https://releases.example.com/z9" },
      {
        schemaVersion: 1,
        organization: "Example Corp",
        limits: { updates: { mode: "auto", feedUrl: `${mirror}/?token=abc` } },
      },
    );
    expect(yield* service.get({ spec: "nightly" })).toEqual({
      version: nightly,
      databaseMigration: 42,
    });
    expect(yield* service.get({ spec: "latest" })).toEqual({ version: stable });
    expect(yield* service.get({ spec: stable })).toEqual({ version: stable });
    // A version the mirror has not approved is not offered, even when GitHub has it.
    expect(yield* service.get({ spec: "9.9.9" })).toBeNull();
    expect(requests.every((request) => request.url.startsWith(`${mirror}/`))).toBe(true);
    expect(requests.every((request) => request.url.endsWith("?token=abc"))).toBe(true);
    expect(requests.every((request) => request.authorization === undefined)).toBe(true);
  }),
);

it.effect("caches each lookup for a minute", () =>
  Effect.gen(function* () {
    const { service, requests } = yield* makeService((url) =>
      url.endsWith("/release.json")
        ? manifest(nightly, 42)
        : Response.json([{ tag_name: `v${nightly}` }]),
    );
    yield* service.get({ spec: "nightly" });
    yield* service.get({ spec: "nightly" });
    expect(requests).toHaveLength(2);
    yield* TestClock.adjust("1 minute");
    yield* service.get({ spec: "nightly" });
    expect(requests).toHaveLength(4);
  }),
);

it.effect("returns an exact version only when that release is published", () =>
  Effect.gen(function* () {
    const { service, requests } = yield* makeService((url) => {
      if (url === `${releasesApi}/tags/v${nightly}`) {
        return Response.json({ tag_name: `v${nightly}` });
      }
      if (url === `${downloads}/v${nightly}/release.json`) return manifest(nightly, 42);
      if (url === `${releasesApi}/tags/v9.9.8`) {
        return Response.json({ tag_name: "v9.9.8", draft: true });
      }
      return notFound();
    });
    expect(yield* service.get({ spec: nightly })).toEqual({
      version: nightly,
      databaseMigration: 42,
    });
    expect(yield* service.get({ spec: "9.9.9" })).toBeNull();
    expect(yield* service.get({ spec: "9.9.8" })).toBeNull();
    expect(requests.map((request) => request.url)).toEqual([
      `${releasesApi}/tags/v${nightly}`,
      `${downloads}/v${nightly}/release.json`,
      `${releasesApi}/tags/v9.9.9`,
      `${releasesApi}/tags/v9.9.8`,
    ]);
  }),
);

it.effect("returns null when no release is on the track", () =>
  Effect.gen(function* () {
    const { service } = yield* makeService(() => Response.json([]));
    expect(yield* service.get({ spec: "latest" })).toBeNull();
  }),
);

it.effect.each([
  { name: "an unreachable index", index: "unreachable", manifest: "valid" },
  { name: "a rate-limited index", index: 403, manifest: "valid" },
  { name: "a malformed index", index: "malformed", manifest: "valid" },
  { name: "an unreachable manifest", index: "valid", manifest: 500 },
  { name: "a malformed manifest", index: "valid", manifest: "malformed" },
  { name: "a manifest for another version", index: "valid", manifest: "mismatched" },
] as const)("reports $name as a failed lookup, not a missing release", (fixture) =>
  Effect.gen(function* () {
    const respond = (value: string | number, valid: () => Response): Reply =>
      value === "unreachable"
        ? "unreachable"
        : typeof value === "number"
          ? new Response("sensitive", { status: value })
          : value === "malformed"
            ? new Response("sensitive")
            : value === "mismatched"
              ? manifest("9.9.9", 1)
              : valid();
    const { service } = yield* makeService((url) =>
      url.endsWith("/release.json")
        ? respond(fixture.manifest, () => manifest(nightly, 42))
        : respond(fixture.index, () => Response.json([{ tag_name: `v${nightly}` }])),
    );
    const found = yield* service.get({ spec: "nightly" }).pipe(Effect.result);
    expect(Result.isFailure(found)).toBe(true);
    if (Result.isFailure(found)) {
      expect(found.failure).toBeInstanceOf(ServerCliReleaseError);
      expect(found.failure.message).toContain("z9code's releases");
      expect(found.failure.message).not.toContain("sensitive");
    }
  }),
);

it.effect.each(["--registry=https://example.com", "../other", "other-package@latest", "*", ""])(
  "rejects invalid release specs before any request: %s",
  (spec) =>
    Effect.gen(function* () {
      const { service, requests } = yield* makeService(() => "unreachable");
      expect(Result.isFailure(yield* service.get({ spec }).pipe(Effect.result))).toBe(true);
      expect(requests).toEqual([]);
    }),
);
