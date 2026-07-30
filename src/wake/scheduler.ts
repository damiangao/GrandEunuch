import type { SqliteWakeRepository, WakeOccurrence } from "./repository.js";

export interface WakeScheduler {
  scan(now: number): WakeOccurrence[];
}

export class LocalWakeScheduler implements WakeScheduler {
  constructor(private readonly repository: SqliteWakeRepository) {}

  scan(now: number): WakeOccurrence[] {
    return this.repository.claimDueOccurrences({ now });
  }
}
