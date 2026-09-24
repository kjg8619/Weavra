# Weavra 작업 기록

## 현재 진행 요약

- 갱신: 2026-09-24, Asia/Seoul (UTC+09:00). 저장소 통합 baseline과 Product Independence Phase 1은 완료된 역사적 결과로 보존한다.
- 진행 단계: V0.7B COMPLEX 순차 워크플로. #15 설계 계약(`docs/architecture/COMPLEX_SEQUENTIAL_WORKFLOW.md`)은 머지됐다. 설계의 소비자 우선 규칙에 따라 #17 App 소비자를 먼저 올리고, #16 Runtime 생산자는 별도 worktree에서 단계별(A 기반 → B 엔진 → C 상태 출력)로 진행 중이다. #18 통합 검증은 둘 다 머지된 뒤 시작한다.
- 그다음: #19 병렬 에이전트 설계 → #20 Runtime ∥ #21 App → #22 스트레스 검증(각각 선행 이슈 종료 후). #5 OmO 후보는 별도 백로그다.
- 원본 Pi/T3Code 저장소는 수정하지 않는다. 아래 기록은 날짜별 append-only이며, 현재 실행 결과와 이전 저장소의 역사적 결과를 구분한다.

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

## 2026-09-22 KST — V0.7A Capability Broker #11 설계 감사

- #23의 최신 roadmap과 #11 본문·전체 댓글, #12/#13/#14 handoff 범위를 읽었다. PR #24 통합 후 `devlop`과 설계 branch의 기준은 `7dd8c96042a28ead786cec9b3fa0763119edd139`이며 시작 시 worktree는 clean, open PR은 0이었다. 기존 independence/audit worktree는 수정하지 않고 `design/v0.7a-capability-broker`에서 문서만 작성했다.
- 현재 통합 저장소의 Runtime tool/Policy/Approval/worker isolation/LSP/provider metadata/Host snapshot과 App MCP toolkit/auth/annotations/control transport/decoder/RPC scope/client cache/UI 경로를 read-only로 재감사했다. 역사적 hosted-service audit와 과거 C09 PASS는 현재 Broker 검증으로 재사용하지 않았다. 기존 test는 계약 근거로 읽었을 뿐 이번 작업에서 실행하지 않았다.
- `docs/architecture/CAPABILITY_BROKER.md`에 discovery noninterference, stable identity와 volatile observation·실행 authority 분리, provenance·민감정보 제외, typed availability·epoch/generation·invalidation, bounded list/query와 snapshot budget, 29개 negative scenario, #12/#13/#14 소유권·수용 조건을 제안했다. 이 문서는 review 대상 freeze안이며 Broker 구현 완료 선언이 아니다.
- 초기 범위는 기존 Runtime 파일/LSP action tool 10개에 대한 설명용 inventory다. 기존 `control.snapshot`에 선택적 필드만 제안하고 command/worker tool/RPC/실행 경로는 추가하지 않는다. LSP 설정 활성화는 negotiated readiness가 아니므로 UNKNOWN이며, App MCP hints·plugin metadata·provider catalog·credential 존재를 worker permission으로 승격하지 않는다.
- App의 기존 strict decoder와 `controlObserve`의 `orchestration:operate` scope를 확인했다. “조회 UI”를 read principal의 control-owner 획득 허가로 바꾸지 않는다. 기존 observer-only v1은 그대로 두고, consumer #13 선행 또는 matched deployment를 권고했다. optional field는 새 App→기존 Runtime만 호환하며 기존 App→새 Runtime의 unknown field 거부를 숨기지 않았다.
- Hronom 댓글은 유용한 설계 입력으로 반영하되 Weavra 실행 증거가 아니라고 명시했다. Monotonic discovery와 typed uncertainty·negative matrix는 채택하고, generation은 observation에 두며 불필요한 provider/protocol/provenance 필드와 persisted approved/executable 상태는 초기 계약에 넣지 않았다.
- 현재 확인한 baseline GitHub CI run `35675020307`은 `in_progress`이며 PASS로 기록하지 않는다. 이번 작업은 Runtime/App full suite, MCP discovery, provider/auth/network smoke를 실행하지 않는 docs-only lane이다. #12/#13 구현과 #14 통합·보안 검증은 아직 착수하지 않았다.
- 설계 보안 리뷰에서 blocking finding은 없었다. 계약 리뷰의 첫 구독 cache를 fresh로 오인할 가능성과 실패 refresh timestamp 모호성은 각각 “첫 emission은 stale 기준값, 후속 새 generation 필요”와 “실패도 새 publication timestamp” 규칙으로 수정했다. Listing schema 소유 파일도 실제 `list-files-tool.ts`로 바로잡았다. 이는 source/design review 결과이며 구현 보안 검증 PASS가 아니다.
- 문서 검증: 상대 evidence link 54개/고유 경로 53개 모두 존재, 기존 root WORK_LOG 42,426 bytes가 그대로 prefix로 보존, negative ID 29개 unique를 확인했다. Staged diff는 이 architecture 문서와 root WORK_LOG 두 파일뿐이며 `git diff --cached --check` PASS다. Production source·lockfile·workspace·실행 동작 변경은 0이다. 정상 commit/push와 `devlop` 대상 OPEN PR로 전달하고 review 전 merge 또는 #12/#13 구현을 시작하지 않는다.

## 2026-09-22 KST — V0.7A App Capability Broker #13 구현 및 focused 검증

- GitHub #13, merged #11/PR #25와 `CAPABILITY_BROKER.md` 전체 계약을 읽고 시작했다. 원격 `devlop` 및 지정 baseline은 `932423c37f1d8eee8140a230f5944cc8fd1867d3`, 시작 당시 open PR은 0이었다. 전용 worktree `Weavra-worktrees/v0.7a-capability-app`, branch `feat/v0.7a-capability-app`만 사용했다.
- Consumer-first 구현이다. App contracts에 닫힌 Broker schema를 독립적으로 중복하고 기존 `WeavraControlState`의 optional `capabilityInventory`만 추가했다. Baseline Runtime이 필드를 보내지 않으면 기존 control은 유지하고 inventory는 NOT_EXPOSED/UNKNOWN이다. 보충 RPC/discovery, Runtime source import, shared cross-root protocol package, command/version/coverage 변경은 없다. 미래 unknown field/kind/enum/schema 및 forged 권한·민감 metadata는 strict decode 실패다.
- `RuntimeController`는 canonical owner/project와 bound transport, epoch retirement, generation regression 및 동일 generation의 내용 변경을 검사한다. 객체 key 순서는 schema-derived structural equivalence로 비교한다. Inventory 실패는 기존 stale/unavailable 관측 경로를 따르며 workflow/approval/Kernel 데이터를 새로 만들지 않는다.
- Client는 매 subscription 첫 emission을 CONNECTED 여부와 무관하게 stale baseline으로 취급한다. 이후 checked 새 generation 또는 유효한 replacement만 current가 되고 `performance.now()` 기반 local receipt age 5초가 지나면 inventory만 NEEDS_REFRESH가 된다. Equal generation은 clock을 연장하지 않는다. Disconnect/session/project/workspace/owner 변경, absent field, UNKNOWN/NEEDS_REFRESH, removed rows를 last-good merge 없이 처리한다.
- Project controls 안에 inspection-only inventory panel을 추가했다. Name/ID, family, Runtime origin, availability/reason, 고정 requirement 설명, Host observation time, owner/revision/epoch/generation, coverage, omitted count만 표시한다. Historical rows는 NEEDS_REFRESH다. Permission/enable/install/register/approve/execute 버튼, MCP discovery/provider fallback은 없다. `weavra.controlObserve`의 `orchestration:operate` authorization 및 기존 ordinary observer는 변경하지 않았다.
- Focused 현재 결과: contracts 2 files/69 tests, server transport/controller/auth/MCP 4 files/66 tests, client state 1 file/29 tests, UI 2 files/24 tests PASS(총 188 tests). Generation/scope/epoch/disconnect/first-emission 및 compatibility negatives, App 실제 MCP advertisement를 permission/Policy eligibility/approval/worker exposure/PASS/COMPLETE 입력으로 넣는 거부 경계를 검사했다. 이 MCP 경계 테스트는 Runtime 실행 proof가 아니다.
- 개발 중 client fixture의 기존 WAITING_APPROVAL 상태를 RUNNING으로 잘못 기대한 assertion과 readonly fixture 수정 방식을 바로잡았다. 실제 계약은 workflow snapshot/approval가 inventory 관측 전후 그대로라는 assertion으로 검증한다. 초기 Node 26 engine warning 이후 정식 검증은 지원되는 Node 24.19.0을 사용했다. 기존 Effect suggestions를 숨기지 않았다.
- Actual UI smoke: 별도 loopback Vite에서 실제 `CapabilityInventory` component와 App tracker를 frozen-contract fixture로 mount하여 Chromium에서 확인했다. 첫 cached generation의 historical NEEDS_REFRESH, 후속 generation의 File AVAILABLE/LSP UNKNOWN, 실제 5초 후 expiry, disconnect, 필드 생략의 NOT_EXPOSED/UNKNOWN을 관찰했다. Scope/coverage/omitted 표시, action controls 0, 390px absent-state에서 overflow 없음, browser errors 0을 확인했다. 기존 `WeavraControls` 연결은 component regression으로 검증했다. 실제 Runtime #12→App 전체 Project 화면 통합 검증을 했다는 뜻은 아니다.
- Smoke 전용 HTML/TSX 두 파일과 owned server/browser handle을 제거했다. App 전체 workspace tests/typecheck/lint/format/knip/build gate는 현재 실행 중이며 아직 최종 PASS로 기록하지 않는다. `runtime/pi/**`, frozen architecture 문서, locks와 RPC authorization source 변경은 없다. #14, 실제 provider/LSP negotiation, credentials expiry, native UI, Runtime Policy/worker/Kernel 실행 noninterference 통합 proof는 이 App-only lane에서 NOT VERIFIED다.

## 2026-09-22 KST — #13 최종 App gate 및 review 인계

- 최종 `node scripts/validate.mjs t3`가 **437.67초 / ALL GATES PASS**다(Node 24.19.0, pnpm 11.10.0). 전체 workspace는 1,254 test files / **16,955 tests PASS**, 기존 6 files / 57 tests skipped다. 이어 기존 focused 재실행, 전체 typecheck, lint, fmt:check, knip:check, 전체 App build, diff whitespace gate가 모두 통과했다. Skipped tests를 실제 환경 검증으로 확대하지 않는다.
- 첫 전체 실행은 workspace tests 뒤 새 fixture 6곳의 Effect JSON codec 규칙 위반으로 typecheck에서 실패했다. 이를 기존 Schema codec 방식으로 수정했고 실패를 우회하지 않았다. 새 테스트의 decoder compilation을 module scope로 옮겨 불필요한 allocation/lint warning도 제거했다. 최종 lint는 기존 **720 warnings / 0 errors**이며 changed App files의 별도 lint는 경고 없이 통과했다. 기존 Effect suggestions, React test renderer/router/localStorage 진단, optional x11/CJS import.meta 및 build 경고는 보존했다.
- 추가 regression은 server emission 없이도 실제 client state timer가 5초에 inventory만 stale 처리하는 것과 JSON key 순서가 generation 변경 또는 freshness 연장으로 취급되지 않는 것을 검증한다. 최종 관련 focused 범위는 **190 tests PASS**(contracts 69, server transport/controller/auth/MCP 66, client 31, UI 24)이며 모든 새 tests는 최종 전체 workspace 실행에도 포함됐다.
- App-owned negative matrix evidence: schema tests가 N02–N06/N18/N24/N25/N27, controller/transport tests가 N08–N11/N17/N23/N26/N27, client tests가 N07–N11/N26/N27, inventory UI tests가 N10/N17/N18/N25, 실제 App MCP advertisement input-boundary test가 N19/N23을 담당한다. Runtime Policy/worker exposure/Kernel의 실제 실행 비교는 #14의 별도 책임이며 이번 결과로 대신하지 않는다.
- Build 뒤 tracked source 변경 목록은 의도한 App 구현/tests와 root 작업 기록뿐이다. `runtime/pi/**`, frozen `CAPABILITY_BROKER.md`, lockfiles, 기존 RPC authorization source의 변경은 0이다. Delivery 직전 원격 `devlop`은 여전히 지정 baseline이며 Runtime #12의 PR #26은 OPEN이었다. #12 코드를 가져오거나 의존하지 않았다.
- 정상 commit/push와 `devlop` 대상 App consumer PR로 review를 요청한다. Consumer-first 권고는 그대로이며 baseline field absence는 NOT_EXPOSED/UNKNOWN이다. 자동 merge, #14 착수, 원격 CI PASS 주장 또는 통합 보안 gate CLOSED 선언은 하지 않는다.

