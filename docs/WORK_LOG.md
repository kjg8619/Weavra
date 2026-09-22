# Weavra 작업 기록

## 현재 진행 요약

- 상태: 저장소 통합 baseline은 완료된 역사적 결과로 보존한다. 현재 Product Independence Phase 1은 별도 feature branch/worktree에서 진행 중이며, 전체 검증·PR CI 완료 전 PR-ready 또는 완료로 기록하지 않는다.
- 날짜/시간대: 2026-09-21, Asia/Seoul (UTC+09:00).
- 범위: 독립 공개 저장소 kjg8619/Weavra 통합. C09/V0.6D 기능 개발 없음.
- 원본 Pi/T3Code 저장소는 수정하지 않는다. 아래 현재 실행 결과와 이전 저장소의 역사적 결과를 구분한다.

## 2026-09-21 KST — 독립 저장소 및 원본 스냅샷 import 완료

- 목적: 최종 split-repository baseline을 각각 별도 commit으로 보존하고 runtime/pi, app/t3code를 독립 build root로 배치.
- 원본: Pi `19184e387733dd3558dffff874c58a8e67748e40`, T3Code `f6ff0ae0f1ae0f54aee055c64b82dd8e2b9eebdf`.
- 생성 commit: 초기 정책 `36b1e78b0977cfb2a99867c42bfcbdf341670c73`, Pi import `89d917c312f52c028a3f7d5183ba602faef19dd1`, T3 import `8fdde3c574c7ad7919810c67d1ab86de0f18ddc6`.
- 변경 파일: 새 저장소 README.md, AGENTS.md, NOTICE.md, docs/migration/SPLIT_REPOSITORY_BASELINE.md 및 두 source manifest, runtime/pi, app/t3code.
- 검증: source/import `git ls-tree -r` 비교와 subtree object ID 일치. Pi 1,918개, T3 23,069개 항목의 경로·mode·blob·symlink 내용 보존. `node scripts/verify-imports.mjs` 재검증 PASS.
- 문제/해결: git archive가 batch 파일 newline을 변환한 최초 추출은 commit 전에 폐기했다. 원본 raw object와 index mode를 사용하여 정확한 tree로 import했다. source history를 parent로 연결하지 않았다.
- 역사적 결과: Pi exact CI 35556089694 success; T3 CI NOT RUN, 로컬 14 workspaces/1,270 files/17,284 PASS/58 skipped 및 lint 722 warnings/0 errors. 이번 작업 결과로 재해석하지 않는다.
- 남은 작업: 경로 호환성, root CI, 실제 stdio/browser 통합 검증, 최종 refs.

## 2026-09-21 13:05 KST — 경로 호환성 및 로컬 전체 검증 완료

- 목적: Git product root와 Pi/T3 source root, 실행 project root, package root 의미를 분리하고 기능/권한 변경 없이 nested layout을 검증.
- 변경 파일: runtime/pi/scripts/{create-source-archive.sh,diff-model-catalog.mjs,check-lockfile-commit.mjs,check-lockfile-commit.test.mjs}, company-runtime/src/provenance.ts, company-runtime/test/measurement-evidence.test.ts, coding-agent/test/suite/company-runtime-status.test.ts. T3 production source 변경 없음.
- root 추가: CI 세 job, 실행파일 환경 helper, import verifier, 격리 검증 runner, 실제 cross-boundary smoke, source archive regression, architecture/migration 문서, root ignore.
- 현재 실행: Pi `npm install --ignore-scripts`, `npm run hydrate:model-data`, `npm run build` PASS. `node scripts/validate.mjs pi`가 check/check:ci/shrinkwrap/install-lock/npm test/test.sh/launcher syntax/diff check 모두 PASS (432.09초). 각 test entrypoint에서 Vitest 553 files/6,582 PASS/894 skipped, scripts 18 PASS; TUI node:test도 성공. 두 test entrypoint는 중복 실행이므로 합산하지 않는다.
- 현재 실행: T3 frozen ignore-scripts install, 명시적 effect-tsgo patch/ensure:electron PASS. `node scripts/validate.mjs t3` 전체 14 workspaces/1,270 files/17,284 PASS/58 skipped. focused contracts17/server26/client28/web23 PASS. typecheck/lint/fmt/knip/build PASS (전체 494.14초), lint 722 warnings/0 errors. 기존 build의 optional x11/import.meta 등 경고는 숨기거나 수정하지 않았다.
- 현재 실행: `node --test scripts/consolidation-paths.test.mjs runtime/pi/scripts/check-lockfile-commit.test.mjs` 3 PASS. model catalog `--thinking openai` smoke PASS. 실제 launcher `--version` 0.85.1.
- 현재 실행: `node scripts/run-cross-boundary.mjs` PASS. 실제 Chromium 후보 CANDIDATE_ONLY, production T3 BridgeTransport hello/snapshot, ControlTransport browser prepare/invalidation/confirm, FitnessReader 실제 CLI 조회, workflow prepare/invalidation/confirm/cancel 및 canonical CANCELLED/writer 해제 확인. RegisteredVerifier 실제 fresh self-check/test 캡처 PASS, 이전 Ready 후보를 보존한 채 현재 문서를 Broken으로 바꾸면 FAIL. paid provider 호출 0, owned pending loopback 호출도 0 (취소가 provider 요청 전에 완료됨).
- 문제/해결: 최초 검증은 fd 미설치, macOS Unix socket 경로 길이, Git root를 CLI bundle root로 오인한 provenance, 파일 경로의 Weavra 문자열까지 금지한 테스트로 실패했다. fd 설치, canonical 짧은 private temp, source root 수정, 무관한 substring assertion 제거 후 전체 재실행 PASS. 첫 실행의 concurrent session 테스트 일회성 실패도 전체 재실행 두 entrypoint에서 재발하지 않았다. 테스트 timeout/skip/권한은 완화하지 않았다.
- smoke fixture 문제: 잘못된 CLI selector 옵션/fitness projectId/분류 불가 goal을 실제 contract에 맞게 수정했다. Chromium의 자동 favicon 추가 요청은 runtime이 정상 거부했다. fixture에 data URL favicon을 선언한 후 runtime 수정 없이 실제 관찰 PASS.
- 원본 보존 검증: 사전 snapshot과 원본 local refs/status, remote `ls-remote --refs`가 모두 동일. 원본 저장소 worklog/branch/tag/workflow/archive 상태를 변경하지 않음.
- 한계: 로컬 성공은 원격 CI 성공이 아니다. 새 root CI run과 정확한 final SHA 검증 전 main/devlop/tag를 확정하지 않는다. 개인 browser/auth 세션 및 유료 inference는 검증하지 않았다.
- commit 상태: import commit 완료. 호환성/문서/CI commit 및 push 준비 중.
- 다음 단계: root CI 실행 및 실패 원인 해결, 원격 검증 완료 후 main/devlop/provenance annotated tag 생성, 최종 clean/ref identity 기록.

