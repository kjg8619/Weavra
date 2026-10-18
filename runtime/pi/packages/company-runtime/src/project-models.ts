import { InMemoryCredentialStore, InMemoryModelsStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

/**
 * Runtime providers the App may prefill from its own installed, authenticated providers.
 * `anthropic` is deliberately absent: an App Claude login must never become a Runtime
 * profile that would route work through Claude subscription OAuth.
 */
const PREFILLABLE_PROVIDERS = ["openai-codex"] as const;

type ModelSource = { getModels(provider?: string): readonly { id: string; reasoning: boolean }[] };

/** Static catalog metadata only: no credential file, provider call, network refresh or login flow. */
export function safeProjectModels(models: ModelSource) {
	return {
		providers: PREFILLABLE_PROVIDERS.map((provider) => ({
			provider,
			models: models.getModels(provider).map((model) => ({ id: model.id, reasoning: model.reasoning })),
		})),
	};
}

export async function readProjectModels() {
	try {
		const models = await ModelRuntime.create({
			credentials: new InMemoryCredentialStore(),
			modelsPath: null,
			modelsStore: new InMemoryModelsStore(),
			allowModelNetwork: false,
			refreshOnCreate: false,
		});
		return safeProjectModels(models);
	} catch {
		// A recommendation is optional; a catalog failure must not block the draft.
		return { providers: [] };
	}
}
