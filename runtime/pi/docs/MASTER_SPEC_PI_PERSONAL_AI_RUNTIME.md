# PI Fork Personal AI Organization Runtime — MASTER_SPEC

> Pi를 기반으로 개인용 AI Organization Runtime을 개발하기 위한 마스터 명세서

```yaml
document:
  id: PI-PERSONAL-AI-RUNTIME-MASTER-SPEC
  version: 0.1.0
  status: draft
  language: ko-KR
  scope: personal
  base_runtime: pi-fork
```

---

# 0. 문서 목적

이 문서는 Pi를 Fork하여 개인용 AI 개발 런타임을 구축하기 위한 최상위 기준 문서다.

이 프로젝트의 목적은 단순한 멀티 에이전트 실행기가 아니다.

사용자의 요청을 분석하고, 필요한 최소 AI 조직을 동적으로 구성하며, 각 Agent에 역할과 권한을 부여하고, 계획 → 실행 → 검토 → 검증 → 완료까지의 전체 작업 수명주기를 관리하는 개인용 AI 작업 운영체계를 만드는 것이 목표다.

이 문서는 다음 항목의 기준이 된다.

- 제품 방향
- 아키텍처
- Agent 역할
- Workflow
- Risk / Approval 정책
- 상태 관리
- 모델 선택 전략
- 검증 정책
- 개발 우선순위
- V0.1 Definition of Done

---

# 1. 프로젝트 정의

## 1.1 프로젝트 이름

현재 미정.

개발 초기에는 특정 브랜드명에 종속되지 않는 중립적인 내부 명칭을 사용한다.

예:

```text
company
kernel
runtime
orchestrator
workflow
agent
```

CLI 이름과 설정 디렉터리는 제품명이 확정된 이후 변경한다.

---

## 1.2 한 문장 정의

> 사용자의 목표를 분석하여 필요한 최소 AI 조직을 동적으로 구성하고, 역할·권한·상태·검증·승인 규칙을 통해 작업을 끝까지 수행하는 개인용 AI Organization Runtime.

---

# 2. 핵심 철학

## 2.1 최상위 원칙

> 멀티 에이전트를 사용하는 것이 목적이 아니라 작업을 가장 효율적으로 완료하는 것이 목적이다.

작업 규모가 작다면 Agent 하나만 사용한다.

작업 규모가 크거나 역할 분리가 실제 품질 향상에 도움이 되는 경우에만 복수 Agent를 구성한다.

---

## 2.2 최소 조직 원칙

항상 가능한 최소 조직을 사용한다.

잘못된 예:

```text
작은 오타 수정

Lead
├── Planner
├── Researcher
├── Developer
├── Reviewer
└── QA
```

올바른 예:

```text
작은 오타 수정

Executor
```

---

## 2.3 검증 우선 원칙

구현 완료 선언보다 검증을 우선한다.

가능한 경우 완료 전에 다음을 확인한다.

- build
- lint
- test
- git diff
- 요구사항 충족 여부

검증할 수 없는 항목은 검증했다고 가정하지 않는다.

---

## 2.4 역할 분리 원칙

구현자는 자신의 작업을 최종 승인하지 않는다.

가능하면 다음 역할을 분리한다.

```text
Implementation != Final Review
```

---

## 2.5 인간 최종 권한 원칙

위험도가 높은 작업의 최종 권한은 사용자에게 있다.

다음과 같은 작업은 자동 실행하지 않는 것을 기본으로 한다.

- 데이터 삭제
- 대량 파일 삭제
- production 변경
- 배포
- credential 변경
- git history 변경
- 파괴적 명령 실행

---

# 3. 개발 전략

## 3.1 Pi Fork 전략

Pi를 Fork하여 개발하지만 upstream과의 divergence를 최소화한다.

우선순위:

1. 기존 Pi 기능 재사용
2. Pi Extension API 활용
3. 별도 Runtime Layer 구현
4. 필요한 경우에만 Pi Core 수정

---

## 3.2 Extension-first 원칙

다음 기능은 가능한 한 Extension 또는 Runtime Layer로 구현한다.

- Agent orchestration
- Workflow selection
- Team composition
- Policy / Risk 판단
- Approval gate
- State management
- Verification
- Custom commands
- TUI 상태 표시

---

## 3.3 Core 변경 조건

Pi Core 수정이 필요한 경우 반드시 먼저 기록한다.

