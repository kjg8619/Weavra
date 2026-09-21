import type { VerificationRequest } from "../ports.ts";
import { ProcessCleanupError } from "../process-runner.ts";
import type { LspConfig, LspEvidence, LspPort } from "./types.ts";

/** Advisory evidence only. Never emits CheckResult/PASS/FAIL or changes required check registration. */
export async function collectLspEvidence(
	port: LspPort,
	config: LspConfig,
	request: VerificationRequest,
	changedFiles: readonly string[],
	diffDigest: string,
): Promise<LspEvidence[]> {
	const paths = [...new Set(changedFiles)].sort();
	const routed = paths.filter((path) =>
		config.servers.some((server) => server.extensions.some((extension) => path.toLowerCase().endsWith(extension))),
	);
	const evidence: LspEvidence[] = [];
	for (const path of routed.slice(0, 8)) {
		request.signal?.throwIfAborted();
		const startedAt = Date.now();
		let item: Omit<LspEvidence, "diffDigest" | "evidenceRef">;
		try {
			const result = await port.diagnostics({ path, signal: request.signal });
			item = {
				serverId: result.serverId,
				status: result.status,
				diagnostics: result.diagnostics,
				reason: result.reason,
				startedAt: result.startedAt,
				finishedAt: result.finishedAt,
				withheld: result.withheld,
				truncated: result.truncated,
			};
		} catch (error) {
			if (error instanceof ProcessCleanupError) throw error;
			request.signal?.throwIfAborted();
			item = {
				serverId: "unavailable",
				status: "UNAVAILABLE",
				diagnostics: [],
				reason: "Diagnostic target unavailable or denied",
				startedAt,
				finishedAt: Date.now(),
				withheld: 0,
				truncated: 0,
			};
		}
		evidence.push({
			...item,
			diffDigest,
			evidenceRef: `lsp:${request.runId}:${request.step.stepId}:${request.step.attempt}:${evidence.length}`,
		});
	}
	if (!routed.length || routed.length > 8) {
		const now = Date.now();
		evidence.push({
			serverId: "runtime",
			status: routed.length ? "PARTIAL" : "UNAVAILABLE",
			diagnostics: [],
			diffDigest,
			evidenceRef: `lsp:${request.runId}:${request.step.stepId}:${request.step.attempt}:${evidence.length}`,
			startedAt: now,
			finishedAt: now,
			withheld: 0,
			truncated: Math.max(0, routed.length - 8),
			reason: routed.length
				? "Diagnostic file budget exceeded"
				: "No changed files routed to configured servers; no diagnostics queried",
		});
	}
	return evidence;
}
export function markStaleLspEvidence(evidence: LspEvidence[], currentDigest: string, safe: boolean): void {
	for (const item of evidence)
		if (!safe || item.diffDigest !== currentDigest) {
			item.status = "STALE";
			item.reason = "Workspace changed after diagnostics; snapshot is not current";
		}
}
