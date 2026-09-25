# Planner draft — V0.8B architecture contract

## 1. Status, decision, and scope

**DESIGN ONLY; proposed contract freeze for review.** This document resolves [#51](https://github.com/kjg8619/Weavra/issues/51). It is the implementation contract for [Runtime #52](https://github.com/kjg8619/Weavra/issues/52), [App #53](https://github.com/kjg8619/Weavra/issues/53) and the boundary corpus of [#54](https://github.com/kjg8619/Weavra/issues/54). Roadmap: [#59](https://github.com/kjg8619/Weavra/issues/59).

- **Baseline:** `devlop` `20ff4632`. #15–#22 are closed. The CI boundary corpora (COMPLEX 14, PARALLEL 9) are green with falseCompletion 0.
- **Branch:** dedicated branch `design/v0.8b-planner-contract`. This PR changes no Runtime or App behavior.

> A COMPLEX Run needs a human-written task plan today: 2–8 tasks with titles, goals, AC mapping, exact-file claims, dependencies and checks. V0.8B adds a **Planner**, a model session that *proposes* such a plan as **candidate data**. The Runtime validates the candidate with the existing deterministic compiler. The human loads it into the existing plan editor, changes what they want, and runs the unchanged prepare → preview → confirm path. The Planner has no authority. Nothing it produces runs until the human confirms a Host preview.

This instantiates the future role that [COMPLEX_SEQUENTIAL_WORKFLOW.md §3](COMPLEX_SEQUENTIAL_WORKFLOW.md) anticipated: "propose decomposition, order, AC mapping, ownership, dependencies … as structured data". It is the reviewed amendment that document requires before a Planner exists (§16). Every V0.7B/V0.8A authority rule still applies; this document names the only additions.

**Chosen minimum:**
- **Tool-less session.** The Planner gets a bounded, Host-assembled **Planning Context** in its prompt and has exactly one tool, `submit_plan_draft`. It has no read, search, list, LSP, shell, write or Git tools.
- **Asynchronous Host commands.** `planner.start` returns at once. The session runs in the background, the snapshot carries its status, and `planner.read` returns a READY draft. The control queue is serial, and the App's per-request timeout is 10 s, so a model call must never run inside a command.
- **Same validation as prepare.** The Host dry-runs the draft through the exact `workflow.prepare` pipeline, including claim facts and Policy. A READY draft therefore prepares cleanly at the same project revision and configuration.
- **Nothing durable.** There is no writer lock, no `.ai` write, no Run and no project revision change. Planner state lives in the Host process only.
- **Fixed small budget.** At most 3 model invocations and a capped token total, reported in the snapshot.

## 2. Authority boundary

| The Planner may | The Planner may not |
| --- | --- |
| Propose 2–8 tasks: titles, goals, `criterionIndexes`, `dependsOnIndexes`, exact-file claims (`create`/`modify`) and `checkIds`, within the existing `ComplexDraft` closed schema | Change the goal, the acceptance statements, the execution mode, Risk, allowed paths, registered checks, budgets, `maxParallel` or any configuration |
| Read the Planning Context the Host gives it | Read, search or list files itself; run commands; write, delete or stage anything; call Git |
| Receive one bounded compiler error and submit one corrected draft | Submit IDs, statuses, digests, limits, Risk, permissions, `delete` claims or anything else outside the closed draft schema (rejected before compilation) |
| Be cancelled at any time | Start a Run, prepare, confirm, approve, or claim PASS/COMPLETE |

Text inside the Planning Context, such as file names, project instructions and facts, is data. A draft steered by such text is still only a candidate: the compiler validates it and the human reviews it.

A READY draft is advice. The App must never submit it automatically. The human must load it, and then prepare and confirm, which are two further explicit actions. `workflow.prepare` recompiles whatever the editor holds, so the Host never trusts the Planner's earlier validation. Completion authority stays with the Kernel (`assertCanCompleteComplex`).

## 3. Flow and state machine

```text
App: planner.start {goal, acceptanceStatements}
  → Host: same classification as prepare → COMPLEX (non-R3) and a draft is required?  else refused, no model call
  → Host: idle? (no active Run, no writer, no execution, no planning)                  else refused, no model call
  → accepted; planner = RUNNING                         (returns at once)
      background: build Planning Context → Planner session → submit_plan_draft
                  → schema check → dry-run prepare pipeline
                     ok      → READY (draft kept in memory)
                     invalid → one correction turn → READY | FAILED/DRAFT_INVALID
App: snapshot.planner shows RUNNING/READY/FAILED/CANCELLED (small, no draft)
App: planner.read {planId} → the READY draft → user loads it into the editor, edits
App: workflow.prepare {goal, statements, complexDraft} → preview → workflow.confirm   (unchanged)
```

| From | To | Cause |
| --- | --- | --- |
| — | RUNNING | `planner.start` accepted |
| RUNNING | READY | A submitted draft passed the schema and the dry-run prepare pipeline |
| RUNNING | FAILED | A failure code in §5.5 |
| RUNNING | CANCELLED | `planner.cancel`, owner disconnect, or Host shutdown |
| READY, FAILED, CANCELLED | (replaced) | A new `planner.start` replaces the previous state |
| READY, FAILED, CANCELLED | (cleared) | A successful `workflow.confirm`: the Run starts, and the planner state is dropped |

The state machine has no other transitions. A terminal planner state never becomes RUNNING again; the user starts a new planning request.

## 4. Planning Context

The Host builds the context deterministically, before the first model call, from the same sources `workflow.prepare` uses. It is the first user message, one JSON object with `role: "Planner"`, like worker requests. That lets the scripted loopback model and the corpora answer it.

| Part | Source | Bound |
| --- | --- | --- |
| Goal and acceptance statements, labelled `AC-001`… in the compiler's order; without statements, the goal is the only AC (`AC-001`), as in prepare | The `planner.start` request | Goal ≤2,048 characters; ≤16 statements of ≤500 characters |
| Execution mode (EDIT or READ_ONLY) and Risk | The same classification as prepare | — |
| Plan rules | Fixed Host text | The §4 limits of COMPLEX_SEQUENTIAL_WORKFLOW and V0.8A `maxParallel`: 2–8 tasks, earlier-row dependencies, full AC coverage, exclusive exact-file claims, `create` needs a missing file in an existing directory, `modify` needs an existing UTF-8 text file, READ_ONLY has zero claims, required checks only |
| Registered checks | `.ai/config.yaml` | `id`, `kind`, `required` only; never `executable` or `args` |
| Allowed paths | `files.allowed_paths` | As configured |
| File listing | The same listing and exclusion rules as `runtime_list_files`, rooted at the allowed paths, under current Policy | 500 files, 65,536 bytes, depth ≤4; `.ai/` and protected paths never appear |
| Project instructions | The existing snapshot | ≤64 KiB, not truncated |
| Project facts | VALID facts only, rechecked as for workers | ≤16 |

The whole context is at most **196,608 UTF-8 bytes**. If it would be larger, planning ends FAILED/`CONTEXT_TOO_LARGE` before any model call. Nothing is truncated silently.

The context carries no secrets, credentials, check commands, `.ai` state, Run history, evidence or diffs. File contents are never included; only names are. Sending the context to the configured provider has the same privacy boundary as a worker prompt.

## 5. Planner session

### 5.1 Routing

The Planner is a new worker role, `Planner`, routed through a new optional intent alias, `models.intents.plan`. Without the alias it uses the `reasoning` profile, the same default as Reviewers. There is no fallback: an unavailable alias, profile, model or credential ends FAILED/`MODEL_UNAVAILABLE`. The snapshot reports the requested route (alias → profile → provider/model), as #5 candidate 3 does for other roles.

### 5.2 Session shape

- A fresh SDK session with no skills, no extensions and no AGENTS discovery. Compaction and retry are off, as for workers.
- **Exactly one tool: `submit_plan_draft`.** Its parameters are the closed `ComplexDraft` schema, `{ tasks: [...] }`. A call to any other tool name is treated like an answer without a submission. An answer with more than one `submit_plan_draft` call is one failed submission.
- The Planner is not the Run-bound `PiAgentExecutor`. There is no runId, no `ActionAudit` and no measurement step, because no Run exists and the Planner has no audited tools.
- **Timeout:** the existing `agents.worker_timeout_ms` (default 180,000 ms) covers the whole planning request.

### 5.3 Submission and correction

1. **Schema check.** The Host checks each submission against the closed schema first.
2. **Dry-run.** It then runs the `workflow.prepare` pipeline with the request's goal and statements and the submitted draft: `prepareHostWorkflowDraft` → `finalizeComplexHostWorkflowPlan` → `compileComplexPlan`, including `claimFactsError` against the filesystem and current Policy. Nothing is stored; there is no preview, writer or Run.
3. **Pass.** If both pass, the state becomes READY with the draft exactly as submitted.
4. **First failure.** The Host answers the tool call with one bounded correction message of at most 2,048 bytes. The message holds the Host-side error code and the compiler's own message. That message names only the draft's own fields and paths and the violated rule. It never includes file contents, check commands or state. The model may submit once more.
5. **Second failure.** A second failing submission ends FAILED/`DRAFT_INVALID`.
6. **No submission.** If the model answers with text and no tool call, the Host sends one fixed reminder. If the next answer again has no submission, planning ends FAILED/`NO_DRAFT`.

### 5.4 Budget and usage

- **Invocation cap:** at most **3 model invocations** per planning request: the first answer, at most one reminder (§5.3 step 6) and at most one correction (§5.3 step 4). A reminder, when used, comes first.
- **Token cap:** `min(200,000, budget.max_reported_tokens)` reported tokens.
- **Reservation:** the Host reserves each invocation before the call, with the existing `BudgetController` semantics. Unknown usage makes the total unknown, and with a token cap it denies the next reservation.
- **Scope:** planning usage belongs to no Run ledger. The snapshot reports it as `{ invocations, reportedTokens | null }`. It is not persisted.

### 5.5 Failure codes (closed)

| Code | Meaning |
| --- | --- |
| `MODEL_UNAVAILABLE` | No usable alias, profile, model or credential. There is no fallback. |
| `CONTEXT_TOO_LARGE` | The Planning Context exceeds 196,608 bytes. No model call is made. |
| `TIMEOUT` | `worker_timeout_ms` elapsed. |
| `PROVIDER_ERROR` | The provider failed, or the stream ended abnormally. |
| `BUDGET_EXHAUSTED` | The invocation or token cap was reached before a valid draft. |
| `BUDGET_UNKNOWN` | Unknown usage with a token cap denied the next reservation. |
| `NO_DRAFT` | No submission after the reminder. |
| `DRAFT_INVALID` | The corrected submission failed the schema or the dry-run pipeline. |
| `STALE` | The project revision or configuration fingerprint changed while RUNNING. The draft would no longer describe the project, so it is discarded. |

`CANCELLED` is a status, not a failure code.

## 6. Binding and staleness

When `planner.start` is accepted, the Host records three values:
- `requestDigest`: `sha256:` followed by the lowercase hex SHA-256 of the UTF-8 bytes of `JSON.stringify(["weavra-planner-request-v1", goal, acceptanceStatements])`. The goal and statements are exactly as sent, and `acceptanceStatements` is `[]` when omitted. The App computes the same value;
- the project revision;
- the configuration fingerprint that `workflow.prepare` compares.

- **While RUNNING:** a change of project revision or configuration ends the request FAILED/`STALE` at the next check. The Host checks before each model call and before READY.
- **After READY:** every snapshot computes `current`. It is true only while the project revision and configuration fingerprint still equal the recorded values. A non-current READY draft stays readable as a starting point, and the App labels it. `workflow.prepare` recompiles regardless, so staleness can never be confirmed by mistake.
- **App side:** the App compares `requestDigest` with its own goal and criteria. If they differ, it labels the draft "for a different goal or criteria".

## 7. Host commands and wire contract

These changes are identical on both sides. The duplicated protocol definitions stay duplicated.

### 7.1 Capability

`control.hello` adds `plannerContractVersion: 1`. When the key is absent (older Runtime), the Planner does not exist on that connection. As with `complexContractVersion`, advertisement is not readiness or permission.

### 7.2 Commands

All three use the existing mutation envelope: `ownerId`, the sequenced request id and `expectedProjectRevision`, as `browser.inspect` does.

| Command | Payload | Success data | Refusals (existing codes unless marked new) |
| --- | --- | --- | --- |
| `planner.start` | `goal`, optional `acceptanceStatements` (the same bounds as prepare) | `{ kind: "accepted", requestId, command: "planner.start", runId: null }` | `STALE_PROJECT`, `ACTIVE_RUN`, `WRITER_PRESENT`, `INVALID_REQUEST`, `INVALID_GOAL`, `UNSUPPORTED_WORKFLOW` (not COMPLEX, or R3), **`PLANNER_BUSY`** (planning or a Run execution already in progress on this Host) |
| `planner.cancel` | `planId` | `{ kind: "accepted", …, command: "planner.cancel", runId: null }` | **`PLANNER_NOT_FOUND`** (unknown or not RUNNING) |
| `planner.read` | `planId` | `{ kind: "planner-draft", planId, requestDigest, projectRevision, current, draft }` | **`PLANNER_NOT_FOUND`**, **`PLANNER_NOT_READY`** |

- **Idleness check.** `planner.start` applies the same idleness test as prepare. That test includes the dead-owner recovery of PR #48, which answers `STALE_PROJECT` after a recovery.
- **Classification check.** `planner.start` then runs the prepare classification. It proceeds exactly when a draftless `workflow.prepare` would raise `ComplexPlanRequiredError` for a non-R3 Risk.
- **Other refusals.** Every other refusal happens before any model call.
- **Wire shape.** The `accepted` DTO's `command` enum gains `planner.start` and `planner.cancel`. A new data kind, `planner-draft`, is added. The three error codes are new on both lists.

### 7.3 Snapshot

The snapshot gains `planner?: PlannerStatus`. The key is **present only after a `planner.start` on this Host**, so snapshots sent to an App that never plans are byte-identical to today's.

```text
PlannerStatus = {
  schemaVersion: 1,
  planId: UUID, status: "RUNNING" | "READY" | "FAILED" | "CANCELLED",
  requestDigest: "sha256:<64 hex>", projectRevision, current: boolean,
  startedAt: epoch ms, finishedAt: epoch ms | null,
  route: { alias: "plan" | null, profile, provider, model } | null,
  usage: { invocations, reportedTokens: number | null },
  taskCount: number | null,            // READY only
  failureCode: <§5.5 code> | null      // FAILED only
}
```

The draft itself is never in the snapshot. `planner.read` returns it, so the snapshot stays within its 65,536-byte response budget next to a historical COMPLEX projection of up to 32,768 bytes. A `planner-draft` response is at most 16,384 bytes; the draft alone is at most 12,288.

### 7.4 Compatibility and landing order

The landing order is **consumer-first**: #53 (App) merges before #52 (Runtime).

- **New App, old Runtime:** `plannerContractVersion` is absent, so the Planner control is hidden and nothing changes.
- **Old App, new Runtime:** the App never sends `planner.*`, so the snapshot never carries `planner`, and nothing changes.
- **New App, new Runtime:** both sides decode the new commands, kinds and codes strictly. The App server's response checks cover the new kinds.

## 8. Interaction with the existing controls

| Situation | Behavior |
| --- | --- |
| `workflow.prepare` while RUNNING | Allowed. Prepare is deterministic and side-effect free; a manual plan may be prepared while the Planner runs. |
| `workflow.confirm` while RUNNING | Refused with `PLANNER_BUSY`. The user cancels planning first. There is no implicit cancel. |
| `workflow.confirm` success | Clears planner state. |
| `planner.start` while READY/FAILED/CANCELLED | Replaces the previous state, including an unread READY draft. |
| Owner connection closes, or Host shutdown | RUNNING is cancelled: the session is aborted and disposed. Late results are discarded. No state survives the Host process. |
| Another App connection | Each App connection runs its own Host process, so another connection never sees or commands this Host's planner state. Planning is private to the Host that runs it; only a started Run is shared, through durable state. |

## 9. App (#53)

- **Control.** Under the COMPLEX plan editor there is a "Draft with Planner" control.
  - Enabled only when the Runtime advertises `plannerContractVersion: 1`, the connection is current and owns the project, the goal and at least one criterion are present, no Run is active and no writer is present.
  - While RUNNING, it shows elapsed time, the route and usage, plus **Cancel**.
- **READY.** A card labelled **"Planner proposal — unreviewed"** shows the task count, the route and the usage, with **Load into editor** and **Discard**.
  - **Load into editor** calls `planner.read` and replaces the editor rows. It asks first if rows are non-empty and differ.
  - **Discard** only hides the card in the App. The Host keeps the READY state until a new `planner.start` replaces it or a confirm clears it.
  - While the editor holds the loaded, unchanged draft, a banner stays visible: "Review every task, claim and check before Prepare."
  - Labels show a non-current draft, or a `requestDigest` that differs from the editor's goal and criteria.
- **FAILED.** Shows the failure code with fixed explanatory text. There is no retry loop; the user starts again.
- **Never:** no automatic prepare or confirm, no hidden edits to the loaded draft, and no persistence of drafts beyond the page session.

## 10. Implementation handoff

**#52 Runtime** (`runtime/pi/packages/company-runtime`):
- the Planning Context builder, with bounds and exclusions;
- the `Planner` role in model routing and `models.intents.plan`;
- the tool-less Planner session with `submit_plan_draft`, the correction and reminder turns, the timeout and budget;
- the dry-run prepare pipeline;
- the three Host commands, the capability, the snapshot `planner` field and the new codes;
- the §8 interactions;
- unit tests for every §5.5 code and §8 row.

The existing COMPLEX/PARALLEL corpora must stay green unchanged.

#52 also updates the "there is no Planner model" statements in [OVERVIEW.md](OVERVIEW.md) and [PARALLEL_AGENTS.md §1](PARALLEL_AGENTS.md) when the Planner exists. Until then, they stay true.

**#53 App** (`app/t3code`):
- the duplicated DTOs, commands, kinds and codes, with strict decoding, and the capability gate;
- the App server forwarding and response validation;
- client state for planner status, read and cancel;
- the §9 UI with tests;
- preserved behavior with an old Runtime.

## 11. #54 boundary corpus (design)

A new corpus, `scripts/planner-integration.mjs`, runs in the CI cross-boundary job. It uses the real Runtime executable, the production App `ControlTransport` and strict decoders, and the scripted loopback model.

| ID | Scenario | Expected |
| --- | --- | --- |
| L01 | Start → READY → read → prepare → confirm | Prepare of the unchanged draft succeeds on the first try; COMPLETED; planning itself changed no project revision |
| L02 | Submission with forged fields (ids, status, risk, limits, `delete`) | Schema refusal, correction, then FAILED/`DRAFT_INVALID` if repeated; no Run, no write |
| L03 | Claim outside allowed paths, or `modify` of a missing file | Bounded correction; the corrected draft is READY |
| L04 | Model answers text only, twice | FAILED/`NO_DRAFT` after exactly 2 invocations (one reminder) |
| L05 | Model never answers | FAILED/`TIMEOUT`; session disposed |
| L06 | Cancel while RUNNING, then the model answers | CANCELLED; the late submission is ignored |
| L07 | Text, then an invalid draft, then another invalid draft | FAILED/`DRAFT_INVALID` after exactly 3 invocations (one reminder, one correction); never a 4th |
| L08 | Start with an active Run, a writer present, a stale revision, a non-COMPLEX goal, or an R3 goal | Refused with the §7.2 code; zero model calls |
| L09 | `workflow.confirm` while RUNNING | `PLANNER_BUSY`; the Run does not start |
| L10 | A commit or config change during RUNNING | FAILED/`STALE`; the draft is not readable |
| L11 | A project change after READY | `current: false`; prepare of the loaded draft re-validates |
| L12 | The owner connection closes during RUNNING | Cancelled; no leftover process or state |
| L13 | The context's file listing | `.ai/` and protected paths absent; context ≤196,608 bytes |
| L14 | Snapshots before any `planner.start` | Byte-identical shape to V0.8A (no `planner` key) |

Besides the corpus, #54 requires:
- one real-model smoke on commandcode `deepseek/deepseek-v4.1-flash`: goal → Planner draft → load → prepare → confirm → COMPLETED, with the cost reported;
- one real App UI check with the dev server and a headless browser, against isolated state.

## 12. Non-goals

- Planner file tools, repository exploration or LSP.
- Automatic prepare or confirm.
- Planning for QUICK or STANDARD.
- R3 planning.
- Durable planning history or evidence.
- Multiple concurrent planning requests on one Host.
- A TUI planner (COMPLEX has no TUI path).
- Model fallback.
- Re-planning during a Run.
- Planner-assigned Risk.
- Using Planner output as review or verification evidence.
- Changes to the frozen V0.7B/V0.8A plan schema or digests.

## 13. Design validation

The code facts this contract relies on, checked on `20ff4632`:
- **Prepare is deterministic.** `workflow.prepare` compiles drafts deterministically, with no model (`host-workflow.ts:59`, `finalizeComplexHostWorkflowPlan` at `host-workflow.ts:245`, `complex-plan.ts:56-60,409-442`). The claim facts and Policy check are in `complex-plan.ts:289-313`. The draft is closed and at most 12,288 bytes (`complex-types.ts`, `host-control.ts:599-605`).
- **The draft trigger is precise.** A draftless COMPLEX request raises `ComplexPlanRequiredError` (`host-workflow.ts:95`), which is the exact `planner.start` trigger.
- **Commands must stay quick.** Control requests are handled serially (`host-control.ts:877-914`). The App transport times out after 10 s per request (`ControlTransport.ts:139-143`) and polls snapshots every 2 s (`RuntimeController.ts:274`). A model call inside a command would stall both.
- **Workers are Run-bound.** They need a runId contract, an `ActionAudit` store and a measurement step (`agent-tools.ts:374-431`, `measurement-types.ts:14,76-122`). Hence the separate, tool-less Planner session.
- **The response budget is tight.** Responses are at most 65,536 bytes, and a COMPLEX projection can take up to 32,768 (`host-control-protocol.ts:16-17`). Hence the draft travels in `planner.read`, not in the snapshot.
- **The App editor can be pre-filled.** The editor rows equal draft tasks, with `checkIds` space-separated (`WeavraControls.tsx:48-95,505-508`).
