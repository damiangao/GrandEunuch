import { newId } from "../persistence/id.js";
import type { DatabaseSync } from "node:sqlite";

export interface WakeIntent {
  id: string;
  principalId: string;
  conversationId: string;
  generation: number;
  plannedAt: number;
  timezone: string;
  intentContext: string;
}

export interface WakeOccurrence {
  id: string;
  wakeId: string;
  generation: number;
  plannedAt: number;
}

export interface VisibleEffect {
  id: string;
  content: string;
  committedAt: number;
}

interface ScheduleWakeInput {
  principalId: string;
  conversationId: string;
  plannedAt: number;
  timezone: string;
  intentContext: string;
  idempotencyKey: string;
  createdAt: number;
}

/** What the Agent decided this occurrence should produce. The Runtime only transports it. */
export type OccurrenceDecision = { kind: "reminder"; content: string } | { kind: "silent" };

export type OccurrenceResolution =
  | { state: "effect"; effectId: string }
  | { state: "silent" }
  | { state: "blocked" };

interface ResolveOccurrenceInput {
  occurrenceId: string;
  wakeId: string;
  generation: number;
  runId: string;
  decision: OccurrenceDecision;
  committedAt: number;
}

export class SqliteWakeRepository {
  constructor(private readonly connection: DatabaseSync) {}

  schedule(input: ScheduleWakeInput): WakeIntent {
    const existing = this.connection
      .prepare("SELECT * FROM wake_intents WHERE idempotency_key = ?")
      .get(input.idempotencyKey) as WakeIntentRow | undefined;

    if (existing) {
      return rowToWakeIntent(existing);
    }

    const wake: WakeIntent = {
      id: newId(),
      principalId: input.principalId,
      conversationId: input.conversationId,
      generation: 1,
      plannedAt: input.plannedAt,
      timezone: input.timezone,
      intentContext: input.intentContext,
    };
    this.connection
      .prepare(
        `INSERT INTO wake_intents (
          id, principal_id, conversation_id, state, generation, planned_at, timezone, intent_context, idempotency_key, created_at
        ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`
      )
      .run(
        wake.id,
        wake.principalId,
        wake.conversationId,
        wake.generation,
        wake.plannedAt,
        wake.timezone,
        wake.intentContext,
        input.idempotencyKey,
        input.createdAt
      );

    return wake;
  }

  listActive(input: { principalId: string }): WakeIntent[] {
    const rows = this.connection
      .prepare("SELECT * FROM wake_intents WHERE principal_id = ? AND state = 'active' ORDER BY planned_at ASC")
      .all(input.principalId) as unknown as WakeIntentRow[];

    return rows.map(rowToWakeIntent);
  }

  claimDueOccurrences(input: { now: number }): WakeOccurrence[] {
    const wakes = this.connection
      .prepare("SELECT id, generation, planned_at FROM wake_intents WHERE state = 'active' AND planned_at <= ?")
      .all(input.now) as unknown as Array<{ id: string; generation: number; planned_at: number }>;

    return wakes.map((wake) =>
      this.claimOccurrence({ wakeId: wake.id, plannedAt: wake.planned_at, claimedAt: input.now })
    );
  }

  claimOccurrence(input: { wakeId: string; plannedAt: number; claimedAt: number }): WakeOccurrence {
    const wake = this.connection
      .prepare("SELECT generation FROM wake_intents WHERE id = ?")
      .get(input.wakeId) as { generation: number } | undefined;

    if (!wake) {
      throw new Error("Wake was not found.");
    }

    const existing = this.connection
      .prepare("SELECT * FROM wake_occurrences WHERE wake_id = ? AND generation = ? AND planned_at = ?")
      .get(input.wakeId, wake.generation, input.plannedAt) as WakeOccurrenceRow | undefined;

    if (existing) {
      return rowToOccurrence(existing);
    }

    const occurrence: WakeOccurrence = {
      id: newId(),
      wakeId: input.wakeId,
      generation: wake.generation,
      plannedAt: input.plannedAt,
    };
    this.connection
      .prepare("INSERT INTO wake_occurrences (id, wake_id, generation, planned_at, claimed_at) VALUES (?, ?, ?, ?, ?)")
      .run(occurrence.id, occurrence.wakeId, occurrence.generation, occurrence.plannedAt, input.claimedAt);

    return occurrence;
  }

  cancel(input: { principalId: string; wakeId: string; idempotencyKey: string; cancelledAt: number }): void {
    this.connection
      .prepare(
        `UPDATE wake_intents
         SET state = 'cancelled', cancelled_at = ?
         WHERE id = ? AND principal_id = ? AND state = 'active'`
      )
      .run(input.cancelledAt, input.wakeId, input.principalId);
  }

