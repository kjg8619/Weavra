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

- `migration/repository-consolidation`: import and compatibility work until all gates pass.
- `main`: validated consolidated baseline only.
- `devlop`: ongoing development, created from validated main.

Nested `.github/workflows` files are preserved historical source files; GitHub does not execute them as root workflows. Only root `.github/workflows` defines active Weavra CI.
