# Todo 22 copy-migration worker brief (shared by every group)

You are one of six parallel workers in lane weavra-hig22, under the lane writer (the parent).
Your job: migrate every user-visible English authored string in YOUR assigned files to Korean,
held in a typed catalog. You edit ONLY your assigned files plus your one group catalog file.
Other workers are editing other files in the same worktree at the same time. Never touch, format,
revert or "fix" any file outside your list, even if typecheck reports errors there.

Worktree: /Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-22 (branch hig/22-korean-surface).
Web source root S = app/t3code/apps/web/src. Toolchain:
`export PATH="/Users/kangjingoo/.nvm/versions/node/v24.19.0/bin:$PATH"`, pnpm 11 (already installed).
Never run git commit, git stash, git checkout, git reset or any branch operation. Never build the
desktop app, never launch Electron/Weavra, never touch /Users/kangjingoo/Applications/Weavra.app.

## Catalog mechanics

- Your group catalog file is `S/i18n/ko.<group>.ts`. It exports one object (e.g. `koSettingsServices`)
  whose top-level keys are fixed. Put your strings ONLY under the sub-namespaces assigned to you,
  for example `settings: freeze({ connections: freeze({...}), storage: freeze({...}) })`.
  Wrap every nested object in `freeze(...)`, as in the file. Do not add new imports to the catalog file.
- `S/i18n/ko.ts` composes the groups. Do NOT edit ko.ts. Consumers import
  `import { ko } from "~/i18n/ko";` and reference, e.g., `ko.settings.connections.addEnvironment`.
  (In files that use relative imports only, `~/i18n/ko` still resolves; it is used already in
  components/chat/AssistantSelectionToolbar.tsx.)
- The parent pre-seeded `ko.common`: project, conversation, controlledTask, runHistory, provider,
  approvalRequired, fullAccess, connection, settings, archive, cancel(취소), close(닫기), confirm,
  retry, unknown, rawDiagnostics, save(저장), saving, delete(삭제), remove(제거), edit(편집),
  add(추가), copy(복사), copied, reset(초기화), loading, learnMore, enabled(사용),
  disabled(사용 안 함), on, off, none, default(기본값), search, back, next, done, open, refresh,
  apply, change, rename, browse, install, update, show, hide, details, more, optional, required,
  error, unavailable, dismiss. Reuse these where the meaning is identical. Do not try to add keys to
  common; put anything else in your own namespace.
- Dynamic copy is a function of its parameters: `savedCount: (count: number) => \`저장된 환경 ${count}개\``.
  Never build Korean sentences by concatenating catalog fragments with English grammar.
  Use the existing number/date formatting calls already in the file (toLocaleString etc.);
  if a number is formatted with an explicit "en-US" locale for display, use "ko-KR".
- Key names: short camelCase English describing purpose (addEnvironment, emptyTitle, removeConfirmTitle).

## What to translate

All authored, user-visible copy in your files: headings, section titles, descriptions, button and
menu labels, field labels, placeholders, tooltips (TooltipPopup text and title attributes),
aria-label / aria-description / sr-only text, toast titles and descriptions, error and empty
states, confirmation dialogs, status words, and settings search metadata (titles, descriptions,
keywords) when in your files.

Do NOT translate (keep byte-exact and copyable):
- user, project, thread, fixture or seeded conversation text; command output; raw stderr/diagnostics;
- commands and code (`codex login`, shell lines, `printf ...`), file paths, IDs, endpoints, URLs,
  env-var names, JSON keys, keybinding command IDs, `when` expression syntax, key names on keycaps
  (Ctrl, Shift, Alt, Cmd, Enter, Esc);
- license text and package names; model and provider identifiers (e.g. gpt-6.1-sol, claude-opus-5-5);
- machine values: option `value`s, ids, data-* attributes, route paths, enum keys, event names,
  storage keys, analytics names, test ids, CSS classes. Only the displayed label changes.
- raw wire enums: keep enum presentation behind components/weavraLabels.ts (do not invent
  local enum->Korean maps elsewhere).

## Latin allowed inside Korean labels (lead-approved, exact segments only)

