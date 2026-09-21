# Weavra V0.3B — TS LSP / Real-Provider Smoke

- **실행일:** 2026-09-17 (KST), transport 16:44 및 최종 재검증 17:09, Provider workflow 16:46–16:47.
- **소스:** `devlop` HEAD `e09100fe3e0ce08610b48a056ed6cd03714e0f97` 위의 **미커밋 V0.3B working tree**. 해당 HEAD 자체에 LSP가 포함됐다는 뜻은 아니다.
- **환경:** macOS/Darwin arm64, Node `v26.7.0`, 기존 설치된 `typescript-language-server 5.1.3`, `tsc --version` 6.0.3.
- **결과:** 실제 stdio 네 query PASS, 실제 Provider STANDARD/R1 한 run PASS.
- 자동 설치·새 build·TUI/launcher smoke·전체 GPT RC 재실행은 하지 않았다. 임시 synthetic fixture에서만 실행했고 Runtime core guard를 테스트용으로 완화하지 않았다.

## 1. 실제 TypeScript server — Provider 호출 없음

private 임시 project root에 `src/a.ts`, `src/b.ts`, `tsconfig.json`을 작성했다. strict/noEmit, TS target ES2022, moduleResolution bundler, automatic type acquisition disabled를 사용했다.

```ts
// src/a.ts
export const bad: number = "wrong";
export function greet(name: string): string {
  return "Hi " + name;
}

// src/b.ts
import { greet } from "./a";
export const value = greet("Ada");
```

실제 `LspManager`에 executable `/opt/homebrew/bin/typescript-language-server`, argv `["--stdio"]`, `.ts/.tsx/.js/.jsx`, timeout 10,000ms, allowed path `src`를 등록했다. status 조회 시 stopped였고 첫 query에서만 lazy spawn했다.

| Query | 실제 결과 |
|---|---|
| diagnostics `src/a.ts` | **PARTIAL**, TS2322/error 1개: string을 number에 할당할 수 없음. 1-based line 1, column 14 |
| definition `src/b.ts:2:22` | **AVAILABLE**, `src/a.ts:2:17`의 greet 정의 |
| references `src/a.ts:2:17` | **AVAILABLE**, 정의 1개와 b.ts import/call 2개, 합계 3개 |
| document symbols `src/a.ts` | **AVAILABLE**, `bad`, `greet` |

TypeScript 서버는 push diagnostics를 사용하므로 PARTIAL을 유지했다. 오류가 한 개 있다는 이유로 FAIL이라고 하지 않았고 query 성공을 PASS evidence로 변환하지 않았다.

query 전후 세 파일의 SHA-256과 디렉터리 목록이 동일했다. `close()` 뒤 process stopped 및 `safeToRelease:true`를 확인했다. 이는 관리하는 POSIX process group의 종료 확인이며 임의 daemon/OS sandbox 검증은 아니다.

## 2. 실제 Provider — edit → LSP evidence → independent Reviewer

- **Provider/model:** 사용자 fixture의 coding/reasoning 설정 `codex-lb / gpt-6-astra`.
- **Worker thinking:** medium.
- **Workflow/risk:** STANDARD/R1, Developer와 Reviewer 각각 새 session.
- **Run:** `f60816fb-f65d-4103-b8b6-d1e0d6032795`.
- **임시 fixture baseline:** `38cf1b1e6bd0da7e056c136288c9c5509bc31ce2`.
- **Developer session:** `01a0ae55-061b-7479-a947-75c96b2def22`.
- **Reviewer session:** `01a0ae55-67df-7479-a947-75ca1ce776e8`.
- **시간:** 45,283ms.

Goal:

```text
Fix the type error in src/a.ts by using a numeric initializer for bad. Inspect diagnostics before and after the change. Preserve greet and all other files.
```

모델이 실제로 선택한 순서:

