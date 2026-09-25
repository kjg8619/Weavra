import { it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  WEAVRA_CONTROL_COMMANDS,
  WeavraControlTransportError,
  WS_METHODS,
  type WeavraControlInput,
  type WeavraControlObservation,
  type WeavraComplexExecution,
  type WeavraComplexExecutionV1,
  type WeavraComplexExecutionV2,
  type WeavraControlObserveInput,
  type WeavraControlResponse,
  type WeavraControlState,
  type WeavraComplexDraft,
  type WeavraPlannerStatus,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as TestClock from "effect/testing/TestClock";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";
import { expect, vi } from "vite-plus/test";
import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
} from "../connection/model.ts";
import { EnvironmentRegistry } from "../connection/registry.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import type { RpcSession } from "../rpc/session.ts";
import {
  createEnvironmentWeavraControlCommand,
  createEnvironmentWeavraControlStateAtoms,
  makeEnvironmentWeavraControlState,
  plannerCancelRequest,
  plannerDraftUnchanged,
  plannerElapsedMs,
  plannerLoadedDraft,
  plannerReadRequest,
  plannerRequestDigest,
  plannerStartRequest,
  plannerStatusOf,
  type WeavraControlViewState,
} from "./weavraControl.ts";
import { makeCapabilityInventoryTracker } from "./capabilityInventory.ts";

const target = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("weavra-control-env"),
  label: "Fixture",
  httpBaseUrl: "http://localhost",
  wsBaseUrl: "ws://localhost",
});
const projectId = ProjectId.make("project");
const digest = `sha256:${"a".repeat(64)}`;
const browserPreview: NonNullable<WeavraControlState["browserPreview"]> = {
  previewId: "browser-preview",
  previewDigest: digest,
  ownerId: "owner",
  projectRevision: 10,
  expiresAt: 10000,
  candidate: {
    schemaVersion: 2,
    kind: "BROWSER_OBSERVATION_CANDIDATE",
    candidateId: "00000000-0000-4000-8000-000000000001",
    projectId: digest,
    authority: "CANDIDATE_ONLY",
    scope: "LOCAL_STATIC_DOCUMENT",
    origin: "http://localhost",
    documentIdentity: "http://localhost/index.html",
    capturedAt: 10,
    pageRevision: digest,
    source: {
      implementationRevision: digest,
      readerRevision: "a".repeat(40),
      readerDigest: digest,
      executableIdentityDigest: digest,
      browserVersion: "Chromium 130",
    },
    freshness: { mode: "CAPTURE_ONLY", startedAt: 9, finishedAt: 10 },
    observationDigest: digest,
    observationType: "target",
    observation: { target: { selector: "#status" }, exists: true, value: "Ready" },
    candidateDigest: digest,
    cleanup: "CONFIRMED",
  },
  check: {
    version: 1,
    checkId: "status-ready",
    projectId: digest,
    origin: "http://localhost",
    documentIdentity: "http://localhost/index.html",
    target: { selector: "#status" },
    assertion: { type: "text_equals", expected: "Ready" },
    freshness: { mode: "NEW_ISOLATED_CAPTURE", maxAgeMs: 10000 },
    registrationDigest: digest,
  },
  isolation: "PRIVATE_HOME_PROFILE_CDP_PIPE_NOT_OS_SANDBOX",
};

function canonicalState(
  projectRevision: number,
  stateRevision: number | null = projectRevision,
  runId = "run",
  ownerId = "owner",
): WeavraControlState {
  return {
    ownerId,
    nextRequestId: `${ownerId}:${projectRevision + 1}`,
    projectRevision,
    stateRevision,
    ownedRunId: runId,
    busy: true,
    cancelling: false,
    startFailure: null,
    preview: {
      previewId: "preview",
      previewDigest: digest,
      ownerId,
      projectRevision,
      expiresAt: 10000,
      goal: "Implement the feature",
      workflow: "STANDARD",
      executionMode: "EDIT",
      risk: "R3",
      allowedPaths: ["src/obsolete.ts"],
      checks: [],
      acceptanceCriteria: [],
      taskContractDigest: digest,
      recipe: null,
      configuration: {
        mutationMode: "strict",
        verifierTrustMode: "strict",
        verifierSandboxMode: "required",
        contextPackMode: "bounded",
        verificationRepairMode: "disabled",
        lspEnabled: false,
      },
    },
    browserPreview: null,
    factPreview: null,
    projectFacts: { status: "available", entries: [] },
    pendingApproval: {
      approvalId: "approval",
      runId,
      stateRevision: stateRevision ?? 0,
      projectRevision,
      risk: "R3",
      operation: "delete-file",
      role: "Developer",
      step: { stepId: "implement", attempt: 1 },
      path: "src/obsolete.ts",
      bytes: 20,
      preconditionDigest: "b".repeat(64),
      expiresAt: 10000,
      explanation: "Remove obsolete implementation",
    },
    snapshot: {
      status: {
        source: "durable-canonical-state",
        ownerObserved: false,
        state: "available",
        writerPresent: true,
        run: {
          runId,
          status: "WAITING_APPROVAL",
          phase: "IMPLEMENT",
          workflow: "STANDARD",
          risk: "R3",
          executionMode: "EDIT",
          codeRevision: 0,
          currentStep: { stepId: "implement", attempt: 1 },
          activeAgentCount: 0,
          taskContractDigest: digest,
          createdAt: 1,
          updatedAt: projectRevision,
        },
      },
      graph: {
        runId,
        stateRevision: stateRevision ?? 0,
        status: "WAITING_APPROVAL",
        nodes: [{ id: "implement:1", kind: "agent", status: "blocked", role: "Developer" }],
        edges: [],
      },
      graphAvailable: true,
      evidence: null,
      configuration: { source: "project-config-not-frozen-run-config", status: "missing" },
    },
  };
}

function observed(
  projectRevision: number,
  stateRevision: number | null = projectRevision,
  runId = "run",
  ownerId = "owner",
): WeavraControlObservation {
  return {
    status: "CONNECTED",
    state: canonicalState(projectRevision, stateRevision, runId, ownerId),
    capabilities: {
      authority: "Runtime/Kernel",
      control: "workflow-control-v1",
      ownerId,
      commands: WEAVRA_CONTROL_COMMANDS,
      maxRequestBytes: 32768,
      maxResponseBytes: 65536,
      resultLimit: 100,
      previewTtlMs: 10000,
      runtimeVersion: "0.85.1",
      readiness: "READY",
      recipes: [],
    },
    stale: false,
    observedAt: projectRevision,
    errorCode: null,
  };
}

