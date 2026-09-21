# Personal AI Runtime 설계 결정 기록

## 상태와 적용 범위

ADR-001~010은 Phase 0의 **권고 결정** 기록을 유지한다. 후속 결정의 상태는 각 ADR에 명시하며, ADR-011은 S1 경계에 대한 사용자 요청으로 채택했다. 개별 결정의 채택이 전체 V0.1 구현 완료를 의미하지 않는다.

기준: [MASTER_SPEC](MASTER_SPEC_PI_PERSONAL_AI_RUNTIME.md), HEAD `f9bcd351dc3cedf989bc5fc0f8aa012db5737df2` (`devlop`). 상세 구조는 [ARCHITECTURE](ARCHITECTURE.md), 작업 순서는 [IMPLEMENTATION_PLAN](IMPLEMENTATION_PLAN.md)을 따른다.

## ADR-001 — Extension-first, Core 변경 0으로 시작

- **상태:** Proposed
- **문제:** 조직 기능을 AgentSession이나 CLI에 직접 넣으면 upstream 동기화 비용이 커진다.
- **예:** `/workflow` 등록과 자식 세션 실행을 위해 CLI parser나 agent-loop를 수정할 필요는 없다.
- **결정:** 얇은 Pi Extension + 별도 `company-runtime` 모듈로 구성한다. Runtime은 Extension 프로세스 안에서 실행하며 서버를 만들지 않는다.
- **대안:** Core 직접 확장, 외부 CLI/RPC supervisor, experimental client/server 이식.
- **이유:** 기존 명령·도구·UI·SDK로 첫 STANDARD 흐름을 표현할 수 있다. 외부 supervisor는 초기 IPC/프로세스 관리가 추가된다.
- **비용/재검토:** lifecycle 또는 공개 SDK의 구체적 한계가 재현되면 작은 adapter 변경을 검토한다. Core 변경 전 Extension으로 불가능한 이유, 수정 영역, upstream 영향, 대체 구현을 새 ADR에 기록한다.

## ADR-002 — Kernel은 코드, 첫 실행은 STANDARD 순차 조직

- **상태:** Proposed
- **문제:** 매 요청마다 Lead/Planner를 생성하면 작은 작업에도 비용과 전달 오류가 생긴다.
- **예:** 로그인 오류 수정에는 Developer와 Reviewer만 있어도 된다.
- **결정:** Kernel은 상태 머신이다. 첫 Slice는 STANDARD만 실행하고 역할 병렬 실행은 1개로 제한한다. 분류와 실행 지원 여부를 따로 관리한다.
- **대안:** 항상 Lead LLM 사용, 첫 단계부터 QUICK/STANDARD/COMPLEX 전체 실행, 범용 DAG scheduler.
- **이유:** 명세의 최소 조직과 최초 Vertical Slice를 가장 작게 검증한다.
- **비용/재검토:** QUICK/COMPLEX는 첫 Slice에서 미지원으로 보고한다. V0.1에서 QUICK을 추가하고 COMPLEX는 우선 판정·보류를 보장한다. 복잡 작업의 실제 사례가 생기면 Lead의 planning 겸임을 추가한다.

## ADR-003 — 역할별 독립 SDK AgentSession

- **상태:** Proposed
- **문제:** 같은 대화에서 “이제 Reviewer”라고 바꾸면 구현 reasoning과 권한이 그대로 남는다.
- **예:** Developer의 bash 권한을 유지한 Reviewer가 코드를 고친 뒤 PASS하면 독립 검토가 아니다.
- **결정:** 역할 호출마다 새 SDK 세션, 명시적 context/tools/resources, 별도 session 참조를 만든다. Reviewer에는 일반 bash/edit/write를 주지 않는다.
- **대안:** 단일 세션 Prompt 전환, subagent 예제의 JSON subprocess, 신규 AgentHarness.
- **이유:** SDK가 필요한 주입 지점을 제공하고 subprocess wire parsing 없이 결과·취소를 연결할 수 있다.
- **비용/재검토:** 동일 프로세스는 보안 격리가 아니다. 메모리·프로세스 장애 격리나 비신뢰 작업 실행이 필요하면 subprocess/container runner로 adapter를 교체한다. 부모 리소스나 Provider override의 자동 상속은 가정하지 않는다.

