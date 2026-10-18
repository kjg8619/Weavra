// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  ModelSelection,
  ProviderRuntimeEvent,
  ProviderSession,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSetupError,
  decodeWorkspaceTurnAdmissionClaimPayload,
  decodeWorkspaceTurnCompactionContinuationPayload,
  decodeWorkspaceTurnStartRefusalPayload,
  makeWorkspaceTurnAdmissionClaimIdentity,
  makeWorkspaceTurnCompactionContinuationIdentity,
  makeWorkspaceTurnStartRefusalIdentity,
  type OrchestrationEvent,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import {
  ApprovalRequestId,
  CommandId,
  ComposerContextId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EnvironmentId,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
  WeavraTask,
} from "@t3tools/contracts";
import { serializeAssistantCitation } from "@t3tools/shared/assistantCitations";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as OwnershipTest from "../../workspace/WorkspaceExecutionOwnershipTest.ts";
import {
  WorkspaceExecutionOwnership,
  WorkspaceOwnershipError,
} from "../../workspace/WorkspaceExecutionOwnership.ts";
import * as ProcessRunner from "../../processRunner.ts";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { it as effectIt } from "@effect/vitest";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { deriveServerPaths, ServerConfig } from "../../config.ts";
import { TextGenerationError } from "@t3tools/contracts";
import {
  ProviderAdapterRequestError,
  ProviderWorkspaceMissingError,
  type ProviderServiceError,
} from "../../provider/Errors.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import {
  SqlitePersistenceMemory,
  makeSqlitePersistenceLive,
} from "../../persistence/Layers/Sqlite.ts";
import { PersistenceSqlError } from "../../persistence/Errors.ts";
import { OrchestrationCommandReceiptRepository } from "../../persistence/Services/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../../provider/Services/ProviderService.ts";
import { ProviderAuthService } from "../../provider/Services/ProviderAuthService.ts";
import { makeProviderRegistryLayer } from "../../provider/testUtils/providerRegistryMock.ts";
import { TextGeneration } from "../../textGeneration/TextGeneration.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import * as ThreadBackgroundLiveness from "../ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../ThreadPlanProgress.ts";
import {
  providerErrorLabelFromInstanceHint,
  ProviderCommandReactorLive,
} from "./ProviderCommandReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProviderCommandReactor } from "../Services/ProviderCommandReactor.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Clock from "effect/Clock";
import { ServerSettingsService } from "../../serverSettings.ts";
import { ServerActivation } from "../../serverActivation.ts";
import { VcsStatusBroadcaster } from "../../vcs/VcsStatusBroadcaster.ts";
import * as GitWorkflowService from "../../git/GitWorkflowService.ts";

const decodeControlledTask = Schema.decodeUnknownEffect(WeavraTask);

const asProjectId = (value: string): ProjectId => ProjectId.make(value);
const asApprovalRequestId = (value: string): ApprovalRequestId => ApprovalRequestId.make(value);
const asMessageId = (value: string): MessageId => MessageId.make(value);
const asTurnId = (value: string): TurnId => TurnId.make(value);
const decodeOwnershipTask = Schema.decodeUnknownSync(WeavraTask);
const encodeActivityJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeActivityRequest = Schema.decodeUnknownOption(Schema.Struct({ requestId: MessageId }));
type ActivityCommand = Extract<
  Parameters<OrchestrationEngineService["Service"]["dispatch"]>[0],
  { type: "thread.activity.append" }
>;
const differentClaimantNonce = (nonce: string) =>
  nonce === "11111111-1111-4111-8111-111111111111"
    ? "22222222-2222-4222-8222-222222222222"
    : "11111111-1111-4111-8111-111111111111";

const assistantQuoteText = "Retain the reconnect backoff.";
const assistantCitation = {
  version: 1 as const,
  environmentId: EnvironmentId.make("source-environment"),
  threadId: ThreadId.make("source-thread"),
  messageId: asMessageId("source-message"),
  text: assistantQuoteText,
  start: 0,
  end: assistantQuoteText.length,
  prefix: "",
  suffix: "",
};

const deriveServerPathsSync = (baseDir: string, devUrl: URL | undefined) =>
  Effect.runSync(deriveServerPaths(baseDir, devUrl).pipe(Effect.provide(NodeServices.layer)));

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = (await Effect.runPromise(Clock.currentTimeMillis)) + timeoutMs;
  const poll = async (): Promise<void> => {
    if (await predicate()) {
      return;
    }
    if ((await Effect.runPromise(Clock.currentTimeMillis)) >= deadline) {
      throw new Error("Timed out waiting for expectation.");
    }
    await Effect.runPromise(Effect.yieldNow);
    return poll();
  };

  return poll();
}