```text
Developer
  runtime_read
  runtime_lsp_diagnostics     → PARTIAL, TS2322
  runtime_edit               → "wrong"를 숫자 0으로 변경
  runtime_lsp_diagnostics     → PARTIAL, diagnostics []
  submit_handoff
SELF_CHECK
  required regression + typecheck → PASS
  verifier-owned diagnostics → PARTIAL, diagnostics []
Reviewer
  actual diff + checks + LSP evidence 수신
  runtime_read
  submit_review              → PASS
TEST
  required regression + typecheck → PASS
  verifier-owned diagnostics → PARTIAL
LSP shutdown/exit + cleanup
Kernel COMPLETE              → COMPLETED
```

harness는 모델의 도구 인자/결과를 만들지 않고 SDK 이벤트와 Reviewer 입력을 관찰했다. goal에서 전후 diagnostics 조회를 요청한 실제 사용 검증이며, 모든 모델이 별도 요청 없이 항상 LSP를 선택한다는 주장으로 확대하지 않는다. Reviewer는 이번 run에서 별도 LSP tool을 호출하지 않고 verifier evidence를 사용했다.

Reviewer의 LSP evidence는 `serverId:typescript`, `status:PARTIAL`, diagnostics 0개, 현재 diffDigest 일치였다. `lsp:f60816fb-f65d-4103-b8b6-d1e0d6032795:self-check:1:0`이 trusted refs와 reviewContext.evidence 양쪽에 정확히 연결되었고 independent PASS의 refs에도 포함됐다. **0 diagnostics가 PASS를 만든 것이 아니다.** 기존 필수 process checks와 독립 리뷰/Kernel guard를 별도로 통과했다.

Required process results:

| Stage | Check | Result |
|---|---|---|
| SELF_CHECK | Node regression | PASS / exit 0 |
| SELF_CHECK | `tsc --noEmit --project tsconfig.json` | PASS / exit 0 |
| TEST | Node regression | PASS / exit 0 |
| TEST | `tsc --noEmit --project tsconfig.json` | PASS / exit 0 |

`src/a.ts`의 initializer 한 곳만 바뀌었고 다른 파일과 greet 동작은 유지됐다. tool error 0개, server process stopped, writer.lock 없음, 최종 COMPLETED를 확인했다. 별도 read-only script로 durable state와 필요한 session fields를 대조하여 전후 diagnostic code, exact refs, checks, 실제 diff를 재확인했다.

Provider-reported usage: input 9,158 / output 874 / cacheRead 5,120 / cacheWrite 0 / total 15,152 tokens. 실제 청구 비용은 확인하지 않았다.

## 경계와 제한

- 사용자 원본 `weavra-rc-fixture`는 수정하지 않았고 `~/.weavra/agent`의 auth/models/settings bytes도 전후 동일했다. worker sessions/model cache는 임시 경로에 분리했다. credential 값·전체 reasoning/conversation/tool 로그는 이 문서에 저장하지 않는다.
- 서버와 Provider를 재현한 fake가 아니라 기존 실제 설치/인증으로 실행했다. 자동 JSON-RPC·Policy·Kernel 실패 회귀는 별도 fake stdio/SDK-faux tests이며 실제 smoke와 구분한다.
- Runtime mutation tool은 기존 runtime_edit뿐이다. client LSP applyEdit/rename/codeAction 경로는 없으며 해당 거부는 자동 fake-server tests에서 검증한다. 외부 language server 실행 파일/플러그인은 여전히 trusted code이지 OS sandbox가 아니다.
- 별도 global daemon/extension 설치/refCount pool, remote/multi-root, LSP hard completion gate, 자동 fix/formatter는 도입하지 않았다.
- 최종 malformed envelope/availability/cancellation 경계 보완은 자동 회귀로 재검증하며 이 한정 Provider happy-path를 추가 호출하지 않는다. 다른 Provider/서버/OS/Node와 전체 RC 성공을 주장하지 않는다.
- 임시 fixture/session/harness는 결과 확인 후 정리했다. 안정 태그 `weavra-v0.1-rc1`은 유지했다.
