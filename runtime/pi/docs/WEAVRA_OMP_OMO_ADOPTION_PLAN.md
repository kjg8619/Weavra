# Weavra — OMP / OMO Native(Senpi) Adoption Plan

- 작성일: 2026-09-17 (KST)
- 대상: Weavra `devlop`
- 목적: OMP와 OMO Native(Senpi)에서 검증된 아이디어를 조사하고, Weavra의 현재 안전성·상태·검증 철학을 유지하면서 가져올 가치가 있는 기능을 우선순위화한다.
- 성격: **기능 도입 설계 후보 문서**. 별도로 구현 상태를 기록한 V0.2C/V0.3A/V0.3B를 제외하면 후보 항목이며 구현 완료를 의미하지 않는다.
- 현재 Weavra 기준선: V0.1 Runtime/RC, fork-local launcher, worktree create/open/list, Status Projection, V0.2A read-only DAG Projection, V0.2B 정적 TUI Viewer, V0.2C Product Isolation/setup/doctor. V0.3A optional Hash-Anchored Edit 구현은 §15 및 WORK_LOG LOG-039를 따른다. `codex-lb / gpt-6-astra`의 한정된 [실제 Provider anchored smoke](WEAVRA_V03A_PROVIDER_SMOKE_2026-09-17.md) 두 시나리오는 PASS다. V0.3B read-only LSP는 §15 및 LOG-043의 구현/검증 범위를 따른다.

> 핵심 원칙: OMP/OMO의 기능을 그대로 복제하지 않는다. Weavra가 이미 가진 `Kernel → Policy → Verification → Review/Approval → State` 경계를 유지하면서, 필요한 개념만 작은 Port/Adapter 또는 read-only projection으로 흡수한다.

---

## 1. 조사 대상

### OMP

- 저장소: https://github.com/YanwuZeng/omp
- Pi 계열의 coding-first harness로, hash-anchored edits, LSP, DAP, browser/web, subagents, Hindsight memory, hidden tool discovery 등을 제공한다.
- 특히 **편집 안정성**, **IDE 수준 code intelligence**, **도구 표면 확장**, **프로젝트 메모리** 측면에서 참고 가치가 높다.

### OMO / OmO Native(Senpi)

- 저장소: https://github.com/code-yeongyu/oh-my-openagent
- Senpi 저장소: https://github.com/code-yeongyu/senpi
- OMO는 OpenCode/Codex/standalone Native 변형을 갖고 있으며, Team Mode, category/model routing, skills, MCP, background agents, goal/todo continuation, setup/agent-dir 관리 등 orchestration과 product packaging 측면이 강하다.
- OMO Native 계열은 독립 agent directory와 setup/doctor 같은 **제품화 UX** 관점에서 특히 참고 가치가 높다.

### 조사 시점 주의

위 프로젝트들은 빠르게 변한다. 이 문서는 2026-09-17 시점 공개 문서/저장소의 개념을 기준으로 하며, 실제 코드 이식 전에는 최신 소스·라이선스·의존성·API를 다시 확인한다.

---

## 2. Weavra 현재 철학과 도입 기준

Weavra는 이미 다음 경계를 의도적으로 강하게 유지한다.

```text
User request
    ↓
Classification / Risk
    ↓
Kernel-owned Workflow
    ↓
Role-specific Agent Adapter
    ↓
Policy gate
    ↓
Mutation / Verification
    ↓
Independent Review / Human Approval
    ↓
Freshness / Completion guard
    ↓
Durable State + Read-only Observation
```

따라서 외부 기능을 평가할 때 다음 기준을 사용한다.

1. **Kernel authority를 우회하지 않는가?**
2. **새 mutation이 Policy/Approval을 건너뛰지 않는가?**
3. **검증 결과가 PASS처럼 과장되지 않는가?**
4. **stale state/evidence를 재사용하지 않는가?**
5. **Worker tool surface를 무제한으로 넓히지 않는가?**
6. **Pi Host/TUI와 Runtime core를 다시 강하게 결합하지 않는가?**
7. **실제 사용성이 늘어나는가, 단순 기능 수만 늘어나는가?**

---

## 3. 우선순위 요약

