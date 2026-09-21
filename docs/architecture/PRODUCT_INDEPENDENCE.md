# Weavra Product Independence — Phase 1

## Status and scope

Phase 0 source audit completed against `8447f9843e0b2d468554e0062abbe6b98a81ba13` on 2026-09-21. Implementation and validation are tracked separately in the root [work log](../WORK_LOG.md). This document defines the product boundary; it does not turn an unexecuted check into PASS.

Development takes place on `feat/product-independence-phase1` in an isolated worktree. `devlop` is an integration branch receiving reviewed, verified PRs, not implementation commits. The PR targets `devlop` and must remain open for the user's merge decision. Source repositories `kjg8619/pi` and `kjg8619/t3code` are historical provenance, never update or synchronization authorities.

## Product identity and lineage

| Concept | Authority |
| --- | --- |
| Product name | Weavra |
| Canonical agent CLI | `weavra` |
| Host/server-only executable | `weavra-server`; not a competing agent CLI |
| Product source | <https://github.com/kjg8619/Weavra> |
| Runtime implementation lineage | Pi-derived implementation under `runtime/pi` |
| App implementation lineage | T3 Code-derived implementation under `app/t3code` |
| Internal namespaces | `@earendil-works/*`, `@t3tools/*` retained |
| Build roots | npm Runtime and pnpm 11 / Vite+ App remain independent |

“Derived from Pi/T3 Code” is historical attribution. It does not authorize behaving as the original product, contacting its hosted services, publishing to its package coordinates, or following its release feed. No blanket string replacement is appropriate: provider identities, mathematical π, protocol markers, copyrights, fixtures and package imports have different meanings.

## Canonical CLI

`weavra --help`, `--version`, `setup`, `doctor`, `update`, `config`, `install`, `remove`, and `list` belong to Weavra. The launcher resolves its own source checkout and executes that checkout's built runtime with the company-runtime extension. It never selects a global Pi binary from PATH.

Self-update and extension management are distinct. Source-build self-update explains that Weavra self-update is not configured and points to the Weavra source checkout. Installing, removing, listing and configuring explicitly selected extensions remain available; this is not permission to install the original runtime as a Weavra update. `setup` retains explicit, per-file legacy configuration import consent and does not import sessions automatically.

## Product version semantics

| Version | Meaning |
| --- | --- |
| `Weavra development` | User-facing product identity; no assigned public release version |
| `0.0.0` for native bundles; `0.0.0-dev` where required by development packaging | Numeric/semver sentinels, not announced releases; visible product version remains `development` |
| Pi-derived package version | Internal package/build provenance; not Weavra's release version |
| T3-derived package version | Internal package/build provenance; not Weavra's release version |
| Host Bridge / Host Control versions | Existing wire compatibility contracts |
| Session / database / launcher schema versions | Existing persisted or transport compatibility contracts |
| C08, C09/V0.6D and other milestones | Development scope, not package or product semver |

No arbitrary Weavra 1.0 release is declared. Build/provenance evidence must continue recording actual internal package versions. Display branding must not rewrite that evidence or silently change protocol version semantics.

## Config and home authority

- Canonical Runtime state is `~/.weavra/agent`, under `WEAVRA_HOME` when explicitly configured.
- Canonical agent/session controls are `WEAVRA_CODING_AGENT_DIR` and `WEAVRA_CODING_AGENT_SESSION_DIR`; launcher-owned validation and isolation take precedence over inherited Pi environment.
- App state uses a separate `app` directory under the Weavra home, with `WEAVRA_APP_HOME` as its explicit override. It must not reuse an upstream App database or cloud credential profile by default.
- Electron has an independent Weavra userData/OS identity. Changing a window title alone does not isolate credentials, service workers or authentication state.
- Explicit `--session`, `--session-dir` and explicitly imported settings retain their existing documented precedence. No wholesale state/session migration is performed.
- `.pi` project-local resource/settings discovery is retained as a compatibility format for this phase. It is not a fallback to `~/.pi/agent`.
- Legacy configuration import is read-only discovery followed by explicit affirmative consent for each supported file. Existing destinations are never overwritten; symlink, permissions and overlapping-home protections remain.
- Runtime profiling uses the same canonical agent override: `--isolated-agent-dir` must not load ambient settings/auth/extensions; `--agent-dir` selects only the explicitly requested profile. The retired Pi agent-home variable is not a profiler isolation control.

