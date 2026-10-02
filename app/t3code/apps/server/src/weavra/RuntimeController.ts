import {
  type ProjectId,
  type ThreadId,
  type WeavraTaskReceiptRequest,
  type WeavraCheckoutIdentityInput,
  type WeavraEvidenceDetailsInput,
  type WeavraTask,
  type WeavraControlCapabilities,
  type WeavraControlInput,
  type WeavraControlObservation,
  type WeavraControlResponse,
  type WeavraControlState,
  WeavraControlTransportError,
  WeavraCapabilityInventory,
  WeavraTaskRunMetadata,
  WEAVRA_CONTROL_MAX_REQUEST_BYTES,
  WEAVRA_CONTROL_MAX_RESPONSE_BYTES,
} from "@t3tools/contracts";
import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { subscribeBeforeSnapshotWithoutMutex } from "../utils/subscribeBeforeSnapshot.ts";
import { complexPreviewConsistent, complexStateConsistent } from "./ComplexProjection.ts";
import { type ControlTransport, openControlTransport } from "./ControlTransport.ts";
import { plannerDraftConsistent, plannerStateConsistent } from "./PlannerProjection.ts";
import {
  WorkspaceExecutionOwnership,
  type WorkspaceOperationToken,
} from "../workspace/WorkspaceExecutionOwnership.ts";

const sameInventory = Schema.toEquivalence(WeavraCapabilityInventory);
const sameTaskMetadata = Schema.toEquivalence(WeavraTaskRunMetadata);

export class RuntimeController extends Context.Service<
  RuntimeController,
  {
    readonly observe: (
      projectId: ProjectId,
      threadId?: ThreadId,
    ) => Stream.Stream<WeavraControlObservation>;
    readonly command: (
      input: WeavraControlInput,
      threadId?: ThreadId,
    ) => Effect.Effect<WeavraControlResponse, WeavraControlTransportError>;
    readonly checkout: (
      input: WeavraCheckoutIdentityInput,
      threadId?: ThreadId,
    ) => Effect.Effect<WeavraControlResponse, WeavraControlTransportError>;
    readonly evidence: (
      input: WeavraEvidenceDetailsInput,
      threadId?: ThreadId,
    ) => Effect.Effect<WeavraControlResponse, WeavraControlTransportError>;
    readonly receipt: (
      projectId: ProjectId,
      threadId: ThreadId,
      request: WeavraTaskReceiptRequest,
    ) => Effect.Effect<WeavraControlResponse, WeavraControlTransportError>;
  }
>()("t3/weavra/RuntimeController") {}
const initial: WeavraControlObservation = {
  status: "CONNECTING",
  state: null,
  capabilities: null,
  stale: true,
  observedAt: null,
  errorCode: null,
};
interface Entry {
  projectId: ProjectId;
  projectRoot: string;
  root: string;
  latest: WeavraControlObservation;
  changes: PubSub.PubSub<WeavraControlObservation>;
  scope: Scope.Closeable;
  bridge?: ControlTransport;
  refresh?: Effect.Effect<void, WeavraControlTransportError>;
  pending: number;
  stopped: boolean;
  inventory?: NonNullable<WeavraControlState["capabilityInventory"]>;
  retiredInventoryEpochs: Set<string>;
  /** The transport, and so the Host, that this server forwarded a `planner.start` to. */
  plannerStartedOn?: ControlTransport;
}
interface RuntimeOperation {
  readonly token: WorkspaceOperationToken;
  readonly ownerId: string;
  readonly confirmation: Extract<WeavraControlInput["request"], { type: "workflow.confirm" }>;
  readonly previousRunId: string | null;
  readonly previousOwnedRunId: string | null;
  outcome: "unacknowledged" | "accepted" | "rejected";
  runId: string | null;
  settled: boolean;
}
function consistent(
  response: WeavraControlResponse,
  previous: WeavraControlState | null,
  capabilities: WeavraControlCapabilities,
  plannerStarted: boolean,
): boolean {
  if (!response.success || response.data.kind !== "snapshot") return false;
  const state = response.data.state;
  const snapshot = state.snapshot;
  const run = snapshot.status.run;
  const approval = state.pendingApproval;
  const inventory = state.capabilityInventory;
  return (
    response.ownerId === state.ownerId &&
    response.runId === (run?.runId ?? null) &&
    response.stateRevision === state.stateRevision &&
    (response.projectRevision ?? 0) === state.projectRevision &&
    state.nextRequestId.startsWith(`${state.ownerId}:`) &&
    snapshot.status.state !== "unavailable" &&
    snapshot.graphAvailable === (snapshot.graph !== null) &&
    (!snapshot.graph ||
      (snapshot.graph.runId === run?.runId &&
        snapshot.graph.stateRevision === state.stateRevision &&
        snapshot.graph.status === run.status)) &&
    (!snapshot.evidence ||
      (snapshot.evidence.runId === run?.runId &&
        snapshot.evidence.status === run.status &&
        snapshot.evidence.codeRevision === run.codeRevision)) &&
    (!state.preview ||
      (state.preview.ownerId === state.ownerId &&
        state.preview.projectRevision === state.projectRevision)) &&
    (!state.browserPreview ||
      (state.browserPreview.ownerId === state.ownerId &&
        state.browserPreview.projectRevision === state.projectRevision)) &&
    (!state.factPreview ||
      (state.factPreview.ownerId === state.ownerId &&
        state.factPreview.projectRevision === state.projectRevision)) &&
    (!inventory ||
      (inventory.ownerId === state.ownerId &&
        inventory.projectRevision === state.projectRevision)) &&
    (!approval ||
      (approval.runId === run?.runId &&
        run.status === "WAITING_APPROVAL" &&
        approval.runId === state.ownedRunId &&
        state.busy &&
        approval.stateRevision === state.stateRevision &&
        approval.projectRevision === state.projectRevision)) &&
    complexStateConsistent(state, capabilities, previous) &&
    plannerStateConsistent(state, capabilities, previous, plannerStarted) &&
    (!previous ||
      (state.projectRevision >= previous.projectRevision &&
        (previous.snapshot.status.run?.runId !== run?.runId ||
          previous.stateRevision === null ||
          (state.stateRevision !== null && state.stateRevision >= previous.stateRevision))))
  );
}

