import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Check } from "typebox/value";
import { JEV_READER_DIGEST, JEV_READER_REVISION, JEV_SNAPSHOT_SOURCE } from "./browser-snapshot.ts";
import {
	BrowserCaptureSchema,
	type BrowserObservationCandidate,
	type BrowserTarget,
	BrowserTargetSchema,
	browserDigest,
	browserProjectId,
	candidateDigestOf,
	canonicalBrowserDocument,
	validateBrowserCandidate,
} from "./browser-types.ts";
import { ProcessCleanupError, resolveExecutable, runProcess, verificationEnvironment } from "./process-runner.ts";
import {
	executableIdentityDigest,
	snapshotBrowserImplementation,
	snapshotVerifierExecutable,
} from "./verifier-trust.ts";

export interface BrowserObservationRequest {
	url: string;
	executable: string;
	/** Explicit Host acknowledgement, not a Kernel approval or a network-sandbox claim. */
	localTestApp: true;
	projectRoot?: string;
	target?: BrowserTarget;
	signal?: AbortSignal;
}

export class BrowserObservationError extends Error {
	constructor() {
		super("Browser observation unavailable or denied; no check registration, PASS, or COMPLETE was produced.");
		this.name = "BrowserObservationError";
	}
}

function localDocumentUrl(request: BrowserObservationRequest): string {
	if (
		request.localTestApp !== true ||
		!isAbsolute(request.executable) ||
		(request.target !== undefined && !Check(BrowserTargetSchema, request.target))
	)
		throw new BrowserObservationError();
	try {
		return canonicalBrowserDocument(request.url);
	} catch {
		throw new BrowserObservationError();
	}
}

export function parseBrowserObservationArguments(
	args: readonly string[],
): BrowserObservationRequest & { saveCandidate: boolean } {
	if (args[0] !== "observe") throw new BrowserObservationError();
	let url: string | undefined;
	let executable: string | undefined;
	let selector: string | undefined;
	let attribute: string | undefined;
	let localTestApp = false;
	let json = false;
	let saveCandidate = false;
	for (let index = 1; index < args.length; index++) {
		const argument = args[index];
		if (argument === "--local-test-app" && !localTestApp) localTestApp = true;
		else if (argument === "--json" && !json) json = true;
		else if (argument === "--save-candidate" && !saveCandidate) saveCandidate = true;
		else if (argument === "--url" && url === undefined && args[index + 1]) url = args[++index];
		else if (argument === "--executable" && executable === undefined && args[index + 1]) executable = args[++index];
		else if (argument === "--selector" && selector === undefined && args[index + 1]) selector = args[++index];
		else if (argument === "--attribute" && attribute === undefined && args[index + 1]) attribute = args[++index];
		else throw new BrowserObservationError();
	}
	if (
		!url ||
		!executable ||
		!localTestApp ||
		!json ||
		(attribute !== undefined && !selector) ||
		(saveCandidate && !selector)
	)
		throw new BrowserObservationError();
	const target = selector ? { selector, ...(attribute !== undefined ? { attribute } : {}) } : undefined;
	if (target && !Check(BrowserTargetSchema, target)) throw new BrowserObservationError();
	const request = {
		url,
		executable,
		localTestApp: true as const,
		...(target ? { target: target as BrowserTarget } : {}),
		saveCandidate,
	};
	request.url = localDocumentUrl(request);
	return request;
}

/**
 * Host-only capture. Each call owns a new browser; it accepts no candidate or prior session.
 * Its result is advisory data, never a CheckResult. Only RegisteredVerifier evaluates assertions.
 */
