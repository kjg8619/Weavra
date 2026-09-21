# Weavra App 제품 독립성

## 범위와 출발점

- 제품 저장소: `kjg8619/Weavra`, PR 대상: `devlop`.
- 출발 `origin/devlop`: `8447f9843e0b2d468554e0062abbe6b98a81ba13`.
- 작업 브랜치: `feat/app-product-independence`.
- 작업 worktree: `../Weavra-worktrees/app-product-independence`.
- 변경 소유 범위: `app/t3code/**`와 이 문서. Runtime, root README/AGENTS/워크플로, 공통 제품 독립성 문서, 원본 저장소는 변경하지 않는다.
- 목적은 현재 App의 제품 이름과 배포·서비스 권한 분리다. 패키지 namespace 이전, OS 식별자 이전, 새 배포 서비스, UI 재설계는 수행하지 않는다.

이 문서는 과거 T3 배포 실적을 Weavra의 실적으로 전환하지 않는다. 현재 Weavra 릴리스 채널은 **없다**. 소스 저장소가 존재한다는 사실은 다운로드·업데이트·스토어 배포가 준비되었다는 뜻이 아니다.

## A–G 감사 분류

| 분류 | 대상과 예 | 현재 결정 |
| --- | --- | --- |
| A — 사용자 표시 identity | Desktop 창·메뉴·권한 안내, Web title/sidebar/onboarding/settings, Mobile 앱 이름·화면·위젯, Server CLI help·진단·도구 설명 | 현재 제품 표시를 Weavra로 전환. 기존 레이아웃과 아트워크는 재설계하지 않음 |
| B — 배포·설치·업데이트 권한 | Electron updater, CLI release index/archive, Server self-update, 원격 desktop commit, SSH archive bootstrap, Expo OTA, npm 플랫폼 설치, shell/PowerShell installer | 채널 미설정으로 거절. 상속 T3 endpoint도 명시적 mirror도 업데이트를 활성화하지 못함 |
| C — hosted 서비스 기본값 | hosted pairing origin, Clerk native associated domains, Mobile legal origin, 원격 model manifest | 상속 origin 제거. 명시적 운영자 설정이 없으면 비활성/미설정. 모델 정보는 bundled manifest 사용 |
| D — 내부·호환 식별자 | `@t3tools/*`, `@t3code/*`, `t3` binary, `T3CODE_*`, `.t3`, `t3.json`, IPC/storage keys, bundle IDs·schemes·GNOME UUID | 호환성을 위해 유지. 이름의 존재는 T3 배포나 서비스 사용 권한이 아님. 별도 승인된 Phase2 이전 대상 |
| E — 현재 저장소·빌드 metadata | Server repository URL/directory/private, Desktop productName/artifact display name, 생성 npm package repository/private/dependencies | Weavra 소스 권한을 명시. npm publish 및 공개 플랫폼 package 자동 설치는 허용하지 않음 |
| F — 출처·법적 고지·역사·fixture | LICENSE/NOTICE, 의존성 고지, `.repos`, 과거 issue/PR 출처, 평가·스크린샷 fixture, 원본 이용 실적·추천사 | 보존. Weavra 저작권·고객·통계로 바꿔 쓰지 않음 |
| G — legacy 배포 인프라 | nested `.github`, marketing, Vercel routing, AUR recipes, 과거 release/Discord/showcase 스크립트, hosted infra | 현재 Weavra 배포 경로가 아님을 분리 기록. 새로운 서비스·자격증명·스케줄·자동 동기화를 만들지 않음 |

감사는 tracked App 소스·설정·스크립트의 T3 문자열, package metadata, URL 및 릴리스 helper 호출 경로를 대상으로 했다. 테스트 fixture와 주석의 출처 문자열은 현재 제품 표시와 구분했다. 단순 전역 문자열 치환은 하지 않았다.

## 현재 제품 표면

- Desktop: `productName=Weavra`, 개발/야간 표시 suffix는 유지한다. 메뉴, 알림, 권한 안내, launcher 표시, GNOME extension 설명, DMG 안내 문구를 전환한다.
- Web: 문서 title, 기본 branding, sidebar, welcome wizard, 설정, 진단과 업데이트 안내에서 Weavra를 표시한다. `T3 Connect`의 사용자 표시 이름은 중립적인 `Remote access`로 바꾼다.
- Mobile: production/preview/development 이름은 Weavra 계열이다. 계정·연결 UI, 권한 안내와 위젯 문구를 전환한다. 내부 Expo slug와 native 식별자는 유지한다.
- Server: 로컬 호환 실행 파일은 여전히 `t3`다. help, 진단, provider/도구 설명은 Weavra이며, triage는 bundled Weavra playbook과 `kjg8619/Weavra`의 소스 이력을 사용한다. 원격 T3 playbook을 가져와 지시로 따르지 않는다.

