import { Agent } from "@earendil-works/pi-agent-core";
import { getLlmApiKey, getLlmModel } from "../llm/provider.js";
import { memoryForgetTool, memoryReadTool, memoryRememberTool, memoryReviseTool, memorySearchTool } from "../memory/tools.js";
import { wakeCancelTool, wakeListTool, wakeScheduleTool } from "../wake/tools.js";
import { SYSTEM_PROMPT, buildTrustedTimeSection } from "./system-prompt.js";

export function createGrandEunuchAgent(): Agent {
  const agent = new Agent({
    initialState: {
      systemPrompt: `${SYSTEM_PROMPT}\n${buildTrustedTimeSection(Date.now())}`,
      model: getLlmModel(),
      tools: [
        memorySearchTool,
        memoryReadTool,
        memoryRememberTool,
        memoryReviseTool,
        memoryForgetTool,
        wakeListTool,
        wakeScheduleTool,
        wakeCancelTool,
      ],
    },
    getApiKey: getLlmApiKey,
  });

  return agent;
}
