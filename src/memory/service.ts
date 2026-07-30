import { newId } from "../persistence/id.js";
import type { SqliteMemoryRepository } from "./repository.js";

export interface ForgetConfirmationRequest {
  principalId: string;
  memoryId: string;
  expiresAt: number;
}

export interface ForgetMemoryRequest {
  principalId: string;
  memoryId: string;
  confirmationToken: string;
}

export class MemoryConfirmationRequiredError extends Error {
  constructor() {
    super("A valid one-time confirmation is required to forget this memory.");
    this.name = "MemoryConfirmationRequiredError";
  }
}

export class MemoryService {
  private readonly confirmations = new Map<string, ForgetConfirmationRequest>();

  constructor(private readonly repository: SqliteMemoryRepository) {}

  createForgetConfirmation(request: ForgetConfirmationRequest): { token: string } {
    const token = newId();
    this.confirmations.set(token, {
      principalId: request.principalId,
      memoryId: request.memoryId,
      expiresAt: request.expiresAt,
    });
    return { token };
  }

  forget(request: ForgetMemoryRequest): void {
    const confirmation = this.confirmations.get(request.confirmationToken);
    this.confirmations.delete(request.confirmationToken);

    if (
      !confirmation ||
      confirmation.expiresAt < Date.now() ||
      confirmation.principalId !== request.principalId ||
      confirmation.memoryId !== request.memoryId
    ) {
      throw new MemoryConfirmationRequiredError();
    }

    this.repository.forget({ principalId: request.principalId, memoryId: request.memoryId });
  }
}
