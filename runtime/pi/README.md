# Weavra

Adaptive Agent Workflow Runtime

**Weavra v0.1 RC1 기반 development build.** 안정 기준점은 [`weavra-v0.1-rc1`](https://github.com/kjg8619/pi/tree/weavra-v0.1-rc1)이며 launcher/branding 작업은 그 이후 변경이다. Pi CLI/SDK `v0.85.1`은 별도 버전이다. 정식 release나 패키지 발행을 뜻하지 않는다.

## What is Weavra?

Weavra는 Pi 위에서 작업 범위와 위험에 따라 QUICK 또는 STANDARD 순차 workflow를 실행하는 Runtime이다. 구현, 독립 리뷰, 실제 검증, 인간 승인을 구분하고 최신 증거를 확인한 Kernel만 완료를 결정한다. 일반 Pi 대화를 자동으로 workflow로 바꾸지 않으며 `/workflow run <goal>`로 시작한다.

## Current capabilities

- QUICK/R0 읽기 전용 설명과 QUICK/R1 작은 단일 파일 수정.
- STANDARD/R0–R2: Developer → SELF_CHECK → 독립 Reviewer → TEST → COMPLETE.
- Scoped R3: Git 추적 텍스트 파일 한 개 삭제에 한정한 1회 Human Approval.
- 실제 Git diff/digest, 등록 checks, 부분 변경 보고, 명시적 취소와 읽기 전용 상태 조회.
- Pi 기본 footer에 로컬 workflow/risk/phase·active role 및 마지막 종료 결과를 표시하는 Status Projection.
- V0.2A: `/graph`로 기존 Run·attempt·Review·Check·Approval을 읽는 순수 DAG Projection과 ASCII 조회.
- V0.2B: 같은 GraphProjection을 `/graph view`의 read-only TUI overlay에서 스크롤하며 조회.
- V0.2C: `~/.weavra/agent` user-level 격리, 명시적 `weavra setup`과 읽기 전용 `weavra doctor`.
- V0.3A: `runtime_read`의 anchored snapshot과 `runtime_edit`의 선택적 full-file stale guard. QUICK/R1 단일 파일 편집에서 우선 사용.
- V0.3B: explicit opt-in LSP diagnostics/definition/references/document symbols, verifier-owned advisory evidence와 읽기 전용 `/lsp status`.
- V0.3C: READ_ONLY/EDIT Execution Contract, devlop 설치 기준, non-mutating CI gate.
- V0.3D: 명시적 project instruction snapshot, bounded `runtime_list_files`, JVM dependency/build 파일의 최소 R2 분류.
- V0.3F: worker별 실제 provider/model·usage·latency·tool 호출 측정(provider-reported usage, UNKNOWN 규칙), optional budget(호출 수 사전 차단·token fail-closed), Run 시작 provenance snapshot, `/state evidence` read-only Evidence Pack, `packages/evals` 기반 Weavra eval adapter와 deterministic fixture 6개.
- V0.5B: built-in reviewed recipe 4종(`bugfix`, `safe-refactor`, `test-addition`, `read-only-investigation`). recipe는 **Planner가 아니고 permission·approval·evidence·skill runtime·completion authority도 아니다**. JSON editor 입력으로 초안을 만들고 기존 AC 편집기에서 사용자가 수정·확인한 최종 AC만 Task Contract로 freeze한다. 현재 recipe command는 **STANDARD 전용**이며 QUICK 선택은 실행 전에 거부한다(일반 `/workflow run <goal>`은 QUICK/STANDARD 유지). scope/check는 Host의 `allowed_paths`와 required registered check를 그대로 매핑하며 별도 scope narrowing은 구현하지 않았다. provenance의 `recipe{id,version,digest}`는 초안에 사용된 정의만 식별하고 최종 Task Contract digest와 별개다. 자동 discovery/install/hooks/임의 skill 실행은 없다. **Expected-failure TDD lifecycle: NOT IMPLEMENTED**.
- V0.5C Bounded Verification Repair: 기본 disabled인 `verification.repair.mode: self-check-once`. Host가 지정한 check의 deterministic normal exit에 한해 **STANDARD/EDIT/R1·SELF_CHECK 최대 1회** 새 attempt를 연다. failed parent/evidence·원래 계약/정책·누적 budget을 보존하며 새 session/context/read receipt → fresh checks → 독립 Reviewer → TEST → Kernel COMPLETE가 필요하다. 인프라/Provider/auth/Policy/cleanup/cancel/oracle 변경은 repair 대상이 아니다. **`codex-lb/gpt-6-astra` actual smoke에서 strict mutation/trust·bounded context·macOS required sandbox로 COMPLETED / oraclePass true / falseCompletion false**를 확인했다(LOG-084). 초기 결함을 의도적으로 남긴 통제 실험이며 자연 발생 오류 복구율·모든 모델/OS 보장이 아니다. Linux sandbox actual은 NOT VERIFIED다. [실행 계약](packages/company-runtime/README.md#v05c-bounded-verification-repair).
- V0.5D(CLOSED, bounded 범위): opt-in Reviewer impact/context. 실제 diff의 changed symbol·bounded references/declarations·관련 테스트와 exact 선언 버전에 맞는 reviewed 문서를 fresh 입력으로 제공한다. **advisory이며 receipt·Policy·검증 evidence·완료 권한이 아니다.** 전체 로컬 회귀·Astra actual 1회·구현 및 별도 closure exact HEAD CI를 통과했다(LOG-086~093).
- V0.6A/C07 **CLOSED, bounded 범위**: 두 read-only slice와 별도 opt-in control을 실제 Weavra CLI → T3 backend → Project Settings UI로 연결했다. legacy read-only argv/protocol v1은 유지하며, control은 준비·명시적 확인·소유 Run 취소·한정 R3 승인 응답만 전달한다. Runtime/Kernel이 실행·Policy·승인 소비·완료와 writer ownership을 소유한다. actual UI·전체 로컬 gate·Pi 구현 exact CI를 확인했고 T3 devlop CI 미실행은 명시했다(LOG-101~105). [T3 설정·계약](packages/company-runtime/README.md#c07-별도-control-계약).
- V0.3E: Host-confirmed Task Contract(순차 AC ID·scope·check mapping), `/workflow run` Plan Preview(AC editor·확인), frozen contract digest, Reviewer/Executor의 AC ID별 결과와 Kernel AC 완료 guard. Plan 확인은 approval이 아니며 legacy state는 `UNKNOWN (legacy)`로 읽는다.
- [GPT RC-01~08 수동 validation](docs/GPT_RC_VALIDATION_2026-09-16.md)에서 핵심 시나리오 PASS. 환경과 evidence 한계는 해당 문서 및 [readiness](docs/V0.1_READINESS.md)를 따른다. **DeepSeek 공식 API는 NOT VERIFIED**다. CommandCode Provider 경유 `deepseek/deepseek-v4.1-flash` worker smoke는 [기록](docs/WEAVRA_COMMANDCODE_DEEPSEEK_SMOKE_2026-09-18.md)과 [V0.3E smoke](docs/WEAVRA_V03E_TASK_CONTRACT_SMOKE_2026-09-18.md)를 따른다: hardening 전 STANDARD 1/5·QUICK 0/3, hardening 후 STANDARD 2/3·QUICK 1/3, V0.3E 2 AC run은 DeepSeek·GPT 교차 모두 COMPLETED(provider 오류 3회 포함, 실패는 모두 fail-closed이고 workspace 무변경).

## Installation

현재는 checkout을 유지하는 개발/개인 설치다. Node.js `>=22.19.0`, npm, Git, Bash와 **이 checkout에서 빌드한 coding-agent CLI**가 필요하다. global Pi 설치는 필요 없다. 기존 Runtime 검증 환경은 macOS/POSIX, Node `26.7.0`이며 두 번째 T3 read-only 연결은 지원 runtime인 Node `24.19.0`에서도 확인했다. 이를 다른 OS/Node 조합의 검증으로 확대하지 않으며 Windows는 지원하지 않는다.

```sh
git clone --branch devlop --single-branch \
  https://github.com/kjg8619/pi.git weavra
cd weavra
npm install --ignore-scripts
npm run build  # workspace 의존성과 fork-local Pi CLI 빌드
npm link --workspace packages/company-runtime --ignore-scripts
weavra setup   # 프로젝트 밖에서도 가능; import는 파일별 동의
weavra doctor  # 읽기 전용 로컬 검사

cd /absolute/path/to/my-project
weavra
```

브랜치/태그의 역할은 다음과 같다. 기본 브랜치를 생략한 clone으로 현재 Weavra 개발판을 설치했다고 가정하지 않는다.

| 기준 | 의미 |
|---|---|
| `main` | upstream/base Pi 계열 |
| `devlop` | current Weavra development |
| `weavra-v0.1-rc1` | immutable historical RC baseline; 현재 개발 기능을 포함하지 않으며 이동하지 않음 |

위의 workspace 한정 `npm link`는 npm global prefix에 **`weavra`만** 연결한다. 해당 `bin` 디렉터리가 PATH에 있어야 한다. `packages/coding-agent`를 global link하거나 기존 `pi`를 덮어쓰지 않는다. checkout 이동/삭제 후에는 다시 link해야 한다. publish는 필요 없다.

```text
pi               → 사용자가 기존에 설치한 Pi (변경 없음)
weavra <args>    → exec <checkout>/packages/coding-agent/dist/bundle/cli.js
                       -e <checkout>/packages/company-runtime/src/extension.ts <args>
```

두 명령을 같은 시스템에서 함께 사용할 수 있다. launcher 자신의 symlink/npm-link 실제 위치에서 checkout을 찾고 두 경로를 절대경로로 전달한다. PATH의 `pi`는 검색하거나 fallback으로 실행하지 않으므로 global Pi의 업데이트/버전 차이가 Weavra의 CLI 선택에 영향을 주지 않는다.

기본 `weavra`는 cwd·인수·stdio·exit code·signal을 유지한다. 환경은 V0.2C의 agent/session 경로 격리만 적용하며 아래를 따른다. `weavra --help`는 **fork-local Pi 도움말**, `weavra --version`은 **fork-local Pi 버전**을 그대로 출력한다. Weavra 버전/기능 도움말은 시작 알림과 `/workflow help`에서 확인한다. `weavra --model ...`은 부모 Pi 모델을 선택하며 worker profile은 `.ai/config.yaml`이 결정한다. `--no-extensions`는 자동 탐색을 끄지만 명시적 `-e`의 Weavra는 로드된다.

Pi를 실행하는 명령은 local CLI build가 없거나 실행할 수 없으면 checkout 경로와 `npm install --ignore-scripts && npm run build` 안내를 출력하고 즉시 실패한다. `--help`/`--version`도 예외가 아니며 global Pi로 대체하지 않는다. Extension이 없으면 checkout/link 복구 안내를 표시한다.

CLI와 Extension은 같은 checkout에서 관리한다. **checkout/Pi 소스·의존성 갱신 후에는 다시 build해야 한다.** launcher는 자동 build/update나 build freshness 검사를 하지 않는다. 기존 모델 데이터가 준비되어 있으면 `npm run build:offline`을 사용할 수 있다. 데이터가 없는 경우 `npm run hydrate:model-data`로 공개 모델 카탈로그를 준비할 수 있으며 추론 요청은 보내지 않는다.

## V0.2C — Product Isolation / Setup / Doctor

```text
Pi:      ~/.pi/agent
Weavra:  ~/.weavra/agent
Project: <project>/.ai   (기존 Runtime state/evidence)
```

기본 `WEAVRA_HOME`은 `~/.weavra`, effective agent dir는 `$WEAVRA_HOME/agent`다. override는 절대 경로 또는 `~/...`를 사용한다. 공백/한글 경로도 지원하며 cwd에 따라 달라지는 상대 경로·줄바꿈 경로는 거부한다. 같은 설정을 setup/doctor/실행에 일관되게 전달한다.

```sh
weavra setup
weavra doctor
weavra

# 선택적 전체 위치 override; shell rc는 자동 수정하지 않는다
WEAVRA_HOME="/absolute/path/나의 Weavra" weavra setup
WEAVRA_HOME="/absolute/path/나의 Weavra" weavra doctor
WEAVRA_HOME="/absolute/path/나의 Weavra" weavra
```

Launcher는 child 실행 직전에 `PI_CODING_AGENT_DIR`을 Weavra agent dir로 덮어쓰고 inherited `PI_CODING_AGENT_SESSION_DIR`을 제거한다. 기존 Pi 환경을 default로 사용하지 않는다. 기본 세션은 Weavra의 `agent/sessions/<encoded-cwd>` 아래에 저장되며 main repo와 worktree들은 **같은 user-level home 안에서 cwd별로 분리**된다. 명시적 Pi `--session-dir`/`--session`은 그대로 전달한다. `WEAVRA_SESSION_DIR`는 V0.2C에서 지원하지 않는다.

### Setup과 import

`weavra setup`은 Node helper만 실행하므로 Git 프로젝트나 Pi build 없이 사용할 수 있다. Weavra home/agent 및 sessions/themes/prompts/tools/bin 디렉터리를 생성한다. 새 디렉터리는 0700, import 파일은 0600으로 만들며 기존 권한을 자동 chmod하지 않는다. product home/agent/기본 하위 경로의 symlink와 비공개가 아닌 디렉터리, `~/.pi`와 겹치는 home은 거부한다. 권한 오류는 사용자가 경로와 소유권을 직접 검토해야 한다.

`~/.pi/agent`에서는 **auth.json, models.json, settings.json만** read-only 후보 탐색한다. 표시된 `[x]`는 존재 여부이지 import 동의가 아니다. 파일별 `Import ...? [y/N]`에 `y`/`yes`로 답해야 복사하며, 빈 응답·EOF·그 밖의 응답은 SKIP이다. auth/models import가 가능하고 settings는 Pi-specific extension/path/command/sessionDir 위험 경고 후 별도로 동의한다. 값이나 경로를 자동 재작성하지 않는다.

기존 Weavra 대상은 파일/디렉터리/symlink 여부와 무관하게 SKIP하며 `--force`는 없다. ordinary UTF-8 JSON object(1 MiB 이하)만 복사한다. 임시 0600 파일을 쓰고 fsync한 다음, 기존 대상을 덮어쓰지 않는 atomic link publication 후 임시 이름을 제거한다. POSIX rename의 덮어쓰기 경합을 피하기 위한 방식이며 전원 장애까지 완전한 transaction은 아니다. 원본 Pi bytes/권한과 global `pi`, PATH, shell rc는 수정하지 않는다. credential 내용은 출력하지 않는다.

**Existing Pi sessions were not imported automatically.** 기존 Pi와 과거 Weavra 대화를 구분할 수 없어 bulk session migration은 하지 않는다. 따라서 V0.2C로 전환한 뒤 `weavra --continue`는 이전 Pi 저장소가 아니라 새 Weavra 저장소를 조회한다. 필요하면 사용자가 명시적으로 `weavra --session /path/to/old-session.jsonl`을 사용할 수 있다. 그 파일의 이후 처리는 기존 Pi session 동작을 따른다.

### First run과 Doctor

Weavra agent dir가 없으면 일반 실행은 `Weavra has not been set up. Run: weavra setup` 안내 후 종료한다. worktree 생성 **전**에도 이 조건을 검사한다. Pi는 custom agent dir에서 자체 experimental first-time setup을 생략하므로 명시적 setup을 선택했다. 설정/auth가 없어도 디렉터리가 준비됐으면 Pi를 실행해 **Weavra 세션 안의 `/login`**을 사용할 수 있다. 기존 Pi에 로그인하는 것만으로 새 Weavra auth가 자동 갱신되지는 않는다.

`weavra doctor`는 checkout/build/Extension, Node/Git version, effective home/agent, private 디렉터리 및 읽기/쓰기 권한, Pi와 경로 격리, auth/models/settings JSON, 기본 session resolution을 검사한다. mkdir/chmod/repair/auth refresh/Provider/network/session/Git mutation/`.ai` 생성을 하지 않는다. 내용·token·JSON parse 원문 오류는 출력하지 않는다.

- `PASS`: 해당 로컬 조건 확인.
- `WARN`: auth 없음 또는 선택적 models/settings 없음, settings.sessionDir override 등. WARN만 있으면 exit 0.
- `FAIL`: build/Extension·경로·권한·JSON 오류 등 필수 조건 실패. non-zero.
- `READY`는 **로컬 launch 조건**일 뿐 credential 유효성·원격 Provider 연결·workflow 성공 보장이 아니다. auth가 없으면 `/login`이 필요할 수 있다.

`setup`/`doctor`는 단독 명령이며 Pi/worktree 옵션과 혼용하지 않는다. 문자 그대로의 prompt가 필요하면 `weavra -- setup`처럼 `--` 뒤에 둔다. `--worktree-list`는 setup/build 없이 기존대로 읽기 전용 조회할 수 있다.

**격리는 default user-level 저장 영역에 한정된다.** `.ai`는 계속 각 프로젝트의 Runtime 원본이며 Weavra home은 workflow authority가 아니다. 명시적으로 import한 settings의 extension/command/sessionDir, 프로젝트 `.pi` 리소스, 일반 Provider 환경변수, 사용자가 지정한 session 경로는 Pi의 기존 규칙을 따른다. custom 실행 코드나 외부 동시 파일 교체를 OS sandbox하지 않으며 setup이 trust/approval을 자동 승인하지 않는다.

## Isolated Git worktree

```sh
cd /path/to/project
# 현재 workspace에서 실행
weavra

# 격리된 Git worktree 생성 후 실행
weavra --worktree fix-login

# --worktree <name>만 소비하고 나머지 Pi 인수는 그대로 전달
weavra --worktree fix-login --model provider/model
```

현재 위치가 속한 Git repository의 canonical root와 HEAD를 확인하고 다음을 생성한다. 하위 디렉터리에서 실행해도 새 worktree의 루트에서 Pi가 시작한다.

- Branch: `weavra/<name>` (예: `weavra/fix-login`).
- Path: `<repo-parent>/.weavra-worktrees/<repo-name>/<name>`.
- 예: `/Users/me/Workspace/game` → `/Users/me/Workspace/.weavra-worktrees/game/fix-login`.
- Base: 생성 전에 고정한 source HEAD commit. 원본 branch/HEAD는 전후로 재검증한다.

이름은 필수이며 `[A-Za-z0-9._-]+`와 Git branch validity를 모두 만족해야 한다. 기존 branch 또는 target 경로(빈 디렉터리·파일·symlink 포함)가 있으면 재사용하지 않고 실패한다. 줄바꿈이 포함된 repository 경로와 source 안으로 들어가는 target은 거부한다. `--` 뒤 인수는 Pi에 그대로 전달하며 launcher 옵션으로 해석하지 않는다.

**생성 시 source는 clean이어야 한다.** staged/tracked/untracked 변경, Git/HEAD/status 검사 실패는 생성 거부다. ignored 파일이나 uncommitted 변경은 복사하지 않는다. `.ai/config.yaml`과 검증 script 등 worktree에서 필요한 파일은 먼저 직접 commit해야 한다. 생성 worktree가 프로젝트 cwd가 되므로 `.ai` state도 그곳에서 동작한다. 기존 설정·의존성·ignored 파일을 자동 준비하거나 trust를 승인하지 않는다.

Weavra **소스 checkout**의 fork-local CLI/Extension 경로는 바뀌지 않는다. 사용자 **프로젝트 worktree**만 실행 cwd가 된다. global Pi fallback은 없으며 local build가 없으면 생성 전에 실패한다. 생성 안내는 Pi stdout/JSON을 오염시키지 않도록 stderr에 출력하고, 이후 Pi argv/stdio·종료 코드/시그널은 기존 exec 계약을, user-level 환경은 위 V0.2C 격리 규칙을 따른다.

**--worktree does not merge, commit, stash, reset, or remove anything automatically.**

성공·BLOCKED·CANCELLED·오류·시그널 종료 후에도 worktree와 branch를 남긴다. 생성 도중 실패하면 예약된 빈 디렉터리나 Git의 부분 생성 결과도 남을 수 있다. 자동 rollback·강제 재사용·충돌 해결·PR 생성은 없다. 결과 확인과 이후 처리는 사용자가 직접 한다.

이 기능은 launcher convenience이며 Runtime/Policy/Approval/Status Projection의 의미나 worker 도구를 바꾸지 않는다. Worktree는 별도 파일 checkout이지 **OS sandbox나 독립 Git repository가 아니다**. Git object/ref 저장소는 공유한다. Launcher Git 명령은 optional index writes와 checkout/fsmonitor hooks를 끄고, worktree 부모 symlink 및 repository를 바꾸는 `GIT_DIR`/`GIT_WORK_TREE` 등의 환경 override는 거부한다. 외부 프로세스의 검사/생성 사이 경합이나 trusted Git filter·Pi/검증 프로그램 내부 부작용까지 격리하지 않는다.

### 기존 worktree 다시 열기와 조회

```sh
# 최초 생성: 이미 존재하면 실패 (create only)
weavra --worktree test-1

# 종료 후 같은 repository에서 다시 열기 (open existing only)
weavra --worktree-open test-1
weavra --worktree-open test-1 --continue  # 마지막 Pi 대화 계속; -c도 가능
weavra --worktree-open test-1 --resume    # Pi session picker; -r도 가능
weavra --worktree-open test-1 --session <path-or-id>

# 현재 repository의 Weavra branch에 연결된 worktree 조회 (read-only)
weavra --worktree-list
```

- **`--worktree`는 계속 생성 전용이다.** 기존 branch/path를 재사용하지 않는다. create/open/list는 동시에 지정하거나 반복할 수 없다.
- **`--worktree-open`은 기존 등록만 연다.** 생성과 같은 이름 검증 후 `git worktree list --porcelain -z`에서 정확한 `refs/heads/weavra/<name>`을 찾는다. 별도 registry 없이 정확히 하나의 등록, 실제 디렉터리, 동일 Git common repository, 일치하는 HEAD/branch, linked metadata의 역참조 경로와 index를 확인한다. Git common repository는 worktree들이 공유하는 Git 저장소다.
- branch만 있거나 경로가 누락/손상/prunable이면 실패한다. 조회 중 등록이 바뀌어도 중단한다. 자동 create/prune/repair/recreate/move/delete는 없다. 사용자가 정상적으로 옮긴 worktree는 **현재 Git 등록 경로**를 사용한다. 이 기능은 경로를 이동시키지 않으며 이전 Pi 세션 경로를 이관하지도 않는다.
- **Open에서는 source와 대상 worktree가 dirty여도 허용한다.** staged/unstaged/untracked 변경과 `.ai` 파일을 그대로 보존한다. 단, 이것이 새 `/workflow run`의 기존 clean baseline·Policy·Approval 조건을 완화하는 것은 아니다.
- launcher는 `--worktree-open <name>`만 소비하고 `--continue`/`--resume`/`--session`을 포함한 Pi 인수를 그대로 전달한다. 같은 canonical worktree cwd에서 Pi의 기존 SessionManager가 대화를 선택한다. session registry 복제나 `.ai` 기반 worktree 검색은 없다. **Pi 대화 재개는 Weavra workflow 자동 재개가 아니다.** `/state`로 결과를 확인하고 새 workflow는 명시적으로 시작한다.

`--worktree-list`는 `refs/heads/weavra/*`에 연결된 등록만 `NAME`, `BRANCH`, `PATH`, `STATUS`로 출력한다. `.ai`/session/config를 로드하거나 Pi를 시작하지 않으므로 **fork-local Pi build 없이도 조회 가능**하다. Node와 Git 및 checkout의 launcher helper는 필요하다. 목록 전용 명령이므로 추가 Pi 인수는 거부한다.

`OK`는 조회 시점의 Git metadata가 정상이라는 뜻이며 clean 상태나 Runtime 성공을 뜻하지 않는다. `LOCKED`도 metadata가 정상인 등록이며 open 가능하다. `PRUNABLE`, `MISSING/BROKEN`, `BROKEN`, `AMBIGUOUS`는 사용자 점검 대상이다. 상태 표시 자체가 자동 수정을 수행하지 않는다. 외부에서 등록한 경로의 탭/줄바꿈/제어 문자는 escape해서 표시하며, 줄바꿈 경로나 최종 디렉터리 symlink는 open에서 거부한다.

Open 성공 시 기존 fork-local CLI/Extension을 `exec`하므로 argv/stdio/exit/signal 계약과 global Pi 미사용은 그대로이며 user-level 환경에는 V0.2C 격리가 적용된다. 안내는 stderr에 출력한다. 등록 검사는 OS sandbox나 Git lock이 아니므로 외부 프로세스의 검사/exec 사이 변경까지 완전히 방지하지는 않는다.

## Quick Start

1. 작업할 **Git 프로젝트 루트**에서 `.ai/config.yaml`을 직접 작성한다. 아래 예제를 수정하고 `scripts/check.mjs`에 실제 프로젝트 검증을 연결한다. 실행 파일과 간접 실행 코드까지 검토한다.
2. `weavra setup` 뒤 Weavra 안의 `/login` 또는 명시적으로 import한 auth/`models.json`으로 provider/model을 준비한다. YAML에 API key를 넣지 않는다.
3. 설정·검증 script를 포함한 사용자 변경을 직접 검토하고 commit하여 clean Git baseline과 기존 HEAD를 준비한다. Runtime은 이를 대신하지 않는다. `.ai/state.json`, `tasks.json`, `writer.lock` 및 generated export는 Git 추적하지 않는다.
4. `weavra`에서 다음 명령을 사용한다. `src/calculator.js`는 프로젝트의 실제 허용 파일로 바꾼다.

```text
/workflow help
/workflow config
/workflow run Explain src/calculator.js
/workflow run --recipe bugfix Fix the empty greeting

/workflow status
/state
/team
/risk
```

Run 확인 창에서 등록 check 실행을 확인한다. 취소는 `/workflow cancel`을 사용한다. 부모 Pi의 Esc가 worker를 취소한다고 가정하지 않는다. 파일 변경이 남았다면 다음 run 전에 사용자가 보존·정리해야 한다.

## Configuration

최소 실행 예제: [config.yaml](packages/company-runtime/examples/config.yaml). **provider/model ID는 예시이며 실제 설치·인증한 ID로 교체해야 한다.** `scripts/check.mjs`도 제공된 범용 검증기가 아니라 프로젝트가 작성해야 하는 trusted check다.

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
files:
  allowed_paths: [src, test]
verification:
  checks:
    - id: regression
      kind: test
      executable: node
      args: [scripts/check.mjs]
```

실제 [schema/parser](packages/company-runtime/src/config.ts)는 알 수 없는 필드와 정책 완화를 거부한다. 위 예제의 기본값은 `runtime.workflow: adaptive`, `agents.max_parallel: 1`, `agents.max_revision_cycles: 1`, `agents.worker_timeout_ms: 180000`, review/state 활성, `.ai` 저장, R3 승인 필수다. check 기본값은 `cwd: .`, `timeout_ms: 60000`, `required: true`다.

- STANDARD 재작업은 0–3회(기본 1), QUICK/scoped R3는 0회다.
- Worker timeout은 역할별 호출의 총 예산(10,000–600,000ms)이며 cleanup 완료 기한은 아니다.
- `allowed_paths`는 literal 상대 파일/디렉터리이며 glob이 아니다. 필수 check는 최소 1개 필요하다.
- QUICK은 coding만 사용하지만 schema에는 coding/reasoning mapping 모두 필요하다. STANDARD는 둘 다 사전 검사한다. 자동 model fallback은 없다.
- 전체 필드·제한: [Runtime 설정 문서](packages/company-runtime/README.md#설정-schema-1).

## Commands

모든 명령은 project trust를 요구한다. 각 명령 뒤 `help`를 붙이면 문법을 확인할 수 있다.

| 명령 | 용도 |
|---|---|
| `/workflow help` | workflow, risk, Reviewer, Human Approval, 안전 한계 |
| `/workflow run <goal>` | QUICK/STANDARD 시작 |
| `/workflow run --recipe <id> <goal>` | STANDARD에서 reviewed recipe로 AC 초안을 만들고 기존 편집기/확인 단계로 전달 |
| `/workflow [status [runId]]` | 현재 또는 저장된 상태 |
| `/workflow history [page]`, `/workflow config` | 이력 / 현재 설정 |
| `/workflow cancel` | 명시적 취소 및 정리 대기; rollback 없음 |
| `/state [runId]` | 결과·요구사항·검증·부분 변경 |
| `/state checks [runId] [page]`, `/state check <number> [runId]` | check 목록 / 출력·exit·evidence |
| `/state review [runId]`, `/state decisions [runId] [page]` | 리뷰 / 운영 결정 |
| `/state export` | idle/terminal 상태에서 파생 결정·check 파일 생성 |
| `/team [runId]` | 역할·profile·독립 세션 참조 |
| `/risk [runId]` | 분류·Policy·Approval 상태 |
| `/graph [latest\|runId]` | 읽기 전용 ASCII snapshot; 실행/재시도 기능 없음 |
| `/graph view [latest\|runId]` | 같은 projection의 read-only TUI overlay viewer |
| `/lsp [status]` | 프로젝트 LSP 설정/로컬 실행 파일·활성 run의 process 상태 조회; 서버 시작 없음 |

runId 생략 또는 `latest`는 최신 run이다. 조회는 worker/check를 재실행하지 않는다. 저장된 PASS는 기록 시점의 증거이며 현재 파일 상태나 프로세스 생존을 보장하지 않는다.

### Persistent status

로컬 workflow를 실행하면 Pi 기본 footer에 짧은 상태가 표시된다.

```text
Weavra · QUICK · R1 · IMPLEMENT · Executor
Weavra · STANDARD · R2 · REVIEW · Reviewer
Weavra · STANDARD · R3 · APPROVAL · Developer
Weavra · COMPLETED
Weavra · BLOCKED
Weavra · CANCELLED
```

기존 Kernel snapshot을 RuntimeEvent 발생 시 읽고, 문자열이 바뀔 때만 공식 `ctx.ui.setStatus("weavra.runtime", text)`를 호출한다. 실행 정리 완료 시 final snapshot/report도 확인한다. 타이머·파일 polling·별도 실행 상태 저장은 없다.

- 실행 전에는 비어 있고 종료 후에는 **이 Pi에서 실행한 마지막 결과**를 남긴다. 현재 Git 상태에 대한 보장이 아니다.
- 새 run의 preflight, reload·세션 전환·종료에서는 이전 표시를 지운다. `/workflow cancel` 후에는 실제 `CANCELLED` 등 종료 결과로 대체한다.
- 저장된 run·다른 Pi의 writer/active 기록은 footer의 live 근거로 사용하지 않는다. 재시작이나 `/state` 조회로 과거 RUNNING을 복원하지 않는다.
- 실행 소유권이 끝났는데 snapshot이 active라면 `Weavra · UNCONFIRMED · /state`, final report에 별도 저장/정리 오류가 있으면 `Weavra · ATTENTION · /state`로 표시한다.
- 다른 extension의 status 키를 건드리지 않고 footer를 교체하지 않는다. 외부 footer도 Pi의 extension statuses를 표시하면 공존할 수 있다. `pi-footer` 설치는 필요 없다.
- TUI에만 표시한다. 표시/clear 실패는 best-effort이며 실행 결과·취소·cleanup을 바꾸지 않는다. UI API 자체가 고장 난 경우 실제 화면의 stale 문자 제거까지 보장할 수는 없다.

## V0.2A — Read-only DAG Projection

```text
/graph
/graph latest
/graph <full-run-id>
/graph help
```

DAG는 순환 없는 방향 그래프다. V0.2A는 **기존 순차 실행을 표시할 뿐 실행 순서를 결정하지 않는다.** `/state`와 같은 조회 경계를 사용하며, 현재 Host 소유 run은 live Kernel snapshot을, 그 밖에는 `.ai/state.json`을 읽는다. reload 후 terminal graph도 state.json만으로 다시 만든다. 알려지지 않은 run ID는 다른 run으로 대체하지 않는다.

출력 예시(헤더와 check 상세를 생략한 STANDARD 일부):

```text
[Developer #1] PASS
  -- sequence --> [Self Check #1]
[Self Check #1] PASS
  -- sequence --> [Reviewer #1]
[Reviewer #1] REVISE (review REVISE)
  -- REVISE --> [Developer #2]
[Developer #2] PASS
  -- sequence --> [Self Check #2]
[Self Check #2] PASS
  -- sequence --> [Reviewer #2]
[Reviewer #2] PASS (review PASS)
  -- PASS required --> [Test #2]
[Test #2] PASS
  -- sequence --> [Complete #2]
[Complete #2] PASS
```

- QUICK에는 Reviewer node가 없다. STANDARD 재작업은 `review:1 -> implement:2`처럼 attempt별 node로 펼쳐 순환을 만들지 않는다. 이전 REVISE attempt에서 선택되지 않은 TEST/COMPLETE를 실행된 것으로 그리지 않는다.
- R3의 `approval:1`, `mutation:1`은 `implement:1` 안의 projection detail이다. `contains`/`approval required` 관계로 표시하며 독립 Kernel step이나 Developer 종료를 뜻하지 않는다. APPROVED는 consent일 뿐 mutation PASS가 아니다. Run에 CONSUMED가 남았을 때만 scoped mutation을 PASS로 표시하고, 이후 실패/취소가 이를 rollback했다고 해석하지 않는다. 소비 기록이 불확실하면 UNKNOWN이며 `/state decisions`에서 action 기록을 별도로 확인한다.
- node 상태는 PENDING/RUNNING/PASS/FAIL/BLOCKED/CANCELLED/SKIPPED/WAITING_APPROVAL/REVISE/UNKNOWN으로 표시한다. 원본 Run/Review/Check/Approval 값을 재작성하지 않는다. 헤더 status는 원본 Run의 기록이고, node PASS도 현재 파일 검증이나 전체 run 성공을 뜻하지 않는다. stale evidence로 COMPLETE가 BLOCKED여도 과거 Reviewer/check PASS는 그대로 남는다.
- 전체 step 이력은 저장돼 있지 않다. 구현 결과 또는 후속 check/review가 남은 attempt만 구현 결과를 확인하며, step metadata 없는 check는 SELF_CHECK/TEST에 임의 배정하지 않는다. 누락 결과는 UNKNOWN, 모순된 identity/phase/attempt·손상 source는 graph 거부다. 저장된 COMPLETED라도 step 근거가 불완전하면 Complete node를 UNKNOWN으로 남긴다.
- RUNNING은 snapshot의 현재 단계 표시이며 OS process liveness 보장이 아니다. 저장된 active 상태와 writer 존재도 live 실행의 증거로 승격하지 않는다. 로컬 저장 실패와 durable 상태가 다르면 기존 `/state`처럼 출처와 차이를 표시한다.

**조회에서 writer lock 획득, state repair/resume, Provider/Agent 실행, approval 변경, Git 실행·mutation을 하지 않는다.** config/auth 없이 조회할 수 있지만 project trust와 알림 가능한 TUI/RPC는 필요하다. Print/JSON에서는 기존 명령과 같이 명시적으로 거부한다. 그래프 출력은 약 32,000자로 제한하고 제어 문자를 escape한다.

`src/graph.ts`의 `GraphProjection`/`GraphNode`/`GraphEdge`는 Pi/UI/파일 시스템 타입 없는 DTO다. node ID와 node/edge/check 순서는 deterministic하다. `/graph` 호출마다 계산하며 자동 갱신·event replay·graph DB/cache는 없다. RuntimeEvent는 향후 viewer에서 snapshot 재계산 trigger로만 연결할 수 있고, 현재 자동 테스트는 실제 event 경계에서도 같은 snapshot projection과 무변경 조회를 확인한다.

DAG Scheduler, node 실행/retry, drag/drop, workflow 편집, parallel node, dynamic scheduling, Planner/Lead, COMPLEX, T3Code, Web UI는 구현하지 않았다. 기존 Status Projection과 Worktree Launcher도 그대로다.

## V0.2B — Read-only TUI DAG Viewer

```text
/graph                       ASCII snapshot (기존 동작)
/graph latest
/graph <runId>

/graph view                  read-only TUI viewer
/graph view latest
/graph view <runId>
```

Viewer는 V0.2A의 **동일 `GraphProjection` node ID/status/edge**를 표시한다. Run/Review/Approval 상태를 다시 판정하지 않는다. Pi 공식 `ctx.ui.custom(..., {overlay: true})`로 열고 기존 editor/footer/status를 교체하지 않는다. Viewer를 닫아도 입력 중이던 editor text와 footer는 유지된다.

| 상태 | 표시 |
|---|---|
| PASS / RUNNING / PENDING | `✓` / `●` / `○` |
| REVISE / BLOCKED / FAILED | `↻` / `!` / `×` |
| CANCELLED / SKIPPED | `-` / `·` |
| WAITING_APPROVAL / UNKNOWN | `?` + 상태 이름 |

색상은 Pi theme를 따르고 문자와 상태 이름도 함께 표시한다. 넓은 화면은 revision edge 뒤를 들여 쓰고 좁은 화면은 단일 column으로 줄인다. `contains`/`approval required`와 `[inside implement:1]` 표기를 유지하므로 R3 Approval을 독립 Kernel step으로 보지 않는다. **APPROVED는 mutation success가 아니며**, CONSUMED/UNKNOWN 등 V0.2A의 의미를 그대로 보여준다.

기본 키는 navigation과 close뿐이다:

- `↑`/`k`, `↓`/`j`: 한 줄 스크롤
- `PgUp`/`PgDn`: 페이지 스크롤, `Home`/`End`: 처음/끝
- `Esc`/`q`/`Ctrl+C`: viewer만 닫기. **Worker 취소가 아니다.**
- Enter, node 실행/retry/approve/deny/cancel/resume 메뉴는 없다.

Pi의 기존 `tui.select.up/down/pageUp/pageDown/cancel`, `tui.altScreen.top/bottom` keybinding ID를 사용한다. viewer-local 기본값에만 `j/k/q`를 추가하며 Pi 전역 manager는 변경하지 않는다. `keybindings.json`의 명시적 설정은 alias를 포함한 viewer 기본값을 대체한다. 화면의 key hint도 적용된 설정을 따른다.

**V0.2B 첫 버전은 열 때 읽은 정적 snapshot이다.** `Static snapshot`을 표시하며, 활성 run이라도 자동 갱신하지 않는다. 현재 상태를 보려면 닫고 다시 연다. RuntimeEvent 저장/replay·polling·timer·새 graph state는 없다. Viewer 종료·reload·session switch/fork/tree/shutdown에서는 자체 component를 dispose하며, 읽기/overlay 생성 중 lifecycle이 바뀌어도 늦은 viewer가 남지 않도록 닫는다. 기존 Runtime cleanup은 그대로 수행한다.

긴 label/runId/diagnostic은 폭에 맞게 truncate하고 내부 세로 스크롤을 제공한다. 너무 작은 화면에서는 resize 또는 `/graph` 사용을 안내한다. Viewer는 TUI-only이며 RPC에는 기존 ASCII `/graph`를 사용한다. 조회 중 writer lock/repair/Provider/Agent/Git mutation은 없고, 실행/승인 authority를 갖지 않는다. 다른 extension의 동시 overlay 중첩과 별도 fullscreen 조합은 이번 검증 범위에 포함하지 않았다.

## V0.3A — Hash-Anchored Edit

Worker는 기존 도구 이름을 그대로 사용한다. 기존 파일 수정에는 QUICK/R1에서 다음 순서를 권장한다.

```text
runtime_read({path: "src/foo.ts", anchors: true})
  → fileDigest: sha256:<full-file hash>
    a1:L1:<opaque hash> "foo()\n"
    a1:L2:<opaque hash> "foo()\n"

runtime_edit({path: "src/foo.ts", oldText: "foo()", newText: "bar()",
              anchor: <복사한 두 번째 행 token>, fileDigest: <복사한 digest>})
```

출력의 행 내용은 JSON-escaped 문자열이다. 모델은 hash를 계산하지 않고 Runtime이 반환한 token/digest를 그대로 복사한다. `oldText`는 JSON 문자열을 해석한 실제 원문이며, anchor 행에서 시작해야 한다(여러 행에 걸쳐도 된다). 다른 행의 중복은 허용하지만 같은 행 안에 여러 occurrence가 있으면 `AMBIGUOUS_ANCHOR`로 거부한다.

Policy ALLOW 이후 mutation 직전에 현재 파일을 다시 읽어 **전체 UTF-8 bytes의 digest → 경로·행 anchor → exact oldText** 순으로 확인한다. 파일의 무관한 부분만 바뀌어도 `STALE_ANCHOR`이며 해당 edit는 0 bytes를 변경한다. 비슷한 줄을 찾거나 fuzzy 보정하지 않는다. 모델이 다시 읽고 새 요청을 해야 하며 자동 재시도 loop는 없다. stale 오류만 기존 세션의 시간·턴 한도 안에서 재읽기 가능하고, Policy·저장 실패 및 취소는 기존 실패 경계를 따른다.

- `anchor`와 `fileDigest`는 둘 다 있거나 둘 다 없어야 한다. 생략 시 기존 unique exact edit이고, `anchors` 생략/false의 read 출력도 그대로다.
- anchor는 canonical workspace/path·1-based 행 번호·줄바꿈을 포함한 정확한 행 내용에 묶인다. LF/CRLF, 마지막 newline, Unicode를 정규화하지 않는다.
- 파일/결과는 256 KiB 이하의 strict UTF-8, non-NUL 텍스트만 허용한다. symlink/hardlink·보호/비허용 경로를 거부한다. 출력도 256 KiB 이하이며 긴 행은 4,096 UTF-16 code units preview, 생략된 나머지 행은 명시적으로 표시한다.
- STANDARD/R2에 anchored-only 사용을 강제하지 않는다. 기존 risk/run binding·독립 Reviewer·checks·완료 조건을 유지하고 Reviewer에는 mutation 도구가 없다.

**Anchored stale protection applies to anchored `runtime_edit` operations; it does not magically make every possible file mutation anchored.** 기존 exact edit와 `runtime_write`, trusted checks, 일반 Pi 도구는 이 보호 대상이 아니다. 모든 existing-file mutation을 anchored-only로 바꾸지는 않았다.

검증과 쓰기는 같은 descriptor에서 중간 JS yield 없이 수행한다. 이는 OS의 atomic compare-and-swap이 아니므로 비협조적인 외부 프로세스의 최종 검사와 쓰기 syscall 사이 경합·쓰기 중 I/O 실패까지 transaction으로 보호하지 않는다. 이미 달라진 generation의 stale 요청은 거부하며, 최종 syscall 경합은 기존 비-sandbox 한계로 남는다. `codex-lb / gpt-6-astra`에서 anchored mode 선택·두 번째 중복 위치 수정·외부 변경 뒤 STALE_ANCHOR 거부를 [실제 Provider smoke](docs/WEAVRA_V03A_PROVIDER_SMOKE_2026-09-17.md)로 확인했다. stale run은 거부/bytes 보존 확인 후 테스트가 취소했으며, 실제 모델의 후속 복구나 다른 Provider까지 검증한 것은 아니다.

## V0.3B — Read-only LSP Diagnostics / Navigation

LSP(Language Server Protocol)는 언어 서버에서 코드 구조와 진단을 조회하는 프로토콜이다. 기본값은 **disabled**이며, 사용할 서버를 직접 준비하고 기존 `.ai/config.yaml`에 아래 설정을 추가한다. 자동 설치·검색·원격 서버·global daemon은 없다.

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

`executable`은 PATH의 이름 또는 절대 경로이고 `args`는 argv 배열이다. shell command string은 받지 않는다. server ID와 extension routing은 중복될 수 없고 root는 project root 하나로 고정한다. 서버가 없으면 `UNAVAILABLE`이며 설치하거나 다른 서버로 몰래 대체하지 않는다. 최대 서버 4개, timeout은 100–60,000ms다.

활성화한 workflow의 Developer/Executor와 Reviewer에는 다음 **R0 read 도구**가 제공된다.

- `runtime_lsp_diagnostics({path})`
- `runtime_lsp_definition({path, line, column})`
- `runtime_lsp_references({path, line, column})`
- `runtime_lsp_symbols({path})` — document symbols만 지원

line/column은 모두 **1-based**, column은 **UTF-16 code units**다. 허용된 안전한 일반 UTF-8 파일만 요청할 수 있으며 잘못된 position은 거부한다. 응답 location도 allowed/protected/workspace/link 경계를 검사해 허용되지 않은 항목 전체를 숨기고 `withheld` 수만 반환한다. arbitrary URI의 파일 내용을 읽어 출력하지 않는다.

| LSP status | 의미 |
|---|---|
| AVAILABLE | query가 응답됨. 코드 PASS가 아님 |
| UNAVAILABLE | disabled/unrouted/missing executable/지원하지 않는 기능·대상 |
| PARTIAL | push snapshot의 완료 미확인 또는 정책 필터/결과 제한 |
| STALE | 요청 중 파일 또는 diagnostics 이후 workspace가 변경됨. 재-query 필요 |
| ERROR | timeout/protocol/RPC 등의 실패. PASS로 간주하지 않음 |

**LSP diagnostics는 required process checks를 대체하지 않는다.** SELF_CHECK/TEST는 기존 checks → workspace inspect → 변경 파일의 LSP diagnostics → 최종 inspect를 수행한다. Reviewer에게 실제 diff/check evidence와 exact verifier-owned LSP refs를 함께 전달한다. error diagnostic이나 빈 diagnostic 배열을 자동 FAIL/PASS로 바꾸지 않으며, 특히 TypeScript 서버의 push diagnostics는 항상 `PARTIAL` snapshot이다. 기존 Kernel 완료·stale-review guard는 그대로다.

서버는 한 run 안에서 lazy start/reuse하고 COMPLETE 전 또는 실패/취소 cleanup에서 shutdown→exit→필요 시 process-group TERM/KILL로 종료를 확인한다. cleanup 미확인 시 완료·writer 해제를 허용하지 않는다. typed connection crash만 최대 한 번 재시도하며 timeout/cancel/malformed/policy/stale는 자동 retry하지 않는다. 요청 전후 disk digest가 다르면 결과를 STALE로 비우고 모델에게 재조회하도록 한다.

`/lsp`와 `/lsp status`는 신뢰한 프로젝트 설정 또는 활성 run의 frozen 설정을 읽는다. 서버/Provider/검증을 시작하거나 Runtime state를 바꾸지 않는다. `READY`는 실행 파일 해석 성공일 뿐 server initialization·진단 성공·PASS가 아니다. `weavra doctor`는 기존처럼 project-independent로 유지한다.

**클라이언트는 LSP mutation authority를 제공하지 않는다.** `workspace/applyEdit`는 `applied:false`, rename/prepareRename/codeAction/formatting/organizeImports/workspace-wide symbols는 미지원이다. 다만 **외부 language server 실행 파일 자체는 trusted code이며 OS sandbox가 아니다.** 서버/플러그인의 직접 파일 I/O·네트워크까지 가로채지 않는다. 리뷰한 실행 파일만 등록해야 하며 credential 환경은 process checks처럼 필터링한다. TypeScript의 automatic typing acquisition은 initialize 옵션으로 비활성화한다.

[실제 TS/Provider smoke](docs/WEAVRA_V03B_LSP_SMOKE_2026-09-17.md)에서 설치된 TypeScript 서버의 네 query, workspace 무변경·종료, 실제 모델의 diagnostics 도구 선택과 독립 Reviewer evidence 전달을 확인했다. 다른 서버/OS·monorepo multi-root는 미검증이다. 상세 범위와 한도는 [Runtime 문서](packages/company-runtime/README.md#v03b-read-only-lsp)를 따른다.

## V0.3C — Trust Baseline

### READ_ONLY / EDIT Execution Contract

`intent / complexity / risk`는 routing 정보다. **R0 label 자체가 read-only 권한을 보장하지 않는다.** 새 run은 Host가 확인한 별도의 `executionMode`를 고정한다.

- READ_ONLY: Worker에 `runtime_write`, `runtime_edit`, `runtime_delete`를 설치하지 않고, 직접 만든 registered mutation action도 Policy에서 DENY한다. 완료 시 실제 workspace·양쪽 verification·handoff의 changed files가 모두 0이어야 한다.
- EDIT: 기존 allowed/protected path와 risk floor를 유지한 mutation만 가능하다. STANDARD/R2의 bound run·독립 Reviewer, R3의 scoped deletion·별도 Human Approval을 대체하지 않는다. Reviewer는 run의 mode와 관계없이 항상 read-only다.
- read/search/설정된 read-only LSP/구조화 제출은 READ_ONLY에서도 사용한다. `/workflow status`, `/state`, `/risk`는 `Execution contract`를 표시한다. 과거 필드 없는 run은 `UNKNOWN (legacy; no permission inferred)`이며 EDIT로 간주하지 않는다.

자연어 해석은 **후보 제안**일 뿐 권한 원본이 아니다. `/workflow run`은 명확한 explain/analyze/inspect/설명/분석/검토와 fix/implement/update/수정/구현 요청을 보수적으로 구분하고, 기존 확인 창에 READ_ONLY/EDIT를 표시하여 명시적으로 확인받는다. 모호한 요청이나 설명+수정의 혼합은 preflight에서 거부하므로 새 명확한 요청이 필요하다. quoted words/code/path는 후보 판정에서 data로 취급하며 English/Korean negation을 제한된 규칙으로 처리한다.

예: `삭제하지 말고 삭제 로직을 설명해줘`는 READ_ONLY 후보이지 삭제 권한 요청이 아니다. 다만 기존 raw risk heuristic은 R3를 유지할 수 있다. **READ_ONLY/R3는 worker/승인 전에 fail closed**하며, 편의를 위해 R3를 낮추거나 approval 의무를 우회하지 않는다. READ_ONLY/R2도 기존 STANDARD 독립 review 의무를 유지한다. 일반 자연어의 모든 의미를 이해하는 classifier가 아니다.

QUICK EDIT 경로는 한글과 quote/backtick으로 감싼 공백 경로, unquoted 경로 뒤 단일 문장부호(`src/a.ts:` 등)를 지원한다. 이는 goal 문법만의 처리이며 실제 tool path를 fuzzy 보정하거나 `..`/절대 경로를 정규화해 허용하는 기능은 아니다.

`executionMode`는 설정이나 모델 tool argument가 아니다. 프로그램 Host도 `WorkflowOptions.executionMode`를 명시해야 하며, run ID에 bound된 contract를 Agent/Policy에 전달해야 한다. 누락·불일치·같은 run의 mode 변경은 거부한다. 과거 state를 자동 migration/overwrite하거나 실행 재개하지 않는다.

**READ_ONLY는 OS sandbox가 아니다.** 등록된 verifier와 LSP 서버는 기존처럼 trusted programs다. 이들이 만든 workspace 변경이 관찰되면 READ_ONLY COMPLETED로 만들지 않지만, 사후 Git guard를 사전 process mutation 차단이라고 설명하지 않는다. Verifier Trust/Sandbox는 후속 범위다.

### devlop CI / non-mutating check

`main`/`devlop` push 및 해당 base branch PR에서 CI를 실행하도록 구성했다.

- `npm run check`: 개발자용 Biome `--write` 후 공통 검증.
- `npm run check:ci`: Biome **non-write** 후 동일 `check:base` 검증.
- `check:base`: pinned/runtime deps, TS imports, entry graphs, shrinkwrap, coding-agent install lock, `tsgo --noEmit`, browser smoke를 모두 유지한다.
- CI는 ignored JSON model data만 hydrate하고 `build:offline`으로 committed source를 빌드한다. 일반 `build`가 tracked 모델 카탈로그를 재생성하는 경로를 CI에서 피하며, checkout/reset/ignore로 diff를 숨기지 않는다.
- 기존 workspace tests는 `bash ./test.sh`의 빈 환경/격리 HOME에서 실행한다. 일반 CI에 실제 Provider/auth/유료 smoke를 넣지 않는다. launcher syntax와 마지막 `git diff --exit-code HEAD --`도 검사한다.

로컬 Node 26 및 Node 22/macOS 회귀와 check:ci 전후 tracked bytes 불변을 확인한다. 실제 GitHub Actions 실행·branch protection 및 Node 22/Linux build/test 결과는 별도 확인 대상이다. V0.3C 검증의 실제 범위는 [WORK_LOG](docs/WORK_LOG.md)의 LOG-046을 따른다.

## V0.3D — Project Context

**Project Context는 Permission이 아니다.** 아래 기능은 프로젝트 규칙·파일 이름을 제공할 뿐 Execution Contract/Policy/Review/Approval을 완화하지 않는다.

### 프로젝트 지침 파일 하나 선택

기존 `.ai/config.yaml`에 명시적으로 추가한다. 기본값/자동 검색은 없다.

```yaml
project:
  instructions:
    path: AGENTS.md
```

Host preflight에서 canonical workspace 안의 일반 single-link UTF-8 파일을 **최대 64 KiB**로 안전하게 읽는다. 보호 경로, directory, symlink/ancestor symlink, traversal, NUL/invalid UTF-8/oversize는 거부하며 truncate하지 않는다. 명시적 Host 선택이므로 worker allowed_paths에 AGENTS.md를 추가할 필요는 없지만 protected 경계를 우회하지는 않는다.

한 run의 Developer/Executor/Reviewer는 같은 frozen content를 받는다. 파일이 바뀌어도 prompt를 다시 읽어 교체하지 않는다. 외부 변경 때문에 기존 clean baseline/freshness 검사가 실패할 수 있으며, 다음 run에서만 새 snapshot을 읽는다. 선택된 path는 worker protected path에 추가하여 read/search/list/edit/delete/LSP로 현재 규칙을 바꾸거나 재읽지 못하게 한다. 자동 AGENTS/CLAUDE 탐색, 여러 파일 merge/inheritance, Skill/Extension 로딩은 없다.

`/state` 등에는 **path/digest/bytes만** 표시한다. 새 run에서 미설정이면 `none`, 과거 metadata가 없으면 `UNKNOWN (legacy)`다. StateStore에 content를 추가 저장하지 않는다. 지침은 Provider에 전달되는 context이므로 비밀을 넣지 말아야 하며, 기존 Pi session/transcript 처리와 권한·완료 guard는 유지한다.

### 파일 탐색

```text
runtime_list_files({})                          configured allowed roots에서 시작
runtime_list_files({path:"src", maxDepth:2})    허용 범위 안에서 좁히기
```

**첫 호출은 path를 생략한다. `"."`, `"/"`, `".."`, 빈 path를 보내지 않는다.** 결과는 workspace-relative file paths와 truncated 여부만 포함한다. 이후 후보를 `runtime_read`, explicit-path `runtime_search`, LSP에 전달한다. search를 recursive tool로 바꾸지 않았다.

- read-only/R0이며 READ_ONLY/EDIT와 Reviewer에 제공한다. 기존 Policy/audit gate를 반드시 통과한다.
- 기본/최대 depth 4, 최대 500 files/64 KiB output, roots 32개·enumerated entries/visited nodes 각각 4,096개. 잘림은 명시하며 추가 항목 수를 추정하지 않는다.
- Node fs만 사용하고 shell/fd/find/ripgrep을 실행하지 않는다. deterministic lexical output, symlink 미추적, hardlink/special/unsafe names 제외, 재검사와 cancellation을 적용한다.
- `.git/.ai/.pi`, secrets/credentials/auth/SSH/cloud config 및 추가 protected paths와 `node_modules`는 숨긴다. configured instruction file도 제외한다.
- `.gitignore` 전체 의미를 재현하지 않는다. `dist/build/coverage/target`은 allowed_paths 안이면 보일 수 있다. 성능은 traversal bounds로 제한한다. entry 한도를 넘는 directory는 OS 순서의 임의 prefix 대신 해당 directory 결과를 생략하고 truncated로 표시한다.

### JVM risk

`pom.xml`, `build.gradle[.kts]`, `settings.gradle[.kts]`, `gradle.properties`, `gradle/libs.versions.toml`, `gradle/wrapper/gradle-wrapper.properties`, `.mvn/wrapper/maven-wrapper.properties`와 그 module 하위 경로의 mutation은 **최소 R2**다. 기존 portable policy처럼 case-insensitive이며 `.bak/.txt/.notes` 같은 유사 파일명이나 `.mvn` 전체로 넓히지 않는다.

R1에서 해당 mutation을 만나면 계속 실행하도록 자동 승격하지 않고 새 STANDARD/R2 run을 요구한다. READ_ONLY read/list/search는 가능하지만 mutation 권한은 없으며 bound R2·독립 Reviewer/R3 승인 의미도 그대로다.

자동 회귀와 실제 검증 범위는 [WORK_LOG LOG-048](docs/WORK_LOG.md)를 따른다. [Provider smoke 1회](docs/WEAVRA_V03D_PROVIDER_SMOKE_2026-09-17.md)는 snapshot 전달/list tool 선택까지 확인했으나 모델의 `path:"."` 요청이 Policy에서 거부돼 완료하지 못했다. 설명 보완 후 실제 Provider 재실행은 하지 않았으며 end-to-end 성공으로 표시하지 않는다. self-hosting claim도 하지 않는다.

## V0.5D — Reviewer Impact / Versioned Documentation

기존 `.ai/config.yaml`의 `review.context.impact: bounded`로 C04를 켠다. 생략하면 기존 동작을 유지하며, C01 `agents.context_pack`과 독립적인 Reviewer 전용 입력이다. C05는 같은 context의 reviewed inline registry를 사용한다. 설정 예제와 상태별 의미는 [Runtime 문서](packages/company-runtime/README.md#v05d-reviewer-impact--versioned-documentation)를 따른다.

- 현재 diff와 full symbol range를 교차하고 Policy로 다시 확인한 references/declarations/test 후보를 제한된 범위에서 제공한다. 삭제된 함수를 인접 함수로 추정하지 않는다. 완전한 call/dependency graph나 public API 호환성 증명이 아니다.
- 문서는 정책상 읽을 수 있는 package.json의 **exact 선언 버전**과 검토된 source/version/capturedAt/digest를 대조한다. `MATCHED`도 installed/resolved version, 최신 공식 문서, approval 또는 PASS가 아니다. range/불명확한 버전은 UNKNOWN이며 stale/unmatched content는 전달하지 않는다. fetch/install/hook 실행은 없다.
- Reviewer 호출마다 재구성하고 run/revision/Task Contract/diff/C01 digest에 묶는다. 추가 envelope는 최대 48 KiB이며 state/measurement/evidence에는 digest·count·byte·truncated 요약만 남긴다. 원문은 기존 Pi worker prompt/transcript 경로를 따르므로 registry에 비밀을 넣지 않는다.
- 결정적 A/B의 고정된 리뷰 알고리즘에서 파일 조회는 6→3, 실제 tool 호출은 10→7이었다. 대신 Reviewer payload는 약 3.1 KiB 증가했다. clean/defect 양쪽 false-positive·false-completion은 0이며 **Provider token/일반 모델 품질·성능 향상은 UNKNOWN**이다.

전체 로컬 회귀와 Astra actual 1회는 PASS다. 실제 TypeScript language server의 changed `formatLabel`, caller/관련 test, TypeScript `5.9.3` 선언의 MATCHED reviewed snapshot을 Reviewer가 받았고 SELF_CHECK/TEST·독립 review·oracle·writer release가 통과했다. 구현 HEAD `0d4e91936`의 [CI](https://github.com/kjg8619/pi/actions/runs/35454385916)와 별도 closure HEAD `9331b3ed9`의 [CI](https://github.com/kjg8619/pi/actions/runs/35454820292)가 모두 PASS다. 현재 bounded 범위는 CLOSED이며, 그 뒤 V0.6A read-only 연결을 시작했다(LOG-092~093). 실제 TUI rendering이나 일반 모델 품질 향상을 검증한 것은 아니다.

## V0.6A — Read-only Host Bridge

첫 slice의 `packages/company-runtime/src/host-bridge.ts`는 trusted Host가 기존 Runtime event sink와 전용 로컬 JSONL streams에 연결하는 repository-level API다. 두 번째 slice는 **`weavra bridge --stdio --project-trusted` → T3 backend → 실제 read-only UI**를 연결한다. T3 server의 trusted 절대경로 `T3_WEAVRA_EXECUTABLE`은 `<Weavra checkout>/packages/company-runtime/bin/weavra`를 가리킨다. **Settings → 정확한 project scope 선택 → Project → Weavra**에서 조회하며 그룹 프로젝트는 environment/checkout 하나를 먼저 선택한다. [설정·readiness·진단](packages/company-runtime/README.md#t3-사용과-진단)을 따른다.

T3는 기존 인증 RPC `weavra.observe`와 `orchestration:read` 권한을 사용하며 새 listener를 열거나 `.ai`를 직접 읽지 않는다. protocol v1 `hello` 후 허용 query만 사용하고, standalone은 **snapshots-only**로 2초마다 canonical snapshot을 읽는다. 기존 in-process actual event sink는 유지하지만 event replay나 가짜 Runtime event는 없다. source/docs/prompt/reasoning/credential/transcript/tool output을 wire에 복제하지 않는다.

**Durable Run, 연결 상태, owner 상태는 별개다.** CONNECTED여도 owner는 UNKNOWN이며 writer 존재는 liveness 증명이 아니다. 연결이 끊기면 표시가 STALE일 수 있지만 RUNNING을 CANCELLED/FAILED로 바꾸거나 Runtime을 종료하지 않는다. config summary는 현재 프로젝트 설정이며 Run의 frozen config가 아니다.

첫 slice의 Runtime/SDK + in-memory faux smoke와 로컬 회귀·구현 `bacbb778e`의 [CI](https://github.com/kjg8619/pi/actions/runs/35457968130)는 LOG-094~096의 역사적 결과다. 두 번째 slice는 isolated managed Chromium에서 실제 CLI/backend/UI의 CONNECTED·graph/evidence, 관찰 child SIGTERM 뒤 DISCONNECTED+STALE·RUNNING/state/writer lock bytes 보존·별도 Runtime owner 생존, 자동 재연결 후 새 canonical Run과 project revision 2→4를 확인했다. real CompanyKernel/FileStateStore fixture이며 agent/check/Provider 실행과 paid-provider E2E를 검증한 것은 아니다. **두 read-only slice의 완료와 아래 control 구현·현재 proof를 구분한다.**

게시 검증: Weavra 구현 `2f7822451`의 [exact HEAD CI](https://github.com/kjg8619/pi/actions/runs/35483948383)는 PASS다. T3 `8486dbd48`은 실제 화면·전체 로컬 test/static/build를 확인했으나, workflow가 `main` push/PR만 대상으로 해 `devlop` CI는 **미실행**이다. 양쪽 결과·검증 fixture 수정·남은 한계는 [WORK_LOG의 LOG-097~100](docs/WORK_LOG.md)에 구분해 기록했다.

### C07 — 별도 opt-in control

T3 server에서 `T3_WEAVRA_CONTROL=1`을 명시해야 별도 `bridge --stdio --project-trusted --control` endpoint를 사용한다. 기존 read-only 명령/한도는 바꾸지 않는다. control의 닫힌 command 집합은 `control.hello`, `control.snapshot`, `workflow.prepare`, `workflow.confirm`, `workflow.cancel`, `approval.resolve`이며 요청은 newline 포함 32 KiB, 응답은 64 KiB다.

- Project panel에서 goal·선택적 recipe data·AC 문장만 입력한다. Runtime이 분류·scope·checks·frozen Task Contract·revision을 정한다. **Prepare는 Provider 호출 없이 preview를 만들며, AC 수정 후 새 preview를 확인하고 modal에서 명시적으로 확인해야 기존 Workflow를 시작한다.** 이 확인은 R3 삭제 승인이 아니다.
- owner UUID와 Runtime-issued 단조 증가 request ID, 최대 64개의 payload-bound receipt로 요청을 결합한다. 같은 epoch에서 evicted ID도 재실행하지 않는다. **ACK는 접수 결과이지 canonical Run의 성공·취소·승인 소비 결과가 아니다.** fresh canonical state에서 결과를 확인한다.
- 브라우저 disconnect/화면 이탈은 server-owned 실행을 종료하지 않는다. reconnect는 fresh canonical state를 읽으며 mutation을 자동 replay하지 않는다. cancel은 **이미 존재하는 owned Run**에만 가능하다. canonical Run 생성 전 model/Git/LSP preflight에는 wire cancellation ID가 없다. 취소 후 cleanup·terminal state를 확인하며 이미 발생한 부분 변경은 rollback하지 않는다.
- R3는 기존 **Git 추적 텍스트 파일 한 개 삭제**만 지원한다. `approval.resolve`는 Runtime의 현재 exact pending request에 대한 approve/reject 응답이며 grant·소비·Policy·완료 권한을 T3에 주지 않는다. 임의 write/edit/tool/shell, 범용 R3, COMPLEX, resume/recovery/rollback/fallback, 새 network Host는 없다.

**현재 actual proof:** 실제 T3 Project Settings에서 edited AC preview 갱신·modal 확인 전 model 호출 0회, 실행 후 실제 checks/독립 review·`COMPLETED`·active agents 0·writer 해제·파일 수정을 확인했다. 대기 중인 Developer에서 browser blank/reconnect 후 같은 RUNNING Run과 writer가 유지됐고, 명시적 cancel 후 `CANCELLED`·active agents 0·writer 해제·faux SSE 종료·부분 변경 보존을 확인했다. R3는 별도 확인 후 **CONSUMED → COMPLETED / 파일 삭제**, Reject 후 **DENIED → BLOCKED / 원본 보존**을 실제 화면과 canonical state로 확인했다.

실제 launcher의 replay·owner 교체·root 변경·과대/잘못된 framing·권한 위조도 거부됐고, 네 프로젝트의 browser raw WebSocket frames/UI에 credential/source sentinel이 없었다. 로컬 faux Provider를 사용한 실제 CLI/backend/UI proof이며 paid-provider 품질·다른 OS의 검증은 아니다. Pi full test/check/check:ci와 T3 전체 순차 회귀 **1,269 files / 17,262 PASS / 58 skipped**를 확인했다. 첫 T3 localhost timeout 1건은 [WORK_LOG](docs/WORK_LOG.md)에 보존한다. **C07은 bounded 범위에서 CLOSED**다. Pi 구현 `fd0f93d58`의 [exact CI](https://github.com/kjg8619/pi/actions/runs/35491863295)는 PASS, T3 `09de732fe`는 main/PR-only workflow에 따라 exact SHA runs/checks 0건으로 **미실행**이다. 이를 T3 remote PASS로 표시하지 않는다.

## Workflow & Risk

| 범위 | 실행과 완료 조건 |
|---|---|
| QUICK/R0 | read-only Executor, Reviewer 없음. finding은 보존하며 실제 파일 변경은 없어야 함 |
| QUICK/R1 | 고정 파일 1개·최대 100 changed-line span, Executor와 필수 checks. 잔여 위험은 STANDARD 필요 |
| STANDARD/R0–R1 | Developer, 독립 read-only Reviewer PASS, SELF_CHECK/TEST와 최신 diff |
| STANDARD/R2 | 제한된 파일 변경(허용된 manifest 포함), 독립 Reviewer 필수. 설치 도구 없음 |
| Scoped R3 | 허용된 Git tracked UTF-8 파일 1개(256 KiB 이하) 삭제만. 기본 Deny, 만료되는 Approve once, 독립 리뷰와 checks 필수 |

R3 요청 문법은 `Delete file src/obsolete.ts`, `Remove file src/obsolete.ts`, `파일 삭제 src/obsolete.ts`다. 일반 run 확인/Pi `--approve`는 별도 삭제 승인이 아니다. 분류는 보수적 규칙이며 불명확/혼합 unsafe 요청은 거부할 수 있다. 실행 중 권한 상승이나 자동 workflow 전환은 하지 않는다.

## Safety Model

- **자동 commit/rollback 없음.** 실패·취소 후 이미 발생한 변경은 남을 수 있다.
- Policy는 역할·허용/보호 경로·action을 검사하고 완료는 독립 리뷰/필수 checks/최신 digest와 저장 성공을 요구한다. stale PASS를 재사용하지 않는다.
- 프로젝트당 단일 writer. cleanup 미확인 시 lock을 보존하며 자동 탈취하지 않는다.
- Human Approval은 exact action에 대한 1회 동의이지 완료나 범용 권한이 아니다.
- **OS sandbox가 아니다.** 등록 check는 trusted code이고 내부 I/O/네트워크를 격리하지 않는다. 외부 파일 교체 경합과 악성 같은-process 코드를 완전히 막지 못한다.
- 정책은 Runtime worker/check 경로에 적용된다. **idle 상태의 일반 Pi 대화·기본 도구 전체를 sandbox하지 않는다.** launcher는 기존 Pi 리소스/설정을 끄거나 재작성하지 않는다.
- `.ai/state.json`은 운영 상태 원본이다. Pi JSONL은 Pi 소유이며 export는 실행/승인 authority가 아니다.

## Current Limitations

COMPLEX 실행, Planner/Lead 실행, 병렬 Agent, DAG scheduler, Windows, 범용 R3, arbitrary shell/install/deploy 도구, 자동 resume/checkpoint/recovery/rollback/fallback은 지원하지 않는다. T3 실행 요청은 위 별도 opt-in control의 닫힌 계약에 한정되며 임의 write/edit/tool/shell이나 전체 Runtime RPC 실행 권한을 제공하지 않는다. Print/JSON 모드에서는 Runtime 명령의 UI가 없어 명시적으로 실패한다.

DeepSeek 공식 API와 다른 Provider, Linux/다른 OS·Node 조합, 전체 upstream e2e 및 배포물 검증은 NOT VERIFIED다. CommandCode 경유 DeepSeek smoke는 한정된 조건의 관찰이며 [기록](docs/WEAVRA_COMMANDCODE_DEEPSEEK_SMOKE_2026-09-18.md)을 따른다. GPT validation의 한정된 PASS를 모든 환경/모델의 보장으로 확대하지 않는다.

## Roadmap

V0.2A의 순수 DTO/ASCII 조회 위에 V0.2B 정적 TUI Viewer를 연결했고 V0.6A/C07은 snapshots-only 관찰과 별도 opt-in control의 bounded 범위로 CLOSED다. V0.6B/C06은 [평가 전용 `weavra fitness` CLI](docs/WEAVRA_PROVIDER_FITNESS_PLAN_2026-09-20.md#9-c06-bounded-구현-계약)로 versioned corpus·private oracle·immutable raw results·read-only compare를 구현했다. actual calibration·closure 상태는 WORK_LOG를 따른다. 종합 점수·모델 자동 선택/fallback은 없다. Pi TUI live update, scheduler/COMPLEX/Planner/Lead/병렬화·Browser product는 별도 범위다.

내부 `CompanyKernel`, `CompanyExtensionOptions`, `registerCompanyRuntime`, `packages/company-runtime`, 세션 경로와 package `0.85.1` 메타데이터는 유지한다. 이는 Weavra 제품 버전이 아니다. 안정된 worker prompt와 역사적 설계/validation 기록의 기존 명칭도 보존한다. 상세 구현은 [Runtime 문서](packages/company-runtime/README.md), 작업 기록은 [WORK_LOG](docs/WORK_LOG.md)를 참고한다.

---

## Upstream Pi

아래는 재사용하는 Pi harness의 안내다. Pi 자체 기능·버전·배포 절차는 Weavra와 별개다.

<p align="center">
  <a href="https://pi.dev">
    <img alt="pi logo" src="https://pi.dev/logo-auto.svg" width="128">
  </a>
</p>
<p align="center">
  <a href="https://discord.com/invite/3cU7Bz4UPx"><img alt="Discord" src="https://img.shields.io/badge/discord-community-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
  <a href="https://www.npmjs.com/package/@earendil-works/pi-coding-agent"><img alt="npm" src="https://img.shields.io/npm/v/@earendil-works/pi-coding-agent?style=flat-square" /></a>
</p>

> New issues and PRs from new contributors are auto-closed by default. Maintainers review auto-closed issues daily. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Pi Agent Harness

This is the home of the Pi agent harness project including our self extensible coding agent.

* **[@earendil-works/pi-coding-agent](packages/coding-agent)**: Interactive coding agent CLI
* **[@earendil-works/pi-agent-core](packages/agent)**: Agent runtime with tool calling and state management
* **[@earendil-works/pi-ai](packages/ai)**: Unified multi-provider LLM API (OpenAI, Anthropic, Google, …)

To learn more about Pi:

* [Visit pi.dev](https://pi.dev), the project website with demos
* [Read the documentation](https://pi.dev/docs/latest), but you can also ask the agent to explain itself

## All Packages

| Package | Description |
|---------|-------------|
| **[@earendil-works/chord](packages/chord)** | Standalone application-composition runtime for services, replicated state, RPC, and plugins |
| **[@earendil-works/pi-telemetry](packages/telemetry)** | Vendor-neutral telemetry contracts, reference adapter, conformance tests, and typed schemas |
| **[@earendil-works/pi-ai](packages/ai)** | Unified multi-provider LLM API (OpenAI, Anthropic, Google, etc.) |
| **[@earendil-works/pi-agent-core](packages/agent)** | Agent runtime with tool calling and state management |
| **[@earendil-works/pi-coding-agent](packages/coding-agent)** | Interactive coding agent CLI |
| **[@earendil-works/pi-tui](packages/tui)** | Terminal UI library with differential rendering |

For Slack/chat automation and workflows see [earendil-works/pi-chat](https://github.com/earendil-works/pi-chat).

## Permissions & Containerization

Pi does not include a built-in permission system for restricting filesystem, process, network, or credential access. By default, it runs with the permissions of the user and process that launched it.

If you need stronger boundaries, containerize or sandbox Pi. See [packages/coding-agent/docs/containerization.md](packages/coding-agent/docs/containerization.md) for three patterns:

- **Gondolin extension**: keep `pi` and provider auth on the host while routing built-in tools and `!` commands into a local Linux micro-VM.
- **Plain Docker**: run the whole `pi` process in a local container for simple isolation.
- **OpenShell**: run the whole `pi` process in a policy-controlled sandbox.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines and [AGENTS.md](AGENTS.md) for project-specific rules (for both humans and agents).  Longer term plans for Pi can also be found in [RFCs](https://rfc.earendil.com/keyword/pi/).

## Development

```bash
npm install --ignore-scripts  # Install all dependencies without running lifecycle scripts
npm run build         # Refresh model data, then build all packages
npm run build:offline # Rebuild using existing model data without network access
npm run check         # Local format/fix and shared validation
npm run check:ci      # Non-mutating lint and the same shared validation
./test.sh            # Run tests (skips LLM-dependent tests without API keys)
./pi-test.sh         # Run pi from sources (can be run from any directory)
```

## Building standalone binaries from release source

GitHub releases include a versioned source archive covered by the release's `SHA256SUMS` file. Extract it and run the same build script used for the official standalone binaries:

```bash
VERSION="<release-version>"
tar -xzf "pi-${VERSION}-source.tar.gz"
cd "pi-${VERSION}"
./scripts/build-binaries.sh --offline-model-data --platform linux-x64 --out "$PWD/out"
```

The archive includes release model data and native prebuilds. `--offline-model-data` uses that model data without refreshing provider catalogs. The script installs dependencies and builds the executable with its runtime assets; pass `--skip-install` if dependencies are already provided.

## Supply-chain hardening

We treat npm dependency changes as reviewed code changes.

- Direct external dependencies are pinned to exact versions. Internal workspace packages remain version-ranged.
- `.npmrc` sets `save-exact=true` and `min-release-age=2` to avoid same-day dependency releases during npm resolution.
- `package-lock.json` is the dependency ground truth. Pre-commit blocks accidental lockfile commits unless `PI_ALLOW_LOCKFILE_CHANGE=1` is set.
- `npm run check` verifies pinned direct deps, native TypeScript import compatibility, and the generated coding-agent shrinkwrap.
- The published CLI package includes `packages/coding-agent/npm-shrinkwrap.json`, generated from the root lockfile, to pin transitive deps for npm users.
- Release smoke tests use `npm run release:local` to build, pack, and create isolated npm and Bun installs outside the repo before tagging a release.
- Local release installs, documented npm installs, and `pi update --self` use `--ignore-scripts` where supported.
- CI installs with `npm ci --ignore-scripts`, and a scheduled GitHub workflow runs `npm audit --omit=dev` plus `npm audit signatures --omit=dev`.
- Shrinkwrap generation has an explicit allowlist for dependency lifecycle scripts; new lifecycle-script deps fail checks until reviewed.

## Share your OSS coding agent sessions

If you use Pi or other coding agents for open source work, please share your sessions.

Public OSS session data helps improve coding agents with real-world tasks, tool use, failures, and fixes instead of toy benchmarks.

For the full explanation, see [this post on X](https://x.com/badlogicgames/status/2037811643774652911).

To publish sessions, use [`badlogic/pi-share-hf`](https://github.com/badlogic/pi-share-hf). Read its README.md for setup instructions. All you need is a Hugging Face account, the Hugging Face CLI, and `pi-share-hf`.

You can also watch [this video](https://x.com/badlogicgames/status/2041151967695634619), where I show how I publish my `pi-mono` sessions.

I regularly publish my own `pi-mono` work sessions here:

- [badlogicgames/pi-mono on Hugging Face](https://huggingface.co/datasets/badlogicgames/pi-mono)

## License

MIT

<p align="center">
  <a href="https://pi.dev">pi.dev</a> domain graciously donated by
  <br /><br />
  <a href="https://exe.dev"><img src="packages/coding-agent/docs/images/exy.png" alt="Exy mascot" width="48" /><br />exe.dev</a>
</p>
