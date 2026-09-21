# Weavra — CommandCode Provider / DeepSeek V4.1 Flash Worker Smoke

- 작성일: 2026-09-18 (KST)
- 대상: devlop HEAD `332e90b8f62d8f18d67ff2993b9a8bb6c5b196da`. smoke 시점 working tree에는 미커밋 `docs/WORK_LOG.md`(LOG-052)만 있었다.
- 목적: 개발 하네스를 Pi + `codex-lb/gpt-6-astra`에서 OMP + DeepSeek로 전환하는 시점에, 같은 모델을 Weavra worker profile로 쓸 수 있는지 **user-level 설정만으로** 구성하고 실제로 검증한다.
- 성격: 실제 Provider smoke evidence다. **제품 source/config/test/dependency 변경은 없다.** 이 문서는 `.ai` 실행 로그나 Work Log가 아니다.

## 현재 판정

| 항목 | 판정 |
|---|---|
| CommandCode custom provider 등록(user-level `~/.weavra/agent/models.json`) | 완료, 기존 `codex-lb`/`omlx` entry 불변 |
| 모델 resolve (`commandcode / deepseek/deepseek-v4.1-flash`) | PASS |
| auth (`${CMD_API_KEY}` template) | PASS |
| streaming + schema-valid tool call | PASS (스키마 위반·Provider 오류 0) |
| structured submit (`submit_handoff`/`submit_review`) | 형식 PASS / identity 필드 오류 다수 |
| STANDARD/EDIT end-to-end | **1/5 COMPLETED**, 실패 4회는 fail-closed Policy/검증 종료 |
| QUICK/R0 end-to-end | **0/3 미완료** (FAILED 2, BLOCKED 1) |
| 독립 Reviewer | 1회 PASS 검증(정확한 trusted refs), 1회 보호 파일 read DENY |
| `runtime_list_files` path omission (V0.3D 미충족 항목) | **확인됨** — list 호출 8회 중 7회가 `{}`, COMPLETED run에서도 확인 |
| DeepSeek 공식 API(`api.deepseek.com`) | 미구성·NOT VERIFIED (사용자 결정으로 CommandCode 경유) |
| V0.3D LSP/JVM·다른 OS/Node·TUI 경로 | NOT VERIFIED |

## 구성

```text
Development harness:        OMP
Development model/provider: DeepSeek V4.1 Flash via CommandCode Provider API
Weavra validation:          동일 (CommandCode Provider API)
Cross validation:           codex-lb / GPT-6 Astra (1회)
```

- Credential은 `CMD_API_KEY`이며 원문은 이 문서·repo·WORK_LOG·`.ai`에 기록하지 않는다. 값은 사용자 승인 아래 OMP credential store에서 `~/.weavra/cmd.env`(mode 600)로 옮겨 smoke 실행 시에만 source했다.
- `models.json`에는 secret이 아닌 참조만 기록했다.

```json
"commandcode": {
  "name": "CommandCode",
  "baseUrl": "https://api.commandcode.ai/provider/v1",
  "api": "openai-completions",
  "apiKey": "${CMD_API_KEY}",
  "authHeader": true,
  "models": [
    {
      "id": "deepseek/deepseek-v4.1-flash",
      "name": "DeepSeek V4.1 Flash (CommandCode)",
      "reasoning": true,
      "input": ["text"],
      "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
      "contextWindow": 1000000,
      "maxTokens": 384000
    }
  ]
}
```

- Pi 내장 `deepseek` provider와 `deepseek-flash` catalog는 이미 존재하지만 base URL이 `https://api.deepseek.com`이고 auth가 `DEEPSEEK_API_KEY`이므로 이번에는 사용하지 않았다. CommandCode 경유를 위해 **custom provider만 추가**했다.
- 수정 전 `models.json`은 임시 경로에 mode 600으로 백업했고, 추가 후 `codex-lb`/`omlx` subtree가 byte 단위로 동일함을 비교 확인했다.
- `cost`는 gateway 요금 정보를 알 수 없어 0으로 선언했다(청구서로 확인하지 않음).

## 방법

