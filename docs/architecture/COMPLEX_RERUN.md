# Explicit re-run of unfinished COMPLEX work — V0.8C architecture contract

## 1. Status, decision, and scope

**DESIGN ONLY; proposed contract freeze for review.** This document resolves [#55](https://github.com/kjg8619/Weavra/issues/55). It is the implementation contract for [Runtime #56](https://github.com/kjg8619/Weavra/issues/56), [App #57](https://github.com/kjg8619/Weavra/issues/57) and the boundary corpus of [#58](https://github.com/kjg8619/Weavra/issues/58). Roadmap: [#59](https://github.com/kjg8619/Weavra/issues/59).

- **Baseline:** `devlop` `00302ecd`. V0.8B is on devlop: the Planner #51–#53, with #54 in review.
- **Branch:** dedicated branch `design/v0.8c-rerun-contract`. This PR does not change Runtime or App behavior.

> A COMPLEX Run can end BLOCKED, CANCELLED, FAILED or INTERRUPTED with some tasks COMPLETED and their changes still in the checkout. Today the user must rewrite the whole plan by hand, and the new Run refuses to start until the checkout is clean. V0.8C adds one deterministic, read-only Host command, `workflow.derive`. From the latest terminal COMPLEX Run it builds a **candidate re-run draft** and reports the **leftover changes** that block a clean start. The user resolves the leftovers: they commit or discard them, because the Runtime never does either. The user then loads the draft into the editor and runs the unchanged prepare → preview → confirm path. Nothing resumes, no evidence is reused, and the old Run stays history.

**This does not change the forbidden things.** The COMPLEX, parallel and state-store contracts forbid resume, replay, retry, rollback and evidence reuse (COMPLEX_SEQUENTIAL_WORKFLOW.md §8 and §17; PARALLEL_AGENTS.md §12; STATE_STORE.md). V0.8C keeps every one of those rules. A derived draft is only a filled-in planning form. The new Run is an ordinary new Run: new parent and plan identities, a clean-start check, and fresh evidence for every task.

**Chosen minimum:**
- **No model.** Derivation is a pure function of the durable source Run plus current file facts. It spends no tokens.
- **Nothing durable.** No writer lock, no `.ai` write and no revision change. Lineage is shown by the App only; it is not stored in the new Run.
- **COMPLETED tasks are verified again.** Each one becomes a read-only verification task: same criteria and checks, no claims. Its self-check, review and test run fresh against the new baseline. Their earlier PASS is never carried over.
- **Unfinished tasks keep their claims, adjusted to current files.** A `create` claim whose file now exists becomes `modify`.
- **The clean-start rule is unchanged.** The response lists the leftover paths that would fail the start check, so the user can resolve them before Prepare.

## 2. Authority boundary

| `workflow.derive` may | It may not |
| --- | --- |
| Read the latest durable Run, the current file facts under Policy, and `git status` names | Write `.ai`, take the writer lock, start or change a Run, or move any revision |
| Return a candidate draft plus a prepare dry-run result | Commit, stage, stash, discard, reset or delete anything in the checkout |
| List leftover paths by name | Read or return file contents or diffs |
| Map COMPLETED tasks to verification tasks | Mark any task complete, skip a verification gate, or reuse any check, review or test result |

The App never prepares a derived draft automatically. `workflow.prepare` recompiles whatever the editor holds. The new Run's confirm rechecks the clean workspace, exactly as today. Completion authority stays with the Kernel.

## 3. Source Run eligibility

`workflow.derive { runId }` accepts the request only when all of these hold. Otherwise it answers the code shown, before reading any file.

| Condition | Refusal |
| --- | --- |
| `runId` is the **latest** Run in durable state, `runs.at(-1)` | `RUN_NOT_FOUND` |
| That Run is COMPLEX, with a Host-confirmed plan | `RERUN_NOT_APPLICABLE` (new) |
| Its status is BLOCKED, CANCELLED, FAILED or INTERRUPTED | `RERUN_NOT_APPLICABLE` (COMPLETED, or not terminal) |
| At least one task row is not COMPLETED | `RERUN_NOT_APPLICABLE` |
| Its Risk is not R3 (a single-delete plan is never derived) | `RERUN_NOT_APPLICABLE` |
| No Run is active and this Host runs nothing | `ACTIVE_RUN` |
| `expectedProjectRevision` is current | `STALE_PROJECT` |

Deriving is allowed while a writer lock is present, because the command is read-only. The only exception is a lock held by a live active Run, which is refused by the rules above.

## 4. Derivation (deterministic)

The source is the durable Run: frozen parent `tasks[0]`, frozen plan, and task rows.

1. **Parent.** The source parent's goal and its acceptance statements in AC order: `AC-001` is statement 1. A prepare of the derived draft therefore reassigns the same AC IDs to the same statements.
2. **Tasks.** The derived draft keeps the source plan's task **count, order and `dependsOnIndexes`**, so it stays within 2–8 tasks and keeps the same graph. Each source row maps as follows:

   | Source row | Derived task |
   | --- | --- |
   | COMPLETED | **Verification task:** title `Verify: <title>` (cut to 80 characters on a code-point boundary); goal `Re-verify without changes: <goal>` (cut to 300). A prefix is added only if the text does not already start with it, so re-running a re-run does not repeat it. `ownership: []`; same `criterionIndexes` and `checkIds` |
   | Any other status | Same title, goal, `criterionIndexes` and `checkIds`. Claims are adjusted as in step 3. |

3. **Claims of unfinished tasks.** Each claim is re-evaluated against the current file.

   | Source claim | Current file | Derived claim |
   | --- | --- | --- |
   | `create` | missing | `create` |
   | `create` | exists as a regular file | `modify` (the source Run or the user created it) |
   | `modify` | exists | `modify` |
   | `modify` | missing | `modify`. It is reported in `notes`, and the dry-run shows prepare will refuse it. |

4. **Index mapping.** Criterion and dependency indexes are 1-based, exactly as in the source plan. Check IDs are copied as they are.
5. **Dry-run.** The draft runs through the same prepare pipeline the Planner uses (`prepareHostWorkflowDraft` → `finalizeComplexHostWorkflowPlan` → `compileComplexPlan`, including claim facts and Policy). The result is `prepareCheck: { ok, code }`, where `code` is the prepare error code or null. Nothing is stored.
6. **Notes.** `notes` is a bounded list of at most 16 fixed-template strings, each at most 200 bytes. Examples:
   - `CT-002 claim src/x.mjs: create became modify (file exists)`
   - `CT-003 claim src/y.mjs: modify target is missing`
   - `CT-001 completed files missing: src/a.mjs; a verification task cannot recreate them`. This note appears when a COMPLETED row's `changedFiles` no longer exist. The user then edits that task back into an implementation task.

   Notes never contain file contents.

Two derivations of the same source against the same files and configuration produce byte-identical drafts.

**Resolve first, derive again.** Claims follow the files at derive time. After the user commits or discards leftovers, they derive again, so that `create`/`modify` match the checkout. One example is discarding a partial file that had turned a `create` into a `modify`. The App offers **Derive again**, and the dry-run shows whether the current draft would prepare.

## 5. Leftover changes

The response carries `leftovers: { clean: boolean | null, paths: string[], truncated: boolean }`.
- **Source.** The paths come from `git status --porcelain=v1 -z --untracked-files=all`, the command the start check (`GitWorkspace.assertClean`) uses. Runtime-owned and generated observation paths are removed with the same filters. What remains is exactly the set that would make a confirm fail with `START_FAILED`.
- **Bounds.** At most 200 paths and 16,384 bytes of names, in sorted order. Beyond that, `truncated` is true.
- **Unknown state.** If Git cannot be run, `clean` is null and `paths` is empty. The App then says the state is unknown; it must never claim the checkout is clean.
- **No contents.** No contents, diffs or modes are returned.

The Runtime still never commits or discards. Resolving leftovers is the user's own action, taken in their own tools.

## 6. Wire contract

These changes are identical on both sides. The duplicated protocol definitions stay duplicated.
- **Capability.** `control.hello` adds `rerunContractVersion: 1`. The advertised `commands` tuple is unchanged, as with `plannerContractVersion`. An App older than #57 rejects the new key, so **#57 lands before #56**, consumer first.
- **Command.** `workflow.derive` uses the mutation envelope (`ownerId`, sequenced id, `expectedProjectRevision`) with the payload `{ runId }`.
- **Success data.** Kind `derived-draft`:

```text
{ kind: "derived-draft", runId, sourcePlanDigest: "sha256:<64 hex>", sourceStatus,
  goal, acceptanceStatements: string[],
  draft: WeavraComplexDraft,
  prepareCheck: { ok: boolean, code: <existing prepare error code> | null },
  leftovers: { clean: boolean | null, paths: string[], truncated: boolean },
  notes: string[] }
```

  The whole response line is at most 49,152 bytes. Beyond that the answer is `RESPONSE_TOO_LARGE`, and nothing is truncated silently except `leftovers.paths`, which is bounded as stated in §5.
- **Error code.** `RERUN_NOT_APPLICABLE` is new on both lists. The other refusals reuse existing codes.
- **Snapshot.** Unchanged. A derived draft is returned only in the command response.

## 7. App (#57)

- **"Re-plan unfinished work" button.** It is shown on the COMPLEX execution view when all of these hold:
  - the Runtime advertises `rerunContractVersion: 1`;
  - the latest Run is terminal: BLOCKED, CANCELLED, FAILED or INTERRUPTED;
  - at least one row is not COMPLETED;
  - the Run is not R3;
  - the connection is current.
- **Loading the draft.** A click sends `workflow.derive`. On success the App asks before replacing a non-empty editor. It then fills the goal, the criteria (one per line) and the task rows, with `checkIds` space-joined.
- **Banner.** It stays while the loaded draft is unchanged: "Derived from Run `<runId>` (`<sourceStatus>`): N completed tasks become read-only verification tasks that are checked again; unfinished tasks keep their claims (create → modify where the file now exists). Review before Prepare."
- **Leftovers.** When `clean` is false: "These changes block a new Run until you commit or discard them. The Runtime never does either." The list of paths follows, with a note when it is truncated. When `clean` is null, the App says "Workspace state unknown".
- **Prepare check.** The App shows `prepareCheck` and the notes.
- **Derive again.** This button re-sends `workflow.derive` after the user resolves leftovers. The banner says that claims follow the files at derive time.
- **Prerequisite fix:** stale writer after a terminal Run.
  - **Today:** the Prepare gate stays disabled while `writerPresent` is true and no other owner has an active Run (`WeavraControls.tsx:344-353`; STATE_STORE.md "App-only users cannot trigger recovery"). So after a terminal Run whose owner died with the lock, the App cannot recover.
  - **Change:** also allow Prepare when the latest Run is terminal and a writer is present.
  - **Runtime outcomes:** the existing dead-owner recovery answers `STALE_PROJECT` after recovering, or `WRITER_PRESENT` if the owner is alive.
- **Never:** the App never prepares or confirms automatically, never runs Git, and never persists derived drafts.

## 8. Runtime (#56)

- The `workflow.derive` command. It is synchronous and deterministic, has the §3 eligibility checks, and follows the §4 derivation, the §5 leftovers, the §6 response bounds and the new code.
- **Reuse, not duplication:**
  - the prepare pipeline extracted for the Planner (`preparePreview` / the planner dry-run);
  - the file-fact inspector used by claim facts;
  - the `GitWorkspace` status command and the Runtime-owned path filters. The workspace is not opened as a writer.
- **Docs.** Update the "no resume" statements to point at this document, and state that V0.8C is not a resume: OVERVIEW, COMPLEX_SEQUENTIAL_WORKFLOW.md §8 (a note only), PARALLEL_AGENTS.md §12 and STATE_STORE.md.

## 9. #58 boundary corpus (design)

The new file is `scripts/rerun-integration.mjs`. It runs in the CI cross-boundary job with the scripted loopback model, the production App transport and decoders, and the App consumer checks on every snapshot. The corpus acts as the user: it commits or discards leftovers with its own git calls.

| ID | Scenario | Expected |
| --- | --- | --- |
| R01 | Task 2 fails its check (BLOCKED) after task 1 COMPLETED | CT-001 becomes a verification task. CT-002 becomes `modify`, because its partial file exists. The leftovers list both files. The user commits task 1's file and discards task 2's partial file, then derives again: CT-002 is `create` again and `clean` is true. Prepare and confirm give COMPLETED, and the verification task runs fresh self-check, review and test. |
| R02 | Owner killed mid-wave (INTERRUPTED/OWNER_LOST, as in P14), recovered through prepare (`STALE_PROJECT`) | Derive works on the recovered Run. The leftovers are resolved, and the new Run COMPLETES. |
| R03 | Derive on a COMPLETED Run, on a non-latest `runId`, on an R3 Run, and while a Run is active | `RERUN_NOT_APPLICABLE`, `RUN_NOT_FOUND`, `RERUN_NOT_APPLICABLE`, `ACTIVE_RUN` |
| R04 | Prepare and confirm the derived draft while leftovers remain | Prepare may succeed. The start fails with `START_FAILED`, because the clean-start rule is unchanged. No Run is created. |
| R05 | Two derives of the same source | Byte-identical drafts. Revision, writer lock and `git status` are unchanged. |
| R06 | Evidence identity | The new Run's plan digest, parent ID and every evidence context differ from the source. No gate starts PASS. |
| R07 | A stale writer after a terminal Run (the dead owner kept the lock) | App Prepare is allowed, the Runtime recovers and answers `STALE_PROJECT`, and derive then works |
| R08 | Old App against a new Runtime | Not supported, because the capability key is refused. Covered by consumer-first landing, not by a scenario. |

Besides the corpus, #58 requires one real-model smoke that runs a BLOCKED Run → derive → resolve → re-run → COMPLETED, and one real App UI check of the button, banner and leftovers.

## 10. Non-goals

- Resume, replay, retry or rollback of any Run.
- Reuse of any evidence.
- Automatic commit, stage, stash or discard.
- Deriving from non-latest or archived Runs.
- Durable lineage between Runs.
- Planner-based re-planning of unfinished work, which is a possible later combination with V0.8B.
- R3 derivation.
- Partial-file salvage beyond the `create` → `modify` rule.
- A TUI path.

## 11. Design validation

These are the code facts this contract relies on, checked on `00302ecd`:
- **Clean start.** The start check runs `git status --porcelain=v1 -z --untracked-files=all` minus Runtime-owned and generated paths, and a leftover fails the start with `START_FAILED` (`workspace.ts:14-20,71-79`; `host-control.ts` confirm start). There is no option to accept the current workspace as the baseline. The Runtime never commits (`workflow.ts:502`).
- **Terminal rows.** Terminal COMPLEX rows keep COMPLETED as it is and settle the others BLOCKED, CANCELLED or INTERRUPTED. `partialChanges` records leftovers (`complex-state.ts:348-405`, `kernel.ts:2374`).
- **Snapshot scope.** Only the latest Run is projected (`host-bridge-projections.ts:26`, `host-control.ts:624-635`). Hence derive is latest-only.
- **Claims.** `create` needs a missing file and `modify` an existing UTF-8 file (`complex-plan.ts:255-287`). Plans have 2–8 tasks and must cover every AC (`complex-types.ts:17`, `complex-binding.ts:141-143`). Hence verification tasks rather than dropped tasks.
- **No Run relationships.** Runs have no lineage field and the Kernel refuses to reuse a Run ID (`contracts.ts`, `kernel.ts:951-952`). The parent ID and plan ID are random per prepare (`task-contract.ts:58`, `host-workflow.ts:259`), so evidence of a new Run can never match the old one.
- **App gate.** The App gate blocks Prepare while a writer is present after a terminal Run (`WeavraControls.tsx:344-353`). Hence the §7 prerequisite fix.
