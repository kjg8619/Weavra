import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import {
  EnvironmentId,
  OrchestrationProjectShell,
  OrchestrationThreadShell,
  ProjectId,
  ThreadId,
  WeavraProjectSetupInput,
} from "@t3tools/contracts";
import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { expect } from "vite-plus/test";
import {
  WorkspaceExecutionOwnership,
  WorkspaceOwnershipError,
} from "../workspace/WorkspaceExecutionOwnership.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { writeFakeCli } from "../testUtils/fakeCli.ts";
import { setupProject } from "./ProjectSetup.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";

const scope = {
  environmentId: EnvironmentId.make("environment"),
  projectId: ProjectId.make("project"),
  threadId: ThreadId.make("thread"),
};
const configDigest = `sha256:${"a".repeat(64)}`;
const decodeThreadShell = Schema.decodeEffect(OrchestrationThreadShell);
const decodeProjectShell = Schema.decodeEffect(OrchestrationProjectShell);
const encodeUpdateInput = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.Struct({ yaml: Schema.String, expectedConfigDigest: Schema.String }),
  ),
);
const encodeTrialCheckInput = Schema.encodeSync(
  Schema.fromJsonString(Schema.Struct({ checkId: Schema.String, consent: Schema.Literal(true) })),
);
const source = `
import {appendFileSync, existsSync} from 'node:fs';
if (process.env.UNTRUSTED_EXECUTABLE) throw new Error('environment leaked');
const args = process.argv.slice(2);
let stdin = '';
for await (const chunk of process.stdin) stdin += chunk;
appendFileSync('invocations.jsonl', JSON.stringify({
  args, cwd: process.cwd(), stdin, untrusted: process.env.UNTRUSTED_EXECUTABLE
}) + '\\n');
const readiness = {schemaVersion:1,ready:!existsSync('not-ready'),diagnostics:existsSync('not-ready')?[{code:'MISSING_TOOL',severity:'ERROR',action:'Install the required tool.'}]:[],configuration:null,workspaceAssessment:null,...(existsSync('policy-denied')?{checkPolicies:[{id:'unit',policy:'denied',reason:'SHELL_COMMAND',suggestion:{executable:'tools/t.sh',args:[],note:'chmod +x'},future:'kept'}]}:{})};
const output = args.join('|') === 'project|draft|--json'
  ? {schemaVersion:1,kind:'draft',projectTypes:['Node'],workspaceProfile:{schemaVersion:1,kind:'supported',profile:{mode:'default',candidate:false},fileCount:1,totalBytes:1},yaml:'candidate'}
  : args.join('|') === 'project|read|--json'
    ? {schemaVersion:1,kind:'read',yaml:'existing config',configDigest:${JSON.stringify(configDigest)}}
    : args.join('|') === 'project|doctor|--app-json'
      ? {...readiness,kind:'doctor'}
      : args.join('|') === 'project|initialize|--json'
        ? {schemaVersion:1,kind:'initialized'}
        : args.join('|') === 'project|init|--stdin|--json'
          ? {schemaVersion:1,kind:'saved',yaml:stdin,configDigest:${JSON.stringify(configDigest)},readiness}
      : args.join('|') === 'project|update|--stdin|--json'
            ? JSON.parse(stdin).expectedConfigDigest === ${JSON.stringify(`sha256:${"b".repeat(64)}`)}
              ? {schemaVersion:1,kind:'error',code:'STALE_CONFIG',message:'설정이 바뀌었어요.'}
              : {schemaVersion:1,kind:'saved',yaml:JSON.parse(stdin).yaml,configDigest:${JSON.stringify(configDigest)},readiness}
            : args.join('|') === 'project|trial-check|--stdin|--json'
              ? JSON.parse(stdin).consent !== true
                ? {schemaVersion:1,kind:'error',code:'TRIAL_CHECK_CONSENT_REQUIRED',message:'동의가 없어요.'}
                : JSON.parse(stdin).checkId === 'denied'
                ? {schemaVersion:1,kind:'error',code:'CHECK_POLICY_DENIED',message:'실행 정책이 거부했어요.'}
                : {schemaVersion:1,kind:'trial-check',checkId:JSON.parse(stdin).checkId,exitCode:3,durationMs:5,outputBytes:20480,truncated:true,timedOut:false,stdoutTail:'tail'}
            : process.exit(42);
process.stdout.write(existsSync('oversized-output') ? 'x'.repeat(131073) : JSON.stringify(output));
if (output.kind === 'error' || (output.kind === 'doctor' && !output.ready)) process.exitCode = 1;
`;
const setup = Effect.fn("test.projectSetup")(function* (
  options: { busy?: boolean; control?: string; executable?: string; nonGit?: boolean } = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const cwd = yield* fs
    .makeTempDirectoryScoped({ prefix: "project-setup-" })
    .pipe(Effect.flatMap(fs.realPath));
  const executable = writeFakeCli({ directory: cwd, name: "setup", source });
  let selectedCwd = cwd;
  let guarded = 0;
  let providerReads = 0;
  const thread = yield* decodeThreadShell({
    id: scope.threadId,
    projectId: scope.projectId,
    title: "Setup fixture",
    modelSelection: { instanceId: "codex", model: "fixture" },
    runtimeMode: "full-access",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    session: null,
    createdAt: "2026-10-16T00:00:00.000Z",
    updatedAt: "2026-10-16T00:00:00.000Z",
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  });
  const project = yield* decodeProjectShell({
    id: scope.projectId,
    title: "Setup fixture",
    workspaceRoot: cwd,
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-10-16T00:00:00.000Z",
    updatedAt: "2026-10-16T00:00:00.000Z",
  });
  const ownership = Layer.mock(WorkspaceExecutionOwnership)({
    environmentId: scope.environmentId,
    resolveTarget: (threadId) =>
      options.nonGit
        ? Effect.fail(
            new WorkspaceOwnershipError({
              cwd,
              reason: "target-changed",
              detail: "No Git repository",
            }),
          )
        : Effect.sync(() => ({
            ...scope,
            threadId,
            target: { workspaceRoot: selectedCwd, worktreePath: null },
            canonicalCwd: selectedCwd,
            repositoryRoot: selectedCwd,
          })),
    withFreshOperation: (input, effect) => {
      guarded++;
      expect(input.kind).toBe("write");
      expect(input.cwd).toBe(selectedCwd);
      return options.busy
        ? Effect.fail(new WorkspaceOwnershipError({ cwd, reason: "owned", detail: "owned" }))
        : effect;
    },
  });
  const run = (input: WeavraProjectSetupInput) =>
    setupProject(input).pipe(
      Effect.provide([
        ownership,
        Layer.mock(ProjectionSnapshotQuery)({
          getThreadShellById: (id) =>
            Effect.succeed(id === scope.threadId ? Option.some(thread) : Option.none()),
          getProjectShellById: (id) =>
            Effect.succeed(
              id === scope.projectId
                ? Option.some({ ...project, workspaceRoot: selectedCwd })
                : Option.none(),
            ),
        }),
        Layer.mock(ProviderRegistry)({
          getProviders: Effect.sync(() => {
            providerReads++;
            return [];
          }),
        }),
      ]),
      Effect.provideService(HostProcessEnvironment, {
        PATH: process.env.PATH,
        T3_WEAVRA_EXECUTABLE: options.executable ?? executable,
        T3_WEAVRA_CONTROL: options.control ?? "1",
        UNTRUSTED_EXECUTABLE: "must-not-reach-child",
      }),
    );
  return {
    run,
    fs,
    cwd,
    changeTarget: () => {
      selectedCwd = `${cwd}/other`;
    },
    guards: () => guarded,
    providerReads: () => providerReads,
  };
});

