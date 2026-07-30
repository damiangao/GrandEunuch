import { createDatabase } from "../persistence/sqlite.js";
import { SqliteMemoryRepository } from "../memory/repository.js";
import { MemoryService } from "../memory/service.js";
import { SqliteWakeRepository } from "../wake/repository.js";
import { SqliteConversationRepository } from "../conversation/repository.js";
import { LocalWakeScheduler } from "../wake/scheduler.js";

const database = createDatabase(process.env.DB_PATH ?? "./data/kokanee.sqlite");
database.runMigrations();

export const localMemoryRepository = new SqliteMemoryRepository(database.connection);
export const localMemoryService = new MemoryService(localMemoryRepository);
export const localWakeRepository = new SqliteWakeRepository(database.connection);
export const localConversationRepository = new SqliteConversationRepository(database.connection);
export const localConversationId = localConversationRepository.ensureDefaultConversation("local-owner", Date.now());
export const localWakeScheduler = new LocalWakeScheduler(localWakeRepository);
export const localPrincipalId = "local-owner";
