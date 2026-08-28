import { formatShanghaiLocalTime } from "./local-time.js";
import type { OccurrenceDecision } from "./repository.js";
import type { WakeRunContext } from "./runner.js";

/** The Agent writes this exact token when it judges the interruption is not worth it. */
const SILENT_TOKEN = "SILENT";

export function buildWakeRunPrompt(context: WakeRunContext): string {
  return `This run was started by a scheduled_wake trigger, not by a new user message.

Wake intent (recorded when you scheduled it): ${context.intentContext}
Originally planned for: ${formatShanghaiLocalTime(context.plannedAt)}
Arrived at: ${formatShanghaiLocalTime(context.arrivedAt)}
User timezone: ${context.timezone}

This wake exists because it was worth scheduling, so the default is to deliver the reminder. Before deciding, call memory__search for the matter this wake tracks (use the tracked keywords or tags). Finding nothing in memory is not a reason to stay silent — most wakes have no separate memory behind them.

Stay silent only when you have positive evidence from memory that the matter is resolved, cancelled, or superseded. Absence of evidence is not such evidence. If memory shows the tracked matter was postponed to a later time, schedule a new wake for that later time with wake__schedule and respond with SILENT — postponement is a reason to re-aim, not to interrupt now.

Then respond with exactly one of:
- The reminder text to show the user. Write it as the message the user will read, and keep the wake intent's substance.
- The single word ${SILENT_TOKEN}, when the evidence above says the reminder would be wrong. Silence is a legitimate outcome, but it is the exception, not the safe default.

Never offer creative or exploratory suggestions here; a wake only reopens secretarial matters.`;
}

/**
 * Maps the Agent's final text onto a decision. Transport only — no business
 * judgment. The Agent often writes its reason next to the token, so anything
 * leading with SILENT counts as silence; the reason itself is not shown.
 */
export function toDecision(finalText: string): OccurrenceDecision {
  const content = finalText.trim();
  if (content.length === 0 || content.startsWith(SILENT_TOKEN)) return { kind: "silent" };
  return { kind: "reminder", content };
}
