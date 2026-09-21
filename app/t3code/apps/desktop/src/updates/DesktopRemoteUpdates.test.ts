import { assert, it } from "@effect/vitest";
import type {
  DesktopTelemetryRequestDesktopUpdate,
  DesktopUpdateStatusReport,
} from "@t3tools/contracts";
import { APP_UPDATE_UNAVAILABLE_REASON } from "@t3tools/shared/cliRelease";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as DesktopTelemetryPublisher from "../telemetry/DesktopTelemetryPublisher.ts";
import * as DesktopRemoteUpdates from "./DesktopRemoteUpdates.ts";
import * as DesktopUpdates from "./DesktopUpdates.ts";
import { makeHarness } from "./updatesTestHarness.ts";

it.effect("reports a remote update as unavailable without contacting the updater", () => {
  const harness = makeHarness();
  return Effect.scoped(
    Effect.gen(function* () {
      const requests = yield* Queue.unbounded<DesktopTelemetryRequestDesktopUpdate>();
      const terminal = yield* Deferred.make<DesktopUpdateStatusReport>();
      const publisher = DesktopTelemetryPublisher.DesktopTelemetryPublisher.of({
        latest: Effect.succeedNone,
        changes: Stream.empty,
        encoded: Stream.empty,
        handleControlForSource: () => Effect.void,
        removeControlSource: () => Effect.void,
        publishUpdateReport: (report) =>
          report.outcome === undefined
            ? Effect.void
            : Deferred.succeed(terminal, report).pipe(Effect.asVoid),
        updateRequests: Stream.fromQueue(requests),
        updateCommits: Stream.empty,
        updateCancellations: Stream.empty,
      });
      const updates = yield* DesktopUpdates.DesktopUpdates;
      yield* updates.configure;
      yield* DesktopRemoteUpdates.listen.pipe(
        Effect.provideService(DesktopTelemetryPublisher.DesktopTelemetryPublisher, publisher),
      );
      yield* Queue.offer(requests, {
        version: 1,
        type: "requestDesktopUpdate",
        requestId: "vendor-release",
      });
      const report = yield* Deferred.await(terminal);
      assert.equal(report.outcome, "failed");
      assert.equal(report.reason, APP_UPDATE_UNAVAILABLE_REASON);
      assert.equal(report.state.enabled, false);
      assert.equal(harness.checkCount(), 0);
      assert.equal(harness.downloadCount(), 0);
      assert.equal(harness.quitAndInstalls(), 0);
    }),
  ).pipe(Effect.provide(harness.layer));
});
