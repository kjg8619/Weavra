import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  WeavraTask,
  WeavraTaskId,
  WeavraAnalysisContext,
  WEAVRA_CONTROL_COMMANDS,
  WeavraTaskReceipt,
  WeavraEvidenceDetailsRequest,
  type WeavraTaskReadInput,
} from "@t3tools/contracts";
import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Option from "effect/Option";
import { ServerConfig } from "../config.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { OrchestrationEngineLive } from "../orchestration/Layers/OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "../orchestration/Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../orchestration/Layers/ProjectionSnapshotQuery.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ThreadBackgroundLiveness from "../orchestration/ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../orchestration/ThreadPlanProgress.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../persistence/Layers/OrchestrationEventStore.ts";
import {
  SqlitePersistenceMemory,
  makeSqlitePersistenceLive,
} from "../persistence/Layers/Sqlite.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import * as Ownership from "../workspace/WorkspaceExecutionOwnership.ts";
import * as OwnershipTest from "../workspace/WorkspaceExecutionOwnershipTest.ts";
import { writeFakeCli } from "../testUtils/fakeCli.ts";
import * as Runtime from "./RuntimeController.ts";
import * as Coordinator from "./TaskCoordinator.ts";
import * as ProviderService from "../provider/Services/ProviderService.ts";

const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeTask = Schema.decodeUnknownEffect(WeavraTask);
const decodeEvidenceRequest = Schema.decodeEffect(
  Schema.fromJsonString(WeavraEvidenceDetailsRequest),
);
const projectId = ProjectId.make("coordinator-project");
const threadId = ThreadId.make("coordinator-thread");
const time = "2026-09-27T00:00:00.000Z";
const packet = Schema.decodeUnknownSync(WeavraAnalysisContext)({
  version: 1,
  packetVersion: 1,
  authority: "ADVISORY_ONLY",
  reviewedAt: 1,
  symptom: "The fixture fails",
  observations: [],
  candidateCause: null,
  uncertainties: [],
  sourceReferences: [],
  constraints: [],
});
const prepare = Effect.fn("coordinatorTest.prepare")(function* (
  coordinator: Coordinator.TaskCoordinator["Service"],
  input: WeavraTaskReadInput,
  context: WeavraAnalysisContext,
  goal: string,
  acceptanceStatements: readonly string[],
) {
  const task = yield* coordinator.read(input);
  return yield* coordinator.prepare(input, { context, goal, acceptanceStatements }, task.revision);
});
const makeSystem = (databasePath?: string) =>
  OrchestrationEngineLive.pipe(
    Layer.provideMerge(OrchestrationProjectionSnapshotQueryLive),
    Layer.provide(OrchestrationProjectionPipelineLive),
    Layer.provide(ThreadBackgroundLiveness.layer),
    Layer.provide(ThreadPlanProgress.layer),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    Layer.provide(RepositoryIdentityResolver.layer),
    Layer.provideMerge(Ownership.layer),
    Layer.provide(OwnershipTest.environmentLayer),
    Layer.provideMerge(ProcessRunner.layer),
    Layer.provide(databasePath ? makeSqlitePersistenceLive(databasePath) : SqlitePersistenceMemory),
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "weavra-coordinator-" })),
    Layer.provideMerge(NodeServices.layer),
  );
const system = makeSystem();

const analysisProvider = (driverKind: "codex" | "claudeAgent") =>
  ProviderService.ProviderService.of({
    startSession: () => Effect.die("unused"),
    sendTurn: () => Effect.die("unused"),
    compactThread: () => Effect.die("unused"),
    interruptTurn: () => Effect.die("unused"),
    respondToRequest: () => Effect.die("unused"),
    respondToUserInput: () => Effect.die("unused"),
    stopSession: () => Effect.die("unused"),
    listSessions: () => Effect.succeed([]),
    getCapabilities: () => Effect.die("unused"),
    getInstanceInfo: (instanceId) =>
      Effect.succeed({
        instanceId,
        driverKind: ProviderDriverKind.make(driverKind),
        displayName: undefined,
        enabled: true,
        continuationIdentity: {
          driverKind: ProviderDriverKind.make(driverKind),
          continuationKey: `${driverKind}:instance:${instanceId}`,
        },
      }),
    assertConversationRollbackSupported: () => Effect.die("unused"),
    rollbackConversation: () => Effect.die("unused"),
    uploadFeedback: () => Effect.die("unused"),
    streamEvents: Stream.empty,
  });

// A deterministic stdio protocol peer. It does not implement workers or claim
// Runtime completion. Production App control, ownership, CAS and SQLite are real.
const peer = `
import {createInterface} from 'node:readline';
import {readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
const ownerId='owner-'+process.pid,digest='sha256:'+'a'.repeat(64),mode=process.env.MODE;
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const checkout={canonicalCwd:process.cwd(),repositoryRoot:process.cwd(),headCommit:'a'.repeat(40),workspaceDigest:digest};
const empty={status:{source:'durable-canonical-state',ownerObserved:false,state:'missing',writerPresent:false,run:null},graph:null,graphAvailable:false,evidence:null,configuration:{source:'project-config-not-frozen-run-config',status:'missing'}};
let seq=1,state={ownerId,nextRequestId:ownerId+':1',projectRevision:0,stateRevision:null,ownedRunId:null,busy:false,cancelling:false,startFailure:null,preview:null,browserPreview:null,factPreview:null,projectFacts:{status:'available',entries:[]},pendingApproval:null,snapshot:empty};
const capabilities={authority:'Runtime/Kernel',control:'workflow-control-v1',ownerId,commands:${encode(WEAVRA_CONTROL_COMMANDS)},maxRequestBytes:32768,maxResponseBytes:65536,resultLimit:64,previewTtlMs:300000,runtimeVersion:'fixture',readiness:'READY',checkoutIdentity:1,evidenceDetails:1,...(mode==='recover-unsupported'?{}:{taskRecovery:1}),...(mode==='unsupported'?{}:{taskBinding:1,analysisContext:1}),recipes:[]};
const response=(r,data)=>({protocolVersion:1,type:'control_response',id:r.id,command:r.type,ownerId,runId:state.snapshot.status.run?.runId??null,stateRevision:state.stateRevision,projectRevision:state.projectRevision,eventId:null,timestamp:1,success:true,data});
for await(const line of createInterface({input:process.stdin})){
 const r=JSON.parse(line);let data;
 appendFileSync('requests',r.type+'\\n');
 if(r.type==='control.hello')data={kind:'capabilities',capabilities};
 else if(r.type==='control.snapshot'){
  if(existsSync('state-patch.json'))Object.assign(state,JSON.parse(readFileSync('state-patch.json','utf8')));
  data={kind:'snapshot',state};
 }
 else if(r.type==='workflow.checkout'){process.stdout.write(JSON.stringify({...response(r,{kind:'checkout-identity',checkout:existsSync('checkout-patch.json')?{...checkout,...JSON.parse(readFileSync('checkout-patch.json','utf8'))}:checkout}),projectRevision:null,runId:null,stateRevision:null})+'\\n');continue;}
 else if(r.type==='workflow.prepare'){
  state.nextRequestId=ownerId+':'+(++seq);
  const taskBinding={taskId:r.task.taskId,environmentId:r.task.environmentId,projectId:r.task.projectId,threadId:r.task.threadId,checkout:r.task.checkout,executionId:randomUUID(),packetVersion:r.task.analysisContext.packetVersion,advisoryDigest:'sha256:'+createHash('sha256').update(JSON.stringify(stable({domain:'weavra.analysis-context.v1',packet:r.task.analysisContext}))).digest('hex'),...(r.task.symptomVerification?{symptomVerification:{criterionId:'AC-'+String(r.task.symptomVerification.criterionIndex).padStart(3,'0'),checkId:r.task.symptomVerification.checkId,registrationDigest:digest}}:{})};
  state.preview={taskBinding,configDigest:digest,previewId:'preview-'+seq,previewDigest:digest,ownerId,projectRevision:0,expiresAt:9999999999999,goal:r.goal,workflow:'STANDARD',executionMode:'EDIT',risk:'R1',allowedPaths:['src'],checks:[{id:'symptom',kind:'test',required:true}],acceptanceCriteria:r.acceptanceStatements.map((statement,i)=>({id:'AC-'+String(i+1).padStart(3,'0'),statement,checkIds:['symptom'],reviewRequired:true})),taskContractDigest:digest,recipe:null,configuration:{mutationMode:'compatible',verifierTrustMode:'compatible',verifierSandboxMode:'disabled',contextPackMode:'disabled',verificationRepairMode:'disabled',lspEnabled:false}};
  data={kind:'prepared',preview:state.preview};
 }else if(r.type==='workflow.confirm'){
  const binding=state.preview.taskBinding;
  const outcome=mode==='failed'?{status:'START_FAILED',reasonCode:'INITIALIZATION_FAILED'}:{status:'ACCEPTED'};
  const receipt={status:'FOUND',executionId:binding.executionId,admission:{metadata:{binding,previewDigest:digest,configDigest:digest,confirmedProjectRevision:0,admittedProjectRevision:1},outcome,acceptedAt:1,updatedAt:1},run:null};
  writeFileSync('receipt.json',JSON.stringify(receipt));appendFileSync('confirms','confirm\\n');
  state.preview=null;state.projectRevision=1;state.nextRequestId=ownerId+':'+(++seq);
  if(mode==='lost'){process.stdout.write('{"invalid":true}\\n');continue;}
  data={kind:'accepted',requestId:r.id,command:r.type,runId:null,taskReceipt:receipt};
 }else if(r.type==='workflow.recover'){
  appendFileSync('recoveries',JSON.stringify(r)+'\\n');
  const receipt=JSON.parse(readFileSync('receipt.json','utf8'));
  if(mode==='recover-live'){
   const {data:ignored,...envelope}=response(r,null);
   process.stdout.write(JSON.stringify({...envelope,success:false,error:{code:'BUSY'}})+'\\n');continue;
  }
  if(mode==='recover-owner')data={kind:'task-recovery',receipt,disposition:'NOT_RECOVERED',cleanup:'UNCONFIRMED',reason:'OWNER_UNPROVEN'};
  else{
   if(receipt.run){receipt.run={...receipt.run,status:'INTERRUPTED',revision:receipt.run.revision+1};}
   else receipt.admission.outcome={status:'INTERRUPTED_BEFORE_START',reasonCode:'OWNER_LOST'};
   receipt.admission.cleanup=mode==='recover-unconfirmed'||mode==='recover-lost'?'UNCONFIRMED':'CONFIRMED';
   receipt.admission.updatedAt=2;
   writeFileSync('receipt.json',JSON.stringify(receipt));
   state.projectRevision++;state.nextRequestId=ownerId+':'+(++seq);
   if(mode==='recover-lost'){process.stdout.write('{"invalid":true}\\n');continue;}
   if(mode==='recover-mismatch')receipt.admission.metadata.configDigest='sha256:'+'b'.repeat(64);
   data={kind:'task-recovery',receipt,disposition:'RECOVERED',cleanup:receipt.admission.cleanup,reason:null};
  }
 }else if(r.type==='workflow.receipt'){
  data={kind:'task-receipt',receipt:existsSync('receipt.json')?JSON.parse(readFileSync('receipt.json','utf8')):{status:'UNKNOWN',executionId:r.executionId}};
 }else if(r.type==='workflow.cancel'||r.type==='approval.resolve'){
  appendFileSync('controls',JSON.stringify(r)+'\\n');
  state.nextRequestId=ownerId+':'+(++seq);
  data={kind:'accepted',requestId:r.id,command:r.type,runId:r.runId};
 }else if(r.type==='workflow.evidence'){
  writeFileSync('evidence-request.json',JSON.stringify(r));
  const snapshot={executionId:r.binding.executionId,runId:r.binding.runId,revision:r.binding.revision,diffDigest:'a'.repeat(64)};
  data={kind:'evidence-details',snapshot,completeness:{criteria:{availability:'available',total:0},checks:{availability:'available',total:0,required:0},changedFiles:{availability:'available',total:0},trustSources:{availability:'available',total:0,checksWithoutTrust:0},review:{availability:'unavailable'}},source:'archive',outcome:{status:'CANCELLED',terminal:true},ownership:{writerPresent:false,cleanup:'UNKNOWN'},codeRevision:0,changedLines:0,symptomVerification:null,review:null,cursor:r.cursor,records:[],nextCursor:null};
  process.stdout.write(JSON.stringify({...response(r,data),runId:r.binding.runId,stateRevision:r.binding.revision})+'\\n');continue;
 }else throw new Error('Unexpected mutation '+r.type);
 process.stdout.write(JSON.stringify(response(r,data))+'\\n');
}
`;

