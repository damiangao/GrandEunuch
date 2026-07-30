import { describe, expect, it } from "vitest";
import { createDatabase } from "../persistence/sqlite.ts";
import { MemoryRevisionConflictError, SqliteMemoryRepository } from "./repository.ts";

describe("SqliteMemoryRepository", () => {
  it("returns the existing memory when the same idempotency key is replayed", () => {
    const database = createDatabase(":memory:");
    database.runMigrations();
    const repository = new SqliteMemoryRepository(database.connection);

    const first = repository.remember({
      principalId: "local-owner",
      content: "运营承诺本周发送 SOP",
      source: "user message",
      epistemicType: "user_statement",
      tags: ["commitment"],
      idempotencyKey: "event-1:memory.remember",
      createdAt: 1,
    });
    const replay = repository.remember({
      principalId: "local-owner",
      content: "运营承诺本周发送 SOP",
      source: "user message",
      epistemicType: "user_statement",
      tags: ["commitment"],
      idempotencyKey: "event-1:memory.remember",
      createdAt: 2,
    });

    expect(replay).toEqual(first);
    expect(repository.search({ principalId: "local-owner", query: "SOP" })).toEqual([first]);
  });

  it("rejects a revision based on an outdated version", () => {
    const database = createDatabase(":memory:");
    database.runMigrations();
    const repository = new SqliteMemoryRepository(database.connection);
    const memory = repository.remember({
      principalId: "local-owner",
      content: "把想法做成播客",
      source: "user message",
      epistemicType: "user_statement",
      tags: ["idea"],
      idempotencyKey: "event-2:memory.remember",
      createdAt: 1,
    });

    const revised = repository.revise({
      principalId: "local-owner",
      memoryId: memory.id,
      expectedVersion: 1,
      content: "下周开始制作播客试播集",
      source: "user decision",
      epistemicType: "user_decision",
      tags: ["commitment"],
      idempotencyKey: "event-3:memory.revise",
      createdAt: 2,
    });

    expect(revised.version).toBe(2);
    expect(revised.tags).toEqual(["commitment"]);
    expect(() =>
      repository.revise({
        principalId: "local-owner",
        memoryId: memory.id,
        expectedVersion: 1,
        content: "过期修改",
        source: "user message",
        epistemicType: "user_statement",
        tags: ["idea"],
        idempotencyKey: "event-4:memory.revise",
        createdAt: 3,
      })
    ).toThrow(MemoryRevisionConflictError);
  });
});
