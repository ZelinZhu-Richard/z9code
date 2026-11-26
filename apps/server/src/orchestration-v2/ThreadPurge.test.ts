import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  OrchestrationV2AppThreadJson,
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  TurnItemId,
} from "@z9code/contracts";
import * as NodeSqliteClient from "@z9code/shared/nodeSqliteClient";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import { ServerConfig, layerTest as layerServerConfig } from "../config.ts";
import * as DatabaseMaintenance from "../persistence/DatabaseMaintenance.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { resolveThreadSegment } from "../provider/EventNdjsonLogger.ts";
import { type DeletedThreadCleanup, StorageCleanup } from "../storageCleanup.ts";
import * as EventSink from "./EventSink.ts";
import * as EventStore from "./EventStore.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ThreadPurge from "./ThreadPurge.ts";

const storageCleanupStub = (
  deletedThreadCleanup: StorageCleanup["Service"]["deletedThreadCleanup"],
  requestSweep: Effect.Effect<void> = Effect.void,
) =>
  StorageCleanup.of({
    runNow: Effect.die("unused"),
    latestReport: Effect.succeed(null),
    reports: Stream.empty,
    drain: Effect.void,
    deletedThreadCleanup,
    requestSweep,
  });
/** Storage cleanup has finished with every deleted thread. */
const finishedStorageCleanup = Layer.effect(
  StorageCleanup,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return storageCleanupStub(
      sql<{ readonly thread_id: string }>`
        SELECT thread_id FROM orchestration_v2_projection_threads WHERE deleted_at IS NOT NULL
      `.pipe(
        Effect.orDie,
        Effect.map((rows) => ({
          finished: new Set(rows.map((row) => row.thread_id)),
          waiting: new Set<string>(),
        })),
      ),
    );
  }),
);
const layerStores = <E, R>(database: Layer.Layer<SqlClient.SqlClient, E, R>) => {
  const stores = Layer.mergeAll(
    database,
    EventStore.layer.pipe(Layer.provideMerge(database)),
    ProjectionStore.layer.pipe(Layer.provideMerge(database)),
  );
  return Layer.mergeAll(
    stores,
    EventSink.layer.pipe(Layer.provide(stores)),
    finishedStorageCleanup.pipe(Layer.provide(database)),
    DatabaseMaintenance.layer,
  );
};
const withServerConfig = <A, E, R>(layer: Layer.Layer<A, E, R>) =>
  layer.pipe(
    Layer.provideMerge(layerServerConfig(process.cwd(), { prefix: "thread-purge-test" })),
    Layer.provideMerge(NodeServices.layer),
  );
const layerTest = withServerConfig(layerStores(SqlitePersistence.layerMemory));
/** The database from before 0.1.0 sits beside the current one, so this case needs real files. */
const layerFileTest = withServerConfig(
  Layer.unwrap(
    Effect.gen(function* () {
      const config = yield* ServerConfig;
      return layerStores(SqlitePersistence.layerFromPath(config.dbPath));
    }),
  ),
);

const providerInstanceId = ProviderInstanceId.make("codex");
const SECRET = "SECRET-DO-NOT-KEEP-7f3a";
const decodeThreadJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(OrchestrationV2AppThreadJson),
);

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
    // The provider log store's batched flush can land after the purge and recreate the file.
    yield* fileSystem.writeFileString(logFile, `${SECRET}\n`);
    assert.equal(yield* purge.sweep(), 0);
    assert.isFalse(yield* fileSystem.exists(logFile));
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

