import { describe, expect, it } from "vitest";
import { toAgentMessages } from "./transcript.ts";
import type { ConversationMessage } from "./repository.ts";

function message(
  role: ConversationMessage["role"],
  content: string,
  createdAt: number
): ConversationMessage {
  return { id: `${role}-${createdAt}`, role, content, createdAt };
}

const model = { id: "test-model", api: "anthropic-messages", provider: "llm" } as const;

describe("toAgentMessages", () => {
  it("replays the stored turns so the agent can refer back to them", () => {
    const messages = toAgentMessages(
      [message("user", "记住我的会议室密码是 4471", 1), message("assistant", "已记住。", 2)],
      { model, limit: 10 }
    );

    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(messages[0]).toMatchObject({ role: "user", content: "记住我的会议室密码是 4471" });
  });

  it("carries reminders in as assistant turns, since the user saw them from the agent", () => {
    const messages = toAgentMessages([message("reminder", "该吃药了。", 1)], { model, limit: 10 });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: "assistant" });
  });

  it("keeps only the most recent turns so the context cannot grow without bound", () => {
    const history = Array.from({ length: 8 }, (_, index) =>
      message(index % 2 === 0 ? "user" : "assistant", `第 ${index} 条`, index)
    );

    const messages = toAgentMessages(history, { model, limit: 3 });

    expect(messages).toHaveLength(3);
    expect(messages.at(-1)).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "第 7 条" }],
    });
  });

  it("drops an empty assistant turn rather than sending a contentless message", () => {
    const messages = toAgentMessages(
      [message("user", "在吗", 1), message("assistant", "", 2)],
      { model, limit: 10 }
    );

    expect(messages.map((m) => m.role)).toEqual(["user"]);
  });

  it("returns nothing for an empty history", () => {
    expect(toAgentMessages([], { model, limit: 10 })).toEqual([]);
  });
});