type ObservationEvent = Effect.Effect<WeavraControlObservation, WeavraControlTransportError>;
type ObservationSubscription = {
  input: WeavraControlObserveInput;
  events: Queue.Queue<ObservationEvent>;
};
/** A new subscription first receives the server's cached value, then its checked refresh. */
const cachedThenChecked = (
  events: Queue.Queue<ObservationEvent>,
  observation: WeavraControlObservation,
) => Queue.offerAll(events, [Effect.succeed(observation), Effect.succeed(observation)]);
const makeSession = Effect.fnUntraced(function* (
  capabilities: { weavraControl?: boolean } = { weavraControl: true },
) {
  const subscriptions = yield* Queue.unbounded<ObservationSubscription>();
  const requests = yield* Queue.unbounded<{
    input: WeavraControlInput;
    reply: Deferred.Deferred<WeavraControlResponse, WeavraControlTransportError>;
  }>();
  const sent: WeavraControlInput[] = [];
  const client = {
    [WS_METHODS.weavraControlObserve]: (input: WeavraControlObserveInput) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const events = yield* Queue.unbounded<ObservationEvent>();
          yield* Queue.offer(subscriptions, { input, events });
          return Stream.fromQueue(events).pipe(Stream.mapEffect((event) => event));
        }),
      ),
    [WS_METHODS.weavraControl]: (input: WeavraControlInput) =>
      Effect.gen(function* () {
        sent.push(input);
        const reply = yield* Deferred.make<WeavraControlResponse, WeavraControlTransportError>();
        yield* Queue.offer(requests, { input, reply });
        return yield* Deferred.await(reply);
      }),
  } as unknown as WsRpcProtocolClient;
  const session: RpcSession = {
    client,
    initialConfig: Effect.succeed({ environment: { capabilities } } as never),
    subscribeServerConfig: () => Stream.empty,
    ready: Effect.void,
    probe: Effect.void,
    closed: Effect.never,
  };
  return { session, subscriptions, requests, sent };
});
const setup = Effect.fnUntraced(function* (current: RpcSession) {
  return EnvironmentSupervisor.of({
    target,
    session: yield* SubscriptionRef.make<Option.Option<RpcSession>>(Option.some(current)),
    state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
    prepared: yield* SubscriptionRef.make<Option.Option<PreparedConnection>>(Option.none()),
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  });
});
function waitFor(
  state: SubscriptionRef.SubscriptionRef<WeavraControlViewState>,
  predicate: (value: WeavraControlViewState) => boolean,
) {
  return SubscriptionRef.changes(state).pipe(
    Stream.filter(predicate),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );
}
const makeRuntime = Effect.fnUntraced(function* (supervisor: EnvironmentSupervisor["Service"]) {
  const run: EnvironmentRegistry["Service"]["run"] = (_environmentId, effect) =>
    Effect.provideService(effect, EnvironmentSupervisor, supervisor);
  const followStream: EnvironmentRegistry["Service"]["followStream"] = (_environmentId, stream) =>
    Stream.provideService(stream, EnvironmentSupervisor, supervisor);
  const runtime = Atom.runtime(
    Layer.succeed(EnvironmentRegistry, {
      run,
      followStream,
      stateChanges: () => SubscriptionRef.changes(supervisor.state),
    } as unknown as EnvironmentRegistry["Service"]),
  );
  const registry = AtomRegistry.make();
  yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
  return {
    registry,
    command: createEnvironmentWeavraControlCommand(runtime),
    atoms: createEnvironmentWeavraControlStateAtoms(runtime),
  };
});
function waitForAtom<A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>,
  predicate: (value: A) => boolean,
) {
  return AtomRegistry.toStream(registry, atom).pipe(
    Stream.filter(AsyncResult.isSuccess),
    Stream.map((result) => result.value),
    Stream.filter(predicate),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );
}
const cancelInput: WeavraControlInput = {
  projectId,
  request: {
    protocolVersion: 1,
    id: "owner:11",
    ownerId: "owner",
    expectedProjectRevision: 10,
    type: "workflow.cancel",
    runId: "run",
    expectedStateRevision: 10,
  },
};
function accepted(input: WeavraControlInput): WeavraControlResponse {
  const command = input.request.type;
  if (
    command !== "workflow.confirm" &&
    command !== "workflow.cancel" &&
    command !== "approval.resolve"
  ) {
    throw new Error("Command is not an accepted acknowledgement");
  }
  return {
    protocolVersion: 1,
    type: "control_response",
    id: input.request.id,
    command,
    ownerId: input.request.ownerId,
    runId: "run",
    projectRevision: 11,
    stateRevision: 11,
    eventId: "run:11",
    timestamp: 11,
    success: true,
    data: { kind: "accepted", command, requestId: input.request.id, runId: "run" },
  };
}

for (const capabilities of [{}, { weavraControl: false }]) {
  it.effect(
    `never opens a control stream without explicit opt-in (${JSON.stringify(capabilities)})`,
    () =>
      Effect.gen(function* () {
        const remote = yield* makeSession(capabilities);
        const supervisor = yield* setup(remote.session);
        const state = yield* makeEnvironmentWeavraControlState(projectId).pipe(
          Effect.provideService(EnvironmentSupervisor, supervisor),
        );
        const unsupported = yield* waitFor(state, (view) => view.support === "unsupported");
        expect(unsupported.observation).toMatchObject({ state: null, stale: true });
        expect(yield* Queue.size(remote.subscriptions)).toBe(0);
      }).pipe(Effect.scoped),
  );
}

it.effect(
  "opens controlObserve with only the project and promotes only the checked observation after the historical first emission",
  () =>
    Effect.gen(function* () {
      const remote = yield* makeSession();
      const supervisor = yield* setup(remote.session);
      const state = yield* makeEnvironmentWeavraControlState(projectId).pipe(
        Effect.provideService(EnvironmentSupervisor, supervisor),
      );
      const subscription = yield* Queue.take(remote.subscriptions);
      expect(subscription.input).toEqual({ projectId });
      expect((yield* SubscriptionRef.get(state)).observation.stale).toBe(true);
      const canonical = observed(10);
      // Even a CONNECTED, fresh-looking first emission is the server's cached history.
      yield* Queue.offer(subscription.events, Effect.succeed(canonical));
      const historical = yield* waitFor(state, (view) => view.observation.state !== null);
      expect(historical.observation).toEqual({ ...canonical, stale: true });
      yield* Queue.offer(subscription.events, Effect.succeed(canonical));
      expect((yield* waitFor(state, (view) => !view.observation.stale)).observation).toEqual(
        canonical,
      );
    }).pipe(Effect.scoped),
);

it.effect("retains canonical display as stale on stream failure", () =>
  Effect.gen(function* () {
    const remote = yield* makeSession();
    const supervisor = yield* setup(remote.session);
    const state = yield* makeEnvironmentWeavraControlState(projectId).pipe(
      Effect.provideService(EnvironmentSupervisor, supervisor),
    );
    const subscription = yield* Queue.take(remote.subscriptions);
    const canonical = observed(10);
    yield* cachedThenChecked(subscription.events, canonical);
    yield* waitFor(state, (view) => !view.observation.stale);
    yield* Queue.offer(
      subscription.events,
      Effect.fail(new WeavraControlTransportError({ code: "STATE_UNAVAILABLE" })),
    );
    const failed = yield* waitFor(state, (view) => view.observation.status === "ERROR");
    expect(failed.observation).toEqual({
      ...canonical,
      status: "ERROR",
      stale: true,
      errorCode: "STATE_UNAVAILABLE",
    });
  }).pipe(Effect.scoped),
);