```text
1. Extension으로 구현할 수 없는 이유
2. 수정 대상 Core 영역
3. upstream merge 영향
4. 대체 구현 가능성
```

가능하면 Core 수정은 얇은 adapter 수준으로 제한한다.

---

# 4. 전체 아키텍처

```text
                     USER
                       │
                       ▼
              ┌─────────────────┐
              │ Company Kernel  │
              └────────┬────────┘
                       │
       ┌───────────────┼────────────────┐
       │               │                │
       ▼               ▼                ▼
 Intent Engine   Workflow Engine   Policy Engine
       │               │                │
       └───────────────┼────────────────┘
                       │
                       ▼
                Team Composer
                       │
                       ▼
                Agent Runtime
                       │
         ┌─────────────┼──────────────┐
         ▼             ▼              ▼
      Planner      Developer       Reviewer
         │             │              │
         └─────────────┼──────────────┘
                       ▼
              Verification Engine
                       │
                       ▼
                  State Engine
                       │
                       ▼
                     USER
```

---

# 5. Company Kernel

Company Kernel은 이 프로젝트의 중심 Runtime이다.

항상 별도 LLM Agent로 존재할 필요는 없다.

가능한 경우 코드 기반 Runtime이 다음을 담당한다.

- 사용자 요청 해석
- Intent classification
- Complexity classification
- Risk classification
- Workflow 선택
- 필요한 역할 선택
- Agent 실행 순서 결정
- Agent 결과 전달
- 검증 상태 관리
- State 기록
- 최종 결과 통합

---

# 6. Intent Engine

사용자 요청을 정규화한다.

기본 결과 구조:

```yaml
intent:
  type:
  complexity:
  risk:
  confidence:
```

예:

```yaml
intent:
  type: bugfix
  complexity: standard
  risk: R1
  confidence: 0.92
```

---

## 6.1 초기 Intent 종류

초기에는 너무 많은 분류를 만들지 않는다.

```text
question
analysis
bugfix
implementation
refactor
research
architecture
creative
maintenance
```

필요 시 확장한다.

---

# 7. Complexity Classification

초기 Complexity는 세 단계로 제한한다.

```text
QUICK
STANDARD
COMPLEX
```

## QUICK

예:

- 오타 수정
- 작은 설정 변경
- 한 파일의 단순 수정
- 짧은 설명
- 간단한 명령 실행

## STANDARD

예:

- 일반 기능 구현
- 버그 수정
- 중간 규모 리팩터링
- 테스트 추가

## COMPLEX

예:

- 신규 시스템 설계
- 아키텍처 변경
- 다수 모듈 수정
- 대규모 리팩터링
- 여러 단계의 조사와 구현이 필요한 작업

---

# 8. Workflow Engine

Workflow는 작업 특성에 따라 선택한다.

## 8.1 QUICK

```text
Kernel
  ↓
Executor
```

특징:

- 불필요한 Reviewer 생성 안 함
- 짧은 작업
- 낮은 Risk

---

## 8.2 STANDARD

```text
Kernel
  ↓
Developer
  ↓
Reviewer
```

주요 사용처:

- 버그 수정
- 기능 구현
- 일반 리팩터링

---

## 8.3 COMPLEX

```text
Kernel
  ↓
Lead
├── Planner
├── Developer
└── Reviewer
```

V0.1에서는 별도 Planner 없이 Lead가 Planning 역할을 겸할 수 있다.

---

## 8.4 향후 Workflow 후보

V0.2 이후 검토:

```text
RESEARCH
CREATIVE
SECURITY
MIGRATION
INCIDENT
```

---

# 9. Team Composer

Team Composer는 Workflow에 따라 필요한 최소 역할만 선택한다.

중요 원칙:

```text
등록된 Agent 수 != 실행되는 Agent 수
```

Agent가 10개 등록되어 있어도 작업에 1개만 필요하면 1개만 사용한다.

---

# 10. Agent Registry

Agent 상세 구성은 아직 확정하지 않는다.

초기 후보:

```text
Executor
Lead
Developer
Reviewer
Planner
Researcher
Explorer
Designer
```

V0.1에서는 다음을 우선한다.

```text
Developer
Reviewer
Lead (필요한 경우)
```

---

# 11. Agent Role 정의

## 11.1 Developer

책임:

- 문제 원인 분석
- 실제 코드 구현
- 코드 수정
- 테스트 작성
- 필요한 도구 실행
- 변경사항 요약

