# Runtime State Store: stale writer recovery and terminal-run archive

Status: implemented on `feat/runtime-review-followups-2` (2026-09-24). Scope: `runtime/pi/packages/company-runtime/src/state-store.ts` and its readers. Kernel authority, Policy, approval and the Host wire protocol are unchanged.

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

No schema version bump (the index is optional and older states stay valid), no archive pruning or compression, no resume of interrupted runs, no change to lock semantics for live owners, and no cross-host coordination.
