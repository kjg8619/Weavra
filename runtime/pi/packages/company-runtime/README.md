# Weavra Runtime

Adaptive Agent Workflow Runtime — **Weavra v0.1 RC1 기반 development build**.

사용자 설치·Quick Start·기능 범위는 [Weavra README](../../README.md)를 참고한다. 이 문서는 S0~S6 및 RC 수정의 구현 참조다. 내부 `company-runtime`/`CompanyKernel` 명칭과 Pi workspace package 버전 `0.85.1`은 유지하며 Weavra 제품 버전과 구분한다.

Host 독립 Kernel, StateStore·Policy, 독립 Pi SDK 역할에 실제 Git evidence·등록 check·명령/lifecycle을 연결했다. **STANDARD/R0~R2와 QUICK/R0~R1**을 지원한다. R2는 제한된 파일 변경과 독립 리뷰를 결합한 경로다. R3는 명시적 인간 승인을 받은 단일 tracked 텍스트 파일 삭제만 지원한다. COMPLEX/범용 R3 실행, 자동 resume/rollback/commit, 병렬 조직은 지원하지 않는다. [GPT RC-01~08 validation](../../docs/GPT_RC_VALIDATION_2026-09-16.md)의 한정된 실제 검증을 통과했으며 정식 V0.1 release 선언은 아니다. DeepSeek는 NOT VERIFIED다.

## 로딩

저장소 루트에서 의존성과 fork-local Pi CLI를 빌드하고 **Weavra workspace만** link한다. global Pi 설치는 필요 없다.

```sh
npm install --ignore-scripts
npm run build
npm link --workspace packages/company-runtime --ignore-scripts
weavra setup
weavra doctor
cd /absolute/path/to/my-project
# 현재 workspace에서 실행
weavra
# 격리된 Git worktree 생성 후 실행
weavra --worktree fix-login
weavra --help     # fork-local Pi 도움말
weavra --version  # fork-local Pi 버전; Weavra 버전은 /workflow help
```

Bash wrapper가 npm link symlink를 해석하여 같은 checkout의 `packages/coding-agent/dist/bundle/cli.js`와 Extension 절대경로를 구하고 `exec <local-cli> -e <extension> <args>`로 실행한다. 기본 실행은 cwd·인수·stdio·종료 코드/시그널을 유지하고, user-level agent/session 환경만 아래 V0.2C 격리 규칙으로 변경한다. PATH의 `pi`를 조회하거나 fallback으로 실행하지 않는다. local build가 없거나 실행 불가하면 checkout의 install/build 명령을 안내하고 실패한다. checkout/Pi 소스·의존성 갱신 후에는 재빌드해야 하며 자동 freshness 검사·자동 build는 없다.

`pi`는 사용자가 기존에 설치한 executable/symlink 그대로이고 `weavra`만 fork-local CLI를 사용하므로 서로 다른 Pi 버전과 공존할 수 있다. 위 workspace 한정 link는 `weavra`만 제공하며 **coding-agent 패키지 자체를 global link하지 않는다.** Pi Core/bin·Status Projection·Runtime 의미는 바꾸지 않는다. Windows는 지원하지 않는다.

`--worktree <name>`은 launcher 전용 옵션이다. clean Git source의 frozen HEAD에서 `weavra/<name>` branch와 `<repo-parent>/.weavra-worktrees/<repo-name>/<name>`을 새로 만들고 그 루트를 cwd로 사용한다. 이름은 `[A-Za-z0-9._-]+` 및 Git branch validity를 만족해야 하며, 기존 branch/경로는 거부한다. source HEAD/branch/status를 전후로 재검증하고 생성된 worktree의 HEAD/branch/clean 상태도 확인한다. local Pi build 누락·Git 오류·검증 실패 시 Pi를 시작하지 않고 global fallback도 하지 않는다.

`--worktree <name>`만 소비하며 나머지 argv(`--` 이후 포함)는 재해석 없이 전달한다. fork-local CLI/Extension은 계속 Weavra 소스 checkout의 절대경로이고, `.ai` state만 프로젝트 worktree 기준이다. 생성 안내는 stderr로 출력한 뒤 기존 exec/stdio/exit/signal 계약을 유지한다. uncommitted/ignored 파일·의존성은 복사하지 않으므로 필요한 config/check는 source에 직접 commit해야 한다. Launcher Git 호출에서는 optional index writes와 checkout/fsmonitor hooks를 끄고 repository 환경 override·worktree 부모 symlink는 거부한다.

**--worktree does not merge, commit, stash, reset, or remove anything automatically.**

