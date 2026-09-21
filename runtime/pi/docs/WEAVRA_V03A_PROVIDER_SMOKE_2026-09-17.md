# Weavra V0.3A — Real-Provider Anchored Edit Smoke

- **실행일:** 2026-09-17 15:50–15:51 (KST)
- **판정:** 요청된 두 시나리오 PASS. 두 번째는 stale 거부 성공이며 workflow COMPLETED를 뜻하지 않는다.
- **Runtime 소스:** `473256de6310c7698eb888a9ae999b338bce0854` (`devlop`).
- **사용자 fixture 원본:** `weavra-rc-fixture`, branch `rc-gpt-stale`, HEAD `5914c8b85433066b2133e3e2fdf3ff359ae09be9`.
- **Provider / model:** fixture coding profile의 `codex-lb / gpt-6-astra`.
- **실제 worker thinking level:** `medium`. 이전 RC의 부모 TUI `high`와 혼동하지 않는다.
- **환경:** macOS/Darwin arm64, Node `v26.7.0`. 현재 Runtime TypeScript 소스와 기존 fork-local Pi SDK build를 직접 사용하는 headless 실행이다. faux Provider, TUI/launcher smoke, 새 build가 아니다.

## 실행 경계

원본 fixture가 clean임을 확인하고, private 임시 디렉터리 아래에 `git clone --local --no-hardlinks`로 두 개의 독립 복제본을 만들었다. 각 복제본에 synthetic target과 exact postcondition test만 추가하고 fixture baseline commit을 만들었다. 원본 branch/HEAD/index/추적 파일과 working tree는 변경하지 않았다.

Provider/auth는 기존 `~/.weavra/agent`의 models/auth를 사용했다. catalog network refresh는 끄고 worker session 및 model cache 경로는 임시 디렉터리로 분리했다. auth/models/settings bytes는 전후 동일했다. credential 값, 원격 endpoint, 전체 대화·reasoning·tool 로그를 이 문서에 저장하지 않는다.

실행은 기존 `StandardWorkflow → PiAgentExecutor → AgentSession`과 실제 `FileStateStore/Policy/GitWorkspace/RegisteredVerifier/Kernel`을 사용했다. 기존 180초·32-turn worker 예산, QUICK/R1 fixed target 및 tool set을 바꾸지 않았다. 추가 synthetic test는 Host protected path로 지정했다.

임시 harness는 SDK session 이벤트를 구독하여 도구 이름, anchored mode 여부, read에서 받은 token/digest와 edit 인자의 동일성, 오류와 파일 bytes를 관찰했다. 도구 구현·schema·Provider 응답·Runtime prompt는 교체하지 않았다. 첫 번째는 observation-only이며, 두 번째에만 아래 외부 변경과 결과 확인 후 cancellation을 주입했다. hash나 anchor를 harness가 모델 대신 만들어 주지 않았다.

## 공통 fixture / 요청

`src/duplicate.js`의 초기 내용:

```js
export function firstLabel() {
  return "teh";
}

export function secondLabel() {
  return "teh";
}
```

두 run에 동일한 goal을 전달했다. goal에 도구 이름이나 anchored mode 사용 지시를 추가하지 않았다. 기존 QUICK/R1 worker guidance에 따른 실제 모델 선택을 확인한다.

```text
Fix the typo in src/duplicate.js by changing only the second occurrence of "teh" to "the", in secondLabel. Preserve firstLabel and all other file bytes.
```

원본 fixture의 등록 check `node --test`를 그대로 사용하고 synthetic test 한 개를 더했다. 새 test는 최종 파일 전체가 두 번째 `teh`만 바뀐 기대 문자열과 byte-for-byte 일치하는지 확인한다. 기존 5개와 합쳐 검증 단계당 6개다.

## 1. Duplicate text → 두 번째 occurrence만 수정

**PASS — QUICK/R1, COMPLETED**

| 항목 | 실제 결과 |
|---|---|
| Run ID | `d67b12c2-4d61-44a2-8244-c6ddecbcf19a` |
| Executor session ID | `01a0ae21-88ee-7236-a903-380d4fe6cc80` |
| 임시 fixture baseline | `e45dfec0120bdc72c038b4b6a52a5523b5c10301` |
| 역할 | Executor 1개, Reviewer 없음 |
| Tool 순서 | anchored read → anchored edit → anchored read → submit_handoff |
| Edit | read 출력에서 복사한 6행 anchor + fileDigest, `oldText: "teh"`, `newText: "the"` |
| Mutation audit | R1 / ALLOW / SUCCEEDED |
| SELF_CHECK / TEST | 각각 PASS, exit 0, 6개 test PASS |
| Workflow 시간 | 25,015 ms |
| Provider usage | input 6,248 / output 406 / total 6,654 tokens |
| 종료 | COMPLETED, writer.lock 없음 |

파일 전체 비교와 실제 Git diff로 첫 번째 occurrence 및 다른 bytes가 그대로임을 확인했다. `runtime_write`는 사용하지 않았다. 성공 Provider tool-call 응답은 4개다.

```diff
 export function secondLabel() {
-  return "teh";
+  return "the";
 }
```

최종 파일 SHA-256:

```text
af2d02bfc7897d44b79bf3543d523f58617a0d8114ac2c9b429fe0f50d033215
```

## 2. Anchored read → 외부 변경 → old anchor → STALE_ANCHOR

**PASS — stale edit 거부, 외부 bytes 보존**

1. 모델이 `runtime_read({path:"src/duplicate.js", anchors:true})`를 호출했다.
2. 성공 read 결과가 생성된 직후, harness가 별도 **`/bin/cp` 프로세스**로 target을 교체했다. 두 `teh` 행은 그대로 두고 파일 끝에 `// EXTERNAL_CHANGE_AFTER_ANCHORED_READ` 한 행을 추가했다. 변경 사실이나 새 digest를 모델에게 주입하지 않았다.
3. 모델이 최초 read의 **6행 anchor와 이전 fileDigest를 그대로 복사**하여 `runtime_edit`를 호출했다. oldText/newText는 각각 `  return "teh";\n` / `  return "the";\n`이었다.
4. Policy는 R1/ALLOW였지만 현재 파일을 재읽은 tool이 **`STALE_ANCHOR: file generation mismatch`**를 반환했다. durable action은 FAILED였다.
5. 오류를 받은 직후 파일 전체가 외부 프로세스가 쓴 bytes와 동일함을 확인했다. 이후 재읽기/재시도가 실패 증거를 가리지 않도록 harness가 명시적으로 run을 취소했다. cancellation을 stale 검사의 대체 수단으로 사용하지 않았다.

| 항목 | 실제 결과 |
|---|---|
| Run ID | `1a8da870-847b-4a32-8d69-25db6e7c6602` |
| Executor session ID | `01a0ae21-eaef-7236-a903-380f43822c2b` |
| 임시 fixture baseline | `c49c9bb799ed7fe6f08e06630e34074abab14d44` |
| 역할 | Executor 1개, Reviewer 없음 |
| Tool 순서 | anchored read → anchored edit(error) |
| Mutation audit | R1 / ALLOW / FAILED; SUCCEEDED mutation 없음 |
| 관찰 오류 | `STALE_ANCHOR: file generation mismatch` |
| 보호 결과 | 두 `teh` 모두 유지, 외부 comment 포함 전체 bytes 동일 |
| SELF_CHECK / TEST | 미실행, PASS로 기록하지 않음 |
| Workflow 시간 | 11,121 ms |
| Provider usage | input 2,579 / output 162 / total 2,741 tokens |
| 종료 | harness cancellation에 의한 CANCELLED, writer.lock 없음 |

성공 Provider tool-call 응답은 2개다. session에는 취소 처리로 token 0의 aborted assistant message가 추가됐다. Runtime이 stale 자체로 CANCELLED를 결정하거나, 모델이 오류 이후 스스로 재읽기/복구했다는 주장은 하지 않는다.

Git diff에는 외부 comment 추가만 남았으며 모델의 `teh → the` 변경은 없었다. 거부 직후와 최종 cleanup 뒤 모두 외부 bytes가 보존됐다.

최종 파일 SHA-256:

```text
69a94cbb14d9d3e52fbd5422cc89b1013c6d3827b88e3de1cfa0675dc3fb2cf9
```

## 사후 검증과 한계

별도의 read-only 검증 script가 durable state, Pi session의 필요한 tool-result/인자만 메모리에서 확인하여 token/digest 복사, 실제 stale 오류, audit outcome, file SHA/diff, checks 및 lock 해제를 재검증했다. 전체 session 로그는 문서에 복제하지 않았다.

- 원본 fixture의 HEAD/branch/index/추적 bytes/status, 개인 auth/models/settings bytes 불변: PASS.
- 초기 harness goal에서 파일 경로 뒤에 붙인 `:` 때문에 QUICK literal-path preflight가 두 번 실패했다. 경로를 독립 token으로 고친 뒤 위 두 실제 run을 실행했다. 이 초기 실패에서는 Provider/worker가 시작되지 않았고 Runtime parser는 변경하지 않았다.
- 사후 검사 script는 처음 Node test 출력이 TAP(`# pass`)이라고 가정하여 실패했다. 실제 Node 26 spec 출력의 pass count를 읽도록 고친 뒤, **Provider 재호출 없이** 같은 저장 evidence를 재검증하여 PASS했다. 실제 등록 checks는 처음부터 PASS였다.
- Token 수는 Provider가 보고한 usage다. 실제 청구 비용은 확인하지 않았다.
- 실제 Provider의 stale 이후 재읽기/복구는 이번 smoke 범위가 아니다. 해당 동작은 LOG-039의 SDK/faux 검증과 구분한다.
- full-file stale 보호는 anchored `runtime_edit`에만 적용된다. legacy exact edit/runtime_write/trusted checks의 변경을 anchored-only로 강제하지 않는다.
- 최종 검사와 write syscall 사이 모든 외부 경합, 다른 Provider/모델/OS/Node, TUI/launcher, 전체 GPT RC-01~08 및 정식 배포물을 검증한 결과로 확대하지 않는다.
- Runtime/Pi 제품 코드는 변경하지 않았다. 임시 fixture/session/harness는 결과 확인 후 정리했다. 원본 fixture와 안정 태그 `weavra-v0.1-rc1`은 유지했다.