it.effect(
  "retains display through disconnect but rejects stale session callbacks until replacement canonical state",
  () =>
    Effect.gen(function* () {
      const old = yield* makeSession();
      const supervisor = yield* setup(old.session);
      const state = yield* makeEnvironmentWeavraControlState(projectId).pipe(
        Effect.provideService(EnvironmentSupervisor, supervisor),
      );
      const oldSubscription = yield* Queue.take(old.subscriptions);
      const canonical = observed(10);
      yield* cachedThenChecked(oldSubscription.events, canonical);
      yield* waitFor(state, (view) => !view.observation.stale);
      yield* SubscriptionRef.set(supervisor.session, Option.none());
      const disconnected = yield* waitFor(
        state,
        (view) => view.observation.status === "DISCONNECTED",
      );
      expect(disconnected.observation).toEqual({
        ...canonical,
        status: "DISCONNECTED",
        stale: true,
      });
      const fresh = yield* makeSession();
      yield* SubscriptionRef.set(supervisor.session, Option.some(fresh.session));
      const freshSubscription = yield* Queue.take(fresh.subscriptions);
      expect((yield* SubscriptionRef.get(state)).observation).toMatchObject({
        state: canonical.state,
        stale: true,
      });
      yield* Queue.offer(oldSubscription.events, Effect.succeed(observed(999)));
      yield* Queue.offer(
        freshSubscription.events,
        Effect.succeed({ ...canonical, status: "CONNECTING", state: null, stale: true }),
      );
      const connecting = yield* waitFor(state, (view) => view.observation.status === "CONNECTING");
      expect(connecting.observation.state).toEqual(canonical.state);
      const replacement = observed(11, 1, "replacement-run");
      yield* Queue.offer(freshSubscription.events, Effect.succeed(replacement));
      expect((yield* waitFor(state, (view) => !view.observation.stale)).observation).toEqual(
        replacement,
      );
    }).pipe(Effect.scoped),
);

it.effect(
  "discards preview and approval when capabilities announce a new owner epoch before its snapshot",
  () =>
    Effect.gen(function* () {
      const remote = yield* makeSession();
      const supervisor = yield* setup(remote.session);
      const state = yield* makeEnvironmentWeavraControlState(projectId, {
        observation: {
          ...observed(10),
          state: { ...canonicalState(10), browserPreview },
        },
      }).pipe(Effect.provideService(EnvironmentSupervisor, supervisor));
      const subscription = yield* Queue.take(remote.subscriptions);
      const replacement = observed(11, 1, "replacement-run", "replacement-owner");
      yield* Queue.offer(
        subscription.events,
        Effect.succeed({ ...replacement, status: "CONNECTING", state: null, stale: true }),
      );
      const connecting = yield* waitFor(
        state,
        (view) => view.observation.capabilities?.ownerId === "replacement-owner",
      );
      expect(connecting.observation.state).toBeNull();
      const next = {
        ...replacement,
        state: {
          ...canonicalState(11, 1, "replacement-run", "replacement-owner"),
          preview: null,
          browserPreview: null,
          pendingApproval: null,
        },
      };
      yield* Queue.offer(subscription.events, Effect.succeed(next));
      expect((yield* waitFor(state, (view) => !view.observation.stale)).observation).toEqual(next);
    }).pipe(Effect.scoped),
);

for (const [label, regressed] of [
  ["project revision", observed(9, 11)],
  ["same-run revision", observed(11, 9)],
  ["missing same-run revision", observed(11, null)],
] as const) {
  it.effect(`does not replace newer cached canonical state with regressed ${label}`, () =>
    Effect.gen(function* () {
      const remote = yield* makeSession();
      const supervisor = yield* setup(remote.session);
      const canonical = observed(10);
      const state = yield* makeEnvironmentWeavraControlState(projectId, {
        observation: canonical,
      }).pipe(Effect.provideService(EnvironmentSupervisor, supervisor));
      const subscription = yield* Queue.take(remote.subscriptions);
      yield* Queue.offer(subscription.events, Effect.succeed(regressed));
      const rejected = yield* waitFor(
        state,
        (view) => view.observation.errorCode === "REVISION_REGRESSION",
      );
      expect(rejected.observation).toMatchObject({
        state: canonical.state,
        stale: true,
        status: "ERROR",
      });
      const next = observed(11, 11);
      yield* Queue.offer(subscription.events, Effect.succeed(next));
      expect((yield* waitFor(state, (view) => !view.observation.stale)).observation).toEqual(next);
    }).pipe(Effect.scoped),
  );
}

for (const errorCode of ["PROJECT_CHANGED", "PROJECT_UNAVAILABLE"] as const) {
  it.effect(
    `${errorCode} clears control state and capabilities instead of retaining cached authority`,
    () =>
      Effect.gen(function* () {
        const remote = yield* makeSession();
        const supervisor = yield* setup(remote.session);
        const state = yield* makeEnvironmentWeavraControlState(projectId, {
          observation: observed(10),
        }).pipe(Effect.provideService(EnvironmentSupervisor, supervisor));
        const subscription = yield* Queue.take(remote.subscriptions);
        yield* Queue.offer(
          subscription.events,
          Effect.succeed({
            ...observed(10),
            status: "ERROR",
            errorCode,
            state: null,
            stale: true,
            observedAt: null,
          }),
        );
        const revoked = yield* waitFor(state, (view) => view.observation.errorCode === errorCode);
        expect(revoked.observation).toMatchObject({
          state: null,
          capabilities: null,
          stale: true,
          observedAt: null,
        });
      }).pipe(Effect.scoped),
  );
}

for (const [nextProject, nextRoot] of [
  [projectId, "/replacement-root"],
  [ProjectId.make("replacement-project"), "/root"],
] as const) {
  it.effect(
    `isolates canonical state and callbacks after key change to ${nextProject}:${nextRoot}`,
    () =>
      Effect.gen(function* () {
        const remote = yield* makeSession();
        const supervisor = yield* setup(remote.session);
        const h = yield* makeRuntime(supervisor);
        const oldAtom = h.atoms.stateAtom(target.environmentId, projectId, "/root");
        const stopOld = h.registry.mount(oldAtom);
        const oldSubscription = yield* Queue.take(remote.subscriptions);
        yield* cachedThenChecked(oldSubscription.events, observed(10));
        yield* waitForAtom(h.registry, oldAtom, (view) => !view.observation.stale);
        const nextAtom = h.atoms.stateAtom(target.environmentId, nextProject, nextRoot);
        h.registry.mount(nextAtom);
        const nextSubscription = yield* Queue.take(remote.subscriptions);
        expect(nextSubscription.input).toEqual({ projectId: nextProject });
        const connecting = yield* waitForAtom(
          h.registry,
          nextAtom,
          (view) => view.support === "supported",
        );
        expect(connecting.observation).toMatchObject({ state: null, stale: true });
        stopOld();
        yield* Queue.offer(oldSubscription.events, Effect.succeed(observed(999)));
        yield* Queue.offer(
          nextSubscription.events,
          Effect.succeed({ ...observed(0), status: "CONNECTING", state: null, stale: true }),
        );
        expect(
          (yield* waitForAtom(
            h.registry,
            nextAtom,
            (view) => view.observation.status === "CONNECTING",
          )).observation.state,
        ).toBeNull();
        const next = observed(1, 1, "replacement-run", "replacement-owner");
        yield* Queue.offer(nextSubscription.events, Effect.succeed(next));
        expect(
          (yield* waitForAtom(h.registry, nextAtom, (view) => !view.observation.stale)).observation,
        ).toEqual(next);
      }).pipe(Effect.scoped),
  );
}

it.effect("old scope finalization cannot mark the replacement stream or its cache stale", () =>
  Effect.gen(function* () {
    const old = yield* makeSession();
    const fresh = yield* makeSession();
    const cache = { observation: observed(1) };
    const oldScope = yield* Scope.make();
    const oldSupervisor = yield* setup(old.session);
    yield* makeEnvironmentWeavraControlState(projectId, cache).pipe(
      Effect.provideService(EnvironmentSupervisor, oldSupervisor),
      Scope.provide(oldScope),
    );
    yield* Queue.take(old.subscriptions);
    const freshSupervisor = yield* setup(fresh.session);
    const state = yield* makeEnvironmentWeavraControlState(projectId, cache).pipe(
      Effect.provideService(EnvironmentSupervisor, freshSupervisor),
    );
    const subscription = yield* Queue.take(fresh.subscriptions);
    const next = observed(20);
    yield* cachedThenChecked(subscription.events, next);
    yield* waitFor(state, (view) => !view.observation.stale);
    yield* Scope.close(oldScope, Exit.void);
    expect(cache.observation).toEqual(next);
    expect((yield* SubscriptionRef.get(state)).observation).toEqual(next);
  }).pipe(Effect.scoped),
);

