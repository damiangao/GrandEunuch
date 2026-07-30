import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { localWakeRepository } from "../runtime/local-runtime.js";
import { formatShanghaiLocalTime, parseShanghaiLocalTime } from "./local-time.js";

const localPrincipalId = "local-owner";
const localConversationId = "default";

const scheduleParams = Type.Object({
  planned_local_time: Type.String({
    description:
      'When to reassess, as the user\'s local wall-clock time in "YYYY-MM-DD HH:MM" form (e.g. "2026-07-30 17:00"). Never include a timezone or offset; never compute an epoch timestamp yourself.',
  }),
  timezone: Type.Literal("Asia/Shanghai", { description: "The confirmed local MVP timezone" }),
  intent_context: Type.String({ description: "Why the future run should reassess whether to interrupt the user" }),
});

export const wakeScheduleTool: AgentTool<typeof scheduleParams> = {
  name: "wake__schedule",
  label: "Schedule wake",
  description:
    "Schedule a future re-evaluation for a secretarial matter. Use for commitments and pending outcomes, not for unsolicited creative suggestions. The wake stores a reassessment intent, not a pre-written reminder.",
  parameters: scheduleParams,
  execute: async (callId, params) => {
    const now = Date.now();
    let plannedAt: number;
    try {
      plannedAt = parseShanghaiLocalTime(params.planned_local_time);
    } catch (error: unknown) {
      return {
        content: [
          {
            type: "text",
            text: `No wake was scheduled — safe to retry. ${error instanceof Error ? error.message : "Invalid time."} The current local time is ${formatShanghaiLocalTime(now)}.`,
          },
        ],
        details: {},
        isError: true,
      };
    }

    if (plannedAt <= now) {
      return {
        content: [
          {
            type: "text",
            text: `No wake was scheduled — safe to retry. "${params.planned_local_time}" is in the past; the current local time is ${formatShanghaiLocalTime(now)}. Tell the user the time has already passed rather than scheduling it.`,
          },
        ],
        details: {},
        isError: true,
      };
    }

    const wake = localWakeRepository.schedule({
      principalId: localPrincipalId,
      conversationId: localConversationId,
      plannedAt,
      timezone: params.timezone,
      intentContext: params.intent_context,
      idempotencyKey: `tool:${callId}:wake.schedule`,
      createdAt: now,
    });

    return {
      content: [
        {
          type: "text",
          text: `Wake confirmed scheduled (id=${wake.id}) for ${formatShanghaiLocalTime(wake.plannedAt)} ${wake.timezone}.`,
        },
      ],
      details: { wake },
    };
  },
};

const cancelParams = Type.Object({
  wake_id: Type.String({ description: "The wake identifier to cancel" }),
});

export const wakeCancelTool: AgentTool<typeof cancelParams> = {
  name: "wake__cancel",
  label: "Cancel wake",
  description: "Cancel a scheduled wake when the user no longer wants it or the tracked matter is resolved.",
  parameters: cancelParams,
  execute: async (callId, params) => {
    localWakeRepository.cancel({
      principalId: localPrincipalId,
      wakeId: params.wake_id,
      idempotencyKey: `tool:${callId}:wake.cancel`,
      cancelledAt: Date.now(),
    });

    return {
      content: [{ type: "text", text: `Wake cancellation confirmed for id=${params.wake_id}.` }],
      details: { wakeId: params.wake_id },
    };
  },
};

const listParams = Type.Object({});

export const wakeListTool: AgentTool<typeof listParams> = {
  name: "wake__list",
  label: "List wakes",
  description: "List active scheduled wakes so you can inspect or cancel them.",
  parameters: listParams,
  execute: async () => {
    const wakes = localWakeRepository.listActive({ principalId: localPrincipalId });
    const text = wakes.length === 0 ? "No active wakes." : wakes.map((wake) => `[id=${wake.id}] ${wake.intentContext}`).join("\n");

    return {
      content: [{ type: "text", text }],
      details: { wakes },
    };
  },
};
