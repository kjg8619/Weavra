# Controlled problem-cycle contracts

## Implemented boundary

Plan tasks 1–8 implement the controlled chat flow: read-only analysis,
explicit advisory selection and review, bound STANDARD execution, durable
recovery, and bounded canonical evidence detail through Runtime Host Control.
The scripted cross-boundary corpus is verified. The historical real-defect
replay has canonical Kernel completion, fresh strict checks, independent review,
and observed target/result UI at 1280/375. The October 2 continuation additionally
verified actual UI consent/confirmation, canonical completion and same-DB restart
without another execution. Earlier failure-card observations remain separately
identified synthetic evidence, not actual-model failure runs.
A readiness probe or an analysis answer is not evidence that implementation completed.
Existing free coding and project Settings workflows retain their previous
protocol and behavior.

Provider ownership generation is a freshness fence, not a controlled/free mode
flag: a released checkout retains its generation. Session mode is tracked
separately. Entering controlled analysis starts a fresh restricted provider
session without inheriting an active or persisted free-session resume cursor;
the App conversation remains the same. An unconfirmed handoff that failed
draining exposes explicit reprepare/abort actions, while a recorded confirm
intent still requires receipt reconciliation or explicit recovery.

The App and Runtime deliberately keep separate Effect Schema and TypeBox
definitions. Neither build root imports the other. Transport remains
stdio.

| Contract | Implemented here | Actual acceptance and remaining scope |
| --- | --- | --- |
| App identity | UUID `WeavraTaskId`; server-resolved thread/project checkout, repository membership and HEAD/workspace capture; immutable association | Exact replay association, actual UI confirmation and restart inspection verified |
| Advisory packet | Closed schemas, provenance, byte bounds, digest binding, source freshness; read-only analysis and explicit visible-message selection | Saved actual analysis reused byte-exactly in the reviewed handoff; no repeated analysis |
| App persistence | Commands, events, receipt fingerprints, SQLite reload, coordinator/RPC/UI, durable uniqueness and generation CAS | Actual UI-confirmed bound result restored after App restart without re-execution |
| Ownership | Durable owner/generation; managed provider/checkpoint/terminal/git/file-write guards; provider stop/drain and release authorization | Actual worker cleanup, writer absence and App release confirmed |
| Runtime persistence | Durable confirm admission, atomic initial Run association, immutable metadata, exact stdio receipts, guarded dead-owner settlement and App recovery | One actual bound Run/admission, preserved through read-only recapture |
| Completion | Canonical Run status, fresh symptom check, independent review and paged evidence govern resolved presentation; App phase alone cannot complete a task | Baseline 11 stale fields fail, actual model fix passes fresh strict checks; separate synthetic failure-card observations preserve unverified states |

Host Control advertises `taskBinding: 1` and `analysisContext: 1`.
It advertises `evidenceDetails: 1` only with the live
`workflow.evidence` handler, and `checkoutIdentity: 1` only with the live
`workflow.checkout` handler. Absence means unsupported, not an inference from
a Runtime version, command tuple or readiness. Task
prepare/receipt/evidence/checkout schemas are in the live wire union;
`workflow.receipt`, `workflow.evidence` and `workflow.checkout` are gated by
their capability fields, not added to the legacy strictly decoded `commands`
tuple. The standalone
`WeavraTaskReadRpc` is in `WsRpcGroup` and reads through the task coordinator.

## Identity and packet

`WeavraTask` persists:

```text
id: WeavraTaskId (canonical lowercase UUID)
environmentId, projectId, threadId
target: { workspaceRoot, worktreePath: string | null }
checkout: { canonicalCwd, repositoryRoot, headCommit, workspaceDigest }
phase: analysis | preparing | awaiting-confirmation | handoff | running |
       finished | attention-required
revision: positive safe integer
context: WeavraAnalysisContext | null
execution: WeavraTaskExecution | null
ownership: { generation: positive safe integer,
             state: analysis | draining | runtime | reconciling | released }
createdAt, updatedAt
```

