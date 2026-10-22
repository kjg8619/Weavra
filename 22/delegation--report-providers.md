# Worker report: providers (todo 22)

Worktree: /Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-22. No commit, git state untouched, no build or app launch.
Paths below are relative to `app/t3code/apps/web/src`.

## Files changed

Catalog: `i18n/ko.providers.ts` (`koProviders.providers`). It has 282 leaf entries (strings plus parameterized functions). About 270 of them are newly translated English strings; the rest are existing Korean strings moved into the catalog.

Sub-namespaces added: `panel, card, status, models, customModel, setup, addInstance, update, banner, threadError`.
- `form` was not created because ProviderSettingsForm.tsx has no authored copy (see notes).
- `readiness` was not created because providerReadiness.logic.ts has no user-visible copy (only commands and state keys).
- The route copy (`routes/settings.providers.tsx`) is stored under `panel`.

Source files edited:
- `components/settings/ProviderSettingsPanel.tsx`
- `components/settings/ProviderInstanceCard.tsx`
- `components/settings/ProviderModelsSection.tsx`
- `components/settings/CustomModelEditor.tsx`
- `components/settings/ProviderSetupSection.tsx`
- `components/settings/AddProviderInstanceDialog.tsx`
- `components/settings/providerStatus.ts`
- `routes/settings.providers.tsx`
- `components/ProviderUpdateEnvironmentRows.tsx`
- `components/chat/ProviderStatusBanner.tsx`
- `components/chat/ThreadErrorBanner.tsx`

Listed but left unchanged because they contain no authored copy:
- `ProviderSettingsForm.tsx`
- `AddProviderInstanceWizardSteps.tsx`
- `ProviderUpdateLaunchNotification.tsx`
- `onboarding/providerReadiness.logic.ts`

`ProviderUpdatePrimaryNotification.tsx` (named in the plan) does not exist in this tree.

## Step 3: structured provider failures

**New function `getProviderRecoveryGuidance(provider)`** in `providerStatus.ts`:
- It returns a Korean `{cause, action}` pair, or null.
- It is derived only from fields that already exist: `enabled`, `status`, `installed`, `auth.status`, `setup.canInstall`/`canAuthenticate`, `driver`, and `versionAdvisory.status === "behind_latest"`.
- Cases covered: not installed, unauthenticated (setup action vs CLI action), error, warning, and version behind.
- The shape returned by `getProviderSummary` is unchanged.

**ProviderInstanceCard (editor):**
- The Korean cause (bold) and recovery action are shown first.
- Below them is the existing single `원문 진단 및 복구 안내` disclosure button, still with `aria-expanded` and `aria-controls`. It renders only when `summary.detail` is set, exactly as at HEAD, so the Providers page still has at most one.
- The controlled panel now shows a `원문 진단` label followed by `provider.message` byte-exact (mono, `select-text`, pre-wrap).
- With no raw message, the panel shows the Korean fallback detail as before.
- The panel element changed from `<p hidden>` to `<div hidden>` with the same id. It needed that to hold a label and a body.

**ProviderStatusBanner:**
- Order: title (Korean cause, e.g. `Codex 로그인 필요` / `Codex 공급자 상태`), then the Korean recovery line, then a generic action line for error/warning with a message (`원문 진단을 확인한 뒤 …`), then `원문 진단: <raw message>` (raw, clamped, with the full text in the tooltip).
- `getProviderStatusMessage` still returns the raw message when one is present (the model picker uses it), otherwise the Korean recovery text.

Raw CLI/server messages are never translated. Commands such as `codex login` appear only inside raw diagnostics or in providerReadiness commands, and neither is touched.

## Strings intentionally left untranslated

| file:line | text | class |
|---|---|---|
| components/settings/ProviderInstanceCard.tsx:278 | `VARIABLE_NAME` placeholder | identifier example (env-var name) |
| components/settings/CustomModelEditor.tsx:244 | `optionId` placeholder | identifier example |
| components/settings/ProviderModelsSection.tsx:28-31 | `gpt-6.7-codex-ultra-preview`, `claude-sonnet-5`, `claude-sonnet-4-6`, `openai/gpt-5` placeholders | model identifiers |
| components/settings/ProviderModelsSection.tsx:646 | `model-slug` placeholder | identifier example |
| components/settings/AddProviderInstanceDialog.tsx:315 | `${driver}_work` placeholder | instance-id example (identifier) |
| components/settings/AddProviderInstanceDialog.tsx:79-94 | `Github Copilot`, `Gemini`, `ACP Registry`, `Pi Agent` | product/provider names (not on the approved Latin list; flagged below) |
| components/settings/ProviderSetupSection.tsx:476 | `http://127.0.0.1:...` placeholder | URL |
| components/settings/ProviderSetupSection.tsx:253 | `Antigravity` fallback display name | allowed proper name |
| components/settings/ProviderSettingsPanel.tsx:641 | `console.warn("Failed to refresh providers")` | not user-visible |
| i18n/ko.providers.ts (setup.*, banner.signInWithGoogleViaSetup) | `Google` inside Korean labels | brand name, not on the approved list; flagged below |
| i18n/ko.providers.ts setup.callbackLabel | `localhost` | host name literal |
| i18n/ko.providers.ts | `PATH`, `MB`, `ID` | env-var name / units / 2-letter segments |

## Tests updated (copy assertions only, now referencing the catalog)