금지:

- 자신의 변경을 최종 승인
- 위험 정책 우회

---

## 11.2 Reviewer

책임:

- Developer와 독립적으로 검토
- git diff 확인
- 요구사항 충족 여부 확인
- build/test 결과 검토
- 누락 및 회귀 가능성 확인

결과:

```text
PASS
REVISE
BLOCK
```

---

## 11.3 Lead

항상 실행되는 Agent가 아니다.

복잡한 작업에서만 사용한다.

책임:

- 작업 분해
- Agent 조율
- 결과 통합
- 우선순위 결정
- Agent 간 충돌 해결

---

# 12. 모델 전략

현재 주요 사용 모델군:

```text
GPT 계열
DeepSeek 계열
```

특정 모델을 Agent 정의에 직접 고정하지 않는다.

---

## 12.1 Capability Profile 방식

예:

```yaml
model_profiles:

  fast:
    purpose:
      - exploration
      - lightweight_analysis
      - simple_tasks

  coding:
    purpose:
      - implementation
      - bugfix
      - refactor

  reasoning:
    purpose:
      - planning
      - architecture
      - review

  creative:
    purpose:
      - design
      - ideation
```

---

## 12.2 Agent와 모델 연결

좋은 예:

```yaml
developer:
  profile: coding

reviewer:
  profile: reasoning
```

피해야 할 예:

```yaml
developer:
  model: specific-model-name
```

---

## 12.3 실제 모델 매핑

사용자 설정에서 매핑한다.

```yaml
model_mapping:

  coding:
    provider: openai
    model: TBD

  reasoning:
    provider: openai
    model: TBD

  fast:
    provider: deepseek
    model: TBD

  creative:
    provider: openai
    model: TBD
```

이 구조를 통해 모델 변경 시 Runtime 코드를 수정하지 않도록 한다.

---

# 13. Risk / Policy Engine

초기 Risk Level은 네 단계로 정의한다.

```text
R0
R1
R2
R3
```

---

## 13.1 R0

비파괴 작업.

예:

- 파일 읽기
- 검색
- 분석
- 코드 구조 확인

정책:

```text
자동 실행 가능
```

---

## 13.2 R1

일반 코드 수정.

예:

- 파일 수정
- 테스트 추가
- 일반 버그 수정

정책:

```text
실행 가능
완료 후 보고
```

---

## 13.3 R2

영향 범위가 큰 변경.

예:

- dependency 변경
- 프로젝트 구조 변경
- 대규모 리팩터링
- 설정 체계 변경

정책:

```text
Reviewer 검증 필수
```

---

## 13.4 R3

위험한 작업.

예:

- 대량 파일 삭제
- 데이터 삭제
- production 변경
- 배포
- credential 수정
- git history 변경
- destructive command

정책:

```text
사용자 승인 필수
```

---

# 14. Approval Gate

Risk 판단은 단순 Prompt 지시가 아니라 가능한 한 Tool 실행 직전에 코드로 검증한다.

개념:

```text
Agent
  ↓
Tool Request
  ↓
Policy Engine
  ↓
Risk Check
  ├─ R0 → RUN
  ├─ R1 → RUN + LOG
  ├─ R2 → REVIEW REQUIRED
  └─ R3 → HUMAN APPROVAL
```

---

# 15. State Engine

프로젝트 상태를 세션과 독립적으로 유지한다.

초기 저장 위치:

```text
.ai/
```

---

## 15.1 초기 구조

```text
.ai/
├── state.json
├── tasks.json
├── decisions.md
├── config.yaml
└── logs/
```

---

## 15.2 state.json

최소 필드:

```json
{
  "goal": "",
  "phase": "",
  "workflow": "",
  "currentTask": "",
  "activeAgents": [],
  "completed": [],
  "next": []
}
```

---

## 15.3 tasks.json

예:

```json
{
  "pending": [],
  "inProgress": [],
  "completed": [],
  "blocked": []
}
```

---

## 15.4 decisions.md

중요한 기술적 판단을 기록한다.

예:

```markdown
## 2026-XX-XX

### Decision
JWT refresh token 저장 방식을 Redis로 변경

### Reason
세션 무효화와 다중 장치 처리를 단순화하기 위해 선택

### Alternatives
- DB 저장
- Stateless refresh token

### Status
Accepted
```

---