| 후보 | 적합도 | 권장 시점 | 도입 방식 |
|---|---:|---|---|
| Weavra 전용 setup / agent-dir 분리 | ★★★★★ | V0.2C 구현 | launcher/helper; §15 참조 |
| Hash-Anchored Edit | ★★★★★ | V0.3A 구현 / 한정 Provider smoke PASS | 기존 read/edit optional mode; §15 참조 |
| LSP Diagnostics / Navigation | ★★★★★ | V0.3B 구현 | run-scoped read-only tools + advisory evidence; §15 |
| QA Evidence / Doctor | ★★★★★ | V0.3C | 검증/제품 운영 레이어 |
| AST Edit Preview → Apply | ★★★★☆ | V0.4 전후 | R2 proposal + apply |
| Bounded Goal / Todo Continuation | ★★★★☆ | COMPLEX 전 | Kernel budget 내부 |
| Capability / Tool Discovery | ★★★★☆ | 도구 증가 후 | CapabilityBroker |
| Project Memory / Facts | ★★★☆☆ | 안정화 후 | 명시적 facts 우선 |
| Team Mode / Parallel Subagents | ★★★☆☆ 지금 / ★★★★★ 나중 | COMPLEX 단계 | DAG + worktree + typed handoff |
| Rules 자동 import | ★★☆☆☆ | 선택적 후순위 | explicit allowlist만 |
| DAP / Browser / persistent eval | ★★☆☆☆ 지금 | 장기 | governed adapter만 |
| Auto commit / merge / cleanup | ★☆☆☆☆ | 비권장 | 현재 철학과 충돌 |

---

# 4. 최우선 후보 1 — Weavra Setup / 전용 Agent Directory

## 참고점

OMO Native 계열은 하나의 canonical agent directory를 두고 setup/doctor/launcher가 모두 같은 위치를 바라보도록 관리한다. 이 방식은 업데이트 후 설정이 사라져 보이거나 서로 다른 entry point가 다른 설정을 읽는 문제를 줄이는 데 유용하다.

현재 Weavra는 실행 파일은 이미 분리됐다.

```text
pi      → 기존 Pi
weavra  → fork-local Pi + Weavra Runtime
```

이 문서의 최초 작성 당시에는 기본 설정/인증/session을 Pi 경로와 공유했다. V0.2C에서는 아래 분리를 구현했다. 상세한 실제 범위/한계는 §15를 따른다.

## 디렉터리 경계

V0.2C 기본값:

```text
~/.pi/
  ... 기존 Pi ...

~/.weavra/
  agent/
    settings.json
    auth.json
    models.json
    sessions/
```

형태를 검토한다.

명령 후보:

```bash
weavra setup
weavra doctor
```

`setup` 책임:

- 기존 Pi/환경의 사용 가능한 credential/model 설정을 **read-only 탐색**
- 사용자에게 import 여부 확인
- 기존 Weavra 값을 자동 overwrite하지 않음
- canonical Weavra agent dir 생성
- 실제 적용 경로 출력

`doctor` 책임:

- fork-local CLI build 존재
- Extension 경로
- agent-dir
- model/auth readiness
- Git version
- Node version
- optional LSP availability는 후속 후보(V0.2C 미구현)
- stale lock/unsafe project 진단은 후속 후보(V0.2C는 프로젝트 없이 user-level 경로와 실행 파일만 검사)

## 도입 조건

- auth/session migration은 명시적 사용자 승인
- credential 원문을 WORK_LOG/evidence에 기록 금지
- 기존 Pi 설치를 수정하지 않음
- launcher가 여러 default 경로를 독자적으로 조합하지 않고 단일 helper 사용

## 평가

**V0.2B 이후 가장 먼저 해도 좋은 제품화 작업.** 기능 자체보다 Weavra를 독립된 개인 coding assistant로 만드는 의미가 크다.

---

# 5. 최우선 후보 2 — Hash-Anchored Edit

## 참고점

OMP는 hash-anchored edit 계열을 중심 기능으로 사용한다. 핵심 아이디어는 단순 문자열 치환보다 **읽었던 특정 line/content anchor의 최신성**을 검증하고, 그 anchor가 stale이면 mutation을 거부하는 것이다.

Weavra의 현재 stale 보호는 주로 다음 단계에 강하다.

```text
Developer result
    ↓
Diff digest
    ↓
Reviewer PASS
    ↓
Final verification
    ↓
Digest mismatch → BLOCK
```

여기에 mutation 직전 stale guard를 추가할 수 있다.

## V0.3A 구현 구조

```text
runtime_read({path, anchors:true})
  ↓
opaque line anchors + full-file digest
  ↓
runtime_edit({path, oldText, newText, anchor, fileDigest})
  ↓
Policy evaluation → durable ALLOW → current file re-read
  ↓
fileDigest → anchor → anchored exact oldText verify
  ├─ match → final bytes/identity/cancel check → mutation
  └─ stale → STALE_ANCHOR / no mutation / re-read required
```

최초 Port 후보 대신 `src/anchored-edit.ts` 순수 helper와 `src/anchored-files.ts` filesystem adapter를 선택했다. tool surface/Policy risk 등록을 늘릴 필요가 없으며, 기존 `runtime_edit` operation과 audit 경계를 재사용한다. **Policy ALLOW가 stale precondition 검사를 대신하지 않는다.**