  resolveOccurrence(input: ResolveOccurrenceInput): OccurrenceResolution {
    this.connection.exec("BEGIN");

    try {
      const resolution = this.connection
        .prepare("SELECT state, effect_id FROM occurrence_resolutions WHERE occurrence_id = ?")
        .get(input.occurrenceId) as { state: "effect" | "silent"; effect_id: string | null } | undefined;
      if (resolution) {
        this.connection.exec("COMMIT");
        if (resolution.state === "silent") return { state: "silent" };
        return resolution.effect_id ? { state: "effect", effectId: resolution.effect_id } : { state: "blocked" };
      }

      const wake = this.connection
        .prepare(
          `SELECT principal_id, conversation_id FROM wake_intents
           WHERE id = ? AND state = 'active' AND generation = ?`
        )
        .get(input.wakeId, input.generation) as { principal_id: string; conversation_id: string } | undefined;
      if (!wake) {
        this.connection.exec("COMMIT");
        return { state: "blocked" };
      }

      if (input.decision.kind === "silent") {
        this.connection
          .prepare(
            `INSERT INTO occurrence_resolutions (
              occurrence_id, wake_id, generation, run_id, state, effect_id, committed_at
            ) VALUES (?, ?, ?, ?, 'silent', NULL, ?)`
          )
          .run(input.occurrenceId, input.wakeId, input.generation, input.runId, input.committedAt);
        this.markFired(input.wakeId, input.generation, input.committedAt);
        this.connection.exec("COMMIT");
        return { state: "silent" };
      }

      const effectId = newId();
      this.connection
        .prepare(
          `INSERT INTO visible_effects (
            id, principal_id, conversation_id, occurrence_id, run_id, kind, content, committed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          effectId,
          wake.principal_id,
          wake.conversation_id,
          input.occurrenceId,
          input.runId,
          input.decision.kind,
          input.decision.content,
          input.committedAt
        );
      this.connection
        .prepare(
          `INSERT INTO occurrence_resolutions (
            occurrence_id, wake_id, generation, run_id, state, effect_id, committed_at
          ) VALUES (?, ?, ?, ?, 'effect', ?, ?)`
        )
        .run(input.occurrenceId, input.wakeId, input.generation, input.runId, effectId, input.committedAt);
      this.markFired(input.wakeId, input.generation, input.committedAt);
      this.connection.exec("COMMIT");

      return { state: "effect", effectId };
    } catch (error: unknown) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * Retires a wake whose occurrence just produced its one allowed resolution, so
   * it stops being reported as active and stops being re-claimed by scans.
   * Must run inside the resolveOccurrence transaction.
   */
  private markFired(wakeId: string, generation: number, firedAt: number): void {
    this.connection
      .prepare(
        `UPDATE wake_intents
         SET state = 'fired', fired_at = ?
         WHERE id = ? AND generation = ? AND state = 'active'`
      )
      .run(firedAt, wakeId, generation);
  }

  findById(wakeId: string): WakeIntent | undefined {
    const row = this.connection
      .prepare("SELECT * FROM wake_intents WHERE id = ?")
      .get(wakeId) as WakeIntentRow | undefined;
    return row ? rowToWakeIntent(row) : undefined;
  }

  isResolved(occurrenceId: string): boolean {
    const resolution = this.connection
      .prepare("SELECT occurrence_id FROM occurrence_resolutions WHERE occurrence_id = ?")
      .get(occurrenceId);
    return resolution !== undefined;
  }

  listVisibleEffects(input: { principalId: string; conversationId: string }): VisibleEffect[] {
    // The kind column is still written for audit, but the read model has no use
    // for it while 'reminder' is the only effect kind.
    const rows = this.connection
      .prepare(
        `SELECT id, content, committed_at FROM visible_effects
         WHERE principal_id = ? AND conversation_id = ?
         ORDER BY committed_at ASC`
      )
      .all(input.principalId, input.conversationId) as unknown as VisibleEffectRow[];

    return rows.map(rowToVisibleEffect);
  }
}

interface WakeIntentRow {
  id: string;
  principal_id: string;
  conversation_id: string;
  generation: number;
  planned_at: number;
  timezone: string;
  intent_context: string;
}

interface VisibleEffectRow {
  id: string;
  content: string;
  committed_at: number;
}

interface WakeOccurrenceRow {
  id: string;
  wake_id: string;
  generation: number;
  planned_at: number;
}

function rowToWakeIntent(row: WakeIntentRow): WakeIntent {
  return {
    id: row.id,
    principalId: row.principal_id,
    conversationId: row.conversation_id,
    generation: row.generation,
    plannedAt: row.planned_at,
    timezone: row.timezone,
    intentContext: row.intent_context,
  };
}

function rowToVisibleEffect(row: VisibleEffectRow): VisibleEffect {
  return { id: row.id, content: row.content, committedAt: row.committed_at };
}

function rowToOccurrence(row: WakeOccurrenceRow): WakeOccurrence {
  return {
    id: row.id,
    wakeId: row.wake_id,
    generation: row.generation,
    plannedAt: row.planned_at,
  };
}
