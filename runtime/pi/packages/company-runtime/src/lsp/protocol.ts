export const MAX_FRAME_BYTES = 1_048_576;
export const MAX_BUFFER_BYTES = MAX_FRAME_BYTES * 2;
export const MAX_PENDING = 16;
export type LspErrorCode = "CLOSED" | "EXITED" | "UNAVAILABLE" | "TIMEOUT" | "CANCELLED" | "PROTOCOL" | "RPC" | "LIMIT";
export class LspConnectionError extends Error {
	readonly code: LspErrorCode;
	constructor(code: LspErrorCode) {
		super(`LSP ${code}`);
		this.name = "LspConnectionError";
		this.code = code;
	}
}
export function object(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new LspConnectionError("PROTOCOL");
	return value as Record<string, unknown>;
}

/** Bounded byte framing. Never interpret a Content-Length as JS string length. */
export class LspFramer {
	private buffer = Buffer.alloc(0);
	private length: number | undefined;
	push(chunk: Buffer): Record<string, unknown>[] {
		if (this.buffer.length + chunk.length > MAX_BUFFER_BYTES) throw new LspConnectionError("LIMIT");
		this.buffer = Buffer.concat([this.buffer, chunk]);
		const messages: Record<string, unknown>[] = [];
		while (messages.length < 256) {
			if (this.length === undefined) {
				const end = this.buffer.indexOf("\r\n\r\n");
				if (end === -1) {
					if (this.buffer.length > 4096) throw new LspConnectionError("PROTOCOL");
					break;
				}
				if (end > 4096) throw new LspConnectionError("PROTOCOL");
				const headers = this.buffer.subarray(0, end).toString("utf8").split("\r\n");
				const lengths = headers.filter((header) => /^content-length:/i.test(header));
				if (
					lengths.length !== 1 ||
					!/^content-length: *(?:0|[1-9][0-9]*)$/i.test(lengths[0]) ||
					headers.some(
						(header) =>
							!/^(?:content-length: *[0-9]+|content-type: *application\/vscode-jsonrpc; *charset=utf-8)$/i.test(
								header,
							),
					)
				)
					throw new LspConnectionError("PROTOCOL");
				this.length = Number(lengths[0].split(":")[1].trim());
				if (!Number.isSafeInteger(this.length) || this.length < 1 || this.length > MAX_FRAME_BYTES)
					throw new LspConnectionError("LIMIT");
				this.buffer = this.buffer.subarray(end + 4);
			}
			if (this.buffer.length < this.length) break;
			const bytes = this.buffer.subarray(0, this.length);
			this.buffer = this.buffer.subarray(this.length);
			this.length = undefined;
			const text = bytes.toString("utf8");
			if (!Buffer.from(text).equals(bytes)) throw new LspConnectionError("PROTOCOL");
			let value: unknown;
			try {
				value = JSON.parse(text);
			} catch {
				throw new LspConnectionError("PROTOCOL");
			}
			const message = object(value);
			if (message.jsonrpc !== "2.0") throw new LspConnectionError("PROTOCOL");
			messages.push(message);
		}
		if (messages.length === 256 && this.buffer.length) throw new LspConnectionError("LIMIT");
		return messages;
	}
}
export function encodeMessage(message: object): Buffer {
	const body = Buffer.from(JSON.stringify(message));
	if (body.length > MAX_FRAME_BYTES) throw new LspConnectionError("LIMIT");
	return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
}
