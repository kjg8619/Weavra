# Weavra

Weavra is an independent product combining an agent runtime with a desktop, web, and host application. It is not operated as a Pi or T3Code fork.

```text
Weavra
├─ Runtime / Agent Engine
│  └─ runtime/pi
├─ Desktop/Web/Host
│  └─ app/t3code
└─ Runtime ↔ Host
   └─ stdio protocol
```

## Build boundaries

- `runtime/pi`: independent npm build root, `package-lock.json`, Node >= 22.19.
- `app/t3code`: independent pnpm 11 / Vite+ build root, `pnpm-lock.yaml`, Node ^24.13.1.
- No root workspace, merged lockfile, shared dependency catalog, or direct runtime source import from the app.
- The host invokes `weavra bridge --stdio --project-trusted`, optionally with `--control`, through the trusted `T3_WEAVRA_EXECUTABLE` startup configuration.

Use Node 24.19.0 for the consolidation validation environment. Install/build inside each build root, not at product root; complete commands and evidence are in the [consolidation record](docs/migration/REPOSITORY_CONSOLIDATION.md).

```sh
# From product root: configure the exact executable without enabling control.
source scripts/weavra-env.sh
# Then run the existing App development command from app/t3code.
```

See [architecture boundaries](docs/architecture/BOUNDARIES.md) for project/source-root semantics and C08 authority.

## Product development build

The canonical agent command is `weavra`; its product identity is `Weavra development`.
Build/install inside `runtime/pi`, then expose the checkout-local launcher:

```sh
cd runtime/pi
npm install --ignore-scripts
npm run hydrate:model-data
npm run build
npm link --workspace packages/company-runtime --ignore-scripts
weavra setup
weavra doctor
weavra --help
```

Runtime state belongs to `~/.weavra/agent`. Self-update and remote session sharing
are unavailable until independent Weavra infrastructure exists; `weavra update`
explains source-checkout updates instead of installing Pi or T3 Code.
Explicit extension installation/removal is separate from product self-update.

See [Product Independence](docs/architecture/PRODUCT_INDEPENDENCE.md) for version
semantics, network/hosted-service policy, compatibility shims and preserved lineage.

## Consolidation provenance

Consolidation date: 2026-09-21. Development harness: OMP / GPT-6 Astra.

| Source | Final split-repository baseline | Historical validation |
| --- | --- | --- |
| [kjg8619/pi](https://github.com/kjg8619/pi) | `19184e387733dd3558dffff874c58a8e67748e40` | Exact CI [35556089694](https://github.com/kjg8619/pi/actions/runs/35556089694): success |
| [kjg8619/t3code](https://github.com/kjg8619/t3code) | `f6ff0ae0f1ae0f54aee055c64b82dd8e2b9eebdf` | CI NOT RUN; local 14 workspaces, 1,270 passed files, 17,284 PASS, 58 skipped; typecheck/lint/fmt/knip/build PASS; lint 722 warnings, 0 errors |

These are historical source results, not proof of validation in the consolidated layout. Consolidated evidence belongs in `docs/migration/REPOSITORY_CONSOLIDATION.md`.

C08 remains CLOSED in its bounded local-static browser scope. Browser/Jev produces observations only; candidates are `CANDIDATE_ONLY`; Runtime/Host owns registration, RegisteredVerifier owns verification, and Kernel owns completion. Fresh captures remain required. Candidate evidence reuse, browser automatic repair, action loops, authenticated personal browsers, and arbitrary remote crawling remain unsupported.

No C09/V0.6D product work is part of consolidation. Source repositories remain unmodified, unarchived historical provenance. No automatic upstream synchronization, regular merge, or compatibility tracking is introduced. Future selective adoption requires a separate explicit task.

Nested READMEs and licenses remain authoritative for their scopes. See [NOTICE.md](NOTICE.md); this repository does not impose a new root-level license on imported code.

## Branches

- `main`: validated product history; never a direct implementation target.
- `devlop`: integration branch; only verified PRs are merged here.
- Feature branches: implementation and validation in isolated worktrees, PRs targeting `devlop`.
- `migration/repository-consolidation`: preserved consolidation history.

Use normal pushes and merge-based integration when needed. No force pushes,
history rewriting, direct integration-branch implementation or automatic PR merge.

Nested `.github/workflows` files are preserved historical source files; GitHub does not execute them as root workflows. Only root `.github/workflows` defines active Weavra CI.
