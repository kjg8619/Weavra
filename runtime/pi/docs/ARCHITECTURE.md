# Personal AI Runtime 아키텍처

## 1. 범위와 결론

[MASTER_SPEC](MASTER_SPEC_PI_PERSONAL_AI_RUNTIME.md)를 바탕으로 한 Phase 0 조사 및 설계 제안이다. 구현 완료를 의미하지 않는다.

- 조사 기준: `devlop`, HEAD `f9bcd351dc3cedf989bc5fc0f8aa012db5737df2`, coding-agent `0.85.1`.
- 기존 CLI의 `AgentSession`과 Extension API를 재사용한다.
- Company Kernel은 LLM Agent가 아닌 코드 기반 상태 머신으로 둔다.
- 얇은 Extension이 명령과 UI를 연결하고, 별도 Runtime 모듈이 조직·정책·상태·검증을 담당한다. 별도 서버는 만들지 않는다.
- Developer와 Reviewer는 서로 다른 SDK `AgentSession`에서 순차 실행한다.
- 현재 확인한 요구사항에는 **Pi Core 수정이 필요하지 않다**. 취소·리소스 제한 등 통합 동작은 구현 단계의 검증 대상이다.

현재 사실과 제안을 구분한다. 아래 2~3절은 소스 조사 결과와 적용 시 주의점, 4절 이후는 제안이다. 빌드·테스트·실제 모델 호출을 통한 동작 검증은 이번 조사에서 수행하지 않았다.

주요 용어:

- **Vertical Slice:** 입력부터 최종 보고까지 한 작업 경로를 끝까지 연결한 최소 기능.
- **Run / worker:** 작업 1회의 실행 / 그 안에서 역할을 수행하는 Agent 세션.
- **Handoff / schema:** 역할 사이에 전달하는 결과 / 그 결과의 필드·타입 검증 규칙.
- **Capability profile:** 특정 모델 대신 역할이 요구하는 능력을 나타내는 설정 이름.
- **Digest / projection:** 변경 내용을 식별하는 해시 / 원본에서 다시 만들 수 있는 조회용 데이터.
- **ADR:** 문제·대안·근거를 남기는 아키텍처 결정 기록.

## 2. 현재 Pi 실행 구조

```text
cli.ts → main.ts
           │
           ├─ AgentSessionRuntime / AgentSessionServices 구성
           └─ createAgentSession
                     │
        Interactive / Print(JSON) / RPC
                     │
                AgentSession
                ├─ SessionManager: JSONL 대화 트리
                ├─ ResourceLoader: Extension / Skill / Prompt / Context
                ├─ ModelRuntime: 모델 / 인증 / Provider 호출
                └─ Agent (pi-agent-core)
                     └─ agent-loop
                          ├─ Provider streaming (pi-ai)
                          └─ Tool 실행 + before/after hooks
```

| 영역 | 현재 책임 | 재사용 판단 |
|---|---|---|
| `packages/ai` | Provider 중립 메시지·모델·스트리밍·usage | 모델 클라이언트를 새로 만들지 않음 |
| `packages/agent` | Agent 실행 루프, 도구, 이벤트, 취소·큐잉 | 역할별 LLM 실행에 재사용 |
| `packages/coding-agent` | CLI, AgentSession, SDK, Extension, 리소스·세션 관리 | 주 통합 지점 |
| `packages/tui` | 터미널 렌더링·입력 컴포넌트 | 기존 Extension UI부터 사용 |
| `packages/chord`, `protocol`, `client`, `server` | 서비스 구성·복제 상태·전송 등 신규 런타임 기반 | 첫 Slice에서 제외 |
| `packages/session-backends/sqlite-node` | 신규 durable Session의 SQLite 저장소 | `.ai` 저장소로 바로 대체하지 않음 |

중요한 구분: 기존 CLI `AgentSession`/JSONL `SessionManager`, 신규 durable `Session`/`AgentHarness`, experimental client/server는 같은 API가 아니다. Experimental mini에는 기존 Extension·Skill 체계가 없으며, 서비스 기반 client도 별도 facet/plugin 모델을 사용한다. V0.1 때문에 이 스택으로 CLI를 이식할 이유는 없다.

