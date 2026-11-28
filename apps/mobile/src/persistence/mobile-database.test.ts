import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { vi } from "vite-plus/test";

const openDatabaseAsync = vi.hoisted(() => vi.fn());

vi.mock("expo-sqlite", () => ({ openDatabaseAsync }));

import * as MobileDatabase from "./mobile-database";

describe("offline pull request cache", () => {
  const environmentId = "cached-environment" as import("@z9code/contracts").EnvironmentId;
  const otherEnvironment = "other-environment" as import("@z9code/contracts").EnvironmentId;

  async function sqliteDatabase() {
    const { DatabaseSync } = await import("node:sqlite");
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec("PRAGMA user_version = 1");
    const database = {
      execAsync: async (sql: string) => {
        sqlite.exec(sql);
      },
      runAsync: async (sql: string, ...args: Array<string | number>) =>
        sqlite.prepare(sql).run(...args),
      getFirstAsync: async (sql: string, ...args: Array<string | number>) =>
        sqlite.prepare(sql).get(...args),
      getAllAsync: async (sql: string, ...args: Array<string | number>) =>
        sqlite.prepare(sql).all(...args),
      withExclusiveTransactionAsync: async (run: (transaction: unknown) => Promise<void>) => {
        await run(database);
      },
      closeAsync: async () => {
        sqlite.close();
      },
    };
    openDatabaseAsync.mockResolvedValueOnce(database);
    return sqlite;
  }

  it.effect("restores saved records and clears them with the environment", () =>
    Effect.gen(function* () {
      yield* Effect.promise(sqliteDatabase);
      const database = yield* MobileDatabase.make;
      yield* database.saveCache(environmentId, "pull-request", "v1:list", 1, '{"entries":[]}');
      yield* database.saveCache(otherEnvironment, "pull-request", "v1:list", 1, "other");
      expect(yield* database.loadCache(environmentId, "pull-request", "v1:list")).toEqual(
        Option.some('{"entries":[]}'),
      );
      yield* database.clearEnvironmentCache(environmentId);
      expect((yield* database.loadCache(environmentId, "pull-request", "v1:list"))._tag).toBe(
        "None",
      );
      expect((yield* database.loadCache(otherEnvironment, "pull-request", "v1:list"))._tag).toBe(
        "Some",
      );
    }),
  );

  it.effect("lists one environment's cache keys of one kind", () =>
    Effect.gen(function* () {
      yield* Effect.promise(sqliteDatabase);
      const database = yield* MobileDatabase.make;
      yield* database.saveCache(environmentId, "thread", "thread-a", 1, "a");
      yield* database.saveCache(environmentId, "thread", "thread-b", 1, "b");
      yield* database.saveCache(environmentId, "shell", "shell", 1, "shell");
      yield* database.saveCache(otherEnvironment, "thread", "thread-c", 1, "c");
      expect([...(yield* database.listCacheKeys(environmentId, "thread"))].sort()).toEqual([
        "thread-a",
        "thread-b",
      ]);
    }),
  );

  it.effect("overwrites deleted rows on disk", () =>
    Effect.gen(function* () {
      const sqlite = yield* Effect.promise(sqliteDatabase);
      yield* MobileDatabase.make;
      expect(sqlite.prepare("PRAGMA secure_delete").get()).toEqual({ secure_delete: 1 });
    }),
  );
});