### Compatibility shims and retained identifiers

Compatibility does not restore inherited product authority. Retained internal families include `piConfig`, extension `pi` metadata/API variables, Pi-derived package coordinates, `pi-messages` and existing relay/RPC protocol names, `t3.json`, private workspace filters, native module/ABI names, and versioned storage schemas. `T3_WEAVRA_EXECUTABLE` / `T3_WEAVRA_CONTROL` remain trusted Host integration controls.

| Control / retained name | Product meaning |
| --- | --- |
| `WEAVRA_HOME` | Runtime-owned validated home; launcher always selects its `agent` child |
| `WEAVRA_CODING_AGENT_DIR`, `WEAVRA_CODING_AGENT_SESSION_DIR` | Direct Runtime/SDK controls; the canonical launcher owns agent selection and clears inherited session environment, preserving explicit session argv |
| `WEAVRA_PACKAGE_DIR` | Explicit package/assets location; `PI_PACKAGE_DIR` no longer selects product metadata |
| `PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR` | Not a normal home fallback; ignored/cleared by the canonical launcher |
| `WEAVRA_APP_HOME` | Explicit App-state override, preceding explicit legacy `T3CODE_HOME` |
| `T3CODE_HOME` | Explicit App compatibility override only; never implicit `~/.t3` discovery |
| `WEAVRA_RADIUS_GATEWAY`, legacy `PI_RADIUS_GATEWAY` | Explicit custom relay gateway only, with explicit token/token-file; stored provider credentials alone never activate relay hosting |
| `PI_OFFLINE`, provider/TUI/eval controls | Retained internal compatibility controls, not vendor/update authority |
| `T3_WEAVRA_EXECUTABLE`, `T3_WEAVRA_CONTROL` | Existing trusted Host launch/control configuration; no protocol rename |

Inherited updater/installer/telemetry switches must never turn Pi/T3 product services back on. A legacy identifier's presence is not itself permission to contact a legacy service.

## Update and release policy

No Weavra hosted updater, public release pipeline, installer authority, mobile OTA tenant or share backend has been established. Those capabilities are unavailable, not redirected to fictitious Weavra endpoints or inherited Pi/T3 hosting.

The boundary covers all entrypoints, not only visible buttons:

- Runtime startup version checks, bare/self/all/managed update variants and Windows self-update machinery.
- Desktop startup polling, manual menu/IPC actions, channel changes, remote check/download/prepare/commit and server-to-desktop update control.
- Server CLI, cloud self-update, boot-service staging, exact-version downloads and SSH remote provisioning.
- Mobile native Expo startup checks plus JavaScript launch, foreground and manual OTA checks.
- Web update banners, manual command recommendations and release-history links.
- Marketing release discovery, installer scripts, app-store CTAs and local release/publish tools.

Local artifact builds, package lock validation, explicit user extension installs and provider tooling are not a hosted product release. Nested `.github/workflows` remain inactive historical source files; only root workflows run as Weavra CI. They must not be promoted into a release pipeline implicitly.

Every declared Runtime workspace and the internally named App server package is private. The twelve Runtime product packages, including the nested SQLite backend, plus the root and App server publication entrypoints also invoke the existing unavailable-publication lifecycle before build or registry work. Source-only extension examples retain their existing private manifests. Internal coordinates remain unchanged; local packing/building is still allowed. Deliberately bypassing lifecycle scripts with `npm --ignore-scripts` still ends in `EPRIVATE`, but npm itself can probe registry metadata before that error. Such an explicit external-client bypass is not a promise of zero metadata requests; the regression intercepts those probes before connection and verifies no publication request.