## 2026-09-21 13:15 KST — 원격 smoke의 revision 경합 수정

- 상태: 첫 root CI `35559913155`, commit `d58653e07c68ad338122f4650fbefbbc3723bcac`의 cross-boundary job 실패. 다른 job은 이 기록 시점 실행 중이며 성공으로 기록하지 않는다.
- 원인: 초기 RUNNING snapshot 직후 Runtime이 startup state를 추가 저장했다. smoke가 서로 다른 시점의 project/state revision을 사용하여 workflow.cancel을 보내자 Runtime이 `STALE_PROJECT`로 정상 거부했다.
- 변경 파일: scripts/cross-boundary-smoke.mjs, 이 worklog 및 consolidation evidence. Runtime/T3 production 코드, stale revision 검사, timeout/skip 정책은 변경하지 않았다.
- 해결: fixture의 실제 owned loopback model 요청 도착을 기다려 startup 완료를 동기화한 뒤 하나의 canonical snapshot에서 모든 cancellation revision을 가져온다. mutation 재시도나 오류 무시는 추가하지 않았다.
- 검증: 실제 `node scripts/run-cross-boundary.mjs` 재실행 PASS (4.94초). 이번에는 owned pending loopback 요청 1개가 실제 도착했고 canonical CANCELLED/writer 해제 및 fresh browser PASS/PASS/FAIL을 확인했다. paid provider 요청은 0.
- commit 상태: 호환성 `0fb6921cb3b2fd944b988755077857b3c79de907`, root integration `d58653e07c68ad338122f4650fbefbbc3723bcac` push 완료. 이번 fixture 보정 commit 준비 중.
- 남은 작업: 보정된 exact SHA의 전체 root CI PASS 및 최종 main/devlop/tag 확정. 아직 CLOSED가 아니다.

## 2026-09-21 14:01 KST — corrected exact root CI 및 증거 문서 확정

- 목적: 로컬 성공에 의존하지 않고 새 독립 저장소의 정확한 commit을 세 CI 경계로 검증하고 결과를 보존.
- 현재 실행: `gh run view 35561216496 --repo kjg8619/Weavra`에서 SHA `3b22c41ee3d94af38d86b9b8e862105c57a0316f`, conclusion success 확인. runtime/pi `106215141718`, app/t3code `106215141632`, cross-boundary `106215141757` 모두 success. 세 job의 tracked-source unchanged gate도 성공.
- 이전 실패 결과 확정: `35559913155`는 runtime/pi·app/t3code success, cross-boundary failure였다. 실패를 재분류하거나 숨기지 않는다.
- 추가 로컬 검증: root smoke 보정 후 Pi `npm run check` PASS, 1,473 files checked/수정 없음. 소유한 임시 browser diagnostic, workflow check script, source archive reproduction 파일을 제거했다.
- 변경 파일: docs/WORK_LOG.md, docs/migration/REPOSITORY_CONSOLIDATION.md만. production 코드/lockfile/protocol/authority 변경 없음.
- branch 상태: 로컬 main/devlop을 검증된 `3b22c41ee3d94af38d86b9b8e862105c57a0316f`에서 생성. 원본 Pi/T3Code의 refs에는 손대지 않았다.
- commit 상태: 구현 및 smoke 보정 commit push 완료. 이 기록은 evidence-only successor로 commit한다. successor의 exact CI 성공 없이 main/devlop의 최종 원격 publication을 하지 않는다.
- 최종 publication 기록: `weavra-consolidation-baseline-2026-09-21` annotated tag에 final SHA, final CI run, 원본/import SHA, 날짜/하네스, authority 한계와 clean/ref identity 결과를 남긴다. tag는 final evidence revision 검증 후 작성한다. 문서가 자기 commit hash를 포함하는 순환 참조는 만들지 않는다.
- 한계/다음 범위: T3 기존 lint 722 warnings/0 errors 및 build 경고 보존. 플랫폼별 skip과 C08 local-static 범위 유지. paid inference/개인 browser 세션 검증, C09/V0.6D, 리브랜딩/namespace/architecture 통합은 별도 요청 사항이다.

## 2026-09-21 KST — Product Independence Phase 1 시작 및 전체 감사

