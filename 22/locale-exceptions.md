# HIG 22 locale exceptions

Every Latin segment that remains on the audited surfaces is in one of the classes below. Each class names its source and
the rule that keeps it. Anything not covered here fails `localeAudit` in the runner (8428a7da) and the self-measurement
`ax` rule; the final self-measurement records zero `ax` failures.

Catalog size: `app/t3code/apps/web/src/i18n/ko.ts` holds 3,966 frozen entries (533 parameter functions) against 64 at the
parent 245a9efd, so 3,902 entries were added. The changed source files hold 2,640 direct `ko.` references (plus local
`copy` aliases) in 118 of 120 files, against none in those files at the parent, where only 3 files imported the catalog
(per-file detail in `delegation/report-*.md`).

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

Wire enums are never shown raw: every value of WeavraCanonicalRunStatus, ConnectionStatus, ComplexTaskStatusV2,
ComplexCleanupStatus and ComplexPhase has a Korean `weavraLabel` (enforced by `src/i18n/ko.test.ts`). Resource telemetry
source status (`healthy`, `degraded`, ...) now shows a Korean label as well.
