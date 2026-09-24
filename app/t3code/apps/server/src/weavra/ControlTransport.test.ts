import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import {
  WEAVRA_CONTROL_MAX_REQUEST_BYTES,
  WEAVRA_CONTROL_MAX_RESPONSE_BYTES,
  type WeavraControlRequest,
  type WeavraControlResponse,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Sink from "effect/Sink";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcessSpawner } from "effect/unstable/process";
import { expect } from "vite-plus/test";
import { writeFakeCli } from "../testUtils/fakeCli.ts";
import { openControlTransport } from "./ControlTransport.ts";

const helloRequest = {
  protocolVersion: 1,
  id: "t3-control-hello-1",
  type: "control.hello",
} as const satisfies WeavraControlRequest;
const confirmRequest = {
  protocolVersion: 1,
  id: "owner-1:1",
  ownerId: "owner-1",
  expectedProjectRevision: 7,
  type: "workflow.confirm",
  previewId: "preview-1",
  previewDigest: `sha256:${"a".repeat(64)}`,
} as const satisfies WeavraControlRequest;
const snapshotRequest = {
  protocolVersion: 1,
  id: "t3-control-snapshot-2",
  type: "control.snapshot",
} as const satisfies WeavraControlRequest;
const helloResponse = {
  protocolVersion: 1,
  runId: null,
  stateRevision: null,
  projectRevision: 7,
  eventId: null,
  timestamp: 1000,
  type: "control_response",
  id: "t3-control-hello-1",
  command: "control.hello",
  ownerId: "owner-1",
  success: true,
  data: {
    kind: "capabilities",
    capabilities: {
      authority: "Runtime/Kernel",
      control: "workflow-control-v1",
      ownerId: "owner-1",
      commands: [
        "control.hello",
        "control.snapshot",
        "workflow.prepare",
        "workflow.confirm",
        "workflow.cancel",
        "approval.resolve",
        "browser.inspect",
        "browser.prepare",
        "browser.confirm",
        "facts.prepare",
        "facts.confirm",
      ],
      maxRequestBytes: 32768,
      maxResponseBytes: 65536,
      resultLimit: 256,
      previewTtlMs: 60000,
      runtimeVersion: "0.86.0",
      readiness: "READY",
      recipes: [],
    },
  },
} as const satisfies WeavraControlResponse;
const acceptedResponse = {
  protocolVersion: 1,
  runId: "run-1",
  stateRevision: 1,
  projectRevision: 8,
  eventId: null,
  timestamp: 1001,
  type: "control_response",
  id: "owner-1:1",
  command: "workflow.confirm",
  ownerId: "owner-1",
  success: true,
  data: {
    kind: "accepted",
    requestId: "owner-1:1",
    command: "workflow.confirm",
    runId: "run-1",
  },
} as const satisfies WeavraControlResponse;
const snapshotResponse = {
  ...acceptedResponse,
  id: "t3-control-snapshot-2",
  command: "control.snapshot",
  data: {
    kind: "snapshot",
    state: {
      ownerId: "owner-1",
      nextRequestId: "owner-1:2",
      projectRevision: 8,
      stateRevision: 1,
      ownedRunId: "run-1",
      busy: true,
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
          writerPresent: true,
          run: {
            runId: "run-1",
            status: "RUNNING",
            phase: "PREFLIGHT",
            workflow: "QUICK",
            risk: "R0",
            executionMode: "EDIT",
            codeRevision: 0,
            currentStep: null,
            activeAgentCount: 0,
            taskContractDigest: null,
            createdAt: 1001,
            updatedAt: 1001,
          },
        },
        graph: null,
        graphAvailable: false,
        evidence: null,
        configuration: {
          source: "project-config-not-frozen-run-config",
          status: "missing",
        },
      },
    },
  },
} as const satisfies WeavraControlResponse;
const stderrMarker = "FAKE_SECRET_STDERR_NOT_FOR_CLIENT";
const source = `
import { createInterface } from 'node:readline';
import { appendFileSync, existsSync, writeFileSync, writeSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
const argv = process.argv.slice(2);
writeFileSync('control-argv', JSON.stringify(argv));
if (argv.join('|') !== 'bridge|--stdio|--project-trusted|--control') process.exit(41);
process.on('SIGTERM', () => {
 writeFileSync('control-closed', 'closed'); process.exit(0);
});
writeFileSync('control-pid', String(process.pid));
const mode = process.env.MODE;
const responses = ${JSON.stringify({
  "control.hello": helloResponse,
  "workflow.confirm": acceptedResponse,
  "control.snapshot": snapshotResponse,
})};
for await (const line of createInterface({input:process.stdin})) {
 appendFileSync('request-lines', line+'\\n');
 const request = JSON.parse(line);
 if (request.type.startsWith('workflow.') || request.type==='approval.resolve') {
  appendFileSync('mutation-lines', line+'\\n');
 }
 writeSync(2, '${stderrMarker}\\n');
 if (mode==='exit') process.exit(23);
 if (mode==='eof') { process.stdout.end(); continue; }
 if (mode==='malformed') { process.stdout.write('{broken\\n'); continue; }
 if (mode==='invalid-utf8') { process.stdout.write(Buffer.from([255,10])); continue; }
 if (mode==='oversized') { process.stdout.write('x'.repeat(${WEAVRA_CONTROL_MAX_RESPONSE_BYTES})); continue; }
 const response = structuredClone(responses[request.type]);
 if (!response) process.exit(42);
 if(mode==='broker' && process.env.BROKER)response.data.state.capabilityInventory=JSON.parse(process.env.BROKER);
 if(mode==='patch'){const patch=JSON.parse(process.env.PATCH);Object.assign(request.type==='control.hello'?response.data.capabilities:response.data.state,patch);}
 if (mode==='version') response.protocolVersion=2;
 if (mode==='wrong-id') response.id='owner-2:1';
 if (mode==='wrong-command') response.command='workflow.cancel';
 if (mode==='unknown-field') response.unrecognized=true;
 if (mode==='private-field') response.data.privateCredential='FAKE_SECRET_MUST_NOT_PASS';
 if (mode==='timeout' && request.type==='workflow.confirm') {
  writeFileSync('mutation-pending', 'pending');
  while (!existsSync('release-response')) await delay(5);
 }
 const output = JSON.stringify(response)+'\\n';
 if (mode==='split') {
  process.stdout.write(output.slice(0,13));
  await delay(10);
  process.stdout.write(output.slice(13));
 } else process.stdout.write(output);
}
`;
const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };
const encodeJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const requestLines = (...requests: ReadonlyArray<WeavraControlRequest>) =>
  requests.map((request) => `${JSON.stringify(request)}\n`).join("");

