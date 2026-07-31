import { beforeAll, describe, expect, it } from "vitest";

// wake/tools.ts pulls in local-runtime, which opens SQLite at module load. Point
// it at an in-memory database before that import happens.
process.env.DB_PATH = ":memory:";

let tools: typeof import("./tools.ts");

beforeAll(async () => {
  tools = await import("./tools.ts");
});

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((part) => part.text ?? "").join("");
}

// These assert on the Tool Result *text*, not on any error flag: pi-agent-core
// derives the model-visible isError purely from whether execute() threw, so the
// spec's "state whether the side effect happened" requirement lives in the text.
describe("wake__schedule", () => {
  it("reports no side effect and stays retryable when the time cannot be parsed", async () => {
    const result = await tools.wakeScheduleTool.execute("call-1", {
      planned_local_time: "下周二下午",
      timezone: "Asia/Shanghai",
      intent_context: "跟进 SOP",
    });

    expect(textOf(result)).toContain("No wake was scheduled — safe to retry");
  });

  it("refuses a past wall-clock time instead of scheduling one that fires immediately", async () => {
    const result = await tools.wakeScheduleTool.execute("call-2", {
      planned_local_time: "2020-01-01 09:00",
      timezone: "Asia/Shanghai",
      intent_context: "跟进 SOP",
    });

    expect(textOf(result)).toContain("No wake was scheduled — safe to retry");
    expect(textOf(result)).toContain("is in the past");
  });

  it("confirms the side effect happened when the time is valid and future", async () => {
    const result = await tools.wakeScheduleTool.execute("call-3", {
      planned_local_time: "2099-01-01 09:00",
      timezone: "Asia/Shanghai",
      intent_context: "跟进 SOP",
    });

    expect(textOf(result)).toContain("Wake confirmed scheduled");
  });

  it("returns the same wake for a replayed call id rather than scheduling twice", async () => {
    const params = {
      planned_local_time: "2099-02-01 09:00",
      timezone: "Asia/Shanghai" as const,
      intent_context: "跟进 SOP",
    };
    const first = await tools.wakeScheduleTool.execute("call-4", params);
    const replay = await tools.wakeScheduleTool.execute("call-4", params);

    expect(textOf(replay)).toBe(textOf(first));
    expect(tools.wakeListTool).toBeDefined();
  });
});