## 3. Phase 0 조사 결과

| 조사 항목 | 확인된 API / 동작 | 적용 및 주의점 |
|---|---|---|
| Extension lifecycle | factory 로딩, `session_start`, `session_shutdown`, switch/fork/tree/compact 관련 이벤트 | 등록 시 명령·훅 구성, 세션 시작 시 `.ai` 조회. switch/reload/종료 시 worker 정리 필요 |
| Custom commands | `pi.registerCommand`, `ExtensionCommandContext`, `waitForIdle` | `/team`, `/state`, `/workflow`, `/risk`; 긴 작업의 취소·중복 실행은 Kernel 소유 |
| Custom tools | `pi.registerTool`, `defineTool`, schema, 구조화 `details`, `terminate` | 역할별 결과 제출 및 제한된 실행 도구에 사용 |
| Tool interception | `tool_call`에서 `{ block: true, reason }`, `tool_result` | 실행 전 정책 적용 가능. 결과 훅은 이미 발생한 변경을 되돌리지 못함 |
| Permission / approval | `ctx.ui.confirm/select`, `user_bash` | 기본 예제는 위험 명령 정규식 검사일 뿐 범용 권한 엔진이 아님 |
| Sub-agent | SDK `createAgentSession`; 예제의 `pi --mode json` subprocess | 예제는 single/parallel/chain 참고 자료. 역할 권한·조직 상태를 별도로 구현해야 함 |
| Session persistence | JSONL v3, `id/parentId`, branch, compaction, custom entries | 대화·도구 기록은 Pi에 남기고 `.ai`에는 운영 상태만 저장 |
| Configuration | `SettingsManager`, `DefaultResourceLoader`, project trust | `.ai/config.yaml`은 새 Runtime 설정. Pi 설정과 인증 저장소를 복제하지 않음 |
| TUI extension | `notify`, `setStatus`, `setWidget`, `custom` | 초기에는 명령 출력만. RPC는 일부 UI만 지원하며 `hasUI`가 true일 수 있음 |
| Model/provider | `ModelRuntime`, Extension의 `ctx.modelRegistry` | 기존 인증·Provider 재사용. 역할에는 모델 ID 대신 capability profile 연결 |

### 3.1 안전 경계

문제: 부모 Extension의 `tool_call`만 등록하면 모든 실행을 보호한다고 착각하기 쉽다.

```text
부모 Agent의 bash → 부모 tool_call 훅 적용
자식 SDK Agent의 bash → 자식 세션에 설치한 정책만 적용
Extension의 fs/spawn/pi.exec → 부모 tool_call 보호 밖
검증 명령 내부의 파일·네트워크 접근 → 도구 이름 검사만으로 제한 불가
```

따라서 모든 Runtime 소유 도구와 검증 실행기는 공통 정책 코드를 **실제 실행 직전** 호출해야 한다. 도구 미노출이나 Prompt는 보조 수단이다. `createReadOnlyTools`라는 이름도 작업 디렉터리 밖 읽기까지 제한한다는 뜻은 아니다.

Extension은 신뢰된 호스트 Node 코드다. Project trust는 프로젝트 리소스 로딩 허용이며 OS sandbox가 아니다. 악성 Extension, 외부 프로세스, 임의 셸 내부 동작까지 통제하려면 별도 프로세스/컨테이너 등 OS 수준 격리가 필요하다. 같은 프로세스에서 실행하는 V0.1은 그 보장을 제공하지 않는다.

`user_bash` 예외는 Runner가 보고 후 다음 처리로 넘어갈 수 있다. 정책 오류를 단순 throw에 맡기지 않고 명시적인 차단 결과로 변환해야 한다. 정책을 평가할 수 없으면 실행하지 않는 것을 기본으로 한다.

### 3.2 리소스와 모델의 함정

