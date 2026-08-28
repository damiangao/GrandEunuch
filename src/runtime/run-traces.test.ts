import { describe, expect, it } from "vitest";
import { createDatabase } from "../persistence/sqlite.ts";
import { createRunTraces } from "./run-traces.ts";
import { SqliteMemoryRepository } from "../memory/repository.ts";
import { SqliteConversationRepository } from "../conversation/repository.ts";
import { newId } from "../persistence/id.ts";

describe("run traces", () => {
  it("records a run with stop state and final output", () => {
    const database = createDatabase(":memory:");
    database.runMigrations();
    const traces = createRunTraces(database.connection);

    const runId = traces.start("user_message", "hello");
    traces.finish(runId, {
      stopState: "completed",
      finalOutput: "hi",
      toolCalls: JSON.stringify([{ tool: "memory__search" }]),
    });

    const row = database.connection.prepare("SELECT * FROM run_traces WHERE run_id = ?").get(runId) as
      | { stop_state: string; final_output: string; finished_at: number }
      | undefined;
    expect(row?.stop_state).toBe("completed");
    expect(row?.final_output).toBe("hi");
    expect(row?.finished_at).toBeGreaterThan(0);
  });

  it("forget scrubs forgotten content and memory id from traces", () => {
    const database = createDatabase(":memory:");
    database.runMigrations();
    const traces = createRunTraces(database.connection);
    const memory = new SqliteMemoryRepository(database.connection);

    const entry = memory.remember({
      principalId: "local-owner",
      content: "机密：密码是 hunter2",
      source: "user",
      epistemicType: "user_statement",
      tags: [],
      idempotencyKey: newId(),
      createdAt: Date.now(),
    });

    const runId = traces.start("user_message", "remember secret");
    traces.finish(runId, {
      stopState: "completed",
      finalOutput: "已记住",
      toolCalls: JSON.stringify([{ tool: "memory__remember", args: "机密：密码是 hunter2" }]),
      contextAssembled: JSON.stringify({ messages: [{ content: "机密：密码是 hunter2" }] }),
    });
    // Conversation replay and committed reminders are recovery paths too.
    database.connection
      .prepare("INSERT INTO conversation_messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("msg-1", "conv-1", "assistant", "记住了：机密：密码是 hunter2", 1);
    database.connection
      .prepare("INSERT INTO visible_effects (id, principal_id, conversation_id, occurrence_id, run_id, kind, content, committed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("eff-1", "local-owner", "conv-1", "occ-1", "run-1", "reminder", "机密：密码是 hunter2", 1);

    const forgotten = memory.forget({ principalId: "local-owner", memoryId: entry.id });
    expect(forgotten).toBe(true);

    const row = database.connection
      .prepare("SELECT tool_calls, context_assembled FROM run_traces WHERE run_id = ?")
      .get(runId) as { tool_calls: string; context_assembled: string };
    expect(row.tool_calls).toContain("[已遗忘]");
    expect(row.tool_calls).not.toContain("hunter2");
    expect(row.context_assembled).not.toContain("hunter2");

    const message = database.connection.prepare("SELECT content FROM conversation_messages WHERE id = ?").get("msg-1") as { content: string };
    const effect = database.connection.prepare("SELECT content FROM visible_effects WHERE id = ?").get("eff-1") as { content: string };
    expect(message.content).not.toContain("hunter2");
    expect(effect.content).not.toContain("hunter2");

    // Write-time scrubbing: assistant re-quotes are scrubbed, user re-mentions are not.
    const conversation = new SqliteConversationRepository(database.connection);
    const assistant = conversation.append({ conversationId: "conv-1", role: "assistant", content: "已删除「机密：密码是 hunter2」", createdAt: 1 });
    const user = conversation.append({ conversationId: "conv-1", role: "user", content: "再告诉你一次：机密：密码是 hunter2", createdAt: 1 });
    expect(assistant.content).not.toContain("hunter2");
    expect(assistant.content).toContain("[已遗忘]");
    expect(user.content).toContain("hunter2");
  });
});
