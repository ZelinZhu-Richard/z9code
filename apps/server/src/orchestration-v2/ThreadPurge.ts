// Deletion marks a thread and runs its cleanup effects; this sweep then removes its rows, its events
// but a scrubbed tombstone, its search tokens, provider logs and browser screenshots. A thread a
// live fork still shows waits for that fork, and every thread waits for storage cleanup, which
// finds the thread's refs and worktree through these rows.
import * as NodeSqliteClient from "@z9code/shared/nodeSqliteClient";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as SqlClient from "effect/sql/SqlClient";

import { ServerConfig } from "../config.ts";
import * as DatabaseMaintenance from "../persistence/DatabaseMaintenance.ts";
import { resolveThreadSegment } from "../provider/EventNdjsonLogger.ts";
import { StorageCleanup } from "../storageCleanup.ts";

const SWEEP_INTERVAL = Duration.seconds(15);
const BATCH_SIZE = 25;
const THREADS_TABLE = "orchestration_v2_projection_threads";
const EVENTS_TABLE = "orchestration_events";
/** The legacy importer treats a thread without this marker as not yet imported. */
const KEPT_TABLES: ReadonlySet<string> = new Set([EVENTS_TABLE, "orchestration_v2_legacy_imports"]);
/** Outbox rows are only removed once settled; a running effect still owns its row. */
const OUTBOX_PREFIX = "orchestration_v2_effect_outbox";
/** Contentless, so deleting a message only tombstones it; its tokens stay until a merge drops them. */
const MESSAGE_SEARCH_TABLE = "orchestration_v2_message_search";
/** Scheduled task tables without a thread column follow the task bound to the thread. */
const TASKS_TABLE = "scheduled_tasks";
const TASK_TABLE_PREFIX = "scheduled_task_";
/**
 * Columns that name an app thread. Purging an owner deletes the row; a row with other references
 * goes once no thread it names is left, so a live thread keeps what it renders. A transfer belongs
 * to the thread it delivered into. Any other `*thread_id` column counts as a reference.
 */
export const THREAD_REFERENCE_POLICY: Readonly<Record<string, "owner" | "reference">> = {
  thread_id: "owner",
  target_thread_id: "owner",
  source_thread_id: "reference",
  child_thread_id: "reference",
};
/** Provider thread ids live in another namespace. */
export const isThreadReferenceColumn = (column: string) =>
  /(?:^|_)thread_id$/u.test(column) && !column.endsWith("provider_thread_id");
/**
 * The tombstone keeps only these structural fields, so a free-text field added to threads later is
 * dropped without anyone updating a list. Optional thread fields are omitted entirely.
 */
const TOMBSTONE_THREAD_FIELDS = [
  "id",
  "projectId",
  "providerInstanceId",
  "modelSelection",
  "runtimeMode",
  "interactionMode",
  "lineage",
  "forkedFrom",
  "createdBy",
  "creationSource",
  "createdAt",
  "updatedAt",
  "archivedAt",
  "settledOverride",
  "settledAt",
  "lastVisitedAt",
  "deletedAt",
] as const;
const TOMBSTONE_PAYLOAD_SQL = `json_object(${[
  ...TOMBSTONE_THREAD_FIELDS.map((field) => `'${field}', payload_json -> '$.${field}'`),
  "'title', 'Deleted thread'",
  "'branch', NULL",
  "'worktreePath', NULL",
  "'activeProviderThreadId', NULL",
].join(", ")})`;

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

