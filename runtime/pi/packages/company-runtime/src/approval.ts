import {
	type ApprovalDecision,
	ApprovalDecisionSchema,
	type ApprovalRecord,
	type ApprovalRequest,
	type R3Scope,
	validateContract,
} from "./contracts.ts";
import { isPolicyPath } from "./policy.ts";
import type { ApprovalPort } from "./ports.ts";

/** Exact initial S5C action grammar; no arbitrary destructive request becomes executable. */
export function selectR3Scope(goal: string, runId: string): R3Scope | undefined {
	const match = /^(?:(?:delete|remove) file|파일 삭제) ([^\s]+)$/i.exec(goal.trim());
	if (!match || !isPolicyPath(match[1])) return undefined;
	return { runId, targetPath: match[1] };
}

/** A timeout/cancelled/late/foreign answer is not consent. Non-cooperative UI cannot keep a grant alive. */
export async function awaitApproval(
	request: ApprovalRequest,
	port: ApprovalPort,
	signal?: AbortSignal,
	now: () => number = Date.now,
): Promise<{ decision: ApprovalDecision; status: ApprovalRecord["status"] }> {
	const controller = new AbortController();
	const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
	const denied: ApprovalDecision = {
		runId: request.runId,
		actionId: request.actionId,
		actionDigest: request.actionDigest,
		configDigest: request.configDigest,
		expiresAt: request.expiresAt,
		approved: false,
	};
	let listener: (() => void) | undefined;
	const timeout = setTimeout(() => controller.abort(), Math.max(0, request.expiresAt - now()));
	try {
		const cancelled = new Promise<undefined>((resolve) => {
			listener = () => resolve(undefined);
			combined.addEventListener("abort", listener, { once: true });
			if (combined.aborted) listener();
		});
		const answer =
			combined.aborted || now() >= request.expiresAt
				? undefined
				: await Promise.race([
						Promise.resolve()
							.then(() =>
								combined.aborted || now() >= request.expiresAt
									? undefined
									: port.requestApproval(structuredClone(request), combined),
							)
							.catch(() => undefined),
						cancelled,
					]);
		if (signal?.aborted) return { decision: denied, status: "CANCELLED" };
		if (controller.signal.aborted || now() >= request.expiresAt) return { decision: denied, status: "EXPIRED" };
		if (!answer) return { decision: denied, status: "DENIED" };
		try {
			validateContract(ApprovalDecisionSchema, answer);
		} catch {
			return { decision: denied, status: "DENIED" };
		}
		if (Object.entries(denied).some(([key, value]) => key !== "approved" && Reflect.get(answer, key) !== value))
			return { decision: denied, status: "DENIED" };
		return {
			decision: { ...denied, approved: answer.approved === true },
			status: answer.approved ? "APPROVED" : "DENIED",
		};
	} finally {
		clearTimeout(timeout);
		if (listener) combined.removeEventListener("abort", listener);
		controller.abort();
	}
}