/** Server lifetime owns execution transports. Subscriptions only observe and never release an owner. */
export const make = Effect.fn("weavra.runtimeController.make")(function* () {
  const query = yield* ProjectionSnapshotQuery;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const environment = yield* HostProcessEnvironment;
  const ownership = yield* WorkspaceExecutionOwnership;
  const serviceScope = yield* Scope.Scope;
  const mutex = yield* Semaphore.make(1);
  const entries = new Map<string, Entry>();
  // Entries/transports are replaceable; unresolved physical executions are not.
  const runtimeOperations = new Map<string, RuntimeOperation>();
  const runtimeAdmissionLocks = new Map<string, Semaphore.Semaphore>();
  const completedConfirmations = new Set<string>();
  const confirmationKey = (
    root: string,
    ownerId: string,
    request: RuntimeOperation["confirmation"],
  ) =>
    JSON.stringify([root, ownerId, request.ownerId, request.id, request.expectedProjectRevision]);
  const executable = environment.T3_WEAVRA_EXECUTABLE;
  const childEnv: Record<string, string> = {};
  for (const key of [
    "PATH",
    "HOME",
    "WEAVRA_HOME",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "SystemRoot",
  ] as const) {
    const value = environment[key];
    if (value !== undefined) childEnv[key] = value;
  }
  const projectRoot = Effect.fn("weavra.controlProjectRoot")(function* (projectId: ProjectId) {
    const project = yield* query
      .getProjectShellById(projectId)
      .pipe(
        Effect.mapError(() => new WeavraControlTransportError({ code: "PROJECT_UNAVAILABLE" })),
      );
    if (Option.isNone(project))
      return yield* new WeavraControlTransportError({ code: "PROJECT_UNAVAILABLE" });
    return yield* fs
      .realPath(project.value.workspaceRoot)
      .pipe(
        Effect.mapError(() => new WeavraControlTransportError({ code: "PROJECT_UNAVAILABLE" })),
      );
  });
  const threadSelections = new Map<
    ThreadId,
    {
      projectId: ProjectId;
      target: { workspaceRoot: string; worktreePath: string | null };
      canonicalCwd: string;
      repositoryRoot: string;
    }
  >();
  // Thread selectors are server-only. RPC clients still cannot choose a process cwd.
  const targetRoot = Effect.fn("weavra.controlTargetRoot")(function* (
    projectId: ProjectId,
    threadId?: ThreadId,
  ) {
    if (threadId === undefined) return yield* projectRoot(projectId);
    const selected = yield* ownership.resolveTarget(threadId).pipe(
      Effect.provideService(ProjectionSnapshotQuery, query),
      Effect.mapError(() => new WeavraControlTransportError({ code: "PROJECT_CHANGED" })),
    );
    const previous = threadSelections.get(threadId);
    if (
      selected.projectId !== projectId ||
      (previous !== undefined &&
        (previous.projectId !== selected.projectId ||
          previous.canonicalCwd !== selected.canonicalCwd ||
          previous.repositoryRoot !== selected.repositoryRoot ||
          previous.target.workspaceRoot !== selected.target.workspaceRoot ||
          previous.target.worktreePath !== selected.target.worktreePath))
    )
      return yield* new WeavraControlTransportError({ code: "PROJECT_CHANGED" });
    threadSelections.set(threadId, selected);
    return selected.canonicalCwd;
  });
  const validate = Effect.fn("weavra.validateControlProject")(function* (entry: Entry) {
    if ((yield* projectRoot(entry.projectId)) !== entry.projectRoot)
      return yield* new WeavraControlTransportError({ code: "PROJECT_CHANGED" });
    const currentRoot = yield* fs
      .realPath(entry.root)
      .pipe(Effect.mapError(() => new WeavraControlTransportError({ code: "PROJECT_CHANGED" })));
    if (currentRoot !== entry.root)
      return yield* new WeavraControlTransportError({ code: "PROJECT_CHANGED" });
  });
  const publish = Effect.fn("weavra.publishControl")(function* (
    entry: Entry,
    update: Partial<WeavraControlObservation>,
  ) {
    entry.latest = { ...entry.latest, ...update };
    yield* PubSub.publish(entry.changes, entry.latest);
  });
  const unavailable = Effect.fn("weavra.controlUnavailable")(function* (
    entry: Entry,
    error: WeavraControlTransportError,
  ) {
    yield* publish(entry, {
      status:
        error.code === "PROTOCOL_MISMATCH" || error.code === "INCOMPATIBLE_CAPABILITIES"
          ? "PROTOCOL_MISMATCH"
          : error.code === "TRANSPORT_CLOSED"
            ? "DISCONNECTED"
            : "ERROR",
      stale: true,
      errorCode: error.code,
      ...(error.code === "PROJECT_CHANGED" || error.code === "PROJECT_UNAVAILABLE"
        ? { state: null, observedAt: null }
        : {}),
    });
  });
  const connect = Effect.fn("weavra.connectControlOwner")(function* (entry: Entry) {
    if (!executable) return yield* new WeavraControlTransportError({ code: "NOT_INSTALLED" });
    const bridge = yield* openControlTransport(executable, entry.root, childEnv);
    let sequence = 0;
    const hello = yield* bridge.exchange({
      protocolVersion: 1,
      id: `t3-hello-${++sequence}`,
      type: "control.hello",
    });
    if (
      !hello.success ||
      hello.data.kind !== "capabilities" ||
      hello.ownerId !== hello.data.capabilities.ownerId ||
      hello.data.capabilities.maxRequestBytes !== WEAVRA_CONTROL_MAX_REQUEST_BYTES ||
      hello.data.capabilities.maxResponseBytes !== WEAVRA_CONTROL_MAX_RESPONSE_BYTES
    )
      return yield* new WeavraControlTransportError({ code: "INCOMPATIBLE_CAPABILITIES" });
    const capabilities = hello.data.capabilities;
    if (capabilities.readiness !== "READY") entry.stopped = true;
    yield* publish(entry, {
      capabilities,
      status: capabilities.readiness,
      stale: true,
      errorCode: null,
    });
    if (capabilities.readiness !== "READY") return;
    const refreshMutex = yield* Semaphore.make(1);
    const acceptsInventory = (state: WeavraControlState) => {
      const next = state.capabilityInventory;
      if (!next) return true;
      const key = `${next.ownerId}/${next.brokerEpoch}`;
      if (entry.retiredInventoryEpochs.has(key)) return false;
      const previous = entry.inventory;
      if (previous) {
        const previousKey = `${previous.ownerId}/${previous.brokerEpoch}`;
        if (key === previousKey) {
          if (
            next.generation < previous.generation ||
            (next.generation === previous.generation && !sameInventory(next, previous))
          )
            return false;
        } else {
          entry.retiredInventoryEpochs.add(previousKey);
        }
      }
      entry.inventory = next;
      return true;
    };
    const refresh = Effect.fn("weavra.refreshControlSnapshot")(function* () {
      yield* validate(entry);
      const runtimeOperation = runtimeOperations.get(entry.root);
      const mayReconcile = runtimeOperation?.settled === true;
      const response = yield* bridge.exchange({
        protocolVersion: 1,
        id: `t3-snapshot-${++sequence}`,
        type: "control.snapshot",
      });
      yield* validate(entry);
      // An exchange from a retired connection cannot publish into its replacement.
      if (entry.bridge !== bridge)
        return yield* new WeavraControlTransportError({ code: "TRANSPORT_CLOSED" });
      if (
        response.ownerId !== capabilities.ownerId ||
        !consistent(
          response,
          entry.latest.state,
          capabilities,
          entry.plannerStartedOn === bridge,
        ) ||
        !response.success ||
        response.data.kind !== "snapshot" ||
        !acceptsInventory(response.data.state)
      )
        return yield* new WeavraControlTransportError({ code: "INVALID_PAYLOAD" });
      const state = response.data.state;
      const run = state.snapshot.status.run;
      if (
        runtimeOperation?.outcome === "accepted" &&
        runtimeOperation.runId === null &&
        state.ownerId === runtimeOperation.ownerId &&
        state.ownedRunId !== null &&
        state.ownedRunId !== runtimeOperation.previousOwnedRunId &&
        state.ownedRunId === run?.runId
      ) {
        // Only this acknowledged confirmation can start a new Run on this Host.
        // A replacement Host's canonical Run (or noRun) cannot establish that link.
        runtimeOperation.runId = state.ownedRunId;
      }
      const associated =
        runtimeOperation !== undefined &&
        (runtimeOperation.runId !== null
          ? run?.runId === runtimeOperation.runId
          : state.ownerId === runtimeOperation.ownerId &&
            (run?.runId ?? null) === runtimeOperation.previousRunId &&
            (runtimeOperation.outcome === "rejected" ||
              (runtimeOperation.outcome === "accepted" && state.startFailure !== null)));
      if (
        runtimeOperation !== undefined &&
        mayReconcile &&
        runtimeOperation.settled &&
        associated &&
        runtimeOperations.get(entry.root) === runtimeOperation &&
        !state.busy &&
        !state.cancelling &&
        !state.snapshot.status.writerPresent &&
        (run?.activeAgentCount ?? 0) === 0 &&
        (run === null ||
          ["COMPLETED", "CANCELLED", "FAILED", "BLOCKED", "INTERRUPTED"].includes(run.status)) &&
        !(yield* fs
          .exists(`${entry.root}/.ai/writer.lock`)
          .pipe(
            Effect.mapError(() => new WeavraControlTransportError({ code: "STATE_UNAVAILABLE" })),
          ))
      ) {
        // A retired observation cannot release a later confirmation's operation.
        if (runtimeOperation.settled && runtimeOperations.get(entry.root) === runtimeOperation) {
          yield* ownership.release(runtimeOperation.token).pipe(
            Effect.andThen(
              Effect.sync(() => {
                if (runtimeOperation.outcome === "accepted")
                  completedConfirmations.add(
                    confirmationKey(
                      entry.root,
                      runtimeOperation.ownerId,
                      runtimeOperation.confirmation,
                    ),
                  );
                runtimeOperations.delete(entry.root);
              }),
            ),
            Effect.uninterruptible,
          );
        }
      }
      const unresolved =
        runtimeOperation !== undefined &&
        runtimeOperations.get(entry.root) === runtimeOperation &&
        runtimeOperation.settled &&
        !associated &&
        !(
          runtimeOperation.outcome === "accepted" &&
          state.ownerId === runtimeOperation.ownerId &&
          state.busy
        );
      // A fresh observation is published only after its cleanup reconciliation.
      yield* publish(entry, {
        status: unresolved ? "ERROR" : "CONNECTED",
        state: response.data.state,
        stale: unresolved,
        observedAt: yield* Clock.currentTimeMillis,
        errorCode: unresolved ? "STATE_UNAVAILABLE" : null,
      });
    }, refreshMutex.withPermits(1));
    entry.bridge = bridge;
    entry.refresh = refresh();
    const poll = Effect.gen(function* () {
      while (true) {
        yield* refresh().pipe(
          Effect.catchIf(
            (error) => error.code === "REQUEST_TIMEOUT",
            (error) => unavailable(entry, error),
          ),
        );
        yield* Effect.sleep(Duration.seconds(2));
      }
    });
    return yield* Effect.raceFirst(poll, bridge.closed).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (entry.bridge === bridge) {
            delete entry.bridge;
            delete entry.refresh;
          }
        }),
      ),
    );
  });
  const run = Effect.fn("weavra.runControlOwner")(function* (entry: Entry) {
    let attempt = 0;
    while (true) {
      yield* validate(entry);
      yield* publish(entry, {
        status: attempt++ === 0 ? "CONNECTING" : "RECONNECTING",
        stale: true,
        errorCode: null,
      });
      const result = yield* connect(entry).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.scoped,
        Effect.result,
      );
      if (result._tag === "Success") return;
      const retryable =
        result.failure.code === "TRANSPORT_CLOSED" || result.failure.code === "SPAWN_FAILED";
      if (!retryable) entry.stopped = true;
      yield* unavailable(entry, result.failure);
      if (!retryable) return;
      // Only observation reconnects. Prior-epoch mutations are never resubmitted.
      yield* Effect.sleep(Duration.seconds(5));
    }
  });
  const acquire = Effect.fn("weavra.acquireControlOwner")(function* (
    projectId: ProjectId,
    threadId?: ThreadId,
  ) {
    if (environment.T3_WEAVRA_CONTROL !== "1")
      return yield* new WeavraControlTransportError({ code: "INCOMPATIBLE_CAPABILITIES" });
    if (!executable) return yield* new WeavraControlTransportError({ code: "NOT_INSTALLED" });
    if (!path.isAbsolute(executable) || /[\r\n\0]/.test(executable))
      return yield* new WeavraControlTransportError({ code: "INVALID_EXECUTABLE" });
    const binary = yield* fs.stat(executable).pipe(Effect.option);
    if (Option.isNone(binary))
      return yield* new WeavraControlTransportError({ code: "NOT_INSTALLED" });
    if (binary.value.type !== "File" || (binary.value.mode & 0o111) === 0)
      return yield* new WeavraControlTransportError({ code: "INVALID_EXECUTABLE" });
    const root = yield* targetRoot(projectId, threadId);
    const selectedProjectRoot = yield* projectRoot(projectId);
    return yield* mutex.withPermits(1)(
      Effect.gen(function* () {
        const existing = entries.get(root);
        if (existing && !existing.stopped) {
          if (existing.projectId !== projectId)
            return yield* new WeavraControlTransportError({ code: "PROJECT_CHANGED" });
          return existing;
        }
        if (existing) {
          yield* Scope.close(existing.scope, Exit.void);
          entries.delete(root);
        }
        if (entries.size >= 32) {
          const stopped = [...entries.values()].find((entry) => entry.stopped);
          if (stopped) {
            yield* Scope.close(stopped.scope, Exit.void);
            entries.delete(stopped.root);
          }
        }
        if (entries.size >= 32)
          return yield* new WeavraControlTransportError({ code: "STATE_UNAVAILABLE" });
        const scope = yield* Scope.fork(serviceScope);
        const entry: Entry = {
          projectId,
          projectRoot: selectedProjectRoot,
          root,
          scope,
          latest: initial,
          changes: yield* PubSub.sliding<WeavraControlObservation>(8),
          pending: 0,
          stopped: false,
          retiredInventoryEpochs: new Set(),
        };
        entries.set(root, entry);
        yield* run(entry).pipe(
          Effect.catch((error) => {
            entry.stopped = true;
            return unavailable(entry, error);
          }),
          Effect.ensuring(
            Effect.sync(() => {
              entry.stopped = true;
            }),
          ),
          Effect.forkIn(scope),
        );
        return entry;
      }),
    );
  });
  return RuntimeController.of({
    observe: (projectId, threadId) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const result = yield* acquire(projectId, threadId).pipe(Effect.result);
          if (result._tag === "Failure")
            return Stream.make({
              ...initial,
              status: result.failure.code === "NOT_INSTALLED" ? "NOT_INSTALLED" : "ERROR",
              errorCode: result.failure.code,
            } satisfies WeavraControlObservation);
          const entry = result.success;
          const subscription = yield* subscribeBeforeSnapshotWithoutMutex(
            entry.changes,
            Effect.sync(() => entry.latest),
          );
          // The cached value is historical for this subscriber. Only a snapshot checked on the
          // currently bound transport, published after this point, is current.
          if (entry.refresh)
            yield* entry.refresh.pipe(
              Effect.catch((error) => unavailable(entry, error)),
              Effect.forkIn(entry.scope),
            );
          return Stream.concat(
            Stream.make({ ...subscription.latest, stale: true }),
            subscription.changes,
          ).pipe(
            Stream.mapEffect((observation) =>
              Effect.gen(function* () {
                if ((yield* targetRoot(projectId, threadId)) !== entry.root)
                  return yield* new WeavraControlTransportError({ code: "PROJECT_CHANGED" });
                return observation;
              }).pipe(
                Effect.catch((error) =>
                  Effect.succeed({
                    ...initial,
                    status: "ERROR",
                    errorCode: error.code,
                  } satisfies WeavraControlObservation),
                ),
              ),
            ),
          );
        }),
      ),
    command: Effect.fn("weavra.controlCommand")(function* (
      input: WeavraControlInput,
      threadId?: ThreadId,
    ) {
      if (environment.T3_WEAVRA_CONTROL !== "1")
        return yield* new WeavraControlTransportError({ code: "INCOMPATIBLE_CAPABILITIES" });
      const root = yield* targetRoot(input.projectId, threadId);
      const entry = entries.get(root);
      if (
        !entry ||
        entry.projectId !== input.projectId ||
        !entry.bridge ||
        !entry.refresh ||
        entry.latest.stale
      )
        return yield* new WeavraControlTransportError({
          code:
            entry?.latest.errorCode === "STATE_UNAVAILABLE"
              ? "STATE_UNAVAILABLE"
              : "TRANSPORT_CLOSED",
        });
      if (entry.pending >= 8)
        return yield* new WeavraControlTransportError({ code: "STATE_UNAVAILABLE" });
      const capabilities = entry.latest.capabilities;
      const planner =
        input.request.type === "planner.start" ||
        input.request.type === "planner.cancel" ||
        input.request.type === "planner.read";
      // A structured COMPLEX draft is never sent to a Runtime that advertises no COMPLEX contract.
      // The draft shape is the same in contract v1 and v2. Without `plannerContractVersion: 1` the
      // Planner does not exist on this connection, so no planner command is ever sent to it; the
      // same holds for re-run derivation without `rerunContractVersion: 1`.
      if (
        !capabilities ||
        (input.request.type === "workflow.recover" && capabilities.taskRecovery !== 1) ||
        (input.request.type === "workflow.prepare" &&
          input.request.task !== undefined &&
          (capabilities.taskBinding !== 1 || capabilities.analysisContext !== 1)) ||
        (input.request.type === "workflow.prepare" &&
          input.request.complexDraft !== undefined &&
          capabilities.complexContractVersion === undefined) ||
        (planner && capabilities.plannerContractVersion !== 1) ||
        (input.request.type === "workflow.derive" && capabilities.rerunContractVersion !== 1)
      )
        return yield* new WeavraControlTransportError({ code: "INCOMPATIBLE_CAPABILITIES" });
      const bridge = entry.bridge;
      const refresh = entry.refresh;
      entry.pending++;
      const operation = (task: WeavraTask | undefined) =>
        Effect.gen(function* () {
          yield* validate(entry);
          if ((yield* targetRoot(input.projectId, threadId)) !== root)
            return yield* new WeavraControlTransportError({ code: "PROJECT_CHANGED" });
          let runtimeOperation: RuntimeOperation | undefined;
          if (input.request.type === "workflow.confirm" && task === undefined) {
            let admissionLock = runtimeAdmissionLocks.get(root);
            if (!admissionLock) {
              admissionLock = Semaphore.makeUnsafe(1);
              runtimeAdmissionLocks.set(root, admissionLock);
            }
            const confirmation = { ...input.request };
            runtimeOperation = yield* admissionLock.withPermits(1)(
              Effect.gen(function* () {
                // Runtime still checks the fingerprint and owns the replay response.
                if (
                  completedConfirmations.has(
                    confirmationKey(root, capabilities.ownerId, confirmation),
                  )
                )
                  return undefined;
                const existing = runtimeOperations.get(root);
                if (existing) {
                  // Runtime owns duplicate/conflicting-payload decisions for an
                  // acknowledged request. Its replay must not rebind the lease.
                  if (
                    existing.outcome === "accepted" &&
                    existing.settled &&
                    existing.ownerId === capabilities.ownerId &&
                    existing.confirmation.ownerId === confirmation.ownerId &&
                    existing.confirmation.id === confirmation.id &&
                    existing.confirmation.expectedProjectRevision ===
                      confirmation.expectedProjectRevision
                  )
                    return undefined;
                  return yield* new WeavraControlTransportError({ code: "STATE_UNAVAILABLE" });
                }
                const token = yield* ownership
                  .acquireIndependent({ cwd: root, kind: "control" })
                  .pipe(
                    Effect.mapError(
                      () => new WeavraControlTransportError({ code: "STATE_UNAVAILABLE" }),
                    ),
                  );
                const admitted: RuntimeOperation = {
                  token,
                  ownerId: capabilities.ownerId,
                  confirmation,
                  previousRunId: entry.latest.state?.snapshot.status.run?.runId ?? null,
                  previousOwnedRunId: entry.latest.state?.ownedRunId ?? null,
                  outcome: "unacknowledged",
                  runId: null,
                  settled: false,
                };
                runtimeOperations.set(root, admitted);
                return admitted;
              }).pipe(Effect.uninterruptible),
            );
          }
          // From here on this Host may report planner state (§7.3), even if the reply is lost.
          if (input.request.type === "planner.start") entry.plannerStartedOn = bridge;
          const response = yield* bridge.exchange(input.request).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                if (runtimeOperation) runtimeOperation.settled = true;
              }),
            ),
          );
          yield* validate(entry);
          if ((yield* targetRoot(input.projectId, threadId)) !== root)
            return yield* new WeavraControlTransportError({ code: "PROJECT_CHANGED" });
          if (
            response.ownerId !== entry.latest.capabilities?.ownerId ||
            (input.request.type === "workflow.recover" &&
              (entry.bridge !== bridge ||
                response.id !== input.request.id ||
                response.command !== input.request.type))
          )
            return yield* new WeavraControlTransportError({ code: "INVALID_PAYLOAD" });
          if (response.success) {
            const request = input.request;
            const data = response.data;
            const valid =
              request.type === "workflow.recover"
                ? data.kind === "task-recovery" &&
                  data.receipt.executionId === request.metadata.binding.executionId &&
                  (data.receipt.status === "UNKNOWN"
                    ? data.disposition === "NOT_RECOVERED" && data.cleanup === "UNCONFIRMED"
                    : sameTaskMetadata(data.receipt.admission.metadata, request.metadata)) &&
                  (data.disposition === "NOT_RECOVERED" ||
                    (data.receipt.status === "FOUND" &&
                      (data.cleanup === "CONFIRMED"
                        ? ["NOT_STARTED", "CONFIRMED"].includes(
                            data.receipt.admission.cleanup ?? "",
                          )
                        : data.receipt.admission.cleanup === "UNCONFIRMED")))
                : request.type === "workflow.prepare"
                  ? data.kind === "prepared" &&
                    data.preview.ownerId === request.ownerId &&
                    data.preview.projectRevision === request.expectedProjectRevision &&
                    // COMPLEX requires the draft, and a draft is never silently downgraded.
                    (data.preview.workflow === "COMPLEX") ===
                      (request.complexDraft !== undefined) &&
                    complexPreviewConsistent(data.preview, capabilities.complexContractVersion)
                  : request.type === "browser.inspect"
                    ? data.kind === "browser-state"
                    : request.type === "browser.prepare"
                      ? data.kind === "browser-prepared" &&
                        data.preview.ownerId === request.ownerId &&
                        data.preview.projectRevision === request.expectedProjectRevision &&
                        data.preview.candidate.candidateId === request.registration.candidateId &&
                        data.preview.candidate.candidateDigest ===
                          request.registration.expectedCandidateDigest &&
                        data.preview.check.checkId === request.registration.checkId
                      : request.type === "browser.confirm"
                        ? data.kind === "browser-registered"
                        : request.type === "facts.prepare"
                          ? data.kind === "fact-prepared" &&
                            data.preview.ownerId === request.ownerId &&
                            data.preview.projectRevision === request.expectedProjectRevision &&
                            data.preview.sourceRef === request.sourceRef &&
                            data.preview.statement === request.statement
                          : request.type === "facts.confirm"
                            ? data.kind === "fact-confirmed"
                            : request.type === "planner.read"
                              ? // Exactly the requested proposal, with only Planner-shaped claims.
                                data.kind === "planner-draft" &&
                                data.planId === request.planId &&
                                plannerDraftConsistent(data.draft)
                              : request.type === "workflow.derive"
                                ? // The candidate draft of exactly the requested Run (COMPLEX_RERUN.md
                                  // §4): `create` and `modify` claims only, never a deletion.
                                  data.kind === "derived-draft" &&
                                  data.runId === request.runId &&
                                  data.draft.tasks.every((task) =>
                                    task.ownership.every((claim) => claim.operation !== "delete"),
                                  )
                                : data.kind === "accepted" &&
                                  data.command === request.type &&
                                  data.requestId === request.id;
            if (!valid) return yield* new WeavraControlTransportError({ code: "INVALID_PAYLOAD" });
          }
          if (runtimeOperation) {
            if (
              response.ownerId !== runtimeOperation.ownerId ||
              response.id !== runtimeOperation.confirmation.id ||
              response.command !== runtimeOperation.confirmation.type
            )
              return yield* new WeavraControlTransportError({ code: "INVALID_PAYLOAD" });
            runtimeOperation.outcome = response.success ? "accepted" : "rejected";
            if (response.success && response.data.kind === "accepted")
              runtimeOperation.runId = response.data.runId;
          }
          yield* refresh.pipe(Effect.catch((error) => unavailable(entry, error)));
          return response;
        });
      // A disconnected caller stops waiting, not the server-owned command or Runtime execution.
      const readOnly =
        input.request.type === "planner.read" ||
        input.request.type === "browser.inspect" ||
        input.request.type === "workflow.derive";
      const guarded = readOnly
        ? operation(undefined)
        : ownership
            .withControlOperation(root, input.request, operation)
            .pipe(
              Effect.catchTag("WorkspaceOwnershipError", () =>
                Effect.fail(new WeavraControlTransportError({ code: "STATE_UNAVAILABLE" })),
              ),
            );
      const fiber = yield* guarded.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            entry.pending--;
          }),
        ),
        Effect.forkIn(entry.scope),
      );
      return yield* Fiber.join(fiber);
    }),
    checkout: Effect.fn("weavra.controlCheckout")(function* (
      input: WeavraCheckoutIdentityInput,
      threadId?: ThreadId,
    ) {
      if (environment.T3_WEAVRA_CONTROL !== "1")
        return yield* new WeavraControlTransportError({ code: "INCOMPATIBLE_CAPABILITIES" });
      const root = yield* targetRoot(input.projectId, threadId);
      const entry = entries.get(root);
      if (
        !entry ||
        entry.projectId !== input.projectId ||
        !entry.bridge ||
        entry.latest.stale ||
        entry.latest.capabilities?.checkoutIdentity !== 1
      )
        return yield* new WeavraControlTransportError({ code: "INCOMPATIBLE_CAPABILITIES" });
      if (entry.pending >= 8)
        return yield* new WeavraControlTransportError({ code: "STATE_UNAVAILABLE" });
      const bridge = entry.bridge;
      entry.pending++;
      const operation = Effect.gen(function* () {
        yield* validate(entry);
        if ((yield* targetRoot(input.projectId, threadId)) !== root)
          return yield* new WeavraControlTransportError({ code: "PROJECT_CHANGED" });
        const response = yield* bridge.exchange(input.request);
        yield* validate(entry);
        if ((yield* targetRoot(input.projectId, threadId)) !== root)
          return yield* new WeavraControlTransportError({ code: "PROJECT_CHANGED" });
        if (entry.bridge !== bridge || response.ownerId !== entry.latest.capabilities?.ownerId)
          return yield* new WeavraControlTransportError({ code: "INVALID_PAYLOAD" });
        if (
          response.success &&
          (response.runId !== null ||
            response.stateRevision !== null ||
            response.projectRevision !== null ||
            response.data.kind !== "checkout-identity" ||
            response.data.checkout.canonicalCwd !== root ||
            response.data.checkout.repositoryRoot !== root)
        )
          return yield* new WeavraControlTransportError({ code: "INVALID_PAYLOAD" });
        return response;
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            entry.pending--;
          }),
        ),
      );
      const fiber = yield* operation.pipe(Effect.forkIn(entry.scope));
      return yield* Fiber.join(fiber);
    }),
    receipt: Effect.fn("weavra.controlReceipt")(function* (
      projectId: ProjectId,
      threadId: ThreadId,
      request: WeavraTaskReceiptRequest,
    ) {
      const root = yield* targetRoot(projectId, threadId);
      const entry = entries.get(root);
      if (
        environment.T3_WEAVRA_CONTROL !== "1" ||
        !entry ||
        entry.projectId !== projectId ||
        !entry.bridge ||
        entry.latest.stale ||
        entry.latest.capabilities?.taskBinding !== 1
      )
        return yield* new WeavraControlTransportError({ code: "INCOMPATIBLE_CAPABILITIES" });
      if (entry.pending >= 8)
        return yield* new WeavraControlTransportError({ code: "STATE_UNAVAILABLE" });
      const bridge = entry.bridge;
      entry.pending++;
      const operation = Effect.gen(function* () {
        yield* validate(entry);
        if ((yield* targetRoot(projectId, threadId)) !== root)
          return yield* new WeavraControlTransportError({ code: "PROJECT_CHANGED" });
        const response = yield* bridge.exchange(request);
        yield* validate(entry);
        if (
          (yield* targetRoot(projectId, threadId)) !== root ||
          entry.bridge !== bridge ||
          response.ownerId !== entry.latest.capabilities?.ownerId ||
          (response.success &&
            (response.data.kind !== "task-receipt" ||
              response.data.receipt.executionId !== request.executionId))
        )
          return yield* new WeavraControlTransportError({ code: "INVALID_PAYLOAD" });
        return response;
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            entry.pending--;
          }),
        ),
      );
      return yield* Fiber.join(yield* operation.pipe(Effect.forkIn(entry.scope)));
    }),
    evidence: Effect.fn("weavra.controlEvidence")(function* (
      input: WeavraEvidenceDetailsInput,
      threadId?: ThreadId,
    ) {
      if (environment.T3_WEAVRA_CONTROL !== "1")
        return yield* new WeavraControlTransportError({ code: "INCOMPATIBLE_CAPABILITIES" });
      const root = yield* targetRoot(input.projectId, threadId);
      const entry = entries.get(root);
      if (
        !entry ||
        entry.projectId !== input.projectId ||
        !entry.bridge ||
        entry.latest.stale ||
        entry.latest.capabilities?.evidenceDetails !== 1
      )
        return yield* new WeavraControlTransportError({ code: "INCOMPATIBLE_CAPABILITIES" });
      if (entry.pending >= 8)
        return yield* new WeavraControlTransportError({ code: "STATE_UNAVAILABLE" });
      const bridge = entry.bridge;
      entry.pending++;
      const operation = Effect.gen(function* () {
        yield* validate(entry);
        if ((yield* targetRoot(input.projectId, threadId)) !== root)
          return yield* new WeavraControlTransportError({ code: "PROJECT_CHANGED" });
        const response = yield* bridge.exchange(input.request);
        yield* validate(entry);
        if ((yield* targetRoot(input.projectId, threadId)) !== root)
          return yield* new WeavraControlTransportError({ code: "PROJECT_CHANGED" });
        if (entry.bridge !== bridge || response.ownerId !== entry.latest.capabilities?.ownerId)
          return yield* new WeavraControlTransportError({ code: "INVALID_PAYLOAD" });
        if (response.success) {
          const data = response.data;
          if (
            response.runId !== input.request.binding.runId ||
            response.stateRevision !== input.request.binding.revision ||
            (data.kind !== "evidence-details" && data.kind !== "evidence-detail-unavailable") ||
            data.snapshot.executionId !== input.request.binding.executionId ||
            data.snapshot.runId !== input.request.binding.runId ||
            data.snapshot.revision !== input.request.binding.revision ||
            (input.request.binding.diffDigest !== null &&
              data.snapshot.diffDigest !== input.request.binding.diffDigest) ||
            data.cursor.category !== input.request.cursor.category ||
            data.cursor.index !== input.request.cursor.index
          )
            return yield* new WeavraControlTransportError({ code: "INVALID_PAYLOAD" });
        }
        return response;
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            entry.pending--;
          }),
        ),
      );
      const fiber = yield* operation.pipe(Effect.forkIn(entry.scope));
      return yield* Fiber.join(fiber);
    }),
  });
});
export const layer = Layer.effect(RuntimeController, make());