## 15.5 config.yaml

프로젝트별 Runtime 설정.

예:

```yaml
workflow:
  default: adaptive

review:
  enabled: true

risk:
  destructive_requires_approval: true

agents:
  max_parallel: 3

models:
  coding: coding
  reasoning: reasoning
```

---

# 16. Pi Session과 프로젝트 State 관계

Pi가 제공하는 기존 Session 기능을 먼저 분석한다.

다음 데이터를 중복 저장하지 않도록 한다.

- 대화 기록
- tool call history
- session tree
- branch 정보
- compaction 정보

`.ai`에는 프로젝트 운영에 필요한 장기 상태만 저장한다.

예:

```text
Pi Session
→ 대화 및 실행 기록

.ai
→ 프로젝트 목표 / 현재 작업 / 결정 / 다음 행동
```

---

# 17. Verification Engine

코드 작업 기본 Lifecycle:

```text
IMPLEMENT
   ↓
SELF CHECK
   ↓
REVIEW
   ↓
TEST
   ↓
COMPLETE
```

---

## 17.1 가능한 검증 항목

```text
build
lint
test
git diff
typecheck
format check
project-specific validation
```

프로젝트 환경에 없는 명령을 억지로 실행하지 않는다.

---

## 17.2 완료 조건

다음 조건을 만족해야 완료로 처리한다.

```text
1. 요구사항 충족
2. 필요한 변경 적용
3. 가능한 검증 수행
4. Reviewer가 필요한 경우 PASS
5. 차단된 항목 명시
```

---

# 18. Agent Handoff

Agent 간 결과 전달은 명확한 구조를 사용한다.

Developer → Reviewer 예:

```yaml
handoff:
  task:
  changed_files:
  summary:
  assumptions:
  tests_run:
  known_risks:
  unresolved:
```

Reviewer → Developer 예:

```yaml
review:
  result: REVISE
  issues:
    - severity:
      file:
      description:
      recommendation:
```

---

# 19. Retry / Revision

Reviewer가 REVISE를 반환하면 Developer에게 작업을 돌려보낸다.

```text
Developer
  ↓
Reviewer
  ├─ PASS → Complete
  ├─ REVISE → Developer
  └─ BLOCK → User / Lead
```

무한 반복을 방지한다.

예:

```yaml
review:
  max_revision_cycles: 3
```

초과 시 Lead 또는 사용자에게 에스컬레이션한다.

---

# 20. Commands

V0.1 후보:

```text
/team
/state
/workflow
/risk
```

---

## 20.1 /team

현재 조직 상태 확인.

예:

```text
Lead       inactive
Developer  working
Reviewer   waiting
```

---

## 20.2 /state

예:

```text
Goal:
Fix login 500 error

Current:
Investigating token validation

Next:
Patch implementation
Regression test
Review
```

---

## 20.3 /workflow

예:

```text
Workflow : STANDARD
Phase    : IMPLEMENT
```

---

## 20.4 /risk

예:

```text
Current Risk : R1
```

---

# 21. TUI

V0.1에서 UI는 필수 핵심 기능이 아니다.

Runtime 기능이 먼저다.

가능하다면 추후 다음 상태를 표시한다.

```text
Workflow : STANDARD
Phase    : IMPLEMENT
Risk     : R1
Agents   : Developer ● Reviewer ○
Task     : Fix authentication failure
```

---

# 22. 병렬 처리

병렬 처리는 독립성이 있는 작업에만 사용한다.

좋은 예:

```text
Research dependency options
Analyze current architecture
Search related tests
```

나쁜 예:

```text
동일 파일을 두 Agent가 동시에 수정
```

---

## 22.1 초기 제한

```yaml
agents:
  max_parallel: 3
```

V0.1에서는 병렬 실행보다 안정적인 handoff 구현을 우선한다.

---

# 23. 초기 파일 구조 제안

실제 Pi 구조 분석 후 변경 가능.

논리적 구조:

```text
company/
├── kernel/
│   ├── intent.ts
│   ├── complexity.ts
│   └── runtime.ts
│
├── workflow/
│   ├── selector.ts
│   ├── quick.ts
│   ├── standard.ts
│   └── complex.ts
│
├── agents/
│   ├── registry.ts
│   ├── developer.ts
│   ├── reviewer.ts
│   └── lead.ts
│
├── policy/
│   ├── risk.ts
│   └── approval.ts
│
├── state/
│   ├── state-manager.ts
│   └── schema.ts
│
├── verification/
│   └── verifier.ts
│
└── commands/
    ├── team.ts
    ├── state.ts
    ├── workflow.ts
    └── risk.ts
```

