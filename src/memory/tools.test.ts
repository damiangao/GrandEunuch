import { beforeAll, describe, expect, it } from "vitest";

// memory/tools.ts pulls in local-runtime, which opens SQLite at module load.
process.env.DB_PATH = ":memory:";

let tools: typeof import("./tools.ts");

beforeAll(async () => {
  tools = await import("./tools.ts");
});

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((part) => part.text ?? "").join("");
}

async function remember(callId: string, content: string, tags: string[]): Promise<string> {
  const result = await tools.memoryRememberTool.execute(callId, {
    content,
    source: "user message",
    epistemic_type: "user_statement",
    tags,
  });
  const id = /id=([0-9a-f-]+)/.exec(textOf(result))?.[1];
  if (!id) throw new Error(`no id in remember result: ${textOf(result)}`);
  return id;
}

describe("memory__forget two-phase confirmation", () => {
  it("issues a token and forgets nothing on the first call", async () => {
    const id = await remember("m-1", "运营承诺本周发送 SOP", ["commitment"]);

    const first = await tools.memoryForgetTool.execute("f-1", { memory_id: id });

    expect(textOf(first)).toContain("Nothing was forgotten yet");
    expect(textOf(first)).toMatch(/confirmation_token=[0-9a-f-]+/);
    // Still readable, so the first phase really had no side effect.
    expect(textOf(await tools.memoryReadTool.execute("r-1", { memory_id: id }))).toContain("运营承诺本周发送 SOP");
  });

  it("forgets the memory once the issued token is passed back", async () => {
    const id = await remember("m-2", "把想法做成播客", ["idea"]);
    const issued = await tools.memoryForgetTool.execute("f-2", { memory_id: id });
    const token = /confirmation_token=([0-9a-f-]+)/.exec(textOf(issued))?.[1];

    const result = await tools.memoryForgetTool.execute("f-3", { memory_id: id, confirmation_token: token });

    expect(textOf(result)).toContain("Memory forget confirmed");
    expect(textOf(await tools.memoryReadTool.execute("r-2", { memory_id: id }))).toContain("not found");
  });

  it("rejects a token replayed after it was already spent", async () => {
    const id = await remember("m-3", "第三条记忆", ["commitment"]);
    const issued = await tools.memoryForgetTool.execute("f-4", { memory_id: id });
    const token = /confirmation_token=([0-9a-f-]+)/.exec(textOf(issued))?.[1];
    await tools.memoryForgetTool.execute("f-5", { memory_id: id, confirmation_token: token });

    const replay = await tools.memoryForgetTool.execute("f-6", { memory_id: id, confirmation_token: token });

    expect(textOf(replay)).toContain("Nothing was forgotten");
  });

  it("rejects a fabricated token instead of deleting anything", async () => {
    const id = await remember("m-4", "不该被伪造令牌删掉", ["commitment"]);

    const result = await tools.memoryForgetTool.execute("f-7", {
      memory_id: id,
      confirmation_token: "made-up-token",
    });

    expect(textOf(result)).toContain("Nothing was forgotten");
    expect(textOf(await tools.memoryReadTool.execute("r-3", { memory_id: id }))).toContain("不该被伪造令牌删掉");
  });

  it("reports a missing memory without issuing a token", async () => {
    const result = await tools.memoryForgetTool.execute("f-8", { memory_id: "no-such-id" });

    expect(textOf(result)).toContain("no memory with that id exists");
    expect(textOf(result)).not.toContain("confirmation_token=");
  });
});

describe("memory__search tag filtering", () => {
  it("matches any requested tag rather than requiring all of them", async () => {
    await remember("m-5", "标签检索：只有 idea", ["idea"]);
    await remember("m-6", "标签检索：只有 commitment", ["commitment"]);

    const result = await tools.memorySearchTool.execute("s-1", {
      query: "标签检索",
      tags: ["idea", "commitment"],
    });

    expect(textOf(result)).toContain("只有 idea");
    expect(textOf(result)).toContain("只有 commitment");
  });

  it("excludes memories whose tags do not intersect the filter", async () => {
    await remember("m-7", "标签排除：带 idea 标签", ["idea"]);

    const result = await tools.memorySearchTool.execute("s-2", { query: "标签排除", tags: ["commitment"] });

    expect(textOf(result)).toBe("No matching memories found.");
  });

  it("ignores tag filtering entirely when no tags are given", async () => {
    await remember("m-8", "无标签过滤时应命中", ["idea"]);

    const result = await tools.memorySearchTool.execute("s-3", { query: "无标签过滤" });

    expect(textOf(result)).toContain("无标签过滤时应命中");
  });
});