Publication privacy must not exempt code from validation. Runtime dependency checks, local consumer packing and internal lockstep version checks select buildable library entrypoints, independently of `private`. The current artifact family contains ten packages. Source-only extension examples are not SDK artifacts merely because they declare a no-op/typecheck build script; their independent versions remain intact. Publication regression discovery follows every declared workspace glob, including nested workspaces and examples.

## Sharing and telemetry policy

Remote session sharing is unavailable without independent infrastructure. `/share` must not upload to Radius or GitHub gists and then present a Pi-owned viewer as Weavra. Local transcript/HTML export remains distinct and supported where already implemented.

Local runtime spans, resource measurements and passive telemetry libraries remain. They do not grant registration, verification or completion authority. Remote product analytics must not use the original Pi install reporter or the embedded T3 PostHog project, including when imported settings or legacy environment enable analytics. Credentials, session transcripts and browser-private data are not product analytics payloads.

The retired hosted `connect` CLI, provider-account analytics identifier, and headless relay tracing layer are removed, not retained as dormant compatibility APIs. Local diagnostics and explicit third-party provider authentication remain separate.

Provider/model API traffic is a separate category. Preserve real provider protocol requirements, explicit custom endpoints and consumer-supplied headers; change product attribution, not undocumented provider compatibility assumptions. Operator-configured third-party observability must be explicit and must not inherit an original product tenant.

## Hosted-service dependency map

These are **audited baseline dependencies**, not a claim that each one made a request during this session. The distinction between automatic, configured and action-driven paths matters.

| Baseline dependency | Trigger / authority | Independence policy |
| --- | --- | --- |
| `pi.dev/api/latest-version` | Interactive version check and self-update planning; response may select package/version | No product version request or updater authority |
| `pi.dev/api/installer/releases/...` | Managed updater downloads executable dependency manifests | Unavailable source-build self-update |
| `earendil-works/pi` releases / Pi npm package | Suggested binary/global self-update authority | Never a Weavra update source |
| `pi.dev/api/report-install` | First-install/changelog path; baseline default enabled | Remote product analytics disabled |
| `pi.dev/api/models/providers/...` | Startup/model-picker/RPC catalog refresh and persisted overlay | Bundled or explicitly configured provider metadata, no implicit vendor overlay |
| `radius.pi.dev` config/auth/relay | Built-in catalog and experimental relay; stored credentials can activate it | No implicit tenant; explicit independently configured provider compatibility is separate |
| Radius artifacts / GitHub gist / `pi.dev/session` | `/share` uploads session contents and selects hosted viewer | Remote share unavailable; local export retained |
| T3 GitHub releases/manifests | Desktop, CLI, boot service, SSH provisioning, web/marketing | No inherited update or download authority |
| `raw.githubusercontent.com/pingdotgg/t3code/.../model-manifest.json` | Provider metadata refresh and authoritative cache | Bundled source metadata, no inherited remote/cache overlay |
| `us.i.posthog.com` with embedded project key | Server boot/client/provider events; baseline default enabled | No inherited project analytics transport |
| `clerk.t3.codes` | Live example key, desktop bridge, configured web/mobile auth | No implicit original tenant activation |
| `relay.t3.codes`, `app.t3.codes` | Managed links, OAuth entry, pairing and saved-link restoration | Hosted product capability unavailable; direct/local connection separate |
| Expo project `d763fcb8-d37c-41ea-a773-b54a0ab4a454` | Native ON_LOAD plus JS launch/foreground/manual OTA | No inherited OTA or EAS project authority |
| Original Apple/Google stores, Apple team and associated domains | Build/submission metadata and marketing links | No inherited app ownership or store release claims |
| Original T3 terms/security/support/testimonials | Active marketing routes and contact links | Preserve provenance, never relabel inherited obligations or endorsements |
| Clerk, Cloudflare, PlanetScale, Axiom, APNs, FCM libraries | Potential operator-deployed managed hosting | Libraries are not tenants; new hosted architecture deferred |