- 요청 범위: 제품/CLI/배포·업데이트/홈·설정/외부 endpoint authority를 Weavra로 분리. 내부 namespace·디렉터리 대규모 변경, C09/V0.6D, 새로운 hosted infrastructure는 제외.
- Git 실제 시작 상태: 원 checkout clean, `devlop = devlop@{upstream} = origin/devlop = 8447f9843e0b2d468554e0062abbe6b98a81ba13`. `git fetch origin` 후 확인했으며 이전 대화 baseline을 추정값으로 사용하지 않았다.
- 격리: `feat/product-independence-phase1`, `/Users/kangjingoo/Workspace/tool/Weavra-worktrees/product-independence-phase1`. 원 checkout의 devlop/main에는 구현하지 않는다. stash/reset/rebase/force-push 없음. PR base는 devlop이며 merge 권한은 사용자에게 남긴다.
- Phase 0: Runtime/App 전체 source·manifests·scripts·숨김 설정·tests·docs·reference/provenance 계열을 A~H로 분류. 제품 identity 외에 Pi catalog/install reporter/Radius relay, App PostHog/model manifest/SSH provisioning/Expo OTA/Clerk·relay tenant/marketing installer와 store 링크를 현재 authority 위험으로 식별했다.
- 변경 전 실제 증거: 격리 HOME에서 `weavra setup` exit 0, `weavra --version`은 `0.85.1`, `--help`는 `pi` 명령과 `~/.pi/agent`, `pi.dev/session`을 안내했다. fetch mock으로 `checkForNewPiVersion('0.85.1')` 실행 시 `https://pi.dev/api/latest-version`, User-Agent `pi/0.85.1 (darwin; node/v24.19.0; arm64)` 관찰. 실제 vendor/provider 요청은 보내지 않았다.
- 보존 사전 확인: immutable import verifier PASS — Pi 1,918개 / T3 23,069개 항목의 원본 import tree 동일. 이것은 product independence 구현 검증이 아닌 역사적 import 보존 검증이다.
- 도구 환경: shell 기본 Node 26/pnpm 9 대신 설치된 Node 24.19.0 및 Corepack pnpm 11.10.0을 임시 PATH로 선택했다. 전역 toolchain이나 사용자 설정은 변경하지 않았다.
- 실행 문제: 기본 writing worker가 `No model selected`로 시작 전 실패했다. 감사 결과는 정상 수신했다. 대체 reviewer는 read-only 도구라 구체적 수정 제안을 받고 Main의 edit/write로 적용하는 방식으로 전환했다. 전환 전에 일부 worker가 전달한 제한적 변경은 작업 tree 상태로 보존하고 최종 통합 검증 대상에 포함한다.
- 정책 결정: 제품 표시는 `Weavra development`, 내부 package/wire/milestone 버전은 구분. canonical agent home은 `~/.weavra/agent`. 원본 updater/share/analytics/hosted tenant 자동 사용을 차단하며, explicit provider/extension/local 연결과 출처·LICENSE·NOTICE·C08 권한 경계는 보존한다.
- 현재 문서/검증 준비: `docs/architecture/PRODUCT_INDEPENDENCE.md`, root CLI/network/provenance regression, README integration-only Git 운영 안내. 전체 Runtime/App/cross-boundary/PR CI 결과는 아직 기록할 수 없다.

## 2026-09-21 KST — 구현 통합 및 검증 시작

- Runtime 현재 실행: Node 24.19.0에서 `npm install --ignore-scripts`, `npm run hydrate:model-data`, coding-agent shrinkwrap/install-lock 생성, `npm run build` PASS. Bundle 51 files / 7.7 MiB. build-time models.dev/NVIDIA/OpenRouter/Vercel metadata 조회는 명시적 빌드 작업이며 paid provider inference가 아니다.
- 출처 보존: 현재 worktree의 `runtime/pi/LICENSE`, `app/t3code/LICENSE`, `NOTICE.md`가 시작 checkout 파일과 byte-identical임을 `cmp`로 확인했다.
- App 구현: desktop/web/mobile identity 및 updater/tenant 경계, 원본 publish/installer authority 거부, source/local 연결 보존 변경을 통합 중. 전체 App regression은 아직 실행 전이며 PASS로 기록하지 않는다.
- Native 아이콘 외부 prerequisite: 기존 exporter는 Icon Composer 2+가 필요하다. 설치 경로 탐색에서 도구를 찾지 못했고 Apple 공식 download는 계정 로그인으로 이동했다. 개인 계정에는 접근하지 않았다. 사용자가 **Icon Composer 제공**을 선택하여 기존 native exporter를 유지하기로 했다. 설치/경로 전달과 PNG/ICO/native export 완료 전 전체 완료/PR-ready로 기록하지 않는다.
- 검증 환경 한계: `xcrun simctl list devices available`은 simctl 부재로 실패했다. Native mobile 실행과 설정/JavaScript regression을 동일한 증거로 취급하지 않는다.
- 현재 진행: root 격리 runner의 전체 Runtime gates를 시작했다. 실패는 원인 수정 후 재검증하며, 기존 skip/warning/gate를 숨기거나 완화하지 않는다.

## 2026-09-21 KST — 실제 CLI/TUI independence smoke 및 회귀 보정

- 실제 CLI regression 2/2 PASS: canonical help, `Weavra development`, setup/doctor, self-update refusal(exit 1), 실제 RPC `get_state`. network preload가 관찰한 외부 연결 시도 0 / paid inference 0. 잘못된 기존 Pi credential sentinel은 선택·수정되지 않았다.
- 실제 TUI를 별도 HOME에서 실행: `Weavra development`, `Weavra Runtime loaded — development`를 관찰했다. `/share`는 hosted sharing unavailable 및 local export 안내를 표시했으며 외부 연결 ledger는 비어 있었다. Ctrl+D 종료 exit 0. 이번 세션은 의도적으로 `--no-session`이어서 HTML export는 in-memory-session 거부를 반환했다; export 성공으로 기록하지 않는다.
- Runtime 전체 첫 회귀에서 오래된 Pi/version/Radius 기대값, 긴 worktree 경로의 terminal wrapping 가정, fitness 통합 30초 timeout을 관찰했다. wording-only prompt test는 삭제하고 오류 식별·파일 보존·CLI dispatch·인증 비활성 계약을 검증하도록 보정했다. timeout/skip은 바꾸지 않았다. focused 8 files / 111 tests PASS; 전체 두 test entrypoint 재실행은 별도 결과를 기다린다.
- App lock 갱신 후 frozen ignore-scripts install, effect-tsgo patch, ensure:electron PASS. private CLI launcher의 이전 platform-package fixture 경로가 IPC 대기 timeout을 일으켜 canonical artifact 경로로 보정했고 실제 IPC/argv/signal regression 1/1 PASS.
- SSH source/명시적 local runtime/누락 runtime download 거부 regression 3/3 PASS. 새 테스트를 기존 Effect FileSystem/ChildProcess/Schema 패턴으로 이관했다. typecheck의 typed-error/logging 규칙도 우회하지 않고 수정 중이며 App 전체 PASS는 아직 아니다.
- 시각 자산: Weavra W SVG를 기존 Android exporter로 렌더링하고 notification PNG를 생성했다. 더 이상 참조되지 않는 원본 screenshot/testimonial/concept binary 35개를 제거했다. Apple-native icon export는 사용자 선택에 따라 Icon Composer 제공을 기다리며 아직 완료하지 않았다.

