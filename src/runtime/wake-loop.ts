import { localWakeRepository, localWakeScheduler } from "./local-runtime.js";
import { createAgentWakeReassessor } from "../wake/agent-reassessor.js";
import { WakeRunner } from "../wake/runner.js";

const POLL_INTERVAL_MS = 30_000;

let started = false;

/**
 * Starts the local wake loop: one scan at startup (so wakes that came due while
 * the service was down are processed exactly once) plus periodic polling.
 */
export function startLocalWakeLoop(): void {
  if (started) return;
  started = true;

  const runner = new WakeRunner(localWakeRepository, localWakeScheduler, createAgentWakeReassessor());
  const tick = (): void => {
    void runner.processDue(Date.now()).catch((error: unknown) => {
      console.error("[wake] scan failed:", error);
    });
  };

  tick();
  setInterval(tick, POLL_INTERVAL_MS).unref();
}