for (const capabilities of [{}, { weavraControl: false }]) {
  it.effect(`rejects commands without opt-in capability (${JSON.stringify(capabilities)})`, () =>
    Effect.gen(function* () {
      const remote = yield* makeSession(capabilities);
      const supervisor = yield* setup(remote.session);
      const h = yield* makeRuntime(supervisor);
      const result = yield* Effect.promise(() =>
        h.command.run(h.registry, { environmentId: target.environmentId, input: cancelInput }),
      );
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure")
        expect(Cause.squash(result.cause)).toMatchObject({ code: "INCOMPATIBLE_CAPABILITIES" });
      expect(remote.sent).toEqual([]);
    }).pipe(Effect.scoped),
  );
}

it.effect("rejects commands without an active connected session", () =>
  Effect.gen(function* () {
    const remote = yield* makeSession();
    const supervisor = yield* setup(remote.session);
    yield* SubscriptionRef.set(supervisor.session, Option.none());
    const h = yield* makeRuntime(supervisor);
    const result = yield* Effect.promise(() =>
      h.command.run(h.registry, { environmentId: target.environmentId, input: cancelInput }),
    );
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure")
      expect(Cause.squash(result.cause)).toMatchObject({ code: "TRANSPORT_CLOSED" });
    expect(remote.sent).toEqual([]);
  }).pipe(Effect.scoped),
);

it.effect("rejects a command whose session changes while capability discovery is pending", () =>
  Effect.gen(function* () {
    const old = yield* makeSession();
    const fresh = yield* makeSession();
    const config = yield* old.session.initialConfig;
    const started = yield* Deferred.make<void>();
    const release = yield* Deferred.make<typeof config>();
    const supervisor = yield* setup({
      ...old.session,
      initialConfig: Deferred.succeed(started, undefined).pipe(
        Effect.andThen(Deferred.await(release)),
      ),
    });
    const h = yield* makeRuntime(supervisor);
    const result = h.command.run(h.registry, {
      environmentId: target.environmentId,
      input: cancelInput,
    });
    yield* Deferred.await(started);
    yield* SubscriptionRef.set(supervisor.session, Option.some(fresh.session));
    yield* Deferred.succeed(release, config);
    const settled = yield* Effect.promise(() => result);
    expect(settled._tag).toBe("Failure");
    if (settled._tag === "Failure")
      expect(Cause.squash(settled.cause)).toMatchObject({ code: "TRANSPORT_CLOSED" });
    expect(old.sent).toEqual([]);
    expect(fresh.sent).toEqual([]);
  }).pipe(Effect.scoped),
);

it.effect(
  "sends a mutation once and never replays it into the replacement session after disconnect",
  () =>
    Effect.gen(function* () {
      const old = yield* makeSession();
      const supervisor = yield* setup(old.session);
      const h = yield* makeRuntime(supervisor);
      const atom = h.atoms.stateAtom(target.environmentId, projectId, "/root");
      h.registry.mount(atom);
      const subscription = yield* Queue.take(old.subscriptions);
      const canonical = observed(10);
      yield* cachedThenChecked(subscription.events, canonical);
      yield* waitForAtom(h.registry, atom, (view) => !view.observation.stale);
      const result = h.command.run(h.registry, {
        environmentId: target.environmentId,
        input: cancelInput,
      });
      const request = yield* Queue.take(old.requests);
      expect(request.input).toEqual(cancelInput);
      yield* SubscriptionRef.set(supervisor.session, Option.none());
      yield* waitForAtom(h.registry, atom, (view) => view.observation.status === "DISCONNECTED");
      yield* Deferred.fail(
        request.reply,
        new WeavraControlTransportError({ code: "TRANSPORT_CLOSED" }),
      );
      const failed = yield* Effect.promise(() => result);
      expect(failed._tag).toBe("Failure");
      if (failed._tag === "Failure")
        expect(Cause.squash(failed.cause)).toMatchObject({ code: "TRANSPORT_CLOSED" });
      const fresh = yield* makeSession();
      yield* SubscriptionRef.set(supervisor.session, Option.some(fresh.session));
      const replacement = yield* Queue.take(fresh.subscriptions);
      yield* cachedThenChecked(replacement.events, observed(11));
      yield* waitForAtom(h.registry, atom, (view) => !view.observation.stale);
      expect(old.sent).toEqual([cancelInput]);
      expect(fresh.sent).toEqual([]);
    }).pipe(Effect.scoped),
);

for (const request of [
  {
    protocolVersion: 1,
    id: "owner:11",
    ownerId: "owner",
    expectedProjectRevision: 10,
    type: "workflow.confirm",
    previewId: "preview",
    previewDigest: digest,
  },
  cancelInput.request,
  {
    protocolVersion: 1,
    id: "owner:11",
    ownerId: "owner",
    expectedProjectRevision: 10,
    type: "approval.resolve",
    runId: "run",
    expectedStateRevision: 10,
    approvalId: "approval",
    decision: "approve",
  },
] satisfies ReadonlyArray<WeavraControlInput["request"]>) {
  it.effect(
    `${request.type} acknowledgement cannot manufacture canonical run, approval, graph or evidence outcomes`,
    () =>
      Effect.gen(function* () {
        const remote = yield* makeSession();
        const supervisor = yield* setup(remote.session);
        const h = yield* makeRuntime(supervisor);
        const atom = h.atoms.stateAtom(target.environmentId, projectId, "/root");
        h.registry.mount(atom);
        const subscription = yield* Queue.take(remote.subscriptions);
        const canonical = observed(10);
        yield* cachedThenChecked(subscription.events, canonical);
        yield* waitForAtom(h.registry, atom, (view) => !view.observation.stale);
        const input: WeavraControlInput = { projectId, request };
        const result = h.command.run(h.registry, { environmentId: target.environmentId, input });
        const pending = yield* Queue.take(remote.requests);
        expect((yield* AtomRegistry.getResult(h.registry, atom)).observation).toEqual(canonical);
        yield* Deferred.succeed(pending.reply, accepted(input));
        expect(yield* Effect.promise(() => result)).toMatchObject({
          _tag: "Success",
          value: accepted(input),
        });
        expect(remote.sent).toEqual([input]);
        expect((yield* AtomRegistry.getResult(h.registry, atom)).observation).toEqual(canonical);
        const next = observed(11);
        yield* Queue.offer(subscription.events, Effect.succeed(next));
        expect(
          (yield* waitForAtom(
            h.registry,
            atom,
            (view) => view.observation.state?.projectRevision === 11,
          )).observation,
        ).toEqual(next);
      }).pipe(Effect.scoped),
  );
}

