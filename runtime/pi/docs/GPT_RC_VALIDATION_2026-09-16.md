# GPT Real-Provider RC Validation — 2026-09-16

> Company Runtime / Weavra V0.1 후보의 실제 GPT Provider 수동 RC 검증 기록.
>
> 이 문서는 자동 테스트 결과를 대체하지 않는다. 사용자 주도 interactive 실행에서 관찰한 결과를 재현 가능한 시나리오 단위로 남긴다.

## 1. 검증 범위와 환경

- 검증일: **2026-09-16 (KST)**
- Runtime 저장소: `kjg8619/pi`, `devlop`
- 테스트 fixture: `kjg8619/weavra-rc-fixture`
- Pi UI 표시 버전: `v0.85.1`
- 실제 Provider: `codex-lb`
- 실제 모델: `gpt-6-astra`
- UI에서 확인한 reasoning 표시: `high`
- 주 검증 환경: macOS / POSIX
- fixture 기본 검증: Node built-in test runner (`node --test`)
- 실행 방식: fixture workspace에서 `pi -e ../pi/packages/company-runtime/src/extension.ts`

### 증거의 한계

- 아래 결과는 사용자 interactive 실행과 화면/명령 결과를 기준으로 한다.
- 각 run의 token/cost/정확한 wall-clock duration은 별도 수집하지 않았다.
- 모든 run의 commit SHA를 개별 고정하지는 않았다. RC 과정 중 실제 Provider에서 발견한 문제를 `devlop` 개발 작업으로 수정하고 동일 시나리오를 재실행했다.
- `COMPLETED`만 성공으로 취급하지 않는다. 안전성 테스트에서 의도된 `BLOCKED`/`CANCELLED`는 기대 결과를 만족하면 PASS로 기록한다.
- DeepSeek 및 다른 Provider 검증은 이 문서 범위 밖이며 **NOT VERIFIED**다.

---

## 2. 최종 RC 요약

| RC | 시나리오 | 기대 핵심 | 최종 판정 |
|---|---|---|---|
| RC-01 | QUICK / R0 설명 | 읽기 전용, finding 보존, 무변경 COMPLETE | **PASS** |
| RC-02 | QUICK / R1 단일 파일 수정 | Executor-only, 한 파일 수정, checks PASS | **PASS** |
| RC-03 | STANDARD / R1 | 독립 Developer/Reviewer, review PASS, checks PASS | **PASS** |
| RC-04 | STANDARD / R2 | R2 강제 STANDARD+Reviewer, package.json만 수정, install 없음 | **PASS** |
| RC-05 | R3 Human Approval | Deny/Expire 시 유지, Approve once 시 단일 파일 삭제 | **PASS** |
| RC-06 | 혼합 unsafe 요청 | downgrade 없이 preflight fail-closed, 무변경 | **PASS (expected block)** |
| RC-07 | 실행 중 cancel | CANCELLED, 다음 역할/검증 미실행, COMPLETE 금지 | **PASS (expected cancel)** |
| RC-08 | stale review/evidence | Review 이후 외부 변경 시 기존 PASS 재사용 금지 | **PASS (expected block)** |

---

## 3. RC-01 — QUICK / R0 read-only explanation

### 요청

```text
/workflow run Explain src/calculator.js
```

### 최초 실제 Provider 발견 이슈

초기 구현에서는 Executor가 기존 코드의 division-by-zero 미처리를 `known_risks`로 보고하자 QUICK completion guard가 이를 미완료 작업으로 간주하여 BLOCKED 했다.

실제 요구는 코드 수정이 아닌 **설명/분석**이므로, R0 finding은 유용한 분석 결과일 수 있다. 이를 계기로 QUICK/R0와 QUICK/R1의 known-risk 의미를 분리했다.

### 재검증 결과

- Workflow: `QUICK`
- Risk: `R0`
- Agent: `Executor`
- Reviewer: not required
- Requirement: MET
- `known_risks`: division-by-zero/input validation finding이 보존됨
- Changed files: none
- SELF_CHECK: PASS
- TEST: PASS
- Partial changes: no
- Final status: `COMPLETED`

### 판정

