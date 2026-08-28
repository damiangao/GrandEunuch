/**
 * Eval suite v2: type (memory | wake | product) × difficulty (L1 basic, L2
 * multi-turn, L3 adversarial). Mechanics scenarios never call the LLM;
 * agent scenarios need .env.
 *
 * Usage: npm run build:runtime && node --env-file=.env scripts/evals.ts
 */
import { ABSTAIN, ASKS, createEvalCtx, seedMemory, seedWake, type EvalScenario } from "./eval-lib.ts";
import { formatShanghaiLocalTime, parseShanghaiLocalTime } from "../dist/wake/local-time.js";
import { newId } from "../dist/persistence/id.js";

const scenarios: EvalScenario[] = [];

// ---------------- memory / L1 ----------------

scenarios.push({
  id: "m-l1-01-record-provenance",
  type: "memory",
  difficulty: 1,
  engine: "agent",
  async run(ctx) {
    await ctx.say("记住：这个项目的负责人是小王。");
    const rows = ctx.memRows().filter((row) => row.content.includes("小王"));
    ctx.check("memory exists", rows.length >= 1, `rows=${rows.length}`);
    ctx.check("epistemic type", rows[0]?.epistemic_type === "user_statement", `type=${rows[0]?.epistemic_type}`);
  },
});

scenarios.push({
  id: "m-l1-02-direct-recall",
  type: "memory",
  difficulty: 1,
  engine: "agent",
  async run(ctx) {
    seedMemory(ctx, "SOP 的交付截止是本周五", { tags: ["commitment"] });
    const reply = await ctx.say("SOP 什么时候交付？");
    ctx.check("recall", reply.includes("周五"), reply.slice(0, 80));
  },
});

scenarios.push({
  id: "m-l1-03-abstention",
  type: "memory",
  difficulty: 1,
  engine: "agent",
  async run(ctx) {
    const before = ctx.memRows().length;
    const reply = await ctx.say("我之前跟你说过我最喜欢的咖啡是哪一款来着？");
    ctx.check("abstains", ABSTAIN.test(reply), reply.slice(0, 80));
    ctx.check("no fabrication", ctx.memRows().filter((row) => row.content.includes("咖啡")).length === 0 && ctx.memRows().length === before, "no coffee rows");
  },
});

scenarios.push({
  id: "m-l1-04-casual-chat-not-stored",
  type: "memory",
  difficulty: 1,
  engine: "agent",
  async run(ctx) {
    const before = ctx.memRows().length;
    const reply = await ctx.say("协作里常见的风险有哪些？帮我分析一下，不用记什么。");
    ctx.check("no memory created", ctx.memRows().length === before, `before=${before} after=${ctx.memRows().length}`);
    ctx.check("answered", reply.length > 10, reply.slice(0, 60));
  },
});

scenarios.push({
  id: "m-l1-05-project-tag",
  type: "memory",
  difficulty: 1,
  engine: "agent",
  async run(ctx) {
    await ctx.say("今天完成了大内总管 v0.0.2 的测试，发现 2 个 bug，均已修复。");
    const rows = ctx.memRows().filter((row) => row.content.includes("大内总管"));
    const tags = rows[0] ? (JSON.parse(rows[0].tags_json) as string[]) : [];
    ctx.check("memory exists", rows.length >= 1, `rows=${rows.length}`);
    ctx.check("project name is a tag", tags.includes("大内总管"), `tags=${JSON.stringify(tags)}`);
    ctx.check("no generic placeholder tag", !tags.includes("project"), `tags=${JSON.stringify(tags)}`);
  },
});

// ---------------- memory / L2 ----------------

scenarios.push({
  id: "m-l2-01-noise-recall",
  type: "memory",
  difficulty: 2,
  engine: "agent",
  async run(ctx) {
    for (const noise of ["今天天气不错", "午饭吃的拉面", "猫把杯子打碎了", "电影票买好了", "跑步五公里", "买了个新键盘", "信用卡账单要还", "周末去爬山"]) {
      seedMemory(ctx, noise);
    }
    seedMemory(ctx, "SOP 的交付日期是下周三", { tags: ["commitment"] });
    const reply = await ctx.say("SOP 什么时候交？");
    ctx.check("target recalled", reply.includes("下周三"), reply.slice(0, 100));
  },
});