- private temporary Git fixture 두 개, faux 응답 없음, 실제 Runtime TypeScript + 기존 fork-local built SDK 사용.
  - READ_ONLY fixture: `runtime.workflow: QUICK`, `allowed_paths: [src]`, 읽기 전용 Node check, project instruction 없음.
  - EDIT fixture: `runtime.workflow: STANDARD`, `allowed_paths: [src]`, `project.instructions.path: AGENTS.md`(444 bytes), required check `node --test test/greeting.test.mjs`, allowed 밖 synthetic marker.
- goal은 고정했고 tool 인자나 path 생략을 유도하지 않았다.
  - QUICK: `Explain what the greet function in src/greeting.js returns.`
  - EDIT: `Fix the greeting typo in the allowed source file, following the selected project rules.` (V0.3D와 동일)
- 각 run은 fixture clone 위에서 1회씩 실행했고, 관찰은 (1) RuntimeEvent, (2) durable `.ai/state.json`의 run/action audit, (3) worker session JSONL의 tool call·usage로만 했다.

## 실행 결과

| run | workflow/risk/mode | 판정 | 종료 원인 | changed | duration | total tokens |
|---|---|---|---|---|---:|---:|
| A | QUICK/R0/READ_ONLY | FAILED | `submit_handoff` identity mismatch (`task`=goal) | `[]` | 9,210ms | 6,243 |
| A2 | QUICK/R0/READ_ONLY | BLOCKED | Kernel: `unresolved` 비어 있지 않음(identity는 정상) | `[]` | 10,619ms | 6,496 |
| A3 | QUICK/R0/READ_ONLY | FAILED | identity mismatch | `[]` | 8,990ms | 6,329 |
| B1 | STANDARD/R1/EDIT | FAILED | Reviewer가 `AGENTS.md` read → Policy R0/DENY | `["src/greeting.js"]` | 12,467ms | 17,019 |
| B2 | STANDARD/R1/EDIT | **COMPLETED** | — | `["src/greeting.js"]` | 15,728ms | 21,138 |
| B3 | STANDARD/R1/EDIT | FAILED | Developer가 `AGENTS.md` read → Policy R0/DENY | `[]` | 4,587ms | 4,624 |
| B4 | STANDARD/R1/EDIT | FAILED | identity mismatch | `["src/greeting.js"]` | 9,710ms | 13,616 |
| B5 | STANDARD/R1/EDIT | FAILED | stale anchor 복구 후 identity mismatch | `["src/greeting.js"]` | 13,466ms | 17,911 |
| cross | STANDARD/R1/EDIT (codex-lb/GPT-6 Astra) | **COMPLETED** | — | `["src/greeting.js"]` | 35,236ms | 9,751 |

- 모든 run에서 worker session이 `commandcode / deepseek/deepseek-v4.1-flash`, thinking level `medium`이었고 fallback은 없었다. Provider가 돌려준 reasoning token도 기록됐다(thinking part 2~3개/session).
- tool call 순서는 일관됐다. DeepSeek Developer: `runtime_list_files` → `runtime_read(anchors:true)` → `runtime_edit(anchored)` → `runtime_read` → `submit_handoff`. Reviewer: `runtime_list_files` → `runtime_read` → `submit_review`.
- B2 COMPLETED 상세: anchored edit 1회로 `Helo`→`Hello`만 수정, SELF_CHECK PASS/exit 0, 독립 Reviewer PASS(trusted refs 2개를 정확히 복사, requirements MET + evidenceRefs), TEST PASS/exit 0, `changedFiles=["src/greeting.js"]`·2줄, AGENTS.md/테스트/allowed 밖 marker 불변, writer.lock 없음, session cleanup 확인.
- DeepSeek B2와 GPT cross run의 최종 `src/greeting.js`는 **byte-identical**했다.

## 관찰과 분류

### 확인된 것

- Provider 계층: model resolve, auth, streaming, tool call schema 검증, structured submit, session cleanup이 실제 호출에서 동작했다. malformed tool call, Provider error/retry, fallback은 0건이었다.
- V0.3D에서 미충족이던 **path omission**: list 호출 8회 중 7회가 `{}`(path 생략)였고 B2의 COMPLETED run에서 Developer가 `{}`를 사용했다. 결과도 `{"files":["src/greeting.js"],"truncated":false}`로 filtering이 유지됐다. 이는 별도 provider/run의 관찰이며 GPT Attempt 2의 판정을 소급 변경하지 않는다.
- B5의 `STALE_ANCHOR`는 consumable 오류로 처리되어 같은 session에서 복구됐다(모델은 이후 exact-match edit로 수정).