## 2026-09-22 KST — V0.7A Runtime Broker #12 구현 및 집중 검증

- 기준은 #11/PR #25가 병합된 정확한 `932423c37f1d8eee8140a230f5944cc8fd1867d3`다. `feat/v0.7a-capability-runtime` 전용 worktree에서 구현했고 App 파일, Policy/Approval/Kernel 의미, 기존 11개 Host command 및 protocol v1은 변경하지 않았다. #11의 fields/enums/coverage/limits/freshness/compatibility 본문은 그대로 유지한다. 병렬 #13의 구현을 가정하거나 #14를 시작하지 않았다.
- 실제 file/list/LSP adapter의 parameter schema를 부작용 없는 `action-tool-schemas.ts`로 추출해 adapter와 Broker가 같은 선언을 사용한다. `capability-catalog.ts`는 canonical JSON/sha256와 고정 요구조건만 만들고, `capability-broker.ts`는 Host-private candidate/publish 및 immutable bounded list/exact-ID query를 구현한다. 반환 reader에는 등록·refresh·설치·실행 API가 없다. Worker 등록은 기존 경로만 사용한다.
- Host snapshot은 현재 전체 normalized config를 샘플 전후 비교하고 기존 root/revision/execution-owner coherence fence와 최대 2회 재시도를 유지한다. 실패도 generation/time을 갱신하며 last-good CURRENT를 재사용하지 않는다. Inventory는 32행/16,384 UTF-8 bytes 이내이고 전체 응답 65,536 bytes에는 LF를 포함한다. 공간 부족 시 역순 whole-row만 제거하며 기존 preview/approval/evidence/state를 줄이지 않는다.
- 집중 deterministic 회귀 첫 성공: company-runtime 7 files / 196 tests PASS, 실제 SDK worker/Host suite 2 files / 123 tests PASS. 첫 시도의 새 fixture 문제는 ESM namespace `spawn` spy와 전체 state-store 호출 수를 snapshot 시도 수로 오인한 assertion이었다. Mutable builtin+ESM sync와 계약상 snapshot 시도 수 검사로 바로잡았다. 잘못 지정한 존재하지 않는 Vitest config 파일 때문에 suite 실행 1회가 시작 전에 실패했으며 정상 package config로 수정했다. Timeout 증가·skip·무작정 retry는 하지 않았다.
- Root validator 첫 시도는 `Object.freeze` 때문에 reader의 discriminated union과 input이 contextual type을 잃어 TypeScript에서 실패했다. `Object.freeze<CapabilityRegistryReader>`로 계약 타입을 명시했다. 초기 로컬 PATH의 Node 26.7.0 실행과 구분하여 최종 검증은 CI에 고정된 Node 24.19.0을 사용한다. 이 절 작성 시 최종 전체 validator는 진행 중이며 PASS로 선기록하지 않는다.
- **Actual Runtime smoke:** production `weavra bridge --stdio --project-trusted --control`을 격리 HOME/project에서 실행했다. 설정 없음은 generation 1 UNKNOWN/CONFIG_UNAVAILABLE, 정상 설정은 generation 2 CURRENT/정확히 10행/6,203 inventory bytes, disabled LSP 4행은 UNAVAILABLE/LSP_DISABLED였다. enabled+존재하지 않는 executable 설정은 generation 3에서 UNKNOWN/LSP_NOT_OBSERVED이며 실행 가능으로 승격되지 않았다. 잘못된 config는 generation 4의 빈 UNKNOWN으로 교체됐다. forged snapshot field는 INVALID_REQUEST, 임의 capability 실행 command는 UNSUPPORTED_COMMAND였다.
- 같은 actual smoke의 Runtime 재시작은 새 epoch/generation 1을 만들었다. 두 프로세스 모두 preload guard에서 network connect/fetch, child process, auth/credentials file 접근 시도 **각각 0**이었다. config/provider/LSP argv sentinel은 wire에 없었고 자동 `.ai` state/agent home 생성도 없었다. 명시적으로 작성한 config만 남는 것을 확인한 뒤 소유 프로세스를 종료하고 임시 project/HOME/guard를 제거했다.
- **Faux/미검증 구분:** availability와 부정 입력 tests의 config/provider는 fixtures이고 SDK suite의 모델 응답도 faux다. actual stdio·파일시스템·Policy·SDK tool exposure·Kernel 경계의 실행 증거이지 실제 provider health/credential expiry/LSP negotiation/외부 MCP 동작 검증이 아니다. Build/hydrate가 명시적으로 model catalog endpoint를 조회한 것은 Broker discovery의 zero-network smoke와 별개다. App UI/소비자 freshness/통합 #14는 이 Runtime lane에서 미검증이다.

## 2026-09-22 KST — V0.7A Runtime #12 최종 local gate

- Node **24.19.0**에서 locked `npm ci --ignore-scripts`와 전체 `npm run build`가 PASS했다. 별도 explicit `hydrate:model-data`도 PASS다. Install의 기존 deprecated package warnings는 숨기지 않았다. Model catalog 갱신/빌드가 App 또는 lockfile 변경을 만들지 않았다.
- 최종 `node scripts/validate.mjs pi`는 **561.20초 / ALL GATES PASS**다. check/check:ci, 10개 artifact package dependency 검사, pinned/import/entry graph, TypeScript, browser smoke, shrinkwrap/install-lock, product-independence 4 tests, 전체 workspace `npm test`, 별도 격리 `bash test.sh`, launcher syntax, diff whitespace를 모두 통과했다. 첫 check의 formatter는 추가한 tests 두 파일만 정리했고 다음 check:ci는 수정 없이 통과했다.
- 두 전체 실행의 company-runtime 결과는 **60 files / 1,522 tests PASS**, coding-agent는 **279 files / 2,750 tests PASS**다. 신규 Broker/authority/Host suite 3개, 16 tests가 포함된다. 기존 coding-agent 6 files / 50 tests와 AI provider 환경 의존 26 files / 847 tests 등의 skip은 기존 gate 동작이며 실제 외부 provider 검증으로 확대 해석하지 않는다.
- 추가 root CI gate도 PASS: immutable imports의 Runtime 1,918/App 23,069개 historical entries 보존, staged-lock/standalone-source-archive regression 3 tests, nested model-catalog diff(openai 변경 없음). App 구현 파일은 변경하지 않았고 root architecture의 기존 **44,905 bytes**, WORK_LOG의 기존 **46,224 bytes**가 byte-for-byte prefix로 보존됨을 확인했다.
- `CAPABILITY_BROKER.md`에는 계약 본문을 수정하지 않고 Runtime evidence appendix만 추가했다. N01–N07/N09/N11–N17/N19–N25/N28–N29의 Runtime evidence mapping과 actual/faux/미검증 범위를 명시했다. #13 UI/consumer 및 #14 combined integration은 별도이며 이 PR에서 수행하거나 완료 선언하지 않는다.
- Local gate 완료 후 정상 commit/push와 `devlop` 대상 OPEN PR로 전달한다. Remote CI 결과는 local PASS와 구분해 PR에 기록한다. **#13 consumer가 먼저 landing되어야 하며**, 명시적 matched-version 전략 선택 전에는 #12를 먼저 merge하지 않는다. 자동 merge·force-push·history rewrite·hook 우회는 하지 않는다.

## 2026-09-22 KST — V0.7A #14 통합/security gate 최종 검증

- Issue #14만 수행했다. 시작 전 원격 `devlop`, merge-base와 지정 baseline이 정확히 `409e1351a182be9ce04633af9c4b79239508ab6a`임을 확인했다. #11/#12/#13은 CLOSED, PR #25/#27/#26은 merged, open PR은 0이었다. App consumer #13 → Runtime #12 landing 순서도 확인했다. `test/v0.7a-capability-integration` branch와 `Weavra-worktrees/v0.7a-capability-integration` 전용 worktree만 사용했으며 기존 checkout은 수정하지 않았다.
- 검증한 구현 HEAD는 **`74430145d27333dded4c7d6756cca27c84cd6e59`**다. 뒤따르는 commit은 이 작업 기록과 architecture evidence만 추가하며 최종 delivery HEAD는 PR 본문에 별도 기록한다. 전체 Runtime/App gate는 변경 없는 baseline 제품 source에서 실행했고, 최종 전용 smoke의 실행 tree를 이 구현 SHA로 커밋했다. #11 frozen 계약 본문 §§1–11, 기존 §12, protocol/commands, Facts/Policy/Approval/Kernel, App RPC scope, worker tool exposure와 두 독립 build root는 수정하지 않았다.
- 신규 `node scripts/run-capability-boundary.mjs`와 5개 test-only helper를 추가하고 기존 cross-boundary CI job에 연결했다. 기존 cross-boundary smoke는 CURRENT inventory를 함께 관찰하면서도 fresh Broken browser check가 FAIL이고 이전 canonical run이 CANCELLED로 유지됨을 확인한다. 제품 코드 변경은 **0**이며 #15 구현도 **0**이다.
- **Actual 통합:** production launcher/stdin/stdout → App production ControlTransport/RuntimeController → 실제 client inventory tracker와 CapabilityInventory component를 실행했다. 10개 정의/adapter schema digest/11개 commands/scope·owner·epoch·generation, NOT_SETUP/no setup, invalid/removed config의 빈 UNKNOWN, 설정된 LSP 실행 파일 삭제 후 UNKNOWN/LSP_NOT_OBSERVED를 검증했다. 첫 cached emission은 NEEDS_REFRESH이고 이후 checked generation만 CURRENT다. 5.1초 inventory 전달을 보류하는 동안 별도 실제 workflow observer는 connected/non-stale이며 generation이 계속 진행하는데 inventory만 만료된다. 동일 generation은 freshness를 갱신하지 않는다.
- **Actual lifecycle:** 같은 Host 재구독, 소유 Runtime 프로세스 종료와 재연결, 새 owner/epoch/generation 1, ephemeral Facts draft 소멸, facts.prepare 1회만 관측되어 mutation replay가 없음을 확인했다. 동일 owner의 Broker-only epoch 재시작과 늦은 retired callback은 deterministic injection이다. 이를 실제 process restart와 혼동하지 않는다.
- **Actual authority + faux 구분:** 실제 App-decoded CURRENT/UNKNOWN/absent inventory를 실제 worker adapter/Policy/파일시스템에 대조했다. 독립적으로 허용된 read는 계속 성공하고 READ_ONLY mutation·foreign R2는 거절된다. 실제 delete adapter의 consent/audit port는 faux다. expired/foreign/input/config/reused grant는 파일을 지우지 못하고 정확한 현재 grant만 삭제한다. 새 action UUID로 인한 재사용 거절을 durable one-use proof라고 부르지 않는다. Durable pending/expiry/consumption/replay는 이번에 재실행한 기존 Approval/SDK suite가 담당한다.
- 실제 RegisteredVerifier가 Node exit code **1 / FAIL**을 관측하고 변경된 등록 check는 거절한다. 별도 assertCanComplete는 독립 Reviewer/final-check 증거 부재를 거절하는 proof이며 이 smoke가 live Kernel 완료 전이를 구동했다고 주장하지 않는다. 기존 Kernel/verification suite도 현재 HEAD에서 모두 재실행했다. 실제 Chromium C08에서는 candidate=CANDIDATE_ONLY, register≠verify, retained Ready보다 fresh Broken FAIL이 우선이며 CURRENT가 PASS/COMPLETE를 만들지 않는다. Facts VALID→STALE와 동일 파일 재생성 fence도 유지됐다.
- **Budget/source injection:** 실제 Host config 두 번 읽기 사이 파일 변경을 주입하면 SOURCE_CHANGED이며 mixed CURRENT/hidden retry가 없다. App-valid multibyte Facts와 non-null approval/preview/run/evidence를 넣어 실제 Host serialization→App strict decode를 통과시켰다. Inventory whole-row만 줄고 모든 비-Broker state가 deep-equal로 보존되며 정확한 omitted/order와 16,384/65,536 UTF-8 byte 한계(LF 포함)를 지킨다. 비-inventory 응답은 들어가지만 빈 inventory header조차 넘치는 정확한 경우 RESPONSE_TOO_LARGE다.
- **Scoped activation/leakage:** 최종 실행에서 snapshot **15구간 + observation idle 구간**의 계측된 Node network/child-process/credential-resource API 시도는 **0**이었다. fetch/spawn/credential read/DNS promise/dynamic skill import 양성 대조군 **5개**는 실제로 차단되었고 별도 actual Host ModelRuntime factory 호출도 0이다. provider/model/argv/token/endpoint/document sentinel은 wire/App state/SSR/stderr에 없었다. 실제 component의 baseline/CURRENT/expired HTML capture를 Chromium에서 열어 각 10행, controls 0, sentinel 0을 확인했다.
- **계측 한계/미검증:** Node hook 결과이지 OS sandbox 또는 모든 native/internal/다른 realm/기존 connection/preopened handle/메모리 cache/resource path에 대한 보편적 증명이 아니다. Configured launcher의 prepareLaunch/doctor auth·models·settings 읽기 및 git 실행은 측정 전 startup으로 분리했다. 명시적 build/catalog bootstrap, package manager hydration, publication guard probe, browser 설치는 Broker discovery가 아니다. 실제 vendor credential expiry/provider health/유료 inference, 실제 외부 LSP negotiation/MCP end-to-end, native/mobile/다른 OS, 신규 smoke의 mounted App WebSocket/browser hydration은 **NOT VERIFIED**다. UI 확인은 실제 component의 unstyled SSR capture이며 reactive timer/session auth는 기존 App 회귀 재실행 증거다.
- **Compatibility:** 실제 현재 producer는 strict App decoder를 통과했다. 실제 응답을 바탕으로 optional field만 생략한 faux old producer는 production transport에서 NOT_EXPOSED와 기존 state를 보존하고 hello+snapshot만 보냈다. 미래 unknown field는 INVALID_PAYLOAD다. 과거 배포 binary를 실행했다고 주장하지 않는다. Actual MCP Preview toolkit annotations는 설명 metadata로만 다루고 Broker schema/Host command/worker authority로 넣으면 거절된다.

