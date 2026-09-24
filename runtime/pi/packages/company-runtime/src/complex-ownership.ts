import { createHash } from "node:crypto";
import { capabilityJson } from "./capability-catalog.ts";
import type { ComplexPlan, OwnershipOperation } from "./complex-types.ts";
import type {
	ComplexMutationOperation,
	ComplexOwnershipPort,
	ComplexWorkspaceImages,
	WorkspaceFileImage,
} from "./ports.ts";

/**
 * V0.7B exact-file task ownership and expected-image ledger (COMPLEX_SEQUENTIAL_WORKFLOW.md §5). Pure and owned by
 * the Kernel: claims are responsibility that narrows the Run writer, never filesystem access, Policy ALLOW,
 * Approval or completion authority. Nothing here is serialized as a reusable permission token.
 */
export type OwnershipDenialCode = "OWNERSHIP_CONFLICT" | "UNOWNED_PATH";

/** Typed pre-effect denial: no effect, no Approval request, no retry and no reassignment follow it. */
export class ComplexOwnershipDenied extends Error {
	readonly code: OwnershipDenialCode;

	constructor(code: OwnershipDenialCode, message: string) {
		super(message);
		this.name = "ComplexOwnershipDenied";
		this.code = code;
	}
}

/** The one mutable task attempt allowed to use its own claims. */
export interface ComplexLease {
	taskId: string;
	attempt: number;
}

type Image = WorkspaceFileImage | null;
/** undefined: the post-effect image could not be read, so the expected state is unknown until a new Run. */
type Expected = Image | undefined;

interface Claim {
	taskId: string;
	operation: OwnershipOperation;
}

function sameImage(left: Expected, right: Expected): boolean {
	if (left === undefined || right === undefined) return false;
	if (left === null || right === null) return left === right;
	return left.hash === right.hash && left.mode === right.mode;
}

function describe(path: string): string {
	return JSON.stringify(path);
}

/**
 * Canonical change digest (§10.1): sha256 over sorted `[path, beforeHash|null, beforeMode|null, afterHash|null,
 * afterMode|null]` tuples of the changed paths, `sha256:`-prefixed. Unknown images make the digest unknown (null).
 */
export function complexChangeDigest(
	paths: readonly string[],
	before: (path: string) => Expected,
	after: (path: string) => Expected,
): string | null {
	const tuples: Array<[string, string | null, number | null, string | null, number | null]> = [];
	for (const path of [...paths].sort()) {
		const from = before(path);
		const to = after(path);
		if (from === undefined || to === undefined) return null;
		tuples.push([path, from?.hash ?? null, from?.mode ?? null, to?.hash ?? null, to?.mode ?? null]);
	}
	return `sha256:${createHash("sha256").update(capabilityJson(tuples), "utf8").digest("hex")}`;
}

/**
 * Claims of one frozen plan with their admission images, the expected cumulative image of every claimed file and
 * the single active task lease. The Run-wide baseline is the one clean GitWorkspace baseline; task start/end images
 * are snapshots against it, never new baselines.
 */
export class ComplexOwnershipLedger {
	private readonly claims: ReadonlyMap<string, Claim>;
	private readonly baseline: ReadonlyMap<string, Image>;
	private readonly expected = new Map<string, Expected>();
	/** create claims whose file this task lineage already created: edit/replace only from then on. */
	private readonly created = new Set<string>();
	private readonly deleted = new Set<string>();
	private lease: ComplexLease | null = null;
	private reconciledDigest: string;

	private constructor(claims: Map<string, Claim>, baseline: Map<string, Image>, digest: string) {
		this.claims = claims;
		this.baseline = baseline;
		for (const [path, image] of baseline) this.expected.set(path, image);
		this.reconciledDigest = digest;
	}

	/** Claimed paths of a plan in ASCII order (the images the Kernel captures at every boundary). */
	static claimPaths(plan: ComplexPlan): string[] {
		return plan.tasks.flatMap((task) => task.ownership.map((claim) => claim.path)).sort();
	}

