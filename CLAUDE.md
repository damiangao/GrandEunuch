# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

MVP working end-to-end, verified in a browser. All eight spec tools implemented (`memory__search/read/remember/revise/forget`, `wake__list/schedule/cancel`), backed by SQLite (`node:sqlite`, survives restarts, self-healing transactional migrations). Next.js App Router PWA (`app/`) serves a local chat UI over the same Runtime — send message → streamed reply → persisted → restored on refresh. Wakes are reliable end to end: due-scan → real Agent reassessment → atomic commit → reminder merged into the conversation timeline. 50 vitest tests pass; `npm run typecheck` and `npm run build` are clean. Per-run tracing (`run_traces`) records context assembly, tool calls and stop states for both user and wake runs, and participates in forget scrubbing (spec §4.1). A burn-in suite (10 scenarios) and a 30-scenario eval matrix (memory/wake/product × L1/L2/L3, `scripts/evals.ts`) run against isolated per-scenario SQLite DBs with scoped tool factories. Deployment is Docker (`compose.yaml`): the ledger volume-mounts at `./data`, survives host reboots, and auto-restarts on crash. A read-only `/memory` knowledge view (markdown cards / timeline / tags / star-map) browses the store without touching the Agent's write authority.

Not yet implemented: Run Coordinator / Execution Budget ceilings, Web Push. Timezone is hardcoded to `Asia/Shanghai`. In-app reminders only.

## Documents

- `docs/GRAND_EUNUCH.md` (v1.0, in Chinese) — the single authoritative spec for GrandEunuch (大内总管). Covers product semantics, the Agent/Runtime decision-rights boundary, Trigger types, Run Input shape, the eight-tool surface, Tool Result categories, Execution Budget, Run Stop states, and a twelve-case Eval dataset (10 secretarial + 2 idea-related cases). Treat it as the single binding spec for any prototype work — it merges what used to be two separate documents (product design + runtime contract) into one, since both product goals share the same memory/wake infrastructure.

## Product intent

GrandEunuch (大内总管) is a personal agent, entered through private conversation, that serves two roles:

1. **Secretarial**: reduce the probability of the user missing important collaborative commitments — promises made to or by the user, pending results, unclear responsibilities — while minimizing unnecessary interruption.
2. **Creative**: help the user surface and synthesize their own recorded ideas when they are unsure what to pursue, actively drawing connections across scattered fragments rather than only passively recalling them.

