import { createGrandEunuchAgent } from "../agent/create-agent.js";
import type { OccurrenceDecision } from "./repository.js";
import type { WakeRunAgent, WakeRunContext } from "./runner.js";
import { buildWakeRunPrompt, toDecision } from "./wake-run-prompt.js";

export function createAgentWakeReassessor(): WakeRunAgent {
  return {
    async reassess(context: WakeRunContext): Promise<OccurrenceDecision> {
      const agent = createGrandEunuchAgent();
      let finalText = "";
      agent.subscribe((event) => {
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
          finalText += event.assistantMessageEvent.delta;
        }
      });
      await agent.prompt(buildWakeRunPrompt(context));
      return toDecision(finalText);
    },
  };
}
