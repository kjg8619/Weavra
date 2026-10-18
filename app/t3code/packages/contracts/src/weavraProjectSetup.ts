import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { WeavraTaskScopeInput } from "./weavraTask.ts";

const yaml = Schema.String.check(
  Schema.makeFilter((value) => new TextEncoder().encode(value).length <= 65_536),
);
const targetDigest = Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/));
const configDigest = Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/));
const scope = WeavraTaskScopeInput;
const input = Schema.Union([
  Schema.Struct({ scope, action: Schema.Literal("draft") }),
  Schema.Struct({ scope, action: Schema.Literal("read") }),
  Schema.Struct({ scope, action: Schema.Literal("doctor") }),
  Schema.Struct({ scope, action: Schema.Literal("initialize") }),
  Schema.Struct({
    scope,
    action: Schema.Literal("save"),
    targetDigest,
    yaml,
  }),
  Schema.Struct({
    scope,
    action: Schema.Literal("update"),
    targetDigest,
    expectedConfigDigest: configDigest,
    yaml,
  }),
  // Runs one saved registered check once after explicit user consent; never verification evidence.
  // consent must be literally true: a missing or false consent is rejected before anything runs.
  Schema.Struct({
    scope,
    action: Schema.Literal("trial-check"),
    targetDigest,
    checkId: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(128)),
    consent: Schema.Literal(true),
  }),
]);
const decodeInput = Schema.decodeUnknownOption(input, { onExcessProperty: "error" });
export const WeavraProjectSetupInput = Schema.Unknown.check(
  Schema.makeFilter((value) => Option.isSome(decodeInput(value))),
).pipe(Schema.decodeTo(input));
export type WeavraProjectSetupInput = typeof WeavraProjectSetupInput.Type;

/**
 * Runtime execution-policy verdict per registered check, evaluated without running anything.
 * Optional because older Runtimes omit it; entries keep unknown keys so a newer Runtime's
 * additions survive the server's strict decode. A suggestion is applied only by a user click.
 */