it.effect(
  "a canonical owner replacement cannot inherit the prior preview or pending approval",
  () =>
    Effect.gen(function* () {
      const remote = yield* makeSession();
      const supervisor = yield* setup(remote.session);
      const state = yield* makeEnvironmentWeavraControlState(projectId, {
        observation: {
          ...observed(10),
          state: { ...canonicalState(10), browserPreview },
        },
      }).pipe(Effect.provideService(EnvironmentSupervisor, supervisor));
      const subscription = yield* Queue.take(remote.subscriptions);
      const replacement: WeavraControlObservation = {
        ...observed(11, 1, "replacement-run", "replacement-owner"),
        state: {
          ...canonicalState(11, 1, "replacement-run", "replacement-owner"),
          preview: null,
          browserPreview: null,
          pendingApproval: null,
        },
      };
      yield* cachedThenChecked(subscription.events, replacement);
      expect((yield* waitFor(state, (view) => !view.observation.stale)).observation).toEqual(
        replacement,
      );
    }).pipe(Effect.scoped),
);

function brokerObservation(
  generation: number,
  brokerEpoch = "12345678-1234-1234-1234-123456789abc",
): WeavraControlObservation {
  const observation = observed(10);
  return {
    ...observation,
    state: {
      ...observation.state!,
      capabilityInventory: {
        schemaVersion: 1,
        coverage: "RUNTIME_ACTION_TOOLS",
        ownerId: "owner",
        projectRevision: 10,
        brokerEpoch,
        generation,
        status: "CURRENT",
        reason: "OBSERVED",
        observedAt: 1,
        entries: [
          {
            descriptor: {
              id: "weavra.worker.runtime_read",
              name: "runtime_read",
              kind: "worker-tool",
              origin: "weavra-runtime",
              transport: "in-process",
              schemaDigest: digest,
              fingerprint: digest,
              source: "runtime-static",
            },
            requirements: {
              operation: "read",
              mode: "READ_OR_EDIT",
              policy: "PER_ACTION",
              approval: "RUNTIME_DECIDES",
            },
            observation: {
              availability: "AVAILABLE",
              reason: "DEFINITION_PRESENT",
              source: "runtime-static",
              observedAt: 1,
            },
          },
        ],
        total: 1,
        omitted: 0,
      },
    },
  };
}

it("treats every subscription first emission as stale even when CONNECTED and previously unseen", () => {
  const tracker = makeCapabilityInventoryTracker();
  expect(tracker.receive(brokerObservation(20), 100).status).toBe("NEEDS_REFRESH");
  expect(tracker.receive(brokerObservation(20), 200).status).toBe("NEEDS_REFRESH");
  expect(tracker.receive(brokerObservation(21), 300).status).toBe("CURRENT");
  tracker.restart();
  expect(tracker.view(400).inventory).toBeNull();
  expect(tracker.receive(brokerObservation(99), 500).status).toBe("NEEDS_REFRESH");
  expect(tracker.receive(brokerObservation(99), 600).status).toBe("NEEDS_REFRESH");
  expect(tracker.receive(brokerObservation(100), 700).status).toBe("CURRENT");
});

it("uses local monotonic receipt age, never Host time or equal generation as a lease", () => {
  const tracker = makeCapabilityInventoryTracker();
  tracker.receive(brokerObservation(1), 0);
  tracker.receive(brokerObservation(2), 100);
  expect(tracker.receive(brokerObservation(2), 5_099).status).toBe("CURRENT");
  expect(tracker.view(5_100).status).toBe("NEEDS_REFRESH");
  expect(tracker.receive(brokerObservation(2), 6_000).status).toBe("NEEDS_REFRESH");
  expect(tracker.receive(brokerObservation(3), 6_001).status).toBe("CURRENT");
});

it("invalidates equal changed payload and regression without last-good promotion", () => {
  for (const generation of [1, 2]) {
    const tracker = makeCapabilityInventoryTracker();
    tracker.receive(brokerObservation(1), 0);
    tracker.receive(brokerObservation(2), 1);
    const original = brokerObservation(generation);
    const changed = {
      ...original,
      state: {
        ...original.state!,
        capabilityInventory: { ...original.state!.capabilityInventory!, entries: [], total: 0 },
      },
    };
    expect(tracker.receive(changed, 2).status).toBe("NEEDS_REFRESH");
    expect(tracker.view(2).inventory).toBeNull();
    expect(tracker.receive(brokerObservation(2), 3).status).toBe("NEEDS_REFRESH");
  }
});

it("replaces removed rows and failed inventories, and absence never means an empty current catalog", () => {
  const tracker = makeCapabilityInventoryTracker();
  expect(tracker.receive(observed(10), 0).status).toBe("NOT_EXPOSED");
  expect(tracker.receive(brokerObservation(1), 1).status).toBe("CURRENT");
  const original = brokerObservation(2);
  const removed = {
    ...original,
    state: {
      ...original.state!,
      capabilityInventory: { ...original.state!.capabilityInventory!, entries: [], total: 0 },
    },
  };
  expect(tracker.receive(removed, 2)).toMatchObject({
    status: "CURRENT",
    inventory: { entries: [], total: 0 },
  });
  for (const [status, reason] of [
    ["UNKNOWN", "CONFIG_UNAVAILABLE"],
    ["NEEDS_REFRESH", "SOURCE_CHANGED"],
  ] as const) {
    const originalFailure = brokerObservation(status === "UNKNOWN" ? 3 : 4);
    const failed = {
      ...originalFailure,
      state: {
        ...originalFailure.state!,
        capabilityInventory: {
          ...originalFailure.state!.capabilityInventory!,
          status,
          reason,
          entries: [],
          total: null,
        },
      },
    };
    expect(tracker.receive(failed, 3)).toMatchObject({
      status,
      inventory: { entries: [], total: null },
    });
  }
  expect(tracker.receive(observed(10), 4)).toEqual({ status: "NOT_EXPOSED", inventory: null });
});

it("disconnect, scope mismatches and retired epochs cannot restore current rows or borrow approval", () => {
  const tracker = makeCapabilityInventoryTracker();
  tracker.receive(brokerObservation(1), 0);
  const approvedElsewhere = brokerObservation(2);
  tracker.receive(approvedElsewhere, 1);
  tracker.stale();
  expect(tracker.view(2)).toMatchObject({ status: "NEEDS_REFRESH", inventory: { generation: 2 } });
  expect(tracker.receive(brokerObservation(2), 3).status).toBe("NEEDS_REFRESH");
  const replacement = brokerObservation(1, "aaaaaaaa-1234-1234-1234-123456789abc");
  expect(tracker.receive(replacement, 4).status).toBe("CURRENT");
  expect(tracker.receive(brokerObservation(999), 5)).toEqual({
    status: "NEEDS_REFRESH",
    inventory: null,
  });
  for (const mismatch of [
    { ...replacement, capabilities: { ...replacement.capabilities!, ownerId: "other" } },
    { ...replacement, state: { ...replacement.state!, projectRevision: 11 } },
  ]) {
    expect(tracker.receive(mismatch, 6).status).toBe("NEEDS_REFRESH");
  }
  expect(approvedElsewhere.state!.snapshot.evidence).toBeNull();
});

