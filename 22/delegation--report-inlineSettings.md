# Report: group inlineSettings (round 3)

Worktree: /Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-22. No commits and no git state changes.

## Files changed (S = app/t3code/apps/web/src)

Components:
- S/components/settings/SourceControlSettings.tsx
- S/components/settings/ConnectionsSettings.tsx
- S/components/settings/IntegrationsSettings.tsx
- S/components/settings/KeybindingsSettings.logic.ts
- S/components/settings/KeybindingsSettings.tsx
- S/components/settings/SnapShotSettings.tsx
- S/components/settings/ProviderModelsSection.tsx

Catalogs:
- S/i18n/ko.settingsServices.ts
- S/i18n/ko.settingsTools.ts
- S/i18n/ko.providers.ts

No test files changed. No colocated test asserted any of the moved strings (I grepped every *.test.ts(x) under src).

## Catalog keys added (42 entries; every inline literal in the scope is gone)

- settings.connections (6): emptyRemoteTitle, emptyRemoteDescription, hostAccessDisconnected, hostAccessScopeBefore, hostAccessScopeAfter, addEnvironmentDescription
- settings.sourceControl (17): authAuthenticated, authUnauthenticated, authUnknown, toolStatus(status), toolInstalled, installRequired, installRequiredLabel, builtInIntegration, authStatus(label), summaryInstallOnHost, summaryReady, summaryAuthSeparate, summaryAuthUnknown, setupGuide(label), setupGuideIntro, toolDiagnostic(detail), rawDiagnostic(detail)
- settings.integrations (3): linkTargetSystem, linkTargetApp ("Weavra"), linkTargetDescription
- settings.keybindings (14): whenLabels {terminalFocus, terminalOpen, previewFocus, previewOpen, modelPickerOpen, isWeb, isDesktop, always, never} (new frozen sub-namespace), whenCustom(name), whenNot(inner), whenAnd(left,right), whenOr(left,right), rawExpressionLabel, parseErrorHint, customPreserved, advancedCondition, advancedDescription(explanation), rawExpressionPrefix, aliasCount(count)
- settings.snapshots (2): activeWindowCapture, attachToDraft
- providers.models (2): modelId, modelIdHint
- Reused ko.common.close for the KeybindingsSettings dialog close button ("닫기").

The `WHEN_VARIABLE_LABELS` map keeps its machine when-variable IDs (including `true` and `false`) as keys; only the values now come from the catalog.

## Value changes (everything else is byte-identical in rendered text)

- IntegrationsSettings link-target description: "⌘ 또는 Ctrl을 누른 채" became "⌘ 또는 컨트롤 키를 누른 채" (round-2 keycap rule).
- ConnectionsSettings hostAccess message: `access:write` is now wrapped in `<code>` inside the existing `<p>`. The sentence is split around it into hostAccessScopeBefore and hostAccessScopeAfter. The text content is unchanged.
- SourceControlSettings "설치 필요: ${installHint}": the install command is now wrapped in `<code>` inside the existing `<span>`, with prefix installRequiredLabel "설치 필요:". The text content is unchanged.
- Why the split and not a function: ko.test.ts requires every copy function to return a string, so a function cannot return a JSX-bearing array.

## Strings intentionally left untranslated or inline

- ConnectionsSettings.tsx: `access:write` inside `<code>` is a permission-scope identifier.
- KeybindingsSettings.tsx: `expression || "true"` inside `<code>` is the raw when expression.
- SourceControlSettings.tsx: `item.installHint` inside `<code>` and `<pre>` is a command.
- Catalog: "Tailscale" in the connections descriptions and "Weavra" in linkTargetApp are allowed proper names.
- Catalog: "ID" in modelId and modelIdHint is a two-letter segment, below the 3-letter rule.
- Catalog: "!, &&, ||" in parseErrorHint is when-expression syntax.
- whenCustom(name) embeds the user's custom when identifier `node.name` in a sentence. It is a plain string consumed as text, so it cannot take `<code>`. Reported, not changed.
- Re-scan: none of the 7 component files has a non-comment line with an inline Hangul literal any more.

## Commands (from app/t3code unless noted)

1. `pnpm exec vp fmt <10 files>` then `pnpm exec vp fmt --check <10 files>`: exit 0, "All matched files use the correct format."
2. `pnpm exec vp lint <10 files>`: exit 0, 6 warnings. I checked each against `git diff -U0` hunks and all 6 are outside changed lines, so there are no new warnings:
   - SourceControlSettings.tsx:283 set-state-in-effect
   - ProviderModelsSection.tsx:227 exhaustive-effect-dependencies
   - SnapShotSettings.tsx:177, 182 and 205 set-state-in-effect
   - ConnectionsSettings.tsx:2220 preserve-manual-memoization
3. `pnpm --filter @t3tools/web typecheck`: exit 0. Grepping the output for my file basenames found no matches.
4. From apps/web, `pnpm exec vp test run --project unit` on these 7 files:
   - KeybindingsSettings.logic.test.ts
   - IntegrationsSettings.test.tsx
   - SnapShotSettings.test.tsx
   - ProviderModelsSection.test.ts
   - ConnectionsSettings.logic.test.ts
   - SourceControlSettings.test.tsx
   - i18n/ko.test.ts

   Result: 6 files passed, and 1 file failed with 2 tests, 94/96 tests passing. The 2 failures are in ko.test.ts ("contains only non-empty copy and copy functions" and "uses every declared parameter of dynamic copy"). Both are caused by another group's file: `S/i18n/ko.transferB.ts:48` `providerList: (names: ReadonlyArray<string>) => names.join(", ")` throws "names.join is not a function" when the test passes sample numbers or strings. Not mine, not touched.
5. Scratch check, a temporary test file created and deleted: I walked my namespaces (connections, sourceControl, integrations, keybindings, snapshots, providers.models; 649 entries) and called each function with string samples. Only `settings.keybindings.conflictsWith` was flagged, a pre-existing key I did not add. The flag means its output does not contain a raw sample argument verbatim, which may be fine. Every key I added passed, and every namespace is frozen.

## Concerns

- Pre-existing `settings.connections.administrativeAccessDescription` (catalog, earlier round) also embeds `access:write` in a sentence. It is outside this round's listed lines, so I left it.
- No fit concerns: the label lengths are unchanged.
