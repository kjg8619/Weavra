import { resolve } from "node:path";
import type { Readable, Writable } from "node:stream";
import { Check } from "typebox/value";
import type { RuntimeEvent, RuntimeEventSink } from "./events.ts";
import {
	projectHostEvidence,
	projectHostGraph,
	readHostConfiguration,
	readHostObservation,
} from "./host-bridge-projections.ts";
import {
	HOST_BRIDGE_CAPABILITIES,
	HOST_BRIDGE_COMMANDS,
	HOST_BRIDGE_MAX_REQUEST_BYTES,
	HOST_BRIDGE_MAX_RESPONSE_BYTES,
	HOST_BRIDGE_PROTOCOL_VERSION,
	type HostBridgeCapabilities,
	type HostBridgeData,
	type HostBridgeErrorCode,
	type HostBridgeEvent,
	type HostBridgeIdentity,
	type HostBridgeRequest,
	HostBridgeRequestSchema,
	type HostBridgeResponse,
	type HostGraphSummary,
} from "./host-bridge-protocol.ts";

const identifier = /^[A-Za-z0-9._:-]{1,128}$/;
const maxConnections = 8;
const maxPending = 8;

export interface HostBridgeConnection {
	readonly closed: boolean;
	/** One complete JSON record, with or without its LF. Never a Pi RPC command. */
	receive(line: string): Promise<void>;
	/** Detaches observation only; cannot stop a Runtime, worker, verifier or writer. */
	close(): void;
}
interface Channel {
	publish(line: string): void;
	close(): void;
}
function discardAsyncFailure(value: unknown): void {
	if (value && (typeof value === "object" || typeof value === "function") && "then" in value)
		void Promise.resolve(value).catch(() => {});
}

/** Trusted Host composition only. The wire surface has no execution or mutation ports. */
export class ReadOnlyHostBridge implements RuntimeEventSink {
	private readonly cwd: string;
	private readonly channels = new Set<Channel>();
	private disposed = false;
	private readonly capabilities: HostBridgeCapabilities;

	constructor(options: {
		cwd: string;
		projectTrusted: boolean;
		handshake?: Pick<HostBridgeCapabilities, "transport" | "observationMode" | "readiness">;
	}) {
		if (options.projectTrusted !== true) throw new Error("Host bridge requires a trusted project");
		this.cwd = resolve(options.cwd);
		this.capabilities = { ...HOST_BRIDGE_CAPABILITIES, ...options.handshake };
	}