Third-party dependencies that are not Pi/T3 product authority include provider APIs/OAuth, explicitly selected npm/Git extension sources, GitHub-hosted fd/rg or cloudflared helper downloads, and user-selected SSH/Tailscale/direct endpoints. Their presence prevents a blanket “the product never uses the network” claim. Verification must report provider/helper traffic separately from product-vendor traffic.

The isolated live App smoke specifically observed provider-tool version requests to `registry.npmjs.org/@openai/codex/latest`, VCS authentication probes to `api.bitbucket.org/2.0/user`, and pricing metadata from `raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json`. These third-party paths remain distinct from Pi/T3 product hosting. They were intercepted before connection, not silently omitted from the network report. Renderer guard probes and package-manager bootstrap traffic belong to the verification harness, not product startup evidence.

The server retains authenticated local link-metadata reads, local publication preferences and owner-authorized unlink. Stored connector configuration never implies an active tunnel. Hosted link proofs, relay enrollment, credential minting and hosted health endpoints return the existing typed `EnvironmentCloudEndpointUnavailableError` (HTTP 503), including retained legacy protocol paths; they do not acquire account tokens or start a connector. Explicit local unlink removes owned link/OAuth credentials while retaining direct pairing. The retired product OAuth manager, interactive login pages and startup/shutdown hosted reconciliation are removed, not left as dormant credential-reuse paths.

Mobile startup revokes inherited in-memory relay authority and clears owned push-registration records and local agent notification/Live Activity artifacts. It does not obtain APNs/FCM tokens or enroll with a hosted relay. System notification permission/settings, local Live Activity opt-out and ordinary notification navigation remain distinct from unavailable remote delivery. The obsolete enrollment, relinking and prompt-triggered Live Activity registration pipeline is removed.

## Phase 0 occurrence classification

The audit searched both source trees and root scripts/docs/CI for `Pi`, `π`, `pi.dev`, `earendil-works`, `@earendil-works`, `PI_`, `.pi`, `pi-coding-agent`, `T3`, `T3 Code`, `t3code`, `pingdotgg`, `@t3tools`, and `T3_`. Overlapping occurrences are classified by their executable or documentary role, not blindly by substring. Generated outputs mirror source and are rebuilt, not independently rewritten.

| Class | Occurrence families | Treatment |
| --- | --- | --- |
| A — user-visible identity | CLI usage/header/version, desktop/window/about, web splash/wordmarks/settings, mobile/native labels, active marketing | Weavra product identity; provider names are not product names |
| B — runtime/distribution authority | Updaters, installers, release scripts, package selection, model manifests, remote triage instructions, OS app identifiers | Detach original authority; unavailable when no independent replacement exists |
| C — external endpoints | Catalog/version/install/share/analytics/auth/relay/OTA/release services and live installer/store links | Classify trigger and tenant; remove implicit original product connection |
| D — config/state ownership | Global homes, Electron profiles, environment precedence, session paths, service/SSH state, project formats | Weavra default ownership; explicit bounded compatibility, no bulk migration |
| E — internal package identity | Namespaces/imports, Effect service tags, source paths, native ABI/module names, internal protocol/storage keys | Retain unless the exact occurrence controls external authority |
| F — provenance/license/history | LICENSE/NOTICE, authors/copyright, original changelogs/worklogs, immutable import manifests, vendored notices | Preserve unchanged; no historical result relabeled as current verification |
| G — test/fixture/example | Arbitrary repository URLs, migration fixtures, sample project names, mocked paths and old protocol payloads | Preserve arbitrary data; change tests only when the observable contract changes |
| H — third-party context | Provider names/endpoints, mathematical π, vendored references, licensed fonts/logos, helper releases | Preserve legitimate third-party semantics; document network distinction |