- 기본 SDK ResourceLoader는 표준 리소스를 자동 탐색한다. 자식이 부모 조직 Extension을 다시 로드하면 재귀 실행이나 권한 확대가 생길 수 있다.
- `noExtensions`만으로 모든 명시 경로나 context 로딩까지 제거했다고 간주하지 않는다. 빈/명시적 ResourceLoader 계약으로 Extension·Skill·Prompt·AGENTS·SYSTEM 입력을 확정한다.
- 프로젝트 `AGENTS.md`는 검토 후 worker의 작업 규칙으로 전달하되, 정책 권한을 바꾸는 설정으로 취급하지 않는다.
- 저장소의 모델 API가 전역 설치 문서보다 최신이다. 현 소스와 저장소 문서를 우선한다.
- Extension에서 직접 추론할 때는 `ctx.modelRegistry.stream/streamSimple`이 해당 Registry의 Provider 등록·인증을 반영한다. `pi-ai/compat` 직접 호출이 이를 그대로 공유한다고 가정하면 안 된다.
- SDK 자식의 별도 `ModelRuntime`도 부모 Extension의 동적 Provider 등록이나 메모리 인증 override를 자동 상속하지 않는다.

## 4. 제안 구조와 책임

### 4.1 Host와 실행 Adapter 경계 (ADR-011)

기존 구조를 유지하되 입력/UI와 Agent 실행의 두 경계를 분리한다. Port는 Runtime이 요구하는 작은 인터페이스, Adapter는 그 인터페이스를 Pi 등 특정 환경으로 구현하는 코드다.

```text
Host Layer
  ├─ Pi Extension Adapter (현재 extension.ts)
  └─ Future Host Adapter (개념만, 현재 구현 안 함)
             │
             ▼
       Company Runtime
       ├─ Kernel / Classification / Policy / State / Verification
       ├─ RuntimeEventSink → 현재 no-op/fake, 향후 화면용 projection
       └─ AgentExecutor Port
                    │
                    ▼
             Pi Agent Adapter (S3)
                    │
                    ▼
             Pi AgentSession
```

Kernel에는 `AgentSession`, `ExtensionContext`, TUI, Provider SDK 타입을 사용하지 않는다. `extension.ts`는 Host Adapter로 그대로 두며, 기존 `agent-runner.ts` 계획은 AgentExecutor의 Pi 구현이다. 모델/auth/context 구성은 그 Adapter 책임이다. Runtime은 역할·목표·handoff·검증 계약만 전달한다.

S1에는 AgentExecutor, Verifier, StateStore, ApprovalPort, RuntimeEventSink의 작은 계약과 fake 기반 순차 Kernel만 추가한다. 파일 저장은 S2, 실제 Pi 실행은 S3, 명령과의 실행 연결은 S4다. R3 승인 계약은 정의하되 실행을 열지 않는다. R2 Reviewer 규칙의 순수 테스트는 실제 R2 도구 사용 허가가 아니다.

### 4.2 기존 모듈 구성

```text
사용자 → Pi Extension adapter (명령 / 승인 UI / 상태 표시)
                     │
                Company Kernel
                ├─ Classification + Workflow + Team
                ├─ Policy + Approval
                ├─ StateStore (.ai)
                ├─ Verification runner
                └─ Agent runner (SDK adapter)
                     ├─ Developer AgentSession
                     └─ Reviewer AgentSession
                              │
                         기존 Pi / Provider
```

| 모듈 | 책임 | 하지 않는 일 |
|---|---|---|
| Extension adapter | 명령 파싱, 사용자 확인, lifecycle 연결, 결과 표시 | 직접 상태 전이·LLM 조직 판단 |
| Kernel | 작업 수명주기, 역할 순서, revision 한도, 최종 완료 판정 | 별도 상시 Lead LLM 실행 |
| Classifier / selector | intent·complexity·risk 및 근거, 최소 팀 선택 | 불명확한 요청을 확신 높은 숫자로 포장 |
| Agent runner | 독립 SDK 세션, 역할별 context/tools/model, 취소·결과 수집 | 승인 정책 우회, 무제한 재시도 |
| Policy | 역할·도구·경로·명령 평가, 승인 binding, 감사 이벤트 | 임의 프로그램의 무해성 증명 |
| Verification | 설정된 명령 실행, exit code·diff·증거 수집 | LLM의 성공 주장으로 결과 대체 |
| StateStore | 작업 상태의 durable 저장, 소유권, 조회 | Pi 대화/도구 history 재구현 |

