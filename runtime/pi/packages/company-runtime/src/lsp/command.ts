import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadRuntimeConfig } from "../config.ts";
import { inspectLspServers } from "./manager.ts";
import type { LspServerStatus } from "./types.ts";

/** Observation only: no Provider, writer, process start, diagnostic query or repair. */
export function registerLspCommand(
	pi: Pick<ExtensionAPI, "registerCommand">,
	live: (cwd: string) => LspServerStatus[] | undefined,
): void {
	pi.registerCommand("lsp", {
		description: "Weavra read-only LSP configuration/process status; /lsp [status]",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) throw new Error("Weavra commands require a notification-capable UI");
			if (!ctx.isProjectTrusted()) {
				ctx.ui.notify("Weavra: project is not trusted; no configuration was read.", "warning");
				return;
			}
			if (!["", "status", "help"].includes(args.trim())) {
				ctx.ui.notify("Usage: /lsp [status]. No install, mutation or query commands.", "warning");
				return;
			}
			if (args.trim() === "help") {
				ctx.ui.notify(
					"/lsp [status]: read-only project LSP configuration/process observation; no server start or Provider call. READY means executable resolved, not successful initialization or PASS.",
					"info",
				);
				return;
			}
			try {
				const active = live(ctx.cwd);
				let statuses = active;
				if (!statuses) {
					const loaded = await loadRuntimeConfig(ctx.cwd);
					statuses = await inspectLspServers(
						loaded.status === "configured" ? loaded.config.code_intelligence?.lsp : undefined,
					);
				}
				ctx.ui.notify(
					[
						"Weavra LSP",
						active
							? "Source: run-scoped frozen configuration"
							: "Source: current project configuration (no server started)",
						...statuses.map(
							(server) =>
								`${server.id}  ${server.status}\nextensions  ${server.extensions.join(" ")}\nprocess     ${server.process}`,
						),
						...(!statuses.length ? ["DISABLED: no enabled explicit LSP servers"] : []),
						"READY is executable availability, not diagnostics/PASS. Required process checks are unchanged.",
					].join("\n"),
					"info",
				);
			} catch {
				ctx.ui.notify("Weavra LSP status unavailable; check project configuration.", "warning");
			}
		},
	});
}
