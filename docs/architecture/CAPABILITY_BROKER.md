# Capability Broker — V0.7A design contract

## 1. Status, baseline, and decision

**Design proposal for review; not an implemented or verified Broker.** Issue [#11](https://github.com/kjg8619/Weavra/issues/11) is the single prerequisite for [Runtime #12](https://github.com/kjg8619/Weavra/issues/12) and [App #13](https://github.com/kjg8619/Weavra/issues/13). The interfaces below are the proposed freeze; implementation starts only after design approval. [#14](https://github.com/kjg8619/Weavra/issues/14) verifies the combined result. [#23](https://github.com/kjg8619/Weavra/issues/23) places this after the completed #6–#10 sequence, before COMPLEX and Parallel.

- Source baseline: `kjg8619/Weavra`, `7dd8c96042a28ead786cec9b3fa0763119edd139` on `devlop`; design branch `design/v0.7a-capability-broker`.
- Audit reads current consolidated Runtime/App source, selected existing test bodies, root rules/README, [boundaries](BOUNDARIES.md), [project facts](PROJECT_FACTS.md), [product independence](PRODUCT_INDEPENDENCE.md), [hosted-service audit](HOSTED_SERVICE_DEPENDENCIES.md), and both #11 comments. Historical source repositories are provenance only. The hosted-service audit's older baseline and past PASS statements are not current verification.
- Add **Runtime-owned, ephemeral, bounded descriptive inventory**. Project it through an optional `HostControlState.capabilityInventory` on the existing `control.snapshot` response. No new command, RPC, worker discovery tool, execution API, persistence format, or shared cross-root package.
- Initial coverage is exactly the ten existing Runtime file/LSP action-tool definitions listed below. This is a coverage choice, not a claim to enumerate every installed resource. No App MCP ingestion, external MCP discovery, outer extension/skill loading, provider initialization, credential inspection, or remote probing.
- The initial App surface is inspection-only for users already entitled to the **opt-in control observation** route. `weavra.controlObserve` currently requires `orchestration:operate`; this design does **not** lower it to `orchestration:read`. Read-scope-only users keep the existing ordinary observer and see this inventory as unavailable. “Read-only UI” does not imply acquisition of control ownership is authorized for read-only principals.

## 2. Current surfaces: similar names, different authority

Paths in the evidence index refer to the fixed baseline above. Findings are source observations, not newly executed tests.

| Surface | Existing meaning and owner | Classification; not equivalent to Broker |
| --- | --- | --- |
| Host Control `HostControlCapabilities` | Runtime/Kernel identity, owner, exact 11-command tuple, protocol v1, bounds, local readiness, Runtime version, recipes [R1–R2] | **Transport declaration.** `READY` is not model authentication, tool eligibility, or run readiness. Command advertisement is not consent. |
| `RegisteredActionTool` / `PolicyContext.tools` | Trusted `{id, operation}` registrations built by `PiAgentExecutor`; fixed run/mode/config/scope [R3–R5] | **Authority-bearing registration input**, necessary but insufficient. Not the complete SDK tool list. |
| Worker `ToolDefinition` list | Host creates role/mode-specific tools, binds exact effects, explicitly activates only these [R4–R5] | **Execution surface.** Broker must never construct this list or become its source of registration. |
| Policy / Approval / dispatch | Path inspection, risk floors, run/role/mode binding, durable intent, reinspection, one-action R3 approval, audit [R3–R5] | **Contextual authorization and execution authority.** A successful lookup does not enter this chain. |
| LSP configuration/status/results | Explicit configured servers; lazy run-owned processes; four read operations; local executable inspection differs from negotiated method support [R6] | Configuration is **operator intent**; status/results are **observations/advisory**. Enabled, locally resolvable, initialized, and method-supported are distinct. LSP `AVAILABLE` is not verification PASS. |
| Registered checks / browser candidates | RegisteredVerifier owns exact command execution; Runtime/Host registers browser checks; fresh captures feed Kernel [R7] | Separate **verification registration/evidence**. Candidate is `CANDIDATE_ONLY`. Neither ordinary tool metadata nor Broker can turn a candidate into PASS/COMPLETE. |
| App `/mcp` toolkits | Fixed Preview (14), Device (4), PullRequests (3) advertisements; authenticated bearer sessions and handler-specific grants [A1–A2] | **Descriptive advertisement** plus a separate App invocation authority. This is an MCP server, not discovery of external MCP servers. No Runtime worker registry import. |
| MCP annotations | `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` [A1] | **Advisory behavior hints**, not permissions, availability, isolation, safe-to-probe guarantees, or Runtime evidence. For example snapshot save can write an artifact; device listing refreshes hosts. |
| Provider/model metadata | Bundled or supplied-runtime catalog identities, input/reasoning/context limits; configured coding/reasoning profiles [R8] | **Support metadata**, not auth/health/fitness. Cached availability is not a fresh credential check; ModelRuntime construction/refresh can read credentials. No existing provider inventory port on HostControlBridge. |
| Outer extensions/skills, instructions/facts/context | Outer Pi resources differ from worker resources; facts/context are bounded advisory input [R5, R9] | Extension tool registration is scoped to that outer runtime. Plugin metadata, reviewed facts, or source provenance never grant worker permission. |
| Proposed Broker | Passive projection of existing Runtime action definitions and a bounded current-config observation | **Descriptive/discovery-only.** Not a universal capability authority, Policy cache, approval store, router, or plugin manager. |

Current worker isolation remains `extensions=[]`, `skills=[]`, `defaultTools=[]`, `enableSkillCommands=false`, Host-owned active tool names and sequential tool execution. The runner does not instantiate/reload the generic resource loader. No arbitrary MCP/skill/plugin/extension discovery, auto-install, provider fallback, catalog fetch on credential presence, or hidden background activation follows from this design. This is not an OS-sandbox claim.

## 3. Monotonic discovery invariant

> Discovery may reduce uncertainty. It MUST NOT mint, widen, or restore authority.

For a fixed trusted execution context `T`, action `a`, and arbitrary Broker state `B`:

```text
PolicyDecision(T, a, B) = PolicyDecision(T, a)
WorkerExposure(T, B)    = WorkerExposure(T)
ApprovalValidity(T, a, B) = ApprovalValidity(T, a)
KernelCompletion(T, B)  = KernelCompletion(T)
```

These are noninterference requirements, not new function signatures. Broker objects must not be accepted as `PolicyContext`, `RegisteredActionTool[]`, approval, check evidence, or a Kernel transition input. Discovery itself has zero action-executor, tool-installation, provider/auth-refresh, LSP-start/query, and Kernel-transition effects. Its only state changes are its own in-memory observation generation and the existing observation cache.

Later execution always starts through existing trusted Host registration and a **fresh invocation-specific** contract/Policy/Approval/dispatch check. Re-resolve the actual binding and current prerequisites there; a stored Broker entry, fingerprint, timestamp, or `AVAILABLE` cannot replace them. #12 adds no execution integration. A future Broker-selection execution feature needs a separate reviewed contract, not an implicit lookup-to-dispatch shortcut.

Mechanically test in #12/#14: vary/forge/omit all Broker metadata while holding `T,a` fixed; compare Policy decisions, exposed names and observable effects. Exercise READ_ONLY mutation and R2/R3 denial paths with a Broker `AVAILABLE` result, then verify no unauthorized filesystem effect, consent consumption, verification PASS, or completion. Also exercise an already permitted ordinary action without inventory: absence must neither grant nor revoke independent existing authority.

## 4. Identity, observations, and authority stay separate

### 4.1 Initial catalog

The registry is one private instance per `HostControlBridge`/pinned project root. It is not global, durable, shared across projects, or stored in `.ai/state.json`. Runtime owns construction and atomic replacement; no worker/App/public registration API exists.

| Actual tool names | Operation | Descriptive requirement |
| --- | --- | --- |
| `runtime_read`, `runtime_search`, `runtime_list_files` | read / search / list respectively | Host exposure and per-action Policy; either execution mode may support reads |
| `runtime_write`, `runtime_edit` | write / edit | EDIT only; actual risk/scope assessed per action, including R2 |
| `runtime_delete` | delete | EDIT plus the existing narrow R3 path and exact one-use approval |
| `runtime_lsp_diagnostics`, `runtime_lsp_definition`, `runtime_lsp_references`, `runtime_lsp_symbols` | read | Explicit LSP configuration, actual run-owned port, per-action Policy; remote method support not inferred |

A catalog entry says the adapter definition exists, not that this role/run received it. In particular R3 delete appears descriptively even when no R3 run exists. `runtime_request_check`, `submit_handoff`, and `submit_review` are intentionally outside `RUNTIME_ACTION_TOOLS` coverage: they are separate request/submission contracts, not ordinary `RegisteredActionTool` actions. Registered checks, recipes, App MCP, models, skills, and extensions also remain outside this initial catalog. The UI must show the coverage label, not “all available tools.”

### 4.2 Exact proposed wire types

These names/fields are normative for #12/#13. Runtime owns its TypeScript/TypeBox representation; App independently implements equivalent Effect schemas. `readonly` is an implementation ownership requirement; it does not add JSON fields. Objects are closed; all listed fields are required except the single outer optional field.

```ts
type CapabilityAvailability = "UNKNOWN" | "NEEDS_REFRESH" | "AVAILABLE" | "UNAVAILABLE";
type CapabilityOperation = "read" | "search" | "list" | "write" | "edit" | "delete";
type CapabilityReason =
  | "DEFINITION_PRESENT"
  | "LSP_DISABLED"
  | "LSP_NOT_OBSERVED"
  | "CONFIG_UNAVAILABLE"
  | "SOURCE_CHANGED";

type CapabilityDescriptor = Readonly<{
  id: string;                     // "weavra.worker." + actual tool name
  kind: "worker-tool";
  name: string;                   // actual runtime_* name, not free-form provider text
  origin: "weavra-runtime";
  transport: "in-process";         // worker adapter binding, NOT underlying LSP transport
  schemaDigest: string;           // sha256 of current adapter parameter schema
  fingerprint: string;            // descriptor + requirement metadata; see §4.3
  source: "runtime-static";
}>;

type CapabilityRequirements = Readonly<{
  operation: CapabilityOperation;
  mode: "READ_OR_EDIT" | "EDIT_ONLY";
  policy: "PER_ACTION";
  approval: "RUNTIME_DECIDES" | "EXACT_R3_ACTION";
}>;

type CapabilityObservation = Readonly<{
  availability: CapabilityAvailability;
  reason: CapabilityReason;
  source: "runtime-static" | "operator-config";
  observedAt: number | null;      // Host Unix milliseconds; observation, not a lease
}>;

type CapabilityEntry = Readonly<{
  descriptor: CapabilityDescriptor;
  requirements: CapabilityRequirements; // explanation, never current eligibility
  observation: CapabilityObservation;
}>;

type CapabilityInventory = Readonly<{
  schemaVersion: 1;
  coverage: "RUNTIME_ACTION_TOOLS";
  ownerId: string;
  projectRevision: number;
  brokerEpoch: string;            // fresh UUID on registry creation/recreation
  generation: number;             // monotonic within epoch, including failed refreshes
  status: "CURRENT" | "NEEDS_REFRESH" | "UNKNOWN";
  reason: "OBSERVED" | "SOURCE_CHANGED" | "CONFIG_UNAVAILABLE" | "INVALID_REGISTRY";
  observedAt: number | null;
  entries: readonly CapabilityEntry[];
  total: number | null;           // matching rows before result truncation; null if unknown
  omitted: number;                // total - entries.length when total is known
}>;

// Sole wire extension; existing fields, commands and version remain unchanged.
interface HostControlState {
  capabilityInventory?: CapabilityInventory;
}
```

No `enabled`, `advertised`, `policyEligible`, `approved`, `executable`, action/run approval token, executable callback, or dynamic `permissions` object is accepted. Presence already expresses catalog advertisement. Availability is an observation. `requirements` describes fixed constraints; it is neither a frozen run contract nor an assessed risk/authorization result. App displays “Runtime checks per action,” not an allow/deny computed from these fields.

A provider ID or negotiated protocol version is **not** added to this initial descriptor: every represented binding is an in-process Runtime worker adapter, and the existing LSP public status port does not expose negotiated method/protocol support. Host Control protocol v1 and Broker schema v1 are separate. Provider IDs, remote transports, plugin origin strings, or a new kind require a design/schema revision, not arbitrary values in today's closed fields. The underlying configured LSP server identity/config is private refresh input, not a claim that its protocol was negotiated.

### 4.3 Identity, fingerprints, bounds, provenance

- Logical identity is `(origin, id)`; `id` is globally unique within the registry. Same ID twice is rejected **even if identical**; same ID with a different origin is not a second valid entry. No first-wins/last-wins/merge behavior. Entire malformed replacement fails closed.
- `name` is 1–64 ASCII `[a-z0-9_]+`; `id` is exactly `weavra.worker.${name}` and at most 96 characters. Only the ten names/operations in §4.1 are accepted in schema v1. No alias resolution, case folding or fuzzy match.
- `schemaDigest` uses the existing adapter's JSON parameter schema, not an invented semantic tool version. #12 extracts/reuses pure schema declarations where necessary; it must not instantiate a worker, duplicate divergent schemas, or run a tool to obtain them. Config-dependent schema selection uses the same validated configuration as the observation.
- Both digests are `sha256:` plus 64 lowercase hex. Canonical JSON recursively sorts object keys by ASCII code-unit order, preserves array order, and permits only JSON values (finite numbers; no undefined/functions/symbols/cycles). Hash UTF-8 bytes. `fingerprint` hashes `{descriptor: descriptorWithoutFingerprint, requirements}`. It excludes timestamps, epoch/generation and availability. It is a change detector, **not a signature, trust upgrade, credential hash, or execution ticket**.
- `source=runtime-static` covers every descriptor field and the fixed requirements. Observation provenance is `runtime-static` for file definition presence; `operator-config` for LSP configuration state. Operator-config means parsed local input, not operator approval of an action. No arbitrary per-field source map or free-form diagnostic text is needed.
- Epoch is a lowercase canonical UUID; owner IDs follow the existing Host identifier restriction (1–128 `[A-Za-z0-9._:-]+`). Counters/times are nonnegative safe integers; generation starts at 0, successful or failed publication increments it, and exhaustion creates a new epoch rather than wrapping. Generation 0 alone has null observedAt. Every completed refresh publication, including CONFIG_UNAVAILABLE, SOURCE_CHANGED and INVALID_REGISTRY, has generation ≥1 and its own Host timestamp sampled at publication. Never carry the previous generation's timestamp forward. Wall-clock timestamps need not increase; generation establishes ordering.
- Maximum registry size 32; list limit 1–32; inventory JSON at most **16,384 UTF-8 bytes**. The initial catalog has ten rows. Complete entries only: no truncated ID, digest, requirement, or provenance. ASCII ID order is deterministic, independent of locale/source registration order.
- Exclude raw config, paths/argv/env values, endpoint URLs/headers, credential existence/value/identifiers, auth objects, plugin payloads, model transcripts, prompts, private reasoning, document text, and raw error/stack text. Schema bodies stay Runtime-private; only their approved schema digest crosses. Private config freshness checks may retain bounded parsed data/digests in memory; never hash secrets into public fingerprints.
- Broker diagnostics are the fixed codes above plus the internal query codes below. No new durable audit/telemetry stream. Existing snapshot trace may record owner/epoch/generation/ID/code within its existing privacy policy; do not log entire private source objects. Policy rejection reasons remain in the existing action audit, not copied into descriptors.

## 5. Availability, generations, and invalidation

`AVAILABLE` means a current local file-tool definition is present for consideration, **not that an action can run**. LSP enabled alone never yields AVAILABLE: no local file/executable inspection establishes negotiated method support. This slice deliberately avoids LSP inspection/start/query and reports enabled LSP tools as UNKNOWN. Existing `/lsp status` remains the separate richer observation; no competing process registry is added.

| Input/transition | Required inventory result |
| --- | --- |
| New registry, before observation | generation 0, UNKNOWN / CONFIG_UNAVAILABLE, null time/total, empty entries |
| Valid current config + trusted static catalog | CURRENT / OBSERVED; file tools AVAILABLE / DEFINITION_PRESENT / runtime-static; LSP disabled → UNAVAILABLE / LSP_DISABLED / operator-config; LSP enabled → UNKNOWN / LSP_NOT_OBSERVED / operator-config |
| Configuration missing, invalid, unsafe or disappears | New generation UNKNOWN / CONFIG_UNAVAILABLE; empty entries, null total, omitted 0. Do not retain previously current rows as current. No config creation or repair. |
| Root/project revision/execution-owner/source changes while sampling | New generation NEEDS_REFRESH / SOURCE_CHANGED, empty entries, null total; existing Host root/revision failure rules still apply. No mixed snapshot. |
| Successful later refresh | New generation from complete current inputs; no status inherited from previous generation. All entry times equal inventory observedAt. |
| Descriptor schema/requirements/fingerprint changes | Atomic rebuild from trusted definitions; invalidate previous entry observation. Same identity does not preserve its old availability. New build/restart has a new epoch. |
| Tool removed from trusted catalog | Absent in next complete generation; exact query → NOT_FOUND. App removes it from current rows, never unions inventories. Retained old rows are historical/stale only. |
| Broker restart, even if Host owner remains | New epoch; generation restarts at 0. Previous observations invalid. No disk restore or last-good cache promotion. |
| Transport disconnect/reconnect or Host owner replacement | App marks retained inventory stale immediately; fresh hello alone is insufficient. Require a checked snapshot for the new connection/owner/epoch. No replayed commands or merged generations. |
| Same-epoch generation regression / same generation different payload | App rejects as inconsistent, marks observation unavailable/stale. Equal generation + identical payload may render but never refreshes its freshness clock. |
| Provider/origin/transport/protocol replacement | Not representable as accepted v1 registration. Reject forged/unsupported descriptor; never rebind an old ID to a new provider. A future expansion needs a revised contract and fresh observation. |
| Credential disappears/expires | No credential-backed entry exists in this catalog; file-definition AVAILABLE must not be described as provider availability. Broker neither reads nor restores credentials. Existing execution/auth revalidation can fail independently, with no fallback. |
| LSP executable/script/server disappears or disconnects | Enabled LSP was already UNKNOWN here; it cannot stay falsely AVAILABLE. Existing execution/status path resolves actual availability. Changed config invalidates the inventory observation; no automatic server launch. |

Runtime #12 refresh procedure: inside existing Host snapshot serialization, use the pinned root and validated current config; build a private candidate; re-read/compare the normalized complete config and root/project/execution ownership before publication. Config is not the frozen active-run Policy. An input mismatch yields NEEDS_REFRESH rather than a successful mixture. Reuse existing at-most-two Host snapshot coherence retries; do not add an unbounded retry/watch loop. A source can change immediately after observation; no filesystem-global atomicity or execution lease is claimed.

Every published refresh attempt advances generation, including failure, so an old CURRENT generation cannot reappear after an error. An invalid registry yields UNKNOWN / INVALID_REGISTRY, empty entries and null total; it does not repair a duplicate, keep a selected duplicate, or disable independently existing execution authority. `NEEDS_REFRESH` is not permission to probe an external service. A new snapshot is the only refresh mechanism in this slice.

## 6. Exact Runtime read API and transport budget

Proposed Runtime-local read interface (not a worker tool or wire command):

```ts
type CapabilityReadResult =
  | { readonly ok: true; readonly inventory: CapabilityInventory }
  | { readonly ok: false; readonly code: "INVALID_QUERY" | "NOT_FOUND" };

interface CapabilityRegistryReader {
  list(input: Readonly<{ limit: number }>): CapabilityReadResult;
  query(input: Readonly<{ id: string }>): CapabilityReadResult;
}
```

- Runtime owns a private constructor/publish path. Only trusted local metadata adapters supply complete candidate catalogs; Reader exposes no register/install/enable/approve/execute/refresh method. No input comes from App metadata, environment discovery, model arguments, or MCP advertisements.
- Calls are pure reads of one immutable published generation. They do not touch disk, refresh sources, advance generation, perform Policy evaluation, or spawn/network. Returned data cannot mutate stored state.
- Closed inputs: list has exactly integer `limit` 1–32; query exactly one canonical ID of at most 96 characters. Missing/extra fields, invalid IDs and invalid limits → INVALID_QUERY. No regex/glob/free-text/pagination/cursors or fallback selection. Query is exact ID lookup, not arbitrary search.
- List sorts by ASCII ID, sets total to matching count before count/byte truncation, and omitted to total minus emitted rows. Query returns one row or NOT_FOUND **only for CURRENT complete registry knowledge**. When the registry is UNKNOWN/NEEDS_REFRESH, either read returns that empty typed inventory, not a false absence. Query results keep the same scope/epoch/generation/time; total is 1 on a match.
- The registry input ceiling is checked before accepting/replacing the catalog; overflow or duplicate/invalid metadata → UNKNOWN / INVALID_REGISTRY. A truncated result is not a truncated underlying registry.
- Host `control.snapshot` calls list with limit 32 and projects the result. Reader validation failure in this fixed call is an internal invalid-registry observation, never a new execution path. Snapshot refresh failures use typed inventory outcomes; unrelated canonical Host failures keep existing Host errors.
- Full control response remains at most **65,536 UTF-8 bytes including LF**, with request maximum 32,768. Inventory has its own 16,384-byte ceiling and must also fit remaining serialized response budget. Drop whole inventory entries in reverse sorted order, updating omitted exactly. Never truncate existing previews, approval, evidence or canonical state to make inventory fit. If even the empty typed inventory/header cannot fit, retain existing `RESPONSE_TOO_LARGE`; do not claim success or silently turn omission into availability.
- No addition/reordering of `HOST_CONTROL_COMMANDS`, no handshake capability boolean, and no protocol-version bump. The existing generic `resultLimit=64` does not override the smaller Broker limits.

## 7. App consumption, freshness, and compatibility

Canonical path: Runtime registry → bounded `HostControlState.capabilityInventory` → strict `ControlTransport` decode → `RuntimeController.consistent` → existing `weavra.controlObserve` → project/environment/workspace-scoped client state → inspection view [A3–A5]. No Runtime source imports in App. Do not put the field on shared `HostSnapshotSummary`: that would also change the independent observer-only protocol.

#13 duplicates the exact closed schema and enforces byte/count/scalar/enum/semantic constraints, including name/ID/operation/mode/approval mapping, digest format, unique sorted IDs, valid availability/reason/source combinations, total/omitted arithmetic and owner/projectRevision equality with the enclosing state. CURRENT pairs only with OBSERVED, nonnull time/total and generation ≥1. NEEDS_REFRESH pairs only with SOURCE_CHANGED; UNKNOWN pairs only with CONFIG_UNAVAILABLE or INVALID_REGISTRY. Noncurrent inventory has empty entries, null total and omitted 0. Generation 0 is exactly the initial UNKNOWN/CONFIG_UNAVAILABLE/null-time form; every later generation has its own nonnull publication time. File rows use AVAILABLE/DEFINITION_PRESENT/runtime-static; LSP rows use the configured UNKNOWN or UNAVAILABLE pairs, with row times equal to inventory time. EDIT_ONLY applies to write/edit/delete; EXACT_R3_ACTION applies only to delete; other rows use READ_OR_EDIT and RUNTIME_DECIDES as applicable. No unknown metadata is forwarded as authority.

App presents actual name, Runtime origin, family (derived from the fixed name), availability/reason, requirements, observation time, scope/epoch/generation, coverage and omitted count. No install/register/enable/permission/approve/dispatch controls. No optimistic “enabled” badges; no mutation or Kernel transition derived from UI state. Existing workflow/approval controls remain separate and unchanged.

Fresh inventory requires all existing connected/nonstale/owner/project checks plus a checked new generation from the current subscription/connection. Add a **5-second local observation-age ceiling** for this inventory only, measured monotonically from receipt of a new checked generation; do not compare clocks across machines. Repeated cached/equal generations cannot extend it. The first emission of **every subscription** is a stale baseline only, even if it says CONNECTED/nonstale and has a generation unseen by this client: baseline `RuntimeController.observe` initially emits its server cache without forcing refresh. Promotion requires a subsequent checked snapshot with a strictly greater generation in that epoch, or a checked replacement epoch/owner under the binding rules below. If the first emission has no inventory, the first subsequent checked inventory can establish the baseline's replacement. Never renew freshness merely because a client mounted or resubscribed. This is display freshness, not a permission lease or a new provider polling loop. Inventory can become stale independently of existing workflow controls; do not silently change their contract.

Disconnected/expired/stale rows may be retained only in a visibly historical section with effective availability NEEDS_REFRESH. Preserve the original observation time; never relabel it as a fresh Runtime result. On project/workspace/session change, discard the old current inventory. On owner/epoch replacement, replace rather than merge. Removed rows disappear from the current view. Any UNKNOWN/NEEDS_REFRESH registry result replaces the current successful inventory; an empty successful catalog and unavailable inventory are different states.

| Combination/event | Required behavior |
| --- | --- |
| New App + baseline Runtime without the optional field | Existing control works; inventory says NOT_EXPOSED/UNKNOWN, not empty/available/permitted. No extra RPC or discovery attempt. |
| Field absent on any later snapshot | Stop treating previous inventory as current, even within one owner. No last-good fallback. |
| Missing/false environment `weavraControl` advertisement | Keep existing unsupported behavior; do not call control RPC. Ordinary read-only observer remains unchanged. |
| Read-scope-only authenticated principal | Existing server scope denial remains authoritative. Show inventory unavailable; do not auto-acquire control, lower scopes, or transfer another user's control cache. |
| New Runtime sends field to old App | **Not forward-compatible:** old strict decoder rejects the unknown field. Ship consumer #13 before producer #12, or deploy matching versions together. Do not weaken decoders or silently omit the new field based on guessed package versions. |
| Unknown descriptor field/kind/enum/schemaVersion; null instead of object | Fail existing strict response decoding, report protocol error/unavailable and stale retained state. This deliberately affects the control observation, not just the row. No silent stripping/permission fallback. |
| Runtime predates other mandatory baseline control fields/commands | Existing unsupported/protocol-error behavior remains; optional Broker support does not promise compatibility with every historical Runtime. |
| New transport connection, same Host owner | Clear freshness baseline; accept only its newly checked snapshot. Cached hello/state is insufficient. |
| Broker epoch changes | Accept as replacement only from a checked current snapshot on the bound transport; retire old epoch. A retired epoch must not be restored by a late callback. Epoch ordering is not lexicographic. |
| Inventory removed from a complete generation | Replace current rows; no union with cache, policy metadata, MCP advertisements or local preference state. |

These choices preserve strict unknown-field rejection and the read/operate boundary at the cost of producer-first compatibility and read-principal inventory access. Extending the ordinary observer or adding feature negotiation is a separately reviewed contract change, not work hidden inside #12/#13.

## 8. Negative/security matrix — required #12/#13/#14 evidence

All rows below are **future acceptance**, not tests run by this design PR. R = #12 Runtime; A = #13 App; I = #14 integration/security. Faux inputs test rejection, not actual external-service operation.

| ID | Negative scenario | Safe observable outcome | Owner |
| --- | --- | --- | --- |
| N01 | Duplicate identical registration | Whole replacement UNKNOWN/INVALID_REGISTRY; neither row selected, no action registration/effect | R, I |
| N02 | Same ID, different origin | Closed-origin/duplicate rejection; no alias or last-wins takeover | R, A, I |
| N03 | Provider/origin replacement under old ID | Unsupported v1 metadata rejected; old observation not reassigned; no provider activation | R, A, I |
| N04 | Transport changed to remote/stdio/shell | Reject unsupported binding metadata; never construct client/process from descriptor | R, A, I |
| N05 | Schema downgrade or forged schemaDigest | Reject unsupported wire version; Runtime derives digest from current trusted schema, never supplied advertisement. Changed trusted build/schema requires fresh epoch/observation; fingerprint is not an attestation against a malicious executable | R, A, I |
| N06 | Host protocol mismatch / unknown Broker schema | Existing protocol rejection/stale UI; no permissive schema fallback | R, A, I |
| N07 | Capability removed after discovery | New complete generation/query no longer contains it; old row cannot invoke anything | R, A, I |
| N08 | Stale generation or equal generation changed payload | Reject inconsistent replacement; mark stale/unavailable; equal cached generation cannot renew age | A, I |
| N09 | Broker restart under same Host owner | New epoch; no restoration of persisted/last-good authority or old observation | R, A, I |
| N10 | Disconnected App retaining inventory | Historical/stale display only; no automatic retry of prior mutation or “enabled” restoration | A, I |
| N11 | Workspace/project revision/session/owner mismatch | Scope mismatch fails closed; no cross-project cache or borrowed current rows | R, A, I |
| N12 | Config source disappears or changes during sample | UNKNOWN/CONFIG_UNAVAILABLE or NEEDS_REFRESH/SOURCE_CHANGED, never mixed CURRENT rows | R, I |
| N13 | Configured LSP server executable disappears | Inventory never claimed negotiated readiness; existing path reports actual failure; no install/spawn from inventory | R, I |
| N14 | Missing/expired credential after discovery | No credential read/refresh/fallback by Broker; existing execution cannot be authorized using a file-definition AVAILABLE flag | R, I |
| N15 | Expired Approval | Existing exact expiry check still denies; inventory cannot extend consent | R, I |
| N16 | Approval copied from another run/action | Existing run/action/input/config binding and one-use audit still reject | R, I |
| N17 | Approval copied from another workspace/Host session | Existing canonical owner/root/run/config/pending approval gates reject; no Broker-supplied grant | R, A, I |
| N18 | Forged App `enabled`/`approved`/permission state or extra RPC field | Strict field/input rejection; zero worker exposure/Policy/Kernel change | A, I |
| N19 | MCP readOnlyHint or other hint promoted to permission | App advertisement never enters Runtime registry/Policy; invocation auth remains separate | R, A, I |
| N20 | Plugin/skill metadata or advertised tool name widens worker tools | Empty resources/Host list unchanged; no generic loader or tool activation | R, I |
| N21 | Broker AVAILABLE bypasses READ_ONLY | Write/edit/delete still denied/absent; no filesystem mutation even with an R3 grant | R, I |
| N22 | Broker AVAILABLE bypasses R2/R3 | Existing bound R2 review path / exact R3 consent still required; no execution-time promotion | R, I |
| N23 | Discovery/hints/candidate converted to PASS/COMPLETE | No verifier evidence or Kernel transition; fresh RegisteredVerifier evidence still required | R, A, I |
| N24 | Oversized registry/query/result/UTF-8 response | Fixed rejection or whole-row truncation with exact omitted count; no unbounded allocation/output | R, A, I |
| N25 | Raw config/token/env/transcript/reasoning embedded in metadata/error | Closed allowlist rejection; no sensitive bytes in response/log/UI | R, A, I |
| N26 | Reconnect/late old-epoch callback/equal cached snapshot | No stale promotion or replay; require current transport + checked new generation | A, I |
| N27 | Old Runtime omits field / future Runtime adds unknown field | Explicit compatibility outcomes in §7, not fake empty/available inventory | A, I |
| N28 | Discovery in missing-config/disabled/control-not-ready state | No setup/repair/auth read/ModelRuntime create/LSP query/network call; unavailable remains typed | R, I |
| N29 | Valid existing operation with Broker unavailable/absent | Existing authorized path remains independent; Broker not accidentally introduced as a grant or mandatory execution gate | R, I |

Integration records actual versus faux versus not-verified results separately. No claim of real provider health, real credential expiry, OS isolation, or MCP end-to-end behavior follows from local fixtures. #14 must preserve existing Policy/Approval/Kernel regression gates and explicitly prove no automatic installation/hidden network activation, then document the gate before COMPLEX.

## 9. Hronom comment disposition

The #11 comment is external design input; its author explicitly did not run Weavra. Hronaut similarities and the AI-assisted note are not Weavra implementation/verification evidence.

- **Adopt:** monotonic discovery/noninterference; separate identity/observation/authority; typed unknown/refresh states; bounded provenance and redaction; origin/schema/removal/restart/approval/scope negatives; App inspection without execution/Kernel authority.
- **Refine:** availability generation belongs to the observation/epoch, not stable identity. Fingerprint detects changes, not permission. Required permission is a fixed explanation plus later per-action checks, not a persisted approved/executable state. Per-field provenance is represented by fixed grouped sources because current fields share sources. Existing owner/project/root transport binding is reused; no speculative global project identity or generic session permission token.
- **Do not adopt in this slice:** arbitrary provider/transport/protocol fields and external advertisements without a current passive Runtime port; credential probing to fill availability; a persisted four-stage advertised/policy-eligible/approved/executable machine; generic plugin registry, automatic discovery/install, or new execution routing. Provider/remote categories may be designed later, but cannot be smuggled through v1 strings.

## 10. Implementation ownership, order, and acceptance

| Issue | Exclusive ownership and exact handoff | Non-goals / gates |
| --- | --- | --- |
| #12 `feat/v0.7a-capability-runtime` | Runtime-local Broker types/registry/metadata adapter (new filenames chosen within company-runtime); passive reusable tool-schema declarations in `agent-tools.ts`, `list-files-tool.ts` and `lsp/tools.ts` as needed; `HostControlState` optional DTO and `HostControlBridge.snapshot` construction/budget/coherence; Runtime contract/security tests | No App files, new tool/command, Policy or Kernel semantics, auth/model creation, registration widening. Preserve npm build/check/test/shrinkwrap/install-lock gates. |
| #13 `feat/v0.7a-capability-app` | Independently duplicated schema in `packages/contracts/src/weavraControl.ts`; strict `ControlTransport`/`RuntimeController.consistent`; existing client state `state/weavraControl.ts`; inspection view alongside `WeavraControls` in project settings; stale/scope/compatibility tests | No Runtime imports/files, RPC scope relaxation, MCP metadata ingestion, enable/install/approval controls, or shared-schema refactor. Preserve pnpm 11 / Vite+ tests/typecheck/lint/format/knip/build gates. |
| #14 `test/v0.7a-capability-integration` | Combined wire fixtures and negative matrix; actual Runtime→Host→App observation, disconnect/restart/limits/leakage and unchanged authority proof | Final integration cannot precede #12 + #13. Fixture/checklist preparation alone may overlap late implementation. No new authority disguised as a test helper. |

Before each issue starts, recheck latest devlop, open PRs, prerequisites, worktrees and overlapping files. After #11 approval, #12 and #13 may implement concurrently against **this exact contract** in separate worktrees. Main integration owner reviews drift. Any changed field, enum, limit, coverage, freshness, or compatibility rule goes through a #11 follow-up agreement before either side diverges. No direct `devlop` edits or automatic merge.

Recommended landing/deployment order: design review/approval → App consumer #13 (handles absent inventory) → Runtime producer #12 → combined #14 verification. Parallel development does not mean producer-first deployment is compatible. Reassess merge conflicts/CI at execution time. A green design PR does not close implementation/security gates or authorize COMPLEX/Parallel.

Design-only validation: confirm only this document and the appended Korean root work log changed; `git diff --check`; all evidence paths exist at baseline; cross-check proposed Host/App seam and strict compatibility against source. No Runtime/App full suite, provider/network smoke, MCP discovery, or new execution test is warranted for these documentation-only changes. Implementation acceptance above remains NOT RUN.

## 11. Baseline evidence index

All paths below exist in the consolidated baseline. Line numbers may move during implementation; symbols and ownership above are normative, not the historical split.

- **R1** [Runtime control DTO and constants](../../runtime/pi/packages/company-runtime/src/host-control-protocol.ts): `HostControlCapabilities`, `HostControlState`, request union, transport bounds.
- **R2** [Host control](../../runtime/pi/packages/company-runtime/src/host-control.ts): `HostControlBridge.snapshot`, `handle`, `connect`; [current config projection](../../runtime/pi/packages/company-runtime/src/host-bridge-projections.ts): `readHostConfiguration`; [ordinary observer protocol](../../runtime/pi/packages/company-runtime/src/host-bridge-protocol.ts).
- **R3** [Policy](../../runtime/pi/packages/company-runtime/src/policy.ts): `RegisteredActionTool`, `evaluatePolicy`, `executePolicyAction`, `evaluateRegisteredCheck`; [execution contract](../../runtime/pi/packages/company-runtime/src/execution-contract.ts).
- **R4** [Worker tools](../../runtime/pi/packages/company-runtime/src/agent-tools.ts): `WORKER_FILE_TOOLS`, `createWorkerTools`, deletion/approval; [listing tool schema/adapter](../../runtime/pi/packages/company-runtime/src/list-files-tool.ts).
- **R5** [Runner](../../runtime/pi/packages/company-runtime/src/agent-runner.ts): `PiAgentExecutor.create`, `workerResources`, session construction; [Runtime config](../../runtime/pi/packages/company-runtime/src/config.ts); [Runtime architecture README](../../runtime/pi/packages/company-runtime/README.md).
- **R6** [LSP types](../../runtime/pi/packages/company-runtime/src/lsp/types.ts), [tools](../../runtime/pi/packages/company-runtime/src/lsp/tools.ts), [manager](../../runtime/pi/packages/company-runtime/src/lsp/manager.ts), [client](../../runtime/pi/packages/company-runtime/src/lsp/client.ts), [config](../../runtime/pi/packages/company-runtime/src/lsp/config.ts), [status command](../../runtime/pi/packages/company-runtime/src/lsp/command.ts); [Workflow](../../runtime/pi/packages/company-runtime/src/workflow.ts): `lspStatus` and run ownership.
- **R7** [RegisteredVerifier](../../runtime/pi/packages/company-runtime/src/verification.ts), [browser registry](../../runtime/pi/packages/company-runtime/src/browser-registry.ts).
- **R8** [Host workflow](../../runtime/pi/packages/company-runtime/src/host-workflow.ts), [ModelRuntime](../../runtime/pi/packages/coding-agent/src/core/model-runtime.ts), [provider interface](../../runtime/pi/packages/ai/src/models.ts), [model metadata](../../runtime/pi/packages/ai/src/types.ts), [bundled catalogs](../../runtime/pi/packages/ai/src/providers/all.ts).
- **R9** [Outer extension loader](../../runtime/pi/packages/coding-agent/src/core/extensions/loader.ts), [skills](../../runtime/pi/packages/coding-agent/src/core/skills.ts), [resource loader](../../runtime/pi/packages/coding-agent/src/core/resource-loader.ts); [project facts architecture](PROJECT_FACTS.md).
- **A1** [MCP server](../../app/t3code/apps/server/src/mcp/McpHttpServer.ts), [Preview descriptors](../../app/t3code/apps/server/src/mcp/toolkits/preview/tools.ts), [Device descriptors](../../app/t3code/apps/server/src/mcp/toolkits/device/tools.ts), [PullRequests descriptors](../../app/t3code/apps/server/src/mcp/toolkits/pullRequests/tools.ts).
- **A2** [Invocation context](../../app/t3code/apps/server/src/mcp/McpInvocationContext.ts), [session registry](../../app/t3code/apps/server/src/mcp/McpSessionRegistry.ts), [provider grant issuance](../../app/t3code/apps/server/src/provider/Layers/ProviderService.ts), [Preview broker](../../app/t3code/apps/server/src/mcp/PreviewAutomationBroker.ts), [Device service](../../app/t3code/apps/server/src/device/DeviceService.ts).
- **A3** [App control contracts](../../app/t3code/packages/contracts/src/weavraControl.ts), [ControlTransport](../../app/t3code/apps/server/src/weavra/ControlTransport.ts), [RuntimeController](../../app/t3code/apps/server/src/weavra/RuntimeController.ts).
- **A4** [RPC authorization](../../app/t3code/apps/server/src/auth/RpcAuthorization.ts), [RPC dispatch](../../app/t3code/apps/server/src/ws.ts), [environment advertisement](../../app/t3code/apps/server/src/environment/ServerEnvironment.ts), [ordinary RuntimeObserver](../../app/t3code/apps/server/src/weavra/RuntimeObserver.ts), [ordinary BridgeTransport](../../app/t3code/apps/server/src/weavra/BridgeTransport.ts).
- **A5** [Client control state](../../app/t3code/packages/client-runtime/src/state/weavraControl.ts), [WeavraControls](../../app/t3code/apps/web/src/components/settings/WeavraControls.tsx), [WeavraSettings](../../app/t3code/apps/web/src/components/settings/WeavraSettings.tsx), [project checkout selection](../../app/t3code/apps/web/src/components/settings/ProjectSettingsPanel.tsx).

## 12. Append-only Runtime #12 implementation evidence

Sections 1–11 above are the frozen #11 contract and historical design record, unchanged by this implementation. This appendix records the Runtime producer only; it does not revise the wire contract or claim #13/#14 completion.

- `company-runtime/src/action-tool-schemas.ts` now holds the pure parameter declarations used by the actual file/list/LSP adapters. `capability-catalog.ts` derives the approved descriptor/requirements and canonical digests from those declarations. No worker is instantiated for inventory.
- `capability-broker.ts` owns immutable generations behind a Host-private prepare/publication closure. Only the frozen list/query reader escapes that owner. No registration, execution, persistence, auth/model/LSP initialization or observation-to-authority integration was added.
- `HostControlBridge.snapshot` samples complete validated current configuration before/after candidate preparation and retains the existing canonical root/revision/execution-owner fence and at-most-two retries. The inventory is attached only to `HostControlState`; ordinary observer protocol and all control commands remain unchanged.
- The Runtime negative evidence below is deterministic/faux where it injects malformed metadata, configuration races, canonical-state byte pressure, approval bindings or model responses. It is not evidence of real external-service health.

| Frozen matrix IDs | Runtime evidence |
| --- | --- |
| N01–N05, N07, N09, N19, N24–N25 | `test/capability-broker.test.ts`: whole-replacement rejection, actual schema digests/fingerprints, removal, restart, exact queries, immutable generations, count/byte bounds, closed metadata and redaction. |
| N06, N11–N14, N17, N24–N25, N28 | `test/host-capability.test.ts`: existing version/command rejection, scope/owner and canonical-source fences, config loss/change, disabled/enabled-but-unobserved LSP, credentials independent of discovery, fixed errors, UTF-8 pressure without truncating canonical state, no model/LSP/network/spawn setup effects. |
| N14–N17, N19–N23, N29 | `test/capability-authority.test.ts`: fixed action/context across absent/current/forged/unavailable inventory, equal Policy decisions/risk, unchanged worker exposure, real allowed read/mutation and denied filesystem effects, exact expired/foreign R3 consent, no registered-check or Kernel evidence promotion. Actual adapter parameters are checked against every public schema digest. |
| N14–N17, N20–N23, N29 | Existing `coding-agent/test/suite/company-runtime-agent.test.ts` and `company-runtime-control.test.ts`, extended with Broker observation: actual SDK resource isolation under CURRENT/UNKNOWN, independent auth failure, AVAILABLE delete still subject to exact pending/expiry/one-use Host approval. Existing full Policy/Approval/Kernel/verification regressions remain required. |

Actual production-launcher stdio smoke separately exercised missing → configured → enabled LSP → invalid config and a Runtime restart. It observed ten rows (six file definitions AVAILABLE, four LSP rows disabled or UNKNOWN), failed-refresh generation advancement, new epoch, strict forged-command/field rejection, no implicit home/state creation and no sensitive sentinels. A disposable process guard recorded zero network, child-process and credential-file access attempts for both owners. No real provider request, LSP negotiation or external MCP call was exercised. Build-time catalog hydration is an explicit separate validation activity, not Broker discovery.

Exact local gate results, failures/fixes and delivery status are recorded in [the root work log](../WORK_LOG.md). **Consumer-first landing remains mandatory:** do not merge/deploy #12 before #13 unless an explicitly chosen matched-version strategy replaces that order. The old strict App decoder is still expected to reject the new field. No App implementation or #14 integration work is included here.

## 13. Append-only #14 combined integration/security evidence

### 13.1 Scope and audited revision

- 2026-09-22, issue #14, branch `test/v0.7a-capability-integration`, dedicated worktree `Weavra-worktrees/v0.7a-capability-integration`.
- Exact integrated baseline: `409e1351a182be9ce04633af9c4b79239508ab6a`. Before starting, remote `devlop`, local integration baseline and branch merge-base matched it; #11/#12/#13 were CLOSED, PR #25/#27/#26 were merged, and open PR count was zero. App #13 landed before Runtime #12.
- Exact verified implementation HEAD: `74430145d27333dded4c7d6756cca27c84cd6e59`. Subsequent delivery commit appends only this evidence and the Korean root work log; the PR records its exact final HEAD separately. Full Runtime/App gates ran against the unchanged baseline product sources; the final dedicated smoke ran against the implementation tree committed at this SHA.
- Sections 1–11, the historical §12 appendix, both independent build roots, duplicated protocol definitions and all production sources are unchanged. No frozen field, enum, limit, freshness or compatibility drift was found. No Policy/Approval/Kernel, worker exposure, command set, RPC authorization or Facts semantics were changed.
- New runnable gate: `node scripts/run-capability-boundary.mjs`, also included in the existing cross-boundary CI job. Its helpers are `scripts/capability-boundary-smoke.mjs`, `capability-app-integration.mjs`, `capability-authority-integration.mjs`, `capability-compatibility.mjs` and the test-only `capability-observation-guard.mjs`. Existing `scripts/run-cross-boundary.mjs` now also requires CURRENT inventory while the fresh Broken-browser check still fails.

### 13.2 Evidence classes and limits

**Actual:** production `weavra bridge --stdio --project-trusted --control` → production App `ControlTransport`/`RuntimeController` → client inventory tracker and actual `CapabilityInventory` component. The controller's project lookup is a fixture; its subprocess transport is real. Missing configuration is NOT_SETUP/UNKNOWN without setup; valid configuration publishes ten definitions with independently checked adapter-schema digests and exact owner/revision/epoch/generation. Removing the configured LSP executable does not turn unobserved LSP into readiness. Invalid/removed configuration replaces CURRENT with empty UNKNOWN.

The first cached emission of each App subscription is NEEDS_REFRESH; only a checked later generation is CURRENT. After 5.1 seconds without delivering another inventory to that tracker, it is stale even though a separate observer confirms that the actual controller remains connected, non-stale, advancing generations and preserving canonical workflow state. Equal generation cannot renew freshness. Resubscription retains the Host owner; killing the owned Runtime process gives a real disconnect/reconnect, new owner/epoch, generation 1, lost ephemeral Facts draft and exactly one original `facts.prepare` request, not a replay. Actual process restart is **not** the same-owner Broker restart case N09.

Actual filesystem/tool adapters receive absent, App-decoded CURRENT/UNKNOWN, and forged inventory sidebands. Existing authorized reads remain allowed, READ_ONLY mutation remains denied/absent, and fixed R2/R3 decisions remain independent. Actual `RegisteredVerifier` executes a registered Node check and observes **exit code 1 / FAIL**; a changed registration is denied. The separate completion assertion proves missing independent Reviewer/final-check evidence is rejected, not a live Kernel transition caused solely by that failing result.

The existing cross-boundary gate uses actual isolated Chromium captures. Candidate is CANDIDATE_ONLY; registration is not verification; Facts VALID→STALE and identical-file recreation remain fenced. With CURRENT inventory, retained Ready evidence and a fresh Broken page still yield FAIL, while the persisted prior run remains CANCELLED. This is not a claim that this smoke drives a live Kernel run through completion.

**Deterministic/faux:** malformed metadata, same-owner epoch replacement, stale callbacks, source change between real Host config reads, and pressure state are deliberately injected because the valid producer cannot advertise those states. A faux old/future executable derives its response from an actual captured current producer: the real App transport accepts absent optional inventory as NOT_EXPOSED, preserves existing workflow state, performs only hello+snapshot, and rejects an unknown future field. This does not exercise a released historical binary.

R3 uses the actual delete adapter and filesystem with a **faux consent callback and nondurable audit port**. Denied/expired/foreign bindings leave the file intact; a current exact grant permits one deletion. Reusing that grant on a fresh adapter action fails its new action binding. Durable consumption/replay and canonical pending Host approval are supplied by the current inherited Approval/SDK regression reruns, not by that callback ledger. SDK model/auth responses in those suites are also faux, never paid inference.

Pressure injection supplies App-valid multibyte Facts plus non-null approval, preview, run and evidence. Real Host serialization removes only whole inventory rows in deterministic order, preserves every non-Broker value by deep equality, reports exact omissions, and stays within 16,384 inventory / 65,536 response UTF-8 bytes including LF. A separately calibrated response fits without inventory but cannot fit even the empty inventory header; it returns RESPONSE_TOO_LARGE rather than dropping canonical state.

**Bounded activation/leakage proof:** 15 snapshot windows plus their observation-idle intervals recorded zero calls through the installed Node network, child-process and credential/resource hooks. Five positive controls actually trip fetch, spawn, credential read, DNS promise and dynamic skill import. Guards remain armed after snapshot responses until an explicit non-snapshot command. A separate actual Host factory spy records zero ModelRuntime creation. Provider/model/argv/token/endpoint/document sentinels are absent from bounded wire, App state, component markup and captured stderr. The generated actual component capture was opened in Chromium: ten rows in each baseline/CURRENT/expired section, no controls and no sentinel bytes.

These are **intercepted Node API** results, not an OS sandbox proof. Native/internal APIs, other realms, existing connections, preopened handles, cached in-memory activity and unrecognized resource paths are not comprehensively intercepted. Configured launcher `prepareLaunch`/doctor may read auth/models/settings and run `git --version` before measurement; startup is explicitly excluded. Explicit build/catalog hydration, package-manager bootstrap, root publication probes and browser setup are also separate activities, not Broker discovery. No automatic install, credential repair, discovery-triggered worker/LSP/model creation, added tool exposure or authorization bypass was observed in the reviewed source and exercised boundary.

**Not verified:** real vendor credential expiry/provider health/paid inference; real external LSP negotiation; external MCP end-to-end execution; native/mobile UI or another OS; a live mounted App WebSocket/browser-hydration session in the new smoke; universal network/resource isolation. Browser confirmation is an unstyled SSR capture of the actual component, not the full App. Existing App session authorization, reactive freshness timer, actual SDK resources, durable approval and Kernel transitions are inherited regression reruns, not newly claimed end-to-end observations.

### 13.3 Complete N01–N29 ownership matrix

All entries below are current reruns, not historical PASS carried forward from §12. PASS applies to the listed contract and evidence scope; the not-verified environments above remain not verified.

Runtime aliases, under `runtime/pi/packages/company-runtime/test/`: **B** `capability-broker.test.ts`; **H** `host-capability.test.ts`; **P** `capability-authority.test.ts` plus `policy.test.ts`; **A** `approval.test.ts`; **K** `kernel.test.ts`; **V** `verification-boundary.test.ts`; **L** `lsp.test.ts`/`lsp-config.test.ts`. **S** is `runtime/pi/packages/coding-agent/test/suite/company-runtime-{agent,control,approval}.test.ts`.

App aliases: **C** `packages/contracts/src/weavraCapabilityInventory.test.ts`/`weavraControl.test.ts`; **T** `apps/server/src/weavra/ControlTransport.test.ts`; **R** `apps/server/src/weavra/RuntimeController.test.ts` (with `auth/RpcAuthorization.test.ts` for authorization); **F** `packages/client-runtime/src/state/weavraControl.test.ts`; **U** `apps/web/src/components/settings/CapabilityInventory.test.tsx`; **M** `apps/server/src/mcp/McpHttpServer.test.ts`. All App paths are under `app/t3code/`. New evidence is the scripts in §13.1.

| ID | Runtime evidence | App evidence | New #14 cross-boundary evidence | Result | Evidence class |
| --- | --- | --- | --- | --- | --- |
| N01 | B: identical duplicate rejects whole registry | C: duplicate/sorted-ID rejection | Duplicate of actual decoded row rejected; producer rejection rerun | PASS | deterministic/faux + inherited focused regression rerun |
| N02 | B: duplicate/foreign origin rejected | C: closed origin | Actual-row origin substitution rejected | PASS | deterministic/faux + inherited focused regression rerun |
| N03 | B: unsupported provider/origin | C: fixed Runtime origin | Forged origin cannot rebind row; guarded observation has no activation | PASS | actual + deterministic/faux + inherited focused regression rerun |
| N04 | B: unsupported transport | C/T: closed binding | stdio descriptor substitution rejected; no intercepted discovery child start | PASS | actual + deterministic/faux + inherited focused regression rerun |
| N05 | B/P: trusted schema/fingerprint | C: version/digest form | Ten actual wire digests match shared adapter schemas; malformed digest/version rejected | PASS | actual + deterministic/faux + inherited focused regression rerun |
| N06 | H: protocol/command rejection | C/T: strict protocol/schema | Exact eleven commands observed; unknown field/version negatives rerun | PASS | actual + inherited focused regression rerun |
| N07 | B: removal/exact NOT_FOUND | F: replace, never union | Injected nine-row generation replaces actual ten-row inventory | PASS | deterministic/faux + inherited focused regression rerun |
| N08 | Not producer ordering responsibility | R/F: regression/equality | Equal payload cannot renew actual elapsed age; changed equal/regressed generation rejected | PASS | actual + deterministic/faux + inherited focused regression rerun |
| N09 | B: fresh Broker, same owner | R/F: replacement/retirement | Same-owner epoch replacement injected; actual process restart separately changes owner | PASS | deterministic/faux + inherited focused regression rerun for same-owner case |
| N10 | S: service/worker lifetime | R/F/U: disconnected history | Actual process loss makes inventory stale; facts.prepare not replayed | PASS | actual + inherited focused regression rerun |
| N11 | H/S: root/owner/revision fences | R/F: project/workspace/session | Actual scope and foreign-owner rejection; injected owner/revision mismatch | PASS | actual + deterministic/faux + inherited focused regression rerun |
| N12 | H: source/coherence fences | C/R/F: typed failure | Actual missing/invalid/removed config; injected mid-read change gives SOURCE_CHANGED through App decode | PASS | actual + deterministic/faux + inherited focused regression rerun |
| N13 | H/L: unobserved LSP/invocation failure | C: UNKNOWN pair | Configured executable actually removed; UNKNOWN/LSP_NOT_OBSERVED, no hidden start | PASS | actual + inherited focused regression rerun |
| N14 | H/S: independent auth failure | No credential authority | Sentinel credentials/guarded observation; late auth failure is faux, not vendor expiry | PASS | actual + deterministic/faux + inherited focused regression rerun |
| N15 | P/A/S: exact expiry | R: canonical approval only | Actual delete adapter refuses expired faux grant; file unchanged | PASS | actual adapter + deterministic/faux + inherited focused regression rerun |
| N16 | P/A/S: bindings/durable one-use | R: no replay | Foreign/reused faux grant denied; durable replay covered by A/S, not callback ledger | PASS | actual adapter + deterministic/faux + inherited focused regression rerun |
| N17 | H/S: Host/session/scope | R/U: foreign approval unavailable | Real transport foreign-owner approval.resolve rejected; foreign config/input grant cannot delete | PASS | actual + deterministic/faux + inherited focused regression rerun |
| N18 | H: extra command/input rejected | C/T/R/U: closed inputs | Forged enabled/approved/permissions/status rejected; no additional mutation request | PASS | deterministic/faux + inherited focused regression rerun |
| N19 | B/P: no MCP source; fixed Policy | M: real App advertisement boundary | Actual Preview toolkit annotations cannot enter Broker/request schemas or worker names | PASS | actual metadata + deterministic/faux + inherited focused regression rerun |
| N20 | P/S: Host tools/resource traps | No App worker registration | Adapter names unchanged across decoded inventories; resource guard plus SDK resource-trap rerun | PASS | actual + inherited focused regression rerun |
| N21 | P/S: READ_ONLY denial | Inspection-only U | Actual worker lacks mutation tools; Policy DENY/file bytes unchanged despite AVAILABLE | PASS | actual + deterministic/faux + inherited focused regression rerun |
| N22 | P/A/S: fixed R2/exact R3 | R: consent remains separate | R2 REVIEW_REQUIRED/foreign DENY/bound ALLOW; actual deletion needs exact faux grant | PASS | actual adapter + deterministic/faux + inherited focused regression rerun |
| N23 | P/V/K/S: verification/completion | R/U/M: no evidence promotion | Actual Node exit 1=FAIL; changed registration denied; CURRENT + fresh Broken=FAIL; canonical CANCELLED unchanged; missing completion evidence rejected | PASS | actual + deterministic/faux + inherited focused regression rerun |
| N24 | B/H: registry/query/UTF-8 bounds | C/T: strict count/byte schema | Populated multibyte canonical state survives real Host whole-row pressure; exact empty-header overflow rejects | PASS | deterministic/faux + inherited focused regression rerun |
| N25 | B/H: closed metadata/errors | C/T/U: safe decode/display | Bounded sentinels absent from wire/state/SSR/stderr; rendered capture inspected in Chromium | PASS | actual + deterministic/faux + inherited focused regression rerun |
| N26 | S: owner execution lifetime | R/F: retired epoch/cache | Actual resubscribe/reconnect; injected retired callback cannot regain CURRENT; no mutation replay | PASS | actual + deterministic/faux + inherited focused regression rerun |
| N27 | Optional consumer field | C/T/R/F: absence/future field | Faux old producer via real transport gives NOT_EXPOSED with hello+snapshot only; future field INVALID_PAYLOAD; actual current producer accepted | PASS | actual + deterministic/faux + inherited focused regression rerun |
| N28 | H: no factory/LSP/source effects | R: readiness boundary | Actual NOT_SETUP/missing/invalid config, no repair; scoped guards/factory spy; startup doctor excluded | PASS | actual + deterministic/faux + inherited focused regression rerun |
| N29 | P/S: independent allowed operation | No discovery authority | Actual runtime_read succeeds for decoded UNKNOWN/current/absent with fixed trusted context | PASS | actual + deterministic/faux + inherited focused regression rerun |

### 13.4 Executed gates and decision

Node 24.19.0; Runtime npm; App pnpm 11.10.0/Vite+; Darwin arm64. No new skip, timeout increase, assertion suppression, blind retry or production fix was used.

| Current command/check | Result |
| --- | --- |
| Runtime `npm run build` | PASS; explicit build/catalog network separate from observation |
| `node scripts/validate.mjs pi` | ALL GATES PASS, 567.69s; full npm tests and isolated `bash test.sh`; company-runtime 60 files/1,522 tests and coding-agent 279 files/2,750 tests in each pass; existing Vitest skips retained |
| `node scripts/validate.mjs t3` | ALL GATES PASS, 510.70s; workspace 1,254 files/16,955 tests PASS, existing 6 files/57 tests skipped; focused reruns, typecheck/lint/format/knip/build; 720 existing warnings/0 errors |
| `node scripts/run-cross-boundary.mjs` | PASS, 9.88s; actual stdio, Facts fences, fresh Chromium Broken failure despite CURRENT inventory |
| `node scripts/run-capability-boundary.mjs` | PASS, 22.21s after review strengthening; 15 snapshot windows plus idle observation, five positive controls, zero intercepted activation attempts |
| Additional focused Runtime authority/security | 7 files/197 tests PASS |
| Additional focused SDK agent/control/approval | 3 files/174 tests PASS |
| Additional focused App contracts/server/client/inventory UI | 170 tests PASS |
| Root immutable imports; lock/source-archive regressions; model catalog diff | PASS; 1,918 Runtime/23,069 App historical entries; 3 tests; no openai catalog changes |
| Tracked Runtime/App source after all gates | Unchanged; no formatter/build-generated source or lock diff |

Initial new-harness failures were corrected to the existing contracts: unknown check throws rather than returning UNAVAILABLE; foreign R2 run is DENY rather than REVIEW_REQUIRED; disposable verification source must be committed; in-process Host requires hello before snapshot. Review then strengthened rather than weakened evidence: exact verifier exit code, live workflow observer during inventory age expiry, populated protected-state comparison, calibrated header-only overflow, wider guard hooks/positive controls and honest same-owner/faux-consent labels. No frozen contract drift or product bug was found. Read-only lifecycle and security reviews reported no remaining blocker in their reviewed scope; execution proof is the final rerun above.

**Decision:** V0.7A combined local integration/security gate is PASS and ready for normal #14 review/closure. N01–N29 has no unexplained gap within the frozen local-evidence scope. The technical prerequisite for considering #15 COMPLEX is satisfied; actual #15 work remains unstarted and requires a separate decision after normal #14 review/CI/merge. This appendix does not close a GitHub issue, merge a PR, claim remote CI PASS, authorize COMPLEX implementation, or generalize local fixtures to the not-verified environments above.
