import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileDigest } from "./anchored-edit.ts";
import type { ImpactRelation, ImpactReviewPack, ImpactSymbol } from "./impact-review-types.ts";
import { listFiles } from "./list-files.ts";
import type { LspLocation, LspPort, LspSymbol } from "./lsp/types.ts";
import {
	evaluatePolicy,
	isListablePath,
	isProtectedPath,
	type PolicyContext,
	type PolicyPathInspector,
} from "./policy.ts";
import { ProcessCleanupError } from "./process-runner.ts";
import { isContextEligible, readStableText } from "./task-context.ts";
import {
	CONTEXT_MAX_PACK_BYTES,
	CONTEXT_MAX_REFERENCE_QUERIES,
	CONTEXT_MAX_SYMBOL_DOCUMENTS,
	type TaskContextPack,
} from "./task-context-types.ts";
import type { DiffEvidence } from "./workspace.ts";

const digest = (value: unknown) => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const lexical = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const locationOrder = (a: LspLocation, b: LspLocation) =>
	lexical(a.path, b.path) ||
	a.line - b.line ||
	a.column - b.column ||
	a.endLine - b.endLine ||
	a.endColumn - b.endColumn;

/** Bounded line LCS with UTF-16 edit extents. Deletions are boundaries, not surviving sibling lines. */
export function changedCurrentRanges(
	before: string,
	after: string,
): Array<Omit<LspLocation, "path"> & { deletion: boolean }> | undefined {
	if (before === after) return [];
	const old = before.split(/\r\n|\n|\r/),
		current = after.split(/\r\n|\n|\r/);
	let start = 0,
		oldEnd = old.length,
		end = current.length;
	while (start < oldEnd && start < end && old[start] === current[start]) start++;
	while (oldEnd > start && end > start && old[oldEnd - 1] === current[end - 1]) {
		oldEnd--;
		end--;
	}
	const n = oldEnd - start,
		m = end - start;
	if ((n + 1) * (m + 1) > 2_000_000 || old.length + current.length > 40_000) return undefined;
	const width = m + 1,
		table = new Uint32Array((n + 1) * width);
	for (let i = n - 1; i >= 0; i--)
		for (let j = m - 1; j >= 0; j--)
			table[i * width + j] =
				old[start + i] === current[start + j]
					? 1 + table[(i + 1) * width + j + 1]
					: Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
	const ranges: Array<Omit<LspLocation, "path"> & { deletion: boolean }> = [];
	let i = 0,
		j = 0;
	while (i < n || j < m) {
		if (i < n && j < m && old[start + i] === current[start + j]) {
			i++;
			j++;
			continue;
		}
		const oldStart = i,
			newStart = j;
		do {
			if (j < m && (i === n || table[i * width + j + 1] >= table[(i + 1) * width + j])) j++;
			else i++;
		} while ((i < n || j < m) && !(i < n && j < m && old[start + i] === current[start + j]));
		const removed = old.slice(start + oldStart, start + i).join("\n");
		const added = current.slice(start + newStart, start + j).join("\n");
		let prefix = 0,
			oldTail = removed.length,
			tail = added.length;
		while (prefix < oldTail && prefix < tail && removed[prefix] === added[prefix]) prefix++;
		while (oldTail > prefix && tail > prefix && removed[oldTail - 1] === added[tail - 1]) {
			oldTail--;
			tail--;
		}
		let line = start + newStart + 1,
			column = 1,
			endLine = line,
			endColumn = column;
		for (let offset = 0; offset < prefix; offset++) {
			if (added[offset] === "\n") {
				line++;
				column = 1;
			} else column++;
		}
		endLine = line;
		endColumn = column;
		for (let offset = prefix; offset < tail; offset++) {
			if (added[offset] === "\n") {
				endLine++;
				endColumn = 1;
			} else endColumn++;
		}
		ranges.push({ line, column, endLine, endColumn, deletion: prefix === tail });
	}
	return ranges;
}

export interface ImpactReviewInput {
	cwd: string;
	policy: PolicyContext;
	paths: PolicyPathInspector;
	protectedPaths: readonly string[];
	verifierSources: readonly string[];
	runId: string;
	revision: number;
	taskContractDigest: string;
	diff: DiffEvidence;
	scopePaths: readonly string[];
	taskContext?: TaskContextPack;
	lsp?: LspPort;
	generatedAt: number;
	maxBytes?: number;
	signal?: AbortSignal;
}

