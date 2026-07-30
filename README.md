# GrandEunuch (大内总管)

[中文](./README.zh-CN.md) | English

A personal agent, reached through private conversation, that serves two roles:

1. **Secretarial** — reduce the odds of missing important collaborative commitments (promises made to or by you, pending results, unclear responsibilities) while minimizing unnecessary interruption.
2. **Creative** — surface and synthesize your own recorded ideas when you're unsure what to pursue, drawing connections across scattered fragments instead of just recalling them one at a time.

These aren't two separate apps. Both are the same agent pursuing different goals in different runs, sharing one memory store. The full product and runtime contract lives in [`docs/GRAND_EUNUCH.md`](./docs/GRAND_EUNUCH.md) (Chinese, v1.0) — that document is the binding spec; this README is an entry point.

## Status

A working local MVP: a single-user PWA on `127.0.0.1`, no accounts, no cloud, nothing leaving your machine except calls to the LLM endpoint you configure.

Working today:

- All eight tools from the spec — `memory__search/read/remember/revise/forget` and `wake__list/schedule/cancel`
- Memory that survives restarts, versioned with conflict detection, keeping each entry's source and whether it was your statement, the agent's inference, or your decision
- Reminders that re-evaluate themselves: when a wake comes due the agent reconsiders whether interrupting you is still warranted, rather than replaying a canned message
- Forgetting that requires explicit confirmation and takes the associated reminders with it
- A chat UI with streaming replies, permanently stored locally, installable as a PWA
- An LLM provider layer for any endpoint speaking Anthropic's `/v1/messages`, OpenAI's `/v1/chat/completions`, or OpenAI's `/v1/responses`

Not yet built: the Run Coordinator and Execution Budget ceilings, the spec's twelve-case Eval dataset, and browser E2E tests. Timezone is fixed to `Asia/Shanghai`. Reminders appear in-app only — no browser notifications.

## Setup

Requires Node.js >= 22.13 (unflagged `node:sqlite`).

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

| Variable | Meaning |
|---|---|
| `LLM_BASE_URL` | Base URL of your LLM endpoint |
| `LLM_API_KEY` | API key |
| `LLM_MODEL` | Model id the endpoint expects |
| `LLM_API_FORMAT` | `anthropic` (`/v1/messages`, default), `openai` (`/v1/chat/completions`), or `openai-responses` (`/v1/responses`) — must match the wire format your endpoint actually speaks |
| `DB_PATH` | SQLite file path (default `./data/kokanee.sqlite`); directory is created if missing |

## Running it

```bash
./scripts/serve.sh start      # build + start in the background
./scripts/serve.sh status
./scripts/serve.sh restart
./scripts/serve.sh stop
./scripts/serve.sh logs
```

Then open http://127.0.0.1:3000.

Run it detached like this rather than in a terminal session: reminders only fire while the server is up. If it was down when one came due, the next start processes it once.

## Commands

```bash
npm run typecheck                               # tsc --noEmit
npm test                                        # vitest run
npm run build                                   # next build
node --env-file=.env scripts/check-llm.ts       # verify LLM connectivity
node --env-file=.env scripts/repl.ts            # interactive agent REPL
```

## Architecture

```
app/                       Next.js App Router: chat UI + local HTTP API
src/agent/                 System prompt (incl. trusted time) + Agent wiring
src/llm/provider.ts        LLM provider + auth for the configured endpoint
src/memory/                Versioned memory: repository, forget confirmations, 5 tools
src/wake/                  Reminders: scheduling, due-scan, re-evaluation, 3 tools
src/conversation/          Chat history + the timeline the UI reads
src/persistence/sqlite.ts  Injectable node:sqlite + transactional migrations
src/runtime/               Local wiring: repositories, per-run agents, wake loop
scripts/serve.sh           Background server management
```

The runtime never decides what matters. It guarantees delivery, idempotency, budgets, and atomic commits; every judgment about relevance, timing, and wording belongs to the agent.

See [`CLAUDE.md`](./CLAUDE.md) for implementation gotchas and the architectural rules this project follows (the agent owns judgment; the runtime only guarantees safe execution).
