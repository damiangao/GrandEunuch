import { createGrandEunuchAgent } from "../agent/create-agent.js";
import { getLlmModel } from "../llm/provider.js";
import { toAgentMessages } from "../conversation/transcript.js";
import type { ConversationMessage } from "../conversation/repository.js";
import { localRunTraces } from "./local-runtime.js";

/** Recent turns replayed into each Run. Enough for a multi-turn exchange, bounded for context. */
const TRANSCRIPT_TURNS = 20;

export interface LocalAgentRuntime {
  respond(message: string, onText: (delta: string) => void): Promise<string>;
}

/** Cap any traced blob so a single run can't bloat the audit table. */
function cap(value: unknown): string {
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return text.length > 4000 ? `${text.slice(0, 4000)}…[truncated]` : text;
  } catch {
    return String(value);
  }
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
      const toolCalls: Array<Record<string, unknown>> = [];

      agent.subscribe((event) => {
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
          response += event.assistantMessageEvent.delta;
          onText(event.assistantMessageEvent.delta);
        }
        if (event.type === "tool_execution_start") {
          toolCalls.push({ id: event.toolCallId, tool: event.toolName, args: cap(event.args) });
        }
        if (event.type === "tool_execution_end") {
          const call = toolCalls.find((entry) => entry.id === event.toolCallId);
          if (call) {
            call.result = cap(event.result);
            call.isError = event.isError;
          }
        }
      });

      const model = getLlmModel();
      const priorTurns = toAgentMessages(history, {
        model: { id: model.id, api: model.api, provider: model.provider },
        limit: TRANSCRIPT_TURNS,
      });
      const promptMessages = [...priorTurns, { role: "user", content: message, timestamp: Date.now() } as const];
      const contextAssembled = JSON.stringify({ systemPrompt: agent.state.systemPrompt, messages: promptMessages });

      const runId = localRunTraces.start("user_message", message.slice(0, 60));
      try {
        await agent.prompt(promptMessages);
        localRunTraces.finish(runId, {
          stopState: "completed",
          finalOutput: response,
          contextAssembled,
          toolCalls: JSON.stringify(toolCalls),
        });
        return response;
      } catch (error) {
        localRunTraces.finish(runId, { stopState: "runtime_failure", contextAssembled, toolCalls: JSON.stringify(toolCalls) });
        throw error;
      }
    },
  };
}