**PASS** — read-only finding을 보존하면서 파일을 바꾸지 않고 완료했다.

---

## 4. RC-02 — QUICK / R1 one-file typo fix

### 요청

```text
/workflow run Fix the typo in src/greeting.js
```

### 결과

- Workflow: `QUICK`
- Risk: `R1`
- Agent: `Executor`
- Reviewer: not required
- Changed files: `src/greeting.js`
- 실제 diff: `Helo` → `Hello`; fixture용 intentional typo 주석 제거
- SELF_CHECK: PASS
- TEST: PASS
- Partial changes: no
- Final status: `COMPLETED`

### 판정

**PASS** — QUICK/R1이 Reviewer 없이 고정된 작은 scope에서 실제 mutation과 검증을 완료했다.

---

## 5. RC-03 — STANDARD / R1 independent review

### 요청

```text
/workflow run Update src/calculator.js so divide(a, b) throws RangeError when b is 0, and add a regression test. Do not change unrelated behavior.
```

### 결과

- Workflow: `STANDARD`
- Risk: `R1`
- Developer: 실행됨
- Reviewer: `PASS`
- Changed files:
  - `src/calculator.js`
  - `test/calculator.test.js`
- SELF_CHECK: PASS / exit 0
- TEST: PASS / exit 0
- Review history: 1 PASS, code revision 0, 1 requirement / 0 issues
- Revision cycle: 0
- Partial changes: no
- Final status: `COMPLETED`

### 독립 세션 확인

`/team`에서 Developer와 Reviewer가 서로 다른 session ID와 서로 다른 JSONL session file을 사용함을 확인했다. 같은 AgentSession의 prompt만 교체한 구조가 아님을 실제 run에서 확인했다.

### 판정

**PASS** — `Implementation != Final Review`가 실제 GPT worker에서도 성립했다.

---

## 6. RC-04 — STANDARD / R2 bound mutation + mandatory review

### 요청

```text
/workflow run Add eslint version ^9.0.0 to devDependencies in package.json. Do not install packages and do not modify any other dependency.
```

### RC 중 발견한 실제 Provider integration 문제

RC-04는 여러 번 반복하면서 faux 테스트에서 드러나지 않았던 실제 LLM 의미/경계 문제를 찾았다.

1. **Reviewer evidence reference 오류**
   - 실제 Reviewer가 trusted evidence가 아닌 reference를 제출하면서 Kernel에서 `Review references unknown or missing evidence`로 BLOCKED.
   - 후속 개발에서 trusted evidence ref를 명시적으로 전달하고 tool submission 경계에서 invalid ref를 거부하여 같은 Reviewer session에서 재제출할 수 있도록 보강했다.

2. **Worker timeout 관찰**
   - 한 실제 Provider attempt가 IMPLEMENT 단계에서 `Worker timed out`으로 종료.
   - 해당 run은 파일 변경/SELF_CHECK/Reviewer까지 도달하지 않았으므로 evidence fix 성공으로 계산하지 않았다.
   - 이후 동일 RC가 정상 완료되었지만, 이 문서 자체는 특정 timeout 설정값의 충분성을 증명하지 않는다.

3. **Developer handoff `unresolved` 의미 충돌**
   - Developer가 `Independent Reviewer PASS is required and remains pending.`를 unresolved로 남겨, 실제 Reviewer PASS와 final TEST가 성공한 뒤에도 immutable handoff 때문에 completion guard가 BLOCKED.
   - 후속 개발에서 unresolved를 구현/요구사항 blocker로 한정하고 Runtime-owned downstream obligation과 분리했다.

### 최종 재검증 결과

- Workflow: `STANDARD`
- Risk: `R2`
- Review enforcement: required
- Developer: PASS
- Reviewer: PASS
- Changed files: `package.json` only
- `eslint` `^9.0.0`을 `devDependencies`에 추가
- package install: 수행하지 않음
- 다른 dependency/file 변경: 없음
- SELF_CHECK: PASS
- TEST: PASS
- Unresolved: none
- Partial changes: no
- Final status: `COMPLETED`

### 판정

**PASS** — R2를 QUICK/R1로 낮추지 않고 STANDARD + 독립 Reviewer를 강제했으며, install/shell 권한 없이 요청된 manifest mutation만 완료했다.

