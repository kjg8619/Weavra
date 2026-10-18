import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import { WeavraControlErrorCode } from "./weavraControl.ts";
import { WeavraTaskRpcError } from "./weavraTaskRpc.ts";

const evidenceCodes = [
  "WORKSPACE_EVIDENCE_CAPACITY",
  "WORKSPACE_EVIDENCE_UNSUPPORTED",
  "WORKSPACE_EVIDENCE_UNAVAILABLE",
] as const;
const decodeControlError = Schema.decodeUnknownSync(WeavraControlErrorCode);
const decodeTaskError = Schema.decodeUnknownSync(WeavraTaskRpcError);

describe("workspace evidence error contracts", () => {
  it.each(evidenceCodes)("preserves %s across control and task error schemas", (code) => {
    const control = decodeControlError(code);
    const task = decodeTaskError({
      _tag: "WeavraTaskRpcError",
      code,
    });

    expect(control).toBe(code);
    expect(task.code).toBe(code);
  });

  it("rejects invented evidence codes rather than broadening either schema", () => {
    const code = "WORKSPACE_EVIDENCE_MISC";

    expect(() => decodeControlError(code)).toThrow();
    expect(() => decodeTaskError({ _tag: "WeavraTaskRpcError", code })).toThrow();
  });
});
