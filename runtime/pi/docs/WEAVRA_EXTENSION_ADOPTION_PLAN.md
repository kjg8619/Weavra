# Weavra — Pi Extension Adoption Plan

> 목적: Pi 생태계의 확장/예제 중 Weavra에 실제로 가져올 가치가 높은 요소를 조사하고, 기존 V0.1 RC 의미론을 깨지 않으면서 어떤 방식으로 흡수할지 정리한다.
>
> 기준: `weavra-v0.1-rc1` 이후 개발 방향. 이 문서는 구현 계획이며 현재 지원 기능을 의미하지 않는다.

## 1. 결론 요약

우선 검토할 대상은 다음 4개다.

| 우선순위 | 후보 | Weavra에서의 역할 | 권장 방식 |
|---|---|---|---|
| 1 | `smoosex/pi-footer` | Workflow/Risk/Phase/Revision 상태 표시 | **직접 의존하지 않고 status contract만 호환** |
| 2 | `pi-worktree` 계열 | clean workspace / disposable 작업공간 | **Weavra Launcher에 native worktree mode로 흡수** |
| 3 | `apmantza/pi-lens` | LSP/lint/typecheck/diagnostics | **Worker extension으로 로드하지 않고 Verification backend로 흡수** |
| 4 | Pi 공식 `sandbox` / Gondolin | OS-level process/file/network 격리 | **Verifier/Process boundary부터 단계적으로 적용** |

핵심 원칙은 다음과 같다.

1. Weavra의 Kernel/Policy/State/Approval/Completion Guard가 계속 최종 권한을 가진다.
2. 외부 extension을 Worker `ResourceLoader`에 자동 로드하지 않는다.
3. verification 결과를 생성하는 확장은 결과를 보고할 뿐 완료 판단을 직접 하지 않는다.
4. formatter/autofix처럼 코드 mutation을 일으키는 기능은 기본 비활성화한다.
5. worktree/sandbox도 Weavra의 정책을 대체하지 않는다. 방어 계층을 추가할 뿐이다.
6. RC-01~RC-08에서 검증한 fail-closed / stale-evidence / approval semantics를 완화하지 않는다.

---

## 2. 기준 아키텍처

현재 Weavra의 핵심 경계는 유지한다.

```text
Host / Launcher
      │
      ▼
Weavra Extension Adapter
      │
      ▼
Company Runtime
 ├─ Kernel
 ├─ Classification
 ├─ Policy
 ├─ StateStore
 ├─ Verification
 └─ AgentExecutor Port
        │
        ▼
   Pi Agent Adapter
        │
        ▼
   Pi AgentSession
```

외부 확장은 이 Kernel 내부에 무분별하게 들어오면 안 된다.

권장 확장 지점은 아래 네 곳이다.

```text
UI Status Port        ← footer/statusline 계열
Workspace Port        ← worktree 계열
Verification Port     ← pi-lens 계열
Execution Sandbox     ← official sandbox / Gondolin
```

---

# 3. Candidate A — pi-footer

## 3.1 조사 대상

- GitHub: <https://github.com/smoosex/pi-footer>
- 설치 예: `pi install npm:@smoose/pi-footer`

주요 특징:

- model / thinking / path / git / context / token / cost 등의 footer segment
- custom segment ordering
- 다른 extension이 `ctx.ui.setStatus(key, value)`로 등록한 status를 footer custom item으로 표시 가능
- status가 없는 경우 숨김 처리 가능
- footer 폭이 부족할 때 다음 줄로 overflow

## 3.2 Weavra에 적합한 이유

Weavra는 이미 다음 상태를 가지고 있다.

```text
workflow
risk
phase / step
revisionCycle
agent role
review result
approval state
run status
```

현재는 `/workflow`, `/state`, `/team`, `/risk`로 조회해야 한다.

이 중 일부를 footer에 상시 노출하면 사용자 경험이 크게 좋아진다.

예:

```text
Weavra STANDARD · R2 · REVIEW · rev 1/3 │ gpt-6-astra · high │ main* │ ctx 31%
```

## 3.3 가져올 것

Weavra parent Extension이 status를 발행하는 작은 계약만 추가한다.

예:

