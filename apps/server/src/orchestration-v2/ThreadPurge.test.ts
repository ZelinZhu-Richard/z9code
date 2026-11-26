import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  EventId,
  MessageId,
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  TurnItemId,
} from "@z9code/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

import { ServerConfig, layerTest as layerServerConfig } from "../config.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { resolveThreadSegment } from "../provider/EventNdjsonLogger.ts";
import * as EventSink from "./EventSink.ts";
import * as EventStore from "./EventStore.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ThreadPurge from "./ThreadPurge.ts";

const database = SqlitePersistence.layerMemory;
const stores = Layer.mergeAll(
  database,
  EventStore.layer.pipe(Layer.provideMerge(database)),
  ProjectionStore.layer.pipe(Layer.provideMerge(database)),
);
const layerTest = Layer.mergeAll(stores, EventSink.layer.pipe(Layer.provide(stores))).pipe(
  Layer.provideMerge(layerServerConfig(process.cwd(), { prefix: "thread-purge-test" })),
  Layer.provideMerge(NodeServices.layer),
);

const providerInstanceId = ProviderInstanceId.make("codex");
const SECRET = "SECRET-DO-NOT-KEEP-7f3a";

function makeThread(
  threadId: ThreadId,
  now: DateTime.Utc,
  forkedFrom: OrchestrationV2AppThread["forkedFrom"] = null,
): OrchestrationV2AppThread {
  return {
    id: threadId,
    projectId: ProjectId.make("project:purge"),
    title: `${SECRET} title`,
    providerInstanceId,
    modelSelection: { instanceId: providerInstanceId, model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: `/srv/${SECRET}`,
    activeProviderThreadId: null,
    lineage: { rootThreadId: threadId, parentThreadId: null, relationshipToParent: null },
    forkedFrom,
    createdBy: "user",
    creationSource: "web",
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  };
}

const writeThread = Effect.fn("writeThread")(function* (
  thread: OrchestrationV2AppThread,
  now: DateTime.Utc,
) {
  const sink = yield* EventSink.EventSinkV2;
  yield* sink.write({
    events: [
      {
        id: EventId.make(`event:${thread.id}:created`),
        type: "thread.created",
        threadId: thread.id,
        providerInstanceId,
        occurredAt: now,
        payload: thread,
      },
      {
        id: EventId.make(`event:${thread.id}:item`),
        type: "turn-item.updated",
        threadId: thread.id,
        occurredAt: now,
        payload: {
          id: TurnItemId.make(`turn-item:${thread.id}`),
          threadId: thread.id,
          runId: null,
          nodeId: null,
          providerThreadId: null,
          providerTurnId: null,
          nativeItemRef: null,
          parentItemId: null,
          ordinal: 10,
          status: "completed",
          title: "Command",
          startedAt: now,
          completedAt: now,
          updatedAt: now,
          type: "command_execution",
          input: `echo ${SECRET}`,
          output: `${SECRET} output`,
        },
      },
      {
        id: EventId.make(`event:${thread.id}:message`),
        type: "message.updated",
        threadId: thread.id,
        occurredAt: now,
        payload: {
          id: MessageId.make(`message:${thread.id}`),
          threadId: thread.id,
          runId: null,
          nodeId: null,
          role: "user",
          text: `Please keep ${SECRET} private`,
          attachments: [],
          streaming: false,
          createdBy: "user",
          creationSource: "web",
          createdAt: now,
          updatedAt: now,
        },
      },
    ] satisfies ReadonlyArray<OrchestrationV2DomainEvent>,
  });
});

const deleteThread = Effect.fn("deleteThread")(function* (
  thread: OrchestrationV2AppThread,
  now: DateTime.Utc,
) {
  const sink = yield* EventSink.EventSinkV2;
  yield* sink.write({
    events: [
      {
        id: EventId.make(`event:${thread.id}:deleted`),
        type: "thread.deleted",
        threadId: thread.id,
        providerInstanceId,
        occurredAt: now,
        payload: { ...thread, deletedAt: now, updatedAt: now },
      },
    ],
  });
});

/** Every row of every table, shadow tables of the full-text index included, that names the text. */
const rowsContaining = Effect.fn("rowsContaining")(function* (needle: string) {
  const sql = yield* SqlClient.SqlClient;
  const tables = yield* sql<{ readonly name: string }>`
    SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  `;
  const hits: Array<string> = [];
  for (const { name } of tables) {
    const rows = yield* sql
      .unsafe<Record<string, unknown>>(`SELECT * FROM "${name}"`)
      .pipe(Effect.catchCause(() => Effect.succeed([] as ReadonlyArray<Record<string, unknown>>)));
    for (const row of rows) {
      const text = JSON.stringify(row, (_key, value) =>
        value instanceof Uint8Array ? new TextDecoder().decode(value) : value,
      );
      if (text.includes(needle)) hits.push(name);
    }
  }
  return hits;
});

it.effect("removes every trace of a deleted thread but a scrubbed tombstone", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* ServerConfig;
    const now = yield* DateTime.now;
    const thread = makeThread(ThreadId.make("thread:purge"), now);
    const kept = makeThread(ThreadId.make("thread:kept"), now);
    yield* writeThread(thread, now);
    yield* writeThread(kept, now);
    yield* fileSystem.makeDirectory(config.providerLogsDir, { recursive: true });
    const logFile = path.join(
      config.providerLogsDir,
      `events.${resolveThreadSegment(thread.id)}.log`,
    );
    yield* fileSystem.writeFileString(logFile, `${SECRET}\n`);
    yield* fileSystem.writeFileString(`${logFile}.1`, `${SECRET}\n`);
    yield* deleteThread(thread, now);
    // A soft delete alone leaves the content in projections, the search index and events.
    const softDeleted = yield* rowsContaining(SECRET);
    assert.includeMembers(softDeleted, [
      "orchestration_v2_projection_messages",
      "orchestration_v2_projection_turn_items",
      "orchestration_events",
    ]);

    const purge = yield* ThreadPurge.make;
    assert.equal(yield* purge.sweep(), 1);

    const remaining = (yield* rowsContaining(thread.id)).filter(
      (table) => table !== "orchestration_events",
    );
    assert.deepEqual(remaining, []);
    const events = yield* sql<{ readonly event_type: string; readonly payload_json: string }>`
      SELECT event_type, payload_json FROM orchestration_events WHERE stream_id = ${thread.id}
    `;
    assert.deepEqual(
      events.map((event) => event.event_type),
      ["thread.deleted"],
    );
    assert.notInclude(events[0]!.payload_json, SECRET);
    assert.include(events[0]!.payload_json, "Deleted thread");
    assert.isFalse(yield* fileSystem.exists(logFile));
    assert.isFalse(yield* fileSystem.exists(`${logFile}.1`));
    // The other thread is untouched, so its content is the only copy left.
    assert.isNotEmpty(yield* rowsContaining(`${kept.id}`));
    assert.equal(yield* purge.sweep(), 0);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("keeps a deleted thread a live fork still shows until the fork is deleted", () =>
  Effect.gen(function* () {
    const now = yield* DateTime.now;
    const parent = makeThread(ThreadId.make("thread:parent"), now);
    const fork = makeThread(ThreadId.make("thread:fork"), now, {
      type: "run",
      threadId: parent.id,
      runId: RunId.make("run:parent"),
    });
    yield* writeThread(parent, now);
    yield* writeThread(fork, now);
    yield* deleteThread(parent, now);

    const purge = yield* ThreadPurge.make;
    assert.equal(yield* purge.sweep(), 0);
    yield* deleteThread(fork, now);
    assert.equal(yield* purge.sweep(), 2);
    assert.deepEqual(yield* rowsContaining(SECRET), []);
  }).pipe(Effect.provide(layerTest)),
);
