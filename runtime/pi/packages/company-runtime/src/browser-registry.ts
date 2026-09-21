import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, unlink } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { parseDocument } from "yaml";
import {
	type BrowserObservationCandidate,
	BrowserObservationCandidateSchema,
	type BrowserRegistrationRequest,
	BrowserRegistrationRequestSchema,
	browserDigest,
	browserProjectId,
	browserRegistrationDigestOf,
	type RegisteredBrowserCheck,
	validateBrowserCandidate,
	validateRegisteredBrowserCheck,
} from "./browser-types.ts";
import { parseRuntimeConfig } from "./config.ts";
import { FileStateStore } from "./state-store.ts";
import { executableIdentityDigest, snapshotVerifierExecutable } from "./verifier-trust.ts";

const MAX_CANDIDATES = 64;
const MAX_CANDIDATE_BYTES = 262144;
const recordSchema = Type.Object(
	{
		schemaVersion: Type.Literal(1),
		executable: Type.String({ minLength: 1, maxLength: 4096 }),
		candidate: BrowserObservationCandidateSchema,
	},
	{ additionalProperties: false },
);
export type BrowserCandidateSummary = Pick<
	BrowserObservationCandidate,
	| "schemaVersion"
	| "kind"
	| "candidateId"
	| "projectId"
	| "authority"
	| "scope"
	| "origin"
	| "documentIdentity"
	| "capturedAt"
	| "pageRevision"
	| "source"
	| "candidateDigest"
	| "cleanup"
	| "freshness"
	| "observationDigest"
> & {
	observationType: "target";
	observation: NonNullable<BrowserObservationCandidate["observation"]["target"]>;
};
export interface PreparedBrowserRegistration {
	candidate: BrowserCandidateSummary;
	check: RegisteredBrowserCheck;
	request: BrowserRegistrationRequest;
	/** Host-private fields: never copied into the control response. */
	executable: string;
	configurationDigest: string;
	projectRevision: number;
	rootIdentity: string;
}
export class BrowserRegistrationError extends Error {
	readonly code:
		| "BROWSER_UNAVAILABLE"
		| "CANDIDATE_CHANGED"
		| "INVALID_BROWSER_CHECK"
		| "CHECK_EXISTS"
		| "CONFIG_CHANGED"
		| "ACTIVE_RUN";
	constructor(code: BrowserRegistrationError["code"]) {
		super(code);
		this.code = code;
	}
}

