import type { Run } from "./contracts.ts";

/** Display only. `live` means this Host still owns the awaited workflow, never a stored status/lock guess. */
export function formatWeavraStatus(run: Run | undefined, live: boolean, error?: string): string | undefined {
	if (!run) return undefined;
	// Cleanup/report failures can supersede an otherwise successful durable terminal snapshot.
	if (error && error !== run.lastError) return "Weavra · ATTENTION · /state";
	if (!["CREATED", "RUNNING", "WAITING_APPROVAL"].includes(run.status)) return `Weavra · ${run.status}`;
	if (!live) return "Weavra · UNCONFIRMED · /state";
	return [
		"Weavra",
		run.workflow,
		run.risk,
		run.status === "WAITING_APPROVAL" ? "APPROVAL" : run.phase,
		...run.activeAgents,
	].join(" · ");
}