## ADR-004 — 정책은 실행 경로에 적용, 승인과 sandbox를 구분

- **상태:** Proposed
- **문제:** 부모 tool hook이나 위험 명령 정규식만으로 모든 실행을 막을 수 없다.
- **예:** 자식 세션의 bash, Extension의 `pi.exec`, 검증 스크립트 내부 네트워크 요청은 서로 다른 경로다.
- **결정:** worker 도구와 verifier의 실행 직전 공통 정책을 호출한다. 미등록 도구·임의 셸은 기본 거부하며 경로·역할을 검사한다. R3 승인은 정확한 action 1회에 묶고 평가 실패·UI 없음·만료는 미실행으로 처리한다.
- **대안:** Prompt 지시, tool 이름 allowlist만 사용, 전체 명령에 포괄 승인.
- **이유:** 명세의 위험 작업 최종 권한을 실제 실행 지점에서 유지해야 한다.
- **비용/재검토:** 악성 Node Extension/외부 프로세스/승인된 프로그램의 내부 동작은 완전히 제한하지 못한다. OS sandbox는 별도 요구사항이다. 첫 Slice는 R2/R3를 차단하고, V0.1에서 제한된 R3 action의 승인 경로를 추가한다.

## ADR-005 — `.ai`는 운영 상태, Pi Session은 실행 기록

- **상태:** Proposed
- **문제:** `.ai`에 대화까지 복사하거나 custom entry만 상태 원본으로 쓰면 session branch와 프로젝트 현실이 충돌한다.
- **예:** 과거 대화 branch로 돌아가도 이미 수정된 파일이나 실행한 작업은 되돌아가지 않는다.
- **결정:** Pi에는 대화·tool history·branch/compaction을 보관한다. `.ai`에는 목표·task·phase·결정·검증 참조를 둔다. `appendEntry`는 run/session 링크용이다.
- **대안:** Pi 세션만 사용, 대화 전체를 `.ai`에 복제, SQLite부터 도입.
- **이유:** 명세의 세션 독립 상태를 지키면서 저장 책임을 중복하지 않는다.
- **비용/재검토:** 서로 다른 저장소 간 트랜잭션은 없다. 참조 누락·진행 중 상태는 명시적인 오류/중단으로 처리한다. 신규 SQLite backend는 기존 JSONL SessionManager의 drop-in replacement가 아니다.

## ADR-006 — 단일 writer와 보수적 중단 복구

- **상태:** Proposed
- **문제:** 여러 Pi 프로세스가 같은 `.ai`를 쓰거나 두 JSON 파일 사이에서 crash하면 상태가 모순된다.
- **예:** state는 완료인데 tasks는 진행 중일 수 있다. 실행 결과 저장 직전 crash한 명령을 재실행하면 부작용이 중복된다.
- **결정:** 프로젝트 단일 writer lock, `state.json` 원본, revision 기반 `tasks.json` projection, 파일별 원자 교체를 사용한다. 재시작 시 진행 중 run은 INTERRUPTED로 보고 자동 재실행하지 않는다.
- **대안:** lock 없는 파일 저장, 여러 파일의 원자성 가정, 처음부터 event sourcing/분산 lease.
- **이유:** 개인용 단일 실행에 필요한 최소 안전장치다. Pi 파일 mutation queue는 프로세스 간 조직 lock을 대체하지 못한다.
- **비용/재검토:** 자동 resume와 exactly-once 실행을 보장하지 않는다. 복구는 사용자 확인이 필요하다. 병렬 writer나 durable resume가 실제 요구가 되면 저장 구조를 재평가한다.

## ADR-007 — 모델 profile과 기존 Pi 인증 재사용