export const WeavraProjectCheckPolicy = Schema.StructWithRest(
  Schema.Struct({
    id: Schema.String,
    policy: Schema.Literals(["allowed", "denied"]),
    reason: Schema.String,
    suggestion: Schema.optionalKey(
      Schema.Struct({
        executable: Schema.String,
        args: Schema.Array(Schema.String),
        note: Schema.String,
      }),
    ),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);
export type WeavraProjectCheckPolicy = typeof WeavraProjectCheckPolicy.Type;
const checkPolicies = Schema.optionalKey(Schema.Array(WeavraProjectCheckPolicy));

/** Deliberate App copy of the standalone Runtime project command JSON contract. */
export const WeavraProjectReadiness = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  ready: Schema.Boolean,
  diagnostics: Schema.Array(
    Schema.Struct({
      code: Schema.String,
      severity: Schema.Literals(["ERROR", "WARN", "INFO"]),
      action: Schema.String,
    }),
  ),
  configuration: Schema.NullOr(
    Schema.Struct({
      requiredChecks: Schema.Finite,
      sandboxMode: Schema.Literals(["disabled", "required"]),
      budgetConfigured: Schema.Boolean,
      maxWorkerInvocations: Schema.NullOr(Schema.Finite),
      maxReportedTokens: Schema.NullOr(Schema.Finite),
    }),
  ),
  workspaceAssessment: Schema.NullOr(
    Schema.Union([
      Schema.Struct({
        schemaVersion: Schema.Literal(1),
        kind: Schema.Literal("supported"),
        profile: Schema.Struct({
          mode: Schema.Literals(["default", "bounded-monorepo"]),
          candidate: Schema.Boolean,
        }),
        fileCount: Schema.Finite,
        totalBytes: Schema.Finite,
      }),
      Schema.Struct({
        schemaVersion: Schema.Literal(1),
        kind: Schema.Literal("unsupported"),
        diagnostic: Schema.Struct({
          code: Schema.Literals([
            "WORKSPACE_EVIDENCE_CAPACITY",
            "WORKSPACE_EVIDENCE_UNSUPPORTED",
            "WORKSPACE_EVIDENCE_UNAVAILABLE",
          ]),
          action: Schema.String,
        }),
      }),
    ]),
  ),
  checkPolicies,
});
export const WeavraProjectSetupOutput = Schema.Union([
  Schema.Struct({
    schemaVersion: Schema.Literal(1),
    kind: Schema.Literal("draft"),
    projectTypes: Schema.Array(Schema.String),
    workspaceProfile: Schema.Union([
      Schema.Struct({
        schemaVersion: Schema.Literal(1),
        kind: Schema.Literal("supported"),
        profile: Schema.Struct({
          mode: Schema.Literals(["default", "bounded-monorepo"]),
          candidate: Schema.Boolean,
        }),
        fileCount: Schema.Finite,
        totalBytes: Schema.Finite,
      }),
      Schema.Struct({
        schemaVersion: Schema.Literal(1),
        kind: Schema.Literal("unsupported"),
        diagnostic: Schema.Struct({
          code: Schema.Literals([
            "WORKSPACE_EVIDENCE_CAPACITY",
            "WORKSPACE_EVIDENCE_UNSUPPORTED",
            "WORKSPACE_EVIDENCE_UNAVAILABLE",
          ]),
          action: Schema.String,
        }),
      }),
    ]),
    yaml,
    checkPolicies,
    // Why a candidate was left out (`NOT_EXECUTABLE:<path>`, `NO_CHECK_CANDIDATES`, ...): codes only.
    notes: Schema.optionalKey(Schema.Array(Schema.String)),
    // Runtime static catalog only; it carries no credential or login state.
    modelAvailability: Schema.optionalKey(
      Schema.Struct({
        providers: Schema.Array(
          Schema.Struct({
            provider: Schema.String,
            models: Schema.Array(Schema.Struct({ id: Schema.String, reasoning: Schema.Boolean })),
          }),
        ),
      }),
    ),
  }),
  Schema.Struct({
    schemaVersion: Schema.Literal(1),
    kind: Schema.Literal("saved"),
    yaml,
    configDigest,
    readiness: WeavraProjectReadiness,
  }),
  Schema.Struct({
    schemaVersion: Schema.Literal(1),
    kind: Schema.Literal("read"),
    yaml,
    configDigest,
    checkPolicies,
  }),
  Schema.Struct({
    ...WeavraProjectReadiness.fields,
    kind: Schema.Literal("doctor"),
  }),
  Schema.Struct({
    schemaVersion: Schema.Literal(1),
    kind: Schema.Literal("initialized"),
  }),
  Schema.Struct({
    schemaVersion: Schema.Literal(1),
    kind: Schema.Literal("trial-check"),
    checkId: Schema.String,
    exitCode: Schema.NullOr(Schema.Finite),
    durationMs: Schema.Finite,
    outputBytes: Schema.Finite,
    truncated: Schema.Boolean,
    timedOut: Schema.Boolean,
    stdoutTail: Schema.String.check(
      Schema.makeFilter((value) => new TextEncoder().encode(value).length <= 2048),
    ),
  }),
  Schema.Struct({
    schemaVersion: Schema.Literal(1),
    kind: Schema.Literal("error"),
    code: Schema.Literals([
      "INVALID_CONFIG",
      "CONFIG_MISSING",
      "STALE_CONFIG",
      "WORKSPACE_BUSY",
      "UNSAFE_PATH",
      "PROJECT_OPERATION_FAILED",
      "OUTPUT_TOO_LARGE",
      "CHECK_NOT_FOUND",
      "CHECK_POLICY_DENIED",
      "CHECK_UNAVAILABLE",
      "TRIAL_CHECK_CONSENT_REQUIRED",
      "TRIAL_CHECK_WRITER_ACTIVE",
    ]),
    message: Schema.String,
  }),
]);
const WeavraProjectModelCandidate = Schema.Struct({
  instanceId: Schema.String,
  displayName: Schema.String,
  provider: Schema.String,
  coding: Schema.String,
  reasoning: Schema.String,
});
export const WeavraProjectSetupResult = Schema.Struct({
  targetDigest,
  result: WeavraProjectSetupOutput,
  presets: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        id: Schema.Literals(["speed", "balanced", "quality"]),
        selected: Schema.NullOr(WeavraProjectModelCandidate),
        alternatives: Schema.Array(WeavraProjectModelCandidate),
      }),
    ),
  ),
  recommendation: Schema.optionalKey(
    Schema.Struct({
      selected: Schema.NullOr(WeavraProjectModelCandidate),
      alternatives: Schema.Array(WeavraProjectModelCandidate),
      anthropicOmitted: Schema.Boolean,
    }),
  ),
});
export type WeavraProjectSetupResult = typeof WeavraProjectSetupResult.Type;

export class WeavraProjectSetupError extends Schema.TaggedError<WeavraProjectSetupError>()(
  "WeavraProjectSetupError",
  {
    code: Schema.Literals(["INVALID_PAYLOAD", "UNAVAILABLE", "TARGET_CHANGED", "WORKSPACE_BUSY"]),
  },
) {}
