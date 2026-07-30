import { describe, expect, it } from "vitest";
import { createDatabase } from "../persistence/sqlite.ts";
import { SqliteWakeRepository } from "./repository.ts";
import { LocalWakeScheduler } from "./scheduler.ts";

describe("LocalWakeScheduler", () => {
  it("claims an overdue wake once after the local service restarts", () => {
    const database = createDatabase(":memory:");
    database.runMigrations();
    const repository = new SqliteWakeRepository(database.connection);
    repository.schedule({
      principalId: "local-owner",
      conversationId: "default",
      plannedAt: 1_000,
      timezone: "Asia/Shanghai",
      intentContext: "重新判断是否提醒用户跟进 SOP",
      idempotencyKey: "event-4:wake.schedule",
      createdAt: 1,
    });

    const restartedScheduler = new LocalWakeScheduler(repository);
    const firstScan = restartedScheduler.scan(2_000);
    const secondScan = restartedScheduler.scan(2_000);

    expect(firstScan).toHaveLength(1);
    expect(secondScan).toEqual(firstScan);
  });
});