기존 이미지·아이콘·테마 자산의 provenance는 유지한다. 이 작업은 독자적인 로고·스토어 스크린샷·서명 자산 출시를 주장하지 않는다.

## 업데이트·설치 정책

`packages/shared/src/cliRelease.ts`의 `APP_UPDATES_ENABLED=false`가 현재 정책이다. 표준 안내는 다음과 같다.

> Weavra updates are unavailable: no Weavra release channel is configured.

| 경로 | 차단 위치와 결과 |
| --- | --- |
| Desktop 시작/주기 확인/수동 확인/download/install | 초기 state부터 disabled. `DesktopUpdates`가 작업을 거절하고 `ElectronUpdater`도 transport 호출 전에 거절 |
| Desktop 원격 update/prepared commit | 상속된 downloaded state나 remote control fd가 있어도 설치·commit 불가 |
| Web update UI | 오래된 available/downloaded state도 설치 버튼·toast·release link로 승격하지 않음. About에 채널 미설정 표시 |
| Mobile OTA | Expo config `enabled=false`, `checkAutomatically=NEVER`. 시작·foreground·수동 확인·pending reload 경로 모두 거절 |
| Server/CLI | update capability를 제공하지 않으며 `t3 update`, self-update, desktop update/commit, client-runtime update 명령을 거절 |
| Pinned runtime | 이미 완료된 로컬 설치의 검증·재사용은 유지. 새로운 다운로드, 불완전 설치 repair, 버전 교체는 filesystem 변경 전에 거절 |
| SSH | archive-only bootstrap은 거절. 명시적으로 선택한 `nodeScriptPath` source runner는 릴리스 URL 해석 없이 실행 가능하며 PID/종료 소유권 유지 |
| npm | Server와 생성 package는 `private:true`. 생성 launcher의 기본 optional platform dependencies는 비워 상속 `@t3code/*` 다운로드를 막음. 명시적으로 설치된 로컬 실행 파일의 사용은 유지 |
| 배포 도구 | CLI publish, shell/PowerShell installer, AUR release publisher는 채널 미설정으로 종료. Desktop builder는 updater feed/publish metadata를 생성하지 않음 |

`T3CODE_RELEASE_BASE_URL` 등의 호환 환경변수나 inherited `app-update.yml`은 이 정책을 해제하지 않는다. Weavra GitHub repository 주소만 바꿔 실제로 존재하지 않는 release/index/download URL을 만들지 않는다. 소스 빌드와 별도로 승인된 배포 설계가 필요하다.

## endpoint 처리

| 상속 값/권한 | 처리 |
| --- | --- |
| `github.com/pingdotgg/t3code/releases` 및 release download/API 기본값 | 현재 updater/installer/CLI에서 사용하지 않음. archive/index resolver가 채널 미설정으로 거절 |
| `raw.githubusercontent.com/pingdotgg/t3code/main/apps/server/src/provider/model-manifest.json` | 원격 fetch와 inherited disk cache 사용 중단. bundled manifest 사용 |
| `app.t3.codes` hosted pairing 기본값 | shared fallback 제거. Server는 explicit hosted config를 요구하고 Web은 미설정 시 pairing URL을 만들지 않음 |
| `clerk.t3.codes` | Mobile variant relying-party 및 native associated domains 제거. 설치 시 상속 도메인 연계를 기본 설정하지 않음 |
| `u.expo.dev/d763fcb8-d37c-41ea-a773-b54a0ab4a454` | OTA URL 및 inherited Expo owner/EAS project ID 제거. OTA 비활성 |
| inherited Apple Team/App Store submit 설정 | 제거. native bundle ID 보존과 배포 계정 소유권을 구분 |
| `t3.codes` legal/privacy 기본값 | 제거. explicit marketing origin 없으면 문서 미설정 안내; 임의 URL 또는 T3 문서 fallback 없음 |
| 현재 repository metadata | `https://github.com/kjg8619/Weavra`, Server directory `app/t3code/apps/server` |

Clerk/relay/tracing의 운영자 제공 키·URL, provider 자체 API와 cloudflared 등 제3자 도구 endpoint는 별도 설정 계약이다. 이를 Weavra 운영 서비스라고 주장하지 않는다. 로그인·서비스 구축·스토어 등록·배포는 수행하지 않았다.