A visible label may keep a Latin segment of 3 or more letters ONLY if it is one of:
Weavra, Codex, Claude, Cursor, Grok, OpenCode, Antigravity, SnapShots, GitHub, GitLab, Bitbucket,
Git, Mercurial, Jujutsu, Tailscale, HTTPS, URL, API, SSH, WSL, CLI, JSON, QR,
and Runtime / Kernel only as the proper names of Weavra components ("Weavra Runtime", "Kernel 상태").
Everything else gets Korean, including the generic verb "Run" (-> 실행) and words like "Sidebar",
"Legacy", "Browser", "Token", "Endpoint", "Backend", "Host" (use 사이드바, 레거시, 브라우저, 토큰,
엔드포인트, 백엔드, 호스트). Fixture/user values shown as data are not labels and stay as they are.
Exception that stays as-is: the existing proper term "Run 그래프" (pinned by the shared runner).

## Korean style and terms

- 해요체 for sentences: "아직 미리보기가 없어요", "연결할 수 없어요. 다시 시도해 주세요."
  Labels and buttons: concise noun or noun+verb form, no period: "환경 추가", "기기 기본값 복원".
- Do not shorten away consequences: a destructive confirmation must keep what is lost and whether
  it can be undone. Keep the same information as the English.
- Glossary (use consistently): project 프로젝트; thread/conversation 대화; controlled task 통제 작업;
  run history 실행 기록; provider 공급자; approval required 승인 필요; full access 전체 접근;
  connection 연결; settings 설정; archive 보관함 (verb archive 보관, unarchive 보관 해제);
  environment 환경; device 기기; workspace 작업 공간; model 모델; action (project script) 작업;
  keybinding 키보드 단축키; integration 연동; source control 소스 제어; storage 저장 공간;
  diagnostics 진단; theme 테마; appearance 모양; light 라이트; dark 다크; system 시스템;
  notification 알림; sidebar 사이드바; legacy 레거시; terminal 터미널; browser 브라우저;
  preview 미리보기; agent 에이전트; repository 저장소; branch 브랜치; commit 커밋;
  pull request 풀 리퀘스트; worktree 작업 트리; token 토큰; API key API 키; endpoint 엔드포인트;
  pairing 페어링; host 호스트; backend 백엔드; usage 사용량; limit 한도; update 업데이트;
  install 설치; sign in / log in 로그인; account 계정; permission 권한; default 기본값;
  custom 사용자 지정; snapshot (generic) 스냅샷, SnapShots (the product/service name) stays.
- Keep existing Korean strings unchanged unless they are inconsistent with this glossary AND not in
  the pinned list below.

## Strings pinned by the shared QA runner (must be shipped EXACTLY)

Already-Korean strings the runner selects by (do not change them where they occur):
계속하기, 프로젝트 가져오지 않기, 프로젝트 추가, 새 프로젝트, 로컬 폴더, 취소, 설정, 일반, 모양, 라이트, 다크,
키보드 단축키, 스냅샷, 공급자, 연동, 소스 제어, 저장 공간, 연결, 보관함, 사용자 지정 모델 추가, 진단 보기,
라이선스 보기, 실행 모드, 오른쪽 패널 열기/닫기, 패널 추가, 패널 열기, 파일, 에이전트, Run 그래프, 기기,
브라우저, 터미널, 통제 작업, 통제 작업 닫기, 워크플로 준비, 기록 불러오기, 작업, 작업 추가, 원문 진단 및 복구 안내,
Codex 공급자 오류 닫기, 공급자 설정 열기, 프로젝트 변경, 대화 제목, 대화 보관, 대화 이름 바꾸기, 삭제, 스레드 삭제,
"추가 (Enter)"/"추가 (⌘ Enter)"/"추가 (Ctrl Enter)", 파일 첨부, 메시지 보내기, 생성 중지, 승인 필요, 전체 접근,
컴퓨터 연결하기, 프로젝트 선택하기, 선택한 컴퓨터에서 사용할 수 있는 에이전트예요., 무엇을 함께 해볼까요?,
아직 에이전트가 없어요, Runtime 실행 제어, Runtime 계획 미리보기, 증거 요약, 순위가 아닌 계약 준수 증거,
워크플로 목표, 확인 후 시작, 프로젝트 설정, 선택한 내용을 작성기에 인용, 직접 지정…, 직접 미루기, 지속되는 입력 목적.