`target` retains the selected App mapping; `checkout` retains the server-resolved
filesystem identity. Absolute paths are data from trusted server resolution, not
client cwd authority. The persistence command checks the project/thread mapping.
The App resolver still owns selected-project repository membership. Runtime
independently requires its trusted cwd to equal the supplied canonical checkout,
checks clean state and captures HEAD/workspace identity. A structurally valid
identity alone is not proof that these checks ran. Changing a target requires a
new task rather than rewriting history.

`WeavraAnalysisContext` / Runtime `AnalysisContextSchema`:

```text
version: 1
packetVersion: positive safe integer
authority: ADVISORY_ONLY
reviewedAt: nonnegative safe integer (Unix milliseconds)
symptom: nonblank string, at most 1000 characters
observations: at most 8 {
  text: nonblank string, at most 500 characters
  provenance: MODEL | USER | HOST_OBSERVATION
  reference: { kind: source, path } |
             { kind: message, threadId, messageId }
}
candidateCause: { kind: HYPOTHESIS, text: at most 1000 characters } | null
uncertainties: at most 8 nonblank strings, at most 250 characters each
sourceReferences: at most 8 {
  path: exact relative path, at most 256 characters
  digest: sha256:<64 lowercase hexadecimal digits>
  lines?: { start: positive integer, end: integer >= start }
}
constraints: at most 8 nonblank strings, at most 250 characters each
```

Source paths cannot be absolute, contain backslashes/control characters, or have
empty, `.` or `..` segments. Source paths are unique and source observations must
reference one of them. Message observations must reference the bound thread.
The whole compact JSON packet must be at most **8192 UTF-8 bytes**, including
metadata. Oversize and unknown fields are rejected, never truncated. Content is
explicitly selected visible material, not transcripts, credentials, hidden
reasoning, permissions or check registration. Even `HOST_OBSERVATION` is
advisory provenance, never a RegisteredVerifier PASS.

The advisory digest is SHA-256 of UTF-8 compact JSON:
`{domain:"weavra.analysis-context.v1",packet:<packet>}`, with object keys sorted
recursively and array order retained. Runtime exports `analysisContextDigest`;
the App uses its existing `stableStringify` and Effect Crypto. A changed packet
increments `packetVersion`. Confirmation freezes the packet and execution
association; subsequent receipts may update the observed outcome, not the
reviewed input.

## Execution, admission and symptom binding

The execution ID is the Runtime-generated Task Contract UUID, not another
App-generated identifier. `WeavraTaskBinding` / `TaskBindingSchema` contains:

```text
taskId, environmentId, projectId, threadId, checkout
executionId, packetVersion, advisoryDigest
symptomVerification?: { criterionId, checkId, registrationDigest }
```

The preparation proposal uses `{criterionIndex, checkId}`. Host resolves the
1-based ordinal to the compiled criterion, requires its registered required
check, and freezes the registration digest. Preview and RegisteredVerifier
startup use the same snapshot helper and normalized configuration digest.
The separate Policy digest remains bound to the actual Run UUID. Startup
compares the preview digest to the verifier's registration, not a newly accepted
replacement. Registration capture does not run a check.

`WeavraTaskExecution` stores `binding`, `previewId`, `previewDigest`,
`configDigest`, `confirmedProjectRevision`, nullable `confirmCommandId`, and
nullable `receipt`. Intent must be persisted before an eventual confirm side
effect. The App task coordinator persists the intent before Runtime confirmation
and reconciles the durable receipt after a response loss.

Canonical `TaskRunMetadata` is:

```text
{
  binding,
  previewDigest,
  configDigest,
  confirmedProjectRevision,
  admittedProjectRevision // strictly greater than confirmedProjectRevision
}
```

Canonical `TaskAdmission` is:

```text
{
  metadata: TaskRunMetadata,
  outcome:
    { status: ACCEPTED } |
    { status: STARTED, runId } |
    { status: START_FAILED,
      reasonCode: MODEL_UNAVAILABLE | INITIALIZATION_FAILED | STALE_PREPARATION } |
    { status: INTERRUPTED_BEFORE_START, reasonCode: OWNER_LOST },
  acceptedAt,
  updatedAt
}
```

