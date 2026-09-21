import * as NodeCryptoService from "@effect/platform-node/NodeCrypto";
import * as NodeCrypto from "node:crypto";

import type {
  EnvironmentId,
  OrchestrationEvent,
  OrchestrationThreadShell,
  ProjectId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import type {
  RelayAgentActivityPublishProofPayload,
  RelayAgentActivityState,
} from "@t3tools/contracts/relay";
import { CommandId, ProviderInstanceId } from "@t3tools/contracts";
import { RELAY_ACTIVITY_PUBLISH_TYP, verifyRelayJwt } from "@t3tools/shared/relayJwt";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Layer from "effect/Layer";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { isAgentActivityPublishingEnabledValue } from "../cloud/config.ts";
import * as AgentAwarenessRelay from "./AgentAwarenessRelay.ts";

const state: RelayAgentActivityState = {
  environmentId: "env" as RelayAgentActivityState["environmentId"],
  threadId: "thread" as RelayAgentActivityState["threadId"],
  projectTitle: "Project",
  threadTitle: "Thread",
  modelTitle: "gpt-5.4",
  phase: "running",
  headline: "Running",
  updatedAt: "2026-05-25T00:00:00.000Z",
  deepLink: "/threads/env/thread",
};

describe.sequential("signRelayAgentActivityPublishProof", () => {
  it("distinguishes pending link credentials from disabled publication", () => {
    expect(
      AgentAwarenessRelay.resolveAgentActivityPublishingStartupState({
        relayConfigured: false,
        publishEnabled: false,
      }),
    ).toBe("waiting-for-link");
    expect(
      AgentAwarenessRelay.resolveAgentActivityPublishingStartupState({
        relayConfigured: true,
        publishEnabled: false,
      }),
    ).toBe("disabled");
    expect(
      AgentAwarenessRelay.resolveAgentActivityPublishingStartupState({
        relayConfigured: true,
        publishEnabled: true,
      }),
    ).toBe("enabled");
  });

  it("derives the thread id from the aggregate id for thread events without payload thread ids", () => {
    const threadId = "thread-aggregate-1" as ThreadId;
    const now = "2026-05-25T00:00:00.000Z";
    const event = {
      type: "thread.activity-appended",
      sequence: 1,
      eventId: "evt-aggregate-1",
      commandId: CommandId.make("cmd-1"),
      aggregateKind: "thread",
      aggregateId: threadId,
      actor: { kind: "server" },
      payload: {},
      occurredAt: now,
    } as unknown as OrchestrationEvent;

    expect(AgentAwarenessRelay.eventThreadId(event)).toBe(threadId);
  });

  it("does not publish imported, start-intent, streaming, or non-awareness events", () => {
    const now = "2026-05-25T00:00:00.000Z";
    const base = {
      sequence: 1,
      eventId: "evt-1",
      commandId: CommandId.make("cmd-1"),
      aggregateKind: "thread",
      aggregateId: "thread-1" as ThreadId,
      occurredAt: now,
      metadata: {},
    };

    expect(
      AgentAwarenessRelay.shouldPublishAgentAwarenessEvent({
        ...base,
        type: "thread.message-sent",
        payload: {
          threadId: "thread-1" as ThreadId,
          streaming: true,
        },
      } as unknown as OrchestrationEvent),
    ).toBe(false);
    expect(
      AgentAwarenessRelay.shouldPublishAgentAwarenessEvent({
        ...base,
        type: "thread.activity-appended",
        payload: {
          threadId: "thread-1" as ThreadId,
          activity: {
            kind: "task.progress",
          },
        },
      } as unknown as OrchestrationEvent),
    ).toBe(false);
    expect(
      AgentAwarenessRelay.shouldPublishAgentAwarenessEvent({
        ...base,
        type: "thread.activity-appended",
        payload: {
          threadId: "thread-1" as ThreadId,
          activity: {
            kind: "approval.requested",
          },
        },
      } as unknown as OrchestrationEvent),
    ).toBe(true);
    expect(
      AgentAwarenessRelay.shouldPublishAgentAwarenessEvent({
        ...base,
        type: "thread.message-sent",
        payload: {
          threadId: "thread-1" as ThreadId,
          streaming: false,
        },
      } as unknown as OrchestrationEvent),
    ).toBe(false);
    expect(
      AgentAwarenessRelay.shouldPublishAgentAwarenessEvent({
        ...base,
        type: "thread.turn-start-requested",
        payload: {
          threadId: "thread-1" as ThreadId,
        },
      } as unknown as OrchestrationEvent),
    ).toBe(false);
    expect(
      AgentAwarenessRelay.shouldPublishAgentAwarenessEvent({
        ...base,
        type: "thread.created",
        metadata: { historyImport: true },
        payload: { threadId: "thread-1" as ThreadId },
      } as unknown as OrchestrationEvent),
    ).toBe(false);
    expect(
      AgentAwarenessRelay.shouldPublishAgentAwarenessEvent({
        ...base,
        type: "thread.settled",
        metadata: { historyImport: true },
        payload: { threadId: "thread-1" as ThreadId },
      } as unknown as OrchestrationEvent),
    ).toBe(false);
    expect(
      AgentAwarenessRelay.shouldPublishAgentAwarenessEvent({
        ...base,
        type: "thread.created",
        payload: { threadId: "thread-1" as ThreadId },
      } as unknown as OrchestrationEvent),
    ).toBe(true);
    expect(
      AgentAwarenessRelay.shouldPublishAgentAwarenessEvent({
        ...base,
        type: "thread.settled",
        payload: { threadId: "thread-1" as ThreadId },
      } as unknown as OrchestrationEvent),
    ).toBe(true);
  });

  it("deduplicates awareness state updates whose only change is their event timestamp", () => {
    expect(AgentAwarenessRelay.agentAwarenessPublishIdentity(state)).toBe(
      AgentAwarenessRelay.agentAwarenessPublishIdentity({
        ...state,
        updatedAt: "2026-05-25T00:10:00.000Z",
      }),
    );
    expect(AgentAwarenessRelay.agentAwarenessPublishIdentity(state)).not.toBe(
      AgentAwarenessRelay.agentAwarenessPublishIdentity({
        ...state,
        phase: "completed",
        headline: "Agent finished",
      }),
    );
  });

  it("requires an explicit opt-in before publishing agent activity", () => {
    expect(isAgentActivityPublishingEnabledValue(null)).toBe(false);
    expect(isAgentActivityPublishingEnabledValue("false")).toBe(false);
    expect(isAgentActivityPublishingEnabledValue("TRUE")).toBe(false);
    expect(isAgentActivityPublishingEnabledValue("true")).toBe(true);
  });

  it("redacts failed activity details and caps other relay detail", () => {
    expect(
      AgentAwarenessRelay.sanitizeRelayAgentActivityState({
        ...state,
        phase: "failed",
        detail: "Provider process exited with secret token.",
      }),
    ).toMatchObject({
      phase: "failed",
      detail: "The agent run failed.",
    });
    expect(
      AgentAwarenessRelay.sanitizeRelayAgentActivityState({
        ...state,
        detail: "x".repeat(200),
      })?.detail,
    ).toHaveLength(160);
  });

  it("resolves a null publish state when a thread or project snapshot disappeared", () => {
    const environmentId = "env-1" as EnvironmentId;
    const threadId = "thread-1" as ThreadId;
    const thread = {
      id: threadId,
      projectId: "project-1" as ProjectId,
      title: "Deleted thread",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      session: null,
      latestTurn: null,
      updatedAt: "2026-05-25T00:00:00.000Z",
      hasPendingApprovals: false,
      hasPendingUserInput: false,
    } as OrchestrationThreadShell;

    expect(
      AgentAwarenessRelay.resolveAgentAwarenessRelayPublishSnapshot({
        environmentId,
        threadId,
        thread: Option.none(),
        project: Option.none(),
      }),
    ).toEqual({
      projectId: null,
      state: null,
      reason: "thread-not-found",
    });

    expect(
      AgentAwarenessRelay.resolveAgentAwarenessRelayPublishSnapshot({
        environmentId,
        threadId,
        thread: Option.some(thread),
        project: Option.none(),
      }),
    ).toEqual({
      projectId: "project-1",
      state: null,
      reason: "project-not-found",
    });
  });

  it("selects only active shell snapshot threads for startup catch-up", () => {
    const now = "2026-05-25T00:00:00.000Z";
    const environmentId = "env-1" as EnvironmentId;
    const projectId = "project-1" as ProjectId;
    const activeThreadId = "thread-active" as ThreadId;
    const idleThreadId = "thread-idle" as ThreadId;

    const baseThread = {
      projectId,
      title: "Run remote agent",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      pullRequests: [],
      latestTurn: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      session: null,
      latestUserMessageAt: null,
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      hasActionableProposedPlan: false,
    } satisfies Omit<OrchestrationThreadShell, "id">;

    expect(
      AgentAwarenessRelay.resolveAgentAwarenessRelayActiveThreadIds({
        environmentId,
        projects: [
          {
            id: projectId,
            title: "T3 Code",
          },
        ],
        threads: [
          {
            ...baseThread,
            id: activeThreadId,
            latestTurn: {
              turnId: "turn-1" as TurnId,
              state: "running",
              requestedAt: now,
              startedAt: now,
              completedAt: null,
              assistantMessageId: null,
            },
          },
          {
            ...baseThread,
            id: idleThreadId,
          },
          {
            ...baseThread,
            id: "thread-missing-project" as ThreadId,
            projectId: "missing-project" as ProjectId,
            latestTurn: {
              turnId: "turn-2" as TurnId,
              state: "running",
              requestedAt: now,
              startedAt: now,
              completedAt: null,
              assistantMessageId: null,
            },
          },
        ],
      }),
    ).toEqual([activeThreadId]);
  });

  it.effect("signs the activity publish JWT and rejects tampering", () =>
    Effect.gen(function* () {
      const keyPair = NodeCrypto.generateKeyPairSync("ed25519", {
        privateKeyEncoding: { format: "pem", type: "pkcs8" },
        publicKeyEncoding: { format: "pem", type: "spki" },
      });
      const payload = {
        iss: "t3-env:env",
        aud: "https://relay.example.test",
        sub: "env",
        jti: "nonce-1",
        iat: 100,
        exp: 200,
        environmentId: state.environmentId,
        threadId: state.threadId,
        state,
      } satisfies RelayAgentActivityPublishProofPayload;
      const proof = yield* AgentAwarenessRelay.signRelayAgentActivityPublishProof({
        privateKey: keyPair.privateKey,
        payload,
      });
      const verify = (token: string) =>
        verifyRelayJwt({
          publicKey: keyPair.publicKey,
          token,
          typ: RELAY_ACTIVITY_PUBLISH_TYP,
          issuer: "t3-env:env",
          audience: "https://relay.example.test",
          nowEpochSeconds: 150,
        });

      expect(yield* verify(proof)).toMatchObject({ jti: "nonce-1", state });

      const [header, body, signature = ""] = proof.split(".");
      const corruptedSignature = `${signature.startsWith("a") ? "b" : "a"}${signature.slice(1)}`;
      const rejection = yield* Effect.flip(verify(`${header}.${body}.${corruptedSignature}`));
      expect(rejection).toBeDefined();
    }),
  );

  it.effect("keeps the hosted publisher disabled without reading saved credentials", () => {
    let secretReads = 0;
    return Effect.gen(function* () {
      const relay = yield* AgentAwarenessRelay.make;
      yield* relay.start();
      yield* relay.publishThread("saved-thread" as ThreadId);
      expect(secretReads).toBe(0);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(
          Layer.mock(ServerSecretStore.ServerSecretStore)({
            get: () =>
              Effect.sync(() => {
                secretReads += 1;
              }).pipe(Effect.andThen(Effect.die("Hosted credentials must not be read"))),
          }),
          Layer.mock(ServerEnvironment.ServerEnvironment)({}),
          Layer.mock(OrchestrationEngineService)({}),
          Layer.mock(ProjectionSnapshotQuery)({}),
          NodeCryptoService.layer,
        ),
      ),
    );
  });
});