- `components/settings/providerStatus.test.ts`: the headline equalities (Available/Unavailable/Needs attention/Not authenticated/Disabled) now point to `ko.providers.status.*` / `ko.common.*`.
- `components/settings/ProviderInstanceCard.test.ts`: "Authenticated as", the email-toggle aria-label, and "Unavailable" now point to the catalog.
- `components/chat/ProviderStatusBanner.test.tsx`: the install-via-setup message is now `ko.providers.banner.installViaSetup("Antigravity")`.
- `components/settings/ProviderSettingsPanel.environment.test.tsx`: refresh sr-only text, Add provider aria-label, "Limited permissions" and "Advanced" titles.
- `components/settings/ProviderSetupSection.test.tsx`:
  - `Signed in with Google.`, `Sign in with Google`, `Remove downloaded runtime` and `Sign out of Google` now point to the catalog.
  - The installation-message fixture `Checking the downloaded runtime.` was changed to `ko.providers.setup.verifyingDownload`. This keeps the "shown only once" deduplication check meaningful.
  - The server auth fixture `Google sign-in complete.` was left raw.
- `components/settings/ProviderModelsSection.test.ts`: "Add custom model", "Add", "Cancel".

## Commands run (from app/t3code, Node 24.19.0)

1. `pnpm exec vp fmt <22 files>`: exit 0. `pnpm exec vp fmt --check <22 files>`: exit 0, "All matched files use the correct format".
2. `pnpm exec vp lint <22 files>`: exit 0 with 3 warnings, all on lines this change did not touch (pre-existing):
   - ProviderModelsSection.tsx:227 (effect dependencies)
   - ProviderSettingsPanel.tsx:325 (set-state-in-effect)
   - ProviderUpdateEnvironmentRows.tsx:360 (ref during render)

   A 4th warning was caused by me: a catalog key named `useAccent` was read as a hook. I renamed it to `accentSwatch`, and the warning is gone.
3. `pnpm --filter @t3tools/web typecheck`: exit 1, with 916 errors, all in other groups' files (LegacySidebar, SettingsPanels, SnapShot*, Theme*, Keybindings*, ko.ts duplicate keys, …). The grep over every one of my file basenames and my tests found 0 errors.
4. `pnpm exec vp test run --project unit` on 16 files (all provider tests, ThreadErrorBanner, providerReadiness, ProviderUpdate*, customModelEditor.logic).
   - **Before my edits (HEAD):** 1 failed, 193 passed. The failure is `ProviderInstanceCard.test.ts > surfaces a failed probe message in both the list row and the editor`: the list row does not contain the raw message ("is not a symlink"). This is the inherited CI failure.
   - **After my edits:** 182 passed, with these failures:
     - The same inherited ProviderInstanceCard failure, same assertion, still failing. I did not change its behavior: list mode shows only the headline. I only switched its "Unavailable" assertion to the catalog value.
     - `ProviderSettingsPanel.environment.test.tsx` fails to load, so its tests did not run. The error is `TypeError: Cannot convert undefined or null to object` at `components/settings/KeybindingsSettings.logic.ts:339` (`ko.settings.keybindings.commands`), imported through settingsSearch.ts and UsageProviderSettings.tsx. Another group owns that file and it is mid-edit; this is not caused by my files. The test file's copy assertions are already updated, and it needs a re-run once the keybindings group lands.

## Fit, behavior, and open questions

- **Wider label in a fixed-width element.** The `w-14` "Option N" label in CustomModelEditor.tsx becomes `옵션 N`, which is shorter. No other required label in a fixed-width element got longer.
- **Brand names outside the approved Latin list.** I kept `Google` (also in existing shipped Korean strings that tests pin), `Github Copilot`, `Gemini`, `ACP Registry` and `Pi Agent` as brand names. The lead should decide whether to add them to the allowed list or transliterate them.
- **Strings outside my files that still render English on provider surfaces:**
  - `SettingResetButton` in settingsLayout.tsx wraps my label as `Reset ${label} to default`, plus the "Reset to default" tooltip.
  - `getRelativeTimeState` in timestampFormat.ts returns "just now" / "5m ago", which appears after `마지막 확인`.
  - `ADD_PROVIDER_WIZARD_STEPS` step labels in AddProviderInstanceDialog.logic.ts.
  - `validateDraft` messages in customModelEditor.logic.ts.
  - Field labels and descriptions from contract schema annotations, plus the `titleizeFieldKey` fallback, in ProviderSettingsForm.
  - `searchableSetting("provider-health-check-interval").title` in settingsSearch.ts.
  - ProviderUpdateLaunchNotification.logic.ts (update summary and result views).
  - `connectionStatusTitle` from client-runtime.
- **Device tabs label.** The device tab group's aria-label is `기기 선택` rather than `기기`, so it cannot collide with the pinned `기기` name.
- **Label placeholder vs slug.** The Add-instance label placeholder is now `예: 업무`. The instance-id slug derivation still keeps only `[a-z0-9]`, so a Korean label produces an empty derived ID and the user has to type one. That is existing behavior; only the placeholder hint changed.
- **Pinned strings.** These are shipped exactly as pinned: `원문 진단 및 복구 안내`, `공급자 추가`, `공급자 설정 열기`, `Codex 공급자 오류 닫기` (pattern), `사용자 지정 모델 추가`, `취소`.
