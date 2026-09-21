import { type Static, Type } from "typebox";
import type { LspConfig } from "./types.ts";

const strict = { additionalProperties: false } as const;
export const LspConfigSchema = Type.Object(
	{
		enabled: Type.Optional(Type.Boolean()),
		servers: Type.Optional(
			Type.Array(
				Type.Object(
					{
						id: Type.String({ pattern: "^[a-zA-Z0-9_-]+$", minLength: 1, maxLength: 64 }),
						executable: Type.String({ minLength: 1, maxLength: 4096 }),
						args: Type.Array(Type.String({ maxLength: 4096 }), { maxItems: 32 }),
						extensions: Type.Array(Type.String({ pattern: "^\\.[a-z0-9]+$", maxLength: 32 }), {
							minItems: 1,
							maxItems: 32,
							uniqueItems: true,
						}),
						timeout_ms: Type.Optional(Type.Integer({ minimum: 100, maximum: 60000 })),
					},
					strict,
				),
				{ maxItems: 4 },
			),
		),
	},
	strict,
);
export function safeServerCommand(executable: string, args: readonly string[]): boolean {
	return (
		/^(?:\/[^\x00-\x1f]+|[A-Za-z0-9._+-]+)$/.test(executable) &&
		!/(?:^|\/)(?:bash|sh|zsh|dash|ksh|fish|csh|cmd|powershell|pwsh|env|xargs|sudo|su|nohup|setsid|npx|npm|pnpm|yarn|bunx|ssh)$/i.test(
			executable,
		) &&
		!args.some((arg) => /[\x00]/.test(arg) || /^(?:-[cep]|--(?:eval|print|command)(?:=|$))/.test(arg))
	);
}
export function normalizeLspConfig(input: Static<typeof LspConfigSchema>): LspConfig {
	const ids = new Set<string>();
	const extensions = new Set<string>();
	const servers = (input.servers ?? []).map((server) => {
		if (ids.has(server.id) || !safeServerCommand(server.executable, server.args))
			throw new Error("Invalid LSP server registration");
		ids.add(server.id);
		for (const extension of server.extensions) {
			if (extensions.has(extension)) throw new Error("Duplicate LSP extension routing");
			extensions.add(extension);
		}
		return { ...server, timeout_ms: server.timeout_ms ?? 10000 };
	});
	if (input.enabled && !servers.length) throw new Error("Enabled LSP requires explicit servers");
	return { enabled: input.enabled ?? false, servers };
}
