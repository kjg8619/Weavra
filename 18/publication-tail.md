## Verification

- From `app/t3code/apps/web`: `pnpm exec vp test run --project unit src/components/settings/providerStatus.test.ts src/components/settings/ProviderModelsSection.test.ts src/components/settings/ProviderSettingsPanel.environment.test.tsx`: 27/27, three files, exit 0.
- From `app/t3code`: targeted `pnpm exec vp fmt --check` and `pnpm exec vp lint` on the seven changed owner files: exit 0; `pnpm --filter @t3tools/web typecheck`: exit 0.
- Both source-built packages use `T3CODE_DESKTOP_SIGNED=false T3CODE_DESKTOP_SKIP_BUILD=false pnpm run dist:desktop:artifact --platform mac --target zip --arch arm64 --output-dir ...`: exit 0. Version 0.0.42, Node 24.19.0, project-selected pnpm 11.10.0, Bun 1.4.0. No live installation was used as the after build.
- Actual final source, app/script/fixture hashes, native bounds, all capture-pair results and both strict acceptance/verifier outcomes are in the [machine-readable status](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/blocked-status.json?raw=true).
- The fresh [a-j measurements](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/rules-a-j.md?raw=true) cover both themes, three CSS sizes, 100/150% text and focus/hover/pressed/invalid/corrected/edit/cancel states. [Computed measurements](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/measure-after--qa-measure.json?raw=true) retain actual rectangles, RGBA/background compositing, five-point hits, contrast, focus, scroll-owner and overlap observations.
- No fabricated acceptance-verdict.json is supplied: the shared verifier exits on the failed scenario before it writes that file. Both actual scenario receipts, AX/action artifacts and raw command logs are preserved.
- The original installed audit build is not the parent comparison. These are fresh c4e04c65 and 16955bb5 source-built packages with explicit provenance.

## Residual findings

**This PR body is prepared locally, not submitted.** The shared runner selects the
All environments breadcrumb instead of the provider diagnostic and reuses an
`aria-expanded=false` live locator after activation. See the [exact blocker and
owner repair](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/BLOCKER.md?raw=true).
Required acceptance failures prevent opening a non-draft PR. Assertions have not
been weakened and hig-01 has not been edited.

Two pre-existing lint warnings remain: the models-list effect dependency and the
provider settings search effect. Parent lint receipts establish both. The shared
Settings breadcrumb/footer crowding at minimum/150% is outside this owner scope.
The full universal Q/200%/+40%/VoiceOver/IME/motion cross-product and monorepo CI
remain Final-wave checks under the October 19 amendment; no full-Q PASS is claimed.
An independent child reviewer could not launch because the nesting limit is one;
no independent review approval is claimed.

Model and harness: GPT-6.1-Sol (`chatgpt-subscription`) with Senpi; unchanged shared
HIG runner `94be65dcf88700e6e73a728fb42437ababa75fdb`. Model/execution/external-network
counters are zero in the isolated self-measurement profile. Only owned evidence
apps are closed; `/Users/kangjingoo/Applications/Weavra.app` remains untouched.
