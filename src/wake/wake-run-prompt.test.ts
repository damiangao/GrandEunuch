import { describe, expect, it } from "vitest";
import { buildWakeRunPrompt, toDecision } from "./wake-run-prompt.ts";

const context = {
  runId: "run-1",
  wakeId: "wake-1",
  occurrenceId: "occurrence-1",
  generation: 1,
  plannedAt: Date.UTC(2026, 6, 30, 13, 20),
  arrivedAt: Date.UTC(2026, 6, 30, 13, 20, 30),
  timezone: "Asia/Shanghai",
  intentContext: "提醒用户吃药",
};

describe("buildWakeRunPrompt", () => {
  it("states the default is to remind, so an absent memory does not become silence", () => {
    const prompt = buildWakeRunPrompt(context);
    expect(prompt).toMatch(/default is to (deliver|remind)/i);
    expect(prompt).toMatch(/finding nothing in memory is not a reason to stay silent/i);
  });

  it("limits silence to positive evidence the matter is settled", () => {
    const prompt = buildWakeRunPrompt(context);
    expect(prompt).toMatch(/resolved, cancelled, or superseded/i);
  });

  it("shows the wake intent and both times as local wall-clock", () => {
    const prompt = buildWakeRunPrompt(context);
    expect(prompt).toContain("提醒用户吃药");
    expect(prompt).toContain("2026-07-30 21:20:00");
    expect(prompt).toContain("Asia/Shanghai");
  });
});

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
