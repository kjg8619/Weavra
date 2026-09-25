# Weavra architecture overview

Start here. This page is the map: what Weavra is, how one run flows through the code, and who decides what. Detailed contracts live in the linked documents and in `runtime/pi/packages/company-runtime/README.md` (the Runtime reference; Korean).

## What Weavra is

Weavra is a coding-agent runtime built on the Pi agent SDK, with a desktop/web host app derived from T3 Code. Its central rule is that **the model never decides that work is done**. A Kernel state machine writes `COMPLETED` only after it re-checks bound evidence: the Developer's actual Git diff, fresh runs of Host-registered checks, an independent Reviewer's verdict per acceptance criterion and, for the one supported destructive action, a human approval.

## Repository map

| Path | What it is | Build root |
| --- | --- | --- |
| `runtime/pi/packages/company-runtime` | **Weavra Runtime** (Kernel, workflow, workers, policy, state, verifier, host bridge/control, launcher `bin/weavra`) | npm (`runtime/pi`) |
| `runtime/pi/packages/{agent,ai,coding-agent,tui}` | Pi SDK the Runtime builds on (sessions, providers, tools, TUI) | npm |
| `runtime/pi/packages/evals` | Fitness corpus and the Weavra-vs-Pi benchmark | npm |
| `app/t3code/apps/server/src/weavra` | App side of the Runtime link: `RuntimeController`, `BridgeTransport`, `ControlTransport`, `FitnessReader` | pnpm (`app/t3code`) |
| `app/t3code/packages/contracts/src/weavra*.ts` | App copies of the wire schemas (deliberately duplicated) | pnpm |
| `app/t3code/apps/web/src/components/settings/Weavra*.tsx` | Project Settings panel: status, graph, evidence, limited controls | pnpm |
| `scripts/` | Root gates: `validate.mjs pi|t3`, cross-boundary and capability smokes, import provenance | none |
| `docs/architecture` | Contracts: [BOUNDARIES](BOUNDARIES.md), [STATE_STORE](STATE_STORE.md), [CAPABILITY_BROKER](CAPABILITY_BROKER.md), [PROJECT_FACTS](PROJECT_FACTS.md), [COMPLEX design](COMPLEX_SEQUENTIAL_WORKFLOW.md), [PRODUCT_INDEPENDENCE](PRODUCT_INDEPENDENCE.md) | none |

The two build roots never import each other. The App talks to the Runtime only through the stdio Weavra protocol (`weavra bridge --stdio` for read-only snapshots, `--control` for prepare/confirm/cancel/approval).

## One STANDARD run

Paths below are relative to `runtime/pi/packages/company-runtime/src`.

1. **Plan.** `/workflow run <goal>` (`extension.ts`) calls `prepareHostWorkflowDraft` (`host-workflow.ts`). `proposeExecutionMode` (`execution-contract.ts`) picks EDIT or READ_ONLY, and `classifyRequest` (`classification.ts`) picks QUICK/STANDARD and risk R0–R3. The user edits acceptance criteria in the Plan Preview (`plan-preview.ts`) and confirms. The confirmation freezes a Task Contract (`task-contract.ts`); it is not an approval.
2. **Start.** `StandardWorkflow.execute` (`workflow.ts`) re-checks every binding, then:
   - takes the project writer lock (`state-store.ts`),
   - creates the worker adapter (`agent-runner.ts`),
   - snapshots Git (`workspace.ts`) and freezes the check registrations (`verification.ts`),
   - creates the Kernel (`kernel.ts`).
3. **implement.** A Developer runs in a fresh SDK session with no inherited context. Its tools (`agent-tools.ts`) are read, search, list, write and edit on allowed paths, plus `runtime_request_check` (advisory runs only when opted in) and `submit_handoff`. There is no shell. Every file action goes through `executePolicyAction` (`policy.ts`), which records a durable intent before execution and the outcome after. Correctable tool errors go back to the model; Policy denials end the worker.
4. **self-check.** `RegisteredVerifier` runs the registered checks fresh and records the diff digest.
5. **review.** A Reviewer in another fresh session, with read-only tools, judges each acceptance criterion by ID. It may cite only verifier evidence references. A REVISE verdict returns to implement, up to `max_revision_cycles` (default 1).
6. **test.** The checks run fresh again.
7. **complete.** `assertCanComplete` (`kernel.ts`) re-validates the whole run: same run, revision and step, both verification stages passed, review digest equals final-check digest equals the live workspace digest, the Task Contract digest, every criterion met, and approvals where required. Only then is `COMPLETED` written, in exactly one place.