const waitForFile = (path: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    while (!(yield* fs.exists(path))) yield* Effect.yieldNow;
  });

it.effect("uses exact control argv, split JSONL replies and owner-correlated requests", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "weavra-control-transport-" });
    const executable = writeFakeCli({
      directory: cwd,
      name: "controller with spaces",
      source,
      env: { MODE: "split" },
    });
    yield* Effect.gen(function* () {
      const bridge = yield* openControlTransport(executable, cwd, env);
      expect(yield* bridge.exchange(helloRequest)).toEqual(helloResponse);
      // An accepted receipt is not a terminal run result: the next canonical read is still busy.
      expect(yield* bridge.exchange(confirmRequest)).toEqual(acceptedResponse);
      expect(yield* bridge.exchange(snapshotRequest)).toEqual(snapshotResponse);
      expect(yield* fs.readFileString(`${cwd}/control-argv`)).toBe(
        encodeJson(["bridge", "--stdio", "--project-trusted", "--control"]),
      );
      expect(yield* fs.readFileString(`${cwd}/request-lines`)).toBe(
        requestLines(helloRequest, confirmRequest, snapshotRequest),
      );
    }).pipe(Effect.scoped);
    expect(yield* fs.readFileString(`${cwd}/control-closed`)).toBe("closed");
    const pid = Number(yield* fs.readFileString(`${cwd}/control-pid`));
    expect(yield* Effect.try(() => process.kill(pid, 0)).pipe(Effect.result)).toMatchObject({
      _tag: "Failure",
      failure: { cause: { code: "ESRCH" } },
    });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.live("accepts a real child reply before the stdin write continuation returns", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "weavra-control-fast-" });
    const executable = writeFakeCli({ directory: cwd, name: "controller", source });
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const responseConsumed = yield* Deferred.make<void>();
    // Keep the real pipe write suspended until the reader has consumed its real response.
    const gatedSpawner = ChildProcessSpawner.make((command) =>
      spawner.spawn(command).pipe(
        Effect.map((child) =>
          ChildProcessSpawner.makeHandle({
            ...child,
            stdin: child.stdin.pipe(Sink.mapEffect(() => Deferred.await(responseConsumed))),
            stdout: child.stdout.pipe(
              Stream.flatMap((chunk) =>
                Stream.make(chunk).pipe(
                  Stream.concat(
                    Stream.fromEffect(
                      chunk.includes(10)
                        ? Deferred.succeed(responseConsumed, undefined)
                        : Effect.void,
                    ).pipe(Stream.drain),
                  ),
                ),
              ),
            ),
          }),
        ),
      ),
    );
    yield* Effect.gen(function* () {
      const bridge = yield* openControlTransport(executable, cwd, env);
      expect(yield* bridge.exchange(confirmRequest)).toEqual(acceptedResponse);
      expect(yield* fs.readFileString(`${cwd}/mutation-lines`)).toBe(requestLines(confirmRequest));
    }).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, gatedSpawner),
      Effect.timeout("3 seconds"),
      Effect.scoped,
    );
    expect(yield* fs.readFileString(`${cwd}/control-closed`)).toBe("closed");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

