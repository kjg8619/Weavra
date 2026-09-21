import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findPackageDirectories } from "./package-workspaces.mjs";

export function getRuntimeArtifactPackages(root = "packages") {
	return findPackageDirectories(root)
		.map((directory) => ({
			directory,
			...JSON.parse(readFileSync(join(directory, "package.json"), "utf8")),
		}))
		// Buildable library entrypoints define the SDK artifact family, not npm publication privacy.
		// Source-only extension examples can have a build script without producing a library.
		.filter((pkg) => typeof pkg.scripts?.build === "string" && (pkg.main || pkg.exports))
		.map(({ directory, name, version }) => ({ directory, name, version }));
}