## 적용 순서

1. QUICK/R1 단일 파일 small edit에서 anchored read/edit를 우선 권장
2. 기존 exact edit와 runtime_write는 유지; STANDARD/R2에 anchored-only 강제하지 않음
3. stale anchor / duplicate occurrence / moved text / line ending 변화 자동 검증
4. 실제 Provider small-edit smoke 후 확대/강제 여부 별도 결정

## 안전 조건

- hash match 자체가 권한이 아니다. Policy는 계속 별도 적용
- anchor 자동 fuzzy 보정으로 다른 위치를 수정하지 않음
- mismatch 시 모델에게 재-read/re-propose 요구
- Reviewer/final digest guard는 그대로 유지

## 평가

**코딩 정확도와 Weavra 철학이 가장 잘 맞는 기능 중 하나.** 단순 편의 기능이 아니라 mutation integrity를 강화한다.

---

# 6. 최우선 후보 3 — LSP Diagnostics / Navigation

## 참고점

OMP는 LSP를 diagnostics/navigation/symbol/rename/code action까지 폭넓게 사용한다. OMO/Senpi 계열도 LSP를 coding harness capability로 활용한다.

Weavra에는 우선 **read-only LSP**가 적합하다.

## V1 범위

```text
LspPort
├─ diagnostics(file/workspace)
├─ definition(symbol/location)
├─ references(symbol/location)
└─ documentSymbols(file)
```

### Verification 연계

```text
SELF_CHECK
├─ registered process checks
└─ LSP diagnostics snapshot

TEST
├─ registered test checks
└─ final LSP diagnostics snapshot
```

V0.3B의 실제 LSP 상태:

```text
AVAILABLE
UNAVAILABLE
PARTIAL
STALE
ERROR
```

query availability와 코드 품질을 구분한다. 빈 diagnostics도 자동 PASS가 아니며 기존 error diagnostic이 있다고 자동 FAIL하지 않는다. push-only snapshot은 완료를 확인할 수 없어 PARTIAL이다. required process checks의 PASS/FAIL/UNAVAILABLE 및 Kernel completion guard를 유지한다.

## V1에서 제외

- rename
- codeAction apply
- formatter/autofix
- organize imports mutation

이 항목들은 실제 파일 변경이므로 이후 R2 mutation backend로 별도 설계한다.

## 추가 가치

Reviewer 입력에 다음을 evidence로 제공할 수 있다.

```text
changed files
actual diff
registered checks
LSP diagnostics delta
```

예: 변경 전 error 2개 → 변경 후 0개.

## 평가

**V0.3B에서 read-only advisory evidence로 구현했다.** LSP가 mutation/completion authority가 되지 않도록 explicit routing·run-scoped cleanup·result path filtering·freshness와 required process checks 분리를 적용했다. 상세 범위는 §15와 [실제 smoke](WEAVRA_V03B_LSP_SMOKE_2026-09-17.md)를 따른다.

---

# 7. 최우선 후보 4 — QA Evidence / Doctor

## 참고점

OMO 개발 문화는 실제 harness QA와 evidence를 강하게 남기는 편이다. Weavra도 이미 개발 과정에서:

```text
unit/integration tests
→ npm run check
→ real TUI smoke
→ GPT RC
→ WORK_LOG
```

를 반복하고 있다.

이 과정을 제품 기능으로 정리할 가치가 있다.

## 제안

```bash
weavra qa
weavra doctor
```

Evidence 예:

```text
.ai/evidence/
  2026-09-17T103000/
    manifest.json
    environment.json
    checks.json
    git.json
    summary.md
```

포함 후보:

- Weavra source commit
- project HEAD
- OS / Node / Git
- workflow/risk
- check IDs
- exit code / duration
- state revision
- workspace digest
- graph digest
- final status

포함하지 않을 것:

- 전체 LLM reasoning/transcript
- API key/credential
- 환경변수 전체 dump
- 민감한 check stdout의 무검토 공개

## Evidence 소유권

`.ai/state.json`은 계속 Runtime source of truth이고, evidence bundle은 **파생 산출물**이다.

기존 `/state export` 철학처럼:

- source state를 변경하지 않음
- generated marker/checksum
- 사용자 수정 파일 overwrite 금지
- 전체 transaction이라고 과장하지 않음

## 평가

Weavra 개발/배포가 커질수록 가치가 증가한다. 특히 실제 프로젝트에서 "왜 이 run을 신뢰했는가"를 재확인하기 좋다.

---

# 8. 후보 — AST Edit Preview → Apply

## 참고점