```ts
ctx.ui.setStatus("weavra-workflow", "STANDARD");
ctx.ui.setStatus("weavra-risk", "R2");
ctx.ui.setStatus("weavra-phase", "REVIEW");
ctx.ui.setStatus("weavra-run", "RUNNING");
```

필요하면 한 개의 합성 status도 제공한다.

```ts
ctx.ui.setStatus("weavra", "STANDARD · R2 · REVIEW");
```

## 3.4 가져오지 않을 것

- pi-footer 렌더러를 Weavra 내부로 복사
- footer theme/color/powerline 자체 구현
- footer가 Runtime 상태의 source of truth가 되는 구조

Footer는 **Projection/UI**일 뿐이다.

## 3.5 권장 구현

```text
Runtime State/Event
       ↓
Weavra Status Projection
       ↓
ctx.ui.setStatus(...)
       ↓
pi-footer 또는 다른 statusline
```

따라서 Weavra는 pi-footer가 설치되지 않아도 정상 동작해야 한다.

## 3.6 우선순위

**HIGH / 가장 먼저 적용 가능**

Runtime semantics를 거의 건드리지 않고 체감 UX를 높일 수 있다.

---

# 4. Candidate B — Git Worktree

## 4.1 조사 대상

### A. `@narumitw/pi-worktree`

- GitHub: <https://github.com/narumiruna/pi-extensions/tree/main/extensions/pi-worktree>
- Package: <https://pi.dev/packages/@narumitw/pi-worktree>
- License: MIT

주요 특징:

- `/worktree`를 통한 create/switch/remove/prune
- 현재/linked/detached/locked/prunable 상태 표시
- 위험한 worktree 제거 전 tracked/untracked/index/submodule/detached commit 검사
- symbolic-link ancestor 및 occupied target 방어
- shell interpolation 없이 argv 기반 Git 실행
- Pi Session을 새 worktree cwd로 전환

패키지 구조도 참고 가치가 있다.

```text
src/
 ├─ index.ts
 ├─ command.ts
 ├─ git.ts
 ├─ session.ts
 ├─ settings.ts
 └─ worktree.ts
```

### B. `@season179/pi-worktree`

- Package: <https://pi.dev/packages/@season179/pi-worktree>
- License: MIT

주요 특징:

- Claude Code 스타일 `pi --worktree` / `pi --wt`
- 임시 branch + worktree 생성
- Pi의 read/write/edit/bash 경로를 worktree로 redirect
- exit 시 dirty 상태를 확인하고 keep/delete 선택
- 명확하게 "workflow framework가 아닌 worktree safety layer"를 표방

## 4.2 Weavra와 특히 잘 맞는 이유

Weavra V0.1은 다음 철학을 가진다.

```text
dirty workspace → 실행 거부
automatic stash → 하지 않음
automatic reset → 하지 않음
automatic rollback → 하지 않음
```

따라서 가장 자연스러운 다음 단계는 **원본 checkout을 깨끗하게 보존한 별도 worktree에서 작업시키는 것**이다.

```text
Original checkout
      │
      ├─ 사용자 작업 유지
      │
      └─ Weavra worktree
              │
              ▼
           Workflow
              │
        ┌─────┴─────┐
        ▼           ▼
      keep        discard
```

## 4.3 Weavra에서 가져올 것

`narumitw`에서:

- safe add/remove/prune 검사
- argv 기반 Git 호출
- occupied/unsafe path 방어
- dirty/untracked/submodule/detached commit 손실 방지
- session/workspace switching 설계

`season179`에서:

- `--worktree` launcher UX
- "현재 checkout과 작업 공간을 격리한다"는 단순한 제품 경험
- exit 시 keep/delete 흐름

## 4.4 권장 Weavra UX

```bash
weavra
weavra --worktree
weavra --worktree auth-fix
```

동작 예:

```text
weavra --worktree auth-fix
  ↓
main HEAD에서 worktree 생성
  ↓
새 worktree를 cwd로 Pi/Weavra 실행
  ↓
기존 QUICK/STANDARD/Risk semantics 그대로 실행
  ↓
종료 시 keep/remove 선택
```

## 4.5 구현 위치

**Launcher/Host 계층**에서 처리한다.

