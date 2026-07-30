import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type EpistemicType = "user_statement" | "agent_inference" | "user_decision" | "system_observation";

export interface MemoryEntry {
  id: string;
  content: string;
  source: string;
  epistemicType: EpistemicType;
  tags: string[];
  createdAt: number;
}

const dbPath = process.env.DB_PATH ?? "./data/kokanee.sqlite";
if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    source TEXT NOT NULL,
    epistemic_type TEXT NOT NULL,
    tags TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`);

interface MemoryRow {
  id: number;
  content: string;
  source: string;
  epistemic_type: EpistemicType;
  tags: string;
  created_at: number;
}

function rowToEntry(row: MemoryRow): MemoryEntry {
  return {
    id: String(row.id),
    content: row.content,
    source: row.source,
    epistemicType: row.epistemic_type,
    tags: JSON.parse(row.tags),
    createdAt: row.created_at,
  };
}

export function remember(entry: Omit<MemoryEntry, "id" | "createdAt">): MemoryEntry {
  const createdAt = Date.now();
  const result = db
    .prepare("INSERT INTO memories (content, source, epistemic_type, tags, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(entry.content, entry.source, entry.epistemicType, JSON.stringify(entry.tags), createdAt);
  return { ...entry, id: String(result.lastInsertRowid), createdAt };
}

export function search(query: string, tags?: string[]): MemoryEntry[] {
  const like = `%${query}%`;
  const hasTags = Boolean(tags?.length);
  const rows = db
    .prepare(
      `SELECT * FROM memories
       WHERE (LOWER(content) LIKE LOWER(?) OR LOWER(source) LIKE LOWER(?))
       ${hasTags ? "AND EXISTS (SELECT 1 FROM json_each(tags) t, json_each(?) qt WHERE t.value = qt.value)" : ""}
       ORDER BY created_at DESC`
    )
    .all(...(hasTags ? [like, like, JSON.stringify(tags)] : [like, like])) as unknown as MemoryRow[];
  return rows.map(rowToEntry);
}
