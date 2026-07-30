import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { localMemoryRepository, localMemoryService } from "../runtime/local-runtime.js";

const localPrincipalId = "local-owner";
const epistemicTypeParams = Type.Union([
  Type.Literal("user_statement"),
  Type.Literal("agent_inference"),
  Type.Literal("user_decision"),
  Type.Literal("system_observation"),
]);

const rememberParams = Type.Object({
  content: Type.String({ description: "What to remember" }),
  source: Type.String({ description: "Where this came from" }),
  epistemic_type: epistemicTypeParams,
  tags: Type.Array(Type.String(), { description: "Free-form labels" }),
});

export const memoryRememberTool: AgentTool<typeof rememberParams> = {
  name: "memory__remember",
  label: "Save memory",
  description: "Save information worth recovering across future runs, keeping its source and epistemic type.",
  parameters: rememberParams,
  execute: async (callId, params) => {
    const memory = localMemoryRepository.remember({
      principalId: localPrincipalId,
      content: params.content,
      source: params.source,
      epistemicType: params.epistemic_type,
      tags: params.tags,
      idempotencyKey: `tool:${callId}:memory.remember`,
      createdAt: Date.now(),
    });
    return { content: [{ type: "text", text: `Memory save confirmed (id=${memory.id}).` }], details: { memory } };
  },
};

const searchParams = Type.Object({
  query: Type.String({ description: "Keyword to search for in memory content and source" }),
  tags: Type.Optional(Type.Array(Type.String(), { description: "Filter by any matching tag" })),
});

export const memorySearchTool: AgentTool<typeof searchParams> = {
  name: "memory__search",
  label: "Search memory",
  description: "Search saved memories by keyword and optional tags. Empty results are valid; do not fabricate content.",
  parameters: searchParams,
  execute: async (_callId, params) => {
    const memories = localMemoryRepository.search({ principalId: localPrincipalId, query: params.query, tags: params.tags });
    const text = memories.length === 0
      ? "No matching memories found."
      : memories.map((memory) => `[id=${memory.id} version=${memory.version} type=${memory.epistemicType} tags=${memory.tags.join(",")}] ${memory.content} (source: ${memory.source})`).join("\n");
    return { content: [{ type: "text", text }], details: { count: memories.length, memories } };
  },
};

const readParams = Type.Object({ memory_id: Type.String({ description: "The memory identifier to read" }) });

export const memoryReadTool: AgentTool<typeof readParams> = {
  name: "memory__read",
  label: "Read memory",
  description: "Read one saved memory after search returns a relevant identifier.",
  parameters: readParams,
  execute: async (_callId, params) => {
    const memory = localMemoryRepository.read({ principalId: localPrincipalId, memoryId: params.memory_id });
    const text = memory
      ? `[id=${memory.id} version=${memory.version} type=${memory.epistemicType} tags=${memory.tags.join(",")}] ${memory.content} (source: ${memory.source})`
      : "Memory was not found or is no longer available.";
    return { content: [{ type: "text", text }], details: { memory } };
  },
};

const reviseParams = Type.Object({
  memory_id: Type.String({ description: "The memory identifier to revise" }),
  expected_version: Type.Integer({ minimum: 1, description: "The version previously read" }),
  content: Type.String({ description: "Replacement memory content" }),
  source: Type.String({ description: "Where the revised content came from" }),
  epistemic_type: epistemicTypeParams,
  tags: Type.Array(Type.String(), { description: "Replacement open tag set" }),
});

export const memoryReviseTool: AgentTool<typeof reviseParams> = {
  name: "memory__revise",
  label: "Revise memory",
  description: "Revise a saved memory after reading it. Replace tags when an idea becomes a commitment instead of stacking both.",
  parameters: reviseParams,
  execute: async (callId, params) => {
    try {
      const memory = localMemoryRepository.revise({
        principalId: localPrincipalId,
        memoryId: params.memory_id,
        expectedVersion: params.expected_version,
        content: params.content,
        source: params.source,
        epistemicType: params.epistemic_type,
        tags: params.tags,
        idempotencyKey: `tool:${callId}:memory.revise`,
        createdAt: Date.now(),
      });
      return { content: [{ type: "text", text: `Memory revision confirmed (id=${memory.id}, version=${memory.version}).` }], details: { memory } };
    } catch (error: unknown) {
      return { content: [{ type: "text", text: error instanceof Error ? error.message : "Memory revision failed." }], details: {}, isError: true };
    }
  },
};

const forgetParams = Type.Object({
  memory_id: Type.String({ description: "The memory identifier to forget" }),
  confirmation_token: Type.String({ description: "One-time token issued after explicit user confirmation" }),
});

export const memoryForgetTool: AgentTool<typeof forgetParams> = {
  name: "memory__forget",
  label: "Forget memory",
  description: "Permanently forget a memory only after explicit user confirmation and a one-time confirmation token.",
  parameters: forgetParams,
  execute: async (_callId, params) => {
    try {
      localMemoryService.forget({ principalId: localPrincipalId, memoryId: params.memory_id, confirmationToken: params.confirmation_token });
      return { content: [{ type: "text", text: `Memory forget confirmed for id=${params.memory_id}.` }], details: {} };
    } catch (error: unknown) {
      return { content: [{ type: "text", text: error instanceof Error ? error.message : "Memory forget failed." }], details: {}, isError: true };
    }
  },
};