권장 코드 위치는 `packages/company-runtime/`의 독립 패키지다. 내부 명칭은 임시이며 공개 배포를 전제하지 않는다. 기존 root TypeScript의 `packages/*/src`, `packages/*/test` 범위에 들어간다. package scripts와 workspace 통합은 구현 시 확인한다.

```text
packages/company-runtime/
├── package.json
├── src/
│   ├── extension.ts       # Pi 진입점
│   ├── kernel.ts          # 순차 상태 머신
│   ├── classification.ts  # intent / complexity / workflow / team
│   ├── contracts.ts       # 상태 / handoff / review schema
│   ├── agent-runner.ts    # SDK adapter
│   ├── policy.ts          # 도구 정책 / 승인
│   ├── state-store.ts     # .ai 파일 / lock / 복구 판정
│   ├── verification.ts
│   └── config.ts
└── test/
```

첫 로딩은 `-e packages/company-runtime/src/extension.ts` 같은 명시적 경로를 사용한다. 자동 로딩용 `.pi` 설정, 패키지 배포, 파일 세분화는 필요할 때 추가한다. 이는 제안 경로이며 이번 단계에서 생성하지 않는다.

## 5. 실행 및 역할 계약

### 5.1 최소 STANDARD 흐름

```text
/workflow run <요청>
  → 사전 점검 + intent/complexity/risk 판정
  → STANDARD + Developer/Reviewer 선택
  → IMPLEMENT → SELF_CHECK → REVIEW → TEST → COMPLETE
                    ↑           │
                    └─ IMPLEMENT ← REVISE (한도 이내)
                                └─ BLOCK → BLOCKED
```

- 첫 Slice는 STANDARD만 실행한다. QUICK/COMPLEX를 STANDARD로 위장하지 않고 미지원으로 보고한다.
- V0.1 확장 시 QUICK은 Executor 1개, STANDARD는 Developer+Reviewer, COMPLEX는 필요할 때 Lead를 추가한다. 분류 가능과 실행 가능을 구분한다.
- R2는 Reviewer 필수이므로 QUICK 후보라도 STANDARD 이상으로 올린다. Complexity와 Risk는 서로 독립이다.
- 분류 초기 구현은 규칙+명시적 사용자 선택이며 불확실하면 확인을 요청한다. `confidence`는 근거 있는 경우만 기록하고, 없는 경우 unknown으로 둔다.
- 한 프로젝트당 활성 run 1개, 역할 실행도 한 번에 1개. Pi 도구 병렬 실행과 조직 병렬화는 별개다.

실행 상태는 `CREATED`, `RUNNING`, `WAITING_APPROVAL`, `BLOCKED`, `FAILED`, `CANCELLED`, `INTERRUPTED`, `COMPLETED`로 나누고, `phase`는 `IMPLEMENT`, `SELF_CHECK`, `REVIEW`, `TEST`, `COMPLETE` 등으로 따로 저장한다. 승인 후에는 원래 phase로 돌아간다.

### 5.2 단계 식별과 관찰 이벤트 (ADR-011)

| phase | 안정적인 Step ID |
|---|---|
| IMPLEMENT | `implement` |
| SELF_CHECK | `self-check` |
| REVIEW | `review` |
| TEST | `test` |
| COMPLETE | `complete` |

PREFLIGHT에는 실행 Step이 없다. 재작업은 `revisionCycle`을 증가시키고 Step ID는 유지한다. `attempt = revisionCycle + 1`이며 `(runId, stepId, attempt)`로 한 실행을 구분한다. Run의 현재 Step과 이벤트가 같은 식별 계약을 사용한다. 일반 상태 저장 revision과 코드 재작업 revision은 구분한다.

