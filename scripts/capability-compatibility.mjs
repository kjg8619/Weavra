import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as NodeServices from "../app/t3code/apps/server/node_modules/@effect/platform-node/dist/NodeServices.js";
import * as Effect from "../app/t3code/apps/server/node_modules/effect/dist/Effect.js";
import { openControlTransport } from "../app/t3code/apps/server/src/weavra/ControlTransport.ts";
import { makeCapabilityInventoryTracker } from "../app/t3code/packages/client-runtime/src/state/capabilityInventory.ts";

// Faux old/future producer: templates are captured current Runtime responses,
// with ONLY the optional-field omission or unsupported extra field injected.
export async function runCompatibility({ env }) {
  const responses = (await readFile(env.WEAVRA_BROKER_WIRE, "utf8")).trim().split("\n").map(JSON.parse);
  const hello = responses.find((r) => r.success && r.data.kind === "capabilities" && r.data.capabilities.readiness === "READY");
  const snapshot = responses.find((r) => r.success && r.data.kind === "snapshot" && r.ownerId === hello.ownerId && r.data.state.capabilityInventory.status === "CURRENT");
  assert.ok(hello && snapshot);
  for (const mode of ["old", "future"]) {
    const log = join(process.env.HOME, `compatibility-${mode}.jsonl`);
    const executable = join(process.env.HOME, `compatibility-${mode}`);
    const modified = structuredClone(snapshot);
    if (mode === "old") delete modified.data.state.capabilityInventory;
    else modified.data.state.futureAuthority = true;
    await writeFile(log, "");
    await writeFile(executable, `#!/usr/bin/env node
const readline = require('node:readline');
const fs = require('node:fs');
const hello = ${JSON.stringify(hello)};
const snapshot = ${JSON.stringify(modified)};
readline.createInterface({input:process.stdin}).on('line', line => {
  const request = JSON.parse(line);
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(request) + '\\n');
  if (!['control.hello','control.snapshot'].includes(request.type)) process.exit(2);
  const response = structuredClone(request.type === 'control.hello' ? hello : snapshot);
  response.id = request.id;
  response.command = request.type;
  process.stdout.write(JSON.stringify(response) + '\\n');
});
`, { mode: 0o700 });
    await Effect.runPromise(Effect.gen(function* () {
      const transport = yield* openControlTransport(executable, process.env.HOME, { PATH: env.PATH, HOME: env.HOME });
      const greeting = yield* transport.exchange({ protocolVersion: 1, id: "hello", type: "control.hello" });
      assert.equal(greeting.success, true);
      const response = yield* transport.exchange({ protocolVersion: 1, id: "snapshot", type: "control.snapshot" }).pipe(Effect.result);
      if (mode === "old") {
        assert.equal(response._tag, "Success");
        assert.equal(response.success.data.state.capabilityInventory, undefined);
        assert.deepEqual(response.success.data.state.snapshot, snapshot.data.state.snapshot);
        const tracker = makeCapabilityInventoryTracker();
        const view = tracker.receive({ status: "CONNECTED", stale: false, state: response.success.data.state, capabilities: hello.data.capabilities, errorCode: null, observedAt: Date.now() }, performance.now());
        assert.equal(view.status, "NOT_EXPOSED");
        assert.equal(view.inventory, null);
      } else {
        assert.equal(response._tag, "Failure");
        assert.equal(response.failure.code, "INVALID_PAYLOAD");
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer), Effect.timeout("10 seconds")));
    assert.deepEqual((await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line).type), ["control.hello", "control.snapshot"]);
  }
  console.log("FAUX producer / ACTUAL ControlTransport PASS N27: absent inventory NOT_EXPOSED, existing state preserved, exactly hello+snapshot; future unknown field rejected");
}
