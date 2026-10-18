import { createHash } from "node:crypto";

/** Key-order-independent SHA-256 of a JSON value; the Host's configuration and checkout digest. */
export function fingerprint(value: unknown): string {
	return `sha256:${createHash("sha256")
		.update(
			JSON.stringify(value, (_key, item: unknown) => {
				if (!item || typeof item !== "object" || Array.isArray(item)) return item;
				return Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)));
			}),
		)
		.digest("hex")}`;
}