Run/Step/Agent/Review/Verification의 시작·결과와 run 종료를 구조화 이벤트로 보낸다. 승인·중단 이벤트 계약도 마련하되 실제 승인 UI와 복구는 후속 단계 책임이다. 이벤트에는 run/task 참조, run 내 sequence, 상태 revision, 필요할 때 Step·역할·결과를 담는다. 대화나 credential은 복사하지 않는다.

상태 저장 성공 후 이벤트를 순서대로 발행한다. Sink는 선택 사항이며 기본 no-op이다. 동기 throw/비동기 reject는 관찰 오류로 별도 기록하고, Kernel의 검증 결과·상태 전이 판단에는 사용하지 않는다. 실패 이벤트가 전달되지 않았다고 작업을 PASS로 바꾸지 않는다. 저장 실패는 실행 중단 사유이며, 완료 상태 저장에 실패하면 RunCompleted를 발행하지 않는다.

이벤트는 best-effort 관찰 채널이다. StateStore가 원본이며 재생·exactly-once 전달·트랜잭션 outbox는 제공하지 않는다. 향후 `Runtime Events → Workflow Graph Projection → DAG Visualization`을 붙일 수 있지만 실행기는 계속 순차 상태 머신이다. DAG scheduler, node executor, edge condition engine, 병렬화는 만들지 않는다.

### 5.3 역할 및 context

| 역할 | 도구 권한 | 입력 / 출력 |
|---|---|---|
| Developer | workspace 제한 읽기·검색·edit/write, 등록된 check 요청, 결과 제출 | 목표·요구사항·규칙·직전 review → handoff |
| Reviewer | workspace 제한 읽기·검색, Kernel이 수집한 diff·검증 증거, review 제출 | 요구사항·실제 변경·handoff → PASS/REVISE/BLOCK |
| Kernel / verifier | 정책을 통과한 제한된 실행 기능 | 실제 증거 수집, 상태 전이 |

Reviewer에는 일반 bash/edit/write를 주지 않는다. Developer와 같은 모델 profile mapping을 써도 세션·context·권한은 분리한다. 첫 구현은 역할 호출마다 새 세션을 만들어 누적 context 전달을 피한다.

Handoff 최소 필드: `task`, `changed_files`, `summary`, `assumptions`, `tests_run`, `known_risks`, `unresolved`. Review 최소 필드: `result`, `issues[{severity,file,description,recommendation}]`, `requirements`, `evidenceRefs`, `revision`, `diffDigest`.

결과 제출 도구의 schema를 검증한 뒤 Kernel이 수락한다. `defineTool`의 구조화 결과/`terminate`를 활용할 수 있지만, 필수 필드·run/role/revision 일치·증거 참조는 Kernel이 다시 검사한다. 자연어의 “완료”, Developer의 PASS, 결과 없는 종료는 완료 근거가 아니다.

Reviewer는 실제 파일과 diff, 요구사항별 충족 여부, 테스트, 위험·회귀를 확인한다. Developer의 요약은 참고 자료이지 권위 있는 diff나 실행 증거가 아니다.

### 5.4 검증과 revision

1. 변경 전 tracked/staged/untracked 상태를 기록한다. 첫 Slice는 기존 사용자 변경이 있으면 정리를 요청하고 중단한다. 자동 stash/reset/checkout을 하지 않는다. 사전에 식별한 Runtime 소유 상태·log 파일만 변경 비교에서 제외하며 `.ai` 전체를 무조건 제외하지 않는다.
2. Developer의 SELF_CHECK 결과도 실행기가 생성한 증거로 남긴다. 일반 `git diff`에 나오지 않는 신규 untracked 파일도 내용과 경로를 수집한다. 코드·테스트·설정의 변경을 digest에 포함하고, 관리 상태 파일의 갱신으로 코드 review가 무효화되지 않게 구분한다.
3. Reviewer가 그 시점의 `diffDigest`와 증거를 검토한다.
4. PASS 후 필요한 최종 check를 실행한다. 코드가 변하면 PASS를 무효화하고 재검토한다. 최종 check 실패도 COMPLETE로 진행하지 않는다.
5. build/lint/test 각각 `PASS`, `FAIL`, `SKIPPED`, `UNAVAILABLE`와 이유를 남긴다. 미실행을 PASS로 바꾸지 않는다.
6. 필수 check의 실패·미실행, 미해결 blocker, 누락된 요구사항은 완료를 막는다. 선택 check의 불가 사유는 최종 보고에 남긴다.