for (const [mode, code] of [
  ["malformed", "INVALID_PAYLOAD"],
  ["invalid-utf8", "INVALID_PAYLOAD"],
  ["oversized", "OVERSIZED_PAYLOAD"],
  ["unknown-field", "INVALID_PAYLOAD"],
  ["private-field", "INVALID_PAYLOAD"],
  ["wrong-id", "INVALID_PAYLOAD"],
  ["wrong-command", "INVALID_PAYLOAD"],
  ["version", "PROTOCOL_MISMATCH"],
  ["eof", "TRANSPORT_CLOSED"],
  ["exit", "TRANSPORT_CLOSED"],
] as const) {
  it.effect(`fails closed on ${mode} without exposing child stderr`, () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "weavra-control-boundary-" });
      const executable = writeFakeCli({
        directory: cwd,
        name: "controller",
        source,
        env: { MODE: mode },
      });
      const result = yield* Effect.gen(function* () {
        const bridge = yield* openControlTransport(executable, cwd, env);
        return yield* bridge.exchange(confirmRequest);
      }).pipe(Effect.scoped, Effect.result);
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "WeavraControlTransportError", code },
      });
      expect(encodeJson(result)).not.toContain(stderrMarker);
      expect(encodeJson(result)).not.toContain("FAKE_SECRET_MUST_NOT_PASS");
      expect(yield* fs.readFileString(`${cwd}/request-lines`)).toBe(requestLines(confirmRequest));
      if (mode !== "exit") {
        expect(yield* fs.readFileString(`${cwd}/control-closed`)).toBe("closed");
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
}

for (const [label, patch] of [
  ["current", {}],
  ["unknown field", { enabled: true }],
  ["unknown schema", { schemaVersion: 2 }],
  ["null", null],
  ["oversized secret", { rawConfig: "PRIVATE_SECRET".repeat(6000) }],
] as const) {
  it.effect(`decodes Broker ${label} through the real bounded JSONL transport`, () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "weavra-broker-transport-" });
      const inventory =
        patch === null
          ? null
          : {
              schemaVersion: 1,
              coverage: "RUNTIME_ACTION_TOOLS",
              ownerId: "owner-1",
              projectRevision: 8,
              brokerEpoch: "12345678-1234-1234-1234-123456789abc",
              generation: 1,
              status: "CURRENT",
              reason: "OBSERVED",
              observedAt: 1,
              entries: [],
              total: 0,
              omitted: 0,
              ...patch,
            };
      const executable = writeFakeCli({
        directory: cwd,
        name: "controller",
        source,
        env: { MODE: "broker", BROKER: encodeJson(inventory) },
      });
      const result = yield* Effect.gen(function* () {
        const bridge = yield* openControlTransport(executable, cwd, env);
        return yield* bridge.exchange(snapshotRequest);
      }).pipe(Effect.scoped, Effect.result);
      if (label === "current") {
        expect(result).toMatchObject({
          _tag: "Success",
          success: { data: { state: { capabilityInventory: inventory } } },
        });
      } else {
        expect(result).toMatchObject({
          _tag: "Failure",
          failure: { code: label === "oversized secret" ? "OVERSIZED_PAYLOAD" : "INVALID_PAYLOAD" },
        });
        expect(encodeJson(result)).not.toContain("PRIVATE_SECRET");
      }
      expect(yield* fs.readFileString(`${cwd}/request-lines`)).toBe(requestLines(snapshotRequest));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
}

