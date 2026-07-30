import type { ConversationMessage, SqliteConversationRepository } from "./repository.js";
import type { SqliteWakeRepository } from "../wake/repository.js";

interface ReadTimelineInput {
  conversations: SqliteConversationRepository;
  wakes: SqliteWakeRepository;
  principalId: string;
  conversationId: string;
}

/**
 * The user-visible conversation: authored messages plus the wake reminders the
 * internal atomic boundary actually committed. Reminders are read from
 * visible_effects rather than copied into conversation_messages so that
 * "at most one visible effect per occurrence" stays enforced in one place.
 */
export function readTimeline(input: ReadTimelineInput): ConversationMessage[] {
  const messages = input.conversations.list(input.conversationId);
  const reminders = input.wakes
    .listVisibleEffects({ principalId: input.principalId, conversationId: input.conversationId })
    .map((effect): ConversationMessage => ({
      id: effect.id,
      role: "reminder",
      content: effect.content,
      createdAt: effect.committedAt,
    }));

  return [...messages, ...reminders].sort((left, right) => left.createdAt - right.createdAt);
}