export async function observeLocalBrowser(request: BrowserObservationRequest): Promise<BrowserObservationCandidate> {
	const url = localDocumentUrl(request);
	request.signal?.throwIfAborted();
	if (process.platform === "win32") throw new BrowserObservationError();
	if (createHash("sha256").update(JEV_SNAPSHOT_SOURCE).digest("hex") !== JEV_READER_DIGEST)
		throw new BrowserObservationError();
	const root = await realpath(request.projectRoot ?? process.cwd());
	const implementation = snapshotBrowserImplementation().sources;
	const executable = await resolveExecutable(request.executable, "");
	const executableSnapshot = snapshotVerifierExecutable(executable);
	const directory = await mkdtemp(join(tmpdir(), "weavra-browser-"));
	let cleanupConfirmed = true;
	let candidate: BrowserObservationCandidate | undefined;
	let failure: unknown;
	try {
		const home = join(directory, "home");
		await mkdir(home, { mode: 0o700 });
		request.signal?.throwIfAborted();
		cleanupConfirmed = false;
		const result = await runProcess({
			executable: process.execPath,
			argv: [
				fileURLToPath(new URL("./browser-driver.ts", import.meta.url)),
				executable,
				url,
				JSON.stringify(request.target ?? null),
			],
			cwd: directory,
			env: { ...verificationEnvironment(), HOME: home, TMPDIR: directory },
			timeoutMs: 15000,
			maxOutputBytes: 524288,
			signal: request.signal,
		});
		cleanupConfirmed = result.cleanupConfirmed;
		if (!cleanupConfirmed) throw new ProcessCleanupError();
		if (result.reason !== "exited" || result.exitCode !== 0 || request.signal?.aborted)
			throw new BrowserObservationError();
		let capture: unknown;
		try {
			capture = JSON.parse(result.stdout);
		} catch {
			throw new BrowserObservationError();
		}
		if (
			!Check(BrowserCaptureSchema, capture) ||
			capture.first.url !== url ||
			capture.startedAt < result.startedAt ||
			capture.finishedAt > result.finishedAt ||
			capture.finishedAt < capture.startedAt ||
			browserDigest(capture.first) !== browserDigest(capture.second) ||
			browserDigest(capture.first.target?.target ?? null) !== browserDigest(request.target ?? null) ||
			browserDigest(implementation) !== browserDigest(snapshotBrowserImplementation().sources) ||
			executableIdentityDigest(executableSnapshot) !==
				executableIdentityDigest(snapshotVerifierExecutable(executable))
		)
			throw new BrowserObservationError();
		const fields: Omit<BrowserObservationCandidate, "candidateDigest"> = {
			schemaVersion: 2,
			kind: "BROWSER_OBSERVATION_CANDIDATE",
			candidateId: randomUUID(),
			projectId: browserProjectId(root),
			authority: "CANDIDATE_ONLY",
			scope: "LOCAL_STATIC_DOCUMENT",
			origin: new URL(url).origin,
			documentIdentity: url,
			capturedAt: capture.finishedAt,
			pageRevision: capture.documentDigest,
			observationType: request.target ? "target" : "document",
			source: {
				implementationRevision: browserDigest(implementation),
				readerRevision: JEV_READER_REVISION,
				readerDigest: `sha256:${JEV_READER_DIGEST}`,
				executableIdentityDigest: executableIdentityDigest(executableSnapshot),
				browserVersion: capture.browserVersion,
			},
			freshness: { mode: "CAPTURE_ONLY", startedAt: capture.startedAt, finishedAt: capture.finishedAt },
			observationDigest: browserDigest(capture.first),
			observation: capture.first,
			cleanup: "CONFIRMED",
		};
		candidate = validateBrowserCandidate({ ...fields, candidateDigest: candidateDigestOf(fields) });
	} catch (error) {
		failure = !cleanupConfirmed || error instanceof ProcessCleanupError ? new ProcessCleanupError() : error;
	}
	if (cleanupConfirmed) {
		try {
			await rm(directory, { recursive: true, force: true });
		} catch {
			throw new ProcessCleanupError();
		}
		request.signal?.throwIfAborted();
	}
	if (candidate) return candidate;
	throw failure;
}