### model-specific behavior (DeepSeek 쪽, 4개 관찰)

1. `submit_handoff.task`에 task ID 대신 **goal 문자열**을 넣었다 (A, A3, B4, B5 — 4회). Runtime은 이를 identity mismatch로 종료한다.
2. QUICK Executor의 `unresolved`에 "확인하지 못한 한계"를 기술했다 (3/3회). Kernel은 `unresolved.length === 0`을 완료 조건으로 요구하므로 A2는 BLOCKED가 됐다.
3. **보호된 지시 파일(AGENTS.md)을 직접 read**하려 했다 (B1 Reviewer, B3 Developer). 그 내용은 이미 worker prompt의 project context block에 원문으로 들어 있다.
4. anchored edit 오류 뒤 exact-match edit로 전환했다 (B5, 정책상 허용).

### product-side 특성 (이번 작업에서 변경하지 않음)

1. handoff identity mismatch는 consumable이 아니라 **fatal**이다. 같은 성격의 `unresolved` 검증 오류는 consumable로 재시도를 허용하므로 두 경로의 처리가 비대칭이다.
2. QUICK Executor prompt에는 `unresolved` 의미 안내가 없다(Developer에만 존재).
3. 보호 경로 read DENY도 fatal이며, prompt에 "지시 파일은 context로 이미 제공되며 read할 수 없다"는 안내가 없다.
4. QUICK/R0의 BLOCKED, R0 mutation DENY, fail-closed 종료 자체는 의도된 동작이며 이번 smoke에서도 workspace 무변경으로 확인됐다.

## 판정 세분화

```text
CommandCode Provider AVAILABLE              VERIFIED (resolve/auth/streaming/tool call/cleanup)
DeepSeek Tool Calling                       VERIFIED (schema-valid calls, anchored edit 포함)
DeepSeek QUICK workflow                     NOT VERIFIED (0/3 완주; 실패 원인은 handoff 내용)
DeepSeek STANDARD workflow                  PARTIAL (1/5 COMPLETED; 경로 자체는 검증됨)
DeepSeek Reviewer                           PARTIAL (1회 PASS 검증, 1회 보호 경로 DENY)
DeepSeek V0.3D features                     PARTIAL (FIX-03 snapshot 전달·digest 기록, list omission 확인;
                                            LSP/JVM risk는 미실행)
DeepSeek 공식 API(api.deepseek.com)          NOT VERIFIED (구성하지 않음)
```

한 run의 성공을 전체 DeepSeek compatibility나 전체 RC로 확대하지 않는다.

## Cross validation (codex-lb / GPT-6 Astra)

- 동일 fixture·goal·config semantics 1회: COMPLETED, 35,236ms, tool error 0, 총 9,751 tokens(Developer 7,110 + Reviewer 2,641).
- GPT는 `runtime_list_files({path:"src",maxDepth:4})`로 narrowing했고 anchored edit 1회, Reviewer는 추가 tool 없이 `submit_review` PASS를 제출했다.
- 비교는 winner 선정이 아니라 compatibility 확인이다. 모델별 결과는 위 표와 이 절에 별도로 기록한다.

## 한계 (NOT VERIFIED)

- 실제 GitHub Actions/Node22 Linux/fresh install/JVM build matrix, DeepSeek 공식 API, 다른 OS/Node, TUI/launcher 경로, LSP 서버, R2/R3, self-hosting은 이번에 실행하지 않았다.
- 비용: `models.json` cost가 0으로 선언되어 있고 실제 청구 비용은 확인하지 않았다(UNKNOWN).
- 표본이 작다. STANDARD 완주율 1/5, QUICK 0/3은 이번 조건에서의 관찰이며 안정적인 비율이 아니다.
- 등록 check와 Provider는 비-sandbox 신뢰 경계라는 기존 한계를 유지한다.

## 열린 결정 (사용자 승인 필요)

이번 작업은 여기서 멈춘다. 아래 항목은 실행하지 않았고, 결정 없이 자동으로 진행하지 않는다.

