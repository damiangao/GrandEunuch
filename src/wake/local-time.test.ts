import { describe, expect, it } from "vitest";
import { parseShanghaiLocalTime } from "./local-time.ts";

/** Formats back through the same timezone so assertions read as wall-clock time. */
function asShanghai(epochMs: number): string {
  return new Date(epochMs).toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" });
}

describe("parseShanghaiLocalTime", () => {
  it("reads a local wall-clock time as Asia/Shanghai, not UTC", () => {
    const epochMs = parseShanghaiLocalTime("2026-07-30 17:00");
    expect(asShanghai(epochMs)).toBe("2026-07-30 17:00:00");
  });

  it("accepts seconds and the T separator", () => {
    expect(asShanghai(parseShanghaiLocalTime("2026-07-30T17:00:00"))).toBe("2026-07-30 17:00:00");
  });

  it("rejects input that is not a plain local date-time", () => {
    expect(() => parseShanghaiLocalTime("today at 5pm")).toThrow();
    expect(() => parseShanghaiLocalTime("2026-07-30")).toThrow();
    expect(() => parseShanghaiLocalTime("")).toThrow();
  });

  it("rejects a timezone-qualified string so the offset can never be double-applied", () => {
    expect(() => parseShanghaiLocalTime("2026-07-30T17:00:00Z")).toThrow();
    expect(() => parseShanghaiLocalTime("2026-07-30T17:00:00+08:00")).toThrow();
  });

  it("rejects an impossible wall-clock time instead of silently rolling over", () => {
    expect(() => parseShanghaiLocalTime("2026-07-30 25:00")).toThrow();
    expect(() => parseShanghaiLocalTime("2026-02-30 10:00")).toThrow();
  });
});
