# Group inlineSettings (round 3): move the remaining inline Korean settings copy into the catalog

Read and follow /Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-22/delegation/shared-brief.md first,
and the round-2 rules in group-transferA.md ("Additional rules for this round" section only).

These files still hold authored copy as inline Korean string literals and JSX text. Plan todo 22
step 1 requires all authored copy to live in the typed catalog. Move every inline authored Korean
string to its existing group catalog, which you own this round:
- `i18n/ko.settingsServices.ts` (settings.sourceControl, settings.connections, settings.integrations) for:
  - components/settings/SourceControlSettings.tsx (lines ~151-346)
  - components/settings/ConnectionsSettings.tsx (~1779-1789, ~3735)
  - components/settings/IntegrationsSettings.tsx (~535, ~547)
- `i18n/ko.settingsTools.ts` (settings.keybindings, settings.snapshots) for:
  - components/settings/KeybindingsSettings.logic.ts (~47-112, the when-condition explanation)
  - components/settings/KeybindingsSettings.tsx (~664-1140)
  - components/settings/SnapShotSettings.tsx (~387-391)
- `i18n/ko.providers.ts` (providers.models) for components/settings/ProviderModelsSection.tsx (~615-621)

Values stay byte-identical except where they break a round-2 rule. For example, IntegrationsSettings.tsx:547
says "⌘ 또는 Ctrl을 누른 채": a keycap name in prose becomes "⌘ 또는 컨트롤 키를 누른 채". Dynamic copy
becomes parameter functions. Keep raw values (`access:write`, `expression || "true"`) in their <code> or
data positions. Do not move: comments, machine values, the when-variable IDs, or enum keys.

Verification is the same as in shared-brief.md. Colocated tests must pass. Update copy-equality
assertions to catalog references only where needed.

Write your final report also to /Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-22/delegation/report-inlineSettings.md.
