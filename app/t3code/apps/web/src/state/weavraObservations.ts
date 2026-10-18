import { createEnvironmentWeavraStateAtoms } from "@t3tools/client-runtime/state/weavra";
import { connectionAtomRuntime } from "../connection/runtime";

export const observations = createEnvironmentWeavraStateAtoms(connectionAtomRuntime);
