import { readFile } from "node:fs/promises";
import { normalizeRadiusGatewayUrl } from "@earendil-works/pi-ai/providers/radius-config";
import type { AuthInput } from "../cli/experimental/command-options.ts";
import { resolvePath } from "../utils/paths.ts";

export const ENV_RADIUS_GATEWAY = "WEAVRA_RADIUS_GATEWAY";

export interface RadiusRelayAuth {
	readonly gateway: string;
	readonly token: string;
}

/** Explicit custom gateway and token only; stored provider auth never enables a relay. */
export class RadiusRelayAuthResolver {
	readonly #input: AuthInput | undefined;
	readonly #gateway: string | undefined;

	constructor(input?: AuthInput, gateway = process.env[ENV_RADIUS_GATEWAY] ?? process.env.PI_RADIUS_GATEWAY) {
		this.#input = input;
		this.#gateway = gateway?.trim() ? normalizeRadiusGatewayUrl(gateway.trim()) : undefined;
	}

	get gateway(): string | undefined {
		return this.#gateway;
	}

	async resolve(options: {
		readonly required: boolean;
		readonly signal?: AbortSignal;
	}): Promise<RadiusRelayAuth | undefined> {
		options.signal?.throwIfAborted();
		if (process.env.PI_OFFLINE !== undefined) {
			if (options.required) throw new Error("Radius relay connections are unavailable in offline mode");
			return undefined;
		}
		if (this.#gateway === undefined) {
			if (options.required) throw new Error("An explicit WEAVRA_RADIUS_GATEWAY is required for relay connections");
			return undefined;
		}
		if (this.#input === undefined) {
			if (options.required) throw new Error("An explicit token or token file is required for relay connections");
			return undefined;
		}
		const value =
			this.#input.type === "token"
				? this.#input.token
				: await readFile(resolvePath(this.#input.path), { encoding: "utf8", signal: options.signal });
		const token = value.trim();
		if (token.length === 0) throw new Error("Radius authentication token must not be empty");
		return { gateway: this.#gateway, token };
	}
}
