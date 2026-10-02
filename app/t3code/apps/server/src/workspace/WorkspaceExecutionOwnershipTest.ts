import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as Ownership from "./WorkspaceExecutionOwnership.ts";

export const environmentLayer = Layer.succeed(ServerEnvironment, {
  getEnvironmentId: Effect.succeed(EnvironmentId.make("ownership-environment")),
  getDescriptor: Effect.die("The ownership fixture does not expose an environment descriptor."),
});

/** Use the enclosing graph's database; never create a second ownership source of truth. */
export const baseLayer = Ownership.layer.pipe(
  Layer.provide(environmentLayer),
  Layer.provide(ProcessRunner.layer),
);

/** Real registry and migrated SQLite for fixtures without an existing database. */
export const layer = baseLayer.pipe(
  Layer.provide(SqlitePersistenceMemory),
  Layer.provide(NodeServices.layer),
  Layer.orDie,
);

/** Service factories return closures; keep their database alive in the enclosing test scope. */
export const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const services = yield* Layer.build(layer);
    return yield* effect.pipe(Effect.provide(services));
  });
