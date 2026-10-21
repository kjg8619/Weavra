# Todo 18: shared runner prevents acceptance

No pull request is opened while required acceptance fails. This is not a product
PASS and W-20/W-25 closure is not claimed.

The user explicitly forbids editing the shared hig-01 worktree. It remains at
94be65dcf88700e6e73a728fb42437ababa75fdb.

`scripts/hig/cases.mjs:1283-1295`, `settingsDisclosure()`, has two independent
selector problems for `18/raw-diagnostic`:

1. The global `button[aria-expanded="false"]` selector picks the Settings
   breadcrumb's All environments menu, not the provider diagnostic disclosure.
2. Its state-qualified live locator is reused after activation. An actually
   expanded button no longer matches `[aria-expanded="false"]`; `.first()`
   retargets another collapsed control before reading `aria-expanded`.

The preserved 983c9713 failure frame shows the All environments popup open and
the actual diagnostic still closed:
`previous-983c9713-breadcrumb-selector/qa/run-477abf4d-f949-4404-94ae-b7577eb94326/scenarios/18/raw-diagnostic/result.png`.
Its AX tree and observations are beside it. The final packet repeats the strict
checks, preserving both actual failing receipts and verifier exit codes.

The actual provider diagnostic was independently activated by its exact
accessible name in 12 light/dark, size and text-scale contexts. Its expanded state
and unchanged provider selection pass; the full raw diagnostic/recovery is
visible. The final receipts record every other case-18 scenario's actual status;
the earlier minimum-window fractional clipping finding is preserved separately.
That 0.0625px finding was fixed with token-based focus scroll margin in
16955bb57c8c4611823d39e0fa3bf6960beb429e. `form-actions-reachable` now passes in
both strict rounds. Each round has five PASS checks and the sole remaining FAIL
is `raw-diagnostic`.

The hig-01 owner needs a stable, case-specific role/name or ID locator for the
provider diagnostic, independent of expanded state, followed by a bounded wait
for that same control's expanded state. A regression should put an unrelated
collapsed breadcrumb before the intended disclosure. Do not change assertions
to accept the breadcrumb, remove the expanded-state assertion, or patch product
navigation to satisfy a broken selector.

After that owner fix, run both accept_pr 18 rounds and --verify-packet against
this branch, regenerate any script-hash-bound captures required by the runner,
then publish the non-draft PR with the prepared section-3.7 body.

This child cannot spawn an independent reviewer (depth 2 exceeds max_depth 1).
The exposed supervisor/intercom surfaces refuse child asks and request a
`contact_supervisor` tool that is not exposed in this session. No independent
review approval is claimed.