OMP의 preview/resolve 패턴처럼 구조적 변경을 즉시 쓰지 않고 제안 상태로 만들 수 있다.

## Weavra식 제안

```text
AST transformation request
        ↓
Proposal
        ↓
Derived diff preview
        ↓
Policy / risk
        ↓
Reviewer (R2)
        ↓
Apply
        ↓
Verification
```

Proposal 예:

```ts
interface MutationProposal {
  id: string;
  targetFiles: string[];
  beforeDigest: string;
  proposedDiff: ...;
  operation: "rename" | "structured-edit" | ...;
}
```

## 주의

- proposal 생성과 apply를 분리
- apply 직전 beforeDigest 재검증
- 자동 apply 금지
- AST engine이 지원하지 않는 언어에서 text fallback으로 몰래 전환하지 않음

## 평가

대규모 rename/refactor가 필요해질 때 유용하지만 현재 exact/small mutation보다 후순위다.

---

# 9. 후보 — Bounded Goal / Todo Continuation

## 참고점

OMO/Senpi의 goal/todo continuation은 agent가 미완료 작업을 이어가게 하는 UX가 강하다.

Weavra에는 그대로 가져오면 안 된다. 이미 Kernel이 완료 조건을 소유한다.

## Weavra식 해석

```text
Incomplete
   ↓
Continuation allowed?
   ↓
Budget check
   ├─ revision cycles
   ├─ attempt cap
   ├─ wall-clock cap
   ├─ optional token/cost cap
   └─ risk unchanged
   ↓
new attempt
```

무한 Ralph loop 형태가 아니라 **bounded continuation**만 허용한다.

## Task/Todo의 위치

- 사용자 계획/표시용 task는 가능
- 완료 authority는 todo checkbox가 아니라 Kernel
- todo 완료가 Review/Verification/Approval을 대체하지 않음

## 평가

STANDARD보다 복잡한 작업과 COMPLEX 도입 전에 유용하다.

---

# 10. 후보 — Capability / Tool Discovery

## 참고점

OMP는 hidden tool index와 BM25 검색으로 필요한 tool을 동적으로 찾는 패턴을 제공한다. OMO는 skill과 scoped capability/MCP를 연결한다.

현재 Weavra는 도구가 적어서 지금 도입할 필요가 없다.

향후 도구가 늘면:

```text
read/search
anchored edit
LSP
AST
web
browser
GitHub
MCP
debug
```

모든 schema를 항상 worker context에 넣는 비용과 안전 문제가 생긴다.

## 제안 구조

```text
Agent intent
    ↓
CapabilityBroker.search(query)
    ↓
Candidate capabilities
    ↓
Policy + role + risk
    ↓
Scoped activation
```

예:

```ts
interface CapabilityDescriptor {
  id: string;
  kind: "read" | "mutation" | "process" | "network";
  riskFloor: "R0" | "R1" | "R2" | "R3";
  roles: Role[];
  provider: string;
}
```

## 핵심

**tool discovery 결과가 곧 실행 권한은 아니다.** 활성화 전에 Policy가 최종 authority를 가진다.

## 평가

V0.4 이후 ToolBroker/MCP 도입 전 기반으로 적합하다.

---

# 11. 후보 — Project Memory / Facts

## 참고점

OMP의 Hindsight는 프로젝트별 durable memory를 유지한다.

Weavra에도 장기적으로 유용하지만 자동 기억은 stale/잘못된 가정 위험이 있다.

## 첫 단계 권장

자동 memory보다 **명시적 Project Facts**부터 시작한다.

```text
/state facts
/fact add "This project uses pnpm"
/fact add "DB migration requires manual approval"
/fact remove <id>
```

저장 예:

```json
{
  "id": "fact-...",
  "text": "DB migration requires manual approval",
  "source": "user",
  "createdAt": "...",
  "scope": "project"
}
```

## 사용 규칙

- Worker prompt 자동 주입은 allowlist/size cap
- 사실마다 source/createdAt 유지
- code evidence와 충돌 시 memory를 authority로 사용하지 않음
- 자동 추론 facts는 별도 status(`suggested`)로 저장하고 사용자 승인 전 사용 제한

## 평가

유용하지만 code intelligence/verification보다 후순위.

---

# 12. 장기 후보 — Team Mode / Parallel Subagents

## 참고점

OMO Team Mode는 lead/member, message/task, max parallel, wall-clock/member turn/message cap을 가진다. OMP도 parallel subagent와 workspace isolation 개념이 강하다.

Weavra에는 **COMPLEX workflow 단계**에서 참고할 가치가 매우 높다.

현재 이미 다음 기반이 있다.

