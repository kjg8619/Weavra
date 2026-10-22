# Group transferB (round 2)

Read and follow /Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-22/delegation/shared-brief.md first, then the round-2 rules below.

## Additional rules for this round (lead Amendment 2026-10-22c)

- Your files are outside the original todo-22 list and were transferred for COPY/CATALOG ONLY: no layout,
  class, behavior, command, data or wire change. Only displayed copy, aria/title/placeholder/tooltip text
  and toast/error copy change.
- "Run" is translated to 실행 everywhere (verb AND the Weavra execution entity): 공식 실행, 실행 리비전,
  실행 상태, 이전 실행. "Run 그래프" is already "실행 그래프". Runtime and Kernel stay.
- Keycap names (Ctrl, Alt, Shift, Cmd, Enter, Esc, Tab, Space, Up, Down, Left, Right) may appear ONLY
  inside keycap/kbd elements. In prose, aria-labels and option labels use Korean (엔터 키, 위쪽 화살표,
  아래쪽 화살표) or the symbols already used by the app (⌘ ⇧ ⌥ ⌃ ↑ ↓ ← →).
- Data tokens (model IDs, file names, env-var names, package names, paths, URLs, commands) must stay in
  their own element/field, never embedded inside a translated sentence, where the QA runner cannot tell
  them apart. Where existing copy embeds such a token in a sentence, keep it but wrap the token in
  <code> if the surrounding JSX already allows a child element; otherwise report it.
- Additional allowed proper names (only as names): Azure DevOps, Forgejo, Gitea, Google, Gemini, Vertex AI,
  GitHub Copilot, Claude Code, T3 Connect, MagicDNS, Tailscale Serve, Xcode, Android Studio, Face ID,
  VoiceOver, Liquid Glass, iOS, Android, Windows, Linux, macOS, theme names T3 Chat/Grove/Ocean/Ember/Iris,
  and CPU, GPU, PID, HTTP. "Electron" is translated (데스크톱).

Your catalog file: app/t3code/apps/web/src/i18n/ko.transferB.ts (export koTransferB).
Your sub-namespaces: providers.{accentColor, usage, addInstanceSteps, customModelValidation, updateToasts}, settings.{deviceHosts, sourceControlWriting, githubRouting, loadBalancing}

Your files (paths relative to app/t3code/apps/web/src; edit nothing else except colocated tests that assert changed copy):
- components/settings/ProviderAccentColorPicker.tsx
- components/settings/UsageProviderSettings.tsx
- components/settings/AddUsageLimitSourceDialog.tsx
- components/settings/AddProviderInstanceDialog.logic.ts
- components/settings/customModelEditor.logic.ts
- components/ProviderUpdateLaunchNotification.logic.ts
- components/settings/DeviceHostsSettings.tsx
- components/settings/DeviceHostEditor.tsx
- components/settings/SourceControlWritingSettings.tsx
- components/settings/GitHubRoutingSettings.tsx
- components/settings/LoadBalancingSettings.tsx

## Group-specific instructions

AddProviderInstanceDialog.logic.ts: ADD_PROVIDER_WIZARD_STEPS ("Driver","Identity","Config") are rendered as step labels; if they are also used as machine keys anywhere, keep the machine values and add a display-label map instead (check every use). ProviderUpdateLaunchNotification.logic.ts: toast titles/descriptions/status texts become Korean; keep raw error messages from providers/commands verbatim. Update colocated tests that assert this copy (e.g. ProviderUpdateLaunchNotification.logic.test.ts, customModelEditor.logic.test.ts, AddProviderInstanceDialog.test.ts, LoadBalancingSettings.test.ts, GitHubRoutingSettings.test.ts) to the catalog values.

Write your final report also to /Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-22/delegation/report-transferB.md.