`FileStateStore.saveTaskAdmission(admission, expectedRevision)` is a writer-only
storage primitive used by Host confirmation. A new ACCEPTED record
requires the exact idle project revision and records the next storage revision.
An identical retry returns its existing outcome without another commit.
Conflicting metadata or stale revisions fail. STARTED cannot be supplied to
this method: `save(run)` associates it atomically with the initial bound Run.
An unrelated Run cannot consume a pending admission. Run metadata cannot later
be added, removed or replaced.

`FileRuntimeState.taskAdmissions`, `Run.taskBinding` and
`ArchivedRun.taskBinding` are optional. Old records remain absent, not empty or
inferred. Admissions are not evicted. Archived Runs retain their full binding
and the archive index retains the lookup metadata; archive digest and identity
checks still apply. A bound Run must be STANDARD with its single Task Contract
ID equal to executionId. A symptom binding must name that contract's
review-required criterion and one of its mapped checks.

`FileStateStore.readTaskReceipt(projectPath, executionId)` returns either
`{status:"UNKNOWN",executionId}` or
`{status:"FOUND",executionId,admission,run}`. `run` is null before start or after
pre-start failure, otherwise `{runId,status,revision}` from the exact inline or
digest-checked archived Run. It acquires no writer and performs no recovery,
repair, execution or completion mutation. Missing is unknown, never permission
to resend confirmation.

`finished` is only an App phase. It can coexist with no Run, START_FAILED,
interruption, cancellation or failed checks. Even canonical COMPLETED means
task checks complete; original issue verification additionally needs the exact
reviewed symptom binding, matching fresh final-revision registration/diff
evidence, MET criterion and independent review. This initial contract increment
did not implement a resolution badge; the current task-result UI evaluates those
conditions before displaying original-issue verification.

## Bound Runtime execution (task 2)

`workflow.prepare` accepts `task: TaskPreparation` only with explicit
`acceptanceStatements` and without a recipe or COMPLEX draft. Classification
must select STANDARD; there is no silent QUICK/COMPLEX conversion. The complete
request, including the terminating newline, is limited to 32768 UTF-8 bytes.
Packet validation counts original message identifiers, including whitespace.

The preview adds `taskBinding` and `configDigest`. Persist those alongside
`previewId`, `previewDigest`, and `projectRevision` before confirming.
`executionId` is `plan.taskContract.id`. For bound previews, `previewDigest`
hashes the original task preparation, goal, statements, binding and normalized
config digest under `weavra.task-preview.v1`; transport owner/expiry are
separate Host checks. A changed packet, target, symptom mapping or plan cannot
reuse another preparation's digest.

`workflow.confirm` first opens one FileStateStore with recovery disabled,
checks the pre-admission revision, and saves ACCEPTED at the next revision.
Only then does it return `accepted` with `taskReceipt` and the admitted
`projectRevision`. Model initialization may still fail; this acknowledgment
does not mean a Run exists. `StandardWorkflow.execute` consumes that same store
and owns cleanup from that point. Before the first resource-producing startup
fence it persists `cleanup: UNCONFIRMED`; the initial admission is `NOT_STARTED`.
Both startup fences compare the admitted revision plus that exact single owned
lifecycle commit and validate on-disk state against the writer's snapshot; they
do not accept unrelated external changes. The first Run save alone atomically
changes ACCEPTED to STARTED. Pre-Run failure records START_FAILED and releases
the writer after confirmed resource cleanup. Uncertain storage or cleanup
retains the writer rather than inventing a settled outcome.

After a new connection's `control.hello`, read-only
`{type:"workflow.receipt",executionId}` needs no previous owner, mutation
sequence or revision. It returns `{kind:"task-receipt",receipt}` for the exact
pending, active or digest-checked archived record, even when readiness is not
READY. It never recovers or retries. Duplicate bound confirmation returns the
cached acknowledgment or exact receipt; an identical preparation for an
admitted task returns its receipt, while changed preparation data gets
PLAN_CHANGED. An admitted task cannot acquire another binding. A new explicit
attempt needs a new task identity after reconciliation, not confirmation replay.

Task-bound recovery is a separate explicit `workflow.recover` mutation advertised
by `taskRecovery: 1`, not a refresh or another preparation. It takes the existing
owner/sequence/revision envelope and the exact persisted `TaskRunMetadata`.
FileStateStore checks metadata, revision, conflicting state and writer execution
attribution under its exclusive recovery guard, then rechecks canonical state
and lock identity before replacement and commit.

