import { createHash } from "node:crypto";
import type { ExtensionContext, ToolCallEvent, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import { type CommandRiskAssessment, type CommandRiskCategory, classifyCommand } from "./command-risk.ts";

/**
 * Weavra command guard (#5 candidate 1): a check inside the existing parent-conversation `tool_call` hook, not a new
 * execution path. Before the `weavra` conversation's built-in `bash` tool runs a command, the local classifier
 * (command-risk.ts) explains it; destructive and unclassified commands need the user's explicit confirmation.
 *
 * - It never grants anything. Read-only commands and reversible local edits run as they did before the guard;
 *   destructive/unknown commands run only after "Run once" in an interactive UI. For an `unknown` command the user
 *   may instead choose "Allow for this session": that exact command then runs without asking until the session
 *   ends (in memory only, never persisted). Destructive commands ask every time. Without a UI they are refused.
 *   Dismissal, timeout, abort or any error refuses and grants nothing.
 * - It does not cover Weavra workflow workers (they have no shell tool; Policy denies bash/sh/shell/exec) or
 *   registered checks (trusted Host configuration run without a shell). The extension skips the guard while a
 *   workflow owns the workspace, because every parent tool call is already blocked then.
 * - Local deterministic rules only: no Jev, model or network call. Each decision is recorded as a bounded session
 *   entry with a digest of the command instead of its text.
 */

export const COMMAND_GUARD_ENTRY_TYPE = "weavra.command-guard";
export const COMMAND_GUARD_ENVIRONMENT = "WEAVRA_COMMAND_GUARD";

export type CommandGuardMode = "confirm" | "off";
export interface CommandGuardSetting {
	mode: CommandGuardMode;
	/** An unrecognized value was ignored; only `off` disables the guard. */
	ignoredValue: boolean;
}

/** Explicit opt-out only: `off` disables the guard; unset, `confirm`, `on` or any other value keeps it on. */
export function commandGuardSetting(value: string | undefined): CommandGuardSetting {
	const normalized = value?.trim().toLowerCase() ?? "";
	if (normalized === "off") return { mode: "off", ignoredValue: false };
	return { mode: "confirm", ignoredValue: !["", "confirm", "on"].includes(normalized) };
}

/** The parent conversation's shell tools. PowerShell syntax is never classified: every call is `unknown`. */
export function isGuardedShellTool(toolName: string): boolean {
	return toolName === "bash" || toolName === "powershell";
}

export interface CommandGuardEntry {
	schemaVersion: 1;
	tool: "bash" | "powershell";
	toolCallId: string;
	category: CommandRiskCategory;
	/** Fixed-template reasons from the classifier; no arguments, paths or other raw command text. */
	reasons: string[];
	programs: string[];
	/** Digest and size of the command without surrounding blanks (`normalizeCommand`); the text is not recorded. */
	commandSha256: string;
	commandBytes: number;
	/**
	 * `allowed_session`: the user allowed this exact `unknown` command for the rest of the session;
	 * `allowed_session_cached`: a later identical call ran on that allowance without a prompt.
	 */
	confirmation:
		| "not_required"
		| "confirmed"
		| "allowed_session"
		| "allowed_session_cached"
		| "declined"
		| "unavailable"
		| "failed";
	decision: "allow" | "deny";
	/** Always 0: the guard makes no Jev, model or network call. */
	remoteCalls: 0;
}

export const COMMAND_GUARD_DENY = "Deny";
export const COMMAND_GUARD_RUN_ONCE = "Run once";
/** Offered for `unknown` commands only; never for destructive ones. */
export const COMMAND_GUARD_ALLOW_SESSION = "Allow for this session";

export interface CommandGuardPorts {
	/** Must succeed before a command runs; a decision that cannot be recorded does not run. */
	record: (entry: CommandGuardEntry) => void;
	/**
	 * Keys (`tool:sha256` of the normalized command) of `unknown` commands allowed for the current session. The
	 * extension keeps this set in memory only and clears it at every session start; it is never persisted.
	 */
	sessionAllowances: Set<string>;
}

/**
 * The command without leading and trailing blanks (space, tab, newline), which never change what bash runs. The
 * text is kept exact when a backslash would escape the first trailing blank. Nothing else is normalized: quoting,
 * inner whitespace and arguments must match for a session allowance to apply.
 */
export function normalizeCommand(command: string): string {
	const blank = (character: string) => character === " " || character === "\t" || character === "\n";
	let end = command.length;
	while (end > 0 && blank(command[end - 1])) end--;
	if (end < command.length && command[end - 1] === "\\") end = command.length;
	let start = 0;
	while (start < end && blank(command[start])) start++;
	return command.slice(start, end);
}
const PREVIEW_LIMIT = 1600;
const FAILED_REASON =
	"Weavra command guard: the command was not run because the guard could not complete its check. A failed check never allows a command.";

const POWERSHELL: CommandRiskAssessment = {
	category: "unknown",
	reasons: ["PowerShell commands are not classified (bash/POSIX shell rules only)"],
	programs: [],
};

/** Control and bidirectional-override characters could forge the prompt; newlines and tabs stay readable. */
function sanitize(text: string): string {
	return text.replace(
		/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g,
		(character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
	);
}

/** Head and tail of long commands. Every part was classified, so hidden text still shows up in the reasons. */
function preview(command: string): string {
	const text = sanitize(command);
	if (text.length <= PREVIEW_LIMIT) return text;
	const head = text.slice(0, 1000);
	const tail = text.slice(-500);
	return `${head}\n… [${text.length - head.length - tail.length} characters not shown here; see the tool call above] …\n${tail}`;
}

function summary(assessment: CommandRiskAssessment): string {
	return assessment.reasons.slice(0, 3).join("; ");
}

export async function guardShellToolCall(
	event: Pick<ToolCallEvent, "toolName" | "toolCallId" | "input">,
	ctx: Pick<ExtensionContext, "hasUI" | "mode" | "signal" | "ui">,
	ports: CommandGuardPorts,
): Promise<ToolCallEventResult | undefined> {
	const { record, sessionAllowances } = ports;
	const tool = event.toolName === "powershell" ? "powershell" : "bash";
	const input = (event.input ?? {}) as Record<string, unknown>;
	const command = typeof input.command === "string" ? input.command : "";
	const normalized = normalizeCommand(command);
	const commandSha256 = createHash("sha256").update(normalized).digest("hex");
	// The tool is part of the key: the same text means something else to PowerShell.
	const allowanceKey = `${tool}:${commandSha256}`;
	let assessment: CommandRiskAssessment | undefined;
	const entry = (
		confirmation: CommandGuardEntry["confirmation"],
		decision: CommandGuardEntry["decision"],
	): CommandGuardEntry => ({
		schemaVersion: 1,
		tool,
		toolCallId: String(event.toolCallId)
			.slice(0, 128)
			.replace(/[^\w.:-]/g, "_"),
		category: assessment?.category ?? "unknown",
		reasons: [...(assessment?.reasons ?? [])],
		programs: [...(assessment?.programs ?? [])],
		commandSha256,
		commandBytes: Buffer.byteLength(normalized),
		confirmation,
		decision,
		remoteCalls: 0,
	});
	try {
		assessment =
			tool === "powershell"
				? POWERSHELL
				: typeof input.command === "string"
					? classifyCommand(input.command)
					: { category: "unknown", reasons: ["the tool input has no command text"], programs: [] };
		if (assessment.category === "read_only" || assessment.category === "reversible") {
			// Recorded before it runs, like Policy's durable intent: a decision that cannot be recorded does not run.
			record(entry("not_required", "allow"));
			return undefined;
		}
		const label = assessment.category === "destructive" ? "destructive" : "unclassified";
		if (!ctx.hasUI) {
			record(entry("unavailable", "deny"));
			return {
				block: true,
				reason: `Weavra command guard: this ${label} ${tool} command was not run. It needs an interactive confirmation, which is not available in ${ctx.mode} mode (${summary(assessment)}). Read-only commands and reversible local edits still run. Only the user can turn the guard off, explicitly, with ${COMMAND_GUARD_ENVIRONMENT}=off.`,
			};
		}
		// Only an earlier explicit choice in this session's UI; never without a UI and never for a destructive command.
		const sessionOption = assessment.category === "unknown";
		if (sessionOption && sessionAllowances.has(allowanceKey)) {
			record(entry("allowed_session_cached", "allow"));
			return undefined;
		}
		const signal = ctx.signal;
		const choice = await ctx.ui.select(
			[
				`Weavra command guard: run this ${label} ${tool} command?`,
				`Classification: ${assessment.category} (${assessment.category === "destructive" ? "may delete or overwrite data" : "not recognized as read-only or a reversible local edit"}; not a permission)`,
				...assessment.reasons.map((reason) => `- ${reason}`),
				"Command:",
				preview(command),
				`${COMMAND_GUARD_DENY} is the default. ${COMMAND_GUARD_RUN_ONCE} allows only this call; nothing is rolled back.`,
				sessionOption
					? `${COMMAND_GUARD_ALLOW_SESSION} runs this exact command without asking until the session ends (kept in memory only); any other command is checked again.`
					: "Destructive commands are asked every time.",
			].join("\n"),
			sessionOption
				? [COMMAND_GUARD_DENY, COMMAND_GUARD_RUN_ONCE, COMMAND_GUARD_ALLOW_SESSION]
				: [COMMAND_GUARD_DENY, COMMAND_GUARD_RUN_ONCE],
			signal ? { signal } : undefined,
		);
		const answered = !signal?.aborted;
		if (answered && sessionOption && choice === COMMAND_GUARD_ALLOW_SESSION) {
			// Recorded first: an allowance whose decision cannot be recorded is never granted.
			record(entry("allowed_session", "allow"));
			sessionAllowances.add(allowanceKey);
			return undefined;
		}
		const confirmed = answered && choice === COMMAND_GUARD_RUN_ONCE;
		record(entry(confirmed ? "confirmed" : "declined", confirmed ? "allow" : "deny"));
		if (confirmed) return undefined;
		return {
			block: true,
			reason: `Weavra command guard: the user did not confirm this ${label} ${tool} command, so it was not run (${summary(assessment)}). Do not retry it or work around it with another command; ask the user how to proceed.`,
		};
	} catch {
		try {
			record(entry("failed", "deny"));
		} catch {
			// The command is refused below either way.
		}
		return { block: true, reason: FAILED_REASON };
	}
}