```text
Weavra Launcher
  ├─ normal cwd
  └─ WorktreeManager
          ↓
      resolved cwd
          ↓
      Pi + Weavra
```

Kernel이 worktree를 직접 생성/삭제하면 안 된다.

Kernel에게는 그냥 하나의 canonical workspace path로 보여야 한다.

## 4.6 추가해야 할 Port 후보

필요하다면 Host 쪽에만 다음 정도를 둔다.

```ts
interface WorkspaceProvider {
  prepare(input: WorkspaceRequest): Promise<PreparedWorkspace>;
  cleanup(result: WorkspaceResult): Promise<void>;
}
```

이건 Company Kernel의 `Workspace/Git evidence`와 다른 책임이다.

## 4.7 반드시 유지할 조건

- worktree를 쓴다고 dirty/evidence 검사 생략 금지
- stale review/digest guard 유지
- 자동 merge 금지
- 자동 commit 금지
- worktree 삭제 전 dirty/untracked 재검사
- original checkout 외부 쓰기 금지

## 4.8 우선순위

**VERY HIGH**

Footer 다음으로 실제 사용성·안전성을 가장 크게 올릴 수 있다.

---

# 5. Candidate C — pi-lens

## 5.1 조사 대상

- GitHub: <https://github.com/apmantza/pi-lens>
- License: MIT
- 설치 예: `pi install npm:pi-lens`

주요 기능:

- LSP diagnostics / navigation
- 변경 파일 영향 진단
- language-specific linter/typechecker/scanner
- formatter/autofix
- ast-grep / tree-sitter 구조 분석
- symbol search / module intelligence
- diagnostics state

특히 Agent Guide의 결과 정직성 규칙이 Weavra와 잘 맞는다.

pi-lens는 다음과 같은 상태가 있으면 이를 "clean"으로 과장하지 말라고 요구한다.

```text
partial
capped
stale
unconfirmed
cold
degraded
unavailable
```

Weavra의 기존 검증 철학:

```text
PASS
FAIL
SKIPPED
UNAVAILABLE
```

과 방향이 매우 유사하다.

## 5.2 왜 그대로 설치하면 안 되는가

Weavra Worker는 의도적으로 리소스를 고정한다.

```text
Extensions: []
Skills: []
Prompts: []
```

즉 `pi-lens`를 Developer/Reviewer AgentSession에 자동 로드하면:

- Worker resource isolation을 깨뜨릴 수 있고
- hidden autofix/mutation이 생길 수 있으며
- Reviewer PASS 이후 formatter가 diff를 바꿀 경우 stale-evidence semantics와 충돌한다.

따라서 **Worker plugin으로 로드하지 않는다.**

## 5.3 가져올 핵심 아이디어

`RegisteredVerifier`를 확장 가능한 Verification Provider 구조로 만든다.

```text
Verifier
 ├─ CommandVerifier        (현재)
 ├─ LspDiagnosticVerifier
 ├─ LintVerifier
 ├─ TypecheckVerifier
 └─ StructuralVerifier
```

초기에는 새로운 범용 plugin framework가 아니라 작은 adapter로 시작한다.

예:

```ts
interface VerificationBackend {
  run(request: VerificationBackendRequest): Promise<VerificationBackendResult>;
}
```

## 5.4 V1 적용 범위

가장 먼저 **report-only**로 제한한다.

```text
LSP diagnostics
lint
static typecheck
structural scan
```

금지:

```text
autofix
formatter mutation
AST replace
automatic dependency installation
```

## 5.5 Evidence 변환

Lens-style 결과를 Weavra evidence에 매핑한다.

예:

```text
complete + no blocker       → PASS
blocker/error               → FAIL
runner unavailable          → UNAVAILABLE
optional check skipped      → SKIPPED
partial/stale/degraded      → PASS로 승격 금지
```

현재 계약을 확장해야 한다면 V0.2 설계 단계에서 별도 ADR로 다룬다.

`partial/stale/degraded`를 억지로 기존 PASS에 넣지 않는다.

## 5.6 Reviewer 연결

Reviewer에게 전달되는 reviewContext에 다음을 Evidence로 추가할 수 있다.

```text
diff
registered command checks
LSP diagnostics
lint/typecheck diagnostics
structural findings
```

