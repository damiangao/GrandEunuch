/**
 * Eval harness: isolated per-scenario SQLite DB, scoped tool factories, and two
 * wake engines (stub for mechanics, real Agent reassessor for judgment scenarios).
 * Runs against dist/ (plain node); rebuild with `npm run build:runtime` first.
 */
import { createDatabase, type KokaneeDatabase } from "../dist/persistence/sqlite.js";
import { SqliteMemoryRepository } from "../dist/memory/repository.js";
import { MemoryService } from "../dist/memory/service.js";
import { SqliteWakeRepository, type OccurrenceDecision, type VisibleEffect, type WakeIntent } from "../dist/wake/repository.js";
import { SqliteConversationRepository } from "../dist/conversation/repository.js";
import { LocalWakeScheduler } from "../dist/wake/scheduler.js";
import { createRunTraces, type RunTraces } from "../dist/runtime/run-traces.js";
import { createMemoryTools } from "../dist/memory/tools.js";
import { createWakeTools } from "../dist/wake/tools.js";
import { createGrandEunuchAgent } from "../dist/agent/create-agent.js";
import { readTimeline } from "../dist/conversation/timeline.js";
import { toAgentMessages } from "../dist/conversation/transcript.js";
import { getLlmModel } from "../dist/llm/provider.js";
import { buildWakeRunPrompt, toDecision } from "../dist/wake/wake-run-prompt.js";
import type { WakeRunContext } from "../dist/wake/runner.js";
import { newId } from "../dist/persistence/id.js";

export interface ScenarioCheck {
  name: string;
  ok: boolean;
  evidence: string;
}

export interface EvalScenario {
  id: string;
  type: "memory" | "wake" | "product";
  difficulty: 1 | 2 | 3;
  engine: "mechanics" | "agent";
  run(ctx: EvalCtx): Promise<void>;
}

export interface MemoryRow {
  id: string;
  content: string;
  source: string;
  epistemic_type: string;
  tags_json: string;
  current_version: number;
  created_at: number;
}

export interface EvalCtx {
  id: string;
  checks: ScenarioCheck[];
  db: KokaneeDatabase;
  memory: SqliteMemoryRepository;
  service: MemoryService;
  wakes: SqliteWakeRepository;
  scheduler: LocalWakeScheduler;
  conversation: SqliteConversationRepository;
  conversationId: string;
  traces: RunTraces;
  check(name: string, ok: boolean, evidence: string): void;
  say(text: string): Promise<string>;
  realWakeRun(nowMs: number): Promise<{ decision: OccurrenceDecision; state: string }>;
  stubWakeRun(nowMs: number, decision: OccurrenceDecision): Promise<{ state: string }>;
  q<T extends Record<string, unknown>>(sqlText: string, ...params: Array<string | number>): T[];
  count(table: string): number;
  memRows(): MemoryRow[];
  effects(): VisibleEffect[];
}