These are not two separate apps. They are the same Agent pursuing different `goal` values in different Runs, sharing one memory and wake infrastructure. Secretarial judgments have objective correctness (a commitment was or wasn't met); idea-related judgments do not (there is no "correct" creative direction) — this asymmetry is reflected directly in the Eval scoring (see spec §14).

First version constraints: only `user_message` and `scheduled_wake` triggers exist. The system does not read external sources (chat, email, calendar) and does not contact other people on the user's behalf. Idea-related work is triggered only passively, inside a `user_message` Run — it must never fire via `scheduled_wake`, since unsolicited creative suggestions lack the objective justification for interruption that secretarial reminders have.

## Core architectural rule: this is an Agentic App

> The Agent owns judgment, planning, and next-step decisions. Tools expose composable capabilities. The Runtime only guarantees safe, reliable execution. Product/contract rules constrain outcomes, not trajectories.

Concretely:

- The **Agent** decides: what the user actually wants (secretarial or creative), whether to search memory, what is worth persisting, what tags to attach, whether to ask a clarifying question, whether to schedule/cancel a wake, tool choice/order/count, and how to recover from tool failure.
- The **Runtime** guarantees: reliable trigger delivery, input/permission/budget validation, tool execution, idempotency and concurrency safety for persistent side effects, wake scheduling/cancellation/dedup, and audit logging. The Runtime stores and filters by tags but never interprets tag semantics.
- The **Runtime must never**: judge business relevance/risk/priority, pre-filter "relevant memories" into the Agent's input, generate a fixed business workflow, pick a recovery action based on an error code, or enforce any tag-semantic rule (e.g. `idea`/`commitment` mutual exclusivity is an Agent self-discipline rule, not a Runtime constraint — see spec §3.1/§3.2).

Before adding any new capability, apply the regression test: *can a near-identical new scenario be handled by the Agent using existing generic tools, or does it require a new Runtime branch, dedicated command, or fixed state machine?* If the latter, the design is regressing toward a Workflow App — stop and reconsider.

## Minimal tool surface (v1.0, exactly eight tools)

```
memory.search
memory.read
memory.remember
memory.revise
memory.forget
wake.list
wake.schedule
wake.cancel
```

These eight tools serve both secretarial and idea-related scenarios — no dedicated "synthesize ideas" tool, no "idea grouping" Artifact. `memory.remember`/`memory.revise` support an optional, fully open tag set (Agent-chosen free text, e.g. `idea`, `commitment`, or anything else); `memory.search` filters by tag with "any match" semantics. No `attention.*`, risk-scoring, or single-purpose business command tools exist in this version.

## Non-negotiable invariants

These constraints must hold in any implementation, regardless of chosen stack:

- Persistent memory must retain source and distinguish user statement / Agent inference / user decision — never write an inference as if it were a user statement.
- Tags are fully open and Runtime-opaque; the `idea`/`commitment` mutual-exclusivity rule is an Agent self-discipline principle only, never Runtime-enforced. When an idea evolves into a commitment, the Agent should migrate the tag via `memory.revise`, not stack both tags on one memory.
- A given Wake occurrence produces **at most one** user-visible effect, enforced by an internal atomic boundary (`resolve_occurrence` or equivalent) that is never exposed as an Agent-callable tool.
- Cancel or forget, once committed, must block any older in-flight Run from producing a new visible effect (no stale-snapshot races).
- Tool timeout is not a confirmed failure. For the five side-effecting tools, a Tool Result must always state in plain language whether the side effect is confirmed to have happened, confirmed not to have happened (safe to retry), or unknown (must be resolved via a queryable receipt/idempotency key before retrying) — no fixed enum is required, natural language suffices, but this distinction is never optional. Read-only tools don't need this distinction; `isError: true` plus a clear message is enough.
- Absolute-time Wakes must never be scheduled silently when the user's timezone is unknown.
- Forget must cover original content, ordinary indexes, derived summaries, tag indexes, and associated Wakes; nothing recoverable through normal search or replayed events afterward.
- Execution Budget (`max_elapsed_time`, `max_model_rounds`, `max_tool_calls`, `max_output`) is a hard Runtime-enforced ceiling; exhaustion must produce `budget_exhausted`, never be disguised as `completed`.
- Idea-related Runs must never be triggered by `scheduled_wake`.

## Evaluation approach

Acceptance criteria constrain final **Outcome** and **hard constraints**, never a specific tool call sequence, tool count, or "must call X before Y" ordering. The spec's twelve-case Eval dataset (§14) is the reference format: each Eval defines input, existing memory, user preference, current time, allowed outcomes, forbidden behaviors, and hard-constraint checks — not a golden trajectory. For idea-related Evals specifically, the `outcome_correct` scoring dimension is always `not_applicable` — there is no correct creative direction to score against.

The executable form of this is `scripts/evals.ts`: 30 scenarios in a type × difficulty matrix, where LLM scenarios retry once (model variance is real; the gate must distinguish "flaky once" from "systematically broken"). `scripts/burn-in.ts` is the 10-case day-0 gate. Both run against `dist/` — `npm run build:runtime` first (see Gotchas).

## Commands

```bash
npm install
npm run typecheck                               # tsc --noEmit
npm test                                        # vitest run
npm run build                                   # next build (production PWA)
npm run build:runtime                           # tsc -p tsconfig.build.json -> dist/ (Runtime-only, no Next.js)
node --env-file=.env scripts/check-llm.ts       # verify LLM connectivity
node --env-file=.env scripts/repl.ts            # interactive agent REPL
node --env-file=.env scripts/burn-in.ts         # day-0 gate (needs build:runtime first)
node --env-file=.env scripts/evals.ts           # 30-scenario matrix (needs build:runtime first)
```

### Running the server

**Production/default: Docker.** The ledger volume-mounts at `./data`, `restart: unless-stopped` brings it back on reboot or crash, and health check + logs are built in:

```bash
docker compose up -d --build     # rebuild after code changes
docker compose logs -f           # steward logs
docker compose restart
```

The host port is 3100 (container-internal 3000) because 3000 is squatted by another project's container — and `serve.sh status` only checks that something listens on the port, so it false-positives there. Use `PORT=3100` for any host-side run.

`scripts/serve.sh` remains for host-side dev runs. **Never run it against the same ledger while the container is up** — one writer per SQLite file:

```bash
PORT=3100 ./scripts/serve.sh start --dev   # detached dev instance
PORT=3100 ./scripts/serve.sh stop|status|logs
```

State lives in the gitignored `.run/` (`server.log`, `build.log`, `server.pid`,
`mode`). `npm run dev`/`npm start` still work for a foreground session.

## Environment

Copy `.env.example` to `.env` (gitignored) and set:

- `LLM_BASE_URL` — base URL of the LLM endpoint
- `LLM_API_KEY` — API key
- `LLM_MODEL` — model id the endpoint expects (e.g. a MiniMax model id — the endpoint speaks Anthropic's or OpenAI's wire format but is not necessarily backed by an actual Claude/OpenAI model; don't assume vendor-specific capabilities/limits)
- `LLM_API_FORMAT` — `anthropic` (`/v1/messages`, default), `openai` (`/v1/chat/completions`), or `openai-responses` (`/v1/responses`); must match the wire format the endpoint actually speaks, not the model's origin vendor
- `DB_PATH` — SQLite file path (default `./data/kokanee.sqlite`); directory is created if missing

Requires Node.js >= 22.13 (unflagged `node:sqlite`).

## Architecture

```
src/llm/provider.ts       Builds the Model + API key resolver for the configured LLM endpoint.
                           getLlmModel()/setupModels() are for direct pi-ai Models usage
                           (scripts/check-llm.ts); getLlmApiKey() is for pi-agent-core's
                           Agent, which resolves auth via a getApiKey(provider) callback
                           instead of the Models/createProvider registration path.
src/persistence/sqlite.ts SQLite factory (node:sqlite) + transactional, self-healing migrations,
                           plus an idempotent column-addition pass (ALTER TABLE can't live in
                           the re-executed migration list).
src/persistence/id.ts     newId(): globalThis.crypto.randomUUID — NOT node:crypto (see Gotchas).
src/memory/repository.ts  SqliteMemoryRepository: remember/read/revise (CAS)/forget/search.
src/memory/service.ts     MemoryService: in-process, single-use, 10-minute forget confirmation tokens.
src/memory/tools.ts       memory__search/read/remember/revise/forget AgentTool definitions.
                           memory__forget is two-phase inside one tool: no token -> issue one and
                           change nothing; token -> delete. Keeps the surface at exactly eight tools.
src/wake/repository.ts    SqliteWakeRepository: schedule/cancel/claim/resolveOccurrence. resolveOccurrence
                           is the internal atomic boundary — at most one visible effect (or one silent
                           decision) per occurrence — and retires the wake to 'fired' in the same
                           transaction. Never exposed as an Agent tool (spec §12.4).
src/wake/scheduler.ts     LocalWakeScheduler: scans + claims due wakes, including ones missed while down.
src/wake/runner.ts        WakeRunner: per-occurrence scheduled_wake Run; asks the Agent, transports the
                           decision to the atomic boundary. A failed reassessment stays unresolved for a
                           later retry rather than being decided on the Agent's behalf.
src/wake/wake-run-prompt.ts  buildWakeRunPrompt + toDecision. Deliberately free of Agent imports so
                           its tests don't trigger local-runtime's module-level SQLite init.
src/wake/agent-reassessor.ts Runs a real Agent against that prompt.
src/wake/local-time.ts    Asia/Shanghai wall-clock <-> epoch. Rejects timezone-qualified input and
                           dates Date.UTC would silently roll over.
src/wake/tools.ts         wake__list/schedule/cancel AgentTool definitions.
src/conversation/repository.ts   SqliteConversationRepository: persisted chat history.
src/conversation/timeline.ts     readTimeline: merges committed wake reminders (from visible_effects,
                           never double-written) into the message history in time order.
src/conversation/transcript.ts   toAgentMessages: replays stored turns as the Agent's transcript
                           (last 20). Without it every Run starts from zero — see Gotchas.
src/runtime/local-runtime.ts     Wires the local-owner/default-conversation SQLite singletons used by all tools.
src/runtime/run-traces.ts        createRunTraces: per-run audit copy (context, tool calls, stop state).
src/runtime/agent-runtime.ts     Per-run Agent factory + streaming callback, used by the Route Handler.
src/runtime/wake-loop.ts         Idempotent startup scan + 30s polling, started lazily by the GET handler.
src/agent/system-prompt.ts   System prompt + buildTrustedTimeSection (required — see Gotchas).
src/agent/create-agent.ts    Wires model + all 8 tools + system prompt into an Agent instance.
app/page.tsx                 Client chat UI: history, streaming, optimistic send, 15s reminder poll.
app/memory/page.tsx          Read-only knowledge views: markdown cards / timeline / tags / time-spiral
                             graph (SVG). Mutations stay in the Agent's hands.
app/api/memories/route.ts    GET all memories for the /memory page.
app/api/conversations/default/route.ts            GET the merged timeline; starts the wake loop.
app/api/conversations/default/messages/route.ts   POST a message, streams the agent reply, persists it.
next.config.ts            webpack extensionAlias (see Gotchas) + @ducanh2912/next-pwa setup
                          (skipWaiting/clientsClaim so updates land on one reload).
Dockerfile/compose.yaml   Container deployment: ledger volume-mounts ./data, host 3100 -> internal
                          3000, restart unless-stopped, node-based health check.
scripts/serve.sh         Background server management (start/stop/restart/status/logs).
scripts/check-llm.ts     One-shot LLM connectivity check.
scripts/repl.ts          Interactive terminal REPL against the agent.
scripts/burn-in.ts       Day-0 gate: 10 scenarios (4 mechanics, no LLM; 6 agent abilities).
scripts/evals.ts         30-scenario matrix: memory/wake/product × L1/L2/L3; isolated DBs;
                         stub engine for mechanics, real Agent for judgment scenarios.
scripts/eval-lib.ts      Eval harness (isolated ctx, scoped tool factories, dual wake engines).
docs/EXPERIMENT.md       Two-week living-experiment protocol (friction log, decision table).
docs/POSITIONING.md      Where GrandEunuch sits: the lifecycle layer (thinking doc, not spec).
```

Any future architecture must satisfy the spec's invariants (docs/GRAND_EUNUCH.md §16) simultaneously.

## Gotchas

- **Tool names cannot contain dots.** The spec writes tool names as `memory.remember`, but the underlying model API restricts tool names to `[a-zA-Z0-9_-]`. All eight tools use double underscores instead (`memory__remember`, `wake__schedule`, …) — keep that convention for any future tool.
- **`model.baseUrl` is what pi-ai actually dispatches to, not `provider.baseUrl`.** `provider.baseUrl` passed to `createProvider()` is effectively inert for request dispatch — each `Model` object needs its own `baseUrl` set. Getting this wrong silently routes requests to the wrong endpoint instead of erroring.
- **`pi-agent-core`'s `Agent` bypasses the `pi-ai` `Models`/`createProvider` registration entirely.** Its default `streamFn` resolves the API key via the `getApiKey(provider)` option and reads `baseUrl`/`api` straight off the `Model` object — it never touches `createModels()`/`setProvider()`. That registration path is only needed for direct `pi-ai` usage (see `setupModels()` in `src/llm/provider.ts`, used by `scripts/check-llm.ts`).
- **OpenAI-format compat settings are auto-detected from `model.provider` name and `baseUrl`.** When `LLM_API_FORMAT=openai`, pi-ai's `openai-completions` API picks tool-calling format, streaming quirks, etc. based on known provider/URL patterns (OpenRouter, Together, Moonshot, etc.). A generic endpoint URL won't match any pattern and falls back to standard OpenAI behavior — that's usually correct, but if your endpoint has quirks (non-standard tool-call format, streaming differences), set `model.compat` explicitly in `src/llm/provider.ts` rather than relying on auto-detection.
- **`openai-responses` here means the standard `/v1/responses` API, not OpenAI Codex/ChatGPT.** pi-ai also ships a separate `openai-codex-responses` API for ChatGPT-OAuth-based Codex access (JWT-derived account id, hardcoded `chatgpt.com` backend, WebSocket/SSE dual transport) — that is a different, account-bound protocol and is intentionally not wired up here. `LLM_API_FORMAT=openai-responses` only covers the plain API-key-authenticated Responses endpoint.
- **Next.js/webpack won't resolve the NodeNext `.js`-import convention used across `src/`** (files there import sibling `.ts` files as `./foo.js`, required by `tsconfig.json`'s `NodeNext`-style resolution for the standalone `build:runtime` output). `next.config.ts` sets `config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] }` to bridge this for the Next.js build — remove it only if `src/**` imports switch to extensionless.
- **`tsconfig.json` uses `module`/`moduleResolution: "esnext"/"bundler"`, not `NodeNext`, even though `src/**` uses NodeNext-style `.js` imports.** Next.js's own type declarations (`next/server`, etc.) aren't resolvable under `NodeNext` moduleResolution in this setup; `bundler` is required for `app/**` to typecheck. `lib` also needs `DOM`/`DOM.Iterable` for `app/*.tsx` (React DOM element types) alongside `ES2022`.
- **Every Run must carry trusted time, or the Agent dates relative requests from its training data.** Without `buildTrustedTimeSection`, "今天17点提醒我" was resolved to 2025-01-25 13:20 — a wake born already-expired, fired instantly, and the user was told "已安排". Relatedly, never ask the model for an epoch timestamp: `wake__schedule` takes a wall-clock string and `src/wake/local-time.ts` converts it, and past times are rejected as "not scheduled, safe to retry" rather than scheduled.
- **The wake-reassessment prompt's wording decides whether reminders arrive at all.** Phrasing that made silence the safe default ("re-evaluate from scratch whether interrupting is justified") caused the Agent to go silent whenever memory search came up empty — which is most wakes, since scheduling a reminder doesn't imply storing a memory. The prompt must state that delivery is the default and that an empty memory search is not grounds for silence. `src/wake/wake-run-prompt.test.ts` locks these clauses: the prompt is a behavioral contract, not copy.
- **In `scripts/serve.sh`, the listening process on `$PORT` is the source of truth, not the recorded PID.** The server is launched via `nohup npx ...`, so `$!` is the `npx` wrapper, not the Next.js server — `kill`ing or `kill -0`ing it gives wrong answers. `running_pid()` resolves the real process with `lsof -ti :$PORT -sTCP:LISTEN`, and `stop` derives the process group via `ps -o pgid=` so Next's child workers die too. macOS has no `setsid`, hence `nohup` + `disown`.
- **Use `newId()` from `src/persistence/id.ts`, never `import { randomUUID } from "node:crypto"`.** Anything reachable from a Route Handler gets bundled by webpack, which refuses `node:`-scheme imports with `UnhandledSchemeError` (and bare `fs`/`crypto` don't resolve either). `globalThis.crypto.randomUUID()` sidesteps it. `node:sqlite` is the exception — it must be loaded via `createRequire`, as it is in `src/persistence/sqlite.ts`.
- **The wake loop starts lazily from the GET Route Handler, not from `instrumentation.ts`.** A root `instrumentation.ts` is the idiomatic startup hook, but webpack bundles its whole dependency graph and then can't resolve the `node:` builtins underneath SQLite. Lazy start is fine here because the server is only useful once the page has been opened, and `startLocalWakeLoop()` is idempotent.
- **Next.js does not need `--env-file`** — it loads `.env` itself (the startup banner prints `Environments: .env`). Only the standalone `scripts/*.ts` entry points need `node --env-file=.env`.
- **Each Run replays stored history via `toAgentMessages`, so a wrong assistant turn becomes "established fact" for later Runs.** Before this existed the Agent started every request from zero and could not honour a follow-up like "确认删除" — the two-phase forget was structurally unreachable. But replay has a cost worth knowing: in testing, one incorrect assistant reply ("这条记忆并不存在") led later Runs to answer from that claim *without calling any tool*, so the memory stayed undeletable until the conversation was cleared. Prompt guidance that a stored turn is not evidence about current state — verify with a tool — matters more here than the replay limit does.
- **Returning `isError: true` from a tool does nothing — pi-agent-core derives the model-visible error flag solely from whether `execute()` threw.** `AgentToolResult` has no `isError` field at all; the flag on the `toolResult` message comes from `agent-loop.js`'s try/catch (`{ result, isError: false }` on success). The field survives typecheck only because `AgentTool`'s `TDetails` defaults to `any`, which disables excess-property checking — a misspelled field would be swallowed just as silently. Consequence: the spec's "state whether the side effect happened" requirement is carried **entirely by the Tool Result text**, which is why the tool tests assert on wording ("No wake was scheduled — safe to retry") rather than on a flag. Don't add `isError` to new tools expecting it to mean anything; if a tool must be flagged as failed, throw.
- **`@ducanh2912/next-pwa` must be wired into `next.config.ts` via `withPWAInit()`** — just having it in `package.json` doesn't generate `public/sw.js`. It's disabled in development (`disable: process.env.NODE_ENV === "development"`) so `npm run dev` won't produce a service worker; check `npm run build && npm start` for the PWA/installability path.
- **Standalone `scripts/*.ts` entry points import from `../dist/*.js`, not `../src/*.ts`** — plain node can't resolve `src/**`'s NodeNext-style `.js` sibling imports, so run `npm run build:runtime` first. (`check-llm.ts` predates this and only survives because `provider.ts` has no local `.js` imports.) Dist is built with `declaration: true`, so scripts can also import its types.
- **styled-jsx cannot style elements rendered by child components.** `nav a { … }` in a styled-jsx block silently never matches when the `<a>` is rendered inside `<Link>` — the link falls back to default blue/underline. Either target a host element you own (`nav :global(a)`) or, better, move shared classes (`.pill`) into `globals.css` and put `className` on the `Link` itself.
- **One writer per `data/kokanee.sqlite`.** The Docker container is the runtime; a host-side `serve.sh` instance is dev-only and must not run against the same ledger concurrently (two wake loops, split-brain debugging). SQLite `busy_timeout` (5s) absorbs brief contention like build-time module evaluation, not two live servers.
- **Docker: Docker Hub pulls can time out from this network — prefer images already in the local cache (`node:22-bookworm-slim` is there).** And `npm start` pins `--hostname 127.0.0.1`, which breaks port mapping; the container CMD overrides with `next start -H 0.0.0.0`.
- **Eval reply assertions: keep regexes generous, prefer DB-level assertions.** Three separate incidents where the Agent's behavior was correct (perfect abstention phrased as “查不到”“删掉了”“没有找到”) but a narrow reply regex scored it as failure. Assert on persisted facts first (rows created/deleted, wake counts); treat reply text as loose secondary evidence. LLM judgment scenarios retry once — see Evaluation approach.
- **Enter-to-send must check `event.nativeEvent.isComposing`.** The user types Chinese; during IME composition Enter confirms candidates. Intercepting it sends half-composed messages.