it.effect(
  "keeps workflow freshness independent while inventory waits for a second checked generation",
  () =>
    Effect.gen(function* () {
      const remote = yield* makeSession();
      const supervisor = yield* setup(remote.session);
      const state = yield* makeEnvironmentWeavraControlState(projectId).pipe(
        Effect.provideService(EnvironmentSupervisor, supervisor),
      );
      const subscription = yield* Queue.take(remote.subscriptions);
      yield* cachedThenChecked(subscription.events, brokerObservation(10));
      const baseline = yield* waitFor(state, (view) => !view.observation.stale);
      expect(baseline.capabilityInventory.status).toBe("NEEDS_REFRESH");
      yield* Queue.offer(subscription.events, Effect.succeed(brokerObservation(11)));
      const current = yield* waitFor(
        state,
        (view) => view.capabilityInventory.status === "CURRENT",
      );
      expect(current.observation.state?.snapshot).toEqual(baseline.observation.state?.snapshot);
      expect(current.observation.state?.pendingApproval).toEqual(
        baseline.observation.state?.pendingApproval,
      );
      expect(remote.sent).toEqual([]);
      yield* SubscriptionRef.set(supervisor.session, Option.none());
      const disconnected = yield* waitFor(
        state,
        (view) => view.observation.status === "DISCONNECTED",
      );
      expect(disconnected.capabilityInventory.status).not.toBe("CURRENT");
      const replacement = yield* makeSession();
      yield* SubscriptionRef.set(supervisor.session, Option.some(replacement.session));
      const newSubscription = yield* Queue.take(replacement.subscriptions);
      yield* Queue.offer(subscription.events, Effect.succeed(brokerObservation(999)));
      yield* cachedThenChecked(newSubscription.events, brokerObservation(12));
      const reconnected = yield* waitFor(
        state,
        (view) =>
          !view.observation.stale && view.observation.state?.capabilityInventory?.generation === 12,
      );
      expect(reconnected.capabilityInventory.status).toBe("NEEDS_REFRESH");
      yield* Queue.offer(newSubscription.events, Effect.succeed(brokerObservation(13)));
      yield* waitFor(state, (view) => view.capabilityInventory.status === "CURRENT");
      expect(replacement.sent).toEqual([]);
    }).pipe(Effect.scoped),
);

it.effect(
  "expires inventory without a further server emission while leaving workflow observation fresh",
  () =>
    Effect.gen(function* () {
      const monotonic = vi.spyOn(performance, "now").mockReturnValue(100);
      yield* Effect.addFinalizer(() => Effect.sync(() => monotonic.mockRestore()));
      const remote = yield* makeSession();
      const supervisor = yield* setup(remote.session);
      const state = yield* makeEnvironmentWeavraControlState(projectId).pipe(
        Effect.provideService(EnvironmentSupervisor, supervisor),
      );
      const subscription = yield* Queue.take(remote.subscriptions);
      yield* Queue.offer(subscription.events, Effect.succeed(brokerObservation(1)));
      yield* waitFor(state, (view) => view.capabilityInventory.inventory?.generation === 1);
      yield* Queue.offer(subscription.events, Effect.succeed(brokerObservation(2)));
      const current = yield* waitFor(
        state,
        (view) => view.capabilityInventory.status === "CURRENT",
      );
      monotonic.mockReturnValue(5_100);
      yield* TestClock.adjust("5 seconds");
      const expired = yield* waitFor(
        state,
        (view) => view.capabilityInventory.status === "NEEDS_REFRESH",
      );
      expect(expired.observation).toEqual(current.observation);
      expect(expired.capabilityInventory.inventory?.observedAt).toBe(1);
      expect(remote.sent).toEqual([]);
    }).pipe(Effect.scoped),
);

it("does not interpret JSON key order as a generation change or renew freshness", () => {
  const tracker = makeCapabilityInventoryTracker();
  tracker.receive(brokerObservation(1), 0);
  const original = brokerObservation(2);
  tracker.receive(original, 100);
  const reordered = {
    ...original,
    state: {
      ...original.state!,
      capabilityInventory: Object.fromEntries(
        Object.entries(original.state!.capabilityInventory!).toReversed(),
      ) as NonNullable<WeavraControlState["capabilityInventory"]>,
    },
  };
  expect(tracker.receive(reordered, 5_099).status).toBe("CURRENT");
  expect(tracker.view(5_100).status).toBe("NEEDS_REFRESH");
});

const complexRow = (id: string): WeavraComplexExecutionV1["tasks"][number] => ({
  id,
  status: "PENDING",
  attempt: 0,
  revisionCycle: 0,
  workerInvocations: 0,
  reportedTokens: 0,
  entryWorkspaceDigest: null,
  exitWorkspaceDigest: null,
  changedFiles: [],
  changesUnknown: false,
  selfCheck: "NOT_RUN",
  review: "NOT_RUN",
  test: "NOT_RUN",
  evidenceFreshness: "NONE",
  failureCode: null,
});
function complexObserved(stateRevision: number, reportedTokens: number | null = 0) {
  const base = observed(10, stateRevision, "complex-run");
  const state = base.state!;
  const complexExecution: WeavraComplexExecutionV1 = {
    schemaVersion: 1,
    ownerId: "owner",
    projectRevision: 10,
    runId: "complex-run",
    stateRevision,
    parent: {
      id: "parent",
      goal: "Split the parser",
      acceptanceCriteria: [
        {
          id: "AC-001",
          statement: "Parsing still works",
          scope: { paths: ["src"] },
          verification: { checkIds: ["test"], reviewRequired: true },
        },
      ],
      status: "inProgress",
    },
    plan: {
      schemaVersion: 1,
      planId: "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a",
      complexPlanDigest: digest,
      parentTaskId: "parent",
      parentTaskContractDigest: digest,
      tasks: ["CT-001", "CT-002"].map((id, index) => ({
        id,
        title: `Task ${index + 1}`,
        goal: "Contribute to the parent",
        dependsOn: index === 0 ? [] : ["CT-001"],
        criterionIds: ["AC-001"],
        ownership: [{ path: `src/${index}.ts`, operation: "modify" as const }],
        checkIds: ["test"],
        maxRevisionCycles: 2,
      })),
      integration: {
        criterionIds: ["AC-001"],
        checkIds: ["test"],
        reviewRequired: true,
        finalChecksRequired: true,
      },
      limits: {
        maxTasks: 8,
        maxWorkerInvocations: 24,
        maxReportedTokens: 200000,
        maxTotalRevisionCycles: 3,
      },
    },
    phase: "TASK_SEQUENCE",
    activeTaskId: null,
    tasks: [complexRow("CT-001"), complexRow("CT-002")],
    integration: {
      check: "NOT_RUN",
      review: "NOT_RUN",
      test: "NOT_RUN",
      workspaceDigest: null,
      evidenceFreshness: "NONE",
      failureCode: null,
    },
    budget: {
      workerInvocations: 0,
      reportedTokens,
      totalRevisionCycles: 0,
      status: reportedTokens === null ? "UNKNOWN" : "WITHIN_LIMITS",
    },
    cleanup: "NOT_REQUESTED",
    partialChanges: false,
    changesUnknown: false,
    failureCode: null,
  };
  return {
    ...base,
    state: {
      ...state,
      preview: null,
      pendingApproval: null,
      complexExecution,
      snapshot: {
        ...state.snapshot,
        graph: null,
        graphAvailable: false,
        status: {
          ...state.snapshot.status,
          run: { ...state.snapshot.status.run!, status: "RUNNING", workflow: "COMPLEX" },
        },
      },
    },
  } satisfies WeavraControlObservation;
}