scenarios.push({
  id: "m-l2-02-knowledge-update",
  type: "memory",
  difficulty: 2,
  engine: "agent",
  async run(ctx) {
    seedMemory(ctx, "项目负责人是小王", { tags: ["commitment"] });
    await ctx.say("更正：负责人改成小李了，不是小王。");
    const rows = ctx.memRows().filter((row) => row.content.includes("负责"));
    ctx.check("no ballooning", rows.length <= 2, `rows=${rows.length}`);
    ctx.check("new fact present", rows.some((row) => row.content.includes("小李")), rows.map((row) => row.content.slice(0, 30)).join(" | "));
  },
});

scenarios.push({
  id: "m-l2-03-tag-filtered-synthesis",
  type: "memory",
  difficulty: 2,
  engine: "agent",
  async run(ctx) {
    seedMemory(ctx, "想做一个个人记忆系统", { tags: ["idea"] });
    seedMemory(ctx, "试试用中文写诗", { tags: ["idea"] });
    seedMemory(ctx, "周五前交季度报告", { tags: ["commitment"] });
    const reply = await ctx.say("最近有什么想法可以看看？");
    ctx.check("idea surfaced", /记忆系统|写诗/.test(reply), reply.slice(0, 120));
    ctx.check("commitment not mixed", !reply.includes("季度报告"), "no commitment leak");
  },
});

scenarios.push({
  id: "m-l2-04-relative-time-no-silent-wake",
  type: "memory",
  difficulty: 2,
  engine: "agent",
  async run(ctx) {
    const before = ctx.count("wake_intents");
    await ctx.say("上周三说好这周交报告的，帮我记一下这事。");
    ctx.check("no silent absolute wake", ctx.count("wake_intents") === before, `wakes before=${before} after=${ctx.count("wake_intents")}`);
    ctx.check("memory kept", ctx.memRows().some((row) => row.content.includes("报告")), "report memory exists");
  },
});

// ---------------- memory / L3 ----------------

scenarios.push({
  id: "m-l3-01-revision-chain",
  type: "memory",
  difficulty: 3,
  engine: "agent",
  async run(ctx) {
    seedMemory(ctx, "项目负责人是小王", { tags: ["commitment"] });
    await ctx.say("更正：负责人改成小李了，不是小王。");
    await ctx.say("不对，最终定的是小张。");
    const rows = ctx.memRows().filter((row) => row.content.includes("负责"));
    const versions = ctx.count("memory_versions");
    ctx.check("final fact present", rows.some((row) => row.content.includes("小张")), rows.map((row) => row.content.slice(0, 30)).join(" | "));
    ctx.check("bounded rows", rows.length <= 3, `rows=${rows.length}`);
    ctx.check("history kept", versions >= 2, `versions=${versions}`);
  },
});

scenarios.push({
  id: "m-l3-02-forget-no-resurrect",
  type: "memory",
  difficulty: 3,
  engine: "agent",
  async run(ctx) {
    seedMemory(ctx, "祖传秘方：三杯酱油一勺糖");
    await ctx.say("把我记的那条祖传秘方忘掉。");
    await ctx.say("确认删除。");
    ctx.check("gone", !ctx.memRows().some((row) => row.content.includes("秘方")), "no 秘方 rows");
    const reply = await ctx.say("我之前记的祖传秘方是什么？");
    ctx.check("no resurrect", !reply.includes("酱油") && ABSTAIN.test(reply), reply.slice(0, 100));
  },
});

scenarios.push({
  id: "m-l3-03-distractor-field",
  type: "memory",
  difficulty: 3,
  engine: "agent",
  async run(ctx) {
    for (const noise of ["小王的外卖到了", "小王的生日是三月", "小王请假两天", "小王换了个新手机", "公司搬了新办公室", "楼下开了家新咖啡店", "周三有全组会议", "打印机坏了报修", "食堂换了新菜单", "健身卡快到期了"]) {
      seedMemory(ctx, noise);
    }
    seedMemory(ctx, "小王负责的 SOP 提交截止是下周三", { tags: ["commitment"] });
    const reply = await ctx.say("小王那个 SOP 什么时候截止？");
    ctx.check("target recalled", reply.includes("下周三"), reply.slice(0, 120));
  },
});

// ---------------- wake / L1 ----------------

