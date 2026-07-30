import { setupModels } from "../src/llm/provider.ts";

async function main() {
  const { models, model } = setupModels();

  const reply = await models.complete(model, {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: "Reply with exactly: pong" }],
        timestamp: Date.now(),
      },
    ],
  });

  console.log("stopReason:", reply.stopReason);
  console.log("content:", JSON.stringify(reply.content));
}

main().catch((err) => {
  console.error("llm check failed:", err);
  process.exitCode = 1;
});
