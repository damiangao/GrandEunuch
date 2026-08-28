import { newId } from "../persistence/id.js";
import { scrubForgottenStrings } from "../persistence/sqlite.js";
import type { DatabaseSync } from "node:sqlite";

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant" | "reminder";
  content: string;
  createdAt: number;
}

export class SqliteConversationRepository {
  constructor(private readonly connection: DatabaseSync) {}

  ensureDefaultConversation(principalId: string, createdAt: number): string {
    const id = "default";
    this.connection
      .prepare("INSERT OR IGNORE INTO conversations (id, principal_id, created_at) VALUES (?, ?, ?)")
      .run(id, principalId, createdAt);
    return id;
  }

  append(input: { conversationId: string; role: ConversationMessage["role"]; content: string; createdAt: number }): ConversationMessage {
    // The user may legitimately re-introduce a forgotten topic; only the
    // assistant's re-quotes are leaks and get scrubbed at write time.
    const content = input.role === "user" ? input.content : scrubForgottenStrings(this.connection, input.content);
    const message: ConversationMessage = { id: newId(), role: input.role, content, createdAt: input.createdAt };
    this.connection
      .prepare("INSERT INTO conversation_messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(message.id, input.conversationId, message.role, message.content, message.createdAt);
    return message;
  }

  list(conversationId: string): ConversationMessage[] {
    return this.connection
      .prepare("SELECT id, role, content, created_at FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at ASC")
      .all(conversationId)
      .map((row) => {
        const value = row as { id: string; role: ConversationMessage["role"]; content: string; created_at: number };
        return { id: value.id, role: value.role, content: value.content, createdAt: value.created_at };
      });
  }
}
