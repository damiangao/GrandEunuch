import { createGrandEunuchAgent } from "../agent/create-agent.js";

export interface LocalAgentRuntime {
  respond(message: string, onText: (delta: string) => void): Promise<string>;
}

export function createLocalAgentRuntime(): LocalAgentRuntime {
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
      await agent.prompt(message);
      return response;
    },
  };
}
