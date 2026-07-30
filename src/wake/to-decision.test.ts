import { describe, expect, it } from "vitest";
import { toDecision } from "./wake-run-prompt.ts";

describe("toDecision", () => {
  it("treats a bare silent token as a silent decision", () => {
    expect(toDecision("SILENT")).toEqual({ kind: "silent" });
    expect(toDecision("  SILENT\n")).toEqual({ kind: "silent" });
  });

  it("treats empty output as a silent decision rather than an empty reminder", () => {
    expect(toDecision("")).toEqual({ kind: "silent" });
    expect(toDecision("   ")).toEqual({ kind: "silent" });
  });

  it("stays silent when the agent explains its silence alongside the token", () => {
    expect(toDecision("SILENT — 用户昨天已经交过房租了，不需要提醒。")).toEqual({ kind: "silent" });
    expect(toDecision("SILENT\n\n理由：该承诺已经完成。")).toEqual({ kind: "silent" });
  });

  it("keeps a real reminder intact", () => {
    expect(toDecision("今天该交房租了。")).toEqual({ kind: "reminder", content: "今天该交房租了。" });
  });

  it("does not mistake a reminder that merely mentions silence for a silent decision", () => {
    expect(toDecision("你之前说会在会上保持沉默，现在要不要确认一下？")).toEqual({
      kind: "reminder",
      content: "你之前说会在会上保持沉默，现在要不要确认一下？",
    });
  });
});