## 2026-09-21 KST — 검증 안정화 및 실제 C08 경계 재검증

- Runtime subprocess 경쟁을 분리한 실험: coding-agent `--maxWorkers=4` 실행에서 278 files PASS / 6 skipped, 2745 tests PASS / 50 skipped. 기존 30초 timeout은 유지하고 worker 상한을 `min(4, availableParallelism())`로 제한했다. hardening test의 기본 1초 polling 대기는 workflow 시작 전에 설치한 실제 readiness-file watcher로 교체했다. 전체 Runtime 두 entrypoint 최종 결과와는 구분한다.
- App 현재 quality 결과: 전체 typecheck 15 tasks PASS, knip files/dependencies/exports PASS, lint PASS. 기존 React warning은 숨기지 않았으며 신규 diagnostic suppression을 추가하지 않았다.
- clean cutover 정리: 퇴역한 hosted connect CLI 및 전용 테스트, provider credential을 읽던 analytics identifier 및 전용 테스트, 사용하지 않는 headless relay tracing layer를 제거했다. 미사용 export는 삭제하거나 실제 모듈 내부 구현으로 축소했고 obsolete updater UI·Clerk profile·cloud draft 및 electron-store dependency를 제거했다. lock 재생성, frozen install, bootstrap PASS.
- 실제 cross-boundary smoke PASS: 별도 HOME와 Chromium 1234에서 CANDIDATE_ONLY 관찰, App production BridgeTransport/ControlTransport/FitnessReader → 실제 Weavra 실행 파일, 등록 preview 무효화/confirm, workflow confirm/cancel 및 writer 해제를 확인했다.
- RegisteredVerifier가 self-check/test마다 새 Chromium capture를 만들었고, 기존 Ready candidate를 보존한 상태에서 실제 문서를 Broken으로 바꾸자 fresh verification이 FAIL했다. registration은 verification이 아니며 candidate evidence를 재사용하지 않았다. paid provider request 0, 소유한 loopback pending request 1.
- native 아이콘과 전체 App/Runtime gate, 실제 App UI 및 PR CI는 아직 별도 완료 증거가 필요하다. 이 기록은 Phase 1 완료 선언이 아니다.

## 2026-09-21 KST — hosted 경계 정리 및 발행·프로파일 격리 보강

- 역사적 검증 결과 구분: 이 절의 발행/profiler 보강 전 `node scripts/validate.mjs pi` 전체 gate가 556.41초에 PASS했다. `npm test`, `bash test.sh`, check/check:ci, pinned/import/entry graph, shrinkwrap/install-lock 및 browser smoke를 모두 포함한다. 이후 manifest와 profiler 변경이 있어 현재 최종 Runtime 재검증은 별도로 수행한다.
- App 서버 회귀에서 모든 hosted handler를 500으로 막던 문제가 드러났다. hosted proof/enrollment/mint/health는 기존 typed 503 unavailable로 변경하고, 인증된 로컬 metadata/preferences 및 owner unlink는 복구했다. 저장된 connector credential만으로 `managedTunnelActive`를 true로 보고하지 않는다. 원본 product OAuth manager/로그인 HTML/startup·shutdown reconciliation과 퇴역한 전용 테스트를 제거했다. provider OAuth·direct pairing은 유지했다.
- 서버 focused 현재 결과: 5 files / 195 tests PASS. 모든 hosted authority endpoint의 503, connector 비활성, 저장 credential 비노출, unlink 권한 검사·실제 secret 삭제·direct pairing 유지가 포함된다. 이 결과는 전체 App PASS와 구분한다.
- Mobile에서는 hosted device enrollment/relink 및 prompt 전송 시 Live Activity 등록 경로를 제거했다. 로컬 OS 권한·설정·Live Activity opt-out·notification navigation은 유지하고, 시작 시 이전 relay session과 소유한 push/local activity artifact만 정리한다. 5 files / 24 tests PASS; native simulator 실행 결과는 아니다.
- read-only authority review에서 두 실제 누락을 발견해 수정했다: 개별 Runtime package 발행이 root 거부를 우회할 수 있었고 profiler가 무시되는 `PI_CODING_AGENT_DIR`를 사용했다. Runtime 11개 package와 App server의 private/lifecycle 경계를 보강하고 profiler를 canonical `WEAVRA_CODING_AGENT_DIR`로 이관했다. 내부 package 이름은 바꾸지 않았다.
- 실제 npm 일반 발행 smoke 14회(root, workspace 선택, Runtime 각 package, App server)가 모두 exit 1로 명시적 unavailable을 반환했다. preload 활성화 28개 process, registry/외부 연결 시도 0, 실제 발행 0. 사용자 npm 설정·credential을 사용하지 않았다.
- `--ignore-scripts` 우회 검증은 별도 계약이다: 실제 npm이 metadata 조회를 먼저 시도하는 동작을 관찰했다. 복사한 12개 manifest 모두 EPRIVATE로 거부되고, reserved `.invalid` registry의 GET 12회는 연결 전에 차단되었으며 publication 요청은 0이었다. 이를 정상 발행 경로의 network=0 증거와 혼동하지 않는다.
- 현재 root independence regression 4/4 PASS: 기존 CLI/provenance에 npm publication 및 실제 RPC profiler 격리를 추가했다. isolated/명시적 agent home 모두 get_state 성공, ambient extension은 미실행, 지정한 extension만 실행, profiler 외부 연결 시도 0.
- App 최종 typecheck/knip/lint/build/전체 regression과 실제 UI 검증은 진행 중이다. native Icon Composer 제공·export 및 PR CI가 남아 있으며 완료/PR-ready로 기록하지 않는다.

