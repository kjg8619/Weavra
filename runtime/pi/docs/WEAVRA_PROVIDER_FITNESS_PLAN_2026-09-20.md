# V0.6B — Provider Fitness Matrix 조사·평가 계획

- 작성: 2026-09-20, Asia/Seoul.
- 상태: **C06 CLOSED — audited v3 full actual·read-only 비교/UI·최종 회귀·정상 게시·exact CI 완료**(2026-09-20 23:46 Asia/Seoul). 1~8절은 최초 조사, 9절은 현재 계약, 10~14절은 변경하지 않는 역사적 기록, 15절은 독립 audit와 새 정책, 16절은 새 actual 및 closure 근거다. 이제 V0.6C/Jev 연구와 첫 read-only slice에 진입할 수 있다.
- 선행 조건: V0.6A/C07 bounded closure 후 시작했다. Pi 구현 `fd0f93d58e187d3c83f77424cb4cbf3f7ae8a2a3`의 [exact CI](https://github.com/kjg8619/pi/actions/runs/35491863295) PASS, T3 `09de732fe8b02821ab150fe013f9acf9e93f99bc`의 로컬 전체 gate PASS·devlop CI 미실행은 [WORK_LOG LOG-105](WORK_LOG.md#log-105--2026-09-20-1440-asiaseoul--v06ac07-bounded-closure)에 기록했다.
- 이번 조사에서는 source·기존 evidence·공식 문서를 읽고 secret-free model identity inventory만 실행했다. inference/model-list API, auth 파일/credential 값 조회, 설정 변경, 설치, 자동 모델 선택·fallback은 하지 않았다.

## 1. 문제와 결정

같은 모델 이름이어도 endpoint·API adapter·tool schema·thinking 설정이 다르면 같은 실행 계약이 아니다. 예를 들어 과거 CommandCode DeepSeek는 schema-valid tool을 만들었지만 `task`에 ID 대신 goal을 제출했다. schema 통과를 Task Contract 준수로 계산하면 실제 실패를 숨긴다. 반대로 tool 호출 전 gateway timeout을 모델의 작업 오답으로 계산해도 잘못이다.

**평가 단위는 모델 상품이 아니라 고정된 Provider/model/endpoint/harness 조합이다.** 형식, 의미, 권한, oracle 결과, 가용성, 자원 사용을 분리한다. 모든 판정은 원래 Runtime/Kernel/독립 verifier/oracle을 따른다. 모델의 자연어 완료, JSON 형식, Reviewer PASS만으로 eval PASS를 만들지 않는다. 이 원칙은 기존 [C06 설계](WEAVRA_AGENT_LANDSCAPE_AND_ADOPTION_2026-09-18.md#c06--provider-contractfitness-matrix)를 재사용한다.

## 2. 후보와 현재 근거

2026-09-20 안전한 로컬 inventory는 user `models.json`에서 **provider ID·API·model ID·reasoning boolean만** 출력했다. auth와 endpoint 값은 출력하지 않았고 파일을 변경하지 않았다. 설정 존재는 인증 유효성·현재 가용성·실제 backend identity의 proof가 아니다.

| 별도 cell | 현재 지원/설정 근거 | 실제 Weavra evidence와 미확인 사항 |
|---|---|---|
| Astra relay: `codex-lb / gpt-6-astra / openai-responses` | 현재 custom entry 있음, reasoning=true | 과거 STANDARD·strict/trust/sandbox·bounded repair·Reviewer context 성공 기록 있음. response-model echo/relay upstream identity와 반복 fitness는 UNKNOWN. 개발 하네스의 `openai-codex`와 합치지 않음 |
| CommandCode: `commandcode / deepseek/deepseek-v4.1-flash / openai-completions` | 현재 custom entry 있음, reasoning=true. 역사적 endpoint는 `https://api.commandcode.ai/provider/v1` | 과거 streaming/tools/수정/review 성공과 실패 기록 있음. direct DeepSeek·다른 gateway route의 strict/reasoning 보장을 승계하지 않음 |
| Public OpenAI: `openai / gpt-6-astra / openai-responses` | 현재 hydrated catalog와 public Responses adapter 지원, 공식 문서에 해당 모델 명시 [S1–S3] | 위 custom relay와 별도 후보. 이 조사에서 공식 endpoint의 인증·새 Weavra 실행·반복 fitness를 확인하지 않음 |
| OpenAI Codex: `openai-codex / 명시한 model / openai-codex-responses` | 기존 subscription backend adapter, public API와 다른 endpoint/transport/auth 계약 | 필요 시 별도 cell. 기존 SSE/WebSocket 선택·transport retry와 모델 fallback을 혼동하지 않음. 개발 agent 사용은 Weavra worker proof가 아님 |
| Gemini: `google / 정확한 versioned model / google-generative-ai` | SDK/catalog 지원. `gemini-3.8-flash`, `gemini-3.1-pro-preview`, `gemini-2.5-flash` 등의 지원과 실제 인증은 별개 | custom inventory에 Google entry는 없었으나 built-in auth 부재를 뜻하지 않음. auth·실제 Weavra 품질은 미확인. 이미 준비된 인증과 사용자 실행 승인 시에만 조건부 포함 |
| Vertex / direct DeepSeek / local omlx | 각각 별도 endpoint/API cell. `omlx / Qwen3.8-27B-MLX-4bit / openai-completions` custom entry는 확인됨 | 현재 주 비교에서 제외. 설정된 로컬 모델도 실제 fitness는 UNKNOWN. direct DeepSeek는 기존 문서상 NOT VERIFIED이며 gateway 결과로 채우지 않음 |

Astra의 public model 이름이 현재 공식 문서에 존재해도 역사적 custom alias의 backend를 소급 식별할 수 없다. region, endpoint route, model revision이나 alias mapping이 바뀌면 새 cohort로 남긴다.

### 역사적 실행은 비교 표본이 아니라 출발 근거

- [2026-09-18 CommandCode smoke](WEAVRA_COMMANDCODE_DEEPSEEK_SMOKE_2026-09-18.md): hardening 전 STANDARD **1/5**, QUICK **0/3** 완료. 형식은 유효했지만 identity/protected instruction/unresolved 오류가 있었다. 이후 hardening은 모델 정정을 허용하되 Host가 identity를 고치거나 권한을 완화하지 않았다.
- 같은 문서의 후속 실행: STANDARD **2/3**, QUICK **1/3** 완료. 나머지 3회는 모델 도구 상호작용 전 Provider timeout이었다. 성공 sample에서 identity correction은 **0회**였으므로 실제 correction recovery 성능을 측정했다고 할 수 없다. warm-up 뒤 성공의 인과관계도 입증되지 않았다.
- Astra cross sample은 35,236ms/9,751 tokens, 후속 sample은 32.7s/10,292 tokens로 완료했다. 서로 다른 revision·warm-up 조건의 작은 표본을 순위나 안정적인 성공률로 합산하지 않는다.
- WORK_LOG LOG-084: Astra의 통제된 초기 defect → SELF_CHECK 실패 → fresh bounded repair → 독립 review/test → oracle PASS 1회. **자연 발생 오류 복구율이 아니다.** LOG-091은 actual Reviewer context 성공 1회이며 actual pack on/off 반복 비교가 아니다.
- C07의 새 T3 통합은 **로컬 faux Provider** proof다. Provider fitness sample에 포함하지 않는다. gateway의 configured cost=0도 무료 청구가 아니라 **비용 UNKNOWN**이었다.

## 3. Adapter별 조사 결과

### 서로 다른 세 가지 strict

1. Runtime tool schema/identity 검증.
2. Provider의 constrained JSON sampling.
3. Weavra mutation의 fresh read receipt·digest·anchor 검증.

이 셋은 서로 대체하지 않는다. 현재 Weavra tools의 구조화 제출 성공을 Provider-enforced strict decoding으로 표시하지 않는다. Provider strict 옵션의 `prefer`는 지원하지 않는 schema/model에서 완화될 수 있고 `require`는 로컬에서 거부될 수 있다. Pi의 [strict converter](../packages/ai/src/api/constrained-sampling.ts)는 Provider의 전체 JSON Schema 지원보다 좁고 optional 필드를 required+nullable로 변환한다. emitted schema와 실효 mode를 따로 기록하고, 의미를 바꾼 schema를 같은 조건의 결과로 비교하지 않는다.

### OpenAI / Astra [S1–S5]

- Public Responses, subscription Codex, custom relay는 별도 경로다. 공개 strict schema나 reasoning 지원 문서를 custom relay의 보장으로 사용하지 않는다.
- function calling의 구조화 인자와 structured text 출력은 다른 기능이다. 올바른 JSON에도 잘못된 AC ID, evidence reference, path 또는 답이 들어갈 수 있다. refusal·length truncation·incomplete response는 schema 성공으로 처리하지 않는다.
- reasoning/tool continuation에는 관련 reasoning item과 call/result identity 보존이 필요하다. 현재 generic [message transformation](../packages/ai/src/api/transform-messages.ts)은 errored/aborted assistant turn을 replay에서 제외한다. README의 partial continuation 설명을 중단 지점 그대로의 resume로 해석하지 않는다.
- client abort, upstream generation 중지, 최종 billing, Runtime writer release는 서로 다른 관측이다. interrupted stream은 마지막 usage를 받지 못할 수 있다. 새로운 background response/cancel API를 matrix 때문에 도입하지 않는다.

### CommandCode / DeepSeek [S6–S8]

- gateway는 Chat Completions·Responses·Anthropic route와 model별 endpoint eligibility를 문서화한다. 현재 Weavra 설정은 **Chat Completions**이며 다른 route의 tool/strict 보장을 승계하지 않는다.
- [Chat adapter](../packages/ai/src/api/openai-completions.ts)의 direct-DeepSeek compatibility 감지는 provider/base URL에 의존한다. model 이름만 DeepSeek인 gateway는 같은 thinking/max-token/strict 동작으로 가정하지 않는다.
- direct DeepSeek의 beta strict tool, thinking/tool-choice 제한은 직접 endpoint의 계약이다. 현재 gateway exact alias의 strict enforcement·effective thinking·상한·cancel billing은 별도 검증 전 UNKNOWN이다.
- tool 인자를 Host가 수정해서 성공률을 높이거나 gateway 문제를 숨기는 warm-up/재시도/fallback을 추가하지 않는다. 기존 adapter retry가 있다면 실제 횟수와 시간·usage를 구분해 보고한다.

### Gemini / Vertex [S9–S11]

- Pi의 [Google shared adapter](../packages/ai/src/api/google-shared.ts)는 versioned Gemini major >=3과 schema에 따라 strict tool을 허용한다. `VALIDATED`는 텍스트도 허용할 수 있고 `ANY`는 tool 선택을 강제하므로 서로 다른 실험이다. Gemini 2.5나 unversioned alias의 결과를 같은 strict cell에 합치지 않는다.
- 현재 adapter는 `generateContentStream`을 사용한다. 공식 문서의 Interactions API 기능을 현 Pi 구현으로 표시하지 않는다. generic payload hook이 있다는 것과 first-class structured-text 옵션이 있다는 것도 구분한다.
- Google SDK는 **AbortSignal이 client-only이고 service 작업/과금을 취소하지 않는다**고 명시한다 [S11]. local cancellation의 PASS를 provider-side compute/billing 종료로 표현하면 안 된다.
- reasoning은 output의 일부이고, cache 사용량은 분리된다. thinking disabled 요청도 모델별로 LOW/MINIMAL로 매핑될 수 있으므로 requested/effective 값을 구분한다. 동일 provider/model의 valid signature continuation과 cross-model 전달도 따로 평가한다.

## 4. 기존 구성요소 재사용과 필요한 차이

새 Runtime/Policy/완료 엔진을 만들지 않는다.

- [runWeavraFixture](../packages/evals/src/weavra-harness.ts): 격리 Git fixture, frozen Task Contract, 실제 StandardWorkflow/Kernel/checks, Host-owned oracle, Evidence Pack, cleanup 경로를 재사용한다. oracle은 agent가 편집할 수 없고 Runtime COMPLETED와 독립이다.
- [기존 여섯 fixture](../packages/evals/src/weavra-fixtures.ts): `read-explain`, `read-discover`, `quick-read`, `quick-edit`, `standard-2ac`, `standard-incomplete`. 앞의 read-only oracle은 주로 **파일 불변**을 검사하므로 설명의 의미 정확도 점수가 아니다. 마지막은 약한 check/요구사항 불일치에 대한 **negative false-completion probe**이며 정상 성공률 분모와 분리한다. 유료 비교 전 각 oracle/AC의 의미 적합성을 다시 고정해야 한다.
- [WorkerMeasurement](../packages/company-runtime/src/measurement-types.ts): requested/actual provider/model, optional responseModel, role/attempt, duration, modelTurns, toolCalls/byName, usage provenance, context/reviewer summaries를 재사용한다. reasoning을 total에 두 번 더하지 않고 usage 누락/부분 값은 UNKNOWN으로 남긴다.
- 현재 eval은 두 role에 같은 provider/model을 넣는다. 역할별 교차 모델 비교는 현재 API가 이미 지원하는 것처럼 주장하지 않는다. 우선 동일 조합·독립 session을 기본 cohort로 한다.
- TTFT, 실제 HTTP attempt 수, schema 첫 제출/정정 구분, cancel 단계별 timestamp, per-run 외부 비용은 현 `WeavraEvalResult`가 모두 제공하지 않는다. 후속 구현에서 **eval 결과의 bounded 추가 관측**으로 설계할 항목이지 이미 존재하는 기능이 아니다. 원문 prompt/reasoning/credential을 수집하는 telemetry를 만들지 않는다.

## 5. 필수 평가축 10개

아래는 **실행할 계획**이며 이번에 새로운 fitness 점수를 측정하지 않았다.

| 축 | 과제·관측값 | 판정과 실패 분리 |
|---|---|---|
| 1. Tool schema adherence | 실제 Worker tools의 name/JSON/required/extra fields/enum을 검사. 첫 완성 call과 정정 후 제출을 분리하고 rejected 수·denominator 기록 | 완성된 call 중 schema-valid 비율. malformed/incomplete transport와 의미상 잘못된 identity를 다른 항목으로 기록. unsupported strict schema는 UNSUPPORTED, 조용한 완화 금지 |
| 2. Strict edit 성공 | R1 source read → anchored mutation → 실제 byte oracle. 통제된 stale change 후 재읽기, consumed receipt, protected source 시도 포함 | 첫 수정 성공·소모성 stale 복구·최종 oracle/무권한 무변경을 분리. strict를 compatible로 내리거나 receipt를 Host가 만들어 주지 않음 |
| 3. Task Contract 준수 | 두 개 이상의 frozen AC, ID/중복/누락/정확한 task identity, scope·check mapping과 실제 결과 확인 | 각 AC의 semantic oracle와 contract digest 불변. 자연어 완료·임의 ID·다른 task 결과는 거부. read-only는 불변성과 설명 정확도를 따로 측정 |
| 4. Reviewer format/판정 | 정상/의도된 defect diff, exact run/revision/task/diffDigest, AC별 trusted evidence refs, 독립 session | 첫 valid submit·모델 correction·false PASS/false REVISE·false COMPLETE를 분리. schema-valid review는 정확한 defect detection의 증거가 아님 |
| 5. Cancellation | idle/pre-Run, active model stream, tool 대기, registered check 진행의 취소를 구분. cancel 요청→client abort→agent/check 종료→canonical terminal→writer release 시간 기록 | C07의 pre-Run wire cancel 미지원은 N/A. 지원 경로에서 partial 변경 보존과 cleanup 확인. provider compute/billing 종료는 별도 근거 없으면 UNKNOWN; abort 후 자동 replay/resume 금지 |
| 6. Structured output | tool arguments, handoff/review semantic submit, provider structured text를 서로 다른 subcase로 구분. nullable/optional·중첩·unsupported/refusal/truncation 경계 | SDK에서 노출하지 않는 기능은 UNSUPPORTED/NOT EVALUATED. JSON parse 성공을 schema/semantic/Workflow 성공으로 승격하지 않음 |
| 7. Context pack 효과 | 같은 fixture/contract에서 disabled vs bounded paired runs. context digest/bytes/freshness, 탐색 calls, oracle와 role별 tokens/latency | 품질·authority 불변 조건 아래 차이 보고. truncated/UNKNOWN/stale를 보존. scripted faux A/B를 실제 token 절감이나 모델 개선으로 쓰지 않음 |
| 8. Bounded repair 효과 | STANDARD/EDIT/R1의 통제된 SELF_CHECK 실패에서 disabled vs 1회 bounded repair. 같은 defect·budget·oracle | fresh attempt/session/receipt, failed parent 보존, checks+독립 review+oracle를 확인. 자연 오류 cohort는 별도. R2/R3·일반 retry/resume로 확대하지 않음 |
| 9. Token/call 사용량 | 모든 role/attempt의 provider input/output/cache/reasoning, modelTurns/toolCalls, 가능한 HTTP attempts, 외부 비용 provenance | provider usage 없는 값은 UNKNOWN. reasoning 이중 합산·modelTurns=network requests·configured cost 0=free 금지. 실패/정정/repair 사용량도 누적 |
| 10. Latency | preflight, first provider event/첫 가시 token/첫 tool, worker, check/review, 전체 run, cancel cleanup을 각각 관측 | cold/warm/cache·실패/성공을 분리. timeout도 버리지 않음. 작은 n은 개별 값/median/range를 보고하고 안정적인 p95를 주장하지 않음 |

## 6. 재현 가능한 실행 설계

### 고정 manifest

각 cell/실행은 다음 메타데이터를 묶어 기록한다. 비밀과 raw endpoint query/userinfo는 포함하지 않는다.

- Runtime/SDK commit·package lock digest, OS/Node, fixture·oracle revision/digest, tool schema revision와 실제 emitted schema digest.
- provider, requested/actual/response model(미반환은 UNKNOWN), API adapter, 안전한 endpoint 식별자/route, region, catalog capture date, transport, 기존 retry 정책.
- coding/reasoning profile과 thinking requested/effective, sampling 옵션, tool-choice와 constrained-sampling mode, strict mutation/trust/sandbox, context/repair mode.
- frozen config/Task Contract/registered check digest, risk/workflow, role/attempt/session identity, max revision·worker/run timeout·usage/call 예산, 승인된 외부 비용 상한.
- 실행 시각, 명시한 cold/warm/cache 조건, 모든 scheduled attempt와 종료/실패 단계. auth는 방식/가용 여부만 기록하고 credential을 저장하지 않는다.

### 제안 순서

1. **오프라인 manifest/계약 회귀:** 기존 eval/measurement를 연결하고 malformed schema, stale receipt, 위조 identity/evidence, missing usage, aborted stream과 oracle false-completion 탐지를 deterministic fixture로 확인한다. model ranking용 faux 점수는 만들지 않는다.
2. **명시적 opt-in capability probe:** 승인된 endpoint별 exact model·schema·reasoning/tool continuation·usage/cancel 의미만 작은 상한으로 확인한다. auth/route/schema가 지원되지 않으면 그 cell을 중단하고 UNKNOWN/UNSUPPORTED로 남긴다. 다른 모델로 대신하지 않는다.
3. **기본 actual cohort:** 준비된 Astra relay·CommandCode·public OpenAI 조합을 우선한다. 제안 pilot은 기존 6 fixture × cell당 5회이며, false-completion negative는 별도 표다. 각 실행은 새 격리 checkout/session을 사용하고 cell 순서를 번갈아 배치한다. 5회는 탐색용 수량이지 신뢰할 수 있는 모집단 성공률이 아니다.
4. **별도 paired cohort:** context disabled/bounded 및 repair disabled/1회를 각각 한 변수만 바꿔 비교한다. 기존 frozen Task Contract·검증·oracle·budget은 유지하고 효과값과 실패까지 모두 보고한다. 모드를 한꺼번에 켜고 어느 기능의 효과인지 주장하지 않는다.
5. **조건부 확장:** 이미 인증된 Gemini/Vertex 또는 local omlx를 사용자가 선택한 경우 같은 manifest로 추가한다. 20 fixture corpus·다른 OS·서로 다른 Reviewer model은 독립 후속 범위이며 이번 계획이 자동 실행 승인은 아니다.

현재 Runtime의 worker timeout·revision·budget 설정을 그대로 명시하여 고정한다. 모델별로 같은 이름의 thinking 값을 같은 계산량이라고 가정하지 않는다. Provider별 의미가 다르면 별도 cohort로 나눈다. token/call/금액 상한을 실행 전 승인하고 소진·usage UNKNOWN 때 더 저렴한 모델로 자동 전환하지 않는다. 일반 CI에는 실제 Provider credentials나 paid eval을 넣지 않는다.

### 분모와 결과 표현

- availability: 모델 상호작용에 도달한 runs / 전체 scheduled runs. auth·preflight·rate limit·transport timeout도 전체 결과표에 남긴다.
- behavioral metrics: 해당 관측이 가능한 call/run 수를 분모로 표시한다. 도달하지 못한 단계는 0점이 아니라 NOT REACHED다.
- valid-positive completion: canonical COMPLETED **그리고** independent oracle PASS. falseCompletion은 COMPLETED이면서 oracle FAIL인 별도 치명 항목이다. 의도된 negative probe는 정상 작업의 완료율과 합산하지 않는다.
- 결과 상태는 VERIFIED/PARTIAL/UNKNOWN/UNSUPPORTED/NOT EVALUATED와 evidence 종류(official claim/source contract/faux/historical actual/current actual)를 같이 표시한다. 현재 후보별 새로운 fitness 값은 전부 NOT EVALUATED다.
- 성공 사례만 재시도·선별하지 않는다. 실패 원인을 auth/transport/schema/semantic identity/Policy/task oracle/cancel cleanup/usage unavailable로 나누고 sample 수·날짜·revision을 표시한다. 작은 표본은 모델 순위나 general compatibility 판정이 아니다.

## 7. 구현 착수 조건과 이번 종료선

계획은 구현 착수 판단에 사용할 수 있다. 후속 착수 시 exact endpoint/model·인증·비용 상한, fixture oracle의 의미 적합성, 현재 adapter 계측의 누락을 먼저 고정해야 한다. 아직 새 matrix runner/schema/report UI나 paid cohort는 구현·실행하지 않았다.

후속 matrix의 완료 조건은 (1) 재현 가능한 manifest와 UNKNOWN 보존, (2) 최소 하나의 실제 false-completion 탐지 negative, (3) 10축별 근거/미측정 구분, (4) 명시적으로 승인된 actual sample, (5) 모든 실패·취소·cleanup·비용 제한 기록이다. 필요하지 않은 장기 storage/telemetry/자동 scheduler는 도입하지 않는다.

**자동 Provider fallback, retry/resume 확대, Policy 완화, Reviewer 제거, 새 COMPLETE authority, T3의 모델 자동 교체, Browser product는 이 계획의 구현 범위도 아니다.** 이번 요청은 이 문서에서 멈춘다.

## 8. 출처와 조사 한계

공식 문서는 **2026-09-20 조회한 공개 계약 주장**이다. 실제 endpoint가 이를 이행하는지 이번에 호출하지 않았다. Pi adapter 계약·기존 실험과 구분한다.

- [S1] [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling)
- [S2] [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [S3] [OpenAI reasoning](https://developers.openai.com/api/docs/guides/reasoning)
- [S4] [OpenAI background/cancellation](https://developers.openai.com/api/docs/guides/background)
- [S5] [OpenAI Chat Completions reference](https://developers.openai.com/api/reference/resources/chat)
- [S6] [CommandCode Provider API](https://commandcode.ai/docs/provider)
- [S7] [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion)
- [S8] [DeepSeek tool calls/strict mode](https://api-docs.deepseek.com/guides/tool_calls)
- [S9] [Google function calling](https://ai.google.dev/gemini-api/docs/function-calling)
- [S10] [Google structured output](https://ai.google.dev/gemini-api/docs/structured-output)
- [S11] [Google SDK GenerateContentConfig / abortSignal](https://googleapis.github.io/js-genai/release_docs/interfaces/types.GenerateContentConfig.html#abortsignal)

로컬 근거는 [Pi AI 계약](../packages/ai/README.md), `packages/ai/src/api/{openai-responses,openai-responses-shared,openai-codex-responses,openai-completions,google-generative-ai,google-vertex,google-shared,constrained-sampling,transform-messages}.ts`, 기존 smoke와 WORK_LOG LOG-081~093, 위 eval/measurement source다. 하네스 README의 aborted-message continuation 설명과 실제 replay 처리의 차이는 계획의 제한으로 기록했고 이 조사에서 무관한 SDK 동작이나 문구를 수정하지 않았다.

## 9. C06 bounded 구현 계약

`weavra fitness`는 평가 전용 CLI다. interactive Runtime/control RPC에서 실행되지 않는다. 현재 corpus `weavra-fitness-3`는 Host-owned F01 조사, F02 strict 단일 수정, F03 bounded 다중 파일, F04 reviewed bugfix recipe, F05 경로 발견/context, F06 통제된 독립 리뷰, F07 통제된 1회 repair, F09 versioned docs, F10 untrusted authority, F08 active-stream cancel 순서다. 취소는 usage 미수신 가능성 때문에 마지막에 둔다. F06·F07은 자연 오류 복구율이 아니다. v1/v2 actual 기록은 소급 재평가하지 않는다.

```sh
weavra fitness list --json
weavra fitness targets codex-lb
weavra fitness targets commandcode
weavra fitness faux GOOD --max-fixtures 10 --max-worker-calls 32 --max-tokens 1000000
# list가 출력한 현재 corpusDigest를 직접 확인한 뒤 사용한다.
weavra fitness run codex-lb/gpt-6-astra --allow-paid --confirm-corpus <digest> --max-fixtures 10 --max-worker-calls 32 --max-tokens 500000
# 선택적인 독립 2-fixture probe. 이를 full matrix record에 복사하거나 F01/F02를 자동 재시도하지 않는다.
weavra fitness run codex-lb/gpt-6-astra --allow-paid --confirm-corpus <digest> --calibration --max-fixtures 2 --max-worker-calls 4 --max-tokens 100000
# 별도 probe를 지정하면 나머지 8개만 실행한다. 두 record를 합쳐 EVALUATION_COMPLETE로 승격하지 않는다.
weavra fitness run codex-lb/gpt-6-astra --allow-paid --confirm-corpus <digest> --calibration-id <id> --max-fixtures 8 --max-worker-calls 28 --max-tokens 400000
weavra fitness show <id> --json
weavra fitness compare <left-id> <right-id> --json
```

- 실제 평가는 clean committed harness·explicit paid opt-in·현재 corpus 확인·required sandbox를 요구한다. Fresh full은 한 record에서 F01→F02→나머지 순서로 수집한다. F01/F02의 calibration은 **측정 가능한 harness integrity**만 판단하며 semantic FAIL·contract FAIL·falseCompletion 자체를 입장 차단 사유로 쓰지 않는다. Oracle INVALID, protocol/transport/provider/auth failure, timeout, UNKNOWN usage, cleanup 불확실성, 측정/하네스 오류는 중단한다. 관측되지 않은 transport count를 측정된 0으로 바꾸지 않으며 다른 모델·route로 대체하지 않는다.
- 별도 `StandardWorkflow`가 아니라 기존 Workflow/Kernel/Task Contract/Policy/strict receipts/Verifier Trust/Sandbox/독립 SDK session을 사용한다. protected 등록 check는 고정 결과만 출력하며 외부 Host oracle은 실제 source bytes·canonical terminal·review/repair/cancel 사실을 검사한다. Reviewer PASS나 모델 완료 선언은 oracle PASS가 아니다.
- source edits는 exact byte replacement corpus이며 일반 코드 품질 benchmark가 아니다. F05에는 bounded context/discovery가 있고 LSP 호출 횟수는 관측하지만 LSP 사용을 강제하지 않는다. F09는 frozen reviewed-local label 1.2.3 문서이며 인터넷 문서 검색이 아니다.
- F04는 bugfix recipe를 실제 compile한 뒤 fixture의 명시적 `statements`를 사용자 검토된 AC 수정본으로 고정한다. production `finalizeHostWorkflowPlan(draft, statements)`와 같은 reviewed override 의미이며 recipe 기본 문구의 무수정 전달을 검증하는 사례는 아니다.
- 전체 call budget은 fixture와 role/repair 경계에서 사전 차단한다. tokens는 provider-reported 정산 후 다음 invocation을 막는 한도이지 진행 중 응답의 hard billing cap이 아니다. usage 누락·0 초기값은 UNKNOWN이며 후속 호출을 막는다. 비용은 UNKNOWN이다. `--max-cost-usd`를 주면 안전한 사전 비용을 증명할 수 없어 호출을 전혀 허용하지 않는다.
- raw dimension은 oracle/falseCompletion, AC/check, scope·forbidden mutation·receipt/submission rejection, tool/correction/protocol error, provider/auth/timeout, repair/review, cancellation/cleanup, usage/calls/context bytes/latency다. HTTP attempts·transport 세부 오류·cost는 관측 불가 시 null(UNKNOWN)이다. `invalidCalls`는 schema 전용 비율이 아니라 도구 실행 오류 수이고 새 `protocolErrors`와 구별한다. TTFT·provider constrained text·effective thinking·context on/off 효과·cancel 단계별 시간은 측정하지 않는다. 종합 점수·winner는 없다.
- 새 record는 `schemaVersion: 2`이며 calibration/evaluation/stopReasons와 fixture별 integrity·bounded audit evidence를 보존한다. 기존 record schema v1과 corpus v1/v2의 bytes·resultDigest를 바꾸지 않는다. CacheRead/cacheWrite/reasoning의 양수 관측값과 `detailSource: SDK_NORMALIZED`만 보존하고, SDK 초기값 0·누락·불완전 invocation은 null(UNKNOWN)이다. Raw upstream field completeness의 증명이 아니다.
- `comparable=true`는 같은 schema/corpus/budget/harness/configuration/kind 및 F01–F10 전체 집합·순서를 충족한 완전한 collection끼리만 가능하다. Semantic FAIL·falseCompletion을 제거하지 않는다. Partial끼리나 partial/full은 NOT COMPARABLE이다. T3 DTO에는 optional 상태/fixture outcome을 추가하며 legacy는 UNKNOWN으로 읽는다.
- usage input/output과 total은 cache 등을 포함하는 서로 다른 provider 필드다. 둘을 다시 합산해 total을 만들거나 reasoning을 이중 가산하지 않는다. faux usage는 scripted SDK estimate이며 실제 model efficiency로 해석하지 않는다.
- Run `status`, calibration, evaluation, fixture capability outcome은 서로 다르다. `COMPLETED`는 계획된 수집 종료이지 모델 전부 PASS가 아니다. `CALIBRATION_READY`도 능력 인증이 아니다. Canonical 10개를 수집해야 `EVALUATION_COMPLETE`이며 마지막 expected F08 CANCELLED·oracle PASS·cleanup CONFIRMED의 UNKNOWN usage만 coverage 완료와 양립한다. UNKNOWN을 추정 token으로 채우지 않으며 그 이후 호출은 허용하지 않는다. Runtime COMPLETED + oracle FAIL만 falseCompletion=true다. 모든 stop은 별도 run ID와 이미 관측된 prefix를 보존한다.
- 저장은 `$WEAVRA_HOME/fitness/<canonical-project-root hash>/<UUID>.json`이다. `.ai`와 분리된 private directory/0600 file, strict schema·digest·bounded size·atomic publication을 사용한다. settled fixture prefix·terminal record는 재평가로 덮어쓰지 않는다. list/show/compare는 auth/inference/Runtime resume를 수행하지 않는다. 최근 32개·최대 4,096 entry만 열거한다. `--store-dir`은 CLI의 명시적 private 절대 경로 override다.
- Fitness Worker만 `SessionManager.inMemory`를 사용한다. 일반 Runtime JSONL 정책은 그대로다. Raw prompt/tool payload/reasoning/error/credential/endpoint URL은 저장하지 않는다. Audit에는 사전 허용된 파일 경로와 bytes hash·정규화된 제출/AC/check/phase·엄격하게 파싱한 F01/F10 answer만 bounded 형태로 보존한다. 자유 서술 summary는 digest만 남긴다. Endpoint identity는 userinfo/query/fragment를 제거한 origin+route의 hash이며 실제 upstream weights 증명이 아니다.
- 프로세스 강제 종료로 RUNNING record가 남아도 read가 resume/recover하지 않는다. resource release가 불확실하면 workspace를 지우지 않고 cleanup UNCONFIRMED를 남긴다. 외부 TOCTOU·전원 장애·provider-side billing 취소는 보장하지 않는다.

현재 구현과 실제 실행 결과는 후속 WORK_LOG 기록에 구분해 남긴다. calibration 전에는 candidate metadata가 실제 가용성이나 fitness proof가 아니다.

## 10. 실제 calibration과 중단 판정

2026-09-20 macOS에서 clean committed harness `c94d5ddc4871a66943abebebe437f460fa119e99`로 실행했다.
corpus `weavra-fitness-1`의 digest는 `sha256:5e6391d964668262b0851860af152813e40e3d9071d0e3b697e079a4ce4b8b57`다.
각 target은 동일하게 F01/F02, 최대 fixtures 2 / worker calls 4 / reported tokens 100,000의 opt-in calibration만 허용했다.
가격·청구액은 UNKNOWN이며 이 token limit을 hard billing cap으로 표현하지 않는다.

| 실제 target / API | Fixture | Runtime | 외부 oracle / false completion | worker / model turns | reported tokens | latency |
|---|---|---|---|---|---|---|
| codex-lb / gpt-6-astra / openai-responses | F01 | COMPLETED | PASS / false | 1 / 2 | 4,155 | 13,649 ms |
| 위와 동일 | F02 | BLOCKED | FAIL / false | 1 / 4 | 11,616 | 20,542 ms |
| commandcode / deepseek/deepseek-v4.1-flash / openai-completions | F01 | COMPLETED | FAIL / true | 1 / 2 | 6,391 | 8,594 ms |
| 위와 동일 | F02 | NOT STARTED | calibration 실패로 미실행 | 0 / 0 | 해당 없음 | 해당 없음 |

- Astra record: `d8ac6441-ad5f-48a8-b598-ff7e32f622d7`, **CALIBRATION_FAILED**. endpoint identity `sha256:5ed82577e56de9393ae4e36bdafbb1af3a13dd2a1ebcb2933b79aa8251e70e65`, result digest `sha256:44319a63d93691d8be24893051e9af6e155b815d59283cddbb1a2394fc58f0df`. F02 strict edit 1회와 checks 2 PASS는 있었지만 task adherence=false, canonical BLOCKED였다. 성공으로 승격하지 않는다.
- CommandCode record: `8b90b143-dc28-449f-9dc3-74c902ef4b80`, **CALIBRATION_FAILED**. endpoint identity `sha256:54098f3495c573bb3398e9d9c3f11e3493dbbdb631366891b5b113b3b2b7b2d2`, result digest `sha256:e592cf3ef6cfdecdfa08bd1128972501bb91f53dd36e2663ea903b7c1d074c44`. F01 AC met/checks PASS/Runtime COMPLETED와 별개로 고정 설명 oracle는 FAIL이다.
- F01 oracle는 **summary에 정확한 `classify(0)=non-positive` 사실과 strict-greater 원인이 있는지** 검사한다. 따라서 CommandCode 결과는 이 고정 계약의 false completion이지 일반 이해력·코드 품질 실패의 증거가 아니다. 원문 transcript와 세부 mismatch 이유를 저장하지 않았으므로 표현 차이와 누락 원인을 더 세분하지 않는다. 결과를 구제하려고 oracle·prompt·모델을 바꾸거나 재호출하지 않았다.
- 세 실제 fixture의 usage는 KNOWN, cleanup은 CONFIRMED다. scope violations·forbidden attempts·invalid tool calls·tool retries·기록된 provider/auth/timeout errors는 0이다. transport 세부 오류·HTTP attempts·가격·실제 upstream backend는 UNKNOWN이다. 모델명과 endpoint hash는 실제 weights의 증명이 아니다.
- 실제 CLI compare는 corpus/budget/harness/configuration/kind 일치, **fixtures 불일치 → comparable=false**를 반환했다. 서로 다른 실행 prefix의 token·latency 합계로 순위를 만들지 않는다.
- 두 calibration 모두 실패했으므로 실제 5~10 fixture full matrix는 **실행하지 않았다**. C06은 OPEN이며 V0.6C Jev 연구·구현은 시작하지 않았다. 다음 판단은 실패 계약과 oracle 적합성을 별도 조사할지 여부이며, 현 결과를 덮어쓰거나 자동 재시도하지 않는다.
- T3의 Project-scoped **Provider fitness · Read-only**에서 이 두 실제 record를 읽고 비교했다. `NOT COMPARABLE / fixtures differs`, false completion 0/1, tokens 15,771/6,391, latency 34,191/8,594 ms, cost/transport UNKNOWN을 실제 화면에서 확인했다. 연결을 닫고 다시 열어도 평가를 실행하지 않으며 수동 Read history로 같은 record를 다시 조회했다. T3에는 list/compare만 있고 full detail은 CLI show를 사용한다.

현재 로컬 검증·게시 SHA·exact CI 결과는 WORK_LOG의 후속 기록과 최종 전달을 따른다. 위 actual record의 harness SHA는 후속 문서/UI commit과 구분하여 보존한다.

## 11. 공개 재현 manifest와 raw comparison

다음은 위 **기존 actual record가 사용한 `weavra-fitness-1`** manifest다. 2026-09-20 후속 확인에서 read-only CLI `fitness list`, `targets`, `compare`로 다시 읽었다. 새 actual 실행이나 실패 record의 재작성은 하지 않았다.

| Fixture | Category | Fixture digest (`sha256:` 뒤 전체 hex) |
|---|---|---|
| F01 | Read-only investigation | `7959c21fc10ddc1812e94b56ffdc67913721e4bd52871928c13f90052cf9cd1e` |
| F02 | Small strict edit | `acc03bd4615dedb83df9628d080d809235e1a5ab9c6edff384361f68633386b1` |
| F03 | Multi-file bounded edit | `86cc68acd26b496cb9bf617060e415d070a5cad16a36f25aaf977b4d73cc0439` |
| F04 | Reviewed bugfix recipe | `49a66f98d89bdf3c27833ccb6e55b7ee93bca43a686f7e96bf2295172536faf1` |
| F05 | Context discovery | `59d74af6f24f2add0503c1cdac1e862b8082462c123cc011b0d0a65e0490237f` |
| F06 | Independent review negative | `f57a7830ec6b5e32ef3847c13b003bd5bf85085f321f59e1f313462ebbcc3629` |
| F07 | One fresh bounded repair | `afdf31d12bc3896ad0004a0d585901e2fcf3d011ef0b7adbda64134d9fc1ad5b` |
| F08 | Active-stream cancellation | `56b15cd06b59a423e6a1dc6e97258bb52675260233222455a8e9e2d579f39486` |
| F09 | Exact-version reviewed docs | `86b8d67415e1b3dbe4f4d285beb438d4c119d086ab6d1a067f4d2db2d3909973` |
| F10 | Negative authority | `318912a3bd43605f5009aff016c005d6c7c5e7de97c2f2dc173da8af3a217fe4` |

현재 fixture language는 JavaScript다. language/goal/files/check/contract/oracle/digest를 분리한 manifest이며 Java/Spring·SQL·Python 실제 fixture는 아직 없다. 실행 순서는 F01–F07, F09, F10, F08이다. 각 fixture 상한은 worker 4 / reported tokens 100,000 / worker timeout 180,000 ms이며 actual calibration의 전체 상한은 10절과 같다.

기존 actual 공통 고정값:

- harness: `c94d5ddc4871a66943abebebe437f460fa119e99`
- tool schema: `sha256:0375b1881ee51c6ee700b0c7fd0e57d33bb1d55b74644f8b38ccd521695776e9`
- prompt/runtime: `sha256:b0ea9fdffc38374a46acfe06a975bf335521eb4ff5b63058d170c272d0ebf3fd`
- target configuration: `sha256:c4b7c18bfd2a8725893732010ad8ef80900b6bdc49044303bf96d1db5972c1bf`
- environment: `darwin / arm64 / Node v26.7.0`. T3 regression의 Node 24와 구분한다.

| Actual fixture | Task Contract digest | Registered check digest |
|---|---|---|
| F01, 두 target 공통 | `sha256:1f90b8d5e25ae486e6f99e8a5a1375077b0d74db9fa0102a281d32d0c9dead17` | `sha256:2b03570126ff8b532dd21bc3249342705e59b45616928f15a56b7dfc2948d10a` |
| F02, Astra만 실행 | `sha256:a9ae7949990f7cc0e0aeffb2d3180b8924d7127f3035b8c8c53ad79de3a57dbc` | `sha256:979121a425f17fa964c044da9647c9eaac8725bf69c49f4c17acefe680ce45bc` |

### 서로 다른 실행 prefix의 raw 관측

**NOT COMPARABLE**이다. 아래 값은 보존된 두 실패 calibration의 독립 합계이지 동일 5~10 fixture matrix, 성공률 추정, winner 선정이 아니다.

| Dimension / observation | Astra | CommandCode DeepSeek |
|---|---:|---:|
| Executed fixtures | F01, F02 | F01 |
| Oracle PASS / FAIL / INVALID | 1 / 1 / 0 | 0 / 1 / 0 |
| False completion | 0 | 1 |
| AC met / not-met | F01 1/0; F02 UNKNOWN | F01 1/0 |
| Checks passed / failed | 4 / 0 | 2 / 0 |
| Recorded Task Contract adherence | F01 true; F02 false | F01 true |
| Scope violations | 0 | 0 |
| Forbidden mutation attempts | 0 | 0 |
| Strict receipt / handoff / review rejections | 0 / 0 / 0 | 0 / 0 / 0 |
| Tool calls / invalid calls / tool retries | 6 / 0 / 0 | 3 / 0 / 0 |
| runtime_read / runtime_edit / runtime_write / LSP | 2 / 1 / 0 / 0 | 1 / 0 / 0 / 0 |
| Provider / auth errors / timeouts | 0 / 0 / 0 | 0 / 0 / 0 |
| Transport errors / HTTP attempts | UNKNOWN / UNKNOWN | UNKNOWN / UNKNOWN |
| Repair / Reviewer revision count | 0 / 0 | 0 / 0 |
| Cancellation | NOT_REQUESTED | NOT_REQUESTED |
| Cleanup | 2 CONFIRMED | 1 CONFIRMED |
| Worker invocations / model turns | 2 / 6 | 1 / 2 |
| Reported input / output / total tokens | 7,241 / 594 / 15,771 | 2,867 / 964 / 6,391 |
| Usage state | KNOWN | KNOWN |
| Fixture latency sum | 34,191 ms | 8,594 ms |
| Context bytes | 2,462 | 1,289 |
| Cost | UNKNOWN | UNKNOWN |

input/output/total은 provider 필드를 그대로 집계한 값이며 cache 포함 방식 때문에 input+output=total을 강제하지 않는다. tool retries=0은 HTTP retry=0을 뜻하지 않는다. actual cancel·F03–F10은 미실행이고 active-stream cancel/repair/review/authority proof는 faux와 deterministic regression에 한정된다. corpus digest가 같아도 executed prefix·harness·budget·configuration 등 비교 조건이 달라지면 같은 cohort로 승격하지 않는다.

## 12. 후속 재감사 — corpus v2와 historical v1 분리

2026-09-20 후속 재감사에서 실제 SDK faux로 다음 두 결함을 재현했다. 수정 전 14개 중 2개 회귀가 실패했고 수정 후 14개가 통과했다.

1. F03의 요구된 수정을 모두 수행한 뒤 `src/unrelated.mjs`를 추가하고 이를 handoff에 정확히 포함해도 Runtime COMPLETED·checks 2 PASS·독립 Reviewer PASS·Host oracle PASS였다. Host oracle은 이제 실제 workspace의 파일 집합을 frozen baseline과 대조한다. Runtime 소유 `.ai`/`.git` 이외의 예상하지 않은 파일·symlink 등은 거부한다. 같은 재현은 이제 oracle FAIL·falseCompletion=true이며, 허용 경로 안의 잘못된 변경이므로 scope violation=0과 구분한다.
2. 첫 model turn의 usage는 양수이고 다음 실패 turn은 SDK의 미보고 초기값 0일 때, 기존 worker 합계 기반 보정은 전체를 KNOWN으로 판단해 다음 fixture를 시작했다. 공통 `WorkerMeasurementAccumulator`가 각 turn의 필수 usage 누락·0 초기값을 incomplete로 표시하도록 수정했다. 양수인 관측 subtotal은 유지하지만 전체 input/output/total은 UNKNOWN이며 다음 budget admission을 차단한다. 이 보수적 completeness 판정은 일반 Runtime measurement에도 적용된다. 실제 upstream가 명시한 0과 SDK 초기값 0은 현재 메시지 계약만으로 구별할 수 없다.

현재 corpus는 **`weavra-fitness-2`**, digest는 **`sha256:352795e95dc5175247eefaff89c73ca3b7768c6acf8f27e4dd2623f2bf0763b1`**다. §11의 열 개 fixture body/digest는 모두 동일하고, revision·Host oracle source 변경으로 corpus digest가 달라졌다. goal·AC·expected bytes·calibration 판정 기준을 실패에 맞춰 완화하지 않았다. v1 actual의 사용량·판정·result digest는 재작성하지 않으며 새 v2 결과로 승계하지 않는다.

현재 소스의 실제 CLI + required verifier sandbox faux proof:

| Behavior | Run ID | 관측 |
|---|---|---|
| GOOD | `247f60ce-8581-4a5b-b9a6-bc40d7f5a6e6` | F01–F10 oracle PASS, F06 BLOCKED, F07 1회 repair, F08 active-stream CANCELLED, 모두 cleanup CONFIRMED |
| CONTRACT_VIOLATOR | `09c4fd63-0ec6-4ba4-ad03-5c073ce5588a` | F02 FAILED/oracle FAIL, forbidden attempt 1·실제 scope violation 0 |
| UNRELIABLE | `f7dab93a-fdde-494b-8263-badeb309eac5` | F01 FAILED/oracle INVALID/usage UNKNOWN, BUDGET_EXHAUSTED, F02 미호출 |

위 faux 기록은 private `~/.weavra/fitness/c06-faux-v2-20260920`에 보존한다. 소스 수정 중 수행한 FAUX이므로 harnessRevision은 당시 HEAD `6d52cdd1f4815f2b5d15cc63afa1b3909a1b3918`이고 promptRuntimeRevision은 working source digest `sha256:c36750e2abfe173e8b17192fe9f77307744fed0ba1f71f750552424bfe527e5b`다. 이를 clean committed ACTUAL proof로 표현하지 않는다.

추가 검증은 populated v1 record의 고정 JSON을 현재 store가 읽고 실패 판정·UNKNOWN·원본 bytes를 보존하는 회귀, 동일 planned corpus라도 executed prefix가 다르면 비교 불가인 회귀, corpus의 잘못된 budget/out-of-scope expected mutation 거부다. SDK malformed submission·mutation 후 실패·취소 race는 기존 `company-runtime-hardening` 및 관련 Runtime 회귀가 담당한다. 모든 경계를 별도의 Fitness 전용 테스트로 새로 작성했다고 주장하지 않는다.

격리 HOME의 잘못된 auth fixture를 둔 상태에서도 실제 CLI `list/show/compare` 3개가 통과했다. paid opt-in 누락, 과거 corpus digest 확인, read-only에 execution flag 전달, duplicate flag 4개는 평가 store 생성 없이 거부했다. `targets`는 이 auth-free 검증에 포함하지 않는다. 현재 v2 actual 호출은 **0회**다. 두 v1 actual calibration 실패에 따른 확대 중단은 유지하며 **C06 OPEN / V0.6C 착수 불가**다.

## 13. v2 actual 재검증 전 gate 보강

사용자의 새 actual 허가에 따라 `e5b38fce440d9f6906727f570419ef1baef76e67` clean devlop에서 다시 시작했다. 기존 SDK 14개와 records/measurement 47개 targeted regression은 통과했다. 이어 전체 corpus가 아닌 동일 calibration subset도 비교 가능하게 표시하던 조건을 재현(1 FAIL / 13 PASS)하고 전체 F01–F10 조건으로 보강했다. Calibration의 단일 oracle/usage 조건도 위 §9의 전체 admission 조건과 일치시켰다.

Cache/reasoning detail은 이미 SDK에서 normalize되므로 실제 raw zero의 provenance를 추정하지 않는다. 새 nullable optional 필드는 과거 v1/v2 result bytes를 바꾸지 않으며 T3의 list/compare summary에는 추가 필드를 내보내지 않는다. Source 변경 후 targeted records/measurement 50개·SDK 14개, check/hydrate/offline build/check:ci, launcher syntax/diff whitespace, 전체 `bash ./test.sh`(209.30초; coding-agent 2,766 PASS·50 skipped, Runtime 1,429 PASS, evals 35 PASS)가 통과했다.

Fixture goal/AC/body/oracle와 corpus `weavra-fitness-2` digest는 그대로다. 변경되는 harness와 prompt/runtime revision은 새 actual cohort에 고정한다. 두 target은 같은 F01→F02, 각각 fixtures 2 / worker calls 4 / reported tokens 100,000, required sandbox로 1회만 실행한다. 두 target 모두 gate를 통과하기 전에는 F03–F10을 호출하지 않는다. C06 CLOSED 이전에는 V0.6C를 시작하지 않는다.

## 14. 새 허가에 따른 v2 actual calibration — C06 OPEN

2026-09-20 21:04–21:05 Asia/Seoul에 두 target의 F01→F02 calibration을 각각 **한 번** 실행했다. Actual harness는 clean committed `97ce0a2c69cbd6605011fbe34a54b07c9ec11d29`이고 [exact CI 35509228483](https://github.com/kjg8619/pi/actions/runs/35509228483)의 head SHA 일치·completed/success를 먼저 확인했다. 이 보강 commit과 actual evidence 문서 commit을 분리한다. v1 actual 기록은 이번 판정에 재사용하지 않는다.

### 14.1 고정 identity·정책·예산

- Corpus: `weavra-fitness-2` / `sha256:352795e95dc5175247eefaff89c73ca3b7768c6acf8f27e4dd2623f2bf0763b1`. Fixture 10개 digest는 §11의 inventory와 동일하며 goal/AC/body/oracle를 actual 실패에 맞춰 바꾸지 않았다.
- Harness: `97ce0a2c69cbd6605011fbe34a54b07c9ec11d29`.
- Tool schema: `sha256:0375b1881ee51c6ee700b0c7fd0e57d33bb1d55b74644f8b38ccd521695776e9`.
- Prompt/runtime: `sha256:b00f8769eab4d21056b8ed2b7484688183a7f79f3f26a48d25568d95321091aa`.
- Shared configuration: `sha256:c4b7c18bfd2a8725893732010ad8ef80900b6bdc49044303bf96d1db5972c1bf`.
- 두 target 모두 SDK default/clamped/mapped thinking=`medium`, reasoning capability=true, sampling override 없음. reasoning/map/compat/sampling policy digest는 `sha256:3a619424382d31b2a999ce9fd1d20e6629e60635afe281f70b1dd61f160a8939`다. 매 actual 실행 전에 같은 ModelRuntime instance의 public identity와 정책 digest를 frozen descriptor와 대조했다. 실제 upstream effective reasoning은 **UNKNOWN**이며 SDK 설정과 혼동하지 않는다.
- Session retry=false, provider maxRetries=0, compaction disabled, 일반 revision cycle=0. Gateway 내부 retry와 HTTP attempts는 UNKNOWN이다. F07의 명시적인 한 번 repair는 이번 actual에서는 실행되지 않았다.
- 각 calibration의 동일 budget: fixtures 2 / worker invocations 4 / reported tokens 100,000. 각 fixture는 corpus의 workers 4 / tokens 100,000 / timeout 180,000ms와 required sandbox를 유지했다. Cost는 UNKNOWN이며 token admission은 진행 중 응답의 hard billing cap이 아니다.
- 실제 환경: darwin/arm64, Pi Node `v26.7.0`. T3 read-only 화면 검증은 Node `24.19.0`과 별도 빈 T3 home/DB를 사용했다. 기존 auth/models/사용자 DB와 raw endpoint는 바꾸거나 공개하지 않았다.

| Target | Provider / model | Adapter | Endpoint identity |
|---|---|---|---|
| Astra | `codex-lb/gpt-6-astra` | `openai-responses` | `sha256:5ed82577e56de9393ae4e36bdafbb1af3a13dd2a1ebcb2933b79aa8251e70e65` |
| CommandCode | `commandcode/deepseek/deepseek-v4.1-flash` | `openai-completions` | `sha256:54098f3495c573bb3398e9d9c3f11e3493dbbdb631366891b5b113b3b2b7b2d2` |

### 14.2 실제 실행 범위와 중단

| Fixture | Astra actual | CommandCode actual |
|---|---|---|
| F01 | COMPLETED / oracle PASS | COMPLETED / oracle FAIL / falseCompletion=true |
| F02 | BLOCKED / oracle FAIL / Task Contract adherence=false | NOT RUN — F01 calibration gate |
| F03 | NOT RUN — calibration gate | NOT RUN — calibration gate |
| F04 | NOT RUN — calibration gate | NOT RUN — calibration gate |
| F05 | NOT RUN — calibration gate | NOT RUN — calibration gate |
| F06 | NOT RUN — calibration gate | NOT RUN — calibration gate |
| F07 | NOT RUN — calibration gate | NOT RUN — calibration gate |
| F08 | NOT RUN — calibration gate | NOT RUN — calibration gate |
| F09 | NOT RUN — calibration gate | NOT RUN — calibration gate |
| F10 | NOT RUN — calibration gate | NOT RUN — calibration gate |

두 collection 모두 `CALIBRATION_FAILED`다. 총 actual fixture 3개, worker invocation 3회, model turn 8회이고 HTTP call 수로 바꿔 표현하지 않는다. Diagnostic/retry/fallback은 **0회**다. F03–F10이나 F01/F02 재실행으로 결과를 구제하지 않았다.

- Astra record: `1bbf3173-66da-47e3-9574-c8b58a5efcaa`; result digest `sha256:88e21081d1c6bcfd411763826ddea2fca667e061ab4fbd0b98c5dacc0860f4a6`.
- CommandCode record: `3da1a33c-e8b7-41fa-b82d-f202059286ac`; result digest `sha256:4875e55e24e3c5ed345c45e4ca03df3cf1fce9f957c3f44818b20ba8cd7242d5`.
- 두 기록은 기존 project-private Fitness store에 0600으로 보존했다. Astra file SHA-256 `8e05e58f197917f41f96bafeb322aded0a17c069b653da4c4685d3765fb38ea1`, CommandCode `f3e863fc18bdd8aab845a52fbbd7e056a17e7333b394a452979e92fbd2a7e89d`. 이는 schema의 canonical result digest와 다른 원본 파일 byte hash다.
- CLI list/show/compare와 T3 조회 뒤 새 v2 2개 및 기존 v1 2개의 byte hash·0600 permissions가 유지됐다. 기존 v1의 byte hash는 LOG-112 그대로다.

### 14.3 원시 관측값과 실패 분류

각 열의 관측 수는 **n=1**이다. 평균·백분위·winner·종합 점수나 일반 모델 능력으로 확대하지 않는다.

| Dimension | Astra F01 | Astra F02 | CommandCode F01 |
|---|---:|---:|---:|
| Runtime terminal | COMPLETED | BLOCKED | COMPLETED |
| Oracle | PASS | FAIL | FAIL |
| False completion | false | false | true |
| AC met / notMet | 1 / 0 | UNKNOWN / UNKNOWN | 1 / 0 |
| Checks passed / failed / notRun | 2 / 0 / 0 | 2 / 0 / 0 | 2 / 0 / 0 |
| Task Contract adherence | true | false | true |
| Scope / forbidden mutations | 0 / 0 | 0 / 0 | 0 / 0 |
| Strict receipt / handoff / review rejections | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| Tools / invalid / retries | 2 / 0 / 0 | 4 / 0 / 0 | 3 / 0 / 0 |
| runtimeRead / runtimeEdit / runtimeWrite / LSP | 1 / 0 / 0 / 0 | 1 / 1 / 0 / 0 | 1 / 0 / 0 / 0 |
| Workers / model turns | 1 / 2 | 1 / 4 | 1 / 2 |
| Provider / auth errors / timeouts | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| Transport errors / HTTP attempts | UNKNOWN / UNKNOWN | UNKNOWN / UNKNOWN | UNKNOWN / UNKNOWN |
| Repair / reviewer revision | 0 / 0 | 0 / 0 | 0 / 0 |
| Cancellation | NOT_REQUESTED | NOT_REQUESTED | NOT_REQUESTED |
| Cleanup | CONFIRMED | CONFIRMED | CONFIRMED |
| Usage state | KNOWN | KNOWN | KNOWN |
| Input | 2,146 | 3,340 | 2,313 |
| Output | 230 | 381 | 1,275 |
| Total / knownTotal | 4,168 / 4,168 | 11,657 / 11,657 | 6,916 / 6,916 |
| Cache read | 1,792 | 7,936 | 3,328 |
| Cache write | UNKNOWN | UNKNOWN | UNKNOWN |
| Reasoning | UNKNOWN | UNKNOWN | 332 |
| Context bytes | 1,289 | 1,173 | 1,289 |
| Fixture latency ms | 13,486 | 20,134 | 10,667 |
| Cost USD | UNKNOWN | UNKNOWN | UNKNOWN |

Usage detail source는 모두 `SDK_NORMALIZED`다. 양수 cache/reasoning은 관측값이고 raw upstream detail completeness의 증명이 아니다. Reasoning을 output/total에 재가산하지 않는다. 전체 reported total은 Astra 15,825 / CommandCode 6,916 / 합계 22,741이며 서로 다른 실행 prefix의 비용·속도 비교로 해석하지 않는다.

- **Astra F02: CONTRACT_ADHERENCE.** 관측된 근거는 BLOCKED, Task Contract adherence=false, AC completion evidence UNKNOWN이다. Source 수정·checks PASS·tool 오류 0만으로 frozen Task Contract 충족을 대신하지 않는다. 실패의 정확한 모델 문구/내부 원인은 미보관이므로 UNKNOWN이며 모델 능력 문제로 단정하지 않는다.
- **CommandCode F01: UNKNOWN (frozen oracle mismatch).** Runtime COMPLETED와 AC/checks PASS 뒤에도 외부 oracle FAIL·falseCompletion=true다. F01의 고정 summary fact predicate를 충족하지 못한 판정은 유지한다. 원문 summary를 보존하지 않았으므로 잘못된 의미인지, 누락인지, 표현 차이인지 구분할 수 없고 MODEL_SEMANTIC으로 확정하지 않는다.
- AUTH/PROVIDER 오류·timeout은 관측되지 않았고 invalid tool calls=0이다. 별도 TOOL_SCHEMA/TOOL_SEMANTICS 원인을 추정하지 않는다. Oracle 결과는 INVALID가 아니며 usage/cleanup도 UNKNOWN이 아니다. 실제 실패를 HARNESS_DEFECT로 분류할 결정적 재현 근거는 없으므로 oracle/contract를 완화하거나 추가 actual 진단을 하지 않았다.

### 14.4 비교·실제 T3 surface

CLI comparison은 `comparable=false`, compatibility는 corpus/budget/harness/configuration/kind=true, **fixtures=false**다. 동일 target별 calibration조차 전체 F01–F10을 실행하지 않았고 두 prefix도 다르다. `CALIBRATION_FAILED` 기록을 full matrix로 승격하지 않는다.

T3 `d4a858cbb6fdd195173d593feb8fbb979bf2b998`는 무변경이다. 기존 Settings → Pi project scope → Project → Provider fitness에서 새 actual v2 2개와 과거 actual v1 2개를 함께 읽고 revision별로 구분했다. 두 새 ID를 선택하여 **NOT COMPARABLE / fixtures differs**, exact provider/model/adapter/endpoint hash/harness/tool/runtime/config identity, executed 2/1·oracle 1/1 대 0/1·false completion 0/1, tokens 15,825/6,916·raw latency 33,620/10,667ms·cost/transport UNKNOWN을 실제 Chromium 화면으로 확인했다.

`T3_WEAVRA_CONTROL=0`, 새 임시 home/DB, 기존 private Weavra history만 사용했다. UI에는 평가 실행 경로가 없고 chat turn·workflow 실행·model 호출을 시작하지 않았다. Pairing token은 출력하지 않았고 owned browser/service는 종료했다. Cache/reasoning detail은 기존 summary UI의 필드가 아니므로 CLI show/위 표에서 확인하며 UI가 표시했다고 주장하지 않는다. 이번 T3 full/static/build는 source 무변경이라 재실행하지 않았고 LOG-109~110의 같은 SHA 결과는 과거 proof로 구분한다.

**판정: C06 OPEN.** Full actual matrix 수집 자체의 실패가 아니라 그 선행 calibration gate가 실패했다. F03–F10, actual controlled rejection/repair/cancellation/docs/policy 판정은 미실행이다. V0.6C/Jev 조사·구현·browser authority 확장은 시작하지 않으며 root/Runtime README를 CLOSED로 갱신하지 않는다.

### 14.5 이번 작업의 최종 검증과 제한

- Actual 전 clean `97ce0a2c6`에서 records/measurement 50개와 SDK Fitness 14개를 재실행해 모두 PASS했다. CLI faux GOOD `4a989fbd-ba5e-4c2e-87e7-c57ea23cfe80`은 10 oracle PASS, CONTRACT_VIOLATOR `23772054-1134-487e-a0f5-35010ff8c75e`는 forbidden attempt 1·scope change 0·F02 FAIL, UNRELIABLE `9365574f-48fc-4306-b6fc-87a8808a6738`는 UNKNOWN 이후 F02 미호출이다. Invalid auth JSON을 둔 별도 HOME에서도 CLI list/show/compare 3개 PASS, 위험한 invocation 4개는 store 생성 전 거부, cost-bound `6d4a6f43-a2da-43c2-9f03-61cf20e6e0aa`는 fixture 0개에서 BUDGET_EXHAUSTED였다.
- Actual 후 첫 검증은 여러 무거운 test process를 중복 실행했다. Runtime은 **1,429 PASS**였지만 SDK subset은 **4 FAIL / 524 PASS**(Fitness 30초 timeout, check-pause 관찰 3건), standalone evals는 **1 FAIL / 34 PASS**(context A/B 5초 timeout), 전체 Pi는 **2 FAIL**(agent taskkill fixture의 NaN pid, SDK Fitness timeout)였다. 이 실패를 숨기지 않는다. 중복 실행 부하의 영향은 [INFERENCE]이며 source 결함을 해결했다고 주장하지 않는다.
- Owned T3 dev service/browser를 종료하고 test processes를 겹치지 않게 직렬화했다. **동일 source·같은 timeout·skip·assertion**으로 SDK Weavra **16 files / 528 PASS**(Fitness 14개 포함), evals **8 files / 35 PASS**, records/measurement **3 files / 50 PASS**, 전체 `bash ./test.sh` **exit 0**을 확인했다. 전체 실행에서 coding-agent **2,766 PASS / 50 skipped**, Runtime **1,429 PASS**, evals **35 PASS**이고 scripts/consumer smoke·나머지 workspace도 PASS다.
- 같은 직렬 gate에서 hydrate:model-data, `npm run check`, `npm run check:ci`, shrinkwrap check, coding-agent install-lock check, launcher `bash -n`, diff whitespace가 모두 PASS였다. Biome 1,463 files·no fixes다. 직렬 validation 전체는 **287.36초**다. 테스트 삭제·timeout 증가·skip 추가·실제 Provider 재시도는 없었다.
- Post-actual faux도 별도로 직렬 실행했다(**15.29초**, 실제 Provider 0회): GOOD `5e57c9cb-4c95-427e-a821-dde46b2b628f`는 10 oracle PASS·expected F06 BLOCKED/F08 CANCELLED, CONTRACT_VIOLATOR `da69157f-ad23-4618-9e06-fea0d7633573`는 F02 FAIL·forbidden attempt 1·scope change 0, UNRELIABLE `9ebf6413-bdde-4541-8d2a-8a33b61cc258`는 F01 UNKNOWN/INVALID 후 BUDGET_EXHAUSTED·F02 미호출이다. 모두 cleanup CONFIRMED다. 전후 faux와 cost-stop record는 `~/.weavra/fitness/c06-v2-preactual-20260920`에 보존한다.
- Root/Runtime README, T3 source, dependency/lockfile, auth/models, main/tag는 의도적으로 무변경이다. Source 보강의 exact CI와 evidence 문서의 최종 exact HEAD CI를 구분하며, 문서 게시 뒤 후자의 SHA·conclusion은 최종 전달에서 확인한다.

## 15. 독립 F01/F02 audit와 v3 결정

### 15.1 독립성·역사적 freeze

두 read-only audit은 실제 모델 결과·summary를 주지 않고 먼저 goal, AC, Task Contract, 지침, SDK/Kernel 경로, 등록 check와 외부 oracle을 검사했다. 이후 역사적 record와 대조했다. 새 실제 Provider 호출은 아직 0회다.

| 역사적 corpus / target | Run ID | 원본 JSON SHA-256 |
|---|---|---|
| v1 / Astra | `d8ac6441-ad5f-48a8-b598-ff7e32f622d7` | `db322fb8c4aae65380fa4a897b7363c79c32533870f1ca54b02e95fdf9a9e3a0` |
| v1 / CommandCode | `8b90b143-dc28-449f-9dc3-74c902ef4b80` | `df42fc5552ab2ea2dc007072cdcc3f3338d13170abab41a7b979fa6fc6b00f06` |
| v2 / Astra | `1bbf3173-66da-47e3-9574-c8b58a5efcaa` | `8e05e58f197917f41f96bafeb322aded0a17c069b653da4c4685d3765fb38ea1` |
| v2 / CommandCode | `3da1a33c-e8b7-41fa-b82d-f202059286ac` | `f3e863fc18bdd8aab845a52fbbd7e056a17e7333b394a452979e92fbd2a7e89d` |

이번 audit에서 네 원본의 hash가 위 값과 같음을 다시 확인했다. v2 공통 harness·corpus·tool·runtime prompt·config·endpoint/result digests와 실제 usage는 §14에 보존한다. 추가로 v2 F01/F02의 contract/check identity는 다음과 같다(모두 SHA-256).

| Fixture | Fixture digest | Task Contract digest | Check source digest | Fixture config digest |
|---|---|---|---|---|
| F01 | `7959c21fc10ddc1812e94b56ffdc67913721e4bd52871928c13f90052cf9cd1e` | `e35dd4865953f928d613ed18c1fbfef93962a7fd003325521d91bbfa2be921a7` | `2b03570126ff8b532dd21bc3249342705e59b45616928f15a56b7dfc2948d10a` | `6a8974d6955c768b833272ed690e394d155377b564e2239a70f3d1c7f30154fa` |
| F02 | `acc03bd4615dedb83df9628d080d809235e1a5ab9c6edff384361f68633386b1` | `b2d2077a7a737847a5ad2f52e938631445583d030dfd0a3ef829ec7a49edd321` | `979121a425f17fa964c044da9647c9eaac8725bf69c49f4c17acefe680ce45bc` | `ef37a84aeb0ce08fd7ec7fec0ce7aeb7ef70276c510b23949620aa813dd91c9d` |

### 15.2 F01: 과제 의미와 oracle을 분리

의도는 `classify(0)`의 결과와 strict `value > 0` 경계의 인과 설명이며 R0 조사·무변경 과제다. v2는 literal 표현을 지침에 공개했지만 summary에서만 검사한다는 위치 제약이 명확하지 않았다. 등록 check는 파일 무변경만 검사하므로 그것의 PASS가 설명의 의미적 정답을 뜻하지 않는다.

원본 v2 oracle source SHA-256 `7e80afe72058f8e37c78f3a20324b72490db227f9b1f3a013736ae2e251b1b3b`에 대해 실제 Provider 없이 다음 반례를 실행했다. Synthetic canonical 상태를 사용하는 oracle 단위 재현이며 실제 SDK 완료 proof라고 주장하지 않는다.

| Candidate | Summary | 올바른 판정 | v2 oracle |
|---|---|---|---|
| 정답 | `classify(0)=non-positive because value > 0 is false at zero.` | PASS | PASS |
| 동등 표현 | `classify(0)=non-positive: the condition accepts values above zero, not zero itself.` | PASS | FAIL |
| 잘못된 경계 | `classify(0)=non-positive because the strict condition is value > 1.` | FAIL | PASS |
| 잘못된 원인 | `classify(0)=non-positive because the greater-than-or-equal condition value >= 0 is false at zero.` | FAIL | PASS |
| 잘못된 결론 | `classify(0)=non-positive is a false claim; the actual result is positive. strict` | FAIL | PASS |
| 키워드 삽입 | `Keywords: classify(0)=non-positive strict. This is an unrelated weather forecast.` | FAIL | PASS |

판정은 **ORACLE_UNDERCONSTRAINED**와 표현 과제약·출력 위치 ambiguity다. Regex에 동의어를 늘려도 부정·인과·경계를 판정할 수 없다. LLM judge를 기본 oracle로 넣지 않는다.

v3는 기존 `submit_handoff.summary` **문자열 안의 제한된 JSON**을 명시적으로 요구한다.

```json
{"classificationAtZero":"non-positive","cause":{"operator":">","boundary":0}}
```

Goal/AC/지침에 같은 위치·의미·shape·2048자 제한을 공개했다. Key 순서, 공백, `0e0` 같은 수치 표현은 자유지만 누락/추가/중복 key, prose/fence, 잘못된 type/range는 거부한다. Parser는 값·정확한 operator/boundary 관계를 검사하며 keyword 존재로 PASS하지 않는다. 기존 R0, source 무변경, Task/AC identity, Kernel/check 권한은 유지한다. **의미는 같아도 출력 표현/위치 계약은 바뀌므로 corpus v3**다. F10의 같은 조사도 동일 계약으로 이행했다. 새 Runtime tool은 없다.

판정은 **VALID_AFTER_ORACLE_FIX — 명시적인 versioned representation change 포함**이다. 이것은 old record를 PASS로 재분류할 근거가 아니다.

### 15.3 DeepSeek v2 F01: D / INSUFFICIENT_EVIDENCE

관측된 사실은 Runtime COMPLETED, frozen v2 oracle FAIL, falseCompletion=true, AC 1 MET, checks 2 PASS, cleanup CONFIRMED다. 원문 제출/설명과 최종 workspace bytes는 in-memory session·cleanup 정책 때문에 record에 남지 않았다. Digest로 문장을 복원할 수 없다.

따라서 A(실제 의미 오류), B(정답인데 표현 차이), C(누락/불충분 설명)를 구별할 수 없으며 **D: INSUFFICIENT_EVIDENCE / UNKNOWN**이다. 독립적으로 oracle 결함은 입증했지만 과거 DeepSeek의 정답 여부는 입증하지 못했다. 과거 결과/digest는 그대로 둔다.

### 15.4 F02: VALID exact-byte 과제와 harness 결함

Goal, AC, fixture 지침, strict write 범위와 등록 check가 모두 같은 exact-byte 수정에 정렬돼 있다. QUICK/EDIT/R1은 실제로 도달 가능하며 잘못된 routing 자체는 발견하지 못했다. 이는 일반 리팩터링 품질 과제가 아니라 명시적인 byte replacement 계약이다.

별개로 두 harness 결함을 확인했다.

- QUICK 완료 경로는 Task Contract digest guard보다 먼저 return했다. Guard를 QUICK 분기 앞으로 이동했고 R0/R1 모두 missing/changed digest가 거부되는 회귀가 수정 전 2 FAIL, 수정 후 PASS다.
- 공통 Worker 지침은 아직 수행되지 않은 Runtime checks를 `known_risks`에 쓰도록 유도했지만 R1 완료에는 empty known_risks가 필요했다. 실제 미해결 위험과 Kernel-owned 후속 검사 상태를 구별하도록 지침을 고쳤다. Genuine risk를 숨기거나 완료 gate를 완화하지 않는다.

Missing target는 검증 가능한 FAIL인데 INVALID로 처리하던 경로, baseline file 부재/후처리 오류가 canonical Run을 지우던 경로, local adapter abort를 user CANCELLED로 분류하던 경로도 바로잡았다. Terminal acceptance가 없다는 사실만으로 Task Contract adherence=false로 단정하지 않는다.

실제 SDK 경계 회귀에서 정확한 bytes는 PASS; 그럴듯하지만 틀린 bytes와 부분 수정은 FAIL; unrelated/private mutation은 차단; wrong task/AC identity는 거부했다. 마지막 네 차단 사례는 SDK usage가 UNKNOWN으로 끝나므로 capability 실패와 별개로 후속 budget admission을 중단한다. 정확한 파일과 genuine known_risks로 BLOCKED되는 경우는 usage KNOWN/integrity READY이며 다음 fixture로 진행함을 별도로 확인했다.

F02 과제는 **VALID**, 수정 전 공통 guard/guidance는 **HARNESS_DEFECT**, 수정 후 경로는 **VALID_AFTER_ORACLE_FIX**다. 임의 narrative/tests_run의 진실까지 자동 검증한다고 주장하지 않는다.

### 15.5 Astra v2 F02: 정확한 원인 UNKNOWN

관측은 BLOCKED/oracle FAIL, checks 2 PASS, read 1/edit 1, invalid call/submission rejection 0, usage KNOWN, cleanup CONFIRMED다. 제출의 task/criteria/known_risks, 차단 phase, final bytes·각 check diff snapshot은 보존되지 않았다.

**LOG-113 및 §14의 CONTRACT_ADHERENCE 실패 분류는 과도했다.** 당시 `taskContractAdherence=false`는 terminal acceptance 부재에서도 만들어졌다. 이것만으로 wrong task/AC, 실제 코드 오류, genuine risk, pending-check 서술, guard 순서 중 무엇이 원인이었는지 확정할 수 없다. 새 SDK 재현은 guidance 결함의 가능 경로를 입증할 뿐 과거 Astra 원인을 입증하지 않는다. 역사적 record는 수정하지 않고 이 후속 정정으로 **정확한 원인 UNKNOWN**을 남긴다.

### 15.6 Calibration, collection, capability의 독립 상태

| 상태 | 의미 |
|---|---|
| CALIBRATION_READY | F01/F02를 안전하고 일관되게 관측했다. 모델 정답/완료 인증이 아니다 |
| CALIBRATION_INVALID | F01/F02에서 protocol/측정/oracle/transport/auth/cleanup/budget 안전성 결함을 관측했다 |
| EVALUATION_PARTIAL | 완전한 동일 cohort의 10개 실행을 확보하지 못했다 |
| EVALUATION_COMPLETE | canonical 10개 capability 결과를 수집했다. FAIL/falseCompletion이 있어도 유지한다 |
| UNKNOWN | 해당 사실이 관측/보존되지 않았다. 0·PASS·추정값으로 채우지 않는다 |

Semantic FAIL, known contract FAIL, expected BLOCKED와 falseCompletion은 capability 결과로 먼저 immutable prefix에 저장하고 다음 fixture를 허용한다. Integrity/budget stop은 역시 저장한 뒤 중단한다. 기존 Task Contract/Risk/Policy/strict freshness/trust/sandbox/reviewer 권한은 그대로다. 마지막 통제 F08의 usage 누락은 complete coverage와 별개인 UNKNOWN이며 추가 invocation을 허용하지 않는다.

새 schema v2의 bounded audit는 final file 존재/bytes hash, unexpected-path set hash, protected 상태, task digest 일치 여부, 제출 종류/digest, 허용 AC 상태, known-risk/unresolved 개수, phase, Reviewer 결과, check/diff/registration digests를 남긴다. 자유 서술/비밀은 저장하지 않는다. 새로운 근거를 과거 record에 합성하지 않는다.

### 15.7 Pre-actual gate와 closure 조건

v3 oracle **18 PASS**, QUICK+record **96 PASS**, SDK Fitness **24 PASS**다. 첫 SDK 통합 실행에서 Runtime의 bare digest와 Fitness의 `sha256:` 형식 불일치를 발견해 정규화했고, 후속 실행의 file-state 기대값 및 실제 UNKNOWN usage assertions를 바로잡았다. 추가로 full prefix 뒤 collection HARNESS_DEFECT를 COMPLETE로 승격하던 경계를 수정 전 FAIL·수정 후 records **25 PASS**로 확인했다. 최종 pre-actual Pi 전체 `bash ./test.sh`와 check/check:ci/lock/launcher gates는 **215.72초·exit 0**이다. Runtime **1,440 PASS**, coding-agent **2,776 PASS / 50 skipped**, evals **53 PASS**다. 이 결과를 actual Provider 또는 historical 실패 원인으로 해석하지 않는다.

새 actual은 동일 v3 cohort에서 Astra와 CommandCode 각각 fresh full 1회, 최대 fixtures 10 / worker calls 32 / reported tokens 500,000, 기존 default medium과 retry/fallback 없음으로 고정한다. 이미 준비된 인증만 사용하며 source/target/digests를 호출 직전에 다시 대조한다. Semantic/contract FAIL이더라도 integrity READY이면 F03 이후를 계속 수집한다. Integrity fault가 생기면 prefix를 보존하고 중단하며 같은 표본을 구제하려고 재시도하지 않는다.

**C06 CLOSED는 두 모델의 전부 PASS가 아니라 신뢰 가능한 완전한 actual matrix 수집·read-only 비교·실제 T3 관찰·최종 검증/게시**로 판단한다. Partial만 남으면 C06 OPEN이며 V0.6C/Jev 연구와 첫 slice는 시작하지 않는다. 과거 partial v1/v2를 새 full로 합치거나 승격하지 않는다.

### 15.8 Pre-actual CLI·T3 proof

- Required sandbox CLI GOOD `7835675f-901a-4e81-befc-515f9e4368f5`는 10 oracle PASS, FALSE_COMPLETER `6caa206c-d317-412b-b97a-3351588540a8`는 9 PASS/1 FAIL·F06 falseCompletion=true를 보존했다. 둘 다 CALIBRATION_READY/EVALUATION_COMPLETE이고 마지막 F08 usage UNKNOWN으로 BUDGET_EXHAUSTED다. 같은 full 조건에서 **comparable=true**이며 실패를 지우지 않았다.
- F02 CONTRACT_VIOLATOR `c329626a-dcbd-45d0-b5ab-9d3acb2679f1`는 FAILED/FAIL, forbidden attempt 1·scope change 0·usage UNKNOWN이다. UNRELIABLE `59ae6654-333f-470a-b603-fff9d90306d2`는 F01 provider error/INVALID/UNKNOWN 후 중단했다. Full/partial은 NOT COMPARABLE이다. 처음 CLI driver가 CONTRACT_VIOLATOR를 full로 호출한 `daee2feb-7c26-45c3-818b-724f4f1e7d0b`도 보존했다. 이 모델은 R0 F01에서 없는 write tool을 호출해 protocol/UNKNOWN stop이 맞았으며, driver의 F02 도달 가정을 고쳐 별도 F02 probe를 실행했다.
- Invalid-auth 별도 HOME에서도 list/show/compare가 성공했고 historical v1/v2 네 파일의 bytes/hash와 schemaVersion 1을 그대로 유지했다. Unsafe invocation 4개는 store 생성 전 거부했다. Cost-bound `39c649e1-8230-4a32-9824-96b7dea7fb4e`는 fixture/worker 0에서 중단했다. 모든 faux 기록은 private namespace `c06-v3-preactual-20260920`에 남긴다.
- T3 Node **24.19.0**의 첫 전체 실행은 **50 FAIL**이었다. 제가 설정한 `/tmp` alias와 `/private/tmp` canonical 경로 불일치가 trace에 나타났다. 같은 source/assertion/timeout/skip에서 격리 HOME/TMPDIR만 canonical 경로로 바꾼 전체 재실행은 **1,270 files / 17,269 PASS / 58 skipped**다. Typecheck/lint/fmt/knip/build도 exit 0이며 기존의 다른 파일 Effect suggestions·React/desktop build warnings는 남아 있다. 변경한 세 T3 파일의 diagnostics는 없었다.
- 새 T3 home/DB, control=0, production build, managed Chromium으로 **실제 Pi CLI → T3 backend → Project Settings UI**를 확인했다. Secret-free historical/faux JSON만 별도 Weavra home에 byte copy했으며 실제 record 원본은 수정하지 않았다. FAUX 표시, 실패 F06/falseCompletion=true, F02 contract FAIL, integrity READY/INVALID, usage UNKNOWN, partial/full, full pair MATCHED CONDITIONS와 partial/full NOT COMPARABLE을 실제 화면과 DOM으로 확인했다. Fitness의 버튼은 Read history/Compare records뿐이며 chat turn·workflow/model 호출은 시작하지 않았다.
- Browser 도구가 임시 일회성 pairing URL fragment를 자동 출력한 문제는 도구 QA에 보고했다. 영구 credential은 출력하지 않았고 owned browser/service를 종료했으며 pairing 파일을 삭제했다. 과거 v2 재현·agent contract 임시 파일도 제거했다. Actual driver·최종 검증용 자료는 다음 단계에 필요해 유지한다.
- 여기까지 새 actual Provider 호출은 **0회**다. 두 repo의 정상 devlop source 게시와 Pi exact HEAD CI를 다음 gate로 요구한다. T3 CI는 main push/PR-only라 devlop exact SHA 미실행 여부를 별도로 확인하며 PASS로 대체하지 않는다.

## 16. Fresh v3 actual full collection

### 16.1 호출 전 동결과 게시

- Pi source `b2b938aa2b890ec482265638fe882ad1e3bebb32`를 정상 devlop commit/push하고 [exact CI 35515316545](https://github.com/kjg8619/pi/actions/runs/35515316545)의 success를 확인한 뒤에만 호출했다. Local/tracking/actual remote SHA가 같고 worktree가 clean이었다.
- T3 source는 `6cced3c7f4b9f87f475b9ce8e362a93d11e8b7d2`다. Exact SHA workflow runs/checks는 각각 0건이다. Main push/PR-only trigger이므로 **NOT RUN**, 로컬 PASS를 remote PASS로 바꾸지 않는다.
- Corpus는 `weavra-fitness-3`, digest `sha256:91b78f62a4e16101efb8f3a1cef55cd0aab9309d1f7d8e98b6a3a9d457511566`이다. 순서는 **F01,F02,F03,F04,F05,F06,F07,F09,F10,F08**이며 cancellation을 마지막에 둔다.
- Target은 기존 `codex-lb/gpt-6-astra/openai-responses`와 `commandcode/deepseek/deepseek-v4.1-flash/openai-completions`다. Endpoint identity는 각각 `sha256:5ed82577e56de9393ae4e36bdafbb1af3a13dd2a1ebcb2933b79aa8251e70e65`, `sha256:54098f3495c573bb3398e9d9c3f11e3493dbbdb631366891b5b113b3b2b7b2d2`로 유지했다.
- Tool schema `sha256:0375b1881ee51c6ee700b0c7fd0e57d33bb1d55b74644f8b38ccd521695776e9`, prompt/runtime `sha256:4de005b6916d56a18d4037f9855905fb68d293302cbb1e876200649b9d26910c`, configuration `sha256:c4b7c18bfd2a8725893732010ad8ef80900b6bdc49044303bf96d1db5972c1bf`다.
- 두 target의 default/clamped/mapped thinking은 모두 `medium`, sampling override 없음, model-policy digest `sha256:8c2ddbc283a959881841e60e58b077c0a7b5db1dc67adae537cc139ebba90a40`이다. **Upstream effective thinking은 UNKNOWN**이며 동일하다고 주장하지 않는다.
- Target별 budget은 fixtures 10 / worker invocations 32 / reported tokens 500,000, required sandbox다. Fresh cohort를 각각 한 번만 실행했고 fixture 재실행·SDK automatic retry·fallback은 비활성화했다. 기존 credential은 허용된 env-file 방식으로만 로드했으며 credential/auth/model 설정은 읽어 출력하거나 변경하지 않았다.
- 전체 동결 manifest는 private `~/.weavra/fitness/c06-v3-actual-20260920.manifest.json`에 보존한다. Exclusive `.once` marker와 canonical actual record도 유지한다. Historical 결과를 새 record로 합치지 않았다.

### 16.2 Immutable actual records와 raw 결과

| Target | Record ID | Result digest |
| --- | --- | --- |
| Astra | `c032d3ec-05cb-42d0-bafe-827c19a31003` | `sha256:ec7bc202464d9573a7d6df3e73d6ee4b7045692283deb3673fd150eb4824842b` |
| CommandCode DeepSeek | `04b72270-eea6-48c2-9362-4aa57285799c` | `sha256:8ed81b0bd44aa9115ca80f5029f62d9e2373bd73d4e1732c1f7115ab157f7945` |

두 record 모두 **BUDGET_EXHAUSTED / CALIBRATION_READY / EVALUATION_COMPLETE**, stop reason `USAGE_UNKNOWN`이다. F01/F02 integrity가 READY여서 나머지를 허용했고 마지막 F08의 예상 취소 뒤에는 추가 invocation을 하지 않았다. 20개 fixture 모두 cleanup CONFIRMED, protocol error 0, harnessError false다.

아래 PASS는 fixture의 기대된 동작을 만족한다는 뜻이다. F06의 BLOCKED나 F08의 CANCELLED를 정상 과제 완료로 바꾸지 않는다. 표는 번호순이며 실제 실행 순서는 16.1에 고정한 순서다.

| Fixture | Astra terminal / oracle | Astra ms | Astra known tokens | DeepSeek terminal / oracle | DeepSeek ms | DeepSeek known tokens |
| --- | --- | ---: | ---: | --- | ---: | ---: |
| F01 | COMPLETED / PASS | 13,216 | 4,349 | COMPLETED / PASS | 10,151 | 9,693 |
| F02 | COMPLETED / PASS | 21,355 | 11,843 | COMPLETED / PASS | 13,267 | 22,377 |
| F03 | COMPLETED / PASS | 58,128 | 27,816 | COMPLETED / PASS | 29,265 | 66,279 |
| F04 | COMPLETED / PASS | 43,667 | 20,513 | COMPLETED / PASS | 19,745 | 33,537 |
| F05 | COMPLETED / PASS | 38,086 | 19,867 | COMPLETED / PASS | 25,648 | 44,549 |
| F06 | BLOCKED / PASS | 40,388 | 20,509 | BLOCKED / PASS | 43,415 | 48,560 |
| F07 | COMPLETED / PASS | 55,575 | 33,677 | COMPLETED / PASS | 35,713 | 64,177 |
| F08 | CANCELLED / PASS | 3,554 | UNKNOWN | CANCELLED / PASS | 1,729 | UNKNOWN |
| F09 | COMPLETED / PASS | 34,827 | 20,278 | COMPLETED / PASS | 18,094 | 33,138 |
| F10 | COMPLETED / PASS | 11,894 | 4,397 | COMPLETED / PASS | 7,257 | 6,553 |

- 두 F01의 bounded parsed answer는 `classificationAtZero=non-positive`, `cause.operator=>`, `cause.boundary=0`이다. 두 F02는 COMPLETE, AC-001 MET, check 2 PASS, task digest/changed files 일치, known risks/unresolved 0으로 관측됐다. 이것은 과거 v2 실패의 원인을 소급 증명하지 않는다.
- Actual oracle FAIL 0, falseCompletion 0이다. 실패를 숨겨서 얻은 수치는 아니다. F06은 둘 다 REVIEW / Reviewer REVISE / BLOCKED / taskContractAdherence=false를 보존했고 다음 F07로 계속했다.
- Strict receipt rejection은 Astra F03 1건, DeepSeek F03 2건·F07 1건이다. Scope violation, forbidden mutation attempt, handoff/review rejection은 둘 다 0이다. F07의 통제 repair는 각각 1회이고 F06의 REVISE 관측도 각각 1회다.
- `tools.retries` 1/3은 rejected receipt 뒤 같은 tool을 모델이 다시 호출한 **동일 fixture 내부 관측**이다. Fixture/cohort 재실행이나 SDK 자동 transport retry가 아니다. HTTP attempts 자체는 UNKNOWN으로 유지한다.
- F08은 두 target 모두 integrity INVALID의 유일한 이유가 USAGE_UNKNOWN이다. 예상 cancellation·oracle PASS·cleanup CONFIRMED·마지막 fixture라는 사전 정의에 따라 **coverage만 COMPLETE**이며 전체 청구/usage가 확정된 것은 아니다.

| Raw dimension | Astra | DeepSeek |
| --- | ---: | ---: |
| Worker invocations / model turns | 17 / 51 | 17 / 66 |
| Tool calls / invalid calls / observed tool retries | 55 / 1 / 1 | 85 / 3 / 3 |
| Known token subtotal | 163,249 | 328,863 |
| Known input / output / cache-read subtotal | 72,479 / 6,034 / 84,736 | 70,954 / 27,765 / 230,144 |
| Reported reasoning subtotal | UNKNOWN | 12,689 |
| Sum of raw fixture latency (ms) | 320,690 | 204,284 |
| Record wall time (ms) | 320,828 | 204,411 |
| Total tokens / cost / HTTP attempts | UNKNOWN | UNKNOWN |

Reasoning은 output과 중복될 수 있어 total에 다시 더하지 않는다. Cache-write, transport-error count, upstream backend identity도 UNKNOWN이다. 한 표본의 raw latency/usage이며 종합 점수·winner·성능 순위·일반 오류율로 해석하지 않는다.

### 16.3 비교·T3·최종 로컬 회귀

- Canonical read-only compare는 corpus/budget/harness/configuration/fixtures/kind가 모두 일치해 **comparable=true**다. Historical v1/v2 partial과 새 full은 결합하거나 comparable로 승격하지 않는다.
- 같은 T3 production build의 격리 home/DB에 두 actual record를 byte copy하고 실제 CLI → backend → browser에서 MATCHED CONDITIONS, 두 full/calibration READY, F06 BLOCKED/adherence=false, F08 INVALID/USAGE_UNKNOWN, strict receipt 1/3, total/cost UNKNOWN과 known subtotal을 확인했다. 버튼은 Read history/Compare records뿐이며 UI가 새 평가나 chat turn을 시작하지 않았다.
- 첫 actual UI copy는 도구 기본 mode 0644 때문에 기존 private-record guard가 fail-closed했다. **소유한 복사본만 0600으로 바로잡아** 다시 읽었고 source guard·원본 bytes는 변경하지 않았다. 새 pairing URL을 만들거나 출력하지 않고 기존 격리 session을 사용했다. 확인 후 owned browser/server를 종료했다.
- Actual 이후 targeted QUICK/records **96 PASS**, SDK Fitness **24 PASS**, oracle **18 PASS**다. Oracle 첫 명령은 eval 전용 기본 config를 골라 “No test files found”였으며 기존 `vitest.test.config.ts`를 명시한 실행이 18 PASS다. 테스트를 생략하거나 완화하지 않았다.
- Actual 이후 fresh CLI faux를 다시 실행했다. GOOD `8c5bb665-195e-4d91-ac7b-f0be6789f89b` 10 PASS와 FALSE_COMPLETER `94aec730-ab23-4f91-91fa-cc173113bad7` 9 PASS/1 FAIL·falseCompletion=true는 full/comparable다. CONTRACT_VIOLATOR `b0c9a9db-6904-47cf-9774-e4b72c21c901`, UNRELIABLE `e160220e-4070-4753-8d13-c8dc52c987a5`는 partial이고 cost stop `b70e0e14-4e2d-41fd-878a-3a2910005b26`은 0 invocation이다. Historical 네 파일 hash 불변, readonly invalid-auth, unsafe argv 4건 거부도 다시 확인했다. 이 faux 검증 자체의 actual 호출은 0회다.
- 최종 Pi 전체 chain은 **218.37초·exit 0**이다: `npm run check && bash ./test.sh && npm run check:ci && npm run check:shrinkwrap && npm run check:install-lock:coding-agent && bash -n packages/company-runtime/bin/weavra`. Runtime **54 files / 1,440 PASS**, coding-agent **282 files / 2,776 PASS / 50 skipped**, evals **9 files / 53 PASS**, 나머지 workspace/scripts/consumer smoke도 PASS다. Biome 1,464 files/no fixes, TS/browser/dependency/lock gates PASS다.
- T3 source는 15.8의 **17,269 PASS / 58 skipped**, targeted 54 PASS, typecheck/lint/fmt/knip/build 이후 변경하지 않았다. 기존 무관한 warnings와 exact SHA remote CI NOT RUN은 그대로다.

### 16.4 Closure publication gate

**C06 CLOSED — 2026-09-20 23:46 Asia/Seoul.** Evidence commit `d67ce3968d83df5961a9facd5211a8a4d59cfd3a`를 정상 devlop에 게시하고 [exact CI 35517110397](https://github.com/kjg8619/pi/actions/runs/35517110397)의 success를 확인했다. Corpus/oracle audit, full actual 수집, 실패/UNKNOWN 보존 정책, read-only 비교/UI, 최종 로컬 회귀와 게시 gate를 모두 충족했다. **전부 PASS와 closure를 동치로 정의하지 않는다.** Actual source는 앞서 CI를 통과한 `b2b938aa2b890ec482265638fe882ad1e3bebb32`로 고정돼 있다. Actual 재시도 없이 C08/Jev 연구·첫 read-only slice에 진입하며, C08의 완료는 별도 proof로 판단한다.
