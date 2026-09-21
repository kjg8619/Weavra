import { assert, describe, it } from "@effect/vitest";
import type {
  DesktopTelemetryRequestDesktopUpdate,
  DesktopTelemetryCommitDesktopUpdate,
  DesktopTelemetryCancelDesktopUpdate,
  DesktopUpdateStatusReport,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { vi } from "vite-plus/test";

vi.mock("electron-updater", () => {
  throw new Error("remote product updater transport is unavailable");
});

import * as DesktopTelemetryPublisher from "../telemetry/DesktopTelemetryPublisher.ts";
import * as DesktopRemoteUpdates from "./DesktopRemoteUpdates.ts";
import * as DesktopUpdates from "./DesktopUpdates.ts";
import { makeHarness } from "./updatesTestHarness.ts";

describe("DesktopRemoteUpdates unavailable capability", () => {
  it.effect(
    "answers requests, stale commits, and cancellations with correlated failure instead of executing an updater",
    () => {
      const harness = makeHarness();
      return Effect.scoped(
        Effect.gen(function* () {
          const requests = yield* Queue.unbounded<DesktopTelemetryRequestDesktopUpdate>();
          const commits = yield* Queue.unbounded<DesktopTelemetryCommitDesktopUpdate>();
          const cancellations = yield* Queue.unbounded<DesktopTelemetryCancelDesktopUpdate>();
          const reports = yield* Queue.unbounded<DesktopUpdateStatusReport>();
          const publisher = DesktopTelemetryPublisher.DesktopTelemetryPublisher.of({
            latest: Effect.succeedNone,
            changes: Stream.empty,
            encoded: Stream.empty,
            handleControlForSource: () => Effect.void,
            removeControlSource: () => Effect.void,
            publishUpdateReport: (report) => Queue.offer(reports, report).pipe(Effect.asVoid),
            updateRequests: Stream.fromQueue(requests),
            updateCommits: Stream.fromQueue(commits),
            updateCancellations: Stream.fromQueue(cancellations),
          });
          yield* DesktopRemoteUpdates.listen.pipe(
            Effect.provideService(DesktopTelemetryPublisher.DesktopTelemetryPublisher, publisher),
          );
          const initial = yield* Queue.take(reports);
          assert.equal(initial.state.status, "disabled");
          const assertRefused = (requestId: string) =>
            Effect.gen(function* () {
              const report = yield* Queue.take(reports);
              assert.equal(report.requestId, requestId);
              assert.equal(report.outcome, "failed");
              assert.equal(report.reason, DesktopUpdates.UNAVAILABLE_REASON);
              assert.isFalse(report.state.enabled);
              assert.isNull(report.state.downloadedVersion);
            });
          yield* Queue.offer(requests, {
            version: 1,
            type: "requestDesktopUpdate",
            requestId: "request",
          });
          yield* assertRefused("request");
          yield* Queue.offer(commits, {
            version: 1,
            type: "commitDesktopUpdate",
            requestId: "stale-token",
          });
          yield* assertRefused("stale-token");
          yield* Queue.offer(cancellations, {
            version: 1,
            type: "cancelDesktopUpdate",
            requestId: "cancel",
          });
          yield* assertRefused("cancel");
        }),
      ).pipe(Effect.provide(harness.layer));
    },
  );
});