it.effect("an absent field on a later checked snapshot clears the COMPLEX projection", () =>
  Effect.gen(function* () {
    const remote = yield* makeSession();
    const supervisor = yield* setup(remote.session);
    const state = yield* makeEnvironmentWeavraControlState(projectId).pipe(
      Effect.provideService(EnvironmentSupervisor, supervisor),
    );
    const subscription = yield* Queue.take(remote.subscriptions);
    yield* cachedThenChecked(subscription.events, complexObserved(10));
    const projected = yield* waitFor(state, (view) => !view.observation.stale);
    expect(projected.observation.state?.complexExecution?.runId).toBe("complex-run");
    const replaced = observed(11, 1, "standard-run");
    yield* Queue.offer(subscription.events, Effect.succeed(replaced));
    const cleared = yield* waitFor(
      state,
      (view) => !view.observation.stale && view.observation.state?.projectRevision === 11,
    );
    expect(cleared.observation.state).not.toHaveProperty("complexExecution");
    expect(cleared.observation).toEqual(replaced);
  }).pipe(Effect.scoped),
);

it.effect(
  "keeps the last checked COMPLEX projection stale when the same revision changes, ignoring key order",
  () =>
    Effect.gen(function* () {
      const remote = yield* makeSession();
      const supervisor = yield* setup(remote.session);
      const state = yield* makeEnvironmentWeavraControlState(projectId).pipe(
        Effect.provideService(EnvironmentSupervisor, supervisor),
      );
      const subscription = yield* Queue.take(remote.subscriptions);
      const checked = complexObserved(10);
      yield* cachedThenChecked(subscription.events, checked);
      yield* waitFor(state, (view) => !view.observation.stale);
      const reordered = {
        ...checked,
        observedAt: 20,
        state: {
          ...checked.state,
          complexExecution: Object.fromEntries(
            Object.entries(checked.state.complexExecution).toReversed(),
          ) as WeavraComplexExecution,
        },
      };
      yield* Queue.offer(subscription.events, Effect.succeed(reordered));
      yield* waitFor(state, (view) => view.observation.observedAt === 20);
      expect((yield* SubscriptionRef.get(state)).observation.stale).toBe(false);
      yield* Queue.offer(subscription.events, Effect.succeed(complexObserved(10, 999)));
      const rejected = yield* waitFor(
        state,
        (view) => view.observation.errorCode === "REVISION_REGRESSION",
      );
      expect(rejected.observation).toMatchObject({ status: "ERROR", stale: true });
      expect(rejected.observation.state?.complexExecution?.budget.reportedTokens).toBe(0);
      expect(remote.sent).toEqual([]);
    }).pipe(Effect.scoped),
);

it.effect(
  "keeps a COMPLEX projection historical across disconnect until the new session's checked observation",
  () =>
    Effect.gen(function* () {
      const old = yield* makeSession();
      const supervisor = yield* setup(old.session);
      const state = yield* makeEnvironmentWeavraControlState(projectId).pipe(
        Effect.provideService(EnvironmentSupervisor, supervisor),
      );
      const oldSubscription = yield* Queue.take(old.subscriptions);
      yield* cachedThenChecked(oldSubscription.events, complexObserved(10));
      yield* waitFor(state, (view) => !view.observation.stale);
      yield* SubscriptionRef.set(supervisor.session, Option.none());
      const disconnected = yield* waitFor(
        state,
        (view) => view.observation.status === "DISCONNECTED",
      );
      expect(disconnected.observation).toMatchObject({ stale: true, observedAt: 10 });
      expect(disconnected.observation.state?.complexExecution?.stateRevision).toBe(10);
      const fresh = yield* makeSession();
      yield* SubscriptionRef.set(supervisor.session, Option.some(fresh.session));
      const freshSubscription = yield* Queue.take(fresh.subscriptions);
      // A late callback from the retired session cannot publish a newer projection.
      yield* Queue.offer(oldSubscription.events, Effect.succeed(complexObserved(12)));
      yield* Queue.offer(freshSubscription.events, Effect.succeed(complexObserved(11)));
      const historical = yield* waitFor(
        state,
        (view) => view.observation.state?.complexExecution?.stateRevision === 11,
      );
      expect(historical.observation.stale).toBe(true);
      yield* Queue.offer(freshSubscription.events, Effect.succeed(complexObserved(11)));
      const current = yield* waitFor(state, (view) => !view.observation.stale);
      expect(current.observation.state?.complexExecution?.stateRevision).toBe(11);
      expect([...old.sent, ...fresh.sent]).toEqual([]);
    }).pipe(Effect.scoped),
);

/** The same Run as a contract v2 projection: both rows implemented in one wave. */
function parallelObserved(stateRevision: number, handedOff: ReadonlyArray<string> = []) {
  const base = complexObserved(stateRevision);
  const { activeTaskId: _activeTaskId, ...fields } = base.state.complexExecution;
  const complexExecution: WeavraComplexExecutionV2 = {
    ...fields,
    schemaVersion: 2,
    plan: {
      ...fields.plan,
      schemaVersion: 2,
      tasks: fields.plan.tasks.map((task) => ({ ...task, dependsOn: [] })),
      limits: { ...fields.plan.limits, maxParallel: 2 },
    },
    activeTaskIds: ["CT-001", "CT-002"],
    tasks: fields.tasks.map((row) => ({
      ...row,
      status: handedOff.includes(row.id) ? "HANDED_OFF" : "IMPLEMENTING",
      attempt: 1,
      workerInvocations: 1,
      entryWorkspaceDigest: "1".repeat(64),
    })),
    budget: { ...fields.budget, workerInvocations: 2 },
  };
  return { ...base, state: { ...base.state, complexExecution } } satisfies WeavraControlObservation;
}

it.effect(
  "keeps same-revision drift of a v2 wave stale, but lets a reconnected Runtime's other contract version replace it",
  () =>
    Effect.gen(function* () {
      const remote = yield* makeSession();
      const supervisor = yield* setup(remote.session);
      const state = yield* makeEnvironmentWeavraControlState(projectId).pipe(
        Effect.provideService(EnvironmentSupervisor, supervisor),
      );
      const subscription = yield* Queue.take(remote.subscriptions);
      yield* cachedThenChecked(subscription.events, complexObserved(10));
      yield* waitFor(state, (view) => !view.observation.stale);
      // Same Run and revision, contract v2 after a Runtime upgrade: a replacement, not drift.
      const upgraded = parallelObserved(10);
      yield* Queue.offer(subscription.events, Effect.succeed(upgraded));
      const replaced = yield* waitFor(
        state,
        (view) => view.observation.state?.complexExecution?.schemaVersion === 2,
      );
      expect(replaced.observation).toEqual(upgraded);
      // Within v2, a row handing off without a new revision is not a refresh.
      yield* Queue.offer(subscription.events, Effect.succeed(parallelObserved(10, ["CT-001"])));
      const rejected = yield* waitFor(
        state,
        (view) => view.observation.errorCode === "REVISION_REGRESSION",
      );
      expect(rejected.observation).toMatchObject({ status: "ERROR", stale: true });
      expect(rejected.observation.state?.complexExecution).toEqual(upgraded.state.complexExecution);
      expect(remote.sent).toEqual([]);
    }).pipe(Effect.scoped),
);

// V0.8B Planner client state (docs/architecture/PLANNER_DRAFT.md §6, §9).
const plannerGoal = "Split the config parser into parse and validate modules";
const plannerStatements = [
  "parseConfig keeps its current behavior",
  "validateConfig rejects duplicate keys",
];
// sha256 of the UTF-8 JSON ["weavra-planner-request-v1", goal, statements], computed outside the
// App with Node crypto and `shasum -a 256` (both agree).
const PLANNER_FIXTURE_DIGEST =
  "sha256:29350ea702ea51a4b633fb065b20653d2070a6e744e76f0ac605424e4179f9f6";
