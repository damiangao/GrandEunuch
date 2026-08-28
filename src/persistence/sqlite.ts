import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncConnection } from "node:sqlite";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

export interface KokaneeDatabase {
  connection: DatabaseSyncConnection;
  runMigrations(): void;
}

const migrations = [
  `
    CREATE TABLE IF NOT EXISTS principals (
      id TEXT PRIMARY KEY,
      timezone TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `,
  `
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      principal_id TEXT NOT NULL,
      current_version INTEGER NOT NULL,
      content TEXT NOT NULL,
      source TEXT NOT NULL,
      epistemic_type TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_versions (
      memory_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      content TEXT NOT NULL,
      source TEXT NOT NULL,
      epistemic_type TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (memory_id, version)
    );

    CREATE INDEX IF NOT EXISTS memories_principal_created_at
      ON memories (principal_id, created_at DESC);
  `,
  `
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      principal_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversation_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS conversation_messages_by_conversation
      ON conversation_messages (conversation_id, created_at ASC);
  `,
  `
    CREATE TABLE IF NOT EXISTS wake_intents (
      id TEXT PRIMARY KEY,
      principal_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      state TEXT NOT NULL,
      generation INTEGER NOT NULL,
      planned_at INTEGER NOT NULL,
      timezone TEXT NOT NULL,
      intent_context TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      cancelled_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS wake_memory_links (
      wake_id TEXT NOT NULL,
      memory_id TEXT NOT NULL,
      PRIMARY KEY (wake_id, memory_id)
    );

    CREATE TABLE IF NOT EXISTS wake_occurrences (
      id TEXT PRIMARY KEY,
      wake_id TEXT NOT NULL,
      generation INTEGER NOT NULL,
      planned_at INTEGER NOT NULL,
      claimed_at INTEGER NOT NULL,
      UNIQUE (wake_id, generation, planned_at)
    );

    CREATE TABLE IF NOT EXISTS occurrence_resolutions (
      occurrence_id TEXT PRIMARY KEY,
      wake_id TEXT NOT NULL,
      generation INTEGER NOT NULL,
      run_id TEXT NOT NULL,
      state TEXT NOT NULL,
      effect_id TEXT,
      committed_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS visible_effects (
      id TEXT PRIMARY KEY,
      principal_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      occurrence_id TEXT UNIQUE,
      run_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      committed_at INTEGER NOT NULL
    );
  `,
  `
    CREATE TABLE IF NOT EXISTS run_traces (
      run_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      trigger_ref TEXT,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      stop_state TEXT,
      final_output TEXT,
      context_assembled TEXT,
      tool_calls TEXT
    );

    CREATE INDEX IF NOT EXISTS run_traces_started_at
      ON run_traces (started_at DESC);
  `,
  `
    CREATE TABLE IF NOT EXISTS forgotten_strings (
      content TEXT PRIMARY KEY,
      forgotten_at INTEGER NOT NULL
    );
  `,
];

/**
 * Column additions that must be applied idempotently. SQLite has no
 * "ADD COLUMN IF NOT EXISTS", and the migrations above are re-executed on every
 * boot to self-heal dropped tables, so ALTER TABLE cannot live in that list.
 */
const columnAdditions = [
  { table: "wake_intents", column: "fired_at", definition: "INTEGER" },
];

/**
 * Scrub every string a memory__forget has committed. Applied at write time to
 * Runtime-generated texts (assistant replies, reminder effects) so content
 * forgotten mid-run cannot leak back in through later messages.
 */
export function scrubForgottenStrings(connection: DatabaseSyncConnection, text: string): string {
  const rows = connection.prepare("SELECT content FROM forgotten_strings").all() as unknown as Array<{ content: string }>;
  let scrubbed = text;
  for (const row of rows) {
    scrubbed = scrubbed.split(row.content).join("[已遗忘]");
  }
  return scrubbed;
}

export function createDatabase(path: string): KokaneeDatabase {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const connection = new DatabaseSync(path);
  // Wait instead of failing when another live connection (wake loop, build-time
  // module evaluation, maintenance scripts) holds the write lock briefly.
  connection.exec("PRAGMA busy_timeout = 5000;");

  return {
    connection,
    runMigrations(): void {
      connection.exec("BEGIN");

      try {
        connection.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY);");

        migrations.forEach((migration, index) => {
          const version = index + 1;
          const applied = connection
            .prepare("SELECT version FROM schema_migrations WHERE version = ?")
            .get(version);

          if (!applied) {
            connection.exec(migration);
            connection.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(version);
          } else {
            connection.exec(migration);
          }
        });

        columnAdditions.forEach(({ table, column, definition }) => {
          const columns = connection.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>;
          if (!columns.some((existing) => existing.name === column)) {
            connection.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
          }
        });
        connection.exec("COMMIT");
      } catch (error: unknown) {
        connection.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