- **상태:** Proposed
- **문제:** 역할 정의에 특정 GPT/DeepSeek 모델을 고정하면 교체 때 코드를 수정해야 한다.
- **결정:** 역할 → capability profile → 사용자 provider/model mapping으로 연결한다. 기존 ModelRuntime과 Pi 인증·모델 설정을 재사용하며 비밀 값을 `.ai`에 복사하지 않는다.
- **대안:** 역할별 모델 하드코딩, 새 Provider client/auth layer, 자동 모델 fallback.
- **이유:** 명세의 교체 가능한 모델 자원을 구현하면서 Pi의 기존 추상화를 유지한다.
- **비용/재검토:** 부모 Extension의 동적 Provider나 메모리 인증은 별도 SDK ModelRuntime에 자동 반영되지 않는다. 첫 구현은 지원하는 인증·등록 경로를 명시하고 시작 전 검사한다. 필요하면 검토한 Provider adapter를 명시적으로 주입한다. 실패를 다른 모델로 조용히 대체하지 않는다.

## ADR-008 — 구조화 결과와 증거 기반 완료

- **상태:** Proposed
- **문제:** “테스트 통과, 완료”라는 LLM 문장은 실행 증거가 아니다.
- **예:** Reviewer가 D1 diff에 PASS한 뒤 autofix가 D2를 만들면 그 PASS는 최신 코드 승인으로 쓸 수 없다.
- **결정:** schema 기반 handoff/review, 실제 check 실행 결과, diff digest를 연결한다. Kernel이 완료 조건을 평가한다. REVISE는 유한 횟수이며 BLOCK/실패/미검증을 성공으로 바꾸지 않는다.
- **대안:** 자연어 parsing, Developer 자가 승인, Reviewer 요약만 확인, 검증 실패 무시.
- **이유:** 구현자와 최종 리뷰 분리 및 검증 우선 원칙을 코드로 유지한다.
- **비용/재검토:** 상태·증거 계약이 추가되지만 첫 Slice부터 필요하다. QUICK의 Reviewer 생략은 별도 명시적 예외이며 정책·검증은 생략하지 않는다. Requirement 충족 여부에 대한 모델 검토도 정확성의 수학적 보장은 아니다.

## ADR-009 — 설정은 데이터이며 정책 완화 권한이 아님

- **상태:** Proposed
- **문제:** Developer가 수정 가능한 프로젝트 설정이 정책까지 낮출 수 있으면 gate를 우회할 수 있다.
- **예:** `.ai/config.yaml`에 `review.enabled: false`를 써서 R2 작업의 Reviewer를 없애는 경우.
- **결정:** YAML schema 검증, run 시작 시 설정 고정, worker의 Runtime 설정/상태 수정 금지, 상위 불변식 우선 적용. 검증 명령의 실행 내용도 사용자 신뢰 대상으로 취급한다.
- **대안:** 모든 YAML 옵션을 그대로 적용, worker가 설정을 자유롭게 재작성.
- **이유:** 프로젝트별 편의 설정과 권한 변경을 분리해야 한다.
- **비용/재검토:** 지원하지 않는 설정에는 오류가 필요하다. 마스터 명세의 여러 YAML 예시는 그대로 혼합하지 않고 S0에서 한 schema로 정리한다.

## ADR-010 — 작은 패키지, 명령 UI, 실험적 스택 유보

- **상태:** Proposed
- **문제:** 초기부터 별도 UI·서버·plugin 플랫폼을 만들면 STANDARD 동작 검증이 늦어진다.
- **결정:** `packages/company-runtime/`에 Runtime과 Extension entry를 둔다. 먼저 명시적 `-e` 로딩과 네 slash command를 제공하고, 필요하면 `setStatus/setWidget`만 추가한다.
- **대안:** Core 디렉터리 혼합, 거대한 `.pi/extensions` 단일 파일, custom TUI, Chord 서비스 기반 재구축.
- **이유:** 독립 테스트와 기존 root 검사 범위를 활용하면서 upstream Core diff를 만들지 않는다.
- **비용/재검토:** 새 workspace package의 scripts/dependency/lockfile 통합은 검토해야 한다. 공개 배포·브랜드·RPC·다중 클라이언트는 이번 결정에 포함하지 않는다.