const setup = Effect.fn("coordinatorTest.setup")(function* (
  mode = "accepted",
  worktree = false,
  existingBase?: string,
  retain = false,
  seedTask = true,
  retainedKind: "write" | "terminal" = "write",
) {
  const fs = yield* FileSystem.FileSystem;
  const runner = yield* ProcessRunner.ProcessRunner;
  const engine = yield* OrchestrationEngineService;
  const ownership = yield* Ownership.WorkspaceExecutionOwnership;
  const directory =
    existingBase ?? (yield* fs.makeTempDirectoryScoped({ prefix: "weavra-task-coordinator-" }));
  const base = yield* fs.realPath(directory);
  const root = `${base}/project`;
  yield* fs.makeDirectory(root);
  assert.equal((yield* runner.run({ command: "git", args: ["-C", root, "init", "-q"] })).code, 0);
  const cwd = worktree ? `${base}/checkout` : root;
  if (worktree)
    assert.equal(
      (yield* runner.run({
        command: "git",
        args: ["-C", root, "worktree", "add", "--orphan", "-b", "controlled", cwd],
      })).code,
      0,
    );
  const executable = writeFakeCli({
    directory: base,
    name: "runtime-peer",
    source: peer,
    env: { MODE: mode },
  });
  yield* engine.dispatch({
    type: "project.create",
    commandId: CommandId.make("project-create"),
    projectId,
    title: "Coordinator",
    workspaceRoot: root,
    createdAt: time,
  });
  yield* engine.dispatch({
    type: "thread.create",
    commandId: CommandId.make("thread-create"),
    projectId,
    threadId,
    title: "Coordinator",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "fixture" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: worktree ? cwd : null,
    createdAt: time,
  });
  const selected = yield* ownership.resolveTarget(threadId);
  const task = yield* decodeTask({
    id: "33333333-3333-4333-8333-333333333333",
    environmentId: ownership.environmentId,
    projectId,
    threadId,
    target: selected.target,
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
    createdAt: time,
    updatedAt: time,
  });
  const retained = retain ? yield* ownership.acquireIndependent({ cwd, kind: retainedKind }) : null;
  if (seedTask)
    yield* ownership.updateTask({
      type: "thread.weavra-task.set",
      commandId: CommandId.make("task-create"),
      threadId,
      expectedRevision: null,
      expectedOwnershipGeneration: 0,
      task,
    });
  const input = { environmentId: task.environmentId, projectId, threadId, taskId: task.id };
  const controller = Runtime.make().pipe(
    Effect.provideService(HostProcessEnvironment, {
      PATH: process.env.PATH,
      T3_WEAVRA_EXECUTABLE: executable,
      T3_WEAVRA_CONTROL: "1",
    }),
  );
  const commandStates: WeavraTask[] = [];
  const open = Effect.gen(function* () {
    const runtime = yield* controller;
    const currentOwnership = yield* Ownership.WorkspaceExecutionOwnership;
    const coordinator = yield* Coordinator.make().pipe(
      Effect.provideService(Runtime.RuntimeController, {
        ...runtime,
        command: (input, selectedThread) =>
          Effect.gen(function* () {
            if (seedTask) commandStates.push(yield* currentOwnership.taskById(task.id));
            return yield* runtime.command(input, selectedThread);
          }),
      }),
    );
    return { runtime, coordinator };
  });
  return { fs, root, cwd, ownership, input, open, task, engine, commandStates, retained };
});

for (const worktree of [false, true]) {
  it.effect(
    `persists context and confirmation before exact ${worktree ? "worktree" : "project"} handoff`,
    () =>
      Effect.gen(function* () {
        // Given production ownership, SQLite and a real stdio adapter.
        const fixture = yield* setup("accepted", worktree);
        const { coordinator } = yield* fixture.open;
        const prepared = yield* prepare(coordinator, fixture.input, packet, "Fix fixture", [
          "Fixture works",
        ]);
        assert.equal(prepared.phase, "awaiting-confirmation");
        assert.deepStrictEqual(prepared.context, packet);
        assert.equal(prepared.execution?.confirmCommandId, null);
        // When the same explicit confirmation is requested twice.
        const first = yield* coordinator.confirm(fixture.input, CommandId.make("confirm"), 3);
        const second = yield* coordinator.confirm(fixture.input, CommandId.make("confirm"), 3);
        // Then ACCEPTED is not a fabricated Run and recovery never repeats confirm.
        assert.equal(first.phase, "handoff");
        assert.deepStrictEqual(second.execution, first.execution);
        assert.equal(second.execution?.receipt?.status, "FOUND");
        assert.equal(yield* fixture.fs.readFileString(`${fixture.cwd}/confirms`), "confirm\n");
        if (worktree) assert.isFalse(yield* fixture.fs.exists(`${fixture.root}/requests`));
        assert.equal((yield* fixture.ownership.activeOperations).length, 0);
        assert.equal(fixture.commandStates[0]?.phase, "preparing");
        assert.deepStrictEqual(fixture.commandStates[0]?.context, packet);
        assert.equal(fixture.commandStates[1]?.execution?.confirmCommandId, "confirm");
        assert.equal(fixture.commandStates[1]?.ownership.state, "runtime");
        assert.equal(fixture.commandStates[1]?.phase, "handoff");
      }).pipe(Effect.scoped, Effect.provide(system)),
  );
}

for (const released of [false, true]) {
  it.effect(`appends deduplicated followup without starting a turn when released=${released}`, () =>
    Effect.gen(function* () {
      const fixture = yield* setup();
      const { coordinator } = yield* fixture.open;
      const task = released
        ? yield* coordinator.abortUnconfirmed(fixture.input, fixture.task.revision)
        : fixture.task;
      const input = {
        task: fixture.input,
        commandId: CommandId.make("followup-command"),
        messageId: MessageId.make("followup-message"),
        text: "Save this followup.",
        expectedRevision: task.revision,
      };

      yield* coordinator.followup(input);
      yield* coordinator.followup(input);

      const detail = yield* (yield* ProjectionSnapshotQuery).getThreadDetailById(threadId, {
        activityKinds: [],
      });
      assert.ok(Option.isSome(detail));
      assert.equal(detail.value.messages.length, 1);
      assert.equal(detail.value.messages[0]?.id, input.messageId);
      assert.equal(detail.value.messages[0]?.text, input.text);
      assert.equal(detail.value.latestTurn, null);
      assert.deepStrictEqual(yield* coordinator.read(fixture.input), task);
    }).pipe(Effect.scoped, Effect.provide(system)),
  );
}

it.effect("rejects foreign followup selectors and stale revisions before appending", () =>
  Effect.gen(function* () {
    const fixture = yield* setup();
    const { coordinator } = yield* fixture.open;
    const cases = [
      { task: { ...fixture.input, environmentId: EnvironmentId.make("foreign") }, revision: 1 },
      { task: { ...fixture.input, projectId: ProjectId.make("foreign") }, revision: 1 },
      { task: { ...fixture.input, threadId: ThreadId.make("foreign") }, revision: 1 },
      { task: fixture.input, revision: 2 },
    ];

    for (const [index, candidate] of cases.entries()) {
      const result = yield* coordinator
        .followup({
          task: candidate.task,
          commandId: CommandId.make(`invalid-followup-${index}`),
          messageId: MessageId.make(`invalid-followup-${index}`),
          text: "Must not be appended.",
          expectedRevision: candidate.revision,
        })
        .pipe(Effect.result);
      assert.equal(result._tag, "Failure");
    }

    const detail = yield* (yield* ProjectionSnapshotQuery).getThreadDetailById(threadId, {
      activityKinds: [],
    });
    assert.ok(Option.isSome(detail));
    assert.deepStrictEqual(detail.value.messages, []);
    assert.equal(detail.value.latestTurn, null);
  }).pipe(Effect.scoped, Effect.provide(system)),
);

