# weavra-hig22 - exact Korean strings for runner aliases (todo 22 / W-03)

Lane: weavra-hig22. Product parent 245a9efd; runner hig-01 82834bcf (unchanged).
Every "Korean (exact)" value below is the string todo 22 will ship, character for character.
Add it as an exact alias next to the English baseline value: [English, Korean]. The English
stays so the parent (before) build still resolves. Keep each target and its uniqueness check
unchanged.

Product ownership: "owned" means the file is in todo 22's plan list. "transfer" means a reachable
corpus string in a file outside that list. Under todo 22 step 5 I claim it copy-only in this PR;
no other active writer touches these files.

## A. capture.mjs readiness `expected` (cases.mjs rows)

| Runner ref | State | English (baseline) | Korean (exact) | Product source | Ownership |
|---|---|---|---|---|---|
| cases.mjs:26 | 11 | Add Action | 작업 추가 | components/projectScriptEditor.tsx:308 (DialogTitle; editing = 작업 편집) | owned |
| cases.mjs:29 | 14 | Set up devices | 기기 설정하기 | components/device/DeviceSetup.tsx:80 | owned |
| cases.mjs:30 | 15 | No preview yet | 아직 미리보기가 없어요 | components/preview/PreviewEmptyState.tsx:41 | owned |
| cases.mjs:32 | 17 | Restore device defaults | 기기 기본값 복원 | routes/settings.tsx:45 | transfer |
| cases.mjs:33-34 | 18/19 | Color scheme | 색상 모드 | settings/settingsSearch.ts:177 (row title) | owned |
| cases.mjs:35 | 20 | Keybindings | 키보드 단축키 | settings/settingsSearch.ts:87 (nav/breadcrumb) | owned |
| cases.mjs:36 | 21 | SnapShots | 스냅샷 | settings/settingsSearch.ts:88 nav label. The SnapShots product name stays where it names the service. Alias only as a safety net. | owned |
| cases.mjs:37 | 22 | Providers | 공급자 | settingsSearch.ts:89 | owned |
| cases.mjs:38 | 23 | Integrations | 연동 | settingsSearch.ts:90 | owned |
| cases.mjs:39 | 24 | Source Control | 소스 제어 | settingsSearch.ts:91 | owned |
| cases.mjs:40 | 25 | Storage | 저장 공간 | settingsSearch.ts:92 | owned |
| cases.mjs:41 | 26 | Connections | 연결 | settingsSearch.ts:93 | owned |
| cases.mjs:42 | 27 | Archive | 보관함 | settingsSearch.ts:94 | owned |
| cases.mjs:43 | 28 | Cancel | 취소 | custom model form (settings/CustomModelEditor.tsx) | owned |
| cases.mjs:44 | 29 | Diagnostics | 진단 | settings/SettingsBreadcrumb.tsx:38 | owned |
| cases.mjs:45 | 30 | Third-party notices | 제3자 라이선스 고지 | settings/OpenSourceLicenses.tsx:226 | owned |

Note: the Korean `expected` values for 22-29 also appear in the settings nav, so readiness on
them is as weak as the English values already are. That is unchanged in kind.

## B. capture.mjs selectors

| Runner ref | Kind | English | Korean (exact) | Product source | Ownership |
|---|---|---|---|---|---|
| capture.mjs:579, 697, 701 | getByText exact | Light | 라이트 | settings/ThemeSettings.tsx:766 | owned |
| capture.mjs:579, 699 | getByText exact | Dark | 다크 | settings/ThemeSettings.tsx:766 (System = 시스템) | owned |
| capture.mjs:674 | button aria-label (optional dismiss) | Dismiss notification | 알림 닫기 | components/ui/toast.tsx:667, 759 | owned |
| capture.mjs:683; assert.mjs:294; cases.mjs:1582, 3113 | button aria-label | Refresh workspace files | 작업 공간 파일 새로 고침 | components/files/FileBrowserPanel.tsx:57 | transfer |

## C. cases.mjs case 22 path (self-contradiction today)

| Runner ref | Kind | English | Korean (exact) | Product source | Ownership |
|---|---|---|---|---|---|
| cases.mjs:1648, 1652 | button | Legacy features | 레거시 기능 | settings/SettingsPanels.tsx:1821 | owned |
| cases.mjs:1657 | switch | Sidebar (legacy) | 레거시 사이드바 | settings/SettingsPanels.tsx:1862; settingsSearch.ts:475 | owned |
| cases.mjs:3888 | button | Add provider | 공급자 추가 | settings/ProviderSettingsPanel.tsx:1038, 1044 | owned |

## D. Other cases (final-wave re-runs)

