import { describe, expect, it } from "vitest";
import { buildWakeRunPrompt } from "./wake-run-prompt.ts";

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