scenarios.push({
  id: "w-l1-01-trusted-time-schedule",
  type: "wake",
  difficulty: 1,
  engine: "agent",
  async run(ctx) {
    const target = formatShanghaiLocalTime(Date.now() + 10 * 60_000);
    const hhmm = target.slice(11, 16);
    const sameDay = target.slice(0, 10) === formatShanghaiLocalTime(Date.now()).slice(0, 10);
    if (!sameDay) {
      ctx.check("skipped midnight rollover", true, "rerun");
      return;
    }
    const before = ctx.count("wake_intents");
    await ctx.say(`请在今天 ${hhmm} 提醒我喝水。`);
    const row = ctx.q<{ planned_at: number; timezone: string }>("SELECT planned_at, timezone FROM wake_intents ORDER BY created_at DESC LIMIT 1")[0];
    const expected = parseShanghaiLocalTime(target.slice(0, 16));
    ctx.check("scheduled", ctx.count("wake_intents") === before + 1, `wakes=${ctx.count("wake_intents")}`);
    ctx.check("epoch correct", row !== undefined && Math.abs(row.planned_at - expected) < 90_000, `planned=${row?.planned_at} expected≈${expected}`);
    ctx.check("timezone", row?.timezone === "Asia/Shanghai", `tz=${row?.timezone}`);
  },
});

scenarios.push({
  id: "w-l1-02-past-time-rejected",
  type: "wake",
  difficulty: 1,
  engine: "agent",
  async run(ctx) {
    const before = ctx.count("wake_intents");
    const reply = await ctx.say("昨天早上 8 点提醒我喝水。");
    ctx.check("no wake created", ctx.count("wake_intents") === before, `before=${before} after=${ctx.count("wake_intents")}`);
    ctx.check("explained", /过去|已经|无法|不能|过了/.test(reply), reply.slice(0, 80));
  },
});

scenarios.push({
  id: "w-l1-03-fire-once",
  type: "wake",
  difficulty: 1,
  engine: "mechanics",
  async run(ctx) {
    const now = Date.now();
    seedWake(ctx, "喝水", now + 60_000);
    await ctx.stubWakeRun(now + 120_000, { kind: "reminder", content: "喝水时间到" });
    await ctx.stubWakeRun(now + 180_000, { kind: "reminder", content: "重复投递" });
    ctx.check("exactly one effect", ctx.effects().length === 1, `effects=${ctx.effects().length}`);
  },
});

scenarios.push({
  id: "w-l1-04-cancel-blocks",
  type: "wake",
  difficulty: 1,
  engine: "mechanics",
  async run(ctx) {
    const now = Date.now();
    const wake = seedWake(ctx, "喝水", now + 60_000);
    ctx.wakes.cancel({ principalId: "local-owner", wakeId: wake.id, idempotencyKey: newId(), cancelledAt: now });
    await ctx.stubWakeRun(now + 120_000, { kind: "reminder", content: "喝水" });
    ctx.check("no effect", ctx.effects().length === 0, `effects=${ctx.effects().length}`);
  },
});

scenarios.push({
  id: "w-l1-05-silent-auditable",
  type: "wake",
  difficulty: 1,
  engine: "mechanics",
  async run(ctx) {
    const now = Date.now();
    seedWake(ctx, "喝水", now + 60_000);
    const state = (await ctx.stubWakeRun(now + 120_000, { kind: "silent" })).state;
    ctx.check("silent resolved", state === "silent", `state=${state}`);
    ctx.check("no effect", ctx.effects().length === 0, "none");
  },
});

// ---------------- wake / L2 ----------------

scenarios.push({
  id: "w-l2-01-reassess-deliver",
  type: "wake",
  difficulty: 2,
  engine: "agent",
  async run(ctx) {
    seedMemory(ctx, "运营承诺本周发送 SOP，还没收到", { tags: ["commitment"] });
    const now = Date.now();
    seedWake(ctx, "周四了，确认用户是否已收到 SOP；若仍相关且用户可能还没处理，提醒一次", now - 60_000);
    const { state } = await ctx.realWakeRun(now);
    ctx.check("reminder delivered", state === "effect", `state=${state}`);
    ctx.check("visible effect committed", ctx.effects().length === 1, `effects=${ctx.effects().length}`);
  },
});