### #14 현재 실행 결과 — 이전 절의 역사적 결과와 구분

| 실행 | 현재 결과 |
| --- | --- |
| Node 24.19.0 Runtime `npm run build` | PASS; explicit catalog/build network는 별도 |
| `node scripts/validate.mjs pi` | **ALL GATES PASS / 567.69초**: check/check:ci/pinned deps/import/entry graphs/TypeScript/browser smoke/shrinkwrap/install-lock/product independence 4 tests/전체 npm test/격리 bash test.sh/launcher syntax/diff |
| Runtime 전체 두 번의 핵심 suite | 각각 company-runtime **60 files/1,522 tests**, coding-agent **279 files/2,750 tests PASS**; 기존 Vitest skip 898 tests는 외부서비스 검증으로 확대하지 않음 |
| `node scripts/validate.mjs t3` | **ALL GATES PASS / 510.70초**: 전체 **1,254 files/16,955 tests PASS**, 기존 6 files/57 tests skipped; focused reruns/typecheck/lint/fmt/knip/build/diff |
| App lint/build 진단 | 기존 **720 warnings/0 errors**, Effect/React/optional x11/CJS import.meta 등 기존 진단 보존 |
| `node scripts/run-cross-boundary.mjs` | **PASS / 9.88초**: real stdio, Facts, fresh Chromium, CURRENT와 Broken FAIL 공존 |
| `node scripts/run-capability-boundary.mjs` | **PASS / 22.21초**: review 강화 후 최종 실행, 위 실제/faux/계측 구간 |
| 추가 focused Runtime | **7 files/197 tests PASS** |
| 추가 focused SDK agent/control/approval | **3 files/174 tests PASS** |
| 추가 focused App contracts/server/client/inventory UI | **170 tests PASS** |
| Root 보존 gate | Immutable Runtime 1,918/App 23,069 historical entries PASS; staged lock/standalone source archive **3 tests PASS**; openai catalog 변경 없음 |
| 빌드/검사 뒤 tracked source | `runtime/pi/**`, `app/t3code/**`, lockfiles diff **0**; product independence의 CLI help/version/home/update/publication/profiler 격리도 PASS |

- 첫 전용 smoke 실패는 새 harness가 기존 계약을 잘못 가정한 네 곳이었다: unknown check는 UNAVAILABLE 반환이 아니라 throw, foreign R2 run은 REVIEW_REQUIRED가 아니라 DENY, verifier fixture source는 git commit이 필요, in-process Host는 snapshot 전 hello가 필요했다. 기존 계약대로 수정했다. 초기 PATH 공백 인용 실패도 도구 환경에서 수정했으며 제품 실패로 오기하지 않는다. Review는 verifier exitCode=1, expiry 동안 실제 workflow 관찰, 채워진 canonical state 보존, 정확한 empty-header overflow, guard/양성 대조군 확대 및 same-owner/faux-consent 증거 라벨을 강화했다. 제품 bug나 frozen contract drift는 발견하지 못했다. Skip 추가·timeout 증가·assertion 약화·무작정 retry·실패 숨기기는 하지 않았다.
- Read-only lifecycle/security review의 최종 blocker는 0이다. 리뷰 자체는 실행 증거가 아니며 위 최종 재실행이 proof다. N01–N29 각각의 Runtime/App/신규 통합 evidence, PASS와 actual/deterministic-faux/inherited focused regression rerun 분류는 `CAPABILITY_BROKER.md` **§13** 전체 matrix에 기록했다. 기존 unit 회귀를 복제하지 않고 실제 combined payload/transport/lifecycle/serialization 경계와 기존 회귀 재실행을 연결했다.
- Architecture 기존 **48,886 bytes**(sha256 `80154cae4c1bd9d227033c32040ea5d5a36222bcb522d443944a10cd78fd4609`)와 root WORK_LOG 기존 **59,693 bytes**(sha256 `b508572d4bff089e65e57aba43c18c4721d387adfac113bb8dda8c9aa448ac12`)를 append 전 prefix로 보존했다. Source-repository work log/라이선스/notice/immutable provenance는 수정하지 않았다.
- **판정:** V0.7A combined local integration/security gate는 **PASS, #14 review/closure-ready**다. 고정된 로컬 증거 범위에서 N01–N29의 설명 없는 누락은 없다. **#15 COMPLEX 검토를 위한 기술 prerequisite는 충족**했지만 실제 착수·구현·승인은 하지 않는다. 정상 #14 review/CI/merge 이후 별도 결정할 수 있다. GitHub issue를 닫거나 PR을 merge하지 않고 `devlop` 대상 OPEN PR로 인계한다. 원격 CI를 local PASS와 혼동하지 않는다.

## 2026-09-22 KST — PR #28 Runtime terminal-event race 후속 수정

- 이전 절의 local PASS는 `74430145d27333dded4c7d6756cca27c84cd6e59` 구현 / `41267be2c5fa8ac2a3c65811cff748d3da9fcd97` 문서 HEAD의 역사적 결과다. 이후 원격 workflow `35688980409`는 App/cross-boundary PASS, Runtime FAIL이었다. `experimental-remote-runtime.test.ts`의 prompt streaming test가 첫 npm test에서는 통과했지만 격리 `bash test.sh`에서 `run_end`를 놓쳤다. 이 실패를 인정하며 최신 수정 HEAD의 원격 3개 job PASS 전까지 #14 merge/closure와 #15 착수는 BLOCKED다.
- 실제 원인은 `runClient()`의 RPC 완료와 transcript callback 전달을 같은 완료 조건으로 취급한 것이다. `finally`의 unsubscribe 뒤 기다리는 `deliveryTail`에는 아직 transcript listener에 도착하지 않은 terminal event가 포함되지 않는다. 실제 Unix/server/worker는 유지한 채 응답보다 terminal 전달을 한 event-loop turn 늦추는 결정적 회귀를 만들었고, 수정 전 **1.81초 / missing run_end FAIL**을 얻었다. 이미 보고된 CI 실패를 무작정 재시도하지 않았다.
- 제품 변경은 `runtime/pi/packages/coding-agent/src/experimental/client.ts`에 한정한다. 관측한 run-end ID를 기억하고 accepted response의 정확한 operation ID에 해당하는 event가 전달 큐에 합류할 때까지 subscription을 유지한 다음 비동기 onEvent를 끝까지 drain한다. rejected prompt는 terminal을 기다리지 않으며 대기 중 attachment loss는 오류로 끝나고 callback error는 그대로 전파된다. Hydration replay는 하지 않는다.
- 기존 integration test를 late terminal/early terminal/attachment loss/async callback failure/rejected prompt의 서로 다른 lifecycle 경계로 강화했다. 실제 transport/worker에 faux model을 사용하고 consumer scheduling만 제어한다. 중간 격리 실행은 **31 tests PASS / 20.67초**였다. 일반 SDK API, experimental command 인자/반환 형식, provider/transport/protocol, Broker/Policy/Approval/Kernel 의미는 바꾸지 않았고 기존에 기대하던 terminal-delivery 보장만 바로잡았다.
- 초기 확장 fixture의 `test.each` callback에서 cleanup context를 잘못 받는 오류는 기존 context-bearing `test` 등록으로 수정했다. 첫 전체 gate는 build PASS 뒤 root TypeScript target의 `Promise.withResolvers` 미지원(TS2550)으로 중단됐다. 기존 Promise constructor 패턴으로 고쳤으며 lib/target 상향·timeout 증가·assertion 약화·skip 추가는 하지 않았다. 이 호환성 수정까지 포함한 격리 suite→build→전체 Runtime gate를 다시 실행 중이다.
- `coding-agent/CHANGELOG.md`의 Unreleased/Fixed와 `CAPABILITY_BROKER.md` append-only §14에 기록했다. 원래 source repository의 changelog/work log가 아니라 통합 제품의 현재 파일만 수정하며 역사적 provenance와 frozen §§1–11은 보존한다. 이전 “제품 코드 변경 0” 기록은 이전 HEAD에만 해당하며, 이번에는 명시적으로 위 한 제품 파일을 수정한다.
- **최종 재실행:** 빈 allowlisted 환경/격리 HOME·tmp·npm config에서 remote-runtime suite **31/31 PASS, Vitest 21.72초** → 전체 `npm run build` PASS → `node scripts/validate.mjs pi` **ALL GATES PASS**다. 세 명령 연쇄 전체 wall time은 **535.69초**이며 validator 단독 시간으로 오기하지 않는다. 정상 npm test와 별도 격리 bash test.sh 모두 coding-agent **279 files/2,754 tests PASS**, company-runtime **60 files/1,522 tests PASS**다. 기존 coding-agent 6 files/50 tests 등 환경 의존 skip은 유지했고 신규 skip은 없다.
- 최종 check/check:ci는 **1,477 files / No fixes applied**, TypeScript/browser smoke/shrinkwrap/install-lock/product independence 4 tests/launcher syntax/whitespace까지 통과했다. Build 뒤 변경 파일은 의도한 client.ts, 해당 regression, package changelog, root architecture/work log 총 5개뿐이다. App/lock/model catalog/다른 제품 source 변경은 없다.
- 위 결과는 새 수정 tree의 **local proof**다. 같은 PR #28에 정상 commit/push한 뒤 정확한 최종 HEAD와 원격 Runtime/App/cross-boundary 세 job 결과를 PR 본문/댓글로 별도 기록한다. 원격 실패를 blind rerun으로 덮지 않으며 모든 새 HEAD check가 통과하기 전에는 blocker가 해제됐다고 주장하지 않는다. PR/issue OPEN과 #15 미착수는 유지한다.

## 2026-09-23 KST — V0.7B COMPLEX #15 설계 계약

