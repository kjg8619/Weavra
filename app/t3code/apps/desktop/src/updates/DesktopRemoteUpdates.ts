import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as DesktopTelemetryPublisher from "../telemetry/DesktopTelemetryPublisher.ts";
import * as DesktopUpdates from "./DesktopUpdates.ts";

/** Retain the control protocol and explicitly refuse every remote update operation. */
export const listen = Effect.gen(function* () {
  const updates = yield* DesktopUpdates.DesktopUpdates;
  const publisher = yield* DesktopTelemetryPublisher.DesktopTelemetryPublisher;
  const state = yield* updates.getState;
  yield* publisher.publishUpdateReport({ version: 1, type: "desktopUpdateStatus", state });
  const refuse = (request: { readonly requestId: string }) =>
    publisher.publishUpdateReport({
      version: 1,
      type: "desktopUpdateStatus",
      requestId: request.requestId,
      outcome: "failed",
      reason: DesktopUpdates.UNAVAILABLE_REASON,
      state,
    });
  yield* Stream.runForEach(publisher.updateRequests, refuse).pipe(Effect.forkScoped);
  yield* Stream.runForEach(publisher.updateCommits, refuse).pipe(Effect.forkScoped);
  yield* Stream.runForEach(publisher.updateCancellations, refuse).pipe(Effect.forkScoped);
});