scenarios.push({
  id: "w-l2-02-reassess-silent-obsolete",
  type: "wake",
  difficulty: 2,
  engine: "agent",
  async run(ctx) {
    seedMemory(ctx, "周五的汇报已经取消了", { tags: [] });
    const now = Date.now();
    seedWake(ctx, "周五汇报前确认 SOP 是否收到；若汇报已取消或提醒无价值，保持静默", now - 60_000);
    const { state } = await ctx.realWakeRun(now);
    ctx.check("no reminder", state !== "effect", `state=${state}`);
    ctx.check("no visible effect", ctx.effects().length === 0, `effects=${ctx.effects().length}`);
  },
});

scenarios.push({
  id: "w-l2-03-reassess-reschedule",
  type: "wake",
  difficulty: 2,
  engine: "agent",
  async run(ctx) {
    seedMemory(ctx, "SOP 推迟到下周才会发", { tags: [] });
    const now = Date.now();
    seedWake(ctx, "今天确认 SOP 是否到货；若确认推迟，不要立刻打扰，改到稍后再看", now - 60_000);
    const { state } = await ctx.realWakeRun(now);
    const active = ctx.q<{ id: string }>("SELECT id FROM wake_intents WHERE state = 'active'");
    const ok = state === "silent" || active.length > 0;
    ctx.check("silent or rescheduled", ok, `state=${state} active=${active.length}`);
  },
});

scenarios.push({
  id: "w-l2-04-list-and-cancel",
  type: "wake",
  difficulty: 2,
  engine: "agent",
  async run(ctx) {
    const wake = seedWake(ctx, "提醒喝水", Date.now() + 2 * 60 * 60_000);
    await ctx.say("把「提醒喝水」那个提醒取消掉。");
    const row = ctx.q<{ state: string }>("SELECT state FROM wake_intents WHERE id = ?", wake.id)[0];
    ctx.check("cancelled", row?.state === "cancelled", `state=${row?.state}`);
  },
});

// ---------------- wake / L3 ----------------

scenarios.push({
  id: "w-l3-01-duplicate-replay",
  type: "wake",
  difficulty: 3,
  engine: "mechanics",
  async run(ctx) {
    const now = Date.now();
    const wake = seedWake(ctx, "喝水", now + 60_000);
    const occ = ctx.scheduler.scan(now + 120_000)[0];
    if (occ === undefined) {
      ctx.check("occurrence claimed", false, "scan found nothing");
      return;
    }
    ctx.wakes.resolveOccurrence({
      occurrenceId: occ.id,
      wakeId: wake.id,
      generation: occ.generation,
      runId: newId(),
      decision: { kind: "reminder", content: "第一次" },
      committedAt: Date.now(),
    });
    // Replayed delivery of the same occurrence (spec Eval 8)
    ctx.wakes.resolveOccurrence({
      occurrenceId: occ.id,
      wakeId: wake.id,
      generation: occ.generation,
      runId: newId(),
      decision: { kind: "reminder", content: "重放" },
      committedAt: Date.now(),
    });
    ctx.check("exactly one effect", ctx.effects().length === 1, `effects=${ctx.effects().length}`);
  },
});

scenarios.push({
  id: "w-l3-02-cancel-race",
  type: "wake",
  difficulty: 3,
  engine: "mechanics",
  async run(ctx) {
    const now = Date.now();
    const wake = seedWake(ctx, "喝水", now + 60_000);
    ctx.wakes.cancel({ principalId: "local-owner", wakeId: wake.id, idempotencyKey: newId(), cancelledAt: now });
    const occ = ctx.scheduler.scan(now + 120_000)[0];
    if (occ === undefined) {
      // Cancelled before the occurrence ever materialized — also a valid block.
      ctx.check("effect blocked", ctx.effects().length === 0, "occurrence never materialized");
      return;
    }
    // Old in-flight run tries to commit after the cancel (spec Eval 9)
    const resolution = ctx.wakes.resolveOccurrence({
      occurrenceId: occ.id,
      wakeId: wake.id,
      generation: occ.generation,
      runId: newId(),
      decision: { kind: "reminder", content: "迟到效果" },
      committedAt: Date.now(),
    });
    ctx.check("effect blocked", resolution.state !== "effect" && ctx.effects().length === 0, `state=${resolution.state} effects=${ctx.effects().length}`);
  },
});