export function createEvalCtx(id: string): EvalCtx {
  const db = createDatabase(`/tmp/grandeunuch-eval-${id}-${Date.now()}.sqlite`);
  db.runMigrations();
  const memory = new SqliteMemoryRepository(db.connection);
  const service = new MemoryService(memory);
  const wakes = new SqliteWakeRepository(db.connection);
  const scheduler = new LocalWakeScheduler(wakes);
  const conversation = new SqliteConversationRepository(db.connection);
  const conversationId = conversation.ensureDefaultConversation("local-owner", Date.now());
  const traces = createRunTraces(db.connection);
  const principalId = "local-owner";

  const tools = [
    ...Object.values(createMemoryTools({ repository: memory, service })),
    ...Object.values(createWakeTools({ repository: wakes, conversationId })),
  ];

  const checks: ScenarioCheck[] = [];
  const ctx: EvalCtx = {
    id,
    checks,
    db,
    memory,
    service,
    wakes,
    scheduler,
    conversation,
    conversationId,
    traces,

    check(name, ok, evidence) {
      checks.push({ name, ok, evidence });
    },

    async say(text) {
      const history = readTimeline({ conversations: conversation, wakes, principalId, conversationId });
      conversation.append({ conversationId, role: "user", content: text, createdAt: Date.now() });
      const agent = createGrandEunuchAgent({ tools });
      let reply = "";
      const toolCalls: Array<Record<string, unknown>> = [];
      agent.subscribe((event) => {
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
          reply += event.assistantMessageEvent.delta;
        }
        if (event.type === "tool_execution_start") {
          toolCalls.push({ id: event.toolCallId, tool: event.toolName, args: JSON.stringify(event.args).slice(0, 500) });
        }
        if (event.type === "tool_execution_end") {
          const call = toolCalls.find((entry) => entry.id === event.toolCallId);
          if (call) {
            call.result = JSON.stringify(event.result).slice(0, 800);
            call.isError = event.isError;
          }
        }
      });
      const model = getLlmModel();
      const priorTurns = toAgentMessages(history, {
        model: { id: model.id, api: model.api, provider: model.provider },
        limit: 20,
      });
      const runId = traces.start("user_message", text.slice(0, 60));
      try {
        await agent.prompt([...priorTurns, { role: "user", content: text, timestamp: Date.now() }]);
        traces.finish(runId, {
          stopState: "completed",
          finalOutput: reply,
          contextAssembled: JSON.stringify({ systemPrompt: agent.state.systemPrompt, turns: priorTurns.length }),
          toolCalls: JSON.stringify(toolCalls),
        });
      } catch (error) {
        traces.finish(runId, { stopState: "runtime_failure", toolCalls: JSON.stringify(toolCalls) });
        throw error;
      }
      conversation.append({ conversationId, role: "assistant", content: reply, createdAt: Date.now() });
      return reply;
    },

    async realWakeRun(nowMs) {
      for (const occurrence of scheduler.scan(nowMs)) {
        if (wakes.isResolved(occurrence.id)) continue;
        const wake = wakes.findById(occurrence.wakeId);
        if (!wake) continue;
        const context: WakeRunContext = {
          runId: newId(),
          wakeId: occurrence.wakeId,
          occurrenceId: occurrence.id,
          generation: occurrence.generation,
          plannedAt: occurrence.plannedAt,
          arrivedAt: nowMs,
          timezone: wake.timezone,
          intentContext: wake.intentContext,
        };
        const agent = createGrandEunuchAgent({ tools });
        let text = "";
        agent.subscribe((event) => {
          if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
            text += event.assistantMessageEvent.delta;
          }
        });
        const runId = traces.start("scheduled_wake", occurrence.id);
        try {
          await agent.prompt(buildWakeRunPrompt(context));
          const decision = toDecision(text);
          const resolution = wakes.resolveOccurrence({
            occurrenceId: occurrence.id,
            wakeId: occurrence.wakeId,
            generation: occurrence.generation,
            runId: context.runId,
            decision,
            committedAt: Date.now(),
          });
          traces.finish(runId, { stopState: resolution.state, finalOutput: text, contextAssembled: JSON.stringify(context) });
          return { decision, state: resolution.state };
        } catch (error) {
          traces.finish(runId, { stopState: "runtime_failure", contextAssembled: JSON.stringify(context) });
          throw error;
        }
      }
      throw new Error("no due, unresolved occurrences to reassess");
    },

    async stubWakeRun(nowMs, decision) {
      for (const occurrence of scheduler.scan(nowMs)) {
        if (wakes.isResolved(occurrence.id)) continue;
        const wake = wakes.findById(occurrence.wakeId);
        if (!wake) continue;
        const resolution = wakes.resolveOccurrence({
          occurrenceId: occurrence.id,
          wakeId: occurrence.wakeId,
          generation: occurrence.generation,
          runId: newId(),
          decision,
          committedAt: Date.now(),
        });
        return { state: resolution.state };
      }
      // Nothing to resolve (already resolved, cancelled, or not yet due) — not an error.
      return { state: "none" };
    },

    q(sqlText, ...params) {
      return db.connection.prepare(sqlText).all(...params) as Array<Record<string, unknown>> as never;
    },

    count(table) {
      return (db.connection.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
    },

    memRows() {
      return db.connection
        .prepare("SELECT id, content, source, epistemic_type, tags_json, current_version, created_at FROM memories ORDER BY created_at ASC")
        .all() as unknown as MemoryRow[];
    },

    effects() {
      return wakes.listVisibleEffects({ principalId, conversationId });
    },
  };
  return ctx;
}

/** Wake schedule helper used by seeding code. */
export function seedWake(ctx: EvalCtx, intentContext: string, plannedAt: number): WakeIntent {
  return ctx.wakes.schedule({
    principalId: "local-owner",
    conversationId: ctx.conversationId,
    plannedAt,
    timezone: "Asia/Shanghai",
    intentContext,
    idempotencyKey: newId(),
    createdAt: Date.now(),
  });
}

export function seedMemory(
  ctx: EvalCtx,
  content: string,
  options: { source?: string; epistemicType?: "user_statement" | "agent_inference" | "user_decision" | "system_observation"; tags?: string[] } = {}
) {
  return ctx.memory.remember({
    principalId: "local-owner",
    content,
    source: options.source ?? "user message",
    epistemicType: options.epistemicType ?? "user_statement",
    tags: options.tags ?? [],
    idempotencyKey: newId(),
    createdAt: Date.now(),
  });
}

/** Abstention markers: the agent must communicate "no record", not invent one. */
export const ABSTAIN =
  /没有(找到|记录|提过|说过|存|保留)|没.{0,3}(记得|记录|说过|提过|存|保留)|不知道|不清楚|无法|查不到|找不到|无记录|删掉|删除|没了|不能(确认|判断|凭空)/;

/** Does the reply read as asking the user for missing information? */
export const ASKS = /(什么|哪|几点|哪天|多少|如何|怎么|能否|可以).{0,6}[?？]|告诉我|补充|确认一下/;
