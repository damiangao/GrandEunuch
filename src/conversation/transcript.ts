import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ConversationMessage } from "./repository.js";

interface TranscriptModel {
  id: string;
  api: string;
  provider: string;
}

interface ToAgentMessagesOptions {
  model: TranscriptModel;
  /** Most recent turns to replay. Bounds context growth on a permanently stored conversation. */
  limit: number;
}

/**
 * Replays stored conversation turns as the Agent's transcript.
 *
 * Without this the Agent starts every request from zero: it cannot honour "确认删除",
 * answer a follow-up, or resolve any reference to what was just said.
 *
 * Reminders become assistant turns because that is who the user saw them from.
 */
export function toAgentMessages(
  history: ConversationMessage[],
  options: ToAgentMessagesOptions
): AgentMessage[] {
  return history
    .filter((message) => message.content.trim().length > 0)
    .slice(-options.limit)
    .map((message) =>
      message.role === "user"
        ? { role: "user" as const, content: message.content, timestamp: message.createdAt }
        : {
            role: "assistant" as const,
            content: [{ type: "text" as const, text: message.content }],
            api: options.model.api,
            provider: options.model.provider,
            model: options.model.id,
            // Replayed history has no real usage to report; the tokens were
            // already counted when these turns were originally produced.
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "stop" as const,
            timestamp: message.createdAt,
          }
    );
}