Reviewer는 실제 ref만 사용해야 하며 RC-04에서 강화한 trusted evidence ref 의미를 그대로 유지한다.

## 5.7 우선순위

**HIGH, 하지만 worktree 이후**

실제 개발 품질에는 효과가 크지만 Verification semantics를 건드리므로 상태 표시/worktree보다 뒤가 안전하다.

---

# 6. Candidate D — Pi Official Sandbox / Gondolin

## 6.1 조사 대상

### Pi 공식 sandbox example

- <https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions/sandbox>

공식 예제는 `@anthropic-ai/sandbox-runtime`으로 bash를 OS level에서 제한한다.

- macOS: `sandbox-exec`
- Linux: `bubblewrap`
- filesystem allow/deny
- network domain allow/deny
- 프로젝트/글로벌 sandbox config 병합

Pi 공식 보안 문서는 기본 Pi가 built-in sandbox를 제공하지 않으며, extension과 tool은 Pi 프로세스 권한으로 동작한다고 명시한다.

- <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/security.md>

### Gondolin

- <https://github.com/earendil-works/gondolin>
- License: Apache-2.0

특징:

- Linux micro-VM
- programmable filesystem/network control
- host-side secret/network policy
- Pi extension에서 project를 `/workspace`로 mount하고 tool 실행을 VM으로 route 가능

## 6.2 Weavra에 필요한 이유

Weavra Policy는 강하지만 **OS security boundary는 아니다.**

현재 경계:

```text
LLM
 ↓
Weavra Tool Policy
 ↓
Node process / filesystem
```

장기 목표:

```text
LLM
 ↓
Weavra Tool Policy
 ↓
OS Sandbox
 ↓
filesystem/process/network
```

정책과 sandbox는 서로 대체 관계가 아니다.

## 6.3 가장 먼저 sandbox할 대상

Weavra Worker file tool보다 **RegisteredVerifier / future ProcessPort**가 먼저다.

이유:

- verifier는 외부 executable을 실제 실행한다.
- project-local test/build script는 코드 실행 권한을 가진다.
- current Worker file mutations는 Weavra가 직접 구현한 bounded file API라 범위가 더 작다.

따라서 1단계:

```text
RegisteredVerifier
      ↓
SandboxedProcessRunner
      ↓
trusted executable
```

2단계:

```text
Future ProcessPort
      ↓
Sandbox
```

3단계에서만 Worker process 전체 격리를 검토한다.

## 6.4 macOS 1차 방향

현재 실제 RC가 macOS 중심이므로 official sandbox-runtime 패턴을 우선 조사한다.

목표:

```text
filesystem:
  read: workspace + toolchain
  write: workspace 또는 temp 제한
  deny: ~/.ssh ~/.aws ~/.config 등
network:
  기본 deny 또는 project explicit allow
```

하지만 실제 compiler/package manager는 system paths/cache를 요구할 수 있으므로 바로 강제하기보다 **audit/report mode → enforce** 순서를 검토한다.

## 6.5 Gondolin 적용 시점

Gondolin은 강력하지만 현재 V0.1 personal macOS workflow에는 과할 수 있다.

다음 조건에서 재검토한다.

- arbitrary process/tool 지원 확대
- Researcher/Browser/Package install 지원
- untrusted project code 실행 비중 증가
- T3Code/remote execution 연결

## 6.6 우선순위

**MEDIUM-HIGH / Security V0.2**

즉시 사용자 기능이라기보다 권한 확장 전에 반드시 고려할 기반이다.

---

# 7. 무엇을 직접 설치하고, 무엇을 흡수할 것인가

| 후보 | 직접 설치 | 소스/설계 흡수 | Weavra 기본 의존성 |
|---|---:|---:|---:|
| pi-footer | Optional | Yes | No |
| narumitw pi-worktree | 개발 참고/실험 가능 | **Yes** | 가능하면 No |
| season179 pi-worktree | 참고 | **Launcher UX 참고** | No |
| pi-lens | 개발 실험 가능 | **Verification 설계 참고** | 초기에는 No |
| official sandbox | 예제 기반 | **Yes** | Optional dependency 검토 |
| Gondolin | 별도 실험 | Later | No |

