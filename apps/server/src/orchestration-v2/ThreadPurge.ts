// Deletion marks a thread and runs its cleanup effects; this sweep then removes every row keyed
// by the thread, its events except a scrubbed tombstone, and its provider logs. Threads a live
// fork still shows wait for that fork.
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as SqlClient from "effect/sql/SqlClient";

import { ServerConfig } from "../config.ts";
import { resolveThreadSegment } from "../provider/EventNdjsonLogger.ts";

const SWEEP_INTERVAL = Duration.seconds(15);
const BATCH_SIZE = 25;
const THREADS_TABLE = "orchestration_v2_projection_threads";
const EVENTS_TABLE = "orchestration_events";
/** The legacy importer treats a thread without this marker as not yet imported. */
const KEPT_TABLES: ReadonlySet<string> = new Set([EVENTS_TABLE, "orchestration_v2_legacy_imports"]);
/** Outbox rows are only removed once settled; a running effect still owns its row. */
const OUTBOX_PREFIX = "orchestration_v2_effect_outbox";
/** Free-text and link fields dropped from the tombstone; the rest is structural. */
const SCRUBBED_THREAD_FIELDS = [
  "$.branch",
  "$.worktreePath",
  "$.linkedPullRequest",
  "$.pullRequests",
  "$.branchPullRequest",
  "$.issues",
  "$.tags",
  "$.opens",
  "$.guestShare",
  "$.delegatedFrom",
  "$.workflowRun",
  "$.limitRecovery",
  "$.titleRegeneration",
  "$.historyOrigin",
  "$.linkOrigin",
] as const;

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const placeholders = (count: number) => Array.from({ length: count }, () => "?").join(", ");

interface ThreadKeyedTable {
  readonly name: string;
  readonly hasStatus: boolean;
}

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig;

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
      const columns = yield* sql<{ readonly name: string }>`
        SELECT name FROM pragma_table_info(${table.name})
      `.pipe(NodeSqliteClient.readOnly);
      if (!columns.some((column) => column.name === "thread_id")) continue;
      keyed.push({
        name: table.name,
        hasStatus: columns.some((column) => column.name === "status"),
      });
    }
    return keyed;
  });

  const purgeableThreadIds = sql<{ readonly thread_id: string }>`
    SELECT thread.thread_id
    FROM orchestration_v2_projection_threads AS thread
    WHERE thread.deleted_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM orchestration_v2_projection_threads AS fork
        WHERE fork.deleted_at IS NULL
          AND json_extract(fork.payload_json, '$.forkedFrom.type') = 'run'
          AND json_extract(fork.payload_json, '$.forkedFrom.threadId') = thread.thread_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM orchestration_v2_effect_outbox AS effect
        WHERE effect.thread_id = thread.thread_id AND effect.status IN ('pending', 'running')
      )
    LIMIT ${BATCH_SIZE}
  `.pipe(
    NodeSqliteClient.readOnly,
    Effect.map((rows) => rows.map((row) => row.thread_id)),
  );

  const purgeRows = (threadIds: ReadonlyArray<string>, tables: ReadonlyArray<ThreadKeyedTable>) =>
    sql.withTransaction(
      Effect.gen(function* () {
        const ids = placeholders(threadIds.length);
        for (const table of tables) {
          const settledOnly =
            table.name.startsWith(OUTBOX_PREFIX) && table.hasStatus
              ? " AND status IN ('succeeded', 'failed')"
              : "";
          yield* sql.unsafe(
            `DELETE FROM ${quote(table.name)} WHERE thread_id IN (${ids})${settledOnly}`,
            [...threadIds],
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
               SET payload_json = json_set(
                 json_remove(payload_json, ${SCRUBBED_THREAD_FIELDS.map((field) => `'${field}'`).join(", ")}),
                 '$.title', 'Deleted thread', '$.branch', NULL, '$.worktreePath', NULL
               ),
               command_id = NULL, correlation_id = NULL
               WHERE sequence = ?`,
              [keep],
            );
          }
        }
        yield* sql`
          DELETE FROM orchestration_v2_projection_threads WHERE thread_id IN ${sql.in(threadIds)}
        `;
      }),
    );

  const purgeProviderLogs = Effect.fn("ThreadPurge.purgeProviderLogs")(function* (
    threadIds: ReadonlyArray<string>,
  ) {
    const directory = config.providerLogsDir;
    const entries = yield* fileSystem
      .readDirectory(directory)
      .pipe(Effect.catchCause(() => Effect.succeed([] as ReadonlyArray<string>)));
    const segments = new Set(threadIds.map((threadId) => resolveThreadSegment(threadId)));
    for (const entry of entries) {
      const match = /^[^.]+\.(.+)\.log(?:\.\d+)?$/u.exec(entry);
      if (match === null || !segments.has(match[1]!)) continue;
      yield* fileSystem.remove(path.join(directory, entry)).pipe(Effect.ignore);
    }
  });

  const sweep = Effect.fn("ThreadPurge.sweep")(function* () {
    let purged = 0;
    let tables: ReadonlyArray<ThreadKeyedTable> | undefined;
    for (;;) {
      const threadIds = yield* purgeableThreadIds;
      if (threadIds.length === 0) break;
      tables ??= yield* threadKeyedTables;
      yield* purgeRows(threadIds, tables);
      yield* purgeProviderLogs(threadIds);
      purged += threadIds.length;
      yield* Effect.yieldNow;
    }
    if (purged > 0) {
      yield* sql`PRAGMA wal_checkpoint(TRUNCATE)`.pipe(Effect.ignore);
      yield* Effect.logInfo("purged deleted threads", { count: purged });
    }
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