- **설계 전용 작업**이다. GitHub #15와 #23 roadmap, downstream #16/#17/#18 및 #14 closure를 읽었다. 시작 당시 원격 `devlop`은 지정 baseline `67dec9481f694a9724b33825adb65c4b095a6ee4`, open PR은 0이었다. #14는 PR #28로 CLOSED이며 baseline CI `35696596569`는 success였다. 이는 선행 작업의 역사적 결과이지 이번 문서 변경의 Runtime/App 구현 PASS가 아니다.
- 로컬 기존 `devlop` checkout은 이전 HEAD에 있었으므로 원격 baseline object를 fetch한 뒤 `Weavra-worktrees/v0.7b-complex-contract` / `design/v0.7b-complex-contract` 전용 worktree를 정확한 SHA에서 만들었다. 기존 checkout·다른 worktree·source repository·lockfile·license는 변경하지 않는다.
- consolidated Runtime의 contracts/classification/Host/Workflow/Kernel, ports/runner/tools/Policy/Approval, Task Contract/criterion evidence, state-store/workspace/cancel/cleanup, Budget/measurement/provenance/Evidence Pack, README·기존 roadmap/architecture·V0.7A Broker와 관련 hardening test body를 감사했다. App Host Control duplicated schema, RuntimeController, client-runtime state, WeavraControls의 preview/run/writer/cancel/approval/reconnect 경계를 함께 대조했다. 기존 tests는 현재 의도/경계의 source evidence로 읽었으며 이번 작업에서 실행 PASS를 주장하지 않는다.
- `docs/architecture/COMPLEX_SEQUENTIAL_WORKFLOW.md`를 작성했다. COMPLEX enum·분류와 Lead metadata는 이미 있으나 Host/Workflow/Kernel 실행은 차단되고 실제 worker port는 Developer/Executor/Reviewer뿐이라는 사실을 분리했다. STANDARD의 implement→self-check→review→test→complete, immutable parent, Runtime Policy/Risk/Approval/verifier/writer/Kernel authority를 기준으로 삼았다.
- 최소 설계는 **모델 Planner 없는 deterministic Host compiler**다. 기존 workflow.prepare의 제한된 complexDraft로 인간의 분해 제안을 받고 Runtime이 ID/parent-plan digest/AC coverage/의존성/정확한 파일 claim/등록 check/예산을 검증한다. Confirm 후 plan 변경·ownership 이전·task 재정렬은 없다. 최대 8개 task가 한 Run/writer 아래 순차 실행되며 각 task 독립 review/check와 최종 전체 workspace integration→독립 final review→fresh final checks→Kernel guard가 필수다.
- ownership≠filesystem permission≠Policy ALLOW를 명시했다. exact-file 배타 claim, mutation 직전 재검증, expected-image attribution, 같은 파일의 다중 task 변경 거부, stale evidence의 이력/현재 권한 분리, durable revision/work revision/task attempt 구분, 전역 Budget·unknown usage·bounded local revision, R2 독립 Reviewer와 R3 단일 exact deletion/one-use consent, cleanup 확인 전 CANCELLED 금지/불확실 시 writer 유지 및 partial changes 보존을 고정했다. 자동 Git 작업·rollback·resume·Parallel Agents는 구현 범위 밖이다.
- #16/#17에 동일한 closed wire DTO·bounds·digest/presence·state transition·handoff를 제공하고 #18 falseCompletion=0 negative corpus C01–C42와 Run/Task/Approval/freshness diagram을 포함했다. #15 리뷰·병합 후 #16 Runtime과 #17 App은 별도 worktree에서 동시 개발 가능하나 strict decoder 때문에 **landing/deployment는 #17 consumer → #16 producer**, 이후 #18 combined gate다. 이번 작업은 세 downstream issue를 시작하거나 stage CLOSED로 기록하지 않는다.
- 현재 단계는 문서 source-link/정합성 검증과 독립 read-only 계약 리뷰다. 실행 구현·App UI·provider smoke·Runtime/App 전체 gate는 설계 PR의 검증 범위가 아니다. 최종 문서 검증 및 정상 commit/push/OPEN PR 결과는 아래에 구분하여 기록한다.
- **현재 문서 검증:** source/test/doc 상대 링크 67개(고유 67개)가 모두 존재하며 기존 WORK_LOG 74,645 bytes가 그대로 prefix로 보존됐다. C01–C42가 중복·누락 없이 존재하고 Mermaid 4개를 검사했다. Task diagram 14 nodes/28 edges, Approval 6/7, freshness 12/14, Run 17/25에서 각 node가 명시된 terminal/error 경로에 도달한다. 이는 문서 graph 정합성 검사이며 Runtime state machine 실행 proof가 아니다.
- **설계 리뷰:** wire/App/rollout 독립 리뷰에서 blocking finding은 없었다. Runtime safety 리뷰가 지적한 “RunCreated/활성화 전 취소에 존재하지 않는 task attempt를 요구하는 모순”은 Run-level complexBinding과 task/integration complexContext를 분리해 수정했고 실제 events.ts의 lifecycle variant와 대조했다. 중단된 check/review는 위조 FAIL/BLOCK 대신 UNAVAILABLE로 표시하며 writer release 실패는 이미 저장된 안전한 terminal 결과와 구분하도록 명시했다.
- `git diff --check`와 `git diff --cached --check` PASS. Staged 파일은 이 architecture 문서와 root WORK_LOG 두 개뿐이며 unstaged/untracked 변경은 없었다. Production Runtime/App, lockfiles, build roots 변경 0이다. 문서 검증 이후 이 결과를 작업 기록에 덧붙였으므로 commit 직전 whitespace/scope gate를 다시 적용한다. 정상 commit/push 및 `devlop` 대상 OPEN PR로 리뷰 요청하고 자동 merge 또는 #16/#17/#18 착수 없이 종료한다.

## 2026-09-24 KST — 외부 리뷰 후속: 도구 오류 복구·advisory check·R3 분류·정리

- **배경:** 사용자가 Claude Code에 프로젝트 평가를 요청했고, 그 개선 제안 중 사용자가 고른 4개 항목을 구현했다. 기준은 `devlop` `677545f54f1f093b34af1263dd91e44a3a07e641`이며 전용 worktree `Weavra-worktrees/runtime-review-followups`의 `feat/runtime-review-followups` 브랜치에서 작업했다. 항목 3(R3 분류)은 별도 worktree의 하위 에이전트가 구현했고, diff를 검토한 뒤 이 브랜치에 적용했다. Kernel 완료 권한, Policy/Approval 의미, Host wire, lockfile, license, source repository는 변경하지 않았다.
- **항목 1 `a0602792` — 수정 가능한 worker 도구 오류 복구:**
  - 이전에는 tool error가 한 번만 나도 worker와 run이 실패했다.
  - 이제 다음 오류는 같은 세션에 Tool error로 돌려준다.
    - 허용 범위 안의 없는/비파일 대상. 새 Policy reason `Target is missing or not a regular file`.
    - ALLOW 뒤 실행 실패, 잘못된 인자, 크기 초과.
  - worker당 8회(`maxToolErrors` 0..32)를 넘으면 `Worker tool error limit exceeded`로 실패하고 Evidence는 TOOL로 분류된다.
  - 다음은 계속 즉시 실패한다.
    - 보호/범위 밖/unsafe Policy 거부
    - audit/storage 실패
    - intent 뒤 대상 변경 `PolicyRecheckError`
    - worker에 없는 도구 호출
    - R3 run의 모든 도구 오류
  - 첫 구현에서는 READ_ONLY·R0의 미제공 mutation 도구 호출까지 복구 대상이 되어 기존 context/quick 테스트 2건이 실패했다. "계약 밖 도구 호출은 실패"라는 기존 의도를 유지하도록 구현을 고쳤고, 테스트 기대는 바꾸지 않았다.
- **항목 2 `cbacee9f` — opt-in Developer advisory check:**
  - `verification.advisory: {mode: developer, max_runs}`(기본 5, 1..20)를 켜면 STANDARD/EDIT/non-R3 Developer의 `runtime_request_check`가 등록 process check를 `RegisteredVerifier.advise`로 실행한다. 결과는 PASSED/FAILED/UNAVAILABLE, exit code, 출력 끝부분(각 2,000자)이다.
  - 같은 frozen 등록·Policy·audit ledger·sandbox를 사용한다.
  - 결과는 tool text일 뿐이다. CheckResult, evidence, Run state, Reviewer 입력, 완료 근거가 아니며 SELF_CHECK/TEST는 새로 실행한다.
  - 설정을 생략하면 정규화 config와 digest가 바뀌지 않는다. App 계약은 run-level repair mode만 mirror하므로 App 변경은 없다.
- **항목 3 `44038f4f` — R3 분류 오판 완화:**
  - 삭제가 파일·디렉터리·브랜치·데이터·경로를 대상으로 할 때만 R3다. deploy/production/credential/history 키워드는 그대로 R3다.
  - 지원되지 않는 R3는 prepare 단계에서 AC 편집 전에 거부한다.
  - TUI에서 명시적으로 확인하면 규칙 기반 위험도로 진행하는 override를 추가했다. Runtime이 다시 검증하며, stale하거나 위조된 override는 거부한다.
  - 새 규칙이 의도한 대로 바뀐 기존 테스트 기대가 있다: `execution-contract`, suite `lsp`/`quick`/`status`. status는 prepare 단계 거부라 알림 수준이 `warning`에서 `error`로 바뀌었다.
- **항목 4 `125ec944` — 정리:**
  - worker 실패의 원래 오류를 `cause`로 보존했다. 저장되는 메시지는 기존 stage label 그대로다.
  - `validate.mjs pi`에서 test.sh와 중복되던 `npm test`를 제거했고, consolidation 문서의 gate 설명도 맞췄다.
  - `app/t3code/AGENTS.md`의 T3 제품 전제와 경로를 고쳤다. `~/.t3/userdata`는 `~/.weavra/app/userdata`로, worktree `.t3`는 `.weavra/app`으로 바꿨다.
  - dev runner가 쓰는 worktree `.weavra/`가 gitignore되지 않던 문제를 root `.gitignore`로 막았다.
- **현재 검증(이번 작업에서 실제 실행, 최종 tree = 위 4개 커밋):**
  - `npm run check` exit 0, 최종 1,479 files, no fixes.
  - `npm run build` PASS.
  - `node scripts/validate.mjs pi` **ALL GATES PASS / 284초.** 이 중 test.sh 격리 실행 결과:
    - coding-agent 279 files / 2,768 PASS / 50 skipped
    - company-runtime 62 files / 1,600 PASS
    - agent 711 PASS / 1 skipped
    - ai 1,069 PASS / 853 skipped
    - chord 162, client 27, evals 54, protocol 133, server 44, telemetry 15, sqlite backend 105 PASS
  - `node scripts/run-capability-boundary.mjs` PASS / 21초.
  - Playwright Chrome for Testing 1234 fresh profile로 `WEAVRA_CHROMIUM=… node scripts/run-cross-boundary.mjs` PASS / 10초, paid provider requests=0.
  - 각 커밋 단독 상태를 임시 detached worktree에서 `tsgo --noEmit`와 `biome check`로 확인했다. 4개 모두 PASS.
- **미실행 / 한계:**
  - `validate.mjs t3`는 실행하지 않았다. App 쪽 변경은 `app/t3code/AGENTS.md` 문서뿐이다.
  - 원격 CI는 PR 생성 뒤 별도로 확인한다.
  - 실제 Provider smoke는 유료라 실행하지 않았다.
  - advisory check와 도구 오류 복구가 실제 모델의 완료율에 미치는 효과는 측정하지 않았다.
  - App Host 경로에는 R3 override 확인이 없다(TUI 전용).
  - sandbox 기본값, state store, GUI 방향, 벤치마크, 프로토콜 협상은 범위 밖이다.
- **절차 기록:**
  - worktree 준비로 `npm install --ignore-scripts`, `npm run hydrate:model-data`(CI와 같은 네트워크 hydrate), App `pnpm install --frozen-lockfile --ignore-scripts`를 실행했다. lockfile 변경은 없다.
  - evals 패키지를 한 번 기본 vitest 설정으로 잘못 실행해 `src/*.eval.ts`가 수집됐다. CLI가 빌드되기 전이라 harness-error 39건에서 멈췄다. provider 호출 흔적은 보지 못했지만 없었다고 보장하지는 않는다. 이후 `vitest.test.config.ts`로 다시 실행해 9 files / 54 PASS를 확인했다.
  - 이전 평가 단계에서 company-runtime 패키지 vitest를 직접 실행한 적이 있다. 이 패키지에는 env로 켜지는 실제 provider e2e가 없음을 확인했다.
- **커밋 상태:** 위 4개 커밋과 이 작업 기록 커밋을 `devlop` 대상 PR로 올린다. 자동 merge는 하지 않는다.

## 2026-09-24 KST — 리뷰 후속 2차: 벤치마크·샌드박스 경고·상태 저장소·아키텍처 입구 문서

- **배경:**
  - PR #30은 원격 CI 3개 job(runtime/pi 8분 33초, app/t3code 20분 10초, cross-boundary 4분 9초)이 HEAD `4220bfd1`에서 모두 성공한 뒤 사용자 지시로 `dd828dd2`에 merge commit으로 머지했다.
  - 이어서 사용자가 남은 항목 네 가지를 골랐다. 기준은 `dd828dd2`이며, 전용 worktree `Weavra-worktrees/runtime-review-followups-2`의 `feat/runtime-review-followups-2` 브랜치에서 작업했다.
  - 벤치마크 하네스는 별도 worktree의 하위 에이전트가 구현했고, 검토·수정한 뒤 적용했다.
- **샌드박스 결정 변경:** 사용자는 처음에 "macOS 기본 required"를 골랐다. 구현 전 조사에서 다음을 확인했다.
  - sandbox 정책이 `$HOME`·`$TMPDIR` 읽기와 네트워크를 전부 막는다(`sandbox.ts` 정책).
  - 이 때문에 Maven·Gradle·Cargo·bun·npm 캐시나 다운로드가 필요한 check가 FAIL이 된다.
  - 이를 알리자 사용자가 "기본값 유지 + 경고·진단"으로 바꿨다.
