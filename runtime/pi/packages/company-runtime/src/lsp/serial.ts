import type { LspPort } from "./types.ts";

/**
 * V0.8A: the concurrent Developers of one COMPLEX wave share the Run's one LSP manager, which answers one query at
 * a time. Queries through this port wait in FIFO order for the previous query to settle instead of failing as
 * concurrent; results, failures, status and close stay those of the underlying port. Read-only; grants nothing.
 */
export function serializedLspPort(port: LspPort): LspPort {
	let tail: Promise<unknown> = Promise.resolve();
	const queue = <T>(query: () => Promise<T>): Promise<T> => {
		const result = tail.then(query, query);
		tail = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	};
	return {
		diagnostics: (request) => queue(() => port.diagnostics(request)),
		definition: (request) => queue(() => port.definition(request)),
		references: (request) => queue(() => port.references(request)),
		symbols: (request) => queue(() => port.symbols(request)),
		get safeToRelease() {
			return port.safeToRelease;
		},
		get cleanupFailed() {
			return port.cleanupFailed;
		},
		close: () => port.close(),
	};
}
