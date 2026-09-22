import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as NodeServices from "../app/t3code/apps/server/node_modules/@effect/platform-node/dist/NodeServices.js";
import * as Effect from "../app/t3code/apps/server/node_modules/effect/dist/Effect.js";
import * as Fiber from "../app/t3code/apps/server/node_modules/effect/dist/Fiber.js";
import * as Layer from "../app/t3code/apps/server/node_modules/effect/dist/Layer.js";
import * as Option from "../app/t3code/apps/server/node_modules/effect/dist/Option.js";
import * as Queue from "../app/t3code/apps/server/node_modules/effect/dist/Queue.js";
import * as Stream from "../app/t3code/apps/server/node_modules/effect/dist/Stream.js";
import * as Schema from "../app/t3code/apps/server/node_modules/effect/dist/Schema.js";
import * as Context from "../app/t3code/apps/server/node_modules/effect/dist/Context.js";
import * as Tool from "../app/t3code/apps/server/node_modules/effect/dist/unstable/ai/Tool.js";
import { HostProcessEnvironment } from "../app/t3code/packages/shared/src/hostProcess.ts";
import { ProjectionSnapshotQuery } from "../app/t3code/apps/server/src/orchestration/Services/ProjectionSnapshotQuery.ts";
import { make } from "../app/t3code/apps/server/src/weavra/RuntimeController.ts";
import { WeavraControlState, WeavraControlRequest, WeavraCapabilityInventory } from "../app/t3code/packages/contracts/src/weavraControl.ts";
import { makeCapabilityInventoryTracker } from "../app/t3code/packages/client-runtime/src/state/capabilityInventory.ts";
import { PreviewToolkit } from "../app/t3code/apps/server/src/mcp/toolkits/preview/tools.ts";
import { CapabilityInventory } from "../app/t3code/apps/web/src/components/settings/CapabilityInventory.tsx";
import { createElement } from "../app/t3code/apps/web/node_modules/react/index.js";
import { renderToStaticMarkup } from "../app/t3code/apps/web/node_modules/react-dom/server.node.js";

const decode = Schema.decodeUnknownSync(WeavraControlState, { onExcessProperty: "error" });
const decodeRequest = Schema.decodeUnknownSync(WeavraControlRequest, { onExcessProperty: "error" });
const decodeInventory = Schema.decodeUnknownSync(WeavraCapabilityInventory, { onExcessProperty: "error" });
const next = (queue, predicate = () => true) => Stream.fromQueue(queue).pipe(Stream.filter(predicate), Stream.runHead, Effect.map(Option.getOrThrow), Effect.timeout("20 seconds"));
const connected = (queue) => next(queue, (value) => value.status === "CONNECTED" && !value.stale);
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

