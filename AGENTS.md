# Weavra development rules

- This is an independent product repository, not an upstream-synchronized fork.
- `runtime/pi`: use npm; preserve Pi/Weavra runtime build, check, test, shrinkwrap, and install-lock gates.
- `app/t3code`: use pnpm 11 / Vite+; preserve T3 workspace tests, typecheck, lint, format, knip, and build gates.
- These directories are independent build roots. Do not unify workspaces, lockfiles, catalogs, TypeScript versions, or build systems implicitly.
- More specific existing AGENTS.md rules under each directory take precedence within that scope.
- Cross-boundary integration uses the stdio Weavra protocol. No direct Pi runtime source imports in T3 server code.
- Git product root, project under execution, package root, and source checkout root are different concepts; preserve the intended meaning.
- Browser/Jev is observation-only; candidate = CANDIDATE_ONLY; Runtime/Host registers; RegisteredVerifier verifies with fresh captures; Kernel completes. Never reuse candidate evidence for verification or introduce browser automatic repair.
- Preserve the existing duplicated protocol definitions until a separately approved architecture task.
- Source repositories are historical provenance only. Never modify, rename, transfer, archive, rewrite, or automatically synchronize them as part of consolidation.
- No automatic upstream sync, scheduled merges, mirrors, subtree pulls, cherry-picks, or conflict resolvers.
- Preserve nested licenses and notices. Do not choose a new root-level license without explicit authorization.
- Record consolidation work in root docs/WORK_LOG.md in Korean, distinguishing historical results from current checks. Never modify source-repository work logs.
- Never use destructive repair, force-push, history rewriting, or bypass failed validation. Do not record consolidation as CLOSED until every documented completion gate passes.
- C09/V0.6D, package/namespace renaming, branding migration, UI redesign, and architecture refactoring are outside this migration.