Pending admissions become INTERRUPTED_BEFORE_START/OWNER_LOST; active Runs become
INTERRUPTED, preserving their identity, failed evidence and partial changes.
`NOT_STARTED` or `CONFIRMED` cleanup can release the recovered writer. With
`UNCONFIRMED` cleanup, recovery records interruption but atomically restores the
original dead-owner lock: owner PID death does not prove detached checks or LSP
processes have stopped. Generic prepare/open cannot remove this protection.
The response distinguishes RECOVERED, ALREADY_SETTLED and NOT_RECOVERED from
CONFIRMED/UNCONFIRMED cleanup. A successful response is not permission to write.

Missing, live, foreign or unattributed writer identity remains unproven; absent
admission or cleanup knowledge does not grant recovery authority. Read-only
receipt/reconnect never invokes recovery. Existing unbound legacy prepare
recovery remains separate and does not bypass the attributed task barrier.

Bound-task model construction disables command-valued credentials through the
SDK's per-instance `allowCredentialCommands: false`. Stored and configured keys
and headers are checked at actual resolution, including refreshes, before shell
execution or cached command reuse. Ordinary model instances keep their previous
behavior. This option does not sandbox custom credential stores or arbitrary
native provider callbacks.

`readCheckoutIdentity` in `workspace.ts` uses the existing bounded execution
collector, including the clean-start checks. Both `canonicalCwd` and
`repositoryRoot` are this checkout's canonical Git top-level, including for a
worktree; they are not the shared Git common directory. `headCommit` is HEAD.
`workspaceDigest` is `sha256:` plus the collector's ordinary `diffDigest`:
SHA-256 of compact JSON `{head,index,gitConfig,files}`, where `index` is
`git ls-files --stage -z`, `gitConfig` is the SHA-256 of the resolved Git config,
and sorted file tuples are `[path,mode,byteHash]`.
For `bounded-monorepo`, the tuples instead are
`[path,kind,mode,byteLength,byteHash]`. The collector includes configured
allowed ignored files and `.ai/config.yaml`, excludes Runtime-owned state and
generated observation files, and applies its existing finite profile limits.
App integration must implement this identity contract independently or arrange
a Host capture; it must not import Runtime source across the stdio boundary.

After `control.hello`, read-only `{type:"workflow.checkout"}` accepts no cwd,
owner, mutation sequence or revision. Runtime captures only from the Host's
already trusted canonical root, using the current normalized configuration's
allowed paths and evidence profile, and returns
`{kind:"checkout-identity",checkout}`. The capture acquires no writer and does
not recover state, initialize a model, execute a check, repair a projection or
create a Run. Dirty or unsupported evidence and root drift fail closed.
Existing writers, active Runs and pending accepted admissions are refused.
Configuration and canonical state are fenced before and after collection; a
change during collection returns an error rather than an identity from mixed
generations. The App adapter additionally requires the returned canonical cwd
and repository root to equal its server-resolved trusted root. The task
coordinator and UI were outside this initial prerequisite; the completed
controlled-chat integration consumes this checkout identity.

Source references are checked against Policy, protected paths and verifier
oracle restrictions before bounded anchored reads. Host compares the supplied
SHA-256 and freezes source generation; it never silently refreshes an old hash.
It repeats those checks at startup and at the first Developer provider-use
boundary after session persistence. Workers receive a distinct `reviewedAnalysis`
block, with the original packet and binding. Later independent workers mark it
historical; the existing bounded task-context builder reads current sources
again and uses eligible reference paths as seeds. It does not compare original
hashes against authorized Run edits. Advisory text adds no tools, project facts,
registered checks, budgets, retries, permissions or completion authority.

## Bounded canonical evidence detail (task 5)

After a normal `control.hello`, `workflow.evidence` reads one exact task-bound
Run. Its request binds task/environment/project/thread/execution IDs, Run ID,
Run state revision and, after the first page, the workspace diff digest. A
different association is rejected. A changed Run revision or digest rejects a
stale page; pages from different versions are never combined.

