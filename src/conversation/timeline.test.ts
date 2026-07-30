import { describe, expect, it } from "vitest";
import { createDatabase } from "../persistence/sqlite.ts";
import { SqliteConversationRepository } from "./repository.ts";
import { SqliteWakeRepository } from "../wake/repository.ts";
import { readTimeline } from "./timeline.ts";

describe("readTimeline", () => {
  it("merges committed wake reminders into the conversation in time order", () => {
    const database = createDatabase(":memory:");
    database.runMigrations();
    const conversations = new SqliteConversationRepository(database.connection);
    const wakes = new SqliteWakeRepository(database.connection);
    conversations.ensureDefaultConversation("local-owner", 1);

    conversations.append({ conversationId: "default", role: "user", content: "帮我记住周三交房租", createdAt: 100 });
    conversations.append({ conversationId: "default", role: "assistant", content: "已记住。", createdAt: 200 });
    const wake = wakes.schedule({
      principalId: "local-owner",
      conversationId: "default",
      plannedAt: 300,
      timezone: "Asia/Shanghai",
      intentContext: "重新判断是否提醒交房租",
      idempotencyKey: "timeline-1:wake.schedule",
      createdAt: 1,
    });
    const occurrence = wakes.claimOccurrence({ wakeId: wake.id, plannedAt: 300, claimedAt: 300 });
    wakes.resolveOccurrence({
      occurrenceId: occurrence.id,
      wakeId: wake.id,
      generation: wake.generation,
      runId: "run-1",
      decision: { kind: "reminder", content: "今天该交房租了。" },
      committedAt: 300,
    });
    conversations.append({ conversationId: "default", role: "user", content: "已经交了", createdAt: 400 });

    const timeline = readTimeline({
      conversations,
      wakes,
      principalId: "local-owner",
      conversationId: "default",
    });

    expect(timeline.map((message) => [message.role, message.content])).toEqual([
      ["user", "帮我记住周三交房租"],
      ["assistant", "已记住。"],
      ["reminder", "今天该交房租了。"],
      ["user", "已经交了"],
    ]);
  });

  it("shows no reminder for a silently resolved wake", () => {
    const database = createDatabase(":memory:");
    database.runMigrations();
    const conversations = new SqliteConversationRepository(database.connection);
    const wakes = new SqliteWakeRepository(database.connection);
    conversations.ensureDefaultConversation("local-owner", 1);
    const wake = wakes.schedule({
      principalId: "local-owner",
      conversationId: "default",
      plannedAt: 300,
      timezone: "Asia/Shanghai",
      intentContext: "重新判断是否提醒交房租",
      idempotencyKey: "timeline-2:wake.schedule",
      createdAt: 1,
    });
    const occurrence = wakes.claimOccurrence({ wakeId: wake.id, plannedAt: 300, claimedAt: 300 });
    wakes.resolveOccurrence({
      occurrenceId: occurrence.id,
      wakeId: wake.id,
      generation: wake.generation,
      runId: "run-1",
      decision: { kind: "silent" },
      committedAt: 300,
    });

    const timeline = readTimeline({
      conversations,
      wakes,
      principalId: "local-owner",
      conversationId: "default",
    });

    expect(timeline).toEqual([]);
  });
});