/** Fresh, bounded, policy-filtered advisory context. No permissions, mutation receipts or check results. */
export async function buildImpactReviewPack(input: ImpactReviewInput): Promise<ImpactReviewPack> {
	const maxBytes = input.maxBytes ?? CONTEXT_MAX_PACK_BYTES;
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > CONTEXT_MAX_PACK_BYTES)
		throw new Error("Invalid impact context budget");
	const cwd = realpathSync(input.cwd),
		unknowns = new Set<string>();
	let truncated = false;
	const assertActive = () => {
		input.signal?.throwIfAborted();
		if (input.lsp?.cleanupFailed) throw new ProcessCleanupError();
	};
	const read = async (path: string) => {
		assertActive();
		if (!isContextEligible(cwd, path, input.protectedPaths, input.verifierSources, input.policy)) return undefined;
		const decision = evaluatePolicy(
			{
				runId: input.runId,
				actionId: "impact-read",
				actionDigest: "impact-read",
				role: "Reviewer",
				tool: "runtime_read",
				risk: "R0",
				paths: [path],
			},
			input.policy,
			await input.paths.inspect([path]),
		);
		if (
			decision.decision !== "ALLOW" ||
			!isContextEligible(cwd, path, input.protectedPaths, input.verifierSources, input.policy)
		)
			return undefined;
		const value = readStableText(join(cwd, path));
		return isContextEligible(cwd, path, input.protectedPaths, input.verifierSources, input.policy)
			? value
			: undefined;
	};
	const roots = [...new Set(input.policy.allowedPaths)]
		.filter(
			(path) =>
				isListablePath(path, input.policy) &&
				!isProtectedPath(path, input.protectedPaths) &&
				!isProtectedPath(path, input.verifierSources),
		)
		.sort(lexical)
		.slice(0, 32);
	const discovered = roots.length
		? await listFiles(cwd, roots, 4, input.policy, input.paths, input.signal ?? new AbortController().signal)
		: { files: [], truncated: false };
	if (input.policy.allowedPaths.length > 32) truncated = true;
	if (discovered.truncated) truncated = true;
	const priority = (a: string, b: string) =>
		Number(input.scopePaths.some((p) => b === p || b.startsWith(`${p}/`))) -
			Number(input.scopePaths.some((p) => a === p || a.startsWith(`${p}/`))) || lexical(a, b);
	const initialDigests = new Map<string, string>();
	for (const path of [...discovered.files].sort(priority).slice(0, 64)) {
		const source = await read(path);
		if (source) initialDigests.set(path, source.digest);
	}
	if (discovered.files.length > 64) truncated = true;
	let changes: unknown;
	try {
		changes = JSON.parse(input.diff.diff);
	} catch {
		changes = undefined;
	}
	if (!Array.isArray(changes) || changes.length > 256 || !input.diff.safe) {
		changes = [];
		unknowns.add("diff unavailable or unsafe");
	}
	const byPath = new Map<string, { before: string | null; after: string | null }>();
	for (const raw of changes as unknown[]) {
		if (
			!raw ||
			typeof raw !== "object" ||
			!("path" in raw) ||
			typeof raw.path !== "string" ||
			!("before" in raw) ||
			!("after" in raw) ||
			(raw.before !== null && typeof raw.before !== "string") ||
			(raw.after !== null && typeof raw.after !== "string")
		) {
			unknowns.add("invalid diff entry");
			continue;
		}
		if (input.diff.changedFiles.includes(raw.path)) byPath.set(raw.path, { before: raw.before, after: raw.after });
	}
	const changedFiles: string[] = [],
		changedSymbols: ImpactSymbol[] = [],
		callers: ImpactRelation[] = [],
		declarations: ImpactRelation[] = [];
	const symbolIds = new Set<string>();
	const relationKeys = { references: new Set<string>(), definition: new Set<string>() };
	let documents = 0;
	for (const path of [...byPath.keys()].sort(lexical)) {
		const change = byPath.get(path)!;
		if (change.after === null) {
			// The safe Host diff supplies deletion metadata; never read historical bytes
			// or attribute the removed extent to a surviving current symbol.
			if (
				isListablePath(path, input.policy) &&
				!isProtectedPath(path, input.protectedPaths) &&
				!isProtectedPath(path, input.verifierSources)
			) {
				const [inspection] = await input.paths.inspect([path]);
				if (inspection?.safe && inspection.kind === "missing" && changedFiles.length < 32) changedFiles.push(path);
				else if (changedFiles.length >= 32) truncated = true;
			}
			unknowns.add("deleted source has no current symbol extent");
			continue;
		}
		const current = await read(path);
		if (!current) {
			unknowns.add("changed file unavailable or excluded");
			continue;
		}
		if (!initialDigests.has(path)) initialDigests.set(path, current.digest);
		changedFiles.push(path);
		if (changedFiles.length > 32) {
			changedFiles.pop();
			truncated = true;
			break;
		}
		if (documents >= CONTEXT_MAX_SYMBOL_DOCUMENTS) {
			truncated = true;
			unknowns.add("symbol document budget reached");
			continue;
		}
		if (change.after === null || fileDigest(change.after) !== current.digest) {
			unknowns.add("changed source is stale");
			continue;
		}
		const lines = changedCurrentRanges(change.before ?? "", current.text);
		if (!lines) {
			truncated = true;
			unknowns.add("changed line computation budget reached");
			continue;
		}
		if (!lines.length) {
			unknowns.add("byte-only change without a current text extent");
			continue;
		}
		if (!input.lsp) {
			unknowns.add("LSP unavailable");
			continue;
		}
		documents++;
		try {
			const result = await input.lsp.symbols({ path, signal: input.signal });
			assertActive();
			const fresh = await read(path);
			if (
				!fresh ||
				fresh.digest !== current.digest ||
				result.fileDigest !== current.digest ||
				!["AVAILABLE", "PARTIAL"].includes(result.status)
			) {
				unknowns.add("LSP symbols unavailable or stale");
				continue;
			}
			if (result.status === "PARTIAL" || result.withheld || result.truncated) {
				truncated = true;
				unknowns.add("LSP symbols incomplete");
			}
			if (result.symbols.length > 128) {
				unknowns.add("LSP symbols exceed bounded result contract");
				truncated = true;
				continue;
			}
			const sourceLines = current.text.split(/\r\n|\n|\r/);
			const candidates = result.symbols.filter((symbol) => {
				const r = symbol.range;
				if (
					symbol.path !== path ||
					!r ||
					symbol.name.length > 256 ||
					!Number.isInteger(symbol.kind) ||
					symbol.kind < 1 ||
					symbol.kind > 26
				)
					return false;
				return (
					[
						r.line,
						r.column,
						r.endLine,
						r.endColumn,
						symbol.line,
						symbol.column,
						symbol.endLine,
						symbol.endColumn,
					].every((v) => Number.isSafeInteger(v) && v > 0) &&
					r.endLine >= r.line &&
					(r.endLine !== r.line || r.endColumn >= r.column) &&
					r.endLine <= sourceLines.length &&
					r.column <= (sourceLines[r.line - 1]?.length ?? -1) + 1 &&
					r.endColumn <= (sourceLines[r.endLine - 1]?.length ?? -1) + 1 &&
					symbol.line >= r.line &&
					symbol.endLine >= symbol.line &&
					symbol.endLine <= r.endLine &&
					(symbol.endLine !== symbol.line || symbol.endColumn >= symbol.column) &&
					(symbol.line !== r.line || symbol.column >= r.column) &&
					(symbol.endLine !== r.endLine || symbol.endColumn <= r.endColumn) &&
					symbol.column <= (sourceLines[symbol.line - 1]?.length ?? -1) + 1 &&
					symbol.endColumn <= (sourceLines[symbol.endLine - 1]?.length ?? -1) + 1
				);
			});
			if (candidates.length !== result.symbols.length) unknowns.add("symbol extent unavailable or invalid");
			const selected = new Set<LspSymbol>();
			const before = (line: number, column: number, endLine: number, endColumn: number) =>
				line < endLine || (line === endLine && column < endColumn);
			for (const edit of lines) {
				const overlapping = candidates.filter((symbol) => {
					const r = symbol.range!;
					return edit.deletion
						? before(r.line, r.column, edit.line, edit.column) &&
								before(edit.line, edit.column, r.endLine, r.endColumn)
						: before(r.line, r.column, edit.endLine, edit.endColumn) &&
								before(edit.line, edit.column, r.endLine, r.endColumn);
				});
				// Disjoint same-line symbols remain distinct; only containing ancestors yield to children.
				for (const symbol of overlapping) {
					const r = symbol.range!;
					if (
						!overlapping.some((other) => {
							const child = other.range!;
							return (
								other !== symbol &&
								!before(child.line, child.column, r.line, r.column) &&
								!before(r.endLine, r.endColumn, child.endLine, child.endColumn) &&
								(before(r.line, r.column, child.line, child.column) ||
									before(child.endLine, child.endColumn, r.endLine, r.endColumn) ||
									other.depth > symbol.depth)
							);
						})
					)
						selected.add(symbol);
				}
				if (!overlapping.length) unknowns.add("changed extent has no current symbol (including deleted symbols)");
			}
			for (const symbol of selected) {
				const body = {
					path,
					name: symbol.name,
					kind: symbol.kind,
					range: symbol.range!,
					selection: { line: symbol.line, column: symbol.column },
					sourceDigest: current.digest,
				};
				const id = digest(["weavra-impact-symbol-v1", body]);
				if (!symbolIds.has(id)) {
					symbolIds.add(id);
					changedSymbols.push({ id, ...body });
				}
			}
		} catch (error) {
			assertActive();
			if (error instanceof ProcessCleanupError) throw error;
			unknowns.add("LSP symbols error");
		}
	}
	changedSymbols.sort(
		(a, b) =>
			lexical(a.path, b.path) ||
			a.range.line - b.range.line ||
			a.range.column - b.range.column ||
			lexical(a.id, b.id),
	);
	if (changedSymbols.length > 32) {
		changedSymbols.length = 32;
		truncated = true;
	}
	for (const [index, symbol] of changedSymbols.entries()) {
		if (index >= CONTEXT_MAX_REFERENCE_QUERIES) {
			truncated = true;
			unknowns.add("reference query budget reached");
			break;
		}
		for (const kind of ["references", "definition"] as const) {
			assertActive();
			if ((await read(symbol.path))?.digest !== symbol.sourceDigest) {
				unknowns.add("symbol became stale");
				continue;
			}
			try {
				const result = await input.lsp![kind]({ path: symbol.path, ...symbol.selection, signal: input.signal });
				assertActive();
				if (
					(await read(symbol.path))?.digest !== symbol.sourceDigest ||
					result.fileDigest !== symbol.sourceDigest ||
					!["AVAILABLE", "PARTIAL"].includes(result.status)
				) {
					unknowns.add("LSP relation unavailable or stale");
					continue;
				}
				if (result.status === "PARTIAL" || result.withheld || result.truncated) {
					truncated = true;
					unknowns.add("LSP relations incomplete");
				}
				if (result.locations.length > 128) {
					truncated = true;
					unknowns.add("LSP relations exceed bounded result contract");
					continue;
				}
				const targets = new Map<string, Awaited<ReturnType<typeof read>>>();
				for (const location of [...result.locations].sort(locationOrder)) {
					if (!targets.has(location.path)) targets.set(location.path, await read(location.path));
					const target = targets.get(location.path);
					if (!target) continue;
					if (initialDigests.get(location.path) !== target.digest) {
						unknowns.add("reference target unavailable in initial bounded snapshot or changed during query");
						if (!initialDigests.has(location.path)) truncated = true;
						continue;
					}
					const lines = target.text.split(/\r\n|\n|\r/);
					if (
						![location.line, location.column, location.endLine, location.endColumn].every(
							(v) => Number.isSafeInteger(v) && v > 0,
						) ||
						location.endLine < location.line ||
						(location.endLine === location.line && location.endColumn < location.column) ||
						location.endLine > lines.length ||
						location.column > (lines[location.line - 1]?.length ?? -1) + 1 ||
						location.endColumn > (lines[location.endLine - 1]?.length ?? -1) + 1
					) {
						unknowns.add("invalid reference location");
						continue;
					}
					const list = kind === "references" ? callers : declarations;
					const relation: ImpactRelation = {
						path: location.path,
						line: location.line,
						column: location.column,
						endLine: location.endLine,
						endColumn: location.endColumn,
						symbolId: symbol.id,
						sourceDigest: target.digest,
					};
					const key = JSON.stringify(relation);
					if (!relationKeys[kind].has(key)) {
						relationKeys[kind].add(key);
						list.push(relation);
					}
				}
			} catch (error) {
				assertActive();
				if (error instanceof ProcessCleanupError) throw error;
				unknowns.add("LSP relation error");
			}
		}
	}
	const relatedTests: ImpactReviewPack["relatedTests"] = [];
	const testCandidates = new Map<string, ImpactReviewPack["relatedTests"][number]["reason"]>();
	for (const path of discovered.files.slice(0, 64)) {
		if (!/(?:\.(?:test|spec)\.[^.]+$|(?:^|\/)test_[^/]+\.[^.]+$)/.test(path)) continue;
		if (changedFiles.some((p) => basename(path).startsWith(`${basename(p).replace(/\.[^.]+$/, "")}.`)))
			testCandidates.set(path, "same-stem");
		else if (changedFiles.some((p) => dirname(p) === dirname(path))) testCandidates.set(path, "same-directory");
		else if (input.taskContext?.relatedFiles.some((p) => p.path === path)) testCandidates.set(path, "c01-heuristic");
	}
	if (discovered.files.length > 64) truncated = true;
	for (const location of callers)
		if (/\.(?:test|spec)\.[^.]+$/.test(location.path)) testCandidates.set(location.path, "lsp-reference");
	const score = (reason: string) =>
		reason === "lsp-reference" ? 3 : reason === "same-stem" ? 2 : reason === "same-directory" ? 1 : 0;
	for (const [path, reason] of [...testCandidates].sort((a, b) => score(b[1]) - score(a[1]) || lexical(a[0], b[0]))) {
		const source = await read(path);
		if (!source) continue;
		if (relatedTests.length >= 24) {
			truncated = true;
			break;
		}
		relatedTests.push({ path, reason, sourceDigest: source.digest });
	}
	unknowns.add("bounded references and heuristic tests are not a complete dependency graph");
	unknowns.add("public contract compatibility is not established by this pack");
	callers.sort(
		(a, b) =>
			Number(input.scopePaths.some((p) => b.path === p || b.path.startsWith(`${p}/`))) -
				Number(input.scopePaths.some((p) => a.path === p || a.path.startsWith(`${p}/`))) ||
			locationOrder(a, b) ||
			lexical(a.symbolId, b.symbolId),
	);
	declarations.sort((a, b) => locationOrder(a, b) || lexical(a.symbolId, b.symbolId));
	if (callers.length > 64) {
		callers.length = 64;
		truncated = true;
	}
	if (declarations.length > 64) {
		declarations.length = 64;
		truncated = true;
	}
	// Revalidate every emitted source after all queries. A target digest binds current
	// bytes, not the language server's internal target-document cache.
	const checked = new Map<string, string | undefined>();
	for (const item of [...changedSymbols, ...callers, ...declarations, ...relatedTests])
		if (!checked.has(item.path)) checked.set(item.path, (await read(item.path))?.digest);
	for (const records of [changedSymbols, callers, declarations, relatedTests]) {
		for (let index = records.length - 1; index >= 0; index--)
			if (checked.get(records[index].path) !== records[index].sourceDigest) {
				records.splice(index, 1);
				unknowns.add("context source changed during composition");
			}
	}
	const retainedSymbols = new Set(changedSymbols.map((symbol) => symbol.id));
	for (const records of [callers, declarations])
		for (let index = records.length - 1; index >= 0; index--)
			if (!retainedSymbols.has(records[index].symbolId)) records.splice(index, 1);
	for (let index = relatedTests.length - 1; index >= 0; index--)
		if (
			relatedTests[index].reason === "lsp-reference" &&
			!callers.some(
				(caller) =>
					caller.path === relatedTests[index].path && caller.sourceDigest === relatedTests[index].sourceDigest,
			)
		)
			relatedTests.splice(index, 1);
	unknowns.add("target source digests do not attest language-server cache freshness");
	const body = {
		version: 1 as const,
		runId: input.runId,
		revision: input.revision,
		taskContractDigest: input.taskContractDigest,
		diffDigest: input.diff.diffDigest,
		changedFiles,
		changedSymbols,
		callers,
		declarations,
		relatedTests,
		unknowns: [...unknowns].sort(lexical),
		truncated,
	};
	const finish = (): ImpactReviewPack => ({
		...body,
		generatedAt: input.generatedAt,
		digest: digest(["weavra-impact-review-v1", body]),
	});
	let pack = finish();
	// Each iteration removes an item; at most these bounded arrays' total length plus one checks.
	const removals =
		relatedTests.length +
		declarations.length +
		callers.length +
		changedSymbols.length +
		changedFiles.length +
		body.unknowns.length;
	for (let i = 0; Buffer.byteLength(JSON.stringify(pack)) > maxBytes && i <= removals; i++) {
		body.truncated = true;
		if (relatedTests.length) relatedTests.pop();
		else if (declarations.length) declarations.pop();
		else if (callers.length) callers.pop();
		else if (changedSymbols.length) changedSymbols.pop();
		else if (changedFiles.length) changedFiles.pop();
		else if (body.unknowns.length) body.unknowns.pop();
		else throw new Error("Impact context minimum exceeds byte cap");
		pack = finish();
	}
	if (Buffer.byteLength(JSON.stringify(pack)) > maxBytes) throw new Error("Impact context exceeds byte cap");
	return pack;
}

export function summarizeImpactReviewPack(pack: ImpactReviewPack) {
	return {
		digest: pack.digest,
		changedSymbolCount: pack.changedSymbols.length,
		callerCount: pack.callers.length,
		testCount: pack.relatedTests.length,
		bytes: Buffer.byteLength(JSON.stringify(pack)),
		truncated: pack.truncated,
	};
}
