import type { DatabaseSync } from "node:sqlite";
import { newId } from "../persistence/id.js";

/**
 * Per-run observability sink: the audit copy the spec demands (§12.3) and the
 * forensic record the two-week experiment replays against. Append-only; written
 * from the agent-runtime and wake-runner subscribe/instrumentation points.
 *
 * run_traces participates in forgetting: memory.forget scrubs matching content
 * and memory ids from context_assembled / tool_calls / final_output (§4.1).
 */
export interface RunTraceFinish {
  stopState: string;
  finalOutput?: string;
  contextAssembled?: string;
  toolCalls?: string;
}

export interface RunTraces {
  start(kind: "user_message" | "scheduled_wake", triggerRef: string): string;
  finish(runId: string, finish: RunTraceFinish): void;
}

export function createRunTraces(connection: DatabaseSync): RunTraces {
  return {
    start(kind, triggerRef) {
      const runId = newId();
      connection
        .prepare("INSERT INTO run_traces (run_id, kind, trigger_ref, started_at) VALUES (?, ?, ?, ?)")
        .run(runId, kind, triggerRef, Date.now());
      return runId;
    },
    finish(runId, input) {
      connection
        .prepare(
          `UPDATE run_traces
           SET finished_at = ?, stop_state = ?, final_output = ?, context_assembled = ?, tool_calls = ?
           WHERE run_id = ?`
        )
        .run(
          Date.now(),
          input.stopState,
          input.finalOutput ?? null,
          input.contextAssembled ?? null,
          input.toolCalls ?? null,
          runId
        );
    },
  };
}
