#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_REPO = "earendil-works/pi";
const DEFAULT_BASE_PATH = "packages/coding-agent";
const DEFAULT_CHANGELOG = "packages/coding-agent/CHANGELOG.md";
const LEGACY_REPO_RE = /^https:\/\/github\.com\/(?:badlogic|earendil-works)\/pi-mono(?=\/|$)/;
const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const INLINE_MARKDOWN_LINK_RE = /(!?\[[^\]\n]+\]\()([^\s)]+)((?:\s+[^)]*)?\))/g;

function printUsage() {
	console.log(`Usage: node scripts/release-notes.mjs <command> [options]

Commands:
  extract              Extract release notes from the coding-agent changelog

extract options:
  --version <x.y.z>    Version to extract
  --tag <vX.Y.Z>       Release tag used for repository links (defaults to v<version>)
  --changelog <path>   Changelog path (default: ${DEFAULT_CHANGELOG})
  --out <path>         Output file (default: stdout)
  --repo <owner/repo>  GitHub repository for generated links (default: ${DEFAULT_REPO})
  --base-path <path>   Base path for relative changelog links (default: ${DEFAULT_BASE_PATH})

`);
}


function parseOptions(args) {
	const options = {
		basePath: DEFAULT_BASE_PATH,
		changelog: DEFAULT_CHANGELOG,
		out: undefined,
		repo: DEFAULT_REPO,
		tag: undefined,
		version: undefined,
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--help") {
			printUsage();
			process.exit(0);
		}

		const optionNames = new Set(["--base-path", "--changelog", "--out", "--repo", "--tag", "--version"]);
		if (!optionNames.has(arg)) {
			throw new Error(`Unknown option: ${arg}`);
		}

		const value = args[++i];
		if (!value) {
			throw new Error(`${arg} requires a value`);
		}

		if (arg === "--base-path") options.basePath = value;
		if (arg === "--changelog") options.changelog = value;
		if (arg === "--out") options.out = value;
		if (arg === "--repo") options.repo = value;
		if (arg === "--tag") options.tag = value;
		if (arg === "--version") options.version = value;
	}

	return options;
}

function normalizeTag(tagOrVersion) {
	if (!tagOrVersion) {
		return undefined;
	}
	return tagOrVersion.startsWith("v") ? tagOrVersion : `v${tagOrVersion}`;
}

function versionFromTag(tag) {
	return tag.startsWith("v") ? tag.slice(1) : tag;
}


function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractChangelogSection(changelog, version) {
	const headingRe = new RegExp(`^## \\[${escapeRegExp(version)}\\](?:\\s+-\\s+\\d{4}-\\d{2}-\\d{2})?\\s*$`, "m");
	const heading = headingRe.exec(changelog);

	if (!heading) {
		return "";
	}

	const sectionStart = heading.index + heading[0].length;
	const rest = changelog.slice(sectionStart);
	const nextHeading = rest.search(/^## \[/m);
	const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);
	return section.trim();
}

function splitLocalTarget(target) {
	const hashIndex = target.indexOf("#");
	const beforeHash = hashIndex === -1 ? target : target.slice(0, hashIndex);
	const fragment = hashIndex === -1 ? "" : target.slice(hashIndex);
	const queryIndex = beforeHash.indexOf("?");

	if (queryIndex === -1) {
		return { fragment, pathPart: beforeHash, query: "" };
	}

	return {
		fragment,
		pathPart: beforeHash.slice(0, queryIndex),
		query: beforeHash.slice(queryIndex),
	};
}

function normalizePathPart(value) {
	return value.replaceAll("\\", "/");
}

function normalizeBasePath(basePath) {
	const normalized = path.posix.normalize(normalizePathPart(basePath)).replace(/\/+$/, "");
	return normalized === "." ? "" : normalized;
}

function resolveRepositoryPath(targetPath, basePath) {
	const normalizedTarget = normalizePathPart(targetPath);
	const joined = normalizedTarget.startsWith("/")
		? path.posix.normalize(normalizedTarget.replace(/^\/+/, ""))
		: path.posix.normalize(path.posix.join(normalizeBasePath(basePath), normalizedTarget));

	if (joined === "." || joined.startsWith("../") || joined === "..") {
		return undefined;
	}

	return joined;
}

function isDirectoryTarget(originalPath, repositoryPath) {
	if (originalPath.endsWith("/")) {
		return true;
	}

	const basename = path.posix.basename(repositoryPath);
	return !basename.includes(".");
}

function normalizeLinkTarget(target, options) {
	let canonicalTarget = target.replace(LEGACY_REPO_RE, `https://github.com/${options.repo}`);
	const repoUrl = `https://github.com/${options.repo}`;

	for (const route of ["blob", "tree"]) {
		for (const branch of ["main", "master"]) {
			const floatingRefPrefix = `${repoUrl}/${route}/${branch}/`;
			if (canonicalTarget.startsWith(floatingRefPrefix)) {
				canonicalTarget = `${repoUrl}/${route}/${options.tag}/${canonicalTarget.slice(floatingRefPrefix.length)}`;
			}
		}
	}

	if (canonicalTarget.startsWith("#") || canonicalTarget.startsWith("//") || URL_SCHEME_RE.test(canonicalTarget)) {
		return canonicalTarget;
	}

	const { fragment, pathPart, query } = splitLocalTarget(canonicalTarget);
	if (!pathPart) {
		return canonicalTarget;
	}

	const repositoryPath = resolveRepositoryPath(pathPart, options.basePath);
	if (!repositoryPath) {
		return canonicalTarget;
	}

	const route = isDirectoryTarget(pathPart, repositoryPath) ? "tree" : "blob";
	return `https://github.com/${options.repo}/${route}/${options.tag}/${encodeURI(repositoryPath)}${query}${fragment}`;
}

function normalizeReleaseNoteLinks(markdown, options) {
	const changes = [];
	const normalized = markdown.replace(INLINE_MARKDOWN_LINK_RE, (match, prefix, target, suffix) => {
		const normalizedTarget = normalizeLinkTarget(target, options);
		if (normalizedTarget !== target) {
			changes.push({ from: target, to: normalizedTarget });
		}
		return `${prefix}${normalizedTarget}${suffix}`;
	});

	return { changes, markdown: normalized };
}

function writeOutput(content, outPath) {
	if (outPath) {
		writeFileSync(outPath, content);
		return;
	}

	process.stdout.write(content);
}

function extractReleaseNotes(options) {
	const version = options.version ?? (options.tag ? versionFromTag(options.tag) : undefined);
	if (!version) {
		throw new Error("extract requires --version or --tag");
	}

	if (!existsSync(options.changelog)) {
		throw new Error(`Changelog does not exist: ${options.changelog}`);
	}

	const tag = normalizeTag(options.tag ?? version);
	const changelog = readFileSync(options.changelog, "utf8");
	const section = extractChangelogSection(changelog, version);
	const rawNotes = section ? `${section}\n` : `Release ${version}\n`;
	const { markdown } = normalizeReleaseNoteLinks(rawNotes, { basePath: options.basePath, repo: options.repo, tag });
	writeOutput(markdown, options.out);
}


try {
	const [command, ...args] = process.argv.slice(2);
	if (!command || command === "--help") {
		printUsage();
		process.exit(command ? 0 : 1);
	}

	const options = parseOptions(args);
	if (command === "extract") {
		extractReleaseNotes(options);
	} else if (command === "fix-github-releases") {
		throw new Error("Weavra does not rewrite source-repository releases.");
	} else {
		throw new Error(`Unknown command: ${command}`);
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
}