이 구조를 그대로 강제하지 않는다.

Pi의 기존 Extension 구조와 자연스럽게 통합되는 방향을 우선한다.

---

# 24. V0.1 Scope

V0.1에서 구현할 핵심:

## Kernel

```text
[ ] Intent classification
[ ] Complexity classification
[ ] Risk classification
[ ] Workflow selection
[ ] Team composition
```

## Agent

```text
[ ] Developer
[ ] Reviewer
[ ] Lead (필요한 경우)
```

## Runtime

```text
[ ] Agent 실행
[ ] Agent 간 handoff
[ ] Developer → Reviewer
[ ] Reviewer → Developer revision
[ ] 완료 상태 관리
```

## Policy

```text
[ ] R0 ~ R3
[ ] 위험 작업 감지
[ ] R3 사용자 승인
```

## State

```text
[ ] .ai/state.json
[ ] .ai/tasks.json
[ ] .ai/decisions.md
[ ] .ai/config.yaml
```

## Commands

```text
[ ] /team
[ ] /state
[ ] /workflow
[ ] /risk
```

## Verification

```text
[ ] git diff
[ ] test
[ ] build
[ ] lint
```

실제 프로젝트에 존재하는 명령만 선택 실행한다.

---

# 25. V0.1 대표 성공 시나리오

사용자 요청:

```text
이 프로젝트에서 로그인할 때 500 오류가 발생하는데
원인을 찾아서 수정해줘.
```

시스템 판단:

```yaml
intent:
  type: bugfix
  complexity: standard
  risk: R1
```

조직:

```text
Developer
Reviewer
```

실행:

```text
1. Developer가 문제 조사
2. 원인 확인
3. 코드 수정
4. 관련 테스트 실행
5. Reviewer에게 handoff
6. Reviewer가 diff 및 요구사항 검증
7. PASS 또는 REVISE
8. PASS인 경우 State 업데이트
9. 사용자에게 결과 보고
```

이 전체 사이클이 실제 동작하면 V0.1 핵심 성공으로 본다.

---

# 26. 개발 단계

## Phase 0 — Pi 구조 조사

코딩 전에 현재 Pi 구조를 분석한다.

반드시 확인:

```text
1. Extension lifecycle
2. custom commands
3. custom tools
4. tool-call interception
5. permission / approval 구현 가능 지점
6. sub-agent 실행 방식
7. session persistence
8. configuration loading
9. TUI extension
10. model/provider abstraction
```

결과물:

```text
docs/
├── ARCHITECTURE.md
├── IMPLEMENTATION_PLAN.md
└── DECISIONS.md
```

---

## Phase 1 — Kernel Skeleton

구현:

```text
Intent
Complexity
Risk
Workflow Selector
Team Composer
```

실제 LLM 호출 없이 테스트 가능한 부분은 unit test를 만든다.

---

## Phase 2 — Agent Runtime

구현:

```text
Developer
Reviewer
handoff
review loop
```

---

## Phase 3 — State

구현:

```text
.ai
state persistence
task persistence
decision log
```

---

## Phase 4 — Policy / Approval

구현:

```text
Risk detection
tool interception
approval gate
```

---

## Phase 5 — Commands / TUI

구현:

```text
/team
/state
/workflow
/risk
```

TUI status는 이후 추가 가능.

---

## Phase 6 — Hardening

검증:

```text
error handling
retry control
revision limit
session restore
model failure fallback
partial task failure
```

---

# 27. 개발 시 금지사항

## 27.1 거대한 System Prompt 하나로 구현

금지.

정책은 가능한 한 코드로 구현한다.

---

## 27.2 모든 작업에서 Multi-Agent 사용

금지.

최소 조직 원칙을 따른다.

---

## 27.3 특정 모델 Hard Coding

금지.

Capability Profile을 사용한다.

---

## 27.4 Reviewer가 단순 요약만 수행

금지.

Reviewer는 실제로 다음을 확인해야 한다.

```text
diff
requirements
tests
risks
regression possibility
```

---

## 27.5 검증 없이 완료 선언

금지.

실행 가능한 검증이 있다면 수행한다.

---

## 27.6 Core를 무분별하게 수정