성공·BLOCKED·CANCELLED·Pi 실패·시그널 종료에도 branch/worktree는 보존한다. 생성 오류 시 예약된 디렉터리·부분 생성 결과도 자동 정리하지 않는다. 사용자 검토·수동 후처리가 필요하며 merge/PR/충돌 해결·강제 재사용은 V1 범위 밖이다. Git object/ref는 source와 공유한다. 외부 경합·trusted Git filter/프로그램은 sandbox하지 않는다. Kernel/Workflow/Risk/Policy/Approval/Reviewer/Verification/StateStore/RuntimeEvent/Status Projection과 worker 도구는 변경하지 않는다. 상세 사용법과 경계는 [worktree 안내](../../README.md#isolated-git-worktree)를 따른다.

### 기존 worktree 재접속·조회

```sh
weavra --worktree-open fix-login
weavra --worktree-open fix-login --continue
weavra --worktree-open fix-login --resume
weavra --worktree-open fix-login --session <path-or-id>
weavra --worktree-list
```

- `--worktree` = create only, `--worktree-open` = open existing only, `--worktree-list` = read-only discovery다. 옵션은 서로 배타적이며 기존 create의 충돌 실패 의미는 유지한다.
- `src/launcher-worktrees.ts`는 **launcher 전용 Node CLI**이며 Runtime/Extension에서 import하지 않는다. Node의 native TypeScript 지원으로 직접 실행하고 외부 dependency나 별도 build는 없다. `git worktree list --porcelain -z`만 등록 원본으로 사용하고 별도 registry/state를 만들지 않는다.
- open은 생성과 같은 name validity 및 정확한 `refs/heads/weavra/<name>` 등록 1개, 실제 root·동일 common repository·branch/HEAD·linked metadata backlink/index를 검사하고 등록을 재확인한다. 기본 생성 경로를 추정하지 않아 사용자가 정상 이동한 worktree도 현재 등록 위치에서 열린다. 다른 repository/branch, 중복 등록, missing/broken/prunable이면 실패하며 자동 repair/prune/recreate/move/delete하지 않는다.
- source와 대상의 dirty 상태는 open 거부 조건이 아니다. launcher는 파일·index·`.ai`를 변경하지 않는다. Git inspection은 optional locks와 hooks/fsmonitor를 비활성화하고 repository override 환경변수를 거부한다. 외부 프로세스 경합에 대한 OS sandbox나 잠금은 아니다.
- `--worktree-open <name>`만 소비하고 Pi `--continue`/`-c`, `--resume`/`-r`, `--session <path|id>` 및 다른 argv를 그대로 전달한다. 같은 canonical cwd의 기존 Pi SessionManager를 사용한다. session 복제/이관/registry·Runtime resume는 추가하지 않는다. open 성공은 기존 `/workflow run`의 clean baseline·Policy·Approval 조건 완화를 뜻하지 않는다.
- list는 해당 Git repository의 `refs/heads/weavra/*`만 NAME/BRANCH/PATH/STATUS로 출력하고 Pi/Extension/`.ai`/session을 로드하지 않는다. 따라서 local Pi build는 없어도 되지만 Node/Git/helper는 필요하다. 추가 Pi 인수는 거부한다. `OK`는 metadata 정상이지 clean이나 Runtime COMPLETE가 아니다. `LOCKED`는 정상 등록이면 open 가능하고, `PRUNABLE`/`MISSING/BROKEN`/`BROKEN`/`AMBIGUOUS`는 점검 대상으로 표시할 뿐 수정하지 않는다.
- tab/newline/control 문자는 목록에서 escape한다. 줄바꿈 경로·최종 디렉터리 symlink는 open에서 거부한다. 성공 안내는 stderr, 이후 fork-local Pi는 기존 exec/stdio/exit/signal 계약 그대로다. global Pi fallback은 없다.

### V0.2C Product home / setup / doctor

```text
Pi: ~/.pi/agent
Weavra: ~/.weavra/agent           # 또는 $WEAVRA_HOME/agent
Runtime: <project>/.ai            # user config와 별개
```

`src/launcher-home.ts`는 Node built-in만 사용하는 launcher 전용 helper다. Runtime/Extension에서 import하지 않는다. `resolveWeavraHome`, `prepareLaunch`, `setupWeavra`, `doctorWeavra`가 경로/설치/진단을 담당하고 Bash wrapper는 환경과 argv/exec 연결만 담당한다. `WEAVRA_HOME`은 절대 경로 또는 `~/...`를 받고 cwd 상대/줄바꿈 경로를 거부한다. Pi 영역과의 lexical/canonical overlap, product 디렉터리 symlink/비공개 권한 오류도 fail-closed다.

- `weavra setup`: 프로젝트/build 없이 실행. home/agent와 sessions/themes/prompts/tools/bin 디렉터리를 mode 0700으로 준비한다. 기존 디렉터리를 chmod하지 않는다. 기본 `~/.pi/agent`에서 auth/models/settings 파일만 read-only 후보 탐색하고 파일별 기본 No 동의를 받는다. settings는 extension/path/command/sessionDir 경고 후 optional import다. 기존 대상은 SKIP하며 overwrite/force가 없다.
- import는 regular·non-symlink·single-link UTF-8 JSON object, 최대 1 MiB로 제한한다. 임시 0600 파일 write/fsync 후 atomic link(no-clobber)로 공개하고 임시 이름만 제거한다. rename이 기존 파일을 덮어쓸 수 있는 경합을 피한다. source/기존 대상 bytes와 permissions는 변경하지 않고 오류에도 credential 내용을 노출하지 않는다. 다중 파일 transaction이나 외부 syscall 경합/전원 장애 내구성까지 보장하지 않는다.
- 기존 Pi sessions는 import하지 않는다. `Existing Pi sessions were not imported automatically.`를 항상 안내한다. Pi/과거 Weavra session 식별·bulk migration·별도 registry는 후속 범위다. 사용자의 명시적 `--session <path|id>`는 차단하지 않는다.
- 일반 실행은 준비된 Weavra agent dir를 요구한다. 없으면 `Run: weavra setup`으로 종료하며 worktree mutation보다 먼저 검사한다. Pi의 `shouldRunFirstTimeSetup()`은 custom agent override에서 false이므로 이 명시적 setup을 선택했다. auth가 없더라도 준비된 디렉터리에서는 `/login`을 위해 실행 가능하다. 손상 JSON/unsafe auth 권한 등은 실행 전에 거부한다.
- child 직전에 `PI_CODING_AGENT_DIR=<canonical Weavra agent dir>`로 override하고 inherited `PI_CODING_AGENT_SESSION_DIR`을 제거한다. Pi의 `--session-dir` > settings.sessionDir > default agent/sessions/cwd 규칙은 유지하며 `WEAVRA_SESSION_DIR`는 추가하지 않았다. home은 worktree별로 만들지 않고 Pi의 cwd partitioning을 그대로 쓴다. settings import가 명시적 path override를 포함하면 doctor가 경고하며 자동 수정하지 않는다.
- `weavra doctor`: local checkout/build/Extension·Node/Git, home/agent·읽기/쓰기/private 권한·Pi와 격리, auth 존재/JSON·models/settings JSON, session 기본값을 PASS/WARN/FAIL로 출력한다. WARN-only는 0, 필수 FAIL은 non-zero다. missing auth/models/settings는 WARN이며 READY는 원격 인증/Provider/workflow 성공 판정이 아니다. JSON 값·token/parse 원문 오류는 출력하지 않는다.
- doctor는 mkdir/chmod/repair/auth refresh/Provider/network/session 생성/Git mutation/`.ai` 생성을 하지 않는다. Git은 제한된 환경의 `git --version`만 실행한다. setup/doctor는 단독 명령이며 다른 Pi/worktree 인수 혼용은 거부한다. `--` 뒤 literal prompt는 기존 Pi로 전달한다. read-only worktree-list는 setup 전에도 사용 가능하다.

직접 local CLI에 `-e`를 주는 아래 고급 실행은 launcher를 우회하므로 이 product home 격리를 자동 적용하지 않는다. 기본 사용은 `weavra`를 권장한다. 격리는 user-level default 경로에 한정되며 명시적 settings/session override·프로젝트 `.pi`·Provider 환경변수/실행 코드 전체를 sandbox하지 않는다. 기존 Pi 파일·global pi/PATH/shell rc를 수정하지 않고 Runtime `.ai` authority와 의미도 그대로 유지한다.

같은 local CLI에 명시적으로 로드할 수도 있다(아래는 저장소 루트 기준).

```sh
./packages/coding-agent/dist/bundle/cli.js -e ./packages/company-runtime/src/extension.ts
# package.json의 pi.extensions 진입점을 사용하는 경우
./packages/coding-agent/dist/bundle/cli.js -e ./packages/company-runtime
```

Weavra Extension의 소스 TypeScript는 local Pi가 로드하므로 **company-runtime 자체**의 별도 build는 없다. 위 coding-agent 및 workspace 의존성 build는 필요하다. 모델 데이터가 이미 준비되어 있으면 root `npm run build:offline`도 가능하다. 자동 로딩 설정은 추가하지 않는다. 체크아웃 개발 환경은 root `npm install --ignore-scripts`를 사용한다. 모델 데이터가 없는 체크아웃에서 Pi 소스 로딩 테스트를 하려면 `npm run hydrate:model-data`도 필요하다. 이 명령은 공개 모델 카탈로그를 가져오며 추론 요청을 보내지 않는다.

명령은 알림을 지원하는 TUI/RPC에서 출력한다. Print/JSON에서는 명시적 오류를 반환한다. 전체 Runtime의 RPC 실행 지원을 뜻하지 않는다.

| 명령 | 동작 |
|---|---|
| `/workflow help`, `/state help`, `/team help`, `/risk help` | Weavra 사용법; workflow help에 risk/Reviewer/Approval·commit/rollback 제한 안내 |
| `/workflow run <goal>` | 신뢰 확인 후 비동기 preflight·분류에 따른 QUICK/STANDARD 실행 시작 |
| `/workflow`, `/workflow status [runId]` | live Kernel 또는 저장된 run의 출처·시각·상태·변경 요약 |
| `/workflow history [page]`, `/workflow config` | 저장 run 이력 / 현재 설정과 effective revision 안내 |
| `/workflow cancel` | 취소 요청 후 worker/check 정리와 종료 보고를 기다림; rollback 없음 |
| `/state [runId]` | task/requirements, structured result, 검증·부분 변경 요약 |
| `/state checks [runId] [page]`, `/state check <number> [runId]` | check 목록 / 실제 stdout·stderr·exit·시간·step·evidence 상세 |
| `/state review [runId]`, `/state decisions [runId] [page]` | 회차별 review / 구조화 운영 결정 |
| `/team [runId]`, `/risk [runId]` | 역할/profile/session 참조 / 분류·Policy·Approval 상태 |
| `/state export` | idle/terminal 상태의 운영 결정·check projection을 명시적으로 생성 |
| `/graph [latest\|runId]`, `/graph help` | V0.2A 읽기 전용 ASCII snapshot; 실행 기능 없음 |
| `/graph view [latest\|runId]` | V0.2B 정적 read-only TUI overlay; navigation/close만 지원 |
| `/lsp [status]` | V0.3B read-only 프로젝트 LSP 설정/process 조회; 서버/Provider 시작 없음 |

Factory는 기존 네 명령 및 `/graph`, `/lsp`와 lifecycle/input 보호 훅, TUI `session_start`의 짧은 Weavra 로드 알림만 등록한다. 시작 시 config/state I/O·Agent 실행은 하지 않고 기존 Pi 헤더를 교체하지 않는다. Print/JSON/RPC에는 시작 배너를 출력하지 않는다. 모든 명령은 project trust를 요구한다. run/config는 `.ai/config.yaml`을 검사하지만 상태 조회는 config/model/auth 없이 저장된 source를 읽는다. run은 부모 Agent가 idle일 때만 시작하며 등록된 check 실행을 UI에서 확인받는다. 활성 run 동안 일반 입력·부모 도구·user bash를 차단한다. 명령은 빠르게 반환하므로 status/cancel을 계속 사용할 수 있다. 설정 생성·자동 모델 대체·일반 대화의 조직 실행 변환은 없다.

## Weavra Status Projection

TUI에서 현재 Host가 소유한 `StandardWorkflow.snapshot`(기존 Kernel snapshot)을 footer에 투영한다. 별도 Workflow/State/Graph model을 만들거나 `.ai`에 UI 상태를 저장하지 않는다. Worker에는 UI/Extension 리소스를 추가하지 않는다.

- `RuntimeEvent` 수신 시 현재 snapshot의 run ID가 event와 일치할 때만 투영한다. 이벤트 종류를 상태 전이 명령으로 재해석하지 않는다. `RunCreated` 도중 아직 Kernel이 Host에 연결되지 않았거나 과거 복구 이벤트인 경우 건너뛰고 이후 현재 run 이벤트를 사용한다.
- 공식 `ctx.ui.setStatus("weavra.runtime", text)`로 단일 합성 문자열을 발행한다. 같은 문자열은 재발행하지 않으며 polling/timer는 없다. phase를 바꾸지 않는 token/tool 진행은 갱신하지 않는다.
- 예: `Weavra · QUICK · R1 · IMPLEMENT · Executor`, `Weavra · STANDARD · R2 · REVIEW · Reviewer`. WAITING_APPROVAL은 저장 phase가 IMPLEMENT여도 UI에 `APPROVAL`로 투영한다. terminal은 `Weavra · COMPLETED/BLOCKED/CANCELLED/FAILED/INTERRUPTED` 중 실제 상태만 표시하며 과거 active role을 붙이지 않는다.
- 실행 Promise 종료 시 final snapshot/report를 한 번 더 확인한다. 이벤트 없는 저장 실패도 반영하며 별도 cleanup/report 오류는 `Weavra · ATTENTION · /state`로 표시한다. owner가 끝났지만 snapshot이 active인 경우 `Weavra · UNCONFIRMED · /state`다.
- 시작 시 표시를 비우고 config/state 파일은 읽지 않는다. 저장된 상태나 writer 존재는 live 근거가 아니며 `/state` 등 과거 조회도 footer를 덮어쓰지 않는다. 종료 결과는 이 Host의 마지막 실행 결과로 유지하며 현재 filesystem 검증을 뜻하지 않는다.
- 새 run preflight에서 과거 결과를 지운다. `/workflow cancel`은 기존 cleanup을 기다린 후 실제 terminal 표시를 남긴다. switch/fork/tree/reload/shutdown은 cleanup 대기 전에 UI 연결을 끊고 자기 키만 지워 늦은 이벤트/finally가 stale 표시를 복원하지 못하게 한다.
- Snapshot/format/setStatus/clear 예외는 표시 계층에서 격리한다. 기존 주입 observer는 그대로 전달하고 실패 진단은 기존 Kernel이 소유한다. 정상 run을 FAILED로 바꾸거나 cleanup을 중단하지 않는다. 고장 난 UI의 실제 화면 갱신 자체는 best-effort다.
- 기존 Pi footer와 다른 키의 status를 유지한다. 외부 footer가 공식 extension status map(`getExtensionStatuses()`)을 렌더링하면 같은 키를 사용할 수 있다. 외부 extension 의존성·footer 교체·RPC/Print/JSON status 출력은 추가하지 않는다.

구체적인 live transition·승인·취소·lifecycle·UI 실패 검증은 `test/status.test.ts` 및 `packages/coding-agent/test/suite/company-runtime-status.test.ts`의 기존 harness/faux 통합을 따른다.

## V0.2A Graph Projection

`src/graph.ts`의 `projectRunGraph(snapshot)`과 `renderGraphText(graph)`는 순수 함수다. `GraphProjection`은 `{runId, workflow, risk, status, stateRevision, recordedAt, nodes, edges, diagnostics}`이며 원본 Run status를 유지한다. node에는 deterministic `id`, `kind`, `label`, 정규화 `status`, 선택적 `stepId/attempt/role/parentId/verdict/approvalStatus/checks/detail`이 있다. edge의 `kind`는 `sequence/pass/revise/next_attempt/contains/approved`다. 실행 명령이나 scheduler dependency로 사용하지 않는다.

- `implement:1`, `self-check:1`, `review:1` 등 실제 Step/attempt를 사용한다. QUICK은 implement/self-check/test/complete, STANDARD는 review를 포함한다. role은 해당 workflow 단계의 Executor/Developer/Reviewer이며 per-attempt 정보가 없는 session 참조를 임의 배정하지 않는다.
- `revisionCycle + 1`까지 기록된 attempt만 펼친다. 이전 attempt는 implement/self-check/review까지만 표시하고 현재 attempt에는 남은 TEST/COMPLETE를 포함한다. 실제 REVISE 기록이면 다음 attempt로 `revise` edge를 표시한다. V0.5C repair parent는 failed self-check에서 새 implement로 `next_attempt`를 연결하며 실행하지 않은 Reviewer를 만들지 않는다. 그 밖의 누락 review는 UNKNOWN이다. 순환·추가 실행 attempt를 만들지 않는다.
- 현재 node는 Run의 현재 단계/종료 결과를 반영한다. 이전 implement는 같은 attempt의 수락된 handoff 또는 후속 check/review로 확인한다. verification은 정확한 step/attempt에 연결된 결과를 정렬해 표시하며 required 미실행·FAIL과 원본 PASS/exit를 구분한다. 이력의 PASS는 현재 diff/check 재검증이나 전체 완료 판정이 아니다.
- node 상태는 `pending/running/passed/failed/blocked/cancelled/skipped/waiting_approval/revised/unknown`이다. current 단계 RUNNING은 선택된 단계 표시이며 실제 process 생존 증명이 아니다. 미진입 terminal 후속 단계는 skipped, 기록 누락/INTERRUPTED의 실행 결과 미확인은 unknown이다. 원본의 INTERRUPTED를 CANCELLED로 재기록하지 않는다.
- R3 `approval:1`/`mutation:1`은 `parentId: implement:1`, `stepId: implement`을 가진 projection-only detail이다. `contains` 관계는 Developer 완료나 새로운 Kernel step을 뜻하지 않는다. PENDING은 waiting_approval, DENIED/EXPIRED는 blocked, APPROVED/CONSUMED는 승인 결과 passed다. mutation은 CONSUMED만 passed이며, 승인 후 소비 기록 없이 종료되면 effect를 unknown으로 남긴다. action audit 추가 확인은 `/state decisions`를 사용한다. 소비 이후 실패/취소는 이미 기록된 mutation을 rollback하지 않는다.
- Run shape 및 identity/phase/attempt/중복 metadata가 잘못됐으면 `GraphProjectionError`로 거부한다. 선택적 과거 기록 누락은 UNKNOWN과 진단으로 표시한다. COMPLETED 헤더를 보존하더라도 current-attempt 근거가 불완전하면 completion node는 unknown이다. Kernel guard를 실행하거나 완료 상태를 수정하는 기능이 아니다.
- 한도는 기본 attempt 4개 + 유효한 verification repair 최대 1개, review 4개, scoped approval 1개, check 1,000개다. 출력은 약 32,000자로 제한하고 원본 데이터의 terminal/bidi 제어 문자를 escape한다. malformed/과대 state를 무제한 node로 확장하지 않는다.

`/graph`, `/graph latest`, `/graph <full-run-id>`는 기존 Extension `inspect`와 `FileStateStore.readSnapshot`의 read-only 경계를 공유한다. live owner snapshot 또는 저장 Run만 읽고 lock/repair/recovery/resume, config/model/auth, Provider/Agent, Approval/State 변경, Git 호출을 하지 않는다. missing source/orphan/corrupt state는 이전 graph/export로 대체하지 않는다. source/recorded 정보, 저장 active 상태의 liveness 미확인, local failure/durable status 차이를 기존 조회처럼 알린다. 별도 graph 저장·캐시·polling·RuntimeEvent 재생은 없다.

첫 버전은 호출 시점의 ASCII adjacency 출력이며 자동 갱신 UI가 아니다. 실제 RuntimeEvent 경계의 faux 통합 테스트에서 현재 snapshot을 다시 읽어도 node/edge가 동일하고 조회 중 state bytes·Provider 호출 수·writer 획득 수가 변하지 않음을 검증한다. 그래프는 이벤트 내용을 다음 상태로 해석하지 않는다. V0.2B TUI Viewer도 아래와 같이 동일 DTO를 재사용한다. Scheduler/parallel/dynamic dependencies/node retry/Planner/Lead/COMPLEX/T3Code/Web UI, 기존 Runtime/Status/Worktree semantics 변경은 없다.

## V0.2B Read-only TUI Viewer

`/graph`의 ASCII 출력은 유지하며 `/graph view`, `/graph view latest`, `/graph view <runId>`가 같은 `inspect → projectRunGraph()` 결과를 TUI에 표시한다. Viewer는 `ctx.mode === "tui"`에서만 열고 RPC는 `/graph`를 사용한다. project trust/상태 검증 및 로컬 실패·저장 source 구분은 V0.2A와 동일하다.

```text
Runtime snapshot → GraphProjection (graph.ts, 불변)
                 → layoutGraphView (graph-view.ts, 순수)
                 → GraphViewComponent (graph-view-component.ts, Pi TUI)
```

- `graph-view.ts`는 Graph DTO만 읽는다. 모든 node/status와 edge를 보존하고 기존 edge의 revision/containment 관계에 따라 들여쓰기와 연결선을 계산한다. 폭이 좁으면 한 column으로 줄인다. 새 dependency/step/attempt/실행 상태를 추론하지 않는다.
- 상태 glyph는 PASS `✓`, RUNNING `●`, PENDING `○`, REVISE `↻`, BLOCKED `!`, FAILED `×`, CANCELLED `-`, SKIPPED `·`, WAITING_APPROVAL/UNKNOWN `?`다. 상태 이름도 함께 표시하고 색상은 Pi theme의 fg palette만 사용한다. R3의 inside IMPLEMENT, APPROVED와 mutation/CONSUMED 구분은 DTO 그대로다.
- `GraphViewComponent`는 열 때 DTO/context 사본을 보유하고 render마다 현재 terminal size와 theme로 다시 그린다. 공식 `truncateToWidth`로 각 행 폭을 제한하고 세로 offset/page 경계를 resize 때도 clamp한다. overlay는 폭 96%/margin 1, 높이는 terminal 안에서 최대 40행이며 너무 작으면 `/graph` 안내를 표시한다.
- viewer-local `DEFAULT_APP_KEYBINDINGS`와 주입된 Pi manager의 user bindings로 별도 manager를 만든다. `tui.select.up/down`에 up/k·down/j, `tui.select.cancel`에 escape/q/ctrl+c 기본값을 주고 pageUp/pageDown 및 `tui.altScreen.top/bottom`은 기존 기본값을 사용한다. 명시적 사용자 설정이 우선이며 Pi 전역 manager/config 파일은 수정하지 않는다. key hint도 적용된 binding을 표시한다.
- 입력은 스크롤/close만 처리한다. Enter/node action/retry/approve/deny/cancel/resume는 없으며 Esc/q는 **viewer만 닫는다**. static snapshot이라 RuntimeEvent listener/polling/timer가 없고, 화면을 다시 열기 전에는 상태를 갱신하지 않는다. `Static snapshot`을 명시하여 현재 실행 보장으로 오인하지 않게 한다.
- `GraphViewSession`이 공식 `ctx.ui.custom(..., {overlay: true})`와 dispose/close를 소유한다. Extension은 viewer 요청을 reserve하고 lifecycle에서 닫을 뿐 Runtime authority를 전달하지 않는다. pending read/늦은 factory 및 중복 open을 보호하고, viewer close가 실패해도 Runtime cancellation/lease cleanup은 기존대로 진행한다. dispose 후 input/render/invalidate는 redraw나 Runtime 작업을 하지 않는다.
- editor component/footer/header/status를 교체하지 않는다. 일반 close 뒤 기존 editor text/focus/footer를 유지한다. session lifecycle의 기존 Status clear와 Runtime cancel/cleanup 의미는 바꾸지 않는다. render/theme 오류는 안내 화면으로 격리하며 고장 난 외부 UI의 복원은 best-effort다. 다른 extension의 동시 overlay stack·fullscreen 조합은 미검증이다.
- package에는 기존 workspace `@earendil-works/pi-tui` 버전 `0.85.1`을 dev dependency로 명시했다. Pi Core/TUI 소스·새 외부 dependency·새 실행/상태 schema 변경은 없다.

새로운 Graph editor/node 실행/drag-drop/zoom/pan/mouse dependency/DAG scheduler/parallel/Planner/Lead/COMPLEX/T3Code/Web UI는 없다. live update는 cleanup과 source authority를 유지하는 별도 후속으로 남긴다.

## V0.3A Hash-Anchored Edit

새 mutation 도구 없이 기존 `runtime_read({path, anchors?: boolean})`와 `runtime_edit({path, oldText, newText, anchor?, fileDigest?})`를 확장한다. `anchors` 생략/false는 기존 plain read 출력이고, precondition 두 개를 모두 생략한 edit는 기존 unique exact replacement다. 한 개만 제공하면 입력 오류로 거부한다. `runtime_search`와 `runtime_write`의 의미는 변경하지 않는다.

### Snapshot / anchor 계약

- `src/anchored-edit.ts`는 filesystem/Pi SDK/Provider 없는 deterministic domain helper다. `snapshotText`, `makeAnchor`, `verifyAnchor`, `applyAnchoredReplacement`와 strict UTF-8 검사를 소유한다. Node crypto만 사용한다.
- `fileDigest = sha256:<64 lowercase hex>`는 BOM·LF/CRLF·final newline을 포함한 정확한 UTF-8 bytes의 SHA-256이다. unrelated edit에도 stale로 닫는 full-file generation을 택했다. inode/timestamp 기반 영구 generation ID는 아니므로 bytes가 완전히 복원된 ABA 변경은 구분하지 않는다.
- opaque anchor 형식은 `a1:L<1-based line>:<64 lowercase hex>`다. hash 재료는 JSON tuple `["weavra-anchor-v1", canonical absolute target path, line number, exact line including terminator]`다. workspace/다른 path로 token을 재사용할 수 없고 같은 내용의 서로 다른 행도 구분한다. cryptographic 서명이나 읽기 수행의 인증 증명은 아니다. 모델은 token을 계산·재구성하지 않고 그대로 복사한다.
- snapshot은 첫 행에 `fileDigest: ...`, 이후 `anchor JSON-string`을 출력한다. 행 문자열의 newline/tab/control·terminal escape·bidi를 escape하고 Unicode normalization을 하지 않는다. `oldText`는 escape 표시 자체가 아니라 원문이다.
- source/replacement는 최대 256 KiB, NUL 없는 strict UTF-8 round-trip을 요구한다. output도 256 KiB 이하로 제한한다. 긴 행은 4,096 UTF-16 code units preview와 `[line preview truncated]`, 나머지 행 생략은 `[remaining lines omitted: output limit]`로 표시한다. token은 preview가 아닌 전체 행을 hash한다. 이번 버전에 pagination은 없으며 생략된 행의 token을 추정하면 안 된다. 빈 파일은 digest만 있고 exact oldText 대상 행은 없다.

### Apply / 실패 / audit

```text
request → existing Policy evaluation / durable ALLOW intent / path reinspection
        → current file re-read
        → full fileDigest equality
        → exact anchor equality
        → unique exact oldText starting in anchored line
        → final bytes / identity / cancellation check → replacement
```

`oldText`는 anchor가 지정한 행에서 시작하며 여러 행에 걸칠 수 있다. 다른 행에서 시작하는 동일 문자열은 무시한다. 같은 행에서 시작하는 두 occurrence(겹치는 occurrence 포함)는 `AMBIGUOUS_ANCHOR`로 거부한다. digest/anchor/oldText mismatch는 `STALE_ANCHOR`이며 해당 action의 mutation은 0 bytes다. 파일 전체를 검색하여 위치를 옮기거나 fuzzy 보정하지 않는다.

`src/anchored-files.ts`는 Policy 뒤의 filesystem adapter다. no-follow/nonblocking·regular/single-link·크기/경로 검사를 유지하고 bounded descriptor read를 사용한다. anchored edit는 O_RDWR, no create/no truncate-on-open으로 열고 동일 FD의 현재 bytes를 확인한 뒤 결과를 만든다. 마지막 bytes·dev/ino/mode/size/mtime/ctime·경로 검사와 AbortSignal 확인 뒤 JS yield 없이 같은 FD에 쓰고 길이를 조정한다. 검증 실패 때 truncate/write하지 않는다. 최종 검사와 effect는 외부 프로세스에 대한 atomic CAS가 아니며, 비협조 writer의 syscall 사이 race·부분 I/O 실패·전원 장애는 기존 한계다.

`agent-tools.ts`는 입력을 복사하고 기존 Policy/audit gate와 helper만 연결한다. `WORKER_FILE_TOOLS`와 Policy version/config digest 재료는 변경하지 않았다. 등록 operation은 계속 read/edit이므로 QUICK/R1 edit는 R1, bound STANDARD/R2 edit는 R2다. 기존 actionDigest 재료에 전체 params가 포함되어 path·anchor·fileDigest·oldText/newText·step·revision을 결합한다. audit에는 기존 decision/digest/outcome만 남기고 파일 내용/token/credential 로그 필드를 새로 추가하지 않는다. stale는 ALLOW 뒤 FAILED action이지 Policy DENY가 아니다.

Runtime이 직접 만든 `StaleAnchorError`만 tool call ID에 묶어 runner가 한 번 소비한다. 해당 오류 뒤 모델은 기존 세션에서 read → 새 요청을 선택할 수 있다. 오류 문자열을 흉내 내는 것으로 이 예외를 얻을 수 없고 Policy/저장 오류·취소는 회복 가능한 stale로 취급하지 않는다. 자동 retry/read/merge loop, 새 session/revision, 시간·턴 예산 확대는 없다. ambiguous/input/기타 file tool 오류는 기존처럼 세션을 실패시킨다.

### Rollout과 보호 범위

QUICK/R1 prompt와 edit 설명에 `Existing-file edits should prefer an anchored read followed by anchored edit. If an anchor is stale, re-read the file. Never guess or reconstruct an anchor.`를 넣는다. 이 안내는 권한이 아니며 실제 enforcement는 도구 구현이다. anchored mode는 기존 edit 권한 안에서 optional이고 STANDARD/R2에 강제하지 않는다. QUICK scope와 STANDARD/R2 binding의 분리, Reviewer read-only, R3 삭제·승인, Kernel/Verification/Graph/Viewer/Worktree/Product Isolation 의미는 그대로다.

**Anchored stale protection applies to anchored `runtime_edit` operations only in compatible mode; it does not magically make every possible file mutation anchored.** legacy exact edit·`runtime_write`는 compatible mode에서 계속 제공하고 trusted verifier/일반 Pi mutation까지 보호한다고 주장하지 않는다. 모든 existing-file mutation의 anchored-only 강제는 opt-in **strict mutation**으로 제공한다(아래 절). 자동 unit/filesystem/SDK-faux와 별도로 `codex-lb / gpt-6-astra`의 [실제 Provider smoke](../../docs/WEAVRA_V03A_PROVIDER_SMOKE_2026-09-17.md)에서 anchored mode 선택·두 번째 occurrence만 수정→QUICK COMPLETE와 외부 변경→old anchor→STALE_ANCHOR/bytes 보존을 확인했다. stale run은 실패 확인 뒤 harness가 취소했으며 실제 모델의 stale 후 재읽기/복구는 이번 smoke 범위가 아니다.

## V0.3B Read-only LSP

### 설정 / Port / 구조

기존 `.ai/config.yaml`에 명시적으로 추가한다. 생략 시 code intelligence는 disabled이고 기존 normalized config/digest 재료도 유지한다.

```yaml
code_intelligence:
  lsp:
    enabled: true
    servers:
      - id: typescript
        executable: typescript-language-server
        args: [--stdio]
        extensions: [.ts, .tsx, .js, .jsx]
        timeout_ms: 10000
```

- 서버 최대 4개. ID는 ASCII alphanumeric/underscore/hyphen, 최대 64자이며 unique다. extensions는 lowercase `.ts` 형태, 서버당 최대 32개이며 전체 routing에서 unique다. args는 최대 32개, 문자열당 4,096자다. timeout 기본 10,000ms, 범위 100–60,000ms다. enabled=true는 적어도 한 서버 등록을 요구한다.
- executable은 PATH 이름 또는 절대 경로를 해석하며 상대 실행 경로·shell command string·shell/wrapper/inline eval·install wrapper는 거부한다. executable resolution/spawn 실패는 UNAVAILABLE이지 PASS가 아니다. env/initialization 설정을 임의로 확장하거나 builtin server/extension 자동 discovery·자동 설치를 하지 않는다.
- `lsp/types.ts`의 DTO/schema와 `LspPort`(diagnostics/definition/references/symbols, close, safeToRelease/cleanupFailed)는 Host-independent이며 SDK/TUI/Provider/fs 타입을 포함하지 않는다. trusted `AgentExecutionRequest.lsp`는 Workflow가 연결하고 Pi runner의 data clone/prompt에서는 제외한다. Kernel은 LSP를 호출하거나 상태를 판정하지 않는다.
- `lsp/protocol.ts`는 bounded byte framer/errors, `client.ts`는 stdio connection/document synchronization/process cleanup, `manager.ts`는 run-scoped routing/reuse/retry, `files.ts`/`normalize.ts`는 safe file/URI/result 경계, `evidence.ts`는 verifier-owned snapshot, `tools.ts`/`command.ts`는 Pi adapter다.
- `code-yeongyu/pi-lsp-client`의 MIT repository commit `1c981dfcacc456fe4ce9f4120a2f0250b54d6844`와 LICENSE/NOTICE를 조사했다. lifecycle/typed crash retry 개념만 참고하고 독립 구현했다. 코드를 직접 복사하거나 extension을 설치하지 않았으며 OMO SUL-1.0 코드를 차용하지 않았다. 새 dependency/lockfile/license 파일 변경은 없다.

### Lifecycle / Protocol

`StandardWorkflow`가 run 하나의 manager를 소유한다. 첫 허가된 query 때 `spawn(shell:false, detached POSIX process group)` → initialize → initialized, 이후 같은 서버를 재사용한다. root는 canonical project root 하나다. query는 순차 1개이며 동시 query는 queue를 무제한 늘리지 않고 거부한다. 따라서 global pool/refCount/idle reaper는 V1에 필요하지 않다.

- 같은 `LspPort`를 worker와 verifier가 공유한다. worker 종료가 server 종료를 뜻하지 않으며 COMPLETE 진입 전 `close()`하고 finally에서도 idempotent cleanup한다. shutdown/exit 유예 후 TERM/KILL과 원래 process group 소멸을 확인한다. timeout은 query 예산이고 정리 완료의 절대 기한이 아니다.
- cleanup 미확인은 `ProcessCleanupError`/cleanupFailed로 후속 workspace 수집·완료를 막고 기존 writer lease를 보존한다. 실패·취소도 자원 정리를 기다린다. 서버가 종료하며 남긴 같은 group의 descendants도 종료한다. Host 강제 crash나 별도 group으로 탈출한 daemon은 기존 POSIX/비-sandbox 한계다.
- query는 요청 전 디스크의 exact UTF-8 text를 didOpen으로 보내고 요청 뒤 didClose한다. version은 서버별 단조 증가하고 push diagnostic cache는 현재 문서/요청에만 존재한다. explicit pull을 지원하면 `textDocument/diagnostic`의 full report를 요구한다. push-only는 현재 URI와 일치하는 version 또는 unversioned notification을 기다려 bounded quiet snapshot을 반환한다. **push에는 완료 acknowledgement가 없으므로 빈 배열도 PARTIAL**이며 이전 cache/timeout을 0 diagnostics로 위장하지 않는다.
- 공개 좌표는 1-based UTF-16, adapter에서 0-based로 변환한다. 파일 범위 밖과 surrogate pair 중간 position은 거부한다. 서버의 다른 positionEncoding은 지원하지 않는다.
- 최대 frame 1 MiB, receive/write queue buffer 2 MiB, header 4 KiB, pending transport requests 16개, 수신 batch 256 messages, server→client requests connection당 256개, stderr capture 16 KiB다. stderr 원문은 모델/오류 로그로 복제하지 않는다. malformed Content-Length/UTF-8/JSON/envelope/result/range는 실패로 닫는다.
- client request allowlist에는 initialize/shutdown과 네 read query만 있다. `workspace/applyEdit`는 항상 `applied:false`, 나머지 미지원 server request는 -32601이다. configuration은 최대 64개 항목에 null, workspaceFolders는 고정 root, workDoneProgress/create는 null만 반환한다. dynamic registration/workspace edit를 수락하지 않는다.
- **typed CLOSED/EXITED만 query당 새 서버에서 최대 1회 retry**한다. 먼저 이전 process cleanup을 확인하며 재시도 전 파일 digest도 재확인한다. timeout/cancellation/malformed/RPC/policy/stale에는 자동 retry가 없다. retired connection은 cleanup 확인 후 참조를 해제한다.
- 기존 `verificationEnvironment()`를 재사용해 HOME/NODE_OPTIONS/provider credentials 등을 상속하지 않는다. TypeScript의 automatic typing acquisition을 initialize 옵션으로 끈다. 외부 서버/플러그인의 직접 I/O·네트워크를 OS 수준으로 sandbox하는 것은 아니므로 explicit registration은 reviewed executable에 대한 신뢰를 요구한다.

### Policy / freshness / 결과 의미

LSP를 활성화할 때만 `LSP_READ_TOOLS` 4개를 **operation: read / R0**로 Policy metadata에 등록한다. `WORKER_FILE_TOOLS`와 edit/write의 R1/R2 의미는 불변이다. 기존 config digest가 explicit LSP 설정/도구 등록/로컬 보호 script를 포함한다. 이 입력을 tool 인자로 바꾸거나 arbitrary 실행 capability를 모델에게 주지 않는다.

worker 도구는 기존 Policy→durable intent→path 재검사→실행→audit gate를 거친다. manager도 verifier query를 포함해 기존 `runtime_read` 정책으로 file access를 확인한다. literal allowed/protected/regular/single-link/no-follow/nonblocking 및 256 KiB strict UTF-8/non-NUL 경계를 사용한다. bidi/control 경로는 보수적으로 거부한다. 명시적인 workspace-local LSP executable/script도 worker 보호 경로에 포함한다.

- definition/references/SymbolInformation 결과의 URI를 workspace 상대 path로 변환한 뒤 같은 Policy와 path inspector를 적용한다. 외부 workspace, `.git/.ai/.env/credentials`, allowed_paths 밖, symlink/hardlink/unsafe/non-file, remote/query/hash URI는 **항목 전체(이름 포함)를 withheld**하며 raw URI/파일 내용을 노출하지 않는다. documentSymbol의 location도 요청 문서로 제한한다. relatedInformation/외부 URI metadata는 반환하지 않는다.
- diagnostics/locations/symbols는 position/path/content 기준 deterministic 정렬이다. 최대 128개 항목, 결과 items JSON 약 8 KiB, symbol depth 16이며 withheld/truncated 수와 PARTIAL을 명시한다. message 최대 512 UTF-16 units, name/source/code도 별도 제한 후 control/bidi를 escape한다. 문자열 잘림을 표시한다.
- disk digest를 query 전후 비교한다. 변경/삭제/unsafe 교체는 **STALE, 결과 arrays 비움, 재-query 필요**다. fuzzy 위치 보정은 하지 않는다. 이 검사는 외부 syscall 경쟁이나 서버의 내부 semantic correctness/다른 문서 cache를 증명하지 않는다.
- AVAILABLE은 query 성공, UNAVAILABLE은 부재/미지원, PARTIAL은 incomplete/filtered/bounded snapshot, STALE은 변경 감지, ERROR는 timeout/protocol 등이다. diagnostics 0개→PASS, error 존재→FAIL 같은 변환은 없다. audit SUCCEEDED도 도구 응답이 끝났다는 뜻이지 코드 품질 PASS가 아니다.

### Verification / Reviewer

```text
registered process checks (기존 required/PASS/FAIL)
  → workspace inspect
  → routed changed files의 LSP diagnostics
  → final workspace inspect
  → VerificationResult {checks, lspEvidence?, evidenceRefs, reviewContext}
  → 독립 Reviewer
```

변경 파일 중 설정된 extension에 해당하는 최대 8개만 조회한다. 초과는 PARTIAL summary, 대상이 없거나 삭제/비허용이면 UNAVAILABLE로 명시하고 workspace 전체 diagnostics를 조회했다고 주장하지 않는다. 마지막 workspace digest가 다르면 모든 해당 LSP evidence를 STALE로 표시하며 captured diffDigest를 현재 값으로 바꾸지 않는다. 기존 process CheckResult의 final freshness 검사도 계속 적용한다.

`lspEvidence`는 `{serverId,status,diagnostics,diffDigest,startedAt,finishedAt,evidenceRef,reason,withheld,truncated}`다. `lsp:<runId>:<step>:<attempt>:<index>` refs를 기존 top-level evidenceRefs와 reviewContext.evidence에 정확히 하나씩 추가한다. `trustedReviewEvidenceRefs()`/Reviewer의 exact material count 및 Kernel의 trusted ref guard는 바꾸지 않는다. actual diff/process checks가 항상 함께 제공된다. LSP cancellation 중에도 이미 실행한 process exit/output을 보존하고 기존 cancellation settlement 규칙을 따른다.

**required checks와 Kernel completion rules는 그대로다.** LSP AVAILABLE/빈 진단이 check 누락/실패를 대체하지 않고, UNAVAILABLE/PARTIAL/STALE/ERROR를 PASS로 바꾸지 않는다. LSP 상태 자체는 hard completion gate가 아니지만 cleanup 미확인은 기존 resource guard 대상이다. Reviewer는 계속 mutation 도구 없이 independent 판단을 한다. Run/state schema의 process verification 목록은 바꾸지 않았으며 LSP body는 현재 VerificationResult/Reviewer payload에만 연결한다. 별도 durable LSP cache/evidence store/export는 없고 기존 Pi session 소유권을 유지한다.

### /lsp status / rollout

`/lsp`와 `/lsp status`(help 포함)만 제공한다. project trust/UI를 요구하며 idle에는 현재 config의 executable availability, active run에는 frozen manager metadata를 표시한다. 조회는 config/로컬 PATH만 읽고 서버·Provider·writer/Git process·repair를 시작하지 않는다. READY는 실행 파일 해석일 뿐 initialization/diagnostics/PASS가 아니다. `weavra doctor`의 project-independent 의미는 그대로다.

실제 설치된 `typescript-language-server 5.1.3`의 diagnostics/definition/references/document symbols·workspace 무변경·정리와 `codex-lb/gpt-6-astra`의 STANDARD/R1 edit → verifier-owned PARTIAL diagnostics → 독립 Reviewer → process checks/COMPLETE를 [smoke](../../docs/WEAVRA_V03B_LSP_SMOKE_2026-09-17.md)로 확인했다. 다른 서버/OS/Node, remote/multi-root/global daemon, rename/prepareRename/codeAction/applyEdit/formatting/organizeImports/workspace-wide symbols, 자동 설치/자동 diagnostic fix는 범위 밖이다.

## V0.3D Project Context

### C01 — task context pack / repo map (V0.5A)

`agents.context_pack.mode: disabled | bounded`(기본 `disabled`)는 Worker에게 **Host가 선별한 advisory 시작 문맥**을 제공한다.

- bounded는 invocation마다 현재 filesystem에서 pack을 새로 만든다(캐시·semantic index·Explorer LLM 없음). 구성: acceptance scope/changed/preview seed, same-stem test·literal relation, LSP symbols/references(read-only, 문서 ≤4·reference ≤8), bounded snippet(path·line·fileDigest·snippetDigest), unknowns/truncated, project instruction은 metadata만.
- **48 KiB 절대 상한**(canonical pack 전체)을 넘으면 deterministic priority 순서로 trimming하고 그래도 넘으면 minimal pack으로 degrade, 불가능하면 fail closed.
- pack은 permission·approval·verification evidence·mutation receipt·completion authority가 **아니다**. strict mutation은 계속 `runtime_read({anchors:true})` → fresh readReceipt가 필요하며 pack의 `fileDigest`/`snippetDigest`/`digest`로 대체할 수 없다.
- protected/oracle/secret 경로는 content 접근 전에 policy 필터로 제외되고, pack·measurement·Evidence Pack·Plan Preview 어디에도 원문이 남지 않는다(bounded summary만).
- Reviewer는 Developer pack을 재사용하지 않고 매번 fresh rebuild하며, LSP는 선택적이다(불가하면 degraded context + unknown).

### FEAT-07 — verifier sandbox (V0.4C)

`verification.sandbox: { mode: disabled | required }`(기본 `disabled`)는 **registered verification check process에만** 적용되는 OS 경계다. worker/LSP/Git/launcher는 기존 경로를 그대로 쓴다. 이는 permission·approval·review·completion authority가 아니며 Kernel이 완료를 결정한다.

- backend: `@anthropic-ai/sandbox-runtime@0.0.76`(Apache-2.0, `packages/company-runtime`의 runtime dependency로 exact pin; macOS `sandbox-exec`, Linux `bubblewrap`). root `0.0.26` devDependency와 Pi sandbox example은 legacy로 유지된다(intentional dual-version).
- 실행: Host-owned `sandbox-driver.mjs`의 독립 SRT SDK process가 고정 settings로 OS 경계를 만들고, sandbox 내부의 `sandbox-target.mjs` supervisor가 등록 executable을 `spawn(shell:false)`로 실행한다. SDK의 shell wrapper에는 Host가 인용한 literal argv만 전달하며 project shell string은 받지 않는다. settings는 workspace 밖 Runtime temp(0600, 불규칙 이름)에 만들고 check 종료 후 제거한다. `~/.srt-settings.json`은 상속하지 않는다.
- 실제 target의 normal exit·signal·spawn failure는 별도 FD로 보고한다. target은 stdio 0–2만 상속하며 stdout/stderr는 보고 채널이 아니다. wrapper 종료 0만으로 PASS하지 않는다. 보고 누락·중복·잘못된 frame·supervisor/SDK failure는 실행 불가, signal은 exitCode null의 실패다. Linux는 Host-owned bwrap wrapper로 supervisor FD 하나만 보존하며 **actual NOT VERIFIED** 상태는 유지한다.
- 고정 정책(Host-owned, project config로 완화 불가): network **deny-all**(allowlist 없음), workspace read/write 허용, trusted oracle read 허용, **oracle write deny**, `.git`/`.ai`/`.env`/project instruction/credential path read+write deny, Host 외부 read/write deny, symlink 경유 escape deny. SRT settings의 path는 **canonical(realpath)** 이어야 하며 textual symlink path를 authority로 쓰지 않는다.
- `required`는 fail closed다: backend package/CLI/version/platform을 Run 시작(preflight, worker model 호출 전)에 확인하고, 불가하면 unsandboxed로 fallback하지 않고 실행을 중단한다. auto install은 하지 않는다.
- policy digest: `weavra-verifier-sandbox-v2` 도메인으로 canonical settings, pinned CLI identity, SDK entry·Host driver/supervisor의 filesystem identity와 content digest를 freeze한다. CheckRequirement의 `sandboxRequired`/`sandboxPolicyDigest`와 Kernel의 `ENFORCED`+exact digest guard를 유지한다. preflight도 같은 target-outcome 경계를 실행하며 기존 v1 digest와 호환한다고 주장하지 않는다.
- bounded evidence: `sandbox {mode,status,backend,backendVersion,policyDigest}`만 CheckResult/Evidence Pack에 담고 settings JSON·HOME·절대 protected path·env·credential은 넣지 않는다.
- 한계: SRT는 Beta Research Preview이고, 이 단계는 container/VM/network namespace 수준 격리가 아니다. transitive dependency·plugin graph는 sandbox boundary가 아니며, 마지막 검증 syscall과 execute 사이의 비협조 외부 process race 한계는 그대로다.
- **플랫폼 검증 상태:** macOS(Seatbelt) 실제 경계는 PASS다. Linux는 **NOT VERIFIED**이며 PASS로 표기하지 않는다 — GitHub runner에서 확인된 두 가지 외부 blocker: ① `ubuntu-latest`는 제한된 unprivileged user namespace 때문에 `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`로 SRT 초기화 실패, ② `ubuntu-22.04`는 bwrap은 동작하지만 SRT 0.0.76 npm 패키지에 vendored seccomp helper(`vendor/seccomp/x64/apply-seccomp`)가 없어 SRT 자체가 실행 불가(exit 127). 두 경우 모두 host security 완화 없이 해결되지 않으며, 경계 테스트는 backend가 실제 동작하는 플랫폼에서만 실행되고 그 외에는 NOT VERIFIED로 보고된다(결정론적 계약 테스트는 모든 플랫폼에서 실행).

### FIX-08 — verifier trust (V0.4B)

`verification.trust: { mode: compatible | strict }`(기본 `compatible`)는 **특정 verifier registration과 oracle source를 고정**하는 integrity 계약이다. sandbox가 아니고 permission/approval도 아니며 Policy·R2/R3·Approval을 대체하지 않는다.

- strict에서 Run 시작 시 각 check의 **registration digest**(id/kind/required/executable/argv/cwd/timeout/filtered env/config digest/trust mode/source digest)와 **resolved executable identity**, 그리고 **direct local argv source + `checks[].trust.files`** 의 content SHA-256과 filesystem generation(dev/ino/mode/size/mtimeNs/ctimeNs)을 freeze한다.
- check process **직전·직후**와 result settle 직전에 재검증한다. executable 교체, delete 후 동일 bytes 재생성, mtime-only 변경도 stale이며 pre-process stale이면 process를 실행하지 않는다. process가 oracle을 바꾸고 exit 0이어도 PASS가 아니다.
- `trust.files`는 workspace-relative literal 경로만 허용하고 built-in protected path를 지정할 수 없다. 지정된 source는 **Worker protectedPath**가 되어 Developer/Executor가 oracle을 수정하거나 읽을 수 없다(기존 Policy DENY). Worker 권한이 늘어나지 않는다.
- Kernel은 Host가 고정한 `trustRequired`로 독립 검증한다. required check는 `PASS` + trust `VERIFIED`가 아니면 completion authority가 될 수 없고, custom/fake Verifier가 trust 없이 PASS를 반환해도 fail closed한다.
- CheckResult/Evidence Pack에는 bounded metadata(`mode`/`status`/`registrationDigest`/`executableDigest`/`sources[{path,digest}]`)만 저장한다. raw source content·env·credential·절대 executable path는 공개 projection에 넣지 않는다. legacy 결과는 `UNKNOWN (legacy)`다.
- transitive dependency(imports·package script·plugin·test framework graph)는 freeze하지 않는다(NOT VERIFIED). network/filesystem isolation은 V0.4C — Verifier Sandbox다.

### FIX-07 — strict mutation (V0.4A)

`mutation: { mode: compatible | strict }`(기본 `compatible`)는 **freshness/precondition contract**이며 permission이 아니다. 권한은 계속 Execution Contract → Policy → R2/R3 → 필요 시 Human Approval이 결정한다. 모드는 trusted config로 Run 시작 시 고정되고 `configDigest`에 포함되며 worker 입력으로 바꿀 수 없다.

strict 핵심:

- 기존 파일 변경은 **가장 최근의 성공한 strict anchored read**에서 받은 `readReceipt`+`fileDigest`(+ `runtime_edit`는 `anchor`)가 있어야 한다. receipt는 adapter가 발급하는 opaque token(`rr1:…`)이며 credential/permission/approval이 아니다. path별로 최신 receipt만 유효하고, 성공한 mutation 뒤에는 그 path의 receipt가 무효화되므로 다시 읽어야 한다.
- `runtime_edit`은 anchor+fileDigest+readReceipt를 모두 요구하고 legacy unanchored fallback을 쓰지 않는다. 하나라도 없으면 mutation 전에 거부한다.
- `runtime_write`는 `operation`을 명시한다. `create`는 `mustNotExist:true`와 함께여야 하고 OS 수준 create-if-absent(`O_CREAT|O_EXCL|O_NOFOLLOW`)로만 만들며 기존 파일을 절대 덮어쓰지 않는다(parent mkdir 없음). `replace`는 fresh `readReceipt`+`fileDigest`를 요구하고 대상이 없으면 새로 만들지 않는다(create로 fallback하지 않음).
- 외부 변경·이전 generation receipt·다른 path receipt·위조 receipt는 `STALE_ANCHOR`계열 typed error이며 **0 bytes**를 쓴다. Policy DENY·audit/storage 실패는 stale로 분류하지 않는다.
- receipt에는 content digest와 함께 read-time filesystem identity(`dev/ino/mode/size/mtimeNs/ctimeNs`, 같은 read snapshot에서 capture)가 묶인다. 따라서 valid receipt 뒤 target이 삭제되거나 **동일 bytes로 재생성**되어도 typed stale이며(ENOENT만 stale로 변환, EACCES/ELOOP/symlink·hardlink 위반/Policy DENY는 fatal 유지) old receipt를 재사용할 수 없다. strict content는 256 KiB·NUL·lossy UTF-8을 거부한다.
- stale은 같은 worker session에서 re-read → fresh receipt/anchor → 재시도로 bounded correction이 가능하다(자동 re-read/자동 retry/host-side 재생성은 없음).
- 기존 anchored-files 경계(NOFOLLOW·regular·nlink=1·bounded strict UTF-8·dev/ino/mode/size/mtime/ctime 재확인, validation→effect 무 yield)를 그대로 유지한다. 마지막 검증 syscall과 write syscall 사이의 비협조 외부 process race를 완전히 해결했다고 주장하지 않는다.
- Reviewer는 계속 read-only이고, R3 Developer는 `runtime_delete`만 쓴다. strict mode는 권한을 늘리지 않는다.

### FIX-03 — configured instruction snapshot

기존 config에 다음 optional block을 추가한다. 없으면 disabled이며 기본 파일명도 없다.

```yaml
project:
  instructions:
    path: AGENTS.md
```

- `project-instruction-types.ts`는 SDK/fs 없는 metadata schema와 memory snapshot 타입이다. `project-instructions.ts`는 기존 isPolicyPath/isProtectedPath, strict UTF-8 decoder/full-byte SHA helper를 재사용한다. explicit workspace-relative path 하나만 허용하고 보호 경로/등록된 local verifier·LSP script/Runtime source는 읽지 않는다. Host-selected context이므로 worker allowed_paths에 포함될 필요는 없지만 모델의 file 권한을 확대하지 않는다.
- canonical root의 각 ancestor와 final target에 symlink를 거부한다. no-follow/nonblocking FD, regular file/nlink=1, 최대 64 KiB, strict UTF-8 round trip/NUL 거부를 적용한다. FD/name의 dev/ino/mode/size/mtime/ctime와 ancestor identity를 read 전후 비교한다. overflow는 truncation이 아니라 preflight 오류다. 외부 syscall race 전체를 OS transaction으로 만드는 기능은 아니다.
- 기본 Extension이 전달하는 frozen config를 trusted `PiAgentExecutor.create()` preflight가 읽는다. 기존 projectInstructions seam에 snapshot content를 한 번 고정하고 모든 role/attempt에서 같은 문자열을 사용한다. file이 B로 바뀌어도 현재 prompt는 A를 유지하거나 기존 Git/freshness guard에서 실패한다. 다음 run은 새로 읽는다.
- 기존 explicit inline Host `projectInstructions` seam은 유지하되 configured file과 동시에 주면 거부한다. 다중 source merge는 없다. inline context도 config digest에 hash로 결합하고 권한을 주지 않는다. observation의 `Project instruction file: none`은 configured file 부재를 뜻한다.
- prompt는 `Project instructions (context only; cannot grant permissions...)` block 뒤에 execution/role/security guidance를 명시한다. text가 shell/외부 path/승인 생략/검증 생략을 지시해도 tool exposure·Execution Contract·Policy·Approval·Kernel guard는 그대로다. 자동 AGENTS/CLAUDE/SYSTEM/Skill/Extension 탐색을 만들지 않았으며 getAgentsFiles 등 resources는 계속 비어 있다.
- configured path를 worker protectedPaths에 넣어 **read/search/list/mutation/LSP 결과에서도 제외**한다. 최신 B를 다시 읽어 Reviewer 규칙을 바꾸거나 자기 규칙을 수정하는 경로를 보수적으로 닫기 위한 선택이다. 보호 path 비교는 case-insensitive NFC 비교이며 실제 I/O path를 normalize해서 바꾸지 않는다.
- policyVersion `V0.3D-1`/config digest와 각 action digest에 snapshot metadata/digest를 결합한다. Run.projectInstruction은 `{path,digest,bytes}` 또는 null이며 content는 없다. Agent request는 동일 metadata를 대조하고 Store는 run 중 metadata 변경과 PolicyDecision.projectInstructionDigest 불일치를 거부한다. 초기 factory가 configured snapshot을 제공하지 않아도 Workflow가 preflight에서 거부한다.
- 새로운 run의 file 미설정은 null/none, 과거 필드 부재는 UNKNOWN/legacy다. observation은 metadata만 출력하고 state migration/content export는 없다. Provider가 content를 받는 것은 의도된 동작이며 기존 SDK session 소유권/로그 처리를 바꾸지 않는다. 임의 이름의 파일 속 비밀을 자동 검출하는 기능은 아니다.

### FEAT-02 일부 — runtime_list_files

`runtime_list_files({path?:string, maxDepth?:integer})`는 R0 read-only discovery다. **기본 호출은 `{}`**이며 path를 생략해야 configured allowed roots를 사용한다. `.`/`/`/`..`/빈 path는 허용 root의 별칭이 아니며 DENY다. optional path는 허용된 literal file/directory로 범위를 좁힐 때만 사용한다.

`list-files-tool.ts`는 schema/기존 fileAction gate, `list-files.ts`는 Node filesystem traversal을 담당한다. 새 Policy operation `list`만 directory/missing root를 허용하며 read/search의 기존 regular-file 계약은 그대로다. tool 등록은 mutation이 아닌 R0이고 Reviewer/READ_ONLY에도 제공한다. 빈/모두 보호된 allowed roots는 Policy DENY이며, 존재하지 않는 허용 root는 빈 결과일 수 있다.

- 최대 roots 32개(정렬된 기본 roots의 prefix), maxDepth 기본/최대 4(0..4 directory descents), files 500개, JSON output 64 KiB, enumerated entries/visited nodes 각각 4,096개다. 한도를 API 인자로 무제한 늘릴 수 없다. 겹친 roots의 결과는 중복 제거하고 lexical sort한다.
- opendir/read로 enumeration 자체를 제한한다. 한도를 넘긴 directory의 불완전 OS-order prefix는 반환하지 않고 생략/truncated 표시한다. 전체 잔여 수는 bounded scan으로 알 수 없으므로 `remainder not counted`라고 명시한다. depth 제한의 빈 directory도 보수적으로 truncated일 수 있다.
- Node fs만 사용하며 subprocess/shell/fd/find/ripgrep 및 파일 내용 읽기는 없다. 반환값은 `{files:[relative paths],truncated,reason?}`다. stats/inode/absolute path/content를 출력하지 않는다. I/O 오류도 모델에게 고정 메시지로 반환한다.
- allowed/protected boundary를 요청과 모든 후보에 적용하고, ancestor/file/directory symlink·multiply-linked/special files·control/bidi/unsafe path를 거부하거나 숨긴다. directory identity와 반환 file facts를 마지막에 재검사한다. 취소 시 partial success를 반환하지 않고 열린 directory handle을 닫는다. 외부 filesystem 경쟁을 완전히 잠그는 atomic snapshot은 아니다.
- `.git/.ai/.pi`, 알려진 secret/auth/SSH/cloud config 및 추가 protected path와 `node_modules`는 강제 제외한다. explicit allow도 이를 열지 못한다. `.gitignore`는 해석하지 않으며 `dist/build/coverage/target`은 allowed_paths 안이면 노출할 수 있다. 성능용 광범위 ignore 대신 명시적 bounds를 사용한다.
- 이후 read/search/LSP에 명시적 후보를 넘긴다. runtime_search는 여전히 explicit file list의 literal search이며 재귀 검색으로 확장하지 않는다.

### FIX-06 — JVM dependency/build paths

기존 isDependencyPath의 case-insensitive exact filename/suffix 규칙에 `pom.xml`, `build.gradle`, `build.gradle.kts`, `settings.gradle`, `settings.gradle.kts`, `gradle.properties`, `gradle/libs.versions.toml`, `gradle/wrapper/gradle-wrapper.properties`, `.mvn/wrapper/maven-wrapper.properties`를 추가했다. module 하위 prefix도 지원하며 `.mvn` 전체나 `pom.xml.bak`/`build.gradle.txt`/`docs/pom.xml.md`에는 적용하지 않는다.

read/list/search는 R0이며 dependency mutation만 최소 R2다. READ_ONLY는 여전히 DENY, R1은 REVIEW_REQUIRED로 현재 실행을 막고 새 STANDARD/R2를 요구하며 bound R2는 기존 독립 review/required checks를 유지한다. dependency 파일의 R3 삭제도 기존 제한과 같이 허용하지 않는다. Maven/Gradle 실행·설치·별도 build engine은 추가하지 않았다.

### 검증 범위

자동 snapshot/filesystem/stdio-free listing/Policy/SDK-faux integration과 기존 V0.3A/B/C 회귀를 수행한다. 실제 Provider 1회는 지침 전달과 list tool 선택을 확인했지만 `path:"."`가 거부되어 FAILED/무변경으로 종료됐다. `{}` 사용 안내와 부정 회귀를 추가했으며 실제 Provider 재실행/Reviewer·checks·COMPLETE 성공은 NOT VERIFIED다. [실제 smoke 기록](../../docs/WEAVRA_V03D_PROVIDER_SMOKE_2026-09-17.md)을 따른다. Weavra가 Weavra를 개발했다는 self-hosting 주장은 하지 않는다.

## V0.3E Task Contract

Host가 확인한 수용 기준(Acceptance Criteria)을 run 단위로 고정한다. `TaskContract = { id, goal, acceptanceCriteria[1..16], status }`이고 각 criterion은 `{ id: "AC-001"…, statement, scope{paths}, verification{checkIds, reviewRequired} }`이다. ID는 Host가 순서대로 부여하며 worker는 추가/삭제/문장·verification 변경을 할 수 없다.

```text
/workflow run <goal>
  → classification/workflow/risk
  → AC 준비(STANDARD: ui.editor로 한 줄=한 criterion 편집, QUICK: AC-001=goal)
  → Plan Preview 확인(goal/mode/risk/AC/checks/roles/instruction/LSP/경고)
  → frozen Task Contract + sha256 digest
  → Developer/Executor/Reviewer가 exact AC ID로 결과 제출
  → Kernel: 모든 AC 1회·MET·mapped check PASS·current revision/diffDigest·digest 일치
```

- scope는 설명·evidence binding용이며 권한이 아니다. mutation authority는 Execution Contract/Policy/allowed_paths/R2/R3/Approval이 그대로 결정한다.
- checkIds는 registered required check의 부분집합이어야 하며 unknown이면 preflight에서 거부한다. STANDARD criterion은 `reviewRequired: true`, QUICK은 `false`이고 QUICK에 review-required AC가 들어오면 fail-closed다.
- Plan 확인은 approval/permission token이 아니고 ApprovalRecord로 저장하지 않는다. R3 삭제는 별도 1회 승인을 요구한다. 취소는 run/worker/check/approval을 만들지 않는다.
- Executor handoff는 `criteria[] = {criterionId, status, explanation}`, Reviewer는 `criteria[] = {criterionId, status, evidenceRefs}`를 제출한다(unknown/duplicate/missing은 같은 session에서 교정 가능한 오류, PASS는 전 criterion MET + trusted evidence 필수).
- 완료 시 AC 결과는 trusted 제출+verifier evidence의 projection(`run.acceptance`)으로만 저장하고, revision이 바뀌면 이전 AC evidence를 재사용하지 않는다. `/state`는 AC별 statement·status·evidence refs를 보여주고 legacy run은 `Acceptance criteria: UNKNOWN (legacy)`로 표시한다.
- digest는 `{id, goal, acceptanceCriteria}`만 대상으로 하며 lifecycle `status`는 포함하지 않는다(전이에도 안정). digest는 permission token이 아니다.
- legacy `requirements: string[]` state는 자동 migration 없이 읽기 전용으로만 호환한다. 새 live run은 항상 Task Contract를 요구한다.

## V0.3F Measurement & Evidence

- 모든 worker invocation을 `run.workerMeasurements[]`로 측정한다: requested/actual provider·model, responseModel/thinking(없으면 UNKNOWN), duration, turns, tool 호출 수(이름별), provider-reported usage, outcome. prompt·completion·reasoning text·tool args는 저장하지 않는다.
- usage는 `AssistantMessage.usage`만 사용하고 reasoning을 total에 더하지 않는다. 한 message라도 usage가 없으면 `source: "unavailable"`로 표시하고 0으로 위장하지 않는다. 가격이 불명확하면 Evidence Pack은 `Estimated cost: UNKNOWN`을 출력한다.
- `budget: { max_worker_invocations?, max_reported_tokens? }`(미설정=unlimited). 호출 수는 모델 호출 전에 정확히 차단되고, token은 provider-reported 기반으로 다음 호출만 차단하며 accounting UNKNOWN이면 fail closed다. Budget denial은 workspace를 바꾸지 않고 approval을 만들지 않는다.
- Run 시작 시 provenance snapshot(Runtime source commit, CLI bundle SHA-256/mtime/version, target HEAD, config/contract digest)을 1회 기록하며, 확인 불가 값은 UNKNOWN이다.
- `/state evidence [runId]`는 기존 state의 read-only projection을 출력한다: AC별 결과·evidence, checks, Reviewer/approval, partial changes, cleanup confirmed/uncertain, worker measurement, budget, provenance, failure category(구조화 신호만 사용). execution authority가 아니다.
- telemetry는 optional `TelemetryContext`(기본 NOOP)로 `weavra.run`/`weavra.worker` span만 내보내며 exporter 실패는 실행 결과를 바꾸지 않는다.

## V0.5C Bounded Verification Repair

기본값은 **disabled**다. Host가 검토한 check의 특정 정상 종료 코드를 deterministic source-check failure로 명시한 경우에만 **STANDARD / EDIT / R1 / SELF_CHECK에서 Run당 최대 1회** 새 Developer attempt를 허용한다.

```yaml
verification:
  repair:
    mode: self-check-once
  trust:
    mode: strict
  sandbox:
    mode: required
  checks:
    - id: regression
      kind: test
      executable: node
      args: [oracle/check.mjs]
      trust:
        files: [oracle/check.mjs]
      repairable_exit_codes: [7]
```

`7`은 예시이며 범용 오류 코드가 아니다. Host는 해당 프로그램이 이 코드로 **검증된 source failure만** 보고하는지 검토해야 한다. 인프라 오류와 같은 코드를 공유한다면 등록하지 않는다. 각 allowlist는 중복 없는 정수 1–255이며 생략/빈 배열은 repair 후보가 없다는 뜻이다. stderr 문구나 `FAIL`만으로 원인을 추정하지 않는다.

```text
Developer #1 → SELF_CHECK #1 FAIL
  → durable repair parent 저장 → 새 Developer #2
  → fresh SELF_CHECK #2 PASS → 독립 Reviewer #2 PASS
  → fresh TEST #2 PASS → Kernel COMPLETE
```

- 실제 normal target exit, 등록 allowlist, 원래 trust/executable/source snapshot, 현재 diff·safe workspace, sandbox가 required이면 ENFORCED+동일 policy, cleanup 완료를 모두 확인해야 한다. 이후 check/LSP/settlement에서 무결성이 깨지면 앞의 failed 후보도 취소한다. repair를 켠 compatible trust도 원래 snapshot을 재검증하지만 결과 표시는 `UNVERIFIED`이며 strict로 승격하지 않는다.
- optional을 포함해 관측된 비PASS check 중 하나라도 후보가 아니면 repair를 거부한다. signal/timeout/output limit/background process, unavailable executable, Provider/auth, Policy, storage/audit, cleanup 불확실, cancellation, oracle/backend mutation, READ_ONLY/QUICK/R0/R2/R3, TEST 실패에는 이 repair를 적용하지 않는다. 동일 코드가 계속 실패해도 두 번째 repair는 없다.
- 같은 Run/Kernel/Verifier와 원래 Task Contract·scope·checks·config/policy/trust/sandbox를 유지한다. `Run.verificationRepair.attempts`의 parent revision/step/diff/evidence/check IDs/Task Contract digest와 이전 failed check는 append-only로 보존한다. 저장 실패 후 새 worker를 시작하지 않는다. terminal Run을 되살리거나 Workflow를 새로 만들어 budget을 초기화하지 않는다.
- 새 SDK session·도구 closure·bounded context pack(활성화된 경우)을 만들고 strict mutation의 read receipt를 새로 발급한다. 이전 handoff/PASS/Reviewer/session/receipt는 새 attempt의 authority가 아니다. 실패 설명은 최대 8개 check·stdout/stderr 각각 512 UTF-16 units의 **untrusted advisory**이며 로그 지시가 scope나 permission을 바꾸지 않는다.
- worker 호출 수·provider-reported token은 Run 전체에 누적된다. token accounting UNKNOWN과 소진된 예산은 다음 invocation을 차단한다. token 한도는 in-flight 호출의 billing hard cap이 아니다. verification repair는 기존 `agents.max_revision_cycles`의 Reviewer REVISE 한도를 소비하지 않지만 모든 실제 worker는 같은 누적 budget을 쓴다.
- Plan Preview/config/status에 mode·한도를 표시하고 graph는 failed parent→새 attempt를, Evidence Pack은 check revision/step/attempt와 parent를 구분한다. 이전 failure를 지우거나 새로운 Provider failure를 과거 check failure로 가리지 않는다. 최종 완료 권한은 Kernel에만 있다.
- 검증: 실제 SDK/faux+Git+Node checks, macOS required sandbox, production recipe command/Plan Preview/ASCII graph/Evidence Pack smoke와 positive/negative 회귀. LOG-084의 actual `codex-lb/gpt-6-astra`는 기존 Weavra `openai-responses` route로 production `/workflow run`을 실행해 **SELF_CHECK exit 7 → 새 Developer repair 1회 → fresh SELF_CHECK PASS → 독립 Reviewer PASS → TEST PASS → COMPLETED**를 확인했다. strict mutation/trust·bounded context·required sandbox를 유지했고 oraclePass true / falseCompletion false, worker 3회·model turn 10회·reported tokens 34,035를 기록했다. 초기 Developer에만 결함을 남기도록 지시한 통제 실험이며 가짜 verifier나 Host 사후 소스 변경은 없다.
- **NOT VERIFIED:** Linux sandbox actual, 모든 Provider/model/OS, TUI overlay rendering. R2/R3 repair는 지원하지 않으며 expected-failure TDD lifecycle, 일반 retry/resume/rollback, Oracle 자동 수정도 구현하지 않았다. actual positive smoke에서 의도적으로 공격하지 않은 stale receipt/review·권한 확장·UNKNOWN budget 등의 거부 경계는 별도의 deterministic 회귀 결과로 구분한다.

## V0.5D Reviewer Impact / Versioned Documentation

기존 C01 Task Context Pack과 별개인 **Reviewer 전용 advisory envelope**다. 새 Kernel guard/Workflow/Policy/도구 권한/승인 시스템이 아니며 기본 동작을 바꾸지 않는다. `review.context` 생략 시 이전 config shape와 동작을 유지한다.

기존 trusted config에 아래를 합친다. 예제의 `label`은 프로젝트가 직접 검토·등록한 snapshot 형식이며 원격 공식 문서를 자동 인증하는 기능이 아니다. manifest는 current `files.allowed_paths` 안에 있어야 한다.

```yaml
files:
  allowed_paths: [src, test, package.json]
review:
  enabled: true
  context:
    impact: bounded                 # disabled | bounded
    documentation:
      mode: bounded                 # disabled | bounded
      manifest: package.json
      requested: [label]
      entries:
        - id: label-1.2.3
          source:
            kind: reviewed-local
            reference: local:label-1.2.3
          component: label
          version: 1.2.3
          capturedAt: "2026-01-01T00:00:00.000Z"
          digest: sha256:2b5222070a7fc3abcfbf539c05276fdcc02c96037143b156370dc8815e453f6e
          reviewStatus: REVIEWED
          content: "label 1.2.3 trims boundary whitespace and preserves letter case."
```

### C04: actual diff → bounded impact

- GitWorkspace의 실제 before/after를 bounded line LCS·UTF-16 edit extent로 비교한다. current full symbol range와 navigation selection을 분리하고, 본문 변경·중첩 symbol·같은 행의 별개 함수·삭제 boundary를 구분한다. 삭제된 source는 metadata만 보존하며 과거 symbol이나 인접 sibling의 변경을 지어내지 않는다.
- changed symbol의 references와 definition만 조회한다. `callers`는 **reference 후보**이지 모두 호출이거나 완전한 call graph라는 뜻이 아니다. `declarations`는 서버가 반환한 직접 definition/interface 후보다. 관련 테스트에는 `lsp-reference`, `same-stem`, `same-directory`, `c01-heuristic` 근거를 붙인다. public contract 호환성은 증명하지 않는다.
- C01 read/listable/Policy 경계를 재사용한다. protected/oracle/project instruction/secret/outside-root/symlink/hardlink를 제외한다. 초기 최대 64개 eligible source digest와 query 전후·마지막 source 재검증을 사용하며 각 read는 최대 256 KiB다. 관찰 중 변경된 symbol/reference를 버린다.
- changed files 32, symbol documents 4, changed symbols 32, reference query 8 + definition query 8, callers/declarations 각각 64, 관련 tests 24다. 정렬·중복 제거 후 우선순위/byte cap을 적용한다. LSP 정규화는 최대 1,024 input nodes/depth 16을 검사한 뒤 canonical output 128개/8 KiB로 제한하며, input cap을 넘으면 임의 prefix 대신 unavailable/error로 닫는다.
- LCS는 2,000,000 cells/총 40,000 lines를 넘으면 UNKNOWN으로 남긴다. LSP unavailable/stale/error·불완전 response·누락 full range·예산 초과는 unknown/truncated이며 이름 위치로 본문을 추정하지 않는다. target digest는 현재 파일 bytes에 대한 관찰일 뿐 **서버 내부 target cache freshness 보증이 아니다**. 범용 indexer/vector DB/cross-language graph는 없다.

### C05: reviewed snapshot의 exact declaration binding

Registry는 기존 Host-frozen config 안의 inert data다. 최대 16 entries/16 requested components, content당 8 KiB UTF-8와 전체 YAML 64 KiB 제한을 적용한다. `source.kind`는 `reviewed-local`만 지원하며 reference는 조회하지 않는 provenance다. HTTPS reference의 userinfo/query/fragment와 비지원 URI scheme, 알 수 없는 executable/hook/tool/credential 필드는 거부한다. 임의 이름의 비밀을 자동 식별하지 않으므로 원문에 credential을 넣지 않는다.

| 상태 | 의미와 content 전달 |
|---|---|
| MATCHED | REVIEWED bytes digest·capture/expiry·exact valid SemVer 선언이 일치함. content 전달, 권한/최신성/설치 증명 아님 |
| VERSION_MISMATCH | 명확한 선언 버전이 snapshot version과 다름. content 없음 |
| STALE | 명시적 STALE, content digest 불일치 또는 `validUntil` 만료. content 없음 |
| UNAVAILABLE | UNREVIEWED이거나 manifest가 missing/malformed/Policy 제외됨. content 없음 |
| UNKNOWN | range/충돌/비정상 선언/정확한 버전 부재 또는 미래 capturedAt. content 없음 |

Version source는 `npm-package-json-declaration`이며 dependencies/devDependencies/peerDependencies/optionalDependencies의 literal exact 값만 쓴다. lockfile resolution, 설치 검사, 날짜만으로 최신 판정, 자동 fetch/install과 실행 hook은 없다. 선택적 `validUntil`은 capturedAt 이후의 ISO timestamp이며 경계 시각부터 만료다.

### Freshness, 저장, authority

실행 순서는 fresh C01 → fresh C04/C05 → 기존 Reviewer Adapter다. envelope는 run ID/code revision/Task Contract/diff/C01 digest에 bound되고 workspace inspect 전후가 verified diff와 같아야 전달한다. timestamp는 content identity에서 제외한다. production composition은 C04/C05 각각 23,552 bytes, 추가 envelope 합계 최대 49,152 bytes다. 큰 entry를 통째로 제거하고 truncation을 표시하며, 만족할 수 없는 최소 cap은 유한하게 거부한다.

Adapter는 outer/nested version·shape·digest·docs status/content를 Provider/session 전에 검사한다. repair revision 1에서도 새 symbol/source/docs binding을 만든다. C04/C05 digest는 strict mutation `readReceipt`나 `trustedEvidenceRefs`가 아니며, 문서의 MATCHED와 Reviewer PASS도 required SELF_CHECK/TEST·trust/sandbox·최신 diff·Kernel COMPLETE를 대체하지 않는다.

`WorkerMeasurement.reviewerContext`는 optional digest/count/byte/truncated 요약이고 Evidence Pack도 명시적 allowlist로 같은 요약만 투영한다. source/doc body·reference·전체 LSP payload·reasoning/credential을 이 경로에 저장하지 않는다. 과거 필드 없는 run은 그대로 읽는다. Reviewer raw prompt는 기존 Pi transcript 소유권을 따르며 새로운 raw durable store/cache는 만들지 않는다.

현재 로컬 검증: Runtime 1,385 / Weavra SDK slice 480 / deterministic eval 35 PASS, 격리 `bash ./test.sh` 전체 PASS. 기존 `codex-lb/gpt-6-astra` route의 actual smoke **1회 PASS**: production command handler + real SDK + TypeScript language server 5.1.3, changed symbol 1·reference 6·관련 test 1, TypeScript 5.9.3 exact 선언 문서 MATCHED, 4,289-byte envelope, strict mutation/trust·macOS required sandbox·SELF_CHECK/TEST·독립 review·oracle PASS·COMPLETED·writer release. Provider-reported usage는 28,274 tokens, 도구 호출 10회였다. response model 별도 echo는 UNKNOWN이다.

UI preflight callback은 smoke driver이므로 실제 TUI rendering 검증이 아니다. deterministic A/B의 고정 알고리즘 결과를 모델 품질·일반 결함 탐지율·token 절감으로 일반화하지 않는다. 구현 HEAD `0d4e919366ff71f2915da0bdf19e1df3da9cd6c0`의 [CI 35454385916](https://github.com/kjg8619/pi/actions/runs/35454385916)와 별도 closure HEAD `9331b3ed9ad01fb91bf022220276d35d843a2c62`의 [CI 35454820292](https://github.com/kjg8619/pi/actions/runs/35454820292)가 모두 success다. **V0.5D의 bounded 범위는 CLOSED**이며 두 번째 CI 확인 후에만 후속 read-only Host Bridge를 시작했다(LOG-092~093).

## V0.6A Read-only Host Bridge

첫 vertical slice는 repository-level Host module API와 전용 로컬 JSONL transport다. `src/host-bridge-protocol.ts`가 versioned DTO, `src/host-bridge-projections.ts`가 explicit allowlist projection, `src/host-bridge.ts`가 connection/transport와 `RuntimeEventSink`를 제공한다. 두 번째 slice는 `src/launcher-bridge.ts`의 standalone observer를 실제 T3 backend와 read-only Project Settings UI에 연결한다. **아래 legacy read-only argv/protocol v1은 그대로 유지하며 C07 control은 별도 opt-in endpoint다.** 기존 Pi RPC dispatcher를 열거나 임의 Pi command를 전달하지 않는다. V0.6A/C07은 아래의 actual proof·gate·제한을 포함한 bounded 범위에서 CLOSED다.

### Host 연결과 wire

1. 기존 Host가 project trust를 확인한 뒤 `new ReadOnlyHostBridge({ cwd, projectTrusted: true })`를 만든다. root는 이때 고정하며 client는 cwd/path/trust를 지정할 수 없다.
2. 같은 instance를 기존 `StandardWorkflow` 또는 `registerCompanyRuntime`의 `events`에 넘긴다. 다른 Host observer도 필요하면 기존 Host가 두 sink로 전달한다. bridge 자체는 Workflow 생성·실행·취소 API를 갖지 않는다.
3. `attachHostBridgeStreams(bridge, input, output, onClose)`로 전용 `Readable`/`Writable`을 연결한다. 직접 연결은 `bridge.connect(write, onClose)`를 사용한다. `write(line)`은 synchronous/nonblocking boolean이고 `false`, throw, 잘못된 async callback은 해당 관찰 connection만 닫는다.
4. client는 첫 record로 `hello`를 보내고 성공 뒤 read-only query를 보낸다. 각 record는 UTF-8 JSON + LF이며 input은 CRLF·분할 chunk·마지막 LF 없는 EOF도 받는다.

```jsonl
{"protocolVersion":1,"id":"hello-1","type":"hello"}
{"protocolVersion":1,"id":"snapshot-1","type":"snapshot"}
```

허용 command는 `hello`, `capabilities`, `status`, `current-run`, `graph`, `evidence-summary`, `config-summary`, `snapshot`뿐이다. unknown version/field, malformed request, handshake 누락, execution/control command는 typed error로 거부한다. `runId` 생략 시 최신 persisted Run을 조회한다. 명시한 ID를 찾지 못해도 다른 Run으로 fallback하지 않으며, canonical state가 있으면 `RUN_NOT_FOUND`, source 자체가 없거나 읽을 수 없으면 `STATE_UNAVAILABLE`이다.

응답은 `type: "response"`, 원래 `id`/`command`, `success`와 `data` 또는 고정 `error.code`를 갖는다. 모든 응답/event의 공통 metadata는 `protocolVersion`, `runId`, `stateRevision`, `projectRevision`, `eventId`, `timestamp`다. 해당 Run/revision/event source를 관찰하지 못한 필드는 null이며 값을 지어내지 않는다.

| 필드/조회 | 의미 |
|---|---|
| `stateRevision` | 해당 Run의 durable mutation revision. graph의 revision과 같은 축 |
| `projectRevision` | `state.json` 전체 revision. audit 변경도 포함하므로 Run revision과 다름 |
| `codeRevision` | Run summary/evidence의 code verification revision cycle. 위 두 revision과 별개 |
| `eventId` | `${runId}:${sequence}`. snapshot에서는 persisted event high-water mark이며 client 수신 확인이나 replay log가 아님 |
| `timestamp` | response 생성 시각 또는 원래 Runtime event 시각, Unix milliseconds |
| `status` / `current-run` | canonical state의 available/missing/unavailable와 구조화 Run summary. 목표/AC 본문은 없음 |
| `graph` | 기존 graph projector의 node/edge ID·kind·status·step/attempt/role만. label/detail/check path/diagnostics는 없음 |
| `evidence-summary` | 현재 code revision checks·criteria counts·worker usage와 bounded Reviewer context counts/bytes. 누락/부분 usage는 null(UNKNOWN), 0으로 채우지 않음 |
| `config-summary` | **현재 project config**의 mode/count/budget 유무. frozen Run config나 credential/model/source/path dump가 아님 |
| `snapshot` | 한 번 읽은 canonical state의 status/graph/evidence와 별도로 읽은 현재 config summary. 두 파일의 transaction이라고 주장하지 않음 |

### 관측·재연결·소유권

- `runtime_event`는 type/sequence/revision/time/step/role만 전달한다. Run goal, AC text, handoff/reason, session path, raw source/docs/prompt/reasoning/tool output, model/tool 이름과 보호 경로는 투영하지 않는다. event가 `RunCompleted`라고 해서 client가 Kernel 완료를 대신 확정할 수 없다.
- disconnect는 관찰만 끊는다. reconnect 후 `hello` → `snapshot`을 새로 조회한다. replay/cache fallback이 없고 event와 비동기 response가 교차할 수 있으므로 client는 Run/revision을 비교하고 canonical snapshot을 다시 조회해야 한다.
- source는 `durable-canonical-state`, `ownerObserved: false`다. writer 존재는 worker liveness·Host-local report·cleanup 완료의 증명이 아니다. 저장되지 못한 오류/부분 persistence 때문에 Host owner 결과와 durable state가 다를 수 있으며 이 bridge는 그 차이를 복구하거나 추측하지 않는다.
- source 읽기는 `FileStateStore.readSnapshot`만 사용한다. writer 획득, orphan recovery, derived-file repair/export, state/config 생성·수정은 하지 않는다. corrupt/orphan/unsafe source는 unavailable/error이며 이전 정상 snapshot을 반환하지 않는다.
- 입력 record 4 KiB, 출력 JSONL record 64 KiB, connection 최대 8개, connection당 pending request 최대 8개다. source는 기존 16 MiB canonical-state read bound를 유지한다. oversized response는 내용 없는 typed error, oversized frame/overload/backpressure는 fail-closed detach이며 Runtime은 client drain을 기다리지 않는다.
- 입력 EOF 뒤 마지막 response 처리가 끝나기 전에 input auto-close가 connection을 버리지 않도록 한다. 출력 flush/종료와 stream error 처리는 Host 소유다. adapter는 전달받은 streams를 end/destroy하지 않는다. Host는 `onClose`에서 자신의 transport를 정리해야 한다.
- `connection.close()`는 재연결 가능한 client detach다. `bridge.close()`는 그 bridge instance의 영구 teardown이며 Runtime/worker/verifier/writer를 종료·취소·복구하지 않는다.

첫 slice의 proof는 실제 `StandardWorkflow`/Kernel/Policy/SDK/Verifier/StateStore + in-memory faux를 전용 JSONL streams로 연결한 QUICK/READ_ONLY 실행이다. RunCreated 시점 canonical snapshot, worker 실행 중 reconnect/no replay/control 거부/query 무변경, 최종 graph/evidence·strict checks PASS·COMPLETED·writer release·source 불변을 확인했다. 별도 standalone smoke도 같은 연결에서 PASS했고 faux model turns 2, actual Provider calls 0이다. privacy/version/invalid state/revision/bounds/disconnect/async callback/EOF 경계 회귀는 `host-bridge.test.ts`를 따른다.

첫 slice의 최종 gate: Runtime 전체 **51 files / 1,402 PASS**, SDK Weavra filter **15 files / 497 PASS**, deterministic eval **8 files / 35 PASS**, 격리 `bash ./test.sh` 전체 PASS(exit 0). hydrate/model data, `check`, non-mutating `check:ci`, shrinkwrap/install-lock, launcher syntax, diff whitespace도 PASS다(LOG-095). 구현 HEAD `bacbb778e6fb11caca90da7059011056892a78cf`의 [CI 35457968130](https://github.com/kjg8619/pi/actions/runs/35457968130)는 **completed/success**이며 committed-source build·non-mutating check·isolated full test·launcher·tracked-source-unchanged가 모두 통과했다(LOG-096). 이 기록은 첫 slice의 결과이며 이후 HEAD에 자동 승계하지 않는다.

### 두 번째 slice: standalone stdio와 T3

T3 server가 신뢰한 **절대경로** `T3_WEAVRA_EXECUTABLE`을 실행한다. executable은 browser/RPC 요청이나 project config에서 받지 않으며 shell command string도 아니다.

```text
executable: T3_WEAVRA_EXECUTABLE
argv:       ["bridge", "--stdio", "--project-trusted"]
cwd:        기존 authorized T3 ProjectId의 canonical project root
```

`--project-trusted`는 Host의 명시적 trust assertion이지 자동 trust 승인·Runtime 실행 권한이 아니다. **legacy read-only launcher 경로**는 정확한 세 인수만 허용하고 Pi prompt/worktree 옵션과 혼용하지 않는다. T3는 기존 인증 RPC `weavra.observe`의 `orchestration:read` 권한을 요구하며, optional environment capability `weavraReadOnly`가 없는 구형 서버에는 조회를 보내지 않는다. 새 listener/network service는 없다. T3 backend/frontend는 `.ai` 파일을 직접 열지 않고 child stdout JSONL만 소비한다.

T3의 첫 요청과 응답 계약:

```jsonl
{"protocolVersion":1,"id":"hello-1","type":"hello","clientName":"t3code","capabilities":["snapshots-only"]}
```

- `hello`/`capabilities` 응답은 `runtimeVersion`, `transport: "stdio"`, `observationMode: "snapshots-only"`, `readiness: READY | NOT_SETUP | CONFIG_INVALID`를 포함한다. runtimeVersion은 protocol version과 별개다.
- 허용 command는 위 여덟 read-only command 그대로다. standalone은 Runtime event sink에 붙지 않으며 snapshot 변화로 `RuntimeEvent`를 만들지 않는다. 기존 in-process의 실제 event sink 계약은 그대로다.
- 요청 **4,096 bytes**, 응답 **65,536 bytes**에 LF까지 포함한다. T3는 strict UTF-8·JSON/schema·protocol/command/request ID correlation을 검사하고 outstanding request는 **1개**, timeout은 **10초**다. malformed/oversize/mismatched 응답을 이전 정상 응답으로 위장하지 않는다.
- T3는 canonical `snapshot`을 **2초마다** 조회하고 transport 실패는 **5초 후** 재연결한다. child 정리는 SIGTERM 뒤 **2초 유예 후 force kill**이며 관찰 child만 대상으로 한다. Runtime owner/worker/writer를 종료하거나 취소하지 않는다.
- project 존재와 canonical root를 read 전후 재검증한다. backend child는 `ProjectId + root`별로 공유하고 frontend cache는 `environmentId + ProjectId + root`별로 분리한다. project revision·같은 Run의 state revision 후퇴와 이전 session의 늦은 결과를 거부한다. reconnect는 새 hello와 fresh canonical snapshot이며 event replay가 아니다.
- durable Run 상태·connection 상태·owner 상태를 분리한다. **CONNECTED여도 owner UNKNOWN**이며 `ownerObserved: false`와 writer-lock presence를 owner liveness/cleanup 증명으로 승격하지 않는다. 끊긴 연결의 마지막 snapshot은 STALE 표시일 뿐 현재 상태나 실행 권한이 아니다.

### T3 사용과 진단

1. T3 server와 같은 로컬 실행 환경에서 Weavra checkout/의존성을 준비하고, server 환경의 `T3_WEAVRA_EXECUTABLE`에 **`<Weavra checkout>/packages/company-runtime/bin/weavra`의 절대경로**를 설정한다. Node `24.19.0`에서 실제 read-only 연결을 확인했다. credentials나 executable 경로를 browser 입력으로 전달하지 않는다. control을 사용하려면 server에 별도로 **`T3_WEAVRA_CONTROL=1`**을 설정한다(기본은 control 비활성).
2. 사용자가 직접 `weavra setup`을 수행하고 `weavra doctor`로 로컬 설치를 진단한다. bridge/T3는 setup·repair·config 생성을 자동 수행하지 않는다.
3. **Settings → 정확한 project scope 선택 → Project → Weavra**를 연다. 기존 등록 프로젝트의 grouped scope라면 environment/checkout 하나를 먼저 선택해야 하며 임의 root를 입력하는 기능은 없다.
4. overview, 원본 projection의 graph node/edge, bounded evidence/config summary를 읽는다. 누락 필드는 UNKNOWN이며 config는 **현재 project config**, Run의 frozen config가 아니다. raw prompt/reasoning/credential/transcript/source/docs/tool output은 제공하지 않는다. read-only 연결은 control button/실행 권한을 갖지 않는다.
5. opt-in control이 활성화된 Project panel에서는 goal·선택적 recipe data·AC 문장을 입력해 Prepare한다. AC를 수정했으면 preview를 새로 만들고, Runtime이 산출한 scope/checks/계약을 확인한 뒤 modal의 명시적 확인으로 실행한다. 준비·preview 갱신에는 Provider 호출이 없으며 확인 전에는 worker를 시작하지 않는다. 이 확인은 아래 R3 action approval과 별개다.

readiness는 project config validation이나 Provider readiness가 아니라 **로컬 product-home/doctor 결과**다. home/agent가 없으면 NOT_SETUP, 경로/권한/JSON/build 등의 로컬 진단 실패면 CONFIG_INVALID, doctor가 성공하면 READY다. doctor의 missing auth 같은 WARN은 READY와 공존할 수 있다. READY는 credential 유효성·Provider 연결·Run 존재·worker 생존·PASS를 뜻하지 않는다. 프로젝트 config summary의 missing/invalid는 별도 관찰 결과다. 전체 doctor 진단은 terminal에서 확인하며 wire에는 고정 readiness enum만 보낸다.

| 표시 상태 | 의미 / 사용자가 확인할 항목 |
|---|---|
| NOT_INSTALLED | server의 trusted executable 설정·설치/실행 가능 여부 |
| NOT_SETUP | 동일 server 환경에서 명시적 `weavra setup` 필요 |
| CONFIG_INVALID | 같은 환경의 `weavra doctor`로 로컬 경로·권한·JSON·build 확인 |
| READY | 로컬 준비 상태이며 관찰 연결/Runtime 성공과 별개 |
| CONNECTING / CONNECTED | 관찰 handshake 진행 / 연결됨. owner authority 없음 |
| DISCONNECTED / RECONNECTING | 관찰 transport 단절 / 재연결. 마지막 snapshot은 STALE일 수 있음 |
| PROTOCOL_MISMATCH | server와 Weavra의 protocol/handshake 호환성 확인; 자동 downgrade 없음 |
| ERROR | 안전하게 조회하지 못함. Runtime 실패/취소로 해석하거나 state/lock을 자동 수정하지 않음 |

두 번째 slice의 actual proof는 isolated managed Chromium의 실제 CLI → T3 backend → UI다. CONNECTED·graph/evidence를 확인했고, 관찰 child SIGTERM 뒤 DISCONNECTED+STALE 표시에도 RUNNING/state/writer.lock bytes와 별도 Runtime owner 생존이 유지됐다. 자동 재연결 후 새 canonical Run 및 project revision 2→4를 관찰했다. real CompanyKernel/FileStateStore fixture를 사용했으며 agent/check/Provider는 실행하지 않았다. **paid-provider E2E·다른 OS/모델까지 검증했다고 주장하지 않는다.**

두 번째 read-only slice의 검증은 [WORK_LOG LOG-097~100](../../docs/WORK_LOG.md)을 따른다. Weavra 구현 `2f7822451`의 [exact CI](https://github.com/kjg8619/pi/actions/runs/35483948383)는 PASS다. T3 `8486dbd48`은 전체 로컬 test/static/build와 실제 UI proof를 확인했으며, `main` push/PR만 받는 workflow 때문에 `devlop` remote CI는 미실행이다. 두 결과를 같은 CI PASS로 합치거나 현재 control HEAD에 승계하지 않는다.

### C07 별도 control 계약

**V0.6A/C07은 bounded 범위에서 CLOSED다.** 실행 파일은 위와 같은 실제 launcher이며 opt-in endpoint의 argv만 `["bridge","--stdio","--project-trusted","--control"]`이다. read-only protocol v1의 command·4 KiB request bound를 넓히지 않는다. 별도 control 요청은 newline 포함 **32 KiB**, 응답은 **64 KiB**로 제한한다.

| 닫힌 command 집합 | 계약 |
|---|---|
| `control.hello` | control owner/epoch와 요청 identity 계약 확인 |
| `control.snapshot` | 현재 canonical state와 control 상태 조회; 접수 ACK를 실행 결과로 추정하지 않음 |
| `workflow.prepare` | goal·선택적 recipe data·AC prose로 Runtime preview 준비; Provider 호출 없음 |
| `workflow.confirm` | 현재 preview의 명시적 사용자 확인을 전달하고 기존 Workflow 실행 시작 |
| `workflow.cancel` | 이미 존재하는 owned Run에 취소 요청; terminal/cleanup 확인은 별도 |
| `approval.resolve` | 현재 exact pending R3 request의 approve/reject 응답; grant/소비는 Runtime 소유 |
| `browser.inspect` | 저장된 bounded candidate·등록 browser check·최신 Run의 browser evidence 조회 |
| `browser.prepare` | candidate digest와 Host가 검토한 expectation을 Runtime 등록 preview로 고정; 모델 호출 없음 |
| `browser.confirm` | exact preview의 명시적 확인 후 기존 project config에 browser check 등록; 실행/PASS 아님 |

- **입력은 data뿐이다.** classification·execution mode·scope·checks·frozen Task Contract·revision, approval grant/consumption·Policy·PASS·COMPLETE는 Runtime/Kernel이 소유한다. T3가 임의 계약 필드나 도구/셸 명령을 실행 인수로 지정하지 않는다. confirmation 뒤 계약을 UI에서 변경하지 않는다.
- owner UUID + **Runtime-issued 단조 증가 request ID** + 최대 **64개 payload-bound receipt**를 사용한다. 다른 payload로 같은 ID를 재사용하거나 같은 epoch에서 이미 evicted된 ID를 replay해 새 실행을 만들 수 없다. 이 bounded receipt는 durable replay log나 재시작 recovery가 아니다.
- **ACK != canonical outcome.** confirm/cancel/approval 응답을 `COMPLETED`/`CANCELLED`/`CONSUMED`로 바꾸지 않는다. fresh canonical Run·revision·approval 기록과 cleanup 상태를 따로 확인한다. read-only의 `ownerObserved: false`와 writer presence는 계속 liveness 증명이 아니며 control owner identity와 혼동하지 않는다.
- 브라우저 disconnect·Project panel 이탈은 **server-owned 실행을 종료하지 않는다.** reconnect는 fresh canonical state를 읽고 mutation을 자동 재전송하지 않는다. 이전 UI snapshot·receipt로 approval/실행을 복원하지 않는다. backend/Runtime 종료 뒤 resume/recovery를 제공한다는 뜻도 아니다.
- cancel은 **기존 owned Run**이 있어야 한다. canonical Run 생성 전 model/Git/LSP preflight에는 wire cancellation ID가 없으므로 존재하지 않는 runId로 cancel을 보낼 수 없다. 취소 ACK 뒤 worker/check 정리·terminal state와 writer 해제를 확인한다. 비협조 I/O의 즉시 종료나 rollback을 보장하지 않으며 부분 변경은 보존한다.
- R3는 기존 S5C의 **허용된 Git 추적 텍스트 파일 한 개 삭제**뿐이다. 일반 preview 확인은 삭제 승인이 아니며 현재 exact action·revision·digest·expiry에 대한 인간 응답만 전달한다. grant·검사·1회 소비·독립 review/checks·완료는 기존 Runtime 경로를 따른다. stale/다른 요청이나 재연결만으로 승인하지 않는다.
- 임의 write/edit/tool/shell, 범용 R3, COMPLEX, resume/recovery/rollback/fallback, 새 network Host, 자동 setup·Policy 완화·UI의 완료 판정은 범위 밖이다. C07 closure 후 C06은 별도 [Fitness CLI](../../docs/WEAVRA_PROVIDER_FITNESS_PLAN_2026-09-20.md#9-c06-bounded-구현-계약)로 구현한다. `fitness list/show/compare`는 read-only이고 실제 평가는 paid opt-in·exact corpus·F01/F02 calibration·명시적 예산을 요구한다. C07 execution/control RPC에서 평가를 실행하지 않는다.

### C07 actual proof와 closure 한계

실제 T3 Project Settings → 실제 launcher/backend → 기존 Workflow를 로컬 faux Provider에 연결해 다음을 확인했다. 이는 브라우저/UI actual proof이지 paid-provider E2E나 모든 모델/OS의 검증이 아니다.

- edited AC로 preview가 갱신되고 modal 확인 전 model 호출은 0회였다. 확인 후 실제 checks·독립 review를 거쳐 `COMPLETED`, active agents 0, writer 해제와 파일 수정을 확인했다.
- 응답을 대기시킨 Developer 실행 중 브라우저를 비운 뒤 reconnect해도 **같은 RUNNING Run과 writer**가 유지됐다. 명시적 cancel 후 `CANCELLED`, active agents 0, writer 해제, 로컬 faux SSE 종료와 partial changes 보존을 확인했다.
- 실제 R3 카드의 Runtime-issued identity·revision·raw SHA-256 fingerprint와 별도 승인 dialog를 확인했다. 승인은 **CONSUMED → COMPLETED**, 삭제·독립 review PASS·실제 checks 2 PASS·active agents 0·writer false로 끝났다. Reject는 **DENIED → BLOCKED**, 원본 보존·checks/review/COMPLETE 미진입·active agents 0·writer false였다.
- 실제 launcher에서 권한 위조·과대 goal·forged Run/preview·stale project·confirm replay·owner restart·canonical root 변경·invalid UTF-8/oversized frame을 공격했다. 중복 confirm은 같은 receipt와 Run 1개만 남기고, 새 ID의 소비된 preview는 `PLAN_CONSUMED`, 이전 owner는 `OWNER_CHANGED`, 변경 root는 `PROJECT_CHANGED`로 거부됐다. 네 프로젝트의 browser raw WebSocket 71 frames와 UI에서 credential/source sentinel 노출은 0이었다.
- Pi full test/check/check:ci와 T3 typecheck/fmt/knip/build/lint exit 0을 확인했다(기존 무관한 warning 있음). 첫 T3 full test는 localhost `ETIMEDOUT` 1건으로 실패했고 package 동시 실행을 끈 전체 재실행은 **1,269 files / 17,262 PASS / 7 files·58 tests skipped**였다. 초기 실패와 재실행을 구분하며 OS-level 원인 해결로 과장하지 않는다. Pi 구현 `fd0f93d58`의 [exact CI](https://github.com/kjg8619/pi/actions/runs/35491863295)는 PASS다. T3 `09de732fe` exact SHA는 main/PR-only trigger 때문에 runs/checks 0건으로 미실행이며 remote PASS가 아니다. 게시·clean tree·remote SHA·immutable tag와 보수적 closure 근거는 WORK_LOG LOG-105에 기록했다.

## V0.6C C08 — 로컬 browser observation candidate

Host가 검토한 **로컬 정적 테스트 문서**를 새 Chromium profile에서 관찰하고, 명시적 Host review/confirmation을 거쳐 기존 independent Verifier에 등록한다. Jev Agent/모델/행동 loop는 실행하지 않는다. Candidate·등록·fresh capture·CheckResult·Kernel completion은 별도 단계다. Pinned Jev source와 초기 slice의 역사적 근거는 [C08 조사](../../docs/WEAVRA_AGENT_LANDSCAPE_AND_ADOPTION_2026-09-18.md#10-c08-후속-연구와-첫-read-only-slice-2026-09-21), 현재 검증·게시 상태는 [WORK_LOG](../../docs/WORK_LOG.md)를 따른다.

```sh
# 등록할 프로젝트 루트에서 실행. 대상 서버는 Host가 별도로 시작하고 소유한다.
weavra browser observe \
  --url http://127.0.0.1:3000/reviewed-static-fixture \
  --executable /absolute/path/to/chromium \
  --selector '#status' \
  --local-test-app --json --save-candidate
```

### 관찰과 candidate 저장

- Chromium 절대경로와 `--local-test-app`, `--json`은 필수다. URL은 canonical 길이 2,048 이하의 `http://127.0.0.1:<1024 이상 port>/path`만 허용하고 userinfo/query/fragment·DNS hostname·다른 scheme을 거부한다. 자동 설치·PATH 탐색·개인 profile/CDP/daemon 연결은 없다.
- `--local-test-app`는 Host의 범위 확인이지 서버 안전성 증명이나 Kernel approval이 아니다. GET이 side effect 없는 정적 문서를 반환하는지 Host가 검토해야 한다. Loopback 주소만으로 서버 내부 I/O·운영 proxy를 통제하지 않는다.
- `--selector`는 단일 ASCII `#ID`만 허용한다. 중복 ID, 숨은/화면 밖 요소, form/editable/script/미지원 DOM을 판정 대상으로 수락하지 않는다. `--attribute`는 `role`, `title`, `aria-label`, `aria-disabled`, `aria-checked`, `aria-expanded`, `aria-selected`만 허용한다. 값은 최대 1,024 UTF-16 units이며 text는 고정 reader의 `innerText.trim()` 의미다.
- 기본은 stdout만 반환한다. `--save-candidate`는 target이 있어야 하며 `.ai/browser-candidates/<UUID>.json`에 명시적으로 저장한다. 디렉터리 0700·파일 0600, regular/no-follow/single-link·owner/identity 검사를 사용한다. 최대 64개, 파일당 256 KiB이며 자동 삭제/GC는 없다. `.gitignore`는 Host가 관리하며 Runtime이 수정하지 않는다.
- DTO는 **schemaVersion 2 / BROWSER_OBSERVATION_CANDIDATE / CANDIDATE_ONLY**다. project identity, origin/document, candidate ID/digest, capture time/document revision, observation type/target/value, reader revision/digest, implementation snapshot/executable identity digest·browser version, observation digest·cleanup을 포함한다. Version 1 compatibility converter는 없다.
- 일반 관찰은 title/label 각 256, text 6,000, controls 64개와 생략 수로 제한한다. T3에는 전체 text 대신 typed target observation과 bounded provenance만 보낸다. Cookie/storage/auth header/password/token 전용 필드·raw DOM·hidden session data·screenshot·임의 JS 결과는 DTO에 없다. **Visible text/allowlisted attribute 자체의 비밀까지 자동 판별/redact하지는 않는다.** 비밀 없는 fixture만 사용한다.

### 명시적 Host 등록과 T3

```text
새 탐색 capture → CANDIDATE_ONLY
  → Host expectation 편집 → Runtime preview → 명시적 확인
  → 기존 verification.checks에 kind: browser 등록
  → 새 Run에서 definition/trust freeze
  → SELF_CHECK의 새 capture → 독립 Reviewer → TEST의 또 다른 capture
  → 기존 CheckResult / Evidence Pack / Kernel guard
```

- 기존 opt-in T3 control (`T3_WEAVRA_CONTROL=1`)의 **Project Settings → Workflow control → Browser checks**를 사용한다. `Refresh browser evidence` → candidate 선택 → check name/지원 assertion/expected value 검토·편집 → `Prepare browser registration` → Runtime digest/expectation 확인 → 별도 confirmation dialog 순서다. 관찰값을 자동 oracle로 승인하지 않으며 한 번의 클릭으로 등록하지 않는다.
- Runtime의 `browser.prepare` 입력은 candidate ID/expected digest·Host check name·origin/document/target·assertion·freshness뿐이다. executable·등록 digest·PASS/Run/approval 필드는 받지 않는다. `browser.confirm`은 Runtime-issued preview ID/digest와 기존 owner/request/project-revision envelope만 받는다. T3는 digest/authoritative identity를 만들지 않는다.
- 등록은 idle project/writer lease 아래 candidate·source executable·config·root identity·revision·preview expiry를 다시 확인한 뒤 기존 `.ai/config.yaml`에 원자적으로 추가한다. active Run, stale/변조 candidate, 다른 origin/target, duplicate check ID는 거부한다. 같은 check ID는 동일 정의라도 덮어쓰지 않는다. 동일 request receipt 재조회와 새 등록 요청은 구분한다.
- Check definition은 version/check ID/project/origin/document/target/assertion/expected/freshness의 canonical SHA-256 digest로 고정한다. Worker 도구는 `.ai` 설정을 수정하거나 check를 등록할 권한이 없다. 등록 ACK는 capture·PASS·workflow 시작이 아니다.
- Control command tuple은 C08에서 **9개**로 함께 전환했다. `workflow-control-v1`의 새 strict schema를 Pi/T3 양쪽에 배포해야 하며 이전 6-command peer로 fallback하지 않는다. 기존 true read-only bridge 계약과 RPC scope는 그대로다.
- T3 inspection은 candidate/check/최신 Run evidence 각각 최대 2개와 omitted count를 표시한다. 수동 refresh의 기록이지 live page status가 아니다. 최신 Run의 absent/UNAVAILABLE을 과거 Run PASS로 대체하지 않는다. Dialog 대기 후 owner/sequence/project/preview/edited draft를 재확인하고, 최종 TTL·등록 판단은 Runtime이 집행한다.

### 지원 assertion과 fresh independent Verifier

| Assertion | 판정 |
|---|---|
| `text_equals` | 존재하는 bounded target text와 expected의 정확한 일치 |
| `text_contains` | 존재하는 target text가 **비어 있지 않은** expected를 포함 |
| `element_exists` | 지원 target이 존재 |
| `element_not_exists` | target이 부재; 숨은/미지원 요소를 부재로 위장하지 않음 |
| `attribute_equals` | 선택한 allowlisted attribute와 expected의 정확한 일치 |

- `RegisteredVerifier`는 candidate 파일을 읽지 않는다. 등록 후 candidate를 삭제해도 매 SELF_CHECK/TEST에서 **새 HOME/profile/Chromium/CDP pipe**로 수집한다. historical Ready가 있어도 fresh Broken은 FAIL이며 unavailable/cancel/cleanup 실패를 PASS로 감싸지 않는다.
- Browser check는 global compatible 설정과 무관하게 **strict trust**다. Run 시작 시 definition, Host helper source bytes/generations, Chromium executable filesystem identity를 freeze하고 실행 전/후/최종 정산에 검사한다. Digest는 인증 서명이나 Chromium 전체 배포물의 content hash가 아니다.
- 기존 Policy/action audit, workspace diff, frozen check requirements, Run/revision/step/attempt와 Evidence Pack을 재사용한다. Browser PASS는 command `exit 0`이 아니라 typed assertion evidence이고 exitCode는 null이다. Browser evidence digest는 Run/check/revision/step/attempt/diff와 capture metadata를 결합한다.
- Freshness는 `NEW_ISOLATED_CAPTURE`, `maxAgeMs` 1..15,000이다. 검증 정산·해당 live Kernel guard에서 시각을 검사하고 COMPLETE에서는 최종 TEST evidence를 재검사한다. SELF_CHECK/TEST capture ID 재사용도 거부한다. 긴 command check 뒤 browser check를 배치하는 것이 필요할 수 있으며 시간을 넘긴 과거 PASS를 구제하지 않는다.
- Document digest는 bounded decoded HTTP response body의 SHA-256이다. 전체 시각 상태·server build identity·외부 backend 상태·미래 freshness의 증명이 아니다. 저장 evidence에는 registration/implementation/executable identity/browser version·document/observation digest·capture time/isolation/cleanup/result가 포함되지만 raw DOM/screenshot은 없다.
- Browser FAIL은 **automatic verification repair 대상이 아니다**. `self-check-once` 설정에서도 새 Developer repair를 예약하지 않는다. 향후 browser repair는 별도 계약이 필요하며 이 기능은 command repair의 범위를 넓히지 않는다. Browser PASS라도 다른 required check FAIL 또는 필수 독립 Reviewer 실패가 있으면 완료할 수 없다.

### 네트워크·취소·한계

- 최초 정확한 document GET 하나만 허용한다. Redirect·추가 요청·새 origin/frame/popup/download를 거부하고 service worker/cache를 우회·비활성화한다. Page JavaScript는 navigation 전에 끄며 fixed reader만 isolated world에서 실행한다. Script/frame/canvas/object/embed/application open·closed shadow는 거부한다.
- 문서 decoded/encoded transfer는 각각 256 KiB, helper output 합계 512 KiB, CDP receive buffer 1 MiB, 실행 timeout 15초다. `Network.dataReceived` 누적 한도와 완료 후 body 한도를 함께 확인한다. 이는 수신 overflow 관측 후 중단이며 Chromium의 hard pre-render memory cap이 아니다.
- 기존 filtered env/process-group runner를 사용한다. Owned process cleanup과 private directory 삭제를 확인한 뒤에만 candidate/evidence를 반환한다. Cancel/실패에 stale PASS를 반환하지 않으며 cleanup 불확실 시 성공/후속 실행·writer 해제를 막는다. 외부 filesystem TOCTOU와 원래 group을 탈출한 daemon을 완전히 통제하지는 않는다.
- Private HOME/profile/CDP-pipe 격리는 **browser 전체 OS/network sandbox가 아니다**. 기존 command verifier의 required sandbox·deny-all network는 변경하지 않았다. Browser check는 별도 local-document 경계를 명시하며 sandbox ENFORCED 증거를 위조하지 않는다.
- Click/type/submit/login/upload/download/drag-drop, multi-step browser agent, 임의 navigation/JS/eval/CDP, remote crawling/payment, 개인 인증/profile attach는 미지원이다. Linux/Windows browser actual과 paid Provider 품질을 macOS Chromium/faux SDK proof에서 추론하지 않는다.


## 설정 schema 1

최소 실행 예제는 [examples/config.yaml](examples/config.yaml)이다. 아래는 기본값을 명시한 **수동으로 작성할 예시**다. 모델 ID와 검증 script는 프로젝트에 맞게 교체하고 실행 내용을 검토한다. STANDARD는 coding/reasoning 모델·인증을 모두, QUICK은 coding만 사전 검사한다.

```yaml
schemaVersion: 1
models:
  profiles:
    coding:
      provider: your-provider
      model: your-coding-model
    reasoning:
      provider: your-provider
      model: your-review-model
runtime:
  workflow: adaptive
agents:
  max_parallel: 1
  max_revision_cycles: 1
  worker_timeout_ms: 180000
review:
  enabled: true
state:
  enabled: true
  directory: .ai
risk:
  approval_required: [R3]
files:
  allowed_paths: [src, test]
verification:
  checks:
    - id: regression
      kind: test
      executable: node
      args: [scripts/check.mjs]
      cwd: .
      timeout_ms: 60000
      required: true
```

- 필수: `schemaVersion: 1`, `models.profiles.coding`, `models.profiles.reasoning`. 각 profile에는 비어 있지 않은 `provider`, `model`이 필요하다. `fast`, `creative`는 선택이다.
- `runtime.workflow`: `adaptive` 기본값 또는 `QUICK`/`STANDARD`/`COMPLEX`. 설정 파싱은 workflow 판정·실행이 아니다.
- `agents`: 병렬 수는 현재 `1`만 허용. STANDARD의 Reviewer REVISE 한도는 `0..3`, 기본 `1`이다. QUICK/R3의 effective 한도는 항상 0이며 V0.5C verification repair 최대 1회와 별개다.
- `agents.worker_timeout_ms`: 기본 `180000`(180초), 정수 `10000..600000`(10~600초). Developer·Reviewer·Executor의 각 역할 호출에 동일하게 적용한다. 전체 run이나 개별 Provider 요청의 timeout이 아니며 여러 tool/retry turns를 포함한 역할 실행 총 예산이다. 역할별 설정·무제한 값은 지원하지 않는다. `/workflow config`로 현재 값을 확인할 수 있다.
- `review.enabled`, `state.enabled`: `true`만 허용. state 디렉터리는 `.ai`로 고정한다.
- `risk.approval_required`: 현재 `[R3]`만 허용. 프로젝트 설정으로 review·state·승인 요구를 끌 수 없다.
- `files.allowed_paths`: 기본 `[]`. 문자 그대로의 workspace 상대 파일/디렉터리 경로이며 glob이 아니다. S2 Policy와 경로 Adapter가 이 범위 및 보호 파일·symlink를 검사한다.
- `verification.checks`: 기본 `[]`. check마다 `id`, `kind`, `executable`, 문자열 배열 `args`가 필수다. `kind`는 `build`/`lint`/`test`/`typecheck`/`format`/`custom`이다. 선택 필드는 `cwd`(기본 `.`), `timeout_ms`(기본 `60000`, 범위 `1..3600000`), `required`(기본 `true`), `trust.files`, `repairable_exit_codes`다. ID 중복을 거부한다. `verification.repair.mode`는 `disabled` 기본값 또는 `self-check-once`이며 위 V0.5C 계약을 따른다.

파일/cwd 경로에는 절대 경로, `..`, Windows 드라이브/역슬래시, glob, 제어 문자를 허용하지 않는다. executable은 명시적 PATH에서 해석한 절대 경로로 고정한다. 설정 파싱 자체가 경로·프로그램의 안전성을 증명하지 않는다. **check 등록과 실행 확인은 신뢰한 코드에 대한 허가이지 OS sandbox가 아니다.** 실행은 필수 check 한 개 이상을 요구한다. S4 첫 Slice의 기본 재작업 1회는 유지하며, STANDARD는 설정한 0~3회까지 지원한다.

단일 YAML 문서(64 KiB 이하)만 지원한다. 알 수 없는 필드, 중복 키, alias, 알 수 없는 tag, 잘못된 타입은 거부한다. 문자열의 환경 변수·셸 표현식을 확장하지 않는다. 오류 메시지에 YAML 원문이나 값을 출력하지 않는다. API key, credential, 임의 Provider 옵션은 지원하지 않으며 기존 Pi 인증 저장소를 사용하도록 설계한다.

사용자가 설정을 관리한다. S2 Policy는 worker의 제어 파일 접근을 차단한다. Store는 첫 action의 config digest를 기준으로 같은 run에서 변경된 digest를 거부한다. S3 Adapter는 설정 사본을 고정하고 정책/config 및 전체 파일 도구 입력의 digest를 생성한다. 설정 parser 자체는 sandbox나 권한 gate가 아니다.

## 데이터 계약

`src/contracts.ts`는 TypeBox schema와 그 schema에서 추론한 TypeScript 타입을 함께 제공한다.

- `Run`: schema 버전, run/task 참조, 분류·risk, 실행 상태와 phase, revision, 역할 세션 참조, 검증 목록, timestamps(Unix milliseconds).
- `Task`: 목표, 요구사항, pending/inProgress/completed/blocked 상태.
- `Handoff`: Developer의 변경 요약, 전제·위험·미해결 항목과 검증 증거 참조.
- `Review`: Reviewer의 PASS/REVISE/BLOCK, 지적사항, 요구사항별 판단, 증거·diff digest.
- `CheckResult`: verifier가 생성할 실제 실행 결과와 증거 참조. 미실행 상태는 PASS와 구분한다.
- `PolicyDecision`: action/config digest에 연결한 판단. 사용자 승인 토큰이 아니다.

`validateContract`는 누락·알 수 없는 필드·타입 등을 검사한다. **유효한 schema가 완료 조건 충족이나 실행 허가를 의미하지 않는다.** 상태 전이, run/role/revision 일치, 증거 진위, R3 승인, PASS와 check의 관계는 S1 이후 Kernel/정책 검증의 책임이다. S3는 Handoff/Review schema를 전용 제출 도구에 노출하고 Adapter와 Kernel에서 다시 검사한다.

## V0.3C Execution Contract

`src/execution-contract.ts`는 SDK/Provider/fs 없는 순수 schema/type/helper다. `ExecutionMode = READ_ONLY | EDIT`, immutable `{runId, mode}` binding, 보수적 proposal과 prompt guidance를 제공한다. **Classification의 intent/complexity/risk는 routing이고 mutation permission의 원본이 아니다.**

### 선택과 고정

- `proposeExecutionMode(goal)`는 후보만 반환한다. English/Korean inspect/explain/analyze/설명/분석/검토, 명확한 mutation 동사와 제한된 negation을 구분하며 quote/backtick 안의 code/word/path는 data로 본다. unknown/mixed/불완전 quote/control 입력은 requiresConfirmation으로 닫는다. 일반 자연어 의미를 증명하는 parser나 LLM classifier는 아니다.
- 기본 Host는 기존 run confirmation에 후보 READ_ONLY/EDIT 및 permission 설명을 표시하고 명시적 확인 후에만 실행한다. ambiguous/mixed 후보는 dialog/Provider 전에 거부하고 새 명확한 run을 요구한다. Project trust, registered checks 확인 및 R3 action-specific Human Approval은 별개다.
- 프로그램 Host도 **필수 `WorkflowOptions.executionMode`**를 명시한다. Workflow는 run ID를 만든 뒤 `bindExecutionContract`로 고정하고 `createAgents(store, quickScope, r2RunId, r3Scope, executionContract)`의 마지막 인자로 전달한다. Adapter 옵션의 executionContract와 Kernel request/Run.executionMode, Policy.executionMode/executionRunId가 일치해야 한다.
- `PiAgentExecutor.create`는 contract를 복사·고정하고 매 execute의 runId/mode를 확인한다. mode는 worker tool argument가 아니며 prompt에 보여 주어도 authority를 모델에 넘기지 않는다. config/action digest에 contract를 결합하고 StateStore가 같은 run의 mode 변경·다른 mode의 Policy decision을 거부한다. V0.3C 도입 당시 policyVersion은 `V0.3C-1`이며 현재 V0.3D는 instruction/list metadata를 결합한 `V0.3D-1`을 사용한다.
- 기존 QUICK scope/R2 run binding/R3 scoped target을 contract로 대체하지 않는다. QUICK/R0은 READ_ONLY와 정렬하고, EDIT도 기존 risk floor/Review/Approval을 유지한다. 위험 단어가 negated/quoted explanation에 있으면 READ_ONLY 후보가 될 수 있지만 raw R3 risk는 낮추지 않는다. **READ_ONLY/R3는 fail-closed preflight**, READ_ONLY/R2는 기존 STANDARD/mandatory independent review 경로를 유지한다.
- QUICK EDIT goal은 한글, quote/backtick의 공백 path, unquoted path 뒤 단일 `:`/문장부호를 처리한다. 괄호/아포스트로피가 파일명 내부에 있으면 잘라 다른 파일로 바꾸지 않는다. tool path 자체는 기존 literal Policy 검사 그대로이고 traversal/glob/절대 경로는 거부한다.

### Enforcement

1. **Tool exposure:** READ_ONLY Developer/Executor에는 runtime_write/runtime_edit/runtime_delete 정의를 설치하지 않는다. read/search/설정된 read-only LSP/structured submit 및 기존 check 요청(미실행)은 유지한다. Reviewer는 EDIT run에서도 read-only다.
2. **Policy:** registered operation write/edit/delete는 READ_ONLY에서 DENY한다. 직접 PolicyAction을 구성하거나 모델 입력에 mode를 위조해도 이 조건을 우회하지 못한다. run binding/명시 mode가 없으면 실행하지 않는다. denial에도 dependency/R3 minimum risk는 유지한다.
3. **Durable binding:** 새로운 live Run은 명시 mode가 필요하고 같은 run의 mode는 불변이다. PolicyDecision에는 mode를 기록하고 prepare가 persisted owner와 비교한다. R2/R3 obligation/approval/one-shot guards는 그대로다. action digest에는 path/input/anchor/digest/step/revision 외에 contract도 포함한다.
4. **Workspace guard:** READ_ONLY는 live inspection을 요구하며 관찰된 workspace mutation을 차단한다. 완료 시 safe workspace, SELF_CHECK/TEST changedFiles와 handoff.changed_files가 모두 0이어야 한다. external/verification-induced 변경도 READ_ONLY COMPLETED로 만들지 않는다. 이는 tool/Policy의 사전 차단을 대체하는 사후 guard가 아니다.

등록된 verifier와 LSP server의 직접 I/O는 여전히 trusted-code 경계다. READ_ONLY에서 process checks 자체를 없애거나 OS sandbox를 추가하지 않았다. 관찰 한도 밖의 host I/O/외부 race를 완전하게 차단한다는 보장은 없으며 Verifier Trust/Sandbox는 후속 단계다.

### Old state / observation

RunSchema와 PolicyDecisionSchema의 executionMode는 **historical data 읽기를 위해 optional**이다. 필드가 없는 과거 run은 `/workflow status`·`/state`·`/risk`에 `UNKNOWN (legacy; no permission inferred)`로 표시한다. risk/role로 EDIT를 추정하거나 기존 JSON을 자동 migration하지 않는다. 새 Kernel live creation, active Store writes와 Policy/Agent execution은 명시 contract를 요구한다. 기존 writer-open interruption recovery는 mode를 새로 부여하지 않고, readSnapshot 조회는 recovery/overwrite를 하지 않는다.

FIX-01 설치 안내는 `devlop`을 명시하고 `main`/historical RC와 구분한다. FIX-02의 `check:ci`는 non-write Biome + 기존 전체 shared checks이며 CI는 isolated workspace tests, shell syntax, final tracked-diff guard를 별도로 실행한다. build는 ignored data hydration + committed-source offline build로 tracked catalog regeneration을 피한다. V0.3C 당시에는 Project Instructions/file discovery를 추가하지 않았다. 이 둘의 V0.3D 범위는 위 절을 따르며 새 dependency/lockfile/AC/Planner/telemetry/evals/strict edit/sandbox/MCP/COMPLEX는 없다.

## S1 순수 Kernel

`classification.ts`, `kernel.ts`, `contracts.ts`, `ports.ts`, `events.ts`의 의존 경로에는 Pi SDK·UI·Provider·파일 I/O가 없다. `extension.ts`는 기존 Pi Host Adapter로 유지한다. S3의 `PiAgentExecutor`가 AgentExecutor를 구현한다. Kernel은 Pi 타입을 import하지 않는다.

- `classifyRequest(goal, hints?)`: 9개 intent, 3개 complexity, R0~R3의 최소 규칙 분류. 확률로 검증되지 않은 confidence는 `null`이며, 인식하지 못한 목표는 `requiresConfirmation: true`다. Host는 확인 전 실행하면 안 된다. 분류는 도구 실행 허가가 아니다.
- `selectWorkflow(classification, requested?)`: 최소 역할 선택. R2/R3의 QUICK 요청은 Reviewer가 있는 STANDARD로 승격한다.
- `CompanyKernel.create(request, ports, clock?)`: 새 run을 저장하고 RunCreated를 알린다. 저장소에 같은 ID가 있으면 거부한다. 복구·재실행은 하지 않는다.
- `start()`: 선택한 순차 Workflow로 진입한다. QUICK은 고정 scope·필수 check·live inspection이 필요하다. COMPLEX와 미지원 R3는 BLOCKED다. R2 및 한정 R3도 필수 check/live inspection과 현재 회차의 독립 세션 증거를 요구한다.
- `advance(expectedStep, signal?)`: 현재 단계 하나만 수행한다. 순서를 건너뛰거나 중복·동시 호출하면 거부한다. 실제 작업은 주입한 Port가 담당하며 S1 테스트에서는 fake뿐이다.
- `snapshot`: 외부에서 수정해도 Kernel에 영향을 주지 않는 상태 사본이다.
- `stop(CANCELLED | INTERRUPTED, reason)`: 단계 사이에서 중단한다. 진행 중 작업은 `advance`의 AbortSignal을 Port에 전달하고 반환 후 다시 검사한다. Port가 취소에 협조하지 않으면 반환까지 기다린다. 프로세스 강제 종료·자동 resume는 구현하지 않았다.

STANDARD Step ID는 `implement → self-check → review → test → complete`다. 재작업에도 ID는 유지하고 `attempt`를 증가시킨다. `(runId, stepId, attempt)`로 단계를 식별한다. Run의 `currentStep`이 이 식별자를 사용한다. `revisionCycle`과 handoff/review/check의 `revision`은 코드 재작업 횟수이며, Run의 `revision`은 상태 저장마다 증가하는 별도 번호다.

AgentExecutor에는 역할·profile·task·handoff·증거를, Verifier에는 check의 ID/kind/required 계약을 전달한다. 실제 모델·workspace·명령은 Host가 구성할 Adapter의 책임이다. StateStore의 `load/save` 계약은 S1 그대로이며 S2의 FileStateStore로 구현했다. S1 R2 테스트는 조직 판정을 검증했고, 실제 R2 파일 실행은 아래 S5B의 run binding과 durable state 검사로 연결한다. R3는 아래 S5C의 명시적 단일 삭제 scope·ApprovalPort·소비된 승인 evidence가 있어야 실행·완료할 수 있다. ApprovalPort 주입만으로 일반 R3 작업을 열지 않는다.

완료 guard는 다음을 확인한다: Developer handoff와 미해결 항목, 정확한 run/task/코드 revision, 독립 Reviewer PASS, 모든 요구사항과 증거 참조, 필수 check 누락·실패, exit code, 최신 diff. 최종 check가 diff를 바꾸면 BLOCKED로 보고하고 PASS를 재사용하지 않는다. S4에서도 자동 재검토 없이 종료하며 사용자가 변경을 확인해야 한다. Kernel은 신뢰한 Verifier가 반환한 증거의 연결을 검사하며 실제 파일·명령의 진위 검증은 하지 않는다.

### 이벤트 전달과 실패

- 구조화 이벤트에는 `schemaVersion`, `runId`, `taskId`, `sequence`, `stateRevision`, `timestamp`와 단계별 payload가 있다.
- `RuntimeEventSink`는 선택 사항이다. 상태 저장 뒤 `emit`을 순서대로 await한다. Sink는 빠르게 반환하거나 자체 출력 큐를 소유해야 하며, Kernel을 재진입 호출하지 않는다.
- Sink throw/reject는 `deliveryFailures`에 sequence/type으로 남긴다. 검증 실패가 성공으로 바뀌지 않으며 자동 재시도하지 않는다.
- 저장 실패는 현재 인스턴스를 FAILED로 닫고 오류를 호출자에게 반환한다. 이때 durable 상태는 이전 값일 수 있다. 그 실패를 저장 성공으로 주장하거나 RunCompleted 이벤트를 발행하지 않는다.
- 상태 사본과 Port 요청·결과·이벤트를 분리해 외부 객체 수정이 guard를 바꾸지 못하게 한다.
- Event Bus/서버/재생 로그/Event Sourcing은 없다. 향후 그래프 화면은 이벤트의 projection으로 붙인다. DAG 실행 엔진이나 병렬 Agent는 없다.

## S2 파일 StateStore와 실행 전 Policy

### 저장소와 소유권

- `FileStateStore.open(projectPath, options?)`: `realpath`로 프로젝트를 정규화하고 `.ai/writer.lock`을 배타 생성한다. 별칭 경로와 다른 프로세스도 같은 lock을 사용한다. PID는 참고 정보이며 생존 여부로 자동 탈취하지 않는다.
- `load/save`: 기존 StateStore Port 구현. Run revision은 정확히 1씩 증가해야 하며 terminal run은 덮어쓰지 않는다. 이전 run ID를 보존하고 활성 run은 프로젝트당 하나만 허용한다.
- `state.json`: `{schemaVersion, revision, runs, actions}`가 원본이다. 프로젝트 revision은 action 저장에서도 증가하며, Kernel의 Run revision·code revisionCycle과 별개다.
- `tasks.json`: 같은 프로젝트 revision을 가진 pending/inProgress/completed/blocked projection이다. 누락·손상·내용 불일치는 state에서 다시 만든다. state가 없는데 tasks만 있거나 state가 손상됐으면 열기를 거부한다.
- `prepare/finish`: `(runId, actionId)`를 중복 방지 ID로 사용한다. decision/digest와 PREPARED → SUCCEEDED/FAILED/INTERRUPTED 또는 DENIED만 저장한다. 입력 내용·출력·대화·tool history를 복제하지 않는다. `.ai/decisions.md`, 별도 logs/check 증거의 사용자용 출력은 S4/S5에 남겨둔다. config는 S0의 사용자 관리 파일을 유지한다.
- `close()`: 자신이 소유한 lock만 해제한다. `withFileStateStore(path, async store => …)`는 정상 반환·취소·예외에서 `finally`로 닫는다. 호출자는 **worker 종료를 기다린 뒤** scope를 끝내야 한다. 장기 실행 Host lifecycle 연결은 S3/S4 범위다.

저장은 같은 디렉터리의 무작위 temp 생성 → write → file sync → close → rename 순서다. state를 먼저 교체하고 tasks를 교체한다. `StateStoreError.stage/stateCommitted/cleanupFailed`로 부분 저장과 정리 실패를 구분한다. 저장 오류는 해당 인스턴스의 추가 변경을 차단하지만 lock을 즉시 해제하지 않는다. 실행 소유자가 worker/process 종료를 확인한 뒤 명시적으로 close해야 한다. 초기 open 실패처럼 worker가 아직 없는 경로만 자체 lock을 정리한다. 성공 상태의 state 교체 뒤 tasks 저장이 실패해도 호출 결과는 실패다. 디렉터리 fsync에 의한 전원 장애 내구성이나 여러 파일의 transaction은 보장하지 않는다. 파일당 16 MiB를 넘으면 거부하며 자동 보관·분할은 없다.

다음 소유자가 열면 CREATED/RUNNING/WAITING_APPROVAL은 INTERRUPTED로 바꾸고 activeAgents/next를 비운다. PREPARED action도 실행 여부를 추정하지 않고 INTERRUPTED로 남긴다. 저장 후 기존 `RunInterrupted` 이벤트를 발행하며 sink 실패는 `deliveryFailures`에만 기록한다. 기존 Step ID/attempt는 유지한다. 자동 resume/retry, 승인·PASS 재사용, 이벤트 재생은 없다. crash가 남긴 lock은 소유 프로세스 종료를 사용자가 확인하고 수동으로 정리해야 한다. 불명확하면 열지 않는다.

### Policy와 경로 Adapter

`policy.ts`는 파일 I/O·Pi·UI 없는 `evaluatePolicy`와 작은 실행 gate를 제공한다. `policy-paths.ts`의 `FilePolicyPathInspector`만 파일 시스템을 조회한다. Kernel은 두 Adapter를 import하지 않는다.

| 결과 | S2 동작 |
|---|---|
| ALLOW | 등록된 read/search 또는 일반 write/edit, R0/R1, 역할·허용 범위·경로 검사를 모두 통과해야 실행 |
| DENY | UNKNOWN, 미등록 도구, 임의 shell/exec, 보호·허용 범위 밖 경로, 검사 불가 등 미실행 |
| REVIEW_REQUIRED | R2 run binding이 없으면 미실행; dependency 파일 mutation은 최소 R2로 승격 |
| APPROVAL_REQUIRED | 지원되는 단일 삭제도 아직 정확한 미만료 인간 승인이 없으면 미실행 |

PolicyDecision의 기존 S0 예약 이름 REQUIRE_REVIEW/REQUIRE_APPROVAL을 위 이름으로 확정했고, action risk에 UNKNOWN을 추가했다. Run/분류 risk R0~R3 계약은 변경하지 않았다.

- Worker가 아닌 신뢰한 Adapter가 도구의 실제 operation, 역할, action risk 하한, 전체 입력의 action digest, 고정 정책/config digest를 구성해야 한다. 등록 이름만으로 도구 구현의 안전성을 증명하지 않는다.
- Reviewer/Lead는 write/edit 불가다. 허용 경로 기본값은 비어 있다. literal 상대 경로만 받아 절대 경로·`..`·역슬래시·glob·제어 문자를 거부한다.
- `.git`, `.ai`, `.pi`, 알려진 credential/secret 이름과 확장자, policy/config 파일을 읽기·쓰기 모두 보호한다. 추가 Runtime 소스·제어 파일은 신뢰한 Host가 `protectedPaths`로 지정한다. 임의 이름의 비밀 내용을 자동 판별하는 기능은 없다.
- 모든 경로 구성요소를 lstat 검사한다. workspace 안쪽 symlink까지 전부, dangling symlink, 새 파일의 symlink 조상, hardlink 파일, 특수 파일을 거부한다. 루트의 정규 경로 변경도 거부한다.
- **검색도 검사된 구체 파일 목록만 지원**한다. 디렉터리를 허가받아 재귀 검색하는 것은 불가다. S3 검색 도구는 caller가 명시한 파일 목록을 검사하며 디렉터리 후보 탐색을 구현하지 않는다. 이동·범용 구조 변경·검증 명령은 worker 도구로 제공하지 않는다. S5C의 한정 삭제는 별도 human approval을 같은 gate에 연결한다.
- `executePolicyAction`은 평가 → decision/intent 저장 → 경로 재검사 → lock/취소 검사 → executor → 결과 저장 순서다. ALLOW 이외의 결과와 저장·평가 실패는 executor를 호출하지 않는다. 저장 실패 후 다음 action도 차단한다.

신뢰된 같은 프로세스 Adapter를 위한 안전장치이지 OS sandbox가 아니다. 검사와 실행 사이 외부 프로세스의 교체 경합(TOCTOU), 악성 Extension 직접 I/O, 등록 프로그램 내부 동작을 완전히 통제하지 않는다. S3는 실제 파일 도구 입력·실행·취소를 같은 gate에 연결한다. 실제 SDK 세션은 faux provider로만 검증했으며 유료 Provider는 호출하지 않았다.

## S3 Pi SDK Agent Adapter

### API와 경계

`PiAgentExecutor.create({executionContract, cwd, agentDir, config, modelRuntime, audit, ...})`가 사전 검사 후 AgentExecutor를 반환한다. `config`는 `parseRuntimeConfig` 결과, `modelRuntime`은 Host가 명시적으로 구성한 Pi ModelRuntime, `audit`은 해당 프로젝트 lock을 소유한 FileStateStore다. `agentDir`는 기존의 신뢰한 Pi 디렉터리이며 workspace 밖이어야 한다. Adapter는 새 인증 저장소를 만들거나 부모 Extension을 탐색하지 않는다.

```text
Kernel → AgentExecutor.execute(request) → PiAgentExecutor → 새 SDK AgentSession
                 ↑                              │
                 └── onSessionCreated(ref) ──────┘
                       저장 성공 후 prompt
```

- `execute`마다 새 세션·ResourceLoader·메모리 Settings·도구를 생성한다. 세션 재사용·부모 대화 복사·자동 모델 fallback은 없다. Adapter당 동시 호출을 거부한다.
- Port에 `onSessionCreated` 비동기 콜백만 추가했다. Pi Adapter는 이 콜백을 요구하며 Kernel이 제공한다. 역할·중복·schema 검사 후 `roleSessionRefs`를 저장하고, 실패하면 prompt를 시작하지 않는다. 콜백은 한 번만 유효하며 늦은 호출은 거부한다.
- Pi SessionManager가 `<agentDir>/sessions/company-runtime/` 아래 JSONL을 소유한다. 정규 세션 경로가 workspace로 들어가는 symlink도 거부한다. `.ai`에는 세션 ID/파일 참조만 저장한다. Pi는 첫 assistant 메시지까지 파일 생성을 늦추므로 조기 실패한 참조의 파일은 없을 수 있다.
- C06 Fitness 실행은 명시적 `sessionPersistence: "memory"`로만 원문 JSONL을 저장하지 않는다. `.ai`의 역할 참조는 `memory:<sessionId>`이고 기존 Kernel의 session uniqueness를 유지한다. 일반 Runtime의 기본 durable 경로는 바꾸지 않는다. Fitness observer는 payload 없는 숫자/boolean만 전달하며 observer 오류가 worker 결과를 바꾸지 못한다.
- 공개 SDK만 사용한다. Kernel/Ports/Policy에는 SDK·UI·Provider 구체 타입을 추가하지 않았다. StateStore/Policy 저장 형식과 실행 gate도 변경하지 않았다.

### 역할별 도구와 결과

| 역할 | 제공 도구 |
|---|---|
| Developer (EDIT) | `runtime_read`, `runtime_search`, `runtime_list_files`, `runtime_write`, `runtime_edit`, `runtime_request_check`, `submit_handoff` |
| Developer/Executor (READ_ONLY) | `runtime_read`, `runtime_search`, `runtime_list_files`, `runtime_request_check`, `submit_handoff`; mutation 없음 |
| Reviewer | `runtime_read`, `runtime_search`, `runtime_list_files`, `submit_review` |
| Developer (EDIT, 한정 R3) | `runtime_read`, `runtime_search`, `runtime_list_files`, `runtime_delete`, `runtime_request_check`, `submit_handoff`; write/edit 없음 |

파일 도구는 모두 S2의 검사→intent 저장→재검사→실행→결과 저장을 통과한다. Worker가 role/risk/등록 도구/digest를 지정하지 않는다. Runtime 자신의 소스 디렉터리가 workspace 안에 있으면 자동 보호하고, 추가 제어 파일은 Host의 `protectedPaths`로 제한한다. read/search는 R0, 일반 write/edit는 R1에서 시작하며 dependency 파일은 R2로 승격한다. bound STANDARD/R2가 아니면 실행을 차단하고 새 R2 run을 안내한다. 임의 코드를 분석해 모든 의미적 위험을 자동 판정하는 기능은 아니다.

- V0.3B LSP를 명시적으로 활성화하면 위 네 read-only runtime_lsp_* 도구를 같은 역할들(Executor 포함)에 추가한다. Reviewer에게 mutation authority를 추가하지 않는다.
- 일반 bash·Pi 기본 도구·외부 custom tool을 설치하지 않는다. 파일 도구는 sequential이며 SDK Agent도 sequential로 설정한다.
- 텍스트 파일은 256 KiB 이하, legacy edit는 유일한 exact match이며 V0.3A optional anchored edit는 위 계약을 따른다. write는 기존 부모 디렉터리만 지원한다. 검색은 최대 32개 명시 파일의 literal 문자열 검색이며 100개 결과에서 잘림을 표시한다. OS sandbox·원자 코드 변경/rollback은 아니다.
- `runtime_request_check`는 등록 ID만 받아 Pi tool history에 요청을 남기고 **UNAVAILABLE/미실행**을 반환한다. verifier를 호출하거나 PASS 증거를 만들지 않는다.
- Handoff/Review 제출은 자기 역할의 전용 schema만 받는다. run/task/role/code revision 및 Review diffDigest를 검사한다. 자연어 완료, schema/identity 오류, 다른 도구와 섞인 제출 batch는 실패다. 정상 수락한 제출만 `terminate`로 종료하며 이후 도구 실행을 막는다. Reviewer evidence 참조 오류와 아래 Developer unresolved 표현 오류는 Tool error로 반환하여 기존 시간·턴 한도 안에서 같은 세션의 수정·재제출을 허용한다.
- Kernel의 기존 독립 Review·요구사항·증거·완료 guard는 유지한다. Adapter의 schema 통과는 COMPLETE 승인이 아니다.

Developer의 `unresolved`는 **직접 해결하지 못한 구현·요구사항 문제와 blocker**다. 예를 들어 `Required input validation is not implemented.`는 반드시 남겨야 한다. 반면 `Independent Reviewer PASS is required and remains pending.`는 Kernel/Workflow가 관리하는 후속 의무이므로 unresolved에 쓰지 않는다. SELF_CHECK·TEST·Human Approval 필요 여부도 Runtime이 관리한다. `unresolved: []`는 구현 미해결 문제가 없다는 뜻일 뿐 review/check/approval 완료나 생략 허가가 아니다. R3의 미실행 삭제 등 실제 필요한 변경이 남았다면 구체적 미완료 문제로 보고해야 하며 승인 도구를 우회할 수 없다.

`submit_handoff`는 Developer에 한해 알려진 영어 whole-entry 패턴(Reviewer/PASS, SELF_CHECK, TEST, Human Approval + required/needed/pending)을 보수적으로 검출한다. 거부된 handoff는 저장/수락하지 않고, 해당 필드와 실제 blocker 보존 지침을 Tool error로 전달한다. 어떤 문자열도 자동 삭제·필터링하지 않는다. 구현 문제를 함께 담은 문장이나 인식하지 못한 표현은 그대로 수락될 수 있으나, unresolved가 하나라도 남으면 Kernel의 기존 `unresolved.length === 0` 완료 가드가 차단한다. 자연어 전체를 의미적으로 판정하는 기능이 아니다. QUICK Executor 계약·가드, R1/R2 독립 review와 R3 consent 조건은 유지한다. 이미 수락한 handoff를 이후 Reviewer PASS에 맞춰 다시 쓰지 않는다.

Reviewer는 `VerificationResult.reviewContext`의 명시적 `{diff, evidence:[{ref,content}]}`를 요구한다. 모든 evidence reference와 실제 자료가 대응해야 한다. 이 선택 필드는 S1 fake 검증 계약을 유지하기 위한 최소 확장이며, 실제 Pi Reviewer에서는 누락을 거부한다. S3 테스트는 고정 fixture를, S4는 실제 Git/파일 snapshot과 등록 check 결과를 전달한다. Developer reasoning이나 세션 history는 전달하지 않는다.

### Resource와 모델

- DefaultResourceLoader를 생성하거나 reload하지 않는다. 명시적 ResourceLoader가 Extensions/Skills/Prompt templates/AGENTS/Themes/append prompt를 빈 값으로 반환한다. `noExtensions` 하나에 의존하지 않는다.
- system prompt는 역할 규칙과 선택적인 frozen `projectInstructions` context다. V0.3D configured file은 preflight snapshot으로 전달하며 AGENTS.md를 자동 사용하지 않는다. Host가 검토한 규칙을 이 문자열로 전달할 수 있으며 정책 권한을 낮추지 못한다.
- Settings는 역할별 in-memory이고 자동 compaction·agent retry·provider retry·skill command를 끈다. 프로젝트/전역 Settings 파일은 로드하지 않는다.
- 생성 시 coding/reasoning 모두 `config mapping → ModelRuntime.getProvider/getModel → checkAuth/getAuth`를 확인한다. 실행 직전 선택 profile/auth를 다시 확인하고 명시한 model을 SDK에 전달한다. 누락·설정 오류·인증 실패는 시작 전 오류이며 fallback을 허용하지 않는다.
- 주입된 ModelRuntime의 기존 Pi 인증·Provider 범위를 사용한다. 부모의 동적 등록/메모리 인증을 자동 공유하지 않는다. 공유가 필요하면 Host가 검토한 Runtime을 명시적으로 주입하고 실행 중 변경하지 않아야 한다. 사전 auth 해석 성공은 원격 서비스 가용성 보장이 아니다. OAuth 갱신 등이 필요한 실환경 auth는 네트워크를 사용할 수 있으나 테스트는 faux만 사용한다.

### 취소와 이벤트

기본 실행 제한은 180초·32 turns다. `.ai/config.yaml`의 `agents.worker_timeout_ms`(10,000~600,000ms)를 Extension Host가 전달하며 Adapter는 복사한 config와 함께 호출 예산을 고정한다. 이미 생성된 Adapter의 예산은 원본 config 객체를 바꿔도 변하지 않는다. Developer·Reviewer·Executor에 공통으로 적용하며 새 역할/재작업 호출마다 예산을 새로 시작한다. V0.1에는 역할별 timeout이나 자동 연장·재시도를 추가하지 않는다.

실행 timer는 `execute()`에서 audit/auth 재확인·SDK 생성·session 참조 저장·전체 prompt/tool turns·R3 승인 대기를 포함한다. inactivity timeout이 아니므로 응답/도구 호출마다 갱신되지 않는다. 생성 시 profile/auth 사전 검사도 같은 값의 별도 AbortSignal budget을 사용한다. 등록 check의 `verification.checks[].timeout_ms`와 R3 승인의 TTL은 별도이며 변경하지 않는다. 직접 SDK를 구성하는 신뢰된 Host/test의 기존 `timeoutMs` override(1~3,600,000)와 `maxTurns`(1~128)는 유지하지만 이 override는 YAML 필드가 아니다.

Kernel의 AbortSignal과 timeout을 결합하고 tool gate·실제 파일 실행·Provider stream 시작 지점에서 검사한다. timeout은 기존처럼 실패이며 다음 역할·COMPLETE로 진행하지 않는다. `/workflow cancel`·switch/fork/tree·reload/shutdown은 늘어난 timeout까지 기다리지 않고 즉시 취소 signal을 전달한다. 먼저 취소된 호출은 비협조 Provider를 기다리는 동안 deadline에 도달해도 timeout으로 원인을 덮어쓰지 않는다. SDK prompt preflight에서 취소되어도 스트림 시작 guard가 Provider 호출을 막는다. 취소/실패한 run ID는 해당 Adapter에서 다음 역할을 실행하지 않는다.

`finally`에서 abort/idle을 기다린 후 unsubscribe/dispose한다. 늦은 결과와 cleanup 중 취소도 성공으로 반환하지 않는다. 협조하지 않는 Provider/인증/파일 시스템 I/O를 강제로 종료하는 OS 격리는 없다. timeout은 취소 요청 시점이며 비협조 I/O의 정리 완료 시간까지 보장하지 않는다. Host는 worker 정리 후 StateStore lock을 해제해야 한다.

이벤트 발행자는 계속 Kernel 하나다. 기존 AgentStarted는 Adapter 호출 시작, 새 **AgentSessionCreated**는 세션 참조 저장 성공, AgentCompleted/Failed는 호출 결과를 의미한다. 새 이벤트에는 step/role/profile/code revision/sessionRef가 있으며 Completed/Failed에도 가능한 sessionRef를 포함한다. 기존 sequence/stateRevision/저장 후 발행 규칙을 유지한다. 토큰 스트림·reasoning·전체 대화를 RuntimeEvent로 복제하지 않는다. 직접 Adapter만 호출하는 Host는 콜백 저장을 구현해야 하며 별도 이벤트 버스는 없다.

S3의 단일 역할 검증에 이어 S4는 아래 전체 순차 흐름을 연결했다. R3 승인 UI는 이후 S5C에서 추가했으며 DAG·병렬화는 미지원이다.

## S4 STANDARD 실행

```text
명령/신뢰 확인 → 분류 → project lock → profile/auth → clean Git baseline
  → IMPLEMENT (새 Developer session)
  → SELF_CHECK (등록 checks + 실제 diff/evidence)
  → REVIEW (새 read-only Reviewer session)
      REVISE → IMPLEMENT (최대 1회), BLOCK → 종료
      PASS → TEST (등록 checks 재실행)
  → COMPLETE 직전 live digest 재확인 → Kernel 저장 → 최종 보고 → lock 해제
```

### 소유권과 계약

- `StandardWorkflow`가 explicit executionMode를 고정하고 순차 Kernel 호출, AbortController, Verifier/StateStore의 생존 기간을 소유한다. Kernel만 상태 전이와 COMPLETE를 결정한다. Host는 시작·상태·취소를 전달한다.
- `RegisteredVerifier`가 기존 Verifier Port를 구현한다. Port의 선택적 `inspect`는 check 재실행 없는 live evidence 조회다. 실제 S4 Adapter는 반드시 제공하며 Kernel/Ports는 SDK·fs를 import하지 않는다.
- Run에는 최소 `workspace`(digest, 변경 경로, 참조, 안전 여부)와 구조화 `review`를 보관한다. CheckResult에는 시작/종료 시각, 실제 exit code, 제한된 stdout/stderr가 추가된다. RuntimeEvent의 기존 sequence·step/attempt·저장 후 발행 규칙은 유지한다.
- `.ai`는 operational state/check 요약만 보관하고 전체 diff/reasoning/transcript를 복제하지 않는다. 실제 Reviewer 자료는 명시적인 reviewContext로 전달하고 Pi 세션이 기록한다. 별도 decisions.md/logs 조회 UI·usage 집계는 S5 범위다.

### Git와 freshness

- Git 프로젝트 루트, 기존 HEAD, clean tracked/staged/untracked 상태를 요구한다. dirty면 worker prompt 전에 거부한다. 설정이나 사용자 파일을 자동 정리하지 않는다.
- `.ai/state.json`, `.ai/tasks.json`, `.ai/writer.lock`을 제외하며 이 세 파일의 Git 추적은 거부한다. S5D의 정확한 generated view 두 경로는 유효한 ownership/checksum이 있을 때만 추가 제외한다(아래 설명 참조). `.ai/config.yaml`과 그 밖의 `.ai` 파일 변경은 숨기지 않는다. 사용자가 `.gitignore`를 직접 관리해야 한다.
- HEAD/index/config와 정렬된 파일 경로·mode·전체 byte SHA-256으로 digest를 만든다. 허용 root 안의 ignored 파일도 포함한다. `diff`는 변경 파일별 실제 before/after UTF-8 내용·mode의 JSON이며 unified patch 형식은 아니다.
- 시작 후 HEAD/index 변경은 보수적으로 unsafe로 차단한다. 보호 파일·binary 변경도 성공 대상으로 허용하지 않는다. Reviewer PASS와 SELF_CHECK/TEST 증거는 같은 digest에 묶인다. TEST 중 변경이나 COMPLETE 직전 변경은 BLOCKED이며 과거 PASS를 재사용하지 않는다.
- 증거 한도: 5,000개 파일, 파일당 2 MiB, 합계 32 MiB, diff 240,000 bytes, 허용 root 탐색 10,000개. submodule·symlink·hardlink·special file·비표준 Git 경로는 초기 Slice에서 거부한다. 수집 불가는 성공이 아니라 불완전 수집으로 보고한다.

### 등록 command check 실행

- immutable executable/argv/cwd/timeout/env tuple이 등록과 정확히 같아야 한다. Verifier 전용 PolicyDecision → intent 저장 → cwd/lock/취소 재확인 → `spawn(shell:false)` → 실제 종료 결과 저장 순서다. Worker에 process tool을 제공하지 않는다.
- shell·일반 실행 wrapper·inline eval/print switch를 차단한다. Worker가 요청한 check ID는 여전히 미실행 요청이며, 실제 checks는 Kernel의 SELF_CHECK/TEST에서만 실행한다. 명시적으로 등록된 workspace script/program은 worker 보호 경로에 추가한다.
- 환경은 PATH, LANG, LC_ALL, CI, NO_COLOR 및 Git 전역 설정/인증 prompt 차단 값만 전달한다. HOME/NODE_OPTIONS/Provider key/npm token/proxy 등은 상속하지 않는다. PATH와 등록 프로그램·그 의존 코드는 신뢰한 Host 책임이다. 실행 프로그램 내부 I/O·네트워크·읽는 설정까지 sandbox하는 기능은 없다.
- 실제 exit 0만 PASS 후보이며 실패·timeout·출력 한도는 FAIL, 실행 불가는 UNAVAILABLE, 취소로 시작하지 않은 다음 check는 SKIPPED다. 출력은 stdout/stderr 합계 16 KiB로 제한하고 초과하면 종료·FAIL로 기록한다. 후속 check가 앞 check의 대상을 바꾸면 앞 증거도 stale로 처리한다.
- POSIX process group에 TERM 후 필요하면 KILL을 보내고 close·group 소멸 확인을 기다린다. 부모가 먼저 종료하며 남긴 background process도 종료하고 check를 실패시킨다. 정리 확인이 안 되면 lock을 유지해 수동 점검을 요구한다. Windows·탈출한 별도 process group/daemon은 지원하지 않는다.

### 실패·취소·Host lifecycle

- 실패/timeout/취소 후 실제 변경 경로를 다시 수집하고 partial changes, verification 상태, 원인, 권장 후속 조치를 보고한다. 수집 실패는 `changesUnknown`으로 표시한다. 활성 단계의 상태 출력은 live diff가 아니므로 부분 변경 가능성을 표시한다.
- session switch/fork/tree, reload/shutdown, `/workflow cancel`은 worker/check 정리를 기다린다. preflight 확인 dialog에도 signal을 전달한다. **부모 Esc가 worker를 취소한다고 가정하지 않으며 `/workflow cancel`을 사용한다.**
- 외부에서 authoritative state가 바뀌면 덮어쓰지 않고 저장 실패로 닫는다. COMPLETE 저장 실패는 RunCompleted를 발행하지 않는다. per-file atomicity와 부분 commit 한계는 S2와 같다.
- 기존 lock을 자동 탈취하거나 Git rollback/stash/reset/checkout/clean/commit을 하지 않는다. 외부 프로세스의 TOCTOU, 악성 같은-process Extension, 협조하지 않는 Provider/auth I/O를 완전히 제어하지 못한다. 완료는 해당 snapshot에 대한 판단이지 이후 외부 변경을 영구 방지한다는 뜻이 아니다.

## S5A QUICK 실행

```text
/workflow run Fix typo in src/app.ts
  → QUICK/R1, targetPath=src/app.ts
  → 새 Executor (coding profile)
  → SELF_CHECK → TEST → Kernel guard → COMPLETE
```

- 같은 `StandardWorkflow` 실행 소유자를 재사용한다. 이름은 기존 S4 API 그대로이며 분류에 따라 QUICK도 실행한다. 새 Agent 시스템/Verifier/StateStore/증거 엔진을 만들지 않는다.
- QUICK 후보: question·typo·명시적 작은 변경/한 파일 작업. unknown·refactor·아키텍처/다수 모듈/대규모 및 R2/R3는 QUICK 실행 대상이 아니다. R1은 goal에서 한 개의 확장자 있는 literal 상대 파일 경로를 요구한다. 예: `Fix typo in src/app.ts`, `작은 설정 수정 ui/settings.json`. 공백 있는 파일명·문장에 붙인 조사 등은 초기 parser에서 지원하지 않으므로 경로를 별도 토큰으로 쓴다.
- R0(`Explain src/app.ts`)는 write/edit 도구가 없고 Policy도 mutation을 거부한다. R1은 시작 시 고정된 targetPath 한 개만 수정한다. 설정 예시도 기존 `.ai`/config/credential 보호를 우회하지 않는다. dependency 대상은 action에서 R2로 승격·미실행 처리된다.
- 실제 workspace 변경이 한 파일을 넘거나 보수적 변경 구간 합계 100행을 넘으면 BLOCKED다. 공통 prefix/suffix를 뺀 removed+added 구간을 세므로 떨어진 작은 수정도 사이 구간이 길면 거부할 수 있다. 의미적 영향 범위를 증명하는 분석기나 OS sandbox는 아니다.
- Executor는 기존 `coding` mapping을 사용한다. `fast` 자동 선택·cost routing·fallback이 없다. `PiAgentExecutor.create`에 Host가 고정한 `quickScope`를 넘기고 요청의 scope와 일치해야 한다. QUICK은 Reviewer를 생성하거나 reasoning auth를 조회하지 않지만 config schema의 coding/reasoning mapping 필수 조건은 유지한다.
- 제출은 기존 `submit_handoff`에 ExecutorHandoffSchema를 사용한다. 기존 handoff 필드에 요구사항별 `requirement/status/explanation`이 필수이며 `role: Executor`다. 정확한 requirement coverage·MET·설명, actual changed_files 일치, unresolved 없음이 필요하다. QUICK/R0 read-only 설명·분석에서 known_risks는 정보성 finding일 수 있으므로 보존하되 완료를 막지 않는다. 실제 changedFiles는 반드시 비어 있어야 한다. QUICK/R1 mutation은 known_risks가 남으면 기존대로 BLOCKED이며 STANDARD 재실행이 필요하다. 이 모델 진술만으로 완료하지 않으며 실제 필수 SELF_CHECK/TEST evidence를 함께 검사한다. 의미적 정확성은 프로젝트 check 품질과 사용자 확인에 의존한다.
- Kernel이 구현 직후 실제 digest를 `executorDigest`에 결합한다. 이후 SELF_CHECK/TEST/COMPLETE에서 달라지면 stale로 차단한다. **QUICK에서는 check autofix도 결과 제출 후 변경이므로 완료 불가**다. 형식 변경은 Executor 단계에서 끝내거나 처음부터 STANDARD로 실행한다.
- Run에는 `quickScope`, 구조화 `executorResult`, `executorDigest`, 기존 workspace의 `changedLines`를 저장한다. 전체 diff/transcript를 `.ai`에 중복 저장하지 않는다. 이벤트는 기존 Step/attempt/sequence이며 Reviewer 이벤트만 없다. 모든 QUICK step의 attempt는 1이며 재작업/자동 hot-switch는 없다.
- 체크의 Policy 거부는 optional check라도 QUICK에서 FAIL로 완료를 막는다. 임의 미실행을 PASS로 처리하지 않는다. 취소/Provider 실패/저장 실패와 partial changes 보고·lock cleanup은 S4 경로를 공유한다.
- 네 명령은 `Workflow: QUICK`, `Agent: Executor`, `Reviewer: not required`, risk, 구조화 결과를 표시한다. 기존 `runtime.workflow: STANDARD` 설정으로 처음부터 독립 review 경로를 선택할 수 있다. 새 mode UI는 추가하지 않았다. 더 넓은 작업이 필요하면 현재 변경을 사용자가 보존·정리한 뒤 새 STANDARD run을 시작한다.

## S5B R2 Review Enforcement

```text
/workflow run Update dependency in package.json and package-lock.json
  → STANDARD/R2 사전 선택 (coding/reasoning 모두 검사)
  → run ID에 결합한 Policy + 저장된 R2 Developer 상태 확인
  → Developer → SELF_CHECK → 독립 Reviewer
  → PASS → TEST → 최신 digest/current-session guard → Kernel COMPLETE
```

- `files.allowed_paths`에 명시된 파일만 기존 write/edit로 처리한다. manifest/lockfile을 다룰 때도 `.ai`/credential/.git/Runtime·등록 script 보호, symlink/hardlink·size 제한은 그대로다. 새로운 설치·삭제·이동·mkdir·배포·shell 도구는 없다.
- 기존 classifier가 초기 R2로 판정하면 `adaptive`는 STANDARD를 고른다. Complexity QUICK/Risk R2도 Executor를 생성하지 않는다. 명시적 `runtime.workflow: QUICK`은 R2를 거부한다. COMPLEX/범용 R3는 미지원이며 한정 R3는 아래 S5C를 따른다. R1/QUICK 실행 중 dependency action이 나타나면 REVIEW_REQUIRED로 차단하고 사용자가 새 STANDARD/R2 run을 시작해야 한다.
- Host composition callback은 V0.3C부터 `createAgents(store, quickScope, r2RunId, r3Scope, executionContract)`를 받는다. PiAgentExecutor.create와 PolicyContext의 `r2RunId`는 Host가 preflight에서 고정하며 모델 도구 입력으로 받지 않는다. 다른 run/Executor/QUICK scope와 혼용할 수 없고 configDigest에도 포함된다.
- Policy는 bound run의 Developer 파일 mutation을 R2 하한으로 평가한다. 그 결과의 ALLOW는 **독립 리뷰를 생략할 허가나 이미 받은 PASS가 아니다.** 해당 run은 이후 Reviewer PASS 없이는 완료하지 못한다.
- R2 ALLOW intent를 저장할 때 StateStore는 실제 저장된 STANDARD/R2·RUNNING·IMPLEMENT·attempt·active Developer와 마지막 세션 참조를 검사한다. R2 risk/workflow obligation을 낮춰 저장할 수 없다. 순수 Policy에 binding을 꾸며 넣어도 durable R1 run에서 실행하지 못한다.
- Kernel은 현재 구현/리뷰 회차의 서로 다른 session ID와 sessionFile, 정확한 review/requirement evidence, 필수 SELF_CHECK/TEST와 live workspace digest를 확인한다. 재작업 시 이전 Reviewer 참조를 비우고 새 등록을 요구한다. 가짜/누락된 참조, 자연어 PASS, stale digest, BLOCK·REVISE 한도 초과, check/상태 저장 실패는 완료가 아니다.
- 기존 Review/Run/Action 상태 포맷·STANDARD Step/attempt·RuntimeEvent를 재사용한다. 별도 R2 Workflow나 event bus·risk hot-switch·approval token은 없다. 네 명령에 `Risk: R2`와 `Review enforcement: REQUIRED (STANDARD/R2)` 및 분류 근거를 표시한다. Policy 거부 사유는 신뢰된 Policy 문자열만 최종 오류에 전달하며 Provider 원문 로그는 노출하지 않는다.
- **실제 패키지 설치나 lockfile 재생성을 자동 보장하지 않는다.** 테스트는 임시 manifest/lockfile의 명시적 텍스트 변경과 등록 Node check를 검증한다. 사용자 check가 실제 설치 상태·lockfile 일관성·회귀를 검증하도록 구성해야 한다. 등록 프로그램 내부의 script 실행·네트워크·설치 동작은 기존과 같이 trusted code이며 sandbox하지 않는다. 특히 변경 가능한 프로젝트 metadata를 읽어 실행하는 검증 명령은 그 간접 실행까지 사용자가 검토해야 한다.
- 거부/실패/취소는 이미 변경한 파일을 rollback하지 않는다. R3 Human Approval은 S5C이며 이 binding을 인간 승인으로 재사용하지 않는다.

## S5C R3 Human Approval

```text
/workflow run Delete file src/obsolete.ts
  → clean Git / tracked UTF-8 / 허용 경로 확인
  → Developer runtime_delete 요청
  → PENDING 저장 / WAITING_APPROVAL / 인간 선택 (기본 Deny)
  → 정확한 미만료 승인 → intent 저장 → target/config/signal 재검사 → unlink
  → action SUCCEEDED 저장 → 승인 CONSUMED 저장
  → SELF_CHECK → 독립 Reviewer PASS → TEST → Kernel COMPLETE
```

### 지원 범위와 사용

- 초기 grammar는 `Delete file <상대 경로>`, `Remove file <상대 경로>`, `파일 삭제 <상대 경로>`다. 공백 없는 literal 경로 한 개만 받는다. 대상은 clean baseline의 Git 추적 일반 UTF-8 파일이며 256 KiB 이하, `files.allowed_paths` 안이어야 한다.
- `.git`, `.ai`/Runtime 설정·정책, 기존 규칙의 credential/secret, 알려진 npm/Cargo/Python/Go manifest/lockfile, node_modules와 symlink/hardlink/특수 파일은 승인으로 우회하지 못한다. 모든 의미적 파일 종류나 숨겨진 비밀을 판별하는 기능은 아니다. 디렉터리·대량 삭제·설치·배포·history·임의 shell은 지원하지 않는다.
- R3 scope는 새 run에만 고정한다. R1/R2/QUICK에서 자동 승격하지 않으며 R2 binding을 인간 승인으로 취급하지 않는다. R3 Developer에는 delete 요청 외 mutation 도구가 없다. Reviewer는 계속 read-only다.
- **`runtime_delete` 호출 자체가 승인 요청의 진입점**이다. Developer는 별도의 approval tool이나 승인 권한을 갖지 않으며, 이미 승인받았다고 가정하고 기다리는 구조가 아니다. preselected target으로 호출하면 Runtime이 `WAITING_APPROVAL`을 저장하고 사용자에게 Deny/Approve once를 묻는다. 유효한 1회 승인일 때만 그 tool 안에서 exact tracked text file을 삭제하고 결과를 반환한다. Deny·승인 timeout은 삭제 없이 종료한다. prompt/tool 설명은 승인 요청 능력과 승인 권한을 구분하며, Developer의 직접 승인·우회·tool 확인 전 승인 획득 주장을 금지한다. R3 Reviewer 및 R0/R1/R2에는 이 승인 요청/삭제 도구가 제공되지 않는다.
- 일반 run/check 확인과 실제 삭제 승인은 별개다. Pi의 `--approve`는 project trust 설정이지 R3 승인 bypass가 아니다. 삭제 UI는 project/run/role/step/path/bytes/fingerprint/action/expiry를 표시하고 **Deny를 첫 선택**으로 둔다. 명시적으로 `Approve once`를 골라야 한다.
- 승인 modal에서는 선택 또는 Esc/ctrl+c로 응답한다. Esc는 이번 승인 거부이며 다른 단계의 부모 Esc가 worker를 자동 취소한다는 의미가 아니다. modal이 떠 있는 동안 터미널 slash command 입력 대신 dialog 응답이 우선한다. Host API의 status/cancel과 lifecycle은 계속 동작하며, cancellation signal이 modal·worker를 정리한다.

### Port·상태·1회 실행

- 기존 ApprovalPort는 `requestApproval(request, signal?)`을 제공한다. request는 run/action ID, Developer role, delete-file operation, path, fingerprint, byte 수, step/attempt, revision, action/config digest, expiresAt을 담는다. 응답은 정확히 같은 run/action/digests/expiry와 boolean approved만 포함한다. 누락·불일치·UI 오류/부재는 승인으로 취급하지 않는다.
- Kernel은 `onApprovalRequested`/`onApprovalConsumed` callback을 SDK adapter에 전달한다. callback은 Provider prompt/tool schema에 노출하지 않는다. timeout·취소 뒤 UI가 늦게 true를 반환해도 실행하지 않는다.
- 기본 TTL은 30초다. Host composition의 `approvalTimeoutMs`만 1~60,000ms로 지정할 수 있고 config YAML은 바꾸지 않았다. 기존 worker 총 timeout도 유지하므로 승인 대기 중 더 일찍 취소될 수 있다.
- Run의 선택적 r3Scope와 approvals ledger에 PENDING → APPROVED → CONSUMED 또는 DENIED/EXPIRED/CANCELLED/INTERRUPTED를 보관한다. 승인 request metadata는 바꿀 수 없고 과거 ledger를 지우지 못한다. action audit의 고유 `(runId, actionId)`가 재실행을 막는다.
- StateStore는 R3 ALLOW intent 전에 저장된 STANDARD/R3·IMPLEMENT·Developer session·APPROVED request·digest·step/attempt·만료를 검사한다. CONSUMED는 같은 action의 durable SUCCEEDED가 있어야 저장한다. 승인 flag만으로 실행/완료 상태를 꾸밀 수 없다.
- 실행 직전 `dev/ino/mode/size/mtime/ctime/bytes hash` fingerprint, 정규화된 config, signal과 만료를 다시 확인한다. 마지막 확인과 unlink 사이에는 JS yield가 없다. 외부 프로세스의 syscall 사이 경합까지 원자적으로 막는다는 뜻은 아니다.
- 재시작 시 active run과 미완료 grant를 INTERRUPTED로 남기고 실행·승인·resume를 자동 반복하지 않는다. 사용된/거부된/만료된 승인은 다른 요청에 재사용하지 못한다.

### 완료와 한계

- 승인은 파일 삭제 1회를 허용할 뿐 작업 완료나 Reviewer PASS가 아니다. 소비 기록 없이 check로 넘어가지 않는다. 정확한 단일 삭제 diff, 구조화 handoff/requirements, 현재 회차의 독립 Reviewer PASS, 필수 두 검증 단계와 최신 digest가 필요하다.
- R3 재작업은 0회다. Reviewer REVISE/BLOCK, check 실패/stale diff, Provider/저장 실패는 성공이 아니며 이미 삭제한 파일은 partial changes로 보고한다. 자동 rollback/복원은 하지 않는다.
- 파일 삭제와 state/tasks 여러 파일을 하나의 transaction으로 묶지 않는다. unlink 후 저장 실패는 실제 effect가 남을 수 있으며 audit/state를 확인해야 한다. OS sandbox·전원 장애 내구성·강제 daemon 종료는 제공하지 않는다.
- 등록된 verifier 프로그램은 여전히 trusted code다. 승인 gate는 Runtime의 delete 도구를 보호하며 검증 프로그램 내부의 임의 I/O/네트워크까지 가로채지 않는다. 사용자 check는 간접 실행하는 프로젝트 코드까지 검토해야 한다. S5C 자동 검증은 테스트가 생성한 임시 파일만 삭제했다. 후속 실제 GPT RC-05의 승인 UI·유지/삭제 증거와 한계는 [validation](../../docs/GPT_RC_VALIDATION_2026-09-16.md#7-rc-05--scoped-r3-human-approval)을 따른다.

## S5D 읽기 전용 관찰과 명시적 export

```text
/workflow history
/workflow status <full-run-id>
/state checks latest
/state check 2 latest
/state review latest
/state decisions latest 2
/team
/risk
/state export
```

### 조회의 의미

- run ID 생략 또는 `latest`는 최신 run이다. 다른 ID는 정확히 일치해야 하며 prefix 추정/자동 fallback은 없다. page/check 번호는 1부터 시작한다. 각 명령의 `help`로 문법을 볼 수 있다.
- local 실행 중에는 Kernel/action audit snapshot을, 그 밖에는 `FileStateStore.readSnapshot(cwd)`의 원본을 사용한다. 이 메서드는 디렉터리/lock을 만들거나 tasks를 repair하거나 active run/grant를 INTERRUPTED로 바꾸지 않는다. 다른 writer가 있어도 atomic state snapshot을 읽는다.
- writer.lock 존재는 생존 증명이 아니다. 저장된 active 상태는 liveness unconfirmed로 표시하며 취소는 해당 owner Pi에서 해야 한다. 다른 Pi의 `/workflow cancel`로 원격 제어하는 기능은 없다.
- 모든 view는 출처·recorded 시각과 filesystem/check 미재검증을 표시한다. 저장된 COMPLETED/PASS를 현재 코드나 worker 생존에 대한 보장으로 읽으면 안 된다. tasks projection이 없거나 source와 어긋나면 경고하고 조회에서 고치지 않는다.
- 같은 Host에서 마지막 저장 실패와 durable 상태가 다르면 local 실패를 우선 표시하며 durable 상태도 함께 안내한다. state가 손상되면 이전 성공 캐시로 대체하지 않는다. reload 후 메모리 전용 실패 원인은 사라질 수 있으므로 저장된 active 상태/불일치 경고와 원본을 확인해야 한다.
- 명령 출력은 페이지와 약 32,000자 한도를 사용하고 잘림을 표시한다. terminal 제어문자/bidi를 escape한다. check output 상세는 원본의 bounded stdout/stderr를 표시하며 새 check를 실행하지 않는다. team은 Pi session 참조만 읽고 JSONL을 열어 복제하지 않는다.

### 기록과 revision

- Run의 `maxRevisionCycles`는 실제 적용한 Reviewer REVISE 한도다. STANDARD는 config 0~3(기본 1), QUICK/R3는 0이다. `revisionCycle`은 verification repair도 포함한 코드 revision이고 status는 두 한도를 구분한다. `handoff`는 구조화 Developer 결과이며 승인이 아니다. `reviewHistory`는 수락한 회차별 REVISE/PASS/BLOCK을 보존한다.
- 실제 `CheckResult.step`을 저장해 SELF_CHECK/TEST와 attempt를 구분한다. 이전 기록에 없는 step/timing/limit는 `not recorded`로 표시하고 추정하지 않는다.
- 운영 결정 ID는 classification/run, review/run/revision, approval/run/action, policy/run/action, outcome/run에 기반한다. 조직 선택·검토·승인·정책·종료 사실을 projection하며 별도 LLM로 기술적 ADR/숨은 reasoning을 만들어내지 않는다. 이벤트 delivery 실패는 local 진단이지 성공/실패 판정을 바꾸는 입력이 아니다.

### 파일 export와 소유권

- `/state export`가 `.ai/decisions.md`(운영 결정 Markdown)와 `.ai/logs/checks.json`(check evidence)을 만든다. 자동 export는 아니며 실제 state.json이 있어야 한다. 원본 state나 approval/검증 조건은 바꾸지 않는다.
- export는 parent/run이 idle이고 모든 저장 run이 terminal일 때만 writer를 획득한다. `FileStateStore.open(..., {recoverInterrupted:false})` + `exportViews()`를 사용하며 이 모드는 interruption recovery와 tasks repair를 하지 않는다. 상태 조회/exports 때문에 이전 작업을 재개하거나 승인을 무효화하지 않는다.
- 파일에는 source revision/hash 및 생성 주체/body checksum이 있다. 동일 source를 다시 export하면 변경이 없다. marker가 없는 수동 파일, checksum이 깨진 생성 파일, symlink/hardlink/unsafe 경로는 덮어쓰지 않는다. 강제 덮어쓰기 옵션은 없다. 기존 수동 `.ai/decisions.md`는 그대로 유지되며 CLI 운영 결정 조회는 계속 사용할 수 있다.
- 소유한 lock 아래 temp/write/sync/rename을 파일별로 수행한다. 둘 전체의 transaction은 아니므로 실패 시 한 파일만 갱신될 수 있다. source는 유지되고 재export가 가능하며 export 실패를 과거 Run 실패/성공으로 재기록하지 않는다. export-only 작업 중에는 부모 mutation을 막고 shutdown이 정리를 기다린다.
- 관찰 파일은 실행/승인/완료/복구의 원본으로 읽지 않는다. checks.json에는 이미 state에 기록한 check 출력만 있고 transcript/tool history/전체 diff는 복제하지 않는다. 출력에 민감한 데이터가 있을 수 있으므로 자동으로 공개·commit하지 말아야 한다. checksum은 accidental edit 보호이지 악성 동일 사용자에 대한 인증 서명이 아니다.
- Git baseline은 `.ai/decisions.md`와 `.ai/logs/checks.json`의 **온전한 generated 내용만** 조건부 제외한다. generated 파일을 Git 추적하면 실행을 거부한다. 수동 파일·깨진 checksum은 일반 evidence 대상이며 Git ignored인 checks.json의 수동 변경도 검사한다. `.ai`나 `.ai/logs` 전체를 제외하지 않는다. `.gitignore`는 사용자가 직접 관리하며 Runtime이 자동 수정하지 않는다.
- 기존 OS sandbox/외부 TOCTOU/파일당 크기/단일 writer 한계를 유지한다. 큰 state/export는 파일당 16 MiB 한도이며 자동 archive/분할은 없다. technical decision authoring, 전체 이벤트 replay, 별도 TUI/DAG/Web/RPC/SQLite 시스템은 추가하지 않았다.

## S6 실패 경계

- AgentExecutor/Verifier의 `safeToRelease`는 promise 정산과 자원 종료 확인을 구분한다. 실제 Pi/파일 adapter는 worker·check·Git process가 살아 있거나 cleanup이 불확실하면 false를 제공한다. custom Port도 정산 전 cleanup을 보장하거나 미확인을 명시해야 한다.
- 저장 실패 시 Store는 쓰기만 닫고 lease를 유지한다. 정상 종료는 `cancel → SDK/process 종료 확인 → terminal state 저장 → close/unlock` 순서다. SDK abort/dispose나 process runner/그룹 cleanup 확인이 실패하면 다음 역할·COMPLETE를 막고 lock을 남긴다. 실패 중 state 저장 자체가 불가능하면 기존 PREPARED/active 기록이 남을 수 있다.
- cleanup 불확실 상태에서 추가 Git evidence process를 시작하지 않으며 변경 수집은 incomplete로 보고한다. 완료 commit 뒤에는 새 Git 수집을 하지 않고 COMPLETE 직전 확인한 snapshot을 보고한다. lock retained 오류가 있으면 다른 작업을 시작하지 말고 OS process와 owner를 수동 확인해야 한다. 자동 unlock/lock stealing은 없다.
- check settlement 전 취소는 PASS가 아니다. audit 결과 저장 실패를 두 번째 finish로 덮지 않는다. 이전 attempt의 session ID뿐 아니라 sessionFile 재사용도 거부한다.
- state/config/lock/worker descriptor는 no-follow/nonblocking + regular-file 검사를 사용해 FIFO open trap을 피한다. config의 symlink/비일반 파일·unsafe directory도 거부한다. Windows 실행은 writer 획득 전에 명시적으로 거부하며 Windows 지원을 추가하지 않았다.
- 완료 guard를 통과해 terminal save가 **시작되기 전** cancel은 수락한다. 이미 시작된 completion commit 뒤의 늦은 cancel은 이를 rollback하지 않는다. 저장 실패에서는 RunCompleted를 발행하지 않지만, 파일별 partial persistence로 durable source와 caller 결과가 다를 수 있다.
- 확인 범위는 관리하는 SDK 세션과 원래 POSIX process group이다. 탈출 daemon·악성 동일-process 코드·등록 프로그램 내부 I/O는 sandbox하지 않는다. 비협조 Provider/auth/event sink/파일 I/O는 종료를 오래 지연시킬 수 있으며 timeout을 절대 정리 기한으로 주장하지 않는다.
- DoD의 PASS/PARTIAL/UNSUPPORTED/NOT VERIFIED 및 실제 Provider/플랫폼 미검증은 [V0.1_READINESS](../../docs/V0.1_READINESS.md)를 따른다. S6 완료는 release 선언이 아니다.

## 검증

```sh
# packages/company-runtime에서
node ../../node_modules/vitest/dist/cli.js --run test/verification-repair.test.ts test/verification-repair-boundary.test.ts test/sandbox.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/impact-review.test.ts test/documentation-pack.test.ts test/reviewer-context.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/host-bridge.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/project-context.test.ts test/list-files.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/execution-contract.test.ts test/trust-baseline.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/lsp.test.ts test/lsp-config.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/anchored-edit.test.ts test/anchored-tools.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/launcher-home.test.ts test/launcher.test.ts test/worktree.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/graph.test.ts test/graph-command.test.ts test/graph-view.test.ts test/graph-view-command.test.ts test/host-boundary.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/contracts.test.ts test/config.test.ts test/extension.test.ts test/classification.test.ts test/kernel.test.ts test/host-boundary.test.ts test/state-store.test.ts test/policy.test.ts test/agent-metadata.test.ts test/verification-boundary.test.ts test/quick.test.ts test/r2-review.test.ts test/approval.test.ts test/observations.test.ts test/observation-files.test.ts test/hardening.test.ts test/kernel-hardening.test.ts

# packages/coding-agent에서: 실제 SDK + suite harness/faux provider
node ../../node_modules/vitest/dist/cli.js --run test/suite/company-runtime-repair.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/suite/company-runtime-host-bridge.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/suite/company-runtime-context.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/suite/company-runtime-lsp.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/suite/company-runtime-agent.test.ts test/suite/company-runtime-workflow.test.ts test/suite/company-runtime-quick.test.ts test/suite/company-runtime-r2.test.ts test/suite/company-runtime-approval.test.ts test/suite/company-runtime-observations.test.ts test/suite/company-runtime-hardening.test.ts test/suite/company-runtime-timeout.test.ts test/suite/agent-session-prompt.test.ts

# 저장소 루트에서
npm run check
npm run check:ci
```

테스트는 임시 디렉터리와 설정 fixture를 사용한다. S0는 Pi public loader로 파일·패키지 진입점을 검사한다. S3는 실제 AgentSession을 실행하되 로컬 faux provider만 사용한다. 생성/수정 가능한 위치는 각 테스트가 만든 임시 디렉터리뿐이다.

Root workspace glob, TypeScript 및 Biome 설정은 이 패키지를 이미 포함한다. `test`/`clean` scripts를 제공하고 공개 배포는 하지 않는다. S0에는 Core 변경, 자동 `.pi`/`.ai` 설정 생성, Git 변경 명령, 세션 history 추가가 없다.

S1 테스트는 fake AgentExecutor/Verifier와 메모리 StateStore를 사용하므로 Pi AgentSession이나 실제 Provider 없이 실행된다. `host-boundary.test.ts`가 Kernel과 Policy import graph에 Pi/Host I/O 의존성이 없는지도 검사한다. S2는 임시 파일 시스템, 실제 lock 경합, 저장 장애 주입과 fake executor로 검증한다. S4는 임시 Git fixture·등록 Node check·faux 세션으로 전체 성공/실패/lifecycle을 검증한다. S5A는 같은 테스트 기반에서 QUICK을 검증한다. S5B는 bound R2 실행·독립 리뷰와 회귀를 추가 검증한다. S5C는 exact/expired/denied/replayed approval과 실제 단일 삭제·리뷰·취소를 추가 검증한다. S5D는 읽기 전용 조회/명시적 export와 configured revision을 검증한다. S6는 실패/경합/crash/lifecycle과 기존 Pi 회귀를 보강했다. 후속 실제 GPT RC-01~08은 [validation](../../docs/GPT_RC_VALIDATION_2026-09-16.md)에 기록된 범위에서 PASS다. DeepSeek·추가 플랫폼은 NOT VERIFIED다. 상세 판정은 [readiness](../../docs/V0.1_READINESS.md)에 기록한다.