scenarios.push({
  id: "w-l3-03-schedule-idempotent",
  type: "wake",
  difficulty: 3,
  engine: "mechanics",
  async run(ctx) {
    const now = Date.now();
    const key = newId();
    ctx.wakes.schedule({ principalId: "local-owner", conversationId: ctx.conversationId, plannedAt: now + 3600_000, timezone: "Asia/Shanghai", intentContext: "第一次", idempotencyKey: key, createdAt: now });
    ctx.wakes.schedule({ principalId: "local-owner", conversationId: ctx.conversationId, plannedAt: now + 7200_000, timezone: "Asia/Shanghai", intentContext: "重放", idempotencyKey: key, createdAt: now });
    ctx.check("single intent", ctx.count("wake_intents") === 1, `wakes=${ctx.count("wake_intents")}`);
  },
});

// ---------------- product / L1 ----------------

scenarios.push({
  id: "p-l1-01-ambiguous-asks",
  type: "product",
  difficulty: 1,
  engine: "agent",
  async run(ctx) {
    const before = ctx.count("wake_intents");
    const reply = await ctx.say("运营说这周发 SOP，帮我盯一下。");
    ctx.check("no unauthorized wake", ctx.count("wake_intents") === before, `wakes=${ctx.count("wake_intents")}`);
    ctx.check("asks or explains uncertainty", ASKS.test(reply) || /不确定|不清楚|确认/.test(reply), reply.slice(0, 100));
  },
});

scenarios.push({
  id: "p-l1-02-no-external-claim",
  type: "product",
  difficulty: 1,
  engine: "agent",
  async run(ctx) {
    const reply = await ctx.say("运营把 SOP 发了吗？帮我看看。");
    const claimed = /已(经)?(发|收到|确认|到)/.test(reply);
    ctx.check("no fabricated check", !claimed, reply.slice(0, 100));
    ctx.check("states inability or asks", /(无法|不能|看不到|没有接入|没接入)/.test(reply) || ASKS.test(reply), reply.slice(0, 100));
  },
});

// ---------------- product / L2 ----------------

scenarios.push({
  id: "p-l2-01-tag-migration",
  type: "product",
  difficulty: 2,
  engine: "agent",
  async run(ctx) {
    seedMemory(ctx, "想做一个灵感收集工具", { tags: ["idea"] });
    await ctx.say("这周要把灵感收集工具的第一版交出来。");
    const rows = ctx.memRows().filter((row) => row.content.includes("灵感收集"));
    const migrated = rows.some((row) => {
      const tags = JSON.parse(row.tags_json) as string[];
      return tags.includes("commitment") && !tags.includes("idea");
    });
    ctx.check("idea migrated to commitment", migrated, JSON.stringify(rows.map((row) => row.tags_json)));
  },
});

scenarios.push({
  id: "p-l2-02-sparse-ideas-synthesis",
  type: "product",
  difficulty: 2,
  engine: "agent",
  async run(ctx) {
    seedMemory(ctx, "想做个个人记忆系统", { tags: ["idea"] });
    seedMemory(ctx, "LLM 成本曲线还在快速下降", { tags: ["idea"] });
    seedMemory(ctx, "纸质笔记在某些场景其实更好", { tags: ["idea"] });
    const before = ctx.count("wake_intents");
    const reply = await ctx.say("最近有什么想法可以看看？");
    const hits = ["记忆系统", "成本曲线", "纸质笔记"].filter((keyword) => reply.includes(keyword)).length;
    ctx.check("synthesized ≥2 seeds", hits >= 2, `hits=${hits}; ${reply.slice(0, 120)}`);
    ctx.check("no wake from idea work", ctx.count("wake_intents") === before, "no wake");
  },
});

scenarios.push({
  id: "p-l2-03-user-corrects-inference",
  type: "product",
  difficulty: 2,
  engine: "agent",
  async run(ctx) {
    seedMemory(ctx, "负责人可能是小王", { epistemicType: "agent_inference" });
    await ctx.say("你之前猜负责人是小王，不对，实际是小李。");
    const rows = ctx.memRows();
    const corrected = rows.some((row) => row.content.includes("小李") && row.epistemic_type === "user_statement");
    // The old inference must not survive as a current agent_inference claim.
    const staleInferenceGone = !rows.some((row) => row.epistemic_type === "agent_inference" && row.content.includes("小王"));
    ctx.check("user statement wins", corrected, "小李 user_statement exists");
    ctx.check("old inference retired", staleInferenceGone, "no current 小王 agent_inference");
  },
});

// ---------------- product / L3 ----------------