`https://t3.codes/schema/t3.json`은 기존 `t3.json` schema 식별자와 editor 참조로 남긴다. App updater가 가져오는 endpoint가 아니다. 편집기가 이 legacy schema URL을 해석할 수 있다는 점은 분리한다. 새 Weavra schema 호스팅을 가정하지 않는다.

## 호환 유지와 후속 승인 경계

다음 값들은 현재 제품 이름이 아니라 호환 계약이다.

- `@t3tools/*`, `@t3code/*`, monorepo/package 이름, `t3` executable 및 archive 내부 파일명.
- `.t3`, `t3code`, legacy `T3 Code (Dev)`/`T3 Code (Alpha)` user-data 탐색, storage/localStorage/IPC key.
- `T3CODE_*`, `T3_*` 환경변수, 기존 stdio DTO와 설정 필드.
- `com.t3tools.t3code*`, native URL schemes, keychain/app-group 식별자, Expo slug, GNOME UUID.
- 기존 fixture·샘플 저장소·테마 출처·이미지 저작권.

이 값들을 유지해 기존 로컬 상태와 명시적 source runner를 끊지 않는다. 그러나 기존 npm/스토어/GitHub/Expo 배포를 현재 Weavra의 설치 경로로 안내하지 않는다. namespace, OS IDs, signing, public package 이름 이전은 별도 설계·권한 확인·승인이 필요하다.

## legacy 자산과 운영 여부

- `app/t3code/.github/**`: 과거 독립 T3 저장소의 workflow/template/playbook. 제품 root의 활성 GitHub workflow가 아니며 승격하거나 실행하지 않았다.
- `apps/marketing`: T3의 과거 추천사·다운로드·스토어 링크·실적을 보존한다. 공통 layout과 독립 95 페이지에 legacy banner를 넣어 Weavra 다운로드 서비스가 아님을 밝힌다. release fetch는 중단한다. 남은 T3 release 링크는 역사 페이지의 링크이며 Weavra release URL로 위장하지 않는다.
- `apps/web/vercel.ts`, `apps/marketing/vercel.ts`, marketing canonical site: 상속 hosting topology. Weavra hosting 구성으로 배포하지 않는다. Web config의 git deployment 비활성 설정과 legacy 경고를 유지한다.
- `packaging/aur`: recipes는 과거 T3 package다. README에 legacy 범위를 표시하고 release publisher는 거절한다. Weavra AUR package를 만들지 않았다.
- `scripts/notify-discord-release.ts`, `scripts/release-smoke.ts`, mobile showcase/평가 자료, `infra/**`: 상속 수동 운영·검증·fixture 자산. 현재 Weavra release 서비스의 존재나 운영 승인을 뜻하지 않는다.
- App README는 현재 소스 기반 개발 경로를 안내한다. nested 문서를 현재 제품 설치 지침으로 무조건 승격하지 않는다.

## Runtime 및 C08 불변조건

[BOUNDARIES.md](BOUNDARIES.md)의 경계를 유지한다.

```text
Weavra App
  -> configured absolute executable + trusted project cwd
  -> weavra bridge --stdio --project-trusted [explicit --control]
  -> Runtime/Host -> RegisteredVerifier -> Kernel
```

- `runtime/pi`는 npm, `app/t3code`는 pnpm 11/Vite+의 독립 build root다. workspace/lockfile/TypeScript/build system을 통합하지 않는다.
- App production code는 Runtime 구현 source를 직접 import하지 않는다. 중복 protocol 정의를 유지한다.
- Browser/Jev는 observation-only. candidate 권한은 `CANDIDATE_ONLY`.
- Runtime/Host만 등록하고 RegisteredVerifier는 새 격리 capture로 검증한다. candidate evidence를 verification에 재사용하지 않는다.
- Kernel만 완료 상태를 결정한다. UI 표시, 성공한 RPC, updater 상태가 PASS/COMPLETE 권한을 만들지 않는다.
- browser 자동 repair와 C09/V0.6D를 시작하지 않는다. C08은 기존 CLOSED 범위를 유지하며 제품 이름 변경으로 권한을 넓히지 않는다.

## 현재 검증 기록

아래는 이 lane에서 실제 실행한 검사이며 과거 consolidation 결과의 재인용이 아니다.

