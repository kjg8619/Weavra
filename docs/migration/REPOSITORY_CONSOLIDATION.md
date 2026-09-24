# Repository consolidation record

Status: implementation validated locally and by all three root CI jobs. Historical source results and current evidence are distinct. Published baseline identity is recorded by the annotated provenance tag described below.

Date: 2026-09-21. Target: independent public [kjg8619/Weavra](https://github.com/kjg8619/Weavra). Harness: OMP / GPT-6 Astra. Scope: repository consolidation only; no C09/V0.6D feature work.

## Immutable import evidence

| Source | Source commit | Import commit | Imported subtree | Entries |
| --- | --- | --- | --- | ---: |
| Pi | `19184e387733dd3558dffff874c58a8e67748e40` | `89d917c312f52c028a3f7d5183ba602faef19dd1` | `b7bb09f505ce3f604e401ca1e70d376cdbbca9cd` | 1918 |
| T3Code | `f6ff0ae0f1ae0f54aee055c64b82dd8e2b9eebdf` | `8fdde3c574c7ad7919810c67d1ab86de0f18ddc6` | `9d2146522f03104f605b421828582464e97cb610` | 23069 |

`node scripts/verify-imports.mjs` compares the committed source manifests against each immutable import subtree: relative path, Git mode, object type and blob ID. Symlink target bytes are blob content; executable modes are included. It also asserts the complete source tree object identity. It passed locally for all 24,987 entries. Compatibility commits are subsequent history, never edits to the import commits.

An initial `git archive` extraction changed the batch file's newline representation through attributes. It was rejected before import commit creation. Raw source objects and indexed modes were used instead; the committed trees match byte-for-byte. Source Git histories were not attached as parents.

## Categories

### Root ownership and policy

New README, root AGENTS, NOTICE, architecture/migration/work-log documentation, root CI and validation/development helpers. No root package workspace, package manifest, dependency catalog or merged lockfile. Original repositories stay public, unarchived and unmodified; no transfer, rename, branch/tag rewrite, mirror, scheduled merge, subtree pull or sync bot.

### Required Pi path compatibility

| File | Problem after nesting | Correction / proof |
| --- | --- | --- |
| `runtime/pi/scripts/create-source-archive.sh` | Git tree paths assumed Pi at repository root; invoking archive from nested cwd could filter out the selected subtree | Prefix source paths, select Pi subtree, archive from product Git root; source archive smoke succeeds |
| `runtime/pi/scripts/diff-model-catalog.mjs` | Git root incorrectly used as generator/package checkout; baseline worktree omitted Pi prefix | Resolve checkout from module location, preserve prefix in temporary baseline worktree; `--thinking openai` smoke succeeds |
| `runtime/pi/scripts/check-lockfile-commit.mjs` | HEAD/index lookups assumed root `package-lock.json` | Resolve local build root and prefix Git index paths; standalone+nested policy regression passes |
| `runtime/pi/packages/company-runtime/src/provenance.ts` | Git root used to find CLI bundle, so nested provenance lost bundle identity | Separate source/build checkout path from containing Git commit; regression checks exact bundle path/hash and actual Git commit |
| `runtime/pi/packages/coding-agent/test/suite/company-runtime-status.test.ts` | Whole serialized state forbidden from containing literal `Weavra`, including valid provenance filesystem paths | Remove incidental substring assertion; retain state/status/authority checks |

These are path/fixture compatibility changes, not runtime authority or protocol redesign. T3 production source remains unchanged.

### Audited, intentionally unchanged

- Launcher module-relative checkout and bundle lookup already resolve `runtime/pi` correctly.
- Runtime GitWorkspace, launcher project trust and target execution cwd retain actual project Git-root semantics.
- T3 RepositoryIdentityResolver/GitVcsDriverCore and linked-worktree identity retain product/project Git-root semantics.
- T3 build, assets, native helpers and dev scripts resolve relative to their own source/package root.
- T3 linked-worktree `.t3` state belongs to the containing worktree; root ignores it.
- Nested workflows, source READMEs, historical worklogs, license/notice files, generated namespaces and vendored trees are preserved. Historical standalone commands that use Git root for node_modules must instead run from the appropriate build root here.
- Nested `t3.json` is not an active root setup hook; see architecture boundaries.
- Duplicated Runtime/T3 protocol definitions and C08 authority paths are unchanged.

### Deferred by scope

C09/V0.6D, UI redesign, branding/package/namespace rename, protocol consolidation, workspace/toolchain unification, architectural refactoring, release/publishing automation and future upstream adoption. None is implied by this baseline.

## Reproducible validation

Run installation/build commands in the named build root; do not run package-manager installation at product root.

```sh
# runtime/pi (Node >=22.19; current consolidation uses Node 24.19.0)
npm install --ignore-scripts
npm run hydrate:model-data
npm run build
# product root
node scripts/validate.mjs pi
node --test runtime/pi/scripts/check-lockfile-commit.test.mjs
node scripts/verify-imports.mjs

# app/t3code (Node 24.19.0, pnpm 11.10.0)
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec effect-tsgo patch
pnpm --filter @t3tools/desktop run ensure:electron
# product root
node scripts/validate.mjs t3

# product root, with an actual owned Chromium installation
WEAVRA_CHROMIUM=/absolute/path/to/chromium node scripts/run-cross-boundary.mjs
```

`validate.mjs pi` runs check, check:ci, shrinkwrap and install-lock gates, test.sh (the full `npm test` suite in an allowlisted empty environment; the separate duplicate `npm test` run was removed after consolidation), launcher syntax and whitespace checks. `validate.mjs t3` runs all recursive workspace tests serially, focused control regressions, typecheck, lint, fmt:check, knip:check, build and whitespace checks. No test is selected by changed paths. Private HOME/temp/config are created and removed; provider credentials and personal sessions are not inherited. Darwin temp paths are canonical and short to respect Unix socket limits. `fd`/`fdfind` and `rg` are test prerequisites.

Root `Weavra CI` has independent `runtime/pi`, `app/t3code`, and `cross-boundary` jobs. Nested source workflows are inactive. Browser smoke uses actual production T3 transports and the actual executable; only the worker's pending inference peer is an owned loopback fixture, with no paid inference. Fresh Chromium observations and verifier results are real, not mocked.

## Current validation evidence

- Local Pi: install/hydrate/build, check/check:ci, both lock gates, npm test and test.sh PASS. Each test entrypoint: Vitest 553 passed files / 6,582 PASS / 894 skipped, 18 script tests PASS, TUI node:test success. The two entrypoints overlap and are not summed.
- Local T3: 14 workspace test tasks, 1,270 passed files, 17,284 PASS, 58 skipped; focused contracts 17 / server 26 / client 28 / web 23 PASS; typecheck/lint/fmt/knip/build PASS. Lint remains 722 warnings, 0 errors.
- Source archive + lock policy regressions: 3 PASS. Exact import manifest verification PASS.
- Actual cross-boundary smoke PASS: candidate-only browser observation, real production T3 transports and executable, registration invalidation/confirm, fitness read, workflow invalidation/confirm/cancel, canonical CANCELLED/writer release, distinct fresh self-check/test captures and fresh Broken rejection. Paid requests 0; owned pending loopback request 1.
- First root CI [35559913155](https://github.com/kjg8619/Weavra/actions/runs/35559913155), SHA `d58653e07c68ad338122f4650fbefbbc3723bcac`: cross-boundary failed on a smoke startup revision race (`STALE_PROJECT`). The fixture now synchronizes on the actual pending loopback request and uses one snapshot for cancellation. No retry, timeout relaxation or production authority change.
- Corrected exact CI [35561216496](https://github.com/kjg8619/Weavra/actions/runs/35561216496), SHA `3b22c41ee3d94af38d86b9b8e862105c57a0316f`: **success**. `runtime/pi` job `106215141718`, `app/t3code` job `106215141632`, and `cross-boundary` job `106215141757` all succeeded, including unchanged-tracked-source checks.
- Local `main` and `devlop` were created from that validated implementation. This evidence-only successor must also pass exact-SHA root CI before publication. No validation result is inferred from an ancestor.

## Final publication identity

The annotated tag `weavra-consolidation-baseline-2026-09-21` is the publication record, not a product release. Its annotation records the exact final commit, exact final CI run, source SHAs, import commits, date/harness, and verification/authority limitations. It is created only after the evidence revision passes all three CI jobs and `main`/`devlop` are fast-forwarded to that same revision.

```sh
git show --no-patch weavra-consolidation-baseline-2026-09-21
git rev-parse main devlop 'weavra-consolidation-baseline-2026-09-21^{}'
git ls-remote --refs origin refs/heads/main refs/heads/devlop
git status --porcelain
```

The source repositories remain historical provenance, not operational upstreams. Their local refs/worktrees and remote branch/tag refs were compared with pre-task snapshots and remained unchanged. Existing lint/build warnings, platform-specific skipped tests, C08's local-static scope, and absence of personal-session/paid-provider verification remain explicit limitations.

Historical source results remain in [SPLIT_REPOSITORY_BASELINE.md](SPLIT_REPOSITORY_BASELINE.md). New local failures and resolutions are recorded in [../WORK_LOG.md](../WORK_LOG.md).
