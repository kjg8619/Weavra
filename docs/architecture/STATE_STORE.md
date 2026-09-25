# Runtime State Store: stale writer recovery and terminal-run archive

Status: implemented on `feat/runtime-review-followups-2` (2026-09-24); Host Control prepare recovery added on `fix/host-orphan-recovery` (2026-09-25). Scope: `runtime/pi/packages/company-runtime/src/state-store.ts`, its readers and `workflow.prepare` in `host-control.ts`. Kernel authority, Policy, approval and the Host wire schemas are unchanged.

## Problem

`FileStateStore` keeps one canonical `.ai/state.json` per project, guarded by an exclusive `.ai/writer.lock`.

1. **Stale lock.** A writer that crashes (kill -9, power loss) leaves `writer.lock` behind. Every later open fails with `open/lock` until a person deletes the file, even though the lock records the owner's PID.
2. **Unbounded state.** `state.json` keeps every run and every audited tool action forever. Each mutation rewrites and fsyncs the whole file, and reads refuse files above 16 MiB. After a few hundred runs, every tool action pays for the full history, and eventually the project stops accepting runs.

## 1. Stale writer recovery

The lock now records `hostname` next to `schemaVersion`, `projectPath`, `token` and `pid`.

When `open` finds an existing lock, it recovers it only if **all** of these hold:

- the lock is a regular, single-link file of at most 4 KiB with valid JSON,
- `projectPath` equals this project's canonical path and `hostname` equals `os.hostname()`,
- `pid` is a positive integer and `process.kill(pid, 0)` reports `ESRCH` (no such process). `EPERM` or success means alive.

Protocol:

1. Create `.ai/writer.lock.recovery` with `O_EXCL`. If it exists, another process is recovering (or a recovery crashed): do not recover.
2. Re-read and validate the lock, and remember its `dev`/`ino`.
3. `lstat` again; only if it is the same inode, `unlink` it.
4. Remove the recovery guard, then take the lock with the normal `O_EXCL` create. If another opener wins that race, this open fails as ordinary contention.

Normal openers never touch an existing lock, and recoverers exclude each other through the guard, so no fresh lock can be deleted. After recovery, the existing open path marks the dead owner's active run `INTERRUPTED`; there is still no automatic resume. The recovery is reported as `store.recoveredStaleLock` and as a workflow diagnostic.

Not recovered (manual inspection, as before): locks without `hostname` (written before this change), other hosts (for example network filesystems), live or unverifiable PIDs, and a leftover recovery guard. PID-namespace isolation with a shared hostname (containers started with the host UTS namespace) can make a live owner look dead. That owner then fails closed on its next ownership check (`lock lost`). This is a documented limitation.

### Recovery paths

Every path uses the rules and guard above. They differ in whether they may settle a dead owner's Run.

| Path | Settles a dead owner's Run |
| --- | --- |
| Normal writer `open` (TUI `/workflow run` and other non-Host writers) | Yes: removes the stale lock, then interrupts and archives as above |
| Host Control `workflow.prepare` (`FileStateStore.recoverDeadOwner`) | Yes, only through a lock whose same-host owner is provably dead (below) |
| Guarded opens with `recoverInterrupted: false` (Host `workflow.confirm` start, Host browser and fact confirmation, `/state export`, `weavra browser` candidate save) | No. The Host and export paths refuse first while a lock or an active Run exists. The candidate save checks nothing first: it can remove a dead owner's lock and then refuse the active Run, which leaves an active Run without a lock |
| `readSnapshot` readers (`control.snapshot`, the read-only bridge, `/graph`, status views) | No. They never write |

**Host Control `workflow.prepare`.** A Host killed mid-run (`kill -9`) leaves its Run active and its lock behind. Before this change the next Host refused every prepare with `WRITER_PRESENT`, so only a non-Host writer could recover the project. Now `workflow.prepare` calls `FileStateStore.recoverDeadOwner` before preparing when this Host has no execution in flight, the canonical revision equals the request's `expectedProjectRevision`, and a lock exists.

`recoverDeadOwner` never creates `.ai` and never takes a free lock. It continues only when the guarded protocol above proves the lock's owner dead. It then opens as the next writer, so the same `open` recovery settles the project:

