import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createGrandEunuchAgent } from "../src/agent/create-agent.ts";

async function main() {
  const agent = createGrandEunuchAgent();

  agent.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      stdout.write(event.assistantMessageEvent.delta);
    }
    if (event.type === "tool_execution_start") {
      console.log(`\n[tool call] ${event.toolName}(${JSON.stringify(event.args)})`);
    }
    if (event.type === "tool_execution_end") {
      console.log(`[tool result] ${JSON.stringify(event.result.content)}`);
    }
  });

  const rl = createInterface({ input: stdin, output: stdout });
  console.log("GrandEunuch REPL. Ctrl+C or /exit to quit.\n");

  while (true) {
    let line: string;
    try {
      line = await rl.question("> ");
    } catch (err) {
      if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ERR_USE_AFTER_CLOSE") break;
      throw err;
    }
    if (line.trim() === "/exit") break;
    if (!line.trim()) continue;

    await agent.prompt(line);
    stdout.write("\n\n");
  }

  rl.close();
}

main().catch((err) => {
  console.error("repl failed:", err);
  process.exitCode = 1;
});
