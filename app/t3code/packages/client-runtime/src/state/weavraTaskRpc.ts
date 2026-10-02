import { WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import {
  request,
  EnvironmentRpcUnavailableError,
  type EnvironmentRpcFailure,
  type EnvironmentRpcInput,
  type EnvironmentRpcSuccess,
} from "../rpc/client.ts";

export type WeavraTaskRpcTag =
  | typeof WS_METHODS.weavraTaskCreate
  | typeof WS_METHODS.weavraTaskAnalyze
  | typeof WS_METHODS.weavraTaskFollowup
  | typeof WS_METHODS.weavraTaskRead
  | typeof WS_METHODS.weavraTaskList
  | typeof WS_METHODS.weavraTaskPrepare
  | typeof WS_METHODS.weavraTaskConfirm
  | typeof WS_METHODS.weavraTaskReconcile
  | typeof WS_METHODS.weavraTaskRecover
  | typeof WS_METHODS.weavraTaskAbort
  | typeof WS_METHODS.weavraTaskReprepare
  | typeof WS_METHODS.weavraTaskCancel
  | typeof WS_METHODS.weavraTaskReadApproval
  | typeof WS_METHODS.weavraTaskResolveApproval
  | typeof WS_METHODS.weavraTaskEvidence;

export class WeavraTaskCapabilityError extends Schema.TaggedError<WeavraTaskCapabilityError>()(
  "WeavraTaskCapabilityError",
  {
    environmentId: Schema.String,
    code: Schema.Literals(["TRANSPORT_CLOSED", "INCOMPATIBLE_CAPABILITIES"]),
  },
) {}

export function requestWeavraTask<TTag extends WeavraTaskRpcTag>(
  tag: TTag,
  input: EnvironmentRpcInput<TTag>,
): Effect.Effect<
  EnvironmentRpcSuccess<TTag>,
  WeavraTaskCapabilityError | EnvironmentRpcUnavailableError | EnvironmentRpcFailure<TTag>,
  EnvironmentSupervisor
> {
  return Effect.gen(function* () {
    const supervisor = yield* EnvironmentSupervisor;
    const selected = yield* SubscriptionRef.get(supervisor.session);
    if (Option.isNone(selected)) {
      return yield* new WeavraTaskCapabilityError({
        environmentId: supervisor.target.environmentId,
        code: "TRANSPORT_CLOSED",
      });
    }
    const config = yield* selected.value.initialConfig.pipe(Effect.orElseSucceed(() => null));
    const active = yield* SubscriptionRef.get(supervisor.session);
    if (Option.isNone(active) || active.value !== selected.value) {
      return yield* new WeavraTaskCapabilityError({
        environmentId: supervisor.target.environmentId,
        code: "TRANSPORT_CLOSED",
      });
    }
    if (config?.environment.capabilities.weavraTasks !== true) {
      return yield* new WeavraTaskCapabilityError({
        environmentId: supervisor.target.environmentId,
        code: "INCOMPATIBLE_CAPABILITIES",
      });
    }
    if (
      (tag === WS_METHODS.weavraTaskAnalyze || tag === WS_METHODS.weavraTaskFollowup) &&
      config.environment.capabilities.weavraTaskAnalysis !== "codex-read-only-v1"
    ) {
      return yield* new WeavraTaskCapabilityError({
        environmentId: supervisor.target.environmentId,
        code: "INCOMPATIBLE_CAPABILITIES",
      });
    }
    if (
      tag === WS_METHODS.weavraTaskRecover &&
      config.environment.capabilities.weavraTaskRecovery !== 1
    ) {
      return yield* new WeavraTaskCapabilityError({
        environmentId: supervisor.target.environmentId,
        code: "INCOMPATIBLE_CAPABILITIES",
      });
    }
    return yield* request(tag, input);
  });
}