## 2026-09-21 KST — 실제 App 화면, 전체 App gate 및 검증 범위 보존

- 현재 전체 App 결과: `node scripts/validate.mjs t3` 418.96초 PASS. 전체 workspace 16,870 tests PASS / 기존 skip 57, 별도 contracts·Host Control·client state·UI boundary 94 tests PASS. typecheck, lint, fmt:check, knip:check, build, diff whitespace gate를 모두 통과했다. lint는 720 warnings / 0 errors였으며 경고를 억제하지 않았다. Effect suggestions 및 기존 optional x11/import.meta 번들 경고는 남아 있다.
- 실제 격리 web onboarding과 Electron native window를 실행해 title/wordmark `Weavra`, visible version `development`, `Updates unavailable` 및 local-source 안내를 확인했다. 실제 화면에서 발견한 pairing log의 `T3 Code`와 sidebar의 분리된 `T3`/`Code` 표시를 canonical product name으로 수정한 뒤 rebuild·재실행했다.
- 실제 생성된 `Weavra.app`의 이름·bundle ID·scheme은 Weavra / `io.weavra.desktop` / `weavra`다. Electron engine 버전이 native product metadata로 노출되던 부분을 숫자 sentinel `0.0.0`으로 분리했다. native update IPC의 numeric currentVersion과 UI의 `development`는 서로 다른 계약이다.
- legacy `pingdotgg/t3code` update repository 및 mock-update 환경값을 넣은 실제 Electron에서 channel/check/download/install IPC를 호출했다. 상태는 계속 disabled, checked/accepted/completed는 false, release 목록은 비어 있었다. UI는 T3 updater나 release를 권하지 않았다. 이는 mocked service 결과가 아닌 실행 중인 native IPC 결과다.
- Electron main/session과 backend process의 interception 설치를 확인했고, 의도한 reserved `.invalid` renderer probe가 실제 Electron hook에서 차단됐다. 제품 vendor 목적지 시도는 없었다. 별도 third-party 시도인 Codex npm version 조회, Bitbucket 인증 상태 조회, LiteLLM 가격 데이터 조회는 차단·분류했으며 paid inference는 실행하지 않았다. 검증 harness의 Corepack bootstrap 시도와 의도한 guard probe는 제품 트래픽과 구분한다.
- 실제 marketing home/download를 Chromium으로 확인했다. source repository 링크, development 및 installer/store unavailable 정책, 외부 renderer 요청 0을 확인했다. 다만 download/footer의 기존 T3 raster icon이 남아 있음을 직접 확인했으며 native asset gate를 PASS로 처리하지 않았다.
- 실제 설치된 Expo CLI로 production/development/preview config를 각각 실행했다. Weavra 계열 name/scheme, `com.weavra.app` 계열 bundle/application group, owner/project tenant 부재, OTA disabled/NEVER를 확인했다. 세 config process 모두 network ledger 0이다. iOS simulator 및 Android adb/emulator command가 없어 native mobile 화면 검증으로 간주하지 않는다.
- 역사적 Runtime 결과 추가: 발행 보강 직후 전체 gate는 578.11초 PASS했으나, 후속 점검에서 `private` 필터가 SDK dependency gate와 artifact inventory를 축소하는 문제 및 nested SQLite 발행 누락을 발견했다. 이 PASS를 최종 완료 증거로 사용하지 않는다.
- 해당 두 gate 결함과 nested publication은 먼저 실제 실패를 재현했다(3 failures). publication regression을 root workspace glob 전체로 확장하고 SQLite의 private/lifecycle guard를 보강했다. private와 무관한 buildable library entrypoint를 SDK artifact 기준으로 삼아 dependency check·local pack·internal version lockstep 범위를 보존했다. source-only example의 독립 버전은 유지했다.
- 수정 후 관련 script regression 13/13 PASS, 실제 dependency gate는 10 SDK artifacts를 검사했다. 실제 10 tarball의 consumer install 및 SDK/두 CLI smoke도 14.73초 PASS. root independence regression 4/4 PASS이며 Runtime workspace 17개와 App server, 총 18 manifest가 EPRIVATE로 발행을 거부했다. bypass metadata GET 18회는 모두 연결 전 차단, publication 요청 0이다.
- 일반 발행은 16개 서로 다른 package/root/workspace 호출형태를 검증했다(반복 포함 17회). 모두 명시적 unavailable, 외부 연결 0, preload process 34개다. source-only example의 private 검사와 product package의 사전 lifecycle 거부를 혼동하지 않는다.
- 위 SDK inventory/SQLite 변경을 포함한 최종 Runtime 전체 gate는 다시 실행 중이다. Icon Composer 2+ 설치 경로가 아직 없어 native·favicon·marketing raster export가 남아 있다. `/Applications`에도 설치가 확인되지 않았다. 이 상태에서는 완료 선언, 구현 commit/push 또는 PR 생성·CI PASS를 기록하지 않는다.

## 2026-09-21 KST — 최종 실행 가능 gate 완료, native asset 입력 대기