New Korean strings the runner will alias (ship exactly these for these English sources):
Add Action -> 작업 추가 (Edit Action -> 작업 편집); Set up devices -> 기기 설정하기;
No preview yet -> 아직 미리보기가 없어요; Restore device defaults -> 기기 기본값 복원;
Color scheme -> 색상 모드; settings nav/breadcrumb: Project -> 프로젝트, General -> 일반,
Appearance -> 모양, Keybindings -> 키보드 단축키, SnapShots (nav) -> 스냅샷, Providers -> 공급자,
Integrations -> 연동, Source Control -> 소스 제어, Storage -> 저장 공간, Connections -> 연결,
Archive -> 보관함, Settings -> 설정, Diagnostics -> 진단, Open source licenses -> 오픈 소스 라이선스;
Cancel -> 취소; Third-party notices -> 제3자 라이선스 고지; Light -> 라이트; Dark -> 다크; System -> 시스템;
Dismiss notification -> 알림 닫기; Refresh workspace files -> 작업 공간 파일 새로 고침;
Legacy features -> 레거시 기능; Sidebar (legacy) -> 레거시 사이드바; Add provider -> 공급자 추가;
Thread notifications -> 대화 알림; Notifications only -> 알림만; In-app notifications -> 앱 내 알림;
Create theme -> 테마 만들기 (Edit theme -> 테마 편집); Inspect app colors -> 앱 색상 검사;
Cancel inspecting app colors -> 앱 색상 검사 취소; Close the theme editor -> 테마 편집기 닫기;
Open links in -> 링크 열기 위치; Add environment -> 환경 추가; Use light mode -> 라이트 모드 사용;
Use dark mode -> 다크 모드 사용; Follow the system appearance -> 시스템 모양 따르기;
Appearance mode -> 색상 모드 선택; When expression -> 실행 조건식; Unarchive -> 보관 해제;
`${projectName} files` -> `${projectName} 파일`; `Run ${name}` -> `${name} 실행`.
Every runner-pinned accessible name must stay unique on its page (no second visible control with
the same role and name).

## Layout and behavior

Copy only. No layout, spacing, class, behavior, command, data or wire change. The one exception:
if a translated label clearly cannot fit because of a fixed width you can see in the same element
(e.g. `w-56`, `truncate` on a required label), leave it unchanged and record it in your report;
the parent decides layout fixes.

## Tests

- Colocated existing tests that assert shipped copy you changed (getByText("Add provider"),
  toEqual("...English...")) must be updated to the new Korean, preferably by referencing the
  catalog value. Never delete, skip or loosen an assertion; keep the same semantic check.
- Never pin prose in new tests.

## Verification you must run before finishing (from app/t3code)

1. `pnpm exec vp fmt <your changed files>` (write), then `pnpm exec vp fmt --check <files>`.
2. `pnpm exec vp lint <your changed files>`; no new warnings compared with the same files at HEAD
   (`git diff` only; compare by running lint on `git stash`-free means: note warnings you see and
   check whether the flagged line is one you changed).
3. `pnpm --filter @t3tools/web typecheck 2>&1 | grep -E "<your file basenames>"` must show no
   errors in your files (other workers' files may be mid-edit; ignore them).
4. From apps/web: `pnpm exec vp test run --project unit <colocated test files you touched or that
   cover your files>`; all must pass. If a failure is caused by another group's file, report it.
5. Re-scan your files for remaining English authored copy (JSX text, title/label/aria-label/
   placeholder/description props, toast and error strings). Each remaining Latin segment must be in
   the allowed classes above, or not user-visible; list every intentional remainder in the report.

## Report (your final message)

- Files changed, catalog sub-namespaces added, count of strings migrated.
- Strings intentionally left untranslated, each with file:line and class (identifier, command, URL,
  user/fixture data, license, allowed proper name, not user-visible).
- Tests updated (file + what changed), commands run with exit codes.
- Any fit concern, behavior question, or string you were unsure about.