Every response repeats `{executionId,runId,revision,diffDigest}`, code revision,
canonical Run status, terminal flag, inline/archive source, writer presence,
cleanup knowledge and the same completeness map. Terminal outcome, writer
presence and cleanup are independent facts. Missing historical categories are
`unavailable` with null totals, never fabricated zero counts.

The four page categories are `criteria`, `checks`, `changed-files` and
`trust-sources`. Cursors are closed `{category,index}` values. A page contains
at most 50 records and is built incrementally against the complete 65,536-byte
JSONL response envelope. Fewer records are returned when UTF-8 bytes require
it. One record that cannot fit returns `evidence-detail-unavailable` with
`RECORD_TOO_LARGE`; it is never truncated. The whole inbound line retains the
32,768-byte limit.

Criteria carry the frozen statement, ID, canonical status and evidence
references. Check rows carry ID/kind, code revision, attempt, step, status,
required flag, exit code, evidence references, registration/executable digest
and source count, plus bounded sandbox metadata. Trust sources are separate
records, so a check never inlines all 64 paths/digests. Changed files are names
only. The fixed review summary carries verdict, independence, revision, diff
digest and criterion count. Frozen `symptomVerification` is included as
`{criterionId,checkId,registrationDigest}`.

The projection is built only from `EvidencePack`, canonical Run metadata, and
the exact canonical task admission. It
does not include source bodies, raw diff/output, check reasons, sessions,
prompts, credentials or hidden reasoning. Reading acquires no writer, performs
no recovery or repair, runs no check/model and mutates no state. The legacy
evidence summary is unchanged. No `resolved` boolean is projected: later UI
must compare the frozen symptom binding with a required PASS at the final code
revision, matching registration and diff evidence, MET criterion and
independent review.

## SQLite and compare-and-set

Migration **054_WeavraTasks** adds:

- `projection_weavra_tasks`: `task_id`, `environment_id`, `project_id`,
  `thread_id`, `canonical_cwd`, `phase`, `ownership_state`, `revision`,
  `generation`, `task_json`. Indexed columns must agree with JSON. Partial
  unique indexes enforce one active/unreleased task per environment/thread and
  one unreleased task per environment/canonical checkout.
- `workspace_execution_ownership`: primary key `(environment_id,canonical_cwd)`;
  `generation`, nullable `task_id`, `state`, nullable `pending_execution_id`.
  Released rows remain with null task/pending execution IDs so a later owner
  cannot reuse an old generation.
- Nullable `orchestration_command_receipts.task_fingerprint`. Legacy receipts
  have no materialized fingerprint in the decoded App object.

Internal `thread.weavra-task.set` carries `commandId`, `threadId`,
`expectedRevision` (null only on creation), `expectedOwnershipGeneration`
(zero only before the first ownership row), and the complete next `task`.
Every accepted update advances both task revision and ownership generation by
one. A new task starts at revision 1 but advances the checkout's retained
generation. `thread.weavra-task-set` persists these CAS inputs and task.

The engine validates before enqueue, fingerprints the complete normalized task
command, and checks that fingerprint before replaying an accepted receipt.
Reusing a command ID for a different task, checkout, packet or operation cannot
report another command's success, even within the same thread. Legacy generic
command deduplication is unchanged.

The event, SQL task/ownership projections and receipt commit in the existing
transaction. Projection writes independently compare persisted revisions and
generations; a failed CAS rolls back the event. Snapshot and command-model
queries reload the optional `weavraTasks` and `weavraOwnership` arrays. No task
rows means the new fields stay absent from old snapshots. Startup does not
clear ownership or infer cleanup. A terminal Run alone is not release proof;
the ownership service must establish worker cleanup and writer
disposition before dispatching a released state.

Task-bound evidence details also consume the exact durable task admission from
the same canonical read. Its STARTED Run ID and complete immutable metadata
must match the bound Run. Cleanup is confirmed only with CONFIRMED admission,
terminal status, no active agents, and a fresh absent-writer observation.
Explicit legacy uncertainty takes precedence. Absent proof remains UNKNOWN;
terminal status or writer absence alone cannot establish cleanup. The Host
rejects a page if project revision or writer presence changes during projection.
This read path does not change the Run, admission, check records, or workspace.
