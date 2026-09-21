# Weavra Roadmap — Post V0.3B

> 작성일: 2026-09-17 (KST)  
> 대상 브랜치: `devlop`  
> 기준 소스: `a3eae0c86b8ea19d2bb9173c66cf2ebc001b4e10`  
> 기준 상태: V0.3B Read-only LSP Diagnostics / Navigation 구현·자동 회귀·실제 TS/Provider smoke 완료  
> 안정 기준점: `weavra-v0.1-rc1` — 이동/수정하지 않음

이 문서는 V0.3B 이후의 **실행 순서와 완료 기준을 고정하기 위한 개발 로드맵**이다.

기존 `MASTER_SPEC`, `ARCHITECTURE`, `DECISIONS`, `IMPLEMENTATION_PLAN`, `WORK_LOG`를 대체하지 않는다. 세부 설계의 근거는 다음 문서를 함께 따른다.

- `docs/WEAVRA_IMPROVEMENT_AND_FEATURE_RESEARCH_2026-09-17.md`
- `docs/WEAVRA_OMP_OMO_ADOPTION_PLAN.md`
- `docs/WORK_LOG.md`
- `docs/V0.1_READINESS.md`

로드맵의 버전명은 개발 단계 표기이며 정식 release/tag 선언이 아니다.

**2026-09-17 후속 상태:** V0.3C FIX-01/02/04 구현과 로컬 자동 회귀를 완료했다(착수 HEAD `dd3c3f706023caae693b1e67204531c5df8676f5`, WORK_LOG LOG-046). Node26/macOS 49 files / 1,646 PASS, Node22/macOS targeted 18 files / 800 PASS, check:ci 전후 tracked bytes 불변을 확인했다. 실제 GitHub Actions/Node22 Linux build-test·fresh install 전체·branch protection은 NOT VERIFIED이며 CI YAML 구성을 실제 원격 PASS로 확대하지 않는다. 아래 다른 단계는 별도 상태 표기를 따른다.

**V0.3D 후속 상태:** FIX-03/FIX-06/runtime_list_files를 구현하고 자동 회귀를 수행했다(WORK_LOG LOG-048). Provider smoke 1회는 snapshot 전달/list tool 선택 후 `path:"."`를 Policy가 거부해 FAILED/무변경으로 끝났다. `{}` 안내 보완 후 실제 end-to-end 성공은 NOT VERIFIED이며 self-hosting claim은 하지 않는다.

**V0.3E 후속 상태:** FIX-05 Acceptance Criteria와 FEAT-01 Plan Preview를 구현하고 자동 회귀·실제 Provider smoke를 수행했다(WORK_LOG LOG-057). Host가 순차 AC ID(`AC-001`…)를 부여하고 Plan Preview 확인 후 frozen digest로 고정하며, Developer/Executor/Reviewer는 AC ID로만 결과/evidence를 제출한다. Kernel 완료 guard가 missing/duplicate/unknown/UNMET/stale을 거부한다. DeepSeek STANDARD/EDIT와 GPT 교차 각 1회 COMPLETED(2 AC MET), R2/R3·미충족 AC의 live smoke는 NOT VERIFIED다.

**V0.3F 후속 상태:** worker measurement·budget controller·provenance·Evidence Pack(`/state evidence`)·evals adapter/fixture 6개를 구현하고 자동 회귀·실제 DeepSeek/GPT smoke를 완료했다(WORK_LOG LOG-059). 실제 Plain Pi vs Weavra 비교 실행과 20개 corpus 확장은 NOT VERIFIED다.

---

## 1. 현재 기준선

V0.3B까지 다음 기반을 확보했다.

```text
V0.1 Runtime / GPT RC
  ↓
Branding / fork-local launcher / Status
  ↓
Worktree create / open / list
  ↓
V0.2A Read-only DAG Projection
  ↓
V0.2B Read-only TUI DAG Viewer
  ↓
V0.2C Product Isolation / setup / doctor
  ↓
V0.3A Hash-Anchored Edit
  ↓
V0.3B Read-only LSP Diagnostics / Navigation
```

현재 강점은 에이전트 수가 아니라 다음 경계다.

- Kernel이 workflow 전이와 완료를 결정한다.
- Developer/Executor와 Reviewer 권한을 분리한다.
- Policy, 독립 Review, Human Approval을 같은 의미로 취급하지 않는다.
- required process check와 advisory evidence를 구분한다.
- mutation 전 anchored freshness와 완료 전 stale evidence guard를 함께 사용한다.
- `.ai` Runtime state와 `~/.weavra/agent` user-level 상태를 분리한다.
- 자동 commit/merge/stash/reset/rollback/resume을 하지 않는다.

V0.3B 시점 자동 targeted regression은 `47 files / 1,565 PASS`이며, 실제 TypeScript LSP query와 `codex-lb / gpt-6-astra` STANDARD/R1 smoke를 별도로 확인했다. 이 수치는 해당 기준점의 기록이며 이후 HEAD에 자동 승계하지 않는다.

---

## 2. 로드맵 원칙

이후 개발은 세 축으로 관리한다.

```text
                    Weavra

     ┌──────────── Safety ────────────┐
     │ execution contract            │
     │ Policy / Approval             │
     │ anchored / strict mutation    │
     │ verifier trust / sandbox      │
     └────────────────────────────────┘

     ┌───────── Intelligence ─────────┐
     │ project instructions          │
     │ file discovery / repo context │
     │ LSP                           │
     │ acceptance criteria           │
     └────────────────────────────────┘

     ┌──────── Measurement ───────────┐
     │ telemetry / budget            │
     │ evals                         │
     │ evidence pack                 │
     │ provenance                    │
     └────────────────────────────────┘
```

우선순위 원칙:

1. **권한을 먼저 고정하고 기능을 늘린다.**
2. **프로젝트 맥락과 완료 조건을 명확히 한 뒤 agent 수를 늘린다.**
3. **새 기능의 효과를 eval/usage로 측정할 수 있어야 한다.**
4. **read-only evidence를 execution authority로 승격하지 않는다.**
5. **외부 프로그램을 사용한다고 sandboxed라고 표현하지 않는다.**
6. **COMPLEX/Parallel은 마지막 단계까지 보류한다.**

---

## 3. 권장 단계 요약