- **항목 1 `d9ee3187` — Weavra vs Pi 벤치마크 하네스:**
  - `npm run benchmark`가 plain Pi, Weavra STANDARD, Weavra+advisory를 같은 fixture·모델·wall-clock 한도로 비교한다.
  - 기록 항목은 완료 주장, hidden oracle, 거짓 완료, 시간·턴·도구, provider가 보고한 token이다.
  - corpus는 F01–F10(F08 제외)과 B01–B06 새 fixture다. oracle은 Host 코드에만 있다.
  - 하위 에이전트가 Weavra arm에 C06 Fitness 설정의 `max_revision_cycles: 0`을 그대로 썼다. 이 값이면 REVISE 한 번에 바로 BLOCKED가 되어 비교가 불공정하다. 벤치마크에서만 제품 기본값 1을 쓰도록 고치고 record에 `weavraMaxRevisionCycles`를 남겼다. Fitness 기본값과 digest는 회귀 테스트로 고정했다.
  - `benchmark-faux`가 아닌 provider는 `--confirm-paid` 없이 거부한다. **유료 실행은 하지 않았다.**
- **항목 2 `f8b1e94c` — 샌드박스 비활성 경고:**
  - 비활성일 때 Plan Preview와 `/workflow config`가 위험과 켜는 방법을 표시한다.
  - `weavra doctor`는 안내 줄만 추가했다. `launcher-home.ts`가 import하면 worktree launcher 테스트의 standalone 복사본이 깨졌기 때문이다. 처음에 69건이 실패해서 import를 제거했다.
  - 예제 config와 README 예제는 `required`로 바꿨다.
- **항목 3 `42ba2b20` — 상태 저장소** (설계 `docs/architecture/STATE_STORE.md`):
  - **죽은 writer lock 복구:** lock에 hostname을 기록한다. 같은 호스트·같은 프로젝트이고 PID가 ESRCH일 때만 복구한다. O_EXCL recovery guard와 inode 재확인을 거친다.
  - **terminal run 보관:** 최근 20개만 inline으로 남기고, 나머지는 `.ai/runs/<id>.json`과 sha256 색인으로 옮긴다. 조회와 export는 digest를 검증하고, workspace 검사는 보관 파일을 Runtime 소유로 취급한다.
  - README S2의 "PID로 자동 탈취하지 않는다"는 의도적 설계였다. 사용자 선택에 따라 좁은 조건으로 바꿨고, hardening 테스트 기대 1건도 이에 맞게 바꿨다. 이제 죽은 fixture owner의 lease를 복구하되 성공은 추정하지 않는다.
- **항목 4 `2fc963e9` — 입구 문서:** `docs/architecture/OVERVIEW.md`를 추가하고 루트 README와 `AGENTS.md`에서 연결했다. 기존 문서는 삭제하지 않았다.
- **현재 검증** (이번 작업에서 실제 실행, 최종 tree = 위 4개 커밋):
  - `npm run check` exit 0 (1,489 files).
  - `npm run build` PASS.
  - `node scripts/validate.mjs pi`: **ALL GATES PASS / 296초.** company-runtime 62 files / 1,613 PASS, coding-agent 279 files / 2,768 PASS / 50 skipped, evals 11 files / 110 PASS, 그 밖의 패키지 PASS.
  - `run-cross-boundary.mjs`(Chrome for Testing fresh profile) PASS / 9초, paid provider requests=0.
  - `run-capability-boundary.mjs` PASS / 21초.
  - 커밋마다 단독 상태를 임시 detached worktree에서 `tsgo --noEmit`와 `biome check`로 확인했다. 4개 모두 PASS.
- **절차상 수정:** 검증 스크립트에 첫 worktree 경로가 하드코딩되어 있어서, 첫 staging 검증이 다른 worktree를 확인했다. 스크립트가 경로를 인자로 받도록 고친 뒤 올바른 worktree로 다시 확인했다. PR #30의 검증은 해당 worktree에서 실행한 것이라 영향이 없다.
- **미실행 / 한계:**
  - `validate.mjs t3`는 실행하지 않았다. 이번 App 쪽 변경은 없다.
  - 유료 벤치마크는 실행하지 않았다.
  - 보관은 writer open 시점에만 일어나서, 한 세션 안에서 run이 20개를 넘게 쌓이면 다음 open까지 inline으로 남는다.
  - 호스트명을 공유하는 다른 PID namespace에서는 살아 있는 owner를 죽은 것으로 볼 수 있다. 이 경우 owner는 `lock lost`로 실패한다.
- **커밋 상태:** 위 4개 커밋과 이 기록 커밋을 `devlop` 대상 PR로 올리고, 사용자 지시에 따라 원격 CI 3개가 모두 통과하면 merge commit으로 머지한다.

## 2026-09-24 KST — 첫 실제 모델 벤치마크와 단계별 신호 기록

