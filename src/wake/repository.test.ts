import { describe, expect, it } from "vitest";
import { createDatabase } from "../persistence/sqlite.ts";
import { SqliteWakeRepository } from "./repository.ts";

describe("SqliteWakeRepository", () => {
  it("resolves a repeated occurrence to one visible effect", () => {
    const database = createDatabase(":memory:");
    database.runMigrations();
    const repository = new SqliteWakeRepository(database.connection);
    const wake = repository.schedule({
      principalId: "local-owner",
      conversationId: "default",
      plannedAt: 1_000,
      timezone: "Asia/Shanghai",
      intentContext: "重新判断是否提醒用户跟进 SOP",
      idempotencyKey: "event-1:wake.schedule",
      createdAt: 1,
    });
    const occurrence = repository.claimOccurrence({ wakeId: wake.id, plannedAt: 1_000, claimedAt: 1_000 });

    const first = repository.resolveOccurrence({
      occurrenceId: occurrence.id,
      wakeId: wake.id,
      generation: wake.generation,
      runId: "run-1",
      decision: { kind: "reminder", content: "运营的 SOP 还没有更新；你要不要跟进？" },
      committedAt: 1_001,
    });
    const replay = repository.resolveOccurrence({
      occurrenceId: occurrence.id,
      wakeId: wake.id,
      generation: wake.generation,
      runId: "run-2",
      decision: { kind: "reminder", content: "重复提醒不应写入" },
      committedAt: 1_002,
    });

    expect(first).toEqual({ state: "effect", effectId: expect.any(String) });
    expect(replay).toEqual(first);
    expect(repository.listVisibleEffects({ principalId: "local-owner", conversationId: "default" })).toHaveLength(1);
  });

  it("blocks an old occurrence after its wake was cancelled", () => {
    const database = createDatabase(":memory:");
    database.runMigrations();
    const repository = new SqliteWakeRepository(database.connection);
    const wake = repository.schedule({
      principalId: "local-owner",
      conversationId: "default",
      plannedAt: 1_000,
      timezone: "Asia/Shanghai",
      intentContext: "重新判断是否提醒用户跟进 SOP",
      idempotencyKey: "event-2:wake.schedule",
      createdAt: 1,
    });
    const occurrence = repository.claimOccurrence({ wakeId: wake.id, plannedAt: 1_000, claimedAt: 1_000 });
    repository.cancel({ principalId: "local-owner", wakeId: wake.id, idempotencyKey: "event-3:wake.cancel", cancelledAt: 1_001 });

    const result = repository.resolveOccurrence({
      occurrenceId: occurrence.id,
      wakeId: wake.id,
      generation: wake.generation,
      runId: "run-3",
      decision: { kind: "reminder", content: "不得在取消后显示" },
      committedAt: 1_002,
    });

    expect(result).toEqual({ state: "blocked" });
    expect(repository.listVisibleEffects({ principalId: "local-owner", conversationId: "default" })).toEqual([]);
  });

  it("stops listing a wake as active once its occurrence was resolved", () => {
    const database = createDatabase(":memory:");
    database.runMigrations();
    const repository = new SqliteWakeRepository(database.connection);
    const wake = repository.schedule({
      principalId: "local-owner",
      conversationId: "default",
      plannedAt: 1_000,
      timezone: "Asia/Shanghai",
      intentContext: "重新判断是否提醒用户跟进 SOP",
      idempotencyKey: "event-6:wake.schedule",
      createdAt: 1,
    });
    const occurrence = repository.claimOccurrence({ wakeId: wake.id, plannedAt: 1_000, claimedAt: 1_000 });

    repository.resolveOccurrence({
      occurrenceId: occurrence.id,
      wakeId: wake.id,
      generation: wake.generation,
      runId: "run-6",
      decision: { kind: "reminder", content: "运营的 SOP 还没有更新；你要不要跟进？" },
      committedAt: 1_001,
    });

    expect(repository.listActive({ principalId: "local-owner" })).toEqual([]);
    expect(repository.claimDueOccurrences({ now: 2_000 })).toEqual([]);
  });

  it("commits a silent decision that blocks any later visible effect for the same occurrence", () => {
    const database = createDatabase(":memory:");
    database.runMigrations();
    const repository = new SqliteWakeRepository(database.connection);
    const wake = repository.schedule({
      principalId: "local-owner",
      conversationId: "default",
      plannedAt: 1_000,
      timezone: "Asia/Shanghai",
      intentContext: "重新判断是否提醒用户跟进 SOP",
      idempotencyKey: "event-5:wake.schedule",
      createdAt: 1,
    });
    const occurrence = repository.claimOccurrence({ wakeId: wake.id, plannedAt: 1_000, claimedAt: 1_000 });

    const silent = repository.resolveOccurrence({
      occurrenceId: occurrence.id,
      wakeId: wake.id,
      generation: wake.generation,
      runId: "run-4",
      decision: { kind: "silent" },
      committedAt: 1_001,
    });
    const laterReminder = repository.resolveOccurrence({
      occurrenceId: occurrence.id,
      wakeId: wake.id,
      generation: wake.generation,
      runId: "run-5",
      decision: { kind: "reminder", content: "静默之后不得再提醒" },
      committedAt: 1_002,
    });

    expect(silent).toEqual({ state: "silent" });
    expect(laterReminder).toEqual({ state: "silent" });
    expect(repository.listVisibleEffects({ principalId: "local-owner", conversationId: "default" })).toEqual([]);
  });
});
