import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import {
  ProjectId,
  type OrchestrationProjectShell,
  WEAVRA_CONTROL_COMMANDS,
  type WeavraBrowserCandidateSummary,
  type WeavraComplexDraft,
  type WeavraComplexExecution,
  WeavraComplexPlan,
  type WeavraControlCapabilities,
  type WeavraControlMutation,
  type WeavraControlObservation,
  type WeavraControlPreview,
  WeavraControlState,
  WeavraTaskContract,
} from "@t3tools/contracts";
import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { describe, expect } from "vite-plus/test";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { writeFakeCli } from "../testUtils/fakeCli.ts";
import {
  complexPlanDigest,
  complexPreviewConsistent,
  complexStateConsistent,
  previewTaskContractDigest,
  taskContractDigest,
} from "./ComplexProjection.ts";
import { make } from "./RuntimeController.ts";
// Shared cross-side reference: the Runtime lane keeps its own copy of the same fixture.
import reference from "./testFixtures/complexContractV1.json" with { type: "json" };

const projectId = ProjectId.make("control-project");
const decodeCanonical = Schema.decodeEffect(Schema.fromJsonString(WeavraControlState));
const encodeJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const browserCandidate: WeavraBrowserCandidateSummary = {
  schemaVersion: 2,
  kind: "BROWSER_OBSERVATION_CANDIDATE",
  candidateId: "00000000-0000-4000-8000-000000000001",
  projectId: `sha256:${"a".repeat(64)}`,
  authority: "CANDIDATE_ONLY",
  scope: "LOCAL_STATIC_DOCUMENT",
  origin: "http://127.0.0.1:3880",
  documentIdentity: "http://127.0.0.1:3880/status",
  capturedAt: 100,
  pageRevision: `sha256:${"a".repeat(64)}`,
  source: {
    implementationRevision: `sha256:${"a".repeat(64)}`,
    readerRevision: "a".repeat(40),
    readerDigest: `sha256:${"a".repeat(64)}`,
    executableIdentityDigest: `sha256:${"a".repeat(64)}`,
    browserVersion: "Fixture",
  },
  freshness: { mode: "CAPTURE_ONLY", startedAt: 90, finishedAt: 100 },
  observationDigest: `sha256:${"a".repeat(64)}`,
  observationType: "target",
  observation: { target: { selector: "#status" }, exists: true, value: "Ready" },
  candidateDigest: `sha256:${"a".repeat(64)}`,
  cleanup: "CONFIRMED",
};
const registration = {
  candidateId: browserCandidate.candidateId,
  expectedCandidateDigest: browserCandidate.candidateDigest,
  checkId: "status-ready",
  origin: browserCandidate.origin,
  documentIdentity: browserCandidate.documentIdentity,
  target: browserCandidate.observation.target,
  assertion: { type: "text_equals" as const, expected: "Reviewed Ready" },
  freshness: { mode: "NEW_ISOLATED_CAPTURE" as const, maxAgeMs: 15000 },
};
// A protocol peer for adapter lifecycle tests, not Runtime completion evidence.
const source = `
import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
if(process.argv.slice(2).join('|')!=='bridge|--stdio|--project-trusted|--control')process.exit(41);
const mode=process.env.MODE;
const launch=existsSync('launch-count')?Number(readFileSync('launch-count','utf8'))+1:1;
writeFileSync('launch-count',String(launch));
const ownerId='owner-'+launch;
process.on('SIGTERM',()=>{writeFileSync('closed',String(launch));process.exit(0)});
const digest='sha256:'+'a'.repeat(64);
const candidate=${encodeJson(browserCandidate)};
let sequence=1;
const receipts=new Map();
const empty={status:{source:'durable-canonical-state',ownerObserved:false,state:'missing',writerPresent:false,run:null},graph:null,graphAvailable:false,evidence:null,configuration:{source:'project-config-not-frozen-run-config',status:'missing'}};
let state={ownerId,nextRequestId:ownerId+':1',projectRevision:0,stateRevision:null,ownedRunId:null,busy:false,cancelling:false,startFailure:null,preview:null,browserPreview:null,factPreview:null,projectFacts:{status:'available',entries:[]},pendingApproval:null,snapshot:empty};
if(existsSync('canonical.json')){const old=JSON.parse(readFileSync('canonical.json','utf8'));state={...old,ownerId,nextRequestId:ownerId+':1',ownedRunId:null,busy:false,cancelling:false,preview:null,browserPreview:null,factPreview:null,pendingApproval:null};}
const complex=mode==='complex';
const capabilities={authority:'Runtime/Kernel',control:'workflow-control-v1',ownerId,commands:['control.hello','control.snapshot','workflow.prepare','workflow.confirm','workflow.cancel','approval.resolve','browser.inspect','browser.prepare','browser.confirm','facts.prepare','facts.confirm'],maxRequestBytes:32768,maxResponseBytes:65536,resultLimit:64,previewTtlMs:300000,runtimeVersion:'0.85.1',readiness:mode==='not-setup'&&launch===1?'NOT_SETUP':'READY',...(complex?{complexContractVersion:1}:{}),recipes:[]};
const reply=(request,data,error)=>({protocolVersion:1,type:'control_response',id:request.id,command:request.type,ownerId,runId:state.snapshot.status.run?.runId??null,stateRevision:state.stateRevision,projectRevision:state.projectRevision,eventId:null,timestamp:1000,success:!error,...(error?{error:{code:error}}:{data})});
const save=()=>writeFileSync('canonical.json',JSON.stringify(state));
for await(const line of createInterface({input:process.stdin})){
 const request=JSON.parse(line);let response;
 if(request.type==='control.hello')response=reply(request,{kind:'capabilities',capabilities});
 else if(request.type==='control.snapshot'){
  if(mode==='broker'){
   if(existsSync('disconnect')&&launch===1)process.exit(0);
   const inventory=existsSync('broker.json')?JSON.parse(readFileSync('broker.json','utf8')):{schemaVersion:1,coverage:'RUNTIME_ACTION_TOOLS',ownerId,projectRevision:state.projectRevision,brokerEpoch:'12345678-1234-1234-1234-123456789abc',generation:1,status:'CURRENT',reason:'OBSERVED',observedAt:1,entries:[],total:0,omitted:0};
   if(inventory===null)delete state.capabilityInventory;else state.capabilityInventory=inventory;
  }
  if(existsSync('state-patch.json'))Object.assign(state,JSON.parse(readFileSync('state-patch.json','utf8')));
  if(existsSync('settle')&&state.busy){state.snapshot.status.run.status=state.cancelling?'CANCELLED':existsSync('decision')&&readFileSync('decision','utf8')==='reject'?'BLOCKED':'COMPLETED';state.snapshot.status.run.phase='COMPLETE';state.snapshot.status.writerPresent=false;state.busy=false;state.cancelling=false;state.pendingApproval=null;state.projectRevision++;state.stateRevision++;save();}
  response=reply(request,{kind:'snapshot',state});
 }else{
  appendFileSync('requests',request.type+'\\n');
  if(receipts.has(request.id)){const old=receipts.get(request.id);response=old.line===line?old.response:reply(request,null,'REQUEST_ID_REUSED');}
  else if(request.ownerId!==ownerId)response=reply(request,null,'OWNER_CHANGED');
  else if(request.expectedProjectRevision!==state.projectRevision)response=reply(request,null,'STALE_PROJECT');
  else{
   state.nextRequestId=ownerId+':'+(++sequence);
   if(request.type==='browser.inspect'){
    response=reply(request,{kind:'browser-state',state:{projectId:digest,candidates:[candidate],omittedCandidates:0,checks:existsSync('browser-check.json')?[{check:JSON.parse(readFileSync('browser-check.json','utf8')),required:true}]:[],omittedChecks:0,evidence:[],omittedEvidence:0}});
   }else if(request.type==='browser.prepare'){
    const {candidateId,expectedCandidateDigest,...definition}=request.registration;
    state.browserPreview={previewId:'browser-preview',previewDigest:digest,ownerId,projectRevision:state.projectRevision,expiresAt:9999999999999,candidate:mode==='browser-wrong-candidate'?{...candidate,candidateId:'00000000-0000-4000-8000-000000000002'}:candidate,check:{version:1,projectId:digest,...definition,registrationDigest:digest},isolation:'PRIVATE_HOME_PROFILE_CDP_PIPE_NOT_OS_SANDBOX'};
    response=reply(request,{kind:'browser-prepared',preview:state.browserPreview});
   }else if(request.type==='browser.confirm'){
    const check=state.browserPreview.check;writeFileSync('browser-check.json',JSON.stringify(check));state.browserPreview=null;
    response=reply(request,{kind:'browser-registered',check});
   }else if(request.type==='workflow.prepare'&&request.complexDraft){
    if(!complex)response=reply(request,null,'INVALID_REQUEST');
    else{state.preview={...JSON.parse(readFileSync('complex-preview.json','utf8')),ownerId,projectRevision:state.projectRevision};response=reply(request,{kind:'prepared',preview:state.preview});}
   }else if(request.type==='workflow.prepare'){
    state.preview={previewId:'preview',previewDigest:digest,ownerId,projectRevision:state.projectRevision,expiresAt:9999999999999,goal:request.goal,workflow:'STANDARD',executionMode:'EDIT',risk:mode==='approval'?'R3':'R1',allowedPaths:['src'],checks:[],acceptanceCriteria:[{id:'AC-1',statement:request.goal,checkIds:[],reviewRequired:true}],taskContractDigest:digest,recipe:null,configuration:{mutationMode:'compatible',verifierTrustMode:'compatible',verifierSandboxMode:'disabled',contextPackMode:'disabled',verificationRepairMode:'disabled',lspEnabled:false}};
    response=reply(request,{kind:'prepared',preview:state.preview});
   }else if(request.type==='workflow.confirm'){
    state.preview=null;state.projectRevision++;state.stateRevision=1;state.ownedRunId='run-1';state.busy=true;
    state.snapshot.status={source:'durable-canonical-state',ownerObserved:false,state:'available',writerPresent:true,run:{runId:'run-1',status:mode==='approval'?'WAITING_APPROVAL':'RUNNING',phase:'IMPLEMENT',workflow:'STANDARD',risk:mode==='approval'?'R3':'R1',executionMode:'EDIT',codeRevision:0,currentStep:{stepId:'implement',attempt:0},activeAgentCount:1,taskContractDigest:digest,createdAt:1,updatedAt:1}};
    if(mode==='approval')state.pendingApproval={approvalId:'approval-1',runId:'run-1',stateRevision:1,projectRevision:state.projectRevision,risk:'R3',operation:'delete-file',role:'Developer',step:{stepId:'implement',attempt:0},path:'src/old.js',bytes:4,preconditionDigest:'b'.repeat(64),expiresAt:9999999999999,explanation:'Delete one tracked file'};
    save();writeFileSync('confirm-received','yes');
    if(mode==='exit-confirm'&&launch===1)process.exit(0);
    if(mode==='delay-confirm')while(!existsSync('release'))await new Promise(r=>setTimeout(r,5));
    response=reply(request,{kind:'accepted',requestId:request.id,command:request.type,runId:null});
   }else{
    if(request.expectedStateRevision!==state.stateRevision)response=reply(request,null,'STALE_RUN');
    else{if(request.type==='workflow.cancel')state.cancelling=true;else{writeFileSync('decision',request.decision);state.pendingApproval=null;}response=reply(request,{kind:'accepted',requestId:request.id,command:request.type,runId:state.ownedRunId});}
   }
   receipts.set(request.id,{line,response});
  }
 }
 process.stdout.write(JSON.stringify(response)+'\\n');
 process.stderr.write('PRIVATE_CONTROL_STDERR_MARKER\\n');
}
`;
function project(workspaceRoot: string): OrchestrationProjectShell {
  return {
    id: projectId,
    title: "Fixture",
    workspaceRoot,
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-20T00:00:00.000Z",
  };
}
function next(
  queue: Queue.Queue<WeavraControlObservation>,
  predicate: (value: WeavraControlObservation) => boolean,
) {
  return Stream.fromQueue(queue).pipe(
    Stream.filter(predicate),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );
}
const connected = (queue: Queue.Queue<WeavraControlObservation>) =>
  next(queue, (value) => value.status === "CONNECTED" && !value.stale);