## ADR-011 — Runtime은 Host 독립 경계와 구조화 실행 이벤트를 제공한다

- **상태:** Accepted — S1 경계에 대한 사용자 요청 반영. 외부 Host 구현 승인을 뜻하지 않는다.
- **문제:** Kernel이 Pi 세션이나 UI를 직접 다루면 다른 실행 환경이나 상태 화면을 붙일 때 핵심 로직을 수정해야 한다.
- **예:** Reviewer 재작업을 표시하려는 UI에는 Pi tool history가 아니라 `runId`, `stepId`, `attempt`와 Review 결과가 필요하다.
- **결정:** Kernel은 Pi 구체 타입을 import하지 않는다. Host의 명령·UI는 Pi Extension Adapter, Agent 실행은 `AgentExecutor` Port 뒤의 Pi Agent Adapter가 담당한다. Verifier, StateStore, ApprovalPort, RuntimeEventSink도 현재 필요한 작은 계약으로 한정한다.
- **이벤트:** 주요 상태 전이를 구조화 RuntimeEvent로 전달한다. 이벤트는 관찰용이며 상태 원본이나 실행 명령이 아니다. 저장 성공 후 순서대로 발행하고, sink 실패는 관찰 오류로 보고하며 실행 실패를 성공으로 바꾸지 않는다.
- **단계 식별:** STANDARD의 `implement`, `self-check`, `review`, `test`, `complete` ID를 고정한다. 재작업은 같은 Step ID와 증가한 attempt로 구분한다. `(runId, stepId, attempt)`가 한 단계 실행을 식별한다.
- **미래 확장:** 다른 Host/Control Surface는 Adapter로 연결할 수 있다. DAG 시각화는 Runtime Event를 화면용 그래프로 변환하는 projection부터 시작한다.
- **제외:** V0.1은 기존 STANDARD 순차 상태 머신을 유지한다. T3Code 연동, Web/Graph UI, RPC 서버, 별도 서비스, 범용 DAG scheduler, 병렬 실행, Event Sourcing, plugin framework는 구현하지 않는다.
- **기존 결정과의 관계:** ADR-001/010의 Extension-first와 별도 모듈, ADR-002의 순차 Kernel, ADR-003의 Pi SDK adapter, ADR-005/006의 상태 원본, ADR-008의 검증 guard를 구체화한다. ADR-004/007/009의 정책·모델·설정 원칙에도 충돌하지 않으므로 ADR-001~010은 변경하지 않는다.
- **비용/재검토:** Port와 이벤트 계약의 관리 비용만 추가한다. 전달 보장·재연결·재생·DAG 의존성 계산은 현재 제공하지 않으며 실제 요구가 생기면 별도 결정한다.

## 보류한 결정

| 항목 | 현재 기본값 / 다음 판단 시점 |
|---|---|
| 제품명·CLI 이름 | `company-runtime` 임시 명칭; 제품화 시 결정 |
| config 최종 schema | S0에서 명세의 중복 예시를 통합 |
| `.ai` Git 추적 범위 | config/결정과 상태/log 구분 권장; 사용자 확인 필요 |
| lock 구현 라이브러리 | 로컬 단일 writer 계약부터 확정; 새 dependency 최소화 |
| 자동 resume / checkpoint | V0.2 이후, 부작용 재실행 계약부터 설계 |
| 병렬 역할 / worktree | 순차 1개부터 시작; 충돌 없는 실제 작업에서 재검토 |
| COMPLEX 실행 | V0.1 판정은 필수, Lead 실행 단계는 별도 범위 확인 |
| Provider 동적 등록 공유 | 첫 환경에서 필요 여부 확인; parent 전체 리소스 상속 금지 |
| OS sandbox | 비신뢰 코드·외부 작업 실행 요구가 생기면 별도 설계 |
| 모델 fallback / 비용 routing | 기본 중단·보고, V0.2 이후 |

## Core 수정 승인 기록

현재 **제안된 Core 수정 없음**. 새 기능이 Extension으로 불가능하다는 재현 근거가 나오기 전에는 수정 대상을 미리 만들지 않는다.
