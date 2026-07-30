# GrandEunuch (大内总管)

[中文](./README.zh-CN.md) | English

A personal agent, reached through private conversation, that serves two roles:

1. **Secretarial** — reduce the odds of missing important collaborative commitments (promises made to or by you, pending results, unclear responsibilities) while minimizing unnecessary interruption.
2. **Creative** — surface and synthesize your own recorded ideas when you're unsure what to pursue, drawing connections across scattered fragments instead of just recalling them one at a time.

These aren't two separate apps. Both are the same agent pursuing different goals in different runs, sharing one memory store. The full product and runtime contract lives in [`docs/GRAND_EUNUCH.md`](./docs/GRAND_EUNUCH.md) (Chinese, v1.0) — that document is the binding spec; this README is an entry point.

## Status

This is a skeleton, not the full spec. Currently working:

- An LLM provider layer that talks to any endpoint speaking Anthropic's `/v1/messages`, OpenAI's `/v1/chat/completions`, or OpenAI's `/v1/responses` wire format
- An agent loop built on [`pi-agent-core`](https://www.npmjs.com/package/@earendil-works/pi-agent-core)
- Two of the eight tools defined in the spec: `memory.remember` and `memory.search`, backed by SQLite (`node:sqlite`, survives restarts)

Not yet implemented: `memory.read`, `memory.revise`, `memory.forget`, `wake.list`, `wake.schedule`, `wake.cancel`, and automated tests.

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

## Commands

```bash
npm run typecheck                              # tsc --noEmit
npm run build                                   # compile to dist/
node --env-file=.env scripts/check-llm.ts       # verify LLM connectivity
node --env-file=.env scripts/repl.ts            # interactive agent REPL
```

## Architecture

```
src/llm/provider.ts       LLM provider + auth for the configured endpoint
src/memory/store.ts       SQLite-backed store (node:sqlite, file at DB_PATH)
src/memory/tools.ts       memory__remember / memory__search tool definitions
src/agent/system-prompt.ts
src/agent/create-agent.ts Wires model + tools + prompt into an Agent
scripts/check-llm.ts      One-shot connectivity check
scripts/repl.ts           Interactive terminal REPL
```

See [`CLAUDE.md`](./CLAUDE.md) for implementation gotchas and the architectural rules this project follows (the agent owns judgment; the runtime only guarantees safe execution).
