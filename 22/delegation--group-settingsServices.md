# Group settingsServices

Read and follow /Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-22/delegation/shared-brief.md first.

Your catalog file: app/t3code/apps/web/src/i18n/ko.settingsServices.ts (export koSettingsServices).
Your sub-namespaces: settings.{connections, storage, sourceControl, integrations}

Your files (paths relative to app/t3code/apps/web/src; edit nothing else except colocated tests that assert changed copy):
- components/settings/ConnectionsSettings.tsx
- components/settings/EnvironmentRow.tsx
- components/settings/StorageSettings.tsx
- components/settings/SourceControlSettings.tsx
- components/settings/IntegrationsSettings.tsx

## Group-specific instructions

Row titles that come from settingsSearch.ts are owned by another group; translate only strings that are literally in your files. Existing tests (ConnectionsSettings.logic.test.ts, IntegrationsSettings*.test.*, SourceControlSettings.test.tsx, etc.) must pass; update copy-equality assertions only. Unowned helper files (e.g. ConnectionsSettings.logic.ts, DeviceHostEditor.tsx, GitHubRoutingSettings.tsx) are NOT yours: list visible copy there with file:line in your report instead of editing.

Write your final report also to /Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-22/delegation/report-settingsServices.md.