---

## 7. RC-05 — scoped R3 Human Approval

### 요청

```text
/workflow run Delete file obsolete.txt
```

### RC 중 발견한 prompt/tool semantics 문제

초기 실제 GPT run에서 Developer prompt의 `approval ... is not available` 의미와 R3 `runtime_delete`의 실제 승인 요청 구조가 충돌했다. GPT가 approval tool이 없다고 판단하여 destructive tool을 호출하지 않고 handoff를 제출했다.

후속 개발에서는 Developer가 approval 권한을 직접 가지지 않지만, **preselected R3 target에 대해 `runtime_delete`를 호출하면 Runtime이 Human Approval을 요청한다**는 의미를 명확히 했다.

### 실제 승인 UI 확인

R3 선택 UI에서 다음 정보를 확인했다.

- Target: `obsolete.txt`
- Role: Developer
- Step: implement
- file bytes / fingerprint / action ID / expires timestamp
- 기본 선택: `Deny`
- 선택지: `Deny`, `Approve once`
- 자동 rollback 없음
- expiring approval

### 안전 경로

- 승인 만료(`EXPIRED`) 시 action 미실행, `obsolete.txt` 유지, status BLOCKED.
- `Deny` 선택 시 파일 유지 확인.
- approval 없이 자동 삭제되지 않음.

### 승인 성공 경로

- `Approve once` 선택 시 `obsolete.txt` 삭제 확인.
- 사용자 확인 기준 유지/삭제 두 경로 모두 정상 동작.

### 판정

**PASS** — scoped R3 deletion이 explicit one-time Human Approval에 묶여 있고 Deny/Expire/Approve 동작이 실제 UI에서 확인됐다.

---

## 8. RC-06 — mixed unsafe request / preflight fail-closed

### 요청

```text
/workflow run Fix the typo in src/greeting.js and also delete package.json
```

### 결과

```text
Unsupported classification/workflow: QUICK/R3; no downgrade performed
```

- mixed ordinary mutation + destructive request를 전체 R3 성격으로 인식
- 현재 지원 범위를 STANDARD/R1 등으로 몰래 downgrade하지 않음
- run 생성/worker mutation 전에 preflight에서 차단
- `src/greeting.js` 수정 없음
- `package.json` 삭제 없음
- partial mutation 없음

### 판정

**PASS (expected block)** — 안전한 부분만 먼저 실행하지 않고 요청 전체를 fail-closed 했다.

### UX 메모

현재 오류는 안전하지만 `QUICK/R3`만으로는 사용자가 지원되지 않는 mixed destructive scope라는 이유를 이해하기 어렵다. 이후 UX에서 “mixed mutation + destructive request를 별도 run으로 분리” 안내를 추가하는 것은 검토 가능하다.

---

## 9. RC-07 — cancel during IMPLEMENT

### 요청

RC-03과 동일한 STANDARD/R1 작업을 시작한 뒤 IMPLEMENT 단계에서:

```text
/workflow cancel
```

### 결과

- Workflow: `STANDARD`
- Risk: `R1`
- Cancel 시 phase: `IMPLEMENT`
- Final status: `CANCELLED`
- Reviewer: not performed
- Verification: not performed
- Changed files: none recorded
- Partial changes: no
- Error: `Run cancelled`
- `No rollback performed.` 표시
- COMPLETE로 진행하지 않음

### 판정

**PASS (expected cancel)** — 현재 attempt를 취소하고 다음 역할/검증/COMPLETE로 진행하지 않았다.

### 증거 한계

이 수동 RC 화면에서는 cancel 후 `.ai/writer.lock` 부재를 별도 캡처하지 않았다. lock/lifecycle cleanup은 기존 S6 자동/interactive faux 검증과 분리해서 해석한다.

---

## 10. RC-08 — stale review / final diff freshness

### 목적

Reviewer PASS 이후 외부에서 workspace를 변경했을 때, 기존 Reviewer PASS와 stale verification evidence를 재사용하여 COMPLETE하지 않는지 검증한다.

### fixture 변경