	/**
	 * Admission under the Run writer: a clean, safe capture whose claimed images fit the claim semantics
	 * (modify/delete: an existing file; create: a missing leaf). Returns the reason when the checkout cannot admit.
	 */
	static admit(plan: ComplexPlan, capture: ComplexWorkspaceImages): ComplexOwnershipLedger | string {
		if (!capture.safe) return "Admission capture is unsafe (HEAD/index/config or unsupported change)";
		if (capture.changedFiles.length)
			return "Admission requires the clean Run baseline; the workspace already changed";
		const claims = new Map<string, Claim>();
		const baseline = new Map<string, Image>();
		for (const task of plan.tasks)
			for (const claim of task.ownership) {
				if (!Object.hasOwn(capture.images, claim.path))
					return `Claimed file ${describe(claim.path)} was not captured`;
				const image = capture.images[claim.path];
				if ((claim.operation === "create") !== (image === null))
					return `${task.id} ${claim.operation} claim ${describe(claim.path)} no longer fits the live checkout`;
				claims.set(claim.path, { taskId: task.id, operation: claim.operation });
				baseline.set(claim.path, image === null ? null : { hash: image.hash, mode: image.mode });
			}
		return new ComplexOwnershipLedger(claims, baseline, capture.diffDigest);
	}

	get activeLease(): ComplexLease | null {
		return this.lease ? { ...this.lease } : null;
	}

	/** Digest of the last capture that reconciled with the expected cumulative state. */
	get expectedWorkspaceDigest(): string {
		return this.reconciledDigest;
	}

	/** ELIGIBLE → IMPLEMENTING or a REVISE attempt: at most one active lease, never another task's claims. */
	activate(lease: ComplexLease): void {
		if (this.lease && this.lease.taskId !== lease.taskId) throw new Error("Another task holds the active lease");
		this.lease = { taskId: lease.taskId, attempt: lease.attempt };
	}

	/** Safe task settlement or terminal cleanup; the claims stay reserved by the immutable plan. */
	release(): void {
		this.lease = null;
	}

	/** Exact ownership and operation semantics (§5.1). Throws a typed denial; returning is still not permission. */
	authorize(lease: ComplexLease, path: string, operation: ComplexMutationOperation): void {
		if (!this.lease || this.lease.taskId !== lease.taskId || this.lease.attempt !== lease.attempt)
			throw new Error("No active ownership lease for this task attempt; late or foreign callback rejected");
		const claim = this.claims.get(path);
		if (!claim)
			throw new ComplexOwnershipDenied(
				"UNOWNED_PATH",
				`UNOWNED_PATH: ${describe(path)} is not claimed by any task of this plan; nothing was changed`,
			);
		if (claim.taskId !== lease.taskId)
			throw new ComplexOwnershipDenied(
				"OWNERSHIP_CONFLICT",
				`OWNERSHIP_CONFLICT: ${describe(path)} is owned by ${claim.taskId}, not ${lease.taskId}; nothing was changed`,
			);
		const current = this.expected.get(path);
		const create = current === null && !this.created.has(path) && !this.deleted.has(path);
		const change = current !== null && (claim.operation === "modify" || this.created.has(path));
		const allowed =
			current !== undefined &&
			(claim.operation === "delete"
				? operation === "delete" && current !== null && !this.deleted.has(path)
				: operation === "write"
					? change || (claim.operation === "create" && create)
					: operation === "create"
						? claim.operation === "create" && create
						: (operation === "replace" || operation === "edit") && change);
		if (!allowed)
			throw new ComplexOwnershipDenied(
				"OWNERSHIP_CONFLICT",
				`OWNERSHIP_CONFLICT: ${operation} is not permitted by ${lease.taskId}'s ${claim.operation} claim of ${describe(path)} in its current state; nothing was changed`,
			);
	}

	/** Expected-image update after one authorized effect of the active attempt. */
	recordEffect(lease: ComplexLease, path: string, image: WorkspaceFileImage | null | undefined): void {
		if (!this.lease || this.lease.taskId !== lease.taskId || this.lease.attempt !== lease.attempt)
			throw new Error("No active ownership lease for this task attempt; late effect not recorded");
		const claim = this.claims.get(path);
		if (!claim || claim.taskId !== lease.taskId) throw new Error("Effect outside the active task's claims");
		const before = this.expected.get(path);
		this.expected.set(path, image === undefined ? undefined : image === null ? null : { ...image });
		if (claim.operation === "create" && before === null && image) this.created.add(path);
		if (image === null) this.deleted.add(path);
	}

