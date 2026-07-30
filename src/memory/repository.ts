import type { DatabaseSync } from "node:sqlite";

export type EpistemicType = "user_statement" | "agent_inference" | "user_decision" | "system_observation";

export interface MemoryEntry {
  id: string;
  principalId: string;
  version: number;
  content: string;
  source: string;
  epistemicType: EpistemicType;
  tags: string[];
  createdAt: number;
}

export interface RememberMemoryInput {
  principalId: string;
  content: string;
  source: string;
  epistemicType: EpistemicType;
  tags: string[];
  idempotencyKey: string;
  createdAt: number;
}

export interface SearchMemoriesInput {
  principalId: string;
  query: string;
  tags?: string[];
}

export interface ReviseMemoryInput {
  principalId: string;
  memoryId: string;
  expectedVersion: number;
  content: string;
  source: string;
  epistemicType: EpistemicType;
  tags: string[];
  idempotencyKey: string;
  createdAt: number;
}

export class MemoryRevisionConflictError extends Error {
  constructor() {
    super("Memory was changed by another operation.");
    this.name = "MemoryRevisionConflictError";
  }
}

interface MemoryRow {
  id: string;
  principal_id: string;
  current_version: number;
  content: string;
  source: string;
  epistemic_type: EpistemicType;
  tags_json: string;
  created_at: number;
}

function rowToMemory(row: MemoryRow): MemoryEntry {
  return {
    id: row.id,
    principalId: row.principal_id,
    version: row.current_version,
    content: row.content,
    source: row.source,
    epistemicType: row.epistemic_type,
    tags: JSON.parse(row.tags_json) as string[],
    createdAt: row.created_at,
  };
}

export class SqliteMemoryRepository {
  constructor(private readonly connection: DatabaseSync) {}

  remember(input: RememberMemoryInput): MemoryEntry {
    const existing = this.connection
      .prepare("SELECT * FROM memories WHERE idempotency_key = ?")
      .get(input.idempotencyKey) as MemoryRow | undefined;

    if (existing) {
      return rowToMemory(existing);
    }

    const id = crypto.randomUUID();
    this.connection
      .prepare(
        `INSERT INTO memories (
          id, principal_id, current_version, content, source, epistemic_type, tags_json, idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.principalId,
        1,
        input.content,
        input.source,
        input.epistemicType,
        JSON.stringify(input.tags),
        input.idempotencyKey,
        input.createdAt
      );
    this.connection
      .prepare(
        `INSERT INTO memory_versions (
          memory_id, version, content, source, epistemic_type, tags_json, idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        1,
        input.content,
        input.source,
        input.epistemicType,
        JSON.stringify(input.tags),
        input.idempotencyKey,
        input.createdAt
      );

    return {
      id,
      principalId: input.principalId,
      version: 1,
      content: input.content,
      source: input.source,
      epistemicType: input.epistemicType,
      tags: input.tags,
      createdAt: input.createdAt,
    };
  }

  read(input: { principalId: string; memoryId: string }): MemoryEntry | undefined {
    const row = this.connection
      .prepare("SELECT * FROM memories WHERE id = ? AND principal_id = ?")
      .get(input.memoryId, input.principalId) as MemoryRow | undefined;

    return row ? rowToMemory(row) : undefined;
  }

  forget(input: { principalId: string; memoryId: string }): boolean {
    this.connection.exec("BEGIN");

    try {
      const deleted = this.connection
        .prepare("DELETE FROM memories WHERE id = ? AND principal_id = ?")
        .run(input.memoryId, input.principalId);

      if (deleted.changes === 1) {
        this.connection
          .prepare(
            `UPDATE wake_intents
             SET state = 'cancelled', cancelled_at = ?
             WHERE id IN (SELECT wake_id FROM wake_memory_links WHERE memory_id = ?)
               AND state = 'active'`
          )
          .run(Date.now(), input.memoryId);
        this.connection.prepare("DELETE FROM wake_memory_links WHERE memory_id = ?").run(input.memoryId);
        this.connection.prepare("DELETE FROM memory_versions WHERE memory_id = ?").run(input.memoryId);
      }

      this.connection.exec("COMMIT");
      return deleted.changes === 1;
    } catch (error: unknown) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }

  revise(input: ReviseMemoryInput): MemoryEntry {
    const existing = this.connection
      .prepare("SELECT * FROM memories WHERE idempotency_key = ?")
      .get(input.idempotencyKey) as MemoryRow | undefined;

    if (existing) {
      return rowToMemory(existing);
    }

    const nextVersion = input.expectedVersion + 1;
    const updated = this.connection
      .prepare(
        `UPDATE memories
         SET current_version = ?, content = ?, source = ?, epistemic_type = ?, tags_json = ?, idempotency_key = ?, created_at = ?
         WHERE id = ? AND principal_id = ? AND current_version = ?`
      )
      .run(
        nextVersion,
        input.content,
        input.source,
        input.epistemicType,
        JSON.stringify(input.tags),
        input.idempotencyKey,
        input.createdAt,
        input.memoryId,
        input.principalId,
        input.expectedVersion
      );

    if (updated.changes !== 1) {
      throw new MemoryRevisionConflictError();
    }

    this.connection
      .prepare(
        `INSERT INTO memory_versions (
          memory_id, version, content, source, epistemic_type, tags_json, idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.memoryId,
        nextVersion,
        input.content,
        input.source,
        input.epistemicType,
        JSON.stringify(input.tags),
        input.idempotencyKey,
        input.createdAt
      );

    return {
      id: input.memoryId,
      principalId: input.principalId,
      version: nextVersion,
      content: input.content,
      source: input.source,
      epistemicType: input.epistemicType,
      tags: input.tags,
      createdAt: input.createdAt,
    };
  }

  search(input: SearchMemoriesInput): MemoryEntry[] {
    const like = `%${input.query}%`;
    const hasTags = Boolean(input.tags?.length);
    const rows = this.connection
      .prepare(
        `SELECT * FROM memories
         WHERE principal_id = ?
           AND (LOWER(content) LIKE LOWER(?) OR LOWER(source) LIKE LOWER(?))
           ${hasTags ? "AND EXISTS (SELECT 1 FROM json_each(tags_json) tag, json_each(?) requested WHERE tag.value = requested.value)" : ""}
         ORDER BY created_at DESC`
      )
      .all(...(hasTags ? [input.principalId, like, like, JSON.stringify(input.tags)] : [input.principalId, like, like])) as unknown as MemoryRow[];

    return rows.map(rowToMemory);
  }
}
