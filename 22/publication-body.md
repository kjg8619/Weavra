## Problem and change

The audited work surfaces mixed Korean with English authored copy: settings pages, navigation, breadcrumb and search, providers, connections, keybindings, SnapShots, diagnostics, project and Weavra settings, chat, both sidebars, panels, dialogs and onboarding. This change moves every reachable authored string on those surfaces into the typed, frozen Korean catalog `app/t3code/apps/web/src/i18n/ko.ts` and keeps everything that is data exact.

- Settings navigation, breadcrumb and search metadata are Korean; the former English titles and terms stay as search aliases, so translated destinations remain findable in either language.
- Structured provider failures show a catalog-backed cause and recovery action first, then the separately labelled original ("원문 진단", rendered as a labelled `<pre>`), byte-exact.
- Raw Weavra enums stay behind `weavraLabels`; every value of the five contract enums has a Korean label, enforced by `src/i18n/ko.test.ts`.
- Korean wraps between words (`html { word-break: keep-all; overflow-wrap: break-word; }`) and the document language is `ko` (Amendment 2026-10-22).
- Layout fixes stay inside owned files and existing roles: explanatory text uses the 14 px `text-sm` role, Korean labels drop uppercase letter-spacing, narrow metric grids collapse, selected values and section names are never truncated, and diagnostics table widths scale with text size.
- Unchanged by design: commands (`codex login`, `weavra setup`), IDs, endpoints, model identifiers, license text, user and fixture content, and the custom-model preset values that are stored and sent (the picker shows Korean names; `customModelEditor.logic.test.ts` locks the stored and sent labels byte-identical).

