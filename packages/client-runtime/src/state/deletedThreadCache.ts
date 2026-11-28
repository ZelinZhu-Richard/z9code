import {
  DELETED_THREAD_LOOKUP_MAX_IDS,
  type EnvironmentId,
  ORCHESTRATION_V2_WS_METHODS,
  type ThreadId,
} from "@z9code/contracts";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";

import { safeErrorLogAttributes } from "../errors/safeLog.ts";
import * as Persistence from "../platform/persistence.ts";
import { requestInSession } from "../rpc/client.ts";
import type { RpcSession } from "../rpc/session.ts";

export const removeDeletedThreadCaches = Effect.fn("DeletedThreadCache.remove")(function* (
  environmentId: EnvironmentId,
  threadIds: Iterable<ThreadId>,
) {
  const cache = yield* Persistence.EnvironmentCacheStore;
  yield* Effect.forEach(
    threadIds,
    (threadId) =>
      cache
        .removeThread(environmentId, threadId)
        .pipe(
          Effect.catch((error) =>
            Effect.logWarning("Could not remove a deleted thread's cache.").pipe(
              Effect.annotateLogs({ environmentId, threadId, ...safeErrorLogAttributes(error) }),
            ),
          ),
        ),
    { discard: true },
  );
});

/**
 * Drops cached snapshots of threads deleted while this client was away. Only ids the server proves
 * were deleted are removed: a missing thread may not be created yet, or may belong elsewhere.
 */
export const pruneDeletedCachedThreads = Effect.fn("DeletedThreadCache.prune")(
  function* (session: RpcSession, environmentId: EnvironmentId) {
    const config = yield* session.initialConfig;
    if (config.deletedThreadLookup !== true) return;
    const cache = yield* Persistence.EnvironmentCacheStore;
    const cached = yield* cache.listThreadIds(environmentId);
    for (const threadIds of Arr.chunksOf(cached, DELETED_THREAD_LOOKUP_MAX_IDS)) {
      const deleted = yield* requestInSession(
        session,
        ORCHESTRATION_V2_WS_METHODS.getDeletedThreadIds,
        { threadIds },
      );
      yield* removeDeletedThreadCaches(environmentId, deleted);
    }
  },
  (effect, _session, environmentId) =>
    effect.pipe(
      Effect.catch((error) =>
        Effect.logWarning("Could not check cached threads for deletions.").pipe(
          Effect.annotateLogs({ environmentId, ...safeErrorLogAttributes(error) }),
        ),
      ),
    ),
);
