# Weavra 작업 기록

## 현재 진행 요약

- 상태: 로컬 전체 검증과 corrected exact root CI 세 job PASS. 검증된 구현에서 main/devlop을 생성했다. 최종 evidence revision의 정확한 SHA·CI·공개 refs는 annotated provenance tag의 publication 기록으로 식별한다.
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