const planId = "5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e";
const plannerRunning: WeavraPlannerStatus = {
  schemaVersion: 1,
  planId,
  status: "RUNNING",
  requestDigest: PLANNER_FIXTURE_DIGEST,
  projectRevision: 10,
  current: true,
  startedAt: 1_000,
  finishedAt: null,
  route: null,
  usage: { invocations: 0, reportedTokens: 0 },
  taskCount: null,
  failureCode: null,
};
const plannerEnvelope = {
  protocolVersion: 1,
  id: "owner:11",
  ownerId: "owner",
  expectedProjectRevision: 10,
} as const;
const plannerDraft: WeavraComplexDraft = {
  tasks: [
    {
      title: "Extract parser",
      goal: "Move parsing into src/parse.ts",
      dependsOnIndexes: [],
      criterionIndexes: [1],
      ownership: [{ path: "src/parse.ts", operation: "create" }],
      checkIds: ["test"],
    },
    {
      title: "Add validation",
      goal: "Reject duplicate keys in src/validate.ts",
      dependsOnIndexes: [1],
      criterionIndexes: [2],
      ownership: [{ path: "src/validate.ts", operation: "create" }],
      checkIds: ["test", "lint"],
    },
  ],
};
function plannerRead(data: unknown): WeavraControlResponse {
  return {
    protocolVersion: 1,
    type: "control_response",
    id: "owner:11",
    command: "planner.read",
    ownerId: "owner",
    runId: null,
    stateRevision: null,
    projectRevision: 10,
    eventId: null,
    timestamp: 11,
    success: true,
    data,
  } as WeavraControlResponse;
}

it("pins the planner request digest to fixtures computed outside the App (§6)", () => {
  expect(plannerRequestDigest(plannerGoal, plannerStatements)).toBe(PLANNER_FIXTURE_DIGEST);
  // Omitted statements bind as [].
  expect(plannerRequestDigest(plannerGoal)).toBe(
    "sha256:7e83f534ce4638c8d468a3b44612444054b37f8e66a7f8383c19cee1a3d0842c",
  );
  expect(plannerRequestDigest(plannerGoal, [])).toBe(plannerRequestDigest(plannerGoal));
  // UTF-8 bytes of JSON.stringify, including escaped quotes and backslashes.
  expect(
    plannerRequestDigest("설정 파서를 parse/validate 모듈로 나눈다", [
      '중복 키는 거부된다 — "quoted" \\ back',
    ]),
  ).toBe("sha256:e08f78263a2ecdf073872009e77741475e80cfffcdf510849b5ddc7b0892879e");
  // The goal and statements are bound exactly as sent: no trimming, reordering or re-splitting.
  for (const [goal, statements] of [
    [`${plannerGoal} `, plannerStatements],
    [plannerGoal, plannerStatements.toReversed()],
    [plannerGoal, [plannerStatements.join("\n")]],
    [plannerGoal, [...plannerStatements, plannerStatements[1]!]],
  ] as const) {
    expect(plannerRequestDigest(goal, statements)).not.toBe(PLANNER_FIXTURE_DIGEST);
  }
});

it("exposes planner status only from a connection that advertises the Planner", () => {
  const base = observed(10);
  const withPlanner = { ...base, state: { ...base.state!, planner: plannerRunning } };
  // An older Runtime has no Planner, whatever a snapshot carries.
  expect(plannerStatusOf(withPlanner)).toBeNull();
  const advertised = {
    ...withPlanner,
    capabilities: { ...withPlanner.capabilities!, plannerContractVersion: 1 as const },
  };
  expect(plannerStatusOf(advertised)).toEqual(plannerRunning);
  expect(plannerStatusOf({ ...advertised, state: base.state })).toBeNull();
  expect(plannerStatusOf({ ...advertised, capabilities: null })).toBeNull();
  expect(plannerStatusOf(undefined)).toBeNull();
});

it("measures planning time on the Host clock and never below zero", () => {
  expect(plannerElapsedMs(plannerRunning, 13_500)).toBe(12_500);
  expect(plannerElapsedMs(plannerRunning, null)).toBeNull();
  expect(plannerElapsedMs(plannerRunning, 500)).toBe(0);
  const ready: WeavraPlannerStatus = {
    ...plannerRunning,
    status: "READY",
    finishedAt: 5_000,
    usage: { invocations: 1, reportedTokens: 900 },
    taskCount: 2,
  };
  expect(plannerElapsedMs(ready, 99_999)).toBe(4_000);
});

it("builds planner start, cancel and read requests with nothing but the contract payload", () => {
  expect(plannerStartRequest(plannerEnvelope, plannerGoal, plannerStatements)).toEqual({
    ...plannerEnvelope,
    type: "planner.start",
    goal: plannerGoal,
    acceptanceStatements: plannerStatements,
  });
  expect(plannerStartRequest(plannerEnvelope, plannerGoal, [])).toEqual({
    ...plannerEnvelope,
    type: "planner.start",
    goal: plannerGoal,
  });
  expect(plannerCancelRequest(plannerEnvelope, planId)).toEqual({
    ...plannerEnvelope,
    type: "planner.cancel",
    planId,
  });
  expect(plannerReadRequest(plannerEnvelope, planId)).toEqual({
    ...plannerEnvelope,
    type: "planner.read",
    planId,
  });
  for (const [goal, statements] of [
    [" ", plannerStatements],
    ["x".repeat(2049), plannerStatements],
    [plannerGoal, Array(17).fill("criterion")],
    [plannerGoal, ["x".repeat(501)]],
    [plannerGoal, ["  "]],
  ] as const) {
    expect(() => plannerStartRequest(plannerEnvelope, goal, statements)).toThrow();
  }
  expect(() => plannerReadRequest(plannerEnvelope, "plan-1")).toThrow();
  expect(() =>
    plannerStartRequest(
      { ...plannerEnvelope, risk: "R0" } as typeof plannerEnvelope,
      plannerGoal,
      plannerStatements,
    ),
  ).toThrow();
});

it("keeps a loaded draft only for its own planning request and notices any edit, not key order", () => {
  const read = plannerRead({
    kind: "planner-draft",
    planId,
    requestDigest: PLANNER_FIXTURE_DIGEST,
    projectRevision: 10,
    current: false,
    draft: plannerDraft,
  });
  const loaded = plannerLoadedDraft(read, planId);
  expect(loaded).toEqual({
    planId,
    requestDigest: PLANNER_FIXTURE_DIGEST,
    current: false,
    draft: plannerDraft,
  });
  expect(plannerLoadedDraft(read, "0b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e")).toBeNull();
  expect(plannerLoadedDraft(accepted(cancelInput), planId)).toBeNull();
  const reordered = {
    tasks: plannerDraft.tasks.map(
      (task) => Object.fromEntries(Object.entries(task).toReversed()) as typeof task,
    ),
  };
  expect(plannerDraftUnchanged(loaded, reordered)).toBe(true);
  const [first, second] = plannerDraft.tasks;
  for (const edited of [
    { tasks: [first!, { ...second!, checkIds: ["test"] }] },
    { tasks: [first!, { ...second!, dependsOnIndexes: [] }] },
    { tasks: [{ ...first!, ownership: [{ path: "src/parse.ts", operation: "modify" }] }, second!] },
    { tasks: [first!, second!, first!] },
  ] satisfies ReadonlyArray<WeavraComplexDraft>) {
    expect(plannerDraftUnchanged(loaded, edited)).toBe(false);
  }
  expect(plannerDraftUnchanged(null, plannerDraft)).toBe(false);
});
