import { describe, expect, it } from "vitest";
import { createDatabase } from "../persistence/sqlite.ts";
import { SqliteWakeRepository } from "./repository.ts";
import { LocalWakeScheduler } from "./scheduler.ts";
import { WakeRunner, type WakeRunAgent } from "./runner.ts";

function setup() {
  const database = createDatabase(":memory:");
  database.runMigrations();
  const repository = new SqliteWakeRepository(database.connection);
  const scheduler = new LocalWakeScheduler(repository);
  return { repository, scheduler };
}

function scheduleWake(repository: SqliteWakeRepository, idempotencyKey: string) {
  return repository.schedule({
    principalId: "local-owner",
    conversationId: "default",
    plannedAt: 1_000,
    timezone: "Asia/Shanghai",
    intentContext: "重新判断是否提醒用户跟进 SOP",
    idempotencyKey,
    createdAt: 1,
  });
}

describe("WakeRunner", () => {
  it("commits a reminder the agent decided to send", async () => {
    const { repository, scheduler } = setup();
    scheduleWake(repository, "runner-1:wake.schedule");
    const agent: WakeRunAgent = {
      reassess: async () => ({ kind: "reminder", content: "运营的 SOP 还没有更新；你要不要跟进？" }),
    };

    await new WakeRunner(repository, scheduler, agent).processDue(2_000);

    const effects = repository.listVisibleEffects({ principalId: "local-owner", conversationId: "default" });
    expect(effects).toHaveLength(1);
    expect(effects[0]?.content).toBe("运营的 SOP 还没有更新；你要不要跟进？");
  });

  it("produces no visible effect when the agent decided to stay silent", async () => {
    const { repository, scheduler } = setup();
    scheduleWake(repository, "runner-2:wake.schedule");
    const agent: WakeRunAgent = { reassess: async () => ({ kind: "silent" }) };

    await new WakeRunner(repository, scheduler, agent).processDue(2_000);

    expect(repository.listVisibleEffects({ principalId: "local-owner", conversationId: "default" })).toEqual([]);
  });

  it("does not re-run the agent for an occurrence already resolved", async () => {
    const { repository, scheduler } = setup();
    scheduleWake(repository, "runner-3:wake.schedule");
    let reassessCount = 0;
    const agent: WakeRunAgent = {
      reassess: async () => {
        reassessCount += 1;
        return { kind: "reminder", content: "只应提醒一次" };
      },
    };
    const runner = new WakeRunner(repository, scheduler, agent);

    await runner.processDue(2_000);
    await runner.processDue(3_000);

    expect(reassessCount).toBe(1);
    expect(repository.listVisibleEffects({ principalId: "local-owner", conversationId: "default" })).toHaveLength(1);
  });

  it("does not let one failing occurrence block the others", async () => {
    const { repository, scheduler } = setup();
    const failing = scheduleWake(repository, "runner-4:wake.schedule");
    scheduleWake(repository, "runner-5:wake.schedule");
    const agent: WakeRunAgent = {
      reassess: async (context) => {
        if (context.wakeId === failing.id) throw new Error("LLM 调用失败");
        return { kind: "reminder", content: "另一个提醒仍应送达" };
      },
    };

    await new WakeRunner(repository, scheduler, agent).processDue(2_000);

    const effects = repository.listVisibleEffects({ principalId: "local-owner", conversationId: "default" });
    expect(effects).toHaveLength(1);
    expect(effects[0]?.content).toBe("另一个提醒仍应送达");
  });
});