export async function runAppIntegration({ executable, project, env, configPath, config, actual, sentinels }) {
  // Instrumentation wrapper only: exec the exact production launcher; no faux protocol.
  // Controller intentionally allowlists environment, so the wrapper adds test guards.
  const guarded = join(process.env.HOME, "guarded-runtime");
  const instrumentation = Object.entries(env).filter(([key]) => key.startsWith("WEAVRA_BROKER_") || key === "NODE_OPTIONS");
  await writeFile(guarded, `#!/bin/sh\n${instrumentation.map(([key, value]) => `export ${key}=${shellQuote(value)}`).join("\n")}\nexec ${shellQuote(executable)} "$@"\n`, { mode: 0o700 });
  let checked;
  let markup;
  await Effect.runPromise(Effect.gen(function* () {
    const projectId = "broker-project";
    const controller = yield* make().pipe(
      Effect.provide(Layer.mock(ProjectionSnapshotQuery)({ getProjectShellById: (id) => Effect.succeed(id === projectId ? Option.some({ id, workspaceRoot: project, title: "Broker integration", defaultModelSelection: null, scripts: [], createdAt: "2026-09-22T00:00:00.000Z", updatedAt: "2026-09-22T00:00:00.000Z" }) : Option.none()) })),
      Effect.provideService(HostProcessEnvironment, { ...env, T3_WEAVRA_EXECUTABLE: guarded, T3_WEAVRA_CONTROL: "1" }),
    );
    const initialQueue = yield* Queue.unbounded();
    const initialConsumer = yield* controller.observe(projectId).pipe(Stream.runForEach((value) => Queue.offer(initialQueue, value)), Effect.forkScoped);
    const initial = yield* connected(initialQueue);
    assert.equal(initial.state.capabilityInventory.status, "CURRENT");
    // A second subscription really receives RuntimeController's cached CURRENT state.
    const queue = yield* Queue.unbounded();
    const consumer = yield* controller.observe(projectId).pipe(Stream.runForEach((value) => Queue.offer(queue, value)), Effect.forkScoped);
    const tracker = makeCapabilityInventoryTracker();
    const baseline = yield* next(queue);
    assert.equal(baseline.status, "CONNECTED");
    assert.equal(baseline.state.capabilityInventory.generation, initial.state.capabilityInventory.generation);
    const staleView = tracker.receive(baseline, performance.now());
    assert.equal(staleView.status, "NEEDS_REFRESH");
    const advanced = yield* next(queue, (value) => value.state?.capabilityInventory.generation > baseline.state.capabilityInventory.generation);
    checked = advanced;
    const currentView = tracker.receive(advanced, performance.now());
    assert.equal(currentView.status, "CURRENT");
    assert.equal(advanced.state.ownerId, baseline.state.ownerId);
    // Withhold new inventory deliveries from this tracker while an independent
    // workflow observer remains connected to the actual service-owned Runtime.
    yield* Fiber.interrupt(consumer);
    const received = performance.now();
    tracker.receive(advanced, received);
    yield* Effect.sleep("5100 millis");
    assert.equal(tracker.view(performance.now()).status, "NEEDS_REFRESH");
    const workflowFresh = yield* next(initialQueue, (value) => value.status === "CONNECTED" && !value.stale && value.observedAt >= advanced.observedAt + 5000);
    assert.ok(workflowFresh.state.capabilityInventory.generation > advanced.state.capabilityInventory.generation);
    assert.deepEqual(workflowFresh.state.snapshot.status, advanced.state.snapshot.status);
    assert.equal(workflowFresh.stale, false);
    yield* Fiber.interrupt(initialConsumer);
    assert.equal(tracker.receive(advanced, performance.now()).status, "NEEDS_REFRESH");
    const render = (view) => renderToStaticMarkup(createElement(CapabilityInventory, { view, connected: true, scope: project }));
    const staleHtml = render(staleView);
    const currentHtml = render(currentView);
    const expiredHtml = render(tracker.view(performance.now()));
    assert.match(staleHtml, /Historical observation/);
    assert.match(currentHtml, /LSP_NOT_OBSERVED/);
    assert.match(currentHtml, /AVAILABLE/);
    assert.match(expiredHtml, /Historical observation/);
    assert.doesNotMatch(currentHtml, /<(?:button|input|select)\b/);
    for (const sentinel of sentinels) assert.equal((staleHtml + currentHtml + expiredHtml).includes(sentinel), false);
    markup = `<!doctype html><meta charset="utf-8"><title>Actual Broker boundary capture</title><main><h1>Actual Runtime → App inventory</h1><h2>First subscription cache</h2>${staleHtml}<h2>Checked generation</h2>${currentHtml}<h2>After five seconds</h2>${expiredHtml}</main>`;
    const requeue = yield* Queue.unbounded();
    yield* controller.observe(projectId).pipe(Stream.runForEach((value) => Queue.offer(requeue, value)), Effect.forkScoped);
    const resumed = yield* connected(requeue);
    assert.equal(resumed.state.ownerId, advanced.state.ownerId);
    assert.ok(resumed.state.capabilityInventory.generation > advanced.state.capabilityInventory.generation);
    const restartedTracker = makeCapabilityInventoryTracker();
    assert.equal(restartedTracker.receive(resumed, performance.now()).status, "NEEDS_REFRESH");
    const fresh = yield* next(requeue, (value) => value.state?.capabilityInventory.generation > resumed.state.capabilityInventory.generation);
    assert.equal(restartedTracker.receive(fresh, performance.now()).status, "CURRENT");
    // A real ephemeral mutation allows detecting accidental replay after process loss.
    const draft = yield* controller.command({ projectId, request: {
      protocolVersion: 1, id: fresh.state.nextRequestId, ownerId: fresh.state.ownerId,
      expectedProjectRevision: fresh.state.projectRevision, type: "facts.prepare", sourceRef: "src/status.txt", statement: "Status initially says Ready.",
    } });
    assert.equal(draft.success, true, JSON.stringify(draft));
    const prepared = yield* next(requeue, (value) => value.state?.factPreview !== null && value.state?.factPreview !== undefined);
    assert.equal(prepared.state.factPreview.previewId, draft.data.preview.previewId);
    const events = (yield* Effect.promise(() => readFile(env.WEAVRA_BROKER_LEDGER, "utf8"))).trim().split("\n").map(JSON.parse);
    const pid = events.filter((event) => event.type === "guard-ready").at(-1).pid;
    // PID is recorded by this exact scoped child, never discovered from unrelated processes.
    process.kill(pid, "SIGTERM");
    const lost = yield* next(requeue, (value) => value.stale && ["DISCONNECTED", "RECONNECTING"].includes(value.status));
    assert.notEqual(restartedTracker.receive(lost, performance.now()).status, "CURRENT");
    const replacement = yield* next(requeue, (value) => value.status === "CONNECTED" && !value.stale && value.state.ownerId !== prepared.state.ownerId);
    assert.notEqual(replacement.state.capabilityInventory.brokerEpoch, prepared.state.capabilityInventory.brokerEpoch);
    assert.equal(replacement.state.capabilityInventory.generation, 1);
    assert.equal(replacement.state.factPreview, null);
    assert.deepEqual(replacement.state.projectFacts.entries, []);
    assert.equal(replacement.state.snapshot.status.run, null);
    assert.equal(restartedTracker.receive(replacement, performance.now()).status, "CURRENT");
    assert.equal(restartedTracker.receive(prepared, performance.now()).status, "NEEDS_REFRESH");
    assert.equal(restartedTracker.view(performance.now()).inventory, null);
    yield* Effect.promise(() => writeFile(configPath, "invalid: ["));
    const unavailable = yield* next(requeue, (value) => value.state?.capabilityInventory.status === "UNKNOWN");
    assert.equal(unavailable.state.capabilityInventory.reason, "CONFIG_UNAVAILABLE");
    assert.deepEqual(unavailable.state.capabilityInventory.entries, []);
    yield* Effect.promise(() => writeFile(configPath, JSON.stringify(config)));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer), Effect.timeout("45 seconds")));
  console.log("ACTUAL PASS N10/N11/N12/N26: RuntimeController cached subscription, checked generation, 5s age, same-owner resubscribe, process loss/reconnect/new owner+epoch, no facts.prepare replay");

  const base = actual.state;
  const change = (mutate) => { const state = structuredClone(base); mutate(state); return state; };
  // All malicious/impossible producer states below are deterministic injections.
  const patches = [
    (s) => { s.capabilityInventory.enabled = true; },
    (s) => { s.capabilityInventory.approved = true; },
    (s) => { s.capabilityInventory.permissions = { write: true }; },
    (s) => { s.capabilityInventory.extra = "field"; },
    (s) => { s.capabilityInventory.entries[0].descriptor.origin = "external-provider"; },
    (s) => { s.capabilityInventory.entries[0].descriptor.transport = "stdio"; },
    (s) => { s.capabilityInventory.entries[0].observation.availability = "APPROVED"; },
    (s) => { s.capabilityInventory.schemaVersion = 0; },
    (s) => { s.capabilityInventory.entries[0].descriptor.schemaDigest = "forged"; },
    (s) => { s.capabilityInventory.ownerId = "foreign"; },
    (s) => { s.capabilityInventory.projectRevision++; },
    (s) => { s.capabilityInventory.entries.push(s.capabilityInventory.entries[0]); },
    (s) => { s.futureAuthority = true; },
  ];
  for (const patch of patches) assert.throws(() => decode(change(patch)));
  const tools = Object.values(PreviewToolkit.tools);
  const advertisements = tools.map((tool) => ({ name: tool.name, annotations: {
    readOnlyHint: Context.get(tool.annotations, Tool.Readonly), destructiveHint: Context.get(tool.annotations, Tool.Destructive),
    idempotentHint: Context.get(tool.annotations, Tool.Idempotent), openWorldHint: Context.get(tool.annotations, Tool.OpenWorld),
  } }));
  assert.equal(advertisements.length, 14);
  assert.ok(advertisements.some((tool) => tool.annotations.readOnlyHint && tool.annotations.openWorldHint));
  assert.ok(advertisements.some((tool) => tool.annotations.destructiveHint));
  for (const tool of advertisements) {
    for (const metadata of [{ toolkit: tool }, { permissions: tool.annotations }, { approved: true }, { workerTools: [tool] }, { evidence: { status: "PASS", source: tool } }, { status: "COMPLETE" }]) {
      assert.throws(() => decodeInventory({ ...base.capabilityInventory, ...metadata }));
      assert.throws(() => decodeRequest({ protocolVersion: 1, id: "injected", type: "control.snapshot", ...metadata }));
    }
    assert.equal(base.capabilityInventory.entries.some((row) => row.descriptor.name === tool.name), false);
  }
  const tracker = makeCapabilityInventoryTracker();
  const input = (state) => ({ ...actual.observation, state: decode(state) });
  tracker.receive(input(base), 0);
  const advanced = change((s) => { s.capabilityInventory.generation++; });
  assert.equal(tracker.receive(input(advanced), 1).status, "CURRENT");
  assert.equal(tracker.receive(input(advanced), 4999).status, "CURRENT");
  assert.equal(tracker.view(5001).status, "NEEDS_REFRESH");
  const removed = structuredClone(advanced);
  removed.capabilityInventory.generation++;
  removed.capabilityInventory.entries = removed.capabilityInventory.entries.slice(1);
  removed.capabilityInventory.total--;
  assert.equal(tracker.receive(input(removed), 5002).inventory.entries.length, 9);
  assert.equal(tracker.view(5002).inventory.entries.some((row) => row.descriptor.id === advanced.capabilityInventory.entries[0].descriptor.id), false);
  const sameChanged = structuredClone(removed);
  sameChanged.capabilityInventory.observedAt++;
  for (const row of sameChanged.capabilityInventory.entries) row.observation.observedAt++;
  assert.equal(tracker.receive(input(sameChanged), 5003).status, "NEEDS_REFRESH");
  assert.equal(tracker.receive(input(base), 5004).status, "NEEDS_REFRESH");
  const newEpoch = structuredClone(removed);
  newEpoch.capabilityInventory.brokerEpoch = randomUUID();
  newEpoch.capabilityInventory.generation = 1;
  assert.equal(tracker.receive(input(newEpoch), 5005).status, "CURRENT");
  assert.equal(tracker.receive(input(removed), 5006).status, "NEEDS_REFRESH");
  const absent = structuredClone(base);
  delete absent.capabilityInventory;
  assert.equal(tracker.receive(input(absent), 5007).status, "NOT_EXPOSED");
  assert.deepEqual(decode(absent).snapshot, base.snapshot);
  const unknown = structuredClone(newEpoch);
  Object.assign(unknown.capabilityInventory, { generation: 2, status: "UNKNOWN", reason: "CONFIG_UNAVAILABLE", entries: [], total: null, omitted: 0 });
  assert.equal(tracker.receive(input(unknown), 5008).status, "UNKNOWN");
  const changed = structuredClone(unknown);
  Object.assign(changed.capabilityInventory, { generation: 3, status: "NEEDS_REFRESH", reason: "SOURCE_CHANGED" });
  assert.equal(tracker.receive(input(changed), 5009).status, "NEEDS_REFRESH");
  assert.deepEqual(base.snapshot, actual.state.snapshot);
  assert.equal(await readFile(join(project, "src/status.txt"), "utf8"), "Ready\n");
  const events = (await readFile(env.WEAVRA_BROKER_LEDGER, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(events.filter((event) => event.type === "request" && event.command === "facts.prepare").length, 1);
  if (process.env.WEAVRA_BROKER_CAPTURE) await writeFile(process.env.WEAVRA_BROKER_CAPTURE, markup);
  console.log("DETERMINISTIC PASS N02–N09/N18/N19/N25/N27: injected closed-schema rejection, actual MCP annotations rejected as authority, complete replacement/no union, same-owner epoch replacement/equal generation/retired epoch/absent field; rendered actual snapshot sentinel-free");
  return { checked, advertisements, renderedBytes: Buffer.byteLength(markup) };
}
