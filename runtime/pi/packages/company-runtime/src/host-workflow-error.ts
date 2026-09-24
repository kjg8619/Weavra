import type { HostControlErrorCode } from "./host-control-protocol.ts";

/**
 * Host planning refusal with an existing Host Control error code. Kept free of workflow/model imports so the
 * pure COMPLEX plan compiler can report the same codes; no Run, writer, worker or check exists at this point.
 */
export class HostWorkflowError extends Error {
	readonly code: HostControlErrorCode;

	constructor(code: HostControlErrorCode, message: string) {
		super(message);
		this.name = "HostWorkflowError";
		this.code = code;
	}
}
