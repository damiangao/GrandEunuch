/**
 * Burn-in suite: run BEFORE the two-week living experiment.
 * Phase 1 (no LLM): mechanical invariants — wake fire-once, cancel-blocks, silent, durability.
 * Phase 2 (needs .env): agent abilities — record/provenance, cross-session recall,
 *   knowledge update, abstention, trusted-time scheduling, past-time rejection.
 *   Scenario taxonomy borrowed from LongMemEval's five abilities + our push-side basics.
 *
 * Usage: npm run build:runtime && node --env-file=.env scripts/burn-in.ts
 *   (phase 1 also runs without .env; it never calls the LLM)
 */
import { newId } from "../dist/persistence/id.js";
import { formatShanghaiLocalTime, parseShanghaiLocalTime } from "../dist/wake/local-time.js";

process.env.DB_PATH = `/tmp/grandeunuch-burnin-${Date.now()}.sqlite`;

const rt = await import("../dist/runtime/local-runtime.js");
const { WakeRunner } = await import("../dist/wake/runner.js");
const { createDatabase } = await import("../dist/persistence/sqlite.js");

const results: Array<{ name: string; ok: boolean | "skip"; evidence: string }> = [];
function check(name: string, ok: boolean, evidence: string): void {
  results.push({ name, ok, evidence });
}
function skip(name: string, evidence: string): void {
  results.push({ name, ok: "skip", evidence });
}

const PRINCIPAL = rt.localPrincipalId;
const CONV = rt.localConversationId;
const sql = createDatabase(process.env.DB_PATH!).connection; // fresh handle for raw assertions