- SDK artifact 범위와 nested SQLite guard를 포함한 최종 `node scripts/validate.mjs pi`가 551.38초에 ALL GATES PASS했다. 두 check 경로 모두 10 artifact package를 검사했고, shrinkwrap/install-lock, root 4 tests, `npm test`, `bash test.sh`, launcher syntax 및 diff gate가 통과했다. 이전 578.11초 결과의 검증 범위 한계를 이 최종 결과로 해소했다.
- 새로 빌드된 `weavra-server` help/version/update를 다시 실행했다. `weavra-server vdevelopment`, 명시적 unavailable exit 1, 세 process의 외부 요청 0을 확인했다. 실제 Desktop/Web startup·update·shutdown ledger의 Pi/T3 product-vendor 요청도 0이었다.
- live App의 별도 third-party 요청은 Codex version 3회, Bitbucket auth status 3회, LiteLLM pricing 1회로 총 7회이며 모두 차단됐다. 의도한 Electron guard probe 1회와 검증 도구 Corepack bootstrap 1회는 제품 요청에서 제외해 별도 기록한다. web/marketing renderer 외부 요청 0, Expo config 0, paid inference 0이다.
- 실제 remote 조회에서 `devlop`과 `main`은 여전히 `8447f9843e0b2d468554e0062abbe6b98a81ba13`이다. original checkout은 clean `devlop`; feature worktree는 같은 HEAD의 `feat/product-independence-phase1`이며 구현 변경 579개가 미커밋 상태다(수정 474, 삭제 97, untracked 8). remote feature branch와 해당 PR은 없으며 PR CI도 실행하지 않았다. source repository 및 보호 branch에 구현 commit/merge를 하지 않았다.
- native asset acceptance만큼은 완료가 아니다. `/Applications`와 `~/Applications`에서 Icon Composer가 확인되지 않았다. 사용자가 선택한 기존 Icon Composer 2+ 경로를 받으면 native/favicon/marketing raster를 export하고 실제 화면을 재검증해야 한다. 그 전까지 App identity/현재 UX gate 및 commit→push→PR→CI delivery를 blocked로 유지한다.
- owned web/desktop/marketing process를 종료하고 browser handle을 닫았다. smoke에서 등록한 worktree `Weavra.app`의 LaunchServices 등록도 해제했다. 소유한 43187–43190 port 종료를 확인한 후 임시 ledger·profile·credential fixture·tool shim 디렉터리 3개를 제거했다. 구현 source와 정상 build artifact는 보존했다.

## 2026-09-21 KST — 사용자 승인으로 아이콘 후속 이관, delivery 재개

- 사용자가 “아이콘은 나중에 하자”라고 명시적으로 승인했다. native/macOS/iOS/universal/Windows icon export, favicon 및 marketing raster 교체는 이번 delivery acceptance에서 제외하고 후속 작업으로 남긴다. 기존 T3 raster가 완전히 제거됐다고 주장하지 않는다.
- 따라서 위 절의 Icon Composer 경로 대기 및 그에 따른 commit/push/PR 차단 상태는 역사적 기록이 되었다. 코드·비아이콘 UI·authority 경계는 검증된 범위로 유지하고, 아이콘 예외를 PR에 명시하여 feature branch delivery를 재개한다. PR은 `devlop` 대상이며 merge하지 않는다.
- 이번 승인은 실행 코드 변경이나 검증 gate 완화가 아니다. Runtime 551.38초 / App 418.96초 전체 PASS, 실제 UI·network·C08 smoke 결과를 유지한다. Native mobile GUI 미검증 및 lint warnings는 계속 별도 제한사항으로 보고한다.
- 최초 commit 시 App hook이 Git product root에서 `vite.config.ts`를 찾지 못해 정상적으로 중단됐다. hook을 비활성화하지 않고 자신의 App package root를 `--cwd`로 지정하도록 수정했다. 별도 실제 Git staged-file smoke에서 App 파일은 포맷되고 Runtime 파일은 byte-for-byte 유지됨을 확인했다. 두 build root의 formatter 경계를 유지한 수정이다.

## 2026-09-21 KST — PR #4 생성 및 원격 CI timing regression 수정