it.effect(
  "reads and drafts non-Git project metadata without creating a repository or workflow",
  () =>
    Effect.gen(function* () {
      const test = yield* setup({ nonGit: true });
      const read = yield* test.run({ scope, action: "read" });
      expect(read.result.kind).toBe("read");
      const draft = yield* test.run({ scope, action: "draft" });
      expect(draft.result.kind).toBe("draft");
      expect(yield* test.fs.exists(`${test.cwd}/.git`)).toBe(false);
      const calls = (yield* test.fs.readFileString(`${test.cwd}/invocations.jsonl`))
        .trim()
        .split("\n");
      expect(calls).toHaveLength(2);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("keeps Runtime initialization Git-dependent while metadata setup is optional", () =>
  Effect.gen(function* () {
    const test = yield* setup({ nonGit: true });
    const failure = yield* test.run({ scope, action: "initialize" }).pipe(Effect.flip);
    expect(failure.code).toBe("TARGET_CHANGED");
    expect(yield* test.fs.exists(`${test.cwd}/invocations.jsonl`)).toBe(false);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("uses trusted fixed commands and only sends reviewed stdin", () =>
  Effect.gen(function* () {
    const test = yield* setup();
    const draft = yield* test.run({ scope, action: "draft" });
    expect(draft.result).toMatchObject({ kind: "draft", yaml: "candidate" });
    const read = yield* test.run({ scope, action: "read" });
    expect(read.result).toMatchObject({ kind: "read", yaml: "existing config", configDigest });
    const doctor = yield* test.run({ scope, action: "doctor" });
    expect(doctor.result).toMatchObject({ kind: "doctor", ready: true });
    const initialized = yield* test.run({ scope, action: "initialize" });
    expect(initialized.result).toMatchObject({ kind: "initialized" });
    const yaml = "reviewed\n$(not-a-shell)\n";
    const saved = yield* test.run({
      scope,
      action: "save",
      targetDigest: draft.targetDigest,
      yaml,
    });
    expect(saved.result).toMatchObject({ kind: "saved", readiness: { ready: true } });
    const updatedYaml = "updated reviewed yaml\n";
    const updated = yield* test.run({
      scope,
      action: "update",
      targetDigest: draft.targetDigest,
      expectedConfigDigest: configDigest,
      yaml: updatedYaml,
    });
    expect(updated.result).toMatchObject({ kind: "saved", yaml: updatedYaml, configDigest });
    const invocations = (yield* test.fs.readFileString(`${test.cwd}/invocations.jsonl`))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(invocations.map(({ args }) => args)).toEqual([
      ["project", "draft", "--json"],
      ["project", "read", "--json"],
      ["project", "doctor", "--app-json"],
      ["project", "initialize", "--json"],
      ["project", "init", "--stdin", "--json"],
      ["project", "update", "--stdin", "--json"],
    ]);
    expect(invocations.map(({ cwd }) => cwd.replace(/^\/private\/var\//, "/var/"))).toEqual(
      Array.from({ length: 6 }, () => test.cwd.replace(/^\/private\/var\//, "/var/")),
    );
    expect(invocations.map(({ stdin }) => stdin).slice(0, 4)).toEqual(["", "", "", ""]);
    expect(invocations[4]?.stdin).toBe(yaml);
    expect(invocations[5]?.stdin).toBe(
      encodeUpdateInput({ yaml: updatedYaml, expectedConfigDigest: configDigest }),
    );
    expect(invocations.every(({ untrusted }) => untrusted === undefined)).toBe(true);
    expect(test.guards()).toBe(6);
    expect(test.providerReads()).toBe(1);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
it.effect("runs a trial check only with the bound target and passes the bounded result", () =>
  Effect.gen(function* () {
    const test = yield* setup();
    const read = yield* test.run({ scope, action: "read" });
    const stale = yield* test
      .run({
        scope,
        action: "trial-check",
        targetDigest: `sha256:${"c".repeat(64)}`,
        checkId: "unit",
        consent: true,
      })
      .pipe(Effect.flip);
    expect(stale.code).toBe("TARGET_CHANGED");
    const trial = yield* test.run({
      scope,
      action: "trial-check",
      targetDigest: read.targetDigest,
      checkId: "unit",
      consent: true,
    });
    expect(trial.result).toEqual({
      schemaVersion: 1,
      kind: "trial-check",
      checkId: "unit",
      exitCode: 3,
      durationMs: 5,
      outputBytes: 20480,
      truncated: true,
      timedOut: false,
      stdoutTail: "tail",
    });
    const denied = yield* test.run({
      scope,
      action: "trial-check",
      targetDigest: read.targetDigest,
      checkId: "denied",
      consent: true,
    });
    expect(denied.result).toMatchObject({ kind: "error", code: "CHECK_POLICY_DENIED" });
    const invocations = (yield* test.fs.readFileString(`${test.cwd}/invocations.jsonl`))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(invocations.map(({ args, stdin }) => [args.join(" "), stdin])).toEqual([
      ["project read --json", ""],
      [
        "project trial-check --stdin --json",
        encodeTrialCheckInput({ checkId: "unit", consent: true }),
      ],
      [
        "project trial-check --stdin --json",
        encodeTrialCheckInput({ checkId: "denied", consent: true }),
      ],
    ]);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
it.effect("rejects a trial check without consent before starting the Runtime", () =>
  Effect.gen(function* () {
    const test = yield* setup();
    const read = yield* test.run({ scope, action: "read" });
    for (const consent of [{}, { consent: false }, { consent: "true" }]) {
      const result = yield* test
        .run({
          scope,
          action: "trial-check",
          targetDigest: read.targetDigest,
          checkId: "unit",
          ...consent,
        } as unknown as WeavraProjectSetupInput)
        .pipe(Effect.result);
      expect(result).toMatchObject({ _tag: "Failure", failure: { code: "INVALID_PAYLOAD" } });
    }
    const invocations = (yield* test.fs.readFileString(`${test.cwd}/invocations.jsonl`))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(invocations.map(({ args }) => args.join(" "))).toEqual(["project read --json"]);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
it.effect("returns not-ready doctor diagnostics when the CLI exits 1", () =>
  Effect.gen(function* () {
    const test = yield* setup();
    yield* test.fs.writeFileString(`${test.cwd}/not-ready`, "1");
    const result = yield* test.run({ scope, action: "doctor" }).pipe(Effect.result);
    expect(result).toMatchObject({
      _tag: "Success",
      success: {
        result: {
          kind: "doctor",
          ready: false,
          diagnostics: [
            { code: "MISSING_TOOL", severity: "ERROR", action: "Install the required tool." },
          ],
        },
      },
    });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
it.effect("passes Runtime check policy verdicts through and tolerates their absence", () =>
  Effect.gen(function* () {
    const test = yield* setup();
    const before = yield* test.run({ scope, action: "doctor" });
    expect(before.result).not.toHaveProperty("checkPolicies");
    yield* test.fs.writeFileString(`${test.cwd}/policy-denied`, "1");
    const after = yield* test.run({ scope, action: "doctor" });
    expect(after.result).toMatchObject({
      kind: "doctor",
      checkPolicies: [
        {
          id: "unit",
          policy: "denied",
          reason: "SHELL_COMMAND",
          suggestion: { executable: "tools/t.sh", args: [], note: "chmod +x" },
          future: "kept",
        },
      ],
    });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
it.effect("rejects a changed target before publication", () =>
  Effect.gen(function* () {
    const test = yield* setup();
    const draft = yield* test.run({ scope, action: "draft" });
    test.changeTarget();
    const result = yield* test
      .run({ scope, action: "save", targetDigest: draft.targetDigest, yaml: "reviewed" })
      .pipe(Effect.result);
    expect(result).toMatchObject({ _tag: "Failure", failure: { code: "TARGET_CHANGED" } });
    expect(yield* test.fs.exists(`${test.cwd}/received.txt`)).toBe(false);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
it.effect("preserves stale config conflict and rejects stale target before launch", () =>
  Effect.gen(function* () {
    const test = yield* setup();
    const draft = yield* test.run({ scope, action: "draft" });
    const staleConfig = yield* test.run({
      scope,
      action: "update",
      targetDigest: draft.targetDigest,
      expectedConfigDigest: `sha256:${"b".repeat(64)}`,
      yaml: "reviewed",
    });
    expect(staleConfig.result).toMatchObject({
      kind: "error",
      code: "STALE_CONFIG",
      message: "설정이 바뀌었어요.",
    });
    const before = (yield* test.fs.readFileString(`${test.cwd}/invocations.jsonl`))
      .trim()
      .split("\n");
    test.changeTarget();
    const staleTarget = yield* test
      .run({
        scope,
        action: "update",
        targetDigest: draft.targetDigest,
        expectedConfigDigest: configDigest,
        yaml: "reviewed",
      })
      .pipe(Effect.result);
    expect(staleTarget).toMatchObject({ _tag: "Failure", failure: { code: "TARGET_CHANGED" } });
    const after = (yield* test.fs.readFileString(`${test.cwd}/invocations.jsonl`))
      .trim()
      .split("\n");
    expect(after).toHaveLength(before.length);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
it.effect("rejects subprocess output above the 128 KiB bound", () =>
  Effect.gen(function* () {
    const test = yield* setup();
    yield* test.fs.writeFileString(`${test.cwd}/oversized-output`, "1");
    const result = yield* test.run({ scope, action: "draft" }).pipe(Effect.result);
    expect(result).toMatchObject({ _tag: "Failure", failure: { code: "INVALID_PAYLOAD" } });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
for (const options of [{ busy: true }, { control: "0" }, { executable: "relative" }]) {
  it.effect(`refuses disabled, untrusted or owned setup ${JSON.stringify(options)}`, () =>
    Effect.gen(function* () {
      const test = yield* setup(options);
      const result = yield* test.run({ scope, action: "draft" }).pipe(Effect.result);
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { code: "busy" in options ? "WORKSPACE_BUSY" : "UNAVAILABLE" },
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
}
it.effect("rejects cross-environment and cross-project selectors", () =>
  Effect.gen(function* () {
    const test = yield* setup();
    for (const selected of [
      { ...scope, environmentId: EnvironmentId.make("other") },
      { ...scope, projectId: ProjectId.make("other") },
    ]) {
      expect(
        yield* test.run({ scope: selected, action: "draft" }).pipe(Effect.result),
      ).toMatchObject({ _tag: "Failure", failure: { code: "TARGET_CHANGED" } });
    }
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
it.effect("rejects caller execution authority and oversized YAML at the RPC boundary", () =>
  Effect.gen(function* () {
    const decode = Schema.decodeUnknownEffect(WeavraProjectSetupInput);
    for (const extra of [
      { executable: "/bin/sh" },
      { cwd: "/other" },
      { argv: ["-c", "touch file"] },
      { env: {} },
    ]) {
      expect(yield* decode({ scope, action: "draft", ...extra }).pipe(Effect.result)).toMatchObject(
        { _tag: "Failure" },
      );
    }
    expect(
      yield* decode({
        scope,
        action: "save",
        targetDigest: `sha256:${"a".repeat(64)}`,
        yaml: "é".repeat(32769),
      }).pipe(Effect.result),
    ).toMatchObject({ _tag: "Failure" });
  }),
);
