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
Head: `b95bacbb200e3e3925dec26766a1e5b0da7dee3a`.
Runner: [`daa942df`](https://github.com/kjg8619/Weavra/commit/daa942df567e52cf47453535083ff139f10d3885) (`scripts/hig` identical at head).
Parent app.asar: `51e20917fe73274b483bb1d89766b18845706fac13e8408b454224cf78481a31`.
Head app.asar: `2d76c80895ccef42b1961afdd61b853ceb3235ad2cc9c0cdae3be9298fe70919`.
Scope: plan todo 22 plus lead Amendments 2026-10-21b, 2026-10-22, 2026-10-22b, 2026-10-22c, 2026-10-22d, 2026-10-22e, 2026-10-22f, 2026-10-22g and 2026-10-22h ([ownership.json](https://github.com/kjg8619/Weavra/blob/hig-evidence/22/22/ownership.json), 129 source files, 38 colocated tests).

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

Head and unchanged parent measured by the same script (`tools/measure-22.mjs`, sha256 `2a3b627cef16b27bad3133d426ded72e1800e1fb1314feaa7463f440ce35135f`). [Full table, method and pre-existing sources](https://github.com/kjg8619/Weavra/blob/hig-evidence/22/22/rules-a-j.md).

| Rule | Head failures | Introduced by this change | Parent failures |
|---|---|---|---|
| b | 1 | 0 | 609 |
| c | 2325 | 0 | 12286 |
| d | 0 | 0 | 324 |
| e | 24 | 0 | 24 |
| f | 0 | 0 | 0 |
| i | 1496 | 0 | 3307 |
| j | 50 | 0 | 50 |
| ax | 0 | 0 | 55108 |
| a (recorded, copy-only geometry) | 12184 | 345 above the parent count | 12129 |

Every remaining head failure for b, c, e, i and j is one the parent also has on the same element and configuration; `ax` (English authored text) is zero on head.

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

## Verification

| Gate | Command | Exit | Result |
|---|---|---|---|
| fmt --check (changed files) | `pnpm exec vp fmt --check <167 changed app/t3code files>` | 0 |  |
| lint (changed files) | `pnpm exec vp lint <165 changed ts/tsx files>` | 0 |  |
| typecheck web | `pnpm --filter @t3tools/web typecheck` | 0 |  |
| typecheck desktop | `pnpm --filter @t3tools/desktop typecheck` | 0 |  |
| plan focused tests | `vp test run --project unit src/i18n/ko.test.ts src/components/settings/settingsSearch.test.ts src/components/settings/KeybindingsSettings.logic.test.ts` | 0 | Tests  104 passed (104) |
| web unit suite | `vp test run --project unit (apps/web)` | 1 | Tests  2 failed | 5696 passed (5698) |
| desktop suite | `vp test run (apps/desktop)` | 0 | Tests  1247 passed | 46 skipped (1293) |
| runner harness | `bun test scripts/hig/harness.test.ts` | 0 | 131 pass |
| lint warnings | same files at head and parent | | 182 at head, 182 at parent, 0 new |
| accept_pr 22 round 01 | `assert.mjs --case 22` + `--verify-packet` + `git diff --check` | 0 | product PASS, 6/6 checks PASS, app exited |
| accept_pr 22 round 02 | `assert.mjs --case 22` + `--verify-packet` + `git diff --check` | 0 | product PASS, 6/6 checks PASS, app exited |
| W-33 regression | `assert.mjs --case 21` on the final build | 0 | 7/7 PASS ([receipt](https://github.com/kjg8619/Weavra/blob/hig-evidence/22/22/regression-21--scenario-receipt.json)) |

Inherited web failures (identical at the parent `245a9efd`, Tests  2 failed | 15 passed (17); [log](https://github.com/kjg8619/Weavra/blob/hig-evidence/22/22/logs--tests-parent-inherited.log)):

- `src/components/settings/ProviderInstanceCard.test.ts > deriveProviderModelsForDisplay > surfaces a failed probe message in both the list row and the editor`
- `src/components/ThreadNotificationCoordinator.badge.test.tsx > shows in-app alerts without adding a badge while focused`

Capture: parent `245a9efdfee4e949a5d312798bcdbf31ed0c1675` and head `b95bacbb200e3e3925dec26766a1e5b0da7dee3a`, 158 paired frames; [gate results](https://github.com/kjg8619/Weavra/blob/hig-evidence/22/22/gate-results.json), [lint comparison](https://github.com/kjg8619/Weavra/blob/hig-evidence/22/22/lint-comparison.json), [fixture retention](https://github.com/kjg8619/Weavra/blob/hig-evidence/22/22/fixture-retention.json).
