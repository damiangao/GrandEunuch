import { createGrandEunuchAgent } from "../agent/create-agent.js";
import { getLlmModel } from "../llm/provider.js";
import { toAgentMessages } from "../conversation/transcript.js";
import type { ConversationMessage } from "../conversation/repository.js";

/** Recent turns replayed into each Run. Enough for a multi-turn exchange, bounded for context. */
const TRANSCRIPT_TURNS = 20;

export interface LocalAgentRuntime {
  respond(message: string, onText: (delta: string) => void): Promise<string>;
}

/**
 * @param history Conversation turns before this message. Without them the Agent
 *   starts each request from zero and cannot honour a follow-up like "确认删除".
 */
export function createLocalAgentRuntime(history: ConversationMessage[] = []): LocalAgentRuntime {
  return {
    async respond(message: string, onText: (delta: string) => void): Promise<string> {
      const agent = createGrandEunuchAgent();
      let response = "";
      agent.subscribe((event) => {
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
          response += event.assistantMessageEvent.delta;
          onText(event.assistantMessageEvent.delta);
        }
      });

      const model = getLlmModel();
      const priorTurns = toAgentMessages(history, {
        model: { id: model.id, api: model.api, provider: model.provider },
        limit: TRANSCRIPT_TURNS,
      });

      await agent.prompt([
        ...priorTurns,
        { role: "user", content: message, timestamp: Date.now() },
      ]);
      return response;
    },
  };
}