- the Run becomes `INTERRUPTED` and its `PREPARED` actions `INTERRUPTED`,
- COMPLEX unfinished rows become `INTERRUPTED`/`OWNER_LOST`; `COMPLETED` rows are kept,
- `RunInterrupted` is emitted and old terminal runs are archived.

It then releases the lock and returns the dead PID.

A preview is always bound to the request's own `expectedProjectRevision`, which keeps the App's strict revision echo check intact. So the prepare checks that revision again after the recovery:

- **A Run was settled.** Settling it committed a new project revision, so the request is stale. The prepare answers `STALE_PROJECT` and prepares nothing. The client re-reads: the snapshot now shows the Run `INTERRUPTED` and no writer. The next prepare runs normally at the recovered revision.
- **Nothing was settled.** The dead owner left no active Run and nothing needed archiving, so the revision did not change. The same prepare continues and returns a preview.

In every other case nothing is written and prepare fails as before: owner alive or `EPERM`, another host, a lock without `hostname`, an unreadable lock, a leftover guard, a stale revision (`STALE_PROJECT`), or an active Run with no lock at all (`ACTIVE_RUN`). Such a lockless Run has no owner left to prove dead; only a normal writer `open` settles it.

`control.snapshot` stays read-only and keeps showing the orphan until a prepare recovers it. The `workflow.confirm` guarded start keeps `recoverInterrupted: false` as its freshness fence; after a prepare-time recovery no active Run is left for it to refuse. Nothing is resumed, replayed, rolled back or deleted. Partial changes stay in the checkout, and the next Run still requires a clean workspace.

For a COMPLEX Run, `workflow.derive` ([COMPLEX_RERUN.md](COMPLEX_RERUN.md)) can turn the recovered Run into a candidate draft for that next Run and list the leftover changes that block the clean start. It is not a resume. It reads `state.json` with `readSnapshot` only: it takes no lock, recovers nothing, writes nothing and moves no revision, and it is allowed while a writer lock is present.

App note: the Project Settings panel enables prepare only when `writerPresent` is `false` and no Run is active. Until that gating allows a prepare over a writer lock, an App-only user cannot trigger this recovery. That App change is tracked separately.

## 2. Terminal-run archive

`state.json` keeps every active run plus the **20 most recent terminal runs**. When a writer opens the store (normal recovery mode only), older terminal runs move to `.ai/runs/<runId>.json`:

```json
{ "schemaVersion": 1, "run": { "…": "Run" }, "actions": [{ "…": "that run's action records" }] }
```

`state.json` gains an optional `archivedRuns` index: `runId`, `status`, `workflow`, `risk`, `phase`, bounded `goal`, `createdAt`, `updatedAt`, action count, and the archive file's `sha256` digest.

Crash consistency:

1. Write each archive file atomically (temporary `O_EXCL` file, fsync, rename). If the file already exists with the same digest, reuse it. A different digest is an integrity error and nothing is archived.
2. Commit `state.json` without those runs and their actions, with the index entries added, as one atomic replace.

A crash between steps leaves the run in `state.json` and an unreferenced archive file. Terminal runs are immutable, so the next open rewrites the same bytes and continues. Archive files are never modified or deleted by the Runtime.

Readers:

- Live execution, the Kernel and Host control only need active runs and are unchanged.
- `/state <runId>`, `/workflow status <runId>` and the Host bridge snapshot look up an archived run through the index. `readArchivedRun` refuses a missing file, a digest mismatch, a schema-invalid payload or a mismatched `runId`.
- `/workflow history` lists index entries after the in-state runs.
- `/state export` loads every archive (digest-checked) so `decisions.md` and `logs/checks.json` still cover all runs.
- `tasks.json` projects only in-state runs.
- Git workspace inspection treats `.ai/runs/<id>.json` and `.ai/writer.lock.recovery` as Runtime-owned, like `state.json`. They must not be tracked.

Effect: each mutation rewrites at most the active run, 20 terminal runs, the index (a few hundred bytes per archived run) and in-flight actions. The 16 MiB limit then applies to that bounded set instead of all history.

## Non-goals

No schema version bump (the index is optional and older states stay valid), no archive pruning or compression, no resume of interrupted runs (the V0.8C re-run in [COMPLEX_RERUN.md](COMPLEX_RERUN.md) starts a new Run and is not a resume), no change to lock semantics for live owners, and no cross-host coordination.