function summary(candidate: BrowserObservationCandidate): BrowserCandidateSummary {
	if (!candidate.observation.target) throw new BrowserRegistrationError("INVALID_BROWSER_CHECK");
	const {
		schemaVersion,
		kind,
		candidateId,
		projectId,
		authority,
		scope,
		origin,
		documentIdentity,
		capturedAt,
		pageRevision,
		source,
		candidateDigest,
		cleanup,
		freshness,
		observationDigest,
	} = candidate;
	return {
		schemaVersion,
		kind,
		candidateId,
		projectId,
		authority,
		scope,
		origin,
		documentIdentity,
		capturedAt,
		pageRevision,
		source: structuredClone(source),
		candidateDigest,
		cleanup,
		freshness: structuredClone(freshness),
		observationDigest,
		observationType: "target",
		observation: structuredClone(candidate.observation.target),
	};
}
async function rootIdentity(root: string): Promise<string> {
	const stat = await lstat(root);
	if (!stat.isDirectory() || stat.isSymbolicLink() || (await realpath(root)) !== root)
		throw new BrowserRegistrationError("BROWSER_UNAVAILABLE");
	return browserDigest({ root, dev: stat.dev, ino: stat.ino });
}
async function directory(root: string, create: boolean): Promise<{ path: string; identity: string }> {
	const parent = join(root, ".ai");
	const parentStat = await lstat(parent);
	if (!parentStat.isDirectory() || parentStat.isSymbolicLink())
		throw new BrowserRegistrationError("BROWSER_UNAVAILABLE");
	const path = join(parent, "browser-candidates");
	if (create)
		await mkdir(path, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
			if (error.code !== "EEXIST") throw error;
		});
	const stat = await lstat(path);
	if (
		!stat.isDirectory() ||
		stat.isSymbolicLink() ||
		(stat.mode & 0o077) !== 0 ||
		(process.getuid && stat.uid !== process.getuid())
	)
		throw new BrowserRegistrationError("BROWSER_UNAVAILABLE");
	return {
		path,
		identity: browserDigest({ parentDev: parentStat.dev, parentIno: parentStat.ino, dev: stat.dev, ino: stat.ino }),
	};
}
async function boundedRead(path: string, maximum: number, privateFile: boolean): Promise<string> {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	try {
		const before = await handle.stat({ bigint: true });
		if (
			!before.isFile() ||
			before.nlink !== 1n ||
			before.size > BigInt(maximum) ||
			(privateFile && ((before.mode & 0o077n) !== 0n || (process.getuid && before.uid !== BigInt(process.getuid()))))
		)
			throw new BrowserRegistrationError("BROWSER_UNAVAILABLE");
		const bytes = Buffer.alloc(Number(before.size) + 1);
		let length = 0;
		while (length < bytes.length) {
			const result = await handle.read(bytes, length, bytes.length - length, length);
			if (!result.bytesRead) break;
			length += result.bytesRead;
		}
		const after = await handle.stat({ bigint: true });
		const current = await lstat(path, { bigint: true });
		if (
			length !== Number(before.size) ||
			before.dev !== after.dev ||
			before.ino !== after.ino ||
			before.size !== after.size ||
			before.mode !== after.mode ||
			before.mtimeNs !== after.mtimeNs ||
			before.ctimeNs !== after.ctimeNs ||
			current.isSymbolicLink() ||
			current.dev !== after.dev ||
			current.ino !== after.ino
		)
			throw new BrowserRegistrationError("BROWSER_UNAVAILABLE");
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length));
	} finally {
		await handle.close();
	}
}
async function candidateRecord(root: string, id: string) {
	if (!Check(BrowserObservationCandidateSchema.properties.candidateId, id))
		throw new BrowserRegistrationError("INVALID_BROWSER_CHECK");
	const before = await directory(root, false);
	const record: unknown = JSON.parse(await boundedRead(join(before.path, `${id}.json`), MAX_CANDIDATE_BYTES, true));
	if (!Check(recordSchema, record)) throw new BrowserRegistrationError("CANDIDATE_CHANGED");
	const candidate = validateBrowserCandidate(record.candidate);
	if (
		candidate.candidateId !== id ||
		candidate.projectId !== browserProjectId(root) ||
		!isAbsolute(record.executable) ||
		(await directory(root, false)).identity !== before.identity
	)
		throw new BrowserRegistrationError("CANDIDATE_CHANGED");
	return record;
}
async function configSource(root: string): Promise<string> {
	const parent = await lstat(join(root, ".ai"));
	if (!parent.isDirectory() || parent.isSymbolicLink()) throw new BrowserRegistrationError("BROWSER_UNAVAILABLE");
	const source = await boundedRead(join(root, ".ai", "config.yaml"), 65536, false);
	const current = await lstat(join(root, ".ai"));
	if (current.dev !== parent.dev || current.ino !== parent.ino || current.isSymbolicLink())
		throw new BrowserRegistrationError("BROWSER_UNAVAILABLE");
	parseRuntimeConfig(source);
	return source;
}
function registeredDefinition(
	candidate: BrowserObservationCandidate,
	request: BrowserRegistrationRequest,
): RegisteredBrowserCheck {
	if (!Check(BrowserRegistrationRequestSchema, request)) throw new BrowserRegistrationError("INVALID_BROWSER_CHECK");
	if (request.expectedCandidateDigest !== candidate.candidateDigest || request.candidateId !== candidate.candidateId)
		throw new BrowserRegistrationError("CANDIDATE_CHANGED");
	if (
		request.origin !== candidate.origin ||
		request.documentIdentity !== candidate.documentIdentity ||
		!candidate.observation.target ||
		browserDigest(request.target) !== browserDigest(candidate.observation.target.target)
	)
		throw new BrowserRegistrationError("INVALID_BROWSER_CHECK");
	const fields: Omit<RegisteredBrowserCheck, "registrationDigest"> = {
		version: 1,
		checkId: request.checkId,
		projectId: candidate.projectId,
		origin: request.origin,
		documentIdentity: request.documentIdentity,
		target: structuredClone(request.target),
		assertion: structuredClone(request.assertion),
		freshness: structuredClone(request.freshness),
	};
	try {
		return validateRegisteredBrowserCheck({ ...fields, registrationDigest: browserRegistrationDigestOf(fields) });
	} catch {
		throw new BrowserRegistrationError("INVALID_BROWSER_CHECK");
	}
}