금지.

Core 수정 이유를 문서화한다.

---

# 28. 향후 확장 후보

V0.2 이후:

```text
Planner
Researcher
Explorer
Designer
Security Reviewer
Database Specialist
DevOps Specialist
```

Workflow 확장:

```text
RESEARCH
CREATIVE
MIGRATION
SECURITY
INCIDENT
```

기능 확장:

```text
model fallback
cost-aware routing
token-budget routing
parallel research
task dependency graph
checkpoint
resume
agent performance metrics
workflow templates
project-specific agents
```

---

# 29. 개인용 제품 범위

초기에는 다음 기능을 구현하지 않는다.

```text
사용자 계정
조직 관리
팀 권한
Cloud Sync
Web Dashboard
Plugin Marketplace
Multi-user collaboration
Remote Server
```

개인용이므로 다음 조합이면 충분하다.

```text
CLI
+
TUI
+
YAML
+
.ai State
+
Agent Runtime
```

---

# 30. 초기 설정 예시

```yaml
runtime:
  workflow: adaptive

models:
  profiles:
    coding:
      provider: openai
      model: TBD

    reasoning:
      provider: openai
      model: TBD

    fast:
      provider: deepseek
      model: TBD

agents:
  max_parallel: 3
  max_revision_cycles: 3

review:
  enabled: true

state:
  enabled: true
  directory: ".ai"

risk:
  approval_required:
    - R3
```

---

# 31. 운영 불변식

다음 규칙은 구현 과정에서도 유지한다.

1. 필요한 최소 조직만 구성한다.
2. Agent 숫자가 많을수록 좋은 것이 아니다.
3. 구현자는 자신의 결과를 최종 승인하지 않는다.
4. 위험한 작업은 사용자 권한을 침범하지 않는다.
5. 검증할 수 있는 것은 검증한다.
6. 모델은 역할이 아니라 교체 가능한 실행 자원이다.
7. 프로젝트 상태는 Session과 구분한다.
8. Core 변경은 최소화한다.
9. 정책은 가능한 한 Runtime에서 강제한다.
10. AI 조직보다 사용자 목표 달성이 우선이다.

---

# 32. Pi에게 최초로 줄 실행 지시

아래 순서로 진행한다.

```text
1. 현재 Pi 저장소 구조를 분석한다.
2. MASTER_SPEC.md 요구사항을 읽는다.
3. Pi에서 재사용 가능한 기능을 식별한다.
4. Extension으로 구현 가능한 부분과 Core 수정이 필요한 부분을 구분한다.
5. docs/ARCHITECTURE.md를 작성한다.
6. docs/IMPLEMENTATION_PLAN.md를 작성한다.
7. docs/DECISIONS.md를 작성한다.
8. 아직 대규모 구현은 시작하지 않는다.
9. V0.1 최소 vertical slice를 제안한다.
10. 이후 작은 단계로 구현한다.
```

---

# 33. 최초 Vertical Slice

첫 번째 실제 구현 목표:

```text
사용자 요청
↓
STANDARD 판정
↓
Developer 실행
↓
Reviewer 실행
↓
PASS / REVISE
↓
상태 저장
↓
최종 보고
```

이 흐름 하나를 완성한 뒤 기능을 확장한다.

---

# 34. Definition of Done — V0.1

다음 조건을 모두 만족해야 한다.

```text
[ ] Pi에서 실제 실행 가능
[ ] QUICK / STANDARD / COMPLEX 판정 가능
[ ] Risk R0 ~ R3 판정 가능
[ ] STANDARD 작업에서 Developer → Reviewer 흐름 동작
[ ] Reviewer REVISE 시 재작업 가능
[ ] 위험 Tool Call 차단 또는 승인 요청 가능
[ ] .ai 상태 저장 가능
[ ] /team 동작
[ ] /state 동작
[ ] /workflow 동작
[ ] /risk 동작
[ ] 가능한 build/test/lint 검증 수행
[ ] 기존 Pi 핵심 기능 회귀 없음
```

---

# 35. 한 문장 헌법

> 목표 달성에 필요한 최소한의 AI 조직만 구성하고, 검증 가능한 작업을 수행하며, 중요한 결정과 위험한 변경의 최종 권한은 사용자에게 둔다.

추가 실행 원칙:

> 계획보다 실행, 실행보다 검증, 조직보다 결과를 우선한다.
