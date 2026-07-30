/**
 * Asia/Shanghai is UTC+8 year-round (no DST since 1991), so a fixed offset is
 * correct here. If the MVP ever supports another timezone, replace this with a
 * real zone lookup rather than widening the offset constant.
 */
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Renders an epoch timestamp as Asia/Shanghai wall-clock time for the Agent and the user. */
export function formatShanghaiLocalTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" });
}

/**
 * Converts a plain wall-clock time the Agent wrote (e.g. "2026-07-30 17:00")
 * into an epoch timestamp, reading it as Asia/Shanghai local time.
 *
 * Deliberately refuses anything carrying its own timezone: accepting an offset
 * here would mean applying Shanghai's on top of it.
 */
export function parseShanghaiLocalTime(localDateTime: string): number {
  const match = LOCAL_DATE_TIME.exec(localDateTime.trim());
  if (!match) {
    throw new Error(
      `planned_local_time must look like "YYYY-MM-DD HH:MM" in the user's local time, got "${localDateTime}".`
    );
  }

  const [, year, month, day, hour, minute, second] = match;
  const epochMs = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second ?? "0")
  ) - SHANGHAI_OFFSET_MS;

  // Date.UTC rolls impossible values over (Feb 30 -> Mar 2), which would silently
  // schedule the wrong day. Round-trip to confirm the calendar time survived.
  const roundTrip = new Date(epochMs + SHANGHAI_OFFSET_MS).toISOString().slice(0, 19);
  const expected = `${year}-${month}-${day}T${hour}:${minute}:${second ?? "00"}`;
  if (roundTrip !== expected) {
    throw new Error(`planned_local_time "${localDateTime}" is not a real date and time.`);
  }

  return epochMs;
}