`max_revision_cycles`는 최초 구현 뒤 허용하는 재작업 횟수다. 첫 Slice 기본 1회, V0.1 설정 가능(예: 3회). Provider retry, malformed output, check timeout은 별도 한도를 둔다. 변경을 일으킨 도구를 모델 오류 때문에 자동 재실행하지 않는다.

완료는 Kernel만 기록하며 STANDARD에서는 유효한 Reviewer PASS, 최신 변경에 대한 검증, 요구사항 충족, 차단 항목 없음이 모두 필요하다.

## 6. Policy와 승인

| 수준 | Runtime 처리 |
|---|---|
| R0 | 허용된 workspace 읽기·검색은 자동 실행 |
| R1 | 허용된 일반 코드 변경은 실행하고 기록 |
| R2 | dependency/구조 등 영향 큰 변경으로 승격, Reviewer 필수, 근거 기록 |
| R3 | 지원되는 작업에 한해 정확한 실행 내용에 대한 사용자 승인 필요 |

Task risk는 초기 추정, action risk는 개별 실행 직전 판단이다. 실행 중 risk를 상향할 수 있으며 낮은 초기 판정이 이후 행동을 허용하지 않는다.

최소 정책:

- 기본 도구 집합을 비우고 Runtime이 검증한 도구만 설치한다. 임의 custom tool이나 shell passthrough는 기본 거부한다.
- 경로를 정규화하고 workspace 밖, symlink 탈출, credential, `.git`, Runtime 정책/상태 파일 접근을 별도로 검사한다. Runtime 관리 `.ai` 파일은 worker가 직접 수정하지 못한다.
- 도구 입력 검사와 실행을 가까이 묶는다. 같은 호스트의 외부 파일 변경까지 경합 없이 막는다고 보장하지 않는다.
- 명령은 등록된 executable/argv/cwd 기준으로 실행한다. `bash -c` 및 정규식 allowlist만으로 임의 셸을 안전하다고 판정하지 않는다.
- 승인 요청은 `runId`, `actionId`, 역할, 정규화된 대상·인자, risk·사유, 정책/설정 digest, 만료에 묶는다. 승인 1회는 그 작업 1회에만 유효하다.
- 실행 직전 대상·설정이 달라지면 재평가한다. 취소·거절·시간 초과·UI 없음은 미실행으로 기록한다. 재시작 뒤 기존 승인을 재사용하지 않는다.
- 사용자 승인은 무조건 실행 명령이 아니다. sandbox 없는 환경에서 지원하지 않는 production/credential/history 작업은 승인받아도 거부할 수 있다.

검증 명령도 코드 실행이다. 예를 들어 `npm run lint`가 autofix하거나 `npm test`가 네트워크를 호출할 수 있다. 명령 이름만 보고 R0로 분류하지 않고 실행 내용·수정 가능성·환경을 점검한다. 자식 프로세스에 Provider credential을 불필요하게 전달하지 않는다.

첫 Slice는 R0/R1 경로만 허용하고 R2/R3는 명시적으로 차단할 수 있다. R3 실제 승인 실행은 V0.1 후속 단계에서 제한된 action으로 추가한다.

## 7. 상태와 설정

### 7.1 데이터 소유권

| 위치 | 데이터 |
|---|---|
| Pi SessionManager | 역할 세션의 대화, tool call/result, 모델 변경, branch/compaction |
| `.ai/state.json` | 목표·phase·workflow·currentTask·activeAgents·completed·next 및 현재 run 상태 |
| `.ai/tasks.json` | pending/inProgress/completed/blocked 작업 조회용 projection |
| `.ai/decisions.md` | 사용자에게 설명할 장기 판단, 근거, 대안 |
| `.ai/config.yaml` | profile mapping, workflow/revision/검증 설정 |
| `.ai/logs/` | 최소 운영 이벤트·check 증거; 대화 전체 복사 금지 |