describe("ProviderCommandReactor", () => {
  let runtime: ManagedRuntime.ManagedRuntime<
    | OrchestrationEngineService
    | ProviderCommandReactor
    | ProjectionSnapshotQuery
    | WorkspaceExecutionOwnership
    | OrchestrationCommandReceiptRepository
    | OrchestrationEventStore
    | SqlClient.SqlClient,
    unknown
  > | null = null;
  let scope: Scope.Closeable | null = null;
  const createdStateDirs = new Set<string>();
  const createdBaseDirs = new Set<string>();

  async function closeHarness() {
    if (scope) {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
    scope = null;
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
  }

  afterEach(async () => {
    await closeHarness();
    for (const stateDir of createdStateDirs) {
      NodeFS.rmSync(stateDir, { recursive: true, force: true });
    }
    createdStateDirs.clear();
    for (const baseDir of createdBaseDirs) {
      NodeFS.rmSync(baseDir, { recursive: true, force: true });
    }
    createdBaseDirs.clear();
  });

  describe("provider error attribution", () => {
    it("uses the current provider instance slug when current instance lookup fails", () => {
      expect(
        providerErrorLabelFromInstanceHint({
          instanceId: "codex_personal",
          modelSelectionInstanceId: "codex",
          sessionProvider: "codex",
        }),
      ).toBe("codex_personal");
    });

    it("uses the desired provider instance slug when desired instance lookup fails", () => {
      expect(
        providerErrorLabelFromInstanceHint({
          instanceId: "claude_openrouter",
        }),
      ).toBe("claude_openrouter");
    });
  });

  async function createHarness(input?: {
    readonly baseDir?: string;
    readonly databasePath?: string;
    readonly decorateReceipts?: (
      service: OrchestrationCommandReceiptRepository["Service"],
    ) => OrchestrationCommandReceiptRepository["Service"];
    readonly decorateEventStore?: (
      service: OrchestrationEventStore["Service"],
    ) => OrchestrationEventStore["Service"];
    readonly beforeActivityDispatch?: (command: ActivityCommand) => Effect.Effect<void>;
    readonly afterActivityDispatch?: (command: ActivityCommand) => Effect.Effect<void>;
    readonly afterTurnStartMessageRead?: (messageId: MessageId) => Effect.Effect<void>;
    readonly workspaceRoot?: string;
    readonly initialTitle?: string;
    readonly deferReactorStart?: boolean;
    readonly replayPersistedEvents?: boolean;
    readonly threadModelSelection?: ModelSelection;
    readonly sessionModelSwitch?: "unsupported" | "in-session";
    readonly requiresNewThreadForModelChange?: boolean;
    readonly unreadableHistory?: boolean;
    readonly titleRegenerationCompletionDispatchFailures?: number;
    readonly titleRegenerationBeforeStart?: "one" | "two";
    readonly serverActivation?: Effect.Effect<void>;
    readonly beforeReadySessionDispatch?: () => Effect.Effect<void>;
    readonly beforeTurnStartDispatch?: () => Effect.Effect<void>;
    readonly afterTurnStartDispatch?: () => Effect.Effect<void>;
    readonly afterSendTurn?: () => Effect.Effect<void>;
    readonly compactThreadEffect?: () => Effect.Effect<void, ProviderAdapterRequestError>;
    readonly interruptTurnEffect?: () => Effect.Effect<void, ProviderAdapterRequestError>;
    readonly stopSessionEffect?: () => Effect.Effect<void, ProviderAdapterRequestError>;
    readonly startSessionEffect?: (
      session: ProviderSession,
    ) => Effect.Effect<ProviderSession, ProviderServiceError>;
    readonly tryHandlePromptCommandEffect?: ProviderAuthService["Service"]["tryHandlePromptCommand"];
  }) {
    const now = "2026-01-01T00:00:00.000Z";
    const baseDir =
      input?.baseDir ?? NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3code-reactor-"));
    createdBaseDirs.add(baseDir);
    const { stateDir } = deriveServerPathsSync(baseDir, undefined);
    createdStateDirs.add(stateDir);
    const runtimeEventPubSub = Effect.runSync(PubSub.unbounded<ProviderRuntimeEvent>());
    const replayedEvents = Effect.runSync(PubSub.unbounded<OrchestrationEvent>());
    const persistenceLayer = input?.databasePath
      ? makeSqlitePersistenceLive(input.databasePath)
      : SqlitePersistenceMemory;
    const tryHandlePromptCommand = vi.fn<ProviderAuthService["Service"]["tryHandlePromptCommand"]>(
      input?.tryHandlePromptCommandEffect ?? (() => Effect.succeed(false)),
    );
    let nextSessionIndex = 1;
    const runtimeSessions: Array<ProviderSession> = [];
    const modelSelection = input?.threadModelSelection ?? {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5-codex",
    };
    const startSessionEffect = input?.startSessionEffect;
    const startSession = vi.fn((_: unknown, input: unknown) => {
      const sessionIndex = nextSessionIndex++;
      const resumeCursor =
        typeof input === "object" && input !== null && "resumeCursor" in input
          ? input.resumeCursor
          : undefined;
      const threadId =
        typeof input === "object" &&
        input !== null &&
        "threadId" in input &&
        typeof input.threadId === "string"
          ? ThreadId.make(input.threadId)
          : ThreadId.make(`thread-${sessionIndex}`);
      const inputModelSelection =
        typeof input === "object" && input !== null && "modelSelection" in input
          ? (input.modelSelection as ModelSelection | undefined)
          : undefined;
      const providerInstanceId =
        typeof input === "object" && input !== null && "providerInstanceId" in input
          ? (input.providerInstanceId as ProviderInstanceId | undefined)
          : inputModelSelection?.instanceId;
      const provider =
        typeof input === "object" &&
        input !== null &&
        "provider" in input &&
        typeof input.provider === "string"
          ? (input.provider as ProviderSession["provider"])
          : ProviderDriverKind.make(inputModelSelection?.instanceId ?? modelSelection.instanceId);
      const session: ProviderSession = {
        provider,
        ...(providerInstanceId ? { providerInstanceId } : {}),
        status: "ready" as const,
        runtimeMode:
          typeof input === "object" &&
          input !== null &&
          "runtimeMode" in input &&
          (input.runtimeMode === "approval-required" || input.runtimeMode === "full-access")
            ? input.runtimeMode
            : "full-access",
        ...(typeof input === "object" &&
        input !== null &&
        "cwd" in input &&
        typeof input.cwd === "string"
          ? { cwd: input.cwd }
          : {}),
        ...((inputModelSelection?.model ?? modelSelection.model)
          ? { model: inputModelSelection?.model ?? modelSelection.model }
          : {}),
        threadId,
        resumeCursor: resumeCursor ?? { opaque: `resume-${sessionIndex}` },
        createdAt: now,
        updatedAt: now,
      };
      return (startSessionEffect?.(session) ?? Effect.succeed(session)).pipe(
        Effect.tap((startedSession) =>
          Effect.sync(() => {
            runtimeSessions.push(startedSession);
          }),
        ),
      );
    });
    const sendTurn = vi.fn((_: unknown) =>
      Effect.succeed({
        threadId: ThreadId.make("thread-1"),
        turnId: asTurnId("turn-1"),
      }).pipe(Effect.tap(() => input?.afterSendTurn?.() ?? Effect.void)),
    );
    const compactThread = vi.fn((_: ThreadId) => input?.compactThreadEffect?.() ?? Effect.void);
    const interruptTurn = vi.fn((_: unknown) => input?.interruptTurnEffect?.() ?? Effect.void);
    const respondToRequest = vi.fn<ProviderServiceShape["respondToRequest"]>(() => Effect.void);
    const respondToUserInput = vi.fn<ProviderServiceShape["respondToUserInput"]>(() => Effect.void);
    const stopSession = vi.fn((stopInput: unknown) =>
      (input?.stopSessionEffect?.() ?? Effect.void).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            const threadId =
              typeof stopInput === "object" && stopInput !== null && "threadId" in stopInput
                ? (stopInput as { threadId?: ThreadId }).threadId
                : undefined;
            if (!threadId) {
              return;
            }
            const index = runtimeSessions.findIndex((session) => session.threadId === threadId);
            if (index >= 0) {
              runtimeSessions.splice(index, 1);
            }
          }),
        ),
      ),
    );
    const renameBranch = vi.fn((input: unknown) =>
      Effect.succeed({
        branch:
          typeof input === "object" &&
          input !== null &&
          "newBranch" in input &&
          typeof input.newBranch === "string"
            ? input.newBranch
            : "renamed-branch",
      }),
    );
    const pruneWorktrees = vi.fn((_: { readonly cwd: string }) => Effect.void);
    const createWorktree = vi.fn(
      (input: { readonly refName: string; readonly path: string | null }) =>
        Effect.succeed({ worktree: { path: input.path ?? "", refName: input.refName } }),
    );
    const refreshStatus = vi.fn((_: string) =>
      Effect.succeed({
        isRepo: true,
        hasPrimaryRemote: true,
        isDefaultRef: false,
        refName: "renamed-branch",
        hasWorkingTreeChanges: false,
        workingTree: {
          files: [],
          insertions: 0,
          deletions: 0,
        },
        hasUpstream: true,
        aheadCount: 0,
        behindCount: 0,
        pr: null,
      }),
    );
    const generateBranchName = vi.fn<TextGeneration["Service"]["generateBranchName"]>((_) =>
      Effect.fail(
        new TextGenerationError({
          operation: "generateBranchName",
          detail: "disabled in test harness",
        }),
      ),
    );
    const generateThreadTitle = vi.fn<TextGeneration["Service"]["generateThreadTitle"]>((_) =>
      Effect.fail(
        new TextGenerationError({
          operation: "generateThreadTitle",
          detail: "disabled in test harness",
        }),
      ),
    );
    const providerSnapshots = [
      {
        instanceId: modelSelection.instanceId,
        ...(input?.requiresNewThreadForModelChange === true
          ? { requiresNewThreadForModelChange: true }
          : {}),
      },
    ];

    const unsupported = () => Effect.die(new Error("Unsupported provider call in test")) as never;
    const service: ProviderServiceShape = {
      startSession: startSession as ProviderServiceShape["startSession"],
      sendTurn: sendTurn as ProviderServiceShape["sendTurn"],
      compactThread,
      interruptTurn: interruptTurn as ProviderServiceShape["interruptTurn"],
      respondToRequest: respondToRequest as ProviderServiceShape["respondToRequest"],
      respondToUserInput: respondToUserInput as ProviderServiceShape["respondToUserInput"],
      stopSession: stopSession as ProviderServiceShape["stopSession"],
      listSessions: () => Effect.succeed(runtimeSessions),
      getCapabilities: (_provider) =>
        Effect.succeed({
          sessionModelSwitch: input?.sessionModelSwitch ?? "in-session",
        }),
      assertConversationRollbackSupported: () => unsupported(),
      getInstanceInfo: (instanceId) => {
        const raw = String(instanceId);
        const driverKind = ProviderDriverKind.make(
          raw.startsWith("claude")
            ? "claudeAgent"
            : raw.startsWith("codex")
              ? "codex"
              : raw.startsWith("antigravity")
                ? "antigravity"
                : raw,
        );
        return Effect.succeed({
          instanceId,
          driverKind,
          displayName: undefined,
          enabled: true,
          continuationIdentity: {
            driverKind,
            continuationKey:
              driverKind === ProviderDriverKind.make("codex")
                ? "codex:home:/shared-codex"
                : `${driverKind}:instance:${instanceId}`,
          },
        });
      },
      rollbackConversation: () => unsupported(),
      uploadFeedback: () => unsupported(),
      get streamEvents() {
        return Stream.fromPubSub(runtimeEventPubSub);
      },
    };

    const orchestrationLayer = OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(ThreadBackgroundLiveness.layer),
      Layer.provide(ThreadPlanProgress.layer),
      Layer.provide(OrchestrationProjectionPipelineLive),
      Layer.provide(OrchestrationEventStoreLive),
      Layer.provide(OrchestrationCommandReceiptRepositoryLive),
      Layer.provide(RepositoryIdentityResolver.layer),
      Layer.provide(persistenceLayer),
    );
    const projectionSnapshotLayer = Layer.effect(
      ProjectionSnapshotQuery,
      Effect.gen(function* () {
        const query = yield* ProjectionSnapshotQuery;
        return {
          ...query,
          getTurnStartMessage: (request) =>
            query
              .getTurnStartMessage(request)
              .pipe(
                Effect.tap(
                  () => input?.afterTurnStartMessageRead?.(request.messageId) ?? Effect.void,
                ),
              ),
        } satisfies ProjectionSnapshotQuery["Service"];
      }),
    ).pipe(
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(ThreadBackgroundLiveness.layer),
      Layer.provide(ThreadPlanProgress.layer),
      Layer.provide(RepositoryIdentityResolver.layer),
      Layer.provide(persistenceLayer),
    );
    const receiptLayer = Layer.effect(
      OrchestrationCommandReceiptRepository,
      Effect.gen(function* () {
        const service = yield* OrchestrationCommandReceiptRepository;
        return input?.decorateReceipts?.(service) ?? service;
      }),
    ).pipe(
      Layer.provide(OrchestrationCommandReceiptRepositoryLive),
      Layer.provide(persistenceLayer),
    );
    const eventStoreLayer = Layer.effect(
      OrchestrationEventStore,
      Effect.gen(function* () {
        const service = yield* OrchestrationEventStore;
        return input?.decorateEventStore?.(service) ?? service;
      }),
    ).pipe(Layer.provide(OrchestrationEventStoreLive), Layer.provide(persistenceLayer));
    let titleRegenerationCompletionDispatchAttempts = 0;
    const reactorOrchestrationLayer = Layer.effect(
      OrchestrationEngineService,
      Effect.gen(function* () {
        const engine = yield* OrchestrationEngineService;
        return {
          readEvents: engine.readEvents,
          readThreadEvents: engine.readThreadEvents,
          getThreadReplayStats: engine.getThreadReplayStats,
          dispatch: (command) => {
            if (command.type === "thread.title.regeneration.complete") {
              titleRegenerationCompletionDispatchAttempts += 1;
              if (
                titleRegenerationCompletionDispatchAttempts <=
                (input?.titleRegenerationCompletionDispatchFailures ?? 0)
              ) {
                return Effect.die(new Error("Injected title regeneration completion failure"));
              }
            }
            const isReplay =
              command.type === "thread.turn.start" &&
              command.commandId.startsWith("server:after-compaction:");
            const before =
              command.type === "thread.session.set" && command.session.status === "ready"
                ? input?.beforeReadySessionDispatch
                : isReplay
                  ? input?.beforeTurnStartDispatch
                  : undefined;
            return (before?.() ?? Effect.void).pipe(
              Effect.andThen(
                command.type === "thread.activity.append"
                  ? (input?.beforeActivityDispatch?.(command) ?? Effect.void)
                  : Effect.void,
              ),
              Effect.andThen(engine.dispatch(command)),
              Effect.tap(() =>
                command.type === "thread.activity.append"
                  ? (input?.afterActivityDispatch?.(command) ?? Effect.void)
                  : Effect.void,
              ),
              Effect.tap(() =>
                isReplay ? (input?.afterTurnStartDispatch?.() ?? Effect.void) : Effect.void,
              ),
            );
          },
          get streamDomainEvents() {
            return engine.streamDomainEvents;
          },
          subscribeDomainEvents: input?.replayPersistedEvents
            ? Effect.gen(function* () {
                const live = yield* engine.subscribeDomainEvents;
                const replay = yield* PubSub.subscribe(replayedEvents);
                return Stream.merge(live, Stream.fromSubscription(replay));
              })
            : engine.subscribeDomainEvents,
          latestSequence: engine.latestSequence,
        } satisfies OrchestrationEngineService["Service"];
      }),
    ).pipe(Layer.provide(orchestrationLayer));
    const layer = ProviderCommandReactorLive.pipe(
      Layer.provideMerge(receiptLayer),
      Layer.provideMerge(eventStoreLayer),
      Layer.provideMerge(OwnershipTest.baseLayer),
      Layer.provideMerge(reactorOrchestrationLayer),
      Layer.provideMerge(projectionSnapshotLayer),
      Layer.provideMerge(Layer.succeed(ProviderService, service)),
      Layer.provide(Layer.mock(ProviderAuthService, { tryHandlePromptCommand })),
      Layer.provideMerge(makeProviderRegistryLayer(providerSnapshots as never)),
      Layer.provideMerge(
        Layer.mock(GitWorkflowService.GitWorkflowService)({
          renameBranch,
          pruneWorktrees,
          createWorktree,
        } satisfies Partial<GitWorkflowService.GitWorkflowService["Service"]>),
      ),
      Layer.provideMerge(
        Layer.succeed(VcsStatusBroadcaster, {
          getStatus: () => Effect.die("getStatus should not be called in this test"),
          refreshLocalStatus: () =>
            Effect.die("refreshLocalStatus should not be called in this test"),
          refreshStatus,
          refreshPullRequestStatus: () =>
            Effect.die("refreshPullRequestStatus should not be called in this test"),
          streamStatus: () => Stream.die("streamStatus should not be called in this test"),
        }),
      ),
      Layer.provideMerge(
        Layer.mock(TextGeneration, {
          generateBranchName,
          generateThreadTitle,
        }),
      ),
      Layer.provideMerge(ServerSettingsService.layerTest()),
      Layer.provideMerge(persistenceLayer),
      Layer.provideMerge(ServerConfig.layerTest(process.cwd(), baseDir)),
      Layer.provideMerge(NodeServices.layer),
    );
    runtime = ManagedRuntime.make(layer);

    const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
    const snapshotQuery = await runtime.runPromise(Effect.service(ProjectionSnapshotQuery));
    const reactor = await runtime.runPromise(Effect.service(ProviderCommandReactor));
    const runEffect = <A, E>(
      effect: Effect.Effect<
        A,
        E,
        | WorkspaceExecutionOwnership
        | OrchestrationEngineService
        | ProjectionSnapshotQuery
        | OrchestrationCommandReceiptRepository
        | OrchestrationEventStore
        | SqlClient.SqlClient
      >,
    ) => runtime!.runPromise(effect);

    await Effect.runPromise(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.make("cmd-project-create"),
        projectId: asProjectId("project-1"),
        title: "Provider Project",
        workspaceRoot: input?.workspaceRoot ?? "/tmp/provider-project",
        defaultModelSelection: modelSelection,
        createdAt: now,
      }),
    );
    await Effect.runPromise(
      engine.dispatch({
        type: "thread.create",
        commandId: CommandId.make("cmd-thread-create"),
        threadId: ThreadId.make("thread-1"),
        projectId: asProjectId("project-1"),
        title: input?.initialTitle ?? "Thread",
        modelSelection: modelSelection,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt: now,
      }),
    );
    if (input?.unreadableHistory === true) {
      // Metadata commands must not decode this unrelated message body.
      await runtime.runPromise(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`
            INSERT INTO projection_thread_messages (
              message_id, thread_id, turn_id, role, text, attachments_json,
              is_streaming, created_at, updated_at
            ) VALUES (
              'old-unreadable-message', 'thread-1', NULL, 'assistant',
              'Old assistant output', 'invalid json', 0, ${now}, ${now}
            )
          `;
        }),
      );
    }
    if (input?.titleRegenerationBeforeStart === "two") {
      await Effect.runPromise(
        engine.dispatch({
          type: "thread.create",
          commandId: CommandId.make("cmd-thread-create-2"),
          threadId: ThreadId.make("thread-2"),
          projectId: asProjectId("project-1"),
          title: "Thread 2",
          modelSelection: modelSelection,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          createdAt: now,
        }),
      );
    }
    const titleRegenerationThreadIds =
      input?.titleRegenerationBeforeStart === "two"
        ? [ThreadId.make("thread-1"), ThreadId.make("thread-2")]
        : input?.titleRegenerationBeforeStart === "one"
          ? [ThreadId.make("thread-1")]
          : [];
    for (const [index, threadId] of titleRegenerationThreadIds.entries()) {
      await Effect.runPromise(
        engine.dispatch({
          type: "thread.meta.update",
          commandId: CommandId.make(
            `cmd-thread-title-regeneration-before-reactor-start-${index + 1}`,
          ),
          threadId,
          regenerateTitle: true,
        }),
      );
    }

    scope = await Effect.runPromise(Scope.make("sequential"));
    const reactorScope = scope;
    const startReactor = () =>
      Effect.runPromise(
        reactor
          .start()
          .pipe(
            Scope.provide(reactorScope),
            Effect.provideService(ServerActivation, input?.serverActivation),
          ),
      );
    if (!input?.deferReactorStart) await startReactor();
    const drain = () => Effect.runPromise(reactor.drain);

    return {
      engine,
      snapshotQuery,
      readModel: () => Effect.runPromise(snapshotQuery.getSnapshot()),
      readPendingTurnStarts: () =>
        runtime!.runPromise(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            return yield* sql<{ readonly threadId: string }>`
              SELECT thread_id AS "threadId"
              FROM projection_turns
              WHERE turn_id IS NULL AND state = 'pending'
            `;
          }),
        ),
      tryHandlePromptCommand,
      startSession,
      sendTurn,
      compactThread,
      interruptTurn,
      respondToRequest,
      respondToUserInput,
      stopSession,
      renameBranch,
      pruneWorktrees,
      createWorktree,
      refreshStatus,
      generateBranchName,
      generateThreadTitle,
      runtimeSessions,
      stateDir,
      drain,
      startReactor,
      runEffect,
      replayPersistedEvent: (event: OrchestrationEvent) =>
        PubSub.publish(replayedEvents, event).pipe(Effect.asVoid),
      get titleRegenerationCompletionDispatchAttempts() {
        return titleRegenerationCompletionDispatchAttempts;
      },
    };
  }

  const watchActivity = Effect.fnUntraced(function* (
    harness: Awaited<ReturnType<typeof createHarness>>,
    predicate: (activity: OrchestrationThreadActivity) => boolean,
  ) {
    const observed =
      yield* Deferred.make<Extract<OrchestrationEvent, { type: "thread.activity-appended" }>>();
    const events = yield* harness.engine.subscribeDomainEvents;
    yield* Stream.runForEach(events, (event) =>
      event.type === "thread.activity-appended" && predicate(event.payload.activity)
        ? Deferred.succeed(observed, event)
        : Effect.void,
    ).pipe(Effect.forkScoped({ startImmediately: true }));
    return Deferred.await(observed).pipe(Effect.timeout("5 seconds"));
  });

  const failureFor = (requestId: string) => (activity: OrchestrationThreadActivity) =>
    activity.kind === "provider.turn.start.failed" &&
    Option.getOrUndefined(decodeActivityRequest(activity.payload))?.requestId === requestId;

  const readActivities = (harness: Awaited<ReturnType<typeof createHarness>>) =>
    Stream.runCollect(harness.engine.readEvents(0, 200)).pipe(
      Effect.map((events) =>
        events.flatMap((event) =>
          event.type === "thread.activity-appended" ? [event.payload.activity] : [],
        ),
      ),
    );

  const dispatchAdmissionMessage = (
    harness: Awaited<ReturnType<typeof createHarness>>,
    commandId: string,
    messageId = "admission-message",
    text = "Keep the exact intent",
  ) =>
    harness.engine.dispatch({
      type: "thread.turn.start",
      commandId: CommandId.make(commandId),
      threadId: ThreadId.make("thread-1"),
      message: { messageId: MessageId.make(messageId), role: "user", text, attachments: [] },
      runtimeMode: "approval-required",
      interactionMode: "default",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

  const seedAdmissionOwner = Effect.fnUntraced(function* (
    harness: Awaited<ReturnType<typeof createHarness>>,
    cwd: string,
    options?: {
      readonly id?: string;
      readonly generation?: number;
      readonly threadId?: ThreadId;
      readonly worktreePath?: string;
    },
  ) {
    const ownership = yield* Effect.promise(() =>
      harness.runEffect(Effect.service(WorkspaceExecutionOwnership)),
    );
    const threadId = options?.threadId ?? ThreadId.make("thread-1");
    const generation = options?.generation ?? 0;
    if (threadId !== ThreadId.make("thread-1")) {
      yield* harness.engine.dispatch({
        type: "thread.create",
        commandId: CommandId.make(`create-admission-owner:${threadId}`),
        projectId: asProjectId("project-1"),
        threadId,
        title: "Other controlled conversation",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" },
        runtimeMode: "approval-required",
        interactionMode: "default",
        branch: null,
        worktreePath: options?.worktreePath ?? null,
        createdAt: "2026-01-01T00:00:00.000Z",
      });
    }
    const task = decodeOwnershipTask({
      id: options?.id ?? "77777777-7777-4777-8777-777777777777",
      environmentId: ownership.environmentId,
      projectId: asProjectId("project-1"),
      threadId,
      target: { workspaceRoot: cwd, worktreePath: options?.worktreePath ?? null },
      checkout: {
        canonicalCwd: options?.worktreePath ?? cwd,
        repositoryRoot: options?.worktreePath ?? cwd,
        headCommit: "a".repeat(40),
        workspaceDigest: `sha256:${"a".repeat(64)}`,
      },
      phase: "analysis",
      revision: 1,
      context: null,
      execution: null,
      ownership: { generation: generation + 1, state: "analysis" },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    yield* harness.engine.dispatch({
      type: "thread.weavra-task.set",
      commandId: CommandId.make(`seed-admission-owner:${task.id}`),
      threadId,
      expectedRevision: null,
      expectedOwnershipGeneration: generation,
      task,
    });
    return task;
  });

  const prepareCompactionConversation = Effect.fnUntraced(function* (
    harness: Awaited<ReturnType<typeof createHarness>>,
    cwd: string,
  ) {
    const threadId = ThreadId.make("thread-1");
    const now = "2026-01-01T00:00:00.000Z";
    // Persist prior conversation before starting the reactor subscription.
    yield* dispatchAdmissionMessage(
      harness,
      "admission-history",
      "admission-history",
      "Earlier work",
    );
    harness.runtimeSessions.push({
      provider: ProviderDriverKind.make("codex"),
      providerInstanceId: ProviderInstanceId.make("codex"),
      threadId,
      status: "ready",
      runtimeMode: "approval-required",
      cwd,
      model: "gpt-5-codex",
      createdAt: now,
      updatedAt: now,
    });
    yield* harness.engine.dispatch({
      type: "thread.session.set",
      commandId: CommandId.make("admission-ready-session"),
      threadId,
      session: {
        threadId,
        status: "ready",
        providerName: "codex",
        providerInstanceId: ProviderInstanceId.make("codex"),
        runtimeMode: "approval-required",
        activeTurnId: null,
        lastError: null,
        updatedAt: now,
      },
      createdAt: now,
    });
    yield* Effect.promise(() => harness.startReactor());
  });

  effectIt.effect.each([
    "missing",
    "accepted",
    "competing",
    "rejected",
    "lookup-failed",
    "refusal-lookup-failed",
    "missing-readback",
    "missing-event",
    "failed-readback",
    "mismatched-readback",
    "commit-failed",
    "ack-failed",
  ] as const)("durable admission handles %s without guessing permission", (scenario) =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("thread-1");
      const messageId = MessageId.make("admission-message");
      const identity = makeWorkspaceTurnAdmissionClaimIdentity(threadId, messageId, {
        kind: "initial",
      });
      const refusal = makeWorkspaceTurnStartRefusalIdentity(threadId, messageId);
      const sent = yield* Deferred.make<void>();
      let lookupCount = 0;
      let competitorCommitted = false;
      let submittedNonce: string | undefined;
      let competitorNonce: string | undefined;
      let harness: Awaited<ReturnType<typeof createHarness>>;
      harness = yield* Effect.promise(() =>
        createHarness({
          afterSendTurn: () => Deferred.succeed(sent, undefined),
          decorateReceipts: (service) => ({
            ...service,
            getByCommandId: (input) => {
              if (scenario === "refusal-lookup-failed" && input.commandId === refusal.commandId) {
                return Effect.fail(
                  new PersistenceSqlError({
                    operation: "test.refusal.lookup",
                    detail: "unavailable",
                  }),
                );
              }
              if (input.commandId !== identity.commandId) return service.getByCommandId(input);
              lookupCount++;
              if (scenario === "lookup-failed") {
                return Effect.fail(
                  new PersistenceSqlError({
                    operation: "test.claim.lookup",
                    detail: "unavailable",
                  }),
                );
              }
              if (scenario === "missing-readback" && lookupCount === 2) {
                return service.getByCommandId(input).pipe(Effect.as(Option.none()));
              }
              return service.getByCommandId(input);
            },
          }),
          decorateEventStore: (service) => ({
            ...service,
            readAggregateRange: (range) => {
              if (scenario === "failed-readback") {
                return Stream.fail(
                  new PersistenceSqlError({
                    operation: "test.claim.readback",
                    detail: "unavailable",
                  }),
                );
              }
              if (scenario === "missing-event") {
                return service.readAggregateRange(range).pipe(Stream.filter(() => false));
              }
              return service.readAggregateRange(range).pipe(
                Stream.map((event) =>
                  scenario === "mismatched-readback" && event.type === "thread.activity-appended"
                    ? {
                        ...event,
                        payload: {
                          ...event.payload,
                          activity: { ...event.payload.activity, id: EventId.make("wrong-claim") },
                        },
                      }
                    : event,
                ),
              );
            },
          }),
          beforeActivityDispatch: (command) => {
            if (command.commandId !== identity.commandId) return Effect.void;
            const payload = Option.getOrThrow(
              decodeWorkspaceTurnAdmissionClaimPayload(command.activity.payload),
            );
            submittedNonce ??= payload.claimantNonce;
            if (scenario !== "competing" || competitorCommitted) return Effect.void;
            competitorCommitted = true;
            competitorNonce = differentClaimantNonce(payload.claimantNonce);
            // Commit the competing invocation through the real engine before
            // the first invocation reaches its deduplicated dispatch.
            return harness.engine
              .dispatch({
                ...command,
                activity: {
                  ...command.activity,
                  payload: { ...payload, claimantNonce: competitorNonce },
                },
              })
              .pipe(Effect.orDie, Effect.asVoid);
          },
          afterActivityDispatch: (command) =>
            scenario === "ack-failed" && command.commandId === identity.commandId
              ? Effect.die(new Error("Injected lost claim acknowledgement"))
              : Effect.void,
        }),
      );
      if (scenario === "accepted") {
        yield* harness.engine.dispatch({
          type: "thread.activity.append",
          commandId: identity.commandId,
          threadId,
          activity: {
            id: identity.activityId,
            tone: "info",
            kind: "provider.turn.admission.claimed",
            summary: "Prior admission",
            payload: {
              version: 1,
              source: "workspace-admission",
              requestId: messageId,
              originCommandId: CommandId.make("prior-origin"),
              originSequence: 0,
              attempt: { kind: "initial" },
              claimantNonce: "11111111-1111-4111-8111-111111111111",
            },
            turnId: null,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          createdAt: "2026-01-01T00:00:00.000Z",
        });
      }
      if (scenario === "rejected") {
        yield* Effect.promise(() =>
          harness.runEffect(
            Effect.gen(function* () {
              const receipts = yield* OrchestrationCommandReceiptRepository;
              yield* receipts.upsert({
                commandId: identity.commandId,
                aggregateKind: "thread",
                aggregateId: threadId,
                acceptedAt: "2026-01-01T00:00:00.000Z",
                resultSequence: 0,
                status: "rejected",
                error: "Prior rejection",
              });
            }),
          ),
        );
      }
      if (scenario === "commit-failed") {
        yield* Effect.promise(() =>
          harness.runEffect(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              yield* sql`
                CREATE TRIGGER fail_admission_receipt
                BEFORE INSERT ON orchestration_command_receipts
                WHEN NEW.command_id LIKE 'server:["workspace-admission-v1"%'
                BEGIN SELECT RAISE(ABORT, 'injected claim receipt failure'); END
              `;
            }),
          ),
        );
      }
      const failure = yield* watchActivity(harness, failureFor(messageId));
      yield* dispatchAdmissionMessage(harness, "fresh-origin");
      if (scenario === "missing") {
        yield* Deferred.await(sent).pipe(Effect.timeout("5 seconds"));
      } else {
        const activity = (yield* failure).payload.activity;
        expect(decodeWorkspaceTurnStartRefusalPayload(activity.payload)).toEqual(Option.none());
      }
      yield* Effect.promise(() => harness.drain());
      expect(harness.startSession).toHaveBeenCalledTimes(scenario === "missing" ? 1 : 0);
      expect(harness.sendTurn).toHaveBeenCalledTimes(scenario === "missing" ? 1 : 0);
      expect(harness.tryHandlePromptCommand).toHaveBeenCalledTimes(scenario === "missing" ? 1 : 0);
      expect(harness.compactThread).not.toHaveBeenCalled();
      const claims = (yield* readActivities(harness)).filter(
        (activity) => activity.id === identity.activityId,
      );
      const projected = (yield* Effect.promise(() => harness.readModel())).threads.find(
        (thread) => thread.id === threadId,
      );
      expect(
        projected?.activities.some(
          (activity) => activity.kind === "provider.turn.admission.claimed",
        ),
      ).toBe(false);
      const noClaim = [
        "rejected",
        "lookup-failed",
        "refusal-lookup-failed",
        "commit-failed",
      ].includes(scenario);
      expect(claims).toHaveLength(noClaim ? 0 : 1);
      if (scenario === "missing" || scenario === "competing") {
        const claim = claims[0];
        if (claim === undefined) return yield* Effect.die("Expected persisted admission claim");
        const payload = Option.getOrThrow(decodeWorkspaceTurnAdmissionClaimPayload(claim.payload));
        expect(payload.claimantNonce).toBe(
          scenario === "missing" ? submittedNonce : competitorNonce,
        );
        if (scenario === "competing") expect(competitorNonce).not.toBe(submittedNonce);
        expect(payload.originCommandId).toBe(CommandId.make("fresh-origin"));
      }
      if (scenario !== "missing") {
        expect(yield* Effect.promise(() => harness.readPendingTurnStarts())).toEqual([]);
      }
    }),
  );

  effectIt.effect.each([
    "claim-commit-before-ack",
    "refusal-transaction-failure",
    "interrupted-before-refusal-commit",
  ] as const)("consumes admission across %s, restart, and ownership release", (scenario) =>
    Effect.gen(function* () {
      const baseDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "admission-restart-"));
      const cwd = NodeFS.realpathSync(baseDir);
      const databasePath = NodePath.join(baseDir, "admission.sqlite");
      const interrupted = yield* Deferred.make<void>();
      const harness = yield* Effect.promise(() =>
        createHarness({
          baseDir,
          databasePath,
          workspaceRoot: cwd,
          beforeActivityDispatch: (command) =>
            scenario === "interrupted-before-refusal-commit" &&
            command.commandId.startsWith('server:["workspace-refusal-v1"')
              ? Deferred.succeed(interrupted, undefined).pipe(Effect.andThen(Effect.never))
              : Effect.void,
          afterActivityDispatch: (command) =>
            scenario === "claim-commit-before-ack" &&
            command.activity.kind === "provider.turn.admission.claimed"
              ? Deferred.succeed(interrupted, undefined).pipe(Effect.andThen(Effect.never))
              : Effect.void,
        }),
      );
      const task =
        scenario === "claim-commit-before-ack"
          ? undefined
          : yield* seedAdmissionOwner(harness, cwd);
      if (scenario === "refusal-transaction-failure") {
        yield* Effect.promise(() =>
          harness.runEffect(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              yield* sql`
                CREATE TRIGGER fail_refusal_receipt
                BEFORE INSERT ON orchestration_command_receipts
                WHEN NEW.command_id LIKE 'server:["workspace-refusal-v1"%'
                BEGIN SELECT RAISE(ABORT, 'injected refusal receipt failure'); END
              `;
            }),
          ),
        );
      }
      const failure = yield* watchActivity(harness, failureFor("admission-message"));
      yield* dispatchAdmissionMessage(harness, "before-restart");
      if (scenario === "refusal-transaction-failure") {
        expect(
          decodeWorkspaceTurnStartRefusalPayload((yield* failure).payload.activity.payload),
        ).toEqual(Option.none());
      } else {
        yield* Deferred.await(interrupted).pipe(Effect.timeout("5 seconds"));
      }
      const before = yield* readActivities(harness);
      expect(
        before.filter((activity) => activity.kind === "provider.turn.admission.claimed"),
      ).toHaveLength(1);
      expect(
        before.filter((activity) =>
          Option.isSome(decodeWorkspaceTurnStartRefusalPayload(activity.payload)),
        ),
      ).toEqual([]);
      expect(harness.startSession).not.toHaveBeenCalled();
      expect(harness.sendTurn).not.toHaveBeenCalled();
      expect(harness.compactThread).not.toHaveBeenCalled();
      expect(harness.tryHandlePromptCommand).not.toHaveBeenCalled();
      yield* Effect.promise(closeHarness);

      const restarted = yield* Effect.promise(() =>
        createHarness({ baseDir, databasePath, workspaceRoot: cwd }),
      );
      if (task !== undefined) {
        const ownership = yield* Effect.promise(() =>
          restarted.runEffect(Effect.service(WorkspaceExecutionOwnership)),
        );
        const released = yield* Effect.promise(() =>
          restarted.runEffect(ownership.releaseAnalysis(task.id)),
        );
        const reacquired = yield* seedAdmissionOwner(restarted, cwd, {
          id: "88888888-8888-4888-8888-888888888888",
          generation: released.ownership.generation,
        });
        yield* Effect.promise(() => restarted.runEffect(ownership.releaseAnalysis(reacquired.id)));
      }
      const replayFailure = yield* watchActivity(restarted, failureFor("admission-message"));
      yield* dispatchAdmissionMessage(restarted, "new-command-after-restart");
      const replay = yield* replayFailure;
      yield* Effect.promise(() => restarted.drain());
      expect(decodeWorkspaceTurnStartRefusalPayload(replay.payload.activity.payload)).toEqual(
        Option.none(),
      );
      expect(restarted.startSession).not.toHaveBeenCalled();
      expect(restarted.sendTurn).not.toHaveBeenCalled();
      expect(restarted.compactThread).not.toHaveBeenCalled();
      expect(restarted.tryHandlePromptCommand).not.toHaveBeenCalled();
      expect(yield* Effect.promise(() => restarted.readPendingTurnStarts())).toEqual([]);
      const after = yield* readActivities(restarted);
      expect(
        after.filter((activity) => activity.kind === "provider.turn.admission.claimed"),
      ).toHaveLength(1);
      const identity = makeWorkspaceTurnAdmissionClaimIdentity(
        ThreadId.make("thread-1"),
        MessageId.make("admission-message"),
        { kind: "initial" },
      );
      const receipt = yield* Effect.promise(() =>
        restarted.runEffect(
          Effect.gen(function* () {
            const receipts = yield* OrchestrationCommandReceiptRepository;
            return yield* receipts.getByCommandId({ commandId: identity.commandId });
          }),
        ),
      );
      expect(Option.getOrThrow(receipt).status).toBe("accepted");
    }),
  );

  effectIt.effect("preserves a newer pending start and the immutable bounded refusal", () =>
    Effect.gen(function* () {
      const cwd = NodeFS.realpathSync(
        NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "admission-refused-")),
      );
      createdBaseDirs.add(cwd);
      const firstEntered = yield* Deferred.make<void>();
      const releaseFirst = yield* Deferred.make<void>();
      const newerEntered = yield* Deferred.make<void>();
      const releaseNewer = yield* Deferred.make<void>();
      const harness = yield* Effect.promise(() =>
        createHarness({
          workspaceRoot: cwd,
          beforeActivityDispatch: (command) => {
            const claim = decodeWorkspaceTurnAdmissionClaimPayload(command.activity.payload);
            if (Option.isNone(claim)) return Effect.void;
            if (claim.value.requestId === MessageId.make("admission-message")) {
              return Deferred.succeed(firstEntered, undefined).pipe(
                Effect.andThen(Deferred.await(releaseFirst)),
              );
            }
            if (claim.value.requestId === MessageId.make("newer-message")) {
              return Deferred.succeed(newerEntered, undefined).pipe(
                Effect.andThen(Deferred.await(releaseNewer)),
              );
            }
            return Effect.void;
          },
        }),
      );
      const task = yield* seedAdmissionOwner(harness, cwd, {
        threadId: ThreadId.make("private-owner-thread"),
      });
      const threadId = ThreadId.make("thread-1");
      const activeTurnId = TurnId.make("another-active-turn");
      yield* harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("keep-active-session"),
        threadId,
        session: {
          threadId,
          status: "running",
          providerName: "codex",
          providerInstanceId: ProviderInstanceId.make("codex"),
          runtimeMode: "approval-required",
          activeTurnId,
          lastError: null,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      const refused = yield* watchActivity(harness, failureFor("admission-message"));
      const newerRefused = yield* watchActivity(harness, failureFor("newer-message"));
      yield* dispatchAdmissionMessage(harness, "refused-origin");
      yield* Deferred.await(firstEntered).pipe(Effect.timeout("5 seconds"));
      yield* dispatchAdmissionMessage(harness, "newer-origin", "newer-message");
      yield* Deferred.succeed(releaseFirst, undefined);
      const original = yield* refused;
      yield* Deferred.await(newerEntered).pipe(Effect.timeout("5 seconds"));

      // The subscriber stays alive. The worker is now parked on the newer
      // claim, so the older failure must leave that exact pending slot intact.
      const pending = yield* Effect.promise(() =>
        harness.runEffect(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            return yield* sql<{ readonly messageId: string }>`
              SELECT pending_message_id AS "messageId"
              FROM projection_turns
              WHERE thread_id = ${threadId} AND turn_id IS NULL AND state = 'pending'
            `;
          }),
        ),
      );
      expect(pending).toEqual([{ messageId: "newer-message" }]);
      const active = (yield* Effect.promise(() => harness.readModel())).threads.find(
        (thread) => thread.id === threadId,
      );
      expect(active?.session?.activeTurnId).toBe(activeTurnId);
      expect(active?.session?.status).toBe("running");
      const payload = Option.getOrThrow(
        decodeWorkspaceTurnStartRefusalPayload(original.payload.activity.payload),
      );
      const origin = (yield* Stream.runCollect(harness.engine.readEvents(0, 100))).find(
        (event) =>
          event.type === "thread.turn-start-requested" &&
          event.commandId === CommandId.make("refused-origin"),
      );
      expect(payload).toEqual({
        version: 1,
        source: "workspace-ownership",
        requestId: MessageId.make("admission-message"),
        reason: "owned",
        originCommandId: CommandId.make("refused-origin"),
        originSequence: origin?.sequence,
      });
      for (const privateValue of [cwd, task.id, task.threadId]) {
        expect(encodeActivityJson(original.payload.activity)).not.toContain(privateValue);
      }
      yield* Deferred.succeed(releaseNewer, undefined);
      yield* newerRefused;
      yield* Effect.promise(() => harness.drain());

      const parent = makeWorkspaceTurnAdmissionClaimIdentity(threadId, payload.requestId, {
        kind: "initial",
      });
      const strayCompactionId = EventId.make("stray-compaction");
      const stray = makeWorkspaceTurnCompactionContinuationIdentity(
        threadId,
        payload.requestId,
        parent.activityId,
        strayCompactionId,
      );
      yield* harness.engine.dispatch({
        type: "thread.activity.append",
        commandId: stray.commandId,
        threadId,
        activity: {
          id: stray.activityId,
          tone: "info",
          kind: "provider.turn.compaction.continuation",
          summary: "Stray continuation",
          payload: {
            version: 1,
            source: "workspace-admission",
            requestId: payload.requestId,
            originCommandId: payload.originCommandId,
            originSequence: payload.originSequence,
            parentClaimId: parent.activityId,
            compactionRequestId: MessageId.make("stray-compaction-message"),
            compactionEventId: strayCompactionId,
            compactionSequence: 0,
          },
          turnId: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      const repeated = yield* watchActivity(harness, failureFor("admission-message"));
      yield* dispatchAdmissionMessage(harness, "refused-reissue");
      expect(
        decodeWorkspaceTurnStartRefusalPayload((yield* repeated).payload.activity.payload),
      ).toEqual(Option.none());
      yield* Effect.promise(() => harness.drain());
      const events = yield* Stream.runCollect(harness.engine.readEvents(0, 100));
      expect(
        events.filter(
          (event) =>
            event.type === "thread.activity-appended" &&
            event.payload.activity.id === original.payload.activity.id,
        ),
      ).toEqual([original]);
      expect(harness.startSession).not.toHaveBeenCalled();
      expect(harness.sendTurn).not.toHaveBeenCalled();
      expect(harness.tryHandlePromptCommand).not.toHaveBeenCalled();
      expect(yield* Effect.promise(() => harness.readPendingTurnStarts())).toEqual([]);
      expect(
        (yield* Effect.promise(() => harness.readModel())).threads.find(
          (thread) => thread.id === threadId,
        )?.session,
      ).toMatchObject({ status: "running", activeTurnId });
    }),
  );

  effectIt.effect("does not label an ownership error after callback entry as a refusal", () =>
    Effect.gen(function* () {
      const sent = yield* Deferred.make<void>();
      const harness = yield* Effect.promise(() =>
        createHarness({ afterSendTurn: () => Deferred.succeed(sent, undefined) }),
      );
      const ownership = yield* Effect.promise(() =>
        harness.runEffect(Effect.service(WorkspaceExecutionOwnership)),
      );
      const withFreshOperation = ownership.withFreshOperation;
      const lateFailure: WorkspaceExecutionOwnership["Service"]["withFreshOperation"] = (
        operation,
        effect,
      ) =>
        withFreshOperation(operation, effect).pipe(
          Effect.andThen(
            Effect.fail(
              new WorkspaceOwnershipError({
                cwd: "/private/late-provider-cwd",
                reason: "owned",
                detail: "Private ownership detail after callback entry",
              }),
            ),
          ),
        );
      const spy = vi.spyOn(ownership, "withFreshOperation").mockImplementation(lateFailure);
      const failed = yield* watchActivity(harness, failureFor("admission-message"));
      yield* dispatchAdmissionMessage(harness, "late-ownership-failure");
      const activity = (yield* failed).payload.activity;
      yield* Deferred.await(sent).pipe(Effect.timeout("5 seconds"));
      yield* Effect.promise(() => harness.drain());
      spy.mockRestore();
      expect(harness.startSession).toHaveBeenCalledTimes(1);
      expect(harness.sendTurn).toHaveBeenCalledTimes(1);
      expect(decodeWorkspaceTurnStartRefusalPayload(activity.payload)).toEqual(Option.none());
      expect(encodeActivityJson(activity)).not.toContain("/private/late-provider-cwd");
      expect(encodeActivityJson(activity)).not.toContain("Private ownership detail");
    }),
  );

  effectIt.effect.each(["fresh-successor", "competing-successor"] as const)(
    "consumes successful compaction continuation once (%s)",
    (scenario) =>
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        const completed = yield* Deferred.make<void>();
        const sent = yield* Deferred.make<void>();
        let competitorCommitted = false;
        let competingNonce: string | undefined;
        let submittedNonce: string | undefined;
        let harness: Awaited<ReturnType<typeof createHarness>>;
        harness = yield* Effect.promise(() =>
          createHarness({
            deferReactorStart: true,
            replayPersistedEvents: true,
            compactThreadEffect: () =>
              Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(completed))),
            afterSendTurn: () => Deferred.succeed(sent, undefined),
            beforeActivityDispatch: (command) => {
              const decoded = decodeWorkspaceTurnAdmissionClaimPayload(command.activity.payload);
              if (
                scenario !== "competing-successor" ||
                competitorCommitted ||
                Option.isNone(decoded) ||
                decoded.value.attempt.kind !== "compaction"
              ) {
                return Effect.void;
              }
              competitorCommitted = true;
              submittedNonce = decoded.value.claimantNonce;
              competingNonce = differentClaimantNonce(submittedNonce);
              return harness.engine
                .dispatch({
                  ...command,
                  activity: {
                    ...command.activity,
                    payload: { ...decoded.value, claimantNonce: competingNonce },
                  },
                })
                .pipe(Effect.orDie, Effect.asVoid);
            },
          }),
        );
        yield* prepareCompactionConversation(harness, "/tmp/provider-project");
        yield* dispatchAdmissionMessage(
          harness,
          "successful-compact",
          "compact-message",
          "/compact",
        );
        yield* Deferred.await(entered).pipe(Effect.timeout("5 seconds"));
        const claimed = yield* watchActivity(
          harness,
          (activity) =>
            activity.kind === "provider.turn.admission.claimed" &&
            Option.getOrUndefined(decodeActivityRequest(activity.payload))?.requestId ===
              MessageId.make("queued-message"),
        );
        yield* dispatchAdmissionMessage(
          harness,
          "queued-origin",
          "queued-message",
          "Queued intent",
        );
        yield* claimed;
        yield* Effect.promise(() => harness.drain());
        expect(harness.sendTurn).not.toHaveBeenCalled();
        const failed = yield* watchActivity(harness, failureFor("queued-message"));
        expect(yield* Deferred.succeed(completed, undefined)).toBe(true);
        if (scenario === "fresh-successor") {
          yield* Deferred.await(sent).pipe(Effect.timeout("5 seconds"));
        } else {
          expect(
            decodeWorkspaceTurnStartRefusalPayload((yield* failed).payload.activity.payload),
          ).toEqual(Option.none());
          expect(competingNonce).not.toBe(submittedNonce);
        }
        yield* Effect.promise(() => harness.drain());
        // Duplicate completion cannot re-enter the success branch.
        expect(yield* Deferred.succeed(completed, undefined)).toBe(false);
        const events = yield* Stream.runCollect(harness.engine.readEvents(0, 100));
        const origin = events.find(
          (event) =>
            event.type === "thread.turn-start-requested" &&
            event.commandId === CommandId.make("queued-origin"),
        );
        const compaction = events.find(
          (event) =>
            event.type === "thread.turn-start-requested" &&
            event.commandId === CommandId.make("successful-compact"),
        );
        const replay = events.find(
          (event) =>
            event.type === "thread.turn-start-requested" &&
            event.commandId?.startsWith("server:after-compaction:"),
        );
        const restoration = events.find(
          (event) =>
            event.type === "thread.session-set" &&
            event.payload.session.status === "ready" &&
            event.commandId?.startsWith("server:provider-session-set:"),
        );
        if (!origin || !compaction || !replay || !restoration) {
          return yield* Effect.die("Expected durable compaction and continuation events");
        }
        const activities = yield* readActivities(harness);
        const permits = activities.filter(
          (activity) => activity.kind === "provider.turn.compaction.continuation",
        );
        expect(permits).toHaveLength(1);
        const permitActivity = permits[0];
        if (!permitActivity) return yield* Effect.die("Expected one continuation permit");
        const permit = Option.getOrThrow(
          decodeWorkspaceTurnCompactionContinuationPayload(permitActivity.payload),
        );
        const initial = makeWorkspaceTurnAdmissionClaimIdentity(
          ThreadId.make("thread-1"),
          MessageId.make("queued-message"),
          { kind: "initial" },
        );
        expect(permit).toEqual({
          version: 1,
          source: "workspace-admission",
          requestId: MessageId.make("queued-message"),
          originCommandId: CommandId.make("queued-origin"),
          originSequence: origin.sequence,
          parentClaimId: initial.activityId,
          compactionRequestId: MessageId.make("compact-message"),
          compactionEventId: compaction.eventId,
          compactionSequence: compaction.sequence,
        });
        const successor = makeWorkspaceTurnAdmissionClaimIdentity(
          ThreadId.make("thread-1"),
          MessageId.make("queued-message"),
          { kind: "compaction", permitId: permitActivity.id },
        );
        const successorActivity = activities.find(
          (activity) => activity.id === successor.activityId,
        );
        if (!successorActivity) return yield* Effect.die("Expected consumed successor claim");
        expect(
          Option.getOrThrow(decodeWorkspaceTurnAdmissionClaimPayload(successorActivity.payload)),
        ).toMatchObject({
          originCommandId: CommandId.make("queued-origin"),
          originSequence: origin.sequence,
          attempt: { kind: "compaction", permitId: permitActivity.id },
          ...(scenario === "competing-successor" ? { claimantNonce: competingNonce } : {}),
        });
        yield* harness.replayPersistedEvent(restoration);
        for (const duplicate of [compaction, origin, replay]) {
          if (duplicate.type !== "thread.turn-start-requested") {
            return yield* Effect.die("Expected turn-start event");
          }
          const duplicateFailure = yield* watchActivity(
            harness,
            failureFor(duplicate.payload.messageId),
          );
          yield* harness.replayPersistedEvent(duplicate);
          expect(
            decodeWorkspaceTurnStartRefusalPayload(
              (yield* duplicateFailure).payload.activity.payload,
            ),
          ).toEqual(Option.none());
          yield* Effect.promise(() => harness.drain());
        }
        const newCommandFailure = yield* watchActivity(harness, failureFor("queued-message"));
        yield* dispatchAdmissionMessage(
          harness,
          "new-command-is-not-new-permission",
          "queued-message",
          "Queued intent",
        );
        yield* newCommandFailure;
        yield* Effect.promise(() => harness.drain());
        expect(harness.compactThread).toHaveBeenCalledTimes(1);
        expect(harness.startSession).not.toHaveBeenCalled();
        expect(harness.sendTurn).toHaveBeenCalledTimes(scenario === "fresh-successor" ? 1 : 0);
        const finalActivities = yield* readActivities(harness);
        const projected = (yield* Effect.promise(() => harness.readModel())).threads.find(
          (thread) => thread.id === ThreadId.make("thread-1"),
        );
        expect(
          projected?.activities.some(
            (activity) =>
              activity.kind === "provider.turn.admission.claimed" ||
              activity.kind === "provider.turn.compaction.continuation",
          ),
        ).toBe(false);
        expect(
          finalActivities.filter(
            (activity) => activity.kind === "provider.turn.compaction.continuation",
          ),
        ).toEqual(permits);
        expect(
          finalActivities.filter(
            (activity) =>
              activity.kind === "provider.turn.admission.claimed" &&
              Option.getOrUndefined(decodeActivityRequest(activity.payload))?.requestId ===
                MessageId.make("queued-message"),
          ),
        ).toHaveLength(2);
        expect(yield* Effect.promise(() => harness.readPendingTurnStarts())).toEqual([]);
      }),
  );

  effectIt.effect.each(["failed", "unrestored"] as const)(
    "does not mint a continuation after %s compaction",
    (scenario) =>
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        const finish = yield* Deferred.make<void>();
        const harness = yield* Effect.promise(() =>
          createHarness({
            deferReactorStart: true,
            compactThreadEffect: () =>
              Deferred.succeed(entered, undefined).pipe(
                Effect.andThen(Deferred.await(finish)),
                Effect.andThen(
                  scenario === "failed"
                    ? Effect.fail(
                        new ProviderAdapterRequestError({
                          provider: "codex",
                          method: "compactThread",
                          detail: "Injected unsuccessful compaction",
                        }),
                      )
                    : Effect.void,
                ),
              ),
          }),
        );
        yield* prepareCompactionConversation(harness, "/tmp/provider-project");
        yield* dispatchAdmissionMessage(
          harness,
          "unsuccessful-compact",
          "compact-message",
          "/compact",
        );
        yield* Deferred.await(entered).pipe(Effect.timeout("5 seconds"));
        const claimed = yield* watchActivity(
          harness,
          (activity) =>
            activity.kind === "provider.turn.admission.claimed" &&
            Option.getOrUndefined(decodeActivityRequest(activity.payload))?.requestId ===
              MessageId.make("queued-message"),
        );
        yield* dispatchAdmissionMessage(harness, "queued-origin", "queued-message");
        yield* claimed;
        yield* Effect.promise(() => harness.drain());
        if (scenario === "unrestored") {
          yield* harness.engine.dispatch({
            type: "thread.session.set",
            commandId: CommandId.make("externally-stopped-session"),
            threadId: ThreadId.make("thread-1"),
            session: {
              threadId: ThreadId.make("thread-1"),
              status: "stopped",
              providerName: "codex",
              providerInstanceId: ProviderInstanceId.make("codex"),
              runtimeMode: "approval-required",
              activeTurnId: null,
              lastError: null,
              updatedAt: "2026-01-01T00:00:01.000Z",
            },
            createdAt: "2026-01-01T00:00:01.000Z",
          });
        }
        const canceled = yield* watchActivity(harness, failureFor("queued-message"));
        yield* Deferred.succeed(finish, undefined);
        yield* canceled;
        yield* Effect.promise(() => harness.drain());
        const repeated = yield* watchActivity(harness, failureFor("queued-message"));
        yield* dispatchAdmissionMessage(harness, "after-failed-compaction", "queued-message");
        yield* repeated;
        yield* Effect.promise(() => harness.drain());
        expect(harness.sendTurn).not.toHaveBeenCalled();
        expect(harness.compactThread).toHaveBeenCalledTimes(1);
        expect(
          (yield* readActivities(harness)).filter(
            (activity) => activity.kind === "provider.turn.compaction.continuation",
          ),
        ).toEqual([]);
        expect(yield* Effect.promise(() => harness.readPendingTurnStarts())).toEqual([]);
      }),
  );

  effectIt.effect(
    "fences a compaction continuation at its original sequence across sibling ownership",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fs.realPath(
          yield* fs.makeTempDirectoryScoped({ prefix: "admission-sibling-compaction-" }),
        );
        const cwd = `${root}/main`;
        const linked = `${root}/linked`;
        yield* fs.makeDirectory(cwd);
        const runner = yield* ProcessRunner.ProcessRunner;
        for (const args of [
          ["init", "-q"],
          [
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@localhost",
            "commit",
            "--allow-empty",
            "-qm",
            "Fixture",
          ],
          ["worktree", "add", "--detach", linked, "HEAD"],
        ]) {
          expect((yield* runner.run({ command: "git", args: ["-C", cwd, ...args] })).code).toBe(0);
        }
        const entered = yield* Deferred.make<void>();
        const finish = yield* Deferred.make<void>();
        const replayReady = yield* Deferred.make<void>();
        const releaseReplay = yield* Deferred.make<void>();
        const harness = yield* Effect.promise(() =>
          createHarness({
            workspaceRoot: cwd,
            deferReactorStart: true,
            compactThreadEffect: () =>
              Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(finish))),
            beforeTurnStartDispatch: () =>
              Deferred.succeed(replayReady, undefined).pipe(
                Effect.andThen(Deferred.await(releaseReplay)),
              ),
          }),
        );
        yield* prepareCompactionConversation(harness, cwd);
        yield* dispatchAdmissionMessage(harness, "sibling-compact", "compact-message", "/compact");
        yield* Deferred.await(entered).pipe(Effect.timeout("5 seconds"));
        const claimed = yield* watchActivity(
          harness,
          (activity) =>
            activity.kind === "provider.turn.admission.claimed" &&
            Option.getOrUndefined(decodeActivityRequest(activity.payload))?.requestId ===
              MessageId.make("queued-message"),
        );
        yield* dispatchAdmissionMessage(harness, "original-before-sibling-owner", "queued-message");
        yield* claimed;
        yield* Effect.promise(() => harness.drain());
        yield* Deferred.succeed(finish, undefined);
        yield* Deferred.await(replayReady).pipe(Effect.timeout("5 seconds"));
        const task = yield* seedAdmissionOwner(harness, cwd, {
          threadId: ThreadId.make("sibling-owner-thread"),
          worktreePath: linked,
        });
        const refused = yield* watchActivity(harness, failureFor("queued-message"));
        yield* Deferred.succeed(releaseReplay, undefined);
        const failure = (yield* refused).payload.activity;
        yield* Effect.promise(() => harness.drain());
        const payload = Option.getOrThrow(decodeWorkspaceTurnStartRefusalPayload(failure.payload));
        const events = yield* Stream.runCollect(harness.engine.readEvents(0, 100));
        const origin = events.find(
          (event) =>
            event.type === "thread.turn-start-requested" &&
            event.commandId === CommandId.make("original-before-sibling-owner"),
        );
        const changed = events.find((event) => event.type === "thread.weavra-task-set");
        const replay = events.find(
          (event) =>
            event.type === "thread.turn-start-requested" &&
            event.commandId?.startsWith("server:after-compaction:"),
        );
        if (!origin || !changed || !replay)
          return yield* Effect.die("Expected ownership fence events");
        expect(origin.sequence).toBeLessThan(changed.sequence);
        expect(changed.sequence).toBeLessThan(replay.sequence);
        // Using the replay sequence would report "owned", not the original
        // request's intervening-generation refusal.
        expect(payload.reason).toBe("stale");
        expect(payload.originSequence).toBe(origin.sequence);
        expect(payload.originCommandId).toBe(CommandId.make("original-before-sibling-owner"));
        const activities = yield* readActivities(harness);
        const permits = activities.filter(
          (activity) => activity.kind === "provider.turn.compaction.continuation",
        );
        expect(permits).toHaveLength(1);
        const permitActivity = permits[0];
        if (!permitActivity) return yield* Effect.die("Expected successful compaction permit");
        expect(
          Option.getOrThrow(
            decodeWorkspaceTurnCompactionContinuationPayload(permitActivity.payload),
          ).originSequence,
        ).toBe(origin.sequence);
        for (const privateValue of [cwd, linked, task.id, task.threadId]) {
          expect(encodeActivityJson(failure)).not.toContain(privateValue);
        }
        expect(harness.compactThread).toHaveBeenCalledTimes(1);
        expect(harness.startSession).not.toHaveBeenCalled();
        expect(harness.sendTurn).not.toHaveBeenCalled();
        expect(yield* Effect.promise(() => harness.readPendingTurnStarts())).toEqual([]);
      }).pipe(Effect.provide(ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer)))),
  );

  effectIt.effect.each(["current", "stale"] as const)(
    "keeps queued controlled analysis separate from ordinary permits (%s revision)",
    (revision) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* fs.realPath(
          yield* fs.makeTempDirectoryScoped({ prefix: "controlled-compaction-queue-" }),
        );
        const runner = yield* ProcessRunner.ProcessRunner;
        expect((yield* runner.run({ command: "git", args: ["-C", cwd, "init", "-q"] })).code).toBe(
          0,
        );
        const entered = yield* Deferred.make<void>();
        const finish = yield* Deferred.make<void>();
        const analysisRead = yield* Deferred.make<void>();
        const replayed = yield* Deferred.make<void>();
        const sent = yield* Deferred.make<void>();
        const analysisMessageId = MessageId.make("queued-controlled-analysis");
        const harness = yield* Effect.promise(() =>
          createHarness({
            workspaceRoot: cwd,
            deferReactorStart: true,
            compactThreadEffect: () =>
              Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(finish))),
            afterTurnStartMessageRead: (messageId) =>
              messageId === analysisMessageId
                ? Deferred.succeed(analysisRead, undefined)
                : Effect.void,
            afterTurnStartDispatch: () => Deferred.succeed(replayed, undefined),
            afterSendTurn: () => Deferred.succeed(sent, undefined),
          }),
        );
        yield* prepareCompactionConversation(harness, cwd);
        yield* dispatchAdmissionMessage(
          harness,
          "controlled-queue-compact",
          "compact-message",
          "/compact",
        );
        yield* Deferred.await(entered).pipe(Effect.timeout("5 seconds"));
        const task = yield* seedAdmissionOwner(harness, cwd);
        yield* harness.engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make("queued-analysis-origin"),
          threadId: ThreadId.make("thread-1"),
          message: {
            messageId: analysisMessageId,
            role: "user",
            text: "Analyze without ordinary write authority",
            attachments: [],
          },
          runtimeMode: "approval-required",
          interactionMode: "plan",
          controlledAnalysis: { taskId: task.id, expectedRevision: task.revision },
          createdAt: "2026-01-01T00:00:00.000Z",
        });
        yield* Deferred.await(analysisRead).pipe(Effect.timeout("5 seconds"));
        yield* Effect.promise(() => harness.drain());
        expect(harness.startSession).not.toHaveBeenCalled();
        expect(harness.sendTurn).not.toHaveBeenCalled();
        if (revision === "stale") {
          yield* harness.engine.dispatch({
            type: "thread.weavra-task.set",
            commandId: CommandId.make("analysis-revised-while-queued"),
            threadId: task.threadId,
            expectedRevision: task.revision,
            expectedOwnershipGeneration: task.ownership.generation,
            task: {
              ...task,
              revision: task.revision + 1,
              ownership: { ...task.ownership, generation: task.ownership.generation + 1 },
            },
          });
        }
        yield* Deferred.succeed(finish, undefined);
        yield* Deferred.await(replayed).pipe(Effect.timeout("5 seconds"));
        if (revision === "current") {
          yield* Deferred.await(sent).pipe(Effect.timeout("5 seconds"));
          yield* Effect.promise(() => harness.drain());
          expect(harness.startSession).toHaveBeenCalledTimes(1);
          expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
            controlledAnalysis: { taskId: task.id, generation: task.ownership.generation },
          });
          expect(harness.startSession.mock.calls[0]?.[1]).not.toHaveProperty("resumeCursor");
          expect(harness.sendTurn).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ interactionMode: "plan" }),
          );
        } else {
          // A later ordinary refusal is a worker-order barrier after the stale
          // controlled replay. It does not substitute for task revision checks.
          const barrier = yield* watchActivity(harness, failureFor("analysis-barrier"));
          yield* dispatchAdmissionMessage(harness, "analysis-barrier", "analysis-barrier");
          yield* barrier;
          yield* Effect.promise(() => harness.drain());
          expect(harness.startSession).not.toHaveBeenCalled();
          expect(harness.sendTurn).not.toHaveBeenCalled();
        }
        const activities = yield* readActivities(harness);
        expect(
          activities.filter(
            (activity) =>
              (activity.kind === "provider.turn.admission.claimed" ||
                activity.kind === "provider.turn.compaction.continuation") &&
              Option.getOrUndefined(decodeActivityRequest(activity.payload))?.requestId ===
                analysisMessageId,
          ),
        ).toEqual([]);
        expect(harness.compactThread).toHaveBeenCalledTimes(1);
      }).pipe(Effect.provide(ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer)))),
  );

  effectIt.effect(
    "starts a fresh controlled analysis from an existing free Codex conversation",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* fs.realPath(
          yield* fs.makeTempDirectoryScoped({ prefix: "controlled-transition-" }),
        );
        const runner = yield* ProcessRunner.ProcessRunner;
        expect((yield* runner.run({ command: "git", args: ["-C", cwd, "init", "-q"] })).code).toBe(
          0,
        );
        const started = yield* Deferred.make<void>();
        const harness = yield* Effect.promise(() =>
          createHarness({
            workspaceRoot: cwd,
            deferReactorStart: true,
            afterSendTurn: () => Deferred.succeed(started, undefined).pipe(Effect.asVoid),
          }),
        );
        const threadId = ThreadId.make("thread-1");
        const now = "2026-01-01T00:00:00.000Z";
        harness.runtimeSessions.push({
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: ProviderInstanceId.make("codex"),
          threadId,
          status: "ready",
          runtimeMode: "approval-required",
          cwd,
          model: "gpt-5-codex",
          resumeCursor: { threadId: "existing-free-provider-thread" },
          createdAt: now,
          updatedAt: now,
        });
        yield* harness.engine.dispatch({
          type: "thread.session.set",
          commandId: CommandId.make("existing-free-session"),
          threadId,
          session: {
            threadId,
            status: "ready",
            providerName: "codex",
            providerInstanceId: ProviderInstanceId.make("codex"),
            runtimeMode: "approval-required",
            activeTurnId: null,
            lastError: null,
            updatedAt: now,
          },
          createdAt: now,
        });
        const ownership = yield* Effect.promise(() =>
          harness.runEffect(Effect.service(WorkspaceExecutionOwnership)),
        );
        const task = yield* decodeControlledTask({
          id: "88888888-8888-4888-8888-888888888888",
          environmentId: ownership.environmentId,
          projectId: asProjectId("project-1"),
          threadId,
          target: { workspaceRoot: cwd, worktreePath: null },
          checkout: {
            canonicalCwd: cwd,
            repositoryRoot: cwd,
            headCommit: "a".repeat(40),
            workspaceDigest: `sha256:${"a".repeat(64)}`,
          },
          phase: "analysis",
          revision: 1,
          context: null,
          execution: null,
          ownership: { generation: 1, state: "analysis" },
          createdAt: now,
          updatedAt: now,
        });
        yield* Effect.promise(() =>
          harness.runEffect(
            ownership.updateTask({
              type: "thread.weavra-task.set",
              commandId: CommandId.make("controlled-transition-task"),
              threadId,
              expectedRevision: null,
              expectedOwnershipGeneration: 0,
              task,
            }),
          ),
        );
        yield* Effect.promise(() => harness.startReactor());
        yield* harness.engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make("controlled-transition-turn"),
          threadId,
          message: {
            messageId: MessageId.make("controlled-transition-message"),
            role: "user",
            text: "Analyze the observed bug",
            attachments: [],
          },
          interactionMode: "plan",
          runtimeMode: "approval-required",
          createdAt: now,
          controlledAnalysis: { taskId: task.id, expectedRevision: task.revision },
        });
        yield* Deferred.await(started);
        yield* Effect.promise(() => harness.drain());
        expect(harness.startSession).toHaveBeenCalledTimes(1);
        expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
          controlledAnalysis: { taskId: task.id, generation: task.ownership.generation },
        });
        expect(harness.startSession.mock.calls[0]?.[1]).not.toHaveProperty("resumeCursor");
        expect(harness.sendTurn).toHaveBeenCalledTimes(1);
      }).pipe(
        Effect.scoped,
        Effect.provide(ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer))),
      ),
  );

  effectIt.effect("retains compaction across an ownership acquire-drain-release ABA attempt", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const cwd = yield* fs.realPath(
        yield* fs.makeTempDirectoryScoped({ prefix: "weavra-compact-aba-" }),
      );
      const runner = yield* ProcessRunner.ProcessRunner;
      const initialized = yield* runner.run({ command: "git", args: ["-C", cwd, "init", "-q"] });
      expect(initialized.code).toBe(0);
      const entered = yield* Deferred.make<void>();
      const resume = yield* Deferred.make<void>();
      const attempted = yield* Deferred.make<void>();
      const restored = yield* Deferred.make<void>();
      const ownerReady = yield* Deferred.make<WorkspaceExecutionOwnership["Service"]>();
      let mutations = 0;
      const threadId = ThreadId.make("thread-1");
      const harness = yield* Effect.promise(() =>
        createHarness({
          workspaceRoot: cwd,
          deferReactorStart: true,
          compactThreadEffect: () =>
            Effect.gen(function* () {
              yield* Deferred.succeed(entered, undefined);
              yield* Deferred.await(resume);
              const owner = yield* Deferred.await(ownerReady);
              yield* owner
                .withFreshOperation(
                  { cwd, kind: "provider", threadId },
                  Effect.sync(() => {
                    mutations++;
                  }),
                )
                .pipe(
                  Effect.mapError(
                    (cause) =>
                      new ProviderAdapterRequestError({
                        provider: "codex",
                        method: "compactThread",
                        detail: cause.message,
                        cause,
                      }),
                  ),
                );
            }).pipe(Effect.ensuring(Deferred.succeed(attempted, undefined))),
        }),
      );
      const ownership = yield* Effect.promise(() =>
        harness.runEffect(Effect.service(WorkspaceExecutionOwnership)),
      );
      yield* Deferred.succeed(ownerReady, ownership);
      harness.runtimeSessions.push({
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId: ProviderInstanceId.make("codex"),
        threadId,
        status: "ready",
        runtimeMode: "approval-required",
        cwd,
        model: "gpt-5-codex",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      yield* harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("compact-history"),
        threadId,
        message: {
          messageId: MessageId.make("compact-history"),
          role: "user",
          text: "Earlier work",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      yield* harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("compact-ready"),
        threadId,
        session: {
          threadId,
          status: "ready",
          providerName: "codex",
          providerInstanceId: ProviderInstanceId.make("codex"),
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      yield* Effect.promise(() => harness.startReactor());
      yield* harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("compact-aba"),
        threadId,
        message: {
          messageId: MessageId.make("compact-aba"),
          role: "user",
          text: "/compact",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      yield* Deferred.await(entered);
      yield* Effect.promise(() => harness.drain());
      const events = yield* harness.engine.subscribeDomainEvents;
      yield* Stream.runForEach(events, (event) =>
        event.type === "thread.session-set" && event.payload.session.status === "ready"
          ? Deferred.succeed(restored, undefined)
          : Effect.void,
      ).pipe(Effect.forkScoped({ startImmediately: true }));
      const task = decodeOwnershipTask({
        id: "77777777-7777-4777-8777-777777777777",
        environmentId: ownership.environmentId,
        projectId: asProjectId("project-1"),
        threadId,
        target: { workspaceRoot: cwd, worktreePath: null },
        checkout: {
          canonicalCwd: cwd,
          repositoryRoot: cwd,
          headCommit: "a".repeat(40),
          workspaceDigest: `sha256:${"a".repeat(64)}`,
        },
        phase: "analysis",
        revision: 1,
        context: null,
        execution: null,
        ownership: { generation: 1, state: "analysis" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      yield* Effect.promise(() =>
        harness.runEffect(
          ownership.updateTask({
            type: "thread.weavra-task.set",
            commandId: CommandId.make("compact-task"),
            threadId,
            expectedRevision: null,
            expectedOwnershipGeneration: 0,
            task,
          }),
        ),
      );
      yield* Effect.promise(() => harness.runEffect(ownership.closeAdmission(task.id)));
      const retained = (yield* ownership.activeOperations).length > 0;
      if (!retained) {
        // Exercise the full ABA cycle when the bug has lost the fork's admission.
        yield* Effect.promise(() => harness.runEffect(ownership.drain(task.id)));
        yield* Effect.promise(() => harness.runEffect(ownership.releaseAnalysis(task.id)));
      } else {
        const blocked = yield* Effect.promise(() =>
          harness.runEffect(ownership.releaseAnalysis(task.id).pipe(Effect.result)),
        );
        expect(blocked._tag).toBe("Failure");
      }
      yield* Deferred.succeed(resume, undefined);
      yield* Deferred.await(attempted);
      yield* Deferred.await(restored);
      if (retained) {
        yield* Effect.promise(() => harness.runEffect(ownership.drain(task.id)));
        yield* Effect.promise(() => harness.runEffect(ownership.releaseAnalysis(task.id)));
      }
      expect(mutations).toBe(0);
      expect(yield* ownership.activeOperations).toEqual([]);
    }).pipe(Effect.provide(ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer)))),
  );

  effectIt.effect.each(["new", "ready", "stopped"] as const)(
    "handles sign-out for a %s thread before worktree repair, text helpers, or startup",
    (sessionStatus) =>
      Effect.gen(function* () {
        const instanceId = ProviderInstanceId.make("antigravity-personal");
        const handled = yield* Deferred.make<void>();
        const harness = yield* Effect.promise(() =>
          createHarness({
            ...(sessionStatus === "new"
              ? {}
              : {
                  threadModelSelection: { instanceId, model: "gemini-3.1-pro" },
                }),
            tryHandlePromptCommandEffect: () =>
              Deferred.succeed(handled, undefined).pipe(Effect.as(true)),
          }),
        );
        const threadId = ThreadId.make("thread-1");
        const createdAt = "2026-01-01T00:00:00.000Z";
        if (sessionStatus !== "new") {
          yield* harness.engine.dispatch({
            type: "thread.session.set",
            commandId: CommandId.make("cmd-sign-out-bound-session"),
            threadId,
            session: {
              threadId,
              providerInstanceId: instanceId,
              providerName: "antigravity",
              status: sessionStatus,
              runtimeMode: "approval-required",
              activeTurnId: null,
              lastError: null,
              updatedAt: createdAt,
            },
            createdAt,
          });
        }
        yield* harness.engine.dispatch({
          type: "thread.meta.update",
          commandId: CommandId.make("cmd-sign-out-worktree"),
          threadId,
          title: "New thread",
          branch: "t3code/1234abcd",
          worktreePath: NodePath.join(harness.stateDir, "missing-worktree"),
        });

        yield* harness.engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make("cmd-provider-sign-out"),
          threadId,
          message: {
            messageId: MessageId.make("message-provider-sign-out"),
            role: "user",
            text: "/logout",
            attachments: [],
          },
          modelSelection: {
            instanceId:
              sessionStatus === "new" ? instanceId : ProviderInstanceId.make("antigravity-other"),
            model: "gemini-3.1-pro",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          createdAt,
        });
        yield* Deferred.await(handled);
        yield* Effect.promise(() => harness.drain());

        const thread = (yield* Effect.promise(() => harness.readModel())).threads.find(
          (entry) => entry.id === threadId,
        );
        expect(thread?.session).toMatchObject({
          status: "stopped",
          providerName: "antigravity",
          providerInstanceId: instanceId,
          activeTurnId: null,
          lastError: null,
        });
        expect(thread?.messages.map((message) => message.text)).toEqual(["/logout"]);
        expect(thread?.activities).toContainEqual(
          expect.objectContaining({ kind: "provider.auth.signed-out", tone: "info", turnId: null }),
        );
        expect(yield* Effect.promise(() => harness.readPendingTurnStarts())).toEqual([]);
        expect(harness.tryHandlePromptCommand).toHaveBeenCalledWith({
          instanceId,
          text: "/logout",
          hasAttachments: false,
        });
        expect(harness.pruneWorktrees).not.toHaveBeenCalled();
        expect(harness.createWorktree).not.toHaveBeenCalled();
        expect(harness.generateThreadTitle).not.toHaveBeenCalled();
        expect(harness.generateBranchName).not.toHaveBeenCalled();
        expect(harness.startSession).not.toHaveBeenCalled();
        expect(harness.sendTurn).not.toHaveBeenCalled();
      }),
  );

  effectIt.effect("clears a failed sign-out request without sending it as a prompt", () =>
    Effect.gen(function* () {
      const instanceId = ProviderInstanceId.make("antigravity-personal");
      const handled = yield* Deferred.make<void>();
      const harness = yield* Effect.promise(() =>
        createHarness({
          threadModelSelection: { instanceId, model: "gemini-3.1-pro" },
          tryHandlePromptCommandEffect: () =>
            Deferred.succeed(handled, undefined).pipe(
              Effect.andThen(
                Effect.fail(
                  new ProviderSetupError({
                    instanceId,
                    operation: "logout",
                    detail: "The provider could not sign out. Try again.",
                  }),
                ),
              ),
            ),
        }),
      );
      const threadId = ThreadId.make("thread-1");

      yield* harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-provider-sign-out-failed"),
        threadId,
        message: {
          messageId: MessageId.make("message-provider-sign-out-failed"),
          role: "user",
          text: "/logout",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      yield* Deferred.await(handled);
      yield* Effect.promise(() => harness.drain());

      const thread = (yield* Effect.promise(() => harness.readModel())).threads.find(
        (entry) => entry.id === threadId,
      );
      expect(thread?.session).toMatchObject({
        status: "error",
        activeTurnId: null,
        lastError: expect.stringContaining("The provider could not sign out. Try again."),
      });
      expect(thread?.activities).toContainEqual(
        expect.objectContaining({ kind: "provider.turn.start.failed", tone: "error" }),
      );
      expect(
        thread?.activities.some((activity) => activity.kind === "provider.auth.signed-out"),
      ).toBe(false);
      expect(yield* Effect.promise(() => harness.readPendingTurnStarts())).toEqual([]);
      expect(harness.startSession).not.toHaveBeenCalled();
      expect(harness.sendTurn).not.toHaveBeenCalled();
    }),
  );

  effectIt.effect.each([
    { label: "a command mention", text: "What does /logout do?", attachments: [] },
    {
      label: "a command with an attachment",
      text: "/logout",
      attachments: [
        {
          type: "file" as const,
          id: "attached-notes",
          name: "notes.txt",
          mimeType: "text/plain",
          sizeBytes: 8,
        },
      ],
    },
    { label: "another provider's command", text: "/logout", attachments: [] },
  ])("sends $label when the provider auth handler leaves it unhandled", ({ text, attachments }) =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const harness = yield* Effect.promise(() =>
        createHarness({
          startSessionEffect: (session) =>
            Deferred.succeed(started, undefined).pipe(Effect.as(session)),
        }),
      );

      yield* harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-provider-command-unhandled"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: MessageId.make("message-provider-command-unhandled"),
          role: "user",
          text,
          attachments,
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      yield* Deferred.await(started);
      yield* Effect.promise(() => harness.drain());

      expect(harness.tryHandlePromptCommand).toHaveBeenCalledWith({
        instanceId: ProviderInstanceId.make("codex"),
        text,
        hasAttachments: attachments.length > 0,
      });
      expect(harness.sendTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          input: text,
          ...(attachments.length > 0 ? { attachments } : {}),
        }),
      );
    }),
  );

  it("reacts to thread.turn.start by ensuring session and sending provider turn", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-1"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-1"),
          role: "user",
          text: "hello reactor",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 1);
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.startSession.mock.calls[0]?.[0]).toEqual(ThreadId.make("thread-1"));
    expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
      cwd: "/tmp/provider-project",
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-codex",
      },
      runtimeMode: "approval-required",
    });

    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.session?.threadId).toBe("thread-1");
    expect(thread?.session?.status).toBe("starting");
    expect(thread?.session?.runtimeMode).toBe("approval-required");
  });

  effectIt.effect("projects inline context before sending the provider turn", () =>
    Effect.gen(function* () {
      const harness = yield* Effect.promise(() => createHarness());

      yield* harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-with-context"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-with-context"),
          role: "user",
          text: "Inspect [build](t3-context://v1/terminal/terminal-1)",
          attachments: [],
          context: {
            version: 1,
            records: [
              {
                version: 1,
                kind: "terminal",
                contextId: ComposerContextId.make("terminal-1"),
                label: "build",
                terminalId: "terminal-1",
                terminalLabel: "Build",
                lineStart: 7,
                lineEnd: 7,
                text: "compiled successfully",
              },
            ],
          },
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: "2026-01-01T00:00:00.000Z",
      });

      yield* Effect.promise(() => waitFor(() => harness.sendTurn.mock.calls.length === 1));
      expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
        input: expect.stringContaining("[Terminal: build; ref=terminal-1]"),
      });
      expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
        input: expect.stringContaining('<context kind="terminal" id="terminal-1">'),
      });
    }),
  );

  effectIt.effect("retains a turn dispatched immediately after start until activation", () =>
    Effect.gen(function* () {
      const activation = yield* Deferred.make<void>();
      const started = yield* Deferred.make<ProviderSession>();
      const harness = yield* Effect.promise(() =>
        createHarness({
          serverActivation: Deferred.await(activation),
          startSessionEffect: (session) =>
            Deferred.succeed(started, session).pipe(Effect.as(session)),
        }),
      );

      yield* harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-before-activation"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: MessageId.make("message-before-activation"),
          role: "user",
          text: "Start after activation",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      expect(yield* Deferred.isDone(started)).toBe(false);

      yield* Deferred.succeed(activation, undefined);
      const session = yield* Deferred.await(started);
      yield* Effect.promise(() => harness.drain());
      expect(session.threadId).toBe(ThreadId.make("thread-1"));
      expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
        threadId: ThreadId.make("thread-1"),
        input: "Start after activation",
      });
    }),
  );

  effectIt.effect("starts a turn and generates its title without loading old message bodies", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const titleGenerated = yield* Deferred.make<void>();
      const harness = yield* Effect.promise(() =>
        createHarness({
          unreadableHistory: true,
          startSessionEffect: (session) =>
            Deferred.succeed(started, undefined).pipe(Effect.as(session)),
        }),
      );
      harness.generateThreadTitle.mockReturnValue(
        Deferred.succeed(titleGenerated, undefined).pipe(Effect.as({ title: "Generated title" })),
      );
      yield* harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-with-old-history"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: MessageId.make("message-turn-start-with-old-history"),
          role: "user",
          text: "Use the current message",
          attachments: [],
        },
        titleSeed: "Thread",
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: "2026-01-01T00:00:01.000Z",
      });
      yield* Deferred.await(started);
      yield* Deferred.await(titleGenerated);
      yield* Effect.promise(() => harness.drain());

      expect(harness.sendTurn).toHaveBeenCalledWith(
        expect.objectContaining({ input: "Use the current message" }),
      );
      expect(harness.generateThreadTitle).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Use the current message" }),
      );
    }),
  );

  effectIt.effect("rejects /compact without conversation context", () =>
    Effect.gen(function* () {
      const harness = yield* Effect.promise(() => createHarness());
      yield* harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-empty-compact"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-empty-compact"),
          role: "user",
          text: "/compact",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      yield* Effect.promise(() => harness.drain());
      expect(harness.compactThread).not.toHaveBeenCalled();
    }),
  );

  effectIt.effect.each(["resume", "stop before resume", "stop after send"])(
    "queues messages until compaction restores the session (%s)",
    (scenario) =>
      Effect.gen(function* () {
        const stopBeforeResume = scenario === "stop before resume";
        const readyDispatchStarted = yield* Deferred.make<void>();
        const releaseReadyDispatch = yield* Deferred.make<void>();
        const firstSent = yield* Deferred.make<void>();
        const queuedSent = yield* Deferred.make<void>();
        const resumeStarted = yield* Deferred.make<void>();
        const releaseResume = yield* Deferred.make<void>();
        const resumeDispatched = yield* Deferred.make<void>();
        const queuedSendStarted = yield* Deferred.make<void>();
        const releaseQueuedSend = yield* Deferred.make<void>();
        let blockReadyDispatch = false;
        const harness = yield* Effect.promise(() =>
          createHarness({
            beforeTurnStartDispatch: () =>
              stopBeforeResume
                ? Deferred.succeed(resumeStarted, undefined).pipe(
                    Effect.andThen(Deferred.await(releaseResume)),
                  )
                : Effect.void,
            afterTurnStartDispatch: () => Deferred.succeed(resumeDispatched, undefined),
            beforeReadySessionDispatch: () =>
              blockReadyDispatch
                ? Deferred.succeed(readyDispatchStarted, undefined).pipe(
                    Effect.andThen(Deferred.await(releaseReadyDispatch)),
                  )
                : Effect.void,
          }),
        );
        const threadId = ThreadId.make("thread-1");
        let sentCount = 0;
        harness.sendTurn.mockImplementation(() =>
          Effect.succeed({ threadId, turnId: asTurnId("turn-1") }).pipe(
            Effect.tap(() => {
              sentCount++;
              return sentCount === 1
                ? Deferred.succeed(firstSent, undefined)
                : sentCount === 2 && scenario === "stop after send"
                  ? Deferred.succeed(queuedSendStarted, undefined).pipe(
                      Effect.andThen(Deferred.await(releaseQueuedSend)),
                    )
                  : sentCount === 3
                    ? Deferred.succeed(queuedSent, undefined)
                    : Effect.void;
            }),
          ),
        );
        const now = "2026-01-01T00:00:00.000Z";
        const dispatchTurn = (id: string, text: string, createdAt: string) =>
          harness.engine.dispatch({
            type: "thread.turn.start",
            commandId: CommandId.make(`cmd-${id}`),
            threadId,
            message: {
              messageId: asMessageId(`user-message-${id}`),
              role: "user",
              text,
              attachments: [],
            },
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            runtimeMode: "approval-required",
            createdAt,
          });

        yield* dispatchTurn("before-blocked-compact", "hello", now);
        yield* Deferred.await(firstSent);
        yield* harness.engine.dispatch({
          type: "thread.session.set",
          commandId: CommandId.make("cmd-session-ready-before-blocked-compact"),
          threadId,
          session: {
            threadId,
            status: "ready",
            providerName: "codex",
            providerInstanceId: ProviderInstanceId.make("codex"),
            runtimeMode: "approval-required",
            activeTurnId: null,
            lastError: null,
            updatedAt: now,
          },
          createdAt: now,
        });

        blockReadyDispatch = true;
        yield* dispatchTurn("blocked-compact", "/compact", "2026-01-01T00:00:01.000Z");
        yield* Deferred.await(readyDispatchStarted);

        yield* harness.engine.dispatch({
          type: "thread.interaction-mode.set",
          commandId: CommandId.make("cmd-queued-mode-plan"),
          threadId,
          interactionMode: "plan",
          createdAt: now,
        });
        yield* dispatchTurn("during-compact-recovery", "first queued", "2026-01-01T00:00:02.000Z");
        yield* harness.engine.dispatch({
          type: "thread.interaction-mode.set",
          commandId: CommandId.make("cmd-queued-mode-default"),
          threadId,
          interactionMode: "default",
          createdAt: now,
        });
        yield* dispatchTurn(
          "during-compact-recovery-2",
          "second queued",
          "2026-01-01T00:00:03.000Z",
        );
        yield* Effect.promise(() => harness.drain());
        expect(harness.sendTurn).toHaveBeenCalledTimes(1);
        const beforeRestore = (yield* Effect.promise(() => harness.readModel())).threads.find(
          (entry) => entry.id === threadId,
        );
        expect(
          beforeRestore?.activities.filter(
            (activity) => activity.kind === "provider.turn.start.failed",
          ),
        ).toEqual([]);
        expect(yield* Effect.promise(() => harness.readPendingTurnStarts())).toEqual([
          { threadId: "thread-1" },
        ]);

        yield* Deferred.succeed(releaseReadyDispatch, undefined);
        if (scenario === "stop after send") {
          yield* Deferred.await(queuedSendStarted);
          yield* harness.engine.dispatch({
            type: "thread.session.stop",
            commandId: CommandId.make("cmd-stop-after-queued-send"),
            threadId,
            createdAt: "2026-01-01T00:00:04.000Z",
          });
          yield* Effect.promise(() => harness.drain());
          const stoppedThread = (yield* Effect.promise(() => harness.readModel())).threads.find(
            (entry) => entry.id === threadId,
          );
          expect(stoppedThread?.session?.status).toBe("stopped");
          expect(
            stoppedThread?.activities.filter(
              (activity) => activity.summary === "Queued message was not sent",
            ),
          ).toEqual([
            expect.objectContaining({
              payload: {
                requestId: "user-message-during-compact-recovery-2",
                detail: expect.any(String),
              },
            }),
          ]);
          expect(harness.sendTurn).toHaveBeenCalledTimes(2);
          yield* Deferred.succeed(releaseQueuedSend, undefined);
          return;
        }
        if (stopBeforeResume) {
          yield* Deferred.await(resumeStarted);
          yield* dispatchTurn("compact-during-resume", "/compact", "2026-01-01T00:00:04.000Z");
          yield* Effect.promise(() => harness.drain());
          expect(harness.compactThread).toHaveBeenCalledTimes(1);
          yield* harness.engine.dispatch({
            type: "thread.session.stop",
            commandId: CommandId.make("cmd-stop-before-queued-resume"),
            threadId,
            createdAt: "2026-01-01T00:00:04.000Z",
          });
          yield* Effect.promise(() => harness.drain());
          yield* Deferred.succeed(releaseResume, undefined);
          yield* Deferred.await(resumeDispatched);
          yield* Effect.promise(() => harness.drain());
          expect(harness.sendTurn).toHaveBeenCalledTimes(1);
          const stoppedThread = (yield* Effect.promise(() => harness.readModel())).threads.find(
            (entry) => entry.id === threadId,
          );
          expect(stoppedThread?.session?.status).toBe("stopped");
          expect(yield* Effect.promise(() => harness.readPendingTurnStarts())).toEqual([]);
          expect(
            stoppedThread?.activities.filter(
              (activity) => activity.summary === "Queued message was not sent",
            ),
          ).toHaveLength(2);
          return;
        }
        yield* Deferred.await(queuedSent);
        expect(harness.sendTurn.mock.calls.slice(1).map(([request]) => request)).toEqual([
          expect.objectContaining({ input: "first queued", interactionMode: "plan" }),
          expect.objectContaining({ input: "second queued", interactionMode: "default" }),
        ]);
        const afterRestore = (yield* Effect.promise(() => harness.readModel())).threads.find(
          (entry) => entry.id === threadId,
        );
        expect(
          afterRestore?.messages.filter((message) => message.text === "first queued"),
        ).toHaveLength(1);
        expect(
          afterRestore?.messages.filter((message) => message.text === "second queued"),
        ).toHaveLength(1);
      }),
  );

  effectIt.effect("does not overwrite concurrent session state after compaction failure", () =>
    Effect.gen(function* () {
      const releaseCompaction = yield* Deferred.make<void>();
      const releaseRunningCompaction = yield* Deferred.make<void>();
      const releaseFailedStop = yield* Deferred.make<void>();
      let compactionCount = 0;
      const harness = yield* Effect.promise(() =>
        createHarness({
          compactThreadEffect: () =>
            Deferred.await(
              compactionCount++ === 0 ? releaseCompaction : releaseRunningCompaction,
            ).pipe(Effect.andThen(Effect.die("Compaction stopped"))),
          stopSessionEffect: () =>
            Deferred.await(releaseFailedStop).pipe(
              Effect.andThen(
                Effect.fail(
                  new ProviderAdapterRequestError({
                    provider: "codex",
                    method: "session.stop",
                    detail: "provider stop failed",
                  }),
                ),
              ),
            ),
        }),
      );
      const threadId = ThreadId.make("thread-1");
      const now = "2026-01-01T00:00:00.000Z";
      const dispatchCompact = (suffix: string, createdAt: string) =>
        harness.engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make(`cmd-compact-${suffix}`),
          threadId,
          message: {
            messageId: asMessageId(`user-message-compact-${suffix}`),
            role: "user",
            text: "/compact",
            attachments: [],
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          createdAt,
        });

      yield* harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-message-before-compact"),
        threadId,
        message: {
          messageId: asMessageId("user-message-before-compact"),
          role: "user",
          text: "hello",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      });
      yield* Effect.promise(() => waitFor(() => harness.sendTurn.mock.calls.length === 1));
      yield* harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-ready-before-compact"),
        threadId,
        session: {
          threadId,
          status: "ready",
          providerName: "codex",
          providerInstanceId: ProviderInstanceId.make("codex"),
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      });
      yield* dispatchCompact("before-stop", now);
      yield* Effect.promise(() => waitFor(() => harness.compactThread.mock.calls.length === 1));
      const compactingThread = (yield* Effect.promise(() => harness.readModel())).threads.find(
        (entry) => entry.id === threadId,
      );
      expect(compactingThread?.session?.status).toBe("starting");
      yield* harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-queued-before-stop"),
        threadId,
        message: {
          messageId: asMessageId("user-message-queued-before-stop"),
          role: "user",
          text: "do not restart after stopping",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      });
      yield* Effect.promise(() => harness.drain());
      yield* harness.engine.dispatch({
        type: "thread.session.stop",
        commandId: CommandId.make("cmd-stop-during-compact"),
        threadId,
        createdAt: "2026-01-01T00:00:01.000Z",
      });
      yield* Effect.promise(() => waitFor(() => harness.stopSession.mock.calls.length === 1));
      yield* Deferred.succeed(releaseCompaction, undefined);
      yield* Effect.promise(() =>
        waitFor(async () => {
          const compactingThread = (await harness.readModel()).threads.find(
            (entry) => entry.id === threadId,
          );
          return (
            compactingThread?.activities.some(
              (activity) => activity.summary === "Context compaction failed",
            ) === true
          );
        }),
      );
      const stoppingThread = (yield* Effect.promise(() => harness.readModel())).threads.find(
        (entry) => entry.id === threadId,
      );
      expect(stoppingThread?.session?.status).toBe("starting");
      yield* Deferred.succeed(releaseFailedStop, undefined);
      yield* Effect.promise(() => harness.drain());

      const recoveredThread = (yield* Effect.promise(() => harness.readModel())).threads.find(
        (entry) => entry.id === threadId,
      );
      expect(recoveredThread?.session?.status).toBe("ready");
      expect(harness.sendTurn).toHaveBeenCalledTimes(1);
      expect(
        recoveredThread?.activities.find(
          (activity) => activity.summary === "Queued message was not sent",
        ),
      ).toMatchObject({
        payload: { requestId: "user-message-queued-before-stop" },
      });
      expect(
        recoveredThread?.activities.find(
          (activity) => activity.kind === "provider.session.stop.failed",
        ),
      ).toMatchObject({
        summary: "Provider session stop failed",
        payload: { detail: "provider stop failed" },
      });

      yield* dispatchCompact("before-running", "2026-01-01T00:00:02.000Z");
      yield* Effect.promise(() => waitFor(() => harness.compactThread.mock.calls.length === 2));
      yield* harness.engine.dispatch({
        type: "thread.session.stop",
        commandId: CommandId.make("cmd-failed-stop-before-compaction-settles"),
        threadId,
        createdAt: "2026-01-01T00:00:02.500Z",
      });
      yield* Effect.promise(() =>
        waitFor(async () => {
          const thread = (await harness.readModel()).threads.find((entry) => entry.id === threadId);
          return (
            thread?.activities.filter(
              (activity) => activity.kind === "provider.session.stop.failed",
            ).length === 2
          );
        }),
      );
      const restartedThread = (yield* Effect.promise(() => harness.readModel())).threads.find(
        (entry) => entry.id === threadId,
      );
      expect(restartedThread?.session?.status).toBe("starting");
      const restartedSession = restartedThread?.session;
      if (!restartedSession) return yield* Effect.die("Compaction session missing");
      yield* harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-running-during-compact"),
        threadId,
        session: {
          ...restartedSession,
          status: "running",
          activeTurnId: asTurnId("compaction-turn"),
          updatedAt: "2026-01-01T00:00:03.000Z",
        },
        createdAt: "2026-01-01T00:00:03.000Z",
      });
      yield* Deferred.succeed(releaseRunningCompaction, undefined);
      yield* Effect.promise(() => harness.drain());
      const runningThread = (yield* Effect.promise(() => harness.readModel())).threads.find(
        (entry) => entry.id === threadId,
      );
      expect(runningThread?.session?.status).toBe("running");
    }),
  );
  effectIt.effect("projects starting before a slow provider session finishes", () =>
    Effect.gen(function* () {
      const releaseStart = yield* Deferred.make<void>();
      const harness = yield* Effect.promise(() =>
        createHarness({
          startSessionEffect: (session) => Deferred.await(releaseStart).pipe(Effect.as(session)),
        }),
      );
      const now = "2026-01-01T00:00:00.000Z";

      yield* harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-slow-provider"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-slow-provider"),
          role: "user",
          text: "start slowly",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      });

      yield* Effect.promise(() => waitFor(() => harness.startSession.mock.calls.length === 1));
      const duringStartup = yield* Effect.promise(() => harness.readModel());
      expect(
        duringStartup.threads.find((entry) => entry.id === ThreadId.make("thread-1"))?.session
          ?.status,
      ).toBe("starting");
      expect(harness.sendTurn).not.toHaveBeenCalled();

      yield* Deferred.succeed(releaseStart, undefined);
      yield* Effect.promise(() => waitFor(() => harness.sendTurn.mock.calls.length === 1));
    }),
  );

  effectIt.effect("shows the missing workspace message without a provider stack trace", () =>
    Effect.gen(function* () {
      const attempted = yield* Deferred.make<void>();
      const missingCwd = "/missing/project/worktree";
      const missingWorkspace = new ProviderWorkspaceMissingError({
        threadId: ThreadId.make("thread-1"),
        cwd: missingCwd,
      });
      const harness = yield* Effect.promise(() =>
        createHarness({
          startSessionEffect: () =>
            Deferred.succeed(attempted, undefined).pipe(
              Effect.andThen(Effect.fail(missingWorkspace)),
            ),
        }),
      );

      yield* harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-missing-workspace"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-missing-workspace"),
          role: "user",
          text: "continue",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      yield* Deferred.await(attempted);
      yield* Effect.promise(() => harness.drain());

      const thread = (yield* Effect.promise(() => harness.readModel())).threads.find(
        (entry) => entry.id === ThreadId.make("thread-1"),
      );
      expect(thread?.session).toMatchObject({
        status: "error",
        activeTurnId: null,
        lastError: missingWorkspace.message,
      });
      const failure = thread?.activities.find(
        (activity) => activity.kind === "provider.turn.start.failed",
      );
      expect(failure?.payload).toMatchObject({ detail: missingWorkspace.message });
      expect(harness.runtimeSessions).toEqual([]);
      expect(harness.sendTurn).not.toHaveBeenCalled();
      expect(yield* Effect.promise(() => harness.readPendingTurnStarts())).toEqual([]);
    }),
  );

  effectIt.effect("settles a failed provider startup and allows a clean retry", () =>
    Effect.gen(function* () {
      let failStartup = true;
      const harness = yield* Effect.promise(() =>
        createHarness({
          startSessionEffect: (session) =>
            failStartup
              ? Effect.fail(
                  new ProviderAdapterRequestError({
                    provider: "codex",
                    method: "thread.start",
                    detail: "deterministic startup failure",
                  }),
                )
              : Effect.succeed(session),
        }),
      );
      const now = "2026-01-01T00:00:00.000Z";

      yield* harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-provider-failure"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-provider-failure"),
          role: "user",
          text: "fail once",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      });

      yield* Effect.promise(() =>
        waitFor(async () => {
          const readModel = await harness.readModel();
          return (
            readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"))?.session
              ?.status === "error"
          );
        }),
      );
      let readModel = yield* Effect.promise(() => harness.readModel());
      let thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
      expect(thread?.session?.lastError).toContain("deterministic startup failure");
      expect(harness.sendTurn).not.toHaveBeenCalled();

      failStartup = false;
      yield* harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-provider-retry"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-provider-retry"),
          role: "user",
          text: "retry",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: "2026-01-01T00:00:01.000Z",
      });

      yield* Effect.promise(() => waitFor(() => harness.sendTurn.mock.calls.length === 1));
      readModel = yield* Effect.promise(() => harness.readModel());
      thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
      expect(thread?.session?.status).toBe("starting");
      expect(thread?.session?.lastError).toBeNull();
    }),
  );

  effectIt.effect.each(["before completion", "after completion", "before startup"] as const)(
    "refines a vague title once when initial generation finishes %s",
    (timing) =>
      Effect.gen(function* () {
        const harness = yield* Effect.promise(() =>
          createHarness({ deferReactorStart: timing === "before startup" }),
        );
        const threadId = ThreadId.make("thread-1");
        const turnId = TurnId.make("title-first-turn");
        const createdAt = "2026-01-01T00:00:01.000Z";
        harness.generateThreadTitle.mockReturnValue(
          Effect.succeed({ title: "Fix QR pairing expiry" }),
        );
        yield* harness.engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make("title-turn"),
          threadId,
          message: {
            messageId: MessageId.make("title-user"),
            role: "user",
            text: "Fix this",
            attachments: [],
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          createdAt,
        });
        yield* Effect.promise(() => harness.drain());
        const generate = harness.engine.dispatch({
          type: "thread.title.generate.complete",
          commandId: CommandId.make("initial-title"),
          threadId,
          expectedTitle: "Thread",
          expectedVersion: null,
          title: "Investigate issue",
          needsRefinement: true,
        });
        if (timing !== "after completion") yield* generate;
        yield* harness.engine.dispatch({
          type: "thread.session.set",
          commandId: CommandId.make("title-running"),
          threadId,
          createdAt,
          session: {
            threadId,
            status: "running",
            providerName: "codex",
            runtimeMode: "approval-required",
            activeTurnId: turnId,
            lastError: null,
            updatedAt: createdAt,
          },
        });
        yield* harness.engine.dispatch({
          type: "thread.message.assistant.delta",
          commandId: CommandId.make("title-answer"),
          threadId,
          messageId: MessageId.make("title-assistant"),
          turnId,
          delta: "The QR pairing token expires before the phone redeems it.",
          createdAt,
        });
        const ready = (commandId: string) =>
          harness.engine.dispatch({
            type: "thread.session.set",
            commandId: CommandId.make(commandId),
            threadId,
            createdAt,
            session: {
              threadId,
              status: "ready",
              providerName: "codex",
              runtimeMode: "approval-required",
              activeTurnId: null,
              lastError: null,
              updatedAt: createdAt,
            },
          });
        yield* ready("title-ready");
        if (timing === "after completion") yield* generate;
        if (timing === "before startup") {
          yield* Effect.promise(harness.startReactor);
        }
        yield* Effect.promise(() => harness.drain());
        if (timing === "before startup") {
          expect(harness.generateThreadTitle).toHaveBeenCalledTimes(1);
        }
        yield* ready("title-ready-again");
        yield* Effect.promise(() => harness.drain());
        expect(harness.generateThreadTitle).toHaveBeenCalledTimes(1);
        expect(harness.generateThreadTitle.mock.calls[0]?.[0].message).toContain(
          "QR pairing token",
        );
        const thread = (yield* Effect.promise(() => harness.readModel())).threads[0];
        expect(thread?.title).toBe("Fix QR pairing expiry");
        expect(thread?.titleState?.needsRefinement).toBe(false);
      }),
  );

  effectIt.effect("does not replace a manual title matching the first message seed", () =>
    Effect.gen(function* () {
      const harness = yield* Effect.promise(() => createHarness());
      const threadId = ThreadId.make("thread-1");
      yield* harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("manual-title"),
        threadId,
        title: "Thread",
      });
      yield* harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("manual-title-turn"),
        threadId,
        titleSeed: "Thread",
        message: {
          messageId: MessageId.make("manual-title-user"),
          role: "user",
          text: "Fix this",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: "2026-01-01T00:00:01.000Z",
      });
      yield* Effect.promise(() => harness.drain());
      expect(harness.generateThreadTitle).not.toHaveBeenCalled();
    }),
  );

  it("retries thread title generation after a transient failure", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const seededTitle = "Please investigate reconnect failures after restar...";
    const harness = await createHarness({ initialTitle: seededTitle });
    let attempts = 0;
    harness.generateThreadTitle.mockReturnValue(
      Effect.suspend(() => {
        attempts += 1;
        return attempts === 1
          ? Effect.fail(
              new TextGenerationError({
                operation: "generateThreadTitle",
                detail: "Claude CLI request timed out.",
              }),
            )
          : Effect.succeed({ title: "Generated title" });
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-title"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-title"),
          role: "user",
          text: "Please investigate reconnect failures after restarting the session.",
          attachments: [],
        },
        titleSeed: seededTitle,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.generateThreadTitle.mock.calls.length === 1);
    expect(harness.generateThreadTitle.mock.calls[0]?.[0]).toMatchObject({
      message: "Please investigate reconnect failures after restarting the session.",
    });

    await waitFor(async () => {
      const readModel = await harness.readModel();
      return (
        readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"))?.title ===
        "Generated title"
      );
    });
    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.title).toBe("Generated title");
    expect(attempts).toBe(2);
  });

  it("regenerates a thread title from the current conversation", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";
    harness.generateThreadTitle.mockReturnValue(
      Effect.succeed({ title: "Resolve stale reconnect state" }),
    );

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-existing"),
        threadId: ThreadId.make("thread-1"),
        title: "Investigate reconnect regressions",
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-before-title-regeneration"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-before-title-regeneration"),
          role: "user",
          text: "Please investigate reconnect regressions after restarting the session.",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.message.assistant.delta",
        commandId: CommandId.make("cmd-assistant-before-title-regeneration"),
        threadId: ThreadId.make("thread-1"),
        messageId: asMessageId("assistant-message-before-title-regeneration"),
        delta: "The remaining issue is stale reconnect state.",
        createdAt: "2026-01-01T00:00:01.000Z",
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.message.assistant.complete",
        commandId: CommandId.make("cmd-assistant-complete-before-title-regeneration"),
        threadId: ThreadId.make("thread-1"),
        messageId: asMessageId("assistant-message-before-title-regeneration"),
        createdAt: "2026-01-01T00:00:02.000Z",
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-regenerate"),
        threadId: ThreadId.make("thread-1"),
        regenerateTitle: true,
      }),
    );

    await harness.drain();

    expect(harness.generateThreadTitle).toHaveBeenCalledTimes(1);
    expect(harness.generateThreadTitle.mock.calls[0]?.[0]).toMatchObject({
      cwd: "/tmp/provider-project",
      previousTitle: "Investigate reconnect regressions",
      message: [
        "USER:",
        "Please investigate reconnect regressions after restarting the session.",
        "",
        "ASSISTANT:",
        "The remaining issue is stale reconnect state.",
      ].join("\n"),
    });
    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.title).toBe("Resolve stale reconnect state");
    expect(thread?.titleRegeneration).toBeNull();
  });

  it("pins the first user message when regeneration context is truncated", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";
    const quoteText = "界".repeat(1_000);
    const citation = serializeAssistantCitation({
      ...assistantCitation,
      text: quoteText,
      end: quoteText.length,
    });
    const firstUserMessage = `Review subagent monitoring risks. ${citation} ${"Opening context. ".repeat(200)}`;
    const recentUserMessage = `LATEST FINDING: ${"implementation detail ".repeat(320)}`;
    harness.generateThreadTitle.mockReturnValue(
      Effect.succeed({ title: "Review subagent monitoring risks" }),
    );

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-existing-long"),
        threadId: ThreadId.make("thread-1"),
        title: "Generic PR review",
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-before-long-title-regeneration"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-before-long-title-regeneration"),
          role: "user",
          text: firstUserMessage,
          attachments: [
            {
              type: "image",
              id: "opening-context-image",
              name: "image.png",
              mimeType: "image/png",
              sizeBytes: 5,
            },
          ],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-middle-turn-before-long-title-regeneration"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("middle-message-before-long-title-regeneration"),
          role: "user",
          text: "Temporary handoff details.",
          attachments: [
            {
              type: "image",
              id: "middle-context-image",
              name: "image.png",
              mimeType: "image/png",
              sizeBytes: 5,
            },
          ],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: "2026-01-01T00:00:01.000Z",
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-recent-turn-before-long-title-regeneration"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("recent-message-before-long-title-regeneration"),
          role: "user",
          text: recentUserMessage,
          attachments: [
            {
              type: "image",
              id: "recent-context-image",
              name: "image.png",
              mimeType: "image/png",
              sizeBytes: 5,
            },
          ],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: "2026-01-01T00:00:02.000Z",
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-regenerate-long"),
        threadId: ThreadId.make("thread-1"),
        regenerateTitle: true,
      }),
    );

    await harness.drain();

    expect(harness.generateThreadTitle).toHaveBeenCalledTimes(1);
    const input = harness.generateThreadTitle.mock.calls[0]?.[0];
    if (!input) {
      throw new Error("Expected a title generation input");
    }
    const message = input.message;
    expect(message).toContain(
      `USER:\nReview subagent monitoring risks. ${quoteText.slice(0, 100)}`,
    );
    expect(message).not.toContain("t3-citation://");
    expect(message).toContain("[Content truncated]");
    expect(message).toContain("[Earlier content truncated]");
    expect(message).toContain("image.png");
    expect(message.length).toBeLessThanOrEqual(8_000);
    expect(input.attachments?.map((attachment) => attachment.id)).toEqual([
      "opening-context-image",
      "middle-context-image",
      "recent-context-image",
    ]);
    const readModel = await harness.readModel();
    expect(
      readModel.threads
        .find((entry) => entry.id === ThreadId.make("thread-1"))
        ?.messages.find(
          (entry) => entry.id === asMessageId("user-message-before-long-title-regeneration"),
        )?.text,
    ).toBe(firstUserMessage);
  });

  it("clears title regeneration state left pending across reactor startup", async () => {
    const harness = await createHarness({
      titleRegenerationBeforeStart: "one",
    });

    expect(harness.generateThreadTitle).not.toHaveBeenCalled();
    expect(harness.titleRegenerationCompletionDispatchAttempts).toBe(1);
    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.title).toBe("Thread");
    expect(thread?.titleRegeneration).toBeNull();
  });

  it("continues clearing startup title regeneration state after one completion fails", async () => {
    const harness = await createHarness({
      titleRegenerationBeforeStart: "two",
      titleRegenerationCompletionDispatchFailures: 1,
    });

    expect(harness.generateThreadTitle).not.toHaveBeenCalled();
    expect(harness.titleRegenerationCompletionDispatchAttempts).toBe(2);
    const readModel = await harness.readModel();
    expect(
      readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"))?.titleRegeneration,
    ).not.toBeNull();
    expect(
      readModel.threads.find((entry) => entry.id === ThreadId.make("thread-2"))?.titleRegeneration,
    ).toBeNull();
  });

  it("keeps the current title when regeneration returns the fallback", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";
    harness.generateThreadTitle.mockReturnValue(Effect.succeed({ title: "New thread" }));

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-before-fallback-regeneration"),
        threadId: ThreadId.make("thread-1"),
        title: "Keep meaningful title",
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-before-fallback-regeneration"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-before-fallback-regeneration"),
          role: "user",
          text: "Investigate the reconnect state.",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-fallback-regeneration"),
        threadId: ThreadId.make("thread-1"),
        regenerateTitle: true,
      }),
    );

    await harness.drain();

    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.title).toBe("Keep meaningful title");
    expect(thread?.titleRegeneration).toBeNull();
  });

  it("clears title regeneration state when generation fails", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-before-failed-regeneration"),
        threadId: ThreadId.make("thread-1"),
        title: "Keep title after failure",
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-before-failed-regeneration"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-before-failed-regeneration"),
          role: "user",
          text: "Investigate the reconnect state.",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-failed-regeneration"),
        threadId: ThreadId.make("thread-1"),
        regenerateTitle: true,
      }),
    );

    await harness.drain();

    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.title).toBe("Keep title after failure");
    expect(thread?.titleRegeneration).toBeNull();
  });

  it("retries a failed completion and continues regenerating", async () => {
    const harness = await createHarness({
      titleRegenerationCompletionDispatchFailures: 1,
    });
    const now = "2026-01-01T00:00:00.000Z";
    harness.generateThreadTitle
      .mockReturnValueOnce(Effect.succeed({ title: "Title lost to completion failure" }))
      .mockReturnValueOnce(Effect.succeed({ title: "Recovered regeneration worker" }));

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-before-completion-failure"),
        threadId: ThreadId.make("thread-1"),
        title: "Existing title",
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-before-completion-failure"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-before-completion-failure"),
          role: "user",
          text: "Investigate the reconnect state.",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-regeneration-completion-failure"),
        threadId: ThreadId.make("thread-1"),
        regenerateTitle: true,
      }),
    );
    await harness.drain();

    let readModel = await harness.readModel();
    let thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.title).toBe("Title lost to completion failure");
    expect(thread?.titleRegeneration).toBeNull();

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-regeneration-after-completion-failure"),
        threadId: ThreadId.make("thread-1"),
        regenerateTitle: true,
      }),
    );
    await harness.drain();

    expect(harness.generateThreadTitle).toHaveBeenCalledTimes(2);
    expect(harness.titleRegenerationCompletionDispatchAttempts).toBe(3);
    readModel = await harness.readModel();
    thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.title).toBe("Recovered regeneration worker");
    expect(thread?.titleRegeneration).toBeNull();
  });

  it("pins the first user context and attachment before the retained tail", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";
    const firstUserContext = "USER:\nOld visual issue\n[Attachments: old-issue.png]";

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-before-truncated-regeneration"),
        threadId: ThreadId.make("thread-1"),
        title: "Existing title",
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-before-truncated-regeneration"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-before-truncated-regeneration"),
          role: "user",
          text: "Old visual issue",
          attachments: [
            {
              type: "image",
              id: "old-title-context-image",
              name: "old-issue.png",
              mimeType: "image/png",
              sizeBytes: 5,
            },
          ],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.message.assistant.delta",
        commandId: CommandId.make("cmd-assistant-truncated-regeneration-context"),
        threadId: ThreadId.make("thread-1"),
        messageId: asMessageId("assistant-truncated-regeneration-context"),
        delta: `content before retained tail${"x".repeat(8_100)}`,
        createdAt: "2026-01-01T00:00:01.000Z",
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.message.assistant.complete",
        commandId: CommandId.make("cmd-assistant-truncated-regeneration-context-complete"),
        threadId: ThreadId.make("thread-1"),
        messageId: asMessageId("assistant-truncated-regeneration-context"),
        createdAt: "2026-01-01T00:00:02.000Z",
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-regenerate-truncated-context"),
        threadId: ThreadId.make("thread-1"),
        regenerateTitle: true,
      }),
    );

    await harness.drain();

    const context = harness.generateThreadTitle.mock.calls[0]?.[0].message;
    expect(context).toContain(firstUserContext);
    expect(context).toContain("ASSISTANT:\ncontent before retained tail");
    expect(context?.length).toBeLessThanOrEqual(8_000);
    expect(harness.generateThreadTitle.mock.calls[0]?.[0].attachments).toEqual([
      expect.objectContaining({
        id: "old-title-context-image",
        name: "old-issue.png",
      }),
    ]);
  });

  it("does not overwrite a manual rename while title regeneration is running", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";
    const generatedTitle = await harness.runEffect(
      Deferred.make<{ readonly title: string }, never>(),
    );
    harness.generateThreadTitle.mockReturnValue(Deferred.await(generatedTitle));

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-before-regeneration-race"),
        threadId: ThreadId.make("thread-1"),
        title: "Existing thread title",
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-before-regeneration-race"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-before-regeneration-race"),
          role: "user",
          text: "Investigate the reconnect state.",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-regeneration-race"),
        threadId: ThreadId.make("thread-1"),
        regenerateTitle: true,
      }),
    );
    await waitFor(() => harness.generateThreadTitle.mock.calls.length === 1);
    const pendingReadModel = await harness.readModel();
    expect(
      pendingReadModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"))
        ?.titleRegeneration?.requestId,
    ).toBe(CommandId.make("cmd-thread-title-regeneration-race"));

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-manual-rename-during-regeneration"),
        threadId: ThreadId.make("thread-1"),
        title: "Keep manual rename",
      }),
    );
    await harness.runEffect(
      Deferred.succeed(generatedTitle, { title: "Generated title should not win" }),
    );
    await harness.drain();

    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.title).toBe("Keep manual rename");
    expect(thread?.titleRegeneration).toBeNull();
  });

  it("does not overwrite a manual rename while title regeneration is queued", async () => {
    let releaseStart = () => {};
    const startGate = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    const harness = await createHarness({
      startSessionEffect: (session) => Effect.promise(() => startGate).pipe(Effect.as(session)),
    });
    const now = "2026-01-01T00:00:00.000Z";
    harness.generateThreadTitle.mockReturnValue(
      Effect.succeed({ title: "Generated title should not win" }),
    );

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-before-queued-regeneration"),
        threadId: ThreadId.make("thread-1"),
        title: "Existing thread title",
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-before-queued-regeneration"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-before-queued-regeneration"),
          role: "user",
          text: "Investigate the reconnect state.",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );
    await waitFor(() => harness.startSession.mock.calls.length === 1);

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-queued-regeneration"),
        threadId: ThreadId.make("thread-1"),
        regenerateTitle: true,
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-manual-rename-before-regeneration-starts"),
        threadId: ThreadId.make("thread-1"),
        title: "Keep queued manual rename",
      }),
    );
    releaseStart();
    await harness.drain();

    expect(harness.generateThreadTitle).not.toHaveBeenCalled();
    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.title).toBe("Keep queued manual rename");
  });

  it("skips superseded title regeneration before generation starts", async () => {
    let releaseStart = () => {};
    const startGate = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    const harness = await createHarness({
      startSessionEffect: (session) => Effect.promise(() => startGate).pipe(Effect.as(session)),
    });
    const now = "2026-01-01T00:00:00.000Z";
    harness.generateThreadTitle.mockReturnValue(
      Effect.succeed({ title: "Latest regenerated title" }),
    );

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-before-superseded-regeneration"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-before-superseded-regeneration"),
          role: "user",
          text: "Investigate the reconnect state.",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );
    await waitFor(() => harness.startSession.mock.calls.length === 1);

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-superseded-regeneration"),
        threadId: ThreadId.make("thread-1"),
        regenerateTitle: true,
      }),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-latest-regeneration"),
        threadId: ThreadId.make("thread-1"),
        regenerateTitle: true,
      }),
    );
    releaseStart();
    await harness.drain();

    expect(harness.generateThreadTitle).toHaveBeenCalledTimes(1);
    expect(harness.titleRegenerationCompletionDispatchAttempts).toBe(1);
    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.title).toBe("Latest regenerated title");
    expect(thread?.titleRegeneration).toBeNull();
  });

  it("does not overwrite an existing custom thread title on the first turn", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";
    const seededTitle = "Please investigate reconnect failures after restar...";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-title-custom"),
        threadId: ThreadId.make("thread-1"),
        title: "Keep this custom title",
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-title-preserve"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-title-preserve"),
          role: "user",
          text: "Please investigate reconnect failures after restarting the session.",
          attachments: [],
        },
        titleSeed: seededTitle,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.generateThreadTitle).not.toHaveBeenCalled();

    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.title).toBe("Keep this custom title");
  });

  it("matches the client-seeded title even when the outgoing prompt is reformatted", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const seededTitle = "Fix reconnect spinner on resume";
    const harness = await createHarness({ initialTitle: seededTitle });
    const prompt = `[effort:high]\\n\\nFix reconnect spinner on resume ${serializeAssistantCitation(assistantCitation)}`;
    harness.generateThreadTitle.mockReturnValue(
      Effect.succeed({
        title: "Reconnect spinner resume bug",
      }),
    );

    const titleUpdated = await harness.runEffect(
      harness.engine.streamDomainEvents.pipe(
        Stream.filter(
          (event) =>
            event.type === "thread.meta-updated" &&
            event.payload.title === "Reconnect spinner resume bug",
        ),
        Stream.take(1),
        Stream.toPull,
        Scope.provide(scope!),
      ),
    );
    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-title-formatted"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-title-formatted"),
          role: "user",
          text: prompt,
          attachments: [],
        },
        titleSeed: seededTitle,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await harness.runEffect(titleUpdated);
    await harness.drain();

    expect(harness.generateThreadTitle.mock.calls[0]?.[0].message).toBe(
      `[effort:high]\\n\\nFix reconnect spinner on resume ${assistantQuoteText}`,
    );
    expect(harness.generateThreadTitle.mock.calls[0]?.[0].message).not.toContain("t3-citation://");
    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.title).toBe("Reconnect spinner resume bug");
    expect(
      thread?.messages.find((entry) => entry.id === asMessageId("user-message-title-formatted"))
        ?.text,
    ).toBe(prompt);
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({ input: prompt });
  });

  it("generates a worktree branch name for the first turn", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";
    const prompt = `Add a safer reconnect backoff. ${serializeAssistantCitation(assistantCitation)}`;
    const statusRefreshed = await harness.runEffect(Deferred.make<void>());
    const refreshStatus = harness.refreshStatus.getMockImplementation()!;
    harness.refreshStatus.mockImplementation((cwd) =>
      refreshStatus(cwd).pipe(Effect.tap(() => Deferred.succeed(statusRefreshed, undefined))),
    );

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-branch"),
        threadId: ThreadId.make("thread-1"),
        branch: "t3code/1234abcd",
        worktreePath: "/tmp/provider-project-worktree",
      }),
    );

    harness.generateBranchName.mockImplementation((input: unknown) =>
      Effect.succeed({
        branch:
          typeof input === "object" &&
          input !== null &&
          "modelSelection" in input &&
          typeof input.modelSelection === "object" &&
          input.modelSelection !== null &&
          "model" in input.modelSelection &&
          typeof input.modelSelection.model === "string"
            ? `feature/${input.modelSelection.model}`
            : "feature/generated",
      }),
    );

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-branch-model"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-branch-model"),
          role: "user",
          text: prompt,
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await harness.runEffect(Deferred.await(statusRefreshed));
    await harness.drain();
    expect(harness.generateBranchName.mock.calls[0]?.[0].message).toBe(
      `Add a safer reconnect backoff. ${assistantQuoteText}`,
    );
    expect(harness.generateBranchName.mock.calls[0]?.[0].message).not.toContain("t3-citation://");
    expect(harness.refreshStatus.mock.calls[0]?.[0]).toBe("/tmp/provider-project-worktree");
    const readModel = await harness.readModel();
    expect(
      readModel.threads
        .find((entry) => entry.id === ThreadId.make("thread-1"))
        ?.messages.find((entry) => entry.id === asMessageId("user-message-branch-model"))?.text,
    ).toBe(prompt);
  });

  it("recreates a missing worktree from the thread branch before starting a turn", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";
    const worktreePath = NodePath.join(harness.stateDir, "missing-worktree");

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-missing-worktree"),
        threadId: ThreadId.make("thread-1"),
        branch: "feature/restore",
        worktreePath,
      }),
    );

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-missing-worktree"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-missing-worktree"),
          role: "user",
          text: "continue",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 1);
    expect(harness.pruneWorktrees).toHaveBeenCalledWith({ cwd: "/tmp/provider-project" });
    expect(harness.createWorktree).toHaveBeenCalledWith({
      cwd: "/tmp/provider-project",
      refName: "feature/restore",
      path: worktreePath,
    });
    expect(harness.createWorktree.mock.invocationCallOrder[0]).toBeLessThan(
      harness.startSession.mock.invocationCallOrder[0]!,
    );
  });

  it("forwards codex model options through session start and turn send", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-fast"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-fast"),
          role: "user",
          text: "hello fast mode",
          attachments: [],
        },
        modelSelection: createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.3-codex", [
          { id: "reasoningEffort", value: "high" },
          { id: "fastMode", value: true },
        ]),
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 1);
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
      modelSelection: createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.3-codex", [
        { id: "reasoningEffort", value: "high" },
        { id: "fastMode", value: true },
      ]),
    });
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      threadId: ThreadId.make("thread-1"),
      modelSelection: createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.3-codex", [
        { id: "reasoningEffort", value: "high" },
        { id: "fastMode", value: true },
      ]),
    });
  });

  it("forwards claude effort options through session start and turn send", async () => {
    const harness = await createHarness({
      threadModelSelection: {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "claude-sonnet-4-6",
      },
    });
    const now = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-claude-effort"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-claude-effort"),
          role: "user",
          text: "hello with effort",
          attachments: [],
        },
        modelSelection: createModelSelection(
          ProviderInstanceId.make("claudeAgent"),
          "claude-sonnet-4-6",
          [{ id: "effort", value: "max" }],
        ),
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 1);
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
      modelSelection: createModelSelection(
        ProviderInstanceId.make("claudeAgent"),
        "claude-sonnet-4-6",
        [{ id: "effort", value: "max" }],
      ),
    });
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      threadId: ThreadId.make("thread-1"),
      modelSelection: createModelSelection(
        ProviderInstanceId.make("claudeAgent"),
        "claude-sonnet-4-6",
        [{ id: "effort", value: "max" }],
      ),
    });
  });

  it("forwards claude fast mode options through session start and turn send", async () => {
    const harness = await createHarness({
      threadModelSelection: {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "claude-opus-4-6",
      },
    });
    const now = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-claude-fast-mode"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-claude-fast-mode"),
          role: "user",
          text: "hello with fast mode",
          attachments: [],
        },
        modelSelection: createModelSelection(
          ProviderInstanceId.make("claudeAgent"),
          "claude-opus-4-6",
          [{ id: "fastMode", value: true }],
        ),
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 1);
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
      modelSelection: createModelSelection(
        ProviderInstanceId.make("claudeAgent"),
        "claude-opus-4-6",
        [{ id: "fastMode", value: true }],
      ),
    });
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      threadId: ThreadId.make("thread-1"),
      modelSelection: createModelSelection(
        ProviderInstanceId.make("claudeAgent"),
        "claude-opus-4-6",
        [{ id: "fastMode", value: true }],
      ),
    });
  });

  it("forwards plan interaction mode to the provider turn request", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.interaction-mode.set",
        commandId: CommandId.make("cmd-interaction-mode-set-plan"),
        threadId: ThreadId.make("thread-1"),
        interactionMode: "plan",
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-plan"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-plan"),
          role: "user",
          text: "plan this change",
          attachments: [],
        },
        interactionMode: "plan",
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      threadId: ThreadId.make("thread-1"),
      interactionMode: "plan",
    });
  });

  it("preserves the active session model when in-session model switching is unsupported", async () => {
    const harness = await createHarness({ sessionModelSwitch: "unsupported" });
    const now = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-unsupported-1"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-unsupported-1"),
          role: "user",
          text: "first",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-unsupported-2"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-unsupported-2"),
          role: "user",
          text: "second",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 2);

    expect(harness.sendTurn.mock.calls[1]?.[0]).toMatchObject({
      threadId: ThreadId.make("thread-1"),
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-codex",
      },
    });
  });

  effectIt.effect(
    "rejects changing models after start when the provider requires a new thread",
    () =>
      Effect.gen(function* () {
        const harness = yield* Effect.promise(() =>
          createHarness({ requiresNewThreadForModelChange: true }),
        );
        const now = "2026-01-01T00:00:00.000Z";

        yield* harness.engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make("cmd-turn-start-restricted-1"),
          threadId: ThreadId.make("thread-1"),
          message: {
            messageId: asMessageId("user-message-restricted-1"),
            role: "user",
            text: "first",
            attachments: [],
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          createdAt: now,
        });

        yield* Effect.promise(() => waitFor(() => harness.sendTurn.mock.calls.length === 1));

        yield* harness.engine.dispatch({
          type: "thread.turn.start",
          commandId: CommandId.make("cmd-turn-start-restricted-2"),
          threadId: ThreadId.make("thread-1"),
          message: {
            messageId: asMessageId("user-message-restricted-2"),
            role: "user",
            text: "second",
            attachments: [],
          },
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5.1-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          createdAt: now,
        });

        yield* Effect.promise(() =>
          waitFor(async () => {
            const readModel = await harness.readModel();
            const thread = readModel.threads.find(
              (entry) => entry.id === ThreadId.make("thread-1"),
            );
            return (
              thread?.activities.some(
                (activity) => activity.kind === "provider.turn.start.failed",
              ) ?? false
            );
          }),
        );

        expect(harness.sendTurn).toHaveBeenCalledTimes(1);
        const readModel = yield* Effect.promise(() => harness.readModel());
        const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
        expect(
          thread?.activities.find((activity) => activity.kind === "provider.turn.start.failed"),
        ).toMatchObject({
          payload: {
            detail: expect.stringContaining(
              "cannot switch models after the conversation has started",
            ),
          },
        });
      }),
  );

  it("starts a first turn on the requested provider instance even when it differs from the thread model", async () => {
    const harness = await createHarness({
      threadModelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" },
    });
    const now = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-provider-first"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-provider-first"),
          role: "user",
          text: "hello claude",
          attachments: [],
        },
        modelSelection: {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "claude-opus-4-6",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);

    expect(harness.startSession).toHaveBeenCalledTimes(1);
    expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
      provider: ProviderDriverKind.make("claudeAgent"),
      providerInstanceId: ProviderInstanceId.make("claudeAgent"),
      modelSelection: {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "claude-opus-4-6",
      },
    });

    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.session?.providerName).toBe("claudeAgent");
    expect(thread?.session?.providerInstanceId).toBe(ProviderInstanceId.make("claudeAgent"));
    expect(
      thread?.activities.find((activity) => activity.kind === "provider.turn.start.failed"),
    ).toBeUndefined();
  });

  it("reuses the same provider session when runtime mode is unchanged", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-unchanged-1"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-unchanged-1"),
          role: "user",
          text: "first",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 1);
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-unchanged-2"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-unchanged-2"),
          role: "user",
          text: "second",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 2);
    expect(harness.startSession.mock.calls.length).toBe(1);
    expect(harness.stopSession.mock.calls.length).toBe(0);
  });

  it("restarts an existing Codex thread on a compatible requested instance", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-compatible-codex-1"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-compatible-codex-1"),
          role: "user",
          text: "first",
          attachments: [],
        },
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 1);

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-compatible-codex-2"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-compatible-codex-2"),
          role: "user",
          text: "second",
          attachments: [],
        },
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex_work"),
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 2);

    expect(harness.startSession).toHaveBeenCalledTimes(2);
    expect(harness.startSession.mock.calls[1]?.[1]).toMatchObject({
      provider: ProviderDriverKind.make("codex"),
      providerInstanceId: ProviderInstanceId.make("codex_work"),
      resumeCursor: { opaque: "resume-1" },
    });

    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.session?.providerInstanceId).toBe(ProviderInstanceId.make("codex_work"));
  });

  it("restarts the provider session when the thread workspace changes", async () => {
    const harness = await createHarness({
      threadModelSelection: {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "claude-sonnet-4-6",
      },
    });
    const now = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-workspace-1"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-workspace-1"),
          role: "user",
          text: "first in project root",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 1);
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);
    expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
      cwd: "/tmp/provider-project",
    });

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.meta.update",
        commandId: CommandId.make("cmd-thread-worktree-change"),
        threadId: ThreadId.make("thread-1"),
        worktreePath: "/tmp/provider-project-worktree",
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-workspace-2"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-workspace-2"),
          role: "user",
          text: "second in worktree",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 2);
    await waitFor(() => harness.sendTurn.mock.calls.length === 2);
    expect(harness.stopSession.mock.calls.length).toBe(0);
    expect(harness.startSession.mock.calls[1]?.[1]).toMatchObject({
      threadId: ThreadId.make("thread-1"),
      cwd: "/tmp/provider-project-worktree",
      resumeCursor: { opaque: "resume-1" },
      modelSelection: {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "claude-sonnet-4-6",
      },
      runtimeMode: "approval-required",
    });
  });

  it("restarts claude sessions when claude effort changes", async () => {
    const harness = await createHarness({
      threadModelSelection: {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "claude-sonnet-4-6",
      },
    });
    const now = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-claude-effort-1"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-claude-effort-1"),
          role: "user",
          text: "first claude turn",
          attachments: [],
        },
        modelSelection: createModelSelection(
          ProviderInstanceId.make("claudeAgent"),
          "claude-sonnet-4-6",
          [{ id: "effort", value: "medium" }],
        ),
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 1);
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-claude-effort-2"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-claude-effort-2"),
          role: "user",
          text: "second claude turn",
          attachments: [],
        },
        modelSelection: createModelSelection(
          ProviderInstanceId.make("claudeAgent"),
          "claude-sonnet-4-6",
          [{ id: "effort", value: "max" }],
        ),
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 2);
    await waitFor(() => harness.sendTurn.mock.calls.length === 2);
    expect(harness.startSession.mock.calls[1]?.[1]).toMatchObject({
      resumeCursor: { opaque: "resume-1" },
      modelSelection: createModelSelection(
        ProviderInstanceId.make("claudeAgent"),
        "claude-sonnet-4-6",
        [{ id: "effort", value: "max" }],
      ),
    });
  });

  it("restarts the provider session when runtime mode is updated on the thread", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.runtime-mode.set",
        commandId: CommandId.make("cmd-runtime-mode-set-initial-full-access"),
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "full-access",
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-runtime-mode-1"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-runtime-mode-1"),
          role: "user",
          text: "first",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "full-access",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 1);
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.runtime-mode.set",
        commandId: CommandId.make("cmd-runtime-mode-set-1"),
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(async () => {
      const readModel = await harness.readModel();
      const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
      return thread?.runtimeMode === "approval-required";
    });
    await waitFor(() => harness.startSession.mock.calls.length === 2);
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-runtime-mode-2"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-runtime-mode-2"),
          role: "user",
          text: "second",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "full-access",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.sendTurn.mock.calls.length === 2);

    expect(harness.stopSession.mock.calls.length).toBe(0);
    expect(harness.startSession.mock.calls[1]?.[1]).toMatchObject({
      threadId: ThreadId.make("thread-1"),
      resumeCursor: { opaque: "resume-1" },
      runtimeMode: "approval-required",
    });
    expect(harness.sendTurn.mock.calls[1]?.[0]).toMatchObject({
      threadId: ThreadId.make("thread-1"),
    });

    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.session?.threadId).toBe("thread-1");
    expect(thread?.session?.runtimeMode).toBe("approval-required");
  });

  it("does not inject derived model options when restarting claude on runtime mode changes", async () => {
    const harness = await createHarness({
      threadModelSelection: {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "claude-opus-4-6",
      },
    });
    const now = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set-runtime-mode-claude"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "ready",
          providerName: "claudeAgent",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.runtime-mode.set",
        commandId: CommandId.make("cmd-runtime-mode-set-claude-no-options"),
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 1);

    expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
      modelSelection: {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "claude-opus-4-6",
      },
      runtimeMode: "approval-required",
    });
  });

  it("does not stop the active session when restart fails before rebind", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.runtime-mode.set",
        commandId: CommandId.make("cmd-runtime-mode-set-initial-full-access-2"),
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "full-access",
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-restart-failure-1"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-restart-failure-1"),
          role: "user",
          text: "first",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "full-access",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 1);
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);

    harness.startSession.mockImplementationOnce(
      (_: unknown, __: unknown) => Effect.fail("simulated restart failure") as never,
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.runtime-mode.set",
        commandId: CommandId.make("cmd-runtime-mode-set-restart-failure"),
        threadId: ThreadId.make("thread-1"),
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(async () => {
      const readModel = await harness.readModel();
      const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
      return thread?.runtimeMode === "approval-required";
    });
    await waitFor(() => harness.startSession.mock.calls.length === 2);
    await harness.drain();

    expect(harness.stopSession.mock.calls.length).toBe(0);
    expect(harness.sendTurn.mock.calls.length).toBe(1);

    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.session?.threadId).toBe("thread-1");
    expect(thread?.session?.runtimeMode).toBe("full-access");
  });

  it("rejects provider changes after a thread is already bound to a session provider", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-provider-switch-1"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-provider-switch-1"),
          role: "user",
          text: "first",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 1);
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-provider-switch-2"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-provider-switch-2"),
          role: "user",
          text: "second",
          attachments: [],
        },
        modelSelection: {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "claude-opus-4-6",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(async () => {
      const readModel = await harness.readModel();
      const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
      return (
        thread?.activities.some((activity) => activity.kind === "provider.turn.start.failed") ??
        false
      );
    });

    expect(harness.startSession.mock.calls.length).toBe(1);
    expect(harness.sendTurn.mock.calls.length).toBe(1);
    expect(harness.stopSession.mock.calls.length).toBe(0);

    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread?.session?.threadId).toBe("thread-1");
    expect(thread?.session?.providerName).toBe("codex");
    expect(thread?.session?.runtimeMode).toBe("approval-required");
    expect(
      thread?.activities.find((activity) => activity.kind === "provider.turn.start.failed"),
    ).toMatchObject({
      payload: {
        detail: expect.stringContaining("cannot switch to 'claudeAgent'"),
      },
    });
  });

  it("rejects cross-driver provider changes after the existing thread session has stopped", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set-stopped-provider-switch"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "stopped",
          providerName: "codex",
          providerInstanceId: ProviderInstanceId.make("codex"),
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-stopped-provider-switch"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-stopped-provider-switch"),
          role: "user",
          text: "continue with claude",
          attachments: [],
        },
        modelSelection: {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "claude-opus-4-6",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(async () => {
      const readModel = await harness.readModel();
      const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
      return (
        thread?.activities.some((activity) => activity.kind === "provider.turn.start.failed") ??
        false
      );
    });

    expect(harness.startSession.mock.calls.length).toBe(0);
    expect(harness.sendTurn.mock.calls.length).toBe(0);
    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(
      thread?.activities.find((activity) => activity.kind === "provider.turn.start.failed"),
    ).toMatchObject({
      payload: {
        detail: expect.stringContaining("cannot switch to 'claudeAgent'"),
      },
    });
  });

  it("reacts to thread.turn.interrupt-requested by calling provider interrupt", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "running",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: asTurnId("turn-1"),
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.interrupt",
        commandId: CommandId.make("cmd-turn-interrupt"),
        threadId: ThreadId.make("thread-1"),
        turnId: asTurnId("turn-1"),
        createdAt: now,
      }),
    );

    await waitFor(() => harness.interruptTurn.mock.calls.length === 1);
    expect(harness.interruptTurn.mock.calls[0]?.[0]).toEqual({
      threadId: "thread-1",
    });
  });

  effectIt.effect(
    "stops a running session and records the failure when provider interrupt fails",
    () =>
      Effect.gen(function* () {
        const harness = yield* Effect.promise(() =>
          createHarness({
            interruptTurnEffect: () =>
              Effect.fail(
                new ProviderAdapterRequestError({
                  provider: "codex",
                  method: "thread.interrupt",
                  detail: "provider session disappeared",
                }),
              ),
            stopSessionEffect: () =>
              Effect.fail(
                new ProviderAdapterRequestError({
                  provider: "codex",
                  method: "session.stop",
                  detail: "provider process already exited",
                }),
              ),
          }),
        );
        const now = "2026-01-01T00:00:00.000Z";

        yield* harness.engine.dispatch({
          type: "thread.session.set",
          commandId: CommandId.make("cmd-session-set-interrupt-failure"),
          threadId: ThreadId.make("thread-1"),
          session: {
            threadId: ThreadId.make("thread-1"),
            status: "running",
            providerName: "codex",
            runtimeMode: "approval-required",
            activeTurnId: asTurnId("turn-1"),
            lastError: null,
            updatedAt: now,
          },
          createdAt: now,
        });

        yield* harness.engine.dispatch({
          type: "thread.turn.interrupt",
          commandId: CommandId.make("cmd-turn-interrupt-provider-failure"),
          threadId: ThreadId.make("thread-1"),
          turnId: asTurnId("turn-1"),
          createdAt: now,
        });

        yield* Effect.promise(() =>
          waitFor(async () => {
            const thread = (await harness.readModel()).threads.find(
              (entry) => entry.id === ThreadId.make("thread-1"),
            );
            return thread?.session?.status === "stopped";
          }),
        );

        const thread = (yield* Effect.promise(() => harness.readModel())).threads.find(
          (entry) => entry.id === ThreadId.make("thread-1"),
        );
        expect(thread?.session).toMatchObject({
          status: "stopped",
          activeTurnId: null,
          lastError: "provider session disappeared",
        });
        expect(
          thread?.activities.find((activity) => activity.kind === "provider.turn.interrupt.failed"),
        ).toMatchObject({
          summary: "Provider turn interrupt failed",
          payload: { detail: "provider session disappeared" },
        });
        expect(harness.stopSession).toHaveBeenCalledWith({ threadId: ThreadId.make("thread-1") });
      }),
  );

  effectIt.effect("stops a starting session without a bound turn when interrupt fails", () =>
    Effect.gen(function* () {
      const harness = yield* Effect.promise(() =>
        createHarness({
          interruptTurnEffect: () =>
            Effect.fail(
              new ProviderAdapterRequestError({
                provider: "codex",
                method: "thread.interrupt",
                detail: "provider session disappeared",
              }),
            ),
        }),
      );
      const now = "2026-01-01T00:00:00.000Z";

      yield* harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set-interrupt-starting"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "starting",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      });

      yield* harness.engine.dispatch({
        type: "thread.turn.interrupt",
        commandId: CommandId.make("cmd-turn-interrupt-starting-provider-failure"),
        threadId: ThreadId.make("thread-1"),
        createdAt: now,
      });

      yield* Effect.promise(() => harness.drain());

      const thread = (yield* Effect.promise(() => harness.readModel())).threads.find(
        (entry) => entry.id === ThreadId.make("thread-1"),
      );
      expect(thread?.session).toMatchObject({
        status: "stopped",
        activeTurnId: null,
        lastError: "provider session disappeared",
      });
      expect(harness.stopSession).toHaveBeenCalledWith({ threadId: ThreadId.make("thread-1") });
      expect(
        thread?.activities.find((activity) => activity.kind === "provider.turn.interrupt.failed"),
      ).toMatchObject({ payload: { detail: "provider session disappeared" } });
    }),
  );

  effectIt.effect("does not overwrite a session that became ready while an interrupt failed", () =>
    Effect.gen(function* () {
      const harness = yield* Effect.promise(() => createHarness());
      const now = "2026-01-01T00:00:00.000Z";
      const completedAt = "2026-01-01T00:00:01.000Z";

      yield* harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set-interrupt-race"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "running",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: asTurnId("turn-1"),
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      });

      harness.interruptTurn.mockImplementation(() =>
        harness.engine
          .dispatch({
            type: "thread.session.set",
            commandId: CommandId.make("cmd-session-set-natural-completion"),
            threadId: ThreadId.make("thread-1"),
            session: {
              threadId: ThreadId.make("thread-1"),
              status: "ready",
              providerName: "codex",
              runtimeMode: "approval-required",
              activeTurnId: null,
              lastError: null,
              updatedAt: completedAt,
            },
            createdAt: completedAt,
          })
          .pipe(
            Effect.catchCause((cause) => Effect.die(cause)),
            Effect.andThen(
              Effect.fail(
                new ProviderAdapterRequestError({
                  provider: "codex",
                  method: "thread.interrupt",
                  detail: "provider session disappeared",
                }),
              ),
            ),
          ),
      );

      yield* harness.engine.dispatch({
        type: "thread.turn.interrupt",
        commandId: CommandId.make("cmd-turn-interrupt-race"),
        threadId: ThreadId.make("thread-1"),
        turnId: asTurnId("turn-1"),
        createdAt: now,
      });

      yield* Effect.promise(() => harness.drain());

      const thread = (yield* Effect.promise(() => harness.readModel())).threads.find(
        (entry) => entry.id === ThreadId.make("thread-1"),
      );
      expect(thread?.session).toMatchObject({
        status: "ready",
        activeTurnId: null,
        lastError: null,
        updatedAt: completedAt,
      });
      expect(harness.stopSession).not.toHaveBeenCalled();
      expect(
        thread?.activities.some((activity) => activity.kind === "provider.turn.interrupt.failed"),
      ).toBe(false);
    }),
  );

  it("starts a fresh session when only projected session state exists", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set-stale"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "ready",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-stale"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-stale"),
          role: "user",
          text: "resume codex",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(() => harness.startSession.mock.calls.length === 1);
    await waitFor(() => harness.sendTurn.mock.calls.length === 1);

    expect(harness.startSession.mock.calls[0]?.[1]).toMatchObject({
      threadId: ThreadId.make("thread-1"),
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-codex",
      },
      runtimeMode: "approval-required",
    });
    expect(harness.sendTurn.mock.calls[0]?.[0]).toMatchObject({
      threadId: ThreadId.make("thread-1"),
    });
  });

  it("rejects active runtime sessions that are missing provider instance ids", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set-missing-instance"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "ready",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );
    harness.runtimeSessions.push({
      provider: ProviderDriverKind.make("codex"),
      status: "ready",
      runtimeMode: "approval-required",
      threadId: ThreadId.make("thread-1"),
      cwd: "/tmp/provider-project",
      resumeCursor: { opaque: "resume-without-instance" },
      createdAt: now,
      updatedAt: now,
    });

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start-missing-instance"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: asMessageId("user-message-missing-instance"),
          role: "user",
          text: "resume codex",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: now,
      }),
    );

    await waitFor(async () => {
      const readModel = await harness.readModel();
      const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
      return (
        thread?.activities.some((activity) => activity.kind === "provider.turn.start.failed") ??
        false
      );
    });

    expect(harness.startSession.mock.calls.length).toBe(0);
    expect(harness.sendTurn.mock.calls.length).toBe(0);
    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(
      thread?.activities.find((activity) => activity.kind === "provider.turn.start.failed"),
    ).toMatchObject({
      payload: {
        detail: expect.stringContaining("without a provider instance id"),
      },
    });
  });

  it("forwards approval responses without reading unrelated message bodies", async () => {
    const harness = await createHarness({ unreadableHistory: true });
    const now = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set-for-approval"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "running",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.approval.respond",
        commandId: CommandId.make("cmd-approval-respond"),
        threadId: ThreadId.make("thread-1"),
        requestId: asApprovalRequestId("approval-request-1"),
        decision: "accept",
        createdAt: now,
      }),
    );

    await harness.drain();
    expect(harness.respondToRequest.mock.calls[0]?.[0]).toEqual({
      threadId: "thread-1",
      requestId: "approval-request-1",
      decision: "accept",
    });
  });

  it("forwards user input answers without reading unrelated message bodies", async () => {
    const harness = await createHarness({ unreadableHistory: true });
    const now = "2026-01-01T00:00:00.000Z";

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set-for-user-input"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "running",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.user-input.respond",
        commandId: CommandId.make("cmd-user-input-respond"),
        threadId: ThreadId.make("thread-1"),
        requestId: asApprovalRequestId("user-input-request-1"),
        answers: {
          sandbox_mode: "workspace-write",
        },
        createdAt: now,
      }),
    );

    await harness.drain();
    expect(harness.respondToUserInput.mock.calls[0]?.[0]).toEqual({
      threadId: "thread-1",
      requestId: "user-input-request-1",
      answers: {
        sandbox_mode: "workspace-write",
      },
    });
  });

  it("normalizes stale Codex approval callbacks without faking approval resolution", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";
    harness.respondToRequest.mockImplementation(() =>
      Effect.fail(
        new ProviderAdapterRequestError({
          provider: ProviderDriverKind.make("codex"),
          method: "item/requestApproval/decision",
          detail: "Unknown pending Codex approval request: approval-request-1",
        }),
      ),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set-for-approval-error"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "running",
          providerName: "codex",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.activity.append",
        commandId: CommandId.make("cmd-approval-requested"),
        threadId: ThreadId.make("thread-1"),
        activity: {
          id: EventId.make("activity-approval-requested"),
          tone: "approval",
          kind: "approval.requested",
          summary: "Command approval requested",
          payload: {
            requestId: "approval-request-1",
            requestKind: "command",
          },
          turnId: null,
          createdAt: now,
        },
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.approval.respond",
        commandId: CommandId.make("cmd-approval-respond-stale"),
        threadId: ThreadId.make("thread-1"),
        requestId: asApprovalRequestId("approval-request-1"),
        decision: "acceptForSession",
        createdAt: now,
      }),
    );

    await waitFor(async () => {
      const readModel = await harness.readModel();
      const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
      if (!thread) return false;
      return thread.activities.some(
        (activity) => activity.kind === "provider.approval.respond.failed",
      );
    });

    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread).toBeDefined();

    const failureActivity = thread?.activities.find(
      (activity) => activity.kind === "provider.approval.respond.failed",
    );
    expect(failureActivity).toBeDefined();
    expect(failureActivity?.payload).toMatchObject({
      requestId: "approval-request-1",
      detail: expect.stringContaining("Stale pending approval request: approval-request-1"),
    });

    const resolvedActivity = thread?.activities.find(
      (activity) =>
        activity.kind === "approval.resolved" &&
        typeof activity.payload === "object" &&
        activity.payload !== null &&
        (activity.payload as Record<string, unknown>).requestId === "approval-request-1",
    );
    expect(resolvedActivity).toBeUndefined();
  });

  it("surfaces non-resumable provider user-input callbacks as stale failures", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";
    harness.respondToUserInput.mockImplementation(() =>
      Effect.fail(
        new ProviderAdapterRequestError({
          provider: ProviderDriverKind.make("claudeAgent"),
          method: "item/tool/respondToUserInput",
          detail: "Unknown pending Codex user input request: user-input-request-1",
        }),
      ),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set-for-user-input-error"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "running",
          providerName: "claudeAgent",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.activity.append",
        commandId: CommandId.make("cmd-user-input-requested"),
        threadId: ThreadId.make("thread-1"),
        activity: {
          id: EventId.make("activity-user-input-requested"),
          tone: "info",
          kind: "user-input.requested",
          summary: "User input requested",
          payload: {
            requestId: "user-input-request-1",
            questions: [
              {
                id: "sandbox_mode",
                header: "Sandbox",
                question: "Which mode should be used?",
                options: [
                  {
                    label: "workspace-write",
                    description: "Allow workspace writes only",
                  },
                ],
              },
            ],
          },
          turnId: null,
          createdAt: now,
        },
        createdAt: now,
      }),
    );

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.user-input.respond",
        commandId: CommandId.make("cmd-user-input-respond-stale"),
        threadId: ThreadId.make("thread-1"),
        requestId: asApprovalRequestId("user-input-request-1"),
        answers: {
          sandbox_mode: "workspace-write",
        },
        createdAt: now,
      }),
    );

    await waitFor(async () => {
      const readModel = await harness.readModel();
      const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
      if (!thread) return false;
      return thread.activities.some(
        (activity) => activity.kind === "provider.user-input.respond.failed",
      );
    });

    const readModel = await harness.readModel();
    const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
    expect(thread).toBeDefined();

    const failureActivity = thread?.activities.find(
      (activity) => activity.kind === "provider.user-input.respond.failed",
    );
    expect(failureActivity).toBeDefined();
    expect(failureActivity?.payload).toMatchObject({
      requestId: "user-input-request-1",
      detail: expect.stringContaining("Stale pending user-input request: user-input-request-1"),
    });

    const resolvedActivity = thread?.activities.find(
      (activity) =>
        activity.kind === "user-input.resolved" &&
        typeof activity.payload === "object" &&
        activity.payload !== null &&
        (activity.payload as Record<string, unknown>).requestId === "user-input-request-1",
    );
    expect(resolvedActivity).toBeUndefined();
  });

  effectIt.effect("stops a provider session without reading unrelated message bodies", () =>
    Effect.gen(function* () {
      const harness = yield* Effect.promise(() => createHarness({ unreadableHistory: true }));
      const now = "2026-01-01T00:00:00.000Z";

      yield* harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set-for-stop"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "ready",
          providerName: "codex",
          providerInstanceId: ProviderInstanceId.make("codex_work"),
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      });

      yield* harness.engine.dispatch({
        type: "thread.session.stop",
        commandId: CommandId.make("cmd-session-stop"),
        threadId: ThreadId.make("thread-1"),
        createdAt: now,
      });

      yield* Effect.promise(() => harness.drain());
      expect(harness.stopSession).toHaveBeenCalledWith({ threadId: ThreadId.make("thread-1") });
      const thread = yield* harness.snapshotQuery
        .getThreadShellById(ThreadId.make("thread-1"))
        .pipe(Effect.map(Option.getOrThrow));
      expect(thread.session).not.toBeNull();
      expect(thread.session?.status).toBe("stopped");
      expect(thread.session?.threadId).toBe("thread-1");
      expect(thread.session?.providerInstanceId).toBe(ProviderInstanceId.make("codex_work"));
      expect(thread.session?.activeTurnId).toBeNull();
    }),
  );

  effectIt.effect("stops a ready provider session after automatic settlement", () =>
    Effect.gen(function* () {
      const sessionStopped = yield* Deferred.make<void>();
      const harness = yield* Effect.promise(() =>
        createHarness({
          stopSessionEffect: () => Deferred.succeed(sessionStopped, undefined).pipe(Effect.asVoid),
        }),
      );
      const now = "2026-01-01T00:00:00.000Z";

      yield* harness.engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set-for-auto-settle"),
        threadId: ThreadId.make("thread-1"),
        session: {
          threadId: ThreadId.make("thread-1"),
          status: "ready",
          providerName: "codex",
          providerInstanceId: ProviderInstanceId.make("codex_work"),
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        },
        createdAt: now,
      });
      const beforeSettlement = yield* Effect.promise(() => harness.readModel());

      yield* harness.engine.dispatch({
        type: "thread.auto-settle",
        commandId: CommandId.make("cmd-auto-settle-with-session"),
        threadId: ThreadId.make("thread-1"),
        snapshotSequence: beforeSettlement.snapshotSequence,
        settledAt: now,
      });

      yield* Deferred.await(sessionStopped);
      yield* Effect.promise(() => harness.drain());
      const readModel = yield* Effect.promise(() => harness.readModel());
      const thread = readModel.threads.find((entry) => entry.id === ThreadId.make("thread-1"));
      expect(thread?.settledOverride).toBe("settled");
      expect(thread?.session?.status).toBe("stopped");
      expect(thread?.session?.providerInstanceId).toBe(ProviderInstanceId.make("codex_work"));
    }),
  );
});
