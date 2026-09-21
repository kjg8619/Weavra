# Final split-repository baseline

Consolidation date: 2026-09-21. Import strategy: exact tracked snapshot; no merged or rewritten upstream Git history.

This repository begins from the final validated split-repository baseline.
The original source repositories remain the authoritative history before consolidation.

## Pi

- Source: `kjg8619/pi`, historical branch `devlop`.
- Immutable SHA: `19184e387733dd3558dffff874c58a8e67748e40`.
- Exact CI: [35556089694](https://github.com/kjg8619/pi/actions/runs/35556089694), PASS (success).
- Historical source state: local = tracking = remote; clean worktree.
- Imported at `runtime/pi`; npm / package-lock.json / Node >= 22.19.

## T3Code

- Source: `kjg8619/t3code`, historical branch `devlop`.
- Immutable SHA: `f6ff0ae0f1ae0f54aee055c64b82dd8e2b9eebdf`.
- CI NOT RUN. Local results are not remote CI results.
- Historical source state: local = tracking = remote; clean worktree.
- Imported at `app/t3code`; pnpm 11 / Vite+ / pnpm-lock.yaml / Node ^24.13.1.

Historical full local validation (Node 24.19.0 / pnpm 11.10.0):

| Scope | Result |
| --- | --- |
| contracts | 26 files / 463 PASS |
| server | 340 passed files / 5,232 PASS / 10 skipped |
| client-runtime | 79 files / 1,560 PASS |
| web | 394 files / 5,322 PASS |
| all workspaces | 14 workspaces / 1,270 passed files / 7 skipped files / 17,284 PASS / 58 skipped |
| typecheck | PASS; existing Effect suggestions |
| lint | PASS; 722 warnings / 0 errors |
| fmt | PASS; 3,969 files |
| knip | PASS (knip:check files/dependencies and scoped exports) |
| build | PASS; 7 tasks; existing x11 external, CJS import.meta, bundling/plugin timing warnings |

Focused historical regression: contracts 17 PASS, server 26 PASS, client-runtime 28 PASS, web 23 PASS. These are already included in full coverage, not additional unique tests.

## Bounded status

C08 remains CLOSED. Browser/Jev is observation producer only; candidate is CANDIDATE_ONLY; registration authority is Runtime/Host; verification authority is RegisteredVerifier; completion authority is Kernel. Fresh captures are required. Candidate evidence reuse, browser automatic repair, action loops, authenticated personal browsers, and arbitrary remote crawling are absent.

No C09/V0.6D implementation, architecture refactor, root protocol package, namespace migration, or root toolchain unification is authorized by this baseline. Historical validation must not be represented as consolidated validation. Source repositories remain unchanged and unarchived.