interface ThreadKeyedTable {
  readonly name: string;
  readonly owners: ReadonlyArray<string>;
  readonly references: ReadonlyArray<string>;
  /** `aggregate_kind`/`aggregate_id` rows, such as command receipts. */
  readonly aggregate: boolean;
  /** Keyed by a scheduled task rather than a thread. */
  readonly task: boolean;
  readonly hasStatus: boolean;
  readonly hasError: boolean;
}

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig;
  const storageCleanup = yield* StorageCleanup;
  const maintenance = yield* DatabaseMaintenance.DatabaseMaintenance;
  const legacyDatabasePath = path.join(path.dirname(config.dbPath), "state.sqlite");

  // Discovered on each sweep so tables added by later migrations are covered without a list.
  const threadKeyedTables = Effect.gen(function* () {
    const tables = yield* sql<{ readonly name: string; readonly sql: string | null }>`
      SELECT name, sql FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    `.pipe(NodeSqliteClient.readOnly);
    const virtualTables = tables
      .filter((table) => /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(table.sql ?? ""))
      .map((table) => table.name);
    const keyed: Array<ThreadKeyedTable> = [];
    for (const table of tables) {
      if (KEPT_TABLES.has(table.name) || table.name === THREADS_TABLE) continue;
      // Virtual tables and their shadow tables are kept in sync by triggers on the real rows.
      if (virtualTables.some((name) => table.name === name || table.name.startsWith(`${name}_`))) {
        continue;
      }
      const columns = (yield* sql<{ readonly name: string }>`
        SELECT name FROM pragma_table_info(${table.name})
      `.pipe(NodeSqliteClient.readOnly)).map((column) => column.name);
      const references = columns.filter(isThreadReferenceColumn);
      const aggregate = columns.includes("aggregate_kind") && columns.includes("aggregate_id");
      const task =
        references.length === 0 &&
        table.name.startsWith(TASK_TABLE_PREFIX) &&
        columns.includes("task_id");
      if (references.length === 0 && !aggregate && !task) continue;
      keyed.push({
        name: table.name,
        owners: references.filter((column) => THREAD_REFERENCE_POLICY[column] === "owner"),
        references,
        aggregate,
        task,
        hasStatus: columns.includes("status"),
        hasError: columns.includes("error"),
      });
    }
    return keyed;
  });

  const deletedThreadIds = (
    filter: "IN" | "NOT IN",
    threadIds: ReadonlySet<string>,
    limit: number,
  ) =>
    sql
      .unsafe<{ readonly thread_id: string }>(
        `SELECT thread.thread_id
         FROM ${THREADS_TABLE} AS thread
         WHERE thread.deleted_at IS NOT NULL
           AND thread.thread_id ${filter} (SELECT value FROM json_each(?))
           AND NOT EXISTS (
             -- A live fork renders its whole ancestor chain, even through deleted intermediate forks.
             WITH RECURSIVE descendant(thread_id, deleted_at) AS (
               SELECT fork.thread_id, fork.deleted_at
               FROM ${THREADS_TABLE} AS fork
               WHERE json_extract(fork.payload_json, '$.forkedFrom.type') = 'run'
                 AND json_extract(fork.payload_json, '$.forkedFrom.threadId') = thread.thread_id
               UNION
               SELECT fork.thread_id, fork.deleted_at
               FROM ${THREADS_TABLE} AS fork
               JOIN descendant
                 ON json_extract(fork.payload_json, '$.forkedFrom.threadId') = descendant.thread_id
               WHERE json_extract(fork.payload_json, '$.forkedFrom.type') = 'run'
             )
             SELECT 1 FROM descendant WHERE descendant.deleted_at IS NULL
           )
           AND NOT EXISTS (
             SELECT 1 FROM orchestration_v2_effect_outbox AS effect
             WHERE effect.thread_id = thread.thread_id AND effect.status IN ('pending', 'running')
           )
         LIMIT ?`,
        [JSON.stringify([...threadIds]), limit],
      )
      .pipe(
        NodeSqliteClient.readOnly,
        Effect.map((rows) => rows.map((row) => row.thread_id)),
      );

  const purgeRows = (threadIds: ReadonlyArray<string>, tables: ReadonlyArray<ThreadKeyedTable>) =>
    sql.withTransaction(
      Effect.gen(function* () {
        const ids = `(${threadIds.map(() => "?").join(", ")})`;
        const [messages] = yield* sql<{ readonly found: number }>`
          SELECT EXISTS (
            SELECT 1 FROM orchestration_v2_projection_messages
            WHERE thread_id IN ${sql.in(threadIds)} AND streaming = 0
          ) AS found
        `;
        // Task-keyed rows go first, while the task rows that name the thread still exist.
        const ordered = [
          ...tables.filter((table) => table.task),
          ...tables.filter((table) => !table.task),
        ];
        for (const table of ordered) {
          const params: Array<string> = [];
          const purged = () => {
            params.push(...threadIds);
            return ids;
          };
          const conditions = table.owners.map((column) => `${quote(column)} IN ${purged()}`);
          if (table.references.length > table.owners.length) {
            const any = table.references.map((column) => `${quote(column)} IN ${purged()}`);
            const none = table.references.map(
              (column) =>
                `(${quote(column)} IS NULL OR ${quote(column)} IN ${purged()} OR ${quote(column)} NOT IN (SELECT thread_id FROM ${THREADS_TABLE}))`,
            );
            conditions.push(`((${any.join(" OR ")}) AND ${none.join(" AND ")})`);
          }
          if (table.aggregate) {
            // Receipts stay so a replayed command cannot recreate the thread; only free text goes.
            if (table.hasError) {
              yield* sql.unsafe(
                `UPDATE ${quote(table.name)} SET error = NULL
                 WHERE aggregate_kind = 'thread' AND aggregate_id IN ${ids}`,
                [...threadIds],
              );
            }
            if (conditions.length === 0 && !table.task) continue;
          }
          if (table.task) {
            conditions.push(
              `task_id IN (SELECT task_id FROM ${TASKS_TABLE} WHERE thread_id IN ${purged()})`,
            );
          }
          const settledOnly =
            table.name.startsWith(OUTBOX_PREFIX) && table.hasStatus
              ? " AND status IN ('succeeded', 'failed', 'cancelled')"
              : "";
          yield* sql.unsafe(
            `DELETE FROM ${quote(table.name)} WHERE (${conditions.join(" OR ")})${settledOnly}`,
            params,
          );
        }
        for (const threadId of threadIds) {
          // One scrubbed tombstone keeps the deletion visible to clients that replay events.
          const tombstone = yield* sql<{ readonly sequence: number | null }>`
            SELECT MAX(sequence) AS sequence FROM orchestration_events
            WHERE aggregate_kind = 'thread' AND stream_id = ${threadId}
              AND event_type = 'thread.deleted'
          `;
          const keep = tombstone[0]?.sequence ?? null;
          if (keep === null) {
            yield* sql`
              DELETE FROM orchestration_events
              WHERE aggregate_kind = 'thread' AND stream_id = ${threadId}
            `;
          } else {
            yield* sql`
              DELETE FROM orchestration_events
              WHERE aggregate_kind = 'thread' AND stream_id = ${threadId} AND sequence <> ${keep}
            `;
            yield* sql.unsafe(
              `UPDATE ${EVENTS_TABLE}
               SET payload_json = ${TOMBSTONE_PAYLOAD_SQL},
               command_id = NULL, correlation_id = NULL
               WHERE sequence = ?`,
              [keep],
            );
          }
        }
        yield* sql`
          DELETE FROM orchestration_v2_projection_threads WHERE thread_id IN ${sql.in(threadIds)}
        `;
        return (messages?.found ?? 0) === 1;
      }),
    );

  /** Provider logs and browser screenshots name their thread by segment. */
  const THREAD_FILES = [
    { directory: config.providerLogsDir, pattern: /^[^.]+\.(.+)\.log(?:\.\d+)?$/u },
    { directory: config.browserArtifactsDir, pattern: /^browser-screenshot\.([^.]+)\./u },
  ];
  const purgeThreadFiles = Effect.fn("ThreadPurge.purgeThreadFiles")(function* (
    segments: ReadonlySet<string>,
  ) {
    if (segments.size === 0) return;
    for (const { directory, pattern } of THREAD_FILES) {
      const entries = yield* fileSystem
        .readDirectory(directory)
        .pipe(Effect.catchCause(() => Effect.succeed([] as ReadonlyArray<string>)));
      for (const entry of entries) {
        const match = pattern.exec(entry);
        if (match === null || !segments.has(match[1]!)) continue;
        yield* fileSystem.remove(path.join(directory, entry)).pipe(Effect.ignore);
      }
    }
  });

  // Starts set so a startup sweep also clears tokens left by a crash or a failed optimize.
  let searchIndexNeedsOptimize = true;
  // Starts set so the startup sweep catches V1 threads purged earlier. After that only purging a V1
  // thread checks again, so a file that a pre-0.1.0 app holds open is not probed every sweep.
  let legacyDatabaseNeedsCheck = true;

  const legacyImported = (threadIds: ReadonlyArray<string>) =>
    sql<{ readonly found: number }>`
      SELECT EXISTS (
        SELECT 1 FROM orchestration_v2_legacy_imports WHERE thread_id IN ${sql.in(threadIds)}
      ) AS found
    `.pipe(
      NodeSqliteClient.readOnly,
      Effect.map((rows) => rows[0]?.found === 1),
    );

  // The pre-0.1.0 database still holds a purged V1 thread's full content. Deleting the file is
  // guarded like doctor's removal: only once no older app has it open and nothing in it is missing.
  const removeLegacyDatabase = Effect.gen(function* () {
    legacyDatabaseNeedsCheck = false;
    if (!(yield* fileSystem.exists(legacyDatabasePath))) return;
    const [purgedLegacyThread] = yield* sql<{ readonly found: number }>`
      SELECT EXISTS (
        SELECT 1 FROM orchestration_v2_legacy_imports AS legacy_import
        WHERE NOT EXISTS (
          SELECT 1 FROM orchestration_v2_projection_threads AS thread
          WHERE thread.thread_id = legacy_import.thread_id
        ) AND EXISTS (
          SELECT 1 FROM orchestration_events AS event
          WHERE event.aggregate_kind = 'thread'
            AND event.stream_id = legacy_import.thread_id
            AND event.event_type = 'thread.deleted'
        )
      ) AS found
    `.pipe(NodeSqliteClient.readOnly);
    if (purgedLegacyThread?.found !== 1) return;
    yield* maintenance.removeLegacyDatabase(config.dbPath);
    yield* Effect.logInfo("deleted the database from before 0.1.0, which held a deleted thread");
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("kept the database from before 0.1.0 after a thread purge", { cause }),
    ),
  );

  // The provider log store batches writes for about a second, and a screenshot save can finish
  // after its session detached, so the next sweep removes a purged thread's files again.
  let recentlyPurgedSegments: ReadonlySet<string> = new Set();

  const sweep = Effect.fn("ThreadPurge.sweep")(function* () {
    yield* purgeThreadFiles(recentlyPurgedSegments);
    const purgedSegments = new Set<string>();
    let purged = 0;
    let tables: ReadonlyArray<ThreadKeyedTable> | undefined;
    const cleanup = yield* storageCleanup.deletedThreadCleanup;
    // Storage cleanup's deletion sweep can run before the deletion's own effects settle.
    const unseen = yield* deletedThreadIds(
      "NOT IN",
      new Set([...cleanup.finished, ...cleanup.waiting]),
      1,
    );
    if (unseen.length > 0) yield* storageCleanup.requestSweep;
    for (;;) {
      const threadIds = yield* deletedThreadIds("IN", cleanup.finished, BATCH_SIZE);
      if (threadIds.length === 0) break;
      tables ??= yield* threadKeyedTables;
      if (!legacyDatabaseNeedsCheck && (yield* legacyImported(threadIds))) {
        legacyDatabaseNeedsCheck = true;
      }
      if (yield* purgeRows(threadIds, tables)) searchIndexNeedsOptimize = true;
      const segments = new Set(threadIds.map((threadId) => resolveThreadSegment(threadId)));
      yield* purgeThreadFiles(segments);
      for (const segment of segments) purgedSegments.add(segment);
      purged += threadIds.length;
      yield* Effect.yieldNow;
    }
    if (searchIndexNeedsOptimize) {
      const [index] = yield* sql<{ readonly found: number }>`
        SELECT EXISTS (SELECT 1 FROM sqlite_schema WHERE name = ${MESSAGE_SEARCH_TABLE}) AS found
      `.pipe(NodeSqliteClient.readOnly);
      // Rewrites the index without tombstoned rows, so secure_delete zeroes their old pages.
      searchIndexNeedsOptimize =
        index?.found !== 1
          ? false
          : yield* sql
              .unsafe(
                `INSERT INTO ${quote(MESSAGE_SEARCH_TABLE)}(${quote(MESSAGE_SEARCH_TABLE)}) VALUES ('optimize')`,
              )
              .pipe(
                Effect.as(false),
                Effect.catchCause((cause) =>
                  Effect.logWarning("message search index optimize failed", { cause }).pipe(
                    Effect.as(true),
                  ),
                ),
              );
    }
    if (purged > 0) {
      yield* sql`PRAGMA wal_checkpoint(TRUNCATE)`.pipe(Effect.ignore);
      yield* Effect.logInfo("purged deleted threads", { count: purged });
    }
    if (legacyDatabaseNeedsCheck) yield* removeLegacyDatabase;
    recentlyPurgedSegments = purgedSegments;
    return purged;
  });

  return { sweep };
});

/** Sweeps once at startup, which also clears threads deleted before this existed, then on an interval. */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const purge = yield* make;
    yield* purge.sweep().pipe(
      Effect.catchCause((cause) => Effect.logWarning("deleted thread purge failed", { cause })),
      Effect.repeat(Schedule.spaced(SWEEP_INTERVAL)),
      Effect.forkScoped,
    );
  }),
);