High-risk Runtime ownership files include `config.ts`, `main.ts`, `package-manager-cli.ts`, `interactive-mode.ts`, `version-check.ts`, `session-share.ts`, `model-runtime.ts`, `remote-catalog-provider.ts`, `provider-attribution.ts`, both user-agent helpers, experimental Radius startup, and company-runtime launcher/home/control. High-risk App files include Electron/Desktop update services, server `selfUpdate`/`pinnedRuntime`/CLI update, shared `cliRelease`, SSH provisioning, `AnalyticsService`, `ModelManifest`, Clerk/public configuration, native/JS mobile updates, and active marketing/release scripts. An import-only namespace match or a fixture URL is not an endpoint escape.

Root audit: source manifests and migration records are F; package-root/task-filter/stdio environment names in validation scripts are D/E; production-transport smoke fixture labels are G/E. Root CI retains separate npm and pnpm roots and immutable-import checks. `scripts/verify-imports.mjs` verifies historical import commits, not current product behavior.

The optional Pi source-project history dialog retains the original announcement artwork and link as F provenance. It explicitly identifies Weavra as independently maintained and does not present the original announcement as current Weavra ownership or release authority.

## Preserved authority and provenance

`runtime/pi/LICENSE`, `app/t3code/LICENSE`, root `NOTICE.md`, nested notices and immutable migration baseline records retain original attribution. No new root license is selected.

C08 remains CLOSED in its existing bounded scope:

1. Browser/Jev produces observations only; candidates are `CANDIDATE_ONLY`.
2. Runtime/Host registers reviewed checks. Registration is not verification.
3. RegisteredVerifier uses new isolated browser captures for self-check and test.
4. Candidate evidence cannot substitute for fresh verification.
5. Kernel alone controls completion.

No browser repair/action loop, authenticated personal browser integration, arbitrary remote crawling or C09/V0.6D work is included.

## Deferred work

- `@earendil-works/*` and `@t3tools/*` namespace migration.
- `runtime/pi` and `app/t3code` directory renaming.
- Project-local `.pi` / `t3.json` format migration and broad persisted-key migration.
- Weavra public release pipeline, hosted updater, signed distribution and app-store publication.
- Weavra session-share infrastructure.
- New Clerk/Expo/relay/observability/push tenants or hosted service architecture.
- New legal operator terms, inherited testimonial adoption or marketing claims.

## Verification contract

Evidence must include actual `weavra --help`, `--version`, `update`, `setup`, `doctor`; deterministic interception/mocking of startup/update/share destinations; behavioral Runtime/App regressions; full independent build/quality gates; real consolidated stdio/C08 fresh-capture smoke; exact PR CI; unchanged provenance; and final clean/tracking/remote equality. Native mobile execution must be distinguished from configuration/JavaScript testing when no native runtime is exercised.

### User-approved icon deferral and device evidence limits

On 2026-09-21, the user explicitly deferred icon work (“아이콘은 나중에 하자”). Native icon export and replacement of inherited raster marks are therefore excluded from this delivery's acceptance gate, not falsely marked as visually complete. The W source artwork and Android adaptive/notification marks are migrated; macOS/iOS/universal/Windows exports, favicon derivatives and marketing raster icons remain follow-up work. Current marketing download/footer screenshots still show the inherited T3 raster mark. The existing Icon Composer 2+ export pipeline remains authoritative; no substitute renderer or automatic repair is introduced.

Mobile configuration and JavaScript tests do not substitute for native-device screenshots. The available workstation has no usable iOS simulator or Android emulator command; Expo production/development/preview configuration can still be exercised offline to verify names, bundle IDs, schemes and disabled OTA authority. Do not record an unperformed native launch as PASS.

Only the validated, user-approved scope is pushed. The PR must disclose the deferred icon work and remaining visual marks, target `devlop`, and remain OPEN for the user's merge decision. No direct implementation commit or automatic merge is allowed on `devlop` or `main`.