```text
GraphProjection
Worktree isolation
Typed Handoff
Independent Reviewer
Policy / Approval
Durable State
```

## 장기 구조 예

```text
Planner
   ↓
Execution DAG
   ├─ Worker A → worktree A
   ├─ Worker B → worktree B
   └─ Researcher → read-only
          ↓
      typed handoff
          ↓
Integrator
   ↓
Reviewer
   ↓
Verification
```

## 필수 budget

- max parallel agents
- max total agents
- max member turns
- max wall-clock
- max inter-agent messages/bytes
- max revision cycles
- cancellation propagation

## 중요

현재 V0.2 DAG는 **projection**이다. 향후 execution DAG를 만들더라도 기존 GraphProjection을 scheduler state로 오용하지 않는다.

```text
Execution Plan / Scheduler State
           ↓
         Kernel
           ↓
     Runtime State
           ↓
   GraphProjection
```

방향을 유지한다.

## 평가

지금 구현하면 너무 이르다. COMPLEX 진입 시 최우선 참고 대상으로 유지한다.

---

# 13. 당장 가져오지 않을 것

## 13.1 AGENTS.md / CLAUDE.md / rules 자동 import

OMP/OMO는 다른 도구의 rules/skills를 적극적으로 발견·재사용한다. 편리하지만 Weavra의 worker resource isolation과 충돌할 수 있다.

필요하면 나중에:

```yaml
context:
  allow:
    - AGENTS.md
    - .weavra/rules/*.md
```

같은 explicit allowlist만 검토한다.

자동 recursive discovery를 기본값으로 두지 않는다.

## 13.2 Persistent Python/Bun eval

현재 Weavra는 arbitrary execution을 제한한다. persistent REPL을 Developer에게 바로 주면 Policy 경계가 사실상 무력화될 수 있다.

필요하면 registered process/sandbox 기반으로 별도 설계한다.

## 13.3 DAP Debugger

가치가 높지만 process control + runtime mutation + long-lived resource 관리가 필요하다. LSP read-only 이후 별도 단계로 둔다.

## 13.4 Browser / Web automation

Researcher 역할이 생기면 유용하지만 네트워크 content trust, credential, browser process, download/file write 정책이 먼저 필요하다.

## 13.5 Auto commit / merge / worktree cleanup

현재 Weavra의 핵심 철학과 맞지 않는다.

```text
no automatic commit
no automatic merge
no automatic rollback
no automatic destructive cleanup
```

사용자 검토 후 명시적 별도 명령으로만 검토할 수 있다.

---

# 14. 권장 로드맵

현재 V0.2B Viewer 이후의 제안 순서:

```text
V0.2B
Read-only TUI DAG Viewer
    ↓
V0.2C
Weavra Setup / ~/.weavra isolation / Doctor
    ↓
V0.3A
Hash-Anchored Edit
    ↓
V0.3B
LSP Diagnostics / Navigation
    ↓
V0.3C
QA Evidence / Doctor 강화
    ↓
V0.4A
AST Proposal / Preview / Apply
    ↓
V0.4B
Capability Broker / Tool Discovery
    ↓
V0.4C
Explicit Project Facts
    ↓
V0.5
COMPLEX / Planner / Execution DAG / Parallel Agents
```

이 순서는 고정 계약이 아니다. 실제 사용에서 pain point가 먼저 발견되면 작은 범위로 순서를 바꿀 수 있다.

---

# 15. 추천 구현 단위

## V0.2C — Product Isolation

