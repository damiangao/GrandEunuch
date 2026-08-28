import type { OccurrenceDecision, SqliteWakeRepository } from "./repository.js";
import type { WakeScheduler } from "./scheduler.js";
import type { RunTraces } from "../runtime/run-traces.js";

/** The reliable Trigger facts a scheduled_wake Run is started from. */
export interface WakeRunContext {
  runId: string;
  wakeId: string;
  occurrenceId: string;
  generation: number;
  plannedAt: number;
  arrivedAt: number;
  timezone: string;
  intentContext: string;
}

/**
 * The judgment half of a scheduled_wake Run. The Runtime only transports the
 * decision to the internal atomic boundary — it never decides for the Agent.
 */
export interface WakeRunAgent {
  reassess(context: WakeRunContext): Promise<OccurrenceDecision>;
}

export class WakeRunner {
  constructor(
    private readonly repository: SqliteWakeRepository,
    private readonly scheduler: WakeScheduler,
    private readonly agent: WakeRunAgent,
    private readonly traces?: RunTraces
  ) {}

  async processDue(now: number): Promise<void> {
    for (const occurrence of this.scheduler.scan(now)) {
      if (this.repository.isResolved(occurrence.id)) continue;

      const wake = this.repository.findById(occurrence.wakeId);
      if (!wake) continue;

      const context: WakeRunContext = {
        runId: globalThis.crypto.randomUUID(),
        wakeId: occurrence.wakeId,
        occurrenceId: occurrence.id,
        generation: occurrence.generation,
        plannedAt: occurrence.plannedAt,
        arrivedAt: now,
        timezone: wake.timezone,
        intentContext: wake.intentContext,
      };

      const traceRunId = this.traces ? this.traces.start("scheduled_wake", context.occurrenceId) : undefined;
      try {
        const decision = await this.agent.reassess(context);
        const resolution = this.repository.resolveOccurrence({
          occurrenceId: context.occurrenceId,
          wakeId: context.wakeId,
          generation: context.generation,
          runId: context.runId,
          decision,
          committedAt: Date.now(),
        });
        if (traceRunId && this.traces) {
          this.traces.finish(traceRunId, {
            stopState: resolution.state,
            finalOutput: decision.kind === "reminder" ? decision.content : undefined,
            contextAssembled: JSON.stringify(context),
          });
        }
      } catch (error: unknown) {
        // A failed reassessment leaves the occurrence unresolved so a later scan
        // can retry it. Never fabricate a decision on the Agent's behalf.
        if (traceRunId && this.traces) {
          this.traces.finish(traceRunId, { stopState: "runtime_failure", contextAssembled: JSON.stringify(context) });
        }
        console.error(`[wake] reassessment failed for occurrence ${context.occurrenceId}:`, error);
      }
    }
  }
}