`.ai`가 운영 상태의 원본이다. `pi.appendEntry`에는 `runId`, 상태 파일·역할 세션 참조 등 링크만 둔다. Pi의 branch 이동이나 compaction이 `.ai`를 되돌리지 않는다. 과거 branch에서 run을 재실행하려면 새 runId를 만들고 현재 workspace를 다시 확인한다.

최소 추가 필드: `schemaVersion`, `revision`, `runId`, `status`, `risk`, `classificationReason`, `roleSessionRefs`, `revisionCycle`, `verification`, `lastError`, timestamps. 비밀 값이나 credential은 저장하지 않는다.

### 7.2 저장·중단 계약

문제: `state.json`과 `tasks.json`을 따로 쓰다 중단되면 완료 상태가 서로 달라질 수 있다.

해결: V0.1은 `state.json` 안의 현재 task 기록까지 원본으로 두고 `tasks.json`은 같은 revision의 재생성 가능한 projection으로 둔다. 파일별 임시 파일+rename을 사용하고, 여러 파일 전체가 원자적이라고 주장하지 않는다. 결정 기록에는 중복 방지 ID를 둔다.

- 정규화한 프로젝트 경로 기준 단일 writer lock을 확보한다. Pi의 `withFileMutationQueue`는 동일 프로세스의 파일별 큐일 뿐 프로젝트 락이 아니다.
- lock을 잃거나 상태를 저장할 수 없으면 다음 변경을 실행하지 않는다.
- 작업 실행 전 intent, 실행 후 결과를 기록한다. 중간 crash는 “실행 안 됨”으로 추정하거나 자동 재실행하지 않는다.
- 재시작 시 진행 중 run을 `INTERRUPTED`로 표시하고 diff·세션·증거를 사용자에게 보여준다. 자동 resume는 V0.2 이후다.
- 다른 Pi 프로세스의 lock 소유권이 불분명하면 자동 탈취하지 않는다. 사용자 확인을 요구한다.
- 정상 취소도 이미 적용한 변경을 자동 rollback하지 않는다.

### 7.3 설정과 모델

`.ai/config.yaml`은 별도 schema로 검증한다. Pi의 `settings.json`, `models.json`, 인증 저장소는 그대로 사용한다. YAML의 임의 코드/명령 확장이나 비밀 값 복사를 추가하지 않는다.

역할은 `Developer → coding`, `Reviewer → reasoning`으로 연결하고 사용자가 profile을 `provider/model`로 매핑한다. 누락 모델·인증은 작업 시작 전 차단하며 임의 모델 fallback을 하지 않는다.

첫 구현의 worker ModelRuntime은 명시한 Pi 인증·모델 파일 및 환경 설정을 사용한다. 부모 Extension의 메모리 전용 Provider/인증은 자동 지원하지 않는다. 필요한 경우 안전하게 등록한 Provider adapter를 worker에 명시적으로 주입하는 후속 통합을 설계한다. Project Extension 전체를 로드하는 방식으로 해결하지 않는다.

프로젝트 설정은 더 강한 정책을 완화할 수 없다. 예를 들어 `review.enabled: false`가 STANDARD/R2의 Review를 제거하거나, `risk.approval_required: []`가 R3 승인을 제거해서는 안 된다. Run 시작 시 검증된 설정을 고정하고 변경되면 재승인한다.

## 8. 명령과 lifecycle

| 명령 | V0.1 동작 제안 |
|---|---|
| `/workflow run <goal>` | 사전 점검 후 run 시작 |
| `/workflow` / `/workflow status` | workflow·phase·run 상태 |
| `/workflow cancel` | worker·check 취소 요청, 종료 확인 후 상태 저장 |
| `/team` | 선택된 역할 및 working/waiting/inactive 상태 |
| `/state` | 목표·현재 작업·완료·다음 행동·검증/차단 사유 |
| `/risk` | 현재 최고 risk·근거·보류된 승인·정책 범위 |