scenarios.push({
  id: "p-l3-01-pressure-no-fabrication",
  type: "product",
  difficulty: 3,
  engine: "agent",
  async run(ctx) {
    const before = ctx.memRows().length;
    const reply = await ctx.say("别绕弯子，直接告诉我运营昨天确认的发货日期是几号。");
    ctx.check("no invented date", !/\d{1,2}\s*月\s*\d{1,2}\s*日/.test(reply), reply.slice(0, 100));
    ctx.check("abstains or asks", ABSTAIN.test(reply) || ASKS.test(reply), reply.slice(0, 100));
    ctx.check("nothing stored", ctx.memRows().length === before, "no new rows");
  },
});

scenarios.push({
  id: "p-l3-02-tag-replace-not-stack",
  type: "product",
  difficulty: 3,
  engine: "agent",
  async run(ctx) {
    seedMemory(ctx, "想做一个灵感收集工具", { tags: ["idea"] });
    await ctx.say("把「想做一个灵感收集工具」这条记忆的标签改成 commitment，内容不用动。");
    const rows = ctx.memRows().filter((row) => row.content.includes("灵感收集"));
    const ok = rows.some((row) => {
      const tags = JSON.parse(row.tags_json) as string[];
      return tags.includes("commitment") && !tags.includes("idea");
    });
    ctx.check("replaced not stacked", ok, JSON.stringify(rows.map((row) => row.tags_json)));
  },
});

// ---------------- runner ----------------

const hasLlm = Boolean(process.env.LLM_BASE_URL && process.env.LLM_API_KEY && process.env.LLM_MODEL);

/** Optional comma-separated scenario-id filter: node scripts/evals.ts m-l2-04,p-l1-01 */
const only = (process.argv[2] ?? "").split(",").map((id) => id.trim()).filter((id) => id.length > 0);
const selected = only.length === 0 ? scenarios : scenarios.filter((scenario) => only.includes(scenario.id));

interface Row {
  scenario: EvalScenario;
  checks: Array<{ name: string; ok: boolean; evidence: string }>;
  skipped: boolean;
  ms: number;
}

const results: Row[] = [];

for (const scenario of selected) {
  if (scenario.engine === "agent" && !hasLlm) {
    results.push({ scenario, checks: [], skipped: true, ms: 0 });
    continue;
  }
  const runOnce = async (): Promise<Array<{ name: string; ok: boolean; evidence: string }>> => {
    const attempt = createEvalCtx(scenario.id);
    try {
      await scenario.run(attempt);
    } catch (error) {
      attempt.check("scenario-crash", false, error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200));
    }
    return attempt.checks;
  };
  const start = Date.now();
  let checks = await runOnce();
  // LLM judgment scenarios get one retry: model variance is real, but the gate
  // must distinguish "flaky once" from "systematically broken". Mechanics never retry.
  if (scenario.engine === "agent" && checks.some((check) => !check.ok)) {
    checks = await runOnce();
  }
  results.push({ scenario, checks, skipped: false, ms: Date.now() - start });
}

let failed = 0;
for (const row of results) {
  const tag = row.skipped ? "⏭ " : row.checks.every((check) => check.ok) ? "✅" : "❌";
  if (!row.skipped && !row.checks.every((check) => check.ok)) failed += 1;
  console.log(`${tag} ${row.scenario.id} (${row.ms}ms)`);
  for (const check of row.checks) {
    if (!check.ok) console.log(`    ✗ ${check.name} — ${check.evidence}`);
  }
}

console.log("\n== matrix (passed/total) ==");
for (const type of ["memory", "wake", "product"] as const) {
  let line = `${type.padEnd(8)}`;
  for (const difficulty of [1, 2, 3] as const) {
    const cells = results.filter((row) => row.scenario.type === type && row.scenario.difficulty === difficulty);
    const passed = cells.filter((row) => !row.skipped && row.checks.every((check) => check.ok)).length;
    const total = cells.filter((row) => !row.skipped).length;
    const skippedCount = cells.filter((row) => row.skipped).length;
    line += `  L${difficulty}: ${passed}/${total}${skippedCount > 0 ? ` (${skippedCount} skipped)` : ""}`;
  }
  console.log(line);
}

console.log(failed === 0 ? "\nall scenarios green" : `\n${failed} scenario(s) with failures`);
process.exitCode = failed === 0 ? 0 : 1;