- 실제 Node 24 CLI `--help`: Weavra 설명과 `t3` 호환 invocation 확인.
- 실제 `t3 update --yes`: 채널 미설정 `CliUpdateError`, exit 1.
- 실제 shell installer, AUR release publisher, CLI publish: 채널 미설정으로 exit 1. publish는 artifact 경로 조회 전에 거절.
- 실제 Web: 격리 HOME/backend와 표준 single-origin Vite proxy로 pairing → welcome → 설정 화면 확인. title `Weavra (Dev)`, sidebar/welcome `Weavra`, About의 update-unavailable 문구를 screenshot으로 확인. 확인한 설정 화면에 inherited T3 링크 없음. provider 설치·로그인·프롬프트·Host Control 동작은 실행하지 않음.
- Mobile `expo config --type public --json`: `name=Weavra`, OTA disabled/NEVER, owner/project ID 및 native associated domains 미설정 확인. bundle IDs는 그대로 보존.
- `node scripts/verify-imports.mjs`: Pi/T3 import commit tree 보존 및 generated model data 검사 통과.
- `node --test scripts/consolidation-paths.test.mjs`: 1 test 통과. nested Pi archive가 독립 package root를 유지함.

초기 전체 검사에서 obsolete updater 기대와 표시 문구 assertion, SSH source runner의 불필요한 release URL 해석을 발견했다. 정책 거절 계약으로 테스트를 전환하고 명시적 SSH source runner를 복구했다. 문구·source-text만 고정하던 assertion은 새 문구로 재고정하지 않고 제거했다. 실제 차단, capability, 상태 전이, 로컬 프로세스 소유권 테스트는 유지한다.

### 최종 로컬 전체 gate — 2026-09-21

Node `24.19.0`, pnpm `11.10.0`에서 제품 root의 `node scripts/validate.mjs t3`를 실행해 **ALL GATES PASS**, exit 0을 확인했다. 기존 runner의 격리 HOME/temp, serial workspace 실행, 필터 없는 전체 테스트를 그대로 사용했다.

| Gate | 현재 결과 |
| --- | --- |
| 전체 workspace test | 14 workspaces, 17,112 passed / 56 skipped; 1,271 test files passed / 6 skipped; 실패 0 |
| C08 focused 재실행 | contracts 17, server 26, client-runtime 28, web 23: 총 94 passed. 전체 suite에 포함된 테스트를 다시 실행한 수치 |
| typecheck | 15 workspace tasks 통과. Effect 제안 진단은 남아 있으며 error로 숨기거나 억제하지 않음 |
| lint | 722 warnings / 0 errors, exit 0 |
| fmt:check | 통과 |
| knip:check | 두 단계 모두 통과 |
| build | Web/marketing/Server/Desktop를 포함한 기존 App build graph 7 tasks 통과 |
| git diff --check | 통과 |

Desktop build에는 optional `x11` externalization 및 dependency의 CJS `import.meta` 경고가 남는다. 경고를 억제하거나 gate를 우회하지 않았다.

직전 전체 실행에서는 수정하지 않은 server router의 loopback `browser-session` 요청 하나가 `ETIMEDOUT`으로 실패했다. 해당 테스트는 소스·timeout·retry 설정 변경 없이 단독 실행에서 통과했고, 위 최종 전체 실행도 통과했다. 원인을 제품 이름 변경이나 smoke 프로세스로 단정하지 않는다.

커밋 단계에서 inherited Vite+ hook이 제품 Git root에서 App의 `staged` 설정을 찾지 못하는 문제가 드러났다. App 소유 `.vite-hooks/pre-commit`이 자신의 위치로 package root를 찾고 `vp staged --cwd`를 실행하도록 보정했다. 제품 root에서 실제 hook을 실행해 259개 App staged 파일의 기존 formatter gate가 통과했고, root 문서는 그 작업 범위에서 제외됨을 확인했다. hook을 끄거나 실패한 검증을 우회하지 않았다. 이 hook 실행 보정은 위 전체 App 검증 뒤에 별도로 검증한 변경이다.

### 검증 한계

- 실제 Windows PowerShell, native Electron 창, iOS/Android 기기·시뮬레이터 실행은 수행하지 않았다. Desktop/Mobile adapter 회귀와 실제 Expo 설정 확인은 native 시각 검증을 대신한다고 주장하지 않는다.
- 서명된 installer, store 제출, 실제 OTA, hosted auth/relay 배포는 의도적으로 수행하지 않았다.
- Web smoke의 잘못된 cross-origin 개발 설정은 인증 cookie를 유지하지 못했다. 소스를 우회하지 않고 저장소의 표준 single-origin 개발 설정으로 바로잡아 pairing과 화면 검증을 완료했다.

## 인수 조건

현재 App 이름과 현재 권한은 Weavra에 속하되, 존재하지 않는 release 서비스를 만들거나 T3 배포를 Weavra 배포로 취급하지 않는다. 전체 App gate와 C08 회귀를 통과한 commit만 normal push하여 `devlop` 대상 PR을 만들고 CI를 확인한다. 이 lane은 PR을 merge하지 않는다.