QUICK uses one Executor instead of Developer + Reviewer, and only for R0/R1. R2 (dependency/build files) always needs STANDARD with independent review. R3 supports exactly one action, `delete file <path>`, with a one-time human approval bound to the file's fingerprint.

COMPLEX ([design](COMPLEX_SEQUENTIAL_WORKFLOW.md)) runs one frozen parent Task Contract as 2–8 human-planned tasks, strictly in order under one Run and one writer. It is prepared only through Host Control with a structured plan (the App's task-plan editor); `/workflow run` refuses it and there is no Planner model. `complex-plan.ts` compiles the plan deterministically. Each task runs implement → self-check → contribution review → test. It may change only its exact claimed files (`complex-ownership.ts` checks before Policy and again at the effect). Then integration runs every registered check, a new independent final Reviewer and the checks again. `assertCanCompleteComplex` (`kernel.ts`) decides completion. The App shows the Runtime's `complexExecution` projection and cannot advance tasks.

## Who decides what

| Decision | Owner | Not decided by |
| --- | --- | --- |
| Whether a tool action may run | Policy (`policy.ts`), audited in `state.json` | the model, prompts or project instructions |
| A deletion (R3) | the human, once, for one fingerprinted file | Plan confirmation, R2 binding |
| Check results (evidence) | `RegisteredVerifier` fresh runs | advisory runs, browser candidates, handoff text |
| Review verdict | an independent Reviewer session | the Developer |
| Which task may change which file (COMPLEX) | the confirmed plan's exact-file claims, checked before and at each effect | Policy ALLOW alone, dependencies between tasks, the App |
| Completion | the Kernel, after `assertCanComplete` | the App, transport success, any worker |
| Whether the interactive `weavra` conversation runs a destructive or unclassified shell command (#5) | the user, in the command guard's prompt: destructive per call, an unclassified command per call or for the session (memory only); refused without a UI | the local classifier, which only explains; workers have no shell at all |

Browser observations are `CANDIDATE_ONLY`. Registering a browser check is not verification; only fresh captures by `RegisteredVerifier` count. Reviewed project facts are advisory context only.

## Files on disk (per project)

`.ai/config.yaml` is user-owned. The Runtime owns:

- `.ai/state.json`: canonical runs, the action audit and the archived-run index
- `.ai/tasks.json`: projection of `state.json`
- `.ai/writer.lock`: single writer lock, recoverable only from a provably dead same-host owner
- `.ai/runs/<runId>.json`: archived terminal runs
- `.ai/decisions.md` and `.ai/logs/checks.json`: explicit `/state export` output

None of these may be tracked in Git. Worker session transcripts live under the Weavra home (`~/.weavra/agent`), never in the workspace. See [STATE_STORE](STATE_STORE.md).

## Labels you will see

- **S1–S6:** the first vertical slices, in order: pure Kernel, file StateStore + Policy, Pi SDK adapter, STANDARD execution, S5A QUICK / S5B R2 / S5C R3 / S5D observation, S6 hardening.
- **V0.x:** feature milestones. Examples:
  - V0.3A anchored edit, V0.3B LSP, V0.3E Task Contract, V0.3F measurement
  - V0.4A–C strict mutation, verifier trust, sandbox
  - V0.5C verification repair
  - V0.6A Host bridge/control, V0.6C browser observation, V0.6D project facts
  - V0.7A capability broker, V0.7B COMPLEX sequential workflow
- **C0x / FIX-0x / FEAT-0x:** capability or issue codes from the roadmap. C06 is the provider Fitness harness, C07 Host control, C08 browser observation, C09 project facts.
- **LOG-###:** entries in the historical Runtime work log. Current work is logged in the root `docs/WORK_LOG.md`.
- **AC-###:** Host-assigned acceptance-criterion IDs inside a Task Contract.

## Validating a change

- Runtime: `npm run check` in `runtime/pi` (lint, types, dependency and lock checks), focused vitest files, then `node scripts/validate.mjs pi` from the root, which runs the full isolated `test.sh` suite.
- App: `node scripts/validate.mjs t3`.
- Across the boundary: `node scripts/run-cross-boundary.mjs` (needs `WEAVRA_CHROMIUM`), `node scripts/run-capability-boundary.mjs` and `node scripts/run-complex-integration.mjs` (COMPLEX Runtime→App corpus with a scripted loopback model).
- Tests use faux or scripted loopback models only. Real model runs (`weavra fitness`, `npm run benchmark`, `scripts/complex-live-smoke.mjs`) require an explicit paid opt-in.
- CI runs the same three gates on every PR to `devlop`.