Weavra는 가능한 한 외부 extension 설치 조합에 따라 핵심 안전성이 달라지지 않도록 한다.

---

# 8. 적용 Roadmap

## Phase A — Status Projection

목표:

```text
Weavra RuntimeEvent / Run State
        ↓
Status Projection
        ↓
ctx.ui.setStatus
```

작업:

- `weavra-workflow`
- `weavra-risk`
- `weavra-phase`
- `weavra-run`
- optional combined `weavra`

완료 조건:

- pi-footer 없이도 정상 동작
- footer를 설치하면 별도 코드 수정 없이 표시 가능
- 상태 조회가 Runtime truth를 변경하지 않음

## Phase B — `weavra --worktree`

목표:

```bash
weavra --worktree
```

작업:

- canonical repo 확인
- safe branch/worktree 생성
- Weavra launcher cwd 전환
- exit keep/remove
- dirty/untracked/submodule 보호
- argv 기반 Git

완료 조건:

- 기존 checkout 무변경
- worktree에서도 RC-02/03 핵심 flow 통과
- remove 전 재검증

## Phase C — Verification+ / Lens-inspired backend

목표:

```text
Command Check + LSP/Lint/Typecheck Evidence
```

작업:

- VerificationBackend contract
- diagnostics evidence refs
- report-only
- degraded/partial 결과를 PASS로 과장하지 않음

완료 조건:

- autofix 없음
- stale digest guard 유지
- Reviewer trusted refs 유지

## Phase D — Sandboxed Verification

목표:

```text
RegisteredVerifier
  ↓
Sandboxed Process Runner
```

작업:

- official Pi sandbox example 분석
- macOS prototype
- filesystem/network policy
- timeout/cancel/process group semantics 유지

완료 조건:

- 기존 verifier 결과 계약 유지
- cancel 후 process cleanup
- sandbox failure를 PASS/SKIPPED로 오인하지 않음

---

# 9. 지금 가져오지 않을 Pi 확장 범주

다음 계열은 Weavra 핵심 책임과 충돌하므로 직접 결합하지 않는다.

```text
subagents
workflow engines
goal loops
kanban orchestrators
permission systems
model fallback engines
```

이유:

- Agent 조직/Workflow → Weavra Kernel 책임
- Risk/Permission/Approval → Weavra Policy 책임
- Review/Verification → Weavra completion semantics 책임
- Model routing → 향후 Weavra capability routing 책임

이런 프로젝트는 아이디어/테스트 케이스만 참고한다.

---

# 10. 추천 최종 순서

현재 `weavra-v0.1-rc1` 이후 추천 순서:

```text
Branding + Launcher
      ↓
Status Projection (pi-footer compatible)
      ↓
weavra --worktree
      ↓
며칠 실제 사용
      ↓
V0.2 DAG Projection / TUI Viewer
      ↓
Lens-inspired Verification Backend
      ↓
Sandboxed Process Runner
      ↓
Planner / Lead / COMPLEX / Parallel DAG
      ↓
T3Code Control Surface
```

`DAG Scheduler`보다 `DAG Projection`이 먼저이며, sandbox보다 먼저 arbitrary tool 권한을 넓히지 않는다.

---

# 11. Source References

- pi-footer: <https://github.com/smoosex/pi-footer>
- @narumitw/pi-worktree: <https://github.com/narumiruna/pi-extensions/tree/main/extensions/pi-worktree>
- @season179/pi-worktree: <https://pi.dev/packages/@season179/pi-worktree>
- pi-lens: <https://github.com/apmantza/pi-lens>
- pi-lens Agent Guide: <https://github.com/apmantza/pi-lens/blob/master/docs/agent-guide.md>
- Pi official extension examples: <https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions>
- Pi official sandbox example: <https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions/sandbox>
- Pi security docs: <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/security.md>
- Gondolin: <https://github.com/earendil-works/gondolin>

---

## 한 문장 결정

> **Weavra는 외부 Pi extension을 Worker 안에 쌓는 제품이 아니라, 검증된 아이디어를 Host/Workspace/Verification/Sandbox 경계에 선택적으로 흡수하면서 Kernel의 권한과 evidence semantics를 유지하는 Runtime으로 발전한다.**