/** Explicit Host persistence only; no browser is running while the cooperative writer lease is held. */
export async function saveBrowserCandidate(
	cwd: string,
	candidate: BrowserObservationCandidate,
	executable: string,
): Promise<void> {
	const root = await realpath(cwd);
	validateBrowserCandidate(candidate);
	if (!candidate.observation.target || candidate.projectId !== browserProjectId(root) || !isAbsolute(executable))
		throw new BrowserRegistrationError("INVALID_BROWSER_CHECK");
	const resolved = await realpath(executable);
	if (executableIdentityDigest(snapshotVerifierExecutable(resolved)) !== candidate.source.executableIdentityDigest)
		throw new BrowserRegistrationError("CANDIDATE_CHANGED");
	const source = `${JSON.stringify({ schemaVersion: 1, executable: resolved, candidate })}\n`;
	if (Buffer.byteLength(source) > MAX_CANDIDATE_BYTES) throw new BrowserRegistrationError("BROWSER_UNAVAILABLE");
	const store = await FileStateStore.open(root, { recoverInterrupted: false });
	try {
		await store.assertWritable();
		const before = await directory(root, true);
		if ((await readdir(before.path)).length >= MAX_CANDIDATES)
			throw new BrowserRegistrationError("BROWSER_UNAVAILABLE");
		const handle = await open(
			join(before.path, `${candidate.candidateId}.json`),
			constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
			0o600,
		);
		try {
			await handle.writeFile(source);
			await handle.sync();
		} finally {
			await handle.close();
		}
		await store.assertWritable();
		if ((await directory(root, false)).identity !== before.identity)
			throw new BrowserRegistrationError("BROWSER_UNAVAILABLE");
	} finally {
		await store.close();
	}
}
export async function listBrowserCandidates(
	cwd: string,
): Promise<{ candidates: BrowserCandidateSummary[]; omitted: number }> {
	const root = await realpath(cwd);
	let before: Awaited<ReturnType<typeof directory>>;
	try {
		before = await directory(root, false);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { candidates: [], omitted: 0 };
		throw error;
	}
	const names = await readdir(before.path);
	if (names.length > MAX_CANDIDATES) throw new BrowserRegistrationError("BROWSER_UNAVAILABLE");
	const candidates: BrowserObservationCandidate[] = [];
	for (const name of names) {
		if (!name.endsWith(".json")) throw new BrowserRegistrationError("BROWSER_UNAVAILABLE");
		candidates.push((await candidateRecord(root, name.slice(0, -5))).candidate);
	}
	if ((await directory(root, false)).identity !== before.identity)
		throw new BrowserRegistrationError("BROWSER_UNAVAILABLE");
	candidates.sort((a, b) => b.capturedAt - a.capturedAt || a.candidateId.localeCompare(b.candidateId));
	return { candidates: candidates.slice(0, 2).map(summary), omitted: Math.max(0, candidates.length - 2) };
}
export async function prepareBrowserRegistration(
	cwd: string,
	request: BrowserRegistrationRequest,
): Promise<PreparedBrowserRegistration> {
	if (!Check(BrowserRegistrationRequestSchema, request)) throw new BrowserRegistrationError("INVALID_BROWSER_CHECK");
	const root = await realpath(cwd);
	const identity = await rootIdentity(root);
	const state = await FileStateStore.readSnapshot(root);
	if (
		state.writerPresent ||
		state.state?.runs.some((run) => ["CREATED", "RUNNING", "WAITING_APPROVAL"].includes(run.status))
	)
		throw new BrowserRegistrationError("ACTIVE_RUN");
	const record = await candidateRecord(root, request.candidateId);
	const check = registeredDefinition(record.candidate, request);
	if (
		executableIdentityDigest(snapshotVerifierExecutable(record.executable)) !==
		record.candidate.source.executableIdentityDigest
	)
		throw new BrowserRegistrationError("CANDIDATE_CHANGED");
	const source = await configSource(root);
	if (parseRuntimeConfig(source).verification.checks.some((item) => item.id === check.checkId))
		throw new BrowserRegistrationError("CHECK_EXISTS");
	if ((await rootIdentity(root)) !== identity) throw new BrowserRegistrationError("BROWSER_UNAVAILABLE");
	return {
		candidate: summary(record.candidate),
		check,
		request: structuredClone(request),
		executable: record.executable,
		configurationDigest: browserDigest(source),
		projectRevision: state.state?.revision ?? 0,
		rootIdentity: identity,
	};
}
/** Called only after the Host owner consumes its reviewed, expiring confirmation preview. */
export async function commitBrowserRegistration(
	cwd: string,
	prepared: PreparedBrowserRegistration,
	assertCurrent: () => void,
): Promise<RegisteredBrowserCheck> {
	assertCurrent();
	const root = await realpath(cwd);
	if ((await rootIdentity(root)) !== prepared.rootIdentity) throw new BrowserRegistrationError("BROWSER_UNAVAILABLE");
	const store = await FileStateStore.open(root, { recoverInterrupted: false });
	let temporary: string | undefined;
	try {
		await store.assertWritable();
		if (store.snapshot.revision !== prepared.projectRevision) throw new BrowserRegistrationError("CONFIG_CHANGED");
		const record = await candidateRecord(root, prepared.request.candidateId);
		const check = registeredDefinition(record.candidate, prepared.request);
		if (
			browserDigest(check) !== browserDigest(prepared.check) ||
			record.executable !== prepared.executable ||
			executableIdentityDigest(snapshotVerifierExecutable(record.executable)) !==
				record.candidate.source.executableIdentityDigest
		)
			throw new BrowserRegistrationError("CANDIDATE_CHANGED");
		const source = await configSource(root);
		if (browserDigest(source) !== prepared.configurationDigest) throw new BrowserRegistrationError("CONFIG_CHANGED");
		if (parseRuntimeConfig(source).verification.checks.some((item) => item.id === check.checkId))
			throw new BrowserRegistrationError("CHECK_EXISTS");
		const document = parseDocument(source);
		const original: unknown = document.toJS({ maxAliasCount: 0 });
		if (!original || typeof original !== "object" || Array.isArray(original))
			throw new BrowserRegistrationError("CONFIG_CHANGED");
		const parsed = original as { verification?: { checks?: unknown[] } };
		document.setIn(
			["verification", "checks"],
			[
				...(parsed.verification?.checks ?? []),
				{
					id: check.checkId,
					kind: "browser",
					executable: record.executable,
					required: true,
					browser: check,
				},
			],
		);
		const next = document.toString();
		parseRuntimeConfig(next);
		temporary = join(root, ".ai", `.browser-config.${randomUUID()}.tmp`);
		const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
		try {
			await handle.writeFile(next);
			await handle.sync();
		} finally {
			await handle.close();
		}
		await store.assertWritable();
		if (
			(await rootIdentity(root)) !== prepared.rootIdentity ||
			browserDigest(await configSource(root)) !== prepared.configurationDigest
		)
			throw new BrowserRegistrationError("CONFIG_CHANGED");
		assertCurrent();
		await rename(temporary, join(root, ".ai", "config.yaml"));
		temporary = undefined;
		await store.assertWritable();
		return check;
	} finally {
		if (temporary)
			await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
				if (error.code !== "ENOENT") throw error;
			});
		await store.close();
	}
}
