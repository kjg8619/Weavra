# Group run (round 2)

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

Your catalog file: app/t3code/apps/web/src/i18n/ko.workspace.ts (shared with nobody this round).
Your sub-namespaces: runtime.{task} in ko.workspace.ts (new), plus editing existing values in ko.workspace.ts

Your files (paths relative to app/t3code/apps/web/src; edit nothing else except colocated tests that assert changed copy):
- components/settings/WeavraControls.tsx
- components/settings/WeavraSettings.tsx
- components/settings/WeavraComplex.tsx
- components/settings/WeavraFitness.tsx
- components/settings/ProjectSettingsPanel.tsx
- components/settings/CapabilityInventory.tsx
- components/chat/WeavraTaskResult.tsx
- components/chat/WeavraTaskCard.tsx
- components/chat/weavraTaskLogic.ts
- components/chat/useWeavraTask.ts
- i18n/ko.workspace.ts

## Group-specific instructions

Your job: translate "Run" to 실행 everywhere in these files and in ko.workspace.ts values (verb and Weavra entity), and migrate the remaining inline authored copy of WeavraComplex.tsx, WeavraTaskResult.tsx, WeavraTaskCard.tsx, weavraTaskLogic.ts and useWeavraTask.ts (Korean or English) into the catalog under ko.runtime.task (add it in ko.workspace.ts under runtime). Also translate other leftover Latin generic words in their copy (e.g. "worker 호출" -> "워커 호출", revision -> 리비전, Diff -> 변경 사항 when it is a label, REVISE/BLOCK are verdict enums: show them via weavraLabel if a label exists, else keep raw in <code>). Raw IDs (runId, digests, revisions), enum values and commands stay verbatim. The Project settings section title "Weavra · 워크플로 제어" is referenced by WeavraRunGraphPanel.tsx via ko.devices.runGraphPanel.readinessHint("Weavra · 워크플로 제어"); expose the section title as a catalog constant and tell the parent its key (do not edit WeavraRunGraphPanel.tsx). Runner-pinned strings in these files must stay exact: Runtime 실행 제어, Runtime 계획 미리보기, 워크플로 준비, 워크플로 목표, 확인 후 시작, 증거 요약, 순위가 아닌 계약 준수 증거, 기록 불러오기, 증거, 기록, 기간, 단위, 실패, 지속되는 입력 목적, 직접 지정…, 직접 미루기 (check cases.mjs read-only for exact use). Update tests that assert changed copy (WeavraControls.test.tsx, WeavraTaskResult/TaskCard tests, weavraTaskLogic tests, CapabilityInventory.test.tsx).

Write your final report also to /Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-22/delegation/report-run.md.