| Runner ref | Kind | English | Korean (exact) | Product source | Ownership |
|---|---|---|---|---|---|
| cases.mjs:101, 1788, 1794 | combobox | Thread notifications | 대화 알림 | settings/NotificationSettings.tsx:69; settingsSearch.ts:295 | transfer (NotificationSettings.tsx) |
| cases.mjs:102, 1789, 1795 | option / hasText | Notifications only | 알림만 | threadNotifications.ts:9 | transfer |
| cases.mjs:103, 1790, 1798 | switch | In-app notifications | 앱 내 알림 | settings/SettingsPanels.tsx:2092; settingsSearch.ts:301 | owned |
| cases.mjs:2294, 3975, 3979 | button / aria-label | Create theme | 테마 만들기 | settings/ThemeSettings.tsx:929; ThemeEditorPanel.tsx:1159, 1185, 1278 (editing = 테마 편집) | owned (ThemeSettings); ThemeEditorPanel transfer |
| cases.mjs:2297 | button | Inspect app colors | 앱 색상 검사 | settings/ThemeEditorPanel.tsx:1201 | transfer |
| cases.mjs:2301 | button | Cancel inspecting app colors | 앱 색상 검사 취소 | settings/ThemeEditorPanel.tsx:1201 | transfer |
| cases.mjs:2306, 3992 | button | Close the theme editor | 테마 편집기 닫기 | settings/ThemeEditorPanel.tsx:1232 | transfer |
| cases.mjs:3603, 3629, 3653, 3669 | combobox | Open links in | 링크 열기 위치 | settings/IntegrationsSettings.tsx:562; settingsSearch.ts:620 | owned |
| cases.mjs:3708, 3716, 3742, 3767 | button | Add environment | 환경 추가 | settings/ConnectionsSettings.tsx:3726, 3730, 3736 (also 2693, 2814) | owned |
| cases.mjs:3897, 3923 | button | Use light mode | 라이트 모드 사용 | settings/ThemeSettings.tsx:751 | owned |
| cases.mjs:3924 | button | Use dark mode | 다크 모드 사용 | settings/ThemeSettings.tsx:751 | owned |
| cases.mjs:3950 | button | Follow the system appearance | 시스템 모양 따르기 | settings/ThemeSettings.tsx:751 | owned |
| cases.mjs:3901; assert.mjs:288 | group aria-label | Appearance mode | 색상 모드 선택 | settings/ThemeSettings.tsx:746 | owned |
| cases.mjs:4175 | textbox | When expression | 실행 조건식 | settings/KeybindingsSettings.tsx:667, 711 | owned |
| cases.mjs:4277 | button | Unarchive | 보관 해제 | settings/SettingsPanels.tsx:3077, 3257 | owned |
| cases.mjs:3030, 3045, 3063, 3090 | region aria-label | baseline-project files | baseline-project 파일 | files/FileBrowserPanel.tsx:583 (`${projectName} 파일`) | transfer |
| cases.mjs:673 | button | Run HIG saved action | HIG saved action 실행 | components/ProjectScriptsControl.tsx:167 (`${name} 실행`) | transfer |

## Not planned (outside the W-03 corpus and owned list); no alias needed

- cases.mjs:2351, 2354 `again to quit`: QuitHoldOverlay.tsx:45. It shows only during quit,
  not in any of the 46 states, and todo 2 owns the file.
- cases.mjs:1878 `hig-image.png, zoomable image`: chat/ZoomableImage.tsx:150. This is the
  expanded-image region inside a dialog. It is not a W-03 must-scroll state, the file is not
  owned, and the locale audit does not inspect regions.

## E. localeAudit treats a proper name only as a whole string (cases.mjs:1705-1706)

`localeAudit` fails any visible button, label, h1-h4, [role=status], input or textarea
whose text, aria-label or placeholder contains 3 or more consecutive Latin letters, unless the
whole string exactly equals one entry of `proper`. So a correctly translated Korean label that
keeps a proper name, protocol or identifier as one segment still fails. The plan (todo 22 visual
QA) instead asks to classify each remaining Latin segment, with its source. Examples in the
audited sections:

- connections: settings/ConnectionsSettings.tsx:3184 `Enable Tailscale HTTPS` -> `Tailscale HTTPS 사용`
  (switch). :875 `Endpoint the pairing QR code and URL use` -> `페어링 QR 코드와 URL이 사용할 엔드포인트`.
  :3578 / :3616 dialog titles keep `Tailscale HTTPS`.
- providers: provider cards and status lines keep `Codex` / `Claude` / `OpenCode` next to
  Korean words, for example `Codex 로그인 필요`. Literal `codex login` and model IDs must stay
  exact (brief rule).
- general / about: `Weavra` inside sentences, for example a `Weavra 업데이트` label.

Requested runner change: classify per Latin segment. Accept a label when every [A-Za-z]{3,}
segment is either an explicit allowlisted proper name, protocol or acronym recorded with its
class (Weavra, Codex, Claude, Cursor, Grok, OpenCode, Antigravity, SnapShots, GitHub, GitLab,
Bitbucket, Git, Mercurial, Jujutsu, Tailscale, HTTPS, URL, API, SSH, WSL, CLI, JSON, QR, Runtime,
Kernel, Run), or a fixture/user value already listed. Record each matched segment and its
class in the observations, so nothing is accepted silently. The lead decides the exact list;
I will not add new Latin to Korean labels beyond these classes.

If the lead prefers a different Korean term for any row, change it here and I will ship that
exact string. Rows marked "transfer" need the lead's acknowledgement of the copy-only claim
(plan todo 22 step 5).