1. **handoff identity mismatch 처리** — 현재는 consumable이 아니라 fatal이라 모델이 같은 session에서 필드를 정정할 기회가 없다. `unresolved` 검증 오류는 consumable로 재시도되므로 두 경로의 처리가 비대칭이다. 제품 source(`agent-tools.ts`/`agent-runner.ts`) 변경이 필요하다.
2. **prompt 안내 보강** — (a) QUICK Executor에게 `unresolved` 의미(남은 구현/요구사항 문제만, 한계·미확인 사항 아님)를 Developer와 동일하게 안내, (b) 보호된 지시 파일은 prompt context로 이미 제공되며 worker가 read할 수 없다는 안내. 역시 제품 prompt 변경이다.
3. **`~/.weavra/cmd.env`(mode 600) 유지/삭제** — 유지해도 repo·문서에는 secret이 없고, 삭제해도 auth.json stored credential 또는 shell env로 대체할 수 있다.
4. **V0.3E Task Contract 착수 여부** — 이번 작업에서 시작하지 않았다. DeepSeek로 dogfooding하려면 1·2번을 먼저 처리하는 편이 실효적이라는 판단만 기록하며, 이는 승인 대상이다.

## 정리

- smoke용 fixture·harness·session JSONL 12개·`models.json` 백업을 정리했고 임시 루트의 부재를 확인했다. 제품 working tree에는 문서 변경만 남겼다. 개인 credential·설정 byte는 smoke 전후로 바뀌지 않았다(단, 이번 작업에서 `models.json`에 commandcode entry를 추가한 것은 의도된 enablement 변경이다).
- `~/.weavra/agent/models.json`의 commandcode entry는 유지한다. `~/.weavra/cmd.env`(mode 600)의 유지/삭제는 사용자 결정이며, 삭제해도 stored credential(auth.json) 또는 shell env로 대체할 수 있다.
- 문서 갱신 후 `npm run check:ci`(exit 0, Biome 1,388 files, warning/info/error 없음), `git diff --check`(exit 0), `bash -n packages/company-runtime/bin/weavra`(exit 0)를 확인했다. 로컬 검사이며 원격 CI 성공을 뜻하지 않는다.

---

# Provider Compatibility Hardening (2026-09-18)

이 절은 위의 LOG-053 evidence(수정하지 않음)에 대한 **후속 hardening 작업** 기록이다. 기준 devlop HEAD는 `03994a6803919befe17944fcf704d1c0573bfa08`다. 자세한 코드 범위·판정은 WORK_LOG LOG-055를 따른다.

## 대상 3건

1. `submit_handoff`/`submit_review`의 **model-correctable identity mismatch**를 consumable submission error로 분류해 같은 worker session에서 정정·재제출할 수 있게 했다. 거부는 그대로이며 host가 값을 대신 고치지 않는다.
2. QUICK Executor에게 `unresolved` 의미(미완료 requirement·구현 문제·concrete blocker만, caveat/Runtime-owned stage 제외)를 명시했다. Kernel 완료 guard는 변경하지 않았다.
3. configured project instruction file이 이미 prompt context로 제공되며 protected라서 read/search/list/LSP/mutation 대상이 아니라는 안내를 system prompt에 추가했다. Policy·권한은 변경하지 않았다.

identity mismatch 처리 결과: 첫 제출은 **거부되고 아무것도 accept/persist되지 않으며**, tool error로 모델에게 exact trusted identity(runId/revision/task, review는 diffDigest)가 안내된다. 같은 session에서 올바른 값으로 재제출하면 정상 검증이 진행된다. Policy DENY, provider error, malformed schema, Execution Contract/R2/R3 binding, approval, cleanup 실패는 기존처럼 fatal이다.

## Before / After (동일 fixture·goal·config semantics)

```text
Before (LOG-053, hardening 전)
  QUICK/R0        0/3 완료  (identity mismatch 2, unresolved BLOCKED 1)
  STANDARD/R1     1/5 완료  (protected AGENTS.md read DENY 2, identity mismatch 2)

After (hardening 후)
  QUICK/R0        1/3 완료  (1 provider error 2회: 모델 상호작용 전 gateway timeout)
  STANDARD/R1     2/3 완료  (1 provider error: 모델 상호작용 전 gateway timeout)
  GPT 교차        1/1 완료  (동일 fixture, codex-lb/gpt-6-astra)
```

