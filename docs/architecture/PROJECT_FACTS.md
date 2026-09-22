# V0.6D / C09 — Reviewed Project Facts

Canonical scope: [issue #6](https://github.com/kjg8619/Weavra/issues/6). Starting baseline: `1b2bd177cf2c9248115443cc31948861a4789d16`. Implementation branch: `feat/v0.6d-project-facts`.

## First-use baseline — 2026-09-22

Actual consolidated source builds and isolated macOS web App → trusted stdio Runtime were exercised before implementation changes. Node 24.19.0, npm, pnpm 11.10.0; explicit `weavra setup` and `doctor`; isolated product homes, disposable Git project, exact absolute `T3_WEAVRA_EXECUTABLE`, and opt-in `T3_WEAVRA_CONTROL=1`.

The user must provide `.ai/config.yaml`, allowed paths, coding/reasoning profile mappings, and reviewed registered checks. Setup does not create these automatically. The App was launched from its source-built server with `start <project> --mode web --host 127.0.0.1 --port 43187 --no-browser --auto-bootstrap-project-from-cwd`, then paired using its one-time local URL. Settings → Project scope → exact disposable project → Project exposed Host Control.

Actual sequence: goal → prepare → edited AC → refreshed Runtime Plan Preview → explicit confirmation → STANDARD / READ_ONLY / R0 → real SDK Developer and independent Reviewer sessions → real registered Node check at SELF_CHECK and TEST → Kernel COMPLETED. Before confirmation, the deterministic inference peer received zero requests. Completion run `37c7cb76-2710-43bc-b370-85f91a35d6f6` had two PASS checks, one MET criterion, independent Review PASS, zero active agents, and released writer. UI and canonical `.ai/state.json` agreed.

A second run `001bebf5-c379-443f-8d46-2ccf7a129c25` remained RUNNING with unchanged writer identity while the browser navigated away. Reopening the same Project panel observed that run; explicit cancel produced canonical CANCELLED and released writer. A negative fixture committed `Broken` source before a third run: `07e55fdc-6b2d-474a-a236-be7a6192bb05` became BLOCKED after real SELF_CHECK FAIL, without Reviewer or COMPLETE. UI agreed. The disposable source was restored with a normal fixture commit.

**Evidence classification:** App, stdio, SDK sessions, filesystem, registered checks, and Kernel transitions were actual. Provider `c09-local`, model `fixture`, was an owned deterministic loopback SSE responder, not model inference and not a paid call. Its scripted Reviewer verdict is not evidence of model reasoning quality. No paid provider inference was performed. Native/mobile/other OS/provider combinations were not verified.

### Separate first-use friction backlog (not C09 fixes)

- Root setup instructions do not provide a complete App/Runtime project configuration walkthrough. Older nested docs retain historical split-checkout paths; the root's consolidated paths take precedence.
- Project settings are hidden until the user selects a project scope; the main chat provider setup is separate from Runtime profile setup.
- Doctor READY is local readiness, not provider readiness; missing auth warnings coexist with READY.
- Connected control and read-only owner UNKNOWN appear together. They refer to different authorities, but are easy to confuse.
- The acknowledgement message remains “Start accepted” after canonical completion; consumed previews remain visible with refresh-required status.
- Runtime overview shows internal `0.85.1`, not a public Weavra release version.
- An unrelated Codex provider-version update notification appears during the first-use flow. It is not a Weavra product updater or a paid inference call.

## Design decision

Reviewed facts belong in optional `projectFacts` within existing `.ai/state.json`, under the same FileStateStore writer lease, atomic commit, and project revision. `tasks.json` remains a derived task projection. Legacy state without facts remains valid and is not migrated on read. No separate facts database, lock, network host, or authority is introduced.

Each durable fact contains a Runtime-issued stable ID, bounded reviewed statement, project-relative source reference, SHA-256 source digest, reviewed timestamp (Unix milliseconds, matching current contracts), and host-only filesystem generation/root binding. Freshness is derived by Runtime on every projection/use, never accepted from the App or persisted as an authoritative `VALID` flag. Only explicit confirmation of a current Host preview may create or replace a durable fact. Re-review of the same source updates its existing ID; bounded capacity is 16 sources.

Fact source selection uses existing allowed-path and protected-path rules, including registered verifier sources, configured instructions, local LSP programs, and Runtime implementation paths. No project-external/remote source, symlink traversal, hardlink, special file, secret/protected source, raw transcript, raw reasoning, or tool-output storage is supported. Content is bounded strict UTF-8; review must exclude sensitive content even in innocuously named files. No automatic extraction or provider call occurs.

Generation checks reuse anchored filesystem identity (device/inode/mode/size/nanosecond mtime/ctime) plus project/root binding and source digest. Equal bytes alone cannot keep a deleted/recreated source current. Missing, unreadable, ineligible, changed, or unverifiable sources become STALE; their statements are withheld (`null`) from public projection and omitted from worker context. Inspection never silently refreshes review. The filesystem is not an OS transaction; this does not claim protection against an uncooperative process changing a file after the final check.

## Authority

Facts are advisory context only. They cannot change ExecutionMode, lower Risk, widen allowed paths, grant tools, satisfy Approval, replace registered checks or Reviewer PASS, or create PASS/COMPLETE. Kernel alone completes. Fact IDs/digests are not trusted verification evidence or mutation receipts. C08 remains CLOSED in its existing local-static observation/registration/fresh-verification boundary.

## Runtime / App contract

Reuse existing authenticated Host Control and canonical snapshot polling. Add only `facts.prepare` (sourceRef + statement) and `facts.confirm` (issued preview ID/digest). Existing owner/request/revision/expiry/replay fences apply. Prepared candidates stay in Host memory. Confirmation rechecks config, source identity, project state, and current protections under the existing writer lease.

Control snapshots carry Runtime-derived `projectFacts` and `factPreview`. App only renders canonical state and requests review/confirmation. It must distinguish disconnected/stale observation from source STALE, never manufacture VALID from an acknowledgement, and invalidate previews when the draft/owner/project changes. Reconnect reads current canonical facts; it does not replay mutations or restore old owner previews.

Worker inputs receive only currently valid reviewed statements through an explicit advisory field, independent of Task Context Pack mode. Runtime revalidates canonical state/configuration and source identity immediately before every SDK provider invocation, including subsequent tool turns. If validity changes after prompt construction, the worker fails closed before another provider call; starting a new worker selects fresh context. Incoming client/context data cannot mint facts. No mode/risk/policy/check/approval/Kernel contract is derived from fact text.

## Bounds and deliberate limitations

- At most 16 distinct source references; statements at most 500 characters; relative source references at most 256 characters; source text at most 64 KiB. No bulk extraction, remote URLs, embedding, memory synchronization, or generic mutation API.
- Source eligibility conservatively protects every configured verifier/browser/LSP executable and non-flag argument resolving inside the project, even when temporarily missing. Configured project instructions and existing built-in protected paths remain excluded.
- Known credential formats, credential assignments, transcript role records, raw reasoning tags, and conventional transcript/log paths are rejected. This is **not** a universal secret classifier: human review remains responsible for sensitive prose and semantic accuracy. Runtime establishes provenance/freshness, not factual truth.
- Re-reviewing the same source replaces its statement/digest/generation with the same ID and new reviewed timestamp. General deletion/renaming is not exposed in this slice. Source churn does not silently recycle another source's slot.
- Metadata is bounded but `.ai/state.json` remains local trusted canonical storage, not signed against a malicious local administrator. Direct filesystem tampering, hostile concurrent OS writers, and post-check races are not an OS-sandbox guarantee.
- Disconnect/owner rotation invalidates pending confirmation. An ACK never creates a UI VALID badge; canonical observation does. A stale/disconnected observation is unavailable even if its last retained entries were VALID.

## Verification status

Current deterministic regression coverage (executed, not inherited):

| Required boundary | Proof |
| --- | --- |
| Reviewed matching source is VALID | Host prepare remains ephemeral; exact confirm persists; stable ID on re-review |
| Changed source is STALE | Canonical projection withholds statement after content change |
| Same-byte recreation is not VALID | Delete/recreate preserves old reviewed digest but changes generation |
| Missing/unreadable source is not VALID | Missing, mode-zero, symlink and hardlink cases |
| Stale facts are not current worker context | Actual SDK provider receives no stale/forged request fact; preflight/tool-turn races stop before provider use |
| Protected/secret sources refused | Local protected paths, traversal/external paths, transcript paths, known credential content/statement |
| Legacy state compatible | No facts required; inspection preserves original bytes |
| Fake callers cannot mint freshness | Strict input schemas; issued preview identity/expiry/replay fences; final canonical registry validation |
| Facts do not bypass authority | Malicious advisory statement cannot write protected state or complete Kernel; real registered-check and C08 fresh-browser negative scenarios remain independent |

The dedicated Runtime suite has 9 passing tests; the SDK boundary suite has 4 passing tests. The production cross-boundary scenario exercises real transport, durable state, source mutation, identical recreation, and Chromium fresh verification. New App regressions cover explicit denial/confirmation, ACK versus canonical validity, STALE content withholding, and disconnect/draft invalidation across a pending modal.

## Post-integration actual UI proof — 2026-09-22

The rebuilt App and Runtime were relaunched against the same isolated disposable project. Project panel prepare displayed `REVIEW REQUIRED · NOT SAVED`, with no durable facts and zero provider requests. The explicit modal presented exact project/source/digest/statement plus the advisory/sensitive-content warning. Confirm created fact `74388c50-b59b-410c-bf3c-88b267e33d96` and canonical VALID. Changing `src/status.txt` produced visible STALE with its statement withheld. Deleting/recreating `Ready\n` and reloading the panel retained STALE; there was no silent revalidation. Screenshots confirmed modal, VALID, STALE and canonical run results.

- Stale-context run `600307aa-d241-4e72-bfa1-ab180bf34241`: actual UI goal → edited AC → refreshed preview → confirmation → COMPLETED, two real registered-check PASS results, independent SDK Reviewer PASS, no active workers and released writer. Both captured provider requests had `projectFacts: []`. Provider calls remained zero through preview.
- Explicit re-review preserved the same fact ID with a new timestamp. Valid-context run `56de66b2-7768-48cc-883a-89c686775958`: both independent worker requests contained that one Runtime-issued VALID fact; READ_ONLY/R0, registered checks and review remained unchanged; Kernel COMPLETED with two check PASS results.
- After committing Broken in the disposable fixture, run `ac7fc70d-7a46-456e-8c4c-c0a9b299d8c8` became BLOCKED with real SELF_CHECK FAIL, no Reviewer verdict and no completion. Its Developer request had no facts. UI showed BLOCKED and released writer.

All five post-integration provider responses were deterministic `c09-local/fixture` **faux** responses; paid inference was zero. Filesystem checks, SDK sessions, stdio, App interactions and Kernel transitions were actual. Native/mobile/other OS/provider combinations and real model reasoning quality remain unverified. First-use friction above is intentionally not expanded into this implementation.

## Current complete validation

- `node scripts/validate.mjs pi`: **ALL GATES PASS** (514.39 s). Includes `check`, `check:ci`, shrinkwrap/install-lock checks, product-independence tests, all workspace `npm test`, isolated `bash test.sh` replay, launcher syntax and whitespace. Current company-runtime result: 57 files / 1,506 tests PASS. Current coding-agent result: 279 files / 2,749 tests PASS, with existing 6 files / 50 tests skipped by their environment gates. Provider/platform skips are not paid-inference evidence.
- `node scripts/validate.mjs t3`: **ALL GATES PASS** (453.05 s): all workspaces, focused contracts/server/client/web control regressions, typecheck, lint, formatting, knip and source builds. Existing optional-platform/build warnings were not suppressed.
- `node scripts/run-cross-boundary.mjs` with actual isolated Chromium: **PASS** on the final source candidate (10.74 s), including reviewed Facts and unchanged C08 fresh-verification boundaries.
- Runtime `npm run build`, final `npm run check:ci`, immutable import verification, consolidation/archive and staged-lock regressions, model-catalog tooling and `git diff --check`: **PASS**. Build outputs and lockfiles introduced no tracked source drift.
- The full-gate model-registry failures caused by a retired external catalog ID were repaired with explicit typed fixture models, not by changing production model selection or skipping tests. Detailed chronology is in the root [work log](../WORK_LOG.md).

Disposable smoke projects, homes, helper scripts and owned App/provider processes were removed after proof. No new skipped test, automatic repair, source-repository synchronization, package/namespace migration or out-of-scope workflow was introduced. PR targets `devlop` and remains subject to review; this document does not claim merge or milestone closure.
