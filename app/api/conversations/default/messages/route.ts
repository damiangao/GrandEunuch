import { NextRequest } from "next/server";
import { readTimeline } from "../../../../../src/conversation/timeline";
import { createLocalAgentRuntime } from "../../../../../src/runtime/agent-runtime";
import {
  localConversationId,
  localConversationRepository,
  localPrincipalId,
  localWakeRepository,
} from "../../../../../src/runtime/local-runtime";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<Response> {
  const body = (await request.json()) as { message?: unknown };
  if (typeof body.message !== "string" || body.message.trim().length === 0) {
    return Response.json({ error: "消息不能为空。" }, { status: 400 });
  }

  const message = body.message.trim();

  // Read the transcript before appending: this message is passed separately, and
  // including it twice would show the Agent a duplicated final turn.
  const history = readTimeline({
    conversations: localConversationRepository,
    wakes: localWakeRepository,
    principalId: localPrincipalId,
    conversationId: localConversationId,
  });
  localConversationRepository.append({ conversationId: localConversationId, role: "user", content: message, createdAt: Date.now() });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller): Promise<void> {
      try {
        const response = await createLocalAgentRuntime(history).respond(message, (delta) => controller.enqueue(encoder.encode(delta)));
        localConversationRepository.append({ conversationId: localConversationId, role: "assistant", content: response, createdAt: Date.now() });
        controller.close();
      } catch (error: unknown) {
        controller.error(error instanceof Error ? error : new Error("Agent 运行失败。"));
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
