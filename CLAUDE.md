# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status

This repository currently contains only a design/contract document. No application source, package manifest, build configuration, test framework, or lint configuration exists yet.

Do not assume a language, framework, package manager, directory layout, or development command. Derive these from committed project files once implementation starts, then update this document.

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
- Tool timeout is not a confirmed failure. If the Runtime cannot prove a side effect did not happen, it must return `outcome_unknown` together with a queryable receipt/idempotency key — never silently retry the side effect itself.
- Absolute-time Wakes must never be scheduled silently when the user's timezone is unknown.
- Forget must cover original content, ordinary indexes, derived summaries, tag indexes, and associated Wakes; nothing recoverable through normal search or replayed events afterward.
- Execution Budget (`max_elapsed_time`, `max_model_rounds`, `max_tool_calls`, `max_output`) is a hard Runtime-enforced ceiling; exhaustion must produce `budget_exhausted`, never be disguised as `completed`.
- Idea-related Runs must never be triggered by `scheduled_wake`.

## Evaluation approach

Acceptance criteria constrain final **Outcome** and **hard constraints**, never a specific tool call sequence, tool count, or "must call X before Y" ordering. The spec's twelve-case Eval dataset (§14) is the reference format: each Eval defines input, existing memory, user preference, current time, allowed outcomes, forbidden behaviors, and hard-constraint checks — not a golden trajectory. For idea-related Evals specifically, the `outcome_correct` scoring dimension is always `not_applicable` — there is no correct creative direction to score against.

## Development commands

There are currently no project commands for development, build, lint, test, or running a single test. Add commands here only after their corresponding configuration is committed.

## Architecture

No application architecture or cross-file data flow exists yet. Document module boundaries and data flows here once they can be verified from the implementation. Any future architecture must satisfy the spec's invariants (docs/GRAND_EUNUCH.md §16) simultaneously.