it.effect("dispatches task-bound analysis through the existing conversation", () =>
  Effect.gen(function* () {
    const fixture = yield* setup();
    const { coordinator } = yield* fixture.open;
    const events = yield* fixture.engine.subscribeDomainEvents;
    const observed = yield* events.pipe(
      Stream.filter((event) => event.type === "thread.turn-start-requested"),
      Stream.runHead,
      Effect.forkScoped,
    );

    const result = yield* coordinator
      .analyze({
        task: fixture.input,
        commandId: CommandId.make("analysis-command"),
        messageId: MessageId.make("analysis-message"),
        text: "Analyze the failure without editing.",
        expectedRevision: fixture.task.revision,
      })
      .pipe(Effect.provideService(ProviderService.ProviderService, analysisProvider("codex")));
    const event = yield* Fiber.join(observed);

    assert.equal(result.id, fixture.task.id);
    assert.ok(Option.isSome(event));
    assert.equal(event.value.type, "thread.turn-start-requested");
    if (event.value.type === "thread.turn-start-requested") {
      assert.deepStrictEqual(event.value.payload.controlledAnalysis, {
        taskId: fixture.task.id,
        expectedRevision: fixture.task.revision,
      });
      assert.deepStrictEqual(event.value.metadata.controlledAnalysis, {
        taskId: fixture.task.id,
        expectedRevision: fixture.task.revision,
      });
    }
    const message = yield* (yield* ProjectionSnapshotQuery).getTurnStartMessage({
      threadId,
      messageId: MessageId.make("analysis-message"),
    });
    assert.ok(Option.isSome(message));
    assert.equal(message.value.message.text, "Analyze the failure without editing.");
  }).pipe(Effect.scoped, Effect.provide(system)),
);

it.effect("rejects unsupported and stale analysis before persisting a message", () =>
  Effect.gen(function* () {
    const fixture = yield* setup();
    const { coordinator } = yield* fixture.open;
    for (const [driver, revision] of [
      ["claudeAgent", fixture.task.revision],
      ["codex", fixture.task.revision + 1],
    ] as const) {
      const result = yield* coordinator
        .analyze({
          task: fixture.input,
          commandId: CommandId.make(`analysis-${driver}-${revision}`),
          messageId: MessageId.make(`analysis-${driver}-${revision}`),
          text: "Do not persist this.",
          expectedRevision: revision,
        })
        .pipe(
          Effect.provideService(ProviderService.ProviderService, analysisProvider(driver)),
          Effect.result,
        );
      assert.equal(result._tag, "Failure");
    }
    const detail = yield* (yield* ProjectionSnapshotQuery).getThreadDetailById(threadId, {
      activityKinds: [],
    });
    assert.ok(Option.isSome(detail));
    assert.isFalse(
      detail.value.messages.some((message) => message.text === "Do not persist this."),
    );
  }).pipe(Effect.scoped, Effect.provide(system)),
);

it.effect(
  "reconciles a lost confirmation reply through a replacement controller without replay",
  () =>
    Effect.gen(function* () {
      const fixture = yield* setup("lost");
      // Given a Runtime admission durable before its invalid/lost reply.
      yield* Effect.gen(function* () {
        const { coordinator } = yield* fixture.open;
        yield* prepare(coordinator, fixture.input, packet, "Fix fixture", ["Fixture works"]);
        const lost = yield* coordinator
          .confirm(fixture.input, CommandId.make("confirm"), 3)
          .pipe(Effect.result);
        assert.equal(lost._tag, "Failure");
      }).pipe(Effect.scoped);
      // When the App's transport and coordinator are replaced.
      const { coordinator } = yield* fixture.open;
      const recovered = yield* coordinator.reconcile(fixture.input);
      // Then immutable receipt association survives; no second implementation was sent.
      assert.equal(recovered.phase, "handoff");
      assert.equal(recovered.execution?.confirmCommandId, "confirm");
      assert.equal(yield* fixture.fs.readFileString(`${fixture.cwd}/confirms`), "confirm\n");
    }).pipe(Effect.scoped, Effect.provide(system)),
);

it.effect("keeps UNKNOWN confirmation outcomes quarantined without resending", () =>
  Effect.gen(function* () {
    const fixture = yield* setup("lost");
    yield* Effect.gen(function* () {
      const { coordinator } = yield* fixture.open;
      yield* prepare(coordinator, fixture.input, packet, "Fix fixture", ["Fixture works"]);
      yield* coordinator.confirm(fixture.input, CommandId.make("confirm"), 3).pipe(Effect.result);
    }).pipe(Effect.scoped);
    yield* fixture.fs.remove(`${fixture.cwd}/receipt.json`);
    const { coordinator } = yield* fixture.open;
    const recovered = yield* coordinator.confirm(fixture.input, CommandId.make("retry"), 3);
    assert.equal(recovered.phase, "attention-required");
    assert.equal(recovered.ownership.state, "reconciling");
    assert.equal(recovered.execution?.receipt?.status, "UNKNOWN");
    assert.equal(yield* fixture.fs.readFileString(`${fixture.cwd}/confirms`), "confirm\n");
  }).pipe(Effect.scoped, Effect.provide(system)),
);

it.effect("releases a terminal no-Run outcome only after fresh cleanup observation", () =>
  Effect.gen(function* () {
    const fixture = yield* setup("failed");
    const { coordinator } = yield* fixture.open;
    yield* prepare(coordinator, fixture.input, packet, "Fix fixture", ["Fixture works"]);
    const result = yield* coordinator.confirm(fixture.input, CommandId.make("confirm"), 3);
    assert.equal(result.phase, "finished");
    assert.equal(result.ownership.state, "released");
    const receipt = result.execution?.receipt;
    assert.ok(receipt?.status === "FOUND");
    assert.equal(receipt.admission.outcome.status, "START_FAILED");
    assert.equal(receipt.run, null);
  }).pipe(Effect.scoped, Effect.provide(system)),
);

it.effect("rejects another thread selector before sending any Runtime mutation", () =>
  Effect.gen(function* () {
    const fixture = yield* setup();
    const { coordinator } = yield* fixture.open;
    const result = yield* prepare(
      coordinator,
      {
        ...fixture.input,
        threadId: ThreadId.make("another-thread"),
      },
      packet,
      "Fix fixture",
      ["Fixture works"],
    ).pipe(Effect.result);
    assert.equal(result._tag, "Failure");
    assert.isFalse(yield* fixture.fs.exists(`${fixture.cwd}/requests`));
  }).pipe(Effect.scoped, Effect.provide(system)),
);

it.effect("gates task preparation and receipt lookup on advertised capabilities", () =>
  Effect.gen(function* () {
    const fixture = yield* setup("unsupported");
    const { coordinator } = yield* fixture.open;
    const result = yield* prepare(coordinator, fixture.input, packet, "Fix fixture", [
      "Fixture works",
    ]).pipe(Effect.result);
    assert.equal(result._tag, "Failure");
    if (result._tag === "Failure") {
      assert.instanceOf(result.failure, Coordinator.TaskCoordinatorError);
      assert.propertyVal(result.failure, "code", "RUNTIME_UNAVAILABLE");
    }
    assert.equal((yield* coordinator.read(fixture.input)).phase, "analysis");
    const requests = yield* fixture.fs.readFileString(`${fixture.cwd}/requests`);
    assert.isFalse(requests.includes("workflow.prepare"));
    assert.isFalse(requests.includes("workflow.confirm"));
  }).pipe(Effect.scoped, Effect.provide(system)),
);