	/**
	 * Compares a whole-workspace capture with the expected cumulative state: any unsafe capture, unclaimed changed
	 * path, or claimed file whose image differs from the ledger is an external mutation. On success the capture's
	 * digest becomes the expected workspace digest. Returns the reason on mismatch.
	 */
	reconcile(capture: ComplexWorkspaceImages): string | undefined {
		if (!capture.safe) return "Workspace capture is unsafe: HEAD/index/config or an unsupported change";
		const unclaimed = capture.changedFiles.filter((path) => !this.claims.has(path));
		if (unclaimed.length)
			return `Unclaimed files changed outside the ledger: ${unclaimed.slice(0, 8).map(describe).join(", ")}`;
		for (const path of this.claims.keys()) {
			if (!Object.hasOwn(capture.images, path)) return `Claimed file ${describe(path)} was not captured`;
			const expected = this.expected.get(path);
			if (expected === undefined) return `Expected image of ${describe(path)} is unknown after a failed effect read`;
			if (!sameImage(capture.images[path], expected))
				return `${describe(path)} differs from the expected ledger image (unattributed change)`;
		}
		this.reconciledDigest = capture.diffDigest;
		return undefined;
	}

	/** Expected images of every claimed path; a point-in-time copy for later deltas. */
	snapshot(): Map<string, Expected> {
		return new Map([...this.expected].map(([path, image]) => [path, image ? { ...image } : image]));
	}

	/** Claimed paths whose expected image differs from a snapshot, ASCII-sorted; unknown images count as changed. */
	changedSince(snapshot: ReadonlyMap<string, Expected>, owner?: string): string[] {
		return [...this.claims]
			.filter(([path, claim]) => (owner === undefined || claim.taskId === owner) && this.differs(snapshot, path))
			.map(([path]) => path)
			.sort();
	}

	/** Whether any expected image is unknown (a post-effect read failed). */
	get unknown(): boolean {
		return [...this.expected.values()].some((image) => image === undefined);
	}

	/** Change digest from a snapshot to the current expectation over exactly `paths`. */
	changeDigest(snapshot: ReadonlyMap<string, Expected>, paths: readonly string[]): string | null {
		return complexChangeDigest(
			paths,
			(path) => snapshot.get(path),
			(path) => this.expected.get(path),
		);
	}

	/** The admission images: the Run-wide baseline of every claimed file. */
	baselineSnapshot(): Map<string, Expected> {
		return new Map([...this.baseline].map(([path, image]) => [path, image ? { ...image } : image]));
	}

	private differs(snapshot: ReadonlyMap<string, Expected>, path: string): boolean {
		return !sameImage(snapshot.get(path), this.expected.get(path));
	}
}

/**
 * Per-invocation capability bound to (taskId, attempt). `close()` when the invocation settles: any later
 * authorize/recordEffect throws, so a late callback can never mutate or be attributed. The first typed denial is
 * reported to the Kernel through `onDenied`, independent of how the adapter wraps its error.
 */
export function complexOwnershipCapability(
	ledger: ComplexOwnershipLedger,
	lease: ComplexLease,
	onDenied: (denial: ComplexOwnershipDenied) => void,
): { port: ComplexOwnershipPort; close: () => void } {
	let open = true;
	const bound = { ...lease };
	return {
		port: {
			authorize: (path, operation) => {
				if (!open) throw new Error("Ownership capability closed; late tool callback rejected");
				try {
					ledger.authorize(bound, path, operation);
				} catch (error) {
					if (error instanceof ComplexOwnershipDenied) onDenied(error);
					throw error;
				}
			},
			recordEffect: (path, image) => {
				if (!open) throw new Error("Ownership capability closed; late effect rejected");
				ledger.recordEffect(bound, path, image);
			},
		},
		close: () => {
			open = false;
		},
	};
}