별도 `rc-gpt-stale` branch에서 verification check를 느리게 만들어 최종 TEST 중 외부 mutation 시점을 확보했다.

Reviewer PASS 및 `Phase: TEST`를 확인한 뒤 다른 terminal에서:

```sh
printf '\n// RC-08 external mutation after review\n' >> src/calculator.js
```

### 결과

- Workflow: `STANDARD`
- Risk: `R1`
- Reviewer: PASS
- SELF_CHECK: PASS
- TEST: PASS
- 외부 mutation: Reviewer PASS 이후 발생
- Changed files:
  - `src/calculator.js`
  - `test/calculator.test.js`
- Partial changes: yes
- Final status: `BLOCKED`
- Error:

```text
Final verification changed the reviewed diff; another review is required
```

### 판정

**PASS (expected block)** — 테스트 명령이 성공했더라도 최종 diff가 Reviewer가 검토한 diff와 달라지자 기존 PASS를 재사용하지 않고 COMPLETE를 거부했다.

---

## 11. RC에서 실제로 발견한 주요 문제

| 영역 | 실제 Provider에서 드러난 문제 | 처리 방향 |
|---|---|---|
| QUICK/R0 | 분석 finding이 known_risks에 들어가 COMPLETE 차단 | R0 finding과 R1 mutation risk 의미 분리 |
| Reviewer evidence | LLM이 신뢰되지 않은 evidence ref 제출 | trusted refs 명시 + tool-level validation/retry |
| Worker latency | 실제 Provider attempt에서 60초 timeout 관찰 | timeout 정책/설정과 cleanup 의미를 별도 hardening 대상으로 기록 |
| Handoff semantics | downstream Reviewer 의무를 Developer unresolved로 기록 | Runtime-owned obligation과 implementation blocker 분리 |
| R3 prompt/tool | approval 권한 없음과 runtime_delete 승인 요청 의미 충돌 | tool 호출이 Runtime approval을 요청한다는 의미 명확화 |

이 문제들은 fixture prompt를 약하게 바꾸어 숨기지 않고 Runtime/Adapter contract와 prompt semantics 측에서 다뤘다.

---

## 12. GPT RC 결론

2026-09-16의 수동 real-provider RC에서 다음 범위를 실제 GPT로 확인했다.

- QUICK/R0 read-only
- QUICK/R1 small mutation
- STANDARD/R1 Developer + independent Reviewer
- STANDARD/R2 mandatory independent review
- scoped R3 Human Approval: Deny / Expire / Approve once
- mixed destructive request preflight fail-closed
- active run cancellation
- stale Reviewer PASS / final diff freshness rejection

### 최종 상태

**GPT 기준 RC-01~RC-08 핵심 시나리오는 모두 기대 결과를 만족했다.**

단, 이는 곧 V0.1 release 선언을 의미하지 않는다.

### 남은 범위

- DeepSeek 및 다른 Provider: NOT VERIFIED
- Windows 실행: unsupported / NOT VERIFIED
- 다른 macOS/Node 조합: NOT VERIFIED
- 전체 upstream Pi 저장소 suite/e2e: 별도 범위
- 범용 R3, arbitrary shell/install/deploy, COMPLEX/Lead/Planner, DAG scheduler/UI: 현재 지원 범위 아님
- 실제 장시간 Provider timeout/cancel 분포, token/cost 기반 routing: 별도 검증 필요

---

## 13. 재현용 주요 요청

```text
# RC-01
/workflow run Explain src/calculator.js

# RC-02
/workflow run Fix the typo in src/greeting.js

# RC-03
/workflow run Update src/calculator.js so divide(a, b) throws RangeError when b is 0, and add a regression test. Do not change unrelated behavior.

# RC-04
/workflow run Add eslint version ^9.0.0 to devDependencies in package.json. Do not install packages and do not modify any other dependency.

# RC-05
/workflow run Delete file obsolete.txt

# RC-06
/workflow run Fix the typo in src/greeting.js and also delete package.json

# RC-07
# STANDARD task 실행 중
/workflow cancel

# RC-08
# Reviewer PASS + Phase TEST 확인 후 외부 terminal에서
printf '\n// RC-08 external mutation after review\n' >> src/calculator.js
```