it.effect("restores the same task after SQLite and controller shutdown", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const base = yield* fs.makeTempDirectoryScoped({ prefix: "weavra-task-restart-" });
    const databasePath = `${base}/app.sqlite`;
    // Given a closed first App graph after acceptance but before a Run.
    const fixture = yield* Effect.gen(function* () {
      const fixture = yield* setup("accepted", true, base);
      const { coordinator } = yield* fixture.open;
      yield* prepare(coordinator, fixture.input, packet, "Fix fixture", ["Fixture works"]);
      yield* coordinator.confirm(fixture.input, CommandId.make("confirm"), 3);
      return fixture;
    }).pipe(Effect.provide(makeSystem(databasePath)), Effect.scoped);
    // When a fresh engine replays the durable event stream from reopened SQLite.
    const result = yield* Effect.gen(function* () {
      const { coordinator } = yield* fixture.open;
      return yield* coordinator.confirm(fixture.input, CommandId.make("second-click"), 3);
    }).pipe(Effect.provide(makeSystem(databasePath)), Effect.scoped);
    assert.equal(result.id, fixture.task.id);
    assert.deepStrictEqual(result.context, packet);
    assert.equal(result.execution?.confirmCommandId, "confirm");
    assert.equal(result.phase, "handoff");
    assert.equal(yield* fs.readFileString(`${fixture.cwd}/confirms`), "confirm\n");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("closes admission before awaiting a retained managed effect", () =>
  Effect.gen(function* () {
    const fixture = yield* setup("accepted", false, undefined, true);
    const { coordinator, runtime } = yield* fixture.open;
    yield* prepare(coordinator, fixture.input, packet, "Fix fixture", ["Fixture works"]);
    const token = fixture.retained;
    assert.ok(token);
    const entered = yield* Deferred.make<void>();
    const scopedOwnership = {
      ...fixture.ownership,
      closeAdmission: (id: typeof fixture.task.id) =>
        fixture.ownership
          .closeAdmission(id)
          .pipe(Effect.tap(() => Deferred.succeed(entered, undefined))),
    };
    const subject = yield* Coordinator.make().pipe(
      Effect.provideService(Runtime.RuntimeController, runtime),
      Effect.provideService(Ownership.WorkspaceExecutionOwnership, scopedOwnership),
    );
    const pending = yield* subject
      .confirm(fixture.input, CommandId.make("confirm"), 3)
      .pipe(Effect.forkScoped);
    yield* Deferred.await(entered);
    assert.isFalse(yield* fixture.fs.exists(`${fixture.cwd}/confirms`));
    assert.equal((yield* fixture.ownership.taskById(fixture.task.id)).ownership.state, "draining");
    const late = yield* fixture.ownership
      .acquireIndependent({ cwd: fixture.cwd, kind: "write" })
      .pipe(Effect.result);
    assert.equal(late._tag, "Failure");
    yield* fixture.ownership.release(token);
    const result = yield* Fiber.join(pending);
    assert.equal(result.phase, "handoff");
  }).pipe(Effect.scoped, Effect.provide(system)),
);

for (const status of ["RUNNING", "CANCELLED"] as const) {
  it.effect(`projects an exact ${status} receipt without inventing completion`, () =>
    Effect.gen(function* () {
      const fixture = yield* setup();
      const { coordinator } = yield* fixture.open;
      yield* prepare(coordinator, fixture.input, packet, "Fix fixture", ["Fixture works"]);
      const accepted = yield* coordinator.confirm(fixture.input, CommandId.make("confirm"), 3);
      const receipt = accepted.execution?.receipt;
      assert.ok(receipt?.status === "FOUND");
      const started: WeavraTaskReceipt = {
        ...receipt,
        admission: {
          ...receipt.admission,
          updatedAt: 2,
          outcome: { status: "STARTED", runId: "run-1" },
        },
        run: { runId: "run-1", status, revision: 2 },
      };
      yield* fixture.fs.writeFileString(`${fixture.cwd}/receipt.json`, encode(started));
      const result = yield* coordinator.reconcile(fixture.input);
      assert.equal(result.phase, status === "RUNNING" ? "running" : "finished");
      assert.equal(result.ownership.state, status === "RUNNING" ? "reconciling" : "released");
      assert.deepStrictEqual(result.execution?.receipt, started);
      assert.equal(yield* fixture.fs.readFileString(`${fixture.cwd}/confirms`), "confirm\n");
    }).pipe(Effect.scoped, Effect.provide(system)),
  );
}

it.effect("retains finished ownership when physical writer cleanup is not proven", () =>
  Effect.gen(function* () {
    const fixture = yield* setup();
    const { coordinator } = yield* fixture.open;
    yield* prepare(coordinator, fixture.input, packet, "Fix fixture", ["Fixture works"]);
    const accepted = yield* coordinator.confirm(fixture.input, CommandId.make("confirm"), 3);
    const receipt = accepted.execution?.receipt;
    assert.ok(receipt?.status === "FOUND");
    yield* fixture.fs.writeFileString(
      `${fixture.cwd}/receipt.json`,
      encode({
        ...receipt,
        admission: {
          ...receipt.admission,
          outcome: { status: "START_FAILED", reasonCode: "INITIALIZATION_FAILED" },
        },
      }),
    );
    yield* fixture.fs.makeDirectory(`${fixture.cwd}/.ai`);
    yield* fixture.fs.writeFileString(`${fixture.cwd}/.ai/writer.lock`, "unresolved writer");
    const result = yield* coordinator.reconcile(fixture.input).pipe(Effect.result);
    assert.equal(result._tag, "Failure");
    const retained = yield* fixture.ownership.taskById(fixture.task.id);
    assert.equal(retained.phase, "finished");
    assert.equal(retained.ownership.state, "reconciling");
  }).pipe(Effect.scoped, Effect.provide(system)),
);

it.effect("rejects consent for a context version replaced after preview", () =>
  Effect.gen(function* () {
    const fixture = yield* setup();
    const { coordinator } = yield* fixture.open;
    const old = yield* prepare(coordinator, fixture.input, packet, "Fix fixture", [
      "Fixture works",
    ]);
    const current = yield* prepare(
      coordinator,
      fixture.input,
      {
        ...packet,
        packetVersion: 2,
        symptom: "A different reviewed symptom",
      },
      "Fix fixture",
      ["Fixture works"],
    );
    const stale = yield* coordinator
      .confirm(fixture.input, CommandId.make("stale"), old.revision)
      .pipe(Effect.result);
    assert.equal(stale._tag, "Failure");
    assert.isFalse(yield* fixture.fs.exists(`${fixture.cwd}/confirms`));
    assert.equal((yield* coordinator.read(fixture.input)).revision, current.revision);
  }).pipe(Effect.scoped, Effect.provide(system)),
);

it.effect("keeps a reused checkout connected when its former thread is retargeted", () =>
  Effect.gen(function* () {
    const fixture = yield* setup();
    const { runtime, coordinator } = yield* fixture.open;
    yield* prepare(coordinator, fixture.input, packet, "Fix fixture", ["Fixture works"]);
    yield* fixture.ownership.releaseAnalysis(fixture.task.id);
    const nextThread = ThreadId.make("next-thread");
    yield* fixture.engine.dispatch({
      type: "thread.create",
      commandId: CommandId.make("next-thread-create"),
      projectId,
      threadId: nextThread,
      title: "Next thread",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "fixture" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt: time,
    });
    const observe = (selectedThread: ThreadId) =>
      runtime.observe(projectId, selectedThread).pipe(
        Stream.filter((value) => !value.stale || value.status === "ERROR"),
        Stream.runHead,
        Effect.timeout("10 seconds"),
      );
    const before = yield* observe(nextThread);
    assert.isTrue(Option.isSome(before));
    const alias = `${fixture.root}-old-thread`;
    yield* fixture.fs.symlink(fixture.root, alias);

    yield* fixture.engine.dispatch({
      type: "thread.meta.update",
      commandId: CommandId.make("retarget-old-thread"),
      threadId,
      worktreePath: alias,
    });

    const after = yield* observe(nextThread);
    assert.isTrue(Option.isSome(after));
    if (Option.isSome(before) && Option.isSome(after)) {
      assert.equal(after.value.status, "CONNECTED");
      assert.isFalse(after.value.stale);
      assert.equal(after.value.state?.ownerId, before.value.state?.ownerId);
    }
    const stale = yield* observe(threadId);
    assert.isTrue(Option.isSome(stale));
    if (Option.isSome(stale)) assert.equal(stale.value.errorCode, "PROJECT_CHANGED");
    assert.isFalse(yield* fixture.fs.exists(`${fixture.cwd}/confirms`));
    assert.equal(
      (yield* fixture.fs.readFileString(`${fixture.cwd}/requests`))
        .split("\n")
        .filter((request) => request === "control.hello").length,
      1,
    );
  }).pipe(Effect.scoped, Effect.provide(system)),
);

it.effect("rejects changed frozen selectors before confirmation", () =>
  Effect.gen(function* () {
    const fixture = yield* setup();
    const { coordinator } = yield* fixture.open;
    const prepared = yield* prepare(coordinator, fixture.input, packet, "Fix fixture", [
      "Fixture works",
    ]);
    const alias = `${fixture.root}-alias`;
    yield* fixture.fs.symlink(fixture.root, alias);
    yield* fixture.engine.dispatch({
      type: "thread.meta.update",
      commandId: CommandId.make("change-target"),
      threadId,
      worktreePath: alias,
    });
    const changed = yield* coordinator
      .confirm(fixture.input, CommandId.make("confirm"), prepared.revision)
      .pipe(Effect.result);
    assert.equal(changed._tag, "Failure");
    assert.isFalse(yield* fixture.fs.exists(`${fixture.cwd}/confirms`));
  }).pipe(Effect.scoped, Effect.provide(system)),
);

it.effect("preserves a known admission when a later lookup becomes UNKNOWN", () =>
  Effect.gen(function* () {
    const fixture = yield* setup();
    const { coordinator } = yield* fixture.open;
    const prepared = yield* prepare(coordinator, fixture.input, packet, "Fix fixture", [
      "Fixture works",
    ]);
    const accepted = yield* coordinator.confirm(
      fixture.input,
      CommandId.make("confirm"),
      prepared.revision,
    );
    yield* fixture.fs.remove(`${fixture.cwd}/receipt.json`);
    const result = yield* coordinator.reconcile(fixture.input).pipe(Effect.result);
    assert.equal(result._tag, "Failure");
    const current = yield* coordinator.read(fixture.input);
    assert.equal(current.phase, "attention-required");
    assert.deepStrictEqual(current.execution?.receipt, accepted.execution?.receipt);
    assert.equal(yield* fixture.fs.readFileString(`${fixture.cwd}/confirms`), "confirm\n");
  }).pipe(Effect.scoped, Effect.provide(system)),
);

it.effect("rejects a changed admission identity even with a newer receipt timestamp", () =>
  Effect.gen(function* () {
    const fixture = yield* setup();
    const { coordinator } = yield* fixture.open;
    const prepared = yield* prepare(coordinator, fixture.input, packet, "Fix fixture", [
      "Fixture works",
    ]);
    const accepted = yield* coordinator.confirm(
      fixture.input,
      CommandId.make("confirm"),
      prepared.revision,
    );
    const receipt = accepted.execution?.receipt;
    assert.ok(receipt?.status === "FOUND");
    yield* fixture.fs.writeFileString(
      `${fixture.cwd}/receipt.json`,
      encode({
        ...receipt,
        admission: {
          ...receipt.admission,
          acceptedAt: 2,
          updatedAt: 2,
          metadata: { ...receipt.admission.metadata, admittedProjectRevision: 2 },
        },
      }),
    );
    const result = yield* coordinator.reconcile(fixture.input).pipe(Effect.result);
    assert.equal(result._tag, "Failure");
    assert.deepStrictEqual((yield* coordinator.read(fixture.input)).execution?.receipt, receipt);
  }).pipe(Effect.scoped, Effect.provide(system)),
);

it.effect("requires reprepare after an unconfirmed preview owner is lost", () =>
  Effect.gen(function* () {
    const fixture = yield* setup();
    const prepared = yield* Effect.gen(function* () {
      const { coordinator } = yield* fixture.open;
      return yield* prepare(coordinator, fixture.input, packet, "Fix fixture", ["Fixture works"]);
    }).pipe(Effect.scoped);
    const { coordinator } = yield* fixture.open;
    const result = yield* coordinator
      .confirm(fixture.input, CommandId.make("confirm"), prepared.revision)
      .pipe(Effect.result);
    assert.equal(result._tag, "Failure");
    const current = yield* coordinator.read(fixture.input);
    assert.equal(current.execution?.confirmCommandId, null);
    assert.isFalse(
      (yield* fixture.fs.readFileString(`${fixture.cwd}/requests`)).includes("workflow.confirm"),
    );
  }).pipe(Effect.scoped, Effect.provide(system)),
);

const draft = { context: packet, goal: "Fix fixture", acceptanceStatements: ["Fixture works"] };
const createInput = (
  fixture: Effect.Success<ReturnType<typeof setup>>,
  command = "public-create",
) => ({
  environmentId: fixture.input.environmentId,
  projectId,
  threadId,
  commandId: CommandId.make(command),
});

it.effect("creates from trusted worktree identity and reuses only the exact command", () =>
  Effect.gen(function* () {
    const fixture = yield* setup("accepted", true, undefined, false, false);
    const { coordinator } = yield* fixture.open;
    const input = createInput(fixture);
    const task = yield* coordinator.create(input);
    assert.deepStrictEqual(yield* coordinator.create(input), task);
    assert.equal(task.checkout.canonicalCwd, fixture.cwd);
    assert.equal(task.checkout.repositoryRoot, fixture.cwd);
    assert.equal(task.target.workspaceRoot, fixture.root);
    assert.equal(task.target.worktreePath, fixture.cwd);
    assert.equal(task.execution, null);
    const events = yield* fixture.engine.readEvents(0).pipe(Stream.runCollect);
    assert.equal(events.filter((event) => event.type === "thread.weavra-task-set").length, 1);
    assert.equal((yield* coordinator.list(input)).length, 1);
    assert.isFalse(
      (yield* fixture.fs.readFileString(`${fixture.cwd}/requests`)).includes("workflow.prepare"),
    );
  }).pipe(Effect.scoped, Effect.provide(system)),
);

for (const wrong of ["environment", "project"] as const) {
  it.effect(`rejects a wrong creation ${wrong} before contacting Runtime`, () =>
    Effect.gen(function* () {
      const fixture = yield* setup("accepted", false, undefined, false, false);
      const { coordinator } = yield* fixture.open;
      const input = createInput(fixture);
      const rejected = yield* coordinator
        .create({
          ...input,
          ...(wrong === "environment"
            ? { environmentId: EnvironmentId.make("wrong") }
            : { projectId: ProjectId.make("wrong") }),
        })
        .pipe(Effect.result);
      assert.equal(rejected._tag, "Failure");
      assert.isFalse(yield* fixture.fs.exists(`${fixture.cwd}/requests`));
      assert.deepStrictEqual(yield* coordinator.listRecoverable, []);
    }).pipe(Effect.scoped, Effect.provide(system)),
  );
}

for (const sameCommand of [true, false]) {
  it.effect(
    `serializes creation races through durable CAS with ${sameCommand ? "duplicate" : "competing"} commands`,
    () =>
      Effect.gen(function* () {
        const fixture = yield* setup("accepted", false, undefined, false, false);
        const { runtime } = yield* fixture.open;
        const both = yield* Deferred.make<void>();
        let arrivals = 0;
        const barrierRuntime = {
          ...runtime,
          checkout: (...args: Parameters<typeof runtime.checkout>) =>
            runtime.checkout(...args).pipe(
              Effect.tap(() =>
                Effect.gen(function* () {
                  if (++arrivals === 2) yield* Deferred.succeed(both, undefined);
                  yield* Deferred.await(both);
                }),
              ),
            ),
        };
        const first = yield* Coordinator.make().pipe(
          Effect.provideService(Runtime.RuntimeController, barrierRuntime),
        );
        const second = yield* Coordinator.make().pipe(
          Effect.provideService(Runtime.RuntimeController, barrierRuntime),
        );
        const results = yield* Effect.all(
          [
            first.create(createInput(fixture)).pipe(Effect.result),
            second
              .create(createInput(fixture, sameCommand ? "public-create" : "competing"))
              .pipe(Effect.result),
          ],
          { concurrency: "unbounded" },
        );
        assert.equal(
          results.filter((result) => result._tag === "Success").length,
          sameCommand ? 2 : 1,
        );
        if (results[0]?._tag === "Success" && results[1]?._tag === "Success")
          assert.equal(results[0].success.id, results[1].success.id);
        assert.equal((yield* first.listRecoverable).length, 1);
        const events = yield* fixture.engine.readEvents(0).pipe(Stream.runCollect);
        assert.equal(events.filter((event) => event.type === "thread.weavra-task-set").length, 1);
      }).pipe(Effect.scoped, Effect.provide(system)),
  );
}

it.effect("reuses the released durable generation without reviving an old create", () =>
  Effect.gen(function* () {
    const fixture = yield* setup("accepted", false, undefined, false, false);
    const { coordinator } = yield* fixture.open;
    const first = yield* coordinator.create(createInput(fixture));
    const released = yield* coordinator.abortUnconfirmed(
      { ...fixture.input, taskId: first.id },
      first.revision,
    );
    const next = yield* coordinator.create(createInput(fixture, "next-create"));
    assert.equal(next.ownership.generation, released.ownership.generation + 1);
    assert.notEqual(next.id, first.id);
    assert.deepStrictEqual(yield* coordinator.create(createInput(fixture)), released);
    assert.equal((yield* coordinator.listRecoverable)[0]?.id, next.id);
  }).pipe(Effect.scoped, Effect.provide(system)),
);

it.effect(
  "refuses another thread owning the same checkout and conflicting duplicate selectors",
  () =>
    Effect.gen(function* () {
      const fixture = yield* setup("accepted", false, undefined, false, false);
      const { coordinator } = yield* fixture.open;
      const task = yield* coordinator.create(createInput(fixture));
      const other = ThreadId.make("other");
      yield* fixture.engine.dispatch({
        type: "thread.create",
        commandId: CommandId.make("other-thread-create"),
        threadId: other,
        projectId,
        title: "Other",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "unused" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt: time,
      });
      for (const commandId of [CommandId.make("other-task"), createInput(fixture).commandId]) {
        const result = yield* coordinator
          .create({ ...createInput(fixture), threadId: other, commandId })
          .pipe(Effect.result);
        assert.equal(result._tag, "Failure");
      }
      assert.deepStrictEqual(yield* coordinator.listRecoverable, [task]);
    }).pipe(Effect.scoped, Effect.provide(system)),
);

it.effect(
  "restores the entire reviewed preview from SQLite without restoring Runtime authority",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const base = yield* fs.makeTempDirectoryScoped({ prefix: "weavra-preview-restart-" });
      const databasePath = `${base}/app.sqlite`;
      const saved = yield* Effect.gen(function* () {
        const fixture = yield* setup("accepted", true, base);
        const { coordinator } = yield* fixture.open;
        const prepared = yield* coordinator.prepare(
          fixture.input,
          {
            ...draft,
            acceptanceStatements: ["First accepted criterion", "Second accepted criterion"],
            symptomVerification: { criterionIndex: 2, checkId: "symptom" },
          },
          1,
        );
        return { fixture, prepared };
      }).pipe(Effect.provide(makeSystem(databasePath)), Effect.scoped);
      yield* Effect.gen(function* () {
        const { coordinator } = yield* saved.fixture.open;
        const restored = yield* coordinator.read(saved.fixture.input);
        assert.deepStrictEqual(restored, saved.prepared);
        assert.deepStrictEqual(
          restored.execution?.preview?.acceptanceCriteria.map((item) => item.statement),
          ["First accepted criterion", "Second accepted criterion"],
        );
        assert.equal(restored.execution?.binding.symptomVerification?.criterionId, "AC-002");
        assert.equal(
          restored.execution?.binding.symptomVerification?.registrationDigest,
          `sha256:${"a".repeat(64)}`,
        );
        const recovery = yield* coordinator.reconcileAll;
        assert.equal(recovery.length, 1);
        const stale = yield* coordinator.read(saved.fixture.input);
        assert.equal(stale.phase, "attention-required");
        assert.deepStrictEqual(stale.execution?.preview, restored.execution?.preview);
        const next = yield* coordinator.reprepare(
          saved.fixture.input,
          CommandId.make("reprepare"),
          draft,
          stale.revision,
        );
        assert.notEqual(next.id, restored.id);
        assert.notEqual(
          next.execution?.binding.executionId,
          restored.execution?.binding.executionId,
        );
        assert.notEqual(next.execution?.preview?.ownerId, restored.execution?.preview?.ownerId);
        assert.equal(next.execution?.confirmCommandId, null);
        assert.equal((yield* coordinator.read(saved.fixture.input)).ownership.state, "released");
        assert.isFalse(
          (yield* fs.readFileString(`${saved.fixture.cwd}/requests`)).includes("workflow.confirm"),
        );
      }).pipe(Effect.provide(makeSystem(databasePath)), Effect.scoped);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("requires new consent after the reviewed symptom binding changes", () =>
  Effect.gen(function* () {
    const fixture = yield* setup();
    const { coordinator } = yield* fixture.open;
    const first = yield* coordinator.prepare(fixture.input, draft, 1);
    const next = yield* coordinator.prepare(
      fixture.input,
      {
        ...draft,
        symptomVerification: { criterionIndex: 1, checkId: "symptom" },
      },
      first.revision,
    );
    const oldConsent = yield* coordinator
      .confirm(fixture.input, CommandId.make("stale"), first.revision)
      .pipe(Effect.result);
    assert.equal(oldConsent._tag, "Failure");
    assert.equal(next.execution?.binding.symptomVerification?.checkId, "symptom");
    assert.equal(next.execution?.preview?.taskBinding.symptomVerification?.checkId, "symptom");
    assert.isFalse(yield* fixture.fs.exists(`${fixture.cwd}/confirms`));
  }).pipe(Effect.scoped, Effect.provide(system)),
);

it.effect("rejects stale draft revisions without replacing the reviewed packet", () =>
  Effect.gen(function* () {
    const fixture = yield* setup();
    const { coordinator } = yield* fixture.open;
    const first = yield* coordinator.prepare(fixture.input, draft, 1);
    const stale = yield* coordinator
      .prepare(
        fixture.input,
        {
          ...draft,
          context: { ...packet, packetVersion: 2, symptom: "Changed" },
        },
        1,
      )
      .pipe(Effect.result);
    assert.equal(stale._tag, "Failure");
    assert.deepStrictEqual(yield* coordinator.read(fixture.input), first);
  }).pipe(Effect.scoped, Effect.provide(system)),
);

it.effect(
  "allows explicit abort and fresh checkout preparation after unconfirmed checkout rejection",
  () =>
    Effect.gen(function* () {
      const fixture = yield* setup();
      const { coordinator } = yield* fixture.open;
      const first = yield* coordinator.prepare(fixture.input, draft, 1);
      yield* fixture.fs.writeFileString(
        `${fixture.cwd}/checkout-patch.json`,
        encode({ headCommit: "b".repeat(40) }),
      );
      const rejected = yield* coordinator
        .confirm(fixture.input, CommandId.make("confirm"), first.revision)
        .pipe(Effect.result);
      assert.equal(rejected._tag, "Failure");
      const current = yield* coordinator.read(fixture.input);
      assert.equal(current.ownership.state, "draining");
      assert.equal(current.execution?.confirmCommandId, null);
      const next = yield* coordinator.reprepare(
        fixture.input,
        CommandId.make("fresh-checkout"),
        draft,
        current.revision,
      );
      assert.equal(next.checkout.headCommit, "b".repeat(40));
      assert.equal((yield* coordinator.read(fixture.input)).ownership.state, "released");
      assert.isFalse(yield* fixture.fs.exists(`${fixture.cwd}/confirms`));
    }).pipe(Effect.scoped, Effect.provide(system)),
);

it.effect("aborts a rejected terminal drain only after the retained operation exits", () =>
  Effect.gen(function* () {
    const fixture = yield* setup("accepted", false, undefined, true, true, "terminal");
    const { coordinator } = yield* fixture.open;
    const first = yield* coordinator.prepare(fixture.input, draft, 1);
    const rejected = yield* coordinator
      .confirm(fixture.input, CommandId.make("confirm"), first.revision)
      .pipe(Effect.result);
    assert.equal(rejected._tag, "Failure");
    if (rejected._tag === "Failure") {
      assert.instanceOf(rejected.failure, Coordinator.TaskCoordinatorError);
      assert.propertyVal(rejected.failure, "code", "TERMINAL_ACTIVE");
    }
    const current = yield* coordinator.read(fixture.input);
    assert.equal(
      (yield* coordinator.abortUnconfirmed(fixture.input, current.revision).pipe(Effect.result))
        ._tag,
      "Failure",
    );
    assert.ok(fixture.retained);
    yield* fixture.ownership.release(fixture.retained);
    const aborted = yield* coordinator.abortUnconfirmed(fixture.input, current.revision);
    assert.equal(aborted.ownership.state, "released");
    assert.equal(aborted.execution?.confirmCommandId, null);
    assert.isFalse(yield* fixture.fs.exists(`${fixture.cwd}/confirms`));
  }).pipe(Effect.scoped, Effect.provide(system)),
);

it.effect(
  "never aborts or reprepares after durable confirm intent even when lookup is UNKNOWN",
  () =>
    Effect.gen(function* () {
      const fixture = yield* setup("lost");
      const { coordinator } = yield* fixture.open;
      const first = yield* coordinator.prepare(fixture.input, draft, 1);
      yield* coordinator
        .confirm(fixture.input, CommandId.make("confirm"), first.revision)
        .pipe(Effect.result);
      const current = yield* coordinator.read(fixture.input);
      for (const attempt of [
        coordinator.abortUnconfirmed(fixture.input, current.revision),
        coordinator.reprepare(fixture.input, CommandId.make("forbidden"), draft, current.revision),
      ])
        assert.equal((yield* attempt.pipe(Effect.result))._tag, "Failure");
      assert.notEqual((yield* coordinator.read(fixture.input)).ownership.state, "released");
      assert.equal(yield* fixture.fs.readFileString(`${fixture.cwd}/confirms`), "confirm\n");
    }).pipe(Effect.scoped, Effect.provide(system)),
);

const startRun = Effect.fn("coordinatorTest.startRun")(function* (
  fixture: Effect.Success<ReturnType<typeof setup>>,
  coordinator: Coordinator.TaskCoordinator["Service"],
  status: "RUNNING" | "WAITING_APPROVAL" | "CANCELLED",
) {
  const prepared = yield* coordinator.prepare(fixture.input, draft, 1);
  const accepted = yield* coordinator.confirm(
    fixture.input,
    CommandId.make("confirm"),
    prepared.revision,
  );
  const receipt = accepted.execution?.receipt;
  assert.ok(receipt?.status === "FOUND");
  const started: WeavraTaskReceipt = {
    ...receipt,
    admission: {
      ...receipt.admission,
      updatedAt: 2,
      outcome: { status: "STARTED", runId: "run-1" },
    },
    run: { runId: "run-1", status, revision: 2 },
  };
  yield* fixture.fs.writeFileString(`${fixture.cwd}/receipt.json`, encode(started));
  if (status !== "CANCELLED") {
    yield* fixture.fs.writeFileString(
      `${fixture.cwd}/state-patch.json`,
      encode({
        stateRevision: 2,
        ownedRunId: "run-1",
        busy: true,
        snapshot: {
          status: {
            source: "durable-canonical-state",
            ownerObserved: false,
            state: "available",
            writerPresent: true,
            run: {
              runId: "run-1",
              status,
              phase: "IMPLEMENT",
              workflow: "STANDARD",
              risk: "R3",
              executionMode: "EDIT",
              codeRevision: 0,
              currentStep: { stepId: "implement", attempt: 1 },
              activeAgentCount: 1,
              taskContractDigest: `sha256:${"a".repeat(64)}`,
              createdAt: 1,
              updatedAt: 2,
            },
          },
          graph: null,
          graphAvailable: false,
          evidence: null,
          configuration: { source: "project-config-not-frozen-run-config", status: "missing" },
        },
        pendingApproval:
          status === "WAITING_APPROVAL"
            ? {
                approvalId: "approval-1",
                runId: "run-1",
                stateRevision: 2,
                projectRevision: 1,
                risk: "R3",
                operation: "delete-file",
                role: "Developer",
                step: { stepId: "implement", attempt: 1 },
                path: "src/obsolete.ts",
                bytes: 1,
                preconditionDigest: "a".repeat(64),
                expiresAt: 9999999999999,
                explanation: "Delete reviewed file",
              }
            : null,
      }),
    );
  }
  return yield* coordinator.reconcile(fixture.input);
});

for (const operation of ["cancel", "approval"] as const) {
  it.effect(`binds ${operation} to the durable task and the fresh owned Run`, () =>
    Effect.gen(function* () {
      const fixture = yield* setup();
      const { coordinator } = yield* fixture.open;
      yield* startRun(
        fixture,
        coordinator,
        operation === "cancel" ? "RUNNING" : "WAITING_APPROVAL",
      );
      const invoke = (
        input: WeavraTaskReadInput,
        expectedRunId: string,
        expectedStateRevision = 2,
      ) =>
        operation === "cancel"
          ? coordinator.cancel(input, { expectedRunId, expectedStateRevision })
          : coordinator.resolveApproval(input, {
              expectedRunId,
              expectedStateRevision,
              approvalId: "approval-1",
              decision: "reject",
            });
      for (const attempt of [
        invoke(
          { ...fixture.input, taskId: WeavraTaskId.make("55555555-5555-4555-8555-555555555555") },
          "run-1",
        ),
        invoke({ ...fixture.input, environmentId: EnvironmentId.make("other") }, "run-1"),
        invoke(fixture.input, "wrong-run"),
        invoke(fixture.input, "run-1", 1),
      ])
        assert.equal((yield* attempt.pipe(Effect.result))._tag, "Failure");
      assert.isFalse(yield* fixture.fs.exists(`${fixture.cwd}/controls`));
      if (operation === "approval") {
        assert.equal((yield* coordinator.readApproval(fixture.input))?.approvalId, "approval-1");
        assert.equal(
          (yield* coordinator
            .resolveApproval(fixture.input, {
              expectedRunId: "run-1",
              expectedStateRevision: 2,
              approvalId: "other-approval",
              decision: "approve",
            })
            .pipe(Effect.result))._tag,
          "Failure",
        );
      }
      const result = yield* invoke(fixture.input, "run-1");
      assert.equal(result.phase, "running");
      const controls = yield* fixture.fs.readFileString(`${fixture.cwd}/controls`);
      assert.equal(controls.trim().split("\n").length, 1);
      assert.isTrue(
        controls.includes(
          `"type":"${operation === "cancel" ? "workflow.cancel" : "approval.resolve"}"`,
        ),
      );
      assert.notEqual(result.ownership.state, "released");
    }).pipe(Effect.scoped, Effect.provide(system)),
  );
}

it.effect("constructs evidence identity from the durable receipt and rejects stale pages", () =>
  Effect.gen(function* () {
    const fixture = yield* setup();
    const { coordinator } = yield* fixture.open;
    const task = yield* startRun(fixture, coordinator, "CANCELLED");
    assert.ok(task.execution);
    const page = {
      revision: 2,
      diffDigest: null,
      cursor: { category: "criteria" as const, index: 0 },
    };
    for (const attempt of [
      coordinator.evidence({ ...fixture.input, projectId: ProjectId.make("wrong") }, page),
      coordinator.evidence(fixture.input, { ...page, revision: 1 }),
    ])
      assert.equal((yield* attempt.pipe(Effect.result))._tag, "Failure");
    assert.isFalse(yield* fixture.fs.exists(`${fixture.cwd}/evidence-request.json`));
    const evidence = yield* coordinator.evidence(fixture.input, page);
    assert.equal(evidence.outcome.status, "CANCELLED");
    assert.equal(evidence.snapshot.executionId, task.execution?.binding.executionId);
    const request = yield* decodeEvidenceRequest(
      yield* fixture.fs.readFileString(`${fixture.cwd}/evidence-request.json`),
    );
    assert.deepStrictEqual(request.binding, {
      taskId: task.id,
      environmentId: task.environmentId,
      projectId,
      threadId,
      executionId: task.execution.binding.executionId,
      runId: "run-1",
      revision: 2,
      diffDigest: null,
    });
    assert.equal(
      (yield* coordinator
        .evidence(fixture.input, {
          ...page,
          diffDigest: "b".repeat(64),
        })
        .pipe(Effect.result))._tag,
      "Failure",
    );
  }).pipe(Effect.scoped, Effect.provide(system)),
);

for (const from of ["RUNNING", "WAITING_APPROVAL"] as const) {
  const to = from === "RUNNING" ? "CREATED" : "RUNNING";
  it.effect(`validates newer Run receipt transition ${from} to ${to}`, () =>
    Effect.gen(function* () {
      const fixture = yield* setup();
      const { coordinator } = yield* fixture.open;
      const task = yield* startRun(fixture, coordinator, from);
      const receipt = task.execution?.receipt;
      assert.ok(receipt?.status === "FOUND" && receipt.run !== null);
      const next: WeavraTaskReceipt = {
        ...receipt,
        admission: { ...receipt.admission, updatedAt: 3 },
        run: { ...receipt.run, status: to, revision: 3 },
      };
      yield* fixture.fs.writeFileString(`${fixture.cwd}/receipt.json`, encode(next));

      const result = yield* coordinator.reconcile(fixture.input).pipe(Effect.result);

      assert.equal(result._tag, from === "RUNNING" ? "Failure" : "Success");
      if (result._tag === "Failure") {
        assert.equal(result.failure._tag, "TaskCoordinatorError");
        if (result.failure._tag === "TaskCoordinatorError")
          assert.equal(result.failure.code, "INVALID_RECEIPT");
      }
      assert.deepStrictEqual(
        (yield* coordinator.read(fixture.input)).execution?.receipt,
        from === "RUNNING" ? receipt : next,
      );
      assert.equal(yield* fixture.fs.readFileString(`${fixture.cwd}/confirms`), "confirm\n");
    }).pipe(Effect.scoped, Effect.provide(system)),
  );
}

it.effect("rejects a STARTED admission regressing to ACCEPTED without losing its known Run", () =>
  Effect.gen(function* () {
    const fixture = yield* setup();
    const { coordinator } = yield* fixture.open;
    const task = yield* startRun(fixture, coordinator, "RUNNING");
    const receipt = task.execution?.receipt;
    assert.ok(receipt?.status === "FOUND");
    yield* fixture.fs.writeFileString(
      `${fixture.cwd}/receipt.json`,
      encode({
        ...receipt,
        admission: { ...receipt.admission, updatedAt: 3, outcome: { status: "ACCEPTED" } },
        run: null,
      }),
    );
    assert.equal((yield* coordinator.reconcile(fixture.input).pipe(Effect.result))._tag, "Failure");
    assert.deepStrictEqual((yield* coordinator.read(fixture.input)).execution?.receipt, receipt);
    assert.notEqual((yield* coordinator.read(fixture.input)).ownership.state, "released");
  }).pipe(Effect.scoped, Effect.provide(system)),
);

it.effect("isolates startup reconciliation failures and excludes foreign environment tasks", () =>
  Effect.gen(function* () {
    const fixture = yield* setup();
    const { coordinator } = yield* fixture.open;
    const first = yield* coordinator.prepare(fixture.input, draft, 1);
    const accepted = yield* coordinator.confirm(
      fixture.input,
      CommandId.make("confirm"),
      first.revision,
    );
    const receipt = accepted.execution?.receipt;
    assert.ok(receipt?.status === "FOUND");
    yield* fixture.fs.writeFileString(
      `${fixture.cwd}/receipt.json`,
      encode({
        ...receipt,
        admission: { ...receipt.admission, acceptedAt: 2, updatedAt: 2 },
      }),
    );
    const secondRoot = `${fixture.root}-independent`;
    yield* fixture.fs.makeDirectory(secondRoot);
    const runner = yield* ProcessRunner.ProcessRunner;
    assert.equal(
      (yield* runner.run({ command: "git", args: ["-C", secondRoot, "init", "-q"] })).code,
      0,
    );
    const secondProject = ProjectId.make("independent-project");
    const secondThread = ThreadId.make("independent-thread");
    yield* fixture.engine.dispatch({
      type: "project.create",
      commandId: CommandId.make("independent-project-create"),
      projectId: secondProject,
      title: "Independent",
      workspaceRoot: secondRoot,
      createdAt: time,
    });
    yield* fixture.engine.dispatch({
      type: "thread.create",
      commandId: CommandId.make("independent-thread-create"),
      projectId: secondProject,
      threadId: secondThread,
      title: "Independent",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "unused" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt: time,
    });
    const second = yield* coordinator.create({
      environmentId: fixture.input.environmentId,
      projectId: secondProject,
      threadId: secondThread,
      commandId: CommandId.make("independent-task-create"),
    });
    const foreign: WeavraTask = {
      ...fixture.task,
      id: WeavraTaskId.make("66666666-6666-4666-8666-666666666666"),
      environmentId: EnvironmentId.make("another-environment"),
    };
    yield* fixture.engine.dispatch({
      type: "thread.weavra-task.set",
      commandId: CommandId.make("foreign-task-create"),
      threadId,
      expectedRevision: null,
      expectedOwnershipGeneration: 0,
      task: foreign,
    });
    const recovery = yield* coordinator.reconcileAll;
    assert.equal(recovery.length, 2);
    assert.equal(recovery.find((entry) => entry.taskId === first.id)?.result._tag, "Failure");
    assert.equal(recovery.find((entry) => entry.taskId === second.id)?.result._tag, "Success");
    assert.equal((yield* coordinator.read(fixture.input)).ownership.state, "reconciling");
    assert.equal(yield* fixture.fs.readFileString(`${fixture.cwd}/confirms`), "confirm\n");
  }).pipe(Effect.scoped, Effect.provide(system)),
);

const confirmedRecoveryFixture = Effect.fn("coordinatorTest.confirmedRecovery")(function* (
  mode = "recover-safe",
) {
  const fixture = yield* setup(mode);
  const { coordinator, runtime } = yield* fixture.open;
  const prepared = yield* coordinator.prepare(fixture.input, draft, 1);
  const confirmed = yield* coordinator.confirm(
    fixture.input,
    CommandId.make("recover-original-confirm"),
    prepared.revision,
  );
  return { ...fixture, coordinator, runtime, confirmed };
});

it.effect("explicit recovery settles safe pre-Run admission and is idempotent after release", () =>
  Effect.gen(function* () {
    const f = yield* confirmedRecoveryFixture();
    const saved = f.confirmed.execution;
    const recovered = yield* f.coordinator.recover(f.input, f.confirmed.revision);
    assert.equal(recovered.phase, "finished");
    assert.equal(recovered.ownership.state, "released");
    assert.deepStrictEqual({ ...recovered.execution, receipt: null }, { ...saved, receipt: null });
    const receipt = recovered.execution?.receipt;
    assert.ok(receipt?.status === "FOUND");
    assert.equal(receipt.admission.outcome.status, "INTERRUPTED_BEFORE_START");
    assert.equal(receipt.admission.cleanup, "CONFIRMED");
    assert.equal(receipt.run, null);
    assert.deepStrictEqual(yield* f.coordinator.recover(f.input, recovered.revision), recovered);
    assert.equal((yield* f.fs.readFileString(`${f.cwd}/recoveries`)).trim().split("\n").length, 1);
    assert.equal(yield* f.fs.readFileString(`${f.cwd}/confirms`), "confirm\n");
    assert.equal(
      (yield* f.fs.readFileString(`${f.cwd}/requests`)).split("workflow.prepare").length,
      2,
    );
  }).pipe(Effect.scoped, Effect.provide(system)),
);

for (const withRun of [false, true]) {
  it.effect(
    `persists interruption with UNCONFIRMED cleanup despite absent lock (Run=${withRun})`,
    () =>
      Effect.gen(function* () {
        const f = yield* confirmedRecoveryFixture("recover-unconfirmed");
        if (withRun) {
          const receipt = f.confirmed.execution?.receipt;
          assert.ok(receipt?.status === "FOUND");
          yield* f.fs.writeFileString(
            `${f.cwd}/receipt.json`,
            encode({
              ...receipt,
              admission: {
                ...receipt.admission,
                outcome: { status: "STARTED", runId: "retained-run" },
              },
              run: { runId: "retained-run", status: "RUNNING", revision: 2 },
            }),
          );
          yield* f.coordinator.reconcile(f.input);
        }
        const before = yield* f.coordinator.read(f.input);
        const recovered = yield* f.coordinator.recover(f.input, before.revision);
        assert.equal(recovered.phase, "attention-required");
        assert.equal(recovered.ownership.state, "reconciling");
        assert.ok(recovered.execution?.receipt?.status === "FOUND");
        assert.equal(recovered.execution.receipt.admission.cleanup, "UNCONFIRMED");
        assert.equal(
          recovered.execution.receipt.run?.runId ?? null,
          withRun ? "retained-run" : null,
        );
        assert.equal(
          recovered.execution.receipt.run?.status ?? null,
          withRun ? "INTERRUPTED" : null,
        );
        assert.isFalse(yield* f.fs.exists(`${f.cwd}/.ai/writer.lock`));
        const refreshed = yield* f.coordinator.reconcile(f.input);
        assert.equal(refreshed.phase, "attention-required");
        assert.equal(refreshed.ownership.state, "reconciling");
        const denied = yield* f.ownership
          .acquireIndependent({ cwd: f.cwd, kind: "write" })
          .pipe(Effect.result);
        assert.equal(denied._tag, "Failure");
        const directRelease = yield* f.ownership
          .releaseAfterCleanup(
            f.task.id,
            Effect.succeed({
              executionId: recovered.execution.binding.executionId,
              runtimeIdle: true,
              activeAgentCount: 0,
              writerPresent: false,
            }),
          )
          .pipe(Effect.result);
        assert.equal(directRelease._tag, "Failure");
        assert.equal(yield* f.fs.readFileString(`${f.cwd}/confirms`), "confirm\n");
      }).pipe(Effect.scoped, Effect.provide(system)),
  );
}

for (const [mode, code] of [
  ["recover-live", "RECOVERY_BUSY"],
  ["recover-owner", "RECOVERY_OWNER_UNPROVEN"],
  ["recover-unsupported", "RECOVERY_UNAVAILABLE"],
  ["recover-mismatch", "INVALID_RECEIPT"],
] as const) {
  it.effect(`refuses ${mode} without replaying preparation or confirmation`, () =>
    Effect.gen(function* () {
      const f = yield* confirmedRecoveryFixture(mode);
      const result = yield* f.coordinator
        .recover(f.input, f.confirmed.revision)
        .pipe(Effect.result);
      assert.equal(result._tag, "Failure");
      if (result._tag === "Failure") assert.propertyVal(result.failure, "code", code);
      const current = yield* f.coordinator.read(f.input);
      assert.equal(current.ownership.state, "reconciling");
      assert.equal(yield* f.fs.readFileString(`${f.cwd}/confirms`), "confirm\n");
      if (mode === "recover-unsupported") assert.isFalse(yield* f.fs.exists(`${f.cwd}/recoveries`));
    }).pipe(Effect.scoped, Effect.provide(system)),
  );
}

it.effect("refuses UNKNOWN and stale selectors before recovery transport effects", () =>
  Effect.gen(function* () {
    const f = yield* confirmedRecoveryFixture();
    for (const input of [
      { ...f.input, environmentId: EnvironmentId.make("foreign") },
      { ...f.input, projectId: ProjectId.make("foreign") },
      { ...f.input, threadId: ThreadId.make("foreign") },
      { ...f.input, taskId: WeavraTaskId.make("44444444-4444-4444-8444-444444444444") },
    ])
      assert.equal(
        (yield* f.coordinator.recover(input, f.confirmed.revision).pipe(Effect.result))._tag,
        "Failure",
      );
    const stale = yield* f.coordinator
      .recover(f.input, f.confirmed.revision - 1)
      .pipe(Effect.result);
    assert.equal(stale._tag, "Failure");
    if (stale._tag === "Failure") assert.propertyVal(stale.failure, "code", "STALE_REVISION");
    assert.isFalse(yield* f.fs.exists(`${f.cwd}/recoveries`));
  }).pipe(Effect.scoped, Effect.provide(system)),
);

it.effect("UNKNOWN admission is never sent to recovery or confirmation again", () =>
  Effect.gen(function* () {
    const f = yield* setup("lost");
    yield* Effect.gen(function* () {
      const { coordinator } = yield* f.open;
      yield* coordinator.prepare(f.input, draft, 1);
      yield* coordinator.confirm(f.input, CommandId.make("original"), 3).pipe(Effect.result);
    }).pipe(Effect.scoped);
    yield* f.fs.remove(`${f.cwd}/receipt.json`);
    const { coordinator } = yield* f.open;
    const unknown = yield* coordinator.reconcile(f.input);
    const denied = yield* coordinator.recover(f.input, unknown.revision).pipe(Effect.result);
    assert.equal(denied._tag, "Failure");
    if (denied._tag === "Failure") assert.propertyVal(denied.failure, "code", "RECOVERY_UNKNOWN");
    assert.isFalse(yield* f.fs.exists(`${f.cwd}/recoveries`));
    assert.equal(yield* f.fs.readFileString(`${f.cwd}/confirms`), "confirm\n");
  }).pipe(Effect.scoped, Effect.provide(system)),
);

it.effect(
  "lost recovery reply restores canonical cleanup through read-only restart reconciliation",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const base = yield* fs.makeTempDirectoryScoped({ prefix: "weavra-recover-restart-" });
      const databasePath = `${base}/app.sqlite`;
      const f = yield* Effect.gen(function* () {
        const f = yield* setup("recover-lost", false, base);
        const { coordinator } = yield* f.open;
        yield* coordinator.prepare(f.input, draft, 1);
        const confirmed = yield* coordinator.confirm(f.input, CommandId.make("original"), 3);
        const lost = yield* coordinator.recover(f.input, confirmed.revision).pipe(Effect.result);
        assert.equal(lost._tag, "Failure");
        return f;
      }).pipe(Effect.provide(makeSystem(databasePath)), Effect.scoped);
      yield* Effect.gen(function* () {
        const { coordinator } = yield* f.open;
        const recovered = yield* coordinator.reconcile(f.input);
        assert.equal(recovered.phase, "attention-required");
        assert.equal(recovered.ownership.state, "reconciling");
        assert.ok(recovered.execution?.receipt?.status === "FOUND");
        assert.equal(recovered.execution.receipt.admission.cleanup, "UNCONFIRMED");
        assert.equal(
          recovered.execution.receipt.admission.outcome.status,
          "INTERRUPTED_BEFORE_START",
        );
        assert.equal(yield* fs.readFileString(`${f.cwd}/confirms`), "confirm\n");
        assert.equal(
          (yield* fs.readFileString(`${f.cwd}/recoveries`)).trim().split("\n").length,
          1,
        );
      }).pipe(Effect.provide(makeSystem(databasePath)), Effect.scoped);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("stale recovery authority cannot cross the effect boundary", () =>
  Effect.gen(function* () {
    const f = yield* confirmedRecoveryFixture();
    const receipt = f.confirmed.execution?.receipt;
    assert.ok(receipt?.status === "FOUND");
    let effects = 0;
    const denied = yield* f.ownership
      .withTaskControl(
        f.task.id,
        Effect.gen(function* () {
          yield* f.ownership.reconcile(f.task.id);
          return yield* f.ownership.withControlOperation(
            f.cwd,
            {
              type: "workflow.recover",
              metadata: receipt.admission.metadata,
            },
            () =>
              Effect.sync(() => {
                effects++;
              }),
          );
        }),
      )
      .pipe(Effect.result);
    assert.equal(denied._tag, "Failure");
    assert.equal(effects, 0);
    assert.equal((yield* f.ownership.activeOperations).length, 0);
  }).pipe(Effect.scoped, Effect.provide(system)),
);

it.effect("raw Settings recovery cannot use an independent permit after task release", () =>
  Effect.gen(function* () {
    const f = yield* confirmedRecoveryFixture();
    const settled = yield* f.coordinator.recover(f.input, f.confirmed.revision);
    const receipt = settled.execution?.receipt;
    assert.ok(receipt?.status === "FOUND");
    assert.equal(settled.ownership.state, "released");
    let effects = 0;
    const denied = yield* f.ownership
      .withControlOperation(
        f.cwd,
        {
          type: "workflow.recover",
          metadata: receipt.admission.metadata,
        },
        () =>
          Effect.sync(() => {
            effects++;
          }),
      )
      .pipe(Effect.result);
    assert.equal(denied._tag, "Failure");
    assert.equal(effects, 0);
    assert.equal((yield* f.ownership.activeOperations).length, 0);
  }).pipe(Effect.scoped, Effect.provide(system)),
);

for (const regression of ["UNKNOWN", "missing-cleanup", "NOT_STARTED"] as const) {
  it.effect(`never forgets durable unconfirmed cleanup (${regression})`, () =>
    Effect.gen(function* () {
      const f = yield* confirmedRecoveryFixture("recover-unconfirmed");
      const recovered = yield* f.coordinator.recover(f.input, f.confirmed.revision);
      const receipt = recovered.execution?.receipt;
      assert.ok(receipt?.status === "FOUND");
      const { cleanup: _cleanup, ...admission } = receipt.admission;
      yield* f.fs.writeFileString(
        `${f.cwd}/receipt.json`,
        encode(
          regression === "UNKNOWN"
            ? { status: "UNKNOWN", executionId: receipt.executionId }
            : {
                ...receipt,
                admission: {
                  ...admission,
                  ...(regression === "NOT_STARTED" ? { cleanup: "NOT_STARTED" } : {}),
                },
              },
        ),
      );
      const refused = yield* f.coordinator.reconcile(f.input).pipe(Effect.result);
      assert.equal(refused._tag, "Failure");
      if (refused._tag === "Failure")
        assert.propertyVal(refused.failure, "code", "INVALID_RECEIPT");
      const current = yield* f.coordinator.read(f.input);
      assert.deepStrictEqual(current.execution?.receipt, receipt);
      assert.equal(current.ownership.state, "reconciling");
    }).pipe(Effect.scoped, Effect.provide(system)),
  );
}

it.effect("retains recovery operation until response, denying release and other mutations", () =>
  Effect.gen(function* () {
    const f = yield* confirmedRecoveryFixture();
    const receipt = f.confirmed.execution?.receipt;
    assert.ok(receipt?.status === "FOUND");
    yield* f.ownership.reconcile(f.task.id);
    const entered = yield* Deferred.make<void>();
    const finish = yield* Deferred.make<void>();
    const operation = yield* f.ownership
      .withTaskControl(
        f.task.id,
        f.ownership.withControlOperation(
          f.cwd,
          {
            type: "workflow.recover",
            metadata: receipt.admission.metadata,
          },
          () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(finish))),
        ),
      )
      .pipe(Effect.forkScoped);
    yield* Deferred.await(entered);
    assert.equal((yield* f.ownership.activeOperations).length, 1);
    const denied = yield* f.ownership
      .acquireIndependent({ cwd: f.cwd, kind: "write" })
      .pipe(Effect.result);
    assert.equal(denied._tag, "Failure");
    const mismatched = yield* f.ownership
      .withTaskControl(
        f.task.id,
        f.ownership.withControlOperation(
          f.cwd,
          {
            type: "workflow.recover",
            metadata: { ...receipt.admission.metadata, configDigest: `sha256:${"b".repeat(64)}` },
          },
          () => Effect.die("mismatched recovery must not enter its effect"),
        ),
      )
      .pipe(Effect.result);
    assert.equal(mismatched._tag, "Failure");
    yield* Deferred.succeed(finish, undefined);
    yield* Fiber.join(operation);
    assert.equal((yield* f.ownership.activeOperations).length, 0);
  }).pipe(Effect.scoped, Effect.provide(system)),
);
