# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

MVP working end-to-end. All eight spec tools implemented (`memory__search/read/remember/revise/forget`, `wake__list/schedule/cancel`), backed by SQLite (`node:sqlite`, survives restarts, self-healing transactional migrations). Next.js App Router PWA (`app/`) serves a local chat UI over the same Runtime — send message → streamed reply → persisted to `conversation_messages` → restored on refresh. 10 vitest tests pass. Not yet implemented: Run Coordinator/Execution Budget, the 12-case Eval harness, Playwright E2E — see `docs/GRAND_EUNUCH.md` and the plan for what's left.

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

## Commands

```bash
npm install
npm run typecheck                               # tsc --noEmit
npm test                                        # vitest run
npm run build                                   # next build (production PWA)
npm run build:runtime                           # tsc -p tsconfig.build.json -> dist/ (Runtime-only, no Next.js)
node --env-file=.env scripts/check-llm.ts       # verify LLM connectivity
node --env-file=.env scripts/repl.ts            # interactive agent REPL
```

### Running the local server

`scripts/serve.sh` manages the server as a detached background process, which is
how it should normally be run: wakes only fire while it is up, so a foreground
`npm run dev` tied to a terminal session means missed reminders.

```bash
./scripts/serve.sh start          # build + start detached (production)
./scripts/serve.sh start --dev    # start detached in dev mode (hot reload, no build)
./scripts/serve.sh restart        # restart; accepts --dev too
./scripts/serve.sh stop
./scripts/serve.sh status
./scripts/serve.sh logs           # tail -f the server log
PORT=3100 ./scripts/serve.sh start
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
src/persistence/sqlite.ts SQLite factory (node:sqlite) + transactional, self-healing migrations.
src/memory/repository.ts  SqliteMemoryRepository: remember/read/revise (CAS)/forget/search.
src/memory/service.ts     MemoryService: two-click forget confirmation tokens.
src/memory/tools.ts       memory__search/read/remember/revise/forget AgentTool definitions.
src/wake/repository.ts    SqliteWakeRepository: schedule/cancel/claimDueOccurrences/resolveOccurrence.
src/wake/scheduler.ts     LocalWakeScheduler: scans + claims overdue wakes once on restart.
src/wake/tools.ts         wake__list/schedule/cancel AgentTool definitions.
src/conversation/repository.ts   SqliteConversationRepository: persisted chat history (user/assistant/reminder).
src/runtime/local-runtime.ts     Wires the local-owner/default-conversation SQLite singletons used by all tools.
src/runtime/agent-runtime.ts     Per-run Agent factory + streaming callback, used by the Route Handler.
src/agent/system-prompt.ts   System prompt text.
src/agent/create-agent.ts    Wires model + all 8 tools + system prompt into an Agent instance.
app/page.tsx                 Client chat UI: loads history, streams replies, optimistic send.
app/api/conversations/default/route.ts            GET persisted conversation history.
app/api/conversations/default/messages/route.ts   POST a message, streams the agent reply, persists it.
next.config.ts            webpack extensionAlias (see Gotchas) + @ducanh2912/next-pwa setup.
scripts/check-llm.ts     One-shot LLM connectivity check.
scripts/repl.ts          Interactive terminal REPL against the agent.
```

Any future architecture must satisfy the spec's invariants (docs/GRAND_EUNUCH.md §16) simultaneously.

## Gotchas

- **Tool names cannot contain dots.** The spec writes tool names as `memory.remember`, but the underlying model API restricts tool names to `[a-zA-Z0-9_-]`. Implementation uses double underscores instead (`memory__remember`, `memory__search`) — apply the same convention for the remaining six tools.
- **`model.baseUrl` is what pi-ai actually dispatches to, not `provider.baseUrl`.** `provider.baseUrl` passed to `createProvider()` is effectively inert for request dispatch — each `Model` object needs its own `baseUrl` set. Getting this wrong silently routes requests to the wrong endpoint instead of erroring.
- **`pi-agent-core`'s `Agent` bypasses the `pi-ai` `Models`/`createProvider` registration entirely.** Its default `streamFn` resolves the API key via the `getApiKey(provider)` option and reads `baseUrl`/`api` straight off the `Model` object — it never touches `createModels()`/`setProvider()`. That registration path is only needed for direct `pi-ai` usage (see `setupModels()` in `src/llm/provider.ts`, used by `scripts/check-llm.ts`).
- **OpenAI-format compat settings are auto-detected from `model.provider` name and `baseUrl`.** When `LLM_API_FORMAT=openai`, pi-ai's `openai-completions` API picks tool-calling format, streaming quirks, etc. based on known provider/URL patterns (OpenRouter, Together, Moonshot, etc.). A generic endpoint URL won't match any pattern and falls back to standard OpenAI behavior — that's usually correct, but if your endpoint has quirks (non-standard tool-call format, streaming differences), set `model.compat` explicitly in `src/llm/provider.ts` rather than relying on auto-detection.
- **`openai-responses` here means the standard `/v1/responses` API, not OpenAI Codex/ChatGPT.** pi-ai also ships a separate `openai-codex-responses` API for ChatGPT-OAuth-based Codex access (JWT-derived account id, hardcoded `chatgpt.com` backend, WebSocket/SSE dual transport) — that is a different, account-bound protocol and is intentionally not wired up here. `LLM_API_FORMAT=openai-responses` only covers the plain API-key-authenticated Responses endpoint.
- **Next.js/webpack won't resolve the NodeNext `.js`-import convention used across `src/`** (files there import sibling `.ts` files as `./foo.js`, required by `tsconfig.json`'s `NodeNext`-style resolution for the standalone `build:runtime` output). `next.config.ts` sets `config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] }` to bridge this for the Next.js build — remove it only if `src/**` imports switch to extensionless.
- **`tsconfig.json` uses `module`/`moduleResolution: "esnext"/"bundler"`, not `NodeNext`, even though `src/**` uses NodeNext-style `.js` imports.** Next.js's own type declarations (`next/server`, etc.) aren't resolvable under `NodeNext` moduleResolution in this setup; `bundler` is required for `app/**` to typecheck. `lib` also needs `DOM`/`DOM.Iterable` for `app/*.tsx` (React DOM element types) alongside `ES2022`.
- **In `scripts/serve.sh`, the listening process on `$PORT` is the source of truth, not the recorded PID.** The server is launched via `nohup npx ...`, so `$!` is the `npx` wrapper, not the Next.js server — `kill`ing or `kill -0`ing it gives wrong answers. `running_pid()` resolves the real process with `lsof -ti :$PORT -sTCP:LISTEN`, and `stop` derives the process group via `ps -o pgid=` so Next's child workers die too. macOS has no `setsid`, hence `nohup` + `disown`.
- **Next.js does not need `--env-file`** — it loads `.env` itself (the startup banner prints `Environments: .env`). Only the standalone `scripts/*.ts` entry points need `node --env-file=.env`.
- **`@ducanh2912/next-pwa` must be wired into `next.config.ts` via `withPWAInit()`** — just having it in `package.json` doesn't generate `public/sw.js`. It's disabled in development (`disable: process.env.NODE_ENV === "development"`) so `npm run dev` won't produce a service worker; check `npm run build && npm start` for the PWA/installability path.
