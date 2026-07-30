import { describe, expect, it } from "vitest";
import { createDatabase } from "./sqlite.ts";

describe("SQLite database", () => {
  it("can run migrations more than once without losing persisted data", () => {
    const database = createDatabase(":memory:");

    database.runMigrations();
    database.connection.prepare("INSERT INTO principals (id, timezone, created_at) VALUES (?, ?, ?)").run(
      "local-owner",
      "Asia/Shanghai",
      1
    );
    database.runMigrations();

    const principal = database.connection
      .prepare("SELECT id, timezone FROM principals WHERE id = ?")
      .get("local-owner") as { id: string; timezone: string } | undefined;

    expect(principal).toEqual({ id: "local-owner", timezone: "Asia/Shanghai" });
  });

  it("keeps separate in-memory databases isolated", () => {
    const first = createDatabase(":memory:");
    const second = createDatabase(":memory:");

    first.runMigrations();
    second.runMigrations();
    first.connection.prepare("INSERT INTO principals (id, timezone, created_at) VALUES (?, ?, ?)").run(
      "first-owner",
      "Asia/Shanghai",
      1
    );

    const principal = second.connection.prepare("SELECT id FROM principals WHERE id = ?").get("first-owner");

    expect(principal).toBeUndefined();
  });

  it("restores a migration table missing from an otherwise recorded schema", () => {
    const database = createDatabase(":memory:");
    database.runMigrations();
    database.connection.exec("DROP TABLE memories");

    database.runMigrations();

    const memoryTable = database.connection
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memories'")
      .get();

    expect(memoryTable).toBeDefined();
  });
});
