# Parallel Agents — V0.8A architecture contract

## 1. Status, decision, and scope

**DESIGN ONLY; proposed contract freeze for review.** This document resolves [#19](https://github.com/kjg8619/Weavra/issues/19). It is the implementation contract for [Runtime #20](https://github.com/kjg8619/Weavra/issues/20), [App #21](https://github.com/kjg8619/Weavra/issues/21) and the race corpus of [#22](https://github.com/kjg8619/Weavra/issues/22). It extends the verified V0.7B contract ([COMPLEX_SEQUENTIAL_WORKFLOW.md](COMPLEX_SEQUENTIAL_WORKFLOW.md), closed by #16/#17/#18). Every V0.7B rule still applies unless this document names the change.

- Baseline: `devlop` `4e4c6410` (#38 merged, #16–#18 closed; COMPLEX corpus of 14 scenarios green in CI, falseCompletion 0, one real-model COMPLEX Run COMPLETED).
- Dedicated branch: `design/v0.8a-parallel-contract`. No Runtime/App behavior changes in this PR.

> V0.8A runs the **implementation** of independent tasks of one frozen COMPLEX plan concurrently, in bounded **waves**, and keeps every **verification** step on a quiescent workspace, one task at a time, exactly as V0.7B.

**Why implementation only.** Registered checks and Reviewers judge the whole workspace. They bind evidence to one digest (`selfCheck = review = test = live`). If task B mutates while task A's checks run, A's evidence describes no real state. Isolated per-task checkouts would need copy-back or Git merges. Those are automatic integration, which #19 forbids. Model-backed implementation is where the wall-clock time goes. So parallelizing only that phase gives the speedup and keeps V0.7B's evidence model unchanged.

**Chosen minimum:**
- Waves of at most `maxParallel` (1–4) ready tasks.
- The existing exact-file claims, which are already globally exclusive, so no two tasks ever own the same file.
- A join barrier after each wave.
- Verification in plan order at a quiescent workspace.
- One global budget ledger.
- One Kernel, one writer, one Run.

`maxParallel = 1` schedules and ends exactly like V0.7B; its v2 trace only adds a brief `HANDED_OFF` between implement and self-check. There is no automatic merge, commit or rollback, no shared ownership, no unlimited fan-out and no model fallback. A Run has no Planner either: since V0.8B an optional Planner may propose a plan draft before preparation, as unreviewed candidate data with no authority, and never takes part in a Run ([PLANNER_DRAFT.md](PLANNER_DRAFT.md)).

## 2. What changes from V0.7B

| Area | V0.7B | V0.8A |
| --- | --- | --- |
| Eligibility | only the next array entry, after **all earlier** tasks COMPLETED | any PENDING task whose **declared dependencies** are all COMPLETED, in plan order, up to `maxParallel` per wave |
| Concurrent workers | one | up to `maxParallel` Developers, implementation phase only |
| Active leases | one | one per implementing task, all under the one Run writer |
| Verification | per task, immediately | per task after the wave joins, plan order, one at a time, workspace quiescent |
| Task statuses | 13 | adds `HANDED_OFF` (implemented, waiting for its verification turn) |
| Projection | `activeTaskId` | `activeTaskIds` (plan order, ≤ `maxParallel`) |
| Plan | `schemaVersion 1`, digest domain `weavra-complex-plan-v1` | `schemaVersion 2`, `limits.maxParallel`, domain `weavra-complex-plan-v2` |
| Capability | `complexContractVersion: 1` | `2` (the App accepts 1 and 2; the Runtime emits exactly one) |

Unchanged:
- Draft shape, bounds and claim semantics (§4–§5 of V0.7B).
- The integration phases and completion guard (§8).
- Revision and budget maxima (§6).
- The R3 narrow case (§7.2; forced `maxParallel = 1`).
- Cancellation and cleanup ordering (§9).
- Evidence minimization (§12).
- One-writer StateStore authority.

## 3. Configuration and plan

- `agents.max_parallel` (config) widens from the literal `1` to an integer `1..4`, default `1`. QUICK/STANDARD ignore it.
- The Host compiler freezes `limits.maxParallel = min(agents.max_parallel, 4)`. R3 plans and READ_ONLY plans with a single task freeze `1`.
- The plan remains a closed object. `ComplexPlan` v2 = v1 fields with `schemaVersion: 2` and `limits.maxParallel: 1..4`. The digest material is `canonicalJson(["weavra-complex-plan-v2", planWithoutDigest])`. A v2 Runtime never emits v1 plans.
- Dependencies keep their V0.7B validation (earlier rows only, no cycles). They now carry scheduling meaning:
  - A task without dependencies may run beside earlier tasks.
  - Plan order remains the deterministic tie-break.
  - A human who wants strict order writes the dependency edge.
- A plan with `maxParallel = 1` schedules exactly like V0.7B, where every earlier row must be COMPLETED. This keeps old plans' meaning; outcomes match V0.7B.

## 4. Wave scheduler (Kernel)

```text
TASK_SEQUENCE:
  wave := first ≤ maxParallel PENDING rows (plan order) whose declared dependencies are all COMPLETED
          [maxParallel = 1: the next row, and every earlier row must be COMPLETED]
  reserve one Developer invocation per wave row (plan order, all-or-nothing)
  persist: wave rows ELIGIBLE → IMPLEMENTING, activeTaskIds = wave
  run the wave rows' implementation concurrently            ← only concurrent part
  JOIN: wait until every wave invocation has settled and its resources are confirmed stopped
  one full capture; reconcile the ledger (all wave effects attributed)
  for each wave row in plan order:                          ← quiescent, one at a time
     SELF_CHECK → REVIEW → (REVISE → IMPLEMENTING alone → HANDED_OFF → SELF_CHECK …) → TEST → COMPLETED
  next wave; after the last row COMPLETED → INTEGRATION_CHECK → FINAL_REVIEW → FINAL_TEST → COMPLETING
```

Rules:

1. **Formation.** A wave is decided and persisted in one save before any worker starts. It never grows or reorders later. A row whose dependencies are not all COMPLETED can never enter a wave, even if its output files exist.
2. **Reservation.** A wave starts only if the budget can reserve one Developer invocation for every wave row. Reservations run in plan order and are all-or-nothing.
   - If they cannot all be reserved, the Run is BLOCKED/BUDGET_EXHAUSTED before any worker of the wave starts.
   - A partial wave is never started.
   - Unknown usage from a previous invocation blocks before the next wave (BUDGET_UNKNOWN), as in V0.7B.
3. **Concurrent implementation.** Each wave row gets its own fresh Developer session, its own `(taskId, attempt)` ownership capability and its own ComplexEvidenceContext. Tool calls stay sequential within one worker.
   - Workers run concurrently.
   - Every durable write goes through one Kernel save queue: transitions, sessions, measurements and action outcomes. Persisted revisions and event sequence numbers form one total order.
4. **Handoff.** A wave row whose Developer returns a valid handoff moves to `HANDED_OFF`. The handoff's `changed_files` must equal the ledger's effects of that attempt. The task's own claimed files, which no sibling may touch, are captured at handoff. A whole-workspace digest is not taken while siblings may still write.
5. **Join barrier.** Verification never starts while any wave invocation is live. After the join, one capture must reconcile with the expected cumulative state of all wave effects. If it does not, the Run becomes BLOCKED/EXTERNAL_MUTATION.
6. **Verification turn.** Wave rows are verified strictly in plan order, one at a time, with no live Developer. The V0.7B stage semantics, checks, contribution review and freshness apply.
   - Each own-claim image at every verification stage must still equal its handoff image.
   - The whole-workspace digest must satisfy `selfCheck = review = test = live` for that task.
   - With `maxParallel = 1` this is exactly the V0.7B equality chain.
7. **Revision.** An accepted REVISE sends that row back to IMPLEMENTING alone, with a fresh attempt and session and the V0.7B local and global limits. The row returns to `HANDED_OFF` and resumes its turn. Later rows of the wave wait. Earlier COMPLETED rows keep their historical evidence, which becomes STALE when the digest moves.
8. **Failure.** Any wave row BLOCKED or FAILED stops the Run:
   - The Kernel aborts every sibling invocation through a wave-scoped AbortSignal.
   - It joins them and settles them through STOPPING.
   - Then it writes the terminal state.
   - Siblings still implementing end BLOCKED/`RUN_STOPPED`. A user cancel ends them CANCELLED.
   - Siblings already HANDED_OFF keep their attempt data and end BLOCKED/`RUN_STOPPED`.
   - Every row keeps its own failure code. The Run's `failureCode` is the first failure in persisted order, and no failure is hidden.
9. **Completion.** Unchanged: all rows COMPLETED is never sufficient; the V0.7B integration phases and `assertCanCompleteComplex` decide. The final budget rule becomes Σ task invocations + 1 final Reviewer. Revision attempts keep the V0.7B per-attempt maximum of two invocations.

Task-state additions to the V0.7B machine (§7.1 there). Only these edges are new:

```text
IMPLEMENTING  → HANDED_OFF   valid handoff whose changed_files equal the attempt's ledger effects
HANDED_OFF    → SELF_CHECK   the row's verification turn (wave joined, workspace quiescent, plan order)
HANDED_OFF    → STOPPING     cancel, sibling failure, join capture failure (EXTERNAL_MUTATION), budget stop
REVIEW        → IMPLEMENTING REVISE within limits (unchanged edge; the row then implements alone)
```

With `maxParallel = 1` a row passes IMPLEMENTING → HANDED_OFF → SELF_CHECK without waiting.

Performance note: a wave's wall-clock time is the slowest implementation plus the serial verification. #22 must measure the speedup and must not claim it without numbers.

## 5. Ownership and the ledger

- Claims stay exact, globally exclusive and immutable (V0.7B §5). No two tasks can own the same path, so no two concurrent workers can mutate the same file.
- The ledger holds **one lease per implementing task** instead of one lease per Run. `authorize(path, effect)` checks the requesting capability's own `(taskId, attempt)` lease. Every V0.7B denial stays:
  - `OWNERSHIP_CONFLICT`: the path belongs to a sibling, running or not;
  - `UNOWNED_PATH`;
  - operation mismatch.
- Effects are recorded synchronously at effect time: an early gate, the Policy check, a late gate, the effect, then the post-image. Concurrency therefore never interleaves one effect's gate and record.
- A capability closes when its invocation settles. A late tool call from an aborted sibling is rejected.
- No shared, subtree, glob or transferable ownership. No lease is inherited by another task, revision or wave.

## 6. Cancellation tree

```text
Run cancel (user) ─┬─ wave-scoped abort → every live Developer (concurrently)
                   ├─ join: all invocations settled, sessions disposed, LSP/process resources confirmed
                   ├─ persist STOPPING (all active rows), cleanup PENDING
                   └─ confirmed → rows CANCELLED, Run CANCELLED, writer released
                      unconfirmed → rows INTERRUPTED, Run INTERRUPTED, writer retained
Sibling failure ──── same tree, rows end BLOCKED/RUN_STOPPED, failing row keeps its code
Owner loss/crash ─── recovery: every non-terminal row INTERRUPTED (OWNER_LOST), COMPLETED rows kept, no resume
```

No worker is left running after a terminal write. The join happens before STOPPING is settled. A late Approval, session, result or effect from any aborted sibling is rejected (V0.7B closed callbacks).

## 7. Events and determinism

- One Kernel save queue: every persisted revision is +1 and every event sequence number is strictly increasing across all tasks.
- Per-task causal order holds (StepStarted before AgentStarted before the task's results). Cross-task interleaving follows persisted order only.
- Wave formation, reservation order, verification order and failure selection all depend only on plan order and persisted state, never on which worker finished first.
- For a fixed plan and fixed worker outcomes, the final durable state is identical regardless of implementation interleaving. Only revisions and timestamps may differ.
- No new event types (V0.7B §10: the ordinary observer stream stays unchanged). Task/step events carry `complexContext`. Run lifecycle events carry `complexBinding`.

## 8. Wire contract v2 (identical for #20 and #21)

Only these Host Control types change. All other V0.7B wire rules stay: presence, strictness, byte limits, envelope equality and no new commands.

| Surface | v2 |
| --- | --- |
| `HostControlCapabilities.complexContractVersion` | `2`. The App accepts `1` (the V0.7B Runtime) and `2`. |
| `ComplexPlan` | `schemaVersion: 2`, `limits.maxParallel: 1..4`, digest domain `weavra-complex-plan-v2` |
| `ComplexTaskStatus` | V0.7B values plus `"HANDED_OFF"` |
| `ComplexExecution` | `schemaVersion: 2`; `activeTaskIds: TaskId[]` replaces `activeTaskId`. Everything else is as in v1 and the byte limit stays 32,768. |

v2 consumer rules. These replace the corresponding V0.7B rules; the others stay.

1. `activeTaskIds` lists exactly the rows in ELIGIBLE, IMPLEMENTING, WAITING_APPROVAL, HANDED_OFF, SELF_CHECK, REVIEW, TEST and STOPPING, in plan order, with length ≤ `plan.limits.maxParallel`. It is empty during integration and at TERMINAL.
2. An active or COMPLETED row requires every **declared dependency** COMPLETED. With `maxParallel = 1`, every **earlier** row must be COMPLETED, which is the V0.7B rule.
3. **Implementation state:** one or more rows IMPLEMENTING/WAITING_APPROVAL, any others HANDED_OFF, and no row in SELF_CHECK, REVIEW or TEST.
4. **Verification state:** exactly one row in SELF_CHECK, REVIEW or TEST, or one revising row IMPLEMENTING with `attempt ≥ 2`. The other active rows are HANDED_OFF. Verification never coexists with a first-attempt implementation.
5. HANDED_OFF: `attempt ≥ 1`, gates NOT_RUN, `entryWorkspaceDigest` non-null, changedFiles ⊆ own claims. Any WAITING_APPROVAL row implies Run WAITING_APPROVAL. R3 plans have `maxParallel = 1`.
6. Task invocations: at most 2 × attempt per row. Σ task invocations ≤ global ≤ Σ task invocations + 1.

Presence and compatibility:
- A v2 Runtime emits v2 shapes only.
- A v1 Runtime keeps emitting v1. The App decodes by the advertised version and never mixes versions.
- An old App with a new Runtime is incompatible by design: its strict decoder rejects version 2, and the App shows the control as stale or unavailable.
- Landing is consumer first: #21 lands before #20, as in V0.7B.

**Amendment A1 — historical v1 Runs (added during #21 review).**

After an upgrade, a project's latest Run may be a V0.7B COMPLEX Run with a v1 plan. Every such Run is terminal, because Host open recovers active Runs as INTERRUPTED. A v2 Runtime projects it as a `schemaVersion: 2` execution that:
- carries the frozen v1 plan unchanged, with its own `schemaVersion: 1` and its `weavra-complex-plan-v1` digest;
- has `activeTaskIds: []`;
- has v1 row statuses (no `HANDED_OFF`).

The App accepts a v1 plan inside a v2 execution only when the snapshot Run is terminal, and recomputes that plan's digest in its own domain. Previews and non-terminal executions from a v2 Runtime always carry v2 plans. The Runtime never rewrites, upgrades or re-digests a frozen plan. Without this amendment, a v2 Runtime could not show such a Run, and the project's control surface would stay unavailable until another Run was started.

**Atomic saves the consumer relies on.** Rules 3 and 4 constrain which states may coexist; they do not list every allowed state. The App also accepts snapshots in which all active rows are ELIGIBLE, all are HANDED_OFF, or all are STOPPING. Consequences for the Runtime:
- It moves every wave row ELIGIBLE → IMPLEMENTING in one save, with the shared wave entry capture.
- It moves every working row (IMPLEMENTING or WAITING_APPROVAL, or a verification-stage row) → STOPPING in one save. HANDED_OFF rows may stay HANDED_OFF beside STOPPING rows until the terminal save.
- A working row never appears beside an ELIGIBLE or STOPPING row.

## 9. App (#21)

- Decode v1 and v2 strictly by capability. Recompute the v2 plan digest and the parent digest. Apply the v2 consumer rules in `ComplexProjection`.
- The draft editor gains no scheduling input: dependencies already express order, and `maxParallel` comes from Runtime config, shown read-only in the preview.
- The read-only view shows a dependency list or graph, which rows run together in the current wave, HANDED_OFF rows waiting for their verification turn, per-row budget and status, the sibling-stop cause (`RUN_STOPPED`) and the cancel state.
- It still offers no task controls. Wave membership is shown only as the Runtime reports it and is never inferred into a transition.

## 10. Implementation handoff

#20 Runtime (`runtime/pi/packages/company-runtime`):

| Files | Responsibility |
| --- | --- |
| `config.ts`, `complex-types.ts`, `complex-binding.ts`, `complex-plan.ts` | `agents.max_parallel 1..4`; plan v2 schema/digest/limits; R3 → 1; v2 execution types; `HANDED_OFF` |
| `complex-ownership.ts` | lease map keyed by task; per-capability authorization; unchanged denials |
| `kernel.ts` | Wave formation/reservation/concurrent implement with a wave-scoped abort and join; one serialized save queue; HANDED_OFF; plan-order verification turns; sibling-failure settlement; `maxParallel = 1` equivalence. Prefer one new wave method plus the existing single-step verification path over a recursive per-task Kernel. |
| `workflow.ts` | drive waves and verification turns; resource settlement joins all workers before terminal writes |
| `complex-state.ts`, `state-store.ts` | v2 projection (`activeTaskIds`), v2 durable invariants and recovery (all non-terminal rows INTERRUPTED/OWNER_LOST) |
| `host-control*.ts`, `evidence.ts`, `observations.ts`, `status.ts` | capability 2, v2 projection, Evidence Pack wave fields, honest TUI rows for concurrent tasks |
| tests | fake-port Kernel races (below) with deterministic gates; SDK suite with the faux provider; V0.7B corpus unchanged at `maxParallel = 1` |

#21 App (`app/t3code`): the v2 DTOs and digest, dual-version decode, the v2 consumer rules, and the wave/HANDED_OFF view. There are no task controls. Old-Runtime (v1) behavior must be preserved.

## 11. #22 deterministic race corpus (design)

Each fixture uses scripted workers with explicit gates, like the #18 loopback harness, so interleavings are forced, not sampled. **falseCompletion = 0** and no leaked worker or writer after any terminal state are mandatory.

| ID | Forced interleaving | Required result |
| --- | --- | --- |
| P01 | 2 independent tasks, both Developers live at once | Both IMPLEMENTING simultaneously (observed); verification in plan order; COMPLETED; measured wall-clock below the serial sum |
| P02 | A hands off first, B still implementing | A stays HANDED_OFF, no check until B hands off |
| P03 | B hands off before A | Verification still A then B |
| P04 | A dependency chain A→B plus independent C | Wave 1 {A, C}, wave 2 {B} |
| P05 | A writes B's claimed file while both are live | A BLOCKED/OWNERSHIP_CONFLICT, B aborted and joined, BLOCKED/RUN_STOPPED, bytes unchanged |
| P06 | One child FAILED while the other is mid-tool-call | Sibling aborted, late effect rejected, Run FAILED, no hidden failure |
| P07 | Cancel with two live Developers | Both aborted, joined, rows CANCELLED, cleanup CONFIRMED, writer released |
| P08 | REVISE of A while B is HANDED_OFF | A re-implements alone; B's turn after A COMPLETED; B's evidence at the new digest |
| P09 | Budget has one invocation left for a two-row wave | BLOCKED/BUDGET_EXHAUSTED before any wave worker starts |
| P10 | Unknown usage from one wave row | Wave joins; BLOCKED/BUDGET_UNKNOWN before the first Reviewer |
| P11 | External change while the wave is live | Join capture fails: EXTERNAL_MUTATION; no verification |
| P12 | Integration check fails after all waves | BLOCKED, completed history kept |
| P13 | App reconnect mid-wave | Consistent v2 projection with two active rows; no replay |
| P14 | Owner crash mid-wave (kill, then new Host) | Recovery: both active rows INTERRUPTED/OWNER_LOST, no resume |
| P15 | Event order | Strictly increasing sequences; per-task causal order; same final state for both forced interleavings |
| P16 | `maxParallel = 1` | The V0.7B 14-scenario corpus passes against the v2 Runtime, changed only for the `activeTaskIds` field name |
| P17 | R3 plan with `max_parallel: 4` | Frozen `maxParallel = 1`; the V0.7B R3 flow unchanged |

Also required: an actual bounded parallel smoke with a real model (2 independent tasks, `max_parallel: 2`), or an explicit NOT VERIFIED, plus Runtime, App and cross-boundary full gates.

## 12. Non-goals

Same-file concurrent mutation, shared/subtree/glob ownership, per-task checkouts or worktrees, automatic merge/commit/reset/rollback, concurrent verification, speculative execution, dynamic re-planning, a Planner/Lead model, unbounded fan-out (> 4), cross-provider fallback, and resuming or re-running tasks after a crash.

## 13. Design validation

1. `git diff --check`. Only this document and the root work log change.
2. Every rule names its owner and implementation seam (§10). No rule relaxes a V0.7B authority.
3. #20 and #21 share exactly the §8 wire changes and consumer rules. The landing order is explicit.
4. Every active wave state has success, block, fail, cancel and unknown exits (§4, §6).
5. The race corpus covers every scenario required by #19 and #22.

No implementation, test run or speedup claim follows from this design PR.
