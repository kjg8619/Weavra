# Weavra V0.3F — Measurement & Evidence Smoke

- 작성일: 2026-09-18 (KST), 실행 11:40–11:42 KST.
- 소스: devlop `6c81b21de9548306bd37982b32bcb55c7ec3598c` + 미커밋 V0.3F working tree.
- 환경: macOS/arm64, Node 26.7.0. Weavra worker: `commandcode / deepseek/deepseek-v4.1-flash`; 교차: `codex-lb / gpt-6-astra`.
- fixture: V0.3E 2 AC greeting fixture(`Fix the greeting typo.` / `Preserve the existing exported greet(name) API and punctuation.`), STANDARD/EDIT, required regression check, `budget.max_worker_invocations=4`.

## 결과

| run | 판정 | measurement | budget | 비고 |
|---|---|---|---|---|
| DeepSeek 1차 | FAILED(provider transport, 모델 상호작용 중) | Developer 16,409 tokens, 10.9s, 6 turns, 6 tools(usage source=provider) | 1/4 | partial change(2줄) 보존·rollback 없음, failure category PROVIDER, AC 결과 UNKNOWN |
| DeepSeek 2차(재시도) | **COMPLETED** | Developer 13,466 / Reviewer 7,357 tokens; 8.4s + 5.7s; 5+2 turns; 6+3 tools | 2/4, 20,823 reported tokens | AC-001/AC-002 MET, Reviewer PASS(독립), checks PASS×2, cleanup confirmed |
| GPT 교차 | **COMPLETED** | 2 workers, 11,824 reported tokens, 6 tools | 2/4 | 동일 Evidence Pack shape, instrumentation 회귀 없음 |

- Evidence Pack(2차)에 담긴 provenance: runtime commit `6c81b21de`, CLI bundle sha256 `08e7f984…`(mtime 2026-09-16, version 0.85.1), target HEAD `048ef3bb…`, config digest, contract digest `sha256:985e45b7…`, capturedAt.
- UNKNOWN 처리 확인: `providerThinkingLevel`은 provider가 echo하지 않아 `thinking UNKNOWN`, cost는 `Estimated cost: UNKNOWN`(0 표시 없음), CLI build commit은 관측 불가라 표시하지 않았다(mtime을 commit으로 부르지 않음).
- 1차 실패 run은 §12/§18 semantics(측정 실패·provider 실패가 기존 결과나 partial changes를 왜곡하지 않음)를 그대로 보여준다.

## NOT VERIFIED

- Plain Pi vs Weavra 실제 비교 실행(adapter는 deterministic test로만 검증), 20개 corpus 확장, repetition 반복, telemetry 외부 exporter, 실제 가격/비용.
- R2/R3 run의 measurement·evidence pack은 이번에 실행하지 않았다(자동 fixture로만 검증).

## Measurement Hardening (LOG-061, 2026-09-18)

V0.3F 게시 후 확인된 plumbing gap을 자동 회귀로 닫았다(Provider 재실행 없음).

| 항목 | before | after |
|---|---|---|
| 실패한 worker invocation | reserve만 되고 durable Run에는 아무 기록이 없었다 | 실패 run에 invocation count·실패 measurement(outcome FAILED·provider tokens)·원래 실패 사유가 함께 남는다 |
| measurement 없는 실패 | 0 token으로 위조될 여지 | `reportedTokens: null`(UNKNOWN) + configured token budget이면 다음 invocation fail closed |
| 성공 후 검증 실패 | measurement가 이미 소비됐지만 persist되지 않았다 | 실패 terminal state와 함께 보존된다 |
| Reviewer REVISE/BLOCK | 성공 persist에만 measurement가 실렸다 | REVISE persist·BLOCK `finish()` 모두 정확히 한 번 포함한다 |
| telemetry 실패 | exporter/span 오류가 결과를 바꾸거나 callback을 재실행할 수 있었다 | work callback은 최대 1회, 성공 결과·원래 오류가 유지된다 |
| `weavra.worker` start span | provider/model이 없었다 | requested provider/model(start) + actual provider/model(end) |

- **정정:** LOG-059가 실패 run에서 관찰한 16,409 tokens는 worker/session-level observation이다. hardening 이전에는 실패 invocation measurement의 durable Run persistence에 gap이 있었다. 성공 run의 판정·Evidence Pack 결과는 유지된다.
- 결정론적 검증: Runtime 36개 파일·1,154개 + coding-agent Weavra suite 11개 파일·449개 + evals unit 6개 파일·33개 = 53개 파일·1,636개 PASS. faux E2E(standard-2ac)는 Provider network 0회로 실제 adapter 경로를 통과한다.
- 이번 hardening은 Provider quota를 사용하지 않았다(DeepSeek·GPT smoke 재실행 NOT RUN).

## Final Micro Hardening (LOG-062, 2026-09-18)

V0.3F에 남은 edge case 2건만 닫고 이 단계를 종료한다(Provider 재실행 없음, dependency·lockfile 변경 없음).

| 항목 | before | after |
|---|---|---|
| result 반환 직후 cancellation | `execute()` → `throwIfAborted()` → `settleBudget()` 순서라 이미 소비된 measurement가 settle에 도달하지 못할 수 있었다 | implement/review 모두 `settleBudget()` → `throwIfAborted()`. measurement는 durable, Run은 기존처럼 CANCELLED이며 handoff/review는 완료 authority가 아니다 |
| telemetry adapter 반환값 | settled 이후 adapter가 반환한 값이 실행 결과가 될 수 있었다 | authoritative 결과는 항상 work callback의 outcome. adapter 반환값·`undefined`·오류 삼키기 어느 것도 Runtime 결과를 바꾸지 못하고 work는 항상 최대 1회 실행된다 |

- 결정론적 검증: Runtime 36개 파일·1,158개 + coding-agent Weavra suite 11개 파일·449개 + evals unit 6개 파일·33개 = 53개 파일·1,640개 PASS. 신규 4건은 pre-fix 상태에서 실제로 실패함을 확인한 뒤 복원해 통과를 확인했다.
- 다음 단계는 V0.4A — Strict Mutation Hardening이다.
