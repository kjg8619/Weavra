# Group providers

Read and follow /Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-22/delegation/shared-brief.md first.

Your catalog file: app/t3code/apps/web/src/i18n/ko.providers.ts (export koProviders).
Your sub-namespaces: providers.{panel, form, card, models, customModel, setup, addInstance, status, update, banner, threadError, readiness}

Your files (paths relative to app/t3code/apps/web/src; edit nothing else except colocated tests that assert changed copy):
- components/settings/ProviderSettingsPanel.tsx
- components/settings/ProviderSettingsForm.tsx
- components/settings/ProviderInstanceCard.tsx
- components/settings/ProviderModelsSection.tsx
- components/settings/CustomModelEditor.tsx
- components/settings/ProviderSetupSection.tsx
- components/settings/AddProviderInstanceDialog.tsx
- components/settings/AddProviderInstanceWizardSteps.tsx
- components/settings/providerStatus.ts
- routes/settings.providers.tsx
- components/ProviderUpdateLaunchNotification.tsx
- components/ProviderUpdateEnvironmentRows.tsx
- components/chat/ProviderStatusBanner.tsx
- components/chat/ThreadErrorBanner.tsx
- onboarding/providerReadiness.logic.ts

## Group-specific instructions

Also implement plan todo 22 step 3: for STRUCTURED external provider failures (provider status with a known structured cause such as unauthenticated / not installed / update available / version behind / setup required / error with message), show a catalog-backed Korean cause and recovery action FIRST, then the separately labelled original diagnostics ("원문 진단") below, unchanged and copyable. Raw CLI stderr/messages are never translated or rewritten. Literal `codex login` and other commands, IDs and endpoints stay exact and copyable. Reuse existing structures (providerStatus.ts, ProviderStatusBanner, the existing "원문 진단 및 복구 안내" disclosure, which the runner opens by that exact name and expects exactly one of on the Providers page, with aria-controls). Do not invent wire fields: derive cause only from fields that already exist. Onboarding provider summaries live in providerReadiness.logic.ts. Existing tests (ProviderInstanceCard.test.ts, ProviderModelsSection.test.ts, ProviderSettingsForm.test.ts, ProviderSettingsPanel.*.test.tsx, ProviderSetupSection.test.tsx, providerStatus.test.ts, AddProviderInstance*.test.*, ProviderStatusBanner tests) must pass; update copy-equality assertions only. Note: ProviderInstanceCard.test.ts has an inherited CI failure at HEAD (unrelated); record its HEAD status before your edits and report whether you changed it. Also note ProviderUpdatePrimaryNotification.tsx named in the plan does not exist in this tree.

Write your final report also to /Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-22/delegation/report-providers.md.
