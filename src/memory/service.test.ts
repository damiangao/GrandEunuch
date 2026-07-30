import { describe, expect, it } from "vitest";
import { createDatabase } from "../persistence/sqlite.ts";
import { SqliteMemoryRepository } from "./repository.ts";
import { MemoryConfirmationRequiredError, MemoryService } from "./service.ts";

describe("MemoryService", () => {
  it("only forgets a memory after its one-time confirmation token is used", () => {
    const database = createDatabase(":memory:");
    database.runMigrations();
    const repository = new SqliteMemoryRepository(database.connection);
    const service = new MemoryService(repository);
    const memory = repository.remember({
      principalId: "local-owner",
      content: "运营承诺本周发送 SOP",
      source: "user message",
      epistemicType: "user_statement",
      tags: ["commitment"],
      idempotencyKey: "event-5:memory.remember",
      createdAt: 1,
    });

    expect(() => service.forget({ principalId: "local-owner", memoryId: memory.id, confirmationToken: "missing" })).toThrow(
      MemoryConfirmationRequiredError
    );

    const confirmation = service.createForgetConfirmation({
      principalId: "local-owner",
      memoryId: memory.id,
      expiresAt: Date.now() + 1_000,
    });
    service.forget({ principalId: "local-owner", memoryId: memory.id, confirmationToken: confirmation.token });

    expect(repository.read({ principalId: "local-owner", memoryId: memory.id })).toBeUndefined();
    expect(repository.search({ principalId: "local-owner", query: "SOP" })).toEqual([]);
    expect(() => service.forget({ principalId: "local-owner", memoryId: memory.id, confirmationToken: confirmation.token })).toThrow(
      MemoryConfirmationRequiredError
    );
  });

  it("cancels wakes linked to a forgotten memory", () => {
    const database = createDatabase(":memory:");
    database.runMigrations();
    const repository = new SqliteMemoryRepository(database.connection);
    const service = new MemoryService(repository);
    const memory = repository.remember({
      principalId: "local-owner",
      content: "运营承诺本周发送 SOP",
      source: "user message",
      epistemicType: "user_statement",
      tags: ["commitment"],
      idempotencyKey: "event-6:memory.remember",
      createdAt: 1,
    });
    database.connection
      .prepare("INSERT INTO wake_memory_links (wake_id, memory_id) VALUES (?, ?)")
      .run("wake-1", memory.id);
    database.connection
      .prepare(
        `INSERT INTO wake_intents (
          id, principal_id, conversation_id, state, generation, planned_at, timezone, intent_context, idempotency_key, created_at
        ) VALUES (?, ?, ?, 'active', 1, ?, ?, ?, ?, ?)`
      )
      .run("wake-1", "local-owner", "default", 1_000, "Asia/Shanghai", "follow up", "event-7:wake.schedule", 1);

    const confirmation = service.createForgetConfirmation({
      principalId: "local-owner",
      memoryId: memory.id,
      expiresAt: Date.now() + 1_000,
    });
    service.forget({ principalId: "local-owner", memoryId: memory.id, confirmationToken: confirmation.token });

    const wake = database.connection.prepare("SELECT state FROM wake_intents WHERE id = ?").get("wake-1") as { state: string };
    expect(wake.state).toBe("cancelled");
  });
});