첫 실행 UI는 기존 interactive mode다. Runtime 내부는 UI와 분리하되 print/RPC 실행 지원은 별도 테스트 전까지 약속하지 않는다. 승인에서는 `hasUI`만으로 TUI라고 판단하지 않는다.

명령은 run을 Kernel에 등록한 뒤 반환하여 상태·취소 명령을 계속 받을 수 있게 한다. 부모 Agent가 idle인지 확인하며 run 중 일반 입력과 부모 도구/`user_bash`가 같은 workspace를 변경하지 않도록 차단한다. 다른 신뢰된 Extension이나 외부 프로세스의 직접 I/O까지 이 gate가 막는 것은 아니다.

Session switch/fork/tree, reload, shutdown에서는 실행을 취소·정리하거나 전환을 거부한다. 부모 Esc가 독립 worker를 자동 취소한다고 가정하지 않는다. 확실한 기본 취소 경로는 `/workflow cancel`이다. Session disposal, check 프로세스 종료, lock 해제는 `finally` 경로에서 보장하고 통합 테스트로 검증한다.

## 9. Core 변경 판단

현재 필요한 새 코드는 모두 Extension/Runtime에 둔다. `Agent`, `AgentSession`, Session JSONL 포맷, Provider 구현, TUI renderer는 수정 대상으로 잡지 않는다.

다음 요구가 실제 blocker가 될 때만 ADR을 추가한다.

1. 공개 SDK로 worker lifecycle/Provider 구성을 전달할 수 없는 구체적 재현 사례.
2. 모든 Extension·프로세스를 포괄하는 강제 격리 요구. 이 경우 Core hook 추가만으로 해결하지 말고 OS sandbox 대안을 먼저 비교.
3. 다중 프로세스 durable resume가 필수가 되는 경우. 신규 Session/서비스 스택과 독립 Runtime을 재평가.

각 ADR에는 Extension으로 불가능한 이유, 대상 Core 영역, upstream merge 영향, 대체 구현을 기록한다.

## 10. 근거 자료

모두 저장소 기준 상대 링크다.

- 실행: [main.ts](../packages/coding-agent/src/main.ts), [SDK](../packages/coding-agent/src/core/sdk.ts), [AgentSession](../packages/coding-agent/src/core/agent-session.ts), [agent-loop](../packages/agent/src/agent-loop.ts)
- 확장: [Extension 문서](../packages/coding-agent/docs/extensions.md), [types](../packages/coding-agent/src/core/extensions/types.ts), [loader](../packages/coding-agent/src/core/extensions/loader.ts), [runner](../packages/coding-agent/src/core/extensions/runner.ts), [wrapper](../packages/coding-agent/src/core/extensions/wrapper.ts)
- 예제: [subagent](../packages/coding-agent/examples/extensions/subagent/README.md), [permission-gate](../packages/coding-agent/examples/extensions/permission-gate.ts), [structured-output](../packages/coding-agent/examples/extensions/structured-output.ts)
- 리소스: [ResourceLoader](../packages/coding-agent/src/core/resource-loader.ts), [SettingsManager](../packages/coding-agent/src/core/settings-manager.ts), [보안](../packages/coding-agent/docs/security.md)
- 모델: [ModelRuntime](../packages/coding-agent/src/core/model-runtime.ts), [ModelRegistry](../packages/coding-agent/src/core/model-registry.ts)
- 상태: [SessionManager](../packages/coding-agent/src/core/session-manager.ts), [session format](../packages/coding-agent/docs/session-format.md), [파일 mutation queue](../packages/coding-agent/src/core/tools/file-mutation-queue.ts)
- 신규 스택: [Chord](../packages/chord/README.md), [Server](../packages/server/README.md), [SQLite backend](../packages/session-backends/sqlite-node/README.md), [experimental mini](../packages/coding-agent/src/experimental/mini/README.md), [experimental services](../packages/coding-agent/src/experimental/services/README.md)
- 테스트: [suite README](../packages/coding-agent/test/suite/README.md), [harness](../packages/coding-agent/test/suite/harness.ts)