it.effect("rejects an oversized UTF-8 request before writing to the child", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "weavra-control-request-bound-" });
    const executable = writeFakeCli({ directory: cwd, name: "controller", source });
    const oversizedRequest = {
      protocolVersion: 1,
      id: "owner-1:oversized",
      ownerId: "owner-1",
      expectedProjectRevision: 7,
      type: "workflow.prepare",
      goal: "Update the project",
      recipeInputs: Object.fromEntries(
        Array.from({ length: 6 }, (_, index) => [`context_${index}`, "한".repeat(2048)]),
      ),
    } as const satisfies WeavraControlRequest;
    const line = requestLines(oversizedRequest);
    expect(line.length).toBeLessThan(WEAVRA_CONTROL_MAX_REQUEST_BYTES);
    expect(Buffer.byteLength(line)).toBeGreaterThan(WEAVRA_CONTROL_MAX_REQUEST_BYTES);
    yield* Effect.gen(function* () {
      const bridge = yield* openControlTransport(executable, cwd, env);
      expect(yield* bridge.exchange(helloRequest)).toEqual(helloResponse);
      expect(yield* bridge.exchange(oversizedRequest).pipe(Effect.result)).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "WeavraControlTransportError", code: "OVERSIZED_PAYLOAD" },
      });
      expect(yield* bridge.exchange(confirmRequest)).toEqual(acceptedResponse);
      expect(yield* fs.readFileString(`${cwd}/request-lines`)).toBe(
        requestLines(helloRequest, confirmRequest),
      );
      expect(yield* fs.readFileString(`${cwd}/mutation-lines`)).toBe(requestLines(confirmRequest));
    }).pipe(Effect.scoped);
    expect(yield* fs.readFileString(`${cwd}/control-closed`)).toBe("closed");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("retains a timed-out mutation and resumes its receipt without replaying it", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "weavra-control-timeout-" });
    const executable = writeFakeCli({
      directory: cwd,
      name: "controller",
      source,
      env: { MODE: "timeout" },
    });
    yield* Effect.gen(function* () {
      const bridge = yield* openControlTransport(executable, cwd, env);
      expect(yield* bridge.exchange(helloRequest)).toEqual(helloResponse);
      const first = yield* bridge.exchange(confirmRequest).pipe(Effect.result, Effect.forkScoped);
      yield* waitForFile(`${cwd}/mutation-pending`);
      expect(yield* fs.readFileString(`${cwd}/mutation-lines`)).toBe(requestLines(confirmRequest));
      yield* TestClock.adjust("10 seconds");
      expect(yield* Fiber.join(first)).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "WeavraControlTransportError", code: "REQUEST_TIMEOUT" },
      });
      for (const other of [
        { ...confirmRequest, id: "owner-1:2" },
        { ...confirmRequest, previewDigest: `sha256:${"b".repeat(64)}` },
        snapshotRequest,
      ]) {
        expect(yield* bridge.exchange(other).pipe(Effect.result)).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "WeavraControlTransportError", code: "REQUEST_TIMEOUT" },
        });
      }
      expect(yield* fs.readFileString(`${cwd}/request-lines`)).toBe(
        requestLines(helloRequest, confirmRequest),
      );
      const resumed = yield* bridge.exchange({ ...confirmRequest }).pipe(Effect.forkScoped);
      yield* TestClock.adjust("0 millis");
      yield* fs.writeFileString(`${cwd}/release-response`, "release");
      expect(yield* Fiber.join(resumed)).toEqual(acceptedResponse);
      // The correlated late receipt releases the slot for a fresh canonical read, not another write.
      expect(yield* bridge.exchange(snapshotRequest)).toEqual(snapshotResponse);
      expect(yield* fs.readFileString(`${cwd}/request-lines`)).toBe(
        requestLines(helloRequest, confirmRequest, snapshotRequest),
      );
      expect(yield* fs.readFileString(`${cwd}/mutation-lines`)).toBe(requestLines(confirmRequest));
    }).pipe(Effect.scoped);
    expect(yield* fs.readFileString(`${cwd}/control-closed`)).toBe("closed");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

