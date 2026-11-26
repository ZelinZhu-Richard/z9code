import { EnvironmentAuthInvalidError } from "@z9code/contracts";
import { describe, expect, it } from "@effect/vitest";

import { isHostCredentialRefusal, mapRemoteDpopEnvironmentError } from "./errors.ts";
import { DPOP_UNKNOWN_HINT } from "../dpop/presentation.ts";
import { RemoteEnvironmentAuthFetchError, RemoteEnvironmentAuthTimeoutError } from "../rpc/http.ts";

describe("mapRemoteDpopEnvironmentError", () => {
  it.each([
    new RemoteEnvironmentAuthFetchError({
      message: "Failed to fetch remote environment endpoint.",
      cause: new TypeError("Failed to fetch"),
    }),
    new RemoteEnvironmentAuthTimeoutError({
      requestUrl: "https://environment.example.test",
      timeoutMs: 10_000,
    }),
  ])("reports an unreachable host as transient: $_tag", (error) => {
    const mapped = mapRemoteDpopEnvironmentError(error);
    expect(mapped).toMatchObject({
      _tag: "ConnectionTransientError",
      detail: error.message,
      hop: "server",
    });
  });

  it("presents clock skew as one possible cause for a generic invalid credential", () => {
    const mapped = mapRemoteDpopEnvironmentError(
      new EnvironmentAuthInvalidError({
        code: "auth_invalid",
        reason: "invalid_credential",
        traceId: "trace-1",
      }),
    );
    expect(mapped).toMatchObject({
      _tag: "ConnectionBlockedError",
      reason: "authentication",
      detail: `The environment credential is invalid. ${DPOP_UNKNOWN_HINT}`,
    });
  });

  it("keeps a host's clock refusal apart from a refused pairing", () => {
    const mapped = mapRemoteDpopEnvironmentError(
      new EnvironmentAuthInvalidError({
        code: "auth_invalid",
        reason: "invalid_credential",
        dpopFailureReason: "time_window",
        traceId: "trace-clock",
      }),
    );
    expect(mapped).toMatchObject({ failureCause: "clock_skew" });
    expect(isHostCredentialRefusal(mapped)).toBe(false);
  });
});