| 단계 | 목표 | 연구 문서 매핑 | 우선순위 |
|---|---|---|---|
| **V0.3C — Trust Baseline** | 설치·CI·실행 권한 계약 고정 | FIX-01, FIX-02, FIX-04 | 구현·로컬 회귀 완료; 원격 CI 환경 별도 확인 |
| **V0.3D — Project Context** | 프로젝트 규칙·파일 탐색·JVM risk 보강 | FIX-03, FIX-06, FEAT-02 일부 | 구현·자동 검증; Provider 완료 smoke 실패/후속 미검증 |
| **V0.3E — Task Contract** | 복합 요청을 검증 가능한 AC로 고정 | FIX-05, FEAT-01 | 높음 |
| **V0.3F — Measurement & Evidence** | 실제 품질·비용·실패를 측정/설명 | FEAT-03, FEAT-04, FEAT-05, FIX-09 | 높음 |
| **V0.4A — Mutation Hardening** | anchored protection을 strict mutation으로 확장 | FIX-07 | **완료**(LOG-064·LOG-065). compatible 기본 + opt-in strict receipt/identity, create/replace 분리, deletion/재생성 typed stale, NUL 거부. DeepSeek strict actual **COMPLETED** |
| **V0.4B — Verifier Trust** | 검증 기준/entrypoint의 신뢰성 강화 | FIX-08 | **완료**(LOG-066·LOG-067) |
| **V0.4C — Verifier Sandbox** | registered check process에 OS 경계 추가 | FEAT-07 | **CLOSED**(LOG-069·LOG-070). macOS actual PASS / Linux actual **NOT VERIFIED**(runner 외부 blocker, PASS로 표기하지 않음) / deterministic cross-platform contract PASS / remote CI PASS / DeepSeek strict+trust+sandbox actual **COMPLETED** |
| **V0.5A — Task Context Pack / Repo Map** | Host-selected bounded advisory context | C01 | **CLOSED**(LOG-071). opt-in `agents.context_pack.mode`, 48 KiB absolute cap, real LspPort symbols/references, TaskContextAgentExecutor, measurement/evidence/preview projection, leakage·freshness·A/B 회귀, DeepSeek actual COMPLETED |
| **V0.5B — Task Recipes** | 반복 작업을 기존 Task Contract로 변환하는 reviewed recipe | C03 | **CLOSED**(LOG-075~079). STANDARD-only reviewed recipe 4종·strict input·사용자 edited AC·Plan Preview·bounded provenance. DeepSeek actual COMPLETED/oraclePass true, production command A/B·negative 및 full local 회귀 PASS, 구현 HEAD remote CI PASS |
| **V0.5C — Bounded Verification Repair** | 허용된 검증 실패에 한해 최대 1회 새 attempt로 복구 | C02 | **CLOSED**(LOG-081~085). opt-in STANDARD/EDIT/R1·SELF_CHECK 1회, durable failed parent·fresh session/context/receipt·독립 review/test·누적 budget. `codex-lb/gpt-6-astra` actual **COMPLETED / oraclePass true / falseCompletion false**, strict mutation/trust·macOS required sandbox·현재 full local PASS. 초기 defect 통제 실험이며 Linux actual·모든 모델/OS 보장이 아님 |
| **V0.5D — Impact Review & Versioned Docs** | 변경 영향 문맥과 버전 고정 문서를 Reviewer 입력으로 보강 | C04, C05 | **CLOSED, bounded 범위**(LOG-086~093). fresh impact·exact-declaration reviewed docs·summary-only projection·negative/A-B/full local PASS. Astra actual 1회 **COMPLETED / oracle PASS / fresh impact/docs / strict trust·macOS sandbox**. 구현 `0d4e91936` 및 별도 closure `9331b3ed9`의 exact CI 모두 PASS |
| **V0.6A — T3 Code Host Bridge** | 구조화 명령·이벤트·승인·취소·재연결 Host 계약 | C07 | **CLOSED, bounded 범위**(LOG-101~105). legacy read-only 유지 + 별도 opt-in control. actual COMPLETE·cancel/reconnect·R3 approve/consume·reject·adversarial proof, 양쪽 전체 로컬 gate, Pi `fd0f93d58` exact CI PASS. T3 `09de732fe`는 devlop CI 미실행을 명시; 새 network Host 없음 |
| **V0.6B — Provider Fitness Matrix** | Provider/model/endpoint별 Weavra 계약 적합성의 재현 가능한 평가 | C06 | **CLOSED**(LOG-114~116). [독립 audit·v3 full actual](WEAVRA_PROVIDER_FITNESS_PLAN_2026-09-20.md#16-fresh-v3-actual-full-collection), 두 target 각각 10 fixture·read-only 비교/UI·최종 전체 회귀. Historical v1/v2·실패/UNKNOWN 보존. Source `b2b938aa2`와 evidence `d67ce3968` exact CI PASS. Winner/fallback 없음 |
| **V0.6C — Jev Browser Evidence** | 격리된 관찰을 Host-reviewed regression check와 fresh evidence로 연결 | C08 | **CLOSED, local-static bounded 범위**(LOG-119~121). Candidate v2 → Host preview/confirm → registry/RegisteredVerifier → fresh SELF_CHECK/TEST → Kernel. 실제 Chromium·SDK faux whole workflow·T3 UI와 최종 전체 로컬 회귀 PASS. Pi `de66efe2a` [exact CI 35552773990](https://github.com/kjg8619/pi/actions/runs/35552773990) PASS, T3 `f6ff0ae0f` remote NOT RUN. Browser actions/auth/session 재사용/remote crawling은 제외 |
| **Later** | Facts / Capability Broker / COMPLEX / Parallel | FEAT-06, 09, Team Mode | 수요·측정 기반 |

---

# 4. V0.3C — Trust Baseline

**상태: 구현·로컬 회귀 완료.** 아래 세 FIX만 반영했다. READ_ONLY 후보 제안은 권한이 아니며 Host가 mode를 확인한 뒤 run에 고정한다. tool surface/Policy/StateStore binding/Kernel no-change guard를 함께 집행한다. legacy 필드 부재는 UNKNOWN으로 조회하고 새 live 실행에 권한을 부여하지 않는다. READ_ONLY/R3는 risk를 낮추지 않고 preflight에서 거부하며 R2 mandatory review는 유지한다.

CI는 `main/devlop` push/PR, non-write `check:ci`, 격리 `test.sh`, launcher syntax 및 final tracked-diff guard로 구성했다. 기존 build의 tracked 모델 카탈로그 재생성을 피하려고 ignored data hydration 뒤 `build:offline`을 사용한다. 실제 Actions 실행과 Node22/Linux 환경 결과는 아직 검증하지 않았다.

## 목표

사용자 요청 해석과 실제 실행 권한을 분리하고, `devlop`의 설치/회귀 검증 경계를 개발 기본값으로 만든다.

### 포함 범위

#### FIX-01 — 개발판 설치 기준 명시

개발판 설치 문서는 `devlop`을 명시한다.

```sh
git clone --branch devlop --single-branch https://github.com/kjg8619/pi.git weavra
```

문서에서 다음 관계를 분명히 한다.

```text
main                 upstream/base Pi 계열

devlop               current Weavra development

weavra-v0.1-rc1      immutable historical RC baseline
```

checkout/source 변경 후 fork-local Pi rebuild가 필요하다는 기존 계약을 유지한다.

#### FIX-02 — devlop CI + non-mutating check

현재 `main` 중심 CI에서 `devlop` 핵심 회귀가 자동 실행되도록 보강한다.

CI에서는 코드 수정형 검사와 검증을 분리한다.

예시 목표:

```text
npm run check          local developer format/fix 포함 가능
npm run check:ci       tracked source를 수정하지 않는 CI gate
```

구현은 `check:ci`에 non-write Biome 및 기존 shared validation 전체를 두고, tests/shell syntax/final diff guard는 CI의 별도 단계로 둔다. CI pipeline은 다음을 포함한다.

- Biome non-write 검사
- TypeScript/type import/entry graph 검사
- shrinkwrap/install-lock 검사
- Weavra Runtime targeted tests
- coding-agent Weavra integration tests
- launcher shell syntax
- 종료 후 tracked diff 0 확인

실제 Provider 호출은 일반 CI에 넣지 않는다.

#### FIX-04 — Execution Contract

기존 분류:

```text
intent
complexity
risk
```

와 별도로 실행 권한 계약을 둔다.

최소 후보:

```ts
type ExecutionMode = "READ_ONLY" | "EDIT";
```

READ_ONLY는 다음 경계로 강제한다.

```text
Host-confirmed READ_ONLY / EDIT → frozen Run.executionMode
READ_ONLY
   ├─ Worker write/edit/delete 미노출
   ├─ Policy mutation DENY + persisted run/mode binding
   └─ Kernel completion: actual changedFiles = 0
```

기존 registered process의 I/O는 sandbox하지 않는다. 관찰된 변경은 READ_ONLY 완료를 막지만 사후 guard를 사전 process 차단으로 과장하지 않는다. mode가 없는 과거 state는 read-only observation만 호환하고 자동 migration/permission default/resume는 하지 않는다.

자연어 분류기나 모델은 execution mode를 제안할 수 있으나 권한 원본이 될 수 없다.

### 대표 부정 테스트

- `오류 원인을 설명해줘`
- `삭제하지 말고 삭제 로직을 설명해줘`
- 위험 단어를 인용한 설명 요청
- QUICK/R0 direct mutation call
- STANDARD/R0 direct mutation call
- Korean/English negation
- 공백/한글 경로 + 문장부호

READ_ONLY에서는 `write/edit/delete`가 실제 mutation 전에 거부되어야 한다.

### DoD

- `devlop` 개발판 설치 절차가 재현된다.
- `devlop` push/PR에서 핵심 CI가 실행된다.
- CI 검증 후 tracked diff가 없다.
- READ_ONLY는 QUICK/STANDARD 양쪽에서 mutation tool 미노출 + Policy DENY를 만족한다.
- R2/R3 minimum risk/approval 의미가 약화되지 않는다.
- 기존 V0.3A/V0.3B regression을 유지한다.
- `weavra-v0.1-rc1`은 불변이다.

---

# 5. V0.3D — Project Context

**상태: 세 범위의 구현·자동 검증 완료.** 실제 Provider 1회 결과와 아직 확인하지 못한 성공 경로는 [smoke 기록](WEAVRA_V03D_PROVIDER_SMOKE_2026-09-17.md)에 구분한다. 전체 JVM build 실행이나 self-hosting을 검증한 단계가 아니다.

## 목표

Agent가 프로젝트의 명시적 규칙과 관련 파일을 더 정확하게 찾도록 하되 자동 resource discovery로 권한 경계를 넓히지 않는다.

### FIX-03 — Project Instructions Snapshot

기존 `projectInstructions` seam을 기본 Host가 전달하는 explicit config에 연결했다. trusted Agent adapter의 run preflight에서 한 번 안전하게 snapshot하고 동일 instance의 Developer/Executor/Reviewer에 고정한다.

초기 범위는 사용자가 명시한 파일 하나다.

```yaml
project:
  instructions:
    path: AGENTS.md
```

Run 시작 시 다음을 고정한다.

```text
path
bytes/content digest
size
selected-at-run-start
```

Developer/Executor/Reviewer는 동일 instruction snapshot을 받는다. 64 KiB strict UTF-8/regular/single-link/no-follow/ancestor identity 경계를 적용하고 truncate하지 않는다. Host-selected path는 worker allowed_paths 밖일 수 있지만 protected 경계는 넘지 못한다. Run/Policy에는 path/digest/bytes와 digest binding만 남기고 content는 frozen memory input이다. 선택 path는 worker protected path에 추가하여 list/read/search/LSP/mutation에서 숨기고 외부 변경을 prompt에 다시 읽어 넣지 않는다.

금지:

- 자동 AGENTS/SYSTEM/Skill/Extension 전체 탐색
- instruction 내용으로 Policy 완화
- stale instruction을 현재 규칙으로 재사용

### FEAT-02 일부 — runtime_list_files

`runtime_search`는 기존 explicit paths 계약을 유지한다. 새 Node fs read-only discovery를 추가했다. 기본 호출은 `runtime_list_files({})`이며 path를 생략해야 configured allowed roots를 사용한다. `.`/`/`/`..`는 허용 root의 별칭이 아니다.

구현:

```text
runtime_list_files
```

경계:

- allowed paths 내부
- protected path 제외
- symlink traversal 금지
- 최대 500 files/64 KiB, maxDepth 0..4(default 4), roots 32, enumeration/visit 각각 4,096
- deterministic lexical ordering 및 명시적 truncated/remainder-not-counted
- shell/find/fd/ripgrep 호출 없음; content/stat/absolute path 반환 없음
- node_modules·security protected 경로만 강제 제외; dist/build/coverage/target은 explicit allowed 범위면 유지
- .gitignore 전체 semantics와 무제한 recursive search는 구현하지 않음

V0.3B LSP와 조합한다.

```text
list files
   ↓
read/search
   ↓
LSP definition/references/symbols
```

Repo-wide semantic index/vector DB는 아직 만들지 않는다.

### FIX-06 — JVM dependency/build risk

우선 다음 계열을 dependency/build 변경으로 다룬다.

```text
pom.xml
build.gradle
build.gradle.kts
settings.gradle
settings.gradle.kts
gradle.properties
gradle/libs.versions.toml
gradle/wrapper/gradle-wrapper.properties
.mvn/wrapper/maven-wrapper.properties
```

exact suffix/filename을 case-insensitive로 검사하고 module prefix를 지원한다. `.bak/.txt/.notes` 등 유사 이름과 `.mvn` 전체는 포함하지 않는다. R1 run이 R2 최소 위험 파일을 만나면 현재 run을 자동 승격하지 않고 새 STANDARD/R2 run을 요구한다. READ_ONLY read/list/search는 가능하지만 mutation permission은 없다.

### DoD

- selected instruction이 Developer/Reviewer에 동일하게 전달된다.
- instruction 변경은 다음 Run에서 새 snapshot을 사용한다.
- `runtime_list_files`가 protected/outside/symlink 결과를 노출하지 않는다.
- Java/Spring/Gradle/Maven fixture에서 dependency risk가 정확히 동작한다.
- LSP와 file discovery가 mutation authority를 갖지 않는다.

---

# 6. V0.3E — Task Contract

**상태: 구현·자동 회귀·실제 Provider smoke 완료(WORK_LOG LOG-057).** AC ID는 Host가 순차 부여하고 Plan Preview 확인 후 frozen contract + digest로 고정된다. 아래 DoD 중 R2/R3 live 흐름과 미충족 AC의 live 부정 경로는 deterministic test로만 검증했으며 NOT VERIFIED다. 자세한 결과는 [V0.3E smoke](WEAVRA_V03E_TASK_CONTRACT_SMOKE_2026-09-18.md)를 따른다.

## 목표

`requirements: [goal]` 한 항목으로 처리하던 복합 요청을 검증 가능한 Acceptance Criteria로 분해한다.

### FIX-05 — Acceptance Criteria

후보 모델:

```text
Task
  ├─ AC-001
  │   ├─ statement
  │   ├─ verification method
  │   └─ scope
  ├─ AC-002
  └─ ...
```

완료 시:

```text
AC ID
→ MET / UNMET / UNVERIFIED
→ evidenceRef
→ revision / diffDigest
```

를 연결한다.

Developer/Reviewer가 AC 목록을 실행 중 임의로 축소/교체하지 못하게 한다.

### FEAT-01 — Plan Preview

초기 버전은 별도 Planner agent 없이 Host 구조화 preview로 시작한다.

```text
User goal
   ↓
Host interpretation
   ↓
ExecutionMode / Risk / Scope
   ↓
Acceptance Criteria
   ↓
planned checks / roles
   ↓
user confirmation if required
   ↓
frozen Task Contract
```

Plan 확인은 R3 Human Approval과 별개다.

### DoD

- AC 하나만 미충족인 fixture가 COMPLETED되지 않는다.
- duplicate/missing/unknown AC evidence를 거부한다.
- 과거 revision의 stale evidence 재사용을 거부한다.
- 독립 acceptance oracle을 구현 agent가 변경하지 못한다.
- 작은 QUICK 작업에 불필요한 Planner model call을 강제하지 않는다.

---

# 7. V0.3F — Measurement & Evidence

**상태: 구현·자동 회귀·실제 smoke 완료(WORK_LOG LOG-059).** provider-reported usage 기반 측정, optional budget(호출 수 사전 차단·token fail-closed), provenance snapshot, `/state evidence` projection, deterministic eval fixture 6개가 반영됐다. 실제 Plain Pi 대비 비교와 repetition 반복은 NOT VERIFIED다.

## 목표

"Weavra가 실제로 더 나은가?"를 성공/비용/지연/실패 기준으로 측정할 수 있게 한다.

새 observability framework를 만드는 대신 기존 repository 자산을 우선 재사용한다.

```text
packages/evals
packages/telemetry
```

### FEAT-03 — Usage / Budget

관측 후보:

- provider/model/thinking
- role/attempt/revision
- input/output/cache/reasoning usage
- latency
- tool call count
- result/status

누락된 usage는 `0`이 아니라 `UNKNOWN`이다.

BudgetController는 telemetry exporter와 분리한다.

### FEAT-04 — Weavra Eval Adapter

동일 fixture에서 다음을 비교한다.

```text
Plain Pi
Weavra QUICK
Weavra STANDARD
```

동일 조건을 기록한다.

```text
baseline commit
provider/model/thinking
checks
feature flags
budget
```

초기 내부 eval set은 약 20개 fixture부터 시작할 수 있다.

### FEAT-05 — Evidence Pack

기존 state의 파생 projection으로 다음을 묶는다.

```text
goal / AC results
changed files / diff digest
process checks
LSP evidence
Reviewer result
approval consumption
partial changes / cleanup
usage / latency
known limitations
```

Evidence Pack은 새로운 execution authority가 아니다.

### FIX-09 — Provenance

관측 가능한 범위에서 다음을 표시한다.

```text
Runtime source commit
fork-local CLI build provenance
config digest
worker provider/model/thinking
```

알 수 없으면 `UNKNOWN`으로 표시한다.

### DoD

- Pi/QUICK/STANDARD 비교를 동일 fixture에서 재현할 수 있다.
- false completion을 독립 oracle로 측정할 수 있다.
- token/latency가 중복 합산되지 않는다.
- telemetry 실패가 무제한 budget을 허용하지 않는다.
- 공개 evidence에 credential/전체 reasoning/raw secret env를 넣지 않는다.

---

# 8. V0.4A — Mutation Hardening

## 구현 상태 (LOG-064 · LOG-065)

아래 후보 설계는 **구현 완료**다. 후보와 구현 사실을 구분해 기록한다.

- `mutation: { mode: compatible | strict }`(기본 compatible): trusted frozen config, `configDigest` 포함, Plan Preview에 `Mutation mode:` 표시.
- strict 기존 파일 mutation은 **최신 strict anchored read의 receipt+digest(+edit은 anchor)** 를 요구하고, receipt registry가 read-time filesystem identity(`dev/ino/mode/size/mtimeNs/ctimeNs`, 같은 read snapshot에서 capture)를 함께 보관한다. deletion·동일 bytes 재생성 모두 typed stale이며 ENOENT만 stale로 변환한다(EACCES/ELOOP/symlink·hardlink 위반·Policy DENY는 fatal 유지).
- `runtime_write`는 `operation=create`(must-not-exist, OS `O_CREAT|O_EXCL|O_NOFOLLOW`)와 `operation=replace`(fresh receipt+digest)로 분리했고 서로 fallback하지 않는다. strict content는 256 KiB·NUL·lossy UTF-8을 거부한다.
- stale은 같은 worker session에서 re-read→재시도로 bounded correction이 가능하고 자동 retry는 없다.
- 결정론적 회귀: Runtime 36개 파일·1,194개 + coding-agent Weavra 11개 파일·449개 + evals 6개 파일·33개 = **53개 파일·1,676개 PASS**.
- 실제 Provider: `commandcode/deepseek/deepseek-v4.1-flash` STRICT `standard-2ac`에서 외부 변경 1회 주입 후 `STALE_ANCHOR → 재-read → fresh receipt → edit 성공 → checks PASS×2 → 독립 Reviewer PASS → COMPLETED`(37,829 tokens)를 확인했다.
- **NOT VERIFIED:** 다른 모델/Provider, R2/R3·QUICK strict actual smoke, remote GitHub Actions 실제 PASS, external TOCTOU 완전 해소(주장하지 않음).

## 목표

V0.3A의 optional anchored edit를 기존 파일 mutation의 opt-in strict contract로 확장한다.

### FIX-07

strict mode 후보:

```text
existing file edit
→ latest read receipt / digest required

new file
→ must-not-exist precondition

replace
→ explicit replacement contract
```

strict mode에서는 `runtime_write`로 stale guard를 우회할 수 없어야 한다.

호환 모드는 당장 제거하지 않는다.

### 추가 실제 smoke

V0.3A에서 남긴 미검증 항목을 확인한다.

```text
anchored read
→ external change
→ STALE
→ actual Provider re-read
→ new anchor
→ successful bounded edit
```

---

# 9. V0.4B — Verifier Trust

## 구현 상태 (LOG-066 · LOG-067 closure)

- `verification.trust.mode: compatible | strict`(기본 compatible)와 `checks[].trust.files`(explicit oracle, workspace-relative literal, protected path 금지)를 추가했다.
- strict는 Run 시작 시 registration digest(check id/kind/required/executable/argv/cwd/timeout/filtered env/config digest/trust mode/sources), resolved executable identity, direct argv source + explicit trust file의 **content SHA-256 + filesystem generation**(dev/ino/mode/size/mtimeNs/ctimeNs)을 freeze하고 process **직전과 직후**, 그리고 result settle 직전에 재검증한다.
- process가 oracle을 바꾸고 exit 0이어도 PASS가 아니며, executable 교체·delete+동일 bytes 재생성·mtime-only 변경도 stale이다. pre-process stale이면 process를 아예 실행하지 않는다.
- trusted source는 Worker protectedPath가 되어 Developer/Executor가 oracle을 수정·열람할 수 없다(기존 Policy DENY semantics).
- Kernel은 Host가 고정한 `trustRequired`로 독립 검증한다: fake verifier가 trust 없이 PASS를 반환해도 completion 불가.
- CheckResult/Evidence Pack에는 bounded trust metadata(mode/status/registrationDigest/executableDigest/sources[{path,digest}])만 담는다. legacy 결과는 `UNKNOWN (legacy)`이며 자동 VERIFIED로 승격하지 않는다.
- **sandbox가 아니다.** network/filesystem isolation은 V0.4C(FEAT-07)이며, transitive package/plugin dependency graph는 freeze하지 않는다(NOT VERIFIED).
- LOG-067 closure: registration digest가 실제 filtered env를 canonical 형태로 bind하고, executableDigest는 real SHA-256 identity digest이며, Kernel이 Host-frozen registration digest까지 비교한다. Reviewer/Worker prompt가 protected oracle 비열람을 명시한다.
- 결정론적 회귀: Runtime 36개 파일·1,207개 + coding-agent Weavra 11개 파일·449개 + evals 6개 파일·33개 = **53개 파일·1,689개 PASS**.
- 실제 Provider: strict trust Run이 **COMPLETED**다. self-check와 test가 각각 `PASS` + `Verifier trust: VERIFIED (strict)`, **동일한 Host-frozen registration digest**(`sha256:5ed65ff6512d6…`), Reviewer PASS(독립, protected oracle 직접 접근 0회), oraclePass true, 22,515 reported tokens(LOG-067). 이전 시도의 Reviewer DENY 실패는 LOG-066에 역사적으로 남긴다.

## 목표

검증 프로그램이 존재한다는 사실과 검증 기준 자체가 신뢰 가능하다는 사실을 구분한다.

### FIX-08

고정 후보:

```text
entrypoint
argv
cwd
config/source digest
Host-owned acceptance test
```

구현 agent가 완료 기준 테스트나 verifier entrypoint를 바꿔 거짓 PASS를 만드는 부정 fixture를 둔다.

등록 check를 shell-free라고 해서 sandboxed라고 표현하지 않는다.

---

# 10. V0.4C — Verifier Sandbox

## 구현 상태 (LOG-069 · LOG-070)

등록된 verification check process만 OS 경계로 감싼다. Worker/LSP/Git/launcher는 기존 경로를 유지한다.

- `verification.sandbox.mode: disabled | required`(기본 disabled), backend는 `@anthropic-ai/sandbox-runtime@0.0.76` exact pin(company-runtime runtime dependency; root legacy 0.0.26 유지).
- Host-owned fixed policy: network deny-all, workspace read/write 허용, trusted oracle read 허용·write deny, `.git`/`.ai`/`.env`/project instruction read·write deny, Host 외부 read/write deny, symlink escape deny. `required`는 backend preflight 실패 시 unsandboxed fallback 없이 fail closed다.
- `sandboxPolicyDigest`(canonical settings + backend identity)를 Host가 freeze하고 Kernel guard가 `mode required` + `ENFORCED` + digest 일치를 요구한다.
- **CLOSED 기준(option 3):** macOS actual **PASS** / Linux actual **NOT VERIFIED**(runner 외부 blocker 2건: ubuntu-latest unprivileged userns의 `bwrap RTM_NEWADDR` 거부, ubuntu-22.04 SRT 패키지의 vendored seccomp helper 부재) / deterministic cross-platform contract PASS / remote CI PASS / DeepSeek strict+trust+sandbox actual COMPLETED.
- 한계: SRT Beta Research Preview, container/VM 아님, transitive dependency graph는 boundary 아님, 비협조 외부 process TOCTOU 미제거, Windows 미지원.

## 목표

등록된 검증 프로그램의 파일/네트워크/process 접근을 OS 수준에서 제한한다.

초기 sandbox 대상은 Worker가 아니라 **Verifier**다.

후보 조사:

- existing Pi sandbox examples
- Anthropic sandbox-runtime 계열
- POSIX/macOS/Linux 지원 차이

필수 원칙:

- sandbox unavailable 시 silent host fallback 금지
- host auth 비노출
- network default deny 후보
- child process cleanup 확인
- sandbox가 Policy/Approval을 대체하지 않음

---

# 10.5. Agent Landscape 반영 후속 순서

2026-09-18의 [AI 코딩 에이전트 유형별 조사 및 도입 제안](WEAVRA_AGENT_LANDSCAPE_AND_ADOPTION_2026-09-18.md)을 후속 로드맵 입력으로 채택한다. 외부 코딩 에이전트 런타임을 중첩 실행하기보다, 현재 Weavra의 Kernel/Policy/Task Contract/Verifier/Evidence 경계를 유지하면서 효과적인 패턴만 작은 모듈로 흡수한다.

채택 순서는 다음과 같다.

```text
V0.4C  Verifier Sandbox
   ↓
V0.5A  C01 Task Context Pack / Repo Map
   ↓
V0.5B  C03 Task Recipes / Reviewed Skill Packs
   ↓
V0.5C  C02 Bounded Verification Repair
   ↓
V0.5D  C04 Impact-aware Review Pack
        + C05 Versioned Documentation Pack
   ↓
V0.6A  C07 T3 Code Host Bridge
   ↓
V0.6B  C06 Provider Contract/Fitness Matrix
   ↓
V0.6C  C08 Jev Browser Explorer → Regression Evidence
   ↓
Facts / Capability Broker
   ↓
COMPLEX / Parallel
```

이 순서의 이유:

- **V0.4C가 먼저다.** V0.4B는 LOG-067에서 CLOSED됐지만 Verifier 실행 자체는 아직 OS sandbox가 아니다. C02의 자동 복구와 C08의 외부 브라우저 행동 범위를 넓히기 전에 verifier/file/network/process 격리 경계를 먼저 닫는다.
- **C01을 기능 확장의 첫 단계로 둔다.** 새 탐색 agent를 바로 추가하지 않고 기존 `runtime_list_files` / read/search / LSP / instruction snapshot을 bounded Task Context Pack으로 조합해 관련 코드 발견률과 토큰 사용을 먼저 측정한다.
- **C03은 새 Planner가 아니다.** bugfix/safe-refactor/test-addition/read-only-investigation 같은 reviewed recipe를 기존 Plan Preview와 frozen Task Contract의 입력 템플릿으로 사용한다.
- **C02는 최대 1회 bounded repair로 시작한다.** 초기 범위는 opt-in STANDARD/EDIT/R1이며 Provider/Auth/Policy/Storage/Cleanup/Cancel/R3/READ_ONLY 실패는 자동 복구하지 않는다. 이전 실패 evidence와 budget을 보존하고 새 attempt에서 stale evidence/receipt/review를 재사용하지 않는다.
- **C04/C05는 Reviewer 입력 품질을 높이는 한 묶음으로 진행한다.** C01의 symbol/caller/test 문맥을 재사용하고, 공식·reviewed 문서에는 version/source/capturedAt을 붙인다. advisory evidence를 completion authority로 승격하지 않는다.
- **C07은 T3 Code를 우선 Host UI로 연결한다.** UI는 Runtime의 구조화 명령·이벤트·승인·취소·재연결 계약을 사용하며 COMPLETE/Approval/Policy의 원본 authority를 갖지 않는다.
- **C06은 일회성 모델 순위가 아니라 지속 평가 track이다.** V0.6B에서는 matrix 형식을 정식화하고 이후 새 Provider/model/endpoint 조합을 같은 fixture·budget·tool schema revision으로 누적한다. run 중 무통보 fallback은 도입하지 않는다.
- **C08은 마지막 조건부 확장이다.** 초기에는 local test app + isolated browser profile + no upload/delete/personal account/production 범위로 제한하고, Jev의 DONE을 Weavra completion으로 사용하지 않는다. 탐색 결과는 registered regression evidence 후보로 변환한 뒤 독립 Verifier가 판정한다.

공통 완료 기준은 기존과 동일하게 authority 확대 없이 측정 가능한 효과를 남기는 것이다. 각 단계는 최소 하나의 deterministic false-positive/false-completion fixture와 기능 대조 eval을 추가하고, 실제 Provider 호출은 일반 CI가 아닌 명시적 opt-in smoke로 유지한다.

---

# 11. 이후 선택 단계

## Project Facts

자동 장기기억이나 vector DB보다 검토된 작은 Facts Pack부터 시작한다.

```text
statement
source ref
related digest
reviewedAt
valid / stale
```

Facts는 Policy나 이전 PASS를 대체하지 않는다.

## Browser QA

자유 브라우저 agent보다 등록된 Playwright QA와 evidence 생성부터 검토한다.

Verifier trust/sandbox가 선행 조건이다.

## Capability Broker / MCP

도구 수가 실제로 증가해 discovery가 필요할 때 도입한다.

MCP annotation(`readOnlyHint` 등)은 권한 보증으로 사용하지 않는다.

## COMPLEX / Parallel Agents

다음 조건이 갖춰진 이후에만 본격 진행한다.

```text
Execution Contract
Acceptance Criteria
Budget
Eval baseline
Task/file ownership
Integration verification
```

그 전에는 현재 순차 QUICK/STANDARD를 유지한다.

---

## 12. 단계 의존 관계

```text
V0.3B Read-only LSP  ✅
        │
        ▼
V0.3C Trust Baseline
        │
        ▼
V0.3D Project Context
        │
        ▼
V0.3E Task Contract
        │
        ▼
V0.3F Measurement & Evidence
        │
        ├──────────────┐
        ▼              ▼
V0.4A Strict Edit   eval baseline
        │
        ▼
V0.4B Verifier Trust  ✅
        │
        ▼
V0.4C Verifier Sandbox
        │
        ▼
V0.5A Context Pack
        │
        ▼
V0.5B Recipes
        │
        ▼
V0.5C Bounded Repair
        │
        ▼
V0.5D Impact Review + Versioned Docs
        │
        ▼
V0.6A T3 Host Bridge
        │
        ▼
V0.6B Provider Fitness Matrix
        │
        ▼
V0.6C Jev Browser Evidence
        │
        ▼
Facts / Capability Broker / COMPLEX / Parallel
```

이 순서는 절대적 기능 의존성이라기보다 **안전성·측정 가능성·실사용 효과를 우선하는 개발 순서**다. 실제 측정 결과에 따라 후속 단계는 조정할 수 있다.

---

## 13. 공통 완료 규칙

모든 단계에서 다음을 유지한다.

- 시작 시 실제 `devlop` HEAD 기록
- 관련 regression을 현재 HEAD에서 재실행
- 수행하지 않은 Provider/build/platform 검증을 PASS라고 기록하지 않음
- Runtime source와 build source를 구분
- real Provider와 faux/mock 결과를 구분
- cleanup 불확실 시 성공을 과장하지 않음
- evidence를 run/revision/attempt/digest에 연결
- secret/raw reasoning/credential을 WORK_LOG 및 evidence에 저장하지 않음
- 일반 push 사용, force push 지양
- 안정 태그 `weavra-v0.1-rc1` 불변

기본 검증:

```sh
npm run check
git diff --check
bash -n packages/company-runtime/bin/weavra
```

CI 단계 도입 이후에는 non-mutating `check:ci`를 기본 자동 gate로 추가한다.

---

## 14. 즉시 다음 작업

**V0.5A·V0.5B·V0.5C·V0.5D는 현재 bounded 범위에서 CLOSED다.** 이전 closure/actual/CI 결과는 LOG-071~085, V0.5D는 LOG-086~093에 보존한다. C04/C05는 fresh Reviewer advisory이며 exact npm 선언을 installed/latest 증명으로, source digest를 LSP 내부 cache freshness 증명으로 승격하지 않는다. 추가 envelope는 48 KiB cap이고 durable data는 optional summary뿐이다.

**V0.6A 첫 Host module 완료:** D 구현 `0d4e91936`의 [CI](https://github.com/kjg8619/pi/actions/runs/35454385916)와 별도 closure `9331b3ed9`의 [CI](https://github.com/kjg8619/pi/actions/runs/35454820292)가 모두 PASS인 것을 확인한 뒤 진행했다. repository-level read-only Host module + bounded local JSONL, 관측 event, fresh canonical snapshot reconnect를 실제 Runtime/SDK·in-memory faux로 검증했고, 전체 로컬 gate와 구현 `bacbb778e`의 [exact CI](https://github.com/kjg8619/pi/actions/runs/35457968130)도 PASS다(LOG-094~096). 이는 첫 slice의 역사적 검증 결과이며 두 번째 slice의 gate 결과로 자동 승계하지 않는다.

**두 번째 실제 read-only vertical slice 완료:** T3 server-local trusted 절대경로 `T3_WEAVRA_EXECUTABLE`을 argv `["bridge","--stdio","--project-trusted"]`, 기존 authorized ProjectId의 canonical root에서 실행한다. 기존 인증 RPC `weavra.observe`/`orchestration:read`와 optional environment capability `weavraReadOnly`를 사용하고, T3는 `.ai`를 직접 읽거나 새 listener를 열지 않는다. protocol v1 snapshots-only hello, 2초 canonical polling·transport 실패 후 5초 재연결, project/root 재검증·revision/session 경계를 적용한다. 실제 in-process event sink는 유지하고 standalone event replay/가짜 Runtime event는 없다.

두 번째 **read-only slice 당시** UI는 **Settings → 정확한 project scope 선택 → Project → Weavra**의 overview·source graph node/edge·bounded evidence/config summary이며 grouped project는 environment/checkout 하나를 선택한다. current config와 frozen Run config, durable Run과 connection/owner를 구분한다. CONNECTED여도 owner UNKNOWN이고 writer presence는 liveness가 아니다. raw prompt/reasoning/credential/transcript/source/docs/tool output과 control button은 이 read-only 계약에 없다.

실제 isolated managed Chromium에서 CLI/backend/UI CONNECTED·graph/evidence, child SIGTERM 뒤 DISCONNECTED+STALE와 RUNNING/state/writer.lock bytes 보존·별도 Runtime owner 생존, 자동 재연결 뒤 새 canonical Run 및 project revision 2→4를 확인했다. Node `24.19.0`의 지원 runtime에서 real CompanyKernel/FileStateStore fixture를 사용했으며 agent/check/Provider 실행이나 paid-provider E2E는 포함하지 않는다. setup/readiness·진단·한도는 [Runtime 계약](../packages/company-runtime/README.md#v06a-read-only-host-bridge)을 따른다.

양쪽 로컬 gate와 게시 결과는 LOG-098~100이다. Weavra 구현 `2f7822451`의 [exact CI](https://github.com/kjg8619/pi/actions/runs/35483948383)는 PASS이며, T3 `8486dbd48`은 full local test/static/build PASS·remote CI 미실행(`main` push/PR 전용 workflow, exact SHA의 run/check 0개)으로 구분한다. 이후 검증 기록 문서 HEAD의 CI도 별도로 확인한다.

**V0.6A/C07은 별도 opt-in control을 포함한 bounded 범위에서 CLOSED다(LOG-101~105).** trusted `T3_WEAVRA_EXECUTABLE`은 실제 `<Weavra checkout>/packages/company-runtime/bin/weavra` 절대경로이고 T3 server의 **`T3_WEAVRA_CONTROL=1`**에서만 `bridge --stdio --project-trusted --control`을 사용한다. legacy read-only argv/protocol v1은 그대로다.

- C07 당시 닫힌 command는 `control.hello`, `control.snapshot`, `workflow.prepare`, `workflow.confirm`, `workflow.cancel`, `approval.resolve` 여섯 개다. C08은 같은 opt-in channel에 `browser.inspect`, `browser.prepare`, `browser.confirm`을 추가한 9-command 계약으로 Runtime/T3를 함께 전환한다. 별도 control request는 newline 포함 32 KiB, response는 64 KiB다. owner UUID + Runtime-issued 단조 증가 request ID + 최대 64개의 payload-bound receipt를 사용하며 같은 epoch의 evicted ID도 replay하지 않는다.
- 사용자는 **Settings → 정확한 project scope 선택 → Project panel**에서 goal·선택적 recipe data·AC prose만 입력한다. Runtime이 classification·scope·checks·frozen Task Contract·revision을 소유한다. Prepare는 Provider 호출이 없고 edited AC의 새 preview를 명시적으로 modal 확인해야 기존 Workflow를 시작한다. **ACK는 canonical outcome이 아니다.**
- browser disconnect/화면 이탈은 server-owned 실행을 종료하지 않는다. reconnect는 fresh canonical state를 읽으며 mutation 자동 replay는 없다. cancel은 **기존 owned Run**에만 가능하고 canonical Run 생성 전 model/Git/LSP preflight에는 wire cancellation ID가 없다. cleanup/terminal 결과를 확인하며 partial changes는 rollback하지 않는다.
- `approval.resolve`는 기존 **Git 추적 텍스트 파일 한 개 삭제**의 exact pending R3 request에 대한 approve/reject 응답이다. preview 확인은 R3 approval이 아니고 grant/consumption·Policy·PASS·COMPLETE는 계속 Runtime/Kernel이 소유한다. 임의 write/edit/tool/shell, 범용 R3, COMPLEX, resume/recovery/rollback/fallback, 새 network Host·자동 setup은 제외한다.

**Actual proof와 제한:** 실제 launcher → T3 backend → Project Settings UI와 로컬 faux Provider에서 edited AC preview 갱신·modal 확인 전 model 호출 0회, 실제 checks/독립 review 뒤 `COMPLETED`·active agents 0·writer 해제·파일 수정을 확인했다. blocked Developer의 browser blank/reconnect는 같은 RUNNING Run과 writer를 유지하고 명시적 cancel은 `CANCELLED`·active agents 0·writer 해제·faux SSE 종료·부분 변경 보존으로 끝났다. R3는 별도 승인 후 **CONSUMED → COMPLETED / 파일 삭제**, Reject 후 **DENIED → BLOCKED / 원본 보존**을 확인했다. 실제 wire의 replay/owner/root/framing/권한 위조와 browser raw frame의 credential/source sentinel 비노출도 확인했다. paid-provider 품질이나 다른 OS의 proof는 아니다.

Pi full test/check/check:ci와 T3 typecheck/fmt/knip/build/lint exit 0을 확인했다(기존 무관한 warning 있음). 첫 T3 full test는 localhost `ETIMEDOUT` 1건으로 실패했고 package 동시 실행을 끈 전체 재실행은 **1,269 files / 17,262 PASS / 58 skipped**였다. 실패 이력은 보존한다. Pi 구현 `fd0f93d58`의 [exact CI 35491863295](https://github.com/kjg8619/pi/actions/runs/35491863295)는 PASS, T3 `09de732fe`는 main/PR-only trigger에 따른 exact SHA runs/checks 0건으로 미실행이다. 두 devlop의 local/tracking/actual remote 일치·clean tree와 immutable tag 유지까지 확인한 뒤 bounded closure로 판정했다. 과거 read-only 결과를 현재 control 검증으로 승계하지 않았다.

**V0.6B/C06은 CLOSED다**(LOG-114~116). 독립 F01/F02 audit 뒤 source `b2b938aa2b890ec482265638fe882ad1e3bebb32`의 exact CI를 먼저 통과하고 두 target의 v3 fresh full을 각각 한 번 수집했다. Astra `c032d3ec-05cb-42d0-bafe-827c19a31003`, DeepSeek `04b72270-eea6-48c2-9362-4aa57285799c`는 각각 10 oracle PASS/falseCompletion 0이며 F06 BLOCKED·strict receipt 1/3·마지막 F08 usage UNKNOWN을 유지한다. Full 비교·actual T3 UI·최종 Pi 전체 218.37초 exit 0 뒤 evidence commit `d67ce3968d83df5961a9facd5211a8a4d59cfd3a`의 [exact CI 35517110397](https://github.com/kjg8619/pi/actions/runs/35517110397)도 PASS했다. T3 `6cced3c7f`는 전체 로컬 gate PASS/remote NOT RUN이다. [현재 근거와 제한](WEAVRA_PROVIDER_FITNESS_PLAN_2026-09-20.md#16-fresh-v3-actual-full-collection)을 보존하며 이제 C08/Jev 연구와 첫 read-only slice에 진입한다. C08에 독자적 PASS/COMPLETE 권한을 부여하지 않는다.

**C08은 local-static 범위에서 CLOSED다**(LOG-119~121). [첫 read-only slice](WEAVRA_AGENT_LANDSCAPE_AND_ADOPTION_2026-09-18.md#10-c08-후속-연구와-첫-read-only-slice-2026-09-21)에 이어 [Host 등록과 fresh 독립 검증](WEAVRA_AGENT_LANDSCAPE_AND_ADOPTION_2026-09-18.md#11-c08-host-등록과-fresh-독립-검증-2026-09-21)을 완료했다. Candidate는 `CANDIDATE_ONLY`이며 Host의 edited expectation·Runtime preview·명시적 confirm 뒤에만 기존 registry에 등록된다. Frozen check/helper/executable identity 아래 매 SELF_CHECK/TEST마다 새 private HOME/profile/CDP-pipe capture를 수행하고 Kernel이 typed evidence와 기존 revision/trust/review guards를 함께 확인한다. Historical Ready/fresh Broken은 FAIL이며 완료를 막고, browser 실패는 자동 repair로 가지 않는다. 실제 Chromium·SDK faux whole workflow·production T3 UI·양쪽 전체 로컬 gate와 Pi source `de66efe2a` exact CI를 확인했다. T3 `f6ff0ae0f`의 remote CI는 main/PR-only trigger 때문에 NOT RUN이다. Action/auth/session 재사용/remote navigation/crawling·임의 JS는 미지원이며 browser 전체 OS sandbox나 기존 required deny-all 완화를 주장하지 않는다.

V0.4C가 닫힌 뒤에는 [Agent Landscape 조사](WEAVRA_AGENT_LANDSCAPE_AND_ADOPTION_2026-09-18.md)를 반영한 다음 순서를 따른다.

```text
V0.5A  C01 Task Context Pack / Repo Map
V0.5B  C03 Task Recipes / Reviewed Skill Packs
V0.5C  C02 Bounded Verification Repair
V0.5D  C04 Impact-aware Review + C05 Versioned Documentation
V0.6A  C07 T3 Code Host Bridge
V0.6B  C06 Provider Contract/Fitness Matrix
V0.6C  C08 Jev Browser Explorer → Regression Evidence
Later  Facts / Capability Broker / COMPLEX / Parallel
```

이 순서는 기능 개수보다 **문맥 품질 → 반복 절차 → 제한 복구 → 리뷰 품질 → Host UI → Provider 측정 → 브라우저 evidence**를 우선한다. T3는 Host/UI이고 Kernel authority가 아니며, Provider Matrix는 자동 fallback이 아닌 지속 평가 track이다. 현재 C08은 owned local static capture와 기존 verifier trust/Kernel 경계에 한정한다. 별도 Browser action policy·최종 입력 검사·OS/network 경계 설계는 향후 action 확장의 전제이며 현재 read-only 범위에 행동 권한을 부여하지 않는다.

과거 V0.3C/V0.3D의 실제 결과와 제한은 기존 LOG의 판정을 그대로 유지하며 소급 수정하지 않는다. 미실행 remote CI, 다른 OS/Node/Provider, R2/R3 actual smoke를 PASS로 확대하지 않는다.

## 15. 최종 split-repository migration baseline

**This is the final split-repository baseline before the planned Weavra repository consolidation.**

현재 C08 구현을 유지한 채 `pi/devlop`과 `t3code/devlop`을 향후 단일 `kjg8619/Weavra` repository 통합의 고정 비교 원본으로 남긴다. Immutable 기준은 branch 이름이 아니라 최종 게시 보고의 **Pi/T3 full commit SHA 쌍**이다. 새 tag나 branch-protection 설정, history rewrite를 수행한다는 뜻이 아니다.

- T3 baseline source는 `f6ff0ae0f1ae0f54aee055c64b82dd8e2b9eebdf` 그대로다. Visual wrapping fix 이후 closure 요청에 따라 full/focused contracts·server·client-runtime·web tests를 새로 실행했고 전체 **17,284 PASS / 58 skipped**, focused **17/26/28/23 PASS**였다. Typecheck/lint/fmt/knip/build는 모두 exit 0이다. Lint **722 warnings / 0 errors**와 기존 typecheck/build 진단은 보존한다. T3 remote CI는 **NOT RUN**이다.
- Pi implementation `de66efe2a5f6bdae4c7cf573ce89414d4b6cbcd2`와 기존 closure `784644382b90c6f01319aa9ccefb1b108e03169a`는 역사적 anchor다. 최종 Pi baseline은 이 closure-only 문서를 포함한 새 게시 commit이며 그 exact CI·full SHA·양쪽 clean/local/tracking/remote 일치를 최종 보고에서 확정한다. 현재 작업의 상세 명령과 실제 결과는 WORK_LOG LOG-122에 기록한다.
- XXVIII의 wrapping-fix 후 전체 재검증은 새 실행으로 완료했다. XXIX Publication과 XXX Bounded closure는 기존 증거를 재작성하지 않고 마지막 문서 exact CI와 게시 identity 확인으로 종료한다. 과거 actual Chromium/SDK proof를 이번 실행 결과로 재표기하지 않는다.

유지하는 C08 경계:

| 대상 | 고정된 책임/제한 |
|---|---|
| Browser/Jev | observation producer only |
| Candidate | CANDIDATE_ONLY |
| Registration authority | Runtime/Host |
| Verification authority | RegisteredVerifier |
| Completion authority | Kernel |
| Freshness | 매 검증마다 fresh browser capture, candidate evidence 재사용 금지 |
| Repair | browser automatic repair 없음 |
| Action | action loop 없음 |
| Authentication | login/authenticated personal browser 없음 |
| Navigation | 임의 remote navigation/crawling 없음 |

**여기서 기능 개발을 멈춘다.** C09/V0.6D, architecture refactor, repository 구조 변경을 시작하지 않는다. 저장소 생성·이관·merge·subtree도 수행하지 않는다. `kjg8619/Weavra` consolidation 실행은 이 baseline 확정과 별개의 향후 작업이다.