const setup = Effect.fn("test.control.setup")(function* (mode = "normal") {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "weavra-control-owner-" });
  const executable = writeFakeCli({
    directory: root,
    name: "control owner",
    source,
    env: { MODE: mode },
  });
  let selected: OrchestrationProjectShell | undefined = project(root);
  const controller = yield* make().pipe(
    Effect.provide(
      Layer.mock(ProjectionSnapshotQuery)({
        getProjectShellById: (id) =>
          Effect.sync(() => (id === projectId ? Option.fromUndefinedOr(selected) : Option.none())),
      }),
    ),
    Effect.provideService(HostProcessEnvironment, {
      PATH: process.env.PATH,
      T3_WEAVRA_EXECUTABLE: executable,
      T3_WEAVRA_CONTROL: "1",
    }),
  );
  const queue = yield* Queue.unbounded<WeavraControlObservation>();
  const consumer = yield* controller.observe(projectId).pipe(
    Stream.runForEach((value) => Queue.offer(queue, value)),
    Effect.forkScoped,
  );
  const initial =
    mode === "not-setup"
      ? yield* next(queue, (value) => value.status === "NOT_SETUP")
      : yield* connected(queue);
  return {
    fs,
    root,
    controller,
    queue,
    consumer,
    initial,
    select: (value: OrchestrationProjectShell | undefined) => {
      selected = value;
    },
  };
});
function fields(state: WeavraControlState) {
  return {
    protocolVersion: 1 as const,
    id: state.nextRequestId,
    ownerId: state.ownerId,
    expectedProjectRevision: state.projectRevision,
  };
}
const start = Effect.fn("test.control.start")(function* (
  fixture: Effect.Success<ReturnType<typeof setup>>,
) {
  const state = fixture.initial.state!;
  const prepared = yield* fixture.controller.command({
    projectId,
    request: { ...fields(state), type: "workflow.prepare", goal: "Fix fixture" },
  });
  if (!prepared.success || prepared.data.kind !== "prepared")
    throw new Error("Missing Runtime plan");
  const planned = (yield* connected(fixture.queue)).state!;
  const request = {
    ...fields(planned),
    type: "workflow.confirm" as const,
    previewId: prepared.data.preview.previewId,
    previewDigest: prepared.data.preview.previewDigest,
  };
  const response = yield* fixture.controller.command({ projectId, request });
  return { request, response, state: (yield* connected(fixture.queue)).state! };
});
const waitFile = Effect.fn("test.control.waitFile")(function* (
  fs: FileSystem.FileSystem,
  file: string,
) {
  yield* fs.exists(file).pipe(Effect.repeat({ until: Boolean }));
});

