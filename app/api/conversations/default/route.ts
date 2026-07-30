import { readTimeline } from "../../../../src/conversation/timeline";
import {
  localConversationId,
  localConversationRepository,
  localPrincipalId,
  localWakeRepository,
} from "../../../../src/runtime/local-runtime";
import { startLocalWakeLoop } from "../../../../src/runtime/wake-loop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  startLocalWakeLoop();

  const messages = readTimeline({
    conversations: localConversationRepository,
    wakes: localWakeRepository,
    principalId: localPrincipalId,
    conversationId: localConversationId,
  });

  return Response.json({ messages });
}