	/** Writer must be synchronous/nonblocking. False/backpressure/throw detaches, never waits on a client. */
	connect(write: (line: string) => boolean, onClose?: () => void): HostBridgeConnection {
		if (this.disposed) throw new Error("Host bridge is closed");
		if (this.channels.size >= maxConnections) throw new Error("Host bridge connection limit reached");
		let closed = false;
		let ready = false;
		let pending = 0;
		let tail = Promise.resolve();
		const close = () => {
			if (closed) return;
			closed = true;
			this.channels.delete(channel);
			try {
				discardAsyncFailure(onClose?.());
			} catch {
				/* A client cannot affect Runtime cleanup. */
			}
		};
		const sendLine = (line: string) => {
			if (closed) return;
			try {
				const accepted: unknown = write(line);
				if (accepted !== true) {
					discardAsyncFailure(accepted);
					close();
				}
			} catch {
				close();
			}
		};
		const identity = (): HostBridgeIdentity => ({
			protocolVersion: HOST_BRIDGE_PROTOCOL_VERSION,
			runId: null,
			stateRevision: null,
			projectRevision: null,
			eventId: null,
			timestamp: Date.now(),
		});
		const reply = (message: HostBridgeResponse) => {
			let line = `${JSON.stringify(message)}\n`;
			if (Buffer.byteLength(line) > HOST_BRIDGE_MAX_RESPONSE_BYTES) {
				// Do not repeat an oversized/untrusted source identity in the error envelope.
				line = `${JSON.stringify({
					...identity(),
					type: "response",
					id: message.id,
					command: message.command,
					success: false,
					error: { code: "RESPONSE_TOO_LARGE" },
				} satisfies HostBridgeResponse)}\n`;
			}
			sendLine(line);
		};
		const error = (code: HostBridgeErrorCode, id: string | null = null, command: string | null = null) => {
			reply({ ...identity(), type: "response", id, command, success: false, error: { code } });
		};
		const processLine = async (line: string) => {
			if (closed) return;
			let input: unknown;
			try {
				input = JSON.parse(line);
			} catch {
				error("INVALID_REQUEST");
				return;
			}
			if (!input || typeof input !== "object" || Array.isArray(input)) {
				error("INVALID_REQUEST");
				return;
			}
			const record = input as Record<string, unknown>;
			const id = typeof record.id === "string" && identifier.test(record.id) ? record.id : null;
			const command = typeof record.type === "string" && identifier.test(record.type) ? record.type : null;
			if (record.protocolVersion !== HOST_BRIDGE_PROTOCOL_VERSION) {
				error("UNSUPPORTED_VERSION", id, command);
				return;
			}
			if (command && !(HOST_BRIDGE_COMMANDS as readonly string[]).includes(command)) {
				error("UNSUPPORTED_COMMAND", id, command);
				return;
			}
			if (!Check(HostBridgeRequestSchema, input)) {
				error("INVALID_REQUEST", id, command);
				return;
			}
			const request = input as HostBridgeRequest;
			if (
				request.runId &&
				(request.type === "hello" || request.type === "capabilities" || request.type === "config-summary")
			) {
				error("INVALID_REQUEST", id, command);
				return;
			}
			if (request.type !== "hello" && (request.clientName !== undefined || request.capabilities !== undefined)) {
				error("INVALID_REQUEST", id, command);
				return;
			}
			if (request.type !== "hello" && !ready) {
				error("HANDSHAKE_REQUIRED", id, command);
				return;
			}
			if (request.type === "hello" || request.type === "capabilities") {
				reply({ ...identity(), type: "response", id, command, success: true, data: this.capabilities });
				ready = !closed;
				return;
			}
			if (request.type === "config-summary") {
				const data = await readHostConfiguration(this.cwd);
				reply({ ...identity(), type: "response", id, command, success: true, data });
				return;
			}
			const observation = await readHostObservation(this.cwd, request.runId);
			if (observation.status.state === "unavailable" && request.type !== "status") {
				error("STATE_UNAVAILABLE", id, command);
				return;
			}
			if (request.runId && !observation.run) {
				error(observation.status.state === "available" ? "RUN_NOT_FOUND" : "STATE_UNAVAILABLE", id, command);
				return;
			}
			let data: HostBridgeData;
			switch (request.type) {
				case "status":
					data = observation.status;
					break;
				case "current-run":
					data = observation.status.run;
					break;
				case "graph":
					if (!observation.run) {
						error("RUN_NOT_FOUND", id, command);
						return;
					}
					try {
						data = projectHostGraph(observation.run);
					} catch {
						error("GRAPH_UNAVAILABLE", id, command);
						return;
					}
					break;
				case "evidence-summary":
					if (!observation.run) {
						error("RUN_NOT_FOUND", id, command);
						return;
					}
					data = projectHostEvidence(observation.run);
					break;
				case "snapshot": {
					let graph: HostGraphSummary | null = null;
					if (observation.run) {
						try {
							graph = projectHostGraph(observation.run);
						} catch {
							/* No guessed or cached graph. */
						}
					}
					data = {
						status: observation.status,
						graph,
						graphAvailable: graph !== null,
						evidence: observation.run ? projectHostEvidence(observation.run) : null,
						configuration: await readHostConfiguration(this.cwd),
					};
					break;
				}
			}
			reply({ ...identity(), ...observation.identity, type: "response", id, command, success: true, data });
		};
		const channel: Channel = {
			close,
			publish: (line) => {
				if (ready) sendLine(line);
			},
		};
		this.channels.add(channel);
		return {
			get closed() {
				return closed;
			},
			close,
			receive: (line) => {
				if (closed) return Promise.resolve();
				if (typeof line !== "string" || Buffer.byteLength(line) > HOST_BRIDGE_MAX_REQUEST_BYTES) {
					error("INVALID_REQUEST");
					close();
					return Promise.resolve();
				}
				if (pending >= maxPending) {
					error("BUSY");
					close();
					return Promise.resolve();
				}
				pending++;
				tail = tail
					.then(() => processLine(line))
					.catch(() => {
						error("STATE_UNAVAILABLE");
					})
					.finally(() => {
						pending--;
					});
				return tail;
			},
		};
	}

