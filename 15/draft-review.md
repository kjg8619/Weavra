# Todo 15 ownership and implementation review

The branch and worktree did not exist at intake. Created `hig/15-source-control-status`
in `Weavra-worktrees/hig-15` from the latest pushed stack parent,
`hig/14-link-destination` at `f95305dfd3fc334a5a311b6fdbce463c6d075583`.
There were no todo 15 draft commits to adopt or rewrite.

Only the two plan-owned files are changed: SourceControlSettings.tsx and its new
SourceControlSettings.test.tsx. The shared runner in hig-01 is read-only.

The discovery query comes from the web sourceControlEnvironment wrapper of
createSourceControlEnvironmentAtoms, through server.discoverSourceControl. The existing
contract carries independent installation (`available`/`missing`) and authentication
(`authenticated`/`unauthenticated`/`unknown`) observations. Bitbucket is an internal API
adapter, not an external CLI: its available installation observation is labelled as a
built-in integration. The old no-executable summary returned "Available" before inspecting
authentication, which hid Bitbucket's unauthenticated state. Provider switches also
combined the two axes into a disabled-looking boolean.

The view now shows both observations in plain text. Setup disclosure reveals the existing
installHint and diagnostic values without parsing, translating or executing commands.
Rescan is still an explicit existing discovery read. No credential, login, discovery,
server, Runtime, contract, routing or provider implementation changes are made.

The same settings component consumes environment-scoped structured discovery for local and
direct remote connections; this patch does not introduce a local-only status inference.
Mobile has a separate settings surface and is outside this web-only ownership.

Seven behavior tests cover the observation combinations, auth-only updates, reversible
setup disclosure without rescan, and failed discovery with explicit recovery. The tooltip
shell is replaced only in the node test environment; the disclosure, Button and actual
panel consumer remain real. Packaged checks cover the actual tooltip and hit/focus behavior.

Failed discovery now takes precedence over a retained successful snapshot, so it cannot
continue to present a stale successful login. The regression deliberately supplies both
cached authenticated data and an error. Disclosure focus uses an explicit semantic
foreground outline and scroll margin; installation/login observations remain separate.
The existing Git disclosure keeps its accessible name for the shared runner. Provider
disclosures are additionally exercised directly by the task-owned measurement script.

Inline details reuse the existing Collapsible but override its inherited height transition
to `transition-none` within this owned component. Expanding/collapsing reflows immediately;
only the existing chevron transform is animated. No shared primitive is edited.

The expanded self-measure matrix measures every source-control provider in its
unauthenticated presentation and all four structured combinations for Bitbucket, in both
themes, all three desktop CSS sizes and both text scales. The full every-consumer/state
cross-product remains the Final-wave contract rather than a per-PR claim.

The existing set-state-in-effect lint warning on the Git search-target auto-expansion and
Effect schema/typecheck suggestions outside these files remain pre-existing findings.
The unchanged Settings route closes on Escape without restoring its settings-button
focus. That route-level issue is outside todo 15. The new setup disclosures are inline,
not dialogs or popups: popup Escape/origin checks are genuinely inapplicable here.
