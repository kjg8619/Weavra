## Problem and change

Runtime preparation looked like a local save, was styled ambiguously when unavailable, and buried the human connection/project identity under raw endpoint, environment ID, project ID, workspace path and a repeated grid of unknown observation values.

This PR keeps the same eligibility inputs (`canPrepareWorkflow`, including the foreign-active and stale-writer recovery branches, and the common()/submit() binding rechecks) and changes only how they are presented:
- When preparation is unavailable, the button is neutral and readable, with its cause right beside it. Preparation is described as a Runtime request, not a local save, approval or execution. Missing control capabilities cannot prepare.
- The human connection name and project title come first. Endpoint, environment ID, project ID and the full workspace path are in a labelled diagnostic disclosure, where they are selectable and can be copied with local feedback.
- Unknown capability and observation metadata collapses into one summary with details. Every original field is kept exactly once, and unknown is never turned into zero or success.
- Onboarding shows raw connection data after the connection name.

Closes: W-06, W-31, W-32.
Base: `hig/02-foundations` @ `54df7a601c8715d48f9d09a0b3e023de392c7e45` (parent app.asar `8cf8aa4a01fd665180c73daf42bc43ddee980fc76d4ff211af9d05bb8653cdf8`). Head: `9e8c3ac3d082b667c35709669cd333c04b1e57f1`. app.asar: `a6823b8c3d5785fa2f79db26063578d9a5d4b11d3cecfb48348d4cbd1919ca86`. Fixture: hig-offline-projection-v4.
Dependencies: #74 (foundations) and #73 (shared runner). The runner now waits for the diagnostic-copy clipboard write to finish, at `132dc59d` (merged into foundations as `54df7a60`). This was a harness race, not a product failure. The assertion is still exact: the copied value must equal the full fixture project path.

## Verification

All commands were run from the hig-03 worktree with Node v24.19.0 and pnpm 11.10.0. Each one has a receipt (`logs/*.json`) and a full log on [hig-evidence/03](https://github.com/kjg8619/Weavra/tree/hig-evidence/03/03).

| Step | Command | Exit |
|---|---|---:|
| Focused tests | `pnpm exec vp test run --project unit src/components/settings/{WeavraControls,CapabilityInventory,WeavraSettings}.test.tsx` (3 files, 78 tests) | 0 |
| Format / lint | `pnpm exec vp fmt --check` / `pnpm exec vp lint` on the six owned files | 0 / 0 |
| Typecheck | `pnpm --filter @t3tools/web typecheck` | 0 |
| Parent build + extract + capture | `dist:desktop:artifact --platform mac --target zip --arch arm64` at `54df7a60`; `capture.mjs --matrix ledger-plus --case 03` (152 PNGs + 6 Electron) | 0 |
| Head build + extract + capture | same at `9e8c3ac3` (152 PNGs + 6 Electron) | 0 |
| Diff | `diff.mjs` (158 pairs: 102 changed, 56 identical, 0 failures) | 0 |
| Todo-3 measurements | `measure-runtime.mjs before` / `after` (19 + 19 PNGs) | 0 / 0 |
| accept_pr 03, round 01 | `assert.mjs --case 03` (run `b526a2a6`, 11/11 PASS) -> `--verify-packet` -> `git diff --check 54df7a60 9e8c3ac3`; then standalone `--verify-packet` | 0, 0, 0; 0 |
| accept_pr 03, round 02 | `assert.mjs --case 03` (run `bd55d13f`, 11/11 PASS) -> `--verify-packet` -> `git diff --check`; then standalone `--verify-packet` | 0, 0, 0; 0 |

Round 01 is kept intact under `repeat-01/pr-03`. Each round launched a fresh isolated profile under its own run UUID. Neither round reuses a stored PASS.

**Request counters (case 03, both rounds).** These are synthetic renderer wire fixtures, not proof of Runtime execution.

| Variant | DOM disabled | AX disabled | prepare/confirm/planner requests |
|---|---|---|---:|
| unsupported | yes | yes | 0 |
| disconnected | yes | yes | 0 |
| stale | yes | yes | 0 |
| missing-scope | yes | yes | 0 |
| fresh (explicit prepare) | no | no | 1 prepare, 0 confirm/execution |
| stale confirmation binding | n/a | n/a | 0 confirm (1 prepare only) |
| reconnect after disconnect | yes | yes | 0 replayed intents |

There were 0 model requests across all unavailable variants, and the scenario counters were model 0, runtimeMutation 0, blockedOutbound 0. These are the guards that already existed. This PR does not claim to have found an execution bypass.

**Measured (supplemental, 1280x800 / 1920x1080 / 840x620, light and dark):**
- The labelled 240-character workspace path was copied exactly at all six size/theme combinations. It is selectable and wraps with no horizontal overflow.
- The prepare reason is 14px, with contrast 4.786 (light) and 4.920 (dark).
- The prepare button is 32px tall at opacity 1, with contrast 14.270 (light) and 16.750 (dark).
- All 16 original overview metadata fields are present exactly once.
- Model, mutation and external-network counters were 0.

**Known limitation.** The shared missing-scope fixture currently reports CONNECTED with an empty goal rather than a real scope denial. Its PASS shows that preparation stays disabled with zero requests. It does not show full denial integration. Unit tests in WeavraControls.test.tsx cover an ERROR/stale/null-state missing-scope observation and a forced submission.