	/** Host-only sink. Never awaits a wire client and never publishes raw RuntimeEvent payloads. */
	emit(event: RuntimeEvent): void {
		if (!this.channels.size) return;
		const message: HostBridgeEvent = {
			protocolVersion: HOST_BRIDGE_PROTOCOL_VERSION,
			type: "runtime_event",
			runId: event.runId,
			stateRevision: event.stateRevision,
			projectRevision: null,
			eventId: `${event.runId}:${event.sequence}`,
			timestamp: event.timestamp,
			event: {
				type: event.type,
				sequence: event.sequence,
				...("step" in event ? { step: { stepId: event.step.stepId, attempt: event.step.attempt } } : {}),
				...("role" in event ? { role: event.role } : {}),
			},
		};
		const line = `${JSON.stringify(message)}\n`;
		if (Buffer.byteLength(line) > HOST_BRIDGE_MAX_RESPONSE_BYTES) {
			this.close();
			return;
		}
		for (const channel of this.channels) channel.publish(line);
	}

	/** Host teardown only; leaves all Runtime ownership and processes untouched. */
	close(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const channel of this.channels) channel.close();
	}
}

/** Dedicated local JSONL streams. Bounds framing before parsing; never owns/destroys the supplied streams. */
export function attachHostBridgeStreams(
	bridge: Pick<ReadOnlyHostBridge, "connect">,
	input: Readable,
	output: Writable,
	onClose?: () => void,
	limits?: { maxRequestBytes?: number; maxBufferedResponseBytes?: number },
): HostBridgeConnection {
	const buffer = Buffer.allocUnsafe(limits?.maxRequestBytes ?? HOST_BRIDGE_MAX_REQUEST_BYTES);
	const utf8 = new TextDecoder("utf-8", { fatal: true });
	let length = 0;
	let ended = false;
	let last = Promise.resolve();
	const detach = () => {
		input.off("data", data);
		input.off("end", end);
		input.off("error", close);
		input.off("close", inputClosed);
		output.off("error", close);
		output.off("close", close);
		return onClose?.();
	};
	const connection = bridge.connect((line) => {
		const accepted = output.write(line);
		// A control reply is already queued even when write() signals backpressure. Permit one
		// bounded response instead of interpreting a full pipe buffer as owner shutdown.
		const bufferedLimit = limits?.maxBufferedResponseBytes ?? 0;
		return accepted || (!output.destroyed && bufferedLimit > 0 && output.writableLength <= bufferedLimit);
	}, detach);
	const close = () => {
		connection.close();
	};
	const inputClosed = () => {
		if (!ended) close();
	};
	const data = (value: unknown) => {
		const chunk = typeof value === "string" ? Buffer.from(value) : Buffer.isBuffer(value) ? value : undefined;
		if (!chunk) {
			close();
			return;
		}
		let offset = 0;
		while (offset < chunk.length && !connection.closed) {
			const newline = chunk.indexOf(10, offset);
			const stop = newline < 0 ? chunk.length : newline;
			const bytes = stop - offset;
			if (length + bytes + (newline >= 0 ? 1 : 0) > buffer.length) {
				close();
				return;
			}
			chunk.copy(buffer, length, offset, stop);
			length += bytes;
			if (newline >= 0) {
				try {
					last = connection.receive(utf8.decode(buffer.subarray(0, length)));
				} catch {
					close();
					return;
				}
				length = 0;
			}
			offset = stop + 1;
		}
	};
	const end = () => {
		ended = true;
		if (length) {
			try {
				last = connection.receive(utf8.decode(buffer.subarray(0, length)));
			} catch {
				close();
				return;
			}
		}
		void last.finally(close);
	};
	input.on("data", data);
	input.on("end", end);
	input.on("error", close);
	input.on("close", inputClosed);
	output.on("error", close);
	output.on("close", close);
	return connection;
}