표본이 작으므로 위 수치를 안정적인 성공률로 해석하지 않는다. Before/After의 run 수가 다른 것도 그대로 기록한다.

## After run 상세

| run | workflow | 판정 | 도구 호출 | 제출 | 비고 |
|---|---|---|---|---|---|
| q1 | QUICK/R0 | FAILED(provider) | 없음 | 없음 | `Request timed out.` 2.0s, workspace 무변경 |
| q2 | QUICK/R0 | FAILED(provider) | 없음 | 없음 | `Request timed out.` 1.3s, workspace 무변경 |
| q3 | QUICK/R0 | **COMPLETED** | list `{}`, read, handoff | 1회, task=id, unresolved `[]` | 8.4s, checks PASS 2, changed 0 |
| s1 | STANDARD/R1 | FAILED(provider) | 없음 | 없음 | `Request timed out.` 1.3s |
| s2 | STANDARD/R1 | **COMPLETED** | list `{}`, read×2, anchored edit, handoff / Reviewer: list+read+review | 2회(Developer/Reviewer) | 14.4s, review PASS, diff 2줄 |
| s3 | STANDARD/R1 | **COMPLETED** | list `{}`, read×2, anchored edit, handoff / Reviewer: list+read+search×2+review | 2회 | 18.3s, review PASS, diff 2줄 |
| gpt1 | STANDARD/R1 | **COMPLETED** | list `{path:"src",maxDepth:4}`, read, anchored edit, handoff / Reviewer: review | 2회 | 32.7s, review PASS |

- hardening 후 DeepSeek run에서 **identity mismatch 0건, protected AGENTS.md read 시도 0건, in-session correction 0건**이었다. 즉 모델이 처음부터 올바른 identity와 `unresolved: []`를 제출했고, protected 파일 안내도 지켰다.
- q3/s2/s3의 handoff `task`는 task ID였고 `unresolved`는 `[]`였다. list 호출은 `{}`(path 생략) 또는 `{maxDepth:...}`였다.
- 사용량: q3 7,112 / s2 21,564(Developer 13,966 + Reviewer 7,598) / s3 25,566(14,052 + 11,514) / gpt1 10,292(7,625 + 2,667) tokens. 실제 billing 비용은 UNKNOWN.
- 최종 `src/greeting.js`는 s2·s3·gpt1 모두 byte-identical(`d1633a9d…`)했다.
- 모든 run에서 writer.lock 잔존 없음, session cleanup 확인, 실패 run의 workspace 무변경을 확인했다.

## Provider/전송 계층 관찰 (이번 task 범위 밖)

- 위 3건(q1·q2·s1)은 모델 상호작용 전에 `Request timed out.`로 종료됐다. 같은 시각에 같은 endpoint에 대해 `curl`(4종 요청 형태)·plain Node `fetch`·Python 없음 모두 정상 200을 받았고, SDK 경로만 ~1.0–1.3s에 실패했다. 대기 후 재시도하면 성공했다.
- run 직전에 동일 provider로 warm-up 요청 1회를 보낸 뒤 실행한 s2·s3·gpt1은 모두 완료됐다(인과관계는 입증하지 않음).
- 이번 hardening은 이 전송 계층 문제를 다루지 않으며, 제품 코드·설정·`models.json`을 변경하지 않았다. provider 오류 run은 모델 행동 실패로 계산하지 않고 위 표에 별도로 기록한다.

## Hardening 후 한계

- 자동 회귀(Node26/macOS): Runtime 33개 파일·1,110개 + coding-agent 18개 파일·607개 PASS. identity correction·fatal 경계·prompt regression 10개를 새로 추가했다.
- DeepSeek 표본은 QUICK 1/3, STANDARD 2/3이며 provider 오류가 섞여 있어 모델 안정성 추정으로 쓰기 어렵다. `unresolved`를 실제로 채우는 genuine blocker 경로, R2/R3, LSP, 다른 OS/Node·원격 CI는 이번에 실행하지 않았다.
- `npm run check`/`check:ci`, `git diff --check`, `bash -n` 결과와 tracked bytes 불변은 WORK_LOG LOG-055에 기록한다.