- 구현 commit `8446e2f63b75c138208e001932a9223431655f9c`를 isolated feature branch에 정상 push하고 [PR #4](https://github.com/kjg8619/Weavra/pull/4)를 `devlop` 대상으로 열었다. Hook 우회, force-push, history 수정, merge는 하지 않았다.
- [첫 원격 CI run](https://github.com/kjg8619/Weavra/actions/runs/35589049449)의 실제 cross-boundary 검증은 PASS했다. Runtime은 concurrent-session 테스트가 비동기 credential 준비를 10ms 고정 sleep으로 기다리다가 streaming 진입 전에 단정하여 실패했다. 이어 fixture 삭제가 진행 중인 credential read와 경합한 unhandled rejection도 관측됐다. 앞선 로컬 전체 PASS와 이 원격 실패는 구분한다.
- 고정 startup/queue sleep을 기존 `expect.poll` 방식의 관측 가능한 streaming/queue event 대기로 교체하고, teardown은 stream abort 완료 후 dispose와 fixture 삭제를 수행하도록 수정했다. Concurrent-session 회귀 7개가 로컬에서 모두 PASS했다(Vitest 2.10초). 실패한 assertion을 제거하거나 timeout을 늘려 숨기지 않았다.
- 첫 Ubuntu run의 sandbox suite는 OS backend unavailable을 명시하고 8개를 skip했다. 해당 Linux OS sandbox 실제 경계를 검증했다고 주장하지 않는다. macOS 실제 cross-boundary 결과와 별개 제한사항이다.
- 최종 head의 전체 Root CI 결과와 job 링크는 PR 본문에 기록한다. 이 기록 시점에서 아직 완료되지 않은 원격 gate를 PASS로 선기록하지 않으며, PR은 OPEN으로 유지한다.
- Timing 수정 후 Runtime `npm run check`도 6.50초에 PASS했다. Biome은 1,465개 파일에 추가 수정이 없었고, 10 artifact package dependency 검사, import/entry graph, shrinkwrap/install-lock, TypeScript 및 browser smoke gate를 유지했다.

## 2026-09-22 KST — C09 착수 기준 및 변경 전 first-use baseline

- Canonical scope는 GitHub issue #6이다. `git fetch origin` 및 실제 `ls-remote`에서 `origin/devlop`과 `origin/feat/v0.6d-project-facts`가 모두 `1b2bd177cf2c9248115443cc31948861a4789d16`임을 확인했다. 기존 local devlop은 5 commits 뒤였고 clean이었다. 원격 feature branch를 tracking checkout했으며 HEAD/merge-base가 정확한 baseline과 일치한다. main/devlop 또는 역사적 원본 저장소에는 구현하지 않는다.
- Root README/경계/독립성/hosted audit/작업 기록, 현재 Runtime roadmap/architecture/company-runtime 및 App Host Control/Project panel을 재감사했다. 과거 split-repository 결과는 현재 검증으로 승계하지 않는다.
- 구현 코드 변경 전에 Node 24.19.0, Runtime `npm ci --ignore-scripts`·hydrate·build, App pnpm 11.10.0 frozen install·명시적 bootstrap·build를 실제 실행해 성공했다. Model catalog 다운로드는 명시적 빌드 작업이며 paid inference가 아니다.
- 격리 HOME/WEAVRA_HOME/WEAVRA_APP_HOME 및 disposable Git 프로젝트에서 실제 setup/doctor, built App server, trusted absolute launcher와 `T3_WEAVRA_CONTROL=1`, 로컬 pairing, Settings → exact Project scope → Project UI를 실행했다. 설정·provider profile·allowed paths·registered check는 명시적으로 작성했으며 자동 repair/setup은 하지 않았다.
- 실제 UI goal/AC 수정/Plan Preview/confirm 뒤 STANDARD·READ_ONLY·R0 run `37c7cb76-2710-43bc-b370-85f91a35d6f6`이 COMPLETED다. 서로 다른 SDK Developer/Reviewer session, 실제 Node SELF_CHECK/TEST 2 PASS, AC 1 MET, Review PASS, activeAgents 0 및 writer 해제를 canonical state와 UI 양쪽에서 확인했다. Prepare와 AC preview 갱신 전후 local provider 요청은 0이었다.
- Provider `c09-local/fixture`는 owned loopback deterministic SSE 응답기다. 위 성공 run의 응답 2개는 **faux**이며 실제 유료 모델 호출/추론 품질 검증이 아니다. App/stdio/SDK/파일시스템/registered process/Kernel은 actual이다. paid inference 0.
- 별도 paused run `001bebf5-c379-443f-8d46-2ccf7a129c25`에서 browser 이탈·재접속 전후 동일 RUNNING/writer identity를 관찰했다. UI 명시적 cancel 뒤 CANCELLED·writer false·activeAgents 0이다. Broken source를 fixture commit한 negative run `07e55fdc-6b2d-474a-a236-be7a6192bb05`은 실제 SELF_CHECK FAIL로 BLOCKED이며 Reviewer/COMPLETE에 도달하지 않았다. UI와 canonical state가 일치했다.
- 무관한 first-use friction은 `docs/architecture/PROJECT_FACTS.md`에 별도 backlog로 분리했다: 수동 project config/분산 setup 안내, scope 선택 전 Project 숨김, local READY/provider readiness 혼동, control-connected와 read-only owner UNKNOWN 병기, 완료 뒤 ACK/consumed preview 잔존, 내부 runtime version 표시, Codex update 알림. C09에서 묵시적으로 수정하지 않는다.
- Persistence 결정: 별도 저장소 대신 기존 `.ai/state.json` optional projectFacts, 기존 writer/revision/atomic commit을 사용한다. App는 review/confirm과 Runtime freshness 표시만 담당한다. Facts는 권한·검증·완료 근거가 아니다. 세부 freshness/legacy/책임은 architecture 문서에 명시했다.
- 이 시점 Facts 구현·회귀·최종 전체 gate·PR은 아직 NOT VERIFIED다. macOS web/owned local deterministic provider 이외 OS/provider/native mobile 조합도 NOT VERIFIED다.

## 2026-09-22 KST — C09 계약 구현과 경계 회귀

- Runtime optional `projectFacts`를 기존 FileStateStore schema에 추가했다. 최대 16 sources, 500자 statement, 256자 relative source, 64 KiB strict UTF-8 source다. Legacy state는 read migration 없이 유지된다. Draft는 Host 메모리에만 있고, exact owner/request/revision/digest/expiry를 가진 명시적 confirm 뒤 기존 writer lease와 atomic state commit으로 저장한다. 같은 source 재리뷰는 stable ID를 유지한다.
- Runtime-issued source digest와 root/ancestor/file generation으로 content 변경, 삭제 후 같은 bytes 재생성, symlink/hardlink/unreadable source를 판별한다. Public STALE statement는 null이고 worker에는 VALID만 주입한다. Final canonical schema/registry/config/source 검사는 모든 SDK provider 호출 직전에 다시 수행한다. Tool turn 중 source가 바뀌어도 다음 provider 호출 전에 fail-closed한다.
- 별도 read-only authority/security review에서 canonical state 삭제/손상 후 last-good 재사용과 존재 여부에 따라 누락될 수 있는 configured verifier/LSP 보호 경로를 발견해 수정했다. 모든 configured executable/argv 후보는 임시로 없어도 보호하며 browser executable도 포함한다. 두 reviewer의 최종 static review에 남은 finding은 없다. 이 review 자체는 실행 검증이 아니다.
- App duplicated Effect contract와 기존 trusted ControlTransport 경계를 유지했다. Project panel에서 source/statement 준비, Runtime preview, 명시적 review modal, canonical VALID/STALE read-only 표시를 제공한다. ACK를 VALID로 승격하지 않고 draft·owner·revision·disconnect 변경 시 confirmation을 무효화한다.
- 새 Runtime Facts 회귀 9개, SDK 실제 prompt/provider 경계 회귀 4개가 PASS다. 후자는 canonical VALID만 전달, stale/forged input 제외, prompt preflight 및 tool 후 source 변화에서 provider 호출 차단, Fact 지시문으로 protected Policy/Kernel 완료를 우회하지 못함을 확인했다. Control stream 포함 focused Runtime 실행은 2 files / 11 tests PASS다.
- 실제 production stdio cross-boundary smoke가 PASS다: App transport → Runtime Facts prepare/confirm → durable VALID → source 변경 STALE → 동일 bytes 재생성 STALE. 같은 실행에서 C08 actual isolated Chromium candidate/registration/fresh SELF_CHECK·TEST와 retained Ready candidate + fresh Broken = FAIL을 유지했다. Paid provider requests=0, owned pending loopback request=1이다.
- 개발 중 새 fixture의 setup 순서/필수 agent directory, 외부 오류 wording assertion, UI confirm API 형태를 바로잡았다. Runtime 전체 compiler/check는 PASS했고 App schema 16 tests는 PASS다. 이 시점 두 root의 전체 validator 및 새 UI actual proof는 진행 중이며 아직 최종 PASS로 기록하지 않는다.
- GitHub #23/#8의 현재 실행 규칙도 확인했다. Open PR은 0이며 다른 worktree는 기존 independence/audit branches다. 본 요청의 통합 feature branch만 수정하며, 원격 feature/devlop 통합은 PR review 뒤 사용자 결정으로 남긴다.

## 2026-09-22 KST — C09 새 UI actual proof 및 전체 gate 중간 결과

- App 전체 `scripts/validate.mjs t3`가 453.05초에 ALL GATES PASS다. 모든 workspace tests, focused contracts/server/client/web 회귀, typecheck, lint, fmt:check, knip:check, 전체 build, diff whitespace gate를 포함한다. 기존 build의 chunk-size, optional x11, CJS import.meta warning은 숨기지 않았고 native 플랫폼 성공으로 확대 해석하지 않는다.
- 새 App/Runtime을 재기동해 actual Project panel에서 review modal, canonical VALID, 원본 변경 STALE, 동일 bytes 재생성 및 reload 뒤 STALE 유지 화면을 확인했다. 준비/리뷰 전에는 durable Fact가 없고 provider call도 0이다. Fact `74388c50-b59b-410c-bf3c-88b267e33d96`은 명시적 재리뷰 뒤 같은 ID와 새 reviewedAt을 유지했다.
- Stale-context run `600307aa-d241-4e72-bfa1-ab180bf34241`은 새 UI goal/AC/preview/confirm 뒤 COMPLETED이며 실제 checks 2 PASS, 독립 Reviewer PASS, activeAgents 0/writer false다. Owned provider가 받은 Developer/Reviewer 요청 양쪽에서 facts=[]를 확인했다. 이후 valid-context run `56de66b2-7768-48cc-883a-89c686775958`은 양쪽 worker에 Runtime VALID fact 1개를 전달하되 READ_ONLY/R0와 registered-check/Review/Kernel 경계를 그대로 유지해 COMPLETED다.
- Post-Facts negative run `ac7fc70d-7a46-456e-8c4c-c0a9b299d8c8`은 fixture source Broken에서 실제 SELF_CHECK FAIL → BLOCKED다. Stale Fact는 prompt에 없고 Reviewer/PASS/COMPLETE를 만들어내지 않았다. UI와 canonical state가 일치한다. 이 단계 provider responses 5개는 모두 `c09-local/fixture` **faux**, paid inference 0이다.
- Runtime 전체 첫 시도에서 기존 model-registry override 테스트 3개가 hydrated catalog에서 삭제된 `anthropic/claude-opus-4`에 의존해 실패했다. 제품 model 선택/metadata를 바꾸지 않고 해당 override tests에 명시적 model fixture를 제공했다. 존재하지 않는 모델의 optional field가 undefined라는 무의미한 assertion도 제거했다. Focused 83 tests PASS 후 typed models.json fixture로 정리했으며 전체 Runtime gate를 다시 실행 중이다. 실패를 skip하거나 PASS로 기록하지 않는다.

## 2026-09-22 KST — C09 최종 local gate 완료

- Typed fixture 수정 후 `node scripts/validate.mjs pi`가 514.39초에 **ALL GATES PASS**다. check/check:ci, pinned/runtime deps·TS imports·entry graphs, shrinkwrap/install-lock, product-independence 4 tests, 전체 workspace npm test, 별도 isolated `bash test.sh` 재실행, launcher syntax, diff whitespace를 모두 통과했다. Current company-runtime은 57 files / 1,506 tests PASS, coding-agent는 279 files / 2,749 tests PASS이며 기존 environment-gated 6 files / 50 tests는 skipped다. 이 skipped 항목을 실제 Provider 검증으로 주장하지 않는다.
- Final shared canonical-size bound 정리 후 별도 `npm run check:ci`도 PASS다. Runtime build, immutable imports 검증, consolidation/source-archive 및 staged lock regression 3 tests, nested model catalog tool도 PASS다. Generated model metadata와 빌드 산출물은 tracked source 변경을 만들지 않았다.
- App 전체 gate PASS와 결합해 최종 production cross-boundary를 다시 실행했고 10.74초에 PASS다. 실제 Chromium·stdio·Runtime Facts·fresh verification/CANCELLED 경계를 포함하며 paid requests=0이다. 정확한 current proof와 한계는 `docs/architecture/PROJECT_FACTS.md`에 정리했다.
- Smoke 완료 뒤 owned App/provider processes를 정지하고 browser tab과 disposable project/HOME/helper scripts를 제거했다. Root 작업 기록만 수정했고 역사적 원본 저장소 기록·license·notice는 그대로다.
- 구현·검증은 dedicated feature branch에서 완료했다. 이제 정상 commit/push 및 `devlop` 대상 OPEN PR로 전달한다. 자동 merge, hook 우회, force-push, history rewrite 또는 C09 CLOSED 선언은 하지 않는다.
