import type { RuntimeConfig } from "./config.ts";
import type { Workflow } from "./contracts.ts";

/**
 * Model intent profiles (#5): a thin alias layer over `models.profiles`. Every worker role has one alias, and
 * `models.intents` may point that alias at another configured profile; otherwise the role's default profile applies.
 * `deep` is used only when the user explicitly asks for it for one run. Routing is a deterministic lookup: no
 * provider call, classifier, cost routing or fallback, and it never changes the Task Contract, risk, Policy, review,
 * approval or completion authority.
 */
export type ModelProfile = keyof RuntimeConfig["models"]["profiles"];
export type ModelIntent = keyof NonNullable<RuntimeConfig["models"]["intents"]>;
export type ModelRole = "Executor" | "Developer" | "Reviewer";

export interface ModelRoute {
	role: ModelRole;
	intent: ModelIntent;
	/** `config`: `models.intents.<intent>` named the profile; `default`: no alias configured, the role default applies. */
	source: "config" | "default";
	profile: ModelProfile;
	provider: string;
	model: string;
}

/** Each role's alias and the profile the role used before aliases existed. `deep` has no default. */
const ROLE_ROUTES: Record<ModelRole, { intent: ModelIntent; profile: ModelProfile }> = {
	Executor: { intent: "simple", profile: "coding" },
	Developer: { intent: "standard", profile: "coding" },
	Reviewer: { intent: "review", profile: "reasoning" },
};

function roleRoute(role: string): { intent: ModelIntent; profile: ModelProfile } | undefined {
	return Object.hasOwn(ROLE_ROUTES, role) ? ROLE_ROUTES[role as ModelRole] : undefined;
}

/**
 * The model one worker role uses. `deep` is the explicit per-run user choice and applies to Developers only. `deep`
 * without `models.intents.deep`, or an alias that names no configured profile, fails instead of picking another model.
 */
export function resolveModelRoute(config: RuntimeConfig, role: ModelRole, deep = false): ModelRoute {
	const base = roleRoute(role);
	if (!base) throw new Error("Unsupported worker role");
	const intent: ModelIntent = deep && role === "Developer" ? "deep" : base.intent;
	const configured = config.models.intents?.[intent];
	if (intent === "deep" && !configured)
		throw new Error("Model intent deep is not configured (models.intents.deep); it is never selected automatically");
	const profile = configured ?? base.profile;
	const mapping = config.models.profiles[profile];
	if (!mapping) throw new Error(`Model intent ${intent} names unconfigured profile ${profile}; fallback disabled`);
	return {
		role,
		intent,
		source: configured ? "config" : "default",
		profile,
		provider: mapping.provider,
		model: mapping.model,
	};
}

/** Routes of the roles a workflow runs: QUICK has one Executor; STANDARD and COMPLEX a Developer and a Reviewer. */
export function workflowModelRoutes(config: RuntimeConfig, workflow: Workflow, deep = false): ModelRoute[] {
	const roles: ModelRole[] = workflow === "QUICK" ? ["Executor"] : ["Developer", "Reviewer"];
	return roles.map((role) => resolveModelRoute(config, role, deep));
}

/** Where a route's profile came from, for display only. */
export function modelRouteSource(route: Pick<ModelRoute, "intent" | "source">): string {
	if (route.source === "default") return "role default; no alias configured";
	return route.intent === "deep"
		? "models.intents.deep; explicit --deep for this run"
		: `models.intents.${route.intent}`;
}

/**
 * Alias view of one recorded invocation. The adapter records `modelIntent` only when a configured alias selected the
 * profile, so an absent value means the role default (as for every Run recorded before aliases existed).
 */
export function recordedModelRoute(measurement: {
	role: string;
	modelIntent?: ModelIntent;
}): Pick<ModelRoute, "intent" | "source"> | undefined {
	if (measurement.modelIntent) return { intent: measurement.modelIntent, source: "config" };
	const base = roleRoute(measurement.role);
	return base ? { intent: base.intent, source: "default" } : undefined;
}