2026-09-17 구현 범위(검증 상세: [WORK_LOG LOG-037](WORK_LOG.md#log-037--v02c-product-isolation--setup--doctor)):

- 기본 `WEAVRA_HOME=~/.weavra`, effective agent dir `$WEAVRA_HOME/agent`. 절대/tilde override, Pi와 lexical/canonical 경로 격리. launcher는 child의 `PI_CODING_AGENT_DIR`을 덮어쓰고 inherited `PI_CODING_AGENT_SESSION_DIR`은 제거한다.
- `weavra setup`: 프로젝트/build 없이 private 디렉터리 생성. 기본 Pi agent dir의 auth/models/settings 3개만 read-only 탐색하고 파일별 기본 No 동의로 import한다. settings는 extension/path/sessionDir 경고 후 optional import. 대상이 있으면 SKIP, force/자동 migration은 없다.
- 복사는 regular/single-link UTF-8 JSON object만 허용한다. 0600 temp write/fsync → atomic no-clobber link publication → temp 제거로 기존 대상을 덮어쓰지 않는다. 디렉터리 0700을 사용하고 기존 권한은 자동 변경하지 않는다.
- first run은 명시적 setup 방식(A)이다. Pi 자체 first-time setup은 custom agent dir에서 생략되므로 Weavra 미설정이면 `Run: weavra setup`으로 실패한다. auth 부재는 Weavra `/login`으로 해결할 수 있다.
- `weavra doctor`: checkout/build/Extension·Node/Git·home/agent 권한/격리·auth/models/settings JSON·session 기본 해석을 read-only 검사한다. WARN-only exit 0, 필수 FAIL non-zero. READY는 로컬 조건이며 auth refresh/Provider/network 검증은 하지 않는다. credential 값은 출력하지 않는다.
- 기존 Pi session 전체는 자동 import하지 않는다. 새 `--continue`는 Weavra의 cwd partition을 사용하고, 명시적 Pi `--session`/`--session-dir`은 보존한다. optional settings의 sessionDir은 경고할 뿐 재작성하지 않는다.
- `.ai`는 계속 프로젝트 Runtime state/evidence이며 user-level config로 쓰지 않는다. setup/doctor는 Runtime/Extension에서 import되지 않는 별도 launcher helper다.
- 임시 HOME의 fake Pi → setup → doctor → 실제 fork-local Weavra startup/명령 smoke 및 SessionManager 경로/continue 검증을 수행한다. 사용자 실제 HOME은 테스트로 수정하지 않는다.
- QA evidence bundle/LSP availability/프로젝트 stale-lock 진단, keychain, cloud sync, auto update, auth format 변경, bulk session migration은 미구현이며 후속 후보로 유지한다. 명시적 settings/project/session override와 임의 실행 코드에 대한 OS sandbox는 아니다.

## V0.3A — Anchored Edit

2026-09-17 구현 범위(검증 상세: [WORK_LOG LOG-039](WORK_LOG.md#log-039--v03a-hash-anchored-edit)):

- `runtime_read`의 optional `anchors:true`, `runtime_edit`의 optional `anchor`+`fileDigest`를 추가한다. 둘 중 하나만 있으면 입력 오류. 기존 plain read/unique exact edit/write 의미와 `WORKER_FILE_TOOLS` operation 등록·Policy config digest 재료는 유지한다.
- token은 `a1:L<line>:<SHA-256>`이며 canonical workspace/target path·행 번호·terminator 포함 exact line을 결합한다. full-file `sha256:<hex>` digest는 BOM/LF/CRLF/final newline을 구분하는 exact UTF-8 bytes다. 일부 unrelated edit도 보수적으로 stale 처리한다. 동일 bytes로 복원된 ABA나 암호학적 read 인증은 목표가 아니다.
- Policy ALLOW와 durable intent 뒤 파일을 다시 읽는다. digest → anchor → 해당 행에서 시작하는 unique exact oldText 순으로 검사한다. multiline oldText는 가능하며 다른 행의 중복은 허용, 같은 행에서 시작하는 중복/겹침은 AMBIGUOUS로 거부한다. mismatch는 STALE_ANCHOR, mutation 0 bytes, fuzzy/자동 위치 보정 없음이다.
- strict UTF-8 round-trip, non-NUL, 256 KiB source/replacement, no-follow/nonblocking·regular/single-link·allowed/protected path를 유지한다. snapshot은 JSON-escaped 행 내용과 안전한 control/bidi 출력이며 256 KiB bound·명시적 long-line preview/remaining-lines truncation을 적용한다.
- `anchored-edit.ts` domain helper는 crypto 외 SDK/Provider/fs 의존성이 없다. `anchored-files.ts`는 동일 FD를 재읽고 마지막 bytes/identity/cancel을 확인한 뒤 동기 쓰기한다. 외부 프로세스에 대한 OS atomic CAS나 multi-file transaction은 아니며 최종 syscall race/부분 I/O 실패 한계는 남는다.
- 기존 actionDigest가 path·anchor·fileDigest·oldText/newText·step·revision을 포함한다. 새 credential/content 로그 저장은 없다. stale는 ALLOW 후 FAILED audit이고, Runtime이 확인한 stale 오류만 같은 세션의 명시적 재읽기를 허용한다. 자동 retry loop나 턴/시간 예산 확대는 없다.
- QUICK/R1 fixed target에서 anchored preference를 prompt/tool description으로 안내하되 안내를 safety authority로 사용하지 않는다. STANDARD/R2 run binding·Reviewer read-only·R3 approval·Kernel/Verification/Graph/Viewer/Worktree/Product Isolation은 그대로다.
- **Anchored stale protection applies to anchored `runtime_edit` operations; it does not magically make every possible file mutation anchored.** `runtime_write`와 legacy exact edit 우회 가능성은 남는다. 모든 existing-file mutation의 anchored-only 강제는 별도 후속이다.
- 자동 domain/filesystem/SDK-faux와 기존 targeted regression을 검증했다. 후속 [실제 Provider smoke](WEAVRA_V03A_PROVIDER_SMOKE_2026-09-17.md)에서 사용자 fixture의 격리 복제본·기존 `codex-lb / gpt-6-astra`로 두 번째 occurrence만 수정→QUICK COMPLETE 및 외부 변경→old anchor→STALE_ANCHOR/bytes 보존을 확인했다. 두 번째 run은 거부 확인 뒤 테스트가 취소했으며 실제 모델의 후속 복구까지 PASS로 주장하지 않는다. 전체 GPT RC-01~08은 재실행하지 않았다.
- fuzzy/AST/LSP/rename/formatter/autofix/editor integration/multi-file transaction/auto merge·commit은 추가하지 않는다.

## V0.3B — LSP

2026-09-17 구현 범위(검증 상세: WORK_LOG LOG-043, [실제 TS/Provider smoke](WEAVRA_V03B_LSP_SMOKE_2026-09-17.md)):

- Host-independent `LspPort`와 `lsp/{types,config,protocol,client,manager,files,normalize,evidence,tools,command}.ts`로 분리했다. Kernel/Policy/Reviewer에 SDK/TUI/실행 authority를 옮기지 않는다.
- `.ai/config.yaml`의 `code_intelligence.lsp`에 enabled/servers(id,executable,args,extensions,timeout_ms)를 명시한다. default disabled, 서버 4개·unique ID/extension routing·argv 배열·root=project root. shell/inline eval/install wrapper 및 임의 env/remote/multi-root는 미지원이다.
- `StandardWorkflow`가 lazy start/initialize/initialized/query/shutdown/exit와 process-group cleanup을 소유한다. run 안에서만 같은 server를 재사용한다. 순차 query이므로 global refCount pool/idle daemon 없이 COMPLETE 전 및 finally에 닫는다. cleanup 미확인 시 성공/lease 해제를 막는다.
- `code-yeongyu/pi-lsp-client` MIT commit `1c981dfcacc456fe4ce9f4120a2f0250b54d6844`의 shared lifecycle/refCount/init timeout/idle reaping/crash detection/typed one-time retry와 LICENSE/NOTICE를 조사했다. 개념만 참고한 독립 구현이며 MIT 코드 직접 복사·extension 설치·OMO SUL-1.0 차용은 없다. 기존 Node built-ins로 bounded framing을 구현하여 production dependency/lockfile을 늘리지 않았다.
- 진단/정의/참조/document symbols만 제공한다. `workspace/applyEdit`는 applied:false, 그 밖의 미지원 server request는 -32601이다. rename/prepareRename/codeAction/formatting/organizeImports/workspace-wide symbols와 자동 install/fix 경로는 없다. config/workspaceFolders/progress 요청만 제한 응답한다.
- 최대 frame 1 MiB/buffer 2 MiB/header 4 KiB/pending 16/stderr 16 KiB, result items 128/약 8 KiB·symbol depth 16, control/bidi escaping과 truncation을 적용한다. malformed protocol은 실패로 닫고 typed CLOSED/EXITED만 최대 1회 cleanup 후 retry한다. timeout/cancel/protocol/policy/stale는 자동 retry하지 않는다.
- `runtime_lsp_diagnostics/definition/references/symbols`는 enabled run에만 기존 Policy read/R0로 등록한다. path는 literal allowed/protected/regular/single-link/strict UTF-8 256 KiB 경계, 위치는 1-based UTF-16이다. 결과 URI도 검사하여 외부/protected/disallowed/symlink 항목 전체를 숨기고 withheld 수만 반환한다. arbitrary URI 파일 읽기·출력은 없다.
- 요청 전후 disk digest가 다르면 STALE/빈 결과로 재-query를 요구한다. diagnostics는 AVAILABLE/UNAVAILABLE/PARTIAL/STALE/ERROR이며 코드 PASS/FAIL이 아니다. push-only는 현재 URI/version을 제한해 수집하지만 완료/완전성 미확인으로 PARTIAL을 유지한다.
- SELF_CHECK/TEST의 기존 required process checks 이후 workspace inspect→변경 파일 최대 8개의 LSP→최종 inspect를 수행한다. workspace가 바뀌면 captured diffDigest의 LSP evidence를 STALE로 표시하고 기존 check freshness도 유지한다. cancellation 중 기존 process exit/output도 보존한다.
- verifier-owned LSP refs와 reviewContext.evidence를 정확히 일치시켜 actual diff/checks와 함께 Reviewer에 전달한다. trustedReviewEvidenceRefs/Kernel ref/completion guard 및 mandatory independent review는 불변이다. LSP는 hard completion gate가 아니며 새 durable LSP store/cache/export는 추가하지 않았다.
- `/lsp`·`/lsp status`는 current config 또는 live frozen manager metadata의 read-only 조회다. server/Provider/writer/Git 실행·repair가 없다. READY는 executable resolution이지 initialization/diagnostics/PASS가 아니다. project-independent `weavra doctor`는 바꾸지 않았다.
- 외부 language server/플러그인은 reviewed trusted code다. client mutation API는 없지만 서버 자체의 직접 파일 I/O·네트워크를 OS sandbox하지 않는다. credential 환경은 기존 verifier처럼 필터링하고 TypeScript automatic typing acquisition은 initialize 옵션으로 끈다. 탈출 daemon/외부 syscall 경합은 기존 한계다.
- fake stdio server로 lifecycle/malformed/bounds/timeout/cancel/crash retry/path filtering/applyEdit 거부 및 SDK-faux QUICK/R0/R1·STANDARD/R1/R2·R3/Reviewer/evidence를 검증했다. 기존 Graph/Viewer/setup/doctor/worktree/anchored-edit/stale-review 회귀도 유지했다.
- 설치된 `typescript-language-server 5.1.3`에서 TS2322 진단, definition/references/document symbols, workspace 무변경과 종료를 확인했다. 실제 `codex-lb/gpt-6-astra` STANDARD/R1 한 run은 diagnostics 도구를 사용하고 Reviewer가 exact PARTIAL evidence를 받아 process checks 4개 PASS 뒤 COMPLETED했다. 전체 GPT RC/다른 server·OS/Node로 확대하지 않는다.

## V0.3C — QA Evidence

DoD 후보:

- evidence bundle 생성
- credential/transcript 제외
- source state 불변
- generated ownership/checksum
- `weavra doctor`와 연결

---

# 16. 피해야 할 아키텍처 회귀

외부 harness를 참고하면서도 다음은 피한다.

### 1. Tool이 Kernel authority가 되는 구조

잘못된 예:

```text
Agent → tool → 직접 approve / complete
```

유지할 구조:

```text
Agent → tool request → Policy/Approval → Kernel completion
```

### 2. Graph가 Scheduler가 되는 암묵적 전환

현재 `GraphProjection`은 display DTO다. execution DAG가 필요해지면 별도 schema/authority를 만든다.

### 3. 편의를 위해 stale evidence 자동 보정

anchor/hash/digest mismatch는 자동 fuzzy repair보다 재-read/re-plan을 우선한다.

### 4. 외부 설정 자동 import

"발견"과 "적용"을 분리하고 적용은 사용자 승인 후 진행한다.

### 5. 모든 capability를 모든 Agent에 제공

역할별 최소 tool surface를 유지하고 CapabilityBroker 도입 후에도 scoped activation만 허용한다.

---

# 17. 소스/참고 링크

- OMP: https://github.com/YanwuZeng/omp
- OMO / oh-my-openagent: https://github.com/code-yeongyu/oh-my-openagent
- OMO Team Mode/설치 문서: https://github.com/code-yeongyu/oh-my-openagent/tree/dev/docs/guide
- OMO configuration: https://github.com/code-yeongyu/oh-my-openagent/tree/dev/docs/reference
- Senpi: https://github.com/code-yeongyu/senpi
- 기존 Weavra Pi extension 조사: [WEAVRA_EXTENSION_ADOPTION_PLAN.md](WEAVRA_EXTENSION_ADOPTION_PLAN.md)
- Weavra architecture: [ARCHITECTURE.md](ARCHITECTURE.md)
- Weavra decisions: [DECISIONS.md](DECISIONS.md)
- 작업 이력: [WORK_LOG.md](WORK_LOG.md)

---

# 18. 결론

OMP/OMO에서 Weavra가 가장 먼저 배워야 할 것은 "기능 개수"가 아니다.

```text
OMP
→ edit precision / code intelligence / capability surface

OMO Native
→ product setup / bounded orchestration / team budgets / operational UX

Weavra
→ fail-closed workflow / policy / independent review / evidence / human approval
```

세 방향을 합치되 Weavra의 authority 구조를 유지하는 것이 핵심이다.

가장 가까운 실전 우선순위는 다음 세 가지다.

1. **Weavra Setup + 독립 agent directory** — 제품 경계 완성
2. **Hash-Anchored Edit** — mutation integrity 강화
3. **LSP Diagnostics/Navigation** — coding/verification 품질 강화

그 뒤 QA Evidence와 Capability Broker를 쌓고, 충분히 안정된 다음에만 OMO Team Mode/OMP subagent 스타일의 COMPLEX/parallel execution으로 확장한다.
