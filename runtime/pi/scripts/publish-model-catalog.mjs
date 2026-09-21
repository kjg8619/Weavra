#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";

const CATALOG_SCHEMA_VERSION = 1;
// Bump this only when generated model metadata requires behavior unavailable in older pi clients.
const MINIMUM_PI_VERSION = "0.80.7";
const REQUIRED_PROVIDERS = ["anthropic", "openai", "openrouter"];
const MINIMUM_MODEL_COUNT = 500;

function parseArgs(args) {
	if (!args.includes("--dry-run")) {
		throw new Error("Weavra model catalog publication is unavailable: no independent release infrastructure is configured. Use --dry-run for local catalog validation.");
	}
	const options = { input: undefined, sourceCommit: undefined };
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--dry-run") continue;
		if (arg === "--input" || arg === "--source-commit") {
			const value = args[++index];
			if (!value) throw new Error(`${arg} requires a value`);
			options[arg === "--input" ? "input" : "sourceCommit"] = value;
			continue;
		}
		throw new Error(`Unknown argument: ${arg}`);
	}
	if (!options.input) throw new Error("--input is required");
	return options;
}

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function validateBundle(inputDir) {
	const modelsPath = join(inputDir, "models.json");
	const providerIndexPath = join(inputDir, "providers.json");
	const providersDir = join(inputDir, "providers");
	const modelsBytes = readFileSync(modelsPath);
	const models = JSON.parse(modelsBytes.toString("utf8"));
	const providerIds = readJson(providerIndexPath);

	if (typeof models !== "object" || models === null || Array.isArray(models)) {
		throw new Error("models.json must contain an object");
	}
	if (!Array.isArray(providerIds) || !providerIds.every((value) => typeof value === "string")) {
		throw new Error("providers.json must contain an array of provider IDs");
	}

	const expectedProviderIds = Object.keys(models).sort();
	if (!isDeepStrictEqual(providerIds, expectedProviderIds)) {
		throw new Error("providers.json does not match the sorted providers in models.json");
	}
	for (const providerId of REQUIRED_PROVIDERS) {
		if (!Object.hasOwn(models, providerId)) throw new Error(`Required provider is missing: ${providerId}`);
	}

	let modelCount = 0;
	for (const providerId of providerIds) {
		const providerModels = models[providerId];
		if (typeof providerModels !== "object" || providerModels === null || Array.isArray(providerModels)) {
			throw new Error(`Provider catalog must be an object: ${providerId}`);
		}
		const providerFile = readJson(join(providersDir, `${providerId}.json`));
		if (!isDeepStrictEqual(providerFile, providerModels)) {
			throw new Error(`Provider shard does not match models.json: ${providerId}`);
		}
		for (const [modelId, model] of Object.entries(providerModels)) {
			if (
				typeof model !== "object" ||
				model === null ||
				Array.isArray(model) ||
				model.id !== modelId ||
				model.provider !== providerId
			) {
				throw new Error(`Invalid model entry: ${providerId}/${modelId}`);
			}
			modelCount++;
		}
	}

	const shardFiles = readdirSync(providersDir).filter((name) => name.endsWith(".json")).sort();
	const expectedShardFiles = providerIds.map((providerId) => `${providerId}.json`).sort();
	if (!isDeepStrictEqual(shardFiles, expectedShardFiles)) {
		throw new Error("Provider shard files do not match providers.json");
	}
	if (modelCount < MINIMUM_MODEL_COUNT) {
		throw new Error(`Refusing to publish only ${modelCount} models; expected at least ${MINIMUM_MODEL_COUNT}`);
	}

	const digest = createHash("sha256").update(modelsBytes).digest("hex");
	return {
		modelsPath,
		providerIndexPath,
		providersDir,
		providerIds,
		providerCount: providerIds.length,
		modelCount,
		revision: `sha256-${digest}`,
	};
}

function gitSourceCommit() {
	const result = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
	if (result.status !== 0) throw new Error(`Unable to determine source commit: ${result.stderr.trim()}`);
	return result.stdout.trim();
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const inputDir = resolve(options.input);
	const bundle = validateBundle(inputDir);
	const publication = {
		schemaVersion: CATALOG_SCHEMA_VERSION,
		minimumPiVersion: MINIMUM_PI_VERSION,
		revision: bundle.revision,
		sourceCommit: options.sourceCommit || gitSourceCommit(),
		providerCount: bundle.providerCount,
		modelCount: bundle.modelCount,
	};
	writeFileSync(join(inputDir, "publication.json"), `${JSON.stringify(publication, null, 2)}\n`);

	console.log(JSON.stringify(publication, null, 2));
	console.log(`Validated model catalog at ${inputDir}; no objects uploaded.`);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