const exchangePatched = (request: WeavraControlRequest, patch: unknown) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "weavra-complex-transport-" });
    const executable = writeFakeCli({
      directory: cwd,
      name: "controller",
      source,
      env: { MODE: "patch", PATCH: encodeJson(patch) },
    });
    const result = yield* Effect.gen(function* () {
      const bridge = yield* openControlTransport(executable, cwd, env);
      return yield* bridge.exchange(request);
    }).pipe(Effect.scoped, Effect.result);
    expect(yield* fs.readFileString(`${cwd}/request-lines`)).toBe(requestLines(request));
    return result;
  });
const digest = `sha256:${"a".repeat(64)}`;
const pendingRow = (id: string) => ({
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
const planTask = (id: string, dependsOn: ReadonlyArray<string>, path: string) => ({
  id,
  title: `Task ${id}`,
  goal: "Contribute to the parent",
  dependsOn,
  criterionIds: ["AC-001"],
  ownership: [{ path, operation: "modify" }],
  checkIds: ["test"],
  maxRevisionCycles: 2,
});
// Schema-valid shapes only: this boundary proves strict decoding, not digest consistency.
const transportExecution = {
  schemaVersion: 1,
  ownerId: "owner-1",
  projectRevision: 8,
  runId: "run-1",
  stateRevision: 1,
  parent: {
    id: "parent-1",
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
    parentTaskId: "parent-1",
    parentTaskContractDigest: digest,
    tasks: [planTask("CT-001", [], "src/a.ts"), planTask("CT-002", ["CT-001"], "src/b.ts")],
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
  tasks: [pendingRow("CT-001"), pendingRow("CT-002")],
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
    reportedTokens: 0,
    totalRevisionCycles: 0,
    status: "WITHIN_LIMITS",
  },
  cleanup: "NOT_REQUESTED",
  partialChanges: false,
  changesUnknown: false,
  failureCode: null,
};
const complexSnapshot = {
  ...snapshotResponse.data.state.snapshot,
  status: {
    ...snapshotResponse.data.state.snapshot.status,
    run: { ...snapshotResponse.data.state.snapshot.status.run, workflow: "COMPLEX" },
  },
};
const statementBytes = "한".repeat(500);
const overBound = {
  ...transportExecution,
  parent: {
    ...transportExecution.parent,
    goal: "한".repeat(2048),
    acceptanceCriteria: Array.from({ length: 16 }, (_, index) => ({
      ...transportExecution.parent.acceptanceCriteria[0],
      id: `AC-${String(index + 1).padStart(3, "0")}`,
      statement: statementBytes,
    })),
  },
};
const standardPreview = {
  previewId: "preview-1",
  previewDigest: digest,
  ownerId: "owner-1",
  projectRevision: 8,
  expiresAt: 9999999999999,
  goal: "Split the parser",
  workflow: "STANDARD",
  executionMode: "EDIT",
  risk: "R1",
  allowedPaths: ["src"],
  checks: [{ id: "test", kind: "command", required: true }],
  acceptanceCriteria: [
    { id: "AC-001", statement: "Parsing still works", checkIds: ["test"], reviewRequired: true },
  ],
  taskContractDigest: digest,
  recipe: null,
  configuration: {
    mutationMode: "strict",
    verifierTrustMode: "strict",
    verifierSandboxMode: "disabled",
    contextPackMode: "bounded",
    verificationRepairMode: "disabled",
    lspEnabled: false,
  },
};

for (const [label, patch, code] of [
  ["current projection", { snapshot: complexSnapshot, complexExecution: transportExecution }, null],
  [
    "unknown projection field",
    { snapshot: complexSnapshot, complexExecution: { ...transportExecution, taskComplete: true } },
    "INVALID_PAYLOAD",
  ],
  [
    "unknown projection version",
    { snapshot: complexSnapshot, complexExecution: { ...transportExecution, schemaVersion: 2 } },
    "INVALID_PAYLOAD",
  ],
  [
    "unknown task status enum",
    {
      snapshot: complexSnapshot,
      complexExecution: {
        ...transportExecution,
        tasks: [{ ...pendingRow("CT-001"), status: "SKIPPED" }, pendingRow("CT-002")],
      },
    },
    "INVALID_PAYLOAD",
  ],
  [
    "null in place of the optional projection",
    { snapshot: complexSnapshot, complexExecution: null },
    "INVALID_PAYLOAD",
  ],
  [
    "projection above its own byte bound",
    { snapshot: complexSnapshot, complexExecution: overBound },
    "INVALID_PAYLOAD",
  ],
  [
    "oversized response",
    {
      snapshot: complexSnapshot,
      complexExecution: { ...transportExecution, rawTranscript: "PRIVATE_SECRET".repeat(6000) },
    },
    "OVERSIZED_PAYLOAD",
  ],
  [
    "unknown preview workflow",
    { preview: { ...standardPreview, workflow: "PARALLEL" } },
    "INVALID_PAYLOAD",
  ],
  [
    "COMPLEX preview without its plan",
    { preview: { ...standardPreview, workflow: "COMPLEX" } },
    "INVALID_PAYLOAD",
  ],
  [
    "plan on a STANDARD preview",
    { preview: { ...standardPreview, complexPlan: transportExecution.plan } },
    "INVALID_PAYLOAD",
  ],
] as const) {
  it.effect(`decodes COMPLEX ${label} strictly before publication (C38)`, () =>
    Effect.gen(function* () {
      const result = yield* exchangePatched(snapshotRequest, patch);
      if (code === null) {
        expect(result).toMatchObject({
          _tag: "Success",
          success: { data: { state: { complexExecution: transportExecution } } },
        });
      } else {
        expect(result).toMatchObject({ _tag: "Failure", failure: { code } });
        expect(encodeJson(result)).not.toContain("PRIVATE_SECRET");
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
}

for (const [label, version, accepted] of [
  ["contract v1", 1, true],
  ["contract v2 (parallel waves)", 2, true],
  ["a future contract version", 3, false],
  ["null", null, false],
  ["a guessed string version", "2", false],
] as const) {
  it.effect(`capability advertisement with ${label} is exact, never inferred`, () =>
    Effect.gen(function* () {
      const result = yield* exchangePatched(helloRequest, { complexContractVersion: version });
      expect(result).toMatchObject(
        accepted
          ? {
              _tag: "Success",
              success: { data: { capabilities: { complexContractVersion: version } } },
            }
          : { _tag: "Failure", failure: { code: "INVALID_PAYLOAD" } },
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
}

// Contract v2 shapes decode strictly too; which version a connection may carry is the
// RuntimeController's check against the advertised capability.
const { activeTaskId: _activeTaskId, ...transportFieldsV2 } = transportExecution;
const handedOffTransportRow = {
  ...pendingRow("CT-002"),
  status: "HANDED_OFF",
  attempt: 1,
  workerInvocations: 1,
  reportedTokens: 10,
  entryWorkspaceDigest: "c".repeat(64),
};
const transportExecutionV2 = {
  ...transportFieldsV2,
  schemaVersion: 2,
  plan: {
    ...transportExecution.plan,
    schemaVersion: 2,
    limits: { ...transportExecution.plan.limits, maxParallel: 2 },
  },
  activeTaskIds: ["CT-002"],
  tasks: [pendingRow("CT-001"), handedOffTransportRow],
};
for (const [label, complexExecution, accepted] of [
  ["a v2 wave projection", transportExecutionV2, true],
  [
    "a v2 projection with the v1 activeTaskId",
    { ...transportExecutionV2, activeTaskId: null },
    false,
  ],
  [
    "a v1 projection with a HANDED_OFF row",
    { ...transportExecution, tasks: [pendingRow("CT-001"), handedOffTransportRow] },
    false,
  ],
  [
    "a v2 projection carrying a v1 plan",
    { ...transportExecutionV2, plan: transportExecution.plan },
    false,
  ],
  [
    "a v2 plan above four parallel tasks",
    {
      ...transportExecutionV2,
      plan: {
        ...transportExecutionV2.plan,
        limits: { ...transportExecutionV2.plan.limits, maxParallel: 5 },
      },
    },
    false,
  ],
  [
    "a wave of five rows",
    { ...transportExecutionV2, activeTaskIds: ["CT-001", "CT-002", "CT-003", "CT-004", "CT-005"] },
    false,
  ],
  ["an unknown projection version", { ...transportExecutionV2, schemaVersion: 3 }, false],
] as const) {
  it.effect(`decodes ${label} strictly before publication`, () =>
    Effect.gen(function* () {
      const result = yield* exchangePatched(snapshotRequest, {
        snapshot: complexSnapshot,
        complexExecution,
      });
      expect(result).toMatchObject(
        accepted
          ? { _tag: "Success", success: { data: { state: { complexExecution } } } }
          : { _tag: "Failure", failure: { code: "INVALID_PAYLOAD" } },
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
}