Closes: W-03.
Base: `hig/21-adaptive-chat` at `245a9efdfee4e949a5d312798bcdbf31ed0c1675` ([PR #93](https://github.com/kjg8619/Weavra/pull/93)).
Head: `bb118bc4c85f6fd2f849c190ecbd8615c4ce4dc4`.
Runner: [`daa942df`](https://github.com/kjg8619/Weavra/commit/daa942df567e52cf47453535083ff139f10d3885) (`scripts/hig` identical at head).
Parent app.asar: `51e20917fe73274b483bb1d89766b18845706fac13e8408b454224cf78481a31`.
Head app.asar: `3662efa41ee3daa102c1e5caf7e16afb7c07f27e864c0ef363fdfeede49c5bd8`.
Scope: plan todo 22 plus lead Amendments 2026-10-21b, 2026-10-22, 2026-10-22b, 2026-10-22c, 2026-10-22d, 2026-10-22e, 2026-10-22f, 2026-10-22g, 2026-10-22h and 2026-10-22i ([ownership.json](https://github.com/kjg8619/Weavra/blob/hig-evidence/22/22/ownership.json), 136 source files, 38 colocated tests).

## Before / after

[Complete 158-pair image table, the rules a-j measurement frames and both acceptance rounds](https://github.com/kjg8619/Weavra/blob/hig-evidence/22/22/image-table.md).

| State, size, theme | Parent | Head | Diff |
|---|---|---|---|
| `1280x800/17_settings_general.png` | ![before](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/22/22/before--capture--1280x800--17_settings_general.png) | ![after](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/22/22/after--capture--1280x800--17_settings_general.png) | [diff JSON](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/22/22/diff--1280x800--17_settings_general.json) |
| `1280x800/22_settings_providers.png` | ![before](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/22/22/before--capture--1280x800--22_settings_providers.png) | ![after](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/22/22/after--capture--1280x800--22_settings_providers.png) | [diff JSON](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/22/22/diff--1280x800--22_settings_providers.json) |
| `1280x800/20_settings_keybindings.png` | ![before](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/22/22/before--capture--1280x800--20_settings_keybindings.png) | ![after](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/22/22/after--capture--1280x800--20_settings_keybindings.png) | [diff JSON](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/22/22/diff--1280x800--20_settings_keybindings.json) |
| `1280x800/07_chat_empty_project.png` | ![before](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/22/22/before--capture--1280x800--07_chat_empty_project.png) | ![after](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/22/22/after--capture--1280x800--07_chat_empty_project.png) | [diff JSON](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/22/22/diff--1280x800--07_chat_empty_project.json) |
| `390x844/42_narrow_chat_dark.png` | ![before](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/22/22/before--capture--390x844--42_narrow_chat_dark.png) | ![after](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/22/22/after--capture--390x844--42_narrow_chat_dark.png) | [diff JSON](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/22/22/diff--390x844--42_narrow_chat_dark.json) |

## Rules a-j self-measurement

Head and unchanged parent measured by the same script (`tools/measure-22.mjs`, sha256 `03bf03d48065ef7fec1cd8bd189b548bd0f0476893f0b173adc517625227640d`). [Full table, method and pre-existing sources](https://github.com/kjg8619/Weavra/blob/hig-evidence/22/22/rules-a-j.md).

| Rule | Head failures | Introduced by this change | Parent failures |
|---|---|---|---|
| b | 1 | 0 | 609 |
| c | 2328 | 0 | 12417 |
| d | 0 | 0 | 945 |
| e | 24 | 0 | 24 |
| f | 0 | 0 | 0 |
| i | 452 | 0 | 2121 |
| j | 50 | 0 | 50 |
| ax | 12 | 0 | 91048 |
| a (recorded, copy-only geometry) | 12160 | 358 above the parent count | 12142 |

Every remaining head failure for b, c, e, i and j is one the parent also has on the same element and configuration.

Rule `ax` now classifies every visible text node. Its 12 head rows were each assigned to an approved exception class by an explicit rule (host name (data): 12); 0 remain unclassified ([review](https://github.com/kjg8619/Weavra/blob/hig-evidence/22/22/measure-after--ax-review.json)).

## Locale exceptions

[Full locale-exception table with source and approval per class](https://github.com/kjg8619/Weavra/blob/hig-evidence/22/22/locale-exceptions.md).

| Class | Examples (file or catalog key) | Why it stays | Approval |
|---|---|---|---|
| Product and brand names | Weavra, Codex, Claude, Claude Code, Cursor, Grok, OpenCode, Antigravity, SnapShots, GitHub, GitLab, Bitbucket, Forgejo, Gitea, Azure DevOps, T3 Connect, T3 Chat, VS Code, Xcode, Android Studio, VoiceOver, Face ID, Liquid Glass, Mac mini, Niri, Hyprland, Omarchy, Google, Gemini, Vertex AI | Proper names | localeAudit allowlist, Amendments 2026-10-22c/d |
| Tools, VCS, platforms | Git, Mercurial, Jujutsu, Tailscale, Tailscale Serve, MagicDNS, macOS, iOS, Android, Windows, Linux, WSL | Proper names | allowlist |
| Protocols, formats, acronyms | HTTPS, HTTP, URL, API, SSH, CLI, JSON, QR, CPU, GPU, PID, RGB, OTEL, MCP, LSP; image formats GIF/HEIC/HEIF/JPEG/PNG/WebP (`chat.composer.unsupportedImageType`) | Technical names, no Korean equivalent in use | allowlist, Amendment 2026-10-22d |
| Weavra component names | Runtime, Kernel ("Runtime 실행 제어", "Runtime 계획 미리보기") | Component names | allowlist |
| Keycaps | ⌘ ⇧ ⌥ ⌃ ↑ ↓ ← →, Ctrl, Alt, Enter, Esc, Backspace inside `<Kbd>`/`[data-slot=kbd]` | Physical key labels; prose uses 엔터 키, 시프트 키, 컨트롤 키 | Amendment 2026-10-22c (A): keycaps only inside keycap elements |
| Commands and shell syntax | `codex login`, `weavra setup`, `weavra doctor`, `weavra-server pair`, `bun test` placeholder, `git status`, slash commands (/model, /plan, /default), when-expression syntax `!`, `&&`, `||` | Must stay exact and copyable | Brief: do not translate commands |
| Identifiers and data tokens | `access:write`, `t3.json`, `keybindings.json`, `T3_WEAVRA_EXECUTABLE`, SIGINT/SIGKILL, model ids, provider instance ids, SPDX license ids (in `<code>`), process names, span names, package names/versions | Machine values, each in its own element where the sentence allows | Amendment 2026-10-22c (A): data patterns in their scoped fields |
| Endpoints, URLs, paths | `http://127.0.0.1:3774/`, `https://hub.example.ts.net:8318`, `~/.config/niri/config.kdl` | Endpoints and paths | Brief |
| User and fixture content | Thread titles, messages, code blocks, terminal output, user profile and script names, seeded fixture model "Claude Fable 5.1", system font names (SF Pro, Menlo) | User data / exact seeded values | Brief; Amendment 2026-10-22c (A): fixture text by exact seeded value |
| Local file and environment names | File-name chips in the composer and font preview (`surface.test.ts`, `SettingsPanels.tsx`), the local environment name from the server config on Connections and onboarding | Real file and machine names, shown as data in their own elements | Amendment 2026-10-22g (B); runner `daa942df` scoped classes |
| Original diagnostics | Provider `message` under the separately labelled "원문 진단", raw error causes, health errors | Original text kept byte-exact behind the Korean cause and action | Plan step 3 |
| License text | Third-party notices, package names, license ids | Legal original | Brief |
| Wire data with a Korean display | Custom-model preset labels (Reasoning, Speed, Fast Mode, Thinking, Agent, Low...Max): stored and sent byte-identical; the picker shows 추론 수준 / 속도 / 빠른 모드 / 사고 과정 / 에이전트 | Persisted and sent values | Amendment 2026-10-22d (3); test `customModelEditor.logic.test.ts` "adds built-in presets with their original wire labels" |
| Built-in names with a Korean display | Browser profiles "Default"/"Incognito" are stored as is and shown as 기본 프로필 / 시크릿; default terminal names "Terminal N" stay in terminal context and show as 터미널 N | Stored or context data | Copy-only display mapping |
| Machine-consumed search data | `englishTitle`, English `searchTerms`, `SETTINGS_SECTION_SEARCH_ALIASES` | Never displayed; keeps English typing able to find translated destinations | Plan step 2 |
| Not user-visible | `console.*` messages, developer invariant errors, JSDoc examples | Never rendered | n/a |
| Two-letter segments | PR, OS, ID, T3 | Under the three-letter Latin rule | runner localeAudit |
| Run-state and protocol identifiers | `R3` risk tier, `CANDIDATE_ONLY`, review decisions `REVISE`/`BLOCK`, error codes (`TARGET_CHANGED`, `UNSUPPORTED_WORKFLOW`), Git `HEAD`, `sha256:` digests, `lines.start/end` fields, `CDP` | Protocol and wire identifiers, shown beside Korean copy; workflow, mode and status values themselves show Korean labels | Amendment 2026-10-22i |
| Formats and units | YAML, Markdown, CSV; KiB, MiB, GB, MB, B/s, ms, px; the 22f timer units h/m/s | Format names and unit symbols | Amendments 2026-10-22f/i |
| External product and platform names | Xcode Settings > Components, Android Studio > Device Manager, GitHub Actions, Finder, Apple Silicon, Intel, GNOME, Unix | Names of other products and their own menus | Amendment 2026-10-22i |
| Built-in theme names | T3 Chat, Grove, Ocean, Ember, Iris | Theme proper names | runner built-in theme class |
| Provider product names (Add provider list) | GitHub Copilot, ACP Registry, Pi Agent | Product names | Amendment 2026-10-22i |
| Original provider message after a Korean status | `Codex CLI is not authenticated. Run \`codex login\` and try again.` on onboarding and the thread provider banner (server `message`, CodexProvider.ts) | Original server diagnostic kept byte-exact behind the Korean status | Amendment 2026-10-22i |
| OS clock format | AM/PM in message timestamps (for example "10/18 6:00 PM") | Follows the OS locale and the 12/24-hour setting, as the setting states | n/a (system format) |

## QA-22 fixes (Amendment 2026-10-22i)

- The workflow command status and the host thermal state render through Korean display maps that cover every value (`ko.runtime.controls.commandStatus`, `ko.settings.telemetry.thermalStates`), with unit tests over every enum value in `src/i18n/ko.test.ts`; the raw values stay unchanged in logic.
- Workflow and run-state identifiers in Weavra prose show their Korean labels (QUICK/STANDARD/COMPLEX, EDIT/READ_ONLY, interrupted/blocked/cancelled/failed, pass/complete/valid); `R3`, `CANDIDATE_ONLY`, review decisions and error codes stay as identifiers (exception table).
- Settings navigation labels wrap and the row grows instead of being cut off. The label text stays "키보드 단축키" because the shared runner pins that exact name.
- Remaining English from the all-state sweep is Korean: model count, "Run", "digest", "Policy", "Early Access", keycap words in prose and the zoomable-image name; "GitHub Copilot" is spelled as the product name.

## All-state locale sweep

Every captured state at every size (152 frames of head `bb118bc4c85f6fd2f849c190ecbd8615c4ce4dc4`) was read and every Latin segment classified: 708 distinct segments, 0 unclassified ([inventory](https://github.com/kjg8619/Weavra/blob/hig-evidence/22/22/capture-latin--capture-latin-inventory.json), [unclassified](https://github.com/kjg8619/Weavra/blob/hig-evidence/22/22/capture-latin--capture-latin-unclassified.json)).

The rules a-j measurement now classifies every visible text node, mixed Korean and Latin included (rule `ax` above; per-segment classes in [latin-inventory.json](https://github.com/kjg8619/Weavra/blob/hig-evidence/22/22/measure-after--latin-inventory.json)).

## Long-copy stress (QA-22 method)

QA-22's own stress script re-run unchanged except for the app and output paths and one readiness wait (QA's fixture database now has "03 Code blocks" archived, so it waits on "06 Empty thread", which the script opens anyway) ([script](https://github.com/kjg8619/Weavra/blob/hig-evidence/22/22/tools--qa22-stress--stress.mjs), [summary](https://github.com/kjg8619/Weavra/blob/hig-evidence/22/22/stress-qa22--stress-summary.json)): 72 samples over 12 configurations (840/1280/1920, 100/150%, light/dark) with at least +40% Korean copy.

| Check | Result |
|---|---|
| Settings navigation ellipsis | 0 |
| Scope identity names (ellipsis with full-value tooltip) | 16 |
| Page overflow | 0 |
| Korean mid-word / orphan breaks | 0 |
| Expansion below +40% | 0 |

## Follow-up (not in this PR)
Git and pull-request vocabulary in 16 unowned files that are not on the audited states (menus, PR panel): 114 Korean strings still use English Git terms. Lead decision 2026-10-22i (B): not in this PR, listed here as a named follow-up.

Files: `BranchToolbarBranchSelector.tsx`, `BranchToolbarEnvModeSelector.tsx`, `DiffPanel.tsx`, `GitActionsControl.logic.ts`, `GitActionsControl.tsx`, `chat/WorktreeSetupCard.tsx`, `pullRequest/LinkPullRequestDialog.tsx`, `pullRequest/PullRequestCodeTab.tsx`, `pullRequest/PullRequestDetailPanel.tsx`, `pullRequest/PullRequestLabelPicker.tsx`, `pullRequest/PullRequestReviewerPicker.tsx`, `pullRequest/PullRequestStackMenu.tsx`, `pullRequest/PullRequestTimelineTab.tsx`, `pullRequest/ThreadPullRequestsPanel.tsx`, `pullRequest/pullRequestDetail.logic.ts`, `pullRequest/pullRequestLinkContextMenu.ts`.

Proposed glossary: commit 커밋, push 푸시, pull 풀, branch 브랜치, ref 참조, worktree 작업 트리, checkout 체크아웃, host 호스트, rebase 리베이스, merge 병합, stash 스태시, upstream 업스트림, patch 패치, feature 기능, base 기준, triage 분류, Squash and merge 스쿼시 후 병합, Rebase and merge 리베이스 후 병합; the remote name `origin` stays verbatim.

## Verification

| Gate | Command | Exit | Result |
|---|---|---|---|
| fmt --check (changed files) | `pnpm exec vp fmt --check <174 changed app/t3code files>` | 0 |  |
| lint (changed files) | `pnpm exec vp lint <172 changed ts/tsx files>` | 0 |  |
| typecheck web | `pnpm --filter @t3tools/web typecheck` | 0 |  |
| typecheck desktop | `pnpm --filter @t3tools/desktop typecheck` | 0 |  |
| plan focused tests | `vp test run --project unit src/i18n/ko.test.ts src/components/settings/settingsSearch.test.ts src/components/settings/KeybindingsSettings.logic.test.ts` | 0 | Tests  108 passed (108) |
| web unit suite | `vp test run --project unit (apps/web)` | 1 | Tests  2 failed | 5700 passed (5702) |
| desktop suite | `vp test run (apps/desktop)` | 0 | Tests  1247 passed | 46 skipped (1293) |
| runner harness | `bun test scripts/hig/harness.test.ts` | 0 | 131 pass |
| lint warnings | same files at head and parent | | 183 at head, 183 at parent, 0 new |
| accept_pr 22 round 01 | `assert.mjs --case 22` + `--verify-packet` + `git diff --check` | 0 | product PASS, 6/6 checks PASS, app exited |
| accept_pr 22 round 02 | `assert.mjs --case 22` + `--verify-packet` + `git diff --check` | 0 | product PASS, 6/6 checks PASS, app exited |
| W-33 regression | `assert.mjs --case 21` on the final build | 0 | 7/7 PASS ([receipt](https://github.com/kjg8619/Weavra/blob/hig-evidence/22/22/regression-21--scenario-receipt.json)) |

Inherited web failures (identical at the parent `245a9efd`, Tests  2 failed | 15 passed (17); [log](https://github.com/kjg8619/Weavra/blob/hig-evidence/22/22/logs--tests-parent-inherited.log)):

- `src/components/settings/ProviderInstanceCard.test.ts > deriveProviderModelsForDisplay > surfaces a failed probe message in both the list row and the editor`
- `src/components/ThreadNotificationCoordinator.badge.test.tsx > shows in-app alerts without adding a badge while focused`

Capture: parent `245a9efdfee4e949a5d312798bcdbf31ed0c1675` and head `bb118bc4c85f6fd2f849c190ecbd8615c4ce4dc4`, 158 paired frames; [gate results](https://github.com/kjg8619/Weavra/blob/hig-evidence/22/22/gate-results.json), [lint comparison](https://github.com/kjg8619/Weavra/blob/hig-evidence/22/22/lint-comparison.json), [fixture retention](https://github.com/kjg8619/Weavra/blob/hig-evidence/22/22/fixture-retention.json).