it.effect("keeps every ancestor of a live fork, through deleted intermediate forks", () =>
  Effect.gen(function* () {
    const now = yield* DateTime.now;
    const root = makeThread(ThreadId.make("thread:root"), now);
    const middle = makeThread(ThreadId.make("thread:middle"), now, {
      type: "run",
      threadId: root.id,
      runId: RunId.make("run:root"),
    });
    const leaf = makeThread(ThreadId.make("thread:leaf"), now, {
      type: "run",
      threadId: middle.id,
      runId: RunId.make("run:middle"),
    });
    yield* writeThread(root, now);
    yield* writeThread(middle, now);
    yield* writeThread(leaf, now);
    yield* deleteThread(root, now);
    yield* deleteThread(middle, now);

    const purge = yield* ThreadPurge.make;
    assert.equal(yield* purge.sweep(), 0);
    yield* deleteThread(leaf, now);
    assert.equal(yield* purge.sweep(), 3);
    assert.deepEqual(yield* rowsContaining(SECRET), []);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("keeps only structural fields in the tombstone, which still decodes as a thread", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const sink = yield* EventSink.EventSinkV2;
    const now = yield* DateTime.now;
    const thread = makeThread(ThreadId.make("thread:rewound"), now);
    yield* writeThread(thread, now);
    yield* sink.write({
      events: [
        {
          id: EventId.make(`event:${thread.id}:deleted`),
          type: "thread.deleted",
          threadId: thread.id,
          providerInstanceId,
          occurredAt: now,
          payload: {
            ...thread,
            rollbackUnrestored: {
              requestId: CommandId.make("command:rewind"),
              repositories: [`${SECRET}-repo`],
            },
            pinOrderKey: `${SECRET}-key`,
            deletedAt: now,
            updatedAt: now,
          },
        },
      ],
    });

    const purge = yield* ThreadPurge.make;
    assert.equal(yield* purge.sweep(), 1);
    assert.deepEqual(yield* rowsContaining(SECRET), []);
    const [tombstone] = yield* sql<{ readonly payload_json: string }>`
      SELECT payload_json FROM orchestration_events WHERE stream_id = ${thread.id}
    `;
    const decoded = yield* decodeThreadJson(tombstone!.payload_json);
    assert.equal(decoded.id, thread.id);
    assert.equal(decoded.title, "Deleted thread");
    assert.isNotNull(decoded.deletedAt);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("removes cancelled effects with the deleted thread", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const now = yield* DateTime.now;
    const thread = makeThread(ThreadId.make("thread:cancelled-effect"), now);
    yield* writeThread(thread, now);
    const at = DateTime.formatIso(now);
    yield* sql`
      INSERT INTO orchestration_v2_effect_outbox
        (effect_id, command_id, thread_id, effect_type, payload_json, status,
         available_at, created_at, updated_at, completed_at)
      VALUES
        ('effect:cancelled', 'command:cancelled', ${thread.id},
         'provider-session.apply-thread-title', ${JSON.stringify({ title: SECRET })},
         'cancelled', ${at}, ${at}, ${at}, ${at})
    `;
    yield* deleteThread(thread, now);

    const purge = yield* ThreadPurge.make;
    assert.equal(yield* purge.sweep(), 1);
    assert.deepEqual(yield* rowsContaining(SECRET), []);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("names a policy for every column that references a thread", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const columns = yield* sql<{ readonly name: string }>`
      SELECT DISTINCT column.name
      FROM sqlite_schema AS tables, pragma_table_info(tables.name) AS column
      WHERE tables.type = 'table' AND tables.name NOT LIKE 'sqlite_%'
    `;
    const unclassified = columns
      .map((column) => column.name)
      .filter(ThreadPurge.isThreadReferenceColumn)
      .filter((name) => ThreadPurge.THREAD_REFERENCE_POLICY[name] === undefined);
    assert.deepEqual(unclassified, []);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("drops a deleted message's tokens from the search index", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const sink = yield* EventSink.EventSinkV2;
    const now = yield* DateTime.now;
    const thread = makeThread(ThreadId.make("thread:indexed"), now);
    const kept = makeThread(ThreadId.make("thread:indexed-kept"), now);
    yield* writeThread(thread, now);
    yield* writeThread(kept, now);
    const token = "qzxjvwk";
    yield* sink.write({
      events: [
        {
          id: EventId.make(`event:${thread.id}:token`),
          type: "message.updated",
          threadId: thread.id,
          occurredAt: now,
          payload: {
            id: MessageId.make(`message:${thread.id}:token`),
            threadId: thread.id,
            runId: null,
            nodeId: null,
            role: "user",
            text: `remember ${token}`,
            attachments: [],
            streaming: false,
            createdBy: "user",
            creationSource: "web",
            createdAt: now,
            updatedAt: now,
          },
        },
      ],
    });
    const trigrams = Array.from({ length: token.length - 2 }, (_, i) => token.slice(i + 1, i + 3));
    const blocksWithToken = Effect.gen(function* () {
      const blocks = yield* sql<{ readonly block: Uint8Array | null }>`
        SELECT block FROM orchestration_v2_message_search_data
      `;
      return blocks.filter((row) => {
        const text = new TextDecoder("latin1").decode(row.block ?? new Uint8Array());
        return trigrams.some((trigram) => text.includes(trigram));
      }).length;
    });
    assert.isAbove(yield* blocksWithToken, 0);
    yield* deleteThread(thread, now);

    const purge = yield* ThreadPurge.make;
    assert.equal(yield* purge.sweep(), 1);
    assert.equal(yield* blocksWithToken, 0);
    const matches = yield* sql<{ readonly rowid: number }>`
      SELECT rowid FROM orchestration_v2_message_search
      WHERE orchestration_v2_message_search MATCH 'private'
    `;
    assert.lengthOf(matches, 1);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("clears search tokens an earlier run left behind on the first sweep", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const sink = yield* EventSink.EventSinkV2;
    const now = yield* DateTime.now;
    const thread = makeThread(ThreadId.make("thread:crashed"), now);
    yield* writeThread(thread, now);
    const token = "vqxkzjw";
    yield* sink.write({
      events: [
        {
          id: EventId.make(`event:${thread.id}:token`),
          type: "message.updated",
          threadId: thread.id,
          occurredAt: now,
          payload: {
            id: MessageId.make(`message:${thread.id}:token`),
            threadId: thread.id,
            runId: null,
            nodeId: null,
            role: "user",
            text: `remember ${token}`,
            attachments: [],
            streaming: false,
            createdBy: "user",
            creationSource: "web",
            createdAt: now,
            updatedAt: now,
          },
        },
      ],
    });
    const trigrams = Array.from({ length: token.length - 2 }, (_, i) => token.slice(i + 1, i + 3));
    const blocksWithToken = Effect.gen(function* () {
      const blocks = yield* sql<{ readonly block: Uint8Array | null }>`
        SELECT block FROM orchestration_v2_message_search_data
      `;
      return blocks.filter((row) => {
        const text = new TextDecoder("latin1").decode(row.block ?? new Uint8Array());
        return trigrams.some((trigram) => text.includes(trigram));
      }).length;
    });
    // A purge that committed but stopped before its optimize leaves only the index tombstone.
    yield* sql`DELETE FROM orchestration_v2_projection_messages WHERE thread_id = ${thread.id}`;
    assert.isAbove(yield* blocksWithToken, 0);

    const purge = yield* ThreadPurge.make;
    assert.equal(yield* purge.sweep(), 0);
    assert.equal(yield* blocksWithToken, 0);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("removes context transfers into a deleted thread, keeping those a live thread got", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const now = yield* DateTime.now;
    const live = makeThread(ThreadId.make("thread:transfer-live"), now);
    const dead = makeThread(ThreadId.make("thread:transfer-dead"), now);
    yield* writeThread(live, now);
    yield* writeThread(dead, now);
    const at = DateTime.formatIso(now);
    const transfer = (id: string, source: ThreadId, target: ThreadId, type: string) => sql`
      INSERT INTO orchestration_v2_projection_context_transfers
        (context_transfer_id, source_thread_id, target_thread_id, type, status, updated_at,
         payload_json)
      VALUES (${id}, ${source}, ${target}, ${type}, 'failed', ${at},
        ${JSON.stringify({ error: `${SECRET} ${id}` })})
    `;
    yield* transfer("transfer:into-dead", live.id, dead.id, "subagent_spawn");
    yield* transfer("transfer:into-live", dead.id, live.id, "merge_back");
    yield* deleteThread(dead, now);

    const purge = yield* ThreadPurge.make;
    assert.equal(yield* purge.sweep(), 1);
    const remaining = yield* sql<{ readonly context_transfer_id: string }>`
      SELECT context_transfer_id FROM orchestration_v2_projection_context_transfers
    `;
    assert.deepEqual(
      remaining.map((row) => row.context_transfer_id),
      ["transfer:into-live"],
    );
    yield* deleteThread(live, now);
    assert.equal(yield* purge.sweep(), 1);
    assert.deepEqual(yield* rowsContaining(SECRET), []);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("keeps the deleted thread's command receipts without their free text", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const now = yield* DateTime.now;
    const thread = makeThread(ThreadId.make("thread:receipts"), now);
    yield* writeThread(thread, now);
    const at = DateTime.formatIso(now);
    yield* sql`
      INSERT INTO orchestration_command_receipts
        (command_id, aggregate_kind, aggregate_id, accepted_at, result_sequence, status, error,
         command_type)
      VALUES
        ('command:receipt', 'thread', ${thread.id}, ${at}, 1, 'rejected', ${SECRET},
         'message.dispatch'),
        ('command:project', 'project', 'project:purge', ${at}, 2, 'accepted', NULL,
         'project.create')
    `;
    yield* deleteThread(thread, now);

    const purge = yield* ThreadPurge.make;
    assert.equal(yield* purge.sweep(), 1);
    assert.deepEqual(yield* rowsContaining(SECRET), []);
    // A receipt guards against a replayed command recreating the purged thread.
    const receipts = yield* sql<{ readonly command_id: string; readonly error: string | null }>`
      SELECT command_id, error FROM orchestration_command_receipts ORDER BY command_id
    `;
    assert.deepEqual(
      receipts.map((row) => [row.command_id, row.error]),
      [
        ["command:project", null],
        ["command:receipt", null],
      ],
    );
  }).pipe(Effect.provide(layerTest)),
);

it.effect("removes webhook deliveries of the scheduled tasks bound to the deleted thread", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const now = yield* DateTime.now;
    const thread = makeThread(ThreadId.make("thread:scheduled"), now);
    yield* writeThread(thread, now);
    const at = DateTime.formatIso(now);
    yield* sql`
      INSERT INTO scheduled_tasks
        (task_id, title, prompt, enabled, schedule_json, project_id, thread_id,
         workspace_strategy_json, model_selection_json, runtime_mode, interaction_mode, created_by,
         creation_source, created_at, updated_at, last_run_status, run_count)
      VALUES ('task:bound', 'Nightly', 'Run', 1, '{}', 'project:purge', ${thread.id}, '{}', '{}',
        'full-access', 'default', 'user', 'web', ${at}, ${at}, 'never', 0)
    `;
    yield* sql`
      INSERT INTO scheduled_task_webhook_deliveries
        (delivery_id, task_id, received_at, method, query, headers_json, body, body_bytes,
         body_truncated, outcome, signature_verified, missing_fields_json, rendered_prompt)
      VALUES ('delivery:bound', 'task:bound', ${at}, 'POST', '', '{}', ${SECRET}, 1, 0,
        'accepted', 1, '[]', ${SECRET})
    `;
    yield* deleteThread(thread, now);

    const purge = yield* ThreadPurge.make;
    assert.equal(yield* purge.sweep(), 1);
    assert.deepEqual(yield* rowsContaining(SECRET), []);
  }).pipe(Effect.provide(layerTest)),
);

it.effect(
  "keeps a deleted thread until storage cleanup has finished with its refs and worktree",
  () =>
    Effect.gen(function* () {
      const now = yield* DateTime.now;
      const thread = makeThread(ThreadId.make("thread:storage-cleanup"), now);
      yield* writeThread(thread, now);
      yield* deleteThread(thread, now);
      let cleanup: DeletedThreadCleanup = { finished: new Set(), waiting: new Set() };
      let sweepRequests = 0;
      const purge = yield* ThreadPurge.make.pipe(
        Effect.provideService(
          StorageCleanup,
          storageCleanupStub(
            Effect.sync(() => cleanup),
            Effect.sync(() => void sweepRequests++),
          ),
        ),
      );

      // No storage cleanup sweep has seen the deletion yet, so one is asked for.
      assert.equal(yield* purge.sweep(), 0);
      assert.equal(sweepRequests, 1);
      cleanup = { finished: new Set(), waiting: new Set([thread.id]) };
      assert.equal(yield* purge.sweep(), 0);
      assert.equal(sweepRequests, 1);
      assert.include(yield* rowsContaining(SECRET), "orchestration_v2_projection_threads");

      cleanup = { finished: new Set([thread.id]), waiting: new Set() };
      assert.equal(yield* purge.sweep(), 1);
      assert.equal(sweepRequests, 1);
      assert.deepEqual(yield* rowsContaining(SECRET), []);
    }).pipe(Effect.provide(layerTest)),
);

const writeLegacyDatabase = Effect.fn("writeLegacyDatabase")(function* (
  threadIds: ReadonlyArray<ThreadId>,
) {
  const path = yield* Path.Path;
  const config = yield* ServerConfig;
  const legacyPath = path.join(path.dirname(config.dbPath), "state.sqlite");
  yield* Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`PRAGMA journal_mode = WAL`;
    yield* sql`CREATE TABLE projection_projects (project_id TEXT PRIMARY KEY, deleted_at TEXT)`;
    yield* sql`CREATE TABLE projection_threads (
      thread_id TEXT PRIMARY KEY, title TEXT, deleted_at TEXT
    )`;
    for (const threadId of threadIds) {
      yield* sql`INSERT INTO projection_threads VALUES (${threadId}, ${SECRET}, NULL)`;
    }
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: legacyPath })));
  return legacyPath;
});

const markLegacyImport = Effect.fn("markLegacyImport")(function* (threadId: ThreadId) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO orchestration_v2_legacy_imports (
      thread_id, source_updated_at, shell_imported_at, transcript_imported_at
    ) VALUES (${threadId}, '2026-10-01', '2026-10-01', '2026-10-01')
  `;
});

it.effect("deletes the database from before 0.1.0 once a thread from it is purged", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const now = yield* DateTime.now;
    const purgedThread = makeThread(ThreadId.make("thread:v1-purged"), now);
    const keptThread = makeThread(ThreadId.make("thread:v1-kept"), now);
    for (const thread of [purgedThread, keptThread]) {
      yield* writeThread(thread, now);
      yield* markLegacyImport(thread.id);
    }
    const legacyPath = yield* writeLegacyDatabase([purgedThread.id, keptThread.id]);
    const purge = yield* ThreadPurge.make;
    assert.equal(yield* purge.sweep(), 0);
    assert.isTrue(yield* fileSystem.exists(legacyPath), "nothing from it has been deleted yet");

    yield* deleteThread(purgedThread, now);
    assert.equal(yield* purge.sweep(), 1);
    for (const suffix of ["", "-wal", "-shm"]) {
      assert.isFalse(yield* fileSystem.exists(legacyPath + suffix), `state.sqlite${suffix}`);
    }
  }).pipe(Effect.provide(layerFileTest)),
);

it.effect("keeps the database from before 0.1.0 while it has a thread the current one lacks", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const now = yield* DateTime.now;
    const thread = makeThread(ThreadId.make("thread:v1-purged"), now);
    yield* writeThread(thread, now);
    yield* markLegacyImport(thread.id);
    const legacyPath = yield* writeLegacyDatabase([thread.id, ThreadId.make("thread:v1-only")]);
    yield* deleteThread(thread, now);
    const purge = yield* ThreadPurge.make;
    assert.equal(yield* purge.sweep(), 1);
    assert.isTrue(yield* fileSystem.exists(legacyPath));
  }).pipe(Effect.provide(layerFileTest)),
);

it.effect("keeps the database from before 0.1.0 when the purged thread never came from it", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const now = yield* DateTime.now;
    const v1Thread = makeThread(ThreadId.make("thread:v1"), now);
    const newThread = makeThread(ThreadId.make("thread:v2-only"), now);
    yield* writeThread(v1Thread, now);
    yield* markLegacyImport(v1Thread.id);
    yield* writeThread(newThread, now);
    const legacyPath = yield* writeLegacyDatabase([v1Thread.id]);
    yield* deleteThread(newThread, now);
    const purge = yield* ThreadPurge.make;
    assert.equal(yield* purge.sweep(), 1);
    assert.isTrue(yield* fileSystem.exists(legacyPath), "rollback to before 0.1.0 still works");
  }).pipe(Effect.provide(layerFileTest)),
);
