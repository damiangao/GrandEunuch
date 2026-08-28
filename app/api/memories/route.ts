import { localMemoryRepository, localPrincipalId } from "../../../src/runtime/local-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only view of the memory store for the /memory page. All mutations stay
 * in the Agent's hands — this route only serves what is already persisted.
 */
export async function GET(): Promise<Response> {
  const memories = localMemoryRepository.search({ principalId: localPrincipalId, query: "" });
  return Response.json({ memories });
}