function count(table: string): number {
  return (sql.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
}

// ---------- Phase 1: mechanics (no LLM) ----------
{
  const now = Date.now();
  const stub = (kind: "reminder" | "silent") => ({
    reassess: async () => (kind === "reminder" ? { kind: "reminder" as const, content: "烧机提醒：喝水" } : { kind: "silent" as const }),
  });

  // W1 fire-once: two due-scans, exactly one visible effect
  const w1 = rt.localWakeRepository.schedule({
    principalId: PRINCIPAL, conversationId: CONV, plannedAt: now + 120_000,
    timezone: "Asia/Shanghai", intentContext: "W1", idempotencyKey: newId(), createdAt: now,
  });
  const r1 = new WakeRunner(rt.localWakeRepository, rt.localWakeScheduler, stub("reminder"));
  await r1.processDue(now + 180_000);
  await r1.processDue(now + 240_000);
  const effects1 = rt.localWakeRepository.listVisibleEffects({ principalId: PRINCIPAL, conversationId: CONV });
  check("W1 fire-once", effects1.length === 1, `visible_effects=${effects1.length} (wake ${w1.id.slice(0, 8)})`);

  // W2 cancel-blocks: cancelled wake produces nothing
  const w2 = rt.localWakeRepository.schedule({
    principalId: PRINCIPAL, conversationId: CONV, plannedAt: now + 120_000,
    timezone: "Asia/Shanghai", intentContext: "W2", idempotencyKey: newId(), createdAt: now,
  });
  rt.localWakeRepository.cancel({ principalId: PRINCIPAL, wakeId: w2.id, idempotencyKey: newId(), cancelledAt: now });
  await new WakeRunner(rt.localWakeRepository, rt.localWakeScheduler, stub("reminder")).processDue(now + 180_000);
  check("W2 cancel-blocks", rt.localWakeRepository.listVisibleEffects({ principalId: PRINCIPAL, conversationId: CONV }).length === 1, "still only W1's effect");

  // W3 silent is auditable: resolved, no effect
  const w3 = rt.localWakeRepository.schedule({
    principalId: PRINCIPAL, conversationId: CONV, plannedAt: now + 120_000,
    timezone: "Asia/Shanghai", intentContext: "W3", idempotencyKey: newId(), createdAt: now,
  });
  await new WakeRunner(rt.localWakeRepository, rt.localWakeScheduler, stub("silent")).processDue(now + 180_000);
  const stillOne = rt.localWakeRepository.listVisibleEffects({ principalId: PRINCIPAL, conversationId: CONV }).length === 1;
  const occ3 = sql.prepare("SELECT * FROM wake_occurrences WHERE wake_id = ?").all(w3.id) as Array<{ id: string }>;
  const occ3id = occ3[0]?.id;
  const resolved3 = occ3id !== undefined && rt.localWakeRepository.isResolved(occ3id);
  check("W3 silent-auditable", stillOne && resolved3, `occurrences=${occ3.length}, resolved=${resolved3}`);

  // W4 durability: reopen the file with a fresh handle, everything still there
  const mem = rt.localMemoryRepository.remember({
    principalId: PRINCIPAL, content: "烧机持久性检查", source: "burn-in",
    epistemicType: "system_observation", tags: ["burnin"], idempotencyKey: newId(), createdAt: now,
  });
  const again = createDatabase(process.env.DB_PATH!);
  const memRow = again.connection.prepare("SELECT content FROM memories WHERE id = ?").get(mem.id) as { content: string } | undefined;
  const wakeRows = (again.connection.prepare("SELECT COUNT(*) AS c FROM wake_intents WHERE state = 'fired' OR state = 'resolved'").get() as { c: number }).c;
  check("W4 reopen-durable", memRow?.content === "烧机持久性检查" && wakeRows >= 1, `memory found=${Boolean(memRow)}, resolved wakes=${wakeRows}`);
}

// ---------- Phase 2: agent abilities (needs LLM) ----------
const hasLlm = Boolean(process.env.LLM_BASE_URL && process.env.LLM_API_KEY && process.env.LLM_MODEL);
if (!hasLlm) {
  skip("M1..M6 agent abilities", "LLM env missing — fill .env then rerun");
} else {
  const { readTimeline } = await import("../dist/conversation/timeline.js");
  const { createLocalAgentRuntime } = await import("../dist/runtime/agent-runtime.js");

  async function say(message: string): Promise<string> {
    const history = readTimeline({ conversations: rt.localConversationRepository, wakes: rt.localWakeRepository, principalId: PRINCIPAL, conversationId: CONV });
    rt.localConversationRepository.append({ conversationId: CONV, role: "user", content: message, createdAt: Date.now() });
    const reply = await createLocalAgentRuntime(history).respond(message, () => {});
    rt.localConversationRepository.append({ conversationId: CONV, role: "assistant", content: reply, createdAt: Date.now() });
    return reply;
  }
  const memRows = () => sql.prepare("SELECT id, content, epistemic_type FROM memories WHERE content NOT LIKE '%烧机%'").all() as Array<{ id: string; content: string; epistemic_type: string }>;

  // M1 record with provenance
  const r1 = await say("记住：这个项目的负责人是小王。");
  const m1row = memRows().find((row) => row.content.includes("小王"));
  check("M1 record+provenance", Boolean(m1row && m1row.epistemic_type === "user_statement"), m1row ? `epistemic=${m1row.epistemic_type}` : `no memory; reply=${r1.slice(0, 60)}`);

  // M2 cross-session recall (fresh runtime each say() already)
  const r2 = await say("顺便聊点别的，今天天气不错。"); // filler turn to force history replay
  const r3 = await say("负责人是谁？");
  check("M2 cross-session recall", r3.includes("小王"), `reply=${r3.slice(0, 80)}`);

  // M3 knowledge update -> revise, not balloon
  await say("更正一下，负责人改成小李了，不是小王。");
  const ownerRows = memRows().filter((row) => row.content.includes("负责"));
  const latestContent = memRows().filter((row) => row.content.includes("小李"));
  check("M3 knowledge-update", ownerRows.length <= 2 && latestContent.length >= 1, `rows=${ownerRows.length}, has-小李=${latestContent.length >= 1}`);

  // M4 abstention on never-recorded fact
  const coffeeBefore = memRows().filter((row) => row.content.includes("咖啡")).length;
  const r4 = await say("我之前跟你说过我最喜欢的咖啡是哪一款来着？");
  const coffeeAfter = memRows().filter((row) => row.content.includes("咖啡")).length;
  const abstained = /没有(找到|记录|提过|说过)|没.{0,3}(记得|记录|说过|提过|存)|不知道|不清楚|无法|未曾/.test(r4);
  check("M4 abstention", abstained && coffeeAfter === coffeeBefore, `reply=${r4.slice(0, 60)}, fabricated=${coffeeAfter > coffeeBefore}`);

  // M5 trusted-time scheduling: relative request resolves to real today
  const target = formatShanghaiLocalTime(Date.now() + 10 * 60_000); // YYYY-MM-DD HH:MM:SS
  const hhmm = target.slice(11, 16);
  const rollsOver = target.slice(0, 10) !== formatShanghaiLocalTime(Date.now()).slice(0, 10);
  if (rollsOver) {
    skip("M5 trusted-time", "midnight rollover — rerun");
  } else {
    const wakesBefore = count("wake_intents");
    await say(`请在今天 ${hhmm} 提醒我喝水。`);
    const rows = sql.prepare("SELECT planned_at, timezone FROM wake_intents ORDER BY created_at DESC LIMIT 1").all() as Array<{ planned_at: number; timezone: string }>;
    const expected = parseShanghaiLocalTime(target.slice(0, 16));
    const planned = rows[0]?.planned_at;
    const ok5 = planned !== undefined && Math.abs(planned - expected) < 90_000 && count("wake_intents") === wakesBefore + 1;
    check("M5 trusted-time", ok5, `planned=${rows[0]?.planned_at}, expected≈${expected}, tz=${rows[0]?.timezone}`);
  }

  // M6 past time rejected
  const before6 = count("wake_intents");
  const r6 = await say("昨天早上 8 点提醒我喝水。");
  check("M6 past-rejected", count("wake_intents") === before6, `wakes unchanged=${count("wake_intents") === before6}; reply=${r6.slice(0, 50)}`);
}

// ---------- report ----------
let failed = 0;
for (const r of results) {
  if (r.ok === false) failed += 1;
  const tag = r.ok === true ? "✅" : r.ok === "skip" ? "⏭ " : "❌";
  console.log(`${tag} ${r.name} — ${r.evidence}`);
}
console.log(`\n${failed === 0 ? "burn-in: all green" : `burn-in: ${failed} FAILURES — fix before the experiment starts`}`);
process.exitCode = failed === 0 ? 0 : 1;
