import {
  DELETED_THREAD_LOOKUP_MAX_IDS,
  EnvironmentId,
  ORCHESTRATION_V2_WS_METHODS,
  type OrchestrationV2ShellStreamItem,
  ThreadId,
} from "@z9code/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
} from "../connection/model.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import * as Persistence from "../platform/persistence.ts";
import type * as RpcSession from "../rpc/session.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import { pruneDeletedCachedThreads } from "./deletedThreadCache.ts";
import { makeEnvironmentShellState } from "./shell.ts";
import * as ShellSnapshotLoader from "./shellSnapshotHttp.ts";
import { v2ShellSnapshot } from "./orchestrationV2TestFixtures.ts";

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});
const PREPARED: PreparedConnection = {
  environmentId: TARGET.environmentId,
  label: TARGET.label,
  httpBaseUrl: TARGET.httpBaseUrl,
  socketUrl: TARGET.wsBaseUrl,
  httpAuthorization: null,
  target: TARGET,
};

const makeHarness = Effect.fn("test.makeDeletedThreadHarness")(function* (options: {
  readonly deletedThreadLookup: boolean;
  readonly cachedThreadIds: ReadonlyArray<string>;
  readonly answer?: (threadIds: ReadonlyArray<ThreadId>) => Effect.Effect<ReadonlyArray<ThreadId>>;
}) {
  const events = yield* Queue.unbounded<OrchestrationV2ShellStreamItem>();
  const lookups = yield* Ref.make<ReadonlyArray<ReadonlyArray<ThreadId>>>([]);
  const removed = yield* Ref.make<ReadonlyArray<ThreadId>>([]);
  const removedSignal = yield* Deferred.make<void>();
  const client = {
    [ORCHESTRATION_V2_WS_METHODS.subscribeShell]: () => Stream.fromQueue(events),
    [ORCHESTRATION_V2_WS_METHODS.getDeletedThreadIds]: (input: {
      readonly threadIds: ReadonlyArray<ThreadId>;
    }) =>
      Ref.update(lookups, (current) => [...current, input.threadIds]).pipe(
        Effect.andThen(options.answer?.(input.threadIds) ?? Effect.succeed([])),
      ),
  } as unknown as WsRpcProtocolClient;
  const session: RpcSession.RpcSession = {
    client,
    initialConfig: Effect.succeed({
      shellResumeCompletionMarker: true,
      environment: { serverVersion: "1.0.0" },
      ...(options.deletedThreadLookup ? { deletedThreadLookup: true } : {}),
    } as never),
    subscribeServerConfig: () => Stream.never,
    ready: Effect.void,
    probe: Effect.void,
    inboundFrames: Effect.succeed(0),
    closed: Effect.never,
  };
  const cache = Persistence.EnvironmentCacheStore.of({
    loadShell: () => Effect.succeedNone,
    saveShell: () => Effect.void,
    loadThread: () => Effect.succeedNone,
    saveThread: () => Effect.void,
    removeThread: (_environmentId, threadId) =>
      Ref.update(removed, (current) => [...current, threadId]).pipe(
        Effect.andThen(Deferred.succeed(removedSignal, undefined)),
      ),
    listThreadIds: () => Effect.succeed(options.cachedThreadIds.map((id) => ThreadId.make(id))),
    loadServerConfig: () => Effect.succeedNone,
    saveServerConfig: () => Effect.void,
    loadVcsRefs: () => Effect.succeedNone,
    saveVcsRefs: () => Effect.void,
    removeVcsRefs: () => Effect.void,
    clearVcsRefs: () => Effect.void,
    clear: () => Effect.void,
  });
  const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
    target: TARGET,
    state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
    session: yield* SubscriptionRef.make(Option.some(session)),
    prepared: yield* SubscriptionRef.make(Option.some(PREPARED)),
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  });
  const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
      Effect.provideService(Persistence.EnvironmentCacheStore, cache),
    );
  return { events, lookups, removed, removedSignal, session, provide };
});