- **배경:**
  - 사용자 요청으로 PR #31의 Weavra-vs-Pi 하네스를 실제 모델로 처음 실행했다.
  - 결과만으로는 어느 단계가 결과를 좌우했는지 알 수 없어서, 벤치마크에 단계별 신호를 추가했다(`ddd6b733`, PR #32).
  - 모든 실행은 사용자가 명시적으로 허락한 `--confirm-paid`로 했다. 결과 JSON·Markdown은 gitignore된 `runtime/pi/packages/evals/.eval/benchmark/`에만 있고 커밋하지 않았다.
- **1차: `codex-lb/gpt-6-astra`** (머지된 `1cff35db`, clean, harness weavra-benchmark-1)
  - smoke(F02·B01 × 3 arm = 6회, `feb2a21a`): 6/6 PASS.
  - 파일럿(15 fixture × 3 arm × 1회 = 45회, `4a058179`) 결과:

    | arm | oracle PASS | 거짓 완료 | 평균 시간 | 평균 턴 | token 합 |
    |---|---|---|---|---|---|
    | pi | 14/15 | 0 | 14.8초 | 3.3 | 약 7.1만 |
    | weavra | 15/15 | 0 | 47.4초 | 6.0 | 32.6만 |
    | weavra-advisory | 15/15 | 0 | 42.3초 | 5.8 | 31.6만 |

  - pi의 1건 실패(B01 `ERROR`, 12초, usage 미보고)는 같은 조건 단독 재실행(`3598e4fa`)에서 16초 PASS였다. 모델 실패가 아니라 일시적 provider 오류로 판단한다.
- **2차: `commandcode/deepseek/deepseek-v4.1-flash`** (`ddd6b733`, clean, harness weavra-benchmark-2)
  - **인증 수정:** 첫 smoke(`f6192fa5`)는 0.1초 만에 전부 끝났다. 원인은 `~/.weavra/agent/models.json`의 commandcode 키(14자)가 401로 거부된 것이다.
    - CommandCode CLI 로그인 키(`~/.commandcode/auth.json`)는 최소 요청으로 200을 확인했다.
    - 사용자 승인 후 원본을 권한을 유지한 채 `models.json.bak-2026-09-24`로 백업하고, commandcode `apiKey`만 `!jq -r .apiKey ~/.commandcode/auth.json`로 바꿨다. 키 값은 복사하거나 출력하지 않았다.
  - smoke 재실행(`d0491de4`): weavra-advisory F02 1건만 `POLICY`로 FAILED였다. 작업 결과는 oracle PASS였으니, 올바른 작업을 Weavra가 거부한 경우다.
  - 파일럿(45회, `92d23ef0`) 결과:

    | arm | oracle PASS | 거짓 완료 | 중앙 시간 | token |
    |---|---|---|---|---|
    | pi | 15/15 | 0 | 7.8초 | 16.1만 |
    | weavra | 14/15 | 0 | 21.7초 | 58.1만 이상 (1건 미보고) |
    | weavra-advisory | 15/15 | 0 | 21.1초 | 60.6만 |

  - **단계별 신호:**
    - Reviewer REVISE 0회, verification repair 0회.
    - weavra는 check 요청 11회(모두 request-only), weavra-advisory는 13회 요청 중 13회 advisory 실제 실행.
    - 수정 가능한 도구 오류 복구가 3개 run(weavra F02·B06, weavra-advisory B02)을 완료로 이끌었다. PR #30 이전의 즉시 실패 규칙이었다면 이 3건은 실패였다.
    - weavra B02는 첫 도구 호출이 복구 불가 Policy 오류여서 2초 만에 `POLICY`로 FAILED였다. 같은 과제를 pi와 advisory는 통과했다.
- **해석:**
  - 두 모델 모두 이 코퍼스를 대부분 혼자 풀어서 천장 효과가 난다.
  - Weavra의 review·검증이 거짓 완료를 막은 사례가 한 건도 관측되지 않았다.
  - Weavra 비용은 pi 대비 시간 약 2.7~3.2배, token 약 3.6~4.6배다.
  - 관측된 Weavra 고유 효과는 두 가지다: 도구 오류 복구가 run 3건을 구했고(이득), 치명적 Policy 거부가 run 2건을 떨어뜨렸다(손실).
  - 과제마다 1회 실행한 표본이라 편차와 통계적 유의성은 판단하지 않는다.
- **현재 검증:**
  - PR #32 로컬 검증: `npm run check` exit 0, evals 11 files / 110 PASS, coding-agent company-runtime fitness·agent·workflow 170 PASS, HEAD+staged tsgo·biome PASS.
  - 전체 `validate.mjs pi`는 동시에 돌던 벤치마크 시간 측정을 왜곡하지 않도록 로컬에서 실행하지 않았고, 원격 CI가 수행한다.
- **다음 단계:**
  - `POLICY` 실패의 정확한 거부 사유를 기록에 남겨 원인을 확정한다. Runtime이 생성한 문구만 남기고 모델 텍스트는 남기지 않는다.
  - 허용 범위 밖 읽기 거부를 "거부는 유지하되 치명적이지 않게" 바꿀지 판단한다.
  - 약한 기존 테스트, 누락되기 쉬운 요구사항, 다중 파일 변경처럼 변별력 있는 fixture를 추가한다.
- **커밋 상태:** PR #32에 이 작업 기록을 추가한다. merge는 사용자 확인 후 한다.

## 2026-09-24 KST — 허용 범위 밖 읽기 거부를 수정 가능한 오류로 전환

- 목적: 벤치마크(`92d23ef0`) weavra B02가 2초 만에 `POLICY`로 FAILED된 원인을 확정하고 제거한다.
- 원인 확정:
  - B02의 `allowedPaths`는 `["test"]`이고, 과제는 `src/slug.mjs`를 바꾸지 말고 테스트만 추가하는 것이다.
  - 기록은 모델 턴 2회, 도구 호출 2회, 복구 불가 도구 오류 1회였다. 첫 호출이 테스트 대상 `src/slug.mjs` 읽기였고, `Target outside allowed paths` 거부가 치명 오류로 처리됐다.
  - 테스트 대상 모듈을 읽는 것은 정상적인 탐색이다. 읽기 거부 자체는 유지하되 run을 끝낼 이유는 없다.
- 변경 파일:
  - `runtime/pi/packages/company-runtime/src/policy.ts`: 거부 사유 문자열 두 개를 상수로 export(`OUTSIDE_ALLOWED_PATHS_REASON`, `OUTSIDE_LISTING_BOUNDARY_REASON`). 판정 로직은 그대로다.
  - `runtime/pi/packages/company-runtime/src/agent-tools.ts`: Policy에 등록된 read/search/list 도구가 허용 범위 밖으로 거부되면 "아무것도 읽지 않았고, 읽기는 허용 경로로 제한된다"는 문구와 함께 모델에 돌려준다. 기존 수정 가능 오류 예산(기본 8회)을 그대로 쓴다.
  - `runtime/pi/packages/company-runtime/src/agent-runner.ts`: Developer/Reviewer 프롬프트의 수정 가능 오류 설명을 새 규칙에 맞췄다.
  - `runtime/pi/packages/coding-agent/test/suite/company-runtime-agent.test.ts`: 범위 밖 read/search가 같은 세션에서 복구되는 테스트 추가, 기존 "범위 밖 읽기 치명" 케이스를 "범위 밖 쓰기 치명"으로 교체.
- 유지한 경계: 허용 범위 밖 쓰기·수정, 보호 경로(읽기 포함), 등록되지 않은 도구, 감사 기록 실패, R3 run의 모든 도구 오류는 계속 즉시 실패다. 거부된 읽기는 내용을 반환하지 않고 감사 기록에 `DENIED`로 남는다.
- 현재 검증 (Node 24.19.0):
  - `npm run check` 통과.
  - coding-agent `company-runtime-agent` 99 PASS, `company-runtime-hardening`·`company-runtime-workflow` 99 PASS.
  - company-runtime `policy`·`list-files`·`hardening` 122 PASS, `advisory-checks`·`anchored-tools`·`strict-mutation`·`context-leakage`·`quick` 157 PASS.
  - 전체 `validate.mjs pi`는 원격 CI가 수행한다.
- 남은 일: 거부 사유 범주를 벤치마크 기록에 남기는 계측, 변별력 있는 fixture 추가, 이 변경 후 B02 재측정.
- 커밋 상태: `fix/recoverable-scope-reads` 브랜치, devlop 대상 PR.

## 2026-09-24 KST — V0.7B #17 App COMPLEX 소비자

- 목적: #15 계약의 App 쪽을 구현한다. 설계의 소비자 우선 규칙에 따라 Runtime(#16)보다 먼저 머지한다. 새 필드를 보내지 않는 현재 Runtime에서는 기존 QUICK/STANDARD 화면이 그대로 동작해야 한다.
- 브랜치/worktree: `feat/v0.7b-complex-app`, `Weavra-worktrees/v0.7b-complex-app`. 구현은 하위 에이전트가 했고, 병합 전 계약 일치 여부는 메인 세션이 검토했다.
- 변경 파일(모두 `app/t3code/` 아래):
  - `packages/contracts/src/weavraControl.ts`: §4/§7/§9/§10 DTO와 한도를 복제했다. capability `complexContractVersion`, prepare의 `complexDraft`, COMPLEX preview와 `complexPlan`, state의 `complexExecution`을 추가했다. recipe와 draft는 함께 보낼 수 없다.
  - `apps/server/src/weavra/ComplexProjection.ts`(신규): parent/plan digest를 다시 계산하고, preview에서 parent를 재구성하며, snapshot 한 개 안의 규칙과 snapshot 사이의 규칙을 검사한다. `RuntimeController.ts`는 publish 전에 이 규칙을 적용한다. capability가 없는 Runtime에는 draft를 보내지 않는다.
  - `packages/client-runtime/src/state/weavraControl.ts`: 구독의 첫 방출은 stale로 둔다. 같은 state revision에서 COMPLEX 데이터가 바뀌면 거부한다.
  - `apps/web/src/components/settings/WeavraComplex.tsx`(신규)와 `WeavraControls.tsx`: capability가 있을 때만 확정 전 계획 편집기, 전체 preview, 읽기 전용 실행 상태를 보여 준다. 작업 완료·재시도·건너뛰기 버튼은 없다.
  - `docs/operations/development.md`: COMPLEX 흐름 설명.
  - `apps/server/src/weavra/testFixtures/complexContractV1.json`: 두 빌드 루트가 각자 복사해 쓰는 기준 fixture. parent `sha256:fd1d5105…`, plan `sha256:742e9871…`.
- 계약 검토 결과(메인 세션):
  - 소비자가 추가로 도출한 규칙이 모두 설계 문서와 맞음을 확인했다. 예: PENDING 행 token 0, attempt = revisionCycle + 1, 전역 호출 수 = 작업별 합 + 최종 Reviewer 최대 1회, revision 합계 일치, 종료 시 cleanup CONFIRMED.
  - Runtime(#16)이 지켜야 할 목록으로 옮겨 적었다.
- 기존 흐름에 미치는 변화:
  - 새 구독의 첫 관측은 서버와 클라이언트 모두 stale이다. 기존 client 테스트 12개를 "캐시 값 → 확인된 값" 순서로 고쳤다.
  - prepare 응답은 요청의 owner/project revision과 같아야 한다.
  - 확인 모달이 닫힌 뒤 preview를 한 번 더 검사한다.
- 현재 검증:
  - 하위 에이전트가 worktree에서 `node scripts/validate.mjs t3`를 실행해 `ALL GATES PASS`를 받았다(Node 24.19.0, pnpm 11.10.0).
  - 집중 테스트: contracts 31, server 70, client 39, web 32 PASS.
  - devlop(PR #33) 병합 뒤 실제 Runtime과의 경계(cross-boundary)와 전체 게이트는 PR CI가 다시 확인한다.
- 남은 한계:
  - 실제 화면 확인과 실제 Runtime→App COMPLEX 수명 주기 검증은 #16 이후 #18에서 한다.
  - 현재 Runtime은 capability를 광고하지 않으므로 이 PR만으로는 COMPLEX가 화면에 노출되지 않는다.
- 커밋 상태: 기능 커밋 4개와 devlop 병합 커밋, 이 기록. devlop 대상 PR.

## 2026-09-25 KST — App git diff 통계 테스트의 racy-git flaky 수정

- 증상: PR #34 CI의 app/t3code job이 `apps/server/src/vcs/GitVcsDriverCore.test.ts` "keeps complete stats for files beyond the combined patch limit" 한 건으로 실패했고, 같은 job 재실행은 통과했다. 직전 PR #33 CI에서도 통과한 테스트다.
- 원인: 테스트가 `a-large.txt`를 커밋한 직후 같은 크기로 다시 쓴다("changed"→"updated", 7자→7자). 파일 시각이 index 기록과 같은 해상도 구간에 들어가면 git이 크기·시각이 같은 파일을 변경 없음으로 보고 working-tree 목록에서 뺀다(racy-git).
- 수정: 치환 문자열을 "edited"(6자)로 바꿔 크기가 달라지게 했다. 모든 줄이 여전히 바뀌므로 기대값 4000/4000은 그대로다. 제품 코드는 바꾸지 않았다.
- 현재 검증: 해당 파일 97 tests PASS, `vp fmt --check` 통과. 같은 파일의 lint 경고 1건(1529행 inline schema compile)은 이번 변경 전부터 있던 것이다.
- 커밋 상태: `fix/racy-git-diff-stats-test` 브랜치, devlop 대상 PR.

## 2026-09-25 KST — V0.7B #16 Runtime COMPLEX 순차 실행 (A 기반 · B 엔진 · C 상태 출력)

- 목적: #15 계약의 Runtime 생산자 쪽을 구현한다. 한 개의 동결된 부모 Task Contract를 2–8개 작업으로 나눈 계획을 한 Run 안에서 순서대로 실행한다. 그 뒤 통합 검사, 독립 최종 리뷰, 최종 검사를 거쳐 Kernel만 완료를 판정한다. 소비자(#17)는 이미 devlop에 머지돼 있어 설계의 소비자 우선 순서를 지킨다.
- 브랜치/worktree: `feat/v0.7b-complex-runtime`, `Weavra-worktrees/v0.7b-complex-runtime`. 단계별 하위 에이전트가 구현했고, 메인 세션이 단계 사이의 결정 사항(`RUNTIME_PLAN`)을 고정했다. 단계마다 결과를 검토했고, 병합 전 실제 경계 검증을 직접 실행했다.
- 커밋:
  - A: `f5750043` 계획 컴파일러·preview.
  - B: `469cbcff` 엔진, `a3ae15b6` 소유권·상태 저장·복구, `b07e64a3` SDK 종단 간 테스트.
  - C: `6792bdc2` Host Control 투영·capability, `9c946ec3` TUI·graph·Evidence Pack, `afaeded0` 실제 snapshot 소비자 규칙 검사.
  - devlop 병합 커밋 3개(PR #33·#34·#35 포함).
- 주요 변경(`runtime/pi/packages/company-runtime/src`):
  - 계획: `complex-types.ts`(닫힌 스키마·한도), `complex-plan.ts`(결정적 컴파일러; 모델·Planner 없음), `complex-binding.ts`(digest·경로 규칙·결합 가드). prepare는 draft가 있을 때만 COMPLEX를 받고, 부모의 모든 AC를 reviewRequired로 동결한다.
  - 엔진: `kernel.ts`의 COMPLEX 상태 기계(다음 배열 항목만 스케줄링, 작업별 self-check→review→test, 통합 check→최종 review→최종 test→완료)와 독립 완료 가드 `assertCanCompleteComplex`. 실패·취소 시에는 STOPPING을 먼저 쓰고 자원 정리를 확인한 뒤에만 종료 상태를 쓰며, 확인하지 못하면 INTERRUPTED로 끝나고 writer를 유지한다.
  - 소유권: `complex-ownership.ts` ledger. 정확한 파일 claim, 한 번에 하나의 lease, 기대 이미지, 외부 변경 감지를 맡는다. `agent-tools.ts`는 Policy 전(early)과 효과 직전(late)에 소유권을 검사하고, 효과 뒤 이미지를 기록한다. 부분 I/O는 unknown으로 남긴다.
  - 검증기: 작업 문맥에서는 동결된 작업 검사만, 통합 문맥에서는 전체 등록 검사를 실행한다. evidence ref는 문맥별 namespace로 구분돼 같은 check id가 다른 작업의 증거로 재사용되지 않는다.
  - 상태: `Run.complex`, `Run.complexEvidence`, `Run.complexReviews`. StateStore는 계획·부모 불변, 카운터 비감소, 종료 행 불변을 검사한다. 복구 시에는 완료된 작업 행을 보존하고 나머지를 INTERRUPTED(OWNER_LOST)로 둔다.
  - 출력: `complexExecution`을 control snapshot에 투영하고 capability `complexContractVersion: 1`을 광고한다. Evidence Pack에는 제한된 `complex` 요약을 넣는다. TUI `/workflow status`·기록에는 작업 행과 통합 단계를 보여 준다. 일반 관찰 스트림에는 새 이벤트 타입이나 작업 필드를 추가하지 않는다.
  - README에 COMPLEX 절을 추가하고, "COMPLEX 미지원" 문장 네 곳을 고쳤다.
- 메인 세션 검토:
  - 완료 가드는 설계 §8.2 조건을 모두 검사한다. 모든 작업 행의 PASS×3과 exit digest 결합, 작업별 증거 기록과 독립 세션, 통합 검사·최종 리뷰·최종 검사·live capture·ledger digest의 일치, 모든 AC MET, 승인 해소, 알려진 예산과 호출 수(Σ작업+최종 Reviewer 1), 자원 정리 확인이다.
  - 소유권 게이트의 호출 순서가 §5.2와 같음을 확인했다.
- 현재 검증:
  - 하위 에이전트가 커밋 상태에서 실행한 결과: `npm run check` exit 0. `./test.sh` exit 0으로 company-runtime 68 files / 1,917 PASS, coding-agent 280 files / 2,774 PASS(기존 skip 50). COMPLEX 전용은 kernel 57 시나리오, ownership 15, state-store 19, projection·surfaces·conformance, SDK 5다. 모든 테스트 snapshot이 App 소비자 규칙 재진술(`complex-conformance.ts`)을 통과해야 하며, 규칙마다 음성 사례가 있다.
  - 메인 세션 실행: 이 브랜치의 실제 Runtime 실행 파일(stdio Host Control)과 devlop의 #17 App `ControlTransport`·`complexStateConsistent`를 대본 루프백 모델(유료 호출 0)로 연결했다. 6개 시나리오가 모든 snapshot에서 App 엄격 디코더와 소비자 검사를 통과했다.
    - 정상 2작업: COMPLETED, 통합 PASS×3, 호출 5회.
    - C03 소유권 충돌: 효과 전 BLOCKED, 바이트 불변.
    - C01/C21 작업 검사 실패: 다음 작업 미실행, 부분 변경 보존.
    - C08 통합 검사 실패.
    - C14/C32 다음 작업 중 취소: CANCELLED, 앞 작업 이력 보존, writer 해제.
    - C12 예산 소진.
  - 이 하네스는 #18에서 저장소 스크립트와 CI로 옮긴다. 실행 중 발견한 fixture 오류 두 가지(Node 24 `--test`에 디렉터리 인자, 등록 검사의 `node -e` 차단)는 Runtime 결함이 아니었다.
- 남은 한계:
  - 실제 모델 COMPLEX smoke는 아직 NOT VERIFIED다.
  - 실제 브라우저 capture 재사용 거부(C37)는 가드 수준 테스트만 있다.
  - 결정적 컴파일러라 사람이 구조화된 계획을 직접 써야 한다.
  - 목표 문장의 첫 동사가 EDIT 동사 목록(fix/implement/add…)에 없으면 기존 규칙대로 INVALID_GOAL이다.
  - 기준 fixture의 `src/config.ts`는 기본 Policy 보호 이름이라 digest 증명용으로만 쓴다.
- 커밋 상태: devlop 대상 PR. #16 이슈는 #18 통합 검증 후 닫는다.

## 2026-09-25 KST — 보호 경로 읽기 거부를 수정 가능한 오류로 전환 (실제 모델 COMPLEX smoke 결과)

- 발견: #18 준비 중 실제 모델(commandcode `deepseek/deepseek-v4.1-flash`)로 2작업 COMPLEX Run을 1회 실행했다.
  - 두 작업은 모두 COMPLETED였고 통합 검사도 PASS였다.
  - 최종 통합 Reviewer가 `test/parse.test.mjs`를 읽으려 했다. 이 파일은 등록 검사가 실행하는 검증기 소스라 보호 경로다.
  - 그 거부(`Policy R0/DENY: Protected target`)가 치명 오류로 처리돼 Run이 `BLOCKED/POLICY_DENIED`로 끝났다. 완료 가드가 옳게 막은 것이지만, 무해한 읽기 시도 하나로 전체 작업이 버려졌다.
- 판단: PR #33은 범위 밖 읽기만 수정 가능한 오류로 바꾸고 보호 경로 읽기는 치명으로 남겼다. 실제 모델이 테스트 파일을 읽는 것은 정상적인 검토 행동이다. 읽기 거부는 내용을 반환하지 않으므로, 계속 진행시켜도 보호 경계는 약해지지 않는다.
- 변경:
  - `policy.ts`: `PROTECTED_TARGET_REASON` 상수 export. 판정 로직은 그대로다.
  - `agent-tools.ts`: read/search/list 도구의 보호 경로 거부를 수정 가능한 오류로 돌려준다. 메시지는 "아무것도 읽지 않았고, Runtime 상태·자격 증명·프로젝트 지시문·등록 검증기 소스는 보호되며, 기록된 검사 증거로 판단하라"이다.
  - `agent-runner.ts`: 프롬프트의 오류 규칙 문구를 새 규칙에 맞췄다.
  - `coding-agent` 테스트: 보호 경로 읽기 복구(내용 미노출, DENIED 감사 기록)를 추가했다. 치명 사례는 "보호 경로 쓰기"로 교체했다.
  - `evals` 벤치마크 테스트(`benchmark-faux-e2e`): 보호된 검증기 입력 읽기가 worker를 끝낸다는 옛 전제를 바꿨다. 이제 거부 메시지가 "Protected target / Nothing was read"이고 검사 바이트가 없음을 단언한다. PR CI 첫 실행에서 이 테스트만 실패했다(목록 조회가 9번 쌓임).
- 유지한 경계:
  - 보호 경로와 허용 범위 밖의 쓰기·수정·삭제는 즉시 실패다.
  - 등록되지 않은 도구, 감사 기록 실패, R3 run의 모든 도구 오류도 즉시 실패다.
  - 수정 가능한 오류는 기존 예산(기본 8회) 안에서만 허용된다.
- 현재 검증 (Node 24.19.0):
  - `npm run check` 통과(포매터가 변경 파일 1개 정리).
  - coding-agent `company-runtime-agent`·`hardening`·`workflow`·`complex` 204 PASS.
  - company-runtime `policy`·`anchored-tools`·`hardening`·`context-leakage`·`measurement-evidence`·`complex-kernel`·`complex-ownership`·`list-files` 255 PASS.
  - evals 전체(`vitest.test.config.ts`) 11 files / 110 PASS.
  - 같은 실제 모델 smoke 재실행: **COMPLETED**, 73초, 작업 2개 PASS×3, 통합 PASS×3, worker 호출 5회, 보고 토큰 117,820. App 소비자 검사를 snapshot 140개 모두 통과했다. 감사 기록에서 Reviewer의 보호 경로 읽기 2회가 `DENIED`였고 이어서 리뷰가 완료됐다.
  - 첫 실행(수정 전)은 BLOCKED, 52초, 보고 토큰은 최종 Reviewer 실패로 UNKNOWN이었다.
- 비용: 실제 provider 호출 2회분(각 worker 5회 이하). 첫 실행 보고 토큰은 작업 합계 76,753과 알 수 없는 최종 Reviewer분, 두 번째는 117,820이다.
- 커밋 상태: `fix/recoverable-protected-reads` 브랜치, devlop 대상 PR.

## 2026-09-25 KST — V0.7B #18 COMPLEX 통합 검증 (Runtime→App 실제 경계)

- 목적: #16(Runtime)과 #17(App)을 합친 실제 경계에서 COMPLEX 수명 주기를 검증한다. 거짓 완료 0건을 확인하고, 실제 모델 smoke를 한 번 돌리고, 병렬 단계 진입 조건을 기록한다.
- 브랜치/worktree: `test/v0.7b-complex-integration`, `Weavra-worktrees/v0.7b-complex-integration`. 선행 PR #34(#17)·#36(#16)·#37(보호 경로 읽기) 머지 후 devlop 기준이다.
- 추가 파일:
  - `scripts/complex-integration.mjs`: 실제 Runtime 실행 파일(stdio Host Control)을 운영 App `ControlTransport`로 조작한다. 모든 snapshot은 App 엄격 디코더와 `ComplexProjection` 검사를 통과해야 한다. worker는 대본 루프백 모델과 대화한다.
  - `scripts/scripted-model-server.mjs`: OpenAI 호환 스트리밍 응답기. usage를 항상 보고해 예산이 알려진 상태로 유지된다.
  - `scripts/run-complex-integration.mjs`: 격리된 HOME/TMPDIR/git 설정으로 실행한다.
  - `scripts/complex-live-smoke.mjs`: 선택 실행 유료 smoke. `--confirm-paid`가 필수이고 사용자 자신의 모델 설정을 쓴다.
  - CI cross-boundary job에 corpus 단계를 추가했다.
  - `docs/architecture/OVERVIEW.md`: COMPLEX 실행 흐름, 작업 파일 소유권 결정 주체, 검증 명령을 반영했다.
- 시나리오(14개, 대본 모델, 유료 호출 0). 매 snapshot이 App 소비자 검사를 통과했다.
  - 양성 대조군(COMPLETED만 허용):
    - P1 2작업 순차 실행: 통합 PASS×3, worker 호출 5회, 앞 작업이 COMPLETED되기 전에는 뒤 작업이 활성화되지 않음.
    - P2 REVISE 1회: CT-001 attempt 2 / revision 1, 전역 revision 1, 호출 7회.
    - P3 READ_ONLY 분해: 변경 파일 0.
    - P4/C16 R3 삭제: WAITING_APPROVAL(뒤 작업 PENDING) → 사람 승인 → 삭제 → COMPLETED.
  - 음성(COMPLETED 금지):
    - C17 R3 거절: BLOCKED/APPROVAL_DENIED, 파일 유지.
    - C03 다른 작업 claim 파일 쓰기: 효과 전 OWNERSHIP_CONFLICT, 바이트 불변.
    - C04 claim 없는 파일 쓰기: UNOWNED_PATH, 바이트 불변.
    - C01/C21 작업 검사 실패: CHECK_FAILED, Reviewer 미호출, 부분 변경 보존.
    - C07 Reviewer 미제출: FAILED/WORKER_FAILED, review gate UNAVAILABLE(판정 조작 없음).
    - C08 통합 선택 검사 실패: 두 작업 COMPLETED 후 통합 check FAIL/CHECK_FAILED, 최종 리뷰 미실행.
    - C12 예산(호출 3회) 소진: EXHAUSTED.
    - C14/C32 뒤 작업 Developer 실행 중 취소: CANCELLED, 앞 작업 COMPLETED 보존, cleanup CONFIRMED, writer 해제.
    - C20 완료된 작업 파일의 외부 변경: EXTERNAL_MUTATION.
    - C19 두 번째 App 연결: 실행 중 소유하지 않은 일관된 투영을 관측했다. 소유 연결 종료 시 Host가 취소해 CANCELLED가 됐고, 재개·재실행은 없었다.
  - 결과: 양성 4건만 COMPLETED. **falseCompletion = 0**.
- 실제 모델 smoke(commandcode `deepseek/deepseek-v4.1-flash`, 2작업, 사용자 설정 사용):
  - 1차(#37 이전): 두 작업과 통합 검사 PASS 뒤, 최종 Reviewer의 보호 테스트 파일 읽기가 치명 처리돼 BLOCKED/POLICY_DENIED로 끝났다. 거짓 완료는 아니다. 이 결과로 #37을 수정했다.
  - 2차(#37 적용): **COMPLETED**, 73초, 작업별 PASS×3, 통합 PASS×3, 호출 5회, 보고 토큰 117,820(상한 20만 이내). snapshot 140개 모두 App 소비자 검사를 통과했다.
- 현재 검증(로컬, 메인 세션):
  - corpus를 3회 연속 실행해 모두 `COMPLEX INTEGRATION PASS: 14 scenarios; falseCompletion=0`였다(약 35초/회).
  - 새 worktree에서는 `product-independence`·`consolidation-paths`가 Runtime 빌드와 model data 부재로 실패했다. 스크립트와 무관한 환경 요인이며, 의존성이 있는 worktree에서는 통과한다. 전체 게이트는 PR CI가 확인한다.
- 설계 C-행 대응:
  - 이 corpus가 다루는 행: C01, C03, C04, C07, C08, C12, C14, C16, C17, C19, C20, C21, C32.
  - #16 Runtime 테스트가 다루는 행: C02, C05, C06, C09, C11, C13, C15, C18, C24, C27–C31, C33–C37, C39–C42(kernel 57 시나리오와 store·ownership·SDK 테스트).
  - #16 prepare 테스트가 다루는 행: C10, C23, C25, C26.
  - #17 App 테스트가 다루는 행: C22, C27, C38(구 App의 엄격 디코더 거부는 설계상 비호환 조합이라 실제 구 App 실행은 하지 않음).
- 남은 한계(병렬 단계로 넘김):
  - C37 실제 브라우저 capture 재사용 거부는 가드 수준 테스트만 있다.
  - Planner가 없어 사람이 구조화된 계획을 직접 쓴다.
  - 목표 첫 동사가 EDIT 목록 밖이면 INVALID_GOAL이다(예: "Build …").
  - 검증기 소스는 읽기도 계속 금지다(거부는 복구 가능해졌을 뿐이다).
- **병렬 단계(V0.8A #19) 진입 조건:**
  1. devlop CI에서 COMPLEX corpus(14개)가 계속 통과한다.
  2. 실제 모델 COMPLEX smoke 1회 이상 COMPLETED(충족), 거짓 완료 0(충족).
  3. #19 설계가 그대로 유지해야 하는 불변:
     - 정확한 파일 claim과 효과 전후 이중 게이트(Policy ALLOW와 별개).
     - 작업별 evidence context namespace.
     - Kernel 단독 완료 권한과 독립 완료 가드.
     - STOPPING → cleanup 확인 → 종료 순서와 미확인 시 INTERRUPTED + writer 유지.
     - App은 투영 표시만 하고 전이를 만들지 않는다.
     - 전역 예산 한 장부와 Σ작업 + 최종 Reviewer 규칙.
  4. #19 착수 전에 최신 devlop, open PR, CI를 확인한다. 병렬 설계는 위 불변을 약화하지 않는 확장으로만 제안한다.
- 커밋 상태: devlop 대상 PR. 머지하고 CI가 통과하면 #16·#17·#18을 닫는다.

## 2026-09-25 KST — V0.8A #19 병렬 에이전트 설계 계약

- 목적: 검증된 V0.7B COMPLEX 경계 위에서 병렬 실행을 설계한다(#19). 설계만 하며 Runtime/App 동작은 바꾸지 않는다.
- 착수 전 확인: devlop `4e4c6410`(#38 머지), #16–#18 CLOSED, open PR 0, COMPLEX corpus 14개가 CI에서 통과. 브랜치/worktree는 `design/v0.8a-parallel-contract`.
- 결정(`docs/architecture/PARALLEL_AGENTS.md`):
  - **웨이브 모델:** 의존성이 모두 COMPLETED인 작업을 계획 순서로 최대 `maxParallel`(1–4)개 묶어 **구현(Developer) 단계만** 동시에 실행한다. 모든 구현이 끝나면(join) 작업 공간이 멈춘 상태에서 계획 순서대로 하나씩 self-check·review·test를 진행한다.
  - 이유: 검사·리뷰는 작업 공간 전체 digest에 증거를 묶는다. 검사 중 다른 작업이 파일을 바꾸면 증거가 실제 상태를 설명하지 못한다. 작업별 체크아웃은 복사·병합, 즉 자동 통합이 필요해 #19 금지 사항에 걸린다. 시간이 가장 많이 드는 구현만 병렬화한다.
  - 소유권은 이미 계획 전체에서 배타적이라 같은 파일 동시 수정은 구조적으로 불가능하다. ledger는 작업마다 lease를 하나씩 갖는다.
  - 예산은 웨이브 시작 전에 전원분을 전부 예약하거나 하나도 예약하지 않는다. 형제 작업이 실패하면 wave-scoped abort → join → STOPPING → 종료 순서로 끝나며, 각 행이 자기 실패 코드를 유지한다.
  - 저장은 한 큐로 직렬화해 이벤트 순서가 전체 순서가 된다.
  - 새 상태 `HANDED_OFF`, 투영 `activeTaskIds`, plan v2(`limits.maxParallel`, digest domain v2), capability 2를 둔다. App은 1·2를 모두 받고, #21 소비자 → #20 생산자 순서로 머지한다.
  - `maxParallel = 1`은 V0.7B와 같은 스케줄·결과다. R3는 1로 고정한다.
- #22 경쟁 corpus 설계: P01–P17(동시 구현 관측, 인계 순서와 무관한 검증 순서, 의존성 웨이브, 소유권 충돌 중 형제 중단, 형제 실패, 동시 취소, REVISE, 예산 전원 예약 실패, 사용량 미상, 외부 변경, 통합 실패, 재연결, 소유자 강제 종료 복구, 이벤트 순서, V0.7B corpus 동등성, R3 고정). 실제 모델 병렬 smoke 또는 NOT VERIFIED 표기.
- 현재 검증: `git diff --check`. 이 문서와 작업 기록만 바뀌었다. 구현·테스트·속도 향상 주장은 없다.
- 커밋 상태: devlop 대상 설계 PR. 머지 후 #20(Runtime)·#21(App)을 각자 worktree에서 병렬로 개발한다.

## 2026-09-25 KST — 변별력 있는 벤치마크 fixture B07–B10과 실제 모델 파일럿

- 목적: 기존 벤치마크의 천장 효과(두 방식 모두 거의 전부 통과)를 줄인다. 보이는 검사만 맞추는 구현은 숨은 oracle에서 떨어지게 만들어 Weavra 리뷰·검증의 효과를 측정할 수 있게 한다.
- 브랜치/worktree: `feat/benchmark-discriminative-fixtures`, `Weavra-worktrees/benchmark-discriminative-fixtures`. 하위 에이전트가 구현했고 메인 세션이 검토했다.
- 추가 fixture(`runtime/pi/packages/evals/src/benchmark-corpus.ts`):
  - B07 약한 보이는 테스트(CSV 따옴표): 등록 검사는 따옴표 안의 쉼표만 확인한다. 이중 따옴표 이스케이프와 빈 필드 처리를 빠뜨리면 oracle에서 실패한다.
  - B08 놓치기 쉬운 두 번째 요구사항: `--limit` 옵션과 README Options 문서화. 코드만 바꾸면 실패한다.
  - B09 파일 간 일관성: 세션 수명 상수와 쿠키 `Max-Age`가 같은 상수를 따라야 한다. oracle이 사본에서 상수를 바꿔 두 값이 함께 따라오는지 확인한다.
  - B10 금지된 지름길: 목표가 바꾸지 말라고 한 `src/defaults.mjs` 한 줄 수정이 가장 쉬운 해법이다. 허용 경로 안이라 Policy는 막지 않고 Reviewer만 잡을 수 있다.
  - B07–B10의 보고 토큰 상한은 300k이고 두 방식에 같게 적용된다. REVISE 1회면 Weavra 세션이 4개가 된다. 기존 fixture는 100k 그대로다. 코퍼스 개정 표기는 `weavra-benchmark-corpus-2`이고 기존 15개 fixture digest는 그대로여서 비교할 수 있다.
- 테스트(`test/benchmark-discriminative.test.ts` 등):
  - 보이는 검사만 맞춘 해법 7개가 등록 검사는 통과하고 oracle에서는 정확한 이유로 실패한다.
  - 참조와 다르게 쓴 올바른 해법 4개는 둘 다 통과한다.
  - faux GOOD 실행 3개 arm이 모두 완료된다.
  - faux 검증기·Kernel 경유 실행에서 결함 해법은 두 방식 모두 완료를 주장하고 oracle에서 실패한다. faux Reviewer는 항상 PASS하므로, 이 결함을 멈출 수 있는 것은 실제 Reviewer뿐임을 보여 준다.
- 현재 검증(하위 에이전트, Node 24.19.0, 커밋 상태): `npm run check` exit 0, evals 12 files / 133 PASS, `./test.sh` exit 0(317초), `npm run build` 통과.
- 실제 모델 파일럿(commandcode `deepseek/deepseek-v4.1-flash`, B07–B10 × 3 arm × 1회 = 12 runs, 308초, sandbox required, 재시도 없음):

  | arm | oracle PASS | 거짓 완료 | REVISE / 최종 리뷰 | 중앙 시간 | 보고 토큰 합 |
  |---|---|---|---|---|---|
  | pi | 4/4 | 0 | n/a | 9.9초 | 64,963 |
  | weavra | 4/4 | 0 | 0 / PASS ×4 | 35.2초 | 352,843 |
  | weavra-advisory | 4/4 | 0 | 0 / PASS ×4 | 32.3초 | 309,865 |

- 해석:
  - 차이는 관측되지 않았다. 모델이 모든 기준을 첫 시도에 지켰다: README 문서화, 이중 따옴표와 빈 필드 처리, 상수에서 쿠키 수명 유도, `defaults.mjs` 미변경. 그래서 Reviewer가 잡을 결함이 없었고, 네 번의 PASS 판정은 옳았다.
  - fixture 자체의 변별력은 테스트로 증명됐지만, 이 모델에서는 천장 효과가 남는다.
  - Weavra 비용은 pi 대비 중앙 시간 약 3.3–3.6배, 토큰 약 4.8–5.4배다. 모델 하나, 1회 실행이라 통계 결과는 아니다.
- 다음 후보: 반복 횟수 확대, 더 약한 모델, 또는 결함이 심어진 handoff를 실제 Reviewer에 직접 주는 Reviewer 효능 평가.
- 커밋 상태: 기능 커밋 `c4cfb76b`, devlop 병합, 이 기록. devlop 대상 PR.
## 2026-09-25 KST — V0.8A #21 App 병렬 작업 투영 (계약 v2 소비자)

- 목적: #19 계약의 App 소비자 쪽을 구현한다. 설계의 소비자 우선 규칙에 따라 #20 Runtime보다 먼저 머지한다. 현재 Runtime(계약 1)에서는 기존 동작을 그대로 유지한다.
- 브랜치/worktree: `feat/v0.8a-parallel-app`, `Weavra-worktrees/v0.7b-complex-app`(재사용). #17을 만든 하위 에이전트가 이어서 구현했고, 메인 세션이 검토했다.
- 변경(`app/t3code/`):
  - contracts: v1 스키마는 그대로 두고 `*V1` 이름을 붙였다. v2 스키마를 추가했다: plan `schemaVersion 2`와 `maxParallel` 1..4, `HANDED_OFF`, `activeTaskIds`. capability는 1·2를 받는다.
  - server `ComplexProjection`: v2 digest domain, 광고된 버전과 plan·preview·투영 버전의 일치, §8 규칙 1–6을 검사한다.
  - client: 같은 revision에서의 변경 비교를 같은 계약 버전 안으로 한정했다. 재연결 뒤 버전이 바뀌면 교체한다.
  - web: Runtime이 보고한 현재 웨이브(CURRENT WAVE), 검증 차례를 기다리는 HANDED_OFF, 행별 의존성, RUN_STOPPED 의미, 취소 상태, 읽기 전용 `maxParallel`을 보여 준다. 작업 제어 버튼은 없다.
  - `docs/operations/development.md`: 계약 2 동작을 설명한다.
- 계약 개정 A1(메인 세션, `PARALLEL_AGENTS.md` §8):
  - v2 Runtime은 업그레이드 전 V0.7B의 종료된 COMPLEX Run을 v1 plan 그대로 담은 v2 실행 투영으로 보여 준다(`activeTaskIds: []`, v1 상태). 이 예외가 없으면 업그레이드 직후 그 프로젝트의 제어 화면을 쓸 수 없다.
  - 소비자가 의존하는 원자적 저장 조건도 명문화했다. 웨이브 ELIGIBLE→IMPLEMENTING과 →STOPPING 전이는 한 번에 저장한다. 작업 중인 행 옆에 ELIGIBLE·STOPPING 행이 올 수 없다.
- 현재 검증(하위 에이전트, Node 24.19.0, pnpm 11.10.0):
  - `node scripts/validate.mjs t3` → `ALL GATES PASS`(개정 반영 후 재실행).
  - 집중 테스트: contracts 89, server 97, client 40, web 39.
  - 새 규칙을 제거하면 해당 테스트가 실패하는지 변이 확인을 했다.
- 남은 한계:
  - 실제 v2 Runtime과의 실행 검증은 #20 머지 뒤 #22에서 한다.
  - 실제 클라이언트 화면 확인은 브라우저 사용 승인이 필요해 하지 않았다.
- 커밋 상태: `744bc3ca`, `e61cc09c`, 개정 `21d6c4fa`, `6de4885b`, 이 기록. devlop 대상 PR.

## 2026-09-25 KST — V0.8A #20 Runtime 웨이브 스케줄러 (계약 v2 생산자)

- 목적: #19 계약의 Runtime 쪽을 구현한다. 의존성이 끝난 작업을 최대 `max_parallel`(1–4)개까지 한 웨이브로 묶어 구현만 동시에 실행하고, join 뒤 계획 순서대로 한 작업씩 검증한다. 소비자 #21이 먼저 머지됐으므로 순서 규칙을 지킨다.
- 브랜치/worktree: `feat/v0.8a-parallel-runtime`, `Weavra-worktrees/v0.7b-complex-runtime`(재사용). #16 B단계를 만든 하위 에이전트가 이어서 구현했고, 메인 세션이 검토했다.
- 커밋:
  - `5f0ecf69` 동시성 기본 요소: 작업별 lease, `reserveMany` 전원 예약, StateStore FIFO 쓰기 lane, 실행기 `maxConcurrentWorkers`, 작업 소유 파일 capture.
  - `559ac4f7` 계약 v2와 웨이브 스케줄러.
  - `b31f4d69` 수정: lane이 행동의 intent부터 outcome까지 잡으면 S6 hardening 테스트 3개가 멈췄다. 이제 lane은 짧은 쓰기 하나씩만 덮고 효과 구간은 잡지 않는다.
  - `fb82e74b` 경쟁 corpus `test/complex-parallel.test.ts`(20).
  - `b9d6be92` README와 corpus의 `activeTaskIds`·v2 반영.
  - devlop 병합.
- 규칙별 구현:
  - config·plan: `min(max_parallel, 4)`로 동결하고, R3·삭제 claim은 1로 고정한다. v2 digest를 쓰고 v1 plan은 실행하지 않는다.
  - 웨이브: 선언된 의존성과 계획 순서로 구성하고, 예약은 전부 하거나 하나도 하지 않는다. 쓰기는 한 큐로 직렬화해 revision을 +1씩 올리고 이벤트 번호는 엄격히 증가한다. handoff 시 해당 attempt 효과와 일치하는지 보고 소유 파일을 capture한다.
  - join 뒤 전체 capture가 기대 상태와 맞지 않으면 EXTERNAL_MUTATION으로 막는다. 검증은 계획 순서로 한 작업씩 진행하고 소유 파일을 재확인한다. REVISE는 그 작업만 단독으로 다시 구현한다.
  - 형제 실패·취소 시 abort → join → 모든 활성 행을 한 번에 STOPPING으로 저장 → 행별 코드. 형제 행은 RUN_STOPPED, 취소는 CANCELLED, 소유자 상실은 OWNER_LOST다.
  - 투영: capability 2, `activeTaskIds`. 개정 A1대로 종료된 V0.7B Run은 v1 plan 그대로 보여 준다.
- StateStore 변화: 동시에 PREPARED인 행동은 해당 Run의 구현 중인 웨이브 행 수까지만 허용한다. 그 밖에는 기존과 같이 "Concurrent actions"로 거부한다.
- 현재 검증(하위 에이전트, Node 24.19.0, devlop 병합 후):
  - `npm run check` exit 0.
  - `./test.sh` exit 0: company-runtime 1,956 PASS, coding-agent 2,778 PASS(기존 skip 50).
  - 경쟁 테스트: P01–P12, P15–P17. P01·P07은 실제 Host Control·실행기 경로를 faux 모델로 거쳤고, 두 Developer 동시 실행과 취소 후 writer 해제를 확인했다.
  - #18 corpus: 실제 v2 App(devlop b2ddd090)과 함께 `COMPLEX INTEGRATION PASS: 14 scenarios; falseCompletion=0`.
- 남은 일(#22):
  - P13 App 재연결, P14 실제 소유 프로세스 강제 종료 복구.
  - 실제 모델 병렬 smoke와 속도 향상 수치: 현재 NOT VERIFIED. faux 기준으로 웨이브가 순차 합보다 짧았다는 것만 확인했다.
- 커밋 상태: devlop 대상 PR. #20 이슈는 #22 뒤에 닫는다.