it.effect(
  "retains execution across all consumer disconnects and converges only from canonical snapshots",
  () =>
    Effect.gen(function* () {
      const fixture = yield* setup();
      const { response, state } = yield* start(fixture);
      expect(response).toMatchObject({ success: true, data: { kind: "accepted", runId: null } });
      expect(state.snapshot.status).toMatchObject({
        writerPresent: true,
        run: { status: "RUNNING" },
      });
      yield* Fiber.interrupt(fixture.consumer);
      expect(yield* fixture.fs.exists(`${fixture.root}/closed`)).toBe(false);
      const second = yield* Queue.unbounded<WeavraControlObservation>();
      yield* fixture.controller.observe(projectId).pipe(
        Stream.runForEach((value) => Queue.offer(second, value)),
        Effect.forkScoped,
      );
      expect((yield* connected(second)).state?.ownerId).toBe(state.ownerId);
      expect(yield* fixture.fs.readFileString(`${fixture.root}/launch-count`)).toBe("1");
      yield* fixture.fs.writeFileString(`${fixture.root}/settle`, "finish");
      yield* TestClock.adjust("2 seconds");
      const final = yield* next(
        second,
        (value) => value.state?.snapshot.status.run?.status === "COMPLETED",
      );
      expect(final.state).toMatchObject({
        busy: false,
        snapshot: { status: { writerPresent: false } },
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("returns Runtime duplicate and stale decisions without a second start", () =>
  Effect.gen(function* () {
    const fixture = yield* setup();
    const started = yield* start(fixture);
    expect(yield* fixture.controller.command({ projectId, request: started.request })).toEqual(
      started.response,
    );
    const conflict = yield* fixture.controller.command({
      projectId,
      request: { ...started.request, previewId: "changed" },
    });
    expect(conflict).toMatchObject({ success: false, error: { code: "REQUEST_ID_REUSED" } });
    const stale = yield* fixture.controller.command({
      projectId,
      request: {
        ...fields(started.state),
        expectedProjectRevision: 0,
        type: "workflow.cancel",
        runId: "run-1",
        expectedStateRevision: 1,
      },
    });
    expect(stale).toMatchObject({ success: false, error: { code: "STALE_PROJECT" } });
    const wrongRevision = yield* fixture.controller.command({
      projectId,
      request: {
        ...fields(started.state),
        type: "workflow.cancel",
        runId: "run-1",
        expectedStateRevision: 0,
      },
    });
    expect(wrongRevision).toMatchObject({ success: false, error: { code: "STALE_RUN" } });
    const canonical = yield* decodeCanonical(
      yield* fixture.fs.readFileString(`${fixture.root}/canonical.json`),
    );
    expect(canonical.snapshot.status.run?.status).toBe("RUNNING");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("cancel acknowledgement leaves RUNNING and writer present until canonical cleanup", () =>
  Effect.gen(function* () {
    const fixture = yield* setup();
    const started = yield* start(fixture);
    const response = yield* fixture.controller.command({
      projectId,
      request: {
        ...fields(started.state),
        type: "workflow.cancel",
        runId: "run-1",
        expectedStateRevision: 1,
      },
    });
    expect(response).toMatchObject({
      success: true,
      data: { command: "workflow.cancel", kind: "accepted" },
    });
    const pending = (yield* connected(fixture.queue)).state!;
    expect(pending).toMatchObject({
      cancelling: true,
      snapshot: { status: { writerPresent: true, run: { status: "RUNNING" } } },
    });
    yield* fixture.fs.writeFileString(`${fixture.root}/settle`, "cleanup");
    yield* TestClock.adjust("2 seconds");
    expect(
      (yield* next(
        fixture.queue,
        (value) => value.state?.snapshot.status.run?.status === "CANCELLED",
      )).state,
    ).toMatchObject({ busy: false, snapshot: { status: { writerPresent: false } } });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
for (const decision of ["approve", "reject"] as const) {
  it.effect(
    `forwards only a pending ${decision} and observes the independent canonical outcome`,
    () =>
      Effect.gen(function* () {
        const fixture = yield* setup("approval");
        const started = yield* start(fixture);
        const pending = started.state.pendingApproval!;
        const response = yield* fixture.controller.command({
          projectId,
          request: {
            ...fields(started.state),
            type: "approval.resolve",
            runId: pending.runId,
            expectedStateRevision: pending.stateRevision,
            approvalId: pending.approvalId,
            decision,
          },
        });
        expect(response).toMatchObject({ success: true, data: { kind: "accepted" } });
        const acknowledged = (yield* connected(fixture.queue)).state!;
        expect(acknowledged.snapshot.status.run?.status).toBe("WAITING_APPROVAL");
        expect(yield* fixture.fs.readFileString(`${fixture.root}/decision`)).toBe(decision);
        yield* fixture.fs.writeFileString(`${fixture.root}/settle`, "canonical");
        yield* TestClock.adjust("2 seconds");
        const final = yield* next(
          fixture.queue,
          (value) =>
            value.state?.snapshot.status.run?.status ===
            (decision === "approve" ? "COMPLETED" : "BLOCKED"),
        );
        expect(final.state?.pendingApproval).toBeNull();
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
}

it.effect("caller interruption does not interrupt an already accepted server-owned command", () =>
  Effect.gen(function* () {
    const fixture = yield* setup("delay-confirm");
    const call = yield* start(fixture).pipe(Effect.forkScoped);
    yield* waitFile(fixture.fs, `${fixture.root}/confirm-received`);
    yield* Fiber.interrupt(call);
    yield* Fiber.interrupt(fixture.consumer);
    expect(yield* fixture.fs.exists(`${fixture.root}/closed`)).toBe(false);
    yield* fixture.fs.writeFileString(`${fixture.root}/release`, "reply");
    const second = yield* Queue.unbounded<WeavraControlObservation>();
    yield* fixture.controller.observe(projectId).pipe(
      Stream.runForEach((value) => Queue.offer(second, value)),
      Effect.forkScoped,
    );
    const running = yield* next(
      second,
      (value) => value.state?.snapshot.status.run?.status === "RUNNING",
    );
    expect(running.state?.busy).toBe(true);
    expect(
      (yield* fixture.fs.readFileString(`${fixture.root}/requests`))
        .split("\n")
        .filter((value) => value === "workflow.confirm"),
    ).toHaveLength(1);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("process loss after acceptance reconnects observation without replaying a mutation", () =>
  Effect.gen(function* () {
    const fixture = yield* setup("exit-confirm");
    const lost = yield* start(fixture).pipe(Effect.result);
    expect(lost).toMatchObject({ _tag: "Failure", failure: { code: "TRANSPORT_CLOSED" } });
    yield* next(fixture.queue, (value) => value.stale && value.status === "DISCONNECTED");
    yield* TestClock.adjust("5 seconds");
    const fresh = (yield* connected(fixture.queue)).state!;
    expect(fresh).toMatchObject({
      ownerId: "owner-2",
      ownedRunId: null,
      busy: false,
      snapshot: { status: { writerPresent: true, run: { status: "RUNNING" } } },
    });
    expect(
      (yield* fixture.fs.readFileString(`${fixture.root}/requests`))
        .split("\n")
        .filter((value) => value === "workflow.confirm"),
    ).toHaveLength(1);
    const old: WeavraControlMutation = {
      protocolVersion: 1,
      id: "owner-1:2",
      ownerId: "owner-1",
      expectedProjectRevision: 0,
      type: "workflow.confirm",
      previewId: "preview",
      previewDigest: `sha256:${"a".repeat(64)}`,
    };
    expect(yield* fixture.controller.command({ projectId, request: old })).toMatchObject({
      success: false,
      error: { code: "OWNER_CHANGED" },
    });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("reopens a stopped not-setup owner after explicit resubscription", () =>
  Effect.gen(function* () {
    const fixture = yield* setup("not-setup");
    yield* waitFile(fixture.fs, `${fixture.root}/closed`);
    yield* Fiber.interrupt(fixture.consumer);
    const observation = yield* fixture.controller.observe(projectId).pipe(
      Stream.filter((value) => value.status === "CONNECTED"),
      Stream.runHead,
    );
    expect(Option.getOrThrow(observation).state?.ownerId).toBe("owner-2");
    expect(yield* fixture.fs.readFileString(`${fixture.root}/launch-count`)).toBe("2");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("does not create a control process before observation or for a forged project", () =>
  Effect.gen(function* () {
    const fixture = yield* setup();
    const request = {
      ...fields(fixture.initial.state!),
      type: "workflow.prepare" as const,
      goal: "Fix fixture",
    };
    expect(
      yield* fixture.controller
        .command({ projectId: ProjectId.make("forged"), request })
        .pipe(Effect.result),
    ).toMatchObject({ _tag: "Failure", failure: { code: "PROJECT_UNAVAILABLE" } });
    expect(yield* fixture.fs.exists(`${fixture.root}/requests`)).toBe(false);
    fixture.select(undefined);
    expect(
      yield* fixture.controller.command({ projectId, request }).pipe(Effect.result),
    ).toMatchObject({ _tag: "Failure", failure: { code: "PROJECT_UNAVAILABLE" } });
    yield* TestClock.adjust("2 seconds");
    expect(
      yield* next(fixture.queue, (value) => value.errorCode === "PROJECT_UNAVAILABLE"),
    ).toMatchObject({ state: null, stale: true });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("rejects a changed canonical root before forwarding another mutation", () =>
  Effect.gen(function* () {
    const fixture = yield* setup();
    const started = yield* start(fixture);
    const replacement = yield* fixture.fs.makeTempDirectoryScoped({ prefix: "weavra-other-root-" });
    fixture.select(project(replacement));
    const result = yield* fixture.controller
      .command({
        projectId,
        request: {
          ...fields(started.state),
          type: "workflow.cancel",
          runId: "run-1",
          expectedStateRevision: 1,
        },
      })
      .pipe(Effect.result);
    expect(result).toMatchObject({ _tag: "Failure", failure: { code: "TRANSPORT_CLOSED" } });
    expect(
      (yield* fixture.fs.readFileString(`${fixture.root}/requests`)).includes("workflow.cancel"),
    ).toBe(false);
    yield* TestClock.adjust("2 seconds");
    expect(
      yield* next(fixture.queue, (value) => value.errorCode === "PROJECT_CHANGED"),
    ).toMatchObject({ stale: true, state: null });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect(
  "forwards browser review and confirmation while keeping registration separate from Run evidence",
  () =>
    Effect.gen(function* () {
      const fixture = yield* setup();
      const inspected = yield* fixture.controller.command({
        projectId,
        request: { ...fields(fixture.initial.state!), type: "browser.inspect" },
      });
      expect(inspected).toMatchObject({
        success: true,
        data: {
          kind: "browser-state",
          state: { candidates: [browserCandidate], checks: [], evidence: [] },
        },
      });
      const inspectedState = (yield* connected(fixture.queue)).state!;
      const prepared = yield* fixture.controller.command({
        projectId,
        request: { ...fields(inspectedState), type: "browser.prepare", registration },
      });
      if (!prepared.success || prepared.data.kind !== "browser-prepared")
        throw new Error("Missing browser preview");
      expect(prepared.data.preview.check.assertion).toEqual(registration.assertion);
      expect(yield* fixture.fs.exists(`${fixture.root}/browser-check.json`)).toBe(false);
      const planned = (yield* connected(fixture.queue)).state!;
      const confirmed = yield* fixture.controller.command({
        projectId,
        request: {
          ...fields(planned),
          type: "browser.confirm",
          previewId: prepared.data.preview.previewId,
          previewDigest: prepared.data.preview.previewDigest,
        },
      });
      expect(confirmed).toMatchObject({
        success: true,
        data: { kind: "browser-registered", check: prepared.data.preview.check },
      });
      const canonical = (yield* connected(fixture.queue)).state!;
      expect(canonical.snapshot.status.run).toBeNull();
      expect(canonical.snapshot.evidence).toBeNull();
      expect(canonical.browserPreview).toBeNull();
      const refreshed = yield* fixture.controller.command({
        projectId,
        request: { ...fields(canonical), type: "browser.inspect" },
      });
      expect(refreshed).toMatchObject({
        success: true,
        data: {
          kind: "browser-state",
          state: {
            checks: [{ check: prepared.data.preview.check, required: true }],
            evidence: [],
          },
        },
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("rejects a browser preview bound to a different candidate", () =>
  Effect.gen(function* () {
    const fixture = yield* setup("browser-wrong-candidate");
    const result = yield* fixture.controller
      .command({
        projectId,
        request: { ...fields(fixture.initial.state!), type: "browser.prepare", registration },
      })
      .pipe(Effect.result);
    expect(result).toMatchObject({ _tag: "Failure", failure: { code: "INVALID_PAYLOAD" } });
    expect(yield* fixture.fs.exists(`${fixture.root}/browser-check.json`)).toBe(false);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

for (const patch of [
  { generation: 0, status: "UNKNOWN", reason: "CONFIG_UNAVAILABLE", observedAt: null, total: null },
  { total: 1, omitted: 1 },
  { ownerId: "other-owner" },
  { projectRevision: 20 },
  { enabled: true },
  { approved: true },
  { permission: "runtime_delete" },
] as const) {
  it.effect(
    `rejects inconsistent Broker replacement ${encodeJson(patch)} without changing canonical workflow`,
    () =>
      Effect.gen(function* () {
        const fixture = yield* setup("broker");
        const original = fixture.initial.state!;
        yield* fixture.fs.writeFileString(
          `${fixture.root}/broker.json`,
          encodeJson({ ...original.capabilityInventory, ...patch }),
        );
        yield* TestClock.adjust("2 seconds");
        const failed = yield* next(fixture.queue, (value) => value.status === "ERROR");
        expect(failed).toMatchObject({ stale: true, errorCode: "INVALID_PAYLOAD" });
        expect(failed.state?.snapshot).toEqual(original.snapshot);
        expect(failed.state?.pendingApproval).toBeNull();
        expect(yield* fixture.fs.exists(`${fixture.root}/requests`)).toBe(false);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
}

it.effect(
  "replaces epochs, rejects late retired epochs, and never manufactures Kernel evidence",
  () =>
    Effect.gen(function* () {
      const fixture = yield* setup("broker");
      const original = fixture.initial.state!.capabilityInventory!;
      const replacement = { ...original, brokerEpoch: "aaaaaaaa-1234-1234-1234-123456789abc" };
      yield* fixture.fs.writeFileString(`${fixture.root}/broker.json`, encodeJson(replacement));
      yield* TestClock.adjust("2 seconds");
      expect((yield* connected(fixture.queue)).state?.capabilityInventory).toEqual(replacement);
      yield* fixture.fs.writeFileString(
        `${fixture.root}/broker.json`,
        encodeJson({ ...original, generation: 99 }),
      );
      yield* TestClock.adjust("2 seconds");
      const stale = yield* next(fixture.queue, (value) => value.status === "ERROR");
      expect(stale.stale).toBe(true);
      expect(stale.state?.capabilityInventory).toEqual(replacement);
      expect(stale.state?.snapshot.evidence).toBeNull();
      expect(stale.state?.snapshot.status.run).toBeNull();
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect(
  "field omission replaces exposed inventory without secondary discovery and failed inventory has no fallback",
  () =>
    Effect.gen(function* () {
      const fixture = yield* setup("broker");
      const original = fixture.initial.state!.capabilityInventory!;
      yield* fixture.fs.writeFileString(`${fixture.root}/broker.json`, "null");
      yield* TestClock.adjust("2 seconds");
      expect((yield* connected(fixture.queue)).state?.capabilityInventory).toBeUndefined();
      const failed = {
        ...original,
        generation: 2,
        status: "UNKNOWN",
        reason: "CONFIG_UNAVAILABLE",
        total: null,
      };
      yield* fixture.fs.writeFileString(`${fixture.root}/broker.json`, encodeJson(failed));
      yield* TestClock.adjust("2 seconds");
      expect((yield* connected(fixture.queue)).state?.capabilityInventory).toEqual(failed);
      expect(yield* fixture.fs.exists(`${fixture.root}/requests`)).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect(
  "disconnect retains only a stale observation until a checked replacement owner snapshot",
  () =>
    Effect.gen(function* () {
      const fixture = yield* setup("broker");
      yield* fixture.fs.writeFileString(`${fixture.root}/disconnect`, "yes");
      yield* TestClock.adjust("2 seconds");
      const disconnected = yield* next(fixture.queue, (value) => value.status === "DISCONNECTED");
      expect(disconnected.stale).toBe(true);
      expect(disconnected.state?.capabilityInventory?.ownerId).toBe("owner-1");
      yield* TestClock.adjust("5 seconds");
      const replacement = yield* connected(fixture.queue);
      expect(replacement.state?.capabilityInventory?.ownerId).toBe("owner-2");
      expect(yield* fixture.fs.exists(`${fixture.root}/requests`)).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("inventory cannot make an approval from another project canonical", () =>
  Effect.gen(function* () {
    const fixture = yield* setup("broker");
    yield* fixture.fs.writeFileString(
      `${fixture.root}/state-patch.json`,
      encodeJson({
        pendingApproval: {
          approvalId: "other-approval",
          runId: "other-run",
          stateRevision: 1,
          projectRevision: 99,
          risk: "R3",
          operation: "delete-file",
          role: "Developer",
          step: { stepId: "implement", attempt: 0 },
          path: "src/file",
          bytes: 1,
          preconditionDigest: "a".repeat(64),
          expiresAt: 9999999999,
          explanation: "another scope",
        },
      }),
    );
    yield* TestClock.adjust("2 seconds");
    const rejected = yield* next(fixture.queue, (value) => value.status === "ERROR");
    expect(rejected.errorCode).toBe("INVALID_PAYLOAD");
    expect(rejected.state?.pendingApproval).toBeNull();
    expect(yield* fixture.fs.exists(`${fixture.root}/decision`)).toBe(false);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("promotes a new subscription only after a refresh checked on the bound transport", () =>
  Effect.gen(function* () {
    const fixture = yield* setup();
    const second = yield* Queue.unbounded<WeavraControlObservation>();
    yield* fixture.controller.observe(projectId).pipe(
      Stream.runForEach((value) => Queue.offer(second, value)),
      Effect.forkScoped,
    );
    // The healthy cached observation is historical for a new subscriber.
    expect(yield* Queue.take(second)).toMatchObject({ status: "CONNECTED", stale: true });
    expect((yield* connected(second)).state?.ownerId).toBe(fixture.initial.state?.ownerId);
    expect(yield* fixture.fs.exists(`${fixture.root}/requests`)).toBe(false);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

const strictDecode = { onExcessProperty: "error" } as const;
const referencePlan = Schema.decodeUnknownSync(WeavraComplexPlan, strictDecode)(reference.plan);
const referenceParent = Schema.decodeUnknownSync(
  WeavraTaskContract,
  strictDecode,
)(reference.parent);
const complexPreview: WeavraControlPreview = {
  previewId: "complex-preview",
  previewDigest: `sha256:${"b".repeat(64)}`,
  ownerId: "owner",
  projectRevision: 4,
  expiresAt: 9999999999999,
  goal: reference.preview.goal,
  workflow: "COMPLEX",
  executionMode: "EDIT",
  risk: "R1",
  allowedPaths: reference.preview.allowedPaths,
  checks: reference.preview.checks,
  acceptanceCriteria: reference.preview.acceptanceCriteria,
  taskContractDigest: reference.preview.taskContractDigest,
  recipe: null,
  configuration: {
    mutationMode: "strict",
    verifierTrustMode: "strict",
    verifierSandboxMode: "disabled",
    contextPackMode: "bounded",
    verificationRepairMode: "disabled",
    lspEnabled: false,
  },
  complexPlan: referencePlan,
};
const complexDraft: WeavraComplexDraft = {
  tasks: referencePlan.tasks.map((task, index) => ({
    title: task.title,
    goal: task.goal,
    dependsOnIndexes: index === 0 ? [] : [1],
    criterionIndexes: [index + 1],
    ownership: task.ownership,
    checkIds: task.checkIds,
  })),
};
const baselineCapabilities: WeavraControlCapabilities = {
  authority: "Runtime/Kernel",
  control: "workflow-control-v1",
  ownerId: "owner",
  commands: WEAVRA_CONTROL_COMMANDS,
  maxRequestBytes: 32768,
  maxResponseBytes: 65536,
  resultLimit: 64,
  previewTtlMs: 300000,
  runtimeVersion: "0.86.0",
  readiness: "READY",
  recipes: [],
};
const complexCapabilities: WeavraControlCapabilities = {
  ...baselineCapabilities,
  complexContractVersion: 1,
};
type Row = WeavraComplexExecution["tasks"][number];
type RunStatus = NonNullable<WeavraControlState["snapshot"]["status"]["run"]>["status"];
const sealPlan = (plan: WeavraComplexPlan): WeavraComplexPlan => ({
  ...plan,
  complexPlanDigest: complexPlanDigest(plan),
});
/** Re-binds an edited preview so that only the rule under test can fail. */
function sealPreview(preview: WeavraControlPreview): WeavraControlPreview {
  const plan = preview.complexPlan!;
  const parentDigest = previewTaskContractDigest(preview, plan.parentTaskId);
  return {
    ...preview,
    taskContractDigest: parentDigest,
    complexPlan: sealPlan({ ...plan, parentTaskContractDigest: parentDigest }),
  };
}
function withTask(plan: WeavraComplexPlan, index: number, patch: Partial<Row | object>) {
  return {
    ...plan,
    tasks: plan.tasks.map((task, position) => (position === index ? { ...task, ...patch } : task)),
  };
}
const pending = (id: string): Row => ({
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
const completedRow = (
  id: string,
  changedFiles: ReadonlyArray<string>,
  evidenceFreshness: Row["evidenceFreshness"] = "CURRENT",
): Row => ({
  ...pending(id),
  status: "COMPLETED",
  attempt: 1,
  workerInvocations: 2,
  reportedTokens: 4000,
  entryWorkspaceDigest: "1".repeat(64),
  exitWorkspaceDigest: "2".repeat(64),
  changedFiles,
  selfCheck: "PASS",
  review: "PASS",
  test: "PASS",
  evidenceFreshness,
});
function execution(patch: Partial<WeavraComplexExecution> = {}): WeavraComplexExecution {
  return {
    schemaVersion: 1,
    ownerId: "owner",
    projectRevision: 4,
    runId: "run-1",
    stateRevision: 7,
    parent: { ...referenceParent, status: "inProgress" },
    plan: referencePlan,
    phase: "TASK_SEQUENCE",
    activeTaskId: "CT-001",
    tasks: [
      {
        ...pending("CT-001"),
        status: "IMPLEMENTING",
        attempt: 1,
        workerInvocations: 1,
        reportedTokens: 1200,
        entryWorkspaceDigest: "1".repeat(64),
      },
      pending("CT-002"),
    ],
    integration: {
      check: "NOT_RUN",
      review: "NOT_RUN",
      test: "NOT_RUN",
      workspaceDigest: null,
      evidenceFreshness: "NONE",
      failureCode: null,
    },
    budget: {
      workerInvocations: 1,
      reportedTokens: 1200,
      totalRevisionCycles: 0,
      status: "WITHIN_LIMITS",
    },
    cleanup: "NOT_REQUESTED",
    partialChanges: false,
    changesUnknown: false,
    failureCode: null,
    ...patch,
  };
}
function complexState(
  value: WeavraComplexExecution | undefined,
  status: RunStatus = "RUNNING",
  workflow: "STANDARD" | "COMPLEX" = "COMPLEX",
): WeavraControlState {
  const active = ["CREATED", "RUNNING", "WAITING_APPROVAL"].includes(status);
  const state: WeavraControlState = {
    ownerId: value?.ownerId ?? "owner",
    nextRequestId: `${value?.ownerId ?? "owner"}:2`,
    projectRevision: value?.projectRevision ?? 4,
    stateRevision: value?.stateRevision ?? 7,
    ownedRunId: value?.runId ?? "run-1",
    busy: active,
    cancelling: false,
    startFailure: null,
    preview: null,
    browserPreview: null,
    factPreview: null,
    projectFacts: { status: "available", entries: [] },
    pendingApproval: null,
    snapshot: {
      status: {
        source: "durable-canonical-state",
        ownerObserved: false,
        state: "available",
        writerPresent: active,
        run: {
          runId: value?.runId ?? "run-1",
          status,
          phase: "IMPLEMENT",
          workflow,
          risk: "R1",
          executionMode: "EDIT",
          codeRevision: 0,
          currentStep: null,
          activeAgentCount: 0,
          taskContractDigest: value
            ? taskContractDigest(value.parent)
            : reference.parentTaskContractDigest,
          createdAt: 1,
          updatedAt: 2,
        },
      },
      graph: null,
      graphAvailable: false,
      evidence: null,
      configuration: { source: "project-config-not-frozen-run-config", status: "configured" },
    },
  };
  return value === undefined ? state : { ...state, complexExecution: value };
}
const running = execution();
const withRow = (base: WeavraComplexExecution, index: number, patch: Partial<Row>) =>
  execution({
    ...base,
    tasks: base.tasks.map((task, position) => (position === index ? { ...task, ...patch } : task)),
  });
const integrating = execution({
  phase: "FINAL_REVIEW",
  activeTaskId: null,
  tasks: [
    completedRow("CT-001", ["src/config.ts", "src/parse.ts"], "STALE"),
    completedRow("CT-002", ["src/validate.ts"]),
  ],
  integration: {
    check: "PASS",
    review: "RUNNING",
    test: "NOT_RUN",
    workspaceDigest: "3".repeat(64),
    evidenceFreshness: "CURRENT",
    failureCode: null,
  },
  budget: {
    workerInvocations: 5,
    reportedTokens: 9000,
    totalRevisionCycles: 0,
    status: "WITHIN_LIMITS",
  },
});
const finished = execution({
  ...integrating,
  stateRevision: 9,
  parent: { ...referenceParent, status: "completed" },
  phase: "TERMINAL",
  integration: { ...integrating.integration, review: "PASS", test: "PASS" },
  budget: { ...integrating.budget, reportedTokens: 9500 },
  cleanup: "CONFIRMED",
});
const blocked = execution({
  stateRevision: 9,
  parent: { ...referenceParent, status: "blocked" },
  phase: "TERMINAL",
  activeTaskId: null,
  tasks: [
    completedRow("CT-001", ["src/config.ts", "src/parse.ts"]),
    {
      ...pending("CT-002"),
      status: "BLOCKED",
      attempt: 1,
      workerInvocations: 1,
      reportedTokens: 1500,
      entryWorkspaceDigest: "2".repeat(64),
      changedFiles: ["src/validate.ts"],
      selfCheck: "FAIL",
      failureCode: "CHECK_FAILED",
    },
  ],
  budget: {
    workerInvocations: 3,
    reportedTokens: 5500,
    totalRevisionCycles: 0,
    status: "WITHIN_LIMITS",
  },
  cleanup: "CONFIRMED",
  partialChanges: true,
  failureCode: "CHECK_FAILED",
});
const consistentNow = (
  value: WeavraComplexExecution | undefined,
  status: RunStatus = "RUNNING",
  previous: WeavraControlState | null = null,
) => complexStateConsistent(complexState(value, status), complexCapabilities, previous);
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .toReversed()
      .map(([key, entry]) => [key, reverseKeys(entry)]),
  );
}

describe("COMPLEX consumer consistency against the shared reference fixture", () => {
  it("reproduces the frozen parent and plan digests from the reference material", () => {
    expect(taskContractDigest(referenceParent)).toBe(reference.parentTaskContractDigest);
    expect(complexPlanDigest(referencePlan)).toBe(reference.complexPlanDigest);
    expect(referencePlan.complexPlanDigest).toBe(reference.complexPlanDigest);
    expect(previewTaskContractDigest(complexPreview, referencePlan.parentTaskId)).toBe(
      reference.parentTaskContractDigest,
    );
    // Lifecycle status is not identity; object key order of the input does not matter.
    expect(taskContractDigest({ ...referenceParent, status: "completed" })).toBe(
      reference.parentTaskContractDigest,
    );
    const reordered = reverseKeys(referencePlan) as WeavraComplexPlan;
    expect(complexPlanDigest(reordered)).toBe(reference.complexPlanDigest);
  });
  it("accepts the reference preview and rejects matching but unproven digest pairs", () => {
    expect(complexPreviewConsistent(complexPreview)).toBe(true);
    const arbitrary = `sha256:${"9".repeat(64)}`;
    const pair = {
      ...complexPreview,
      taskContractDigest: arbitrary,
      complexPlan: sealPlan({ ...referencePlan, parentTaskContractDigest: arbitrary }),
    };
    for (const forged of [
      pair,
      { ...complexPreview, goal: "A different parent goal" },
      { ...complexPreview, allowedPaths: ["src"] },
      {
        ...complexPreview,
        acceptanceCriteria: complexPreview.acceptanceCriteria.map((criterion) => ({
          ...criterion,
          statement: `${criterion.statement}.`,
        })),
      },
      { ...complexPreview, complexPlan: withTask(referencePlan, 0, { title: "Unsealed edit" }) },
      {
        ...complexPreview,
        complexPlan: { ...referencePlan, complexPlanDigest: `sha256:${"0".repeat(64)}` },
      },
    ]) {
      expect(complexPreviewConsistent(forged)).toBe(false);
    }
  });
  it("rejects coverage, selection, review, integration and recipe drift even when resealed", () => {
    const plan = referencePlan;
    for (const drifted of [
      sealPreview({
        ...complexPreview,
        complexPlan: withTask(plan, 1, { criterionIds: ["AC-001"] }),
      }),
      sealPreview({ ...complexPreview, complexPlan: withTask(plan, 0, { checkIds: ["lint"] }) }),
      sealPreview({
        ...complexPreview,
        acceptanceCriteria: complexPreview.acceptanceCriteria.map((criterion, index) => ({
          ...criterion,
          reviewRequired: index === 0,
        })),
      }),
      sealPreview({
        ...complexPreview,
        complexPlan: { ...plan, integration: { ...plan.integration, checkIds: ["test"] } },
      }),
      sealPreview({
        ...complexPreview,
        checks: [...complexPreview.checks, { id: "e2e", kind: "command", required: false }],
      }),
      sealPreview({
        ...complexPreview,
        recipe: { id: "bug-fix", version: 1, digest: complexPreview.previewDigest },
      }),
      sealPreview({ ...complexPreview, executionMode: "READ_ONLY" }),
    ]) {
      expect(complexPreviewConsistent(drifted)).toBe(false);
    }
    const readOnly = sealPreview({
      ...complexPreview,
      executionMode: "READ_ONLY",
      complexPlan: {
        ...plan,
        tasks: plan.tasks.map((task) => ({ ...task, ownership: [] })),
      },
    });
    expect(complexPreviewConsistent(readOnly)).toBe(true);
  });
  it("requires the projection exactly when an advertising Runtime's latest Run is COMPLEX", () => {
    expect(complexStateConsistent(complexState(running), complexCapabilities, null)).toBe(true);
    expect(complexStateConsistent(complexState(undefined), complexCapabilities, null)).toBe(false);
    expect(complexStateConsistent(complexState(running), baselineCapabilities, null)).toBe(false);
    // A baseline Runtime never sends the field; its COMPLEX summary stays display-only history.
    expect(complexStateConsistent(complexState(undefined), baselineCapabilities, null)).toBe(true);
    expect(
      complexStateConsistent(
        complexState(undefined, "COMPLETED", "STANDARD"),
        complexCapabilities,
        null,
      ),
    ).toBe(true);
    const previewed = {
      ...complexState(undefined, "COMPLETED", "STANDARD"),
      preview: complexPreview,
    };
    expect(complexStateConsistent(previewed, complexCapabilities, null)).toBe(true);
    expect(complexStateConsistent(previewed, baselineCapabilities, null)).toBe(false);
  });
  it("accepts consistent running, integration and terminal projections", () => {
    expect(consistentNow(running)).toBe(true);
    expect(consistentNow(integrating)).toBe(true);
    expect(consistentNow(finished, "COMPLETED")).toBe(true);
    expect(consistentNow(blocked, "BLOCKED")).toBe(true);
    expect(consistentNow({ ...blocked, cleanup: "UNCONFIRMED" }, "INTERRUPTED")).toBe(true);
  });
  it("rejects task, gate, budget and outcome combinations that cannot be canonical", () => {
    for (const [label, value, status] of [
      ["pending with unknown usage", withRow(running, 1, { reportedTokens: null }), "RUNNING"],
      [
        "pending with fresh evidence",
        withRow(running, 1, { evidenceFreshness: "CURRENT" }),
        "RUNNING",
      ],
      [
        "change outside claims",
        withRow(running, 0, { changedFiles: ["src/validate.ts"] }),
        "RUNNING",
      ],
      ["missing active task", execution({ activeTaskId: null }), "RUNNING"],
      ["wrong active task", execution({ activeTaskId: "CT-002" }), "RUNNING"],
      ["second active task", withRow(running, 1, { status: "ELIGIBLE" }), "RUNNING"],
      ["attempt without cycle", withRow(running, 0, { attempt: 2 }), "RUNNING"],
      [
        "invocations beyond attempt",
        execution({
          tasks: [{ ...running.tasks[0]!, workerInvocations: 3 }, running.tasks[1]!],
          budget: { ...running.budget, workerInvocations: 3 },
        }),
        "RUNNING",
      ],
      ["test before review", withRow(running, 0, { test: "PASS" }), "RUNNING"],
      ["attempt without capture", withRow(running, 0, { entryWorkspaceDigest: null }), "RUNNING"],
      [
        "approval wait outside Run wait",
        withRow(running, 0, { status: "WAITING_APPROVAL" }),
        "RUNNING",
      ],
      [
        "unknown status with known usage",
        execution({ budget: { ...running.budget, status: "UNKNOWN" } }),
        "RUNNING",
      ],
      [
        "null usage within limits",
        execution({ budget: { ...running.budget, reportedTokens: null } }),
        "RUNNING",
      ],
      [
        "cap reached within limits",
        execution({ budget: { ...running.budget, reportedTokens: 200000 } }),
        "RUNNING",
      ],
      [
        "ledger below subtotals",
        execution({ budget: { ...running.budget, workerInvocations: 0 } }),
        "RUNNING",
      ],
      [
        "ledger above final review",
        execution({ budget: { ...running.budget, workerInvocations: 3 } }),
        "RUNNING",
      ],
      [
        "revision total drift",
        execution({ budget: { ...running.budget, totalRevisionCycles: 1 } }),
        "RUNNING",
      ],
      ["integration before tasks", execution({ phase: "INTEGRATION_CHECK" }), "RUNNING"],
      [
        "integration gate during tasks",
        execution({ integration: { ...running.integration, check: "RUNNING" } }),
        "RUNNING",
      ],
      ["terminal Run without terminal phase", running, "BLOCKED"],
      ["terminal phase without terminal Run", finished, "RUNNING"],
      ["terminal running gate", withRow(blocked, 1, { selfCheck: "RUNNING" }), "BLOCKED"],
      ["unconfirmed cleanup on blocked", execution({ ...blocked, cleanup: "PENDING" }), "BLOCKED"],
      ["unconfirmed cleanup on cancel", execution({ ...blocked, cleanup: "PENDING" }), "CANCELLED"],
      [
        "completed with failed final test",
        execution({ ...finished, integration: { ...finished.integration, test: "FAIL" } }),
        "COMPLETED",
      ],
      [
        "completed with stale integration",
        execution({
          ...finished,
          integration: { ...finished.integration, evidenceFreshness: "STALE" },
        }),
        "COMPLETED",
      ],
      [
        "completed with unknown usage",
        execution({
          ...finished,
          budget: { ...finished.budget, reportedTokens: null, status: "UNKNOWN" },
        }),
        "COMPLETED",
      ],
      [
        "completed task without evidence",
        execution({
          ...finished,
          tasks: [finished.tasks[0]!, { ...finished.tasks[1]!, review: "REVISE" }],
        }),
        "COMPLETED",
      ],
      [
        "all tasks completed presented as parent completion",
        execution({ ...integrating, parent: { ...referenceParent, status: "completed" } }),
        "RUNNING",
      ],
    ] as const) {
      expect([label, consistentNow(value, status)]).toEqual([label, false]);
    }
    const summary = complexState(running);
    const wrongDigest: WeavraControlState = {
      ...summary,
      snapshot: {
        ...summary.snapshot,
        status: {
          ...summary.snapshot.status,
          run: { ...summary.snapshot.status.run!, taskContractDigest: `sha256:${"0".repeat(64)}` },
        },
      },
    };
    expect(complexStateConsistent(wrongDigest, complexCapabilities, null)).toBe(false);
  });
  it("rejects changed data at the same state revision but ignores key order (C27)", () => {
    const previous = complexState(running);
    expect(consistentNow(reverseKeys(running) as WeavraComplexExecution, "RUNNING", previous)).toBe(
      true,
    );
    expect(
      consistentNow(
        { ...running, ownerId: "replacement-owner", projectRevision: 5 },
        "RUNNING",
        previous,
      ),
    ).toBe(true);
    for (const changed of [
      execution({ budget: { ...running.budget, reportedTokens: 1300 } }),
      withRow(running, 0, { status: "SELF_CHECK", selfCheck: "RUNNING" }),
      execution({ parent: { ...referenceParent, status: "pending" } }),
    ]) {
      expect(consistentNow(changed, "RUNNING", previous)).toBe(false);
    }
  });
  it("rejects regressions, frozen-plan drift and terminal re-entry for the same Run (C19)", () => {
    const advanced = execution({
      tasks: [
        {
          ...running.tasks[0]!,
          attempt: 2,
          revisionCycle: 1,
          workerInvocations: 3,
          reportedTokens: 5000,
        },
        running.tasks[1]!,
      ],
      budget: {
        workerInvocations: 3,
        reportedTokens: 5000,
        totalRevisionCycles: 1,
        status: "WITHIN_LIMITS",
      },
    });
    expect(consistentNow(advanced)).toBe(true);
    expect(consistentNow(execution({ stateRevision: 8 }), "RUNNING", complexState(advanced))).toBe(
      false,
    );
    const unknown = execution({
      budget: { ...running.budget, reportedTokens: null, status: "UNKNOWN" },
    });
    expect(consistentNow(execution({ stateRevision: 8 }), "RUNNING", complexState(unknown))).toBe(
      false,
    );
    const previous = complexState(running);
    const driftedPlan = sealPlan(withTask(referencePlan, 1, { title: "Different contribution" }));
    expect(
      consistentNow(execution({ stateRevision: 8, plan: driftedPlan }), "RUNNING", previous),
    ).toBe(false);
    const driftedParent = {
      ...referenceParent,
      goal: "A different frozen goal",
      status: "inProgress" as const,
    };
    const reboundPlan = sealPlan({
      ...referencePlan,
      parentTaskContractDigest: taskContractDigest(driftedParent),
    });
    const rebound = execution({ stateRevision: 8, parent: driftedParent, plan: reboundPlan });
    expect(consistentNow(rebound)).toBe(true);
    expect(consistentNow(rebound, "RUNNING", previous)).toBe(false);
    const progressed = withRow(
      execution({ stateRevision: 8, budget: { ...running.budget, reportedTokens: 1500 } }),
      0,
      {
        status: "SELF_CHECK",
        reportedTokens: 1500,
        selfCheck: "RUNNING",
      },
    );
    expect(consistentNow(progressed, "RUNNING", previous)).toBe(true);
    const terminal = complexState(blocked, "BLOCKED");
    expect(consistentNow(execution({ stateRevision: 10 }), "RUNNING", terminal)).toBe(false);
    expect(consistentNow(execution({ ...blocked, stateRevision: 10 }), "CANCELLED", terminal)).toBe(
      false,
    );
    const rewritten = execution({
      ...blocked,
      stateRevision: 10,
      tasks: [
        { ...blocked.tasks[0]!, status: "BLOCKED", failureCode: "STALE_EVIDENCE" },
        blocked.tasks[1]!,
      ],
    });
    expect(consistentNow(rewritten, "BLOCKED")).toBe(true);
    expect(consistentNow(rewritten, "BLOCKED", terminal)).toBe(false);
    // A new Run replaces the projection; nothing is merged from the old one.
    expect(
      consistentNow(execution({ runId: "run-2", stateRevision: 1 }), "RUNNING", terminal),
    ).toBe(true);
  });
});

it.effect("does not forward a COMPLEX draft to a Runtime that does not advertise contract v1", () =>
  Effect.gen(function* () {
    const fixture = yield* setup();
    expect(fixture.initial.capabilities?.complexContractVersion).toBeUndefined();
    const result = yield* fixture.controller
      .command({
        projectId,
        request: {
          ...fields(fixture.initial.state!),
          type: "workflow.prepare",
          goal: reference.parent.goal,
          acceptanceStatements: reference.preview.acceptanceCriteria.map((item) => item.statement),
          complexDraft,
        },
      })
      .pipe(Effect.result);
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { code: "INCOMPATIBLE_CAPABILITIES" },
    });
    expect(yield* fixture.fs.exists(`${fixture.root}/requests`)).toBe(false);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

const complexRunPatch = (value: WeavraComplexExecution) => {
  const state = complexState(value);
  return {
    projectRevision: state.projectRevision,
    stateRevision: state.stateRevision,
    ownedRunId: state.ownedRunId,
    busy: true,
    preview: null,
    snapshot: state.snapshot,
    complexExecution: value,
  };
};

it.effect("publishes COMPLEX preview and projection only after recomputed bindings", () =>
  Effect.gen(function* () {
    const fixture = yield* setup("complex");
    const initial = fixture.initial.state!;
    expect(fixture.initial.capabilities?.complexContractVersion).toBe(1);
    yield* fixture.fs.writeFileString(
      `${fixture.root}/complex-preview.json`,
      encodeJson(complexPreview),
    );
    const prepared = yield* fixture.controller.command({
      projectId,
      request: {
        ...fields(initial),
        type: "workflow.prepare",
        goal: reference.parent.goal,
        acceptanceStatements: reference.preview.acceptanceCriteria.map((item) => item.statement),
        complexDraft,
      },
    });
    expect(prepared).toMatchObject({
      success: true,
      data: { kind: "prepared", preview: { workflow: "COMPLEX", complexPlan: referencePlan } },
    });
    expect((yield* connected(fixture.queue)).state?.preview?.complexPlan).toEqual(referencePlan);
    const current = execution({ ownerId: initial.ownerId, projectRevision: 1 });
    yield* fixture.fs.writeFileString(
      `${fixture.root}/state-patch.json`,
      encodeJson(complexRunPatch(current)),
    );
    yield* TestClock.adjust("2 seconds");
    const projected = yield* next(
      fixture.queue,
      (value) => !value.stale && value.state?.complexExecution !== undefined,
    );
    expect(projected.state?.complexExecution).toEqual(current);
    // Same Run and state revision with different canonical data is not a refresh.
    yield* fixture.fs.writeFileString(
      `${fixture.root}/state-patch.json`,
      encodeJson(
        complexRunPatch({ ...current, budget: { ...current.budget, reportedTokens: 999 } }),
      ),
    );
    yield* TestClock.adjust("2 seconds");
    const rejected = yield* next(fixture.queue, (value) => value.status === "ERROR");
    expect(rejected).toMatchObject({ stale: true, errorCode: "INVALID_PAYLOAD" });
    expect(rejected.state?.complexExecution).toEqual(current);
    expect(
      (yield* fixture.fs.readFileString(`${fixture.root}/requests`)).split("\n").filter(Boolean),
    ).toEqual(["workflow.prepare"]);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("rejects a forged COMPLEX preview and never publishes it as current", () =>
  Effect.gen(function* () {
    const fixture = yield* setup("complex");
    yield* fixture.fs.writeFileString(
      `${fixture.root}/complex-preview.json`,
      encodeJson({
        ...complexPreview,
        complexPlan: { ...referencePlan, complexPlanDigest: `sha256:${"0".repeat(64)}` },
      }),
    );
    const result = yield* fixture.controller
      .command({
        projectId,
        request: {
          ...fields(fixture.initial.state!),
          type: "workflow.prepare",
          goal: reference.parent.goal,
          complexDraft,
        },
      })
      .pipe(Effect.result);
    expect(result).toMatchObject({ _tag: "Failure", failure: { code: "INVALID_PAYLOAD" } });
    yield* TestClock.adjust("2 seconds");
    const failed = yield* next(fixture.queue, (value) => value.status === "ERROR");
    expect(failed).toMatchObject({ stale: true, errorCode: "INVALID_PAYLOAD" });
    expect(failed.state?.preview).toBeNull();
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

for (const [label, mode, patch] of [
  [
    "an advertised latest COMPLEX Run without its projection",
    "complex",
    (() => {
      const { complexExecution: _missing, ...rest } = complexRunPatch(
        execution({ ownerId: "owner-1", projectRevision: 1 }),
      );
      return rest;
    })(),
  ],
  [
    "a projection from a Runtime that never advertised COMPLEX",
    "normal",
    complexRunPatch(execution({ ownerId: "owner-1", projectRevision: 1 })),
  ],
] as const) {
  it.effect(`treats ${label} as unavailable, not as an empty task list`, () =>
    Effect.gen(function* () {
      const fixture = yield* setup(mode);
      yield* fixture.fs.writeFileString(`${fixture.root}/state-patch.json`, encodeJson(patch));
      yield* TestClock.adjust("2 seconds");
      const failed = yield* next(fixture.queue, (value) => value.status === "ERROR");
      expect(failed).toMatchObject({ stale: true, errorCode: "INVALID_PAYLOAD" });
      expect(failed.state?.snapshot.status.run).toBeNull();
      expect(failed.state?.complexExecution).toBeUndefined();
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
}