describe("deleted thread cache pruning", () => {
  it.effect("removes only the cached threads the server proves were deleted", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        deletedThreadLookup: true,
        cachedThreadIds: ["thread-a", "thread-b", "thread-c"],
        answer: () => Effect.succeed([ThreadId.make("thread-b")]),
      });
      yield* harness.provide(pruneDeletedCachedThreads(harness.session, TARGET.environmentId));
      expect(yield* Ref.get(harness.removed)).toEqual(["thread-b"]);
      expect(yield* Ref.get(harness.lookups)).toEqual([["thread-a", "thread-b", "thread-c"]]);
    }),
  );

  it.effect("does not ask a server that cannot answer from tombstones", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        deletedThreadLookup: false,
        cachedThreadIds: ["thread-a"],
        answer: () => Effect.succeed([ThreadId.make("thread-a")]),
      });
      yield* harness.provide(pruneDeletedCachedThreads(harness.session, TARGET.environmentId));
      expect(yield* Ref.get(harness.lookups)).toEqual([]);
      expect(yield* Ref.get(harness.removed)).toEqual([]);
    }),
  );

  it.effect("splits a large cache into bounded lookups", () =>
    Effect.gen(function* () {
      const cachedThreadIds = Array.from(
        { length: DELETED_THREAD_LOOKUP_MAX_IDS + 1 },
        (_, index) => `thread-${index}`,
      );
      const harness = yield* makeHarness({ deletedThreadLookup: true, cachedThreadIds });
      yield* harness.provide(pruneDeletedCachedThreads(harness.session, TARGET.environmentId));
      expect((yield* Ref.get(harness.lookups)).map((ids) => ids.length)).toEqual([
        DELETED_THREAD_LOOKUP_MAX_IDS,
        1,
      ]);
    }),
  );

  it.effect("prunes nothing when the lookup fails", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        deletedThreadLookup: true,
        cachedThreadIds: ["thread-a"],
        answer: () => Effect.die("unreachable") as never,
      });
      const failing = {
        ...harness.session,
        client: {
          ...harness.session.client,
          [ORCHESTRATION_V2_WS_METHODS.getDeletedThreadIds]: () =>
            Effect.fail({ _tag: "OrchestrationV2GetShellSnapshotError", message: "down" }),
        } as unknown as WsRpcProtocolClient,
      };
      yield* harness.provide(pruneDeletedCachedThreads(failing, TARGET.environmentId));
      expect(yield* Ref.get(harness.removed)).toEqual([]);
    }),
  );

  it.effect("prunes the cache when the shell subscribes", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        deletedThreadLookup: true,
        cachedThreadIds: ["thread-a", "thread-gone"],
        answer: () => Effect.succeed([ThreadId.make("thread-gone")]),
      });
      yield* harness.provide(
        makeEnvironmentShellState().pipe(
          Effect.provideService(ShellSnapshotLoader.ShellSnapshotLoader, {
            load: () => Effect.succeedNone,
          }),
        ),
      );
      yield* Deferred.await(harness.removedSignal);
      expect(yield* Ref.get(harness.removed)).toEqual(["thread-gone"]);
    }),
  );

  it.effect("drops an unopened thread's cache on a live deletion, not on an archive", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ deletedThreadLookup: false, cachedThreadIds: [] });
      const state = yield* harness.provide(
        makeEnvironmentShellState().pipe(
          Effect.provideService(ShellSnapshotLoader.ShellSnapshotLoader, {
            load: () => Effect.succeedNone,
          }),
        ),
      );
      yield* Queue.offer(harness.events, {
        kind: "snapshot",
        snapshot: { ...v2ShellSnapshot, snapshotSequence: 1 },
      });
      yield* Queue.offer(harness.events, {
        kind: "thread.removed",
        sequence: 2,
        location: "active",
        threadId: ThreadId.make("thread-archived"),
      });
      yield* SubscriptionRef.changes(state).pipe(
        Stream.filter((value) => value.removedAt.has(ThreadId.make("thread-archived"))),
        Stream.runHead,
      );
      yield* Queue.offer(harness.events, {
        kind: "thread.removed",
        sequence: 3,
        location: "active",
        threadId: ThreadId.make("thread-deleted"),
        deleted: true,
      });
      yield* Deferred.await(harness.removedSignal);
      expect(yield* Ref.get(harness.removed)).toEqual(["thread-deleted"]);
    }),
  );
});
