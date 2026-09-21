# 작업 이력

Personal AI Runtime의 작업 내용과 검증 결과를 누적 기록한다. 설계 근거는 [DECISIONS](DECISIONS.md), 단계별 범위는 [IMPLEMENTATION_PLAN](IMPLEMENTATION_PLAN.md)을 기준으로 한다. 이 문서는 릴리스 Changelog나 Runtime이 저장할 `.ai` 실행 로그가 아니다.

## 기록 규칙

- 개발·조사·문서 작업이 끝나거나 중단될 때마다 항목을 추가한다. 개별 도구 호출을 모두 기록하지는 않는다.
- 기록일과 시간대, 단계·상태, 목적, 변경 파일, 검증 명령·결과, 문제와 해결, 남은 제한, 다음 작업, 커밋 여부를 남긴다.
- 미실행 검증을 통과로 표시하지 않는다. 테스트 개수는 해당 작업 당시 결과이며 전체 저장소 테스트 수가 아니다.
- 기존 항목은 보존한다. 후속 변경이나 정정은 새 항목에서 이전 기록을 참조한다.
- 인증 정보, 비밀 값, 전체 대화·도구 출력은 복사하지 않는다.

## 현재 요약

| 단계 | 상태 | 확인된 결과 |
|---|---|---|
| Phase 0 | 완료 | Pi 구조 조사와 설계 문서 3종 |
| S0 | 완료 | 계약·설정·Extension 골격, 테스트 62개 통과 |
| S1 | 완료 | Host 독립 순차 Kernel, S0 포함 테스트 133개 통과 |
| S2 | 완료 | 파일 StateStore·lock·실행 전 Policy, S0/S1 포함 테스트 244개 통과 |
| S3 | 완료 | 독립 SDK 역할·Policy·참조·취소, faux 통합 47개 및 metadata 5개 추가 |
| S4 | 완료 | 실제 Git/check·STANDARD 통합·명령/lifecycle, 자동 367개 및 실제 Pi faux smoke 통과 |
| S5A | 완료 | QUICK Executor·공통 검증/정책/상태, 자동 446개 및 QUICK Pi faux smoke 통과 |
| S5B | 완료 | bound STANDARD/R2 파일 실행·독립 리뷰 강제, 자동 522개 및 R2 Pi faux smoke 통과 |
| S5C | 완료 | 단일 tracked 텍스트 파일 삭제의 1회 Human Approval, 자동 608개 및 실제 승인/거절/Esc/만료 smoke 통과 |
| S5D | 완료 | 읽기 전용 관찰·명시적 결정/check export·revision 설정 연결, 자동 655개 및 실제 명령 smoke 통과 |
| S6 | 완료 | cleanup/lease·race/crash/freshness 실패 경계 보강, targeted 740개 + 기존 Pi 59개 및 interactive 실패 smoke 통과 |
| RC-01 후속 수정 | 완료 / 실제 GPT 최종 PASS | R0 finding 보존·무변경 COMPLETE. 당시 targeted 829개 결과는 아래 이력에 보존 |
| RC-04 후속 수정 | 완료 / 실제 GPT 최종 PASS | R2 mandatory Reviewer·두 checks·COMPLETED. 실제 ref 오류 후 재제출의 개별 trace는 미수집; 당시 targeted 847개 |
| RC-04 timeout 후속 수정 | 완료 / 실제 설정·지연 미수집 | 공통 worker timeout 설정과 취소/lease 보호, 이후 GPT RC-04 정상 완료. 특정 예산의 충분성은 별도; 당시 targeted 876개 |
| RC-04 handoff 후속 수정 | 완료 / 실제 GPT 최종 PASS | unresolved 없음·독립 review·checks·COMPLETED, 기존 Kernel guard 유지; 당시 targeted 901개 |
| RC-05 R3 prompt 수정 | 완료 / 실제 GPT 최종 PASS | 승인 UI·Deny/Expire 무삭제·Approve once 단일 삭제 확인; 당시 targeted 909개 |
| GPT Real-Provider RC / V0.1 Closure | 완료 / 소스 RC 기준점 유지 | 실제 GPT RC-01~08 PASS. LOG-020 당시 HEAD `dc6d3df65`의 targeted 30개 파일·909개 및 root check PASS |
| Weavra Branding + Launcher UX | 완료 / 커밋·푸시 | `632ad3bcd`로 게시. 당시 31개 파일·931개 및 root check PASS; RC 태그 불변 |
| Weavra Status Projection | 완료 / 커밋·푸시 | `2205dec84`로 게시. 당시 공식 setStatus·stale/실패 격리, 33개 파일·975개 및 실제 TUI smoke PASS |
| Fork-local Weavra Launcher | 완료 / 기존 커밋 확인 | `14c3f6992`에 반영. global Pi 의존 제거, 같은 checkout의 built CLI 고정. LOG-025 자동 33개 파일·982개 PASS. 사용자 정상 실행 보고는 LOG-026 참조 |
| Weavra Worktree Launcher V1 | 완료 / 커밋·푸시 | `965240041`에 반영. create-only·frozen HEAD·외부 경로·충돌/dirty 거부·자동 정리 없음. LOG-028 당시 34개 파일·1,040개 PASS |
| Weavra Worktree Open/List | 완료 / 커밋·푸시 | `add45781d`에 반영. Git 등록 기반 open-only/list·dirty 허용·Pi argv 전달. LOG-030 당시 34개 파일·1,098개 PASS |
| V0.2A Read-only DAG Projection | 완료 / 커밋·푸시 | `b40c016d3`에 반영. 순수 DTO/ASCII·attempt·R3 detail·UNKNOWN. LOG-032 당시 36개 파일·1,168개 PASS |
| V0.2B Read-only TUI DAG Viewer | 완료 / 커밋·푸시 | `0834683bd`에 반영. 정적 overlay·navigation/close. LOG-034 당시 38개 파일·1,231개 및 실제 TUI smoke PASS |
| V0.2C Product Isolation / Setup / Doctor | 완료 / 커밋 확인 | `e7f37f777`에 반영. `~/.weavra/agent`·child env 격리·명시적 import·read-only doctor. LOG-037 자동 42개 파일·1,402개 및 임시 HOME의 실제 launcher/TUI smoke PASS |
| V0.3A Hash-Anchored Edit | 완료 / 코드·evidence 게시 | 구현 `473256de6`, evidence `e09100fe3`. LOG-039 자동 44개 파일·1,470개 PASS. LOG-041 실제 `codex-lb/gpt-6-astra` duplicate-second·stale 거부 2건 PASS |
| V0.3B Read-only LSP | 완료 / 게시 | `a3eae0c86`에 반영. LOG-043 자동 47개 파일·1,565개 및 실제 TS/Provider smoke PASS |
| V0.3C Trust Baseline | 완료 / 게시 | `08c04daf1`에 반영. LOG-046 Node26 49개 파일·1,646개, Node22/macOS 18개 파일·800개 PASS |
| V0.3D Project Context | 구현·자동 회귀 게시(`6da0c5ce5`); Provider acceptance FAILED | LOG-048 자동 Node26 1,738개/Node22 308개 PASS. Attempt 1 dot-root DENY. LOG-050 Attempt 2는 narrowed list→anchored edit→독립 review/checks→COMPLETED이나 요청한 path omission 미충족 |
| CommandCode/DeepSeek Worker Validation | 완료 / 커밋·푸시 | `6c86bd5d6`로 게시. `~/.weavra/agent/models.json`에 commandcode custom provider 추가. STANDARD/EDIT 5회 중 1회 COMPLETED, QUICK/R0 3회 미완료, codex-lb/GPT 교차 1회 COMPLETED. LOG-053·[smoke 문서](WEAVRA_COMMANDCODE_DEEPSEEK_SMOKE_2026-09-18.md) |
| Provider Compatibility Hardening | 구현·자동 회귀 PASS / 실제 smoke 완료 / 게시 `72561d4f3` | LOG-055·LOG-056. identity mismatch를 consumable 정정으로, Executor `unresolved` 의미·configured instruction 보호 안내 추가. 자동 51개 파일·1,717개 PASS. DeepSeek QUICK 1/3·STANDARD 2/3 COMPLETED(provider 오류 3회 별도), GPT 교차 1/1 COMPLETED |
| V0.3E Task Contract | 구현·자동 회귀·실제 smoke 완료 / 게시 `5bc7f8a43` | LOG-057·LOG-058. Host-confirmed Acceptance Criteria(AC-001…)·Plan Preview·frozen digest·AC 완료 guard. 자동 45개 파일·1,575개 PASS. DeepSeek STANDARD/EDIT + GPT 교차 각 1회 COMPLETED(2 AC MET). R2/R3·미충족 AC의 live smoke는 NOT VERIFIED |
| V0.3F Measurement & Evidence | 구현·자동 회귀·실제 smoke 완료 / 게시 `b6267e233` | LOG-059. worker별 usage/latency/tool 측정, optional budget(호출 수 사전 차단·token fail-closed), provenance snapshot, `/state evidence` Evidence Pack, evals adapter+fixture 6개. 자동 51개 파일·1,624개 PASS. DeepSeek 1차 provider 실패 후 재시도 COMPLETED, GPT 교차 COMPLETED |
| V0.3F Final Micro Hardening | 구현·자동 회귀 PASS / 게시 `c95993b9f` | LOG-062. result 반환 직후 cancellation에서도 소비 measurement 보존(implement/review 동일 경계), telemetry adapter 반환값이 실행 결과를 바꾸지 못하게 격리. 자동 53개 파일·1,640개 PASS. 선행 LOG-061 Measurement Hardening: 실패 invocation measurement·budget settlement의 durable 기록(성공·실패·REVISE·BLOCK·후속 검증 실패 전 경로 exactly-once), telemetry exactly-once 격리, `weavra.worker` start attr의 requested provider/model, eval adapter faux E2E(Provider 0회). 자동 53개 파일·1,636개 PASS |
| V0.4A Strict Mutation | 구현·자동 회귀 PASS / 게시 `bb909a59b` | LOG-064. opt-in `mutation.mode`(기본 compatible)·read receipt(최신 1개, mutation 후 무효화)·strict `runtime_edit`(legacy fallback 없음)·`runtime_write` create/replace 분리(O_EXCL create, fresh receipt replace, fallback 없음). 자동 53개 파일·1,668개 PASS. DeepSeek strict smoke에서 stale→re-read→재시도 성공을 확인했으나 fixture check 실패로 COMPLETED는 미확인 |
| V0.4A Strict Mutation Closure | 구현·자동 회귀 PASS / DeepSeek strict actual COMPLETED / 게시 `5c15317c9` | LOG-065. read-time filesystem identity binding(같은 read snapshot에서 capture)·deletion/재생성 typed stale(ENOENT만 변환)·strict create/replace NUL·lossy text 거부. 자동 53개 파일·1,676개 PASS. DeepSeek `standard-2ac` strict smoke: Helo→Heelo 주입 1회 → STALE_ANCHOR → 재-read → fresh receipt로 edit 성공 → checks PASS×2 → 독립 Reviewer PASS → **COMPLETED**(37,829 tokens) |
| V0.4B Verifier Trust | 구현·자동 회귀 PASS / DeepSeek strict trust VERIFIED / smoke COMPLETED 미확인 / 게시 `b41843e68` | LOG-066. opt-in `verification.trust.mode`(기본 compatible)·`checks[].trust.files`, registration digest·executable identity·source digest+generation freeze, pre/post process + settle 재검증, Worker protected source, Kernel `trustRequired` guard, bounded trust evidence. 자동 53개 파일·1,689개 PASS. DeepSeek strict run에서 self-check `PASS`+`VERIFIED (strict)`, Reviewer protected-read Policy DENY로 FAILED |
| V0.4B Verifier Trust Closure | 구현·자동 회귀 PASS / DeepSeek strict-trust run **COMPLETED** / 게시 `96b1d8366` | LOG-067. registration digest가 실제 filtered env(canonical)를 bind, executableDigest는 real SHA-256 identity digest, digest schema 강화(`^sha256:[0-9a-f]{64}$`), Kernel이 Host-frozen registration digest까지 비교(wrong/malformed VERIFIED 거부), Reviewer/Worker protected-oracle 비열람 guidance. 자동 53개 파일·1,696개 PASS. DeepSeek: self-check·test `PASS`+`VERIFIED` 동일 digest, Reviewer PASS(독립)·oracle 직접 접근 0회, oraclePass true, 22,515 tokens |
| V0.4C Verifier Sandbox | 구현·자동 회귀 PASS / macOS actual PASS / **Linux actual NOT VERIFIED** / remote CI PASS / DeepSeek strict+trust+sandbox **COMPLETED** / 게시 `acfbac0fd`·문서 `aa43b9f9f` | LOG-069·LOG-070. `verification.sandbox.mode`(기본 disabled), SRT 0.0.76 exact pin, SandboxPort(argv·canonical path·0600 temp settings), fixed deny-all network + workspace write allow + oracle/protected read·write deny, Host-frozen `sandboxPolicyDigest` + Kernel guard. 자동 54개 파일·1,710 PASS(경계 테스트는 backend 동작 플랫폼에서만 실행) |
| V0.5A Task Context Pack | CLOSED | LOG-071; bounded context actual COMPLETED, historical regression·CI PASS |
| V0.5B Task Recipes | CLOSED | LOG-075~080; actual COMPLETED/oraclePass true, full local PASS, closure HEAD `a5023eb98` CI `35441610636` success |

S0~S6와 제한된 GPT RC-01~08 Closure 이후 Branding, Status Projection, fork-local launcher를 완료했다. 실제 GPT 판정은 [GPT_RC_VALIDATION_2026-09-16.md](GPT_RC_VALIDATION_2026-09-16.md)의 사용자 수동 evidence다. Branding은 `632ad3bcd`, Status Projection은 `2205dec84`, fork-local launcher는 commit `14c3f6992`에 반영되어 있다. 각각의 당시 검증은 LOG-021~027에 보존한다.

현재 상태는 다음과 같다. 상세 history는 각 LOG와 [V0.3D smoke 문서](WEAVRA_V03D_PROVIDER_SMOKE_2026-09-17.md)에 그대로 보존한다.

- V0.3A Hash-Anchored Edit, V0.3B Read-only LSP, V0.3C Trust Baseline, V0.3D Project Context는 완료다. V0.3D의 역사적 판정은 소급 수정하지 않는다(Attempt 1 `path:"."` DENY/FAILED·무변경, LOG-050 Attempt 2는 narrowed list→anchored edit→독립 review/checks→COMPLETED이나 요청한 path omission은 NOT VERIFIED, default-root `{}` 후속 evidence 포함).
- Provider Compatibility Hardening(LOG-055·LOG-056), V0.3E Task Contract(LOG-057·LOG-058), V0.3F Measurement & Evidence(LOG-059), V0.3F Measurement Hardening(LOG-061), V0.3F Final Micro Hardening(LOG-062)까지 완료·게시했다. V0.3F는 LOG-062로 종료한다.
- V0.4A Strict Mutation(LOG-064)은 opt-in strict freshness/precondition contract로 게시했고, LOG-065에서 deletion/재생성 stale·read-time identity binding·NUL 거부를 닫았다. strict actual smoke는 `standard-2ac`/DeepSeek에서 **COMPLETED**(stale→re-read→retry→checks PASS→독립 Reviewer PASS→oracle PASS)까지 확인했다. V0.4A는 LOG-065로 종료한다.
- V0.4B Verifier Trust(LOG-066 구현 + LOG-067 closure)는 opt-in strict registration/source freeze, env-bound registration digest, real executable identity digest, pre/post process 재검증, Worker protected source, Kernel의 Host-frozen digest guard, Reviewer oracle 비열람 guidance, bounded trust evidence를 구현·자동 회귀 검증했다. 실제 DeepSeek strict-trust run이 **COMPLETED**했고 self-check/test가 같은 registration digest로 `VERIFIED`를 기록했다. V0.4B는 LOG-067로 종료한다.
- V0.4C Verifier Sandbox(LOG-069 구현 + LOG-070 closure)는 option 3 기준으로 CLOSED다: macOS actual PASS, Linux actual **NOT VERIFIED**(runner 외부 blocker 2건 — 명시), deterministic cross-platform contract PASS, remote CI PASS(전체 run success), DeepSeek strict+trust+sandbox actual **COMPLETED**.
- V0.5A Task Context Pack / Repo Map(LOG-071)는 opt-in `agents.context_pack.mode`(기본 disabled), 48 KiB absolute cap, real LspPort symbols/references, TaskContextAgentExecutor, measurement/evidence/plan projection, leakage·freshness·deterministic A/B 회귀를 구현·검증했고 DeepSeek strict-trust+sandbox actual이 bounded context로 **COMPLETED**했다. V0.5A는 CLOSED다.
- **V0.5A·V0.5B·V0.5C·V0.5D는 현재 bounded 범위에서 CLOSED**다. D의 전체 로컬 회귀·Astra actual 1회·구현 및 별도 closure exact HEAD CI PASS는 LOG-086~093에 보존한다. V0.6A 첫 read-only module은 LOG-094~096, 실제 CLI → T3 backend → read-only frontend와 재연결은 LOG-097~100에서 검증했다. LOG-100 시점에는 두 read-only slice만 완료했고 전체 C07/control은 OPEN이었다.
- **V0.6A/C07과 V0.6B/C06은 bounded 범위에서 CLOSED**다(LOG-101~116). C06은 독립 audit·v3 source `b2b938aa2` exact CI 뒤 두 target의 fresh full을 각각 한 번 수집하고, actual T3·최종 Pi 전체 회귀 뒤 evidence `d67ce3968` exact CI까지 통과했다. 두 record는 각각 10 fixture·CALIBRATION_READY/EVALUATION_COMPLETE·oracle PASS 10·falseCompletion 0이다. F06 BLOCKED·strict receipt 1/3·F08 UNKNOWN usage와 historical v1/v2 bytes/원인 UNKNOWN을 보존한다. Closure는 전부 PASS가 아닌 신뢰 가능한 full collection 기준이다. 이제 C08/Jev 연구와 첫 read-only slice에 진입하며 C08 자체 완료는 별도 검증한다.
- **V0.6C/C08은 local-static browser check의 bounded 범위에서 CLOSED**다(LOG-119~122). 기존 actual Chromium·SDK faux whole workflow·production T3 proof와 Pi source `de66efe2a` [exact CI 35552773990](https://github.com/kjg8619/pi/actions/runs/35552773990)를 보존한다. 기존 closure docs `784644382`의 [exact CI 35553422237](https://github.com/kjg8619/pi/actions/runs/35553422237)도 completed/success다. T3 source `f6ff0ae0f`를 변경하지 않고 최종 closure 요청에 따라 전체/focused tests·typecheck/lint/fmt/knip/build를 새로 실행했다(LOG-122). T3 remote CI는 **NOT RUN**이다. C06 CLOSED와 원본은 유지한다.
- **최종 split-repository migration baseline:** `This is the final split-repository baseline before the planned Weavra repository consolidation.` 향후 `kjg8619/Weavra` 통합을 위한 비교 원본이며 이번 작업은 closure 문서 게시까지만 한다. 기준은 움직일 수 있는 branch 이름이 아니라 최종 보고의 Pi/T3 full commit SHA 쌍이다. 새 C09/V0.6D·architecture refactor·구조 변경·저장소 생성/이관/merge/subtree는 수행하지 않는다.
- 안정 기준: `weavra-v0.1-rc1`은 immutable historical RC baseline이며 이동하지 않는다.
- 아직 NOT VERIFIED: **Linux verifier sandbox actual**(runner 외부 blocker 2건 — V0.4C는 macOS actual PASS로 CLOSED), TUI overlay rendering, V0.4A strict의 R2/R3·QUICK actual smoke, Plain Pi vs Weavra 실제 반복 비교, 20 fixture corpus 확대, R2/R3 measurement/evidence actual Provider smoke, 추가 모델/OS/Node matrix, COMPLEX/parallel, live browser action/MCP/memory, external TOCTOU의 완전 해소(주장하지 않음). 독립 browser Verifier는 LOG-119~120의 bounded local-static/macOS 범위에서 검증했으며 개인 session·다른 OS/browser까지 확대하지 않는다. V0.5C actual은 통제 defect 1회이며 R2/R3 repair·expected-failure TDD·일반 retry/resume는 미지원이다. V0.5D 착수 HEAD는 `1d2a4af96`, 구현 `0d4e91936`의 [CI 35454385916](https://github.com/kjg8619/pi/actions/runs/35454385916) 및 closure `9331b3ed9`의 [CI 35454820292](https://github.com/kjg8619/pi/actions/runs/35454820292)는 success다. V0.6A의 T3 read-only UI는 LOG-097에서 실제 관찰했으나 Host owner liveness/cleanup, 실행 control, 별도 network service/replay는 제공하지 않는다.

2026-09-18부터 개발 하네스를 Pi + `codex-lb/gpt-6-astra`에서 OMP + DeepSeek 4.1로 전환한다. 전환 시점의 저장소·fork-local 환경 확인 결과는 LOG-052에 기록한다. 같은 날 CommandCode Provider API를 custom provider로 구성하고 실제 worker smoke를 수행했으며(LOG-053), 결과는 [smoke 문서](WEAVRA_COMMANDCODE_DEEPSEEK_SMOKE_2026-09-18.md)에 기록한다. DeepSeek 공식 API와 나머지 플랫폼 조합은 NOT VERIFIED다.

이어서 LOG-055에서 structured submission identity mismatch를 같은 worker session에서 정정할 수 있게 하고(거부·무결성 유지, host 자동 교정 없음), QUICK Executor의 `unresolved` 의미와 configured project instruction 보호 안내를 보강했다. before/after는 [smoke 문서](WEAVRA_COMMANDCODE_DEEPSEEK_SMOKE_2026-09-18.md)의 "Provider Compatibility Hardening" 절에 기록한다.

LOG-057에서 V0.3E Task Contract를 구현했다: Host-confirmed Acceptance Criteria(AC-001…)·Plan Preview·frozen task contract digest·AC 기반 완료 guard와 evidence mapping. 실제 Provider smoke는 DeepSeek STANDARD/EDIT 1회와 GPT 교차 1회 모두 COMPLETED(2 AC MET)이며, R2/R3·미충족 AC 부정 경로의 live smoke는 NOT VERIFIED다. 구현·문서는 `5bc7f8a43`로 게시했다(LOG-058).

---

## LOG-001 — Phase 0: Pi 조사와 초기 설계

- **기록일:** 2026-09-15 (KST), 이전 작업 결과 소급 기록. 정확한 작업 시작·종료 시각은 남기지 않았다.
- **상태:** 완료
- **목적:** MASTER_SPEC를 구현하기 전에 Pi 재사용 영역과 Extension/Core 경계를 확인한다.

### 작업 내용

- CLI/SDK/AgentSession, Extension lifecycle·명령·도구·interception, 모델·인증, 리소스 로딩, 세션 저장과 TUI를 조사했다.
- Extension + 별도 Runtime + 역할별 SDK 세션을 권고했다. Core 수정은 제안하지 않았다.
- 첫 Vertical Slice를 STANDARD → Developer → Reviewer → PASS/REVISE → 상태 저장·보고로 한정했다.
- 부모 도구 훅의 보호 범위, 승인과 sandbox의 차이, Pi 세션과 `.ai` 상태의 소유권을 구분했다.

### 변경 문서

- `docs/ARCHITECTURE.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/DECISIONS.md`: ADR-001~010

`docs/MASTER_SPEC_PI_PERSONAL_AI_RUNTIME.md`는 기존 사용자 문서로 유지했다.

### 검증과 제한

- 상대 링크·코드 블록·공백 검사: 통과.
- 코드 구현, 빌드, 테스트, 실제 Provider 추론: 미실행.
- 소스 조사 기준: `devlop`, HEAD `f9bcd351dc3cedf989bc5fc0f8aa012db5737df2`, coding-agent `0.85.1`.
- **다음 작업:** S0 계약·로딩 골격.
- **커밋:** 하지 않음.

## LOG-002 — S0: 계약·설정·Extension 골격

- **기록일:** 2026-09-15 (KST), 이전 작업 결과 소급 기록.
- **상태:** 완료
- **목적:** 실제 Agent 실행 없이 데이터 계약과 Pi 진입점을 검증한다.

### 작업 내용과 파일

`packages/company-runtime/`에 다음을 추가했다.

- `package.json`, `vitest.config.ts`: private workspace 패키지와 테스트 구성.
- `src/contracts.ts`: Run, Task, Handoff, Review, CheckResult, PolicyDecision schema와 타입.
- `src/config.ts`: `.ai/config.yaml` schema, 보수적 기본값, 잘못된 설정·정책 완화 거부.
- `src/extension.ts`: `/team`, `/state`, `/workflow`, `/risk` 읽기 전용 명령 골격.
- `test/contracts.test.ts`, `test/config.test.ts`, `test/extension.test.ts`.
- `README.md`: 로딩 방법, 설정과 미구현 범위.

`package-lock.json`에는 새 workspace 등록을 반영했다. 기존 버전의 TypeBox/YAML/Vitest 등을 재사용했으며 Core·자동 로딩 설정·프로젝트 `.ai` 파일은 수정하거나 생성하지 않았다.

### 검증

패키지 디렉터리에서:

```sh
node ../../node_modules/vitest/dist/cli.js --run test/contracts.test.ts test/config.test.ts test/extension.test.ts
```

- 최종 결과: **3개 파일, 62개 테스트 통과**.
- 실제 Pi public loader로 파일 및 패키지 진입점 로딩 확인.
- 저장소 루트 `npm run check`: 통과.
- 빌드·전체 테스트 suite·실제 Provider 추론: 미실행.

### 문제와 해결

- 초기 `node_modules` 부재: `npm install --ignore-scripts`로 설치했다. lockfile은 `npm install --package-lock-only --ignore-scripts`로 갱신했다.
- Pi 생성 모델 JSON 부재로 로딩 테스트와 타입 검사가 실패했다. 기존 `npm run hydrate:model-data`로 공개 카탈로그 데이터를 준비한 뒤 재검증했다. 모델 생성 소스나 Provider 구현은 수정하지 않았다.
- 설치 시 기존 Vitest 계열에서 중간 위험도 취약점 3건을 확인했다. S0 범위를 벗어나는 일괄 의존성 업데이트는 하지 않았다.

### 남은 범위

- 명령은 상태 안내만 제공한다. run/cancel, Agent 실행, 정책 집행, 파일 상태 저장은 미구현이다.
- **다음 작업:** S1 순수 Kernel.
- **커밋:** 하지 않음.

## LOG-003 — S1: Host 독립 순차 Kernel과 RuntimeEvent

- **기록일:** 2026-09-15 (KST), 직전 작업 결과 소급 기록.
- **상태:** 완료
- **목적:** S0와 STANDARD 범위를 유지하면서 다른 Host와 향후 상태 화면을 위한 경계를 마련한다.

### 설계 보완

- ADR-001~010과 충돌이 없음을 확인하고 기존 결정은 유지했다.
- `docs/DECISIONS.md`: ADR-011 추가. Host 독립 경계와 관찰용 이벤트를 채택했다.
- `docs/ARCHITECTURE.md`: Host Adapter와 AgentExecutor/Pi Agent Adapter 경계, Step 식별과 이벤트 전달 규칙 추가.
- `docs/IMPLEMENTATION_PLAN.md`: S0~S6는 유지하고 S1 범위·완료 결과를 보완했다.

### 구현 파일과 동작

`packages/company-runtime/` 기준:

- `src/classification.ts`: 최소 intent/complexity/risk 규칙과 최소 역할 선택. 불명확한 요청은 확인 대상으로 표시한다.
- `src/kernel.ts`: STANDARD 순차 전이, PASS/REVISE/BLOCK, revision 한도, 완료 guard.
- `src/ports.ts`: AgentExecutor, Verifier, StateStore, ApprovalPort 등의 작은 계약.
- `src/events.ts`: 구조화 RuntimeEvent와 선택적 RuntimeEventSink.
- `src/contracts.ts`: Step 참조, 검증 결과 계약, Run의 `currentStep`·`eventSequence` 추가.
- `test/classification.test.ts`, `test/kernel.test.ts`, `test/host-boundary.test.ts`: 새 unit tests.
- `test/contracts.test.ts`: 추가된 Run 필드에 맞춘 fixture 보완.
- `README.md`: S1 API와 제한 설명 추가.

Step ID는 `implement`, `self-check`, `review`, `test`, `complete`로 고정했다. `(runId, stepId, attempt)`로 재작업의 동일 단계를 구분한다. 상태 저장 후 이벤트를 발행하며, sink 실패는 별도 진단으로 남긴다. 저장 실패는 실행을 중단하고 RunCompleted 발행을 막는다.

S0의 설정과 Extension 명령은 재작성하지 않았다. S1에서 새 dependency나 Core 수정은 추가하지 않았다.

### 검증

패키지 디렉터리에서:

```sh
node ../../node_modules/vitest/dist/cli.js --run test/classification.test.ts test/kernel.test.ts test/host-boundary.test.ts test/contracts.test.ts test/config.test.ts test/extension.test.ts
```

- 최종 결과: **6개 파일, S0 포함 133개 테스트 통과**.
- 검증 항목: STANDARD 전이, PASS/REVISE/BLOCK, invalid transition, revision limit, completion guard, R2 Reviewer 강제, 이벤트 순서, Step ID/attempt 일관성.
- 추가 검증: sink throw/reject, 상태 저장 실패, 객체 사본 격리, 동시 advance 거부, 취소 후 늦은 결과, Host 의존 경계.
- 저장소 루트 `npm run check`: 통과, 최종 실행에서 자동 수정 없음.
- 문서 상대 링크·코드 블록 검사: 통과.
- 빌드·전체 테스트 suite·실제 Pi AgentSession/Provider 실행: 미실행.

### 문제와 해결

- 초기 check의 사용하지 않는 import 경고를 수정했다.
- 테스트의 `Promise.withResolvers`가 저장소 ES2022 타입 설정과 맞지 않아 동일한 동작의 Promise fixture로 변경했다. 이후 테스트·check를 다시 통과했다.

### 남은 범위와 다음 작업

- Port의 실제 파일 저장·정책 구현은 S2, Pi Agent Adapter는 S3, 명령 실행 연결은 S4다.
- ApprovalPort는 계약만 있으며 R3 실행은 계속 차단한다. R2 fake 테스트 통과는 실제 도구 실행 허가가 아니다.
- 이벤트는 관찰용이며 재생·전달 보장·Event Sourcing을 제공하지 않는다.
- DAG scheduler/renderer, 병렬 Agent, RPC 서버, Web UI, T3Code 연동은 추가하지 않았다.
- **다음 작업:** S2 진입 가능. 파일 StateStore·lock과 실행 전 Policy를 구현한다.
- **커밋:** 하지 않음.

## LOG-004 — 작업 이력 기록 규칙 도입

- **기록일:** 2026-09-15 (KST)
- **상태:** 완료
- **목적:** 앞으로 각 작업 결과가 대화에만 남지 않도록 문서로 유지한다.
- **변경:** `docs/WORK_LOG.md` 생성, Phase 0/S0/S1 소급 기록. `AGENTS.md`에 작업 종료·중단 시 이력 갱신 규칙 추가.
- **검증:** 문서 변경만 수행. 링크·형식·diff 확인. 코드 테스트와 `npm run check`는 재실행하지 않았으며 위 S0/S1 결과는 당시 실행 기록이다.
- **제한:** 소급 기록은 이전 대화와 검증 출력 기준이다. 별도 원본 실행 로그나 정확한 단계별 소요 시간은 보관하지 않았다.
- **다음 작업:** S2 진행 시 새 항목을 추가하고 현재 요약을 갱신한다.
- **커밋:** 하지 않음.

---

## LOG-005 — S2: 최소 파일 StateStore와 실행 직전 Policy

- **기록일:** 2026-09-15 14:48 (KST)
- **상태:** 완료
- **목적:** S0/S1과 Host 독립 경계를 유지하면서 실제 Agent 실행 전에 필요한 상태·소유권·정책 안전장치를 구현한다.

### 변경 내용과 파일

`packages/company-runtime/` 기준:

- `src/state-store.ts`: 기존 StateStore Port의 파일 구현, 프로젝트 revision 및 run별 revision 검사, 단일 활성 run, 배타 writer lock, 원자 파일 교체, projection 복구, 중단 판정, 최소 action intent/result 기록, scoped finally 정리.
- `src/policy.ts`: 순수 정책 판단, 등록된 read/search/write/edit와 역할·경로·risk 검사, 실행 전후 audit gate. R2/R3/UNKNOWN은 실행하지 않는다.
- `src/policy-paths.ts`: 순수 Policy와 분리한 파일 시스템 검사 Adapter. symlink·hardlink·workspace 탈출·특수 파일을 거부한다.
- `src/contracts.ts`: PolicyDecision의 예약 결과를 REVIEW_REQUIRED/APPROVAL_REQUIRED로 확정하고 action risk UNKNOWN을 추가했다. Run/분류의 risk와 Step 계약은 유지했다.
- `test/state-store.test.ts`, `test/policy.test.ts`: 실제 임시 파일 시스템, 별도 Node 프로세스 lock 경합, 저장 장애 주입, fake executor 검증.
- `test/host-boundary.test.ts`: 순수 Policy도 기존 Host/I/O import 경계 검사에 포함했다.
- `README.md`: API, 저장 포맷·오류·복구, 안전 한계와 S3 연결 조건을 문서화했다.

`docs/IMPLEMENTATION_PLAN.md`에 S2 결과와 S3 진입 상태를 반영했다. 별도 decisions.md/logs 출력은 S4/S5에 남기고, S2는 state 내부 decision/action ID·최소 상태만 기록하도록 범위를 명시했다. `docs/WORK_LOG.md`에 현재 기록을 추가했다.

기존 Kernel/Ports/Events/config/Extension 구현, MASTER_SPEC와 ADR-001~011은 변경하지 않았다. 새 dependency, Core 수정, 실제 프로젝트 `.ai` 생성, 명령 연결은 없다. 기존 AGENTS.md/package-lock.json 작업도 유지했다.

### 동작과 실패 처리

- 정규 프로젝트 경로의 `.ai/writer.lock`을 배타 생성한다. lock 획득 실패는 기존 상태를 변경하지 않는다. 다른 소유자나 불명확한 stale lock은 자동 삭제·탈취하지 않는다.
- `.ai/state.json`의 `{schemaVersion, revision, runs, actions}`가 원본이다. tasks는 같은 프로젝트 revision의 재생성 가능한 projection이다. action ID는 run에 묶고 중복 실행·동일 run의 config digest 변경을 거부한다.
- temp/write/file sync/rename으로 state를 먼저 저장한다. tasks 저장 실패는 `stateCommitted: true`인 오류이며 추가 변경을 차단한다. 다중 파일 transaction으로 취급하지 않는다.
- 재개된 소유자는 CREATED/RUNNING/WAITING_APPROVAL과 PREPARED action을 INTERRUPTED로 저장한다. 기존 RunInterrupted 이벤트를 저장 뒤 발행하며 sink 실패는 별도 진단에 남긴다. 자동 실행·resume·PASS/승인 재사용은 없다.
- Policy는 ALLOW만 실행하고 나머지 결과·검사 불가·저장 실패에서 executor를 호출하지 않는다. intent 저장 뒤 경로·lock·취소를 다시 검사한다. 실행 후 결과 저장 실패도 성공으로 반환하지 않고 다음 action을 막는다.

### 이번 작업에서 실행한 검증

패키지 디렉터리에서:

```sh
node ../../node_modules/vitest/dist/cli.js --run test/state-store.test.ts test/policy.test.ts test/host-boundary.test.ts test/contracts.test.ts test/config.test.ts test/extension.test.ts test/classification.test.ts test/kernel.test.ts
```

- 시작 시 기존 S0/S1 **6개 파일·133개 테스트** 통과를 재확인했다.
- 최종 S2 포함 **8개 파일·244개 테스트 통과**. 저장/revision/projection/복구/lock/손상 JSON/원자 저장 실패/fail-closed, 경로·symlink·역할·도구·위험 정책 및 차단된 executor 호출 0회를 검증했다.
- 저장소 루트 `npm run check`: 통과. TypeScript, 의존성·entry graph·shrinkwrap·install lock 및 browser smoke 검사 포함. Biome 자동 포맷 결과도 확인했다.
- `git diff --check`: 통과. 작업 문서의 상대 링크·코드 블록·이력 ID도 확인했다.
- 빌드·전체 테스트 suite·실제 AgentSession/Provider 추론·interactive smoke: 미실행. 이번 범위에 실제 Agent/명령 연결이 없다.

### 문제와 해결

- 첫 check가 타입 없는 지역 변수 2개를 지적했다. Node의 Stats/FileHandle 타입을 명시한 뒤 check를 통과했다.
- 결과 저장 실패를 executor 실패로 잡으면 두 번째 저장을 시도해 부분 저장 오류를 가릴 수 있었다. 성공 결과 저장을 executor try/catch 밖으로 분리하고 실패 후 추가 실행 차단 테스트를 추가했다.
- 순수 Policy에서 파일 시스템을 조회하지 않도록 policy-paths Adapter를 별도 파일로 분리했다. Kernel의 import graph는 유지했다.

### 남은 제한과 다음 작업

- 로컬 협력적 단일 writer 계약이며 OS sandbox·분산 lock·전원 장애 내구성은 아니다. 외부 프로세스의 검사/실행 사이 파일 교체 경합을 완전히 막지 못한다. 검증 환경은 현재 macOS/Node이며 다른 OS 검증은 하지 않았다.
- 모든 symlink(내부 포함), hardlink 파일, 디렉터리 단위 재귀 검색을 보수적으로 차단한다. 검색은 구체 파일 목록만 지원한다. 임의 이름의 비밀 내용을 자동 탐지하지 않는다.
- 실제 도구 입력·risk·정책/config digest 생성·고정과 추가 Runtime 보호 경로 지정은 신뢰한 S3 Adapter 책임이다. 임의 shell과 verifier 명령 실행은 아직 지원하지 않는다.
- close/scoped finally는 제공하지만 worker가 살아 있는 동안 lock을 풀지 않도록 Host가 종료를 기다려야 한다. crash가 남긴 불명확한 lock은 사용자 확인 후 수동 정리해야 한다.
- 대화/tool history 복제, 별도 decisions.md/logs 출력, 자동 resume/retry/checkpoint, 승인 UI, SDK worker, RPC/Web/DAG/병렬 실행은 추가하지 않았다. 파일 크기 16 MiB 제한과 자동 보관 미지원은 남아 있다.
- **다음 작업:** S3 진행 가능. 독립 Developer/Reviewer SDK Adapter에 고정된 도구·리소스와 S2 gate를 연결하고 faux provider로 검증한다. 명령→workflow 연결은 S4로 유지한다.
- **커밋:** 하지 않음.

---

## LOG-006 — S3: 독립 Pi SDK Agent Adapter

- **기록일:** 2026-09-15 15:33 (KST)
- **상태:** 완료
- **목적:** Kernel/Port/Adapter 경계를 유지하며 Developer와 Reviewer를 실제 SDK AgentSession에 연결한다. 전체 workflow·verifier·명령 연결은 제외한다.

### 변경 내용과 파일

`packages/company-runtime/` 기준:

- `src/agent-runner.ts`: PiAgentExecutor, 두 profile의 사전 model/auth 검사, 역할 호출별 새 SDK 세션, 명시적 ResourceLoader·메모리 Settings, timeout/abort/dispose, 동시 역할·실패 run 재호출 거부.
- `src/agent-tools.ts`: S2 gate를 직접 호출하는 read/search/write/exact edit, 등록 check 요청(미실행), 역할별 구조화 결과 제출. 기본 Pi 도구나 shell은 설치하지 않는다.
- `src/contracts.ts`: 기존 세션 참조 shape를 RoleSessionReferenceSchema로 분리하고 VerificationResult에 선택적 reviewContext를 추가했다. Pi Reviewer는 실제 자료가 없는 입력을 거부한다.
- `src/ports.ts`: session reference 저장을 기다리는 onSessionCreated 콜백 추가. Pi 구체 타입 없음.
- `src/kernel.ts`: 세션 참조 검증·저장, 저장 후 이벤트, 단일 등록·늦은 콜백 거부만 추가했다. STANDARD 전이·completion guard·revision limit는 유지했다.
- `src/events.ts`: AgentSessionCreated와 AgentCompleted/Failed의 선택적 sessionRef. 기존 이벤트 sequence·stateRevision 규칙 유지.
- `test/agent-metadata.test.ts`: 순수 Port의 참조 저장·잘못된 참조·저장 실패·늦은 콜백 검사.
- `README.md`: API와 역할 도구, 리소스/인증 범위, 참조·이벤트·취소 및 S4 연결 조건 기록.

추가 변경:

- `packages/coding-agent/test/suite/company-runtime-agent.test.ts`: 기존 suite harness와 faux provider로 실제 SDK Adapter 통합 테스트.
- `packages/coding-agent/vitest.config.ts`: public coding-agent import를 workspace source로 해석하는 alias 한 줄. 빌드 없는 소스 테스트용이며 Core 동작 변경이 아니다.
- `docs/IMPLEMENTATION_PLAN.md`, `docs/WORK_LOG.md`: S3 결과·현재 요약과 다음 단계 갱신.

MASTER_SPEC/ARCHITECTURE/ADR-001~011, S2 StateStore·Policy 구현과 S0 config/Extension은 변경하지 않았다. Pi Core, dependency/lockfile, 실제 프로젝트 `.ai` 설정·명령 연결도 변경하지 않았다. 기존 AGENTS.md/package-lock.json 수정은 이전 작업 그대로다.

### 구현 결정과 확인된 동작

- Developer와 Reviewer는 세션·ID·도구·ResourceLoader·Settings·모델 profile이 독립적이다. Handoff/명시적 verification 자료 외 부모 대화나 Developer reasoning을 Reviewer에 전달하지 않는다.
- 기본 ResourceLoader가 noExtensions 외에도 context/SYSTEM/append prompt 등을 읽을 수 있음을 소스로 확인했다. Worker는 기본 로더를 생성하지 않고 빈 resource 목록과 명시적 role/projectInstructions만 제공한다. project/global 리소스 trap fixture가 로드되지 않음을 확인했다.
- 설정 사본·도구 등록·보호 경로를 고정해 config digest를 생성한다. coding/reasoning 모두 provider/model/checkAuth/getAuth를 확인하고, 실행 직전 해당 profile을 다시 검사한다. 원격 availability나 자동 fallback을 가정하지 않는다.
- 파일 도구는 부모 hook 없이 S2 gate를 통과한다. Reviewer에는 read/search/submit_review만 있다. 등록 check 요청은 Pi history에 남기되 UNAVAILABLE이며 어떤 명령도 실행하지 않는다.
- 제출 결과는 schema와 run/task/role/revision 및 review diffDigest를 검사한다. 제출과 mutation을 섞은 batch, 자연어-only 완료, malformed 결과와 도구 실패는 종료 오류다. Kernel의 기존 결과/완료 재검증은 유지한다.
- 새 세션 참조를 Kernel에 저장한 뒤 prompt를 실행한다. Pi JSONL은 workspace 밖 Pi agent directory가 소유한다. Runtime State/Event에는 참조·단계·상태만 기록하며 transcript/reasoning을 복제하지 않는다.
- 이벤트 발행자는 Kernel 하나다. AgentStarted(호출 시작) → AgentSessionCreated(참조 저장) → AgentCompleted/Failed를 관찰한다. 새로운 이벤트 버스나 replay는 없다.
- AbortSignal/timeout을 tool gate와 Provider stream 시작에 연결한다. finally에서 idle/abort 정리를 기다리고 dispose한다. 실패·취소 run은 해당 Adapter에서 다음 역할을 시작하지 않는다.

### 이번 작업에서 실행한 검증

패키지별 명령:

```sh
# packages/company-runtime
node ../../node_modules/vitest/dist/cli.js --run test/agent-metadata.test.ts test/contracts.test.ts test/config.test.ts test/extension.test.ts test/classification.test.ts test/kernel.test.ts test/host-boundary.test.ts test/state-store.test.ts test/policy.test.ts

# packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run test/suite/company-runtime-agent.test.ts test/suite/agent-session-prompt.test.ts
```

- Runtime: **9개 파일·249개 테스트 통과**. 기존 S0~S2 244개 회귀와 새 metadata 5개 포함.
- coding-agent: **2개 파일·63개 테스트 통과**. 새 faux SDK 통합 47개와 기존 prompt suite 16개 포함.
- 이번 최종 검증 합계 **11개 파일·312개 테스트 통과**. 이 숫자는 전체 저장소 suite 수가 아니다.
- 루트 `npm run check`: 통과. 최종 Biome는 자동 수정 없음. TypeScript·deps·entry graph·shrinkwrap·install lock·browser smoke 포함.
- `git diff --check`, 변경 문서 링크·코드 블록·이력 ID·공백 검사: 통과.
- 유료/실제 Provider API, 전체 테스트 suite, build, interactive smoke: 미실행. 실제 모델에 대한 품질·네트워크 검증으로 보고하지 않는다.

### 문제와 해결

- 첫 통합 실행은 public coding-agent 패키지의 미빌드 entry를 찾지 못했다. 기존 workspace source alias를 테스트 설정에 추가해 build 없이 실행했다.
- faux context에는 SDK tool 함수가 포함되어 structuredClone이 실패했다. 테스트에서 제공된 context를 관찰하고 검증하되 함수까지 복제하지 않도록 수정했다.
- Vitest spy 타입의 overload 지정이 TypeScript 검사에 맞지 않았다. 설치된 타입을 확인하고 MockInstance로 명시했다.
- SDK prompt preflight가 Agent abort controller 생성 전에 yield할 수 있다. Adapter에서 기존 SDK streamFunction을 감싸 취소를 재검사하고 signal을 결합했다. 이 구간 취소 시 Provider 호출 0도 테스트했다.
- cleanup 중 취소가 성공 반환으로 빠지지 않도록 cleanup 뒤 signal을 다시 검사한다. 늦은 tool callback은 disposed 상태에서 차단한다.

### 남은 제한과 후속 단계

- 전체 Developer→SELF_CHECK→Reviewer→TEST workflow는 실행하지 않았다. 독립 역할 호출과 단일 Kernel IMPLEMENT 연결만 검증했다. 실제 diff/check 자료 생성·freshness 연결·명령 및 Host shutdown은 S4다.
- 검색은 명시한 파일 최대 32개만 지원한다. 읽기/작성 내용은 256 KiB, exact edit·기존 부모 디렉터리만 지원한다. 자동 후보 탐색·삭제·이동·범용 shell은 없다.
- 같은 프로세스의 정책 gate이지 OS sandbox가 아니다. 외부 파일 교체 경합·악성 Extension 직접 I/O·비협조 Provider/auth/파일 I/O를 강제로 종료하지 못한다. timeout은 취소 요청 기한이며 정리 시간의 절대 상한이 아니다. 실환경 인증 해석은 OAuth 갱신 등 네트워크를 사용할 수 있다.
- Pi SessionManager는 첫 assistant까지 JSONL 생성을 지연한다. 사전 실패 sessionRef에 대응하는 파일이 없을 수 있다. `.ai`와 Pi transcript 간 transaction이나 resume는 없다.
- 공유 ModelRuntime의 동적 변경은 Host가 관리해야 한다. 부모 리소스를 로드해 인증·Provider를 자동 상속하지 않는다. usage는 Pi session에 남기고 Runtime 집계는 추가하지 않았다.
- S4 후속 제안: 신뢰한 실제 diff/check 자료를 reviewContext로 전달하고 같은 Policy로 제한 verifier를 구현한다. Provider/세션 오류·취소 후 부분 파일 변경을 최종 보고에서 명시한다. 승인 UI·DAG·Web/RPC·Lead/Planner·병렬화·checkpoint/fallback은 범위 밖으로 유지한다.
- **다음 작업:** S4 진입 가능.
- **커밋:** 하지 않음.

---

## LOG-007 — S4: Verification + STANDARD Vertical Slice

- **기록일:** 2026-09-15 16:31 (KST)
- **상태:** 완료 — 첫 STANDARD/R0~R1 Slice. 전체 V0.1 완료 아님.
- **목적:** 기존 S0~S3와 ADR-001~011을 유지하며 실제 검증 증거, 순차 SDK 역할, 명령과 취소 lifecycle을 연결한다.

### 1. 변경 파일

- 신규: `packages/company-runtime/src/process-runner.ts`, `src/workspace.ts`, `src/verification.ts`, `src/workflow.ts`.
- 수정: 같은 패키지 `src/contracts.ts`, `src/ports.ts`, `src/kernel.ts`, `src/policy.ts`, `src/state-store.ts`, `src/agent-runner.ts`, `src/extension.ts`.
- 테스트: 같은 패키지 `test/verification-boundary.test.ts` 신규, `test/extension.test.ts` S4 갱신; `packages/coding-agent/test/suite/company-runtime-workflow.test.ts` 신규.
- 문서: `packages/company-runtime/README.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/WORK_LOG.md`.
- MASTER_SPEC/ARCHITECTURE/DECISIONS, Pi Core, dependency/lockfile, 실제 저장소 `.ai`는 수정·생성하지 않았다. 기존 AGENTS/lockfile/Vitest alias·untracked S0~S3 작업은 보존했다. devlop이므로 별도 릴리스 Changelog는 작성하지 않았다.

### 2. 전체 실행 흐름

`/workflow run <goal>` → 신뢰/등록 실행 확인 → 분류 → 단일 writer → profile/auth → clean Git baseline → IMPLEMENT → SELF_CHECK → 독립 REVIEW → TEST → live digest 확인 → Kernel COMPLETE 저장 → 보고 → lock 해제다. REVISE는 IMPLEMENT부터 새 session/attempt로 최대 1회 반복한다. BLOCK/한도 초과/필수 check 실패는 최종 완료로 진행하지 않는다.

### 3. Host와 Kernel/Adapter 경계

Extension은 명령·UI·ModelRuntime 구성과 lifecycle만 담당한다. StandardWorkflow가 순차 호출과 취소/자원 수명을 소유하고 Kernel만 상태 전이/완료를 결정한다. 기존 Verifier Port에 선택적 live `inspect`만 추가했으며 S4 Adapter는 제공한다. Kernel/Ports/Policy에 Pi·UI·fs 구체 타입을 추가하지 않았다. 범용 plugin framework/event bus/DAG scheduler는 없다.

### 4. 실제 Verification Engine

등록 check ID/kind/required를 요청과 대조하고 frozen executable/argv/cwd/timeout/env를 실행한다. PASS/FAIL/SKIPPED/UNAVAILABLE, 실제 exit code, 시작/종료 Unix ms, stdout/stderr와 evidence reference를 반환한다. stdout/stderr 합계 16 KiB 초과·timeout·실패는 PASS가 아니다. 미실행 check를 PASS 처리하지 않는다. 등록 ID를 요청하는 worker tool은 이전처럼 UNAVAILABLE이며 실제 실행은 SELF_CHECK/TEST에서만 수행한다.

### 5. 실행 Policy와 제한

Verifier 전용 PolicyDecision을 S2 audit prepare/finish에 연결했다. exact registration 비교, shell/wrapper/inline eval 차단, cwd 경로 검사 및 intent 후 재검사, lock/취소 확인을 통과해야 `spawn(shell:false)`를 호출한다. PATH·locale·CI·색상 및 Git 설정 차단 값만 환경으로 전달하고 HOME/NODE_OPTIONS/키/token/proxy 등은 상속하지 않는다. 명시적 local check script/program을 Developer 보호 경로에 추가했다. 등록 프로그램 내부 코드·의존성·네트워크는 sandbox하지 않으므로 UI에 신뢰 전제를 표시한다.

### 6. Git baseline과 diff

기존 HEAD가 있는 프로젝트 루트에서 tracked/staged/untracked 사용자 변경이 있으면 worker prompt 전에 거부한다. HEAD/index/config와 정렬된 경로·mode·전체 bytes SHA-256으로 digest를 계산한다. runtime 운영 파일 세 개만 제외하고 추적 상태이면 시작을 거부한다. 설정 파일 변경은 숨기지 않는다. 허용 root의 ignored 파일도 수집한다. diff는 실제 before/after UTF-8·mode JSON이며 unified patch가 아니다. HEAD/index 변경, binary 변경, 보호 경로, symlink/hardlink/special file과 크기 한도는 보수적으로 거부한다. 사용자 Git 정리·rollback·commit은 수행하지 않는다.

### 7. Reviewer 입력과 독립성

매 호출 새 Developer/Reviewer SDK session과 기존 제한 도구를 사용한다. Reviewer에 task requirements, 구조화 handoff/위험/미해결 항목, 실제 changed files/diff/digest, SELF_CHECK 출력 evidence와 revision을 전달한다. Developer reasoning/transcript를 복사하지 않으며 read/search/submit_review 외 mutation/process 도구를 제공하지 않는다. REVISE도 새 session을 사용한다.

### 8. 완료 조건과 stale review

Kernel은 기존 run/task/revision·요구사항·미해결·독립 PASS·필수 checks guard를 유지한다. TEST 이후 또는 COMPLETE 직전 digest가 달라지면 BLOCKED로 종료하고 기존 PASS를 재사용하지 않는다. 후속 check가 앞 check의 workspace를 바꾸면 앞 증거도 stale로 처리한다. 자동 재검토 반복은 추가하지 않았다. COMPLETE state 저장 실패는 RunCompleted를 발행하지 않는다.

### 9. 상태와 RuntimeEvent

Run에 최소 workspace digest/changedFiles/evidence/safe와 구조화 Review, CheckResult에 timing/output을 추가했다. 실제 check 결과는 취소와 후속 diff 수집 실패에서도 가능한 먼저 저장한다. `.ai/state.json` 원본과 tasks projection, Pi JSONL의 transcript 소유권은 유지한다. 외부 authoritative state 변경은 덮어쓰지 않고 실패로 닫는다. 이벤트는 기존 Kernel authority·sequence·stateRevision·(runId, stepId, attempt)·저장 후 발행이며 별도 재생 로그/버스는 없다.

### 10. 취소와 partial mutation

오류/timeout/취소 후 실제 변경 경로를 재수집하여 partial changes, verification 상태/원인, 사용자 후속 조치를 보고한다. 수집 실패는 changesUnknown이며 완료로 위장하지 않는다. 활성 단계 status는 live diff가 아니라는 경고를 출력한다. worker abort/idle/dispose와 check process group TERM/KILL/close/소멸 확인 후 lock을 해제한다. 정리가 불확실하면 lock을 유지하고 수동 점검을 요구한다. 자동 rollback·resume는 없다.

### 11. 명령과 Host lifecycle

네 명령과 `/workflow status|run|cancel`을 연결했다. 장기 작업 Promise를 소유하지만 run 명령 handler는 즉시 반환한다. 중복 run·활성 부모 Agent와 경합을 거부하며 실행 중 부모 input/tool/user_bash를 차단한다. switch/fork/tree/reload/quit 및 명시적 cancel은 cleanup을 기다린다. preflight dialog에도 signal을 전달한다. 부모 Esc가 worker를 자동 취소한다고 가정하지 않는다.

### 12. 이번 작업의 자동 검증

```sh
# packages/company-runtime
node ../../node_modules/vitest/dist/cli.js --run test/agent-metadata.test.ts test/contracts.test.ts test/config.test.ts test/extension.test.ts test/classification.test.ts test/kernel.test.ts test/host-boundary.test.ts test/state-store.test.ts test/policy.test.ts test/verification-boundary.test.ts

# packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run test/suite/company-runtime-workflow.test.ts test/suite/company-runtime-agent.test.ts test/suite/agent-session-prompt.test.ts

# root
npm run check
git diff --check
```

- 최종 targeted tests(16:26 KST): Runtime **10개 파일·261개**, coding-agent **3개 파일·106개**, 합계 **13개 파일·367개 통과**. 이전 LOG-006의 312개는 당시 결과이며 이번 전체 저장소 suite 수가 아니다.
- 신규 workflow 43개: PASS, REVISE→PASS/한도 초과, BLOCK, dirty tracked/staged/untracked/config, 미지원 분류, check FAIL/UNAVAILABLE/timeout/shell/eval, stale TEST/COMPLETE, TEST 자체 mutation, 모든 Step 경계 취소, live Developer/Reviewer/SELF_CHECK/TEST 취소, duplicate writer, Provider 실패, COMPLETE 저장 실패, state corruption, symlink, check script 보호 및 Host lifecycle 포함.
- 신규 process/registration 11개와 Extension trust/public loader/confirmation/명령 회귀 포함. S0~S3 회귀와 기존 AgentSession prompt 16개도 이번에 다시 실행했다.
- root check 최종(16:29 KST) 통과, Biome 자동 수정 없음. TypeScript·deps·entry graphs·shrinkwrap·install lock·browser smoke 포함. 초기 자동 포맷과 tracked/untracked 파일 목록도 확인했다.
- 최종 `git diff --check`, 변경 문서 상대 링크·코드 fence·공백 및 LOG-001~007 고유 ID 검사 통과. untracked Runtime TypeScript/README의 공백도 별도 검사했다. 임시 검사 script는 제거했다.

### 13. 실제 Pi interactive smoke

- `.pi/skills/interactive-testing.md`에 따라 80×24 tmux에서 저장소 `pi-test.sh`를 실행했다. 임시 Extension을 `-e`로 명시적으로 로드하고 같은 `registerCompanyRuntime`에 suite harness/faux ModelRuntime을 주입했다.
- 임시 Git fixture, 별도 HOME/agentDir, `env -i`, `--offline --approve --provider faux --model coding --no-session`을 사용했다. 실제 Provider key·원격 추론·유료 token 호출은 없다.
- `/workflow run` 확인 dialog → 실제 코드 변경 → check PASS → Reviewer PASS → TEST PASS → COMPLETED를 두 번 확인했다. `/workflow`, status, state, team, risk 출력도 확인했다.
- live Developer에서 `/workflow cancel` → CANCELLED·src/app.js 부분 변경 보고·lock 없음, reload 후 저장 상태 조회를 확인했다. 별도 fresh fixture에서 **실행 중 `/reload`**도 worker 종료 후 CANCELLED로 조회됐다.
- 마지막 fixture 상태: 성공 2건 COMPLETED/PASS/PASS, 취소·live reload 각 CANCELLED, 모두 writer.lock 없음. 테스트 후 tmux·임시 fixture/script를 제거했다. 실제 작업 저장소 `.ai`가 없음을 확인했다. Interactive switch/fork/tree는 별도 조작하지 않았으며 faux Host 통합 테스트로 검증했다.

### 14. 문제와 해결 / 미실행과 한계

- 초기 check에서 지역 Stats 타입 누락, RuntimeEvent union narrowing, Vitest overloaded mock 타입, 기존 S0 골격 테스트 expectation을 수정했다. 최종 check/test로 해결을 확인했다.
- macOS의 group 종료 직후 kill probe에 일시 EPERM이 관찰됐다. 즉시 cleanup 완료/실패로 단정하지 않고 bounded polling으로 ESRCH를 확인하도록 수정했고 실제 descendant 종료 테스트를 통과했다.
- check 뒤 symlink 때문에 evidence 수집이 실패하면 exit/output이 사라질 수 있었다. 실제 check result를 FAIL로 보존하고 이후 수집 실패는 incomplete로 보고하도록 분리했다.
- 초기 smoke launcher의 single-quote `$1` 경로 오류를 고쳤다. 이는 fixture 실행 전 실패였으며 성공 smoke로 계산하지 않았다.
- `npm run build`, 전체 npm test/Vitest suite, 실제 Provider 품질/네트워크/유료 inference는 실행하지 않았다. 요청된 범위의 targeted/interactive faux만 검증했다.
- macOS/Node/POSIX 구현이다. Windows, 탈출한 daemon/process group, 외부 TOCTOU·악성 같은-process I/O·비협조 Provider/auth I/O를 강제 격리하지 않는다. 등록 프로그램은 검토된 trusted code여야 한다.
- Git evidence는 file/byte/count 한도가 있고 허용 root 밖 ignored 파일 전부를 스캔하지 않는다. 알려지지 않은 파일 안의 비밀 값 자동 탐지·OS sandbox는 없다. 단일 requirement는 command goal 전체이며 계획 분해는 없다.
- 파일별 atomicity이며 state/tasks 다중 transaction, directory fsync 내구성, 자동 crash recovery 실행은 없다. separate decisions.md/logs UI, usage 집계, R3 approval, QUICK/COMPLEX/R2/R3 실행은 추가하지 않았다.

### 15. 다음 단계와 커밋

첫 Slice는 완료했고 **S5 진입 가능**하다. 사용자 승인 후 QUICK/R2/R3와 조회·결정 기록 등의 작은 범위를 순서대로 진행한다. S6의 추가 실패/플랫폼 회귀 hardening도 남아 있다. 기존 제한을 자동 해제하거나 DAG/병렬화/웹/RPC/별도 서비스/SQLite migration을 추가하지 않는다.

**커밋: 하지 않음.** 사용자 작업 저장소의 Git 정리/commit은 없으며 테스트용 Git baseline commit은 새 임시 fixture 안에서만 생성하고 제거했다.

---

## LOG-008 — S5A: 검증을 공유하는 QUICK Executor

- **기록일:** 2026-09-15 17:00 (KST)
- **상태:** 완료 — S5A만 구현. S5B/R2·S5C/R3·S5D polish 및 S6는 미착수.
- **목적:** STANDARD 회귀를 막으면서 Reviewer만 생략한 최소 조직을 추가한다. QUICK도 정책·검증·최신 digest·Kernel 완료 판정을 유지한다.
- **시작 상태:** devlop clean, HEAD/origin은 `e80d97272513aa89cfbea6585933ac44c301f15d`. 직전 사용자 승인으로 S0~S4·명세·lockfile 39개 파일을 커밋/푸시한 상태다. LOG-001~007의 커밋 미실행 표시는 각 당시 기록으로 보존한다.

### 1. QUICK 선택 기준

- 기존 classifier의 question/typo에 명시적 작은 변경·설정·한 파일 표현을 보완했다. `adaptive`는 classification을 사용하고 기존 `runtime.workflow: STANDARD`는 처음부터 독립 review 조직을 선택한다. 새 mode UI는 없다.
- QUICK/R0는 read-only, QUICK/R1은 goal에 정확히 한 개의 확장자 있는 literal 상대 파일 경로를 요구한다. `Fix typo in src/app.ts`, `작은 설정 수정 ui/settings.json`, `Explain src/app.ts`를 검증했다.
- unknown·아키텍처/다수 모듈/대규모·refactor QUICK·R2/R3는 실행하지 않는다. 단순 classifier는 권한 증명이 아니며 실제 action과 workspace 검사도 수행한다.

### 2. Executor 구조와 profile

- 기존 RoleSchema의 Executor를 실행 Port/Event에 연결했다. PiAgentExecutor가 새 SDK session·명시적 resources·제한 도구·timeout/dispose를 그대로 사용한다. 별도 범용 Agent 시스템은 없다.
- `Executor → coding`을 사용하며 모델 ID 하드코딩·fast 자동 선택·fallback·비용 routing은 없다. Host가 frozen quickScope를 전달하고 요청과 일치해야 한다.
- STANDARD는 기존 coding/reasoning auth 사전 검사를 유지한다. QUICK은 coding만 검사하고 Reviewer session/auth를 생성·조회하지 않는다. config schema의 reasoning mapping 필수 조건은 유지하며 QUICK에서 미사용 model이 없어도 실행되는 fixture를 검증했다.

### 3. STANDARD와 공유하는 코드·변경 파일

- `packages/company-runtime/src/{classification,contracts,ports,events,kernel}.ts`: QUICK Step/role/result/scope와 공유 완료 guard의 명시적 QUICK 분기.
- `src/{agent-runner,agent-tools,policy}.ts`: 기존 SDK/도구와 Policy에 fixed scope 적용. R0 write/edit 미노출에만 기대지 않고 Policy에서도 mutation을 거부한다.
- `src/{workspace,verification,workflow,extension}.ts`: 기존 baseline/digest/실제 checks/실행 소유권/네 명령·lifecycle 재사용. S4의 StandardWorkflow 이름과 순차 실행 소유자를 유지하며 분류에 따라 두 경로를 실행한다.
- `StateStore`, path inspector, process runner 구현은 수정하지 않았다. 보호 파일·dependency gate·단일 writer·실패/취소 정리·원자 파일 저장 방식도 그대로다.
- Pi Core·dependency/lockfile·MASTER_SPEC/ARCHITECTURE/DECISIONS·실제 프로젝트 `.ai`는 변경하지 않았다. 기존 ADR-008/011로 설명 가능하므로 새 ADR을 억지로 추가하지 않았다.

### 4. QUICK 전용 코드와 evidence

- 신규 `src/quick.ts`: 작은 goal scope 선택, 공통 prefix/suffix를 제외한 changed-line span 계산, workspace의 한 파일/100행 한도 검사. 독립 diff/digest 엔진은 아니다.
- 기존 `HandoffSchema` 필드를 재사용한 ExecutorHandoffSchema에 정확한 요구사항별 status/explanation을 요구한다. `submit_handoff`와 기존 도구 구현을 재사용한다.
- Run에는 `quickScope`, 구조화 `executorResult`, `executorDigest`를 추가하고 공통 workspace evidence에 선택적 changedLines를 보완한다. 전체 diff·reasoning·transcript를 `.ai`에 추가 복제하지 않는다.
- QUICK 전용 scope/guard unit test와 coding-agent suite 파일을 추가했다. 기존 Kernel test fixture는 새 역할 union을 명시적으로 거부하도록 좁히고, 옛 QUICK 미지원 테스트는 live inspection 없는 QUICK 거부로 유지했다. S4의 일반 설명 미지원 fixture는 위험 설명 요청으로 바꿨으며 STANDARD 동작 assertion은 제거하지 않았다.

### 5. Completion Guard

- 구조화 Executor 결과의 run/task/revision 일치, exact requirements·MET·비어 있지 않은 설명, 실제 changed_files 일치, unresolved/known_risks 없음이 필요하다.
- 필수 check가 적어도 하나 있어야 하고 SELF_CHECK/TEST 각각 실제 PASS/exit 0/evidence/동일 digest여야 한다. optional check라도 Policy 거부는 QUICK에서 FAIL로 완료를 막는다.
- Kernel이 구현 직후 snapshot digest를 결과에 결합한다. SELF_CHECK/TEST/COMPLETE까지 executorDigest가 유지되어야 한다. check autofix도 결과 제출 뒤 변경이므로 QUICK에서는 stale·BLOCKED다.
- live inspection·scope/changed-line evidence 없이 완료할 수 없다. 자연어 완료, 누락/미충족 요구사항, blocker, stale digest, state 저장 실패는 COMPLETE가 아니다. Kernel만 완료를 저장한다.

### 6. R2/R3와 범위 확대 처리

- 초기 classification이 R2/R3이면 Host preflight에서 run/Provider 실행 전에 거부한다. 기존 selector의 QUICK→STANDARD 승격은 조직 판정일 뿐 실제 R2/R3 실행 허용이 아니다.
- `Fix typo in package.json`처럼 초기 R1이더라도 action Policy는 dependency mutation을 R2/REVIEW_REQUIRED로 차단한다. S5B의 R2 실제 실행을 열지 않았다.
- 고정 targetPath 밖 worker mutation은 실행 전 DENY다. 실제 코드가 여러 파일/100행 이상으로 확장되거나 결과 뒤 변경되면 BLOCKED·부분 변경·STANDARD 재실행 필요를 보고한다. 자동 hot-switch/rollback은 없다.

### 7. RuntimeEvent와 명령 trace

```text
RunCreated → RunStarted
StepStarted(implement) → AgentStarted(Executor) → AgentSessionCreated
  → AgentCompleted → StepCompleted
StepStarted(self-check) → VerificationStarted → VerificationCompleted → StepCompleted
StepStarted(test) → VerificationStarted → VerificationCompleted → StepCompleted
StepStarted(complete) → StepCompleted → RunCompleted
```

sequence/stateRevision·저장 후 발행·(runId, stepId, attempt) 구조는 유지한다. QUICK attempt는 1이며 ReviewRequested/ReviewPassed나 Reviewer session은 없다. 네 명령에 Workflow QUICK, Executor, Reviewer not required, risk와 구조화 결과를 표시한다. 활성 단계의 부분 변경 가능성·명시적 cancel 안내도 유지한다.

### 8. 이번 작업의 자동 검증

```sh
# packages/company-runtime
node ../../node_modules/vitest/dist/cli.js --run test/quick.test.ts test/agent-metadata.test.ts test/contracts.test.ts test/config.test.ts test/extension.test.ts test/classification.test.ts test/kernel.test.ts test/host-boundary.test.ts test/state-store.test.ts test/policy.test.ts test/verification-boundary.test.ts

# packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run test/suite/company-runtime-quick.test.ts test/suite/company-runtime-workflow.test.ts test/suite/company-runtime-agent.test.ts test/suite/agent-session-prompt.test.ts

# root
npm run check
git diff --check
```

- 최종 targeted tests(16:59 KST): Runtime **11개 파일·302개**, coding-agent **4개 파일·144개**, 합계 **15개 파일·446개 통과**. LOG-007의 367개는 S4 당시 결과이며 전체 저장소 suite 수가 아니다.
- QUICK 신규 **unit 41개 + faux integration 38개 = 79개**. R0/R1, coding Executor·Reviewer 없음, Policy·필수 checks PASS/FAIL, structured requirements, Provider 실패·partial mutation, 모든 Step 취소·live check 취소, dirty tracked/staged/untracked, R2/R3, scope 확대, SELF_CHECK/TEST mutation·stale digest, event sequence, COMPLETE 저장 실패, active/stored 명령·Host shutdown을 검증했다.
- root check 최종(17:02 KST) 통과, Biome 자동 수정 없음. 초기 TypeScript에서 STANDARD test helper의 역할 union narrowing 누락 1건을 수정했다. Biome 자동 포맷 결과와 tracked/untracked 변경을 확인했다. 별도 build·전체 npm test/Vitest suite·유료 Provider 추론은 실행하지 않았다.
- `git diff --check`, 변경 문서 링크/fence/공백·LOG-001~008 고유 ID·S5A~S5D 소제목 검사 통과. 신규 untracked 소스/테스트 공백도 별도 검사했고 임시 checker는 제거했다.

### 9. Interactive smoke

- interactive-testing skill에 따라 80×24 tmux에서 `pi-test.sh`와 명시적 `-e` 임시 wrapper를 사용했다. 기존 suite harness/faux를 `registerCompanyRuntime`에 주입하고 별도 HOME/agentDir, `env -i`, `--offline --approve --provider faux --model coding --no-session`으로 실행했다.
- QUICK/R1 오타 수정: Executor 1개 → SELF_CHECK PASS → TEST PASS → COMPLETED, src/app.ts만 변경, Reviewer not required를 확인했다.
- QUICK/R0 설명: read-only Executor 1개와 두 checks PASS → COMPLETED, 원본 내용 불변을 확인했다. reload 후 `/state`에서 저장된 QUICK 상태·구조화 결과/요구사항 설명도 확인했다.
- `/workflow`, `/team`, `/state`, `/risk` 출력 및 live Executor status → `/workflow cancel` → CANCELLED·partial changes yes를 확인했다.
- 세 fixture의 실제 state/session role/check digest·writer.lock 부재를 검증했다. tmux·임시 fixture/script를 제거했고 실제 저장소 `.ai`는 생성하지 않았다. 실제 모델 품질·원격/유료 Provider를 검증한 결과로 주장하지 않는다.

### 10. STANDARD 회귀와 문서

- 기존 S0~S4 검증을 이번에 다시 실행했다. STANDARD의 독립 Developer/Reviewer, PASS·REVISE→PASS·BLOCK, 최종 TEST mutation, 취소/Host lifecycle, state 실패, Pi prompt 회귀가 통과했다.
- `docs/IMPLEMENTATION_PLAN.md`: S5A~S5D 내부 순서와 S5A 결과·S5B 다음 단계를 추가했다. S5 전체 방향·S4 첫 Slice 기록을 보존했다.
- `packages/company-runtime/README.md`: 현재 실행 범위, QuickScope/profile/result/digest/API·명령·한계와 테스트 명령을 갱신했다.
- `docs/WORK_LOG.md`: 현재 요약과 본 LOG-008을 추가했다. 과거 이력은 보존한다.

### 11. 알려진 제한

- goal parser/분류는 보수적 heuristic이다. 한 파일 경로가 명확하지 않으면 거부하며 공백 있는 경로·복잡한 문장 분해·의미적 영향 범위 증명은 없다. 기존 보호 규칙상 config 파일 이름 일부는 작은 수정이어도 막힌다.
- 100행은 보수적 changed span이지 완전한 semantic diff가 아니다. Executor의 요구사항 설명은 모델 진술이며 독립 Reviewer 판단이 아니다. 정확성은 실제 프로젝트 checks와 사용자 확인에 의존한다.
- 등록 check는 trusted code이고 R0에서도 subprocess 내부 I/O를 OS 수준으로 막지 않는다. 관찰된 mutation을 fail-closed 처리하지만 transient 변경/외부 TOCTOU/탈출 daemon/비협조 I/O를 완전히 통제하지 못한다. 기존 macOS/POSIX·byte/count 한도도 유지한다.
- `.ai` 다중 파일 transaction·자동 rollback/resume/checkpoint, R2/R3 실제 실행, Lead/Planner/COMPLEX, DAG/T3Code/RPC/Web/병렬 실행/비용 routing/OS sandbox는 추가하지 않았다.

### 12. 다음 단계와 커밋

**S5B 진입 가능**하다. 사용자 승인 후 R2의 허용 action·독립 Reviewer enforcement를 별도 작은 작업으로 구현한다. S4/QUICK 회귀가 계속 우선이다.

**이번 S5A 커밋·푸시: 하지 않음.** 직전 S4 checkpoint `e80d97272` 이후 변경으로 남겨둔다.

---

## LOG-009 — S5B: R2 Review Enforcement

- **기록일:** 2026-09-15 17:32 (KST)
- **상태:** 완료 — R2의 제한된 파일 실행과 독립 리뷰 강제. S5C/R3는 구현하지 않음.
- **목적:** S4/S5A 회귀를 막으며 R2 파일 작업이 Reviewer 없이 실행 완료되거나 QUICK/R1 권한으로 우회되지 않게 한다.
- **시작 상태:** devlop, HEAD `e80d97272`. S5A의 미커밋 tracked/untracked 변경을 보존한 상태에서 진행했다.

### 구현 범위와 실행 구조

- 초기 R2는 STANDARD Developer/Reviewer로 선택한다. `adaptive`에서는 Complexity QUICK/Risk R2도 실행 전 STANDARD를 고른다. 명시적 config QUICK, COMPLEX/R3는 계속 거부한다. 실행 중 R1/QUICK에서 R2 action을 발견하면 중단하고 새 STANDARD/R2 run을 안내한다. 자동 workflow 전환·risk promotion은 없다.
- 기존 write/edit 도구로 허용 경로의 파일을 변경한다. dependency manifest/lockfile도 같은 경로·보호·size 검사를 거친다. 설치·삭제·이동·mkdir·배포·shell 도구를 추가하지 않았다.
- Host가 run ID를 먼저 정하고 `createAgents(store, quickScope?, r2RunId?)`를 통해 PiAgentExecutor/Policy에 고정한다. 실제 request·evidence 수집·verifier의 run과 일치해야 한다. `r2RunId`는 configDigest에 포함하며 worker tool 인자가 아니다.
- bound R2 run의 Developer mutation은 최소 R2로 평가한다. ALLOW는 독립 리뷰 전제의 파일 실행 허가이지 이미 받은 PASS나 Human Approval이 아니다. binding 없는 R2는 REVIEW_REQUIRED이며 R3/UNKNOWN·다른 role/run·QUICK 혼합·보호 경로는 실행하지 않는다.
- StateStore는 R2 ALLOW intent 전에 저장된 STANDARD/R2·RUNNING·IMPLEMENT·attempt·active Developer와 마지막 Developer session 참조를 확인한다. R2 obligation의 risk/workflow를 낮춰 저장하지 못한다. binding만 위조해 durable R1 run의 R2 실행을 열 수 없다.

### 완료·Reviewer·상태·이벤트

- coding/reasoning profile/model/auth를 첫 mutation 전에 확인한다. Reviewer는 기존 새 read-only SDK 세션과 명시적 실제 diff/검증 자료를 사용하며 Developer reasoning을 받지 않는다.
- Kernel은 현재 회차의 서로 다른 Developer/Reviewer session ID·파일, 필수 checks/live inspection, 정확한 handoff/requirements·Review PASS·SELF_CHECK/TEST·최신 digest를 모두 요구한다. session callback 누락, 같은 ID/파일, 이전 회차 참조, 자연어 PASS, stale 결과와 저장 실패는 완료 불가다.
- REVISE는 기존 한도 1회를 유지하며 새 Developer/Reviewer 등록이 필요하다. BLOCK·한도 초과는 최종 TEST/COMPLETE로 넘어가지 않는다. 실패·취소 후 변경을 재수집하고 partial mutation과 검증 상태를 보고하며 rollback하지 않는다.
- 기존 Run/Review/PolicyDecision/Action 포맷과 STANDARD Step/attempt/RuntimeEvent를 재사용했다. R2 전용 상태 저장소·증거 엔진·event bus·승인 token은 없다. Runtime에 전달하는 SDK payload에는 R2/reviewRequired context만 추가했다.
- 네 명령에 R2 분류 근거와 `Review enforcement: REQUIRED (STANDARD/R2)`를 표시한다. 실행 중 R2 거부는 신뢰된 Policy의 risk/decision/reason을 최종 오류로 전달한다. Provider 원문/credential 로그는 전달하지 않는다.

### 이번 변경 파일

- `packages/company-runtime/src/{policy,agent-runner,agent-tools,workflow,extension,workspace,verification}.ts`: run binding, R2 file risk 하한, 기존 실제 실행·evidence 연결과 최소 상태/거부 사유 출력.
- `packages/company-runtime/src/kernel.ts`: R2 시작/완료 guard, 현재 회차의 독립 session 증거 관리. `CompletionEvidence` 타입만 보완하며 Host/SDK 타입은 import하지 않는다.
- `packages/company-runtime/src/state-store.ts`: durable R2 obligation/intent 검사. 기존 lock·atomic writes·recovery 방식은 유지했다.
- 신규 `packages/company-runtime/test/r2-review.test.ts`, `packages/coding-agent/test/suite/company-runtime-r2.test.ts`.
- 기존 `packages/company-runtime/test/kernel.test.ts`: S1 R2 fake에 live evidence·session registration을 제공해 강화된 조건으로 독립 Reviewer 규칙을 계속 검증한다.
- 기존 `packages/coding-agent/test/suite/company-runtime-workflow.test.ts`, `company-runtime-quick.test.ts`: 일반 R2의 옛 미지원 fixture는 COMPLEX/R2 거부로, QUICK R2 거부는 명시적 QUICK 설정으로 정정했다. STANDARD/QUICK의 기존 성공·실패 assertion은 유지했다.
- 문서: `docs/IMPLEMENTATION_PLAN.md`, `docs/WORK_LOG.md`, `packages/company-runtime/README.md`.
- 이번 S5B에서 MASTER_SPEC/ARCHITECTURE/DECISIONS, Pi Core, dependency/lockfile, config schema, RuntimeEvent 정의, process runner/path inspector는 변경하지 않았다. 별도 ADR이 필요한 새 아키텍처를 도입하지 않았다.

### 이번 작업의 자동 검증

```sh
# packages/company-runtime
node ../../node_modules/vitest/dist/cli.js --run test/r2-review.test.ts test/quick.test.ts test/agent-metadata.test.ts test/contracts.test.ts test/config.test.ts test/extension.test.ts test/classification.test.ts test/kernel.test.ts test/host-boundary.test.ts test/state-store.test.ts test/policy.test.ts test/verification-boundary.test.ts

# packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run test/suite/company-runtime-r2.test.ts test/suite/company-runtime-quick.test.ts test/suite/company-runtime-workflow.test.ts test/suite/company-runtime-agent.test.ts test/suite/agent-session-prompt.test.ts

# root
npm run check
git diff --check
```

- 최종 targeted tests(17:30 KST): Runtime **12개 파일·340개**, coding-agent **5개 파일·182개**, 합계 **17개 파일·522개 통과**. R2 신규 unit 38개 + faux integration 38개 = **76개**. LOG-008의 446개는 S5A 당시 결과이며 전체 저장소 suite 수가 아니다.
- R2 actual manifest/lockfile mutation·audit·독립 PASS, 초기 QUICK/R2의 STANDARD 선택, REVISE→PASS/한도 초과/BLOCK, model/auth 누락, 자연어·stale review·누락/재사용 참조·이전 회차 참조, SELF_CHECK/TEST 실패·digest 변경·저장 실패를 검증했다.
- 모든 Step 취소, live Reviewer/final-check 취소·lock 경합, dirty tracked/staged/untracked, 보호 경로/상위 경로, R3/COMPLEX 차단, binding mismatch·durable R1 거부·R2 obligation downgrade 거부와 네 명령 composition도 검증했다.
- S0~S5A와 기존 Pi AgentSession prompt suite를 이번에 다시 실행했다. R0/R1 STANDARD·QUICK의 검증/정책/lifecycle을 회귀시키지 않았음을 이 targeted 범위에서 확인했다.
- root check 최종(17:33 KST) 통과, Biome 자동 수정 없음. 앞선 자동 포맷 결과도 확인했다. build·전체 npm test/Vitest suite·실제 유료 Provider·실제 package install은 실행하지 않았다.
- 최종 `git diff --check`, 변경 문서 상대 링크/fence/공백·LOG-001~009 고유 ID·S5A~S5D 소제목 검사 통과. 새 untracked R2 테스트 공백도 별도 검사했으며 임시 checker는 제거했다.

### 실제 Pi interactive smoke

- interactive-testing skill의 80×24 tmux에서 `pi-test.sh`를 사용했다. 임시 Extension을 `-e`로 명시 로드하고 같은 registerCompanyRuntime에 기존 suite harness/faux ModelRuntime을 주입했다.
- 별도 HOME/agentDir·`env -i`·`--offline --approve --provider faux --model coding --no-session`과 네 개의 임시 Git fixture를 사용했다. 실제 인증 정보/원격 추론/유료 token은 사용하지 않았다.
- PASS: STANDARD/R2·서로 다른 역할 세션 2개·SELF_CHECK/TEST PASS·COMPLETED 확인.
- REVISE→PASS: 회차 1, 새 세션 포함 총 4개, checks PASS 3개·COMPLETED 확인.
- BLOCK: REVIEW/BLOCKED, SELF_CHECK만 PASS, manifest/lockfile partial changes yes 확인.
- live Reviewer cancel: REVIEW/CANCELLED, 부분 변경·mandatory review 표시 및 reload 후 `/risk` 저장 상태 조회 확인. `/workflow status`, `/team`, `/state`, `/risk`도 확인했다.
- 종료 후 각 fixture의 Run risk/workflow/session/action/check와 writer.lock 부재를 검사했다. 설치된 node_modules가 없음을 확인하고 tmux·임시 fixture/script를 제거했다. 실제 작업 저장소 `.ai`는 생성하지 않았다.

### 문제와 해결·남은 제한

- R2 Policy의 ALLOW만으로는 저장된 run이 R1인지 알 수 없으므로 StateStore의 실제 run 검사도 필요했다. 잘못된 durable owner에서 executor 호출 0을 검증했다.
- 단순한 Reviewer PASS 데이터는 현재 회차의 독립 세션 실행을 증명하지 못한다. Kernel이 callback으로 등록한 현재 Developer/Reviewer 참조를 보유하고, 새 IMPLEMENT 때 이전 Reviewer 참조를 비우도록 했다. REVISE 후 등록을 생략한 SDK fixture로 COMPLETE 차단을 확인했다.
- Policy 거부를 SDK의 일반 tool-error 문구로만 보고하면 R2 재실행 필요가 숨겨졌다. 신뢰된 Policy 문자열만 별도 전달하여 해결했다. 원격 Provider 오류 로그를 그대로 노출하는 변경은 아니다.
- R2의 모든 의미적 위험이나 dependency 설치 상태를 증명하는 기능은 아니다. manifest/lockfile 텍스트 변경과 명시적 사용자 check만 지원한다. 실제 lockfile 생성·패키지 설치/호환성 검증은 별도 사용자 구성·권한이 필요하다.
- 등록 check는 trusted code이며 변경 가능한 metadata/프로젝트 코드를 읽어 간접 실행할 수 있다. 해당 프로그램의 내부 script·네트워크·설치 동작을 sandbox하지 않는다. 검증 명령과 간접 실행 대상도 사용자가 검토해야 한다. 기존 macOS/POSIX·TOCTOU·비협조 I/O·탈출 daemon·파일 한도를 유지한다.
- action risk가 R2로 승격되어 거부돼도 실행 중 Run risk를 자동 변경하지 않는다. 초기 분류는 Run에, action의 더 높은 risk/거부는 audit와 오류에 남는다. 사용자가 변경을 확인하고 새 R2 run을 시작해야 한다.
- R3 Human Approval, COMPLEX/Lead/Planner, DAG/병렬 실행/T3Code/RPC/Web, 자동 checkpoint/resume/fallback, decisions/log UI polish는 추가하지 않았다.

### 다음 단계와 커밋

**S5C 진입 가능**하다. 사용자 승인 후 제한된 action의 Human Approval binding을 별도 단계로 구현한다. R2 run binding을 Human Approval로 재사용하지 않으며 S4/S5A/S5B 회귀를 계속 유지한다.

**이번 S5B 커밋·푸시: 하지 않음.** S5A 변경과 함께 작업 트리에 남겨둔다.

---

## LOG-010 — S5C: 한정 R3 Human Approval

- **기록일:** 2026-09-15 18:28 (KST)
- **상태:** 완료 — Git 추적 텍스트 파일 한 개 삭제에만 실제 인간 승인을 연결했다. 범용 R3 실행은 미지원이다.
- **목적:** R2 실행 binding이나 일반 run 확인을 인간 승인으로 오인하지 않고, 실행 직전 exact/expiring/one-use consent를 강제한다. S4/S5A/S5B 회귀가 우선이다.
- **시작 상태:** devlop, HEAD `e80d97272`. S5A/S5B의 기존 미커밋 tracked/untracked 변경을 보존했다.

### 지원 범위와 설계

- 지원 grammar: `Delete file <literal 상대 경로>`, `Remove file <literal 상대 경로>`, `파일 삭제 <literal 상대 경로>`.
- clean Git baseline에서 추적 중인 256 KiB 이하 일반 UTF-8 파일 한 개만 대상으로 한다. 기존 allowed/protected 경로 규칙, symlink/hardlink/특수 파일 거부를 유지한다. Runtime/.git/알려진 credential·dependency manifest, node_modules, 디렉터리·대량 삭제·임의 shell·배포는 승인으로 열리지 않는다.
- R3 Developer는 read/search, runtime_delete, check 요청, structured handoff만 사용한다. 일반 write/edit가 없다. R3 scope는 run ID/대상에 고정하고 R2/QUICK binding과 혼합하지 않는다. R3도 coding/reasoning 모델·인증과 독립 Reviewer가 필요하다.
- 실제 삭제를 포함하지만 개발 중 effect는 테스트가 새로 만든 temporary Git fixture에만 적용했다. 사용자 저장소 파일 삭제·실제 deploy/install·유료 inference는 수행하지 않았다.

### 승인 binding과 실행 경계

- ApprovalRequest/Decision/Record schema와 기존 ApprovalPort를 연결했다. run/action ID, role, operation, path, file fingerprint/byte 수, step/attempt, revision, action/config digest와 expiresAt을 고정한다. UI 응답은 같은 run/action/digests/expiry와 정확한 boolean 승인만 수락한다.
- Kernel은 PENDING 기록을 저장하고 WAITING_APPROVAL로 진입한 뒤 Host authority를 호출한다. 기본 TTL은 30초, Host의 approvalTimeoutMs는 1~60,000ms다. YAML 권한 완화 옵션은 추가하지 않았다. worker 총 timeout도 적용된다.
- 거절·UI 부재/오류·취소·만료·잘못된 binding·늦은 긍정 응답은 실행 허가가 아니다. timeout/cancel은 signal을 통해 UI를 닫고, 비협조 authority의 늦은 응답도 재사용하지 않는다.
- ALLOW 전후에 Policy와 StateStore가 정확한 승인/현재 R3 Developer/단계/expiry를 검사한다. 실제 unlink 직전 파일 dev/ino/mode/size/mtime/ctime/bytes hash, 정규화 config, signal과 만료를 다시 확인한다. 마지막 확인부터 unlink까지 JS yield는 없지만 외부 syscall 경합까지 원자적이라는 주장은 하지 않는다.
- 고유 action ID의 durable prepare/finish가 재사용을 막는다. action SUCCEEDED가 저장된 뒤에만 승인 CONSUMED 기록을 저장한다. ledger의 request metadata/과거 기록은 수정·삭제할 수 없고 허용된 상태 전이만 가능하다.
- 재시작 시 미완료 PENDING/APPROVED grant는 INTERRUPTED로 남고 자동 재승인·실행·resume하지 않는다. 취소/실패 뒤 approval과 실제 effect의 기록을 구분한다.

### 완료·관찰·UI

- 소비된 승인 없이 SELF_CHECK로 넘어가지 않는다. 실제 단일 삭제 diff, 구조화 handoff/요구사항, 현재 회차의 다른 Developer/Reviewer session ID·파일, 독립 PASS, 필수 SELF_CHECK/TEST와 최신 digest가 모두 있어야 Kernel만 COMPLETE를 저장한다.
- R3 revision 한도는 0이다. REVISE/BLOCK은 중단하며 인간 승인으로 재작업/복원 권한까지 주지 않는다. 승인 후 Provider/check/storage 실패는 이미 삭제된 파일을 partial changes로 보고하며 rollback하지 않는다.
- 기존 RuntimeEvent에 ApprovalRequested/Resolved/Consumed를 연결하고 (runId, stepId, attempt)·sequence·저장 후 발행을 유지했다. 전체 대화/승인 원문 UI 로그를 state에 복제하지 않고 구조화 metadata만 저장한다.
- Pi UI는 project/run/role/step/target/bytes/fingerprint/action/expiry와 No rollback 안내를 표시한다. 기본 선택은 Deny이고 Approve once를 명시적으로 골라야 한다. `--approve`의 project trust나 초기 check 확인으로 R3 승인을 대체하지 않는다.
- modal이 열려 있을 때 터미널 입력은 dialog 선택/Esc/ctrl+c가 우선이며 Esc는 이번 승인 거부다. Host의 status/cancel 및 lifecycle은 계속 동작하고 pending UI/worker를 signal로 정리한다. 다른 단계에서 부모 Esc가 worker를 자동 취소한다고 가정하지 않는다.

### 변경 파일

- 신규 `packages/company-runtime/src/approval.ts`: 제한된 scope 선택, exact decision 검사, 시간 제한/취소/늦은 응답 무효화. Pi/파일 시스템 구현을 import하지 않는다.
- `src/{contracts,ports,events,classification,kernel}.ts`: 승인 schema/Port/callback, 단일 삭제 분류, WAITING_APPROVAL/ledger/event와 소비 증거 완료 guard.
- `src/{policy,state-store,agent-runner,agent-tools}.ts`: bound deletion operation, SDK callback 분리, fingerprint/config 재검사, 실제 unlink, durable approval/intent/consumption/recovery 검사.
- `src/{workspace,verification,workflow,extension}.ts`: tracked 대상 preflight·삭제 diff, 기존 검증기/순차 owner 재사용, human UI·deadline·lifecycle·상태 표시.
- 신규 테스트 `packages/company-runtime/test/approval.test.ts`, `packages/coding-agent/test/suite/company-runtime-approval.test.ts`.
- 문서 `docs/IMPLEMENTATION_PLAN.md`, `docs/WORK_LOG.md`, `packages/company-runtime/README.md`.
- MASTER_SPEC/ARCHITECTURE/DECISIONS, Pi Core, dependency/lockfile, config YAML schema, process runner/path inspector는 변경하지 않았다. ADR-004/006/008/011의 기존 승인·상태·증거·Host 경계를 구현했으며 별도 ADR/범용 승인 서버/Event Bus를 만들지 않았다.

### 이번 작업의 자동 검증

```sh
# packages/company-runtime
node ../../node_modules/vitest/dist/cli.js --run test/approval.test.ts test/r2-review.test.ts test/quick.test.ts test/agent-metadata.test.ts test/contracts.test.ts test/config.test.ts test/extension.test.ts test/classification.test.ts test/kernel.test.ts test/host-boundary.test.ts test/state-store.test.ts test/policy.test.ts test/verification-boundary.test.ts

# packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run test/suite/company-runtime-approval.test.ts test/suite/company-runtime-r2.test.ts test/suite/company-runtime-quick.test.ts test/suite/company-runtime-workflow.test.ts test/suite/company-runtime-agent.test.ts test/suite/agent-session-prompt.test.ts

# root
npm run check
git diff --check
```

- 최종 targeted tests(18:27 KST): Runtime **13개 파일·383개**, coding-agent **6개 파일·225개**, 합계 **19개 파일·608개 통과**. S5C 신규 unit 43개 + faux integration 43개 = **86개**. LOG-009의 522개는 S5B 당시 결과이며 전체 저장소 suite 수가 아니다.
- 승인/거절/부재/오류/expired/취소/다른 binding/late consent, target/config/symlink 재검사, 승인 뒤 저장 지연으로 만료, 중복 delete, 소비 callback 누락, handoff-only 우회, 보호·미추적 대상, R3 write/edit/bash 미노출, 독립 BLOCK/REVISE, 필수 checks/stale diff/Provider/intent·consumption·COMPLETE 저장 실패를 검증했다.
- durable replay·expiry·digest mismatch·ledger 변조·소비 증거 위조·재시작 미완료 grant 중단, live final-check 취소, pending approval의 status 조회·Host shutdown, 기본 Deny/명시적 승인 UI composition을 검증했다.
- S0~S5B와 기존 AgentSession prompt 회귀도 이번에 다시 통과했다. root check 최종(18:32 KST)은 TypeScript/deps/entry graph/shrinkwrap/install lock/browser smoke를 포함해 통과했고 Biome 자동 수정이 없었다. 앞선 자동 포맷 결과도 확인했다. build·전체 npm test/Vitest suite·유료 Provider·실제 install/deploy는 실행하지 않았다.
- 최종 `git diff --check`, 문서 상대 링크/fence/공백·LOG-001~010 고유 ID·S5A~S5D 제목 검사 통과. 신규 untracked approval 소스/테스트 공백도 별도 검사했으며 임시 checker는 제거했다.

### 실제 Pi interactive smoke

- interactive-testing skill의 80×24 tmux에서 `pi-test.sh`와 명시적 `-e` wrapper를 사용했다. 기존 suite harness/faux ModelRuntime만 주입하고 **human ApprovalPort는 실제 Extension UI 그대로** 사용했다.
- 별도 HOME/agentDir, `env -i`, `--offline --approve --provider faux --model coding --no-session`, 새 Git fixture 4개를 사용했다. `--approve`를 줬어도 별도 R3 선택 창이 열리고 승인 전 파일이 존재함을 확인했다.
- allow: 기본 Deny 화면의 대상/fingerprint/expiry를 확인한 뒤 Down → Approve once. 삭제 1회, CONSUMED, Developer/Reviewer 세션 2개, checks PASS 2개와 COMPLETED 확인.
- deny: 기본 선택에서 Enter. DENIED/BLOCKED, 원본 파일 유지, 실행 action/검증 없음. reload 후 `/state`에서도 DENIED를 확인했다.
- escape: 승인 modal에서 Esc. DENIED/BLOCKED와 원본 유지 확인.
- expire: 테스트 Host TTL 1,200ms를 사용해 선택하지 않고 대기. EXPIRED/BLOCKED와 원본 유지 확인.
- `/team`, `/risk`, `/state` 출력도 확인했다. 종료 뒤 네 fixture의 approval/run/action/check/session/file 상태와 writer.lock 부재를 검사한 후 tmux·임시 fixture/script를 제거했다. 실제 저장소 `.ai`는 생성하지 않았다.

### 문제와 해결·남은 한계

- 첫 integration에서 중복 delete의 audit 길이를 1로 기대해 실패했다. 구현은 승인된 삭제 SUCCEEDED 1개와 두 번째 요청 DENIED 1개를 남겼다. 실행이 한 번인지와 거부 기록을 구분하도록 기대값을 수정하고 전체 테스트를 다시 통과했다.
- 승인 시점과 effect 시점 사이에 저장이 yield할 수 있으므로 human answer만 검사해서는 부족했다. durable prepare와 최종 fingerprint/config/signal/expiry 확인을 함께 적용했다. 긍정 응답 후 저장 지연으로 만료되는 테스트도 포함했다.
- 승인 소비를 callback 주장만으로 저장하면 실행 없이 CONSUMED를 꾸밀 수 있었다. StateStore가 동일 action의 SUCCEEDED를 확인하도록 했고 위조 소비를 거부했다.
- ApprovalPort는 신뢰된 Host authority다. 악성 같은-process 코드가 authority/UI를 위조하는 것을 막는 OS 보안 경계나 다중 사용자 인증 서버는 아니다. 경로/파일 종류 식별은 기존 명시적 allow/protect 규칙이며 숨겨진 비밀이나 모든 dependency 형식을 의미적으로 판별하지 않는다.
- 단일 텍스트 파일 삭제만 지원한다. R3 재작업·자동 복원/rollback, 범용 shell·배포·대량 삭제·설치, checkpoint/resume/parallel/COMPLEX/DAG/RPC/Web은 추가하지 않았다.
- unlink와 state/tasks 저장은 다중 transaction이 아니다. 파일 삭제 후 I/O 실패가 남을 수 있으며 partial changes/audit를 사용자가 확인해야 한다. 외부 TOCTOU·탈출 daemon·비협조 I/O·전원 장애 내구성 등 기존 한계는 유지한다.
- 승인 gate는 Runtime의 delete tool을 보호한다. 등록된 verifier 프로그램은 여전히 trusted code이며 내부의 임의 I/O/네트워크를 sandbox하지 않는다. consumed deletion 기록 전에는 checks를 시작하지 않지만 프로그램 내부 부작용까지 가로채는 기능은 없다.
- 승인 대기 동안 worker 전체 실행 한도도 흐른다. UI timeout은 1회 consent의 기한이며 모든 비협조 외부 작업을 그 시간 안에 강제 종료한다는 보장은 아니다.

### 다음 단계와 커밋

**S5D 진입 가능**하다. 사용자 승인 후 Commands/State/Decision polish를 진행하며 STANDARD/QUICK/R2/한정 R3 회귀를 유지한다. 전체 V0.1 완료나 범용 R3 권한 해제를 주장하지 않는다.

**이번 S5C 커밋·푸시: 하지 않음.** 기존 S5A/S5B 변경과 함께 작업 트리에 보존했다.

---

## LOG-011 — S5D: Commands / State / Decision polish

- **기록일:** 2026-09-15 19:51 (KST)
- **상태:** 완료 — 읽기 전용 조회, 구조화 운영 결정/검증 projection과 기존 revision 설정 연결. S6는 미착수.
- **목적:** 상태를 보는 행위가 복구/승인/실행을 바꾸지 않게 하고, 현재·저장·실패 결과를 구분하여 조회한다. S4/S5A/S5B/S5C 회귀 방지가 우선이다.
- **시작 상태:** devlop, HEAD `e80d97272`; 기존 S5A~S5C의 미커밋 tracked/untracked 변경을 보존했다.

### 명령과 읽기 전용 경계

- `/workflow status [runId]`, `history [page]`, `config`; `/state [runId]`, `checks [runId] [page]`, `check <number> [runId]`, `review [runId]`, `decisions [runId] [page]`; `/team [runId]`, `/risk [runId]`, 각 help를 연결했다. 생략/latest는 최신 run이며 unknown ID/check/page는 오류다.
- FileStateStore.readSnapshot은 state source를 안전하게 읽을 뿐 lock 생성/탈취, mkdir, tasks repair, interruption/grant recovery를 수행하지 않는다. 다른 writer의 atomic 저장과 동시에 읽을 수 있다. state가 없거나 손상되면 projection이나 이전 성공 cache로 대체하지 않는다.
- UI에 source·recorded 시각·현재 filesystem/check 미재검증을 표시한다. writer.lock은 존재 여부일 뿐 생존 증명이 아니다. 외부 owner의 stored active 상태는 liveness unconfirmed이며 취소는 owner Pi에서 해야 한다.
- 현재 local 저장 실패가 durable snapshot과 다르면 local 실패를 우선 표시하고 durable 상태를 함께 알린다. 원본이 손상된 경우 이전 cached COMPLETE를 보여주지 않는다. tasks 불일치는 진단만 출력한다.
- 조회는 config/provider/auth 없이 동작한다. `/workflow config`만 현재 설정을 별도 검사하고 active run의 frozen config가 아님을 표시한다. 출력은 pagination/크기 제한, terminal/bidi escaping을 적용한다. Pi JSONL을 열거나 전체 대화/usage를 복제하지 않는다.

### 기록과 revision

- Run에 적용된 `maxRevisionCycles`, 구조화 Developer `handoff`, 수락된 회차별 `reviewHistory`를 저장한다. REVISE/BLOCK도 잃지 않는다. 새로운 actual CheckResult에는 step/attempt를 기록하며 Kernel이 envelope와 일치하는지 검사한다.
- 기존 config의 STANDARD 재작업 0~3을 Host 실행에 연결했다. 기본 1은 그대로다. QUICK/한정 R3는 effective 0이며 R3 승인으로 재작업을 열지 않는다. 3회 REVISE→PASS 및 한도 초과, QUICK/R3 0회 고정을 faux로 검증했다.
- 운영 결정은 classification, review, approval, policy action, outcome의 안정적 ID로 표현한다. 기술적 ADR을 LLM로 새로 추론하는 기능은 아니다. 체크의 stage/timing/limit가 이전 기록에 없으면 not recorded로 표시한다.
- 관찰 event delivery 실패는 local diagnostics로만 표시하며 execution result를 바꾸지 않는다. 순차 Step/attempt/RuntimeEvent와 기존 completion/Policy/Approval guard는 유지했다.

### 명시적 export와 파일 소유권

- `/state export`는 idle/terminal source에서 owned writer로 `.ai/decisions.md`와 `.ai/logs/checks.json`을 생성한다. 자동 export/자동 gitignore/자동 commit은 하지 않는다. export-only open은 active source를 거부하고 interruption recovery와 tasks repair도 건너뛴다.
- 원본은 계속 state.json이다. 파생본에는 source revision/hash, 생성 marker/body checksum이 있고 동일 source 재export는 무변경이다. 사용자 수동 파일 또는 수정되어 checksum이 깨진 파일, unsafe 경로는 덮어쓰지 않는다. 강제 overwrite 옵션은 없다.
- 파일별 temp/write/sync/rename과 parent/target/ownership 재검사를 사용한다. 한 파일만 갱신되고 다음 파일이 실패할 수 있으므로 전체 transaction으로 주장하지 않는다. export 실패가 완료된 Run을 실패로 재기록하거나 source를 바꾸지 않으며 재export할 수 있다.
- 실제 source state/approval/verification을 파생 파일에서 복원하지 않는다. Markdown은 데이터의 markup/control을 escape하며 logs JSON에는 기존 bounded check evidence만 담는다. transcript/전체 diff는 추가 복제하지 않는다.
- Git evidence는 정확한 두 generated 경로의 온전한 marker/checksum만 조건부 제외한다. tracked generated view는 거부하고, 수동 내용/깨진 checksum은 일반 evidence로 수집한다. Git ignored checks.json의 수동 변경도 감지한다. `.ai`/logs 디렉터리 전체를 무조건 제외하지 않는다.

### 변경 파일

- 신규 `packages/company-runtime/src/observations.ts`: 작은 observation DTO, safe/bounded command views, history/config/check/review/decision 렌더링.
- 신규 `src/observation-files.ts`: 고정 export 경로의 안전한 읽기, generated ownership/checksum, deterministic output과 원자 파일 교체.
- `src/{contracts,kernel,verification}.ts`: 최소 metadata 저장, review 회차 보존과 check step 일치 검사. 추가 저장 전이를 늘리기보다 기존 save payload에 포함했다.
- `src/{state-store,workspace,workflow,extension}.ts`: readonly snapshot/export-only ownership, 조건부 Git 제외, 실제 revision 설정, 명령/diagnostics·lifecycle 연결.
- 신규 `test/observations.test.ts`, `test/observation-files.test.ts`, `packages/coding-agent/test/suite/company-runtime-observations.test.ts`.
- 문서 `docs/IMPLEMENTATION_PLAN.md`, `docs/WORK_LOG.md`, `packages/company-runtime/README.md`.
- 이번 S5D에서 MASTER_SPEC/ARCHITECTURE/DECISIONS, Pi Core, dependency/lockfile, config schema, Policy/Approval 집행 로직·worker 도구·RuntimeEvent 정의·process runner/path inspector는 변경하지 않았다. 별도 graph/event sourcing/서버/SQLite 아키텍처를 만들지 않았으므로 새 ADR은 추가하지 않았다.

### 이번 작업의 검증

```sh
# packages/company-runtime
node ../../node_modules/vitest/dist/cli.js --run test/observations.test.ts test/observation-files.test.ts test/approval.test.ts test/r2-review.test.ts test/quick.test.ts test/agent-metadata.test.ts test/contracts.test.ts test/config.test.ts test/extension.test.ts test/classification.test.ts test/kernel.test.ts test/host-boundary.test.ts test/state-store.test.ts test/policy.test.ts test/verification-boundary.test.ts

# packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run test/suite/company-runtime-observations.test.ts test/suite/company-runtime-approval.test.ts test/suite/company-runtime-r2.test.ts test/suite/company-runtime-quick.test.ts test/suite/company-runtime-workflow.test.ts test/suite/company-runtime-agent.test.ts test/suite/agent-session-prompt.test.ts

# root
npm run check
git diff --check
```

- 최종 targeted tests(19:50 KST): Runtime **15개 파일·419개**, coding-agent **7개 파일·236개**, 합계 **22개 파일·655개 통과**. 신규 unit/filesystem 36개 + faux integration 11개 = **47개**. 앞서 보고한 654개에 export-only tasks 미수정 테스트 1개를 추가한 최종 수치다. LOG-010의 608개는 당시 결과이며 전체 저장소 suite 수가 아니다.
- 조회 무변경/atomic writer 병행 읽기/복구 금지/unsafe source·손상·orphan 거부, stage/timing/output/페이지/출처/제어문자, generated idempotence·수동/수정 파일·symlink·rename 직전 교체·부분 export 실패·source 불변을 검증했다.
- Git의 generated 조건부 제외·tracked 생성 파일 거부·수동/ignored 파일 변경 감지, configured revision3/한도 초과/QUICK·R3 0, review/handoff/check metadata, 다른 owner의 pending approval 조회, model 호출 없는 query/export, local 실패와 durable 차이·성공 cache 뒤 corruption도 검증했다.
- 기존 S0~S5C와 Pi AgentSession prompt 회귀를 이번에 다시 실행했다. root check 최종(19:53 KST) 통과, Biome 자동 수정 없음. 앞선 자동 포맷 결과도 확인했다. build·전체 npm test/Vitest suite·유료 Provider·실제 install/deploy는 실행하지 않았다.
- 최종 `git diff --check`, 문서 상대 링크/fence/공백·LOG-001~011 고유 ID·S5A~S5D 제목 검사 통과. 새 untracked observation 소스/테스트 공백도 검사했으며 임시 checker는 제거했다.

### 실제 Pi interactive smoke

- interactive-testing skill의 80×24 tmux, `pi-test.sh`, 명시적 `-e` wrapper와 기존 suite harness/faux ModelRuntime을 사용했다. 별도 HOME/agentDir·`env -i`·offline·temporary Git fixture만 사용했다.
- `/workflow config`는 source state를 생성하지 않았고 STANDARD 3 / QUICK·R3 0을 정확히 표시했다.
- 실제 run은 REVISE 3회 뒤 PASS/COMPLETED, code revision3, Developer/Reviewer session 총8개, actual checks5개를 기록했다.
- `/workflow status`, history, `/team`, `/risk`, `/state checks`, check5의 stdout/stderr/step/시간, review 이력, decisions page2를 확인했다.
- `/state export` 첫 호출 updated2, 같은 source 재호출 updated0을 확인했다. 조회/export 전후 state.json SHA-256이 동일했고 config/gitignore를 자동 수정하지 않았다.
- 생성된 decisions를 테스트용 USER_MANUAL_NOTES로 바꾼 뒤 재export가 거부되고 내용이 유지됨을 확인했다. reload 후 저장 review/history 조회와 잘못된 check 번호 오류도 확인했다.
- run의 faux inference는 9회였고 observations/export 때문에 추가되지 않았다. source bytes 불변·manual notes 보존·writer.lock 부재를 검사한 뒤 tmux와 임시 fixture/script를 제거했다. 실제 저장소 `.ai`는 생성하지 않았다.

### 문제와 해결·남은 한계

- 초기 check가 새 integration test의 미사용 import 2개를 지적했다. 저장 실패/corruption 검증을 완성하고 최종 check를 통과했다.
- 초기 integration은 Markdown의 UUID 하이픈 escape 때문에 raw stable ID를 찾지 못했다. newline/control/markup escaping을 유지하면서 안전한 하이픈·점은 그대로 출력하도록 수정했고 전체 테스트를 다시 통과했다.
- 단순 snapshot 조회에서 FileStateStore.open을 쓰면 lock/recovery/repair가 발생하므로 별도 readonly 경계를 만들었다. export-only open도 tasks를 고치지 않도록 명시적으로 분리했다.
- generated 출력 전체를 무조건 Git에서 제외하면 수동 변경을 숨길 수 있으므로 exact path + ownership/checksum을 사용했다. checksum은 accidental modification 구분이며 악성 동일 사용자에 대한 인증 서명/OS sandbox는 아니다.
- export는 운영 결정의 projection이지 기술 ADR 작성·전체 RuntimeEvent 로그·자동 archive가 아니다. 수동 decisions 파일은 보존되지만 CLI decisions는 state 기반 운영 기록을 보여준다. 필요 시 사용자가 수동 파일을 별도로 관리해야 한다.
- snapshots는 당시 저장 사실이며 live diff/check 또는 다른 프로세스 생존 증명이 아니다. local diagnostics는 reload 후 사라질 수 있고, state/tasks가 원자적 한 묶음이 아니므로 부분 저장/일시 불일치 경고를 확인해야 한다.
- output/source/export 크기 한도와 외부 TOCTOU·비협조 I/O·POSIX/단일 writer·R3 한정 범위는 유지한다. exporter는 민감한 check output을 자동 탐지하지 않으므로 파생 파일을 공개/commit하기 전에 검토해야 한다.
- S6 hardening, 범용 R3, COMPLEX/Lead/Planner, DAG/RPC/Web/parallel, 자동 resume/checkpoint/fallback은 구현하지 않았다.

### 다음 단계와 커밋

**S6 진입 가능**하다. 사용자 승인 후 실패·복구·플랫폼/lifecycle 경계와 전체 V0.1 DoD 추적을 hardening한다. S5D 완료를 전체 V0.1 완료나 전체 저장소 회귀 없음으로 확대 해석하지 않는다.

**이번 S5D 커밋·푸시: 하지 않음.** 기존 S5A~S5C 변경과 함께 작업 트리에 보존했다.

---

## LOG-012 — S6: V0.1 실패 경계 Hardening

- **기록일:** 2026-09-16 09:28 (KST)
- **상태:** 완료 — 신규 제품 기능/권한 확대 없이 기존 기능의 실패 경계를 보강했다. V0.1 release 선언 아님.
- **목적:** Provider/process/storage/approval/freshness/lifecycle 실패에서 완료를 위조하거나 자원 종료 전에 writer lease를 해제하지 않도록 검증한다.
- **시작 상태:** devlop clean, HEAD/origin `fa83746a170c26074f460eb42afa16b42197fe9c`. 앞선 S5A~S5D 변경은 사용자 요청으로 커밋/푸시된 상태다. 이전 LOG의 커밋 미실행 표시는 각 작업 당시 기록으로 유지한다.
- **환경:** Darwin arm64, Node v26.7.0, 로컬 Git/파일 시스템/POSIX process group. 다른 OS나 실제 Provider를 테스트한 결과로 확대하지 않는다.

### 발견 문제와 수정

1. **저장 실패의 조기 unlock:** Store.fail이 tool result 저장 실패에서도 즉시 lock을 지워 SDK cleanup 이전에 다른 writer가 들어올 수 있었다. 실패 시 mutation만 닫고, 실행 소유자가 자원 종료 후 close하도록 변경했다. open 실패처럼 worker가 아직 없는 경로는 기존 자체 정리를 유지한다. 동시 close도 같은 promise로 합쳐 두 번째 해제가 새 writer의 lock과 경합하지 않게 했다.
2. **정산과 종료 확인 혼동:** SDK abort/dispose 실패 또는 process runner 예외에서도 호출 promise가 끝났다는 이유로 unlock될 수 있었다. 작은 safeToRelease 상태와 ProcessCleanupError로 미확인을 owner까지 전달한다. 불확실하면 다음 역할/COMPLETE·추가 Git 수집을 막고 lock을 유지하며 changedFiles 수집 불완전을 표시한다.
3. **Git process 예외 누락:** preflight에서 GitWorkspace 객체 반환 전 cleanup 오류도 lease 보존 대상이 되게 했다. COMPLETE 뒤에는 별도 Git process를 다시 시작하지 않고 완료 직전 검증한 snapshot을 보고한다.
4. **check/cancel 및 partial persistence:** check settlement 전 취소는 PASS가 아니며, audit finish 실패를 두 번째 finish로 재시도해 원래 partial commit 오류를 덮지 않게 했다. pipe error도 종료 요청 사유로 처리한다.
5. **이전 attempt 참조:** session ID가 달라도 이전 sessionFile을 재사용하면 Kernel이 거부한다.
6. **FIFO/config 파일 경계:** no-follow descriptor에 POSIX nonblocking을 추가하고 regular-file 검사를 유지해 FIFO open 대기를 피한다. config directory/file identity·크기도 검사한다. Windows owner 실행은 lock 획득 전에 명시적으로 거부하며 Windows 구현을 추가하지 않았다.

정상 정리는 `cancel signal → SDK/process 종료 확인 → terminal state 저장 → lock release`다. cleanup 미확인 또는 state 저장 불가에서는 failure 진단/기존 PREPARED 기록과 lock이 남을 수 있으며, 이를 성공이나 미실행으로 추정하지 않는다. 확인 가능한 SDK 작업/원래 process group 밖의 daemon·악성 Node I/O를 격리하지는 않는다.

### 변경 파일

- `packages/company-runtime/src/{state-store,ports,agent-runner,verification,workflow,workspace,kernel,process-runner}.ts`: mutation 차단과 lease 수명 분리, cleanup 확인/전파, cancel/finish 경계, 참조 재사용 guard.
- `src/{agent-tools,observation-files,config}.ts`: no-follow/nonblocking descriptor와 config identity/size 검사. 도구 종류·R3 승인 scope·config schema는 넓히지 않았다.
- `test/state-store.test.ts`: 실패 시 lease가 owner close까지 유지되는 강화된 계약에 맞춰 assertions를 갱신했다. invalid/partial state 거부·복구 검증은 유지한다.
- 신규 `test/hardening.test.ts`, `test/kernel-hardening.test.ts`, `packages/coding-agent/test/suite/company-runtime-hardening.test.ts`.
- 문서 `docs/V0.1_READINESS.md` 신규, `docs/IMPLEMENTATION_PLAN.md`, `docs/WORK_LOG.md`, `packages/company-runtime/README.md` 갱신.
- MASTER_SPEC/ARCHITECTURE/DECISIONS, Pi Core, dependencies/lockfile, 제품명/패키지명, SDK/Host 경계와 순차 Workflow는 유지했다. 신규 DAG/RPC/Web/Lead/Planner/COMPLEX/parallel/generic R3/resume/fallback/SQLite/OS sandbox를 추가하지 않았다.

### 이번 작업의 자동 검증

```sh
# packages/company-runtime
node ../../node_modules/vitest/dist/cli.js --run test/hardening.test.ts test/kernel-hardening.test.ts test/observations.test.ts test/observation-files.test.ts test/approval.test.ts test/r2-review.test.ts test/quick.test.ts test/agent-metadata.test.ts test/contracts.test.ts test/config.test.ts test/extension.test.ts test/classification.test.ts test/kernel.test.ts test/host-boundary.test.ts test/state-store.test.ts test/policy.test.ts test/verification-boundary.test.ts

# packages/coding-agent: Runtime + 기존 prompt
node ../../node_modules/vitest/dist/cli.js --run test/suite/company-runtime-hardening.test.ts test/suite/company-runtime-observations.test.ts test/suite/company-runtime-approval.test.ts test/suite/company-runtime-r2.test.ts test/suite/company-runtime-quick.test.ts test/suite/company-runtime-workflow.test.ts test/suite/company-runtime-agent.test.ts test/suite/agent-session-prompt.test.ts

# packages/coding-agent: 추가 기존 Pi 회귀 (Company Extension 미등록)
node ../../node_modules/vitest/dist/cli.js --run test/suite/agent-session-runtime.test.ts test/suite/agent-session-model-extension.test.ts test/suite/agent-session-retry-events.test.ts test/suite/agent-session-queue.test.ts

# root
npm run check
git diff --check
```

- 최종 실행(09:36 KST): Runtime **17개 파일·453개**, 관련 coding-agent **8개 파일·287개**, 합계 **25개 파일·740개 통과**. S6 신규 unit/process/crash23개 + kernel11개 + SDK/lifecycle51개 = **85개**이며 기존655개를 이번에 다시 실행했다. 09:16의 최초 전체 통과 뒤 동시 close 검증 1개를 추가하고 모두 재실행한 수치다.
- 추가 기존 Pi runtime/model-extension/retry-events/queue **4개 파일·59개 통과**. 최종 targeted 합계 **29개 파일·799개 통과**, 전체 저장소 suite 수가 아니다.
- Provider 연결/자연어/malformed/stream-aborted 결과를 Developer/Reviewer/Executor에 적용하고 late mutation·SDK cleanup 중 cancel·Reviewer model/auth 실패를 확인했다. 기존 S3 timeout/pre-abort/turn limit/resource isolation 테스트도 다시 실행했다.
- 실제 Node check의 signal exit·stdout/stderr limit·공백 경로·TERM 무시→KILL·group 확인 실패, check settlement/cancel 및 finish 실패 race, 초기 Git cleanup 미확인을 검증했다. SDK abort/dispose 예외와 R1/R3 actual effect 후 실제 rename 실패 중 지연 cleanup에서 lock이 유지됐다.
- 실제 별도 Node 프로세스를 state 저장/tasks 교체 사이 또는 effect/결과 저장 사이에서 종료시켰다. stale lock의 새 writer 획득 거부, 테스트 child 종료 확인 뒤 수동 정리한 owned recovery의 INTERRUPTED, 효과를 SUCCEEDED로 추정하지 않음을 확인했다. 실제 제품에는 자동 stale-lock 삭제를 넣지 않았다.
- approval의 정확한 expiry 경계·same-turn approve/cancel, 기존 target/config/symlink/late/replay/restart/소비 evidence, 실제 chmod 기반 effect 실패와 부분 저장을 검증했다. 이번 권한 오류 테스트는 비특권 macOS 사용자에서 실행됐고 root 환경에서는 명시적 skip 대상이다.
- 이전 Review/check revision·sessionFile·diff, stale QUICK executorDigest, check attempt 위조, terminal commit 전/후 cancel 경계를 검증했다. commit 시작 뒤 늦은 cancel은 이미 수락한 terminal 저장을 rollback하지 않는 것으로 명시했다. observer 오류는 delivery diagnostic이며 rollback으로 위장하지 않는다.
- Developer/Reviewer/check/approval 각각에 cancel/switch/fork/tree/reload/quit를 적용한 **24개 Host-handler lifecycle matrix**에서 cancel→resource 종료→terminal state→unlock 순서를 확인했다.
- root check 최종(09:39 KST) 통과, Biome 자동 수정 없음. 초기 Biome noUnsafeFinally 지적은 cleanup 오류를 finally 밖에서 보고하는 방식으로 수정했으며 suppress/검사 우회는 하지 않았다. 기존 state-store 실패 assertions는 안전한 지연 unlock으로 강화했다.
- 최종 `git diff --check`, 문서 상대 링크/fence/공백·LOG-001~012 고유 ID·readiness의 네 판정 상태 검사 통과. 신규 untracked S6 테스트 공백도 검사했고 임시 checker는 제거했다.
- build·전체 npm test/Vitest suite·실제 GPT/DeepSeek/API·package install/deploy·다른 OS는 미실행이다. 실제 Provider 검증은 별도 RC 단계로 남긴다.

### 실제 Pi interactive faux smoke

- interactive-testing skill의 80×24 tmux, 저장소 `pi-test.sh`, 명시적 `-e` wrapper, 기존 suite harness/faux ModelRuntime을 사용했다. 별도 HOME/agentDir·빈 자격 환경·offline·새 temporary Git fixture 5개였다.
- 성공: STANDARD COMPLETED, SELF_CHECK/TEST PASS와 lock 없음.
- active Developer `/workflow cancel`: IMPLEMENT/CANCELLED, 기존 fixed 부분 변경 유지, Provider의 late write 미실행, lock 없음.
- active Reviewer `/reload`: REVIEW/CANCELLED 저장 후 reload, status에서 늦은 PASS 미사용·부분 변경 확인.
- active verification `/reload`: SELF_CHECK/CANCELLED, check FAIL·lock 없음. 기록한 child process group이 ESRCH이고 5초 지연 write가 없음을 확인했다.
- active R3 approval modal Esc: DENIED/BLOCKED, 삭제 대상 원본 유지. reload 후 `/risk`에서도 DENIED를 확인했다.
- 실제 TUI switch/fork/tree 조작은 이번 smoke에서 하지 않았으며 자동 Host matrix 및 기존 Pi runtime 전환 tests로 구분해 검증했다. approval modal에서는 slash command 입력보다 dialog 응답이 우선한다.
- 각 fixture의 state/file/check/group/lock을 확인한 뒤 tmux·임시 fixture/script를 제거했다. 실제 작업 저장소 `.ai`는 만들지 않았고 실제 Provider 자격/유료 token은 사용하지 않았다.

### DoD / readiness와 남은 제한

- `docs/V0.1_READINESS.md`에 MASTER_SPEC §34를 PASS/PARTIAL/UNSUPPORTED/NOT VERIFIED로 대조했다. 분류 가능과 COMPLEX 실행 미지원, R0~R3 heuristic과 한정 실행, 운영 decisions projection과 기술 ADR 작성, 선택한 Pi 회귀와 전체 suite를 분리했다.
- macOS/Darwin arm64·Node26.7·로컬 POSIX 검증이다. Linux/최소 Node/Bun/다른 파일 시스템·전원 장애는 미검증이며 Windows 실행은 미지원이다. negative PID group, mode/access, no-follow/nonblocking FD, O_EXCL/inode와 atomic rename 가정을 문서화했다.
- Provider/auth/event sink/파일 I/O가 비협조적이면 timeout/cancel 이후에도 정리를 오래 기다릴 수 있다. 종료를 추정해 lease를 해제하지 않는다. 예상 밖 생성/cleanup 예외는 실제 자원이 없어도 보수적으로 lock을 남길 수 있다.
- cleanup 확인은 관리하는 SDK 작업과 원래 POSIX group에 한정된다. 다른 group으로 탈출한 daemon, 같은-process 악성 Host/등록 프로그램 내부 I/O·외부 TOCTOU는 sandbox하지 않는다. lock 유지 오류에서는 실제 resource/owner 확인 전 추가 workspace 작업을 하지 않아야 한다.
- partial state/tasks/효과 저장, terminal commit이 시작된 뒤의 late cancel, snapshot/liveness 구분과 observer best-effort 전달을 명시했다. 자동 rollback/resume/replay나 whole-repo·실제 Provider 안전성은 주장하지 않는다.

### 다음 단계와 커밋

**제한된 V0.1 RC 검증 진입은 조건부 가능**하다. 별도 사용자 승인 후 disposable 프로젝트의 실제 GPT/DeepSeek smoke, 지원 OS/Node 범위, 실제 프로젝트 checks와 설치/취약점/배포 검증 범위를 결정한다. S6 완료만으로 V0.1 release를 선언하지 않는다.

**이번 S6 커밋·푸시: 하지 않음.**

---

## LOG-013 — RC-01: QUICK/R0 정보성 known risk의 완료 의미 수정

- **기록일:** 2026-09-16 12:00 (KST)
- **상태:** 수정 및 자동 회귀 검증 완료. 수정 후 실제 Provider RC 재실행은 대기.
- **목적:** 실제 GPT Provider integration에서 드러난 QUICK/R0 설명 작업의 잘못된 완료 차단만 수정한다. 기능·권한·workflow 범위는 확대하지 않는다.
- **시작 상태:** `devlop` clean, HEAD `5ce99df59`. 작업 요청 cwd는 별도 `weavra-rc-fixture`이고 실제 Kernel은 형제 저장소 `pi/packages/company-runtime`에 있다.
- **환경:** macOS/Darwin arm64, Node v26.7.0. 이번 자동 검증은 로컬 unit 및 기존 suite harness/faux SDK 통합이며 실제 GPT 호출이 아니다.

### 실제 RC 문제와 원인

사용자가 GPT RC-01에서 `QUICK/R0 Explain src/calculator.js`를 실행했다. Provider/Worker, 구조화 Executor 결과, SELF_CHECK, TEST는 정상이었고 파일 변경도 없었다. Executor가 현재 코드의 division-by-zero 미처리를 `known_risks`로 보고하자 Kernel이 `QUICK requirements incomplete or risks unresolved; STANDARD required`로 BLOCKED 처리했다. 이는 사용자 보고로 확인된 실제 Provider integration issue이며 모델 ID·비용/지연은 보고되지 않아 추정하지 않는다.

`assertCanComplete()`의 QUICK 분기가 R0/R1 모두에 `handoff.known_risks.length === 0`을 요구했다. 따라서 설명을 마쳤고 unresolved가 없어도 기존 코드의 정보성 finding 하나만으로 완료가 거부됐다. LOG-008의 당시 모든 QUICK에 대한 known_risks 없음 조건은 이 후속 수정으로 R1에만 적용된다. 이전 이력 자체는 보존한다.

### 변경 파일과 한정된 수정

- `packages/company-runtime/src/kernel.ts`: 기존 조건을 `(evidence.quickScope.risk === "R0" || handoff.known_risks.length === 0)`으로 한정 변경했다. 앞선 trusted scope/workspace 검사와 R0 실제 changedFiles 0 요구는 그대로다. finding을 삭제하거나 필터링하지 않고 executorResult/state에 유지한다.
- `packages/company-runtime/test/quick.test.ts`: R0 known risk 허용/R1 STANDARD 요구를 명시적으로 검증한다. 기존 실패 matrix를 R0/R1에 적용하며 R0에는 known risk를 함께 넣어 unresolved·UNMET/UNVERIFIED·누락/잘못된 requirement·파일 변경·SELF_CHECK/TEST 실패·stale evidence·scope/revision 위반이 계속 차단됨을 확인한다.
- `packages/coding-agent/test/suite/company-runtime-quick.test.ts`: 기존 SDK/harness/faux/Git/verifier로 R0 COMPLETE/COMPLETED와 R1 BLOCKED 회귀 2개를 추가했다. 두 checks PASS, finding 보존, R0 무변경, R1 partial change·STANDARD 안내, durable state·terminal event·writer cleanup을 확인한다.
- `packages/company-runtime/README.md`: QUICK 완료 조건에 R0 finding과 R1 잔여 위험의 차이를 반영했다.
- `docs/V0.1_READINESS.md`, `docs/WORK_LOG.md`: 실제 RC 발견, 원인/수정, 자동 회귀와 실제 재실행 미검증을 구분해 기록했다.

공통 unresolved 0·정확한 requirements/MET, SELF_CHECK/TEST/exit/evidence/digest/state guard는 완화하지 않았다. QUICK/R1은 known risk가 남으면 계속 STANDARD 실행이 필요하다. R2/R3/STANDARD completion guard, Policy/Approval/StateStore/Provider 구현, 분류·prompt·schema는 변경하지 않았다. `weavra-rc-fixture`의 prompt·코드·config·저장된 run을 수정하지 않았다.

### 이번에 실행한 검증

수정 전 새 테스트로 문제를 재현했다:

```sh
# packages/company-runtime
node ../../node_modules/vitest/dist/cli.js --run test/quick.test.ts
# packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run test/suite/company-runtime-quick.test.ts -t 'RC-01'
```

- 수정 전 unit: **68 PASS / 1 FAIL**. R0 known-risk 허용 사례가 기존 STANDARD required 오류로 실패했다.
- 수정 전 신규 통합: **1 PASS / 1 FAIL / 기존 38개 필터 제외**. R0의 예상 COMPLETED 대신 BLOCKED를 확인했고, R1 차단은 이미 통과했다.

Kernel 수정 후 LOG-012와 같은 S0~S6 targeted 및 추가 Pi 회귀를 다시 실행했다:

```sh
# packages/company-runtime
node ../../node_modules/vitest/dist/cli.js --run test/hardening.test.ts test/kernel-hardening.test.ts test/observations.test.ts test/observation-files.test.ts test/approval.test.ts test/r2-review.test.ts test/quick.test.ts test/agent-metadata.test.ts test/contracts.test.ts test/config.test.ts test/extension.test.ts test/classification.test.ts test/kernel.test.ts test/host-boundary.test.ts test/state-store.test.ts test/policy.test.ts test/verification-boundary.test.ts

# packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run test/suite/company-runtime-hardening.test.ts test/suite/company-runtime-observations.test.ts test/suite/company-runtime-approval.test.ts test/suite/company-runtime-r2.test.ts test/suite/company-runtime-quick.test.ts test/suite/company-runtime-workflow.test.ts test/suite/company-runtime-agent.test.ts test/suite/agent-session-prompt.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/suite/agent-session-runtime.test.ts test/suite/agent-session-model-extension.test.ts test/suite/agent-session-retry-events.test.ts test/suite/agent-session-queue.test.ts

# pi root
npm run check
git diff --check
```

- 최종 targeted 결과: Runtime **17개 파일·481개**, 관련 coding-agent **8개 파일·289개**, 추가 기존 Pi **4개 파일·59개**, 합계 **29개 파일·829개 PASS**. 이번에 모두 실행한 결과이며 전체 저장소 suite 수가 아니다. 기존 799개 대비 30개 순증이다.
- QUICK 단위 **69개**, QUICK SDK 통합 **40개**가 위 결과에 포함된다. 수정 전 실패한 R0 사례도 통과했고 R1 known risk는 계속 BLOCKED다.
- `npm run check`: **PASS**, Biome 자동 수정 없음. TypeScript/deps/entry graph/shrinkwrap/install-lock/browser smoke 포함.
- `git diff --check`: **PASS**. 변경 범위와 fixture working tree 무변경을 확인했다.
- build·전체 npm test/Vitest suite·interactive smoke·실제 GPT/DeepSeek/API 재실행·다른 OS 검증은 이번에 하지 않았다. 사용자 실제 RC 결과를 이번 faux 실행의 성과로 계산하지 않는다.

### 남은 제한·다음 작업·커밋

- 실제 GPT RC-01의 수정 후 성공은 아직 확인하지 않았다. 같은 `Explain src/calculator.js` prompt/config로 새 run을 실행하여 COMPLETE, 실제 changedFiles 0, known risk 보존을 확인해야 한다. 기존 BLOCKED 기록을 성공으로 재작성하지 않는다.
- known risk 허용은 R0 설명 완료의 의미만 바꾼다. 발견한 division-by-zero 결함을 수정했다거나 코드가 위험 없음을 보장하지 않는다. 기존 신뢰된 check·heuristic classification·로컬 filesystem 및 비협조 Provider 한계는 유지한다.
- **다음 작업:** 사용자 환경에서 실제 GPT RC-01 재실행 후 별도 결과 기록. DeepSeek 및 남은 RC 시나리오는 별도 검증한다.
- **커밋·푸시:** 하지 않음.

---

## LOG-014 — RC-04: Reviewer evidence 참조 안내·검증·동일 세션 재제출

- **기록일:** 2026-09-16 13:41 (KST)
- **상태:** 구현·자동 회귀 완료, 실제 GPT RC-04 재실행은 미검증
- **목적:** 실제 GPT STANDARD/R2에서 발견된 Reviewer 참조 오류를 Kernel guard 완화 없이 입력·제출 경계에서 교정 가능하게 한다.
- **시작 상태:** `devlop`, HEAD `5ce99df59`. RC-01의 미커밋 Kernel/QUICK test/README/문서 변경이 이미 있었으며 그대로 보존했다.

### 문제와 한정된 해결

사용자 보고에서 Developer mutation과 SELF_CHECK는 성공했지만 Reviewer의 잘못된 evidence ref 때문에 Kernel이 `Review references unknown or missing evidence`로 BLOCKED했다. 기존 `submit_review`는 identity/diffDigest만 검사한 뒤 구조화 결과를 수락하고 세션을 종료했다. 여기에 membership 검증만 추가해도 Adapter가 모든 Tool error를 치명적 오류로 취급하므로 Reviewer는 수정할 기회를 얻지 못한다.

- `packages/company-runtime/src/agent-tools.ts`: 현재 verifier의 `evidenceRefs` + 각 check의 `evidenceRefs` 합집합을 만드는 helper를 추가했다. `submit_review`에서 top-level/각 requirement membership과 필수 배열의 비어 있음 여부를 검사한다. 잘못된 필드·정확한 trusted 목록·재제출 안내를 Tool error로 반환하며 `submitted`나 `terminate`를 설정하지 않는다. Adapter 내부 call ID 집합으로 이 오류만 1회 식별하고, 모델의 문자열·오류 label로 retry 권한을 판단하지 않는다.
- `packages/company-runtime/src/agent-runner.ts`: Reviewer 입력에 `trustedEvidenceRefs`를 추가하고 prompt에서 정확한 문자열 복사, filename/diffDigest/description 사용 금지, 동일 세션 재제출을 안내했다. 위 도구가 확인한 evidence 검증 오류만 즉시 abort에서 제외한다. 새 session/revision/Provider 재시도 시스템은 만들지 않았다.
- `packages/coding-agent/test/suite/company-runtime-agent.test.ts`: 17개 SDK/faux 회귀를 추가했다. unknown/missing/nonexact/file/digest/description ref 거부와 동일 세션 retry, check-only ref 수락·정확한 합집합, REVISE/BLOCK 조건, 미제출/턴 한도/취소/stale identity/금지 도구/혼합 submit 종료를 검증한다.
- `packages/coding-agent/test/suite/company-runtime-r2.test.ts`: RC-04 유사 통합 1개를 추가했다. 실제 임시 Git/Policy mutation·SELF_CHECK 뒤 digest-as-ref 제출을 거부하고 REVIEW 상태/lock을 유지한다. 같은 Reviewer 세션에서 정상 제출한 후 TEST·COMPLETE, durable review 1개·독립 세션 2개·revision0·lock 해제를 확인했다.
- `docs/V0.1_READINESS.md`, `docs/WORK_LOG.md`: 사용자 실제 GPT 발견과 이번 자동 검증을 구분해 기록했다.

Kernel `assertReview()`와 freshness/integrity guard는 변경하지 않았다. 기존 의미대로 모든 verdict의 top-level evidenceRefs는 비어 있을 수 없고 PASS는 각 requirement에도 ref가 필요하다. REVISE/BLOCK의 requirement refs는 빈 배열이 가능하나 제공한 모든 ref는 trusted set에 속해야 한다. 잘못된 ref를 필터링·추정·자동 대체하지 않는다. Schema/identity/Policy/Provider 오류와 timeout/turn/cancel 경계, QUICK/R0/R1·STANDARD/R1·R2/R3 completion 및 RC-01 수정은 유지한다. 실제 RC fixture·prompt/config·기존 run은 수정하지 않았다.

### 이번에 실행한 검증

```sh
# packages/coding-agent: 최초 실행 및 formatter 이후 최종 재실행
node ../../node_modules/vitest/dist/cli.js --run test/suite/company-runtime-agent.test.ts test/suite/company-runtime-r2.test.ts

# packages/company-runtime: S0~S6 + RC-01
node ../../node_modules/vitest/dist/cli.js --run test/hardening.test.ts test/kernel-hardening.test.ts test/observations.test.ts test/observation-files.test.ts test/approval.test.ts test/r2-review.test.ts test/quick.test.ts test/agent-metadata.test.ts test/contracts.test.ts test/config.test.ts test/extension.test.ts test/classification.test.ts test/kernel.test.ts test/host-boundary.test.ts test/state-store.test.ts test/policy.test.ts test/verification-boundary.test.ts

# packages/coding-agent: Runtime/RC-01 통합 및 기존 Pi 회귀
node ../../node_modules/vitest/dist/cli.js --run test/suite/company-runtime-hardening.test.ts test/suite/company-runtime-observations.test.ts test/suite/company-runtime-approval.test.ts test/suite/company-runtime-r2.test.ts test/suite/company-runtime-quick.test.ts test/suite/company-runtime-workflow.test.ts test/suite/company-runtime-agent.test.ts test/suite/agent-session-prompt.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/suite/agent-session-runtime.test.ts test/suite/agent-session-model-extension.test.ts test/suite/agent-session-retry-events.test.ts test/suite/agent-session-queue.test.ts

# root
npm run check
git diff --check
```

- 최초 수정 후 두 파일 실행: **101 PASS / 2 FAIL**. 신규 테스트가 SDK user content를 string으로만 가정했고 action audit에서 Verifier action까지 Developer mutation 수로 계산했다. 실제 SDK의 text block 입력 처리를 반영하고 Developer action만 검사하도록 테스트를 수정했다. 구현의 guard를 완화하지 않았다.
- S0~S6/RC-01 전체 targeted 재실행: Runtime **17개 파일·481개**, 관련 coding-agent **8개 파일·307개**, 추가 기존 Pi **4개 파일·59개**, 합계 **29개 파일·847개 PASS**. 이전 829개에 신규 18개를 더한 현재 실행 결과다. 전체 저장소 suite 수가 아니다.
- formatter 적용 뒤 수정한 두 테스트 파일 재실행: **2개 파일·103개 PASS**. 위 847개와 중복되므로 합산하지 않는다.
- `npm run check`: **PASS**. 최초 Biome이 이번 변경 파일 3개의 import/format을 정리했고, 최종 재실행은 자동 수정 없이 통과했다. TypeScript/deps/entry graph/shrinkwrap/install-lock/browser smoke 포함.
- `git diff --check`: **PASS**. `kernel.ts`의 diff는 시작 시 존재하던 RC-01 변경뿐이며 `assertReview()`는 그대로다.

### 제한·다음 작업·커밋

- 실제 GPT RC-04 수정 후 재실행·DeepSeek·interactive smoke·다른 플랫폼·전체 suite/build는 이번에 하지 않았다. 실제 API/유료 호출도 없다. faux 재제출 성공이 실제 모델의 준수/품질을 보장하지 않는다.
- 재제출은 기존 시간·턴 제한 안에서만 가능하다. 최종 유효 제출이 없으면 실패하며 arbitrary tool/schema/identity 오류 전반을 재시도 대상으로 확장하지 않았다.
- **다음 작업:** 사용자 환경의 같은 fixture/prompt/config에서 새 실제 GPT RC-04 run으로 ref 준수 또는 오류 후 수정 및 independent PASS·TEST·COMPLETE를 확인한다. 기존 BLOCKED run을 성공으로 재작성하지 않는다. RC-01의 실제 Provider 재실행도 별도 확인한다.
- **커밋·푸시:** 하지 않음. 시작 시 RC-01 미커밋 변경과 이번 RC-04 변경을 작업 트리에 유지한다.

---

## LOG-015 — RC-01/RC-04 통합 커밋·푸시 준비

- **기록일:** 2026-09-16 (KST)
- **상태·목적:** 사용자 최종 지시에 따라 RC-01과 RC-04를 모두 포함하는 커밋 범위를 확정하고 게시 전 검증을 완료했다. 중간의 RC-04만 포함하는 방안은 취소했으며 해당 방안으로 스테이징·커밋·파일 분리는 수행하지 않았다.
- **변경 파일:** LOG-013/014의 코드·테스트·README·readiness·작업 이력 총 10개 파일. 기존 RC-01 변경을 사용자 명시적 승인으로 포함한다. 그 외 기능·의존성·lockfile 변경은 없다.
- **이번 검증:** root `npm run check` 재실행 PASS, Biome 자동 수정 없음. `git diff --check` PASS, `git status --short --branch`와 변경 diff로 대상 10개 파일 및 `devlop`을 확인했다. 추가 테스트는 이번 커밋 준비에서 재실행하지 않았다. 직전 LOG-014의 29개 파일·847개 PASS는 구현 검증 당시 결과다.
- **문제·해결:** RC-01/RC-04가 같은 문서에 함께 존재했으나 사용자가 모두 게시하도록 최종 승인하여 부분 스테이징이 필요 없어졌다. 이전 로그의 당시 미커밋 상태 기록은 보존한다.
- **남은 제한·다음 작업:** 실제 GPT RC-01/RC-04 수정 후 재실행 및 DeepSeek 검증은 여전히 미검증이다. 명시적 10개 경로만 스테이징하여 일반 커밋 후 `origin/devlop`에 푸시하고 HEAD/원격 일치와 작업 트리를 확인한다.
- **커밋 상태:** 이 항목 작성 시 실행 직전. 예정 메시지는 `fix(coding-agent): correct runtime R0 completion and review evidence retries`이며 실제 커밋 ID·푸시 결과는 Git 이력과 최종 응답으로 보고한다.

---

## LOG-016 — RC-04 재검증: bounded worker timeout 설정과 선행 취소 보존

- **기록일:** 2026-09-16 13:58 (KST)
- **상태:** 구현·자동 회귀 완료, 실제 Provider 후속 재실행 미검증
- **목적:** 실제 GPT STANDARD/R2 IMPLEMENT가 60초 worker deadline으로 끝난 문제에 대해 명시적·bounded 실행 예산을 제공하되 취소/cleanup/lease 안전성을 보존한다.
- **시작 상태:** `devlop` clean, HEAD `d4d9ff4c0167293caf746827d7de8f1310c0d505`. LOG-015 뒤 사용자 승인대로 RC-01/RC-04 모두 이 커밋에 포함하여 `origin/devlop`에 푸시했고 당시 로컬/원격 HEAD 일치·clean을 확인했다. 이 항목의 새 변경은 아직 커밋하지 않았다.

### 실제 발견·설계 판단

사용자 실제 GPT RC-04 재검증에서 Developer가 IMPLEMENT 도중 `Worker timed out`으로 종료했다. 이 run에는 파일 변경·SELF_CHECK·Reviewer 실행이 없었다. 따라서 LOG-014의 Reviewer evidenceRefs 수정은 실제 Provider에서 여전히 검증되지 않았다. 모델/프롬프트를 바꾸거나 fixture를 축소하지 않는다. 정확한 reasoning/network 지연 원인은 이번 보고만으로 추정하지 않는다.

기존 Adapter의 기본 60초와 Extension에서 timeout을 별도 전달하지 않는 경로를 확인했다. 설정은 `agents.worker_timeout_ms` 한 개로 한정하고 기본 180000ms·허용 정수 10000..600000ms를 선택했다. 120초보다 대기 여유를 주되 사용자 설정을 10분 이내로 제한한다. 모델별 실측 최적값이라는 주장은 아니다. V0.1에서는 역할별 timeout·별도 scheduler·자동 연장/재시도/모델 fallback이 필요하지 않다.

예산은 각 Developer/Reviewer/Executor 호출의 audit/auth 재확인·SDK 생성·session 참조 저장·전체 Provider/tool turns와 승인 대기를 포함한다. token/turn마다 갱신되는 inactivity timeout도 전체 workflow timeout도 아니다. 생성 시 profile/auth preflight는 같은 값의 별도 signal budget을 사용한다. 기존 직접 Host/test `timeoutMs` override(1~3,600,000ms)는 의도된 API이므로 제거하지 않았고 YAML에 이를 노출하지 않는다. check timeout·R3 승인 TTL은 별도다.

### 변경 파일·실패 경계

- `packages/company-runtime/src/config.ts`: strict schema에 optional bounded 정수를 추가하고 생략 시 180000ms로 정규화한다. 0/음수/범위 초과/소수/문자열/null 등은 거부한다.
- `packages/company-runtime/src/extension.ts`: Host가 정규화된 config 값을 `PiAgentExecutor.create`에 명시적으로 전달한다. 기존 lifecycle hook은 변경하지 않았다.
- `packages/company-runtime/src/agent-runner.ts`: 직접 호출에도 frozen config의 값이 기본으로 적용된다. 원본 config 객체 변경은 이미 생성된 Adapter의 예산에 영향을 주지 않는다. timeout callback은 signal이 이미 취소됐으면 원인을 덮지 않는다. 이전에는 비협조 Provider의 취소 정산이 늦어 deadline에 도달하면 선행 사용자 취소가 `Worker timed out`으로 바뀔 수 있었다. 기존 abort/await/dispose·safeToRelease·다음 역할 거부는 그대로다.
- `packages/company-runtime/src/observations.ts`: `/workflow config`에 공통 timeout과 범위·cleanup 대기 의미를 표시한다. active run의 설정을 바꾸거나 상태 schema를 확장하지 않는다.
- `packages/company-runtime/test/config.test.ts`, `test/extension.test.ts`: 설정 유효/거부 matrix 14개, config 출력과 잘못된 설정이 confirmation/provider/writer 전에 거부되는 Host 사례 2개를 추가했다. check timeout이 독립이라는 기존 검증도 유지한다.
- `packages/coding-agent/test/suite/company-runtime-timeout.test.ts`: SDK/harness/faux/가상 timer 13개를 추가했다. Developer/Reviewer 90초 지연 성공, 기본값 179999ms 성공, 120000ms timeout, 총 여러-turn 예산, 선행 cancel 우선, late result/tool 거부, 무효 config+override 거부를 검증한다. 실제 Extension config 전달 및 timeout/cancel/switch/reload/quit 경로에서 Provider/SDK cleanup 대기 동안 lock·RUNNING/IMPLEMENT를 유지하고 두 번째 writer를 거부하며, 최종 FAILED/CANCELLED 후 unlock·무변경·check/review 미실행을 확인한다.
- `packages/company-runtime/README.md`, `docs/V0.1_READINESS.md`, `docs/WORK_LOG.md`: 설정 예시·정확한 시간 의미·역할 공통 결정·실제 GPT 실패와 자동 검증의 차이를 기록했다.

Kernel/Ports/Policy/Approval/StateStore와 completion guard는 변경하지 않았다. QUICK/R0/R1·STANDARD/R1/R2·R3 실행 의미는 그대로이며 timeout 증가가 권한이나 완료 요건을 낮추지 않는다. timeout은 실패이고 COMPLETE로 진행하지 않는다. 사용자/lifecycle signal은 즉시 전달하지만 비협조 Provider/SDK 종료를 확인할 때까지 반환·unlock을 보장하지 않는다. cleanup이 불확실하면 기존처럼 lease를 유지한다.

### 이번 검증 명령·실제 결과

```sh
# packages/company-runtime: 초기 targeted와 최종 S0~S6/RC 회귀
node ../../node_modules/vitest/dist/cli.js --run test/config.test.ts test/extension.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/hardening.test.ts test/kernel-hardening.test.ts test/observations.test.ts test/observation-files.test.ts test/approval.test.ts test/r2-review.test.ts test/quick.test.ts test/agent-metadata.test.ts test/contracts.test.ts test/config.test.ts test/extension.test.ts test/classification.test.ts test/kernel.test.ts test/host-boundary.test.ts test/state-store.test.ts test/policy.test.ts test/verification-boundary.test.ts

# packages/coding-agent: 신규 suite 및 기존 회귀
node ../../node_modules/vitest/dist/cli.js --run test/suite/company-runtime-timeout.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/suite/company-runtime-timeout.test.ts test/suite/company-runtime-hardening.test.ts test/suite/company-runtime-observations.test.ts test/suite/company-runtime-approval.test.ts test/suite/company-runtime-r2.test.ts test/suite/company-runtime-quick.test.ts test/suite/company-runtime-workflow.test.ts test/suite/company-runtime-agent.test.ts test/suite/agent-session-prompt.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/suite/agent-session-runtime.test.ts test/suite/agent-session-model-extension.test.ts test/suite/agent-session-retry-events.test.ts test/suite/agent-session-queue.test.ts

# root
npm run check
git diff --check
```

- 초기 config/Host **64개 PASS**. 신규 SDK suite 최초 **8 PASS / 4 FAIL**은 테스트가 Kernel의 저장된 cancel 원인을 Adapter의 `Worker aborted`로 예상한 오류였다. Kernel은 기존대로 `Run cancelled`를 저장하므로 기대값을 수정했다. 구현/Kernel guard는 이 테스트에 맞춰 바꾸지 않았다. 이후 여러-turn 예산 사례를 추가하여 신규 suite **13개 PASS**를 확인했다.
- 최종 **30개 파일·876개 PASS**: Runtime 17개 파일·497개 + 관련 coding-agent 9개 파일·320개 + 추가 Pi 4개 파일·59개. 신규 29개이며 LOG-014의 847개와 중복 합산하지 않는다. 기존 S6 cleanup/lifecycle matrix와 RC-01/RC-04 evidence 회귀도 이번에 모두 다시 실행했다.
- `npm run check` **PASS**: 최초 Biome이 이번 test 파일 3개 format을 정리했고 최종 재실행은 자동 수정 없이 통과했다. TypeScript/deps/entry graph/shrinkwrap/install-lock/browser smoke 포함. formatter 이후 전체 targeted를 실행했다.
- `git diff --check` **PASS**. 실제 API/유료 호출·interactive smoke·전체 저장소 suite/build·다른 OS는 이번에 실행하지 않았다. 90~180초 성공은 가상 경과 시간의 실제 SDK/faux 검증이지 실제 GPT 지연/성공 증거가 아니다.

### 제한·다음 작업·커밋

- 실제 GPT RC-04는 새 timeout 설정으로 다시 실행해야 한다. `/workflow config`에서 effective 값을 확인하고 같은 fixture/prompt/model로 새 run을 수행한다. Reviewer가 실제 시작하여 정확한 ref 또는 Tool error 후 수정·PASS·TEST·COMPLETE에 도달해야 evidence 수정 검증으로 기록할 수 있다. 기존 실패 run을 재작성하지 않는다.
- 180초 기본값이 quota/network/model 품질 문제를 해결하거나 Provider가 AbortSignal에 협조한다는 보장은 없다. shutdown 응답 시간·lease 정리는 여전히 협조적 cleanup에 의존한다. timeout은 강제 OS 종료 deadline이 아니다.
- **커밋·푸시:** 이번 수정은 하지 않음. 새 기능 단계나 release 선언이 아니다.

---

## LOG-017 — RC-04 재검증: Developer unresolved와 Runtime 후속 의무 구분

- **기록일:** 2026-09-16 14:29 (KST)
- **상태:** 구현·자동 회귀 완료, 수정 후 실제 Provider COMPLETE 미검증
- **목적:** Developer가 시스템 소유 후속 단계를 immutable handoff의 unresolved로 제출해 완료가 차단되는 문제를 prompt·제출 피드백으로 수정한다. Kernel의 unresolved 완료 가드는 유지한다.
- **시작 상태:** `devlop`, HEAD `d4d9ff4c0`. LOG-016의 worker timeout 코드·테스트·문서가 미커밋 상태였으며 모두 보존했다. 이번 변경과 함께 검증하되 이전 작업과 이번 변경을 구분한다.

### 실제 문제·짧은 trace

사용자 실제 GPT STANDARD/R2 재검증에서 Developer → SELF_CHECK → Reviewer PASS → final TEST까지 성공했지만 COMPLETE가 `Handoff has the wrong task or unresolved work`로 BLOCKED됐다. Developer가 unresolved에 `Independent Reviewer PASS is required and remains pending.`를 넣었고, 실제 리뷰가 PASS해도 이미 수락한 immutable handoff는 바뀌지 않아 `unresolved.length === 0` 가드에 걸렸다.

LOG-016 당시 timeout run과 달리 최신 보고에서는 Reviewer PASS와 final TEST까지 확인됐다. 이는 사용자 실제 Provider 실행의 보고이며 이번 faux 결과가 아니다. actual ref 오류 후 재제출 여부, 모델/지연/timeout 설정값은 미보고라 추정하지 않는다. 전체 run이 성공한 것으로 기록하거나 기존 BLOCKED state를 재작성하지 않는다.

### 변경 파일과 한정된 설계

- `packages/company-runtime/src/agent-runner.ts`: Developer prompt에서 unresolved를 구현·요구사항의 실제 미해결 문제/blocker로 정의한다. Reviewer 실행/PASS·SELF_CHECK·TEST·Human Approval 필요/대기는 Kernel/Workflow 소유이며, Developer가 생략·완료를 결정하지 않도록 명시한다. 미구현 변경은 구체적 blocker로 남겨야 하며 R3 승인 도구를 우회하지 않는다. 새 안내는 QUICK Executor prompt에는 적용하지 않았다.
- `packages/company-runtime/src/agent-tools.ts`: Developer `submit_handoff` 설명과 검증을 추가했다. 알려진 영어 whole-entry 패턴(Reviewer/PASS/execution·SELF_CHECK·TEST·Human Approval + required/needed/pending)만 검출하고 해당 unresolved index를 Tool error로 반환한다. 대소문자·공백·마지막 마침표/느낌표 변형을 인식하지만 원본 handoff는 수정하지 않는다. 실제 미완료를 뜻한다면 구체적 누락 변경을 기술하고 실제 blocker를 반드시 보존하도록 안내한다. 수락/terminate 전에 거부하므로 같은 세션에서 다시 제출할 수 있다.
- 기존 Reviewer evidence retry의 내부 call ID 분류를 tool 이름까지 결합한 submission 오류 Map으로 공유했다. 해당 Adapter가 표시한 handoff 의미 오류와 Reviewer ref 오류만 재제출 가능하다. 모델이 오류 문자열을 흉내 내거나 일반 Tool/Policy 오류를 일으켜도 재시도 권한이 생기지 않는다.
- `packages/coding-agent/test/suite/company-runtime-agent.test.ts`: 13개 추가. 알려진 표현 변형 4개가 같은 Developer session에서 수정 가능함, 미재제출/턴 제한/취소/timeout/stale identity/Policy 거부/혼합 제출은 계속 종료됨, QUICK R0/R1 Executor unresolved는 이번 Developer 규칙으로 변경하지 않음을 검증했다.
- `packages/coding-agent/test/suite/company-runtime-r2.test.ts`: 12개 추가. 알려진 obligation 5개 제출 거부 후 같은 Developer session에서 빈 unresolved로 수정 → 독립 Reviewer PASS·두 check PASS·COMPLETE; 실제/애매한 문제 5개는 그대로 보존되어 Reviewer PASS에도 BLOCKED; mixed 배열 교정 후 실제 blocker 유지; custom Adapter가 제출 검증을 우회해 원래 obligation을 반환해도 Kernel이 BLOCKED함을 확인했다.
- `packages/company-runtime/README.md`, `docs/V0.1_READINESS.md`, `docs/WORK_LOG.md`: 의미·예시·한계와 실제 Provider 단계 성공/전체 완료 실패, 이번 자동 검증 결과를 구분해 기록했다.

**변경하지 않은 경계:** `kernel.ts`와 `unresolved.length === 0`, R2 independent review 의무, R3 Approval, QUICK/R0/R1 및 STANDARD/R1 completion semantics, Policy/StateStore/계약 schema. 실제 미해결 문제는 빈 배열로 강제 변환하지 않는다. 구현 문제와 섞인 문장·알려지지 않은 표현은 제출 피드백을 놓칠 수 있지만 그대로 남아 최종 guard가 차단한다. Reviewer PASS 뒤 handoff를 필터링하거나 수정하는 단계는 없다. 기존 시간·턴·취소·cleanup/lease와 RC-04 evidence retry는 유지한다.

### 이번 검증 명령·실제 결과

```sh
# packages/coding-agent: 수정한 두 파일 targeted
node ../../node_modules/vitest/dist/cli.js --run test/suite/company-runtime-agent.test.ts test/suite/company-runtime-r2.test.ts

# packages/company-runtime: S0~S6/RC 회귀
node ../../node_modules/vitest/dist/cli.js --run test/hardening.test.ts test/kernel-hardening.test.ts test/observations.test.ts test/observation-files.test.ts test/approval.test.ts test/r2-review.test.ts test/quick.test.ts test/agent-metadata.test.ts test/contracts.test.ts test/config.test.ts test/extension.test.ts test/classification.test.ts test/kernel.test.ts test/host-boundary.test.ts test/state-store.test.ts test/policy.test.ts test/verification-boundary.test.ts

# packages/coding-agent: timeout/evidence/RC-01 포함 통합 및 기존 Pi 회귀
node ../../node_modules/vitest/dist/cli.js --run test/suite/company-runtime-timeout.test.ts test/suite/company-runtime-hardening.test.ts test/suite/company-runtime-observations.test.ts test/suite/company-runtime-approval.test.ts test/suite/company-runtime-r2.test.ts test/suite/company-runtime-quick.test.ts test/suite/company-runtime-workflow.test.ts test/suite/company-runtime-agent.test.ts test/suite/agent-session-prompt.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/suite/agent-session-runtime.test.ts test/suite/agent-session-model-extension.test.ts test/suite/agent-session-retry-events.test.ts test/suite/agent-session-queue.test.ts

# root
npm run check
git diff --check
```

- 수정한 두 파일 최초 targeted: **2개 파일·128개 PASS**. 신규 25개가 포함되며 이번 작업의 테스트 실패는 없었다.
- 전체 targeted: Runtime **17개 파일·497개**, 관련 coding-agent **9개 파일·345개**, 추가 기존 Pi **4개 파일·59개**, 합계 **30개 파일·901개 PASS**. LOG-016의 876개는 과거 결과이며 합산하지 않는다. 기존 S6 lifecycle/lease와 R3·QUICK·STANDARD 회귀도 이번에 다시 실행했다.
- root `npm run check`: **PASS**. 최초 Biome이 이번 변경 파일 3개 format을 정리했고 최종 재실행은 자동 수정 없이 통과했다. TypeScript/deps/entry graph/shrinkwrap/install-lock/browser smoke도 통과했다. formatter 이후 전체 targeted를 실행했다.
- `git diff --check`: **PASS**. Kernel diff가 없음을 확인했다. 실제 API/유료 호출·interactive smoke·전체 suite/build·다른 OS는 이번에 실행하지 않았다.

### 제한·다음 작업·커밋

- 검출은 보수적인 알려진 영어 문구 피드백이며 범용 자연어 의미 판별기가 아니다. 놓친 다른 표현은 기존 완료 가드에서 계속 BLOCKED될 수 있다. 반대로 stage 이름만으로 표현한 실제 미구현 문제라면 구체적 문제로 수정 제출해야 하며 자동 삭제하지 않는다.
- 실제 구현 완료/요구사항 충족은 모델 진술만으로 증명되지 않으며 독립 review·필수 check·fresh evidence가 여전히 필요하다. 이번 수정 후 actual GPT COMPLETE는 미검증이다.
- **다음 작업:** 같은 실제 RC fixture/prompt/model의 새 run에서 올바른 handoff 또는 Tool error 후 수정, Reviewer PASS·TEST·COMPLETE를 확인한다. 기존 실패 run/state는 변경하지 않는다.
- **커밋·푸시:** 하지 않음. LOG-016 timeout 변경과 이번 handoff 변경을 작업 트리에 유지한다.

---

## LOG-018 — RC-05: R3 승인 요청과 승인 권한의 prompt/tool 의미 분리

- **기록일:** 2026-09-16 (KST)
- **상태:** 구현·자동 회귀 완료, 수정 후 실제 GPT RC-05 재실행 미검증
- **목적:** 실제 GPT R3 run에서 Human Approval UI가 나타나지 않은 문제에 대해 모순된 역할 안내를 수정한다. 새로운 승인 권한이나 실행 경로는 추가하지 않는다.
- **시작 상태:** `devlop`, HEAD `d4d9ff4c0`; LOG-016 timeout과 LOG-017 unresolved 코드·테스트·문서가 미커밋 상태였다. 모두 보존하고 함께 회귀를 실행했다.

### 실제 발견·원인과 해결

사용자는 실제 GPT RC-05에서 `Delete file obsolete.txt`를 실행했지만 Human Approval UI가 나타나지 않고 BLOCKED됐다고 보고했다. 공통 Developer system prompt는 `approval ... is available`을 부정하는 반면 R3 문구는 `runtime_delete ... after explicit human approval`이라고 안내했다. 이는 승인을 요청할 방법이 없거나 별도 승인이 먼저 있어야 tool을 호출할 수 있다는 혼동을 만든다.

기존 코드와 테스트를 확인하면 Developer가 별도 approval tool을 가질 필요가 없다. `runtime_delete`가 현재 scope/경로/config를 검사한 뒤 `onApprovalRequested`를 호출하고 Runtime이 WAITING_APPROVAL/PENDING을 저장하여 ApprovalPort/Host UI에 전달한다. 사용자 결정에 따른 exact grant를 검사한 뒤에만 실제 삭제·consumption을 진행한다. 따라서 guard나 승인 UI 구현을 완화하지 않고 **호출이 승인 요청을 시작한다는 사실**을 prompt/tool 설명에 일치시켰다. 사용자 보고 외 실제 모델 전체 로그나 비용·지연은 확인하지 않았으며 추정하지 않는다.

### 변경 파일

- `packages/company-runtime/src/agent-runner.ts`: 공통 문구를 shell/자동 context 부재와 직접 승인·우회·workflow 제어 권한 부재로 분리했다. R3 Developer에만 `runtime_delete` 호출 → Runtime 승인 요청, 별도 approval tool/prior grant 불필요, WAITING_APPROVAL에서 Deny/Approve once, tool 확인 전 승인 획득 주장 금지, 거절/만료 후 우회·재시도 금지를 안내한다. 일반 코드 mutation 안내 대신 한정 deletion을 지시한다. R3 Reviewer는 읽기 전용 handoff/diff/evidence 리뷰만, R0/R1/R2는 승인 요청·destructive 도구 미제공을 명시한다. 공통 unresolved 설명의 모호한 'permitted tool로 먼저 승인 획득' 문장은 R3의 구체적 흐름으로 대체하되 실제 미완료 blocker 보존 의미는 유지한다.
- `packages/company-runtime/src/agent-tools.ts`: `runtime_delete` description만 같은 요청/대기/삭제 순서로 명확히 했다. 실행 함수·입력 schema·tool 등록 조건·Policy gate·callback·fingerprint/expiry 재검사·unlink·consumption은 이번 작업에서 변경하지 않았다.
- `packages/coding-agent/test/suite/company-runtime-approval.test.ts`: RC-05 신규 8개. approve/deny/timeout 3개가 실제 SDK/faux의 prompt·tool 설명·도구 목록을 검증하고 ApprovalPort 진입 전 미승인·파일 존재, 진입 시 WAITING_APPROVAL/PENDING, 반환 뒤 결과를 확인한다. 위조 승인 인자 1개와 QUICK R0/R1·STANDARD R1/R2의 destructive 도구 미노출 및 실제 호출 거부 4개를 추가했다. 기존 Host Deny/Approve once 테스트는 selection 시 WAITING_APPROVAL/PENDING·파일 존재·Deny 기본값을 명시적으로 확인하도록 강화했다.
- `packages/company-runtime/README.md`, `docs/V0.1_READINESS.md`, `docs/WORK_LOG.md`: 요청 권한과 승인 권한의 차이, 실제 GPT 문제와 자동 검증 범위·후속 RC gate를 기록했다.

**유지한 경계:** Developer에게 승인 권한/approval tool을 주지 않는다. R3 preselected scope/actionDigest/configDigest/fingerprint/TTL/one-shot/state와 Kernel completion guard는 그대로다. Deny/timeout은 삭제 없이 BLOCKED, 유효한 Approve once만 한 파일 삭제, 독립 review/check 뒤에만 완료 가능하다. R0/R1/R2에 R3 기능을 노출하지 않고 R3 Reviewer도 delete tool을 갖지 않는다. 사용자 fixture·prompt/model·RC 요청·기존 run/state는 변경하지 않았다.

### 이번 검증 명령·실제 결과

```sh
# packages/coding-agent: 수정 전 새 prompt 계약 테스트, 수정 후 전체 approval suite
node ../../node_modules/vitest/dist/cli.js --run test/suite/company-runtime-approval.test.ts -t 'RC-05'
node ../../node_modules/vitest/dist/cli.js --run test/suite/company-runtime-approval.test.ts

# packages/company-runtime: S0~S6/RC 및 승인 guard 회귀
node ../../node_modules/vitest/dist/cli.js --run test/hardening.test.ts test/kernel-hardening.test.ts test/observations.test.ts test/observation-files.test.ts test/approval.test.ts test/r2-review.test.ts test/quick.test.ts test/agent-metadata.test.ts test/contracts.test.ts test/config.test.ts test/extension.test.ts test/classification.test.ts test/kernel.test.ts test/host-boundary.test.ts test/state-store.test.ts test/policy.test.ts test/verification-boundary.test.ts

# packages/coding-agent: 전체 Runtime/RC 및 관련 Pi 회귀
node ../../node_modules/vitest/dist/cli.js --run test/suite/company-runtime-timeout.test.ts test/suite/company-runtime-hardening.test.ts test/suite/company-runtime-observations.test.ts test/suite/company-runtime-approval.test.ts test/suite/company-runtime-r2.test.ts test/suite/company-runtime-quick.test.ts test/suite/company-runtime-workflow.test.ts test/suite/company-runtime-agent.test.ts test/suite/agent-session-prompt.test.ts
node ../../node_modules/vitest/dist/cli.js --run test/suite/agent-session-runtime.test.ts test/suite/agent-session-model-extension.test.ts test/suite/agent-session-retry-events.test.ts test/suite/agent-session-queue.test.ts

# root
npm run check
git diff --check
```

- 수정 전 신규 RC-05 테스트: **7 FAIL / 1 PASS / 기존 43개 필터 제외**. 기존 prompt가 새 권한/요청 설명 계약을 만족하지 않아 assertion이 실패했다. 승인 인자 위조 거부는 기존에도 통과했다. 이 결과는 실제 LLM의 자연어 판단을 재현한 증거가 아니라 prompt/tool 계약 회귀다.
- 수정 후 approval suite: **51개 PASS**. 이후 Host selection 검사 강화와 formatter를 적용하고 전체 targeted를 다시 실행했다.
- 최종 **30개 파일·909개 PASS**: Runtime 17개 파일·497개, 관련 coding-agent 9개 파일·353개, 추가 Pi 4개 파일·59개. 신규 8개이며 LOG-017의 901개와 중복 합산하지 않는다. 기존 승인 생략·다른 경로·재사용·변조 binding·만료·늦은 응답·승인 중 lifecycle/cleanup 회귀도 이번에 다시 통과했다.
- root `npm run check`: **PASS**, 최초 Biome이 이번 approval test 파일 1개 format을 정리했고 최종 재실행은 자동 수정 없이 통과했다. TypeScript/deps/entry graph/shrinkwrap/install-lock/browser smoke 포함.
- `git diff --check`: **PASS**. 실제 API/유료 호출·interactive smoke·전체 suite/build·다른 OS 검증은 이번에 하지 않았다.

### 한계·다음 작업·커밋

- prompt 명확화가 모든 실제 모델의 도구 선택을 보장하지 않는다. 실제 GPT RC-05 재실행은 아직 미검증이며 이번 faux/Host selection 통합은 실제 TUI 표시 확인과 구분한다.
- **다음 작업:** 같은 실제 `Delete file obsolete.txt` 요청으로 새 run에서 runtime_delete 호출과 Human Approval UI 표시를 확인한다. Deny/timeout 파일 유지 및 Approve once exact 삭제·consumption·후속 review/check를 별도 검증한다. 이전 BLOCKED run을 재작성하지 않는다.
- **커밋·푸시:** 하지 않음. 앞선 timeout/handoff 수정과 이번 prompt 변경을 작업 트리에 유지한다.

---

## LOG-019 — RC-04/RC-05 누적 수정 커밋·푸시 준비

- **기록일:** 2026-09-16 15:25 (KST)
- **상태·목적:** 사용자 요청에 따라 LOG-016~018의 worker timeout·Developer unresolved·R3 승인 요청 prompt 수정과 테스트·문서를 함께 게시하기 위한 검증을 완료했다.
- **변경 파일:** 앞선 세 작업에서 변경한 Runtime 소스 5개, Runtime 테스트 2개, coding-agent suite 4개(신규 timeout suite 포함), README/readiness/작업 이력 3개로 총 14개 파일. 다른 변경이나 lockfile은 포함하지 않는다.
- **이번 검증:** root `npm run check` 재실행 PASS, Biome 자동 수정 없음. `git diff --check` PASS, `git status --short --branch`·변경 목록·기존 staged 변경 없음 확인. 테스트는 이번 커밋 준비에서 다시 실행하지 않았으며 LOG-018의 30개 파일·909개 PASS는 직전 구현 검증 결과다.
- **문제·해결:** 추가 문제 없음. Kernel/Policy/Approval/StateStore의 완료·승인 guard를 바꾸지 않은 누적 수정 범위를 유지한다. 과거 로그의 당시 미커밋 상태는 그대로 보존한다.
- **남은 제한·다음 작업:** 실제 GPT RC-04 수정 후 COMPLETE와 RC-05 승인 UI 재검증은 여전히 미완료다. 명시적 14개 경로를 스테이징해 커밋한 뒤 `origin/devlop`에 푸시하고 로컬/원격 HEAD 일치 및 작업 트리를 확인한다.
- **커밋 상태:** 이 항목 작성 시 실행 직전. 예정 메시지는 `fix(coding-agent): clarify runtime worker limits and approval semantics`이며 실제 커밋 ID·푸시 결과는 Git 이력과 최종 응답으로 보고한다.

---

## LOG-020 — Weavra V0.1 RC Closure: GPT Real-Provider RC-01~08 완료

- **기록일:** 2026-09-16 (KST), 이번 자동 targeted 재실행 시작 15:36 KST
- **상태:** 완료 — 한정된 GPT 시나리오 및 소스 RC Closure. 정식 release/패키지 발행 아님.
- **목적:** 실제 GPT 최종 evidence를 readiness와 일치시키고 S0~S6/RC 회귀를 현재 HEAD에서 다시 확인하여 `weavra-v0.1-rc1` 태그 준비 여부를 판정한다. 기능 추가나 Policy 의미 변경은 하지 않는다.
- **시작/최종 검증 HEAD SHA:** **`dc6d3df65ad4d9217f2f82e81cd56f07511163b6`**, `devlop`, 시작 시 clean 및 `origin/devlop`과 일치. 이번 작업에서 커밋하지 않아 최종 HEAD도 동일하다. 최종 작업 트리 차이는 아래 문서 두 개뿐이다.
- **연결 이력:** LOG-019 뒤 누적 수정 14개 파일은 사용자 승인으로 `970d238852366d044e6613ce4f24851020f69dc7`에 커밋·푸시했다. 이후 원격 evidence 문서 커밋 `dc6d3df65`를 fast-forward로 가져왔다. 앞선 로그의 당시 미커밋/미검증 상태는 수정하지 않고 이 항목에서 최종 결과를 연결한다.

### 실제 GPT evidence와 최종 판정

근거는 **[docs/GPT_RC_VALIDATION_2026-09-16.md](GPT_RC_VALIDATION_2026-09-16.md)** 전체(특히 §1~10·12)다. 사용자 주도 interactive 수동 검증이며 이번 작업에서 실제 모델을 새로 호출한 결과가 아니다.

- Provider: **`codex-lb`**, 모델: **`gpt-6-astra`**, reasoning 표시: **`high`**.
- 수동 환경: macOS/POSIX, Pi 표시 버전 `v0.85.1`, 별도 `kjg8619/weavra-rc-fixture`, `pi -e ../pi/packages/company-runtime/src/extension.ts`, fixture Node built-in tests.

| RC | 최종 판정 | 확인된 실제 결과 |
|---|---|---|
| RC-01 QUICK/R0 | PASS | known-risk finding 보존·파일 무변경·두 checks PASS·COMPLETED |
| RC-02 QUICK/R1 | PASS | Executor-only·한 파일 typo 수정·두 checks PASS·COMPLETED |
| RC-03 STANDARD/R1 | PASS | Developer/Reviewer 별도 session ID/JSONL·독립 PASS·두 checks PASS·COMPLETED |
| RC-04 STANDARD/R2 | PASS | `package.json`만 수정, install 없음, mandatory Reviewer·두 checks PASS·unresolved 없음·COMPLETED |
| RC-05 scoped R3 | PASS | Human Approval UI·기본 Deny·Deny/EXPIRED 파일 유지·Approve once 단일 삭제 |
| RC-06 mixed unsafe | PASS (expected block) | downgrade 없이 preflight 차단, worker mutation 이전 무변경 종료 |
| RC-07 IMPLEMENT cancel | PASS (expected cancel) | CANCELLED, Reviewer/verification 미실행, COMPLETE 금지·기록된 변경 없음 |
| RC-08 stale evidence | PASS (expected block) | Reviewer 뒤 외부 변경, 두 checks PASS여도 stale diff로 BLOCKED·부분 변경 보고 |

`BLOCKED`/`CANCELLED` 안전 시나리오의 PASS는 그 run을 COMPLETED로 바꿨다는 뜻이 아니다. 초기 실제 실패와 immutable 과거 run은 보존한다.

### Evidence 한계와 NOT VERIFIED 유지

- 수동 RC는 run별 SHA를 모두 고정하지 않았고 수정/재실행을 포함한다. 실제 GPT run 모두를 위 최종 HEAD에서 다시 실행했다고 주장하지 않는다. 이번 자동 회귀만 최종 HEAD에 정확히 연결한다.
- RC-05 문서의 직접 증거는 승인 UI 및 유지/삭제다. 승인 뒤 모든 review/check/COMPLETE 상세가 기록됐다고 확대하지 않는다. 해당 guard는 자동 suite에서 별도 검증했다.
- RC-07에는 취소 후 writer.lock 부재의 별도 수동 캡처가 없다. lease/lifecycle 자동 회귀와 과거 S6 interactive faux 증거를 별도로 해석한다.
- token/cost/duration·특정 timeout 예산의 충분성·실제 ref 오류 후 재제출 trace·장시간 network/rate-limit/quota/OAuth 경계는 미수집/미검증이다.
- **DeepSeek 및 다른 Provider/모델, 다른 OS와 macOS/Node 조합: NOT VERIFIED.** Windows 실행은 UNSUPPORTED / NOT VERIFIED다. 지원되지 않는 COMPLEX·범용 R3·shell/install/deploy·DAG/T3Code·model routing을 추가하지 않았다.
- 전체 upstream suite/e2e/build, Node/Bun 배포물의 저장소 밖 설치/실행 smoke, dependency vulnerability 재평가를 이번에 하지 않았다. 과거 audit를 현재 보안 PASS로 취급하지 않는다.

### 변경 파일과 문제 정리

- `docs/V0.1_READINESS.md`: 최종 HEAD와 이번 회귀 수치, RC-01~08 표, 근거 출처/한계, GPT PASS와 타 Provider/OS NOT VERIFIED를 구분했다. RC-01/04/05의 오래된 재실행 대기·미완료 상태를 최종 수동 결과로 갱신하되 당시 문제와 자동 결과는 보존했다. RC 진입 안내를 Closure/태그 준비 판정으로 정리했다.
- `docs/WORK_LOG.md`: 현재 요약을 갱신하고 본 완료 항목을 추가했다. LOG-001~019의 이력 본문은 보존한다.
- evidence 원문, Runtime 소스·테스트·Policy/Approval/StateStore/Kernel, README/설계 문서, dependency/lockfile, branding/package/version은 변경하지 않았다.
- 문제는 readiness의 오래된 미검증 상태와 최종 GPT 결과가 불일치한 것이었다. 실제 evidence를 출처로 연결하여 해소했으며 문서에 없는 성공 trace를 추가하지 않았다. 이번 테스트 실패나 코드 수정은 없다.

### 이번에 실제 실행한 검증

자동 환경: **Darwin arm64, Node v26.7.0**, 로컬 filesystem/Git/POSIX. 다음 명령을 각각 해당 package root에서 실행했다.

```sh
# packages/company-runtime — 전체 Runtime S0~S6 및 RC fixes targeted
node ../../node_modules/vitest/dist/cli.js --run test/hardening.test.ts test/kernel-hardening.test.ts test/observations.test.ts test/observation-files.test.ts test/approval.test.ts test/r2-review.test.ts test/quick.test.ts test/agent-metadata.test.ts test/contracts.test.ts test/config.test.ts test/extension.test.ts test/classification.test.ts test/kernel.test.ts test/host-boundary.test.ts test/state-store.test.ts test/policy.test.ts test/verification-boundary.test.ts

# packages/coding-agent — Runtime/RC suite와 기존 prompt
node ../../node_modules/vitest/dist/cli.js --run test/suite/company-runtime-timeout.test.ts test/suite/company-runtime-hardening.test.ts test/suite/company-runtime-observations.test.ts test/suite/company-runtime-approval.test.ts test/suite/company-runtime-r2.test.ts test/suite/company-runtime-quick.test.ts test/suite/company-runtime-workflow.test.ts test/suite/company-runtime-agent.test.ts test/suite/agent-session-prompt.test.ts

# packages/coding-agent — 추가 기존 Pi 회귀
node ../../node_modules/vitest/dist/cli.js --run test/suite/agent-session-runtime.test.ts test/suite/agent-session-model-extension.test.ts test/suite/agent-session-retry-events.test.ts test/suite/agent-session-queue.test.ts

# repo root
npm run check
git diff --check
git status --short --branch
git rev-parse HEAD
git tag --list 'weavra-v0.1-rc1'
git ls-remote --tags origin 'refs/tags/weavra-v0.1-rc1' 'refs/tags/weavra-v0.1-rc1^{}'
```

| 이번 실행 | 파일 수 | 테스트 수 | 실제 결과 |
|---|---:|---:|---|
| Runtime S0~S6/RC | 17 | 497 | PASS |
| coding-agent Runtime + prompt | 9 | 353 | PASS |
| 추가 Pi runtime/model-extension/retry-events/queue | 4 | 59 | PASS |
| **합계** | **30** | **909** | **PASS, 실패/skip 0** |
| root `npm run check` | — | — | PASS, Biome 자동 수정 없음; TypeScript/deps/entry graph/shrinkwrap/install-lock/browser smoke 포함 |
| `git diff --check` | — | — | PASS |
| 로컬/원격 exact RC tag 조회 | — | — | 기존 `weavra-v0.1-rc1` 없음 |

숫자가 LOG-018의 909개와 같지만 **이번 Closure에서 다시 실행한 결과**다. 이전 결과나 수동 RC 8개를 합산하지 않는다. 실제 GPT·DeepSeek API/유료 호출·TUI interactive smoke는 이번에 새로 실행하지 않았다.

문서 갱신 뒤 root `npm run check`도 다시 실행해 자동 수정 없이 PASS했다. 임시 `python3 /tmp/weavra-rc-closure-doc-check.py` 검사로 HEAD/문서 전용 변경 범위, RC-01~08 판정·30/909 합계, 상대 링크·코드 fence, LOG-001~019 본문 보존, GPT evidence 원문 무변경을 확인했다(PASS). 검사 script는 실행 후 제거했으며 프로젝트 파일로 추가하지 않았다.

### 최종 Closure·태그 준비와 다음 작업

**`weavra-v0.1-rc1` 소스 RC 태그 후보로 적합하다.** 사용자 지정 GPT RC 범위와 현재 코드의 targeted/check 검증이 모두 통과했다. 이는 다른 Provider/OS, 패키징/전체 suite/보안 검증까지 완료됐다는 뜻이 아니다. Pi 정식 lockstep release/배포 절차와 별개이며 패키지 발행·새 버전/기능은 추가하지 않는다.

- **최종 HEAD:** `dc6d3df65ad4d9217f2f82e81cd56f07511163b6`.
- **다음 작업:** 사용자 승인 후 이번 Closure 문서 두 개를 커밋하고 최종 커밋 SHA·문서 전용 diff·작업 트리를 확인한 뒤 RC 태그를 생성/푸시할 수 있다. 그 사이 코드가 바뀌면 관련 검증을 다시 수행한다. 태그 설명에도 위 evidence 한계와 NOT VERIFIED 범위를 공개한다.
- **커밋·푸시·태그:** 이번 작업에서는 모두 하지 않음. 기능/Policy 불변이며 문서 두 개만 미커밋으로 남긴다.

---

## LOG-021 — Weavra Branding + Launcher UX

- **기록일:** 2026-09-16 16:03 (KST)
- **상태:** 완료 / 미커밋
- **목적:** RC-01~08의 실행 의미를 바꾸지 않고 검증된 Runtime을 Weavra launcher·UI·문서로 제공한다.
- **시작 상태:** `devlop` clean, HEAD `183f85de1897d8b9f4fadb368a54e2b1390e5a84`. 기존 annotated tag `weavra-v0.1-rc1` object `7deb58be5b2da7b4f8e2cf42c1b1fd5d912a107c`, peeled commit은 HEAD와 동일했다. LOG-020 이후 커밋/태그 상태는 현재 조회 결과이며 이번 생성 작업이 아니다.

### 구조와 변경 파일

- `packages/company-runtime/bin/weavra` 신규: 기존 package/bin 방식의 실행 가능한 Bash wrapper. npm link의 상대/연쇄 symlink를 따라 자신의 위치를 구하고 Extension 절대경로를 계산한다. PATH의 `pi`를 `exec "$PI" -e "$EXTENSION" "$@"`로 실행한다. cwd·환경·argv 경계·exit code/시그널을 유지하고 추가 proxy 프로세스나 shell 재해석을 만들지 않는다. Pi 부재/비실행 경로·불완전 checkout에 Weavra 오류를 표시한다.
- `packages/company-runtime/package.json`: private 내부 패키지 이름/버전은 유지하고 `bin.weavra` 및 제품 설명만 추가/갱신했다. `package-lock.json`은 요구된 `npm install --package-lock-only --ignore-scripts`로 갱신했으며 bin metadata 3줄뿐이다. 새 dependency·버전 교체·shrinkwrap 변경은 없다.
- `packages/company-runtime/src/extension.ts`: 기존 Company runtime/workflow·operation UI 문자열을 Weavra로 바꾸고 TUI에만 짧은 `session_start` 알림을 등록한다. 기존 Pi 헤더·footer·trust/lifecycle/승인 흐름을 교체하지 않는다. `/workflow help`에 QUICK/STANDARD, R0/R1/R2/scoped R3, 독립 Reviewer, Human Approval, 필수 checks/freshness와 자동 commit/rollback/resume 부재를 명시했다. 나머지 세 help도 Weavra·조회 문법을 안내한다.
- `src/observations.ts`: state 없음 메시지 이름 한 곳만 변경. `src/workflow.ts`: Windows 미지원 오류 이름 한 곳만 변경. 조건·전이·자료 구조는 그대로다.
- `packages/company-runtime/test/launcher.test.ts` 신규: cwd/환경·정확한 argv·공백/빈 인수/shell 문자·help/version·symlink·오류·exit code/시그널·public loader의 네 명령 등록 13개.
- `test/extension.test.ts`: TUI-only startup 4개, help 4개 추가 및 handler 수 갱신. 모델 호출/config/state 생성이 없음을 검증한다. `test/config.test.ts`: root/package README YAML과 새 예제 파일을 실제 parser로 정규화하여 동일한지 비교하는 1개 추가.
- `README.md`: Weavra 사용자 문서를 상단에 추가하고 upstream Pi 문서는 별도 영역으로 보존했다. 요청된 10개 섹션, 설치/Quick Start/명령/안전 경계/현실적 한계/읽기 전용 DAG Projection 후보를 설명한다. Pi `--help`/`--version` passthrough와 worker profile/부모 모델 구분을 명시한다.
- `packages/company-runtime/README.md`: 제품명·launcher·도움말·현재 GPT validation 링크와 과거 단계 설명의 오래된 미검증 표현을 정리했다. 상세 API/schema 설명은 보존한다.
- `packages/company-runtime/examples/config.yaml` 신규: 실제 schema 1의 최소 실행 예제. provider/model은 명시적 placeholder이며 check script도 사용자가 작성·검토해야 한다. schema에 없는 필드는 추가하지 않았다.
- `docs/WORK_LOG.md`: 현재 요약과 본 항목. 과거 LOG-001~020 본문은 보존한다.

### 유지한 경계

`CompanyKernel`, `CompanyExtensionOptions`, `registerCompanyRuntime`, private package 이름·0.85.1 workspace 버전, `packages/company-runtime` 및 Pi session 경로를 유지했다. worker의 `Company Runtime` prompt는 모델 행동 불변을 위해 의도적으로 보존했고 사용자 문서에 구분했다. Kernel/Policy/Approval/StateStore/classifier/schema/Agent 도구·prompt, Pi Core/bin/version/config는 변경하지 않았다. COMPLEX/Planner/Lead/병렬 실행/DAG scheduler/T3Code는 구현하지 않았다. Weavra 표시는 `v0.1 RC1 (development)`이며 Pi `0.85.1`과 별개다.

### 이번 검증 명령과 실제 결과

```sh
# packages/company-runtime
node ../../node_modules/vitest/dist/cli.js --run test/launcher.test.ts test/hardening.test.ts test/kernel-hardening.test.ts test/observations.test.ts test/observation-files.test.ts test/approval.test.ts test/r2-review.test.ts test/quick.test.ts test/agent-metadata.test.ts test/contracts.test.ts test/config.test.ts test/extension.test.ts test/classification.test.ts test/kernel.test.ts test/host-boundary.test.ts test/state-store.test.ts test/policy.test.ts test/verification-boundary.test.ts

# packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run test/suite/company-runtime-timeout.test.ts test/suite/company-runtime-hardening.test.ts test/suite/company-runtime-observations.test.ts test/suite/company-runtime-approval.test.ts test/suite/company-runtime-r2.test.ts test/suite/company-runtime-quick.test.ts test/suite/company-runtime-workflow.test.ts test/suite/company-runtime-agent.test.ts test/suite/agent-session-prompt.test.ts test/suite/agent-session-runtime.test.ts test/suite/agent-session-model-extension.test.ts test/suite/agent-session-retry-events.test.ts test/suite/agent-session-queue.test.ts

# root
npm run check
git diff --check
git rev-parse HEAD weavra-v0.1-rc1 'weavra-v0.1-rc1^{}'
```

- 최종 targeted(16:02 KST): Runtime **18개 파일·519개 PASS**, 관련 coding-agent **13개 파일·412개 PASS**, 합계 **31개 파일·931개 PASS**, 실패/skip 0. 기존 909개를 이번에 다시 실행했고 branding/launcher/config 22개를 추가했다. GPT 수동 RC 8개나 과거 자동 결과를 합산하지 않는다.
- `npm run check`: PASS. Biome format 후 TypeScript/deps/entry graph/shrinkwrap/install-lock/browser smoke 모두 통과했다. 최종 포맷 이후 전체 targeted를 실행했다.
- `git diff --check`: PASS. HEAD/tag object/peeled SHA가 시작과 같음을 확인했다.
- 문서 갱신 후 최종 `npm run check`도 자동 수정 없이 PASS했다. `bash -n packages/company-runtime/bin/weavra` PASS. 임시 Python 검사로 다른 Runtime core/prompt/schema의 byte 불변, workflow/observation의 문자열 치환만 존재, lock의 bin metadata 외 불변, 과거 LOG 본문 보존, 문서 상대 링크/fence와 RC 태그를 확인했다(PASS). 임시 checker는 삭제했다.
- 초기 launcher argv test 5개와 첫 check의 TypeScript는 Vitest `it.each` 배열이 callback 인수로 펼쳐지는 테스트 작성 오류로 실패했다. 행을 `{args: [...]}`로 수정하고 launcher/extension/config **86개 PASS** 및 전체 931개를 확인했다. launcher를 오류에 맞춰 약화하지 않았다.
- lock 갱신 시 npm이 **moderate 3건**을 보고했다. 이번 작업은 dependency를 바꾸지 않았으며 일괄 `audit fix`를 하지 않았다. 해소/보안 PASS로 기록하지 않는다.

### 실제 설치·TUI smoke

- 임시 prefix에서 `npm_config_prefix=<tmp>/prefix npm link --workspace packages/company-runtime --ignore-scripts`를 실행했다. package 1개 link 성공, 생성된 `bin/weavra` symlink로 기존 설치된 Pi `0.85.1`을 호출했다. 사용자 global prefix·설정·인증은 변경하지 않았다.
- linked `weavra --version`은 `0.85.1`. 저장소 밖 임시 프로젝트에서 `pi --help`와 `weavra --help` 출력을 `cmp`하여 동일함을 확인했다.
- interactive-testing skill의 tmux 80×24, 별도 HOME/agentDir·`env -i`·offline·credential 없는 환경에서 실제 linked `weavra`를 실행했다. Pi 헤더와 별도로 Weavra 시작 3줄, 프로젝트 cwd 유지, 자동 Extension 로딩(`--no-extensions`와 병행), `/workflow help`, `/workflow`, `/state`, `/team`, `/risk` 출력을 확인했다. `/reload`와 `/quit`도 정상 종료했다.
- 초기 fixture에 모델/인증 및 fd가 없으므로 Pi의 no-model/offline-fd 경고는 예상된 결과다. 모델 prompt·workflow run을 보내지 않았고 유료 API를 호출하지 않았다. startup/명령 smoke이지 새 real-provider RC나 release smoke 통과가 아니다. 프로젝트에는 `.ai`/파일이 생성되지 않았다. 확인 후 tmux·임시 prefix/link·HOME/agentDir·fixture/script/help 비교 파일을 모두 제거했다.

### 한계·다음 작업·커밋

- source checkout과 별도 설치된 Pi/PATH에 의존하는 개인 설치다. 정식 publish/standalone 배포물·Windows·Linux·최소 Node 버전은 검증하지 않았다. 사용자의 실제 global prefix에 설치하지 않고 격리 prefix에서 같은 link 구조를 검증했다.
- Runtime semantics가 바뀌지 않아 GPT RC-01~08을 다시 실행하지 않았다. DeepSeek는 NOT VERIFIED다. 전체 upstream suite/e2e/build 및 새 vulnerability audit는 실행하지 않았다.
- **다음 단계:** 기존 state/event를 읽는 **DAG Projection 설계·구현에 진입 가능**하다. 읽기 전용 관찰과 실행 authority를 분리하는 조건이며 DAG scheduler/병렬화/COMPLEX 진입을 의미하지 않는다.
- **커밋·푸시·태그 변경:** 모두 하지 않음. 안정 태그 `weavra-v0.1-rc1`을 그대로 유지한다.

---

## LOG-022 — Weavra Branding + Launcher 커밋·푸시 준비

- **기록일:** 2026-09-16 16:13 (KST)
- **상태·목적:** 사용자 요청에 따라 LOG-021의 변경을 커밋하고 `origin/devlop`에 게시하기 위한 검증 완료.
- **변경 파일:** LOG-021의 launcher·UI·테스트·README/config·작업 이력 및 `package-lock.json` 총 13개 파일. lockfile은 `bin.weavra` metadata 3줄뿐이며 dependency 변경은 없다. 이번 준비에서는 작업 이력만 추가했다.
- **이번 검증:** `npm run check` 재실행 PASS, Biome 자동 수정 없음. `git diff --check` PASS. `git status --short --branch`와 staged diff로 다른 변경/기존 staged 파일이 없음을 확인했다. HEAD와 RC tag object/peeled commit이 LOG-021 시작과 같음을 확인했다.
- **과거 검증과 구분:** 31개 파일·931개 PASS 및 실제 npm-link/TUI smoke는 LOG-021의 구현 검증 결과다. 이번 커밋 준비에서는 테스트·실제 Provider를 다시 실행하지 않았다.
- **문제·해결:** 추가 문제 없음. 사용자 승인된 launcher 등록에 필요한 lockfile만 `PI_ALLOW_LOCKFILE_CHANGE=1`로 명시적으로 포함하며 일반 pre-commit 검사는 유지한다.
- **남은 제한·다음 작업:** 기존 플랫폼/DeepSeek/배포물 미검증과 Runtime semantics 불변을 유지한다. 명시적 13개 경로만 stage·commit 후 일반 push하고 원격 HEAD 일치·clean·안정 태그 불변을 확인한다. 다음 제품 단계는 읽기 전용 DAG Projection이다.
- **커밋 상태:** 이 항목 작성 시 실행 직전. 메시지는 `feat(coding-agent): add Weavra branding and launcher UX`이며 실제 SHA·push 결과는 Git 이력과 최종 응답으로 보고한다. RC 태그는 수정·이동·재생성하지 않는다.

---

## LOG-023 — Weavra Status Projection

- **기록일:** 2026-09-16 17:06 (KST)
- **상태:** 완료 / 미커밋
- **목적:** 기존 Runtime 상태를 Pi TUI에서 지속적으로 확인하는 관찰 UX를 추가한다. 새 실행 기능·상태 authority·DAG model은 만들지 않는다.
- **시작 상태:** `devlop` clean, HEAD/origin `9cef7aa93ef2d39cb874856045a21c09177135bf`. LOG-022의 branding/launcher는 `632ad3bcdb2dc5dc4263348654542fb26823fe1c`로 커밋·푸시됐으며, 이후 추가된 `docs/WEAVRA_EXTENSION_ADOPTION_PLAN.md`를 읽고 보존했다. 안정 RC tag object는 계속 `7deb58be5b2da7b4f8e2cf42c1b1fd5d912a107c`다.

### 설계와 변경 파일

- `packages/company-runtime/src/status.ts` 신규: 기존 `Run` snapshot을 짧은 문자열로 만드는 순수 함수. QUICK/STANDARD·R0~R3·현재 phase/activeAgents를 읽고 WAITING_APPROVAL만 표시상 APPROVAL로 투영한다. terminal은 과거 active role/phase 없이 실제 종료 상태만 표시한다. Run/schema는 변경하지 않는다.
- `packages/company-runtime/src/extension.ts`: 공식 `ctx.ui.setStatus("weavra.runtime", text)`를 TUI에만 연결했다. 상태 소스는 이 Host가 소유한 `StandardWorkflow.snapshot`이며 `RuntimeEvent`는 갱신 신호일 뿐 replay/state machine이 아니다. event.runId와 현재 snapshot이 일치할 때만 읽고 같은 문자열은 재발행하지 않는다. 기존 주입 observer와 Kernel의 delivery diagnostics는 유지한다.
- Kernel 생성 중 Host에 snapshot이 아직 연결되지 않은 RunCreated 및 이전 run recovery event는 건너뛴다. 이후 RunStarted/step/agent/approval/terminal event의 최신 snapshot을 읽으므로 완료 event의 과거 step 이름으로 phase를 되돌리지 않는다. token/tool마다 polling하거나 timer를 두지 않는다.
- 실행 Promise가 끝나면 final snapshot/report를 한 번 재확인한다. 이벤트 없는 persistence 실패도 반영하고 별도 cleanup/report 오류가 있으면 `Weavra · ATTENTION · /state`로 표시한다. 소유 실행이 끝났는데 active snapshot이 남으면 `Weavra · UNCONFIRMED · /state`다.
- 저장된 run/writer만으로 live를 추정하지 않는다. 시작/reload에서는 파일을 읽지 않고 표시를 비우며 `/state` 등 과거 조회는 footer를 덮어쓰지 않는다. 완료 후 footer는 이 Pi에서 실행한 마지막 결과이지 현재 Git 검증 보장이 아니다.
- 새 run preflight에서 이전 결과를 비운다. 명시적 cancel은 기존 cleanup 후 실제 terminal 결과로 바꾸고, switch/fork/tree/reload/shutdown은 cleanup을 기다리기 **전에** UI를 분리·clear하여 늦은 event/finally의 stale 재표시를 막는다. 다른 status 키·footer는 교체하지 않는다.
- snapshot/format/setStatus/clear 예외는 UI 계층에서 격리하며 실행 결과·취소·정리를 바꾸지 않는다. 외부 footer가 Pi의 공식 extension status map을 렌더링하면 공존할 수 있고 `pi-footer` 의존성은 없다. UI 자체가 고장 난 경우 화면 문자 제거는 best-effort다.
- 테스트: `packages/company-runtime/test/status.test.ts` 신규 19개, 기존 `test/extension.test.ts`의 TUI-only startup/clear assertions 보강. `packages/coding-agent/test/suite/company-runtime-status.test.ts` 신규 25개는 기존 harness/faux·실제 SDK/Git/check를 사용한다.
- 문서: `README.md`, `packages/company-runtime/README.md`에 source/update timing·표시·lifecycle/stale·error·공존 계약을 추가했다. `docs/WORK_LOG.md`의 현재 요약과 본 기록을 추가하며 이전 LOG 본문을 보존했다. 변경은 총 8개 파일이다.

### 표시 예와 유지한 의미

```text
Weavra · QUICK · R1 · IMPLEMENT · Executor
Weavra · STANDARD · R2 · REVIEW · Reviewer
Weavra · STANDARD · R3 · APPROVAL · Developer
Weavra · COMPLETED
Weavra · BLOCKED
Weavra · CANCELLED
```

Kernel/Workflow owner/Policy/Approval/StateStore/분류/schema/worker prompt·도구·권한·리소스 격리는 그대로다. `.ai`에 status를 저장하지 않고 UI 문자열 한 개와 UI 연결만 메모리에 보관한다. Launcher·package/bin·lockfile·Pi Core·RC 태그도 변경하지 않았다. DAG Scheduler/Graph model/Planner/Lead/COMPLEX/병렬 실행은 추가하지 않았다.

### 이번 자동 검증

```sh
# packages/company-runtime
node ../../node_modules/vitest/dist/cli.js --run test/status.test.ts test/launcher.test.ts test/hardening.test.ts test/kernel-hardening.test.ts test/observations.test.ts test/observation-files.test.ts test/approval.test.ts test/r2-review.test.ts test/quick.test.ts test/agent-metadata.test.ts test/contracts.test.ts test/config.test.ts test/extension.test.ts test/classification.test.ts test/kernel.test.ts test/host-boundary.test.ts test/state-store.test.ts test/policy.test.ts test/verification-boundary.test.ts

# packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2 test/suite/company-runtime-status.test.ts test/suite/company-runtime-timeout.test.ts test/suite/company-runtime-hardening.test.ts test/suite/company-runtime-observations.test.ts test/suite/company-runtime-approval.test.ts test/suite/company-runtime-r2.test.ts test/suite/company-runtime-quick.test.ts test/suite/company-runtime-workflow.test.ts test/suite/company-runtime-agent.test.ts test/suite/agent-session-prompt.test.ts test/suite/agent-session-runtime.test.ts test/suite/agent-session-model-extension.test.ts test/suite/agent-session-retry-events.test.ts test/suite/agent-session-queue.test.ts

# root
npm run check
git diff --check
```

- Runtime **19개 파일·538개 PASS**. coding-agent **14개 파일·437개 PASS**. 최종 합계 **33개 파일·975개 PASS**, 실패/skip 0. 신규 44개와 기존 S0~S6/RC·branding/launcher 및 관련 Pi 회귀를 모두 이번에 실행했다. 과거 931개 및 수동 GPT RC 결과를 중복 합산하지 않는다.
- QUICK R0/R1, STANDARD R1/R2의 실제 implement/self-check/review/test/complete 순서와 중복 UI 호출 생략, R3 승인 UI 진입 시 WAITING_APPROVAL·대상 파일 존재·Approve/Deny 결과, 독립 BLOCK, 세 역할 cancel, 네 lifecycle hook의 늦은 event 차단/새 실행 연결을 검증했다.
- 저장된 RUNNING을 writer 유무와 무관하게 live로 투영하지 않음, 조회 시 source bytes 불변·Provider 호출 0, 다른 status 키 보존, RPC 미출력, UI/formatter/observer throw·reject와 clear 실패에서 정상 COMPLETE 또는 cancel/lock 정리 유지, event 없는 저장 실패와 terminal 뒤 cleanup 실패의 final 투영을 검증했다.
- `npm run check`: PASS(TypeScript/deps/entry graphs/shrinkwrap/install-lock/browser smoke 포함). Biome의 테스트 포맷 후 전체 targeted를 실행했고 문서 갱신 후 최종 check도 자동 수정 없이 PASS했다. `git diff --check`: PASS. 임시 문서 검사로 상대 링크/fence, LOG-001~022 본문 보존, launcher/package/lock/adoption plan 불변을 확인했다(PASS). 검사 script는 제거했다.
- 최초 신규 통합 23개 중 2개 실패는 faux가 QUICK의 risk를 `scope.risk` 대신 STANDARD payload의 risk 필드에서 읽어 R0에 write를 요청한 fixture 오류였다. 올바른 payload 분기로 고쳐 23개 PASS 후 RPC/clear-failure 2개를 추가했다. Runtime guard는 바꾸지 않았다.
- 최초 전체 병렬 실행은 기존 QUICK `cancels an active TEST process`의 기본 waitFor(1초) 안에 marker가 나타나지 않아 **436 PASS / 1 FAIL**이었다. 해당 테스트와 Runtime을 변경하지 않고 동시 worker를 2로 제한해 관련 전체 14개 파일을 다시 실행하여 **437 PASS**를 확인했다. 병렬 부하에서의 시간 민감성 가능성이 있으며 지연 원인 분포를 별도로 측정한 것은 아니다.

### 실제 Pi TUI smoke

- interactive-testing skill의 tmux **80×24**, 저장소 `pi-test.sh`, 임시 Extension wrapper와 기존 suite harness/faux를 사용했다. 별도 HOME/agentDir·credential 없는 `env -i`·offline·외부 임시 Git fixture만 사용했고 실제 Provider/유료 토큰은 호출하지 않았다.
- 기본 Pi footer에서 `Other status`와 Weavra가 동시에 표시됐다. QUICK/R0 IMPLEMENT→COMPLETED, STANDARD/R1 IMPLEMENT·SELF_CHECK·REVIEW/Reviewer, R3 APPROVAL/Developer와 실제 Deny modal→BLOCKED, 명시적 QUICK cancel→CANCELLED를 확인했다.
- 완료 후 reload 및 live Developer 중 reload에서 Weavra만 제거되고 Other status는 남았다. reload 후 `/state`의 저장 CANCELLED 조회도 footer에 과거 phase를 복원하지 않았다.
- 종료 후 임시 state의 실제 결과 **COMPLETED, COMPLETED, BLOCKED, CANCELLED, CANCELLED**, R3 DENIED·원본 파일 유지, writer.lock 부재, UI key 미저장을 검사했다(PASS). 초기 fd/model 미설정 경고는 offline fixture의 예상 결과다. 실제 TUI의 TEST 프레임은 별도 캡처하지 않았고 자동 순서 검증으로 확인했다.
- 임시 Python 검사에서 변경 대상 외 Runtime core/prompt/schema의 byte 불변과 RC tag 불변도 PASS했다. tmux·임시 fixture/wrapper/검사 script를 정리했다. 실제 프로젝트 `.ai`는 생성하지 않았다.

### 한계·다음 작업·커밋

- 기본 Pi footer 및 별도 status 키와의 공존을 검증했으며 외부 pi-footer 자체를 설치/실행하지 않았다. 공식 status map을 무시하는 custom footer의 표시를 강제로 바꾸지 않는다. 저장된 다른 owner의 실시간 실행을 추적하거나 재시작 후 terminal을 복원하지 않는다.
- snapshot/보고 오류로 표시한 ATTENTION/UNCONFIRMED는 관찰 진단이며 저장된 Run status를 재작성하지 않는다. UI API가 clear 자체를 거부하면 실제 화면 제거를 보장하지 않지만 Runtime 결과는 바꾸지 않는다.
- Runtime semantics 불변이므로 GPT RC-01~08은 재실행하지 않았다. DeepSeek·다른 OS/Node 조합은 계속 NOT VERIFIED. 전체 upstream suite/e2e/build는 미실행이다.
- **다음 작업:** 사용자 확인 후 다음 관찰/Host 개선 범위를 정한다. DAG Projection 또는 worktree는 별도 승인 범위이며 이번에 구현하지 않았다.
- **커밋·푸시:** 하지 않음. 안정 태그 `weavra-v0.1-rc1`은 수정·이동하지 않았다.

---

## LOG-024 — Weavra Status Projection 커밋·푸시 준비

- **기록일:** 2026-09-16 17:18 (KST)
- **상태·목적:** 사용자 요청에 따라 LOG-023의 Status Projection 변경을 커밋하고 `origin/devlop`에 게시하기 위한 검증 완료.
- **변경 파일:** LOG-023의 status formatter·Extension 연결·테스트·README·작업 이력 총 8개 파일. 이번 준비에서는 작업 이력만 추가했다. dependency/lockfile/launcher/Runtime core 변경은 없다.
- **이번 검증:** `npm run check` 재실행 PASS, Biome 자동 수정 없음. `git diff --check` PASS. `git status --short --branch`와 staged diff로 대상 외 변경·기존 staged 파일이 없음을 확인했다. RC tag object/peeled SHA가 기존 기준점과 같음을 확인했다.
- **과거 검증과 구분:** 33개 파일·975개 PASS 및 실제 TUI smoke는 LOG-023의 구현 검증 결과다. 이번 커밋 준비에서는 테스트·실제 Provider를 재실행하지 않았다.
- **문제·해결:** 추가 문제 없음. 명시적 8개 경로만 stage하며 일반 commit/push와 검사 절차를 유지한다.
- **남은 제한·다음 작업:** 기존 플랫폼/DeepSeek/외부 footer 미검증과 Runtime semantics 불변을 유지한다. 게시 후 로컬·원격 HEAD 일치, clean, RC 태그 불변을 확인한다. 이후 제품 범위는 별도 사용자 승인에 따른다.
- **커밋 상태:** 이 항목 작성 시 실행 직전. 메시지는 `feat(coding-agent): project Weavra runtime status in the Pi footer`이며 실제 SHA·push 결과는 Git 이력과 최종 응답으로 보고한다. `weavra-v0.1-rc1`은 수정·이동·재생성하지 않는다.

---

## LOG-025 — Fork-local Weavra Launcher

- **기록일:** 2026-09-16 17:31 (KST)
- **상태:** 구현·자동 회귀 완료 / 미커밋. 실제 full build 및 built CLI 성공 startup 미검증.
- **목적:** 기존 global `pi` 설치를 보존하면서 `weavra`는 같은 kjg8619/pi checkout의 coding-agent build와 Runtime을 실행하도록 한다.
- **시작 상태:** `devlop` clean, HEAD/origin `2205dec84fa4d397ec70032459dfc4934c052b12`. LOG-024 뒤 사용자 승인으로 Status Projection을 해당 커밋에 게시한 상태다. RC tag object `7deb58be5b2da7b4f8e2cf42c1b1fd5d912a107c` 및 peeled commit `183f85de1897d8b9f4fadb368a54e2b1390e5a84`는 유지한다.

### 조사·구현·변경 파일

- `packages/coding-agent/package.json`의 공식 bin은 `dist/bundle/cli.js`다. 기존 root build가 workspace 의존성을 순서대로 빌드하고 `scripts/build-coding-agent-bundle.mjs`가 이 executable과 SDK/chunks를 생성함을 확인했다. 새 fork-specific Pi Core나 별도 build pipeline은 필요 없다.
- `packages/company-runtime/bin/weavra`: `command -v pi`를 제거하고 실제 launcher 위치에서 checkout root를 계산해 `packages/coding-agent/dist/bundle/cli.js`를 고정한다. local CLI가 일반 파일·readable·executable이 아니면 명시적 경로와 `cd <checkout> && npm install --ignore-scripts && npm run build` 안내 후 exit 1이다. help/version도 예외가 아니며 local CLI 오류 후에도 global fallback은 없다.
- Extension과 CLI를 checkout 기준 절대경로로 넘기고 기존 `exec "$PI" -e "$EXTENSION" "$@"` 방식을 유지한다. npm-link/상대·연쇄 symlink·checkout alias·공백 경로를 지원한다. 경로 계산의 subshell `cd`에만 `CDPATH=`를 적용해 사용자 CDPATH에 의한 다른 경로 선택/추가 출력을 막으며 caller cwd/env는 바꾸지 않는다.
- `packages/company-runtime/test/launcher.test.ts`: local CLI process fixture를 임시 checkout에 만들고 실제 Extension 소스를 복사해 public loader 검사도 유지한다. 기본 PATH에는 node만 준비하고 pi는 두지 않는다. 다른 버전 global Pi trap, 실행/누락/실패 시 미호출, symlink·cwd·argv/env·stdio·exit/signal 및 실제 격리 npm link의 기존 pi 보존을 검증한다. built Pi 자체의 통합 실행으로 오인하지 않도록 fixture 목적을 주석에 명시했다.
- `README.md`, `packages/company-runtime/README.md`: global Pi 설치 요구를 제거하고 root install→build→Weavra workspace만 link하는 흐름을 문서화했다. `pi`와 `weavra` 공존, local help/version, no fallback, pull/source/dependency 변경 뒤 rebuild, offline build, 설정/session 미분리를 설명한다.
- `docs/WORK_LOG.md`: 현재 요약과 본 기록. 변경은 총 **5개 파일**이며 package metadata/lockfile/build scripts/Pi Core/Runtime 및 Status Projection 소스는 그대로다.

### 실행·버전·설정 경계

```text
pi      → 기존 사용자 설치 (executable/symlink 불변)
weavra  → exec <checkout>/packages/coding-agent/dist/bundle/cli.js
               -e <checkout>/packages/company-runtime/src/extension.ts <args>
```

Global Pi 버전과 실행 경로가 Weavra의 CLI 선택에 영향을 주지 않는다. 같은 checkout의 CLI와 Extension을 사용하지만 **오래된 local build를 자동 검출하거나 재빌드하지는 않는다.** checkout 갱신 시 사용자가 다시 build해야 한다. Weavra 제품 버전과 Pi 버전은 여전히 별개다. `~/.pi`·auth/models/settings/sessions 및 `PI_CODING_AGENT_DIR` 등 환경변수는 그대로이며 별도 Weavra 디렉터리 분리는 후속 설계로 남긴다. Policy/Approval/Risk/Workflow/RC 의미는 변경하지 않는다.

### 이번 검증 명령과 실제 결과

```sh
# packages/company-runtime
node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2 test/launcher.test.ts test/status.test.ts test/hardening.test.ts test/kernel-hardening.test.ts test/observations.test.ts test/observation-files.test.ts test/approval.test.ts test/r2-review.test.ts test/quick.test.ts test/agent-metadata.test.ts test/contracts.test.ts test/config.test.ts test/extension.test.ts test/classification.test.ts test/kernel.test.ts test/host-boundary.test.ts test/state-store.test.ts test/policy.test.ts test/verification-boundary.test.ts

# packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2 test/suite/company-runtime-status.test.ts test/suite/company-runtime-timeout.test.ts test/suite/company-runtime-hardening.test.ts test/suite/company-runtime-observations.test.ts test/suite/company-runtime-approval.test.ts test/suite/company-runtime-r2.test.ts test/suite/company-runtime-quick.test.ts test/suite/company-runtime-workflow.test.ts test/suite/company-runtime-agent.test.ts test/suite/agent-session-prompt.test.ts test/suite/agent-session-runtime.test.ts test/suite/agent-session-model-extension.test.ts test/suite/agent-session-retry-events.test.ts test/suite/agent-session-queue.test.ts

# root
npm run check
bash -n packages/company-runtime/bin/weavra
git diff --check
```

- 초기 launcher/config/Extension/status targeted **4개 파일·112개 PASS**. 최종 전체 targeted **Runtime 19개 파일·545개 + coding-agent 14개 파일·437개 = 33개 파일·982개 PASS**, 실패/skip 0. Launcher는 기존 13개를 local 실행 계약으로 갱신하고 순증 7개인 **20개**다. LOG-023의 975개는 과거 결과이며 이번에 모두 다시 실행했다.
- global Pi 없는 PATH에서도 local fixture 실행, global `0.1.0`/`999.0.0` 존재 시 미호출 및 직접 `pi --version` 결과 보존, local build 누락/디렉터리/비실행 파일 시 명확한 fail-fast, local exit 42 뒤에도 fallback 없음, npm-link/checkout alias·공백·빈 인수·shell 문자·cwd·HOME/agentDir·stdio·exit 23·SIGTERM을 검증했다.
- 테스트에서 실제 `npm link --workspace packages/company-runtime --ignore-scripts --offline`을 **임시 npm prefix**에 수행했다. `weavra`가 저장소 launcher를 가리키고 미리 만든 `pi` symlink와 대상 bytes/실행 결과가 그대로임을 확인했다. 사용자 global prefix는 변경하지 않았다.
- `npm run check`: PASS(TypeScript/deps/entry graph/shrinkwrap/install-lock/browser smoke 포함). 최초 Biome은 launcher test 한 파일만 포맷했고 그 이후 전체 targeted를 실행했다. npm link가 bin에 weavra만 추가함을 확인하는 assertion 보강 뒤 launcher **20개 PASS**를 재확인했고 최종 root check도 자동 수정 없이 PASS했다. `bash -n`과 `git diff --check`: PASS. 이번 테스트 실패는 없다.
- 임시 Python 검사로 모든 Runtime/Status 소스·Pi Core·package/lock·RC 태그·기존 global pi symlink 불변, 문서 상대 링크/fence 및 LOG-001~024 본문 보존을 확인했다(PASS). 검사 script는 실행 후 삭제했다.
- 실제 checkout에는 `packages/coding-agent/dist/bundle/cli.js`가 없었다. `/tmp`에서 실제 launcher `--version` 실행 시 checkout build 안내·`No global Pi fallback`과 **exit 1**을 확인했다. 설치된 `/Users/kangjingoo/.local/bin/pi`는 시작과 동일한 symlink로 남았다. 이는 성공 startup 검증이 아니라 의도된 build-missing 경계 검증이다.

### 문제·해결·남은 제한·다음 작업

- 문제는 global Pi 업데이트/경로 선택이 Weavra와 별개로 달라지는 것이었다. 기존 공식 built bin 경로만 사용하여 실행 파일 결합을 checkout으로 옮겼으며 global Pi를 제거/수정하거나 runtime 권한을 바꾸지 않았다.
- 저장소 지침상 명시 요청 없이 build를 실행하지 않는다. 이번에는 `npm run build`/`build:offline`을 실행하지 않았고 build 산출물을 실제 checkout에 임의로 만들지도 않았다. 자동 테스트의 local CLI는 process fixture이며 실제 bundled Pi 성공 실행·TUI smoke를 대신하지 않는다.
- GPT RC-01~08/DeepSeek/유료 Provider/전체 upstream suite/e2e/다른 OS는 미실행. 현재 macOS/Node 환경의 자동 회귀와 실행 연결 경계만 검증했다.
- **다음 작업:** 사용자 승인 후 root build와 실제 fork-local `weavra --version`/TUI 네 명령·Status Projection smoke를 수행한다. 설정/session directory 분리는 별도 설계 범위다.
- **커밋·푸시·태그 변경:** 모두 하지 않음. `weavra-v0.1-rc1` 안정 기준점을 그대로 유지한다.

---

## LOG-026 — Fork-local Launcher 사용자 실행 확인

- **기록일:** 2026-09-16 17:37 (KST)
- **상태·목적:** 사용자가 직접 명령을 실행해 정상 동작했다고 보고한 후속 수동 확인을 기록한다.
- **변경 파일:** `docs/WORK_LOG.md`의 현재 요약 및 본 항목만 갱신했다. 코드·설정·태그는 변경하지 않았다.
- **검증·출처:** 사용자 실행 성공 보고를 수신했다. 구체적인 명령·출력·build 방식·CLI 버전·네 명령/Status Projection 화면은 전달되지 않았다. 에이전트가 실제 built CLI를 실행한 결과나 전체 TUI/RC PASS로 확대하지 않는다. LOG-025의 자동 982개 PASS는 직전 구현 검증 결과이며 이번에 재실행하지 않았다.
- **문제·해결:** 이전 기록의 에이전트 미실행 사실은 보존하고 사용자 확인을 별도 후속 evidence로 연결했다.
- **남은 제한·다음 작업:** 추가 build를 자동 실행하지 않는다. 필요 시 구체적인 version/TUI 결과를 후속 기록한다. 설정/session directory 분리는 별도 설계로 유지한다.
- **커밋·푸시:** 하지 않음. launcher 변경은 계속 미커밋이다.

---

## LOG-027 — Fork-local Launcher 커밋·푸시 준비

- **기록일:** 2026-09-16 17:41 (KST)
- **상태·목적:** 사용자 요청에 따라 LOG-025~026의 fork-local launcher 변경과 사용자 확인 기록을 커밋하고 `origin/devlop`에 게시하기 위한 검증 완료.
- **변경 파일:** `README.md`, `packages/company-runtime/README.md`, `packages/company-runtime/bin/weavra`, `packages/company-runtime/test/launcher.test.ts`, `docs/WORK_LOG.md` 총 5개. 이번 준비에서는 작업 이력만 갱신했다.
- **이번 검증:** `npm run check` 재실행 PASS, Biome 자동 수정 없음. `git diff --check` PASS. `git status --short --branch`와 staged diff로 대상 외 변경·기존 staged 파일이 없음을 확인했다. RC tag object/peeled SHA 불변을 확인했다.
- **과거 검증과 구분:** 자동 33개 파일·982개 PASS와 launcher 20개 재검증은 LOG-025 결과다. 사용자 정상 실행 보고는 LOG-026의 수동 evidence이며 상세 명령/출력은 미수집이다. 이번 준비에서는 테스트/build/실제 Provider를 재실행하지 않았다.
- **문제·해결:** 추가 문제 없음. 명시적 5개 경로만 stage하고 일반 commit/push를 사용한다. global Pi 설치/명령과 Runtime/Status/Policy 의미는 그대로다.
- **남은 제한·다음 작업:** 기존 build freshness·설정/session 공유·플랫폼 미검증 제한을 유지한다. 게시 후 로컬·원격 HEAD 일치, clean, RC 태그 불변을 확인한다.
- **커밋 상태:** 이 항목 작성 시 실행 직전. 메시지는 `fix(coding-agent): launch Weavra with the fork-local Pi build`이며 실제 SHA·push 결과는 Git 이력과 최종 응답으로 보고한다. 안정 태그는 수정·이동하지 않는다.

---

## LOG-028 — Weavra Worktree Launcher V1

- **기록일:** 2026-09-16 18:02 (KST)
- **상태:** 구현·자동 회귀 완료 / 미커밋
- **목적:** 원본 checkout의 파일·HEAD·branch를 유지하면서 명시적으로 생성한 Git worktree에서 기존 Weavra를 실행한다.
- **시작 상태:** `devlop` clean, HEAD `14c3f699202e937ddae8bdc9f487cf57c7afe8aa`. LOG-027 이후 fork-local launcher가 이 커밋에 반영된 상태였다. RC tag object `7deb58be5b2da7b4f8e2cf42c1b1fd5d912a107c`와 peeled commit `183f85de1897d8b9f4fadb368a54e2b1390e5a84`는 시작·최종 조회에서 동일했다.

### 구현·변경 파일

- `packages/company-runtime/bin/weavra`: 기존 fork-local CLI/Extension 경로·local build 사전 검사를 유지한다. `--worktree <name>`만 배열 기반으로 소비하고 `--` 이후는 그대로 전달한다. 기본 `weavra`는 기존 cwd/argv/env/stdio/exit/signal 계약을 유지한다.
- Git root를 canonical 경로로 확인하고 HEAD commit·branch를 고정한다. clean tracked/staged/untracked·submodule 상태와 검사 성공을 요구한다. 이름은 ASCII 제한 및 `git check-ref-format --branch`로 검증하고 기존 branch/target은 거부한다. source 상태는 생성 직전·직후·Pi 실행 전 재검증한다.
- `<repo-parent>/.weavra-worktrees/<repo-name>/<name>`에 부모 디렉터리를 준비하고 target을 `mkdir`로 배타 예약한다. Git이 기존 빈 target을 허용하는 동작에 의존해 사용자 빈 디렉터리를 재사용하지 않도록 하기 위함이다. `git worktree add -b weavra/<name> <target> <frozen-head>`를 quoted argv로 실행하며 eval/명령 문자열 재해석은 없다.
- 생성 후 target HEAD·branch·clean 상태를 확인하고 stderr에 Branch/Path/Base를 표시한다. target 루트로 cwd를 바꾼 후 기존 `exec <checkout>/packages/coding-agent/dist/bundle/cli.js -e <checkout>/packages/company-runtime/src/extension.ts <args>`로 교체한다. 별도 Pi proxy·signal handler·global fallback·종료 후 cleanup은 없다.
- source index의 불필요한 쓰기와 checkout/fsmonitor hook 부작용을 막도록 launcher Git 명령에만 optional locks 비활성·hooks/fsmonitor override를 적용한다. repository를 바꾸는 Git 환경변수, worktree 부모 symlink, source 내부 target, 줄바꿈 root 경로는 보수적으로 거부한다. Pi 환경 자체를 정리하거나 trust를 허용하지 않는다.
- `packages/company-runtime/test/worktree.test.ts` 신규 **55개**: 실제 임시 Git, fork-local CLI process fixture, global Pi trap, Git argv audit/실패 주입으로 생성·보호·충돌·실패·종료 보존을 검증한다.
- `packages/coding-agent/test/suite/company-runtime-workflow.test.ts` **3개 추가**: 기존 suite harness/faux SDK를 사용한다. 실제 launcher가 만든 worktree cwd에서 실제 Worker/Policy/Git checks/StateStore를 실행하여 COMPLETED/BLOCKED/CANCELLED, 작업 파일·`.ai`·branch/worktree 보존 및 source 무변경을 확인한다. CLI 프로세스만 cwd 출력 fixture이며 실제 bundled CLI 전체 실행은 아니다.
- `README.md`, `packages/company-runtime/README.md`: 두 실행 방식, 생성 위치/branch, clean source/config 사전 commit, ignored 파일 미복사, no automatic merge/commit/stash/reset/remove, 수동 검토와 OS sandbox 아님을 설명한다.
- `docs/WORK_LOG.md`: 현재 요약 및 이 항목. 총 **6개 파일** 변경이다. 기존 launcher test는 수정 없이 재실행했다.

### 안전 경계와 유지한 의미

원본 Git checkout으로 돌아가는 checkout/reset/stash/clean이나 자동 commit/merge/rollback/branch 삭제/worktree 삭제/PR/충돌 해결은 구현하지 않았다. 실패·BLOCKED·CANCELLED·SIGTERM/SIGINT 종료에도 생성 결과를 남긴다. Git add 실패 또는 사후 검사 실패에서도 성공 안내/Pi 실행을 차단하고 부분 생성 branch/worktree·예약 디렉터리를 자동 정리하지 않는다. 외부 프로세스가 source HEAD/branch를 바꾼 경우에도 감지·중단할 뿐 원상복구하지 않는다.

Kernel/Workflow/QUICK·STANDARD/R0~R3/Policy/Approval/Reviewer/Verification/StateStore/RuntimeEvent/Status Projection·worker 도구/prompt의 구현은 변경하지 않았다. `.ai`는 기존 cwd 계약에 따라 worktree에 저장된다. Pi Core/공식 bin/build scripts/package metadata/dependencies/lockfile도 불변이다.

### 이번 검증 명령·실제 결과

```sh
# packages/company-runtime: launcher/worktree, Status Projection, S0~S6 + RC
node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2 test/worktree.test.ts test/launcher.test.ts test/status.test.ts test/hardening.test.ts test/kernel-hardening.test.ts test/observations.test.ts test/observation-files.test.ts test/approval.test.ts test/r2-review.test.ts test/quick.test.ts test/agent-metadata.test.ts test/contracts.test.ts test/config.test.ts test/extension.test.ts test/classification.test.ts test/kernel.test.ts test/host-boundary.test.ts test/state-store.test.ts test/policy.test.ts test/verification-boundary.test.ts

# packages/coding-agent: faux Runtime/RC/Status 및 관련 기존 Pi 회귀
node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2 test/suite/company-runtime-status.test.ts test/suite/company-runtime-timeout.test.ts test/suite/company-runtime-hardening.test.ts test/suite/company-runtime-observations.test.ts test/suite/company-runtime-approval.test.ts test/suite/company-runtime-r2.test.ts test/suite/company-runtime-quick.test.ts test/suite/company-runtime-workflow.test.ts test/suite/company-runtime-agent.test.ts test/suite/agent-session-prompt.test.ts test/suite/agent-session-runtime.test.ts test/suite/agent-session-model-extension.test.ts test/suite/agent-session-retry-events.test.ts test/suite/agent-session-queue.test.ts

# root
npm run check
bash -n packages/company-runtime/bin/weavra
git diff --check
git rev-parse HEAD weavra-v0.1-rc1 'weavra-v0.1-rc1^{}'
```

- 자동 환경: Darwin arm64, Node `v26.7.0`, 로컬 Git/POSIX. Runtime **20개 파일·600개**, coding-agent **14개 파일·440개**, 합계 **34개 파일·1,040개 PASS**, 실패/skip 0. LOG-025의 982개는 과거 결과이며 이번에 모두 다시 실행했다. 신규 55+3개를 포함한다.
- 초기 launcher/worktree **2개 파일·71개 PASS** 후 추가 경로 보호 4개를 보완했고 최종에는 worktree 55개·기존 launcher 20개가 포함됐다. 공백/빈/shell 문자 argv, canonical subdirectory/npm link, detached/linked-worktree source, 정확한 add argv, 원본 bytes/index/HEAD/branch 불변, 세 종류 dirty, 기존 branch/빈·비어있지 않은 디렉터리/file/dangling symlink를 검증했다.
- non-Git/unborn HEAD, Git root/HEAD/branch/status/ref/add/사후 검사 실패, 부분 add, dirty target, 전후 source 교체, source 내부 target·줄바꿈 경로·symlink/비디렉터리 부모·Git 환경 override·hook 차단·build 누락을 검증했다. 모든 launcher Git 호출은 읽기 검사 및 `worktree add -b` allowlist로 감사했고 global Pi trap은 한 번도 호출되지 않았다.
- 종료 코드 0/23, SIGTERM/SIGINT, CLI outcome별 `.ai`/branch/worktree 보존을 process fixture로 검증했다. 별도로 실제 SDK/faux 통합에서 worktree의 파일만 수정되고 `.ai/state.json`에 실제 terminal이 저장되며 lock이 정상 해제되는지 검증했다.
- 통합 초기 **43 PASS / 3 FAIL**은 macOS `/var`와 canonical `/private/var`의 테스트 기대 경로 불일치였다. `realpathSync`로 기대 경로를 정규화하고 stderr를 capture하도록 고쳐 해당 suite **46개 PASS**, 최종 전체 440개 PASS를 확인했다. launcher/Runtime guard를 완화하지 않았다.
- `npm run check`: **PASS**, TypeScript/deps/entry graphs/shrinkwrap/install-lock/browser smoke 포함. Biome은 이번 두 테스트 파일만 포맷했다. 이후 전체 targeted를 실행했다. `bash -n`, `git diff --check`: **PASS**. 최종 문서 기록 후 root check를 다시 실행해 자동 수정 없이 PASS했고 `bash -n`·`git diff --check`도 PASS했다. 임시 Python 검사로 정확한 6개 변경 파일, staged 변경 없음, LOG-001~027 본문 보존, Markdown fence/공백, HEAD/RC tag 불변, 실제 프로젝트 `.ai` 부재를 확인했다(PASS). 검사 script는 제거했다.

### 한계·다음 작업·커밋

- source/worktree는 Git object/ref 저장소를 공유한다. 외부 프로세스의 검사/생성 사이 교체, trusted Git filter·등록 check·Pi 내부 부작용은 OS 수준으로 격리하지 않는다. 생성 실패 후 남은 디렉터리/branch는 사용자가 직접 검토한다.
- uncommitted/ignored 파일·node_modules·기존 `.ai` 실행 상태는 복사하지 않는다. worktree에 필요한 config/check는 먼저 commit하고 의존성 등은 사용자가 준비해야 한다. 자동 build/freshness 검사·독립 auth/session 디렉터리는 추가하지 않았다.
- Runtime semantics 불변이므로 실제 GPT RC-01~08을 재실행하지 않았다. 유료 Provider·실제 bundled Pi/TUI startup·build·전체 upstream suite/e2e·다른 OS/Node 조합은 이번에 미실행이다. 실제 워크플로 검증은 기존 harness/faux이며 CLI fixture와 구분한다.
- **다음 작업:** 사용자가 clean 프로젝트에서 `weavra --worktree <name>`을 실행하고 남은 worktree의 diff/state/check 결과를 직접 검토한다. 후속 확장은 별도 승인 범위다.
- **커밋·푸시·태그 변경:** 모두 하지 않음. `weavra-v0.1-rc1`은 이동·수정하지 않았다.

---

## LOG-029 — Weavra Worktree Launcher V1 커밋·푸시 준비

- **기록일:** 2026-09-16 18:11 (KST)
- **상태·목적:** 사용자 요청에 따라 LOG-028의 worktree launcher V1을 커밋하고 `origin/devlop`에 게시하기 위한 검증을 완료했다.
- **변경 파일:** `README.md`, `docs/WORK_LOG.md`, `packages/company-runtime/README.md`, `packages/company-runtime/bin/weavra`, `packages/company-runtime/test/worktree.test.ts`, `packages/coding-agent/test/suite/company-runtime-workflow.test.ts` 총 6개. 이번 준비에서는 현재 요약과 이 항목만 갱신했다.
- **이번 검증:** root `npm run check` 재실행 PASS, Biome 자동 수정 없음. `bash -n packages/company-runtime/bin/weavra` 및 `git diff --check` PASS. `git status --short --branch`, diff 목록, 기존 staged 변경 없음, HEAD 및 RC tag object/peeled commit 불변을 확인했다.
- **과거 검증과 구분:** 34개 파일·1,040개 PASS는 LOG-028 구현 검증 결과다. 이번 커밋 준비에서는 테스트/build/실제 Provider를 다시 실행하지 않았다. `--model provider/model`은 부모 Pi 모델의 선택 옵션이며 workflow worker 모델은 기존 `.ai/config.yaml`을 따른다는 후속 설명도 전달했다. 코드 변경은 없다.
- **문제·해결:** 추가 문제 없음. Runtime/Status/Policy 의미 및 global Pi 설치를 그대로 유지하고 명시적 6개 경로만 stage한다. dependency/lockfile 변경은 없다.
- **남은 제한·다음 작업:** 기존 플랫폼/실제 bundled CLI·TUI 미검증 및 worktree의 비-sandbox 한계를 유지한다. 일반 commit/push 후 원격 HEAD 일치, clean working tree와 RC 태그 불변을 확인한다.
- **커밋 상태:** 이 항목 작성 시 실행 직전. 메시지는 `feat(coding-agent): launch Weavra in isolated Git worktrees`이며 실제 SHA·push 결과는 Git 이력과 최종 응답으로 보고한다. 안정 태그 `weavra-v0.1-rc1`은 이동·수정하지 않는다.

---

## LOG-030 — Weavra Worktree Open/List: 기존 등록 재접속과 읽기 전용 조회

- **기록일:** 2026-09-16 19:36 (KST)
- **상태:** 구현·자동 회귀 완료 / 미커밋
- **목적:** create-only V1을 유지하면서 종료 후 기존 worktree를 다시 열고 Pi의 기존 session 옵션을 전달한다. 별도 registry 없이 Git 등록만 조회한다.
- **시작 상태:** `devlop` clean, HEAD `965240041e697028fa4e60c7192be70ff494d2aa`. LOG-029 뒤 worktree V1은 해당 커밋으로 게시됐다. RC tag object `7deb58be5b2da7b4f8e2cf42c1b1fd5d912a107c`와 peeled commit `183f85de1897d8b9f4fadb368a54e2b1390e5a84`는 시작·최종 조회에서 동일했다.

### 문제·구체적 동작·해결

기존 `weavra --worktree test-1`은 생성하고 종료하면 worktree/branch를 남기지만, 다시 같은 명령을 실행하면 create-only 충돌로 실패한다. 사용자가 경로를 직접 찾아 `cd`해야 했던 재접속을 `--worktree-open test-1`로 분리했다. `--worktree-list`로 현재 common repository의 `weavra/*` 등록을 찾는다. 기존 생성 명령을 재사용 모드로 바꾸지 않는다.

### 변경 파일과 설계

- `packages/company-runtime/bin/weavra`: `--worktree`/`--worktree-open`/`--worktree-list`를 상호 배타적으로 파싱한다. `--` 이후와 나머지 Pi argv는 재해석 없이 보존한다. create의 실제 Git 생성·clean source·충돌/전후 검증 본문은 그대로다.
- open은 기존 local CLI/Extension 사전 검사 후 launcher helper에서 검증한 canonical cwd로 이동하여 같은 fork-local Pi를 `exec`한다. 별도 Pi proxy/signal handler/global fallback은 없다. `--continue`/`-c`, `--resume`/`-r`, `--session <path|id>`는 launcher가 해석하지 않는다.
- list는 Pi/Extension을 실행하지 않는 조회이므로 build/Extension 검사 전에 분기한다. 추가 Pi 인수는 거부하며 Node/Git/helper만 필요하다. 이 예외는 create/open의 local build 요구를 바꾸지 않는다.
- 신규 `packages/company-runtime/src/launcher-worktrees.ts`: Node native TypeScript로 실행하는 launcher 전용 CLI. Runtime/Extension에서는 import하지 않는다. `spawnSync`의 argv로 `git worktree list --porcelain -z`를 읽고 NUL 구분을 파싱한다. 별도 registry/state/cache 파일과 `.ai`·Pi session 읽기/복제는 없다.
- open은 생성과 같은 보수적 이름 및 Git branch validity, 정확한 `refs/heads/weavra/<name>` 등록 1개, 실제 root·같은 canonical common repository·일치하는 branch/HEAD, linked metadata의 gitdir 역참조와 index를 검증한다. 등록 목록과 metadata를 다시 확인하여 검사 중 변경을 거부한다. 사용자가 정상 이동한 worktree는 현재 등록 경로를 사용하며 기본 생성 경로를 추정하지 않는다.
- branch만 있는 경우, 중복/위장 등록, wrong branch/repository, missing/broken/prunable, 최종 경로 symlink/줄바꿈은 open 실패다. 자동 생성/prune/repair/recreate/move/delete/branch 삭제는 없다. 정상 locked 등록은 open 가능하다.
- open에서는 source/target dirty 여부를 검사하지 않는다. staged/unstaged/untracked와 `.ai` 변경은 그대로 보존한다. Git 조회는 optional locks와 hooks/fsmonitor를 끄고 repository override 환경변수를 거부한다. index 검사에는 읽기 전용 `ls-files --stage -z`를 사용한다.
- list는 `refs/heads/weavra/*`만 NAME/BRANCH/PATH/STATUS로 표시한다. 상태는 `OK`, `LOCKED`, `PRUNABLE`, `MISSING/BROKEN`, `BROKEN`, `AMBIGUOUS`이며 파일 수정이나 clean/Runtime 성공 판정이 아니다. 경로 제어 문자는 escape한다. Git 목록 자체가 실패/손상되면 성공 목록을 출력하지 않는다.
- `packages/company-runtime/test/worktree.test.ts`: 기존 55개를 유지하고 open/list **58개 추가**, 공통 fixture에 새 helper 복사 및 읽기 전용 argv audit/파일 snapshot을 연결했다. 제품 코드의 생성/정리 권한을 테스트에 맞춰 완화하지 않았다.
- `README.md`, `packages/company-runtime/README.md`: create/open/list 구분, Pi session 인수, dirty 허용과 Runtime baseline 조건의 차이, 목록 상태/build 예외, 이동/손상/동시 변경 및 수동 점검 한계를 설명한다.
- `docs/WORK_LOG.md`: 현재 요약 및 본 항목. 총 **6개 파일** 변경이다. Pi Core/bin/SessionManager/SDK와 Runtime·Policy·Approval·Workflow·Status Projection 구현, 기존 coding-agent 테스트, dependency/lockfile/package metadata는 변경하지 않았다.

### 이번 검증 명령·실제 결과

```sh
# packages/company-runtime — launcher/worktree, Status, S0~S6/RC
node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2 test/worktree.test.ts test/launcher.test.ts test/status.test.ts test/hardening.test.ts test/kernel-hardening.test.ts test/observations.test.ts test/observation-files.test.ts test/approval.test.ts test/r2-review.test.ts test/quick.test.ts test/agent-metadata.test.ts test/contracts.test.ts test/config.test.ts test/extension.test.ts test/classification.test.ts test/kernel.test.ts test/host-boundary.test.ts test/state-store.test.ts test/policy.test.ts test/verification-boundary.test.ts

# packages/coding-agent — 기존 faux Runtime/RC/Status·Pi 회귀
node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2 test/suite/company-runtime-status.test.ts test/suite/company-runtime-timeout.test.ts test/suite/company-runtime-hardening.test.ts test/suite/company-runtime-observations.test.ts test/suite/company-runtime-approval.test.ts test/suite/company-runtime-r2.test.ts test/suite/company-runtime-quick.test.ts test/suite/company-runtime-workflow.test.ts test/suite/company-runtime-agent.test.ts test/suite/agent-session-prompt.test.ts test/suite/agent-session-runtime.test.ts test/suite/agent-session-model-extension.test.ts test/suite/agent-session-retry-events.test.ts test/suite/agent-session-queue.test.ts

# root
npm run check
bash -n packages/company-runtime/bin/weavra
git diff --check
packages/company-runtime/bin/weavra --worktree-list
git rev-parse HEAD weavra-v0.1-rc1 'weavra-v0.1-rc1^{}'
```

- 환경: Darwin arm64, Node `v26.7.0`, Git `2.50.1 (Apple Git-155)`. 최종 **Runtime 20개 파일·658개 + coding-agent 14개 파일·440개 = 34개 파일·1,098개 PASS**, 실패/skip 0. LOG-028의 1,040개는 과거 결과이며 이번에 모두 다시 실행했다.
- 초기 launcher/worktree **2개 파일·126개 PASS** 후 추가 7개를 보완했다. 최종에는 기존 launcher 20개 + worktree 113개(기존 55 + 신규 58)가 포함된다. 이번 작업에서 테스트 실패는 없었다.
- create 종료 후 open, Pi cwd/전체 argv/env/stdio/exit23/SIGTERM, dirty source+target의 staged/unstaged/untracked/`.ai` 및 파일·Git index/ref bytes 불변, worktree의 후속 commit 유지, 수동 이동/다른 linked source discovery를 검증했다.
- 잘못된 이름·옵션 충돌·branch-only·wrong branch/default path, 누락/손상 `.git`/index/symlink, prunable, 중복/변경/위장 목록, 동일 path/branch의 다른 repository 및 같은 common repository의 잘못된 backlink를 거부했다. list는 dirty 상태/build·Extension 부재에서도 동작하고 prefix 필터·locked/prunable·empty 목록·Git 실패·경로 제어문자 escaping·읽기 전용 argv를 확인했다. 모든 경우 global Pi trap은 호출되지 않았다.
- `npm run check`: PASS(TypeScript/deps/entry graphs/shrinkwrap/install-lock/browser smoke 포함). Biome은 이번 helper와 worktree 테스트만 포맷했고 이후 전체 targeted를 실행했다. `bash -n`, `git diff --check`: PASS.
- 최종 문서 기록 후 root `npm run check`를 재실행해 자동 수정 없이 PASS했다. `bash -n`·`git diff --check` 및 임시 Python 검사도 PASS했다. 정확한 6개 변경 파일, staged 변경 없음, 기존 create 실행 본문과 LOG-001~029 본문 보존, 문서 fence/공백, HEAD/RC 태그 불변, 실제 프로젝트 `.ai` 부재를 확인했다. 검사 script는 제거했다.
- 실제 작업 checkout에서 `packages/company-runtime/bin/weavra --worktree-list`: exit 0, NAME/BRANCH/PATH/STATUS 헤더만 출력. 현재 repository에는 대상 등록이 없으며 dirty checkout도 조회를 막지 않았다. Pi/Provider/Runtime 명령은 시작하지 않았다. RC 태그와 HEAD 불변을 재확인했다.

### 남은 한계·다음 작업·커밋

- Pi session 선택 UI 자체는 이번 테스트에서 실행하지 않았다. launcher가 정확한 cwd/인수를 넘기는 process fixture와 기존 coding-agent 회귀를 검증했다. session 존재/선택/오류 처리는 기존 Pi가 소유한다. 사용자가 worktree를 이동했다면 이전 cwd의 Pi session을 자동 이관하지 않는다.
- open의 dirty 허용은 launcher 접근 조건이다. 새 `/workflow run`의 clean baseline·Policy·Approval·writer lock 조건을 완화하거나 기존 workflow를 자동 재개하지 않는다. `.ai`는 registry가 아니며 자동 commit/merge/stash/reset/clean/rollback/삭제는 없다.
- common Git object/ref는 계속 공유한다. Git 검사/exec 사이 외부 교체를 원자적으로 막는 잠금이나 OS sandbox는 아니다. 검사 중 변경을 감지하면 수동 재시도를 요구한다. UTF-8 Git 출력·Git 명령당 10초/8 MiB 한도를 사용하며 한도 초과도 open 성공으로 처리하지 않는다. 다른 OS/Node·구버전 Git은 미검증이다.
- 실제 bundled Pi/TUI·session picker smoke, build, 전체 upstream suite/e2e, 유료 GPT RC-01~08/DeepSeek는 재실행하지 않았다. Runtime semantics 불변이므로 새 실제 Provider 검증을 주장하지 않는다.
- **다음 작업:** 사용자 프로젝트에서 `--worktree-list`와 `--worktree-open <name> --continue/--resume`를 사용해 기존 Pi session을 선택한다. 추가 자동 복구/관리 기능은 별도 승인 범위다.
- **커밋·푸시·태그 변경:** 모두 하지 않음. `weavra-v0.1-rc1`을 그대로 유지한다.

---

## LOG-031 — Weavra Worktree Open/List 커밋·푸시 준비

- **기록일:** 2026-09-17 08:57 (KST)
- **상태·목적:** 사용자 요청에 따라 LOG-030의 Open/List 변경을 커밋하고 `origin/devlop`에 게시하기 위한 검증을 완료했다.
- **변경 파일:** `README.md`, `docs/WORK_LOG.md`, `packages/company-runtime/README.md`, `packages/company-runtime/bin/weavra`, `packages/company-runtime/src/launcher-worktrees.ts`, `packages/company-runtime/test/worktree.test.ts` 총 6개. 이번 준비에서는 현재 요약과 이 항목만 갱신했다.
- **이번 검증:** root `npm run check` 재실행 PASS, Biome 자동 수정 없음. `bash -n packages/company-runtime/bin/weavra`, `git diff --check` PASS. `git status --short --branch`, diff 목록, 기존 staged 변경 없음과 RC tag object/peeled commit 불변을 확인했다.
- **과거 검증과 구분:** 34개 파일·1,098개 PASS와 실제 checkout의 list 조회는 LOG-030 구현 검증 당시 결과다. 이번 커밋 준비에서는 테스트/build/실제 Provider/TUI를 재실행하지 않았다.
- **문제·해결:** 추가 문제 없음. 명시적 6개 경로만 stage하고 일반 commit/push를 사용한다. create-only 의미, Runtime/Policy/Approval/Workflow/Status Projection, global Pi 설치 및 dependency/lockfile은 그대로다.
- **남은 제한·다음 작업:** 기존 실제 session picker/TUI·플랫폼 미검증과 비-sandbox 한계를 유지한다. 게시 후 원격 HEAD 일치, clean working tree와 RC 태그 불변을 확인한다.
- **커밋 상태:** 이 항목 작성 시 실행 직전. 메시지는 `feat(coding-agent): reopen and list existing Weavra worktrees`이며 실제 SHA·push 결과는 Git 이력과 최종 응답으로 보고한다. 안정 태그 `weavra-v0.1-rc1`은 이동·수정하지 않는다.

---

## LOG-032 — V0.2A: Read-only DAG Projection

- **기록일:** 2026-09-17 09:34 (KST)
- **상태:** 구현·자동 회귀 완료 / 미커밋
- **목적:** 기존 Runtime snapshot과 저장된 Step/attempt·역할·Review·Check·Approval을 DAG DTO/ASCII로 표현한다. 실행 scheduler나 새로운 state authority를 만들지 않는다.
- **시작 상태:** `devlop` clean, HEAD `add45781dc6b937e3212951fd591484272a3021a`. LOG-031 뒤 Open/List를 이 커밋에 게시한 상태였다. RC tag object `7deb58be5b2da7b4f8e2cf42c1b1fd5d912a107c`와 peeled commit `183f85de1897d8b9f4fadb368a54e2b1390e5a84`는 시작·최종 조회에서 동일했다.

### 문제·구체적 trace·설계

기존 Run에는 currentStep·revisionCycle·reviewHistory·step이 연결된 verification·approval ledger가 있지만 모든 과거 step 완료 이벤트가 저장되는 것은 아니다. 예를 들어 REVISE 뒤에는 `implement:2`로 이동하고 이전 handoff는 덮어쓰지만 reviewHistory와 `self-check:1` 결과는 남는다. 이 저장 사실로 attempt를 펼치되 없는 결과를 이벤트 재생이나 PASS 추정으로 채우지 않는 순수 projection을 추가했다.

- `review:1 --revise--> implement:2`로 연결해 재작업 순환을 펼친다. 이미 REVISE로 넘어간 attempt의 TEST/COMPLETE는 실행 node로 만들지 않는다. current attempt의 남은 단계는 pending 또는 terminal 이후 skipped다.
- R3의 `approval:1`/`mutation:1`은 `parentId: implement:1`, `stepId: implement`인 projection detail이다. `contains`/`approved` 관계는 Developer 완료나 독립 Kernel step을 뜻하지 않는다. APPROVED는 mutation 완료가 아니며, Run의 CONSUMED가 있어야 해당 mutation을 passed로 표시한다. 승인 후 소비 기록 없이 종료되면 효과를 unknown으로 남기고 `/state decisions`의 action 기록을 안내한다.
- 기존 Check/Review PASS가 있어도 COMPLETE에서 stale evidence로 BLOCKED되면 과거 PASS와 현재 completion blocked를 함께 표시한다. 입력 Run/Check/Review/Approval status를 재작성하지 않는다.
- 현재 호출 시점의 snapshot만 투영한다. `/graph`가 RuntimeEvent를 저장/재생하거나 새로운 bus/cache를 만들지 않는다. V0.2A에는 자동 갱신 UI가 없으며 향후 Viewer는 event를 snapshot 재계산 trigger로만 사용할 수 있다. 실제 event 경계에서의 무변경 조회는 이번 faux 통합으로 검증했다.

### 변경 파일

- 신규 `packages/company-runtime/src/graph.ts`: `GraphProjection`, `GraphNode`, `GraphEdge`, `GraphNodeStatus`, `projectRunGraph(unknown)`, `renderGraphText(graph)`, `GraphProjectionError`. 기존 contracts/TypeBox만 사용하는 순수 모듈이며 Pi/UI/Provider/fs/clock/process 의존성이 없다.
- DTO는 원본 runId/workflow/risk/status와 source revision/recorded 시각, deterministic node/edge 및 diagnostics를 담는다. node 상태는 pending/running/passed/failed/blocked/cancelled/skipped/waiting_approval/revised/unknown이며 Review verdict와 Check 원본 상태를 별도로 남긴다. code revision/attempt 순서와 check ID 정렬은 입력 배열 순서에 의존하지 않는다.
- graph 입력은 Run shape와 identity/phase/attempt·중복/모순 metadata를 검사한다. 한도는 attempt 4, review 4, scoped approval 1, checks 1,000이다. step metadata 없는 check를 SELF_CHECK/TEST에 임의 배정하지 않는다. 저장된 COMPLETED라도 current-attempt 근거가 불완전하면 Complete node는 unknown이다. 이는 Kernel 완료 guard 실행이나 저장 상태 변경이 아니다.
- `packages/company-runtime/src/extension.ts`: 기존 명령 loop/inspect에 `/graph`, `/graph latest`, `/graph <full-run-id>`, help를 연결하고 시작/도움말에 discoverability만 추가했다. notification-capable UI/project trust 조건, live owner snapshot·FileStateStore.readSnapshot·local failure 우선/출처 진단을 공유한다. 조회 시 config/auth, writer open, state repair/recovery/resume, Provider/Agent, approval 변경, Git 호출은 없다. 출력은 약 32,000자이며 제어 문자/bidi를 escape한다.
- 신규 `test/graph.test.ts`, `test/graph-command.test.ts`, 공유 fixture `test/graph-fixtures.ts`: 순수 DTO/정렬/불변/회차/상태/승인/누락·손상과 실제 readSnapshot 경계 **59개**.
- `test/extension.test.ts`, `test/launcher.test.ts`: public loader의 기존 네 명령이 새 `/graph`를 포함한 다섯 명령이 되는 것을 확인한다. 기존 로딩/stdio/argv/global Pi 회귀 assertions는 유지한다. `test/host-boundary.test.ts`에는 Graph import graph의 Pi/UI/Provider/fs 독립 검사를 추가했다.
- `packages/coding-agent/test/suite/company-runtime-observations.test.ts`: 기존 harness/faux 실제 SDK/Kernel/StateStore/check 기반 **11개 추가** 및 기존 revision/R3 pending/local storage failure/corruption 사례에 graph assertion을 보강했다. 실제 Provider API/key/유료 token은 사용하지 않았다.
- `README.md`, `packages/company-runtime/README.md`: 사용법, ASCII 출력, projection 전용 node/edge·unknown 한계·source/조회 경계·V0.2B 후속 단계를 설명한다. `docs/WORK_LOG.md`는 현재 요약과 이 항목을 추가했다. 총 **12개 파일** 변경이다.

### 유지한 실행 의미

Kernel/Workflow/QUICK·STANDARD/R0~R3/Reviewer/Verification/Approval/Policy/StateStore/RuntimeEvent·Status Projection 및 Worktree create/open/list 구현은 변경하지 않았다. worker 도구/prompt/역할/승인 권한도 그대로다. Pi Core/bin/SessionManager/package/version/dependencies/lockfile 변경은 없다. DAG Scheduler, node 실행/retry, workflow 편집/drag-drop/parallel/dynamic dependencies, Planner/Lead/COMPLEX/T3Code/Web UI/V0.2B Viewer를 구현하지 않았다.

RUNNING node는 snapshot의 현재 단계 표시이지 OS process liveness가 아니다. 기존 저장 active 상태·writer 파일만으로 live를 주장하지 않는다. 읽기 실패를 이전 성공 graph/export로 대체하지 않고, 같은 Host의 local storage failure는 기존 `/state`처럼 durable 상태와 구분한다. graph 조회 때문에 footer나 실행 상태를 바꾸지 않는다.

### 이번 검증 명령·실제 결과

```sh
# packages/company-runtime — 신규 graph + S0~S6/RC/launcher/status/worktree
node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2 test/graph.test.ts test/graph-command.test.ts test/worktree.test.ts test/launcher.test.ts test/status.test.ts test/hardening.test.ts test/kernel-hardening.test.ts test/observations.test.ts test/observation-files.test.ts test/approval.test.ts test/r2-review.test.ts test/quick.test.ts test/agent-metadata.test.ts test/contracts.test.ts test/config.test.ts test/extension.test.ts test/classification.test.ts test/kernel.test.ts test/host-boundary.test.ts test/state-store.test.ts test/policy.test.ts test/verification-boundary.test.ts

# packages/coding-agent — 실제 SDK/faux Runtime/RC/Status와 관련 Pi 회귀
node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2 test/suite/company-runtime-status.test.ts test/suite/company-runtime-timeout.test.ts test/suite/company-runtime-hardening.test.ts test/suite/company-runtime-observations.test.ts test/suite/company-runtime-approval.test.ts test/suite/company-runtime-r2.test.ts test/suite/company-runtime-quick.test.ts test/suite/company-runtime-workflow.test.ts test/suite/company-runtime-agent.test.ts test/suite/agent-session-prompt.test.ts test/suite/agent-session-runtime.test.ts test/suite/agent-session-model-extension.test.ts test/suite/agent-session-retry-events.test.ts test/suite/agent-session-queue.test.ts

# root
npm run check
bash -n packages/company-runtime/bin/weavra
git diff --check
git rev-parse HEAD weavra-v0.1-rc1 'weavra-v0.1-rc1^{}'
```

- 환경: Darwin arm64, Node `v26.7.0`. 최종 **Runtime 22개 파일·717개 + coding-agent 14개 파일·451개 = 36개 파일·1,168개 PASS**, 실패/skip 0. 신규 59+11개이며 LOG-030의 1,098개는 과거 결과다. 기존 회귀도 이번에 모두 다시 실행했다.
- 초기 graph/command/extension/launcher/boundary **5개 파일·96개 PASS**, SDK observation suite **22개 PASS** 후 role/scope/approval 모순 검사 3개를 보강하고 최종 전체 회귀를 통과했다. 테스트 실패는 없었다.
- QUICK R0/R1, STANDARD R1/R2, REVISE 1~3회/한도 차단, R3 PENDING/APPROVED/CONSUMED/DENIED/EXPIRED/CANCELLED/INTERRUPTED, BLOCKED/CANCELLED/FAILED, 실제 stale COMPLETE BLOCK, live event 경계와 reload-equivalent 새 Host의 stored terminal graph를 확인했다.
- 순수 frozen input·반환 참조 격리·JSON 재구성·node/edge/check 정렬/앞으로만 향하는 revision edge, malformed/incomplete/과대/다른 identity 거부 및 UNKNOWN, 제어 문자/출력 크기 한도를 검증했다. graph 조회 전후 state/tasks/config/writer bytes와 디렉터리 목록 불변, Provider 호출 0 및 writer 생성 0, Graph import 경계와 기존 status 미변경을 확인했다.
- `npm run check`: PASS(TypeScript/deps/entry graphs/shrinkwrap/install-lock/browser smoke 포함). 첫 실행에서 Biome이 새 테스트의 문자열 결합에 info 1건을 보고했고 template literal로 수정했다. 타입 오류·실패를 완화하지 않았다. 최종 code check에는 info/warning/error가 없으며 formatter 후 전체 targeted를 실행했다. `bash -n`, `git diff --check`: PASS. HEAD/RC 태그도 불변이다.
- config bytes 불변 assertion을 보강한 뒤 `test/graph-command.test.ts`를 재실행해 **15개 PASS**했다(위 합계와 중복). 최종 문서 기록 후 root check를 다시 실행해 자동 수정 없이 PASS했고, `bash -n`·`git diff --check`도 PASS했다. 임시 Python 검사로 정확한 12개 변경 파일, 기존 Runtime/Status/Worktree/Pi/dependency 불변, Extension의 inspect/status/run/lifecycle 본문 보존, LOG-001~031 본문·문서 fence/공백·HEAD/RC 태그 불변 및 실제 프로젝트 `.ai` 부재를 확인했다(PASS). 검사 script는 제거했다.

### 한계·다음 작업·커밋

- 모든 과거 step 완료·세션-attempt 대응이 저장된 것은 아니다. 실제 남은 handoff/check/review로 확인 가능한 부분만 표시하고 나머지는 UNKNOWN이다. graph만으로 현재 diff/check freshness나 action effect를 재검증하지 않는다. 원본 status와 표시 node 상태의 차이는 diagnostics로 설명한다.
- V0.2A는 요청 시점의 ASCII 조회다. 자동 live view/별도 event 저장·replay/Graph DB는 없다. 향후 V0.2B는 동일 DTO와 snapshot authority를 유지해야 하며 아직 진행하지 않았다.
- 실제 bundled Pi/TUI 그래프 화면 smoke, build, 전체 upstream suite/e2e, 다른 OS/Node 조합·실제 GPT RC-01~08/DeepSeek는 이번에 미실행이다. Runtime semantics가 바뀌지 않아 실제 Provider RC를 재호출하지 않았다. 자동 테스트의 real SDK/faux 결과를 유료 Provider/TUI PASS로 확대하지 않는다.
- **다음 작업:** 사용자 환경에서 `/graph` 출력과 정보 한계를 확인하고 V0.2A 안정화 후 V0.2B의 읽기 전용 TUI Viewer 범위를 별도 승인한다.
- **커밋·푸시·태그 변경:** 모두 하지 않음. `weavra-v0.1-rc1`을 그대로 유지한다.

---

## LOG-033 — V0.2A Read-only DAG Projection 커밋·푸시 준비

- **기록일:** 2026-09-17 10:13 (KST)
- **상태·목적:** 사용자 요청에 따라 LOG-032의 V0.2A 변경을 커밋하고 `origin/devlop`에 게시하기 위한 검증을 완료했다.
- **변경 파일:** `README.md`, `docs/WORK_LOG.md`, `packages/company-runtime/README.md`, `src/graph.ts`, `src/extension.ts`, `test/graph.test.ts`, `test/graph-command.test.ts`, `test/graph-fixtures.ts`, `test/extension.test.ts`, `test/host-boundary.test.ts`, `test/launcher.test.ts`(앞의 상대 경로는 company-runtime 기준), `packages/coding-agent/test/suite/company-runtime-observations.test.ts` 총 12개. 이번 준비에서는 현재 요약과 이 항목만 갱신했다.
- **이번 검증:** root `npm run check` 재실행 PASS, Biome 자동 수정 없음. `bash -n packages/company-runtime/bin/weavra`, `git diff --check` PASS. `git status --short --branch`, diff 목록과 기존 staged 변경 없음, HEAD 및 RC tag object/peeled commit 불변을 확인했다.
- **과거 검증과 구분:** 36개 파일·1,168개 PASS와 graph-command 15개 재검증은 LOG-032 구현 당시 결과다. 이번 커밋 준비에서는 테스트/build/실제 Provider/TUI를 재실행하지 않았다.
- **문제·해결:** 추가 문제 없음. 명시적 12개 경로만 stage하고 일반 commit/push를 사용한다. Runtime 실행 의미·Status/Worktree 구현·Pi Core·dependency/lockfile은 그대로다.
- **남은 제한·다음 작업:** 실제 TUI smoke·플랫폼 미검증 및 누락 과거 결과의 UNKNOWN 한계를 유지한다. 게시 후 원격 HEAD 일치, clean working tree와 RC 태그 불변을 확인한다. V0.2B는 V0.2A 안정화와 별도 승인 후 진행한다.
- **커밋 상태:** 이 항목 작성 시 실행 직전. 메시지는 `feat(coding-agent): add read-only Weavra DAG projection`이며 실제 SHA·push 결과는 Git 이력과 최종 응답으로 보고한다. 안정 태그 `weavra-v0.1-rc1`은 이동·수정하지 않는다.

---

## LOG-034 — V0.2B: Read-only TUI DAG Viewer

- **기록일:** 2026-09-17 11:08 (KST)
- **상태:** 구현·자동 회귀·실제 TUI smoke 완료 / 미커밋
- **목적:** V0.2A GraphProjection을 그대로 보여주는 읽기 전용 TUI viewer를 추가한다. Viewer는 Runtime 실행/승인 authority가 아니다.
- **시작 상태:** `devlop` clean, HEAD `b40c016d385b1c28b8f352c9cb99aceffef7c8bf`. LOG-033 뒤 V0.2A가 이 커밋으로 게시됐다. RC tag object `7deb58be5b2da7b4f8e2cf42c1b1fd5d912a107c` 및 peeled commit `183f85de1897d8b9f4fadb368a54e2b1390e5a84`는 그대로다.

### 문제·설계·구조

ASCII snapshot은 모든 기록을 읽을 수 있지만 긴 revision 이력을 한 화면에서 보기 어렵다. `/graph`/`latest`/`runId` 출력은 유지하고 `/graph view [latest|runId]`만 transient overlay로 연결했다. `Runtime snapshot → 기존 GraphProjection → 순수 layout → Pi TUI Component` 순서이며 양쪽 renderer가 각각 Run 상태를 추론하지 않는다.

- `src/graph.ts`의 DTO/projector/ASCII renderer는 byte 변경 없이 재사용한다. viewer는 같은 node ID/status/edge를 받고 glyph·색상·들여쓰기·스크롤만 계산한다. R3 승인과 mutation은 inside IMPLEMENT인 projection detail이며 APPROVED != mutation success와 UNKNOWN/CONSUMED 의미를 그대로 유지한다.
- 첫 버전은 **open 시점의 정적 사본**이다. `Static snapshot`을 표시하고 현재 상태를 보려면 닫고 다시 연다. RuntimeEvent subscription/replay/cache DB/polling/timer를 만들지 않아 late event가 viewer 상태를 바꾸지 않는다. Live update는 별도 후속으로 남겼다.
- 공식 `ctx.ui.custom(..., {overlay:true, overlayOptions:{anchor:"center", width:"96%", maxHeight:"100%", margin:1}})`를 사용한다. Pi Core/TUI 자체, editor component/footer/header/status를 교체하지 않는다.
- 키는 up/k·down/j, PgUp/PgDn, Home/End, Esc/q/Ctrl+C close만 제공한다. viewer-local `DEFAULT_APP_KEYBINDINGS`와 주입된 manager의 user bindings를 조합하며 Pi 전역 manager/config는 변경하지 않는다. Enter와 node 실행/retry/approve/deny/cancel/resume 메뉴는 없다. Esc/q는 Worker 취소가 아니다.
- viewport 높이/폭마다 layout·scroll 경계를 갱신하고 공식 truncation으로 display width를 제한한다. 좁은 화면은 단일 column, 너무 작은 화면은 resize 또는 `/graph` 안내다. glyph와 상태 이름을 같이 표시하고 theme fg palette만 사용한다.
- Extension은 요청/overlay owner를 한 개만 보유한다. lifecycle에서 viewer를 먼저 닫은 뒤 기존 Status clear·Runtime cancel/lease cleanup을 그대로 수행한다. pending read/늦은 factory/중복 open과 dispose 후 입력·render를 보호하며 UI close 실패도 Runtime cleanup을 막지 않는다.

### 변경 파일

- 신규 `packages/company-runtime/src/graph-view.ts`: 순수 row layout, 상태 glyph/label, 제어 문자 escaping. 기존 GraphNode/GraphEdge 참조를 보존하며 Node/edge 상태를 변경하지 않는다.
- 신규 `src/graph-view-component.ts`: theme/terminal 크기·세로 scroll·navigation/close Component 및 `GraphViewSession` transient owner. runtime port/action은 전달하지 않는다.
- `src/extension.ts`: 기존 read-only `inspect → projectRunGraph` 결과를 ASCII 또는 viewer로 분기한다. TUI-only/project trust/정확한 run ID/동시 open 검사를 추가하고 기존 lifecycle hook에서 viewer owner만 닫는다. config/Provider/Agent/Git/state writer 경로는 추가하지 않는다.
- 신규 `test/graph-view.test.ts` **43개**: workflow/risk/revision/R3/terminal/stale/UNKNOWN, 동일 DTO node/edge set, glyph/colorless, 긴 CJK/제어 문자, narrow/resize, scroll 경계, user keybindings, Enter 무동작, theme 실패, static/dispose 경계.
- 신규 `test/graph-view-command.test.ts` **16개**와 `test/graph-view-harness.ts`: 실제 TuiMainScreen/VirtualTerminal 및 공식 custom bridge 형태로 open/close·editor/footer/focus 보존, state/config/tasks/writer bytes 불변, Provider/writer 0, pending read/factory·lifecycle/UI 실패·중복/malformed/non-TUI를 검증한다. source selection/projector spy로 ASCII와 동일 DTO임도 확인한다.
- `test/host-boundary.test.ts`: 순수 graph layout도 Kernel/Policy/Graph와 함께 Pi/UI/fs import 경계를 검사한다.
- `packages/coding-agent/test/suite/company-runtime-status.test.ts` **4개 추가**: 기존 harness/faux의 실제 live Worker를 유지한 채 Esc/q가 viewer만 닫는지, reload/UI close 실패에도 CANCELLED 저장·lock cleanup·다른 status 보존이 유지되는지 확인한다.
- `packages/company-runtime/package.json`, root `package-lock.json`: 기존 workspace `@earendil-works/pi-tui` `0.85.1` dev dependency 1개를 명시했다. lock diff도 해당 metadata 1줄뿐이며 새 외부 버전/패키지·lifecycle script·shrinkwrap 변경은 없다. `npm install --package-lock-only --ignore-scripts`로 갱신했다.
- `README.md`, `packages/company-runtime/README.md`: ASCII/viewer 구분, static snapshot·keybinding·작은 화면·lifecycle 및 미지원 범위를 설명한다. `docs/WORK_LOG.md`는 현재 요약과 본 항목을 추가했다. 총 **13개 파일** 변경이다.

### 유지한 의미와 제한

GraphProjection/GraphNode/GraphEdge, Kernel/Workflow/QUICK·STANDARD/R0~R3/Reviewer/Verification/Approval/Policy/StateStore/RuntimeEvent·Status Projection·Worktree Launcher는 변경하지 않았다. worker 도구/prompt/권한·Pi Core/TUI 소스도 그대로다. Graph editor, node action/retry, drag/drop/workflow 편집, scheduler/parallel/dynamic dependency, zoom/pan/mouse dependency, Planner/Lead/COMPLEX/T3Code/Web UI는 구현하지 않았다.

Viewer에는 Run의 현재 단계나 승인 상태를 바꿀 콜백이 없다. 기존 active run도 정적 표시이며 자동 갱신/현재 filesystem·process 생존 보장이 아니다. 오류 표시/close는 best-effort UI 경계이며 다른 extension의 동시 overlay stack·fullscreen 조합은 이번 검증 범위가 아니다.

### 자동 검증 명령·실제 결과

```sh
# packages/company-runtime — V0.2B + V0.2A/S0~S6/RC/launcher/status/worktree
node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2 test/graph-view.test.ts test/graph-view-command.test.ts test/graph.test.ts test/graph-command.test.ts test/worktree.test.ts test/launcher.test.ts test/status.test.ts test/hardening.test.ts test/kernel-hardening.test.ts test/observations.test.ts test/observation-files.test.ts test/approval.test.ts test/r2-review.test.ts test/quick.test.ts test/agent-metadata.test.ts test/contracts.test.ts test/config.test.ts test/extension.test.ts test/classification.test.ts test/kernel.test.ts test/host-boundary.test.ts test/state-store.test.ts test/policy.test.ts test/verification-boundary.test.ts

# packages/coding-agent — 기존 harness/faux Runtime/RC/Status 및 Pi 회귀
node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2 test/suite/company-runtime-status.test.ts test/suite/company-runtime-timeout.test.ts test/suite/company-runtime-hardening.test.ts test/suite/company-runtime-observations.test.ts test/suite/company-runtime-approval.test.ts test/suite/company-runtime-r2.test.ts test/suite/company-runtime-quick.test.ts test/suite/company-runtime-workflow.test.ts test/suite/company-runtime-agent.test.ts test/suite/agent-session-prompt.test.ts test/suite/agent-session-runtime.test.ts test/suite/agent-session-model-extension.test.ts test/suite/agent-session-retry-events.test.ts test/suite/agent-session-queue.test.ts

# root
npm run check
git diff --check
bash -n packages/company-runtime/bin/weavra
```

- 환경: Darwin arm64, Node `v26.7.0`. 최종 **Runtime 24개 파일·776개 + coding-agent 14개 파일·455개 = 38개 파일·1,231개 PASS**, 실패/skip 0. 신규 59+4개이며 LOG-032의 1,168개는 과거 결과다. 기존 targeted도 이번에 모두 다시 실행했다.
- 초기 viewer/layout/command/기존 graph-command/boundary 실행은 **52 PASS / 23 FAIL**이었다. 16개는 test harness에서 SDK의 type-only KeybindingsManager export를 생성자로 사용한 setup 오류, 7개는 공식 truncateToWidth가 삽입하는 정상 SGR reset을 unsafe source escape로 판단한 assertion 오류였다. test-only 실제 manager import와 중립 reset/데이터 escape 구분으로 고쳤으며 구현의 width 검사나 Runtime guard를 낮추지 않았다. 이후 **4개 파일·75개 PASS**, SDK Status suite **29개 PASS**를 확인했다.
- 최종 full targeted 이후 test teardown을 finally로 보강하고 `test/graph-view-command.test.ts`를 다시 실행해 **16개 PASS**했다(합계와 중복). 살아 있는 Worker의 기존 Provider 호출은 baseline으로 두고 viewer로 인한 추가 Provider/writer 호출이 0임을 검증했다. query-only 테스트는 전체 Provider/Agent/Workflow/Git/writer 실행 0이다.
- `npm run check`: PASS, TypeScript/deps/entry graphs/shrinkwrap/install-lock/browser smoke 포함. Biome은 이번 변경 파일만 포맷했고 그 뒤 전체 targeted를 실행했다. `git diff --check`, `bash -n`: PASS. root package-lock 갱신 시 기존 **moderate 3건**을 보고했으며 이번에 audit fix/의존성 보안 해소를 수행하거나 PASS로 선언하지 않았다.

- 최종 문서 기록 후 `npm run check`를 재실행해 자동 수정 없이 PASS했다. `bash -n`·`git diff --check` 및 임시 Python 최종 검사도 PASS했다. 정확한 13개 변경 파일, V0.2A 모델/Runtime/Status/Worktree/Pi Core 불변, Extension의 기존 snapshot 조회·run/취소 로직 보존, lockfile의 내부 TUI dependency metadata 외 불변, LOG-001~033 본문·문서 fence/공백·HEAD/RC 태그 불변과 실제 프로젝트 `.ai` 부재를 확인했다. 최종 검사 script는 제거했다.

### 실제 Pi TUI smoke

- `.pi/skills/interactive-testing.md`에 따라 고유 임시 fixture와 tmux **80×24**에서 source `pi-test.sh`를 실행했다. 별도 HOME/agentDir, credential 없는 `env -i`, `--offline --approve --no-session --no-extensions --no-skills --no-prompt-templates --no-context-files` 및 명시적 임시 wrapper Extension을 사용했다. 기존 global Pi/config/auth는 건드리지 않았다.
- V0.2A의 shape-valid stored fixture를 사용했다: QUICK/R0 COMPLETED, STANDARD/R2 COMPLETED, STANDARD/R1 REVISE→attempt2 COMPLETED, R3 WAITING_APPROVAL/PENDING. Worker/Provider는 호출하지 않았으며 no-model/offline-fd 경고는 예상된 fixture 조건이다.
- 실제 `/graph view quick`, `view standard`, `view revise`, `/graph view`(latest R3), reload 후 `view quick`까지 **5회 open/close**를 확인했다. QUICK의 완료 chain, STANDARD Reviewer, REVISE edge/들여쓴 attempt2, R3 inside IMPLEMENT와 승인!=mutation 안내를 확인했다.
- PgDn/End 세로 scroll, **42×18** 단일 column, **30×10** too-small 안내, 80×24 복귀 및 Esc/q 닫기를 확인했다. 실제 TUI에서 viewer를 닫은 뒤 `/reload`하고 새 viewer를 열었다. viewer가 열린 채 강제 session lifecycle이 발생하는 경계는 자동 테스트로 별도 검증했다.
- wrapper는 실제 graph handler 진입 직전에 draft를 넣고 반환 뒤 editor text를 기록했다. 5회 모두 `DRAFT_PRESERVED`였고 footer의 `OTHER STATUS`도 복원됐다. fixture state SHA-256은 전후 동일하며 `.ai`에는 state.json만 있었다(writer/tasks 생성 없음). 검증 script PASS 후 tmux와 임시 fixture/wrapper/검사 파일을 제거했다. 전체 화면/대화 로그는 저장소에 복사하지 않았다.
- 이 결과는 source Pi + stored fixture의 실제 TUI smoke다. 실제 bundled 배포물이나 real-Provider workflow 성공 evidence로 확대하지 않는다. tiny/fallback 화면의 key hint는 이후 사용자 binding을 반영하도록 정리했고 최종 자동 회귀에서 다시 검증했다.

### 다음 작업·커밋

- live update·추가 overlay 조합·fullscreen/다른 OS·Node 검증은 별도 후속이다. 사용자 환경에서 static snapshot 의미와 키 설정을 확인한 뒤 범위를 정한다.
- Runtime semantics 불변이므로 GPT RC-01~08/DeepSeek·유료 Provider를 재실행하지 않았다. build·전체 upstream suite/e2e도 이번에 실행하지 않았다.
- **커밋·푸시·태그 변경:** 모두 하지 않음. `weavra-v0.1-rc1`을 이동·수정하지 않았다.

---

## LOG-035 — V0.2B Read-only TUI DAG Viewer 커밋·푸시 준비

- **기록일:** 2026-09-17 13:46 (KST)
- **상태·목적:** 사용자 요청에 따라 LOG-034의 V0.2B 변경을 커밋하고 `origin/devlop`에 게시하기 위한 검증을 완료했다.
- **변경 파일:** `README.md`, `docs/WORK_LOG.md`, `package-lock.json`, `packages/company-runtime/README.md`, `packages/company-runtime/package.json`, 같은 패키지의 `src/extension.ts`, `src/graph-view.ts`, `src/graph-view-component.ts`, `test/graph-view.test.ts`, `test/graph-view-command.test.ts`, `test/graph-view-harness.ts`, `test/host-boundary.test.ts`, `packages/coding-agent/test/suite/company-runtime-status.test.ts` 총 13개. 이번 준비에서는 현재 요약과 이 항목만 갱신했다.
- **이번 검증:** root `npm run check` 재실행 PASS, Biome 자동 수정 없음. `bash -n packages/company-runtime/bin/weavra`, `git diff --check` PASS. `git status --short --branch`, 변경 목록과 기존 staged 변경 없음, RC tag object/peeled commit 불변을 확인했다.
- **과거 검증과 구분:** 38개 파일·1,231개 PASS, graph-view-command 16개 재검증 및 실제 80×24 TUI smoke는 LOG-034 구현 당시 결과다. 이번 커밋 준비에서는 테스트/build/실제 Provider/TUI를 재실행하지 않았다.
- **문제·해결:** lockfile은 내부 `@earendil-works/pi-tui` dev dependency metadata 1줄뿐임을 재확인했다. 사용자 승인된 V0.2B 게시 범위로 `PI_ALLOW_LOCKFILE_CHANGE=1`을 명시하여 포함하며 일반 commit 검사는 유지한다. 다른 의존성 변경이나 검사 우회는 없다.
- **남은 제한·다음 작업:** 정적 snapshot, 다른 extension overlay 중첩/fullscreen·플랫폼 미검증과 기존 취약점 미해소 한계를 유지한다. 명시적 13개 경로만 stage·commit 후 일반 push하고 원격 HEAD 일치, clean working tree와 RC 태그 불변을 확인한다.
- **커밋 상태:** 이 항목 작성 시 실행 직전. 메시지는 `feat(coding-agent): add read-only Weavra TUI graph viewer`이며 실제 SHA·push 결과는 Git 이력과 최종 응답으로 보고한다. `weavra-v0.1-rc1`은 이동·수정하지 않는다.

---

## LOG-036 — V0.2B 게시: 원격 문서 커밋과 충돌 없는 통합

- **기록일:** 2026-09-17 13:47 (KST)
- **상태·목적:** V0.2B 최초 커밋 후 non-fast-forward로 거부된 푸시를 강제 푸시 없이 해결한다.
- **변경 파일:** 이번 후속 기록은 `docs/WORK_LOG.md`만 추가한다. LOG-035의 13개 게시 파일은 유지하며 원격 문서는 수정하지 않았다.
- **문제·해결:** 최초 커밋 `407b34a45`의 푸시가 원격 선행 커밋으로 거부됐다. `git fetch origin devlop`으로 원격 `8037cefae`가 `docs/WEAVRA_OMP_OMO_ADOPTION_PLAN.md`만 추가했음을 확인했다. `git rebase origin/devlop`은 충돌 없이 완료됐고 V0.2B 코드 내용은 유지됐다. force push는 사용하지 않았다.
- **검증 명령·실제 결과:** rebase 후 `npm run check` 재실행 PASS, Biome 자동 수정 없음. `git diff --check`, `bash -n packages/company-runtime/bin/weavra` PASS. `git status --short --branch`에서 원격 대비 V0.2B 커밋 1개 선행·작업 트리 clean을 확인했다. 테스트/TUI/실제 Provider는 재실행하지 않았으며 LOG-034 결과와 구분한다.
- **남은 제한·다음 작업:** 기존 정적 viewer/플랫폼/보안 검증 한계를 유지한다. 이 기록을 미게시 V0.2B 커밋에 포함하고 일반 push 후 로컬·원격 HEAD 일치와 RC 태그 불변을 확인한다.
- **커밋 상태:** 최초 커밋은 rebase로 교체됐으며, 이 항목 작성 시 최종 기록 반영·푸시 직전이다. 최종 SHA와 실제 push 결과는 Git 이력 및 최종 응답으로 보고한다.

---

## LOG-037 — V0.2C: Product Isolation / Setup / Doctor

- **기록일:** 2026-09-17 14:44 (KST)
- **상태:** 구현·자동 회귀·임시 HOME 실제 launcher/TUI smoke 완료 / 미커밋
- **목적:** 같은 머신의 기존 Pi와 Weavra가 기본 auth/settings/session을 섞지 않도록 user-level 제품 영역을 분리한다. 프로젝트 `.ai`는 기존 Runtime source로 유지한다.
- **시작 상태:** `devlop` clean, HEAD `0834683bd1c43cf1442f37be1db478ba004b53fb`. LOG-036의 V0.2B는 원격 문서 커밋 위로 충돌 없이 rebase 후 이 커밋으로 게시됐다. 안정 태그 object `7deb58be5b2da7b4f8e2cf42c1b1fd5d912a107c` 및 peeled commit `183f85de1897d8b9f4fadb368a54e2b1390e5a84`는 불변이다.

### Pi 경로/첫 실행 조사와 선택

- `config.ts`의 공식 `getAgentDir()`는 `PI_CODING_AGENT_DIR`을 우선 사용하고 auth/models/settings/themes/prompts/tools/bin/sessions가 그 경로 아래로 파생된다. `main.ts`는 SessionManager 생성 전에 CLI sessionDir → 환경 sessionDir → startup settings.sessionDir를 선택하고, 없으면 기존 SessionManager가 agent/sessions/<encoded-cwd>를 사용한다.
- `cli/startup-ui.ts`의 `shouldRunFirstTimeSetup()`은 custom agent dir override가 있으면 false다. `main.ts`의 bootstrap Settings/Migrations는 실제 Pi 시작 시 실행되므로 launcher의 setup/doctor가 이 API를 import하면 user-level mutation을 유발할 수 있다.
- 따라서 **A: 명시적 setup**을 선택했다. Weavra agent dir가 없으면 `Weavra has not been set up. Run: weavra setup`으로 종료한다. worktree 생성보다 먼저 검사하며 기존 Pi 경로 fallback은 없다. 준비된 private dir에 auth가 없어도 Pi `/login`을 위해 시작할 수 있다. doctor READY는 인증 성공이 아니라 로컬 실행 조건만 뜻한다.

### 구현·변경 파일

- 신규 `packages/company-runtime/src/launcher-home.ts`: Node built-in만 사용하는 launcher 전용 helper. `resolveWeavraHome`, `prepareLaunch`, `setupWeavra`, `doctorWeavra`, 제한 import 함수가 경로/설치/진단을 소유한다. Runtime/Extension에서 import하지 않는다.
- 기본 home `~/.weavra`, effective agent dir `$WEAVRA_HOME/agent`. 절대 경로·tilde override·공백/한글을 지원하고 cwd 상대/줄바꿈/빈 override는 거부한다. 기존 경로 조상의 canonical 해석으로 Pi home과 같은/상위/하위 alias를 차단한다. custom inherited Pi dir와의 겹침도 보수적으로 검사하되 Weavra child 자체 경로 재진입은 허용한다. product home/agent/주요 하위 디렉터리는 실제 private directory여야 한다.
- `packages/company-runtime/bin/weavra`: setup/doctor 단독 명령 dispatch와 worktree mutation 전 home 검사, child 직전 `PI_CODING_AGENT_DIR` override 및 `PI_CODING_AGENT_SESSION_DIR` unset만 추가했다. cwd·나머지 환경·argv/stdio/exit/signal·동일 checkout의 CLI/Extension 경로를 유지한다. setup/doctor와 Pi/worktree 옵션 혼합은 거부하고 literal prompt는 `--` 뒤에 전달한다. 읽기 전용 worktree-list는 setup 없이 기존대로 동작한다.
- setup은 home/agent와 sessions/themes/prompts/tools/bin을 0700으로 생성하며 기존 권한을 자동 chmod하지 않는다. Pi는 기본 `~/.pi/agent`의 auth/models/settings 3개만 read-only 후보 탐색한다. `[x]`는 존재 표시일 뿐 동의가 아니며 파일별 기본 No에 명시적 y/yes만 import한다. settings는 Pi-specific extension/path/command/sessionDir 경고 후 선택적으로 가져오며 내용은 자동 변환하지 않는다.
- import는 non-symlink/single-link regular UTF-8 JSON object(1 MiB 이하)를 읽는다. 0600 임시 파일에 write/fsync 후 `link`로 no-clobber publication하고 임시 이름만 제거한다. POSIX rename이 기존 대상을 덮어쓰는 경합을 피하기 위한 선택이다. 기존 file/directory/symlink 대상은 SKIP이고 force/자동 overwrite는 없다. 실패/동시 대상 생성에서도 원본 및 기존 대상은 보존하며 credential 값이나 원문 parse 오류는 출력하지 않는다.
- doctor는 checkout/build/Extension, Node 최소 버전/Git version, effective home/agent, private·readable/writable 디렉터리·Pi 경로 격리, auth 존재·JSON/권한, models/settings JSON 및 session 기본값을 PASS/WARN/FAIL로 표시한다. auth/models/settings 없음은 WARN, 경로/build/권한/손상 JSON 등 필수 실패는 non-zero다. READY는 local checks only, Provider readiness not verified다. settings.sessionDir이 있으면 값 자체는 표시하지 않고 override 경고한다.
- doctor는 파일 생성/chmod/repair/credential refresh/Provider/network/session/Git mutation/`.ai` 생성이 없다. Git은 trace/config 주입을 상속하지 않는 제한 환경의 `git --version`만 사용한다.
- 신규 `test/launcher-home.test.ts` **57개**: 임시 HOME·fake credential만 사용하며 default/custom 경로, first-run, inherited env 분리, 명시적 import/skip/복사 실패·동시 대상 생성·unsafe 경로·secret 미출력, doctor 읽기 전용 및 실제 Pi SessionManager 경로/continue를 검증한다.
- `test/launcher.test.ts`, `test/worktree.test.ts`: 기존 process fixture에 private Weavra home/helper를 준비하고 agentDir 기대값만 새 제품 계약에 맞췄다. 기존 argv/stdio/exit/signal/create-only/open/list/global Pi trap·source 보호 assertions는 보존했다. stdin 회귀 fixture에도 임시 HOME을 명시했다.
- `packages/coding-agent/test/suite/company-runtime-workflow.test.ts`: 기존 launcher-created worktree/faux SDK 통합 fixture에 helper 및 private home 준비만 추가했다. Runtime 실행/완료/취소 assertions는 유지한다.
- `README.md`, `packages/company-runtime/README.md`: Pi/Weavra/.ai 역할·setup/doctor·migration 제한·명시적 session precedence·default 격리 한계를 설명했다. `docs/WEAVRA_OMP_OMO_ADOPTION_PLAN.md`는 V0.2B 기준선과 V0.2C 실제 구현 범위를 갱신하고 LSP/QA evidence/stale-project diagnosis를 후속으로 구분했다. `docs/WORK_LOG.md`는 현재 요약과 이 항목. 총 **10개 파일** 변경이다.

### 의미·안전 경계

- `~/.weavra`는 사용자 설정/인증/session 영역이고 `.ai`는 각 project/worktree의 Runtime state/evidence다. 한 worktree마다 user agent dir를 만들지 않으며 기존 Pi cwd partitioning을 사용한다.
- `Existing Pi sessions were not imported automatically.`를 setup에서 명시한다. 이전 Pi/과거 Weavra 대화를 구분할 수 없어 bulk migration을 하지 않는다. 새 `--continue`는 새 Weavra 영역을 보며, 사용자가 지정한 `--session`/`--session-dir` 및 settings의 명시적 override는 기존 Pi 규칙을 따른다. WEAVRA_SESSION_DIR는 추가하지 않았다.
- Kernel/Workflow/Policy/Approval/Verification/StateStore/RuntimeEvent/Graph/Viewer/Status·worker 도구/prompt와 worktree 생성/등록 조회 본문은 불변이다. Pi Core/name/branding/auth format·dependency/lockfile·global Pi command/PATH/shell rc는 수정하지 않았다.
- 격리는 user-level **기본 저장 경로**에 한정된다. 명시적 settings import/project `.pi`/session 경로·Provider 환경변수·실행 코드 전체를 sandbox하지 않는다. 의도적으로 기존 Pi 경로를 가리키는 settings/path를 import하면 공유될 수 있으므로 별도 경고와 사용자 검토가 필요하다. 악성 외부 파일 교체를 OS 수준으로 막는 기능이나 다중 파일 transaction/전원 장애 내구성은 아니다.

### 자동 검증 명령·실제 결과

```sh
# packages/company-runtime — setup/doctor + 기존 V0.2A/B/S0~S6/RC/launcher/status/worktree
node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2 test/launcher-home.test.ts test/graph-view.test.ts test/graph-view-command.test.ts test/graph.test.ts test/graph-command.test.ts test/worktree.test.ts test/launcher.test.ts test/status.test.ts test/hardening.test.ts test/kernel-hardening.test.ts test/observations.test.ts test/observation-files.test.ts test/approval.test.ts test/r2-review.test.ts test/quick.test.ts test/agent-metadata.test.ts test/contracts.test.ts test/config.test.ts test/extension.test.ts test/classification.test.ts test/kernel.test.ts test/host-boundary.test.ts test/state-store.test.ts test/policy.test.ts test/verification-boundary.test.ts

# packages/coding-agent — Runtime/RC/Status·Pi 회귀 + 관련 argv/session 회귀
node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2 test/suite/company-runtime-status.test.ts test/suite/company-runtime-timeout.test.ts test/suite/company-runtime-hardening.test.ts test/suite/company-runtime-observations.test.ts test/suite/company-runtime-approval.test.ts test/suite/company-runtime-r2.test.ts test/suite/company-runtime-quick.test.ts test/suite/company-runtime-workflow.test.ts test/suite/company-runtime-agent.test.ts test/suite/agent-session-prompt.test.ts test/suite/agent-session-runtime.test.ts test/suite/agent-session-model-extension.test.ts test/suite/agent-session-retry-events.test.ts test/suite/agent-session-queue.test.ts test/args.test.ts test/sdk-session-manager.test.ts test/session-manager/file-operations.test.ts

# root
npm run check
bash -n packages/company-runtime/bin/weavra
git diff --check
```

- 환경: Darwin arm64, Node `v26.7.0`. 최종 **Runtime 25개 파일·833개 + coding-agent 17개 파일·569개 = 42개 파일·1,402개 PASS**, 실패/skip 0. 기존 1,231개 + 신규57개 + 관련 Pi 추가114개다. LOG-034 결과는 당시 기록이며 이번에 기존 targeted를 모두 재실행했다.
- 초기 home/launcher **2개 파일·71개 PASS**, 실제 SessionManager 경로/continue 보완 뒤 home **52개 PASS**, launcher/home/worktree **3개 파일·185개 PASS**를 확인했다. 이후 root path·first-run worktree·destination 종류 5개를 보완한 최종 home57개가 전체 회귀에 포함된다. 테스트 실패는 없었다.
- 실제 별도 child에서 기존 Pi SessionManager의 create/continueRecent를 사용하여 Weavra agent/sessions 아래 경로, 동일 cwd의 ID 재사용, 다른 cwd의 partition 분리, explicit session-dir를 검증했다. 해당 SDK session probe는 실제 Provider 추론이 아니다. 기존 Pi bytes/modes와 session 파일 목록은 그대로였다.
- `npm run check`: 최종 PASS, TypeScript/deps/entry graphs/shrinkwrap/install-lock/browser smoke 포함. 초기 import 함수의 catch/finally 경로 TS2366을 명시적 never-return으로 정리했고 test 문자열 결합 info 1건은 template literal로 수정했다. 검사 완화는 없다. 최종 formatter 후 전체 targeted를 실행했으며 warning/info/error가 없다. `bash -n`, `git diff --check`: PASS.

- 최종 문서 기록 후 root `npm run check`를 다시 실행해 자동 수정 없이 PASS했다. `bash -n`, `git diff --check`와 임시 Python 검사도 PASS했다. 정확한 10개 변경 파일, Runtime/Extension/Graph/Viewer/Status/Pi Core·dependency 불변, worktree 실행 본문과 LOG-001~036 보존, 문서 fence/공백, HEAD/RC 태그 불변 및 실제 project `.ai` 부재를 확인했다. 최종 검사 script는 제거했다.

### 실제 임시 HOME smoke

- 실제 사용자 HOME이 아닌 고유 `/tmp` 아래 fake `~/.pi/agent` auth/models/settings/session fixture를 만들었다. 인증 값은 가짜이며 출력하지 않았다. 실제 launcher로 `weavra setup`을 실행하여 auth/models에 yes, settings에 no를 입력했고 새 Weavra dir·0600 auth 및 empty sessions를 확인했다.
- 같은 임시 HOME으로 실제 `weavra doctor`: exit 0, checkout/build/Extension·Node `26.7.0`·Git `2.54.0`·home/dir/JSON PASS, settings 없음 WARN, local READY를 확인했다. 이는 현재 PATH의 Git이며 자동 fixture는 `/usr/bin` Git도 사용한다.
- interactive-testing 지침에 따라 tmux **80×24**와 credential 없는 `env -i`, inherited Pi agent/session 변수를 fake Pi로 고정한 상태에서 **기존 built fork-local CLI를 실제 launcher로 실행**했다. offline/telemetry off/명시적 Weavra Extension·no-session·no 자동 리소스 로딩으로 `/graph`, `/state`, `/quit`를 확인했다. Model 미설정/offline fd 경고는 예상된 결과였고 Provider는 호출하지 않았다.
- 기존 fake Pi auth/models/settings/session의 SHA-256·permissions와 전체 목록은 전후 동일했다. 새 Pi settings는 `~/.weavra/agent/settings.json`에만 생성됐고 기존 session은 복사되지 않았으며 project `.ai`도 없었다. 검사 script PASS 후 tmux·임시 HOME/fixture/script를 제거했다. 사용자 실제 `~/.pi`/`~/.weavra`는 테스트로 읽어 복사하거나 수정하지 않았다.
- build를 새로 실행하지 않았다. 이번 smoke는 현재 checkout에 이미 있던 built CLI의 실제 startup/명령 연결 검증이며 real-Provider RC나 전체 배포물/플랫폼 검증은 아니다.

### 남은 제한·다음 작업·커밋

- JSON object 검사만 하며 auth 유효성/원격 모델 가용성·network refresh는 doctor에서 확인하지 않는다. auth가 없어도 로컬 READY일 수 있으므로 Weavra `/login` 또는 explicit import가 필요하다.
- 외부 프로세스의 syscall 사이 변경·악성 user-owned extension/명시적 path override는 sandbox하지 않는다. 기존 broad permissions/링크/손상 config는 자동 repair하지 않으므로 수동 검토가 필요하다. session bulk migration/cloud sync/keychain/auto update/Hash-Anchored Edit/LSP/QA Evidence bundle은 구현하지 않았다.
- Runtime semantics 불변이므로 실제 GPT RC-01~08/DeepSeek·유료 Provider는 재실행하지 않았다. 전체 upstream suite/e2e·다른 OS/Node/파일시스템은 미검증이다.
- **다음 작업:** 사용자가 실제 환경에서 직접 `weavra setup` → candidate별 동의 → `weavra doctor`를 실행한다. 에이전트가 실제 HOME에서 자동 setup/import하지 않는다. 이후 Weavra 안의 `/login` 또는 설정을 확인하고 필요한 과거 session만 명시적으로 연다.
- **커밋·푸시·태그 변경:** 모두 하지 않음. `weavra-v0.1-rc1`은 그대로 유지한다.

---

## LOG-038 — V0.2C 사용자 실행 확인 및 커밋·푸시 준비

- **기록일:** 2026-09-17 15:03 (KST)
- **상태·목적:** 사용자의 정상 실행 보고와 커밋·푸시 요청에 따라 V0.2C 게시 전 검증을 완료했다.
- **사용자 확인:** 사용자가 실행이 잘 되는 것 같다고 보고했다. 구체적인 setup/import/doctor 출력·사용한 모델·session 선택 결과는 전달되지 않았으므로 전체 사용자 환경/Provider RC PASS로 확대하지 않는다. 에이전트가 실제 사용자 HOME에 setup을 실행한 것은 아니다.
- **변경 파일:** `README.md`, `docs/WEAVRA_OMP_OMO_ADOPTION_PLAN.md`, `docs/WORK_LOG.md`, `packages/company-runtime/README.md`, `packages/company-runtime/bin/weavra`, 같은 패키지의 `src/launcher-home.ts`, `test/launcher-home.test.ts`, `test/launcher.test.ts`, `test/worktree.test.ts`, `packages/coding-agent/test/suite/company-runtime-workflow.test.ts` 총 10개. 이번 준비에서는 현재 요약과 이 항목만 갱신했다.
- **이번 검증:** root `npm run check` 재실행 PASS, Biome 자동 수정 없음. `bash -n packages/company-runtime/bin/weavra`, `git diff --check` PASS. `git status --short --branch`와 diff 목록에서 대상 외 변경·기존 staged 변경이 없음을 확인했고 HEAD/RC tag object/peeled commit 불변을 확인했다.
- **과거 검증과 구분:** 자동 42개 파일·1,402개 PASS 및 임시 HOME의 실제 launcher/TUI smoke는 LOG-037 구현 당시 결과다. 이번 커밋 준비에서는 테스트/build/실제 Provider/TUI를 재실행하지 않았다.
- **문제·해결:** 추가 문제 없음. 명시적 10개 경로만 stage하며 일반 commit/push를 사용한다. Runtime 의미/Pi Core·dependency/lockfile은 그대로다.
- **남은 제한·다음 작업:** 기존 default 경로 격리·명시적 설정 override·session bulk migration 미지원 및 플랫폼/Provider 미검증 한계를 유지한다. 게시 후 원격 HEAD 일치, clean working tree와 RC 태그 불변을 확인한다.
- **커밋 상태:** 이 항목 작성 시 실행 직전. 메시지는 `feat(coding-agent): isolate Weavra home and add setup and doctor`이며 최종 SHA·push 결과는 Git 이력과 최종 응답으로 보고한다. `weavra-v0.1-rc1`은 이동·수정하지 않는다.

---

## LOG-039 — V0.3A: Hash-Anchored Edit

- **기록일:** 2026-09-17 15:27 (KST)
- **상태:** 구현·자동 targeted 회귀 완료 / 미커밋. 실제 Provider smoke 미실행.
- **목적:** 모델의 이전 read 이후 파일이 바뀌면 오래된 anchor로 다른 위치를 수정하지 않고 fail-closed 처리한다. 기존 Runtime 권한·완료 의미를 유지한다.
- **시작 상태:** `devlop` clean, HEAD `e7f37f777cd32eae1d268ddfe9456e5b5748b0e2`. V0.2C가 이 커밋에 반영된 상태에서 시작했다. 안정 태그 peeled commit은 `183f85de1897d8b9f4fadb368a54e2b1390e5a84`다.

### 문제·구체적 동작·설계

기존 unique exact edit는 같은 `foo()`가 두 행에 있으면 실패하고, 과거에 읽은 파일 generation을 요청에 결합하지 않는다. V0.3A는 두 번째 행의 anchor와 당시 fileDigest를 복사하여 두 번째 occurrence만 수정할 수 있게 한다. 그 사이 마지막 행에 외부 내용이 추가되면 대상 행이 그대로여도 전체 digest mismatch로 거부하고 외부 bytes를 보존한다.

- 새 mutation tool/Port를 추가할 필요가 없어 `runtime_read({path, anchors:true})`와 `runtime_edit({path, oldText, newText, anchor, fileDigest})`만 확장했다. anchor/digest는 모두 있거나 모두 없어야 한다. plain read 생략/false 및 legacy unique exact edit/duplicate 거부·runtime_write는 유지한다.
- anchor 형식은 **`a1:L<1-based line>:<64 lowercase SHA-256 hex>`**다. hash 재료는 JSON tuple `["weavra-anchor-v1", canonical absolute target path, line number, exact line including terminator]`다. 경로·workspace·행 identity를 결합하고 LF/CRLF/final newline/Unicode/BOM을 정규화하지 않는다. 모델은 opaque token을 그대로 복사한다.
- **fileDigest는 `sha256:<hex>`**, 정확한 UTF-8 전체 bytes의 digest다. local anchor만 검사하면 unrelated 외부 변경을 놓칠 수 있으므로 correctness 우선의 full-file generation을 선택했다. 같은 bytes로 복원된 ABA 이력을 구분하는 영구 generation 번호나 읽기 수행의 인증 서명은 아니다.
- Policy evaluation → durable ALLOW intent → path 재검사 → 현재 파일 read → fileDigest → anchor → anchored exact oldText → 최종 bytes/identity/cancel 검사 → apply 순서다. Policy ALLOW가 freshness를 대신하지 않는다. mismatch는 STALE_ANCHOR와 FAILED audit이며 write/truncate 전에 거부한다.
- oldText는 anchor 행에서 시작하고 여러 행에 걸칠 수 있다. 다른 행에서 시작하는 duplicate는 허용하지만 같은 행의 여러 시작점(겹침 포함)은 AMBIGUOUS_ANCHOR로 거부한다. fuzzy search·가까운 위치 추정·자동 보정은 없다.

### 변경 파일·경계

- 신규 `packages/company-runtime/src/anchored-edit.ts`: snapshot/token/digest/exact replacement/strict UTF-8 domain helper. Node crypto 외 SDK/Provider/fs 의존성이 없다.
- 신규 `src/anchored-files.ts`: Policy 뒤의 bounded filesystem adapter. canonical root/path·no-follow/nonblocking·regular/single-link·256 KiB를 유지한다. O_RDWR/no-create/no-truncate-on-open의 같은 descriptor에서 검증·쓰기하며 마지막 bytes와 dev/ino/mode/size/mtime/ctime·AbortSignal을 확인한다. 적용 전 JS yield/reopen이 없다.
- `src/agent-tools.ts`: optional schema·도구 설명, 입력 사본, 기존 gate 뒤 helper 연결. source/replacement strict UTF-8 round-trip과 NUL 거부를 anchored mode에만 적용한다. JSON-escaped/control/bidi-safe snapshot output도 256 KiB로 제한하고 4,096 UTF-16 code units long-line preview/나머지 행 생략을 명시한다.
- `src/agent-runner.ts`: QUICK/R1에 anchored preference와 stale 재읽기/token 재구성 금지 안내. Runtime이 직접 만든 StaleAnchorError만 tool call ID로 한 번 소비하여 같은 세션의 명시적 재읽기를 허용한다. 자동 retry/read loop나 새로운 session/revision은 없고 시간·턴 예산·취소·일반 tool/Policy/저장 오류의 종료 경계는 그대로다. audit finish 실패가 stale 예외로 둔갑하지 않음을 검증했다.
- 신규 `test/anchored-edit.test.ts`, `test/anchored-tools.test.ts`: domain 및 실제 파일/Policy/audit 경계 **66개**. `packages/coding-agent/test/suite/company-runtime-quick.test.ts`: 기존 harness/faux로 실제 SDK/Kernel/StateStore/check를 사용하는 duplicate-second와 stale→명시적 read→edit **2개** 추가.
- 문서 `README.md`, `packages/company-runtime/README.md`, `docs/WEAVRA_OMP_OMO_ADOPTION_PLAN.md`, `docs/WORK_LOG.md` 갱신. adoption plan의 과거 후보 그림을 Policy-before-read/apply와 실제 구현 범위로 정정했다.

`WORKER_FILE_TOOLS` operation 목록, Policy 구현/version/config digest 재료는 불변이다. 새 schema/설명은 optional 기능을 노출하지만 mutation 등록은 계속 edit이고 QUICK/R1은 R1, bound STANDARD/R2는 R2다. 기존 actionDigest의 전체 input에 path·anchor·fileDigest·oldText/newText가 포함되고 step/revision도 결합된다. audit에 credential/파일 내용/token 원문 필드를 추가하지 않았다. 기존 snapshot 기대값을 일괄 덮어쓰지 않았으며 registry·risk·action digest contract를 별도로 검증했다.

Kernel/Workflow/Policy/Approval/Verification/StateStore/Reviewer 권한/Graph/Viewer/Status/Worktree/Product Isolation·Pi Core·dependency/lockfile은 변경하지 않았다. STANDARD/R2에 anchored-only를 강제하지 않고 Reviewer는 read/search/submit_review뿐이다. R3에는 write/edit를 계속 제공하지 않는다.

### 이번 검증 명령·실제 결과

```sh
# packages/company-runtime
node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2 test/anchored-edit.test.ts test/anchored-tools.test.ts test/launcher-home.test.ts test/graph-view.test.ts test/graph-view-command.test.ts test/graph.test.ts test/graph-command.test.ts test/worktree.test.ts test/launcher.test.ts test/status.test.ts test/hardening.test.ts test/kernel-hardening.test.ts test/observations.test.ts test/observation-files.test.ts test/approval.test.ts test/r2-review.test.ts test/quick.test.ts test/agent-metadata.test.ts test/contracts.test.ts test/config.test.ts test/extension.test.ts test/classification.test.ts test/kernel.test.ts test/host-boundary.test.ts test/state-store.test.ts test/policy.test.ts test/verification-boundary.test.ts

# packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2 test/suite/company-runtime-status.test.ts test/suite/company-runtime-timeout.test.ts test/suite/company-runtime-hardening.test.ts test/suite/company-runtime-observations.test.ts test/suite/company-runtime-approval.test.ts test/suite/company-runtime-r2.test.ts test/suite/company-runtime-quick.test.ts test/suite/company-runtime-workflow.test.ts test/suite/company-runtime-agent.test.ts test/suite/agent-session-prompt.test.ts test/suite/agent-session-runtime.test.ts test/suite/agent-session-model-extension.test.ts test/suite/agent-session-retry-events.test.ts test/suite/agent-session-queue.test.ts test/args.test.ts test/sdk-session-manager.test.ts test/session-manager/file-operations.test.ts

# root
npm run check
git diff --check
bash -n packages/company-runtime/bin/weavra
```

- 이번 최종 targeted(15:23 KST 시작): **Runtime 27개 파일·899개 + coding-agent 17개 파일·571개 = 44개 파일·1,470개 PASS**, 실패/skip 0. 신규 68개이며 V0.2C의 1,402개도 이번에 다시 실행했다. 과거 LOG-037 결과를 중복 합산하지 않는다.
- 초기 신규 domain/adapter **61개 PASS**, QUICK SDK **42개 PASS** 후 Reviewer·protected/disallowed·late hardlink·filesystem byte boundary 5개를 보완했다. 테스트 실패는 없었다.
- deterministic token/digest·content/path/workspace/line identity, LF/CRLF/final newline/BOM/CJK/긴 행·output/file/replacement bounds, legacy read/edit/write, duplicate elsewhere/within/overlap·multiline, stale/fabricated/mismatch와 bytes 불변을 확인했다.
- symlink/hardlink/ancestor link·binary/invalid UTF-8/oversize·보호/허용/QUICK scope 경로, Policy DENY 선행, durable ALLOW persistence 중 외부 변경, 마지막 asynchronous path 검사 뒤 hardlink 변경, 취소 세 시점·audit 실패, deterministic action digest·R1/R2 및 Reviewer tool set을 확인했다.
- 외부 race fixture는 anchored read 후 **별도 `/bin/cp` 프로세스**로 실제 파일 bytes를 변경하고 기존 token apply를 거부하여 외부 bytes 보존을 확인했다. 최종 syscall 순간의 모든 경합을 검증한 것으로 과장하지 않는다.
- SDK/faux는 anchor를 tool 출력에서 복사하여 두 번째 occurrence만 변경했다. stale 사례는 실패 후 외부 bytes를 먼저 확인하고 모델 응답으로 명시적 재읽기→새 edit를 선택했다. 각각 Executor session 1개·Reviewer 없음·SELF_CHECK/TEST PASS·COMPLETED와 failed edit의 R1 audit 보존을 확인했다.
- V0.2A `/graph`, V0.2B viewer, V0.2C setup/doctor, worktree create/open/list, QUICK/STANDARD/R2/R3/stale-review/cancellation 및 기존 Pi session/argv 회귀를 재실행했다.
- root `npm run check` PASS(TypeScript/deps/entry graph/shrinkwrap/install-lock/browser smoke 포함). 첫 check의 test 문자열 결합 info 1건을 template literal로 수정했고 이후 check는 warning/info/error 없이 통과했다. Biome은 이번 변경 파일만 포맷했고 그 뒤 전체 targeted를 실행했다. `git diff --check`, `bash -n` PASS.

### 남은 한계·Provider smoke·다음 작업

- **실제 Provider smoke: 미실행.** 이번 요청에 구체적인 사용자 fixture 경로/사용 모델이 지정되지 않아 실제 프로젝트/인증을 임의로 선택하지 않았다. faux의 도구 선택은 실제 모델이 anchored mode를 자발적으로 선택하는지에 대한 증거가 아니다. 전체 GPT RC-01~08·유료 API·TUI/build·전체 upstream suite/e2e·다른 OS는 재실행하지 않았다.
- **runtime_write bypass는 그대로 남는다.** Anchored stale protection applies to anchored runtime_edit operations; it does not magically make every possible file mutation anchored. legacy exact edit·trusted verifier·일반 Pi 도구도 이 보호 대상이 아니다. every-mutation anchored-only 강제는 별도 단계다.
- 동일 FD·동기 최종 재검사는 OS atomic compare-and-swap이 아니다. 비협조 외부 writer의 최종 검사와 write syscall 사이 경합, 중간 I/O 실패·전원 장애의 부분 변경은 기존 비-sandbox 한계로 남는다. 자동 rollback/merge/commit은 없다.
- bounded snapshot에서 생략된 행은 anchor를 제공하지 않으며 pagination을 추가하지 않았다. full-file digest 때문에 연속 edit나 unrelated change 후에는 다시 읽어야 한다. AST/LSP/rename/formatter/autofix/editor integration/multi-file transaction은 범위 밖이다.
- **다음 작업:** 사용자가 선택한 fixture/model로 QUICK/R1 duplicate-second 1건과 가능하면 anchored read 뒤 외부 변경 stale 1건을 실제 Provider에서 확인한다. 검증 전 STANDARD/R2 강제 적용이나 runtime_write 축소는 하지 않는다.
- **커밋·푸시·태그 변경:** 모두 하지 않음. `weavra-v0.1-rc1`은 그대로 유지한다.

---

## LOG-040 — V0.3A Hash-Anchored Edit 커밋·푸시 준비

- **기록일:** 2026-09-17 15:41 (KST)
- **상태·목적:** 사용자 요청에 따라 LOG-039의 V0.3A 변경을 커밋하고 `origin/devlop`에 게시하기 위한 검증을 완료했다.
- **변경 파일:** `README.md`, `docs/WEAVRA_OMP_OMO_ADOPTION_PLAN.md`, `docs/WORK_LOG.md`, `packages/company-runtime/README.md`, 같은 패키지의 `src/agent-runner.ts`, `src/agent-tools.ts`, `src/anchored-edit.ts`, `src/anchored-files.ts`, `test/anchored-edit.test.ts`, `test/anchored-tools.test.ts`, `packages/coding-agent/test/suite/company-runtime-quick.test.ts` 총 11개. 이번 준비에서는 현재 요약과 이 항목만 갱신했다.
- **이번 검증:** root `npm run check` 재실행 PASS, Biome 자동 수정 및 warning/info/error 없음. `git diff --check`, `bash -n packages/company-runtime/bin/weavra` PASS. `git status --short --branch`, diff 목록과 기존 staged 변경 없음, HEAD 및 RC tag peeled commit 불변을 확인했다.
- **과거 검증과 구분:** 44개 파일·1,470개 PASS는 LOG-039 구현 검증 당시 결과다. 이번 게시 준비에서는 테스트/build/실제 Provider/TUI를 다시 실행하지 않았다.
- **문제·해결:** 추가 문제 없음. 명시적 11개 경로만 stage하고 일반 commit/push를 사용한다. dependency/lockfile 변경 및 검사 우회는 없다.
- **남은 제한·다음 작업:** 실제 Provider anchored 선택은 미검증이며 runtime_write/legacy exact edit 보호 범위와 외부 최종 syscall race 한계를 유지한다. 게시 후 로컬·원격 HEAD 일치, clean working tree와 RC 태그 불변을 확인한다.
- **커밋 상태:** 이 항목 작성 시 실행 직전. 메시지는 `feat(coding-agent): add stale-safe Weavra hash-anchored edits`이며 최종 SHA·push 결과는 Git 이력과 최종 응답으로 보고한다. `weavra-v0.1-rc1`은 이동·수정하지 않는다.

---

## LOG-041 — V0.3A: 실제 Provider duplicate-second / stale-anchor smoke

- **기록일:** 2026-09-17 15:56 (KST). 실제 Provider 실행 15:50–15:51 KST.
- **상태:** 요청된 두 시나리오 PASS / 문서 미커밋.
- **목적:** 실제 모델이 anchored mode를 선택하여 두 번째 occurrence만 수정하고, read 뒤 외부 변경이 있으면 old anchor가 STALE_ANCHOR로 거부되는지 확인한다.
- **시작 상태:** `devlop` clean, HEAD/origin `473256de6310c7698eb888a9ae999b338bce0854`. LOG-040 뒤 V0.3A는 이 커밋으로 게시됐다. 사용자 `weavra-rc-fixture`도 `rc-gpt-stale`, HEAD `5914c8b85433066b2133e3e2fdf3ff359ae09be9`, clean이었다.

### 실행 환경·격리·변경 파일

- 원본 fixture와 user-level 설정은 읽기만 했다. private `/tmp/weavra-v03a-provider.9DeEvH` 아래 `git clone --local --no-hardlinks` 복제본 두 개에 synthetic `src/duplicate.js`와 exact postcondition test를 추가하고 **복제본 안에서만** fixture baseline commit을 만들었다. 원본 Git HEAD/branch/index/추적 bytes/status는 전후 동일했다.
- 실제 `.ai/config.yaml`의 coding profile **`codex-lb / gpt-6-astra`**, 기존 Weavra models/auth를 사용했다. 실제 worker thinking은 **medium**, 기본 180초·32-turn 예산이다. 별도 credential 복사/출력 없이 model cache와 worker session만 임시 위치로 분리했고 auth/models/settings bytes 불변을 확인했다.
- macOS/Darwin arm64·Node `v26.7.0`. 현재 Runtime TypeScript + 기존 built Pi SDK로 실제 `StandardWorkflow/PiAgentExecutor/Kernel/Policy/StateStore/Git/Verifier`를 실행했다. faux Provider나 TUI/launcher 검증이 아니며 build를 새로 실행하지 않았다.
- 임시 SDK harness는 session 이벤트를 관찰했다. 두 번째에만 read 성공 직후 별도 `/bin/cp` 프로세스로 unrelated comment를 추가하고, edit 오류/외부 bytes 확인 **뒤** run을 취소했다. 도구 구현/schema/Provider 응답/Runtime prompt·권한을 교체하거나 hash를 모델 대신 계산하지 않았다.
- 영구 변경은 문서 **5개**뿐이다: 신규 `docs/WEAVRA_V03A_PROVIDER_SMOKE_2026-09-17.md`, 기존 `README.md`, `packages/company-runtime/README.md`, `docs/WEAVRA_OMP_OMO_ADOPTION_PLAN.md`, `docs/WORK_LOG.md`. 앞선 LOG의 미실행 기록은 당시 사실로 보존하고 현재 상태만 갱신했다. Runtime/Pi 소스·테스트·dependency/lockfile 변경은 없다.

### 실제 결과

1. **Duplicate-second PASS**: goal에는 도구/anchor 지시 없이 두 번째 `teh`만 수정하도록 요청했다. 모델은 anchored read → 6행 token/fileDigest를 그대로 복사한 anchored edit(`teh`→`the`) → anchored read → handoff를 선택했다. 첫 번째 occurrence와 다른 모든 bytes 불변, `runtime_write` 미사용, R1/ALLOW/SUCCEEDED, Executor 1개·Reviewer 없음, SELF_CHECK/TEST 각각 6개 test PASS·exit 0·COMPLETED, lock 없음이다. Run `d67b12c2-4d61-44a2-8244-c6ddecbcf19a`, 25,015ms, Provider usage 6,654 tokens(input 6,248/output 406).
2. **Stale-anchor PASS**: 같은 goal로 anchored read 후 외부 프로세스가 comment를 추가했다. 모델은 이전 6행 token/digest로 두 번째 return 행을 수정하려 했고 **`STALE_ANCHOR: file generation mismatch`**를 받았다. Policy R1/ALLOW 뒤 action FAILED, 성공 mutation 0개, 거부 직후와 cleanup 뒤 전체 파일이 외부 bytes와 동일했다. 결과 확인 후 harness가 명시적으로 취소하여 최종 CANCELLED·checks 미실행·lock 없음이다. Run `1a8da870-847b-4a32-8d69-25db6e7c6602`, 11,121ms, Provider usage 2,741 tokens(input 2,579/output 162). stale 자체가 CANCELLED를 결정했다거나 모델이 후속 복구했다고 주장하지 않는다.

두 시나리오의 Provider tool-call 응답은 각각 4개/2개다. 두 번째에는 cancellation의 token 0 aborted assistant message가 하나 더 저장됐다. 실제 청구 비용은 미확인이다. run/session ID·file SHA·fixture와 작은 diff·관찰 경계는 위 smoke 문서에 기록하고 credential/전체 대화·reasoning/tool 로그는 복제하지 않았다.

### 이번 검증 명령·결과와 문제 해결

```sh
node /tmp/weavra-v03a-provider.9DeEvH/smoke.mjs --preflight-only
node /tmp/weavra-v03a-provider.9DeEvH/smoke.mjs
node /tmp/weavra-v03a-provider.9DeEvH/verify.mjs
python3 /tmp/weavra-v03a-provider.9DeEvH/check-docs.py
git diff --check
bash -n packages/company-runtime/bin/weavra
```

- 사전 model mapping/분류/config 로딩: PASS. 실제 smoke 두 건 및 원본 fixture/개인 설정 불변 assertion: PASS.
- 초기 harness의 goal이 `src/duplicate.js:`처럼 colon을 포함하여 QUICK의 literal-path preflight가 두 번 실패했다. 첫 번째 보고 script는 state 부재를 처리하지 못해 원인을 가렸다. 오류 보고를 보완하고 경로를 독립 token으로 고친 뒤 위 두 실제 run을 실행했다. 초기 실패는 Provider/worker 시작 전이며 Runtime parser나 guard는 변경하지 않았다.
- 독립 `verify.mjs`가 저장 state/session에서 복사한 token/digest·실제 tool 오류·audit·checks를 대조하고 file SHA/diff·외부 bytes·lock을 재검증: 최종 PASS. 처음 TAP(`# pass 6`)만 예상한 assertion은 Node 26의 spec 출력 prefix 때문에 실패했으며 prefix와 무관하게 pass count를 검사하도록 고쳤다. **Provider 재호출 없이** 같은 저장 evidence로 재검증했다. 실제 check는 처음부터 PASS였다.
- 문서 상대 링크/fence·이전 LOG 본문 보존·docs-only diff·RC 태그 불변 검사, `git diff --check`, launcher `bash -n`: PASS. 기록 후 동일 문서 검사와 diff/bash 검사를 다시 실행하여 PASS했다.
- root `npm run check`·전체 targeted·GPT RC-01~08·TUI/build는 재실행하지 않았다. 코드 변경이 없는 한정 smoke/문서 작업이며 LOG-039의 1,470개 PASS를 이번 실행으로 계산하지 않는다.

### 한계·정리·다음 작업·커밋

- 실제 Provider의 stale 후 재읽기/복구는 테스트하지 않았다. 실패 증거 확인 후 취소하여 모델의 재시도나 legacy write가 외부 bytes를 덮지 않게 했다. 이번 취소는 도구의 stale 거부가 끝난 뒤이므로 stale gate를 대신하지 않는다.
- anchored runtime_edit만 보호한다. runtime_write/legacy edit/trusted checks의 bypass 한계 및 비협조 외부 writer의 최종 syscall race/부분 I/O 실패는 그대로다. 다른 Provider/OS/Node·전체 배포물/모델 품질까지 보장하지 않는다.
- 결과 확인 후 생성한 임시 fixture/session/harness/검사 script만 정리했고 임시 루트 부재를 확인했다. 사용자 원본 fixture·개인 auth/config·Runtime 상태/태그는 변경하지 않았다.
- **다음 작업:** 실제 사용에서 anchored preference와 편집 실패 양상을 관찰한다. STANDARD/R2 강제 적용·runtime_write 축소·새 기능은 별도 범위로 유지한다.
- **커밋·푸시:** 이번 smoke 문서는 하지 않음. 안정 태그 `weavra-v0.1-rc1`은 불변이다.

---

## LOG-042 — V0.3A Provider smoke evidence 커밋·푸시 준비

- **기록일:** 2026-09-17 15:59 (KST)
- **상태·목적:** 사용자 요청에 따라 LOG-041의 실제 Provider smoke 결과와 현재 상태 문서를 커밋하고 `origin/devlop`에 게시한다.
- **변경 파일:** `README.md`, `packages/company-runtime/README.md`, `docs/WEAVRA_OMP_OMO_ADOPTION_PLAN.md`, `docs/WEAVRA_V03A_PROVIDER_SMOKE_2026-09-17.md`, `docs/WORK_LOG.md` 총 5개. 이번 준비에서는 현재 요약과 이 항목만 추가했다. 소스·테스트·dependency/lockfile 변경은 없다.
- **이번 검증:** `npm run check` 재실행 PASS, Biome 자동 수정 및 warning/info/error 없음. `git diff --check`, `bash -n packages/company-runtime/bin/weavra` PASS. `git status --short --branch`, diff와 기존 staged 변경 없음 및 RC tag peeled commit 불변을 확인했다.
- **과거 검증과 구분:** 실제 Provider 두 시나리오 PASS는 LOG-041 당시 결과다. 이번 게시 준비에서는 Provider·targeted tests·TUI/build를 다시 실행하지 않았다. LOG-039의 1,470개 PASS도 과거 구현 검증 결과로 유지한다.
- **문제·해결:** 추가 문제 없음. 명시적 문서 5개만 stage하고 일반 commit/push를 사용한다. 기존 smoke의 제한과 stale 거부 후 harness cancellation을 그대로 기록한다.
- **남은 제한·다음 작업:** 실제 모델의 stale 후 복구, 다른 Provider/OS/Node 및 기존 runtime_write/legacy edit 보호 범위 한계를 유지한다. 게시 후 로컬·원격 HEAD 일치, clean working tree와 RC 태그 불변을 확인한다.
- **커밋 상태:** 이 항목 작성 시 실행 직전. 메시지는 `docs(coding-agent): record Weavra anchored edit provider smoke`이며 실제 SHA·push 결과는 Git 이력과 최종 응답으로 보고한다. `weavra-v0.1-rc1`은 이동·수정하지 않는다.

---

## LOG-043 — V0.3B: Read-only LSP Diagnostics / Navigation

- **기록일:** 2026-09-17 17:12 (KST), 개발 시작 16:08 KST.
- **상태:** 구현·자동 targeted·실제 TS/Provider smoke 완료 / 미커밋.
- **목적:** language server를 read-only code intelligence/advisory evidence로 연결하되 mutation authority와 required process check/Kernel 완료 의미를 바꾸지 않는다.
- **시작 상태:** `devlop` clean, HEAD/origin `e09100fe3e0ce08610b48a056ed6cd03714e0f97`. V0.3A Provider smoke evidence가 게시된 기준선이다. RC tag peeled commit은 `183f85de1897d8b9f4fadb368a54e2b1390e5a84`다.

### 참고 조사·dependency/license 선택

- GitHub API로 `code-yeongyu/pi-lsp-client`의 main commit **`1c981dfcacc456fe4ce9f4120a2f0250b54d6844`**를 고정하고 README/LICENSE/NOTICE 및 manager/client/client-wrapper/connection/transport/process/errors 소스를 전부 읽었다. LICENSE는 MIT, copyright 2026 Yeongyu Kim이다. NOTICE는 원 저자가 해당 port만 MIT로 재라이선스했으며 OMO 본체는 SUL-1.0임을 명시한다.
- shared pool의 refCount/pending waiters/idle reaping, init timeout, session shutdown, typed crash detection/read-only one-time retry를 조사했다. Weavra는 run-scoped 순차 query이므로 global pool/refCount/idle daemon 대신 Workflow-owned manager를 선택했다.
- **코드 직접 차용 없음.** 개념만 참고하여 독립 구현했고 외부 Pi extension을 설치/자동 로딩하지 않았다. OMO SUL-1.0 코드를 복사하지 않았다. 코드 차용에 따른 LICENSE/NOTICE 파일 추가는 없으며 문서에 출처/commit/선택을 기록했다.
- 새 production dependency나 lockfile 변경 없이 Node built-ins로 bounded stdio JSON-RPC를 구현했다. 작은 read-only method 집합과 명시적 frame/buffer/pending limits를 유지하고 malformed/oversize/timeout/EOF/crash tests로 parser 경계를 검증했다. `vscode-jsonrpc`를 추측해서 사용하거나 dependency metadata를 늘리지 않았다.

### 구조·변경 파일

- 신규 `packages/company-runtime/src/lsp/types.ts`: Host-independent DTO/schema, `LspPort`, read/R0 tool metadata. SDK/TUI/Provider/fs 타입 없음.
- 신규 `lsp/config.ts`: explicit bounded config/중복 routing·shell/eval/install wrapper 거부. `config.ts`에 optional `code_intelligence.lsp`를 연결했다. 생략한 config는 기존 normalized shape/digest 재료를 그대로 유지한다.
- 신규 `lsp/protocol.ts`, `client.ts`, `manager.ts`: bounded framing, typed failures, stdin/stdout/stdout EOF·process exit 감지, limited server requests, 문서 동기화, run-scoped reuse/retry/close와 POSIX group cleanup.
- 신규 `lsp/files.ts`, `normalize.ts`: input/result path Policy, safe bounded strict UTF-8 read, 1-based UTF-16 position, diagnostics/location/document-symbol 정규화·정렬/escaping/withheld/truncation.
- 신규 `lsp/evidence.ts`: advisory snapshot과 captured workspace diffDigest, deterministic verifier-owned refs와 STALE 표시. `contracts.ts`의 VerificationResult에 optional lspEvidence만 추가했다. Run/state와 CheckResult/Kernel guard는 변경하지 않았다.
- 신규 `lsp/tools.ts`, `command.ts`: 네 read-only worker tools 및 `/lsp [status]` 관찰. `agent-tools.ts`에는 async gate/helper 연결만 추가했다. `agent-runner.ts`는 enabled metadata·로컬 LSP script 보호·prompt 안내와 trusted Port의 clone/prompt 제외를 연결한다. `ports.ts`는 LspPort를 re-export하고 request의 trusted runtime-only 필드로 받는다.
- `workflow.ts`: 같은 manager를 worker/verifier에 연결하고 COMPLETE 전 및 finally에서 닫는다. `verification.ts`: 기존 checks 뒤 LSP/final inspect, exact evidence material과 cancellation outcome 보존을 연결했다. `extension.ts`는 `/lsp` 등록과 run confirmation의 trusted LSP 실행 안내만 추가했다.
- 신규 테스트: Runtime `test/lsp.test.ts`, `test/lsp-config.test.ts`, 실제 stdio `test/fixtures/lsp-server.mjs`; SDK suite `packages/coding-agent/test/suite/company-runtime-lsp.test.ts`. 기존 `extension.test.ts`/`launcher.test.ts`는 read-only 명령이 5→6개인 계약을 검증하고 기존 handlers/authority assertions는 유지한다. `config.test.ts`는 완전한 YAML 예제를 계속 동일성 검사하고 partial opt-in snippets는 별도 LSP schema test로 검증한다. snapshot 기대값만 덮어쓰지 않았다.
- 문서: `README.md`, `packages/company-runtime/README.md`, `docs/WEAVRA_OMP_OMO_ADOPTION_PLAN.md`, `docs/WORK_LOG.md`, 신규 `docs/WEAVRA_V03B_LSP_SMOKE_2026-09-17.md`.

### config / lifecycle / protocol

설정 형식은 `code_intelligence.lsp: {enabled:true, servers:[{id,executable,args,extensions,timeout_ms}]}`다. default disabled, root는 project root, 서버 최대 4개·unique ID/extension routing·argv 배열, timeout 기본 10,000ms/허용 100–60,000ms다. executable은 PATH 이름/절대 경로의 실제 파일만 해석하며 없으면 UNAVAILABLE이다. 자동 설치/서버 검색/remote/multi-root/env override는 없다.

`StandardWorkflow → lazy start → initialize → initialized → sequential query/reuse → shutdown → exit → group cleanup` 순서다. 정상 완료 전과 실패/취소 finally에 같은 idempotent close를 사용한다. unconfirmed cleanup은 후속 workspace 작업/COMPLETE/lease 해제를 막는다. worker 사이에 살아 있는 idle server와 cleanup 실패를 구분하며, 서버가 남긴 같은 process group의 descendant도 TERM/KILL·소멸 확인 대상이다. refCount/global daemon/cross-run persistence/idle reaper는 추가하지 않았다.

최대 frame 1 MiB, response/write buffer 2 MiB, header 4 KiB, transport pending 16, 수신 batch/server requests 256, stderr capture 16 KiB다. configuration은 bounded null 응답, workspaceFolders는 고정 root, progress/create는 null만 제공한다. `workspace/applyEdit`는 **applied:false**, unknown request는 -32601이다. client 요청 allowlist에도 rename/prepareRename/codeAction/formatting/organizeImports/workspace symbol은 없다. 실제 파일 mutation 함수는 LSP adapter에 없다.

CLOSED/EXITED typed error만 최대 1회 새 server에서 read query를 재시도한다. 이전 process cleanup 및 retry 전 disk digest를 확인한다. timeout/cancel/malformed/RPC/policy/stale는 자동 retry하지 않는다. 종료된 connection은 정리 확인 후 참조를 해제하여 run 내 반복 오류가 메모리를 누적하지 않게 했다.

### diagnostics / checks / Reviewer / freshness

- AVAILABLE은 query 응답이지 PASS가 아니다. UNAVAILABLE/PARTIAL/STALE/ERROR를 별도로 반환한다. 기존 error diagnostic도 자동 FAIL하지 않는다. push diagnostics는 completion acknowledgement가 없어 **빈 배열도 PARTIAL**이다. timeout을 빈 성공 cache로 바꾸지 않는다.
- 매 query는 디스크의 exact UTF-8 text로 didOpen하고 version을 증가시키며 결과 뒤 didClose한다. push store는 현재 URI/version(또는 unversioned)에만 제한한다. 1-based UTF-16 좌표를 LSP 0-based로 바꾸고 파일 범위 밖/surrogate 중간 위치는 거부한다. 전후 file digest가 달라지면 STALE/빈 결과와 명시적 재-query를 요구한다.
- SELF_CHECK/TEST는 **기존 required process checks → workspace inspect → routed changed files 최대 8개 LSP → final inspect**다. captured diffDigest와 final digest가 다르면 LSP evidence를 STALE로 남기고 기존 check freshness guard도 유지한다. LSP가 없거나 실패해도 process checks 자체의 결과를 대체하지 않는다. LSP 대기 중 취소되면 이미 실행한 process exit/output을 보존하고 기존 cancelled settlement를 적용한다.
- `lsp:<run>:<step>:<attempt>:<index>` refs를 VerificationResult.evidenceRefs와 reviewContext.evidence에 1:1 추가한다. 기존 trustedReviewEvidenceRefs/exact material count/Kernel ref validation은 그대로다. actual diff/check evidence와 함께 Reviewer에 전달하고 UNAVAILABLE/PARTIAL/STALE 사실도 숨기지 않는다.
- LSP body는 현재 VerificationResult/Reviewer payload에 연결하며 별도 durable state/cache/export를 만들지 않는다. `.ai`의 process check 목록은 그대로고 기존 Pi session ownership을 유지한다. LSP 자체가 hard completion gate가 되는 조건은 추가하지 않았다.

### path filtering / authority

- 네 도구는 enabled run에만 operation read/R0로 등록한다. `WORKER_FILE_TOOLS`는 그대로이며 edit/write의 R1/R2 floor·QUICK target·STANDARD/R2 binding·Reviewer/R3 mutation 권한도 그대로다. explicit LSP config/등록/local protected script는 기존 config digest 재료에 포함된다. 모델은 server 실행 argv나 policy를 도구 인자로 지정할 수 없다.
- 요청은 기존 literal allowed/protected/regular/single-link/no-follow/nonblocking·256 KiB strict UTF-8/non-NUL 경계다. 결과 URI도 같은 정책으로 검사해 workspace 밖·보호/비허용·symlink/hardlink/non-file/remote 항목 전체(이름 포함)를 withheld하고 raw URI나 그 파일 내용을 반환하지 않는다. symbols는 명시적 document만 지원한다.
- result items 최대 128개/약 8 KiB, symbol depth 16, message/name/source/code 길이 제한·control/bidi escaping·문자열 잘림 표시·deterministic 정렬을 적용한다. withheld/truncated 수는 숨기지 않는다.
- `/lsp`와 `/lsp status`는 config 또는 active frozen manager metadata만 조회한다. READY는 executable resolution이며 query/Provider/서버 start/writer/Git/repair를 수행하지 않는다. 기존 project-independent `weavra doctor`는 변경하지 않았다.
- **외부 language server/플러그인은 trusted code이며 OS sandbox가 아니다.** client mutation 요청은 거부하지만 서버 자체의 직접 I/O/네트워크까지 가로채지 않는다. credential 환경은 기존 verifier 필터를 재사용하고 TypeScript automatic typing acquisition은 initialize 옵션으로 비활성화했다. 탈출 daemon/Host 강제 crash/외부 syscall 경합은 기존 한계다.

### 이번 자동 검증 명령·실제 결과

```sh
# packages/company-runtime
node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2 test/lsp.test.ts test/lsp-config.test.ts test/anchored-edit.test.ts test/anchored-tools.test.ts test/launcher-home.test.ts test/graph-view.test.ts test/graph-view-command.test.ts test/graph.test.ts test/graph-command.test.ts test/worktree.test.ts test/launcher.test.ts test/status.test.ts test/hardening.test.ts test/kernel-hardening.test.ts test/observations.test.ts test/observation-files.test.ts test/approval.test.ts test/r2-review.test.ts test/quick.test.ts test/agent-metadata.test.ts test/contracts.test.ts test/config.test.ts test/extension.test.ts test/classification.test.ts test/kernel.test.ts test/host-boundary.test.ts test/state-store.test.ts test/policy.test.ts test/verification-boundary.test.ts

# packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2 test/suite/company-runtime-lsp.test.ts test/suite/company-runtime-status.test.ts test/suite/company-runtime-timeout.test.ts test/suite/company-runtime-hardening.test.ts test/suite/company-runtime-observations.test.ts test/suite/company-runtime-approval.test.ts test/suite/company-runtime-r2.test.ts test/suite/company-runtime-quick.test.ts test/suite/company-runtime-workflow.test.ts test/suite/company-runtime-agent.test.ts test/suite/agent-session-prompt.test.ts test/suite/agent-session-runtime.test.ts test/suite/agent-session-model-extension.test.ts test/suite/agent-session-retry-events.test.ts test/suite/agent-session-queue.test.ts test/args.test.ts test/sdk-session-manager.test.ts test/session-manager/file-operations.test.ts

# root
npm run check
git diff --check
bash -n packages/company-runtime/bin/weavra
```

- **최종 targeted(17:09 KST 시작): Runtime 29개 파일·978개 + coding-agent 18개 파일·587개 = 47개 파일·1,565개 PASS**, 실패/skip 0. 신규 95개(LSP transport/manager 54, config 21, SDK 16, command 4)와 기존 1,470개를 이번에 실행했다. LOG-039 등의 과거 결과를 합산하지 않는다.
- initialize/shutdown/exit/reuse, missing/directory executable, startup/query timeout, active cancel/close, malformed Content-Length/JSON/error/method/range·oversize/buffer/pending limits, process crash 및 살아 있는 process의 stdout EOF 각각의 최대 1회 retry, TERM 무시/descendant/no-orphan을 실제 stdio로 검증했다.
- Unicode/좌표·diagnostic 정렬/escaping/count/byte bound, definition/references/document symbols, 외부/보호/비허용/링크 URI 필터, input deny before spawn, file STALE, workspace STALE evidence, applyEdit false/unknown request/mutation methods 미지원, fresh disk/version과 push empty/old-version cache 경계를 검증했다.
- 실제 SDK/harness/faux는 QUICK/R0/R1·STANDARD/R1/R2·R3 consent·Reviewer read-only, exact trusted evidence, optional missing/timeout/push snapshots, required process FAIL/누락 guard, Policy denial·schema scope injection, active LSP 및 verifier LSP 취소·actual process outcome 보존, cleanup 미확인 시 COMPLETE/lease 차단을 검증했다.
- 기존 `/graph`·`/graph view`·setup/doctor·worktree create/open/list·anchored edit·stale-review·cancellation 및 Pi session/argv 회귀를 다시 통과했다.
- `npm run check` 최종 PASS(TypeScript/deps/entry graphs/shrinkwrap/install lock/browser smoke). 초기 unused type import 1건과 notification callback이 갱신하는 필드를 TS가 undefined로 고정 추론한 오류를 정리했다. guard/검사/의존성을 낮추지 않았다. Biome은 이번 변경 파일만 포맷했고 그 뒤 위 전체 targeted를 실행했다. `git diff --check`, `bash -n` PASS.

### 실제 TS / Provider smoke

- 이미 설치된 **typescript-language-server 5.1.3**, CLI `tsc` 6.0.3, Node26.7.0을 사용했다. auto-install/build 없음. private `/tmp/weavra-v03b-smoke.uXyt4D`의 synthetic TS fixture에서 `node .../transport.mjs`: TS2322/error 1개(PARTIAL), definition 1개, references 3개, symbols bad/greet(AVAILABLE), 파일 SHA/목록 무변경, close 후 safeToRelease true/process stopped **PASS**. 최종 EOF/parser 보완 뒤 17:09에 같은 네 query를 재실행해 PASS했다. Provider 호출은 없는 transport smoke다.
- 실제 사용자 profile **codex-lb/gpt-6-astra**, medium으로 `node .../provider.mjs`의 **STANDARD/R1 한 run**을 16:46–16:47 실행했다. Developer가 runtime_lsp_diagnostics를 수정 전후 호출했고 `"wrong"` initializer만 숫자 0으로 바꿨다. Reviewer가 verifier-owned PARTIAL/0 diagnostics와 exact trusted ref/current digest를 받았고 독립 PASS, SELF_CHECK/TEST의 regression/typecheck **4개 PASS** 뒤 COMPLETED했다. Run `f60816fb-f65d-4103-b8b6-d1e0d6032795`, 45,283ms, Provider-reported total 15,152 tokens(실제 비용 미확인). 서버 stopped·writer.lock 없음·개인 auth/models/settings bytes 불변을 확인했다.
- `node .../verify.mjs`가 saved state/session에서 TS2322→빈 PARTIAL diagnostics, Reviewer refs/독립 PASS 및 실제 checks를 별도로 대조했다(PASS). 마지막 parser/availability/EOF/취소 보완 후에는 자동 회귀와 실제 transport만 재검증했고 유료 Provider를 반복 호출하지 않았다.
- 상세 관찰 경계·fixture·run/session ID와 한계는 **[WEAVRA_V03B_LSP_SMOKE_2026-09-17.md](WEAVRA_V03B_LSP_SMOKE_2026-09-17.md)**에 기록했다. 전체 conversation/reasoning/tool 로그·credential은 문서에 복제하지 않았다. 사용자 원본 RC fixture는 수정하지 않았다.

### 한계·다음 작업·커밋

- 진단은 changed files 최대 8개, query는 explicit document만 지원한다. push의 completeness/unversioned server cache·서버 semantic correctness를 증명하지 않으며 PARTIAL을 유지한다. 전체 workspace diagnostics나 새로운 hard gate가 아니다.
- LSP evidence를 별도 durable cache/export로 저장하지 않는다. 다른 language server/OS/Node·Windows·monorepo multi-root·remote/global daemon·TUI 화면 검증은 미실행이다. 전체 GPT RC-01~08·upstream e2e·build는 재실행하지 않았다.
- rename/prepareRename/codeAction/applyEdit/formatter/organizeImports/workspace-wide symbols/자동 install/autofix/auto merge·commit은 추가하지 않았다. 기존 runtime_write/legacy edit의 anchored 보호 범위도 그대로다.
- 최종 문서 기록 뒤 root `npm run check`를 다시 실행해 자동 수정 없이 PASS했고 diff/bash 검사도 PASS했다. 임시 Python 검사로 변경 30개 파일, 문서 링크/fence·LOG-001~042 본문 보존, Kernel/Policy/Approval/State/Graph/Launcher/Anchored Edit/Pi Core/dependency·RC 태그 불변을 확인했다(PASS).
- 조사·smoke에 사용한 임시 소스/fixture/session/harness/검사 script만 정리하고 두 임시 루트의 부재를 확인했다. 안정 태그 `weavra-v0.1-rc1`과 원본 사용자 설정/fixture는 유지했다.
- **다음 작업:** 실제 프로젝트에 explicit LSP 설정을 opt-in하고 advisory/partial 의미를 확인한다. 성능/coverage·다른 서버·durable evidence 확장은 별도 후속 범위다.
- **커밋·푸시·태그 변경:** 모두 하지 않음.

---

## LOG-044 — V0.3B Read-only LSP 커밋 준비

- **기록일:** 2026-09-17 17:21 (KST)
- **상태·목적:** 사용자 요청에 따라 LOG-043의 V0.3B 구현·테스트·문서를 로컬 `devlop`에 커밋한다. 이번 요청에는 푸시가 없으므로 원격 게시하지 않는다.
- **변경 파일:** LOG-043의 Runtime 소스 8개와 신규 `src/lsp/` 10개, 기존 Runtime 테스트 3개·신규 테스트/fixture 4개, README/adoption/work log/smoke 문서 5개로 총 30개. 이번 준비에서는 현재 요약과 이 항목만 갱신했다. dependency/lockfile 변경은 없다.
- **이번 검증:** root `npm run check` 재실행 PASS, Biome 자동 수정 및 warning/info/error 없음. `git diff --check`, `bash -n packages/company-runtime/bin/weavra` PASS. `git status --short --branch`, 변경 30개 경로와 기존 staged 변경 없음, HEAD 및 RC tag peeled commit 불변을 확인했다.
- **과거 검증과 구분:** 47개 파일·1,565개 PASS와 실제 TS/Provider smoke는 LOG-043 구현 당시 결과다. 이번 커밋 준비에서는 테스트/Provider/TUI/build를 다시 실행하지 않았다.
- **문제·해결:** 추가 문제 없음. 명시적 30개 경로만 stage하고 일반 commit 검사를 유지한다. 다른 작업이나 lockfile은 포함하지 않는다.
- **남은 제한·다음 작업:** advisory/PARTIAL 의미, trusted language server의 비-sandbox 한계와 다른 서버/OS/Node 미검증을 유지한다. 커밋 후 변경 목록·clean working tree·RC 태그 불변을 확인한다. 푸시는 별도 요청 후 수행한다.
- **커밋 상태:** 이 항목 작성 시 실행 직전. 메시지는 `feat(coding-agent): add read-only Weavra LSP intelligence`이며 실제 SHA는 Git 이력과 최종 응답으로 보고한다. `weavra-v0.1-rc1`은 이동·수정하지 않는다.

---

## LOG-045 — V0.3B 게시: 원격 문서 커밋과 충돌 없는 통합

- **기록일:** 2026-09-17 17:30 (KST)
- **상태·목적:** 사용자의 추가 푸시 요청에 따라 미게시 V0.3B 커밋을 `origin/devlop`에 게시한다.
- **문제·해결:** 최초 `868cbd0d3` 푸시가 원격 선행 변경으로 거부됐다. `git fetch origin devlop` 후 원격 `8850dd352`가 `docs/WEAVRA_IMPROVEMENT_AND_FEATURE_RESEARCH_2026-09-17.md`만 추가한 커밋임을 확인했다. clean 상태에서 `git rebase origin/devlop`을 수행했고 충돌 없이 완료됐다. `git range-diff e09100fe3..868cbd0d3 8850dd352..HEAD`의 `=`로 V0.3B patch가 그대로임을 확인했다. 강제 푸시는 사용하지 않는다.
- **변경 파일:** 이번 후속 기록은 `docs/WORK_LOG.md`의 현재 요약과 본 항목뿐이다. 원격 연구 문서와 기존 V0.3B 코드·테스트 내용은 수정하지 않았다.
- **이번 검증:** rebase 후 `npm run check` PASS, Biome 자동 수정 및 warning/info/error 없음. `git diff --check`, `bash -n packages/company-runtime/bin/weavra` PASS. 작업 트리 clean과 원격 대비 V0.3B 커밋 1개 선행 상태를 확인했다.
- **과거 검증과 구분:** LOG-043의 47개 파일·1,565개 PASS 및 실제 TS/Provider smoke는 구현 당시 결과다. 이번 게시 준비에서는 테스트/Provider/TUI/build를 재실행하지 않았다.
- **남은 제한·다음 작업:** 기존 advisory/PARTIAL·비-sandbox 및 플랫폼 미검증 한계를 유지한다. 이 기록을 미게시 V0.3B 커밋에 포함한 뒤 일반 push하고 로컬·원격 HEAD 일치, clean과 RC 태그 불변을 확인한다.
- **커밋 상태:** 최초 커밋은 rebase로 교체됐다. 최종 SHA·실제 푸시 결과는 Git 이력과 최종 응답으로 보고한다. 안정 태그 `weavra-v0.1-rc1`은 이동·수정하지 않는다.

---

## LOG-046 — V0.3C: Trust Baseline (FIX-01 / FIX-02 / FIX-04)

- **기록일:** 2026-09-17 19:08 (KST), 착수 17:52 KST.
- **상태:** 지정한 세 FIX 구현·로컬 자동 회귀 완료 / 미커밋. 실제 Actions/Linux와 새 Provider smoke 미검증.
- **목적:** devlop 설치/CI 기준을 명시하고, 자연어 분류와 worker mutation permission을 별도 trusted Execution Contract로 분리한다.
- **착수 확인:** 먼저 `git status --short --branch`가 clean임을 확인했다. 그 뒤에만 `git fetch origin devlop` → `git rebase origin/devlop`을 수행했으며 already up to date였다. 로컬/원격 HEAD는 사용자 지정 **`dd3c3f706023caae693b1e67204531c5df8676f5`**와 일치했다. stash/reset/clean/강제 푸시는 하지 않았다. roadmap/research/작업 이력을 읽었다.

### FIX-01 / FIX-02 — 설치와 CI

- root README clone을 `git clone --branch devlop --single-branch https://github.com/kjg8619/pi.git weavra`로 명시하고 main=upstream/base Pi, devlop=current Weavra development, RC tag=immutable historical baseline을 구분했다. checkout/source/dependency 변경 후 fork-local rebuild 계약과 global pi 불변은 유지했다. 실제 full fresh install은 이번 범위에서 재실행하지 않았다.
- root `package.json`을 **check = Biome --write + check:base**, **check:ci = Biome non-write + check:base**로 분리했다. base에는 기존 pinned/runtime deps, TS imports, entry graphs, shrinkwrap/install-lock, tsgo --noEmit, browser smoke를 빠짐없이 유지한다. dependency metadata/lockfile 변경은 없다.
- `.github/workflows/ci.yml`은 main/devlop push 및 해당 base PR을 대상으로 한다. Check는 check:ci, Test는 기존 전체 workspace tests를 호출하는 **`bash ./test.sh`**로 실행하여 빈 환경/격리 HOME에서 auth·Provider key·endpoint 조건이 일반 CI에 유입되지 않게 했다. launcher syntax와 마지막 `if:always()`의 **`git diff --exit-code HEAD --`**를 추가했다. 원격 branch protection을 자동 변경하지 않았다.
- 기존 root build는 AI generate-models를 호출해 tracked `*.models.ts`/`models.generated.ts`를 다시 쓸 수 있음을 package scripts와 generator의 data-only 분기로 확인했다. CI에서는 기존 supported **hydrate:model-data(--data-only)**로 ignored JSON을 준비하고 **build:offline**으로 동일 workspace source를 빌드한다. 넓은 ignore/checkout/reset으로 diff를 지우지 않는다. 공개 catalog metadata hydration은 inference/auth smoke가 아니다. local build/full npm test를 임의 실행하지 않았다.

### FIX-04 — 구조 / 선택 / binding

문제는 STANDARD/R0 label만으로는 Developer의 write/edit를 사전에 막지 못했던 것이다. 예를 들어 STANDARD의 설명 run에서도 일반 mutation 도구가 설치되고 action이 R1로 평가될 수 있었다. 이제 label에 의존하지 않고 다음을 고정한다.

```text
자연어 → conservative proposal (권한 아님)
       → Host의 명시적 mode 확인 / trusted API selection
       → immutable {runId, mode}
       → Run.executionMode / Agent request / Policy binding
       → tool exposure + Policy DENY + durable identity + no-change completion
```

- 신규 `src/execution-contract.ts`: pure ExecutionMode schema/type, candidate selection, bind/assert, prompt guidance. SDK/Provider/fs 의존성이 없다. READ_ONLY/EDIT 이외 및 missing contract는 거부한다. **R0 label이나 모델 입력은 permission authority가 아니다.**
- proposal은 명확한 English/Korean read/mutation 동사를 보수적으로 구분하고 quoted code/words/paths를 data로 처리한다. negation, 혼합 요청, 불완전 quote/control·과대 입력을 다루지만 범용 의미 분석기는 아니다. ambiguous/mixed는 requiresConfirmation으로 거부하고 새 명확한 run을 요구한다. Host confirmation에는 mode와 permission 경계를 명시하며 동의 전에 Provider를 만들지 않는다.
- 프로그램 Host도 `WorkflowOptions.executionMode`를 명시해야 한다. Workflow가 생성한 run ID에 bind한 contract를 factory의 다섯 번째 인자 `createAgents(store, quickScope, r2RunId, r3Scope, executionContract)`로 전달한다. PiAgentExecutorOptions의 executionContract는 필수이며 복사/고정된다. Kernel creation/Agent execute/Policy가 동일 run/mode를 확인한다. 자동 EDIT default나 모델 tool 인자로 mode를 받는 경로는 없다.
- `classification.ts`의 기존 risk heuristic/floor는 유지하며 Korean question의 알려줘/알려주세요 표현만 보완했다. 오류/bug 단어 때문에 R1로 분류되더라도 READ_ONLY contract는 여전히 읽기 전용이다. negated/quoted 위험 단어가 raw R3를 만들면 **READ_ONLY/R3는 preflight에서 fail closed**한다. risk를 낮춰 R3 requirement를 우회하지 않는다. READ_ONLY/R2도 STANDARD mandatory independent Reviewer를 유지한다.
- `quick.ts`의 goal path 문법은 한글·quote/backtick 공백 path·단일 trailing 문장부호/colon을 지원한다. 내부 apostrophe/괄호를 잘라 다른 경로로 바꾸지 않고 comma-separated/unsafe path는 거부한다. tool path 자체를 normalize/fuzzy 교정하지 않는다. R3 deletion grammar/scope는 확장하지 않았다.

### Enforcement / old state

- **노출:** READ_ONLY Developer/Executor에는 runtime_write/runtime_edit 정의를 생성·설치하지 않고 runtime_delete도 제공하지 않는다. read/search/read-only LSP/structured submit 및 기존 check 요청(실행하지 않음)은 유지한다. Reviewer는 EDIT run에서도 기존 read-only 역할이다.
- **Policy:** trusted executionMode/executionRunId가 필수다. write/edit/delete는 READ_ONLY에서 사전 DENY하며 입력/schema/risk label 조작이나 valid R3 consent로 우회하지 못한다. deny에서도 dependency/R3 최소 risk를 유지한다. R2/R3 bound review/approval 조건은 그대로다.
- **Digest/Store:** policyVersion `V0.3C-1` 및 config/action digest에 contract를 결합했다. PolicyDecision에도 mode를 기록하고 Store.prepare가 persisted run의 mode와 대조한다. 같은 run의 mode 변경/삭제, 다른 Policy contract, legacy mode 추정은 fail-closed다. Runtime transcript/credential 전체를 새로 기록하지 않는다.
- **완료:** READ_ONLY는 live inspect를 요구하고 관찰된 workspace mutation을 차단한다. completion은 safe workspace·SELF_CHECK·TEST·handoff changedFiles가 모두 0임을 추가 검사한다. external/verification-induced mutation도 READ_ONLY COMPLETED가 아니다. 사후 Git guard를 사전 차단의 유일한 근거로 사용하지 않는다.
- **과거 state:** Run/PolicyDecision schema의 mode는 historical read를 위해 optional이다. 필드가 없는 과거 run은 `/workflow status`·`/state`·`/risk`에서 **UNKNOWN (legacy; no permission inferred)**로 읽는다. readSnapshot은 bytes/recovery를 바꾸지 않고 자동 migration/overwrite를 하지 않는다. 기존 writer-open interruption recovery도 mode를 새로 부여하지 않는다. 새 live creation/active writes/Agent/Policy에는 명시 mode가 필요하다.
- registered verifier와 LSP 실행 파일은 기존 trusted-code 경계다. READ_ONLY라고 이들의 직접 I/O를 sandbox하지 않는다. 변경이 관찰되면 완료를 막지만 관찰 밖 host I/O·외부 race를 모두 사전 차단한다는 보장은 없다. FIX-08/Verifier sandbox는 후속이다.

### 변경 파일과 기존 회귀의 연결

- 제품 변경: root README/package scripts/CI; Runtime `execution-contract.ts` 신규 및 `classification/quick/contracts/ports/kernel/workflow/agent-runner/agent-tools/policy/state-store/observations/extension/verification/workspace/lsp/files` 연결.
- 신규 tests: Runtime `execution-contract.test.ts`, `trust-baseline.test.ts`. 기존 SDK LSP suite에 actual SDK/faux READ_ONLY QUICK/STANDARD/heuristic-R1/R2·direct mutation·tampering·external/check mutation 부정 테스트 18개, Host confirmation tests 3개를 추가했다.
- 기존 live test factories에는 명시적인 EDIT/READ_ONLY grant와 run binding을 제공했다. legacy observation fixtures는 필드 없는 상태로 유지했다. 변경은 광범위하지만 대부분 fixture의 required contract 추가이며 기존 mutation/R2/R3/리뷰/취소 assertions를 제거하거나 허용 기준을 낮추지 않았다.
- 문서 `README.md`, `packages/company-runtime/README.md`, `docs/WEAVRA_ROADMAP_2026-09-17.md`, `docs/WEAVRA_IMPROVEMENT_AND_FEATURE_RESEARCH_2026-09-17.md`, `docs/WORK_LOG.md`. roadmap의 완료 표기는 구현/회귀 뒤에 추가하고 remote CI/fresh install 미검증을 분리했다. 연구의 수정 전 관찰/SHA는 보존했다.
- Project Instructions, runtime_list_files/Repo Map, AC/Planner, telemetry/evals/Evidence Pack, strict edit, sandbox, Browser/MCP, COMPLEX/parallel은 구현하지 않았다. Pi Core/패키지 버전/dependencies/lockfile/launcher/Graph/Viewer/anchored helper/LSP transport/Approval 구현은 변경하지 않았다.

### 검증 명령과 실제 결과

```sh
# packages/company-runtime — Node26/macOS
node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2 test/execution-contract.test.ts test/trust-baseline.test.ts test/lsp.test.ts test/lsp-config.test.ts test/anchored-edit.test.ts test/anchored-tools.test.ts test/launcher-home.test.ts test/graph-view.test.ts test/graph-view-command.test.ts test/graph.test.ts test/graph-command.test.ts test/worktree.test.ts test/launcher.test.ts test/status.test.ts test/hardening.test.ts test/kernel-hardening.test.ts test/observations.test.ts test/observation-files.test.ts test/approval.test.ts test/r2-review.test.ts test/quick.test.ts test/agent-metadata.test.ts test/contracts.test.ts test/config.test.ts test/extension.test.ts test/classification.test.ts test/kernel.test.ts test/host-boundary.test.ts test/state-store.test.ts test/policy.test.ts test/verification-boundary.test.ts

# packages/coding-agent — Node26/macOS
node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2 test/suite/company-runtime-lsp.test.ts test/suite/company-runtime-status.test.ts test/suite/company-runtime-timeout.test.ts test/suite/company-runtime-hardening.test.ts test/suite/company-runtime-observations.test.ts test/suite/company-runtime-approval.test.ts test/suite/company-runtime-r2.test.ts test/suite/company-runtime-quick.test.ts test/suite/company-runtime-workflow.test.ts test/suite/company-runtime-agent.test.ts test/suite/agent-session-prompt.test.ts test/suite/agent-session-runtime.test.ts test/suite/agent-session-model-extension.test.ts test/suite/agent-session-retry-events.test.ts test/suite/agent-session-queue.test.ts test/args.test.ts test/sdk-session-manager.test.ts test/session-manager/file-operations.test.ts

# 별도 shell에서 Node22/macOS (각 package root)
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
# packages/company-runtime
node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2 test/execution-contract.test.ts test/trust-baseline.test.ts test/policy.test.ts test/kernel.test.ts test/quick.test.ts test/r2-review.test.ts test/approval.test.ts test/anchored-edit.test.ts test/anchored-tools.test.ts test/lsp.test.ts test/extension.test.ts test/observations.test.ts test/state-store.test.ts
# packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2 test/suite/company-runtime-lsp.test.ts test/suite/company-runtime-agent.test.ts test/suite/company-runtime-quick.test.ts test/suite/company-runtime-r2.test.ts test/suite/company-runtime-approval.test.ts

# root (기본 Node26)
npm run check
python3 /tmp/weavra-v03c-verify.W8Q98Y/check-ci-bytes.py  # 내부에서 npm run check:ci 실행 + 전후 bytes/modes 비교
git diff --check
bash -n packages/company-runtime/bin/weavra
```

- **Node v26.7.0/macOS 최종(18:59 KST 시작): Runtime 31개 파일·1,041개 + coding-agent 18개 파일·605개 = 49개 파일·1,646개 PASS**, 실패/skip 0. 신규 81개(contract/policy/storage/path 55 + installation/CI 5 + SDK 18 + Host confirmation 3)와 기존 1,565개를 이번에 실행했다.
- **Node v22.22.3/macOS 별도 최종(19:01 KST 시작): Runtime 13개 파일·545개 + SDK 5개 파일·255개 = 18개 파일·800개 PASS**, 실패/skip 0. 위 Node26 결과와 중복되는 다른 Node 실행이며 고유 테스트 총수로 더하지 않는다.
- root check/check:ci/diff/bash **PASS**. check:ci 실행 전후 **tracked 1,811개 경로와 non-ignored untracked files의 bytes/modes/목록이 동일**했다. Biome non-write negative fixture는 의도적 formatting 오류를 non-zero로 거부하고 원문 bytes를 유지했다.
- 초기 기존 회귀는 Runtime **975 PASS/3 FAIL**, SDK **500 PASS/87 FAIL**이었다. 새 live contract를 요구하는 Store fixture의 누락 3건을 명시 grant로 보완했고, 나머지 주요 원인은 GitWorkspace evidence가 사용하던 가상 `evidence` run ID와 새 Policy binding의 불일치였다. Git/LSP 검사에 actual frozen run ID를 전달하여 해결했으며 EDIT/anchored/LSP 기존 성공 assertions를 낮추지 않았다.
- 신규 corpus 처음 9개 실패는 `mode` 필드 부재를 `toMatchObject({mode:undefined})`로 비교한 테스트 shape 오류였다. requiresConfirmation=true 및 mode가 undefined임을 각각 검증하도록 수정했다. 실제 proposal은 이미 fail-closed였다. root check의 shell `${...}` literal lint 경고는 regex assertion으로 해결했다. 최종 check에 warning/info/error는 없다.
- path 검토에서 punctuation split이 파일명 내부 apostrophe/괄호를 잘라 잘못된 candidate를 만들 수 있어 whole-token parsing으로 보완하고 추가 6개 경로/혼합 regression을 최종 set에 포함했다.

### NOT VERIFIED / 다음 작업 / 커밋

- **실제 Provider 수행: 없음.** 새 Execution Contract의 모델 행동/품질을 real Provider PASS로 주장하지 않는다. 기존 V0.3A/V0.3B Provider 기록은 역사적 결과다. 전체 GPT RC-01~08/유료 smoke를 자동 재실행하지 않았다.
- **Node22/Linux/GitHub Actions의 실제 build/test, branch rules/required checks, 문서 전체 fresh install: NOT VERIFIED.** Docker CLI는 있었으나 daemon socket이 없어 연결할 수 없었다. VM/daemon/외부 dependency를 자동 설치·시작하지 않았다. Node22/macOS PASS를 Linux PASS로 표시하지 않는다.
- local full build/full npm test/TUI·실제 TS server smoke는 재실행하지 않았다. CI YAML은 기존 workspace build/tests를 유지하도록 구성했고 로컬에서는 요청 범위의 targeted와 non-mutating check를 검증했다.
- 범용 NLP가 아니므로 일부 명확해 보이는 goal도 기존 routing/risk/scope 검사에서 거부될 수 있다. READ_ONLY/R3 negation은 권한을 부여하지 않지만 conservative raw risk 때문에 실행 자체를 거부한다. 사용자는 새 명확한 run을 요청해야 한다.
- 최종 문서 반영 후 check/check:ci를 재실행해 자동 수정·warning/info/error 없이 PASS했다. tracked 1,811개 및 untracked source의 byte/mode 불변을 다시 확인했고 diff/bash 검사도 PASS했다. 문서의 기존 Markdown hard-break 공백이 새 변경 줄에서 diff 검사에 걸린 것은 명시적 `<br>`로 고쳤다.
- 별도 최종 검사에서 변경 50개 파일, 문서 상대 링크/fence, LOG-001~045 본문 보존, dependency metadata/lockfile 및 비대상 구현·HEAD/RC 태그 불변을 확인했다(PASS). 임시 검증 script 디렉터리를 제거하고 부재를 확인했다.
- **다음 작업:** 사용자 승인 후 일반 commit/push와 실제 Actions 결과를 확인한다. 그 뒤 V0.3D 여부를 별도로 결정한다. 이번에는 후속 기능을 추가하지 않는다.
- **커밋·푸시·태그 변경:** 모두 하지 않음. `weavra-v0.1-rc1`은 `183f85de1897d8b9f4fadb368a54e2b1390e5a84`로 유지한다.

---

## LOG-047 — V0.3C Trust Baseline 커밋·푸시 준비

- **기록일:** 2026-09-17 19:43 (KST)
- **상태·목적:** 사용자 요청에 따라 LOG-046의 FIX-01/02/04 구현·테스트·문서를 커밋하고 `origin/devlop`에 게시한다.
- **변경 파일:** LOG-046의 CI/root scripts·Runtime Execution Contract 연결·기존 live fixture의 명시적 contract·신규 regression·문서 총 50개. 이번 준비에서는 작업 이력의 현재 요약과 본 항목만 추가했다. dependency/lockfile 및 후속 기능 변경은 없다.
- **이번 검증:** `npm run check`, `npm run check:ci` 재실행 PASS, Biome 자동 수정 및 warning/info/error 없음. `git diff --check`, `bash -n packages/company-runtime/bin/weavra` PASS. status/변경 목록에서 대상 50개 파일과 기존 staged 변경 없음, HEAD 및 RC 태그 불변을 확인했다.
- **과거 검증과 구분:** Node26/macOS 49개 파일·1,646개, Node22/macOS 18개 파일·800개 PASS와 check:ci bytes 불변 검사는 LOG-046 당시 결과다. 이번 커밋 준비에서는 targeted tests·Provider·TUI/build를 다시 실행하지 않았다.
- **문제·해결:** 추가 문제 없음. 명시적 50개 경로만 stage하며 일반 commit/push와 검사를 유지한다. 원격 선행 변경이 발견되면 확인 후 충돌 없는 통합만 수행하며 강제 푸시는 하지 않는다.
- **남은 제한·다음 작업:** 실제 Actions/Node22 Linux build-test·fresh install 전체·새 contract의 Provider 검증은 아직 NOT VERIFIED다. 게시 후 로컬·원격 HEAD 일치, clean과 RC 태그 불변을 확인한다. CI 원격 결과는 별도 evidence로 구분한다.
- **커밋 상태:** 이 항목 작성 시 실행 직전. 메시지는 `feat(coding-agent): establish Weavra execution contracts and devlop CI`이며 최종 SHA·push 결과는 Git 이력과 최종 응답으로 보고한다. `weavra-v0.1-rc1`은 이동·수정하지 않는다.

---

## LOG-048 — V0.3D: Project Context (FIX-03 / FIX-06 / bounded list_files)

- **기록일:** 2026-09-17 20:55 (KST), 착수 19:52 KST.
- **상태:** 세 범위 구현·자동 회귀 완료 / 미커밋. Provider 완료 smoke 1회 FAIL, 후속 실제 성공 미검증.
- **목적:** 명시적 프로젝트 규칙과 파일 탐색 출발점을 제공하고 JVM build/dependency risk를 보강한다. Project Context를 permission authority로 사용하지 않는다.
- **착수 확인:** `git status --short --branch`가 clean인 상태에서 `git fetch origin devlop`을 실행하고 clean인 경우만 rebase했다(already up to date). 로컬/원격 HEAD는 사용자 기준 **`08c04daf17e5d3ee5846fff3ab45b9e2bbd990d5`**와 일치했다. stash/reset/clean이나 branch 이동은 없었다. roadmap/research/작업 이력과 기존 path/anchored/Policy 경계를 확인했다.

### FIX-03 — 설정·snapshot·전달

- optional config는 **`project.instructions.path: AGENTS.md`** 형태다. absent는 disabled이며 기본 filename/auto-discovery가 없다. 파일 하나만 지원하고 glob/directory/parent/absolute/symlink/outside/protected 경로와 unsupported settings는 거부한다.
- Host가 전달한 frozen config를 trusted `PiAgentExecutor.create()` preflight가 읽는다. `project-instructions.ts`에서 기존 isPolicyPath/isProtectedPath·strict UTF-8 decoder·exact SHA helper를 재사용했다. canonical root/ancestors와 final target, no-follow/nonblocking FD, regular/nlink=1, **64 KiB**와 UTF-8 round trip/NUL 경계를 확인한다. overflow는 truncate하지 않는다. read 전후 FD/name dev/ino/mode/size/mtime/ctime 및 ancestor identity도 비교한다.
- Host의 explicit context 선택이므로 worker allowed_paths에 AGENTS.md를 추가할 필요는 없다. 단 built-in 보호, Runtime source와 등록된 local verifier/LSP script 보호는 그대로 적용한다. 이것이 일반 worker read 권한 확대를 뜻하지 않는다.
- snapshot `{path,digest,bytes,content}`는 생성 후 immutable memory input이다. 기존 projectInstructions seam에 content를 한 번 고정하고 같은 Agent adapter의 Developer/Executor/Reviewer와 재작업에 동일하게 전달한다. run 도중 파일 B를 다시 읽어 현재 A prompt를 바꾸지 않는다. 외부 변경은 기존 clean/freshness guard에서 실패할 수 있으며, 다음 run만 B를 읽는다.
- 기존 trusted inline Host string seam은 유지하지만 configured file과 동시 지정하면 거부한다. 파일 merge/inheritance는 없다. prompt는 context-only block과 별도의 execution/role/security guidance를 구분하며, no extensions/skills/implicit AGENTS 및 fixed resource loader를 유지한다.

### metadata / protection / freshness

- `project-instruction-types.ts`는 pure metadata schema/type이다. **Run.projectInstruction에는 path/digest/bytes만** 저장한다. content는 state나 `/state`에 추가 복제하지 않는다. 새 run의 no-file은 null/none, legacy absent는 UNKNOWN으로 구분한다. SDK/Provider로 전달되는 지침은 context이므로 임의 파일 속 비밀을 자동 탐지한다고 주장하지 않는다.
- policyVersion `V0.3D-1`, config/action digest 및 PolicyDecision.projectInstructionDigest에 snapshot identity를 결합했다. Kernel request/Agent의 metadata가 달라지거나 Store의 run metadata/digest binding을 바꾸면 거부한다. inline string도 config digest에는 hash만 결합한다.
- **configured instruction path는 worker protectedPaths에 추가**하여 read/search/list/LSP/mutation에서 모두 제외했다. 민감한 규칙 파일을 다시 읽거나 최신 B를 읽어 Reviewer context를 바꾸지 못하게 하는 보수적 선택이다. path 비교는 case-insensitive NFC이며 실제 I/O path를 normalize해 다른 파일로 바꾸지 않는다. 내부 alias로 protection을 놓치지 않기 위한 비교다.
- instructions의 shell 허용/외부 수정/승인 생략/check 생략 문구가 tool surface, Execution Contract, Policy, Approval, Kernel guard를 변경하지 않음을 SDK/faux에서 검증했다. metadata-only persistence와 config 없는 auto-discovery trap도 유지했다.

### FEAT-02 일부 — runtime_list_files

- 입력은 **`{path?: string, maxDepth?: integer}`**다. 기본 호출은 **`runtime_list_files({})`**, path 생략은 configured allowed roots이며 `.`/`/`/`..`/빈 문자열을 root alias로 취급하지 않는다. maxDepth 기본/최대 4, 0..4 directory descents를 지원한다.
- 별도 Policy **operation=list / risk R0**로 등록하고 기존 fileAction의 Policy→intent→재검사→실행→audit를 거친다. list만 directory/missing root를 허용하며 read/search의 regular explicit-file 계약은 완화하지 않는다. READ_ONLY/Reviewer에도 제공하지만 mutation capability는 없다.
- `list-files.ts`는 Node fs opendir/read/lstat만 사용한다. shell/fd/find/ripgrep 또는 파일 내용 읽기는 없다. 최대 **500 files, 64 KiB JSON output, roots 32, enumerated entries/visited nodes 각각 4,096**이다. 결과는 relative file paths/truncated/reason뿐이며 stat/inode/absolute path/content를 반환하지 않는다.
- 요청·후보에 allowed/protected/unsafe-name 필터를 적용하고 symlink를 따라가지 않는다. hardlink/special files도 숨기고 traversed directory identity·결과 file facts를 재검사한다. cancellation은 열린 directory를 닫고 partial success를 반환하지 않는다.
- lexical root/entry/output ordering과 de-duplication을 사용한다. bounded enumeration 도중 한도 초과한 directory는 OS 순서의 임의 prefix를 반환하지 않고 그 directory를 생략한다. depth/root/file/byte/entry 제한은 truncated로 알리며 잔여 총수를 추정하지 않는다. 원자 filesystem snapshot이나 외부 syscall race 완전 방지는 아니다.
- 강제 ignore는 `.git/.ai/.pi` 등 기존 security protected rules·configured instruction/local protected paths와 `node_modules`다. **dist/build/coverage/target은 allowed 범위면 유지**한다. explicit allow를 무시하는 성능용 global ignore나 .gitignore 재구현은 하지 않았다. runtime_search를 recursive search로 바꾸지 않았다.

### FIX-06 — JVM risk

- `isDependencyPath`에 pom.xml, build/settings.gradle[.kts], gradle.properties, gradle/libs.versions.toml, gradle/wrapper/gradle-wrapper.properties, .mvn/wrapper/maven-wrapper.properties를 추가했다. module prefix와 기존 portable policy의 case-insensitive exact suffix 규칙을 따른다.
- backup/docs 유사 이름(pom.xml.bak, build.gradle.txt, my-build.gradle.notes, docs/pom.xml.md)과 .mvn 전체는 확대하지 않는다. R1 mutation은 R2/REVIEW_REQUIRED, bound STANDARD/R2는 기존 independent review, READ_ONLY는 여전히 mutation DENY다. read/list/search 자체는 R0로 유지한다. 기존 dependency 파일의 R3 삭제 제한도 그대로 적용된다.

### 변경 파일과 회귀 의미

- 신규 `src/project-instruction-types.ts`, `src/project-instructions.ts`, `src/list-files.ts`, `src/list-files-tool.ts` 및 Runtime `project-context.test.ts`, `list-files.test.ts`, SDK `company-runtime-context.test.ts`.
- config/Policy/tools/runner/Kernel metadata/Workflow binding/Store/observation/Host confirmation에 연결했다. 기존 Reviewer/R3 tool list와 anchored action digest tests는 **read-only tool 1개 및 instruction digest metadata**를 명시적으로 검증하도록 보완했다. 기존 mutation/role/approval assertions는 유지했다.
- 문서 `README.md`, `packages/company-runtime/README.md`, roadmap/research/WORK_LOG 및 별도 Provider smoke 기록을 갱신했다. roadmap의 구현 완료와 실제 Provider 성공 미검증을 구분했다.
- 새 dependency/lockfile, Project Instructions 다중 파일/자동 discovery/inheritance, Repo Map/index, AC/Planner, telemetry/evals/Facts, strict edit/sandbox/browser/MCP/COMPLEX/parallel은 추가하지 않았다. Pi로 개발했으며 Weavra self-hosting claim은 없다.

### 이번 자동 검증 명령·실제 결과

```sh
# packages/company-runtime — Node26/macOS
node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2 test/project-context.test.ts test/list-files.test.ts test/execution-contract.test.ts test/trust-baseline.test.ts test/lsp.test.ts test/lsp-config.test.ts test/anchored-edit.test.ts test/anchored-tools.test.ts test/launcher-home.test.ts test/graph-view.test.ts test/graph-view-command.test.ts test/graph.test.ts test/graph-command.test.ts test/worktree.test.ts test/launcher.test.ts test/status.test.ts test/hardening.test.ts test/kernel-hardening.test.ts test/observations.test.ts test/observation-files.test.ts test/approval.test.ts test/r2-review.test.ts test/quick.test.ts test/agent-metadata.test.ts test/contracts.test.ts test/config.test.ts test/extension.test.ts test/classification.test.ts test/kernel.test.ts test/host-boundary.test.ts test/state-store.test.ts test/policy.test.ts test/verification-boundary.test.ts

# packages/coding-agent — Node26/macOS
node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2 test/suite/company-runtime-context.test.ts test/suite/company-runtime-lsp.test.ts test/suite/company-runtime-status.test.ts test/suite/company-runtime-timeout.test.ts test/suite/company-runtime-hardening.test.ts test/suite/company-runtime-observations.test.ts test/suite/company-runtime-approval.test.ts test/suite/company-runtime-r2.test.ts test/suite/company-runtime-quick.test.ts test/suite/company-runtime-workflow.test.ts test/suite/company-runtime-agent.test.ts test/suite/agent-session-prompt.test.ts test/suite/agent-session-runtime.test.ts test/suite/agent-session-model-extension.test.ts test/suite/agent-session-retry-events.test.ts test/suite/agent-session-queue.test.ts test/args.test.ts test/sdk-session-manager.test.ts test/session-manager/file-operations.test.ts

# 별도 Node22/macOS shell; 각 package root
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
# packages/company-runtime
node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2 test/project-context.test.ts test/list-files.test.ts test/config.test.ts test/policy.test.ts test/execution-contract.test.ts
# packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2 test/suite/company-runtime-context.test.ts test/suite/company-runtime-lsp.test.ts

# root / Node26
npm run check
python3 /tmp/weavra-v03d-smoke.741ncw/check-ci-bytes.py  # npm run check:ci + before/after source byte/mode comparison
git diff --check
bash -n packages/company-runtime/bin/weavra
```

- **Node v26.7.0/macOS 최종(20:50 KST 시작): Runtime 33개 파일·1,110개 + SDK/관련 Pi 19개 파일·628개 = 52개 파일·1,738개 PASS**, 실패/skip 0. 기존 1,646개 + 신규 unit/filesystem/config/JVM 69개 + SDK 23개이며 과거 결과를 합산하지 않는다.
- **Node v22.22.3/macOS targeted(20:52 KST 시작): 5개 파일·251개 + SDK 2개 파일·57개 = 7개 파일·308개 PASS**, 실패/skip 0. 위 set과 중복이므로 고유 tests 총수로 더하지 않는다.
- Snapshot valid/missing/directory/links/hardlink/protected/outside/invalid UTF-8/NUL/oversize/64 KiB boundary/deterministic CRLF·Unicode·freeze, list depth/order/count/output/enumeration/cancel/root denial/filter/explicit generated dirs, JVM positive/negative/case/risk semantics를 검증했다.
- SDK/faux로 Developer/Executor/Reviewer 동일 snapshot, actual list→anchored edit→checks→review→COMPLETE, READ_ONLY read/list 및 malicious instruction 권한 불변, 선택 파일 mutation 거부/hidden listing, snapshot 뒤 외부 변경 preflight 실패·실행 중 A 유지, 다음 run B, metadata/digest tampering 거부, none/legacy observation을 검증했다.
- V0.3A/B/C와 QUICK/STANDARD READ_ONLY/EDIT, R2/R3, Reviewer/stale review/cancel, setup/doctor/worktree/graph/viewer/lsp status/session isolation 회귀를 재실행했다.
- root check/check:ci/diff/bash **PASS**. check:ci 전후 **tracked 1,814개 경로와 non-ignored untracked source bytes/modes가 동일**했다. 초기 TypeScript 검사에서 test Context.systemPrompt의 optional narrowing과 readonly roots 타입 두 문제를 보완했다. 검사/의존성을 낮추지 않았으며 최종 warning/info/error는 없다. 자동 tests 실패는 없었다.

### 실제 Provider 1회와 발견 문제

- `node /tmp/weavra-v03d-smoke.741ncw/provider.mjs`로 임시 synthetic Git fixture에서 실제 **codex-lb/gpt-6-astra, medium, STANDARD/EDIT/R1** 한 run을 실행했다(20:35 KST). 원본 RC fixture는 읽기만 했고 config profile을 재사용했으며 product source를 worker에게 수정시키지 않았다.
- Developer에 391-byte AGENTS snapshot이 정확히 전달됐고 모델이 runtime_list_files를 선택했다. 그러나 **`{path:".",maxDepth:4}`**를 보내 literal-path Policy에서 **R0/DENY**됐다. Run `df979d42-907e-4ef4-8893-9b49251c42a2`는 FAILED, changedFiles=[], edits/checks/Reviewer 없음, lock 해제로 종료했다. 7,303ms, reported 1,448 tokens이며 실제 청구 비용은 미확인이다.
- `inspect.mjs`로 필요한 session tool arguments와 durable DENIED action을 별도 확인하고, fixture `git diff --exit-code HEAD --`로 tracked 무변경을 확인했다. 이를 실제 listing/filtering·anchored edit·Reviewer·checks·COMPLETED PASS로 확대하지 않는다.
- tool/schema description을 **`runtime_list_files({})`, OMIT path**로 명확히 하고 dot-root 거부 SDK/unit regression을 추가했다. `.`을 broader root alias로 자동 보정하거나 Policy를 완화하지 않았다. **요청된 1회 제한에 따라 Provider 재호출 없음.** 설명 보완 후 실제 성공 경로는 NOT VERIFIED다.
- 상세 결과는 [WEAVRA_V03D_PROVIDER_SMOKE_2026-09-17.md](WEAVRA_V03D_PROVIDER_SMOKE_2026-09-17.md)에 기록한다. credential/전체 conversation/reasoning/tool 로그는 문서에 복제하지 않는다. 개인 설정 bytes 비교 assertion은 smoke 성공 뒤에 배치되어 이번 실패 run에서는 미실행이므로 PASS로 기록하지 않는다.

### 제한·다음 작업·커밋

- shared context는 권한이 아니다. registered verifier/LSP의 직접 I/O, 외부 syscall races/daemon은 기존 비-sandbox 한계다. snapshot content는 Provider로 전달되므로 사용자 지침에서 secret을 제거해야 하며 임의 secret detection은 없다.
- `.gitignore` semantics, 여러 instruction files, auto-discovery/inheritance, directory-wide rules, Repo Map/workspace index는 미구현이다. entry/depth/root/bytes 한도로 결과를 생략할 수 있으며 잔여 수를 추정하지 않는다.
- 실제 Java/Spring/Maven/Gradle build matrix, Node22/Linux/GitHub Actions, full fresh install/build/TUI, 다른 Provider/OS는 NOT VERIFIED다. 전체 GPT RC-01~08·전체 upstream/e2e를 재실행하지 않았다.
- 최종 문서 반영 뒤 check/check:ci/diff/bash를 다시 실행해 자동 수정·warning/info/error 없이 PASS했다. tracked 1,814개 및 untracked source의 bytes/modes 불변을 재확인했다. 별도 검사로 변경 30개 파일, 문서 링크/fence, LOG-001~047 본문, V0.3C CI/contract와 Approval/Anchored/LSP transport/Graph/Launcher/Pi Core/dependency·HEAD/RC 태그 불변을 확인했다(PASS).
- 실제 smoke fixture의 tracked 무변경을 재확인한 뒤 생성한 임시 fixture/session/harness/검사 script만 정리하고 임시 루트 부재를 확인했다. 원본 사용자 RC fixture는 clean 상태로 유지됐다.
- **다음 작업:** 실제 Provider의 omitted-path 안내 효과 재검증은 별도 사용자 승인 후 한정 smoke로 수행한다. 자동 재시도·self-hosting·V0.3E/다른 후속 기능은 이번에 진행하지 않는다.
- **커밋·푸시·태그 변경:** 하지 않음. `weavra-v0.1-rc1`은 `183f85de1897d8b9f4fadb368a54e2b1390e5a84`로 유지한다.

---

## LOG-049 — V0.3D Project Context 커밋·푸시 준비

- **기록일:** 2026-09-17 21:09 (KST)
- **상태·목적:** 사용자 요청에 따라 LOG-048의 FIX-03/06 및 runtime_list_files 구현·테스트·문서를 커밋하고 `origin/devlop`에 게시한다.
- **변경 파일:** LOG-048의 instruction snapshot/metadata·list adapter·JVM Policy 연결, 기존 tool/digest contract tests와 신규 unit/SDK tests, README/roadmap/research/작업 이력/Provider smoke 문서 총 30개. 이번 준비에서는 현재 요약과 본 항목만 추가했다. dependency/lockfile 및 후속 기능 변경은 없다.
- **이번 검증:** `npm run check`, `npm run check:ci` 재실행 PASS, Biome 자동 수정 및 warning/info/error 없음. `git diff --check`, `bash -n packages/company-runtime/bin/weavra` PASS. status/변경 목록으로 대상 30개 경로와 기존 staged 변경 없음, HEAD 및 RC 태그 불변을 확인했다.
- **과거 검증과 구분:** Node26/macOS 52개 파일·1,738개, Node22/macOS 7개 파일·308개 PASS 및 source bytes 불변 검사는 LOG-048 당시 결과다. 이번 커밋 준비에서는 targeted tests/Provider/TUI/build를 재실행하지 않았다.
- **문제·해결:** 추가 문제 없음. 명시적 30개 경로만 stage하고 일반 commit/push를 사용한다. 실제 Provider 1회의 dot-root DENY/FAILED·무변경 사실과 설명 보완 후 성공 미검증을 그대로 포함하며 PASS로 바꾸지 않는다.
- **남은 제한·다음 작업:** omitted-path 안내의 실제 Provider 재검증, JVM build matrix/다른 환경 미검증 및 기존 비-sandbox 한계를 유지한다. 게시 후 로컬·원격 HEAD 일치, clean 및 RC 태그 불변을 확인한다. 강제 푸시는 하지 않는다.
- **커밋 상태:** 이 항목 작성 시 실행 직전. 메시지는 `feat(coding-agent): add Weavra project context and bounded file discovery`이며 최종 SHA·push 결과는 Git 이력과 최종 응답으로 보고한다. `weavra-v0.1-rc1`은 이동·수정하지 않는다.

---

## LOG-050 — V0.3D Provider Smoke Attempt 2: Runtime 완료 / path omission 미충족

- **기록일:** 2026-09-18 08:18 (KST), 실제 Provider 실행 08:12:52–08:13:28 KST.
- **상태·목적:** 현재 커밋의 보완된 tool guidance를 실제 Provider workflow 1회로 재검증했다. **Runtime COMPLETED, 요청한 acceptance FAILED(path omission)**다. 기능 추가·제품 코드 수정은 없다.
- **착수 확인:** `git status --short --branch` clean → `git fetch origin devlop` → clean 상태에서 `git rebase origin/devlop`(already up to date). HEAD/origin이 지정된 `6da0c5ce54c853e7147730c81acd3a080938dedc`임을 확인했다. LOG-049의 구현은 이미 이 SHA로 게시된 상태다. stash/reset/clean/checkout은 사용하지 않았다.
- **변경 파일:** `docs/WEAVRA_V03D_PROVIDER_SMOKE_2026-09-17.md`에 Attempt 2와 현재 판정을 추가하고, `docs/WORK_LOG.md`의 현재 요약과 본 항목을 갱신했다. Attempt 1 실패 및 LOG-001~049 본문은 보존한다. Runtime/Pi source·test·prompt/schema/Policy·dependency/lockfile 변경은 없다.
- **방법·fixture:** 삭제된 이전 임시 harness를 같은 의미로 재구성하여 private temporary Git fixture만 사용했다. AGENTS.md 391 bytes와 digest `sha256:f37326d5f0b61cc330a213fa58441007c48c6c8a3716b938f78ca7aa5822bd86`가 Attempt 1과 동일했다. goal은 `Fix the greeting typo in the allowed source file, following the selected project rules.` 그대로다. path 생략/`{}` 힌트나 모델 응답·인자 대체는 없다. STANDARD/EDIT/R1, allowed_paths=[src], required regression, 실제 codex-lb/gpt-6-astra·medium, macOS/Node26.7.0의 현재 Runtime TypeScript와 기존 built SDK를 사용했다.
- **실제 결과:** Run `7016de31-6da5-4468-b088-c49a3812b576`. Developer와 Reviewer가 각각 **`runtime_list_files({path:"src",maxDepth:1})`**를 호출하여 `src/greeting.js`만 받았다. Developer는 anchored read의 anchor/fileDigest를 그대로 사용해 `Helo`→`Hello` 한 곳만 수정했다. SELF_CHECK PASS/exit0 → 별도 read-only Reviewer PASS → TEST PASS/exit0 → fresh evidence로 COMPLETED였다. AGENTS/test/private marker·나머지 fixture 파일은 불변이다.
- **Instruction / independence:** 두 역할 prompt의 context block과 metadata가 동일 frozen snapshot과 정확히 일치했다. instruction은 실제 protectedPaths에 포함됐고 같은 Policy의 순수 read/list/edit probe는 모두 DENY였다(모델의 금지 호출은 아님). durable state에는 path/digest/bytes만 있고 7개 ALLOW/SUCCEEDED audit 모두 instruction digest에 결합됐다. Developer session `01a0b1a4-f323-7463-87cc-668af0851cb6`, Reviewer `01a0b1a5-3a3c-7463-87cc-668c581f363f`로 ID/파일이 다르다. Reviewer에는 mutation tools 없이 actual diff/check material·trusted refs가 전달됐으며 기존 independent review 계약을 통과했다.
- **정리·외부 불변 검증:** Worker abort/dispose 및 executor safeToRelease, verifier/workspace safeToRelease, writer.lock 부재를 확인했다. LSP는 미설정·미기동으로 서버 shutdown smoke가 아니다. smoke 전후 실제 제품 repo와 원본 RC fixture의 tracked bytes/modes·HEAD/branch/index/status, 개인 auth/models/settings bytes가 같았다. 이 비교는 실패 assertion 이전 finally에서 실행됐으므로 Attempt 1과 달리 이번에는 실제 확인된 결과다.
- **실행 명령·실제 판정:** `node /tmp/weavra-v03d-attempt2.DcdPtD/provider.mjs`는 Provider workflow 종료 뒤 omitted-path assertion에서 **exit 1**이었다. `node /tmp/weavra-v03d-attempt2.DcdPtD/verify.mjs`는 저장 요약만 읽어 path omission만 실패이고 나머지 15개 관찰 조건이 충족됨을 확인했다(**exit 0, Provider 추가 호출 0**). Runtime status를 FAILED로 덮어쓰거나 acceptance 조건을 완화하지 않았다.
- **사용량:** input 7,292 / output 679 / cache read 6,528 / cache write 0 / total 14,499 tokens. harness duration 35,702ms(model-runtime 준비·workflow/cleanup 포함). 실제 billing cost UNKNOWN.
- **문제·판단:** dot-root DENY는 재발하지 않았다. `path:"src"`는 허용된 narrowing이며 Policy 결함은 아니지만 요청한 `{}` 또는 maxDepth-only 경로를 검증하지 못했다. 전체 Provider smoke PASS로 기록하지 않고 추가 호출·제품 변경 없이 중단한다. path 없는 기본 discovery/별도 narrowed tool, root selector enum, default-roots 계약은 필요 시 별도 설계 후보이며 이번에 구현하지 않았다.
- **문서 검증:** 문서 갱신 후 `npm run check:ci` PASS(Biome 1,388개 파일, 자동 수정·warning/info/error 없음; TypeScript/deps/entry graphs/shrinkwrap/install-lock/browser smoke 포함), `git diff --check` PASS. `python3 /tmp/weavra-v03d-attempt2.DcdPtD/check-docs.py`로 변경이 unstaged 문서 2개뿐이고 untracked가 없으며, Attempt 1 본문·LOG-001~049 보존, 링크/fence·결과 수치, HEAD/RC 태그 불변임을 확인했다(PASS). 원격 CI 결과가 아니라 로컬 검사다.
- **남은 제한·다음 작업:** omitted-path의 실제 Provider 경로는 NOT VERIFIED다. 새 실행은 별도 승인 대상이며 self-hosting을 주장하지 않는다. GitHub Actions/Node22 Linux/fresh install/JVM build matrix·다른 Provider/OS·TUI/build/전체 suite는 이번에 실행하지 않았다. LOG-048의 Node26 52개 파일·1,738개와 Node22 7개 파일·308개 PASS는 과거 자동 회귀다. 임시 fixture/session/harness는 필요한 요약 보존 후 정리하고 임시 루트 부재를 확인했다. 전체 conversation/reasoning/tool logs와 credential 원문은 복제하지 않았다.
- **커밋·푸시:** 하지 않음. 사용자의 성공 조건부 docs commit 조건을 충족하지 않았다. 안정 태그 `weavra-v0.1-rc1`은 계속 `183f85de1897d8b9f4fadb368a54e2b1390e5a84`다.

---

## LOG-051 — V0.3D Attempt 2 evidence 커밋·푸시 준비

- **기록일:** 2026-09-18 08:48 (KST)
- **상태·목적:** LOG-050 결과를 보고한 뒤 사용자가 별도로 요청한 커밋·푸시를 진행한다. Runtime COMPLETED와 smoke acceptance FAILED(path omission) 판정은 변경하지 않는다.
- **변경 파일:** `docs/WEAVRA_V03D_PROVIDER_SMOKE_2026-09-17.md`, `docs/WORK_LOG.md` 두 개뿐이다. 이번 준비에서는 게시 승인에 맞춰 현재 요약과 본 항목을 갱신했다. Attempt 1/2 실행 결과 및 과거 LOG 본문은 보존하며 source/test/dependency/lockfile 변경은 없다.
- **착수·검증:** `git status --short --branch`에서 위 문서 두 개만 수정되고 staged/untracked 변경이 없음을 확인했다. `git fetch origin devlop` 후 HEAD/origin은 모두 `6da0c5ce54c853e7147730c81acd3a080938dedc`였다. 미커밋 문서가 있어 rebase/stash/reset/clean은 하지 않았다. `npm run check:ci` 재실행 PASS(자동 수정·warning/info/error 없음), `git diff --check` PASS.
- **과거 검증과 구분:** 실제 Provider 1회·사용량·cleanup·fixture/config 불변은 LOG-050 당시 결과다. 이번에는 Provider/targeted tests/TUI/build를 재실행하지 않았다. 로컬 check를 GitHub Actions PASS로 주장하지 않는다.
- **문제·제한·다음 작업:** 추가 문제 없음. omission 경로의 실제 Provider 검증은 NOT VERIFIED로 유지한다. 명시적 문서 두 경로만 stage하고 일반 commit/push 후 clean 및 로컬·원격 HEAD 일치를 확인한다. 강제 푸시는 하지 않는다.
- **커밋 상태:** 이 항목 작성 시 실행 직전. 메시지는 `docs(coding-agent): record Weavra V0.3D provider smoke attempt 2`이며 실제 SHA·push 결과는 Git 이력과 최종 응답으로 보고한다. `weavra-v0.1-rc1`의 peeled commit `183f85de1897d8b9f4fadb368a54e2b1390e5a84`는 불변이다.

---

## LOG-052 — 개발 하네스 전환: 현황 확인과 다음 단계 후보

- **기록일:** 2026-09-18 09:17 (KST)
- **상태:** 완료 (조사·기록만; 코드·테스트·Provider·build·TUI 실행 없음)
- **목적:** 개발 하네스를 Pi + `codex-lb/gpt-6-astra`에서 OMP + DeepSeek 4.1로 전환하기 전에 devlop 상태, fork-local 실행 환경, 남은 검증·미구성 항목을 확인한다.

### 확인한 현재 상태 (2026-09-18 09:17 KST)

- `git status --short --branch`가 `## devlop...origin/devlop` clean이다. HEAD `332e90b8f62d8f18d67ff2993b9a8bb6c5b196da`가 `origin/devlop`과 같다. 안정 태그 `weavra-v0.1-rc1`은 `183f85de1897d8b9f4fadb368a54e2b1390e5a84`로 불변이다.
- fork-local CLI bundle `packages/coding-agent/dist/bundle/cli.js`가 2026-09-16 17:35 build로 존재한다. `packages/coding-agent/src`의 마지막 변경은 upstream `46bde88a1`(2026-09-10)이고 V0.3C/V0.3D는 이 경로를 변경하지 않아 build staleness는 확인되지 않았다. Weavra Runtime은 checkout source(`packages/company-runtime/src`)에서 로딩된다.
- `~/.local/bin/weavra`가 checkout의 `packages/company-runtime/bin/weavra`를 가리킨다. Node는 v26.7.0(macOS arm64)이다.
- `~/.weavra/agent`에 `auth.json`(provider 키 `openai-codex`), `models.json`(custom provider `codex-lb`, `omlx`), `settings.json`, `sessions`가 있다. **DeepSeek provider/profile은 아직 구성되지 않았다.**
- `.github/workflows/ci.yml`(2026-09-17 갱신)이 존재하지만 실제 원격 Actions 실행 결과는 여전히 NOT VERIFIED다.
- Weavra Runtime 규모: `packages/company-runtime/src` TypeScript 43개 파일 약 9.4천 줄, `test` 35개 파일.

### 단계 진행 요약

V0.1 RC(수동 GPT RC-01~08) → Branding/fork-local launcher/Status → Worktree create/open/list → V0.2A/B/C → V0.3A/B/C까지 완료·게시됐다. V0.3D(FIX-03/06 + `runtime_list_files`)는 구현과 자동 회귀가 `6da0c5ce5`로 게시됐고, 실제 Provider smoke는 Attempt 2 Runtime COMPLETED에도 acceptance는 path omission 미충족으로 FAILED를 유지한다(LOG-050, evidence 문서 게시 `332e90b8f`). 다음 로드맵 단계는 V0.3E Task Contract(FIX-05/FEAT-01)와 V0.3F Measurement & Evidence다.

### 변경 파일

- `docs/WORK_LOG.md`의 현재 요약과 본 항목만 갱신한다. source/test/config/dependency/lockfile 변경은 없다.

### 이번 검증

- 문서 갱신 후 `npm run check:ci` 재실행: exit 0. Biome `Checked 1388 files`, 자동 수정 없음, warning/info/error 없음. pinned-deps/runtime-deps/ts-imports/entry-graphs/shrinkwrap/install-lock/tsgo/browser-smoke 포함.
- `git diff --check` exit 0, `git status --short`에서 변경은 `docs/WORK_LOG.md` 1개뿐이다.
- 코드·테스트·Provider·build·TUI는 이번 작업에서 실행하지 않았다(소스 변경 없음).

### 문제·해결

- 추가 문제 없음. 하네스 전환 자체는 저장소 변경을 요구하지 않는다. 개발 하네스(OMP + DeepSeek)와 Weavra worker profile(`.ai/config.yaml` + `~/.weavra/agent` provider)은 별개 계층이며, 후자는 현재 `codex-lb`/`omlx`만 구성되어 있다.

### 남은 제한과 다음 작업

- DeepSeek·다른 Provider/OS/Node 조합은 NOT VERIFIED를 유지한다. V0.3D omitted-path의 실제 Provider 검증도 NOT VERIFIED다. 원격 GitHub Actions/Node22 Linux/fresh install/JVM build matrix/전체 suite는 미실행이다.
- 다음 작업 후보(사용자 결정): (a) V0.3D omitted-path smoke 재시도(별도 승인), (b) V0.3E Task Contract 착수, (c) Weavra worker profile에 DeepSeek provider 구성·검증.
- **커밋:** 하지 않음.

---

## LOG-053 — CommandCode Provider 구성과 DeepSeek worker smoke

- **기록일:** 2026-09-18 (KST), 실제 Provider 실행 09:30–09:36 KST.
- **상태:** 완료 (user-level 설정 + 실제 Provider smoke; 제품 source/test/dependency 변경 없음)
- **목적:** 개발 하네스를 Pi + `codex-lb/gpt-6-astra`에서 OMP + DeepSeek로 전환하는 시점에, 같은 모델을 Weavra worker로 쓸 수 있도록 user-level 설정만으로 구성하고 실제 동작과 실패 모드를 확인한다.

### 계층 분리

```text
Development harness:        OMP
Development model/provider: DeepSeek V4.1 Flash via CommandCode Provider API
Weavra validation:          동일 (CommandCode Provider API)
Cross validation:           codex-lb / GPT-6 Astra (1회)
```

### 변경 파일

- repo 밖(user-level): `~/.weavra/agent/models.json`에 `commandcode` custom provider 추가(기존 `codex-lb`/`omlx` entry는 byte 단위 불변), `~/.weavra/cmd.env`(mode 600, `CMD_API_KEY`). 값 원문은 repo·문서·로그에 기록하지 않았다.
- repo: 신규 `docs/WEAVRA_COMMANDCODE_DEEPSEEK_SMOKE_2026-09-18.md`, `docs/WORK_LOG.md` 현재 요약·본 항목, `README.md`의 DeepSeek 표기. 제품 source/test/config/dependency/lockfile 변경 없음.

### 착수 상태

- `git status --short --branch`에서 미커밋 LOG-052(`docs/WORK_LOG.md`)만 있었다. stash/reset/clean은 하지 않았고 그대로 보존했다. HEAD와 origin은 `332e90b8f62d8f18d67ff2993b9a8bb6c5b196da`였다.

### 구성 전 확인과 결정

- Pi 내장 provider `deepseek`(base `https://api.deepseek.com`, auth env `DEEPSEEK_API_KEY`)와 catalog `deepseek-flash`는 존재하지만 이번에는 사용하지 않고, 사용자 지시대로 CommandCode를 `openai-completions` custom provider로 등록했다. 모델 ID는 `deepseek/deepseek-v4.1-flash`다.
- `models.json` schema는 `providers.<id>.{baseUrl,api,apiKey,models[]}`이고 `apiKey`는 `${ENV}` template을 지원한다. 그래서 secret 없이 `${CMD_API_KEY}` 참조만 기록했다.
- `CMD_API_KEY` 값은 사용자 승인 아래 OMP credential store(`~/.omp/agent/agent.db`의 `auth_credentials`)에서 `~/.weavra/cmd.env`로 옮겼고 어떤 출력에도 원문을 남기지 않았다.

### 실행한 검증과 실제 결과

1. ModelRuntime resolve/auth: `commandcode / deepseek/deepseek-v4.1-flash` provider·model 확인, `checkAuth`가 "configured API key"로 해석됨(apiKeyLength 92). 추가 Provider 코드는 만들지 않았다.
2. READ_ONLY 최소 smoke(QUICK/R0) 3회: 0/3 완료. A/A3는 `submit_handoff.task`에 task ID 대신 goal을 넣어 identity mismatch로 FAILED, A2는 identity는 맞았지만 `unresolved`가 비어 있지 않아 Kernel이 BLOCKED 처리했다. 세 run 모두 workspace 무변경.
3. EDIT smoke(STANDARD/R1, V0.3D 유사 fixture) 5회: 1/5 COMPLETED(B2). B1·B3은 보호된 `AGENTS.md` read가 Policy R0/DENY되어 FAILED(B1은 Reviewer, B3은 Developer), B4·B5는 identity mismatch로 FAILED. 편집이 이미 적용된 실패 run은 partialChanges=true로 남았고 자동 rollback은 없었다.
4. B2 COMPLETED 상세: anchored edit 1회로 `Helo`→`Hello`, SELF_CHECK PASS/exit 0, 독립 Reviewer PASS(trusted refs 2개 정확히 사용), TEST PASS/exit 0, `changedFiles=["src/greeting.js"]`·2줄, writer.lock 없음, session cleanup 확인.
5. 모든 run에서 `commandcode / deepseek/deepseek-v4.1-flash`, thinking `medium`, fallback 0, malformed tool call 0, Provider error/retry 0이었다. `runtime_list_files` 호출 8회 중 7회가 `{}`(path 생략)였고 V0.3D의 미충족 항목(path omission)이 별도 provider/run에서 확인됐다.
6. 교차검증(codex-lb/GPT-6 Astra, 동일 fixture·goal·config semantics) 1회: COMPLETED, 35,236ms, 9,751 tokens, tool error 0. DeepSeek B2와 최종 `src/greeting.js`가 byte-identical했다.
7. 표·관찰·판정 세분화·한계는 [smoke 문서](WEAVRA_COMMANDCODE_DEEPSEEK_SMOKE_2026-09-18.md)에 기록했다.

### 문제·해결

- 첫 실행은 fixture 설정 수정이 커밋되지 않아 preflight가 "Dirty workspace"로 거부했다. 설정을 커밋한 뒤 재실행했고, 이후에는 매 run을 fresh clone에서 시작해 이전 run의 `.ai` state가 다음 run을 오염시키지 않게 했다.
- identity mismatch는 consumable이 아니라 fatal이라 모델이 같은 session에서 정정할 기회가 없다. 반면 `unresolved` 검증 오류는 consumable로 재시도된다. 이 비대칭과 QUICK Executor prompt의 `unresolved` 안내 부재는 개선 후보로만 기록하고 이번에 제품 코드를 바꾸지 않았다.
- 추가 문제 없음. 실패 run도 모두 fail-closed였고 workspace 무변경 또는 partialChanges 보고가 실제 상태와 일치했다.

### 이번 검증

- 문서 갱신 후 `npm run check:ci` 재실행: exit 0. Biome `Checked 1388 files`, 자동 수정·warning/info/error 없음(pinned-deps/runtime-deps/ts-imports/entry-graphs/shrinkwrap/install-lock/tsgo/browser-smoke 포함).
- `git diff --check` exit 0, `bash -n packages/company-runtime/bin/weavra` exit 0, `git status --short`에서 변경은 `README.md`, `docs/WORK_LOG.md`, 신규 `docs/WEAVRA_COMMANDCODE_DEEPSEEK_SMOKE_2026-09-18.md`뿐이다.
- 제품 source 변경이 없어 자동 테스트·build·TUI는 이번에 실행하지 않았다. smoke의 실제 검증 내용은 위 "실행한 검증과 실제 결과"와 smoke 문서에 기록했다.

### 남은 제한과 다음 작업

- DeepSeek 공식 API, Linux Actions/Node22, fresh install, TUI/launcher 경로, LSP/JVM risk, R2/R3, self-hosting은 NOT VERIFIED다. 표본이 작아 완주율은 이번 조건의 관찰값이다. 실제 billing 비용은 UNKNOWN이다.
- QUICK/R0 handoff 처리(identity mismatch의 consumable 여부), QUICK Executor `unresolved` 안내, 보호된 지시 파일 read 안내는 제품 source/prompt 변경이 필요한 **미결정 사항**이며 이번에 코드를 바꾸지 않았다. `~/.weavra/cmd.env` 유지/삭제도 사용자 결정이다. 네 항목과 근거는 [smoke 문서](WEAVRA_COMMANDCODE_DEEPSEEK_SMOKE_2026-09-18.md)의 "열린 결정"에 기록했다.
- V0.3E Task Contract 구현은 이번 작업에서 시작하지 않았다. DeepSeek로 dogfooding하려면 위 오류 처리·prompt 개선을 선행하는 편이 실효적이라는 판단만 기록하며, 착수는 별도 승인 대상이다.
- **커밋:** 하지 않음 (LOG-052 포함 미커밋).

---

## LOG-054 — CommandCode smoke 문서 게시

- **기록일:** 2026-09-18 (KST)
- **상태·목적:** 사용자 요청에 따라 LOG-052·LOG-053과 README·smoke 문서를 커밋하고 `origin/devlop`에 게시한다. 판정과 결과는 변경하지 않는다.
- **변경 파일:** `README.md`, `docs/WORK_LOG.md`, 신규 `docs/WEAVRA_COMMANDCODE_DEEPSEEK_SMOKE_2026-09-18.md` — LOG-052(하네스 전환 확인), LOG-053(CommandCode 구성·smoke), 현재 요약, README의 DeepSeek 표기. 제품 source/test/config/dependency 변경은 없다.
- **이번 검증:** 게시 전 `npm run check:ci` 재실행 PASS(Biome 1,388 files, 자동 수정·warning/info/error 없음), `git diff --check` PASS, `bash -n packages/company-runtime/bin/weavra` PASS. 커밋 후 로컬/원격 HEAD 일치와 clean working tree, RC 태그 불변을 확인했다.
- **과거 검증과 구분:** 실제 Provider smoke 결과·사용량·cleanup은 LOG-053 당시 결과다. 이번 게시 준비에서는 Provider/targeted tests/TUI/build를 재실행하지 않았다. 로컬 check를 원격 CI PASS로 주장하지 않는다.
- **커밋·푸시:** `6c86bd5d6`(`332e90b8f` 위)로 게시했고 이 항목은 후속 커밋으로 게시한다. 정정: LOG-052·LOG-053 본문의 커밋 상태 표기는 작성 시점 기준이며 실제 게시 커밋은 `6c86bd5d6`다. 안정 태그 `weavra-v0.1-rc1`은 `183f85de1897d8b9f4fadb368a54e2b1390e5a84`로 불변이다. 강제 푸시는 사용하지 않았다.
- **남은 제한·다음 작업:** [smoke 문서](WEAVRA_COMMANDCODE_DEEPSEEK_SMOKE_2026-09-18.md)의 "열린 결정" 4항목(identity mismatch consumable 처리, Executor `unresolved`·보호 파일 read 안내, `cmd.env` 유지/삭제, V0.3E 착수)은 여전히 사용자 승인 대상이다.

---

## LOG-055 — Provider Compatibility Hardening (identity correction·Executor unresolved·instruction 보호 안내)

- **기록일:** 2026-09-18 (KST), 실제 Provider 실행 10:03–10:17 KST.
- **상태:** 완료 (제품 source 2개 + SDK suite test 2개 변경, 문서 갱신. **미커밋**)
- **기준 SHA:** `03994a6803919befe17944fcf704d1c0573bfa08` (착수 시 `git status` clean, fetch 후 로컬=원격). `weavra-v0.1-rc1`은 `183f85de1`로 불변.
- **목적:** CommandCode/DeepSeek 실제 smoke에서 확인된 provider-agnostic 안정성 문제 3건만 보완한다. V0.3E·AC·Plan Preview·schema 확장·권한 완화는 하지 않는다.

### 정확한 hardening 범위 (3건)

1. **Identity mismatch의 consumable 처리** (`packages/company-runtime/src/agent-tools.ts`)
   - `submit_handoff`: `runId`/`revision`/`task` mismatch, `submit_review`: `runId`/`revision`/`task`/`diffDigest` mismatch를 기존 `submissionValidationErrors` 메커니즘으로 분류한다.
   - 첫 제출은 **거부되고 accept/persist되지 않는다**. host는 값을 대신 고치지 않으며 partial/fuzzy/schema 완화도 없다.
   - tool error 메시지로 exact trusted identity를 안내하고 같은 session에서 정정·재제출만 허용한다. Kernel identity guard는 그대로 유지한다.
2. **QUICK Executor unresolved 안내** (`agent-runner.ts`)
   - shared `UNRESOLVED_GUIDANCE`로 Developer/Executor에 동일한 의미를 전달한다. Executor에는 "requirements[].status로 결과를 보고하고 unresolved는 genuinely unfinished work만"을 추가 안내한다.
   - Executor에 대한 obligation filter나 Kernel guard 변경은 없다(`Developer feedback does not rewrite QUICK Executor unresolved` regression 유지).
3. **Configured instruction 보호 안내** (`agent-runner.ts`)
   - `policy.projectInstruction`이 있을 때만 system prompt에 "이미 project context로 제공됐고 protected Runtime input이므로 read/search/list/LSP/edit/write/delete하지 말라"는 문장을 넣는다. inline instruction seam만 있는 경우에는 넣지 않는다.
   - Policy·protectedPaths·list hiding·권한은 변경하지 않았다. Policy DENY는 계속 fatal이다.

### 여전히 fatal인 것

Policy DENY(보호 경로 read 포함), 임의 mutation 거부, schema가 깨진 malformed 제출, provider error, cleanup 실패, Execution Contract/R2/R3 binding mismatch, approval 오류, unsafe workspace, mixed submit batch, natural-language 완료. `STALE_ANCHOR`의 consumable semantics도 그대로다. consumable 오류는 `maxTurns`/worker timeout 안에서만 재시도되며 별도 무한 retry 장치는 만들지 않았다.

### 변경 파일

- `packages/company-runtime/src/agent-runner.ts`: `UNRESOLVED_GUIDANCE`·`INSTRUCTION_PROTECTION_GUIDANCE` 추가, handoff 역할 공통 적용, configured instruction 안내 1줄.
- `packages/company-runtime/src/agent-tools.ts`: 두 제출 도구의 identity mismatch를 consumable로 분류 + 안내 메시지, `submit_handoff` description에 identity 필드 의미와 Executor unresolved 안내 추가.
- `packages/coding-agent/test/suite/company-runtime-agent.test.ts`: identity 정정 test(handoff 3, review 4), fatal 경계 test(Policy DENY, provider error), identity-loop bound를 turn-limit과 함께 검증, Executor prompt assertion.
- `packages/coding-agent/test/suite/company-runtime-context.test.ts`: configured instruction 보호 안내 assertion과 "instruction 없음" case.
- 문서: 이 항목, 현재 요약, [smoke 문서](WEAVRA_COMMANDCODE_DEEPSEEK_SMOKE_2026-09-18.md)의 "Provider Compatibility Hardening" 절, `README.md`의 DeepSeek 표기.

### 이번 자동 검증

```sh
# packages/company-runtime (전체)
node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2
# packages/coding-agent (Weavra + 관련 Pi 18개 파일)
node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2 test/suite/company-runtime-context.test.ts ... test/sdk-session-manager.test.ts

# root
npm run check
npm run check:ci        # 전후 tracked bytes 및 non-ignored untracked bytes 비교
git diff --check
bash -n packages/company-runtime/bin/weavra
```

- Runtime **33개 파일·1,110개 PASS**, coding-agent **18개 파일·607개 PASS**(합 51개 파일·1,717개, 실패/skip 0). identity 정정·fatal 경계·prompt regression 10개를 추가했다.
- `npm run check`/`check:ci` PASS(자동 수정 없음), `git diff --check`·`bash -n` PASS. `check:ci` 전후 tracked 1,823개 파일과 untracked bytes가 동일했다.
- 새 test가 실패한 적이 있었다: 공유 문구에서 "enforced by Kernel/Workflow"를 빠뜨려 R2 suite 5건이 깨졌고, 문구를 복원해 51개 파일 전체를 다시 PASS시켰다.

### 실제 Provider smoke (자동 test PASS 후)

- 환경: macOS/Node26.7.0, `commandcode / deepseek/deepseek-v4.1-flash`(thinking medium), 기존 `~/.weavra/agent/models.json`·`~/.weavra/cmd.env` 재사용·변경 없음.
- QUICK/R0 3회: q1·q2는 모델 상호작용 전 provider 오류(`Request timed out.`)로 FAILED, q3는 **COMPLETED**(8.4초, 7,112 tokens, handoff 1회·task ID·unresolved `[]`, checks PASS 2, workspace 무변경).
- STANDARD/R1/EDIT 3회: s1은 provider 오류로 FAILED, s2·s3은 **COMPLETED**(14.4초·21,564 tokens / 18.3초·25,566 tokens, anchored edit, 독립 Reviewer PASS, diff 2줄).
- hardening 후 DeepSeek run에서 identity mismatch·protected AGENTS.md read 시도·in-session correction이 모두 0건이었다. `runtime_list_files`는 `{}` 또는 `{maxDepth:…}`를 사용했다.
- GPT 교차검증 1회(`codex-lb/gpt-6-astra`, 동일 fixture·goal·config semantics): **COMPLETED**(32.7초, 10,292 tokens, 도구 오류 0, anchored edit). 최종 `src/greeting.js`는 DeepSeek s2·s3과 byte-identical.
- Before/After(샘플 수를 성공률로 해석하지 않음): QUICK 0/3 → 1/3 완료, STANDARD 1/5 → 2/3 완료.

### 문제와 해결

- provider 오류 3회는 전송/provider 계층 문제로 판단했다. 같은 시각 `curl`·plain `fetch`는 정상 200이었고 SDK 경로만 ~1.0–1.3초에 실패했다. 대기 후 재시도하면 성공했으며, run 직전 warm-up 요청 뒤 실행한 s2·s3·gpt1은 모두 완료됐다(인과관계는 미입증). 이번 hardening은 이 문제를 다루지 않으며 provider 오류 run은 모델 행동 실패로 계산하지 않았다.
- 세 hardening 범위 밖의 새 failure class는 발견되지 않았다.

### 남은 제한과 다음 작업

- DeepSeek 표본(QUICK 1/3, STANDARD 2/3)에는 provider 오류가 섞여 있어 안정성 추정으로 쓰기 어렵다. `unresolved`에 실제 blocker를 넣는 경로, 보호 경로 read 재현, R2/R3, LSP, 다른 OS/Node·원격 CI는 이번에 실행하지 않았다.
- 자동 회귀는 Node26/macOS만 실행했다.
- **커밋·푸시:** 하지 않음. 사용자 보고 후 결정한다. `weavra-v0.1-rc1`은 이동하지 않았다.
- V0.3E Task Contract는 이번 작업에서 시작하지 않았다.

---

## LOG-056 — Provider Compatibility Hardening 게시

- **기록일:** 2026-09-18 (KST)
- **상태·목적:** 사용자 요청에 따라 LOG-055의 hardening source/test/doc 7개 파일을 커밋하고 `origin/devlop`에 게시한다. hardening 판정·결과는 변경하지 않는다.
- **변경 파일:** `packages/company-runtime/src/agent-runner.ts`, `packages/company-runtime/src/agent-tools.ts`, `packages/coding-agent/test/suite/company-runtime-agent.test.ts`, `packages/coding-agent/test/suite/company-runtime-context.test.ts`, `README.md`, `docs/WORK_LOG.md`, `docs/WEAVRA_COMMANDCODE_DEEPSEEK_SMOKE_2026-09-18.md`. 이번 후속 항목에서는 현재 요약과 본 항목만 추가한다.
- **이번 검증:** 게시 전 `git status`로 대상 7개 경로만 수정되고 staged/untracked 변경이 없음을 확인했고, HEAD와 origin이 기준 SHA `03994a6803919befe17944fcf704d1c0573bfa08`임을 확인했다. LOG-055의 `npm run check`/`check:ci` PASS와 자동 회귀(Runtime 33개 파일·1,110개 + coding-agent 18개 파일·607개)를 근거로 하며, 이번 커밋 준비에서는 테스트·Provider·TUI를 재실행하지 않았다. 로컬 check를 원격 CI PASS로 주장하지 않는다.
- **과거 검증과 구분:** 실제 Provider smoke 결과·usage·cleanup은 LOG-055 당시 결과다.
- **커밋·푸시:** `72561d4f3`(`03994a680` 위)로 게시했고 이 항목은 후속 커밋으로 게시한다. 정정: LOG-055의 "커밋·푸시: 하지 않음"은 작성 시점 기준이며 실제 게시 커밋은 `72561d4f3`다. 강제 푸시는 사용하지 않았고 안정 태그 `weavra-v0.1-rc1`은 `183f85de1897d8b9f4fadb368a54e2b1390e5a84`로 불변이다.
- **남은 제한·다음 작업:** LOG-055의 남은 제한(작은 DeepSeek 표본, CommandCode 전송 flake, Node26/macOS 한정, R2/R3·LSP·원격 CI 미실행)을 그대로 유지한다. V0.3E Task Contract 착수는 별도 승인 대상이다.

---

## LOG-057 — V0.3E Task Contract (FIX-05 Acceptance Criteria + FEAT-01 Plan Preview)

- **기록일:** 2026-09-18 (KST), 실제 Provider 실행 11:12–11:14 KST.
- **상태:** 구현·자동 회귀·실제 Provider smoke 완료. **미커밋**(사용자 보고 후 결정).
- **기준 SHA:** `9e2cf9e8bfc6e011402a2598b6a1a93294a8214a`(착수 시 clean, 로컬=원격). `weavra-v0.1-rc1`은 `183f85de1`로 불변.
- **개발 하네스:** OMP. **개발 모델:** CommandCode/DeepSeek V4.1(같은 계층을 Weavra worker smoke에도 사용).

### Task Contract schema (V1)

```text
TaskContract         { id, goal, acceptanceCriteria[1..16], status }
AcceptanceCriterion  { id: "AC-001".., statement(<=500), scope{paths[]}, verification{checkIds[], reviewRequired} }
AcceptanceResult     { criterionId, status: MET|UNMET|UNVERIFIED, evidenceRefs[], revision, diffDigest }
```

- AC ID는 **Host가 순서대로** 부여한다(`AC-001`, `AC-002`, …). Worker는 ID를 만들거나 바꿀 수 없다. Kernel이 순차 형식·중복·누락을 검증한다.
- `scope.paths`는 설명·evidence binding용이며 **권한이 아니다**. mutation authority는 계속 Execution Contract/Policy/allowed_paths/R2/R3/Approval이다.
- `verification.checkIds`는 trusted config의 registered required check 부분집합이고(unknown check는 binding에서 거부), `reviewRequired`는 STANDARD=true / QUICK=false로 Host가 고정한다.
- `taskContractDigest = sha256(JSON({id, goal, acceptanceCriteria}))`. lifecycle `status`는 digest에서 제외해 시작/완료 전이에도 안정적이다. digest는 permission token이 아니다.
- Legacy `requirements: string[]` task/review/executor 결과는 `Legacy*Schema`로 읽기 전용 호환한다. **자동 migration/rewrite는 없다.** 새 live Run은 반드시 TaskContract이며, legacy Run은 observation에서 `Acceptance criteria: UNKNOWN (legacy)`로 표시하고 AC evidence를 만들어내지 않는다.

### Plan Preview(FEAT-01)와 QUICK/STANDARD 차이

- `/workflow run <goal>`은 classification/workflow/risk → AC 준비 → **Plan Preview 확인** → frozen contract 순서다. 별도 Planner LLM 호출은 없다.
- STANDARD는 `ctx.ui.editor()`로 "한 줄 = 한 criterion"을 확인·편집하고(초기값=goal), 빈/중복/16개 초과/500자 초과는 Host가 거부한다. QUICK은 editor 없이 `AC-001 = goal` 하나만 만들고 Preview에는 표시한다.
- Preview에는 goal/workflow/execution contract/risk/AC 목록(check·review mapping)/allowed paths/planned checks(trusted program·비-sandbox 경고)/roles/project instruction/LSP/no rollback·commit이 들어간다. **Plan 확인은 approval/permission token이 아니며 ApprovalRecord로 저장하지 않는다.** R3 삭제는 계속 별도 1회 Human Approval을 거친다.
- 취소(editor 취소/확인 거절/cancel)는 run·worker·check·approval을 만들지 않고 info/warning으로 보고한다(FAILED로 과장하지 않음).
- 확인 이후 contract는 frozen이다. Worker는 AC 추가/삭제/문장·verification 변경을 할 수 없고 tool에도 그런 API가 없다. Kernel은 완료 시 digest binding을 재검증해 다르면 `Task Contract changed after confirmation`으로 막는다.

### Evidence mapping / stale guard

- Executor handoff: `criteria[] = {criterionId, status, explanation}` — 모든 AC를 정확히 1회 cover(unknown/duplicate/missing은 consumable 교정 오류).
- Reviewer: `criteria[] = {criterionId, status, evidenceRefs}` — 같은 coverage 규칙 + trustedEvidenceRefs만 사용, PASS는 전 criterion MET + evidence 필수.
- 완료 guard는 (a) AC 정확히 1회·중복/unknown/missing 없음, (b) 모두 MET, (c) 각 AC `checkIds`가 SELF_CHECK/TEST에서 PASS evidence 보유, (d) current revision/diffDigest, (e) digest 일치를 요구한다. QUICK은 reviewRequired AC가 있으면 fail-closed다. AC 결과는 trusted 제출+verifier evidence의 **projection**(`run.acceptance`)이며 새 authority 저장소가 아니다.
- REVISE로 revision이 올라가면 이전 revision의 AC 결과/evidence/check를 재사용하지 않는다(fresh verification → fresh review → fresh AC). 기존 diff/check freshness guard와 동일 의미다.
- `/state`는 contract Run에 AC별 statement·status·evidence refs와 `Task Contract digest`를, legacy Run에 `Acceptance criteria: UNKNOWN (legacy)`를 출력한다.

### 변경 파일

- Runtime src: `contracts.ts`(AC/TaskContract/AcceptanceResult/legacy union/guard), 신규 `task-contract.ts`(Host builder·preflight·binding), 신규 `criterion-evidence.ts`(digest·ID 검증·AC projection), 신규 `plan-preview.ts`, `kernel.ts`(contract 생성·AC guard·projection), `workflow.ts`(frozen contract 필수·binding), `agent-tools.ts`/`agent-runner.ts`(criteria 제출·coverage 소비·prompt), `ports.ts`, `observations.ts`, `graph.ts`, `extension.ts`(Plan Preview UX). Kernel import graph는 `node:crypto`(결정적 pure module)만 추가 허용했다.
- 테스트: Runtime 신규 `test/task-contract.test.ts`(16개) + fixture 전면 이관, SDK suite 11개 파일 이관 + extension/observation case 추가. `Legacy*Schema` 호환은 `contracts.test.ts`가 계속 검증한다.
- 문서: `README.md`, `packages/company-runtime/README.md`, `docs/WEAVRA_ROADMAP_2026-09-17.md`, `docs/WEAVRA_IMPROVEMENT_AND_FEATURE_RESEARCH_2026-09-17.md`, 신규 [V0.3E smoke](WEAVRA_V03E_TASK_CONTRACT_SMOKE_2026-09-18.md), 본 항목. dependency/lockfile 변경 없음.

### 이번 자동 검증

```sh
# packages/company-runtime (전체)
node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2
# packages/coding-agent (Weavra suite 11개 파일)
node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2 test/suite/company-runtime-{context,lsp,status,timeout,hardening,observations,approval,r2,quick,workflow,agent}.test.ts

# root
npm run check
npm run check:ci
git diff --check
bash -n packages/company-runtime/bin/weavra
```

- Runtime **34개 파일·1,128개**, coding-agent **11개 파일·447개 PASS**(합 45개 파일·1,575개, 실패/skip 0). 신규·이관 test에 AC 미충족, missing/duplicate/unknown, stale revision/diff, digest 변조, QUICK review-required fail-closed, legacy UNKNOWN 표시가 포함된다.
- `npm run check`(Biome 1,394 files)·`check:ci` PASS(자동 수정 없음), `git diff --check`·`bash -n` PASS.
- 이관 중 드러난 원인도 기록한다: review/handoff/task fixture shape 이관, contract digest에서 `status` 제외(전이 시 불일치), Plan Preview 도입에 따른 extension/host stub·기대값 갱신, kernel graph에 추가된 `node:crypto` 경계 승인, criteria 미매핑(required check가 없는 fixture) 허용.

### 실제 Provider smoke

- commandcode / `deepseek/deepseek-v4.1-flash`, thinking medium, private Git fixture(AC-001 typo, AC-002 API·punctuation 보존, required regression check): **COMPLETED**. 21.5초, 34,144 tokens(Developer 26,087 + Reviewer 8,057), `AC-001`/`AC-002` MET(revision 0, diff/check evidence), Reviewer PASS(criteria 2개, 각 evidence refs), `taskContractDigest=sha256:932f6585…`. Developer는 anchored edit 1회(STALE_ANCHOR consumable 복구 1회 포함)로 typo만 수정했다.
- GPT 교차검증(codex-lb / gpt-6-astra, 동일 fixture·goal·문장, 1회): **COMPLETED**. 36.6초, 13,235 tokens, 동일 acceptance shape, digest `sha256:7fbd2c9c…`(contract id 상이). 두 run의 최종 `src/greeting.js`는 byte-identical(`d1633a9d…`).
- 이번 회차에는 provider transport 오류가 없었다. (직전 LOG-055에서 관찰한 CommandCode gateway flake는 별도 계층 문제이며 이번 결과에 포함하지 않는다.)
- 상세는 [V0.3E smoke](WEAVRA_V03E_TASK_CONTRACT_SMOKE_2026-09-18.md)에 기록했다.

### 남은 제한과 다음 작업

- 실제 Provider에서 "AC 하나 미충족 → COMPLETED 금지"는 deterministic automated fixture로만 검증했다(명시된 범위). R2/R3 live AC 흐름, QUICK Executor AC 제출의 live smoke, 다른 Provider/OS/Node, 원격 CI, JVM build matrix는 NOT VERIFIED다.
- Planner Agent·LLM AC 분해·병렬/COMPLEX·telemetry/eval/Evidence Pack/Budget/strict edit/verifier sandbox/browser/MCP/memory는 이번에 추가하지 않았다(다음 단계 범위).
- **커밋·푸시:** 하지 않음. 보고 후 사용자 승인을 따른다.

---

## LOG-058 — V0.3E Task Contract 게시

- **기록일:** 2026-09-18 (KST)
- **상태·목적:** 사용자 요청에 따라 LOG-057의 V0.3E 구현·테스트·문서 50개 경로를 커밋하고 `origin/devlop`에 게시한다. 판정·결과는 변경하지 않는다.
- **변경 파일:** 위 LOG-057의 Runtime src 4개 신규(`task-contract.ts`, `criterion-evidence.ts`, `plan-preview.ts`, `test/task-contract.test.ts`)와 src/test/doc 수정 44개, test helper 2개 신규(`test/fixture-contract.ts`, `test/suite/company-contract.ts`), 신규 smoke 문서 1개. 이번 후속 항목에서는 현재 요약과 본 항목만 추가한다.
- **이번 검증:** 게시 전 `git status --porcelain`으로 대상 50개 경로만 staged됨을 확인했고, HEAD와 origin이 기준 SHA `9e2cf9e8bfc6e011402a2598b6a1a93294a8214a`임을 확인했다. LOG-057의 자동 회귀(Runtime 34개 파일·1,128개 + coding-agent 11개 파일·447개 = 45개 파일·1,575개 PASS), `npm run check`/`check:ci`, `check:ci` 전후 tracked 1,823 files bytes 불변, `git diff --check`, `bash -n` 결과를 근거로 하며 이번 커밋 준비에서는 테스트·Provider·TUI를 재실행하지 않았다.
- **과거 검증과 구분:** 실제 Provider smoke(DeepSeek STANDARD/EDIT, GPT 교차) 결과는 LOG-057 당시 결과다.
- **커밋·푸시:** `5bc7f8a43`(`9e2cf9e8b` 위)로 게시했고 이 항목은 후속 커밋으로 게시한다. 정정: LOG-057의 "커밋·푸시: 하지 않음"은 작성 시점 기준이며 실제 게시 커밋은 `5bc7f8a43`다. 강제 푸시는 사용하지 않았고 안정 태그 `weavra-v0.1-rc1`은 `183f85de1897d8b9f4fadb368a54e2b1390e5a84`로 불변이다.
- **남은 제한·다음 작업:** LOG-057의 남은 제한(미충족 AC의 live 부정 경로, R2/R3 live AC 흐름, 다른 OS/Node·원격 CI·JVM build matrix, Planner/병렬/telemetry 등 후속 범위)을 그대로 유지한다.


---

## LOG-059 — V0.3F Measurement & Evidence (FEAT-03/04/05 + FIX-09)

- **기록일:** 2026-09-18 (KST), 실제 Provider 실행 11:40–11:42 KST.
- **상태:** 구현·자동 회귀·실제 smoke 완료. **미커밋**.
- **기준 SHA:** `6c81b21de9548306bd37982b32bcb55c7ec3598c`(착수 시 clean, 로컬=원격). `weavra-v0.1-rc1`은 `183f85de1`로 불변.
- **개발 하네스:** OMP. **개발 모델:** CommandCode/DeepSeek V4.1(Weavra worker smoke에도 동일).

### Measurement schema / usage semantics

```text
WorkerMeasurement { role, profile, revision, step, requested/actual provider+model, responseModel?, providerThinkingLevel?,
                    startedAt/finishedAt/durationMs, modelTurns, toolCalls, toolCallsByName, usage, outcome }
WorkerUsage       { source: "provider"|"unavailable", input, output, cacheRead, cacheWrite, totalTokens, reasoning? }
```

- source는 `AssistantMessage.usage`만 사용하고 추정하지 않는다. invocation 내 모든 assistant message를 합산하되 responseId/timestamp로 **중복 집계를 막고**, `reasoning`은 `output`의 subset이므로 total에 더하지 않으며 provider-reported `totalTokens`를 우선한다. 한 message라도 usage가 없으면 `source: "unavailable"`(부분합은 보존)이고 reasoning은 UNKNOWN으로 남긴다.
- UNKNOWN 규칙: reasoning/responseModel/thinking level 미제공, 가격 미확인, provenance 확인 불가는 0/`$0.00`이 아니라 `UNKNOWN`으로 렌더링한다. CommandCode custom model은 cost 0으로 등록돼 있어도 Evidence Pack은 항상 `Estimated cost: UNKNOWN`을 출력한다.
- requested와 actual(세션 provider/model, responseModel, thinking)을 분리하고, 존재하지 않으면 UNKNOWN이며 fallback은 그대로 드러난다.

### Budget semantics

- `budget: { max_worker_invocations?, max_reported_tokens? }`는 optional이다. **미설정 = configured unlimited**(기존 사용자를 제한하지 않음).
- `max_worker_invocations`는 정확히 사전 강제한다: 다음 호출 전에 `used+1 > max`면 모델 호출 전에 BLOCKED. `max_reported_tokens`는 provider-reported 기반이며 **billing hard cap이 아니다**: in-flight 초과는 기록 후 다음 호출을 차단한다.
- token budget이 설정됐는데 이전 usage가 unavailable이면 `Budget accounting unavailable`로 fail closed. token budget이 없으면 usage UNKNOWN 자체로 실행을 실패시키지 않는다.
- BudgetController는 telemetry exporter와 분리된 Kernel-owned ledger다(exporter 실패로 예산이 무제한이 되지 않음). Budget denial은 worker 실행 전에 발생하고 workspace를 mutate하거나 approval을 만들지 않으며, 기존 partial changes는 rollback 없이 보존된다.

### Telemetry / provenance

- `weavra.run`·`weavra.worker` 두 span만 정의했고(`WEAVRA_TELEMETRY_SCHEMA`), attribute는 workflow/risk/mode/role/revision/provider/model/status/duration/tool count/token 계열로 제한한다. prompt·completion·reasoning text·tool args/output·credential·env는 넣지 않는다. 기본은 NOOP이며 exporter 실패는 실행 결과를 바꾸지 않는다.
- provenance는 Run 시작 시 Host가 1회 snapshot한다: Runtime source checkout commit(모듈 위치에서 .git 탐색), fork-local CLI bundle의 SHA-256/mtime/version, target workspace HEAD(별도 값), config digest, Task Contract digest, capturedAt. 확인 불가 값은 저장하지 않고 UNKNOWN으로 렌더링한다. mtime을 commit으로 부르지 않는다.

### Evidence Pack

- 기존 Run state + live report의 **read-only projection**이다(새 authority/저장소 아님). status/goal/workflow/risk/execution mode, Task Contract digest와 AC별 statement·status·evidence refs, changed files/diff digest/changed lines, SELF_CHECK/TEST checks, LSP advisory 유무, Reviewer 결과·독립성, R3 approval, partial changes, cleanup confirmed/uncertain/UNKNOWN, worker measurement, budget 상태, provenance, limitations, failure category를 담는다.
- failure category는 **구조화된 신호만** 사용한다: budget exceeded → BUDGET, status CANCELLED → CANCELLED, approval DENIED/EXPIRED → APPROVAL, 실패/UNAVAILABLE required check → VERIFICATION, review REVISE/BLOCK → REVIEW, 그리고 runtime이 실제로 생성하는 exact 문자열(`Policy `, `Budget `, `Worker provider failed`, `Worker tool failed or was denied`, `Runtime storage failed`, cleanup unconfirmed)만 매핑하고 나머지는 UNKNOWN이다. lastError를 대규모 regex로 추론하지 않는다.
- `/state evidence [runId]`로 사람이 읽는 요약을 출력한다(기존 `/state export` 의미는 그대로). raw prompt/reasoning/credential은 포함하지 않는다.

### Eval adapter (FEAT-04)

- `packages/evals/src/weavra-harness.ts`: `materializeFixture`(격리 Git workspace + trusted config + required check), `runWeavraFixture`(실제 Runtime 경로: Task Contract → StandardWorkflow → PiAgentExecutor → Evidence Pack projection). 실제 provider 실행은 **opt-in**이며 자동 회귀에 넣지 않는다. Plain Pi baseline은 기존 `createPiCodingAgentHarness`를 그대로 쓴다(별도 mock 없음).
- `packages/evals/src/weavra-fixtures.ts`: deterministic fixture 6개(read-only 3: read-explain/read-discover/quick-read, QUICK edit 1: quick-edit, STANDARD 2: standard-2ac, standard-incomplete false-completion probe). oracle은 Host 소유로 workspace 파일 내용/부재를 직접 검사하며 Runtime COMPLETED 주장과 독립이다.
- eval metadata(baseline/runtime commit·provider·model·thinking·workflow·mode·contract digest·budget)와 repetition=1 원칙, 비용 UNKNOWN 원칙을 문서화했다. 실제 Plain Pi vs Weavra 비교 실행은 이번에 하지 않았다(quota 보호).

### 이번 자동 검증

```sh
# packages/company-runtime (전체)
node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2
# packages/coding-agent (Weavra suite 11개 파일)
node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2 test/suite/company-runtime-*.test.ts
# packages/evals (unit)
node ../../node_modules/vitest/dist/cli.js run --config vitest.test.config.ts
# root
npm run check / npm run check:ci / git diff --check / bash -n packages/company-runtime/bin/weavra
```

- Runtime **35개 파일·1,145개 PASS**, coding-agent **11개 파일·447개 PASS**, evals unit **5개 파일·32개 PASS**(합 51개 파일·1,624개, 실패/skip 0). 신규 test는 measurement 2·budget 5·provenance 1·evidence pack 5·eval adapter 4건이다.
- 구현 중 실제 결함 1건을 발견·수정했다: `contracts.ts ↔ measurement.ts` 순환 import로 Node ESM에서 `RoleSchema` TDZ 오류가 발생해 schema를 leaf 모듈(`measurement-types.ts`)로 분리했다.
- `npm run check`·`check:ci` PASS, `git diff --check`·`bash -n` PASS.

### 실제 Provider smoke

- DeepSeek(commandcode/deepseek-v4.1-flash, STANDARD/EDIT 2 AC, `budget.max_worker_invocations=4`): **1차 시도는 모델 상호작용 중 provider transport 오류로 FAILED**였고 measurement·partial changes 보존·BUDGET/PROVIDER 분류·provenance가 그대로 기록됐다. 재시도는 **COMPLETED**: Developer 13,466 tokens/8.4s/5 turns/6 tools, Reviewer 7,357 tokens/5.7s/2 turns/3 tools, budget 2/4 invocations·20,823 reported tokens, AC-001/AC-002 MET, Reviewer PASS(독립), checks PASS×2, cleanup confirmed, cost UNKNOWN.
- GPT 교차(codex-lb/gpt-6-astra, 동일 fixture): **COMPLETED**, worker measurement 2건·11,824 reported tokens·6 tool calls, 동일한 Evidence Pack shape. instrumentation이 기존 GPT 경로를 깨지 않았다.
- 상세는 [V0.3F smoke](WEAVRA_V03F_MEASUREMENT_EVIDENCE_2026-09-18.md)에 기록했다.

### 남은 제한과 다음 작업

- Plain Pi vs Weavra 실제 비교 실행, 20개 corpus 확장, repetition 반복, telemetry exporter/SaaS, LLM judge oracle, Planner/병렬/COMPLEX/strict edit/verifier sandbox/browser/MCP/memory는 이번 범위 밖이며 NOT VERIFIED다.
- provider-reported token 한도는 billing 정확도가 아니고, 가격은 어느 provider도 신뢰 가능한 출처가 없어 전부 UNKNOWN이다.
- **커밋·푸시:** 하지 않음. 보고 후 사용자 승인을 따른다.


---

## LOG-060 — V0.3F Measurement & Evidence 게시

- **기록일:** 2026-09-18 (KST)
- **상태·목적:** 사용자 요청에 따라 LOG-059의 V0.3F 구현·테스트·문서 27개 경로를 커밋하고 `origin/devlop`에 게시한다. 판정·결과는 변경하지 않는다.
- **변경 파일:** 신규 Runtime 8개(`measurement-types.ts`, `measurement.ts`, `budget.ts`, `provenance-types.ts`, `provenance.ts`, `telemetry.ts`, `evidence.ts`, `test/measurement-evidence.test.ts`), 신규 evals 3개(`weavra-harness.ts`, `weavra-fixtures.ts`, `test/weavra-harness.test.ts`), 신규 smoke 문서 1개, 수정 15개(contracts/kernel/workflow/agent-runner/config/ports/extension, README 2종, roadmap/research/WORK_LOG, `packages/coding-agent/test/suite/company-runtime-agent.test.ts`, `packages/company-runtime/package.json` + `package-lock.json`). 이번 후속 항목에서는 현재 요약과 본 항목만 추가한다.
- **dependency:** workspace 내부 `@earendil-works/pi-telemetry@0.85.1`를 devDependency로 추가했다(외부 dependency·새 exporter 없음). lockfile 변경이 포함되므로 커밋 시 `PI_ALLOW_LOCKFILE_CHANGE=1`을 사용했고 강제 push는 하지 않았다.
- **이번 검증:** 게시 전 `git status --porcelain`으로 대상 27개 경로만 staged됨을 확인했고 HEAD/origin이 `6c81b21de9548306bd37982b32bcb55c7ec3598c`임을 확인했다. LOG-059의 자동 회귀(Runtime 35개 파일·1,145개 + coding-agent 11개 파일·447개 + evals unit 5개 파일·32개 = 51개 파일·1,624개 PASS), `npm run check`/`check:ci`, `git diff --check`, `bash -n` 결과를 근거로 하며 이번 커밋 준비에서는 테스트·Provider를 재실행하지 않았다.
- **과거 검증과 구분:** 실제 Provider smoke(DeepSeek 1차 provider 실패·2차 COMPLETED, GPT 교차 COMPLETED)는 LOG-059 당시 결과다.
- **커밋·푸시:** `b6267e233`(`6c81b21de` 위)로 게시했고 이 항목은 후속 커밋으로 게시한다. 정정: LOG-059의 "커밋·푸시: 하지 않음"은 작성 시점 기준이며 실제 게시 커밋은 `b6267e233`다. 안정 태그 `weavra-v0.1-rc1`은 `183f85de1897d8b9f4fadb368a54e2b1390e5a84`로 불변이다.
- **남은 제한·다음 작업:** LOG-059의 남은 제한(Plain Pi 비교 실행·20 corpus 확장·repetition·외부 exporter·실제 가격·R2/R3 measurement/evidence·다른 OS/Node·원격 CI)을 그대로 유지한다.

---

## LOG-061 — V0.3F Hardening: 실패 measurement·budget 정합성·telemetry 격리

- **기록일:** 2026-09-18 (KST)
- **상태:** 구현·자동 회귀 완료. 실제 Provider 재실행은 하지 않았다(quota 보호). 커밋·푸시: 하지 않음(보고 후 승인 대기).
- **기준 SHA:** `9f80f0070`(clean, `origin/devlop` 일치). 안정 태그 `weavra-v0.1-rc1`은 `183f85de1897d8b9f4fadb368a54e2b1390e5a84`로 불변이다.
- **목적:** V0.3F의 measurement/telemetry/eval plumbing에서 확인된 5개 gap을 deterministic하게 닫는다. ① worker가 실제 호출된 뒤 실패하면 invocation count·measurement가 durable Run에 남지 않던 문제, ② Reviewer REVISE/BLOCK과 성공 후 검증 실패 경로의 measurement 유실, ③ telemetry 실패가 실행 결과를 바꾸거나 callback을 두 번 실행할 수 있는 구조, ④ `weavra.worker` start span에 requested provider/model 누락, ⑤ Provider 없이 eval adapter를 끝까지 통과하는 faux E2E 부재.
- **변경 파일:** `packages/company-runtime/src/kernel.ts`, `src/telemetry.ts`, `src/agent-runner.ts`, `test/measurement-hardening.test.ts`(신규, 9건), `packages/coding-agent/test/suite/company-runtime-agent.test.ts`(telemetry 2건), `packages/evals/src/weavra-harness.ts`(composition seam), `packages/evals/test/weavra-faux-e2e.test.ts`(신규, 1건), 본 항목과 [V0.3F smoke 문서](WEAVRA_V03F_MEASUREMENT_EVIDENCE_2026-09-18.md) 후속 절.
- **exactly-once settlement:** `advance()`가 `budgetReserved`/`budgetSettled`와 `measurementPatch`를 유지한다. `reserve`가 성공한 invocation만 settle 대상이고, 성공·실패·REVISE·BLOCK·완료 persist가 모두 같은 patch를 정확히 한 번 포함한다. 실패 path는 `WorkerExecutionError.measurement`가 있으면 그 measurement를, 없으면 `recordUnavailable()`을 기록해 0 token으로 위조하지 않는다. `finish()`는 trusted extra patch만 받고 `status`/`reviewHistory`/`approvals`/`tasks` 권한 필드는 그대로 덮어쓴다.
- **실패 measurement(failed worker measurement):** before — 실패한 invocation은 durable Run에 아무 흔적이 없었다(budget/workerMeasurements patch가 catch에서 버려짐). after — 실패 run에 `workerInvocations`, 실패 measurement(outcome FAILED·provider tokens), 원래 실패 사유가 함께 남는다. 검증 중 pre-fix 상태에서 신규 테스트 2건이 실제로 실패함을 확인하고 되돌려 after에서 9/9 PASS를 확인했다.
- **Reviewer REVISE/BLOCK:** REVISE persist와 revision-limit/BLOCK `finish()`가 Reviewer measurement를 포함한다. REVISE 1회 후 재구현·재리뷰 COMPLETED run에서 measurement 4건(100/50/100/50 tokens)과 budget 4 invocations·300 tokens가 중복 없이 남고, terminal BLOCK에서도 Reviewer measurement가 유지된다.
- **telemetry exactly-once:** `withSpan`은 `runOnce()`로 work callback을 최대 한 번만 시작한다. telemetry가 callback 전에 throw하면 work를 직접 1회 실행하고, callback 성공 후 flush/setStatus/setAttributes가 throw하면 성공 결과를 유지하며, callback 자체 오류는 telemetry 오류에 가려지지 않는다. callback을 호출하지 않고 끝난 adapter에서도 work가 유실되지 않는다.
- **weavra.worker 속성:** start span에 trusted config profile의 `provider`/`model`(requested)을, end attributes에 `actualProvider`/`actualModel`을 넣는다. suite 회귀에서 start attr 5개(role/profile/revision/provider/model)와 end attr의 actual identity를 실제로 확인했다.
- **Eval faux E2E:** `runWeavraFixture`에 test-only composition seam(`createAgents`)을 추가했다. 기본 경로는 그대로 `PiAgentExecutor`이고, 주입 시에도 StandardWorkflow/Kernel/`RegisteredVerifier`/StateStore/Evidence Pack은 실제 코드다. standard-2ac fixture가 faux 실행기만으로 Provider network 0회, `runtimeStatus COMPLETED`·oraclePass true·falseCompletion false·measurementPresent true·taskContractDigest 존재·Evidence Pack AC-001/AC-002 포함·reported tokens 240·tool calls 2로 통과한다.
- **정정(LOG-059):** LOG-059가 관찰한 실패 run의 16,409 tokens는 worker/session-level observation이며, V0.3F hardening 이전에는 실패 invocation measurement의 durable Run persistence에 gap이 있었다. 성공 경로의 판정·Evidence Pack 결과는 정정 대상이 아니고, 과거 evidence를 없었던 것으로 바꾸지 않는다.
- **이번 작업에서 실행한 검증:**
  ```sh
  # packages/company-runtime (전체)
  node ../../node_modules/vitest/dist/cli.js --run            # 36개 파일·1,154개 PASS
  # packages/coding-agent (Weavra suite 11개 파일)
  node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2 test/suite/company-runtime-*.test.ts  # 11개 파일·449개 PASS
  # packages/evals (unit, vitest.test.config.ts)
  node ../../node_modules/vitest/dist/cli.js run --config vitest.test.config.ts   # 6개 파일·33개 PASS
  # root
  npm run check / npm run check:ci / git diff --check / bash -n packages/company-runtime/bin/weavra  # 모두 exit 0
  ```
  합계 53개 파일·1,636개 PASS(실패·skip 0). 이번 작업에서 추가된 테스트는 Runtime hardening 9건, coding-agent telemetry 2건, evals faux E2E 1건이다. pre-fix 재현은 위 "실패 measurement" 항목에 기록했다.
- **Provider 재실행:** NOT RUN. 이번 범위는 Provider 호출 없이 deterministic하게 검증했고(§32/§33), DeepSeek·GPT quota를 사용하지 않았다. 실제 Provider 재검증이 필요한 새 문제는 발견하지 않았다.
- **남은 제한·다음 작업:** V1.0 release candidate polish, Plain Pi vs Weavra 실제 비교, 20개 corpus 확장, repetition 반복, telemetry 외부 exporter, 실제 가격/비용, R2/R3 measurement·evidence, verifier sandbox, Planner/병렬/COMPLEX, strict edit, browser/MCP/memory는 이번 범위 밖이며 NOT VERIFIED다. 실패 measurement는 provider-reported token 한도이며 billing 정확도가 아니다. `package.json`/`package-lock.json`은 변경하지 않았다.
- **커밋·푸시:** 사용자 승인 후 `6eb9c535b`(`9f80f0070` 위)로 게시했다. 이 항목의 게시 SHA 정정은 후속 문서 커밋으로 남긴다. 강제 push는 하지 않았고 `weavra-v0.1-rc1` 태그는 불변이다.

---

## LOG-062 — V0.3F Final Micro Hardening: cancellation race·telemetry return-value 격리

- **기록일:** 2026-09-18 (KST)
- **상태:** 구현·자동 회귀 완료. 실제 Provider 재실행 없음(NOT RUN). 커밋·푸시: 하지 않음(보고 후 승인 대기).
- **기준 SHA:** `eea796117ef44231a3c657f35d827992a759207c`(clean, `origin/devlop` 일치, rebase 불필요). 구현 기준은 `6eb9c535b`. 안정 태그 `weavra-v0.1-rc1`은 `183f85de1897d8b9f4fadb368a54e2b1390e5a84`로 불변이다.
- **목적:** V0.3F에 남은 edge case 2개만 닫는다. 이번 작업은 V0.4A가 아니다.
- **변경 파일:** `packages/company-runtime/src/kernel.ts`, `src/telemetry.ts`, `test/measurement-hardening.test.ts`(테스트 4건 추가), 본 항목과 [V0.3F smoke 문서](WEAVRA_V03F_MEASUREMENT_EVIDENCE_2026-09-18.md) 후속 한 절.

### A. result 반환 직후 cancellation race

- **before:** implement/review worker path가 `execute()` → `signal.throwIfAborted()` → `settleBudget(result.measurement)` 순서였다. Agent가 실제 invocation과 measurement를 반환한 직후, abort 재확인 지점에서 cancellation이 들어오면 measurement는 이미 소비됐는데 settle에 도달하지 못했고 catch에서는 `WorkerExecutionError`가 아니라서 measurement를 알 수 없었다. durable Run에는 invocation 1회만 UNKNOWN으로 남을 수 있었다.
- **after:** `execute()` → `settleBudget(result.measurement)` → `signal.throwIfAborted()` 순서로 바꿨다. implement·review 두 경계가 동일하다. 기존 exactly-once guard(`budgetReserved`/`budgetSettled`)는 의미 변경 없이 그대로 사용한다.
- **cancellation semantics 불변:** measurement가 보존돼도 result 수용은 아니다. aborted result는 handoff/review authority로 쓰이지 않고(`run.handoff`·`run.review` 없음), 다음 step·Reviewer invocation·COMPLETED로 진행하지 않으며 Run은 `CANCELLED`, partial changes는 그대로 두고 rollback도 하지 않는다.
- **Developer 경계 test:** fake executor가 정상 Developer result(fixture measurement 77 tokens)를 반환하면서 abort한다. 확인: `status CANCELLED`, `workerMeasurements.length 1`·`usage.totalTokens 77`, `budget.workerInvocations 1`·`reportedTokens 77`, 다음 Reviewer invocation 0회, handoff 없음, duplicate 없음.
- **Reviewer 경계 test:** implement·self-check를 정상 진행한 뒤 Reviewer가 정상 verdict+measurement(50 tokens)를 반환하면서 abort한다. 확인: `CANCELLED`, Developer 100 + Reviewer 50 = 2건 durable·`reportedTokens 150`·invocations 2, `reviewHistory` 0건·`completed` 0건(review verdict가 완료 authority가 되지 않음).
- **pre-fix 재현:** 순서를 되돌린 상태에서 신규 2건이 실제로 실패함을 확인하고 복원해 13/13 PASS를 확인했다. LOG-061의 기존 경로(실패 measurement durable, measurement 없는 실패는 UNKNOWN, REVISE/BLOCK, 성공 후 검증 실패)는 그대로 유지된다.

### B. telemetry adapter return-value 격리

- **before:** `withSpan()`이 settled 이후 `telemetry.startSpan(...)`의 반환값을 그대로 돌려줬다. adapter가 callback 결과 대신 다른 값(또는 `undefined`)을 반환하면 Runtime 실행 결과가 바뀔 수 있었다.
- **after:** authoritative 결과는 항상 work callback의 outcome이다. telemetry가 callback을 이미 실행했다면 work value를 반환하고 work error가 있으면 그 오류를 던진다(adapter 반환값은 사용하지 않음). adapter가 callback을 호출하지 않았다면 `runOnce()`로 정확히 1회 실행하며, telemetry/span/exporter가 throw·reject해도 work를 두 번 실행하지 않는다.
- **추가 test:** 변조 반환(`"tampered-result"`) → work 결과 유지·work 1회, `undefined` 반환 → work 결과 유지, callback 오류를 삼키고 성공값을 반환하는 adapter → 원래 work 오류 유지·work 1회. 기존 격리 test(callback 전 throw, settled 후 throw, span 메서드 throw, callback 미호출 adapter)는 전부 유지된다.
- **pre-fix 재현:** 기존 방식으로 어댑터 반환값을 쓰도록 되돌린 상태에서 신규 변조 test와 기존 settled-after-throw test가 함께 실패함을 확인하고 복원했다.

### 이번 작업에서 실행한 검증

```sh
# packages/company-runtime (전체)
node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2      # 36개 파일·1,158개 PASS
# packages/coding-agent (Weavra suite 11개 파일)
node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2 test/suite/company-runtime-*.test.ts  # 11개 파일·449개 PASS
# packages/evals (unit, vitest.test.config.ts)
node ../../node_modules/vitest/dist/cli.js run --config vitest.test.config.ts   # 6개 파일·33개 PASS
# root
npm run check / npm run check:ci / git diff --check / bash -n packages/company-runtime/bin/weavra  # 모두 exit 0
```

- 합계 53개 파일·1,640개 PASS(LOG-061 대비 +4). 신규 테스트는 Runtime cancellation race 2건·telemetry 격리 2건이다.
- `packages/company-runtime` 전체 suite와 Weavra suite를 동시에 돌린 1회차에서 Weavra suite 1건이 CPU 경쟁으로 실패했고(449개 중 1개), 동일 suite를 단독으로 2회 재실행하니 각각 11개 파일·449개 전부 PASS였다. 동시 실행 시점의 flake이며 이번 변경과 무관함을 단독 재실행 2회로 확인했다.
- Provider 호출 0회(DeepSeek·GPT NOT RUN). dependency·lockfile·config 변경 없음.

### 남은 제한과 다음 작업

- 이번 micro hardening은 cancellation race와 telemetry 반환값 격리만 다룬다. telemetry 외부 exporter, 실제 가격/비용, R2/R3 measurement·evidence, Plain Pi 비교, eval corpus 확장, verifier sandbox, Planner/병렬/COMPLEX는 여전히 NOT VERIFIED다.
- **다음 단계:** 이 작업이 clean하게 끝나면 V0.4A — Strict Mutation Hardening으로 넘어간다.
- **커밋·푸시:** 사용자 승인 후 `c95993b9f`(`eea796117` 위)로 게시했다. 강제 push는 하지 않았고 `weavra-v0.1-rc1` 태그는 불변이다. V0.3F는 이 커밋으로 종료되며 다음 단계는 V0.4A — Strict Mutation Hardening이다.

---

## LOG-063 — WORK_LOG current-state cleanup

- **기록일:** 2026-09-18 (KST)
- **기준 SHA:** `0ee163a3f64d0a019454660e9ca6d98561ece754`(clean, `origin/devlop` 일치, rebase 불필요). 안정 태그 `weavra-v0.1-rc1`은 `183f85de1897d8b9f4fadb368a54e2b1390e5a84`로 불변이다.
- **상태·목적:** docs-only 정리. `docs/WORK_LOG.md`만 수정했고 Runtime/source/test/config/package/lockfile은 건드리지 않았다. Provider 호출도 없다.
- **변경 내용:**
  - 현재 요약 표의 `V0.3F Final Micro Hardening` 행에 `|`가 하나 더 있어 4열처럼 깨져 있었다. LOG-062 결과와 선행 LOG-061 결과를 한 셀에 담아 정상 3열 행으로 복구했다. 수치(53개 파일·1,640개 / 1,636개)와 게시 SHA(`c95993b9f`)는 변경하지 않았다.
  - 표에서 `V0.3E Task Contract` 행을 `V0.3F Measurement & Evidence` 행 앞으로 옮겨 개발 순서(V0.3C → V0.3D → Provider Validation → Provider Compatibility Hardening → V0.3E → V0.3F → V0.3F hardening)로 읽히게 했다. 행 내용과 수치는 그대로다.
  - 표 아래의 stale 문단 "현재 작업은 **V0.3D — Project Context**…"를 현재 상태 요약으로 교체했다: V0.3A~V0.3F 완료, 다음 단계 V0.4A — Strict Mutation Hardening, RC 태그 불변, NOT VERIFIED 목록(remote GitHub Actions 실제 PASS·Plain Pi 반복 비교·20 fixture corpus·R2/R3 measurement/evidence smoke·OS/Node matrix·verifier sandbox·COMPLEX/parallel·browser/MCP/memory).
  - 같은 위치의 stale 계획 문장 2개만 정정했다. LOG-055 문단의 "V0.3E Task Contract는 별도 승인 전까지 시작하지 않는다"는 문장을 제거했고(이후 LOG-057·LOG-058에서 완료·게시), LOG-057 문단의 "구현·문서는 **미커밋**이며 사용자 승인 후 게시한다"는 실제 게시 커밋 `5bc7f8a43` 참조로 바꿨다.
- **보존:** LOG-001~062 본문과 판정·수치, V0.3D historical evidence(Attempt 1/2·acceptance FAILED·path omission NOT VERIFIED·default-root `{}` 후속 evidence), LOG-059~062 내용, RC 태그 사실은 삭제·재작성하지 않았다.
- **검증:** `git diff --check` clean, `git status --short`는 `docs/WORK_LOG.md`만, `git diff -- docs/WORK_LOG.md`로 변경 확인, `npm run check:ci`는 non-mutating으로 실행(exit 0). docs-only이므로 Runtime/Provider test suite는 재실행하지 않았다.
- **남은 제한·다음 작업:** 문서 표기 정리만 수행했으므로 코드·검증 상태는 LOG-062와 동일하다. 다음 단계는 V0.4A — Strict Mutation Hardening이다.
- **커밋 상태:** 하지 않음. 보고 후 사용자 승인을 따른다.

---

## LOG-064 — V0.4A Strict Mutation Hardening (FIX-07)

- **기록일:** 2026-09-18 (KST)
- **기준 SHA:** `62b9a38536effb3833f2e92b04adbeb56eedf744`(clean, `origin/devlop` 일치, rebase 불필요). 안정 태그 `weavra-v0.1-rc1`은 `183f85de1897d8b9f4fadb368a54e2b1390e5a84`로 불변이다.
- **환경:** 개발 하네스는 OMP + `commandcode/deepseek/deepseek-v4.1-flash`다. strict smoke도 같은 Provider를 사용했고 GPT cross는 지시대로 실행하지 않았다(Codex quota 보호).
- **상태:** 구현·자동 회귀 완료. 실제 Provider smoke는 stale recovery 동작까지 확인했고 COMPLETED 판정은 미확인(NOT VERIFIED). 커밋·푸시: 하지 않음.
- **config 결정:** 기존 schema style에 맞춰 최상위 `mutation: { mode: compatible | strict }`를 추가했고 **기본은 compatible**이다(`mutation` 필드가 없으면 compatible). trusted frozen config이며 `configDigest` 재료에 자연스럽게 포함되고 Run 중 hot switch가 없다. Plan Preview와 표시 문구에 `Mutation mode: …`를 추가했고 strict에는 "strict freshness/precondition enforcement … not a permission and not approval"이라고 명시한다.
- **read receipt 설계:** strict에서 `runtime_read({anchors:true})`는 기존 `fileDigest`/line anchor에 더해 adapter 발급 opaque token(`rr1:` + 24 random bytes)을 반환한다. `createWorkerTools`의 invocation-scoped `Map<path,{receipt,fileDigest}>`로 관리하며 같은 path를 다시 읽으면 이전 receipt가 무효화되고 최신만 유효하다. 성공한 create/replace/edit 뒤에는 그 path의 receipt가 삭제된다. receipt는 credential/permission/approval이 아니고 state/evidence/telemetry/audit prose에 raw token으로 저장하지 않는다(action digest 재료로만 쓰인다).
- **runtime_edit(strict):** path·oldText·newText·anchor·fileDigest·readReceipt를 모두 요구하고 하나라도 없으면 mutation 전에 거부한다. legacy exact-edit fallback은 없다. 검증 순서는 기존 Policy/audit authority 순서를 유지하며(입력 검증 → Policy/durable intent → receipt → filesystem digest/anchor/oldText/identity → write) Policy DENY가 stale 검사보다 앞선다.
- **runtime_write(strict):** `operation` 필수. `create`는 `mustNotExist:true` 필수(+receipt/digest 금지)이고 `O_CREAT|O_EXCL|O_NOFOLLOW`로만 생성하며 기존 파일 bytes는 그대로 둔다(parent mkdir 없음). `replace`는 fresh `readReceipt`+`fileDigest` 필수(+mustNotExist 금지)이고 대상 missing이면 생성하지 않는다. external race가 이기면 O_EXCL/ENOENT 실패로 끝나고 외부 bytes를 보존한다.
- **stale 분류:** `StaleMutationError extends StaleAnchorError`(receipt 불일치·mutation 후 재사용·digest generation 불일치·create 대상 존재·replace 대상 missing)를 추가했다. consumable stale은 `runtime_edit`/`runtime_write` 두 도구로 확장했고 Policy DENY·audit/storage 실패·malformed schema는 fatal로 유지한다. 새 retry loop는 만들지 않았다.
- **compatible 유지:** legacy `runtime_write` existing-file 교체와 unanchored unique exact edit가 그대로 동작한다. compatible에서 strict-only 필드(`operation`/`mustNotExist`/`readReceipt`/`fileDigest`)를 쓰면 명시적으로 거부한다(조용한 strict/legacy 혼용 방지).
- **prompt:** strict일 때 mutation 도구가 있는 역할에만 `STRICT_MUTATION_GUIDANCE`를 추가했다(receipt/digest/anchor 복사 금지 규칙·create/replace 계약·mutation 후 재-read·stale 시 재시도). compatible에서는 기존 ANCHORED_EDIT_GUIDANCE 안내만 유지한다.
- **자동 검증:**
  ```sh
  packages/company-runtime        node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2      # 36개 파일·1,186개 PASS
  packages/coding-agent           node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2 test/suite/company-runtime-*.test.ts  # 11개 파일·449개 PASS
  packages/evals                  node ../../node_modules/vitest/dist/cli.js run --config vitest.test.config.ts   # 6개 파일·33개 PASS
  root                            npm run check / npm run check:ci / git diff --check / bash -n packages/company-runtime/bin/weavra   # 모두 exit 0
  ```
  합계 53개 파일·1,668개 PASS(실패·skip 0). 신규 `test/strict-mutation.test.ts` 28건이 config 기본값/Plan Preview/receipt lifecycle(최신 1개·mutation 후 무효화·위조·다른 path)/strict edit positive·negative/replace digest precondition/create race(O_EXCL)·missing replace/existing create/compatible 회귀/CRLF·BOM·CJK·emoji·긴 줄·공백·한글 path를 검증한다.
- **실제 Provider smoke(strict):** `standard-2ac` fixture를 `mutation.mode: strict`로 실행하고, harness audit seam(`wrapAudit`, 제품 코드 아님)으로 **첫 mutation intent 시점에 정확히 한 번** 외부 변경(`Helo,` → `Helo!!,`)을 주입했다.
  - 1차: credential preflight 실패(`~/.weavra/cmd.env` 미로드, model interaction 0회) → 승인된 재시도로 간주하고 `cmd.env` 로드 후 재실행.
  - 2차(real interaction): `runtime_edit` → **`STALE_ANCHOR: file generation mismatch`** → 같은 worker session에서 모델이 "Hmm, stale anchor. Re-read." 판단 후 `runtime_read({anchors:true})` 재호출 → fresh receipt/digest로 `runtime_edit` **"File edited" 성공**. transcript(JSONL)로 확인했다.
  - 그러나 Run은 **BLOCKED**(self-check `FAIL exit 1`)로 끝났다. 주입한 `!!` punctuation을 모델이 보존해 최종 파일이 `Hello!!, ${name}!`이었고 fixture check(`greet("Ada") === "Hello, Ada!"`)가 실패했기 때문이다. 즉 실패 원인은 strict contract가 아니라 주입 내용의 모호성이다.
  - 결과: strict stale→re-read→retry 실동작 **확인**, COMPLETED까지의 end-to-end는 **미확인(NOT VERIFIED)**. Provider transport/model interaction 오류는 0건, reported tokens 37,688(Developer 1 invocation, 9 turns, 9 tools).
  - 다음 시도 제안(사용자 승인 필요): `Heelo,`처럼 교정 결과가 유일하게 `Hello,`가 되는 주입으로 1회 더 실행해 COMPLETED를 확인한다. 지시된 attempt 상한(2회)을 이미 사용했으므로 추가 실행은 승인 후 진행한다.
- **NOT VERIFIED:** strict COMPLETED end-to-end, R2/R3에서의 strict smoke, GPT cross(지시대로 미실행), external TOCTOU의 완전 해소(주장하지 않음), remote GitHub Actions 실제 PASS. V0.4A는 권한을 늘리지 않았고 Policy/R2/R3/approval/Task Contract/Verifier/Budget/cleanup 경계는 그대로다.
- **임시 파일:** smoke harness script(`packages/evals/smoke-v04a.mts`)와 진단용 keep-root 옵션은 smoke 종료 후 제거했고 커밋 대상이 아니다. 재사용 가능한 harness seam(`mutation`, `wrapAudit`)과 state.json 부재 시 오류 보존 수정만 남긴다.
- **커밋·푸시:** 사용자 승인 후 `bb909a59b`(`62b9a3853` 위)로 게시했다(13개 경로, 923 insertions). 강제 push는 하지 않았고 `weavra-v0.1-rc1` 태그는 불변이다.

---

## LOG-065 — V0.4A Final Hardening / Closure (FIX-07)

- **기록일:** 2026-09-18 (KST)
- **기준 SHA:** `7db4ac039135275a622517cf2bde8c5ddb3412bc`(clean, `origin/devlop` 일치, rebase 불필요). 구현 기준은 `bb909a59b`. 안정 태그 `weavra-v0.1-rc1`은 `183f85de1897d8b9f4fadb368a54e2b1390e5a84`로 불변이다. LOG-064의 역사적 smoke 결과(stale→re-read→retry 성공, fixture check FAIL, COMPLETED NOT VERIFIED)는 그대로 보존한다.
- **상태:** 구현·자동 회귀 완료, DeepSeek strict actual smoke **COMPLETED** 확인. 커밋·푸시: 하지 않음.
- **실제 root cause:** receipt registry가 `{receipt, fileDigest}`만 보관했다. ① valid receipt 뒤 target이 사라지면 anchored helper의 `assertPath`/`open` ENOENT가 typed stale로 변환되지 않고 generic filesystem error로 새어 나가 recoverable correction이 아니라 fatal로 분류될 수 있었다. ② digest는 내용 기준이므로 `unlink` 후 동일 bytes로 재생성하면 old receipt가 그대로 유효했다(파일 generation이 바뀌었는데도 통과). ③ strict create/replace content는 `bytes.toString("utf8") !== content` 수준만 검사해 NUL이 통과했다(기존 anchored read/edit는 `decodeAnchoredText`가 NUL을 거부).
- **filesystem identity 설계:** `AnchoredFileIdentity {dev,ino,mode,size,mtimeNs,ctimeNs}`를 같은 read fd에서 `before fstat → bounded bytes read → after fstat → path lstat` 순서로 캡처하는 `readAnchoredSnapshot()`을 추가했다(불안정하면 `STALE_ANCHOR`로 거부하고 receipt 미발급). strict receipt registry는 `Map<path,{receipt,fileDigest,identity}>`로 확장했고 identity는 Host-side에만 있으며 model에게는 기존처럼 `readReceipt`/`fileDigest`/anchor만 보인다(state/Evidence Pack/telemetry에 raw 저장 없음, permission/approval/credential 아님). strict effect는 열어 둔 fd의 identity와 expected identity를 비교해 다르면 `StaleMutationError`다.
- **missing/recreate stale:** `staleIfMissing()`으로 **ENOENT만** `StaleMutationError`로 변환한다(EACCES/EPERM/ELOOP/symlink·hardlink 위반/Policy DENY/audit·storage/unsupported·invalid encoding은 기존 fatal 유지). edit/replace의 초기 assert·open·pre-effect path 재확인 세 지점에 적용했고 replace는 missing에서 create로 fallback하지 않는다. deletion 뒤 동일 bytes 재생성은 content digest가 같아도 identity mismatch로 stale이며 외부 bytes를 보존한다.
- **NUL/text 처리:** `assertTextContent`가 `decodeAnchoredText(bytes)`(256 KiB·NUL·byte round-trip)와 `decoded === content`(unpaired surrogate 같은 lossy 입력)를 함께 요구한다. strict create/replace 모두 실패 시 target을 만들지 않고 원본 bytes도 유지한다.
- **추가 deterministic tests(8건):** 삭제된 edit target → consumable stale(`consumeStaleAnchorError` true), 삭제된 replace target → stale·missing 유지, delete+동일 bytes 재생성(edit/replace) → stale·bytes 보존, 재생성 후 fresh receipt로 정상 mutation, strict create NUL 거부·target 미생성, strict replace NUL 거부·원본 보존, lossy surrogate create/replace 거부. identity 검증을 끈 pre-fix 상태에서 재생성 stale 테스트 2건이 실제 실패함을 확인하고 복원했다.
- **자동 검증:**
  ```sh
  packages/company-runtime        node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2      # 36개 파일·1,194개 PASS
  packages/coding-agent           node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2 test/suite/company-runtime-*.test.ts  # 11개 파일·449개 PASS
  packages/evals                  node ../../node_modules/vitest/dist/cli.js run --config vitest.test.config.ts   # 6개 파일·33개 PASS
  root                            npm run check / npm run check:ci / git diff --check / bash -n packages/company-runtime/bin/weavra   # 모두 exit 0
  ```
  합계 53개 파일·1,676개 PASS(실패·skip 0). Weavra suite를 다른 suite와 함께 돌린 1회차에서 1건이 실패했으나 로그를 tail만 수집해 이름을 남기지 못했고, 단독 재실행 2회는 각각 449/449 PASS였다(LOG-062와 같은 동시 실행 flake 패턴). 기존 strict regression(latest receipt·mutation 후 무효화·위조/타 path receipt·외부 content 변경·O_EXCL create/replace missing·existing create·Policy DENY 우선·QUICK scope·Reviewer read-only)은 그대로 유지된다.
- **DeepSeek actual smoke(V0.4A closure):** 자동 회귀 PASS 뒤 1회. `commandcode/deepseek/deepseek-v4.1-flash`, strict STANDARD/EDIT `standard-2ac` fixture, harness audit seam으로 첫 mutation intent 시점에 **정확히 1회** external change(`Helo,` → `Heelo,`) 주입(제품 코드 변경 없음, credential은 `~/.weavra/cmd.env`를 호출 전에 로드).
  - 흐름(transcript 확인): `runtime_read anchors:true`(receipt A) → 외부 변경 → `runtime_edit`(A) → **`STALE_ANCHOR: file generation mismatch`** → 같은 session에서 `runtime_read anchors:true`(receipt B) → `runtime_edit`(B) → 성공 → post-mutation 재-read → `runtime_request_check` → `submit_handoff`.
  - 결과: **`runtimeStatus COMPLETED`**, `runtimeError null`, oraclePass true, falseCompletion false, changedFiles `src/greeting.js`, AC-001/AC-002 MET, self-check·test checks **PASS exit 0 ×2**, Reviewer **PASS**(독립 session), measurement present. Developer 29,779 tokens/16.2s/8 turns/8 tools, Reviewer 8,050 tokens/7.0s/2 turns/3 tools, 합계 37,829 reported tokens, provider 오류 0건, model interaction 1회(추가 재시도 없음).
  - 판정: **V0.4A strict actual E2E VERIFIED**(해당 fixture·Provider·STANDARD/EDIT 범위). 다른 모델/Provider, R2/R3·QUICK strict smoke는 NOT VERIFIED다.
- **NOT VERIFIED:** remote GitHub Actions 실제 PASS(YAML 존재를 PASS로 쓰지 않음), V0.4A strict의 R2/R3·QUICK actual smoke, 다른 OS/Node matrix, verifier sandbox, COMPLEX/parallel, browser/MCP/memory, external TOCTOU 완전 해소(주장하지 않음 — 마지막 identity 검증 syscall과 write syscall 사이의 비협조 외부 process race 한계는 그대로다).
- **임시 파일:** smoke script(`packages/evals/smoke-v04a.mts`)는 실행 후 제거했고 커밋 대상이 아니다. 재사용 가능한 harness seam(`mutation`·`wrapAudit`)만 남긴다.
- **커밋·푸시:** 사용자 승인 후 `5c15317c9`(`7db4ac039` 위)로 게시했다(6개 경로, 372 insertions). 강제 push는 하지 않았고 `weavra-v0.1-rc1` 태그는 불변이다. V0.4A는 이 커밋으로 종료되며 다음 단계는 V0.4B — Verifier Trust(FIX-08)다.

---

## LOG-066 — V0.4B Verifier Trust (FIX-08)

- **기록일:** 2026-09-18 (KST)
- **기준 SHA:** `971d4c30daf20ee6e92cf3d840098eb68fffd05f`(clean, `origin/devlop` 일치, rebase 불필요). 안정 태그 `weavra-v0.1-rc1`은 `183f85de1897d8b9f4fadb368a54e2b1390e5a84`로 불변이다. LOG-064/065의 역사적 결과는 그대로 보존한다.
- **상태:** 구현·자동 회귀 완료. 실제 Provider smoke는 strict trust `VERIFIED` 확인, COMPLETED는 미확인(NOT VERIFIED). 커밋·푸시: 하지 않음.
- **config 결정:** `verification.trust: { mode: compatible | strict }`(기본 compatible)와 check별 `trust: { files: [...] }`. trust.files는 workspace-relative literal·unique·최대 64개이며 built-in protected path는 지정 불가(config 단계에서 거부). trust 없음/`compatible`은 기존 동작 그대로이고, `strict`만 fail-closed다.
- **strict vs compatible:** compatible은 기존 registration/process/workspace/Policy semantics를 유지하고 trust metadata만 `UNVERIFIED`(또는 snapshot 실패 시 미기록)로 남긴다. strict는 ① frozen registration 일치 ② executable identity 일치 ③ direct/explicit source 일치 ④ exit 0 ⑤ cleanup confirmed ⑥ post-process source 일치 ⑦ workspace evidence current를 모두 요구한다.
- **trust snapshot 구조:** `verifier-trust.ts`가 direct argv source 해석(기존 protected-path heuristic과 동일한 helper)·explicit trust file 검증·source snapshot(`path`+`sha256`+`dev/ino/mode/size/mtimeNs/ctimeNs`)·executable identity snapshot(realpath)을 담당한다. content는 저장하지 않고 raw bytes SHA-256만 계산하며, 1 file 4 MiB·total 32 MiB·64 files 상한을 넘으면 strict preflight fail closed다. registration digest는 check id/kind/required/executable/argv/cwd/timeout/filtered env 표시/config digest/trust mode/source digest를 `weavra-verifier-registration-v1` 도메인으로 묶는다(raw credential 없음).
- **protected source resolution:** `resolveVerifierTrustSources`를 `PiAgentExecutor.create`와 `RegisteredVerifier.create`가 공유해 Worker protection 집합과 freeze 집합이 drift하지 않는다. explicit trust file은 missing/symlink/protected면 fail closed이고, direct argv 후보는 기존처럼 존재하는 regular file만 포함하며 없으면 plain argv literal로 남는다. 지정된 oracle은 Worker protectedPath가 되어 Developer/Executor의 수정·열람이 Policy DENY다(oracle protection이 allowed_paths보다 강하다).
- **pre/post 검증:** strict check는 process 직전에 executable+source를 재검증하고 stale이면 **process를 시작하지 않고** `FAIL`+trust `STALE`을 기록한다. exit 0이어도 process 직후 재검증이 stale이면 `FAIL`이며(자기수정 oracle 포함), result settle 직전에 한 번 더 확인해 settle 사이 변경도 stale로 만든다.
- **Kernel 독립 guard:** Host(workflow)가 strict Run의 CheckRequirement에 `trustRequired: true`를 고정하고, Kernel `assertVerification`이 required check에 대해 `PASS` + trust `VERIFIED`를 요구한다. custom/fake Verifier가 trust 없이 PASS를 반환하는 forged 결과는 completion authority가 되지 못한다(전용 test 포함). legacy CheckResult에는 trust가 없어 `UNKNOWN (legacy)`이며 자동 VERIFIED로 승격하지 않는다.
- **evidence:** CheckResult에 bounded trust metadata(mode/status/registrationDigest/executableDigest/sources[{path,digest}])를 추가했고 Evidence Pack은 `Verifier trust: VERIFIED (strict); registration sha256:…; trusted sources N` 형식으로, trust가 없으면 `UNKNOWN (legacy)`로 표시한다. Reviewer는 이 evidence를 읽기만 하고 trust를 새로 계산하지 않는다(권한 생성 없음). raw content/credential/env/절대 executable path는 공개 projection에 없다.
- **negative fixtures(false-PASS 금지):** trusted source mtime-only 변경 → pre-process stale·process 0회·FAIL / delete+동일 bytes 재생성 → stale·process 0회 / oracle self-modify + exit 0 → post-process stale·FAIL / frozen executable 교체 → stale·FAIL / forged PASS without trust → Kernel completion 거부 / config: unknown mode·duplicate·traversal·protected trust file 거부 / declared trust file missing·symlink → fail closed. `test/verifier-trust.test.ts` 13건이 이 경계를 덮는다.
- **자동 검증:**
  ```sh
  packages/company-runtime        node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2      # 36개 파일·1,207개 PASS
  packages/coding-agent           node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2 test/suite/company-runtime-*.test.ts  # 11개 파일·449개 PASS
  packages/evals                  node ../../node_modules/vitest/dist/cli.js run --config vitest.test.config.ts   # 6개 파일·33개 PASS
  root                            npm run check / npm run check:ci / git diff --check / bash -n packages/company-runtime/bin/weavra   # 모두 exit 0
  ```
  합계 53개 파일·1,689개 PASS(실패·skip 0). 기존 strict mutation·QUICK·R2·R3·approval·Task Contract·measurement/telemetry·cleanup 회귀는 그대로 유지된다.
- **실제 Provider smoke:** 자동 회귀 PASS 뒤 1회. `commandcode/deepseek/deepseek-v4.1-flash`, `standard-2ac`, `verification.trust.mode: strict`+`test/eval.test.mjs`를 trusted source로 고정하고 `allowed_paths: [src]`를 유지했다. Developer는 list → read `src/greeting.js` → edit → re-read → request_check로 진행했고 **self-check check가 `PASS` + `Verifier trust: VERIFIED (strict)`(registration sha256:4ccb3c21d72d7…, trusted sources 1)** 를 기록했다. 그러나 Reviewer가 protected oracle을 읽으려다 `Policy R0/DENY: Protected target`으로 FAILED했고(Reviewer CANCELLED), Run은 **FAILED**로 끝났다. 즉 **strict trust path는 실제 run에서 동작 확인**, COMPLETED 판정은 **NOT VERIFIED**다. 실패 원인은 V0.4B 결함이 아니라 protected oracle 열람에 대한 기존 Policy semantics + 모델 선택이며, 실패를 이유로 Policy나 strict를 완화하지 않았다. Provider 호출 1회(model interaction 1회), transport/provider 오류 0건, Developer 24,774 tokens·9 tools, duration 16.7s. 추가 재시도는 승인 후 진행한다.
- **남은 제한(NOT VERIFIED):** V0.4B smoke COMPLETED, transitive dependency(imports·package script·plugin·test framework) freeze, 다른 모델/OS/Node matrix, remote GitHub Actions 실제 PASS, V0.4B의 R2/R3 실제 smoke.
- **sandbox 아님:** network/filesystem isolation·seccomp·container는 V0.4C(FEAT-07)이며, 이번 단계는 registration/source integrity pinning이다. 마지막 검증 syscall과 write/execute 사이의 비협조 외부 process race 한계는 그대로다.
- **임시 파일:** smoke script(`packages/evals/smoke-v04b.mts`)는 실행 후 제거했고 커밋 대상이 아니다. 재사용 harness seam(`mutation`·`verifierTrust`·`wrapAudit`)만 남긴다.
- **커밋·푸시:** 사용자 승인 후 `b41843e68`(`971d4c30d` 위)로 게시했다(19개 경로, 955 insertions). 강제 push는 하지 않았고 `weavra-v0.1-rc1` 태그는 불변이다. 다음 단계는 V0.4C — Verifier Sandbox(FEAT-07)이며, V0.4B smoke의 COMPLETED 판정은 추가 Provider 시도 승인 시 이어서 확인한다.

---

## LOG-067 — V0.4B Final Trust Contract Closure (FIX-08)

- **기록일:** 2026-09-18 (KST)
- **기준 SHA:** `656fc19fe575eab324f4d12ce968bf7a8cd984e2`(clean, `origin/devlop` 일치, rebase 불필요). 구현 기준은 `b41843e68`. 안정 태그 `weavra-v0.1-rc1`은 `183f85de1897d8b9f4fadb368a54e2b1390e5a84`로 불변이다. LOG-066의 역사적 결과(Reviewer DENY로 FAILED)는 그대로 보존한다.
- **상태:** 구현·자동 회귀 완료, DeepSeek strict-trust actual **COMPLETED**. 커밋·푸시: 하지 않음.
- **actual root causes:** ① `registrationDigestOf`가 `env: "verification-filtered"` 고정 문자열만 넣어 실제 filtered env(PATH 등)가 registration digest에 binding되지 않았다. ② `executableDigest`가 `sha256:` + dev/ino/size/mtime 연결 문자열이라 실제 SHA-256이 아니면서 evidence에 sha256으로 표시됐다. ③ Kernel guard가 `trust.status === "VERIFIED"`만 확인해 custom/buggy Verifier가 임의 digest로 VERIFIED를 주장해도 통과할 수 있었다. ④ Reviewer가 protected oracle(`test/eval.test.mjs`)을 직접 읽으려다 Policy DENY로 run이 FAILED했다(LOG-066).
- **env digest design:** `registrationDigestOf` 입력에 `environment`(실제 process에 전달되는 `registration.env`)를 추가하고, `canonicalEnvironment()`가 `Object.entries` → key lexical sort → `[[key,value],…]`로 canonicalize한 값을 domain-separated SHA-256 입력에 넣는다. key 순서만 다른 env는 동일 digest, `PATH` 값이 다르면 다른 digest다. raw env 값은 CheckResult/Evidence Pack/WORK_LOG에 출력하지 않으며 `verificationEnvironment()`의 credential filtering은 그대로다.
- **executable digest design:** `executableIdentityDigest(snapshot)`가 realpath/dev/ino/mode/size/mtimeNs/ctimeNs를 `weavra-verifier-executable-v1` 도메인으로 SHA-256 해싱해 `sha256:<64hex>`를 만든다(전체 binary hash는 이번 범위가 아니다 — 고정 대상은 resolved executable filesystem identity). Evidence Pack/badge는 이제 실제 SHA-256만 sha256으로 부른다.
- **digest schema:** `VerifierTrustEvidenceSchema`의 registrationDigest/executableDigest/source digest와 CheckRequirement의 `trustRegistrationDigest`를 `^sha256:[0-9a-f]{64}$`로 좁혀 malformed digest가 schema 경계에서 거부된다(legacy CheckResult는 trust 자체가 optional이라 계속 `UNKNOWN (legacy)`).
- **Host expected trust binding:** `RegisteredVerifier`가 Run 시작 시 freeze한 snapshot에서 bounded accessor `trustRequirements`(id/kind/required/trustRequired/registrationDigest)를 제공하고, Workflow가 그 값으로 Kernel의 CheckRequirement를 만든다(모델/Verifier 결과가 expected digest를 결정하지 않음). Verifier.verify도 `request.checks`의 `trustRegistrationDigest`가 자신이 freeze한 값과 다르면 fail closed다.
- **Kernel guard:** strict required check는 `PASS` + `mode==="strict"` + `status==="VERIFIED"` + `trust.registrationDigest === expected.trustRegistrationDigest`를 모두 만족해야 completion authority가 된다. Kernel은 filesystem I/O나 재해싱을 하지 않고 Host-frozen 기대값과 evidence를 비교한다(동일 process 내 악성 custom Verifier에 대한 암호학적 격리는 주장하지 않는다 — V0.4C와도 별개다).
- **Reviewer/Worker guidance:** strict trust가 켜지면 Developer/Executor/Reviewer prompt에 “Verifier trust sources are Host-owned protected oracle inputs(: workspace-relative 목록, 최대 8개)” + do not read/search/list/LSP/edit/write/delete + “supplied CheckResult verifier-trust metadata·diff·verifier-owned review evidence만 사용, oracle을 직접 열지 말 것, Policy DENY는 예상된 결과이며 재시도 금지”를 추가했고, generic discovery 안내에도 “protected project instructions or verifier trust sources에는 적용되지 않는다”를 명시했다. **Policy는 완화하지 않았고 enforcement는 그대로다**(guidance가 enforcement를 대체하지 않는다).
- **deterministic regressions(신규):** env canonical/binding(PATH 변경 시 digest 변경, key 순서 무관), executable identity digest 형식 `^sha256:[0-9a-f]{64}$`·identity 변경 시 변경, strict VERIFIED evidence의 real digest 3종 + Host binding 일치, forged VERIFIED + wrong digest → Kernel `frozen verifier registration` 거부, malformed digest(`sha256:not-a-hash`) → schema 경계 거부, schema-valid VERIFIED + exact digest → trust guard 통과, Reviewer prompt guidance 4문구 존재 확인. 기존 tamper fixtures(pre-process mtime 변경, delete+동일 bytes 재생성, self-modify+exit 0, executable 교체, missing trust)는 그대로 유지된다.
- **자동 검증:**
  ```sh
  packages/company-runtime        node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2      # 36개 파일·1,213개 PASS
  packages/coding-agent           node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2 test/suite/company-runtime-*.test.ts  # 11개 파일·450개 PASS
  packages/evals                  node ../../node_modules/vitest/dist/cli.js run --config vitest.test.config.ts   # 6개 파일·33개 PASS
  root                            npm run check / npm run check:ci / git diff --check / bash -n packages/company-runtime/bin/weavra   # 모두 exit 0
  ```
  합계 53개 파일·1,696개 PASS(실패·skip 0).
- **DeepSeek actual smoke(closure):** 자동 회귀 PASS 뒤 1회. `commandcode/deepseek/deepseek-v4.1-flash`, `standard-2ac`, strict trust + `test/eval.test.mjs` 고정, `allowed_paths: [src]`.
  - Developer: list → read `src/greeting.js` → edit → re-read → `submit_handoff`(protected oracle 접근 0회, DENY 0회).
  - SELF_CHECK: `PASS` exit 0, `Verifier trust: VERIFIED (strict)`, registration `sha256:5ed65ff6512d6…`, trusted sources 1.
  - Reviewer: list → read `src/greeting.js` → `submit_review` → **PASS**(독립 session, oracle 직접 접근 0회, guidance 이후 재시도 없음).
  - TEST: `PASS` exit 0, `VERIFIED (strict)`, **self-check와 동일한 Host-frozen registration digest**.
  - Run: **`COMPLETED`**, `runtimeError null`, oraclePass true, falseCompletion false, changedFiles `src/greeting.js`, 8 tool calls, 22,515 reported tokens, 17.4s. Provider 오류 0건, model interaction 1회.
- **판정:** V0.4B **CLOSED** — strict verifier trust가 실제 Provider run에서 normal path COMPLETED로 확인됐다(해당 fixture·Provider·STANDARD/EDIT 범위).
- **남은 제한(NOT VERIFIED):** remote GitHub Actions 실제 PASS(YAML 존재를 PASS로 쓰지 않음), transitive dependency(imports·package script·plugin·test framework) freeze, R2/R3 strict trust actual smoke, 다른 모델/OS/Node matrix, sandbox(별도 단계), 마지막 검증 syscall과 execute 사이 비협조 외부 process race.
- **임시 파일:** smoke script(`packages/evals/smoke-v04bc.mts`)는 실행 후 제거했고 커밋 대상이 아니다.
- **커밋·푸시:** 사용자 승인 후 `96b1d8366`(`00207163e` 위, 원래 기준 `656fc19fe`)으로 게시했다(12개 경로, 350 insertions). push 직전 원격에 다른 세션의 docs-only commit `00207163e`가 있어 fast-forward가 거부됐고, 겹치는 파일이 없어 `git rebase origin/devlop`으로 재배치한 뒤 push했다(강제 push·stash·reset·clean 없음). `weavra-v0.1-rc1` 태그는 불변이다. V0.4B는 이 커밋으로 CLOSED이며 다음 단계는 V0.4C — Verifier Sandbox(FEAT-07)다.

---

## LOG-068 — Agent Landscape 후속 로드맵 통합

- **기록일:** 2026-09-18 (KST)
- **기준 SHA:** `010567711f35db9ce786d1f7bc57b61eb52d4fd1`에서 V0.4B closure 게시 상태를 확인한 뒤 docs-only 통합을 시작했다. 안정 태그 `weavra-v0.1-rc1`은 불변이다.
- **목적:** `WEAVRA_AGENT_LANDSCAPE_AND_ADOPTION_2026-09-18.md`의 C01~C08 제안을 기존 Post-V0.4B 로드맵에 실제 후속 순서로 반영한다. 외부 agent runtime을 중첩 실행하지 않고 현재 Kernel/Policy/Task Contract/Verifier/Evidence authority를 유지한다.
- **로드맵 결정:** 현재 즉시 다음은 **V0.4C Verifier Sandbox**다. 이후 **V0.5A C01 Task Context Pack → V0.5B C03 Task Recipes → V0.5C C02 Bounded Verification Repair → V0.5D C04 Impact-aware Review + C05 Versioned Documentation → V0.6A C07 T3 Code Host Bridge → V0.6B C06 Provider Contract/Fitness Matrix → V0.6C C08 Jev Browser Evidence → Facts/Capability Broker → COMPLEX/Parallel** 순서로 고정했다.
- **의존 원칙:** C02와 C08은 V0.4C 격리 경계를 선행한다. C01은 기존 list/read/search/LSP를 조합하는 bounded context부터 시작하고 별도 탐색 agent는 후속 검토다. C03은 새 Planner가 아니라 기존 Plan Preview/Task Contract의 reviewed template이다. C04/C05는 Reviewer 입력 품질을 보강하되 advisory evidence를 authority로 승격하지 않는다.
- **제품 방향:** T3 Code는 V0.6A의 우선 Host/UI이며 Runtime의 Completion/Policy/Approval authority를 갖지 않는다. C06은 자동 fallback/router가 아니라 Provider/model/endpoint/thinking/tool-schema 조합을 같은 fixture·budget·policy로 누적하는 지속 평가 track이다. C08은 local test app·isolated profile부터 시작하고 Jev의 DONE을 Weavra completion으로 사용하지 않는다.
- **문서 보정:** Agent Landscape 문서의 게시 당시 V0.4B actual COMPLETED 미검증 상태를 LOG-067 기준 **V0.4B CLOSED**로 보정했다. Roadmap의 단계 요약·의존 관계·즉시 다음 작업을 위 순서로 갱신했다.
- **변경 파일:** `docs/WEAVRA_ROADMAP_2026-09-17.md`, `docs/WEAVRA_AGENT_LANDSCAPE_AND_ADOPTION_2026-09-18.md`, 이 `docs/WORK_LOG.md`만 변경했다. 제품 코드·설정·package/lockfile은 변경하지 않았다.
- **게시:** Roadmap 통합 `f1e66f7288c7a33984e050fe5ab9af4849e87c40`, Agent Landscape 보정 `26815b6c83a92c419e8f336319da02fad41f2137`. Provider 호출·자동 regression은 docs-only 변경이라 실행하지 않았다.
- **남은 제한:** remote GitHub Actions 실제 PASS는 계속 NOT VERIFIED다. V0.4C 및 C01~C08은 이 문서 갱신만으로 구현/검증된 것이 아니다. 각 단계 착수 시 실제 HEAD·계약·지원 OS/Provider를 다시 확인한다.
- **다음 작업:** V0.4C — Verifier Sandbox(FEAT-07).

---

## LOG-069 — V0.4C Verifier Sandbox (FEAT-07)

- **기록일:** 2026-09-18 (KST)
- **기준 SHA:** `48fc6fb508414684a73171dee8209e2ca8d6b33c`(clean, `origin/devlop` 일치; 로컬은 `git rebase origin/devlop`으로 fast-forward). 안정 태그 `weavra-v0.1-rc1`은 `183f85de1897d8b9f4fadb368a54e2b1390e5a84`로 불변이다.
- **상태:** 구현·자동 회귀 완료, macOS actual sandbox 경계 PASS. Linux·DeepSeek sandbox smoke는 NOT VERIFIED. 커밋·푸시: 하지 않음.
- **backend 선택 근거:** `@anthropic-ai/sandbox-runtime`는 macOS에서 Seatbelt(sandbox-exec), Linux에서 bubblewrap을 쓰고 npm 기반이라 Node Runtime에 통합 가능하다. 실측으로 CLI(`bin.srt` → `dist/cli.js`), `-s/--settings`, argv 형태(`--`)를 확인했고 `-c`(shell string)는 사용하지 않는다. SRT 0.0.76은 Beta Research Preview이므로 Kernel/Verifier가 SRT API에 직접 의존하지 않고 **CLI argv + process supervision** 경계로만 통합했다.
- **dependency placement:** V0.4C production 주체는 `packages/company-runtime`이므로 그 패키지의 **runtime dependency**로 `"@anthropic-ai/sandbox-runtime": "0.0.76"`을 exact pin 했다(root devDependency `0.0.26`과 `packages/coding-agent/examples/extensions/sandbox`의 `0.0.26`은 Pi legacy example/tooling 용도로 **의도적 dual-version 유지**, 이번 scope에서 migration하지 않음). `package-lock.json`만 변경됐고(1 package added, 2 changed) `npm run check:shrinkwrap`·`npm run check:install-lock:coding-agent`는 **변경 없이 PASS**였다. license Apache-2.0, engines `node>=20.11.0`(현재 v26.7.0), lifecycle script 없음(`--ignore-scripts`로 설치).
- **SandboxPort 구조:** `packages/company-runtime/src/sandbox.ts` — ① `resolveSandboxBackend()`: 설치된 package.json에서 CLI entry를 resolve하고 **정확한 version(0.0.76)** 과 identity digest(`weavra-verifier-sandbox-backend-v1`)를 freeze. 불일치/missing은 `SandboxUnavailableError`. ② `canonicalHostPath()`: policy path를 realpath 기준 canonical로 고정(없는 tail은 가장 가까운 ancestor 기준). ③ `buildSandboxPolicy()`: Host-owned 고정 settings와 `policyDigest`(`weavra-verifier-sandbox-v1`) 생성. ④ `runSandboxedCheck()`: settings를 workspace 밖 Runtime temp에 0600으로 쓰고 `node <srt cli> -s <settings> -- <exe> <argv...>`를 기존 `runProcess`로 감싸 실행한 뒤 settings를 제거. Kernel/Policy/Task Contract 로직은 이 모듈에 없다.
- **config:** `verification.sandbox.mode: disabled | required`(기본 `disabled`, schema는 `additionalProperties:false`로 project가 network allowlist·backend path·profile을 설정할 수 없다). trust와 독립이며 기존 config는 동작 변화가 없다.
- **fixed policy:** network `{allowedDomains: [], deniedDomains: []}` = deny-all(loopback 포함), 파일시스템은 `denyRead`(HOME·protected·temp) → `allowRead`(workspace carve-out) → workspace 내부 protected(project instruction·`.git`·`.ai`·`.env`)은 더 구체적인 denyRead로 유지, `allowWrite`(workspace) + `denyWrite`(protected + **trusted oracle**) — SRT 문서 기준 denyWrite가 우선한다. 0.0.76에는 `allowAppleEvents`/`allowUnixSockets`/weaker-isolation 키가 없어 해당 완화 옵션 자체가 존재하지 않는다(없는 키를 발명하지 않았다).
- **canonical path 실측 조건:** `/tmp/...`(symlink) 경로를 settings에 넣으면 allowRead가 매칭되지 않아 workspace read까지 ENOENT로 차단됐고, `pwd -P`(`/private/tmp/...`)로 canonicalize하자 의도대로 동작했다. SandboxPort가 policy path를 Host에서 realpath로 freeze하는 이유이며, textual symlink path를 authority로 쓰지 않는다.
- **Kernel guard:** CheckRequirement에 Host-frozen `sandboxRequired` + `sandboxPolicyDigest`를 추가하고 `assertVerification`이 required check에 대해 `status === "ENFORCED"` + **digest 정확 일치**를 요구한다. ENFORCED 문자열만으로는 완료 불가이며, forged ENFORCED(wrong digest)·누락·malformed digest는 모두 거부된다(전용 test 4건).
- **자동 회귀:**
  ```sh
  packages/company-runtime        node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2      # 37개 파일·1,222개 PASS
  packages/coding-agent           node ../../node_modules/vitest/dist/cli.js --run --maxWorkers=2 test/suite/company-runtime-*.test.ts  # 11개 파일·450개 PASS
  packages/evals                  node ../../node_modules/vitest/dist/cli.js run --config vitest.test.config.ts   # 6개 파일·33개 PASS
  root                            npm run check / npm run check:ci / git diff --check / bash -n / check:shrinkwrap / check:install-lock:coding-agent   # 모두 exit 0
  ```
  합계 54개 파일·1,705개 PASS. 신규 `test/sandbox.test.ts` 9건(config 2·backend/policy digest 2·**macOS real boundary 2**·Kernel guard 4).
- **macOS actual 결과(darwin 27, sandbox-exec):** RegisteredVerifier를 sandbox required로 실제 실행한 integration test에서 `sandbox.status === "ENFORCED"` + Host-frozen digest 일치, 그리고 검증 대상 oracle 자신의 probe 출력으로 ① workspace source read 허용 ② `.env` read BLOCKED ③ Host 외부 sentinel read BLOCKED ④ symlink 경유 read BLOCKED(secret bytes 미출력) ⑤ **trusted oracle write BLOCKED**(bytes 불변) ⑥ Host 외부 write BLOCKED(파일 미생성) ⑦ `fetch`·raw `net.Socket`·child process 네트워크 **모두 BLOCKED**(loopback test server 요청 수 **0**)를 확인했다. 별도 symlink escape test도 통과했다. settings 파일은 실행 후 제거되며 기존 process cleanup/`cleanupConfirmed` semantics를 유지한다.
- **Linux:** bubblewrap backend는 이번 Host에서 실행하지 않았다 → **Linux actual sandbox NOT VERIFIED**(macOS 결과에서 추론하지 않음). Windows는 기존대로 미지원이다.
- **남은 제한:** ① SRT는 Beta Research Preview이고 이 단계는 container/VM 수준 격리가 아니다. ② transitive dependency·plugin·package script graph는 sandbox boundary가 아니다. ③ 마지막 검증 syscall과 execute 사이의 비협조 외부 process race 한계는 그대로다. ④ DeepSeek strict+sandbox normal smoke는 이번 increment에서 실행하지 않았다(NOT VERIFIED) — 다음 작업에서 1회 수행한다. ⑤ remote GitHub Actions 실제 PASS는 여전히 NOT VERIFIED다.
- **임시 파일:** 실측/탐침용 scratch(`/tmp/srtprobe*`)는 제거했고 저장소에는 남기지 않았다. `git status`는 의도한 변경만 포함한다.
- **커밋·푸시:** 사용자 승인 후 `4909b10e7`(`48fc6fb50` 위)로 게시했다(16개 경로, 817 insertions, `PI_ALLOW_LOCKFILE_CHANGE=1` 사용 — company-runtime runtime dependency 추가에 따른 `package-lock.json` 변경 포함, shrinkwrap은 변경 없음). 강제 push는 하지 않았고 `weavra-v0.1-rc1` 태그는 불변이다. 다음 단계는 V0.4C의 남은 확인(Linux actual, DeepSeek strict+sandbox smoke) 후 V0.5A — C01 Task Context Pack / Repo Map이다.

---

## LOG-070 — V0.4C Final Sandbox Contract Closure (FEAT-07)

- **기록일:** 2026-09-18 (KST)
- **기준 SHA:** `fe2d9ff380dfbd719c8b71e2e4d526b227924519`(V0.4C publication). 구현 기준 `4bb77a724`. 안정 태그 `weavra-v0.1-rc1`은 `183f85de1897d8b9f4fadb368a54e2b1390e5a84`로 불변이다.
- **상태:** V0.4C **CLOSED**(option 3 기준). macOS actual PASS, Linux actual **NOT VERIFIED**, remote CI PASS, DeepSeek strict+trust+sandbox actual **COMPLETED**. 커밋·푸시: 이 항목의 docs commit까지 포함해 게시한다.
- **oracle read conflict root cause(수정):** V0.4C 초기 구현은 `policy.protectedPaths`(Worker 보호 목록, trusted oracle 포함)를 그대로 sandbox `denyRead`에 넣어 실제 Workflow에서 verifier가 자기 oracle을 읽지 못할 수 있었다. 이제 Worker 보호와 sandbox read 경계를 분리한다 — exact-equal entry는 `denyRead`에서 제외하고 `denyWrite`에는 유지하며, trusted source가 non-trust protected ancestor(예: `test` 아래 `test/oracle.mjs`)나 built-in(`.git`/`.ai`/`.env`/project instruction) 아래에 있으면 `trusted verifier source conflicts with sandbox protected read boundary`로 fail closed한다.
- **policy digest completeness(수정):** domain `weavra-verifier-sandbox-v1`에 schema·backend{package,version,identityDigest}·**canonicalSettings 전체**(denyRead/allowRead/allowWrite/denyWrite/network를 sorted canonical form으로)를 bind한다. workspace·protected·trusted·backend identity 변경 시 digest가 바뀌고 순서만 바뀌면 동일하다(전용 test 4종).
- **backend identity revalidation(추가):** `validateSandboxBackend`가 CLI의 dev/ino/mode/size/mtimeNs/ctimeNs + identityDigest를 freeze snapshot과 비교한다. 실행 직전·직후·result settlement 전에 검증하고, 불일치면 SRT process를 시작하지 않거나 `sandbox.status = STALE` + check FAIL로 처리한다(replace/recreate fixture 포함).
- **OS backend preflight(추가):** `probeSandboxBackend`가 Host-owned temp settings + argv no-op(`node -e "process.exit(0)"`)으로 실제 backend 초기화를 확인한다. 실패 시 `SandboxUnavailableError`로 worker model interaction 전에 중단하며 unsandboxed fallback은 없다.
- **Kernel required-mode binding(수정):** required check는 `sandbox.mode === "required"` + `status === "ENFORCED"` + Host-frozen `sandboxPolicyDigest` 정확 일치를 모두 요구한다. mode disabled + ENFORCED + correct digest, wrong digest, missing, malformed digest는 모두 거부된다(전용 test 5종). Workflow가 `verifier.trustRequirements`의 sandbox 필드를 Kernel checks로 넘기지 않던 버그를 수정했다(이 버그 때문에 첫 smoke가 `Verification request changed registered checks`로 실패했다).
- **Plan Preview(수정):** `Planned checks (… verifier OS sandbox required)` / `not sandboxed`로 분기하고 `Verifier sandbox: required (network denied; Host-owned fixed policy; sources are protected from workers; not a sandbox)`를 표시한다.
- **upstream-sync blocker(별도 commit `4ad59528c`):** V0.4C와 무관하게 CI `Check (non-mutating)`이 `packages/ai` model catalog와 테스트 기대의 drift로 실패했다. parent `earendil-works/pi@main` 대비 최소 test delta만 동기화해 해소했고(context-overflow의 `mistralai/mistral-large`, z.ai effort metadata의 provider 범위, coding-plan 비용 기대), generator 재생성·`models.generated.ts` 직접 수정·CI hydrate 구조 변경은 하지 않았다.
- **CI-exposed LSP timing hardening(별도 commit `cc1d0da7c`):** 처음 전체 suite가 실행되며 `test/lsp.test.ts`의 `rejects workspace/applyEdit and unknown mutation requests…`가 runner에서 race로 실패했다(첫 `applied:false` event만 기다리고 `-32601`을 동기 검사). 두 응답을 한 `vi.waitFor`에서 기다리도록 수정했고 assertion·bytes 불변 검증은 그대로 유지, skip 없음. 대상 테스트 20회 반복 PASS.
- **macOS actual:** RegisteredVerifier sandbox-required 실 실행에서 workspace read 허용, `.env`/Host sentinel/symlink read deny, oracle read 허용·write deny, Host 외부 write deny, `fetch`/raw socket/child network deny(loopback 요청 0), cleanup confirmed.
- **Linux actual: NOT VERIFIED** (PASS로 표기하지 않음). runner에서 확인된 외부 blocker 2건 — ① `ubuntu-latest`: 제한된 unprivileged userns 때문에 `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`로 SRT 초기화 실패, ② `ubuntu-22.04`: bwrap은 동작하나 SRT 0.0.76 패키지에 vendored seccomp helper가 없어 `apply-seccomp: No such file or directory`(exit 127). host security 완화(privileged/sysctl/AppArmor off)는 사용하지 않았고, 경계 테스트는 backend가 실제 동작하는 플랫폼에서만 실행되며 그 외에는 로그에 `[sandbox] OS backend unavailable … actual boundary NOT VERIFIED`를 남긴다(결정론적 계약 테스트는 전 플랫폼 실행).
- **remote CI:** run `35326015858`(head `cc1d0da7c`) = **success** ✓ (`Check (non-mutating)`, `Test (isolated)`, `Launcher syntax`, `Tracked source unchanged` 모두 PASS). 전체 suite에서 company-runtime 1,227 중 sandbox 경계 3건만 NOT VERIFIED 사유로 skip되고 나머지 PASS.
- **DeepSeek actual E2E(closure):** `commandcode/deepseek/deepseek-v4.1-flash`, `standard-2ac`, STANDARD/EDIT + `mutation.mode: strict` + `verification.trust.mode: strict` + `verification.sandbox.mode: required`, trusted oracle `test/eval.test.mjs`, allowed path `src`.
  - self-check: **PASS** exit 0, `Verifier trust: VERIFIED (strict)`(registration `sha256:6b08713779b5a…`), `Verifier sandbox: ENFORCED (srt 0.0.76)`(policy `sha256:2ff874fc8bffb…`, network denied).
  - Reviewer: **PASS**(독립 session, oracle 직접 접근 0회).
  - test: **PASS** exit 0, trust/sandbox **self-check와 동일 digest** ✓.
  - Run: **`COMPLETED`**, `runtimeError null`, oraclePass true, falseCompletion false, 10 tool calls, 35,608 reported tokens, 22.9s.
  - Provider interaction: 3회 사용(1회는 위 workflow 버그로 실패, 1회는 Reviewer provider transport 실패, 1회 COMPLETED). provider 측 transport 실패는 제품 문제가 아님을 기록한다.
- **자동 회귀:** company-runtime 1,227 + coding-agent Weavra 450 + evals 33 = **54개 파일·1,710 PASS**, `npm run check`/`check:ci`/`check:shrinkwrap`/`check:install-lock:coding-agent`/`git diff --check` 모두 exit 0.
- **남은 제한(genuine):** SRT Beta Research Preview, VM/container 수준 격리 아님, transitive dependency graph는 sandbox boundary 아님, 비협조 외부 process TOCTOU 완전 제거 아님, Windows 미지원. Linux actual은 위 외부 blocker로 NOT VERIFIED다.
- **커밋·푸시:** 구현 `acfbac0fd`(그 앞의 `4ad59528c`·`25e100d43`·`ba2aa1709`·`301c8ad5d`·`fb0242a94`·`a3196b33d`·`8995e2228`·`cc1d0da7c` 포함), 문서 `aa43b9f9f`. 최종 HEAD(`aa43b9f9f`) remote CI run `35326933645` = **success**, 구현 HEAD(`cc1d0da7c`) run `35326015858` = **success**. 강제 push·tag 이동 없음.

---

## LOG-071 — V0.5A Task Context Pack / Repo Map Closure (C01)

- **기록일:** 2026-09-18 (KST)
- **기준:** V0.5A 시작 base `bbfe541d1`, 구현 chain `02184ff8a`→`fd4b82598`→`7cd64c7f4`→`d1cbea6e9`→`3cb0e5c7c`→`b2e17b09b`→`d2cb86a62`/`cf83a5fa5`→`9fecbb996`→`05a4c5d94`→`9bd1a5a63`→`dcf512183`→`8f1313acd`. 안정 태그 `weavra-v0.1-rc1`은 `183f85de1897d8b9f4fadb368a54e2b1390e5a84`로 불변이다.
- **상태:** V0.5A **CLOSED**. 모든 단계가 로컬 deterministic + remote CI + actual Provider 근거로 닫혔다.

### CI hydrate blocker와 Kimi fallback

- upstream models.dev에서 `kimi-for-coding` provider가 사라져 `Cannot hydrate missing providers: kimi-coding`으로 CI가 막혔다. parent main도 같은 live source에 의존하므로 단순 복사로는 해결되지 않았다.
- 해결: published `@earendil-works/pi-ai@0.85.1`의 `dist/providers/data/kimi-coding.json`을 **verbatim** tracked snapshot(`packages/ai/scripts/model-fallbacks/kimi-coding.json`)으로 두고, live source가 `kimi-coding` 모델을 하나도 만들지 못할 때만 그대로 emit한다(live 우선). provenance와 sha256을 README에 고정하고 테스트로 검증했다.
- validator: api group `anthropic-messages`, model.api 일치, provider `kimi-coding`, baseUrl 고정, name non-empty, input `text|image`만, cost 4종 finite·≥0, contextWindow/maxTokens > 0 — 위반 시 fail closed. strict missing-provider 의미는 `missingHydratedProviders()` pure helper로 추출해 **다른 provider는 여전히 실패**함을 로직으로 검증했다(테스트 7건).
- 재구성 emission이 `thinkingLevelMap`/`compat`을 잃어 catalog가 커밋본과 달라지던 문제를 발견해 snapshot **verbatim emit**으로 수정했다(`fd4b82598`).

### Context Pack 계약

- **48 KiB absolute cap**(canonical pack 전체, JSON overhead 포함): deterministic trimming priority(`acceptance-scope > changed-file > previous-review > lsp-reference > literal-reference > same-stem-test`, 동일 rank는 역 lexical), strict-decreasing unknown 축소로 무한 loop 제거, 초과 시 minimal pack으로 degrade, 그조차 불가하면 명시적 bounded error로 fail closed. stress fixture로 pre-trim > 49152 → ≤49152·truncated·유효 digest를 검증했다.
- **real LspPort**: drift interface 제거 후 `Pick<LspPort, "symbols" | "references">` 사용, symbol position(1-based UTF-16 line/column/endLine/endColumn, numeric kind) 보존, canonical 정렬로 server 순서 무관 digest, symbol 문서 ≤4·reference query ≤8, reference path는 policy/symlink/hardlink 재필터 후 `lsp-reference`, `AVAILABLE`/`PARTIAL(+truncated+unknown)`/`STALE(omit)`/`UNAVAILABLE`/`ERROR`/`withheld>0` 의미 구현, `ProcessCleanupError`·`cleanupFailed`는 fail closed(rethrow).
- **policy-first discovery**: `.env`/`.ai`/oracle/project instruction/symlink/hardlink/outside-root는 content 접근 전에 제외. listable allowed root가 없으면 honest empty pack.
- **TaskContextAgentExecutor**: 요청마다 현재 filesystem에서 pack 생성 → `request.taskContextPack` attach → inner 실행. Provider 호출·mutation·verification 없음, `safeToRelease` 위임. StandardWorkflow가 executor를 감싸 real/faux/eval이 같은 경로를 지난다(disabled면 wrapper 자체를 만들지 않아 기존 경로·타이밍 보존).
- **Developer seed**: AC scope paths(+revision 시 previousReview issues), scope 디렉터리는 listing root로 확장. **Reviewer**: AC scope + verification.changedFiles + handoff.changed_files로 **fresh rebuild**(Developer pack 재사용 없음; decorator 테스트에서 mutation 후 digest·snippet이 바뀜을 확인).
- **prompt**: bounded에서만 `taskContextPack` key 포함, advisory·non-authority guidance(“not permission/approval/evidence/mutation receipt/completion authority”, pack digest는 receipt 대체 불가), callback·signal·LSP·credential 미유출, 524288 cap 유지.
- **strict mutation non-authority**: pack `fileDigest`/`snippetDigest`/`digest`를 receipt로 위조하면 `runtime_edit`·`runtime_write replace` 모두 STALE, 정상 anchored read→receipt 경로는 성공(테스트).
- **measurement/evidence/plan**: `contextPack` optional summary(mode/digest/bytes/4 count/truncated)를 **실제 전달된 pack**에서 bind(SUCCEEDED/FAILED/CANCELLED 동일 보존, legacy 무필드 허용), Evidence Pack은 worker별 `context:` 한 줄만, Plan Preview에 `contextPackMode` 표기.
- **leakage**: SUPER_SECRET_VALUE/ORACLE_SECRET_MARKER/PROJECT_PRIVATE_MARKER가 pack·measurement·Evidence·Plan Preview·worker prompt의 pack section에 0건(project instruction 원문은 기존 Project Context section에만).
- **deterministic A/B**: faux worker로 disabled vs bounded를 production composition path로 실행 — authority·oracle 결과 동일, disabled는 pack 없음, bounded는 요약 존재(실측: 파일 1·bytes 323 수준의 작은 fixture), Provider token은 NOT APPLICABLE(가짜 절감률 없음).

### 검증

```sh
npm run hydrate:model-data / npm run build:offline            # PASS
packages/ai                                                  # 1,106 passed | 804 skipped, 0 failed
packages/company-runtime                                     # 1,262 passed
packages/coding-agent Weavra suites                          # 452 passed
packages/evals deterministic                                 # 34 passed
npm run check / check:ci / check:shrinkwrap / check:install-lock:coding-agent
git diff --check / bash -n packages/company-runtime/bin/weavra   # 모두 exit 0
```
- implementation HEAD `8f1313acd` remote CI run `35402182026` = **success**(Hydrate/Build/Check/Test/Launcher/Tracked source unchanged).
- **DeepSeek actual 1회**: `commandcode/deepseek/deepseek-v4.1-flash`, STANDARD/EDIT, `context_pack bounded` + `mutation strict` + `trust strict` + `sandbox required` → **COMPLETED**, oraclePass true, falseCompletion false, SELF_CHECK·TEST 모두 PASS + trust `VERIFIED` + sandbox `ENFORCED`(동일 policy digest), Reviewer PASS(독립, oracle 직접 접근 0), Developer/Reviewer measurement에 context summary 기록(`bounded sha256:5c94045b… | files 1 | symbols 0 | snippets 0 | bytes 323`), 28,025 tokens, 9 tool calls. retry 없음(1회).
- stable tag `weavra-v0.1-rc1` 불변.

### 남은 제한

heuristic relation discovery(complete dependency graph 아님) · persistent semantic index/AST graph 없음 · LSP unavailable 시 degraded context · Provider smoke는 fixture 1건이라 token/성능 개선을 일반화할 수 없음 · **Linux verifier sandbox actual은 계속 NOT VERIFIED**(runner 외부 blocker 2건, PASS로 표기하지 않음) · context pack은 QUICK에서 별도 actual smoke 미검증.

---

## 이후 항목 형식

```markdown
## LOG-NNN — 단계: 작업 제목

- 기록일: YYYY-MM-DD (시간대)
- 상태: 완료 / 진행 중 / 중단
- 목적:
- 변경 내용·파일:
- 검증 명령·결과: 통과 / 실패 / 미실행과 이유
- 문제와 해결:
- 남은 제한:
- 다음 작업:
- 커밋: 하지 않음 / 실제 커밋 ID
```

---
## LOG-073 - V0.5B: Task Recipes 구현 진행(B3~B8)과 미완 항목
- 기록일: 2026-09-19 (UTC+09:00)
- 상태: 진행 중(V0.5B CLOSED 아님)
- 목적: reviewed recipe를 production workflow에 연결하고, 검증·게시한 범위와 미완 범위를 실제 결과로 기록한다.
- 변경 내용·파일:
  - `packages/company-runtime/src/task-recipe-command.ts` + `test/task-recipe-command.test.ts`: `--recipe <id> <goal>` leading-flag parser. unknown/duplicate/누락/`=` 형태/unknown recipe는 run 생성 전에 거부하고, goal 안의 `--recipe`는 텍스트로 남긴다.
  - `packages/company-runtime/src/provenance-types.ts`, `provenance.ts` + `test/measurement-evidence.test.ts`: backward-compatible optional `recipe{id,version,digest}`를 run 시작 시 freeze. mid-run refresh 없음, malformed는 contract boundary에서 거부, legacy 무필드 record는 계속 유효.
  - `packages/company-runtime/src/extension.ts`, `task-recipes.ts`, `workflow.ts`, `plan-preview.ts` + `test/task-recipe-integration.test.ts`: `--recipe` 선택 → JSON editor 입력(data only) → `compileTaskRecipe` → 기존 AC 편집기 prefill → 사용자 수정 → `buildTaskContract` freeze → Plan Preview에 `Recipe: id@ver sha256:...` 표시 → `WorkflowOptions.recipe`로 provenance 전달. QUICK 선택은 AC 단계가 없어 fail closed.
  - `packages/coding-agent/test/suite/company-runtime-*.test.ts`: fixture 준비 게이트에 명시적 예산 부여(조건·lifecycle 순서 assertion 불변).
- 검증 명령·결과:
  - `npx tsgo --noEmit` PASS, `npm run check:ci` exit 0.
  - `vitest --run --root packages/company-runtime`: 1271 PASS(B4/B5 시점), 신규 `task-recipe-integration.test.ts` 6 PASS(4 recipe positive, manual/recipe authority 동등성, bounded preview, negative matrix, scope/check 안전, mode 불일치).
  - `vitest --run --maxWorkers=2 test/suite/company-runtime-*.test.ts`: 452 PASS.
  - `bash ./test.sh`는 **실패 상태**다. 전체 suite 동시 실행 시 `company-runtime-hardening`의 Reviewer 행 일부가 fixture 기동 게이트(`entered`)를 30초 예산으로도 넘기지 못한다. 실패 assertion은 전부 게이트이며 취소 순서 assertion은 실행되지 않았다. 부하 민감 문제로 좁혔으나 완전 해결은 아니다.
- 문제와 해결:
  - CI run 35427331553(head 2a3c0c41f) 실패 3건은 전부 게이트 라인(`hardening:628`, `r2:603`, `workflow:467`)이었고 로컬 단독 실행에서는 재현되지 않았다. `test.sh` 전체 실행으로 재현했고, 게이트 예산을 명시했지만 부하 조건에서 재발했다.
  - recipe fixture의 실제 field 이름(`behaviour`, `condition`, `baseline`, `coverage`, `observations`, `possible_causes`, `unknowns`, `requested_recommendation`)을 코드에서 확인해 테스트를 맞췄다. policy 밖 allowed path는 compiler가 거부(fail closed)함을 테스트로 고정했다.
- 남은 제한:
  - B7/B8의 확장 회귀(no Planner/no auto-discovery 증명, duplicate/missing flag matrix 일부)와 B9 full regression, B10 DeepSeek actual, B11 closure docs는 미완이다.
  - expected-failure TDD lifecycle은 구현하지 않았다. Linux verifier sandbox actual은 NOT VERIFIED.
- 다음 작업: B7/B8 회귀 확장 → B9 full regression → B10 DeepSeek actual(bugfix/STANDARD/EDIT/bounded/strict/strict/required) → B11 LOG-072 통합·README·Roadmap 마감.
- 커밋: `f704c67a8`(B3), `2a3c0c41f`(B6), `96fd2ee60`(게이트 예산), `674f4c654`(B4/B5). V0.5B는 CLOSED 아님.

---
## LOG-074 - V0.5B: B9 회귀 실행 결과와 B10 미실행
- 기록일: 2026-09-19 (UTC+09:00)
- 상태: 진행 중(V0.5B CLOSED 아님)
- 목적: B9 회귀 목록을 실제로 실행해 결과를 남기고, B10 actual Provider smoke의 실행 여부를 사실대로 기록한다.
- 검증 명령·결과(이번 항목에서 실행):
  - `npm run hydrate:model-data` exit 0
  - `npm run check` exit 0
  - `npm run check:shrinkwrap` exit 0
  - `npm run check:install-lock:coding-agent` exit 0
  - `git diff --check` exit 0
  - `bash -n packages/company-runtime/bin/weavra` exit 0
  - `npm run check:ci`는 같은 세션 앞선 커밋(`674f4c654`, `2c1909569` staging)에서 exit 0을 확인했다. B9 전체 체인의 `check:ci` 단계는 이번 항목에서 완주를 확인하지 못했다(미확인).
  - `bash ./test.sh`: **실패**. `company-runtime-hardening` Reviewer 행 중 일부가 fixture 기동 게이트에서 실패하며, 취소 순서 assertion은 실행되지 않는다(LOG-073의 부하 민감 문제와 동일).
- 문제와 해결:
  - B10 DeepSeek actual smoke는 **실행하지 않았다.** 이전 smoke는 `~/.weavra/agent/models.json`의 commandcode provider와 `~/.weavra/cmd.env`(mode 600, 사용자 승인 하에 source)로 실행했는데, 이번 세션에서는 해당 credential sourcing과 대화형 편집기/확인 단계를 구동하지 않았다. 따라서 recipe→Plan Preview→Task Contract→Developer/Reviewer/Verifier 경로는 actual Provider로 검증되지 않았고, provenance·oraclePass·falseCompletion도 actual run 기준으로 미확인이다.
- 남은 제한:
  - actual smoke 0회(이번 V0.5B 범위), Linux verifier sandbox actual NOT VERIFIED, expected-failure TDD lifecycle 미구현.
  - V0.5B CLOSED 조건 중 actual 관련 항목과 final CI 확인이 미충족이다.
- 다음 작업: B10 actual smoke(bugfix/STANDARD/EDIT/bounded/strict/strict/required) 1회 → 결과에 따라 LOG-072 통합 → final docs HEAD CI 확인.
- 커밋: 이 항목은 docs commit으로 게시한다. V0.5B는 CLOSED 아님.

---
## LOG-075 — V0.5B production recipe actual smoke

- 기록일: 2026-09-19 20:28 KST
- 상태: Phase 1 완료. V0.5B closure는 현재 회귀·최종 CI 확인 후 판정한다.
- 기준: fetch 후 local HEAD = origin/devlop = `2809b407dc7a706b6f6142ccbb059a21271fdc9a`, clean. 해당 SHA의 remote CI `35430230642`는 success다. 안정 RC 태그는 `183f85de1897d8b9f4fadb368a54e2b1390e5a84`로 불변.
- 방법: 기존 `standard-2ac` Git fixture와 실제 SDK를 재사용하되 eval runner가 아니라 `registerCompanyRuntime`에 등록된 `/workflow run --recipe bugfix <goal>` production handler를 호출했다. UI adapter가 recipe JSON editor → AC editor → plan confirm에 입력을 공급했다. 실제 터미널 keypress/overlay 검증은 아니며 Provider/worker/check/Kernel은 대체하지 않았다. fixture factory의 관찰용 YAML 대신 전체 normalized config를 fixture에 commit했다. 제품 코드는 변경하지 않았다.
- Provider/model/route: `commandcode` / `deepseek/deepseek-v4.1-flash` / `https://api.commandcode.ai/provider/v1`; 두 session JSONL의 thinking level은 `medium`. measurement의 provider-reported thinking은 UNKNOWN으로 유지한다. 기존 credential을 프로세스 환경에서만 사용했고 문서·fixture에는 기록하지 않았다.
- 실제 호출: workflow 1회, paid retry 0, fallback 0. 최초 임시 `.ts` driver는 CJS의 `jiti/static` export resolution에서 Provider 호출 전 실패했고 `.mts`로 실행해 해결했다. 이를 Provider 실패나 제품 run으로 세지 않는다.
- 입력/계약: reviewed bugfix의 reproduction/expected/preserve/regression을 실제 greeting typo에 맞춰 입력했다. generated AC 4개를 editor에서 최종 AC 3개로 수정·확인했다. 확인 전에 `.ai/state.json` 없음; durable Task Contract는 수정된 3개 AC, scope `["src"]`, checkIds `["eval"]`, independent review required만 포함했다.
- provenance: run `54a89a9a-a193-4491-93c7-a2ca458591c9`; recipe `bugfix@1`, digest `sha256:8eba00c5f95cbc75da431c17dc2c3ff7b3dfa0e251fc465b1bfc8408a6899cfe`. RunCreated 시 읽은 metadata와 종료 state가 동일하다. Task Contract digest `sha256:2b066ceea7ba526f1ea4c5d8dbf99fdd95f80a6bc32299d7f30ec3b2dbb0ffd0`는 별도다. recipe raw JSON을 provenance에 저장하지 않는다. 사용자가 확인한 AC 문장은 본래 계약/증거에 표시된다.
- 결과: Developer normal handoff → SELF_CHECK PASS → 독립 Reviewer PASS(3 AC MET) → TEST PASS → Kernel RunCompleted. `oraclePass=true`, `falseCompletion=false`. 변경은 `src/greeting.js`의 Helo→Hello 2줄뿐이며 Host oracle·private marker는 byte 불변, worker의 oracle 직접 read 0회다.
- strict mutation: 실제 anchored `runtime_read` → `runtime_edit`에 `anchor`, `fileDigest`, `rr1:` read receipt가 전달되어 성공했다. Reviewer는 read/list/submit_review만 호출했고 Developer와 session ID가 다르다.
- verifier: self-check/test 모두 strict trust `VERIFIED`, executable/source/registration identity 동일. registration `sha256:17d93da79165c7b9a054e60a227737890d6e2da8349dd66f3f42342556611cfd`; required sandbox `ENFORCED`, SRT 0.0.76, 동일 policy `sha256:aff32ad279615b06a6be454262f2da9847ddd652fb08011d7025ad0be715ec4b`. writer.lock 해제 확인.
- 측정: Developer 22,864 + Reviewer 9,608 = 32,472 reported tokens, 총 9 tool calls. 두 invocation 모두 bounded context. 한 fixture의 결과이며 Provider 전체 성공률·성능 개선으로 일반화하지 않는다.
- 문서 정정: LOG-073/074의 hardening readiness “30초로도 실패” 주장은 부정확했다. 실제 lifecycle matrix의 `vi.waitFor`는 여전히 기본 1초이며, 그 실패는 취소를 보내기 전 readiness 지점이다. 과거 실패 결과는 보존하지만 부하 원인 확정/30초 실패 해석은 철회한다. 현재 remote CI PASS와 새 local 전체 실행 결과를 별도로 기록한다.
- 제한: Linux sandbox actual NOT VERIFIED, expected-failure TDD lifecycle NOT IMPLEMENTED, built-in recipes만 지원, STANDARD-only recipe UX, common Host scope/check mapping(자동 narrowing 없음), recipe는 Planner/permission/approval/evidence/completion authority가 아니다.
- 다음 작업: Phase 2 현재 전체 회귀와 readiness 계약 확인 → Phase 3 closure. V0.5C는 아직 시작하지 않았다.
- 커밋: 이 항목을 Phase 1 증거 문서 commit으로 게시한다.

---
## LOG-076 — V0.5B 회귀 정합성 및 readiness 동기화

- 기록일: 2026-09-19 20:37 KST
- 상태: Phase 2 focused 검증 완료, 전체 local/remote 회귀 실행 중.
- 목적: 과거 timeout 진단을 실제 코드와 대조하고 production recipe 경로의 회귀 공백을 메운다. 새 Runtime 기능은 추가하지 않았다.
- 변경: `company-runtime-hardening.test.ts` lifecycle matrix의 Developer/Reviewer/approval readiness를 실제 pause callback이 resolve하는 promise로 동기화했다. 기본 1초 polling 의존만 제거했으며 test deadline·cancel/termination/dispose/terminal/unlock assertion은 유지한다. terminal-state marker는 `await save()` 이후로 옮겨 durable 저장 완료를 관찰한다.
- 현재 baseline local `bash ./test.sh`: hardening Reviewer의 switch/fork/tree 3행 실패를 재현했다. 모두 취소 전 readiness assertion이었다. 같은 baseline remote SHA `2809b407d` run `35430230642`는 PASS다. 과거 실패를 소급 PASS로 바꾸지 않으며 30초 timeout 실패/부하 원인 확정 주장은 LOG-075에서 정정했다.
- 회귀 보강: 신규 `company-runtime-recipe.test.ts`는 실제 command handler·UI adapter·faux SDK·Git·등록 verifier·Kernel을 통과한다. manual/recipe A/B, 4→2 AC 편집·freeze, independent Reviewer, Host scope/check, run-start provenance 불변, provider 호출 전 unknown/duplicate/missing flags·malformed/unknown-field input·mode mismatch·취소/decline 거부, PASS 문구가 있어도 실제 check FAIL이면 completion 불가를 검증한다. 실제 기존 실패 상태는 `BLOCKED`이며 FAIL check를 PASS로 바꾸지 않는다.
- 기존 `task-recipe-integration.test.ts`의 같은 literal contract 두 개를 비교하던 A/B 대용 assertion은 삭제했다. RuntimeConfig 강제 cast 대신 실제 parser를 사용하고 “unsafe roots를 drop”한다는 잘못된 주석을 수정했다. 4 recipe compile→contract positive는 유지한다.
- 실행 결과: recipe unit 3 files/13 PASS; production recipe + hardening 2 files/63 PASS; hardening 추가 반복 51 PASS(앞선 단독 포함 3회 51 PASS). `npm run check` PASS(1,429 files); hydrate:model-data, check:ci, check:shrinkwrap, check:install-lock:coding-agent, diff --check, launcher bash -n 모두 exit 0.
- 작업 중 test fixture 결함(미생성 worker directory, 기존 Kernel BLOCKED semantics를 FAILED로 기대)을 수정해 실제 계약에 맞췄다. Runtime 안전 계약은 바꾸지 않았다.
- 다음: 수정된 HEAD의 local full test 및 remote CI → Phase 3 별도 closure commit. V0.5C 미착수.
- 커밋: 이 항목과 테스트 변경을 Phase 2 commit으로 게시한다. 전체 회귀 결과는 closure 항목에 추가한다.

## LOG-077 — 2026-09-19 (Asia/Seoul) — V0.5B closure 회귀의 native watcher 검사 정정

**상태:** footer 단독 8 PASS, `npm run check` PASS. 전체 격리 회귀 재실행 중; 전체 PASS나 V0.5B CLOSED를 아직 선언하지 않는다.

- LOG-076 변경 이후 `bash ./test.sh`에서 company-runtime **45 files / 1,276 PASS**, deterministic eval **7 files / 34 PASS**. coding-agent는 **2,701 PASS / 1 FAIL / 50 skipped**였다. cancellation readiness 회귀는 통과했고, 실패는 기존 footer reftable native watcher 테스트의 `execFile` 호출 수가 정확히 1이 되기를 기다리는 조건이었다.
- 관찰과 추론 구분: 실제 오류 위치는 `footer-data-provider.test.ts`의 호출 횟수 대기였다. fs.watch와 watchFile의 비동기 통지는 하나의 변경에 대해 중복 refresh를 만들 수 있으므로 그 중간 호출 수는 소비자 계약이 아니다. 실패 실행에서 실제 호출 수는 출력되지 않아 중복 통지가 원인이었다고 확정하지 않는다.
- `packages/coding-agent/test/footer-data-provider.test.ts`에서 해당 구현 호출 횟수 대기·assertion만 제거했다. 실제 파일 변경, native watcher, 기존 3초 대기 한도, 최종 cached branch `foo`, branch-change callback 정확히 1회는 그대로 검증한다. skip·mock 전환·timeout 증대·runtime 기능 변경은 없다. 별도 deterministic debounce 검사는 유지한다.
- 현재 실행: footer 파일 **8/8 PASS**, `npm run check` PASS(1,429 files, 변경 없음). 수정 후 전체 `bash ./test.sh`는 진행 중이다.
- 이전 전체 회귀의 성공을 이 실행의 성공으로 대체하지 않는다. 다음은 현재 전체 결과와 수정 commit 원격 CI 확인 후 별도 문서 closure다. 이 정정은 별도 commit/push한다.

## LOG-078 — 2026-09-19 (Asia/Seoul) — verifier LSP cancellation readiness 동기화

**상태:** LSP 통합 34 PASS, `npm run check` PASS, 수정 후 full 격리 회귀 PASS. 수정 commit 원격 CI와 별도 V0.5B closure가 남았다.

- LOG-077 수정 후 full 회귀와 별도 Weavra subset에서 기존 `company-runtime-lsp.test.ts`의 verifier cancellation 테스트가 default 1초 `vi.waitFor` readiness 한도에 걸렸다. full은 coding-agent **2,701 PASS / 1 FAIL / 50 skipped**, company-runtime **1,276 PASS**, eval **34 PASS**였고, 별도 Weavra subset은 **463 PASS / 1 FAIL**이었다. footer native branch 회귀는 통과했다.
- 실제 stdio 서버 trace에 대상 method가 기록되는 것을 `watchFile`로 관찰하고 workflow terminal과 race하는 readiness로 두 cancellation 테스트를 바꿨다. 서버·Provider·verifier를 mock으로 대체하지 않았고 server request timeout이나 test timeout을 늘리지 않았다. request가 도착하기 전에 workflow가 종료하면 즉시 실패한다.
- `finally`에서 cancel과 workflow settlement를 기다린 뒤 fixture를 정리한다. 기존 CANCELLED·writer release·process reap·이미 실행한 check stdout/exitCode 보존 assertions는 유지했다.
- 변경 파일: `packages/coding-agent/test/suite/company-runtime-lsp.test.ts`, 이 로그. 현재 단독 파일 **34/34 PASS**, `npm run check` PASS(1,429 files, 변경 없음). 수정 후 full `bash ./test.sh` 결과를 기다린다.
- 새로운 runtime 기능이나 repair는 추가하지 않았다. local full 및 수정 HEAD remote CI가 확인되기 전까지 V0.5B는 미종료다. 이 변경은 검증 결과와 함께 별도 commit/push한다.
- 후속 실제 결과(20:50 KST): 수정 후 `bash ./test.sh` **exit 0 / 전체 PASS**. coding-agent **278 files / 2,702 PASS / 50 skipped**(Weavra integration 포함), company-runtime **45 files / 1,276 PASS**, deterministic eval **7 files / 34 PASS**. 나머지 workspace 및 script/TUI 테스트도 정상 종료했다. skip은 기존 Provider/env 조건이며 이번 변경으로 추가하지 않았다. 앞선 실패 실행은 LOG-076~078에 그대로 남긴다.

## LOG-079 — 2026-09-19 (Asia/Seoul) — V0.5B Task Recipes closure

**판정: V0.5B CLOSED.** actual Provider + production command 회귀 + full local + 구현 HEAD remote CI가 통과했다. 이 항목·README·로드맵만 별도 closure commit으로 게시하고, 그 문서 HEAD CI까지 PASS인 것을 확인한 후에만 V0.5C를 시작한다.

### 실제 구현 및 권한

- 출발점은 `2809b407dc7a706b6f6142ccbb059a21271fdc9a`(local/origin 일치)였다. reviewed recipe 4종, strict 입력, STANDARD-only `/workflow run --recipe <id> <goal>`, compiler prefill → 사용자 AC 편집/확정 → Plan Preview → 기존 StandardWorkflow/Kernel 경로, bounded recipe provenance를 확인했다.
- recipe는 Planner/Policy/승인/COMPLETE authority가 아니다. 최종 confirmed Task Contract를 사용하고 Host의 allowed paths와 registered checks를 그대로 유지한다. 현재 compiler는 scope를 더 좁히지 않는다. ordinary command와 QUICK 경로는 그대로다.
- expected-failure TDD lifecycle은 **미구현**이다. 외부 skill 자동 탐색·임의 hook·command·Tool·protected oracle 읽기나 trust baseline 변경 권한도 없다. README의 scope narrowing 표현과 로드맵의 premature V0.5C 안내를 정정했다.
- `RunCreated`에서 기록한 bounded recipe `id/version/digest`와 최종 run provenance가 동일하다. Task Contract digest와 recipe digest는 다른 identity다. raw recipe 입력 JSON·credential·protected 내용·전체 Provider transcript를 provenance에 저장하지 않는다. recipe에서 유래한 최종 AC는 의도적으로 Task Contract와 evidence에 나타난다. EvidencePack에 별도 recipe metadata 필드가 있다고 주장하지 않는다.

### actual Provider 증거

- LOG-075: `commandcode` / `deepseek/deepseek-v4.1-flash` / `https://api.commandcode.ai/provider/v1`, run `54a89a9a-a193-4491-93c7-a2ca458591c9`, **COMPLETED / oraclePass true / falseCompletion false / retry 0**.
- actual UI adapter가 production 등록 command의 recipe JSON 입력·prefill 확인·AC 4→3 편집·Plan Preview 확인을 수행했다. 실제 terminal 키 입력/화면 rendering 검증으로 확대하지 않는다.
- Developer fresh session → SELF_CHECK PASS → 독립 Reviewer PASS(AC 3개 MET) → TEST PASS → Kernel RunCompleted. strict read receipt와 anchored edit 사용, SELF_CHECK/TEST trust VERIFIED 및 동일 registration/executable/oracle digest, required sandbox ENFORCED(srt 0.0.76) 및 동일 policy digest를 확인했다. oracle 직접 도구 접근 0, oracle/private marker 변경 없음, writer lock 해제.
- recipe `bugfix@1` digest `sha256:8eba00c5f95cbc75da431c17dc2c3ff7b3dfa0e251fc465b1bfc8408a6899cfe`; Task Contract digest `sha256:2b066ceea7ba526f1ea4c5d8dbf99fdd95f80a6bc32299d7f30ec3b2dbb0ffd0`. 상세 신뢰/격리 digest와 AC는 LOG-075에 보존한다.
- Provider 보고 token 32,472, tool calls 9. session의 thinking은 medium, measurement의 thinking 표시는 UNKNOWN이며 둘을 혼동하지 않는다. 임시 smoke driver는 삭제했고 실제 run evidence 디렉터리는 조사 가능하도록 보존했다.

### 이번 실행의 회귀와 게시

- recipe unit/helper **3 files / 13 PASS**. production manual-vs-recipe A/B, 사용자 편집 AC, preflight 거부, 실제 required check exit 7의 false-completion 방지를 포함하는 새 command 통합 **12 PASS**. 동일 literal을 비교하던 helper A/B는 제거했다.
- readiness 및 native watcher 실패/수정은 LOG-076~078에 분리 기록했다. timeout 확대·skip·runtime 안전 경계 변경 없이 실제 준비 신호/소비자 동작을 검증했다. 수정 후 동일 Weavra subset 재실행 **12 files / 464 PASS**.
- 최종 `bash ./test.sh` **exit 0**: coding-agent **278 files / 2,702 PASS / 50 skipped**, company-runtime **45 files / 1,276 PASS**, deterministic eval **7 files / 34 PASS**. script 및 모든 나머지 workspace/TUI도 정상 종료했다. 이전 실패 실행을 이 PASS로 소급 수정하지 않는다.
- `npm run check`, `npm run hydrate:model-data`, `npm run check:ci`, `npm run check:shrinkwrap`, `npm run check:install-lock:coding-agent`, `git diff --check`, `bash -n packages/company-runtime/bin/weavra`를 실제 실행해 PASS했다. ignored model JSON은 hydrate했지만 tracked generated source·lockfile은 변경하지 않았고 로컬 full build는 실행하지 않았다.
- 구현 HEAD `f4c3298f645c65232136925cf6a52acf9cf5fe3b`의 [CI run 35441207575](https://github.com/kjg8619/pi/actions/runs/35441207575) **success**: hydrate / committed-source build / non-mutating check / isolated tests / launcher syntax / tracked-source unchanged 모두 PASS.
- phase commits: `cfa2d002b` actual 기록, `c97a35665` recipe 회귀·worker readiness, `6ef51700c` native watcher assertion, `f4c3298f6` LSP readiness. 모두 일반 push했다. 중간 `cfa2d002b`·`c97a35665` CI는 후속 push 때문에 cancelled였으며 PASS로 세지 않는다. `6ef51700c` CI `35440812793`도 success였지만 최종 구현 판단은 위 `f4c3298f6` run을 사용했다.

### 제한과 다음 단계

- 이 closure는 bugfix recipe actual 1회와 deterministic 4종/negative 경로 검증이다. 모든 recipe의 Provider actual, 모든 OS/모델, Linux sandbox actual, terminal rendering, expected-failure TDD를 검증했다고 주장하지 않는다.
- V0.5C 코드는 아직 없다. closure 문서 commit/push 후 해당 HEAD CI PASS를 확인하고, opt-in STANDARD/EDIT/R1·SELF_CHECK 최대 1회·fresh linked attempt·누적 budget·infrastructure failure 제외 계약을 재검증한다.
- 이 항목의 변경 파일은 `README.md`, `docs/WEAVRA_ROADMAP_2026-09-17.md`, `docs/WORK_LOG.md`다. changelog는 `devlop` 규칙에 따라 추가하지 않는다. 안정 태그 `weavra-v0.1-rc1`은 변경하지 않는다. closure 문서 HEAD의 SHA/CI 결과는 후속 작업 기록에서 확정한다.

## LOG-080 — 2026-09-19 21:16 (Asia/Seoul) — V0.5B 게시 완료 및 V0.5C 종료 원인 경계 재검증

**상태:** V0.5B 최종 CLOSED. V0.5C는 설계 재검증 중이며 runtime 변경 없음. sandbox 종료 원인 구분 문제로 구현 범위 결정을 요청한다.

- closure commit `a5023eb98a26d6299c7ee7faa8ec4add3fb359e7`을 일반 push했고, [CI 35441610636](https://github.com/kjg8619/pi/actions/runs/35441610636)은 **success**다. hydrate, committed-source build, non-mutating check, isolated tests, launcher syntax, tracked-source unchanged 모두 PASS. 원격 `devlop` SHA 일치, 원격 RC tag peeled target `183f85de1897d8b9f4fadb368a54e2b1390e5a84` 불변을 확인한 후 V0.5C 조사를 시작했다.
- 조사 결과 fresh Pi session/tool closure/read receipt와 bounded context 재구성은 기존 invocation 경계에 있다. 같은 Kernel/Workflow 안에서 code revision과 step attempt를 함께 증가시키고 failed SELF_CHECK의 parent/evidence를 durable state에 연결해야 budget·Host-frozen verifier/trust/policy를 유지할 수 있다. `previousReview`에 가짜 REVISE를 넣거나 Workflow를 재생성하는 방식은 사용하지 않는다. graph는 과거 attempt가 모두 Reviewer에 도달했다고 가정하고 evidence pack은 check attempt를 생략하므로 함께 정정해야 한다.
- `CheckResult.FAIL`은 일반 command nonzero뿐 아니라 timeout, signal, output limit, Policy, trust/oracle mutation, sandbox, workspace/cancellation을 포함한다. reason 문자열을 파싱하거나 FAIL만으로 repair를 허용할 수 없다. 현재 verifier의 최종 freshness 재검증이 PASS에만 적용되므로 failed 후보도 settlement까지 재검증해야 한다.
- 구체적 선행 문제: runtime-local pinned SRT **0.0.76** CLI는 sandbox wrapper의 exit를 target의 exit와 합친다. `sandbox.ts`는 wrapper가 정상 종료하면 `ENFORCED`를 표시한다. 설치된 CLI의 signal/exception 처리까지 읽어 확인했다. stdout/stderr 문구나 exit-code allowlist만으로 sandbox infrastructure 실패를 제외할 수 없다.
- 실제 macOS 임시 재현(`node --import tsx /tmp/weavra-repair-attribution.mts`, 유료 Provider 호출 없음, backend probe 성공):
  - target `process.exit(1)` → `ENFORCED / reason=exited / exitCode=1 / cleanupConfirmed=true`.
  - target self-SIGKILL → **동일하게** `ENFORCED / exited / 1 / true`.
  - 앞선 self-SIGTERM 실행 → `ENFORCED / exited / 0 / true`. SRT CLI가 child SIGINT/SIGTERM을 `process.exit(0)`으로 변환하는 코드와 일치한다. 이것은 target 성공의 증거가 아니다. 전체 Workflow가 COMPLETED했다고 재현한 것은 아니며, 기존 verifier의 exit-zero PASS 판정에 잘못 들어갈 가능성은 소스 근거의 추론이다.
- 임시 driver와 fixture는 제거했다. node_modules/source/lockfile은 수정하지 않았다. 이번 조사에서 추가 code check/full test/Provider run은 실행하지 않았으며 앞 단계 PASS와 구분한다.
- 결정 필요: (A) trusted target 종료/실패 원인 경계를 먼저 보강하고 sandboxed repair까지 포함, 또는 (B) 첫 slice를 명시적으로 direct registered check에 한정하고 sandbox 결과는 원인 불명으로 repair 거부. B에서도 기존 required sandbox를 끄거나 정책을 낮추지 않는다. 일반 command의 application exit 의미도 Host가 고정한 check 계약으로 명시해야 하며 임의 비영 종료를 source defect로 추정하지 않는다.
- V0.5B의 실제 성공 run과 회귀/CI 결과는 유효한 역사적 증거다. 이번 발견으로 sandbox의 모든 종료 상태가 검증됐다고 확대하지 않는다. 새 조사 결과를 기존 LOG에 소급 덮어쓰지 않는다. 이 로그는 현재 미커밋이며, 결정 후 해당 phase commit에 포함한다.

## LOG-081 — 2026-09-19 21:40 (Asia/Seoul) — V0.5C 선행 target 종료 판정 경계

**상태:** 사용자가 LOG-080의 A(종료 판정 경계부터 보강)를 선택했다. direct-only 축소나 sandbox 비활성화 없이 선행 경계를 구현·검증했다. bounded repair 자체는 다음 단계다.

- 변경: `process-runner.ts`에 Host 전용 bounded control FD를 추가했다. `sandbox-driver.mjs`는 check별 독립 SRT SDK process이며 고정 settings·정리 경계를 유지한다. `sandbox-target.mjs`는 sandbox 안에서 실제 executable을 shell 없이 spawn하고 target에 전달하지 않은 FD로 normal exit/signal/spawn failure를 보고한다. stdout/stderr와 SRT wrapper exit는 target 종료 증거로 사용하지 않는다.
- `sandbox.ts`의 preflight와 check가 같은 경계를 사용한다. wrapper 비정상 종료·누락/잘못된 보고·정리 실패는 PASS가 될 수 없다. SIGTERM/SIGKILL은 exitCode null이다. SDK entry 및 Host driver/supervisor의 generation/content digest를 동결·재검증하며 policy digest domain을 v2로 변경했다. fixed network/oracle/protected path 정책과 no-fallback은 그대로다.
- `packages/company-runtime/README.md`의 실행·digest 계약을 수정했다. 기존 설명의 shell 미사용 주장을 SDK 내부 shell wrapper와 등록 target의 `shell:false`로 구분했다. Linux의 Host bwrap wrapper는 supervisor FD 하나만 보존하지만 **Linux actual NOT VERIFIED**는 유지한다. dependency/lockfile, 안정 태그는 변경하지 않았다.
- 실제 macOS 임시 smoke: `node --import tsx /tmp/weavra-target-outcome.mts`. 초기 probe의 workspace 밖 cwd가 새 Node supervisor의 `process.cwd()`에서 EPERM이 되어, probe를 고정된 workspace allow-read root에서 실행하도록 수정했다. 수정 후 probe PASS, target exit 0→0·7→7, SIGTERM/SIGKILL→null, 위조 stdout+exit 7→7, 모두 cleanupConfirmed true. Provider 호출 없음. 임시 driver/fixture 제거.
- `node ../../node_modules/vitest/dist/cli.js --run test/sandbox.test.ts`(company-runtime cwd) 최종 **19 PASS**. 실제 OS 경계에서 literal argv, signal, 위조 stdout/target FD 비상속, supervisor kill, target launch failure, 실제 RegisteredVerifier의 SIGTERM FAIL을 포함했다. 최초 새 verifier test는 fixture oracle 수정 후 baseline commit 누락으로 dirty-workspace 거부되었고 fixture를 바로잡았다. 기존 경계 테스트도 통과했다.
- `npm run check` 최종 **PASS**(현재 작업 실행). 전체 local test/remote CI 결과를 이 단계에서 아직 주장하지 않는다.
- 다음 계약: Host가 `verification.repair.mode=self-check-once`와 check별 deterministic failure exit code를 명시해야 한다. typed normal target exit·fresh trust/sandbox/workspace·정리 완료만 후보이며 reason 문자열은 authority가 아니다. 동일 Run/Kernel/Verifier에서 failed evidence를 보존하고 parent SELF_CHECK→새 implement attempt를 연결한다. 새 worker/session/context/read receipt, 독립 Reviewer/TEST, 기존 누적 budget과 정책을 유지한다.
- 이 단계 변경 파일은 위 source 4개, `test/sandbox.test.ts`, runtime README, WORK_LOG다. phase commit 후 일반 push하고, 후속 로그에서 SHA/CI 결과를 기록한다. changelog는 `devlop` 규칙에 따라 추가하지 않는다.

## LOG-082 — 2026-09-19 22:27 (Asia/Seoul) — V0.5C bounded repair 첫 vertical slice

**상태:** 구현·실제 SDK/faux 및 production command smoke·전체 local 회귀 완료. 이 entry 시점에는 새 slice가 미커밋이며 commit/push 후 정확한 HEAD의 remote CI를 확인한다. V0.5C 전체 milestone이나 유료 Provider actual 완료 선언은 아니다.

### 선행 경계 게시와 구현

- LOG-081의 target 종료 경계 commit `71ea7b2aaaecbab32f30fada79c3d29a394a2ac6`을 일반 push했고 [CI 35443556517](https://github.com/kjg8619/pi/actions/runs/35443556517)은 **success**다. hydrate, committed-source build, non-mutating check, isolated tests, launcher syntax, tracked-source unchanged가 모두 통과했다. V0.5B closure 뒤 이 경계를 선행한 순서를 유지했다.
- `verification.repair.mode`는 기본 `disabled`, opt-in `self-check-once`다. Host가 check별 `repairable_exit_codes`로 정상 종료의 deterministic source failure 의미를 명시한다. 실제 typed target outcome과 원래 trust/backend/workspace·cleanup을 확인해야 `COMMAND_NONZERO` 후보가 된다. stderr/reason 문자열이나 일반 FAIL은 authority가 아니다. optional infrastructure failure도 repair를 막는다.
- 동일 Kernel/Workflow/Verifier에서 failed SELF_CHECK를 durable parent로 저장하고 code revision·step attempt를 하나 증가시킨다. 원래 Task Contract·scope·check registration·Policy·trust/sandbox·누적 budget·failed check evidence를 유지한다. parent 저장 실패 후 새 worker는 시작하지 않는다. terminal reset, 새 Workflow, 가짜 Reviewer REVISE, 숨은 실패 삭제는 없다.
- 새 Developer session/tool closure/context pack/read receipt, 새 SELF_CHECK, 독립 Reviewer, TEST, 최신 digest와 Kernel COMPLETE가 필요하다. 이전 session ID/file·handoff·check/review revision·strict receipt를 재사용하지 않는다. 실패 로그는 최대 8개 check·stdout/stderr 각각 512 UTF-16 units의 untrusted advisory다. 기존 Reviewer REVISE 한도는 별도이고 모든 worker가 원래 호출/token budget을 공유한다.
- `Run.verificationRepair`의 mode와 parent history, 기존 verification prefix를 변경/삭제할 수 없다. graph는 failed self-check→새 implement를 연결하며 도달하지 않은 Reviewer를 만들지 않는다. Evidence Pack은 revision/step/attempt를 구분하고 과거 check FAIL이 새 Provider 실패 원인을 가리지 않는다. Plan Preview/config/status도 repair와 Reviewer revision 한도를 분리했다.
- 변경 source: `packages/company-runtime/src/{config,contracts,ports,events,kernel,workflow,agent-runner,verification,state-store,graph,evidence,observations,plan-preview,extension}.ts`. 신규 회귀: runtime의 `verification-repair.test.ts`, `verification-repair-boundary.test.ts`, SDK suite의 `company-runtime-repair.test.ts`. 기존 `context-leakage`, `task-contract`, `strict-mutation` fixture를 갱신하고 wording/bare-not-throw 검사 3개를 제거했다. core 동작을 바꾸지 않고 `footer-data-provider.test.ts`의 native watcher readiness를 보강했다.

### 실제 smoke와 회귀

- `node --import tsx /tmp/weavra-repair-command.mts`로 **production `/workflow run --recipe bugfix`** 등록 command를 실제 SDK/faux·Git·Node oracle·strict mutation/trust·required macOS sandbox·bounded context로 실행했다. 실제 Plan Preview, config/status, ASCII `/graph`, `/state evidence` 출력을 확인했다. 최종 run `6bbf1900-6360-4320-b50a-246cee76fb8c`: **COMPLETED / oraclePass true / falseCompletion false / repair 1 / writer released**.
- 실제 흐름은 Developer revision 0 → SELF_CHECK FAIL exit 7 → 새 Developer revision 1 → SELF_CHECK PASS → 독립 Reviewer PASS → TEST PASS → COMPLETE다. 서로 다른 session 3개, 모두 동일한 frozen trust registration/sandbox policy의 ENFORCED check 3개를 확인했다. 호출 3회·faux provider-reported token 35,895를 누적했고 새 pack은 original→wrong→fixed snapshot을 반영했다. 이는 유료 Provider 사용량이 아니다. 최초 smoke도 동일 경로 PASS였으며 status의 code revision/Reviewer 한도 혼동을 발견해 표시를 분리하고 다시 실행했다.
- 신규 회귀는 **57 PASS**(Kernel/durable 37, 실제 RegisteredVerifier 14, SDK 6). positive·opt-out·두 번째 failure 상한·invocation/token/UNKNOWN budget, stale receipt/누락·재사용 session, 오래된 check/review, TEST failure, Provider/auth/Policy, storage/cancel/cleanup, strict/compatible trust, signal/timeout/output limit/background process, unavailable executable, oracle 동일 bytes 재생성·settlement 뒤 변경, request allowlist 확장 거부를 포함한다. R3 fixture는 preflight 거부 경로이며 R3 actual repair 실행으로 확대하지 않는다.
- 최종 package-root targeted 명령:
  - coding-agent: `node ../../node_modules/vitest/dist/cli.js --run test/footer-data-provider.test.ts test/suite/company-runtime-repair.test.ts` → **14 PASS**.
  - company-runtime: `node ../../node_modules/vitest/dist/cli.js --run test/observations.test.ts test/verification-repair.test.ts test/verification-repair-boundary.test.ts` → **77 PASS**.
- `npm run check` 및 `npm run check:ci` 최종 **PASS**. Biome, pinned/runtime dependencies, relative imports, entry graphs, shrinkwrap/install-lock, tsgo, browser smoke gate가 통과했다. 언어 서버가 새 schema 필드를 누락한 stale 진단을 반복했으므로 실제 compiler 결과와 구분하고 tool issue로 기록했다.
- `bash ./test.sh` 최종 **전체 PASS**: scripts 16, coding-agent 279 files / **2,708 PASS·50 skipped**, company-runtime 47 files / **1,329 PASS**, eval 7 files / **34 PASS**. agent·ai·chord·client·protocol·server·telemetry·TUI·sqlite-node도 통과했다. isolated HOME/API-key 제거 경로이며 유료 Provider 호출은 없다.

### 문제·정리·제한

- 첫 전체 실행은 기존 `footer-data-provider.test.ts`의 reftable native watcher 변경 검출 1건이 timeout이었다(runtime/eval은 PASS). fixture가 watcher 준비 전에 유일한 변경을 쓰던 경합을 없애기 위해 Git refresh가 실제 관측될 때까지 readiness를 확인한 후 검증 대상 branch를 바꾸도록 했다. timeout 확대·skip·production watcher 변경은 하지 않았다. 비동기 mock은 `queueMicrotask`로 바꾸고 실제 OS watcher를 기다리는 timer 예외 이유를 주석으로 남겼다. targeted와 두 번째 full suite가 모두 PASS다.
- 새 fixture 초기 실패도 수정했다: bounded pack은 실제 literal symbol seed를 필요로 하므로 fixture에 `formatLabel`을 사용했고, faux callback의 네 인자를 모두 전달했다. oracle replay fixture의 정책 밖 marker 쓰기는 올바르게 BLOCKED였으므로 stdout 실행 증거로 바꿨다. faux usage는 고정 숫자 추정 대신 실제 worker measurement 합계를 검증하며, Store가 오류 후 닫힌 상태이므로 변조 거부 뒤에는 디스크의 durable 원본을 검사한다. Runtime guard를 약화하지 않았다.
- README·runtime README·roadmap에 기본 disabled, Host exit-code 계약, fresh attempt/원래 정책/누적 budget/독립 review, graph/evidence 의미와 미검증 범위를 기록했다. 임시 smoke driver와 fixture는 제거했다. dependency/lockfile·안정 태그 변경은 없고 `devlop` 규칙에 따라 changelog는 추가하지 않았다.
- **NOT VERIFIED:** V0.5C 유료 Provider actual, Linux sandbox actual, TUI overlay rendering, 추가 OS/Node/모델, 완전한 외부 TOCTOU·transitive oracle/plugin graph 격리. expected-failure TDD, 일반 retry/resume/rollback, oracle 자동 수정은 구현하지 않았다.
- 다음: 이 slice를 명시 경로만 stage하여 commit/push하고 정확한 구현 HEAD의 CI를 확인한다. 이후 게시 결과를 새 entry에 남기며 최종 문서 HEAD도 별도로 CI PASS를 확인한다.

## LOG-083 — 2026-09-19 22:37 (Asia/Seoul) — V0.5C 첫 vertical slice 게시 확인

**상태:** 첫 vertical slice 구현·local 검증·구현 HEAD remote CI까지 완료했다. V0.5C 전체 milestone과 미실행 Provider/platform 검증은 별개다.

- 구현 commit `53bdafe1b4e8369bad45923fd5fb0f7fba37e743`(`feat: add bounded self-check repair attempts`)에 이 세션의 25개 파일만 명시적으로 stage했고 일반 push로 `devlop`에 게시했다. 선행 `71ea7b2aa` 위에 순서대로 적용했으며 force push·태그 이동·lockfile 변경은 없다.
- `gh run watch 35445922622 --repo kjg8619/pi --exit-status --interval 20` 및 `gh run view ... --json headSha,status,conclusion,url,jobs`로 **정확한 구현 SHA의 [CI 35445922622](https://github.com/kjg8619/pi/actions/runs/35445922622) success**를 확인했다. hydrate, committed-source build, non-mutating check, isolated tests, launcher syntax, tracked-source unchanged가 모두 PASS다. CI success를 Linux sandbox actual PASS로 해석하지 않는다.
- `git ls-remote`의 `refs/heads/devlop`은 구현 SHA와 일치했고 `weavra-v0.1-rc1^{}`은 기존 `183f85de1897d8b9f4fadb368a54e2b1390e5a84` 그대로다. local full suite·targeted·production command smoke는 LOG-082에서 이번 작업에 실제 실행한 결과이며 이 문서 작업에서 다시 실행했다고 기록하지 않는다.
- 이번 문서 변경은 `docs/WORK_LOG.md`의 현재 요약·게시 이력과 `docs/WEAVRA_ROADMAP_2026-09-17.md`의 첫 slice 완료 상태뿐이다. README/runtime README의 config·실행 경계·미검증 설명은 구현 commit에 포함돼 있다. 기존 역사 기록은 수정하지 않는다.
- 남은 제한은 LOG-082와 같다: C 유료 Provider actual·Linux sandbox actual·TUI overlay rendering NOT VERIFIED, expected-failure TDD 및 일반 retry/resume 미구현. 기능 scope를 넓히거나 권한/완료 조건을 완화하지 않았다.
- 이 게시 기록을 별도 docs commit으로 일반 push한 뒤, **그 최종 문서 HEAD의 CI도 별도로 PASS 확인**하고 최종 보고에 정확한 SHA/run URL을 남긴다. 새 문서 commit의 아직 실행하지 않은 CI 결과를 미리 PASS로 기록하지 않는다.

## LOG-084 — 2026-09-19 23:39 (Asia/Seoul) — V0.5C Astra actual Provider 검증

**상태:** actual Provider repair 성공과 evidence 검증 완료. 이 entry 시점에는 전체 회귀 최종 실행·closure commit·그 정확한 HEAD의 CI 확인이 남아 있어 V0.5C closure 게시 완료로 기록하지 않는다.

### 기준선과 실제 Provider 경로

- 착수 시 clean `devlop`의 local HEAD·`origin/devlop`·`git ls-remote`가 모두 `96660237ef8ec15759e0a2061623749a9812f396`이었다. 해당 SHA의 [CI 35446398078](https://github.com/kjg8619/pi/actions/runs/35446398078) success도 이번 작업에서 확인했다. 선행 sandbox target 경계 `71ea7b2aa` → bounded repair `53bdafe1b` → 게시 기록 `96660237e` 순서를 유지했다.
- 구현·분석 agent는 OMP의 `openai-codex/gpt-6-astra`다. 이것만으로 Weavra worker의 가용성을 추정하지 않았다. Weavra의 기존 `models.json` metadata, fork-local `ModelRuntime.getModel/getAvailable`, 살아 있는 relay `/v1/models`를 각각 확인했다.
- actual worker는 **`codex-lb/gpt-6-astra`**, API **`openai-responses`**, 기존 endpoint **`http://127.0.0.1:2455/v1`**를 사용했다. coding/reasoning profile 모두 같은 명시 ID이며 fallback은 없다. Weavra auth의 `openai-codex` OAuth 존재와 custom `codex-lb` credential 설정 존재를 구분했고 값은 출력·복사하지 않았다. auth/models/settings를 수동 수정하거나 OMP credential을 이식하지 않았다.
- 실제 SDK assistant metadata와 worker measurement 모두 요청한 provider/model을 기록했다. 별도 `responseModel`은 없어 UNKNOWN이며 relay 뒤 upstream identity를 독립 검증했다고 주장하지 않는다. OMP endpoint도 별도로 확인되지 않았으므로 두 실행 경로가 같다고 주장하지 않는다.

### Fixture와 actual 결과

- `node --import tsx /tmp/weavra-astra-repair.mts`로 production `registerCompanyRuntime`의 **`/workflow run Fix the formatLabel bug in src/label.mjs`**를 실행했다. 임시 Git repository, 실제 Pi SDK/Provider·Git·Node oracle·RegisteredVerifier를 사용했고 UI 입력 adapter만 AC 편집/Plan 확인을 제공했다. recipe 변환이 아닌 repair 자체를 검증하기 위해 일반 command를 선택했다. TUI 화면 검증은 아니다.
- Host가 고정한 최종 AC는 일반 문자열 trim, 빈/공백 문자열의 `Unnamed` 반환, source 한 파일만 변경이다. 초기 Developer revision 0에만 `return value.trim()`으로 blank fallback 결함을 남기도록 frozen project instruction에 명시했다. **의도적 결함 주입 통제 실험**이며 자연 발생 모델 오류·모델 품질 평가가 아니다. Worker가 실제 소스를 편집했고 Host 사후 소스 변경·가짜 verifier·oracle 수정은 없다.
- oracle은 실제 함수 결과가 기대값과 다를 때만 exit `7`, 성공은 `0`, import/실행 오류는 다른 정상 Node 실패다. `repairable_exit_codes: [7]`, STANDARD/EDIT/R1, `self-check-once`, bounded context, strict mutation/trust, required macOS sandbox를 모두 적용했다. worker timeout 180,000ms, 원래 누적 budget 3 workers/100,000 reported tokens, Reviewer REVISE 한도 0이다.
- 실제 run **`42712fab-ac25-42ae-9a73-e44e7b7c878d`**:

| 실제 단계 | code revision / step attempt | 결과 |
|---|---|---|
| Developer | 0 / implement:1 | fresh anchored read → source edit → 새 handoff |
| SELF_CHECK | 0 / self-check:1 | **FAIL / exit 7 / COMMAND_NONZERO** |
| repair Developer | 1 / implement:2 | durable failed parent 뒤 새 session·receipt로 blank fallback 수정 |
| SELF_CHECK | 1 / self-check:2 | **PASS / exit 0** |
| 독립 Reviewer | 1 / review:2 | 실제 source read, **PASS / AC-001~003 MET** |
| TEST → Kernel COMPLETE | 1 / test:2 → complete:2 | **PASS → COMPLETED** |

- **repair 1회 / oraclePass true / falseCompletion false / writer released / durable terminal COMPLETED**. 별도 실제 oracle 실행도 PASS였고 변경 파일은 `src/label.mjs` 하나다. config·oracle·project instruction·기타 baseline 파일의 bytes는 불변이다.
- session IDs는 Developer 0 `01a0ba12-f4c1-718c-92a3-2084c40f1416`, Developer 1 `01a0ba13-5ef0-718c-92a3-2086a33cd6b8`, Reviewer 1 `01a0ba13-cc43-718c-92a3-208854cb3bb6`으로 서로 다르고 session files도 다르다. 각 history는 새 user request로 시작했으며 이전 conversation/tool results를 복사하지 않았다. repair에는 이전 Reviewer verdict가 없고 Reviewer는 revision 1 handoff와 fresh SELF_CHECK evidence를 받았다.
- 두 Developer의 anchored read receipt가 다르고 mutation은 각 session에서 새로 받은 receipt를 사용했다. 세 bounded pack은 714/721/736 bytes이며 각각 original/initial-defect/fixed source digest를 담았다. invocation마다 새 `createWorkerTools` receipt registry가 만들어지는 source 경계도 확인했다.
- 누적 budget은 **1 worker / 12,412 tokens → 2 / 26,283 → 3 / 34,035**였다. model turns는 **4 + 4 + 2 = 10**, tool calls도 10이다. worker invocation과 Provider turn을 혼동하지 않는다. session의 provider-reported usage 합과 durable measurement/budget 합이 일치했다. UNKNOWN usage 거부는 실제 positive run이 아니라 deterministic 회귀로 검증했다.

### Frozen evidence와 부정 경계

- Task Contract digest: `sha256:4f395004012d3317762159fa57a64d7423f26ba79bf89500cefd4cc34439fcca`. 세 worker request와 durable snapshots/repair parent에 동일하다.
- action 8개의 config digest: `0ce5022cb72e3e8d0b7c1e9fa5ee28330548527f0844a36863880431895d0eef`. Execution Mode/instruction binding은 그대로이며 최초 Verifier action의 FAILED도 숨기지 않았다.
- 세 check 모두 strict **VERIFIED**, 동일 registration digest `sha256:e0e259356771ccca6a7c041e728d5f9e2023f222eb82015658157ca32e2d9073`, 동일 executable/source digest다. required sandbox는 모두 **ENFORCED**, SRT `0.0.76`, policy digest `sha256:17eb4c8a81a92994138eac81039fbf93074ea37319b54ece2d4d0fdb45a51b71`다.
- failed parent diff `69052d26afde97043d5d71e5f8c8ddc622319a731578e124b8151fa79bb692c5`는 보존됐다. repair 이후 SELF_CHECK·Reviewer·TEST의 최신 diff는 모두 `89c6ffd833d60041cb9539f20a46e595e12b7e954c1b1963d0f568bc0a6a89ee`다. 이전 failed snapshot을 새 PASS로 재사용하지 않았다.
- `node --import tsx /tmp/weavra-audit-repair.mts`의 실제 session/durable snapshot 대조 assertions를 통과했다. 공개 기록에는 bounded metadata만 남기고 credential·전체 reasoning·원문 transcript는 넣지 않았다. 임시 driver/probe/analyzer와 fixture는 제거했고 안전한 metadata JSON만 `/tmp/weavra-astra-safe-evidence.json`에 남겼다. Pi-owned worker sessions는 기존 저장소에 유지했다.
- 이번 실행의 기존 회귀에서 두 번째 repair, Provider/auth/Policy, cancellation/cleanup, signal/timeout/output limit, unavailable executable, stale receipt/check/review, session 재사용, scope/Task Contract 변경, budget UNKNOWN을 거부했다. actual positive smoke에서 이 공격을 모두 유료 호출로 재실행했다고 주장하지 않는다. 새 중복 테스트·Provider 호출·Runtime 변경은 추가하지 않았다.

### 현재 회귀 결과와 발견한 문제

- company-runtime package-root `node ../../node_modules/vitest/dist/cli.js --run test/verification-repair.test.ts test/verification-repair-boundary.test.ts test/task-contract.test.ts test/execution-contract.test.ts`: **4 files / 120 PASS**.
- company-runtime package-root `node ../../node_modules/vitest/dist/cli.js --run test`: **47 files / 1,329 PASS**.
- coding-agent package-root `node ../../node_modules/vitest/dist/cli.js --run test/suite/company-runtime`: 최종 단독 실행 **13 files / 470 PASS**. repair SDK 6건을 포함한다.
- 첫 `bash ./test.sh`의 eval package는 **7 files / 34 PASS**였다. 별도 eval 명령은 처음 잘못된 기본 config로 test를 찾지 못했고, `--config vitest.test.config.ts`로 바로잡았다. 그 병렬 실행의 2건은 5초 timeout이었으므로 PASS로 기록하지 않는다.
- 첫 병렬 SDK/full 실행에는 기존 lifecycle fixture의 `check-ready` 대기 실패가 각각 5건 있었다. `vi.waitFor` 기본 1초와 실제 check startup을 구분했고, 다른 검증 종료 뒤 같은 설정의 SDK 전체 단독 실행은 모두 PASS였다. timeout 확대·skip·test/Runtime 수정은 하지 않았다. 과도한 동시 검증 부하와의 관련성은 추론이며, 최종 전체 실행은 다른 heavy suite를 겹치지 않는다.
- `npm run check`(Biome no fixes), `npm run check:ci`, `npm run check:shrinkwrap`, `npm run check:install-lock:coding-agent`, `git diff --check`, `bash -n packages/company-runtime/bin/weavra`: **PASS**. 이 entry 시점 두 번째 `bash ./test.sh`는 진행 중이다.
- 최초 smoke goal은 classifier가 인식하는 `bug`가 없어 preflight에서 거부됐다. run/worker/Provider 호출이 없었으며 명확한 bugfix goal로 수정한 위 1회 actual run만 수행했다. classifier/권한 guard를 완화하지 않았다.
- 변경 문서는 `README.md`, `packages/company-runtime/README.md`의 actual repair 결과와 이 이력이다. Runtime/test/dependency/lockfile 변경은 없다. commit/push는 아직 하지 않았다.
- 남은 제한: Linux sandbox actual·추가 모델/OS/Node·TUI rendering NOT VERIFIED, R2/R3 repair·expected-failure TDD·일반 retry/resume/rollback 미지원, 외부 TOCTOU·transitive plugin graph 완전 격리 미보장. 다음은 최종 full 회귀 결과로 closure를 판정하고 roadmap/현재 요약을 갱신한 뒤 별도 closure commit의 정확한 CI를 확인하는 것이다. **V0.5D 구현은 시작하지 않는다.**

## LOG-085 — 2026-09-19 23:40 (Asia/Seoul) — V0.5C closure 판정과 별도 게시

**상태:** LOG-084 actual Provider evidence와 이번 최종 전체 회귀로 **V0.5C를 현재 bounded 범위에서 CLOSED**로 판정한다. 이 문서 변경은 별도 closure commit으로 게시하며, 최종 보고 전 그 정확한 SHA의 remote CI PASS를 확인한다. 아직 실행하지 않은 closure CI를 이 entry에서 PASS로 기록하지 않는다.

- 다른 heavy suite를 겹치지 않은 두 번째 **`bash ./test.sh` 전체 PASS(exit 0)**: scripts 16, coding-agent 279 passed files / **2,708 PASS·50 skipped**, company-runtime 47 files / **1,329 PASS**, deterministic eval 7 files / **34 PASS**. agent 711, ai 1,069(유료/e2e 등 843 skipped), chord 162, client 27, protocol 133, server 44, telemetry 15, sqlite-node 105 및 TUI도 PASS다. isolated HOME/credential 제거 경로이며 actual Provider 결과와 분리한다. LOG-082의 역사적 PASS를 재사용한 수치가 아니다.
- SDK 단독 470 PASS와 최종 full 모두 같은 source·timeout·테스트 설정에서 통과했다. 최초 병렬 실행의 readiness/timeout 실패는 LOG-084에 보존한다. Runtime 기능 결함으로 확정하거나 flaky 가능성이 없어졌다고 주장하지 않는다.
- closure 기준: actual failure classification/allowlist, failed parent의 durable 보존, 최대 repair 1회, 새 Developer session/tool closure/context/receipt, 원래 계약·scope·registration·policy·trust/sandbox, 누적 calls/tokens, 독립 Reviewer와 fresh TEST, 최신 digest/AC의 Kernel 완료, 실제 oracle PASS와 writer release를 확인했다. negative boundaries는 기존 deterministic suites로 검증했다. 권한 확대·completion guard 완화·Runtime/test 변경 없이 닫는다.
- 문서 변경: `docs/WORK_LOG.md` 현재 요약·LOG-084/085, `docs/WEAVRA_ROADMAP_2026-09-17.md`의 V0.5C CLOSED·V0.5D NEXT/미착수, `README.md`와 `packages/company-runtime/README.md`의 actual capability·정확한 제한. 의존성/lockfile/production code/test/changelog 변경은 없다.
- 안정 태그 `weavra-v0.1-rc1^{}`은 원래 `183f85de1897d8b9f4fadb368a54e2b1390e5a84`다. 변경 파일 네 개만 명시 stage하여 별도 docs closure commit으로 일반 push한다. force push·태그 이동은 하지 않는다. exact closure SHA·CI URL·최종 결과는 GitHub Actions와 최종 응답에서 대조한다.
- 제외 범위는 그대로다: Linux sandbox actual 및 모든 모델/OS/Node 검증, R2/R3 repair, expected-failure TDD, 일반 retry/resume/rollback, 완전한 external TOCTOU/transitive oracle/plugin graph 격리. 통제 defect fixture의 성공을 자연 발생 오류 복구율로 일반화하지 않는다.
- **다음 첫 작업(미착수):** V0.5D의 C04 Impact-aware Review Pack 계약을 기존 C01 Task Context Pack 위에서 정한다. changed symbol/caller/test를 bounded·fresh advisory Reviewer 입력으로 연결하고 C05 reviewed documentation의 version/source/capturedAt·digest·stale 의미를 같은 입력 계약에 정리한다. Policy·검증 evidence·completion authority로 승격하지 않는다. 이 작업에서는 설계/구현을 시작하지 않고 closure 게시·정확한 CI 확인까지만 수행한다.

## LOG-086 — 2026-09-20 00:02 (Asia/Seoul) — V0.5D 계약 감사·구현 착수

**상태:** 진행 중. V0.5D closure와 V0.6A 시작을 아직 선언하지 않는다.

- 시작 local HEAD·`origin/devlop`·실제 remote HEAD는 모두 `1d2a4af966b95bdcf6e0f8a3ac1f7c7e9129686b`이며 working tree는 clean이었다. 안정 태그 peeled commit은 `183f85de1897d8b9f4fadb368a54e2b1390e5a84`로 유지한다.
- 기존 C01/Policy/LSP/Verifier/Workflow/measurement/evidence와 문서 계약을 조사했다. GitWorkspace는 실제 baseline/current JSON diff를 제공하지만 LSP document symbol은 selection range만 보존하므로 본문 range를 별도로 유지해야 한다. Worker 도구 좌표·기존 Kernel authority는 바꾸지 않는다.
- C04는 실제 변경 행과 current symbol range 교차, policy 재검증된 references/tests/declarations, bounded deterministic digest를 갖는 Reviewer advisory다. C05는 기존 trusted `.ai/config.yaml` 안의 reviewed local snapshot registry부터 시작한다. 네트워크·설치·실행 hook·새 indexing/runtime을 넣지 않는다. 최초 version binding은 정책상 읽을 수 있는 npm package.json의 exact 선언 버전이며 installed/resolved version과 구분한다.
- Reviewer 호출 직전 fresh 재구성하고 기존 Task Context Pack과 분리한다. raw source/docs는 durable measurement/evidence에 저장하지 않으며 optional summary만 추가하여 historical run readability를 유지한다. 두 pack의 추가 Reviewer envelope는 합계 48 KiB로 제한한다.
- OMP read-only scout 두 개의 조사 결과를 main이 통합했다. writing subagent 두 개는 model 미설정(`No model selected`)으로 시작하지 못했으며 파일 변경은 없었다. credential 이식·harness 설정 우회 없이 main이 구현을 계속한다. 이 문제는 Weavra actual Provider 가용성 판정과 별개다.
- 이 entry 시점 신규 테스트·full regression·actual Provider·remote CI는 미실행이다. 단계별 구현/검증 뒤 별도 commit으로 게시하고 정확한 HEAD CI를 확인한다. V0.5D가 실제 CLOSED된 뒤에만 V0.6A read-only bridge로 진행한다.

## LOG-087 — 2026-09-20 00:14 (Asia/Seoul) — C04/C05 core 및 Reviewer 조합 1차 검증

**상태:** C04 core를 첫 구현 commit으로 분리한다. C05와 Reviewer integration은 작업 tree에서 후속 검증 중이며 V0.5D는 OPEN이다.

- C04: `impact-review.ts`·leaf types·회귀를 추가했다. 기존 GitWorkspace before/after의 bounded LCS로 변경 행을 계산하고 LSP의 새 full symbol range와 교차한다. selection 좌표는 기존대로 유지한다. C01 안전 read/eligibility 함수를 재사용하고 Policy/read 검사·source digest·query/byte cap을 적용한다.
- 첫 targeted 실행은 113건 중 2 FAIL이었다. replacement를 insertion+deletion으로 순회할 때 다음 unchanged line까지 deletion gap으로 기록하는 오류를 발견했다. 같은 edit hunk에 insertion이 있으면 별도 deletion gap을 추가하지 않도록 고쳐 nested symbol과 separated hunk 검증을 통과했다. assertion·timeout을 완화하지 않았다.
- `node ../../node_modules/vitest/dist/cli.js --run test/impact-review.test.ts test/documentation-pack.test.ts test/lsp.test.ts test/task-context.test.ts test/measurement-evidence.test.ts test/host-boundary.test.ts` (company-runtime): **6 files / 135 PASS**. C04뿐 아니라 현재 작업 tree의 C05/schema integration을 포함한 실행이며, 아직 게시하지 않은 C05 결과를 이전 commit의 결과로 소급하지 않는다.
- 현재 작업 tree `npm run check`: **PASS**, Biome 1440 files 중 이 작업 파일 12개 정렬/format 적용, 이후 type/import/entry graph/shrinkwrap/install-lock/browser-smoke gate PASS. 변경된 dependency/lockfile은 없다.
- LSP 도구가 성공적으로 수정된 파일의 이전 buffer로 diagnostics/reference 위치를 반환하는 문제가 있어 reload와 도구 이슈 보고를 수행했다. disk source를 사용하는 실제 tsgo/check는 PASS였다. 이 stale harness diagnostics를 제품 type error로 오인하여 코드를 낮추지 않았다.
- 추가 Reviewer SDK/freshness/authority/leakage 회귀, deterministic A/B, full local 및 actual/remote 검증은 다음 단계다. C04/C05는 advisory이며 Kernel 완료·Policy·trust/sandbox guard는 변경하지 않았다.

## LOG-088 — 2026-09-20 00:45 (Asia/Seoul) — C05 reviewed documentation 및 경계 보강

**상태:** C05를 별도 구현 commit으로 분리한다. V0.5D는 OPEN이며 실제 Provider 호출은 하지 않았다.

- 변경: `documentation-pack.ts`, `documentation-pack-types.ts`, `config.ts`, `test/documentation-pack.test.ts`, 공통 `task-context.ts` exclusion 비교 및 이 작업 이력. 기존 trusted config의 opt-in inline registry, strict metadata/정확한 npm 선언 버전, MATCHED/VERSION_MISMATCH/STALE/UNAVAILABLE/UNKNOWN, 전체 snapshot 단위 byte cap과 summary-only projection을 구현했다. 원격 fetch·설치·실행 hook은 없다.
- Read-only 감사에서 잘못된 SemVer(`1.2.3-01` 등), `://` 없는 URI credential/query, 별도로 전달한 protected/oracle exclusions 누락을 찾았다. literal SemVer 검증·URI scheme 검사·동일 C01 exclusion 입력으로 고쳤다. verifier source 별칭도 기존 protected-path의 NFC/case 비교를 재사용한다.
- 현재 실행: documentation 단독 **22 PASS** 후 경계 4건을 추가했다. `impact-review.test.ts documentation-pack.test.ts task-context.test.ts`는 **3 files / 71 PASS**(C04 23, C05 26, C01 22)다. 추가 전 `impact-review.test.ts documentation-pack.test.ts lsp.test.ts`는 **3 files / 95 PASS**였다.
- SDK 현재 작업 tree `test/suite/company-runtime-repair.test.ts`: **16 PASS**. repair revision 1의 실제 fixture LSP symbol/source digest·declaration 및 docs, summary-only state/evidence, TEST 실패 시 BLOCKED, outer hash를 다시 계산해도 잘못된 nested version/digest/field/status/content를 Reviewer session/Provider 전에 거부하는 경계를 확인했다. 실제 Provider가 아니라 기존 SDK faux harness다.
- C04 후속 보강은 다음 integration commit에 포함한다: 삭제 boundary와 UTF-16 edit extent, 서버 순서가 아닌 canonical-before-budget LSP 결과, scope 우선 relation cap, bounded 초기 source snapshot과 최종 재검증. LSP server의 내부 target cache freshness를 source digest가 증명한다고 주장하지 않는다.
- 첫 추가 `npm run check`는 fixture의 `reason:null` type error와 template 정보 1건을 보고했다. 올바른 문자열/템플릿으로 수정한 후 다시 실행한 **`npm run check` 전체 PASS**, 정보·경고 없음. stale LSP rename 도구가 test의 다른 offset을 손상한 문제도 도구에 보고하고 원문을 복구했다. 해당 source/check를 낮추거나 safety assertion을 제거하지 않았다.
- deterministic A/B 첫 실행은 canonical cwd를 사용하지 않은 새 direct-tool fixture가 `Unsafe anchored path`로 거부됐다(다른 5 tests PASS). fixture를 실제 Adapter처럼 `FilePolicyPathInspector.projectPath`로 연결했으며 재실행 전이므로 A/B PASS로 기록하지 않는다.
- commit은 명시한 C05 파일만 stage하며 아직 push/remote CI를 하지 않았다. dependency/lockfile·stable tag 변경은 없다. 다음은 advisory authority 회귀와 A/B 완료, full validation, 조건 충족 시 Astra actual 최대 1회, exact 구현/closure CI다. V0.6A는 V0.5D CLOSED 이후에만 시작한다.

## LOG-089 — 2026-09-20 01:03 (Asia/Seoul) — Reviewer 통합·advisory 경계·deterministic A/B

**상태:** V0.5D OPEN. C04 `a5db86f1f`, C05 `8e7a638ab` 다음으로 Reviewer 통합과 회귀/eval을 분리해 commit한다. 아직 push·actual Provider·remote CI를 실행하지 않았다.

- 통합 변경: Reviewer 직전 fresh C01→C04/C05 조합, run/revision/Task Contract/diff binding, strict nested schema·digest·metadata validation, 합계 48 KiB, optional summary-only measurement/evidence. Developer 입력·mutation receipt·verification evidence·Kernel COMPLETE authority는 확장하지 않았다.
- C04 보강: UTF-16 변경 extent/삭제 boundary, most-specific symbol, canonical-before-budget LSP 정규화, symbol/relation 중복 제거, scope 우선 cap, query 중 target 변경과 최종 source 변경 제거, PARTIAL/불완전 cache 의미를 확인했다. raw LSP의 미등록 필드는 관계 출력에 복사하지 않는다.
- 추가 direct-tool 회귀는 context/impact/docs digest를 strict read receipt나 review evidence로 쓰는 시도, 문서의 instruction-like text가 권한을 추가하는 시도, fresh revision의 manifest mismatch, 조합 도중 diff 변경을 방어한다. SDK 회귀는 fresh revision·독립 Reviewer·TEST 실패 시 BLOCKED·malformed nested context의 Provider 이전 거부를 확인한다.
- 현재 targeted company 회귀: **7 files / 154 PASS**. 현재 SDK repair 단독은 LOG-088의 **16 PASS**이며 SDK 전체는 별도로 실행 중이다. 회사 Runtime 전체 `node ../../node_modules/vitest/dist/cli.js --run test`: **50 files / 1,385 PASS**, 126.30초. 서로 다른 실행의 숫자를 합산한 전체 건수로 주장하지 않는다.
- deterministic eval targeted: **3 files / 6 PASS**. 새 A/B 단독 재실행도 **1 PASS**이며 clean/defect × baseline/bounded 네 workflow를 실제 Runtime/Kernel/Policy/strict tools/Verifier와 fixture LSP로 실행했다. 같은 Task Contract·scope·check를 유지한다.
- A/B 관측: clean payload 5,137→8,271 bytes, defect 5,151→8,285 bytes, envelope 3,115 bytes, 파일 검사 6→3, 도구 호출 10→7. clean false-positive 없음, 통제 defect 양쪽 발견, false-COMPLETE 없음. scripted Reviewer 전략이므로 모델 품질·일반 결함 탐지율·token 절감을 증명하지 않으며 Provider tokens는 **UNKNOWN**이다.
- 첫 A/B의 canonical cwd 오류 다음에는 eval harness가 측정 없는 worker의 usage를 빈 합계 `0`으로 기록하는 문제를 발견했다. 측정 없음을 `null`로 보존하도록 고쳤다. faux usage를 실제 Provider usage로 바꾸거나 assertion을 완화하지 않았다. 기존 C01 A/B의 inline import와 temporary directory 누수도 정리했다.
- 현재 `npm run hydrate:model-data` **PASS**(1,409 tool-capable model records), `npm run check`, `npm run check:ci`, `npm run check:shrinkwrap`, `npm run check:install-lock:coding-agent`, `git diff --check`, `bash -n packages/company-runtime/bin/weavra` 모두 **PASS**. Biome은 이번 파일 3개를 정리했고 재검사는 변경/경고/정보 없이 통과했다. dependency/lockfile 변경은 없다.
- 문서는 README 두 개·roadmap·현재 작업 이력에 opt-in 계약, exact declared version/installed version 구분, 상태 의미, byte/query bound, advisory-only·summary-only 및 A/B 제한을 반영했다. full `bash ./test.sh`와 actual 최대 1회·exact 구현/closure CI는 아직 미완료다. credential-free metadata에서 기존 `codex-lb/gpt-6-astra`, `openai-responses`, `127.0.0.1:2455` 설정과 설치된 TypeScript language server만 확인했으며 Provider 요청은 하지 않았다.
- 남은 제한: LSP 내부 cache·완전한 call graph/public compatibility·전체 transitive oracle graph를 증명하지 않는다. V0.6A는 D의 실제 CLOSED 및 별도 closure HEAD CI PASS 이후에만 착수한다.

## LOG-090 — 2026-09-20 01:11 (Asia/Seoul) — V0.5D 전체 로컬 gate

**상태:** 전체 로컬 gate PASS. 실제 Astra workflow smoke 한 번을 시작했으며 그 결과는 아직 이 entry에서 판정하지 않는다. V0.5D는 OPEN이고 V0.6A는 미착수다.

- Reviewer 통합·경계 회귀 commit은 `795ae41ad`다. 변경한 소스/테스트와 WORK_LOG만 명시 stage했다. eval harness/A-B/사용 문서는 후속 검증 commit으로 분리한다. 아직 remote push는 하지 않았다.
- heavy suite를 직렬 실행했다. company-runtime 전체 **50 files / 1,385 PASS**, SDK Weavra slice **13 files / 480 PASS**, deterministic eval 전체 **8 files / 35 PASS**.
- 현재 `bash ./test.sh`는 isolated HOME/credential 제거 환경에서 **전체 PASS(exit 0, 228.71초)**. scripts 16, agent 711(1 skipped), ai 1,069(843 skipped), chord 162, client 27, coding-agent **279 passed files / 2,718 PASS·50 skipped**, company-runtime **50 files / 1,385 PASS**, eval **8 files / 35 PASS**, protocol 133, server 44, telemetry 15, sqlite-node 105 및 TUI가 통과했다. 현재 변경 tree에서 실행한 결과이며 과거 V0.5C 숫자를 재사용하지 않았다.
- full 실행의 새 A/B도 clean false-positive/defect miss/false-COMPLETE 없이 통과했다. payload는 run metadata에 따라 소폭 달라졌고 envelope 3,115 bytes, 검사 6→3, 도구 10→7, Provider tokens UNKNOWN이라는 관측은 같았다.
- actual 준비는 repository source aliases를 사용하는 temporary driver에서 production command registration/handler, real SDK/ModelRuntime, 실제 설치된 `typescript-language-server 5.1.3`와 TypeScript `5.9.3`, strict mutation·Verifier trust·required macOS sandbox를 조합한다. `--prepare`는 config/원래 defect 재현만 확인했고 **Provider 호출 0**이다. credential/auth 설정을 복사·변경하거나 fallback을 추가하지 않았다.
- actual은 `/workflow run Fix the label casing bug in src/label.ts`의 production handler 한 번이며 Worker 최대 2회, revision/verification repair 자동 재시도 없음으로 제한했다. UI preflight callback은 driver이므로 실제 TUI rendering 검증이라고 주장하지 않는다. 실제 결과·usage·fresh pack·oracle·writer release는 후속 entry에 기록한다.
- 남은 gate: actual 결과, exact 구현 HEAD CI, 별도 closure docs HEAD CI. stable tag와 dependency/lockfile은 변경하지 않는다.

## LOG-091 — 2026-09-20 01:13 (Asia/Seoul) — V0.5D Astra actual 1회 PASS

**상태:** 허용된 actual smoke를 한 번 실행하여 **PASS**했다. 전체 로컬 gate도 LOG-090에서 PASS다. exact 구현 HEAD와 별도 closure HEAD의 remote CI가 남았으므로 아직 CLOSED로 선언하지 않는다.

- 경로: 기존 `~/.weavra/agent`의 `codex-lb/gpt-6-astra`, `openai-responses`, local endpoint를 사용했다. auth/models 변경·credential 복사·fallback은 없다. production `/workflow run Fix the label casing bug in src/label.ts` 등록 handler, 실제 SDK/ModelRuntime, 별도 Developer/Reviewer session 두 개, 실제 `typescript-language-server 5.1.3`을 사용했다. UI callbacks는 temporary driver이며 TUI rendering 검증은 아니다.
- run `bb7f9bb2-630d-46ab-8c74-150f8d10a689`, revision 0, Task Contract `sha256:14762dfa6be5ff574635795f83e4cb5e023167a37506fd2ffec53ca39197caf7`. 같은 Task Contract·frozen config·scope/check를 유지했고 Developer에는 Reviewer context가 없었다. 원래 case-preservation defect가 실제 oracle에서 실패한 뒤 수정 후 oracle PASS였다.
- Reviewer는 현재 source digest의 `formatLabel` symbol 1개, bounded reference 6개(`src/caller.ts`, `src/label.ts`, `test/label.test.ts`), 관련 test 1개와 declaration을 받았다. references를 완전한 call graph나 6개의 실제 호출로 해석하지 않는다. impact digest `sha256:d3617937a5644bc1552c55c1d964499388d1630d0cc3744d508355e3c873a224`, 2,896 bytes, truncated false.
- C05는 npm manifest의 TypeScript **5.9.3 exact 선언**과 reviewed-local snapshot이 MATCHED였다. documentation pack 913 bytes, matched 1/stale 0/unmatched 0, digest `sha256:17d6a7a6e618dd02576cf2a5b984dae64102c369e6d4fcbf6935b4766ccba500`. 설치/최신 공식 문서 증명으로 승격하지 않았다.
- 추가 envelope 4,289 bytes, digest `sha256:09f5f3eadd8fc5fd91fc95b2af92971e9693f6305d761de2633efba0f7419838`. run/revision/Task Contract/diff/fresh C01 digest binding과 current source digest를 실제 worker prompt에서 확인했다. raw prompt/log를 WORK_LOG에 복사하지 않았다.
- 결과: 독립 Reviewer PASS, authoritative SELF_CHECK/TEST 모두 PASS·strict trust VERIFIED·required macOS sandbox ENFORCED(`srt 0.0.76`), Kernel **COMPLETED**, oraclePass true/falseCompletion false, 보호 oracle·다른 fixture 파일·auth/models 원문 불변, state/evidence raw source/doc body 없음, writer released. Runtime 안전 guard나 등록 check를 완화하지 않았다.
- Provider-reported measurements: Developer 4 turns/6 tools/14,932 tokens/24,545 ms, Reviewer 2 turns/4 tools/13,342 tokens/22,299 ms. 합계 **28,274 tokens / 10 tool calls**, driver 전체 51.38초. 두 worker의 actual provider/model metadata는 `codex-lb/gpt-6-astra`; 별도 response-model echo는 기록되지 않아 **UNKNOWN**이다. reasoning 수치 0은 Provider 보고이며 reasoning 원문은 기록하지 않았다.
- 다음: temporary fixture/driver 정리, eval·문서 commit 및 일반 push, exact 구현 HEAD CI 확인, 별도 V0.5D closure 문서 commit과 exact CI. 추가 actual 재시도는 하지 않는다. Linux actual·다른 모델/OS/Node·일반 모델 성능·TUI rendering·완전한 LSP cache/call graph는 NOT VERIFIED다. V0.6A는 D closure gate 이후에만 시작한다.

## LOG-092 — 2026-09-20 01:22 (Asia/Seoul) — V0.5D bounded closure 판정

**상태:** C04/C05를 현재 명시한 bounded/advisory 범위에서 **CLOSED**로 판정한다. 이 entry는 별도 closure 문서 commit이다. 후속 V0.6A는 이 closure commit의 정확한 remote CI까지 PASS인 것을 확인한 뒤에만 시작한다.

- 구현 commits: `a5db86f1f`(C04), `8e7a638ab`(C05), `795ae41ad`(fresh Reviewer/경계), `0d4e91936`(eval UNKNOWN·A/B·문서/실제 검증). 일반 push 후 정확한 구현 HEAD **`0d4e919366ff71f2915da0bdf19e1df3da9cd6c0`**의 [CI 35454385916](https://github.com/kjg8619/pi/actions/runs/35454385916)를 `gh run watch --exit-status`와 `gh run view`로 확인했다: **completed/success**.
- remote CI의 committed-source build, non-mutating check, isolated full test, launcher syntax, tracked-source-unchanged 및 후처리 모두 PASS다. Ubuntu runner label의 향후 migration 안내 annotation만 있었고 실패/품질 경고는 없었다. 다른 SHA의 CI나 이전 V0.5C 결과로 대체하지 않았다.
- 로컬 proof는 LOG-089~091의 targeted/Runtime 1,385/SDK 480/eval 35/full regression 및 hydrate/static gate와 actual Astra 1회다. 선언 version binding·bounded bytes/query·fresh revision/source/diff·strict nested validation·authority/receipt/evidence 비승격·summary-only/legacy·negative paths를 확인했다. actual은 독립 session, required verification/trust/sandbox, oracle, 최신 Task Contract/diff, Kernel COMPLETE 및 writer release를 확인했다.
- 실제 smoke temporary workspace/session은 driver의 확인된 shutdown 후 제거했고, `/tmp/weavra-v05d-smoke.mts`와 summary JSON도 제거했다. credentials/full conversation/tool logs를 저장소에 추가하지 않았다. README 두 개·roadmap·이 작업 이력만 closure 문서 commit으로 stage한다.
- dependency/lockfile·Kernel authority·Policy·completion guard·stable tag 변경은 없다. 현재 closure는 전체 call graph/public compatibility, LSP 내부 cache 증명, installed/latest documentation, 일반 모델 품질/token 절감, Linux actual/모든 Provider·OS·Node/TUI rendering을 포함하지 않는다.
- 다음 정확한 단계: 이 closure docs commit을 일반 push → **그 exact HEAD CI PASS 확인** → V0.6A read-only Host Bridge 첫 vertical slice(구조화 read-only query/response, observational event, canonical snapshot reconnect). T3 UI나 run/write/start/approval/cancel control, Provider Fitness Matrix, Browser는 구현하지 않는다. 이 entry 시점 closure CI와 V0.6A는 아직 미실행이다.

## LOG-093 — 2026-09-20 01:33 (Asia/Seoul) — D closure CI 확인 및 V0.6A read-only 착수

**상태:** 별도 closure commit **`9331b3ed9ad01fb91bf022220276d35d843a2c62`**의 [CI 35454820292](https://github.com/kjg8619/pi/actions/runs/35454820292)가 **completed/success**다. exact HEAD metadata와 `gh run watch --exit-status` 결과를 확인했다. D의 게시 gate까지 끝난 뒤에만 V0.6A 조사를 시작했다.

- 첫 연결 범위는 protocol-versioned hello/capabilities/status/current-run/graph/evidence-summary/config-summary와 canonical snapshot reconnect, Runtime 관측 event다. runId/stateRevision/eventId/timestamp를 구분하며 event로 authoritative state를 재구성하지 않는다.
- 기존 `FileStateStore.readSnapshot`, graph/evidence projections, RuntimeEventSink와 Host/transport seams를 조사한다. Main이 protocol/구현을 소유하며 read-only scout 두 개가 canonical-state/projection과 transport/lifecycle 경계를 독립 조사한다. 조사 agent는 파일 수정·검증·Provider 호출을 하지 않는다.
- Bridge는 credential/model/session 생성이나 writer lock/recovery를 소유하지 않는다. raw source/docs/prompt/reasoning/tool output/보호 경로를 응답에 복사하지 않는 명시적 projection, strict bounded input/output, unsupported control 거부, disconnect 후 fresh canonical snapshot을 구현·실행 검증한다.
- T3 UI, run/write/start/approval/cancel control, Provider Fitness Matrix, Browser는 이번 연결 범위 밖이다. 실제 Provider 허용 1회는 LOG-091에서 이미 사용했으므로 추가 actual 호출은 하지 않는다. 이 entry 시점 Bridge 소스/테스트는 아직 작성하지 않았다.

## LOG-094 — 2026-09-20 02:04 (Asia/Seoul) — V0.6A read-only 첫 연결 및 실행 proof

**상태:** versioned Host query/response·관측 event·canonical reconnect를 구현했다. 실제 Runtime/SDK + in-memory faux JSONL standalone smoke와 targeted 회귀 PASS. 전체 최종 회귀·push·exact HEAD CI는 아직 실행 전이며 전체 C07을 닫지 않는다.

- 변경: `src/host-bridge-protocol.ts`, `host-bridge-projections.ts`, `host-bridge.ts`, Runtime `test/host-bridge.test.ts`, SDK `test/suite/company-runtime-host-bridge.test.ts`; README 두 개·roadmap·WORK_LOG. 기존 Kernel/Workflow/Policy/StateStore/Verifier guards, Pi RPC dispatcher, deps/lockfile은 변경하지 않았다.
- version 1의 hello/capabilities/status/current-run/graph/evidence-summary/config-summary/snapshot만 허용한다. trusted Host가 root를 고정하며 wire cwd/path/control/unknown field/version을 거부한다. Run state revision·project revision·code revision·event cursor를 분리하고 config는 frozen Run config가 아닌 현재 project config임을 표시한다.
- durable canonical read와 기존 graph/evidence를 allowlist DTO로 투영한다. raw source/docs/prompt/reasoning/tool output·session/protected paths를 보내지 않고 누락/부분 token usage는 UNKNOWN이다. corrupt/orphan/unsafe source는 cached fallback/recovery/write 없이 닫는다. `ownerObserved: false`이므로 writer 존재를 liveness/cleanup 완료로 승격하지 않는다.
- local JSONL은 입력 4 KiB/출력 64 KiB, connection 8/pending 8을 제한한다. client exception/backpressure/disconnect는 Runtime 실행을 취소하거나 writer를 가져오지 않는다. async callback의 rejected promise도 격리한다. supplied streams의 flush/종료는 Host 소유다.
- 첫 Runtime targeted 실행은 7 PASS/7 FAIL이었다. 6건은 historical terminal fixture를 새 live writer 저장 경로로 넣어 올바른 execution-mode/new-run guard에 거부된 테스트 setup 문제였고, 기존 graph test와 같은 raw historical snapshot fixture로 고쳤다. 실제 EOF 버그 1건은 input auto-close가 마지막 async response 전에 detach하던 문제였다. EOF 시 마지막 response 처리를 기다리도록 수정했으며 guard/timeout을 완화하지 않았다.
- Runtime targeted `node ../../node_modules/vitest/dist/cli.js --run test/host-bridge.test.ts`: 최종 **1 file / 17 PASS**. privacy(실제 configured C05 registry body 포함), historical UNKNOWN/current-code check 분리, authority 비승격, source 오류, 독립 revision, exact Run selector, frame/response/pending/connection bounds, client 실패, EOF, permanent observation teardown을 검증했다.
- SDK targeted `node ../../node_modules/vitest/dist/cli.js --run test/suite/company-runtime-host-bridge.test.ts`: **1 file / 1 PASS**. suite harness의 in-memory faux로 실제 StandardWorkflow/Kernel/Policy/SDK/Verifier/StateStore를 실행했다. 실제 Provider는 호출하지 않았다.
- 별도 `/tmp/weavra-v06a-smoke.mts`를 `node_modules/.bin/tsx --tsconfig tsconfig.json /tmp/weavra-v06a-smoke.mts`로 실행: **HOST_BRIDGE_SMOKE_PASS**, 1.82초. Run `d11a56a9-3012-43a8-9ef5-3d468658e168` COMPLETED, Run revision 20/project revision 26/event cursor 18, faux turns 2, actual calls 0. RunCreated snapshot, active reconnect/no replay, cancel 거부, query state bytes/model-call 수 불변, 모든 read query, final RunCompleted/graph, strict SELF_CHECK·TEST PASS, writer release, source 불변을 확인했다. fixture/session은 driver finally에서 정리했다.
- `npm run check` 첫 실행은 optional-chain lint warning 1개로 중단됐다. 해당 표현식만 수정했고 재실행은 **PASS**(Biome 1,447 files·types·dependency/import/entry graph/lock/browser smoke gates). LSP가 기존 C05/reviewerContext 타입의 stale 진단을 반환했지만 실제 tsgo가 통과했으며 타입을 삭제·완화하지 않았다.
- 다음: temporary driver 제거, heavy suite 직렬 실행과 전체 로컬/static gate, explicit-path commit·일반 push·exact HEAD CI. D의 actual 허용 1회는 이미 사용했으므로 추가 실제 Provider smoke는 하지 않는다. T3 UI/control/Provider Matrix/Browser는 범위 밖이며 별도 다음 결정 전 착수하지 않는다. 이 entry 시점 새 변경은 미커밋이다.

## LOG-095 — 2026-09-20 02:21 (Asia/Seoul) — V0.6A 최종 전체 로컬 gate

**상태:** read-only 첫 slice의 구현·실행 proof·최종 로컬 gate PASS. 이 entry를 포함한 변경 9개만 commit/일반 push하고 exact HEAD remote CI를 확인한다. 이 시점 V0.6A remote CI는 아직 실행 전이며, 결과를 다른 HEAD의 success로 대체하지 않는다.

- 후속 경계 점검에서 optional provenance가 없는 실제 Kernel Run의 canonical Task Contract digest를 null로 투영하던 문제를 재현했다(**16 PASS / 1 FAIL**). `host-bridge-projections.ts`가 auxiliary provenance 대신 canonical `run.taskContractDigest`를 읽도록 수정했고 기존 reconnect 테스트를 보강한 재실행은 **17 PASS**다. provenance 부재 때문에 이미 알려진 계약 identity를 UNKNOWN으로 잃지 않는다.
- heavy suite를 직렬 실행했다. Runtime `node ../../node_modules/vitest/dist/cli.js --run test`: **51 files / 1,402 PASS**. SDK `node ../../node_modules/vitest/dist/cli.js --run test/suite/company-runtime test/suite/agent-session-prompt.test.ts`: **15 files / 497 PASS**. SDK filter가 D 단계의 명시적 13-file slice보다 넓으므로 숫자를 같은 표본으로 해석하지 않는다.
- eval `node ../../node_modules/vitest/dist/cli.js --run --config vitest.test.config.ts`: **8 files / 35 PASS**. C04/C05 scripted A/B도 계속 통과했다. full 실행의 clean payload 5,133→8,271 bytes/defect 5,151→8,285 bytes, envelope 3,115 bytes, file inspections 6→3, tools 10→7; clean false-positive·defect miss·false-COMPLETE 없음, Provider tokens UNKNOWN이다.
- 최종 source의 `npm run hydrate:model-data` **PASS**, 현재 upstream catalog **1,411 records**(D 당시 1,409는 역사적 결과). `npm run check`, `npm run check:ci`, `npm run check:shrinkwrap`, `npm run check:install-lock:coding-agent`, `bash -n packages/company-runtime/bin/weavra`, `git diff --check` 모두 **PASS**. Biome 1,447 files에서 변경/경고 없이 통과했다.
- **`bash ./test.sh` 전체 PASS(exit 0, 217.23초)**. isolated HOME/API credentials 제거 환경에서 scripts 16, agent 711(1 skipped), ai 1,069(843 skipped), chord 162, client 27, coding-agent **280 passed files / 2,719 PASS·50 skipped**, company-runtime **51 files / 1,402 PASS**, eval **8 files / 35 PASS**, protocol 133, server 44, telemetry 15, sqlite-node 105, TUI가 통과했다. TUI dot reporter는 총수를 출력하지 않았으므로 수치를 추정하지 않는다. 이 full 실행은 위 digest 수정 이후의 source다.
- LOG-094의 standalone real-Runtime/faux smoke driver를 제거했다. fixture/session은 driver가 이미 정리했다. 추가 actual Provider 호출은 없고 D의 단 한 번 `codex-lb/gpt-6-astra` 실제 결과는 LOG-091 그대로다. auth/models/deps/lockfile/stable tag는 변경하지 않았다.
- commit 범위는 새 source 3개·테스트 2개와 README 두 개·roadmap·WORK_LOG 총 9개다. `git status --short --branch`에서 현재 `devlop`과 이 파일들만 확인했다. 기존 Kernel/Policy/Verifier/writer guards, timeout, Pi RPC/control surface는 수정하지 않았다.
- 한계: durable state만 관찰하며 Host-local error/report·worker liveness/cleanup을 보증하지 않는다. no replay, no raw data dump, no default network/launcher service다. 첫 read-only slice이지 전체 C07 완료가 아니다. 다음 작업은 이 commit의 exact CI까지 확인한 뒤 멈추는 것이며 T3 Host/UI·execution control·Provider Matrix·Browser는 별도 후속 범위 결정 전 착수하지 않는다.

## LOG-096 — 2026-09-20 02:32 (Asia/Seoul) — V0.6A 첫 read-only slice 원격 검증

**상태:** read-only 첫 vertical slice의 구현·실행·전체 로컬·remote gate를 확인했다. 전체 V0.6A/C07 완료로 확대하지 않는다. 이 entry와 README 두 개·roadmap은 관측한 결과만 기록하는 별도 문서 commit이다.

- 구현 commit **`bacbb778e6fb11caca90da7059011056892a78cf`**, `feat: add read-only Runtime Host bridge`. 명시한 source 3개·test 2개·문서 4개만 stage/commit하고 `git push origin devlop`으로 일반 push했다. force/tag 변경은 없었다. Git의 기존 자동 committer 설정 안내는 있었지만 사용자 global identity/config를 임의 변경하지 않았다.
- `gh run list --repo kjg8619/pi --branch devlop --commit bacbb778e6fb11caca90da7059011056892a78cf --event push`로 정확한 실행을 선택하고 `gh run watch 35457968130 --repo kjg8619/pi --exit-status --interval 30` 및 `gh run view ... --json headSha,headBranch,status,conclusion,url,jobs`로 확인했다. [CI 35457968130](https://github.com/kjg8619/pi/actions/runs/35457968130): exact HEAD, `devlop`, **completed/success**, build-check-test 7분 27초.
- committed-source build, non-mutating check, isolated full test(no Provider credentials), launcher syntax, tracked-source-unchanged와 후처리 모두 PASS다. Ubuntu-latest의 향후 Ubuntu 26 migration 안내 annotation만 있었고 code/test gate 실패는 없었다.
- 이 결과는 D 구현/closure CI 뒤 착수한 별도 V0.6A source의 결과다. D의 actual Astra 1회는 LOG-091, V0.6A의 실제 Runtime/SDK·local JSONL·in-memory faux proof는 LOG-094, 최종 로컬 수치/명령과 EOF·canonical digest 수정은 LOG-094~095를 따른다. 추가 actual Provider/model 호출은 하지 않았다.
- README·Runtime README·roadmap의 현재 상태를 첫 read-only slice 완료로 갱신했다. 전체 C07, T3 application/UI, execution control, network service/auth, replay, Provider Matrix, Browser와 owner-local liveness/cleanup은 미구현/미검증 경계를 그대로 유지한다.
- 다음: 이 검증 기록 문서 commit을 일반 push하고 **그 exact HEAD CI도 확인**한 뒤 종료한다. 이 entry 시점 문서 commit/CI는 아직 실행 전이다. 이후 작업은 T3 Host의 transport/owner-state 및 read-only 소비 계약을 별도 범위로 결정하는 단계이며, 이번 작업에서 UI/control로 계속 확장하지 않는다.

## LOG-097 — 2026-09-20 10:33 (Asia/Seoul) — C07 두 번째 실제 read-only 연결

**상태:** 실제 Runtime/Host Bridge/T3 backend/frontend 연결·단절·재연결 proof 확보. 최종 전체 검증·commit/push·exact remote 판정은 진행 중이며 전체 C07은 OPEN이다.

- 시작점: Weavra `devlop` local/tracking/actual remote 모두 `5ee094c2b50505045e8c1f8023052e890d2ffa07`, 별도 인접 checkout의 T3 `devlop`은 모두 `d6f291303ddc0c9a14f570266a4d9eff6d431593`였다. stable RC tag와 main은 이동하지 않는다.
- Weavra 변경: `bin/weavra`, `src/launcher-bridge.ts`, `host-bridge-protocol.ts`, `host-bridge.ts`, 두 bridge 테스트, README 두 개·roadmap·이 작업 이력. 정확한 `bridge --stdio --project-trusted` 전용 child, runtime/protocol/transport/readiness handshake, doctor 기반 로컬 준비 상태를 추가했다. Pi session/worker/writer를 시작하거나 setup·repair하지 않는다.
- T3 변경: contracts의 schema/RPC/environment capability, authenticated `weavra.observe`의 `orchestration:read`, server `weavra/BridgeTransport`·`RuntimeObserver`와 기존 service wiring, client-runtime session/cache와 Project Settings의 read-only Weavra section, 경계 회귀와 기존 development guide. `.ai` 직접 접근·browser 실행경로 설정·새 network listener·control API는 없다.
- 계약: trusted server-local 절대 executable, authorized ProjectId의 canonical cwd; 4,096/65,536-byte JSONL, strict schema/UTF-8/correlation, outstanding 1·timeout 10초·snapshot polling 2초·transport 재접속 5초·SIGTERM 후 2초 force kill. root/프로젝트 존재를 read 전후 검증하고 project/same-Run revision 후퇴·이전 session/cache 결과를 거부한다. standalone은 snapshots-only이며 event replay/가짜 Runtime event를 만들지 않는다.
- read-only review에서 중복 child finalizer의 무기한 kill 대기, healthy child의 project root 재검증 누락, root 없는 frontend cache key, backend 재생성 후 첫 snapshot revision 후퇴를 찾아 수정했다. 현재 transport/service 회귀 **2 files / 23 PASS**에는 SIGTERM을 무시하는 실제 child의 bounded shutdown도 포함한다. source state나 writer cleanup 권한은 확장하지 않았다.
- 현재 T3 targeted 결과: contracts **2 PASS**, client state **5 PASS**, auth/service 묶음 **13 PASS**, authenticated server RPC **1 PASS / 194 skipped**. 서로 겹치는 실행은 합산하지 않는다. full `pnpm run typecheck`는 **15 tasks, exit 0**이며 기존 Effect suggestion 879개가 출력됐다. root lint는 exit 0이나 기존 경고와 신규 array-index key 경고가 있었고 신규 key를 고쳤다. knip은 신규 unused protocol constant 1개를 지적해 references 확인 후 제거했으며 최종 재검사는 아직 전이다.
- 실제 proof: 사용자 승인으로 unavailable built-in preview 대신 isolated managed Chromium을 사용했다. 임시 HOME/Weavra home/T3 home/프로젝트와 real CompanyKernel/FileStateStore fixture만 사용했고 agent/check/Provider는 실행하지 않았다. 실제 executable/프로젝트를 기존 T3 UI로 등록해 CONNECTED·Run/Task Contract digest·graph·evidence·UNKNOWN usage를 확인했다. Weavra section의 실행/편집 controls는 0개였고 raw task 본문은 노출되지 않았다.
- 관찰 child만 SIGTERM으로 종료하자 DISCONNECTED + STALE이 되었지만 durable RUNNING·state.json bytes·writer.lock bytes와 별도 Runtime owner 생존이 유지됐다. 별도 fixture owner가 만든 새 canonical Run/project revision 2→4를 자동 재연결 뒤 관찰했다. executable 미설정 시 실제 NOT_INSTALLED/NO SNAPSHOT·설정 안내·graph/evidence unavailable을 확인했다. 지원 Node 24.19.0으로 T3 server 실제 executable과 CONNECTED를 다시 확인했다.
- Weavra 최초 targeted는 **2 files / 24 PASS**였다. 뒤의 정확한 frame 경계 검사에서 4,096-byte 본문 + LF를 허용하는 off-by-one을 **1 PASS / 1 FAIL**로 재현해 LF 포함 bound로 수정했다. 최종 재검사는 별도 기록한다. `npm run hydrate:model-data`는 ignored JSON **1,411 records**, 최신 `npm run check`는 **PASS**, Biome 1,449 files·types·dependency/import/entry/lock/browser gates, 최종 수정/경고 없음이다.
- 남은 작업: 양쪽 전체 tests/static/build, 문서 마무리, scoped commit·일반 devlop push, Weavra exact HEAD CI 및 T3 exact HEAD CI/non-trigger 확인. credentials/pairing URL/full logs는 기록하지 않는다. owner liveness·paid-provider E2E·다른 OS·execution control은 증명하거나 제공하지 않으며 다음 control slice로 진행하지 않는다. 이 entry 시점 신규 변경은 미커밋이다.

## LOG-098 — 2026-09-20 11:08 (Asia/Seoul) — T3 전체 gate와 검증 환경 수정

**상태:** T3 실제 연결 source의 전체 test/static/build를 실행했다. 기존 검증 fixture 두 곳을 수정했으며 제품 동작·timeout·assertion을 완화하지 않았다. Weavra 나머지 전체 gate와 양쪽 게시/remote 판정은 아직 진행 중이다.

- Node **24.19.0**, pinned pnpm **11.10.0**으로 실행했다. 초기 isolated HOME에서 pnpm의 global virtual store 기본값이 설치 상태와 달라 자동 재설치를 시도했으나 non-TTY 보호로 중단됐다. 이후 `--config.ignore-scripts=true --config.verify-deps-before-run=error --config.enable-global-virtual-store=false --config.store-dir=/Users/kangjingoo/Library/pnpm/store/v11`로 기존 설치 상태를 고정했다. 의존성/lockfile 변경이나 purge는 하지 않았다.
- 첫 `pnpm run test`는 macOS `/tmp`와 `/private/tmp`의 identity 차이로 50개 테스트가 실패했고, GitManager의 기존 cross-repo fixture 1개가 외부 Git URL을 조회하다 timeout됐다. canonical `HOME=/private/tmp/... TMPDIR=/private/tmp`에서 해당 10 files 재실행은 **398 PASS / 1 FAIL**로 경로 문제를 해소했다.
- `apps/server/src/git/GitManager.test.ts`의 기존 `configureVisibleRemoteUrlWithLocalRewrite`를 재사용해 fake GitHub URL을 local bare repo로 연결했다. 단일 회귀는 **1 PASS / 112 skipped**, 이후 credentials를 제거한 `env -i ... pnpm ... run test` 전체는 **14 tasks / 1,264 passed files·7 skipped files / 17,194 PASS·58 skipped / exit 0, 311.08초**다. 서버 부분은 **337 passed files·2 skipped / 5,198 PASS·10 skipped**이며 새 read-only 경계 테스트도 포함한다.
- reviewed `apps/desktop`의 `pnpm run ensure:electron`은 pinned Electron **44.4.2**를 ignored 설치 경로에 준비했다. `pnpm run build:desktop`은 web→server→desktop의 기존 의존 task **5개 모두 PASS**했다. 기존 Effect CJS bundle의 `import.meta` 경고는 남아 있으며 새 suppression은 추가하지 않았다.
- 후속 `node apps/desktop/scripts/verify-preload-bundle.mjs`는 기존 sandbox에 `window`가 없어 macOS preload의 DOM lifecycle listener 등록에서 실패했다. `verify-preload-bundle.test.mjs`의 non-callable API 거부 사례에 lifecycle 등록을 추가해 **1 FAIL / 8 PASS**를 재현한 뒤, verifier의 sandbox에 실제 표준 `EventTarget`을 제공했다. 재실행 **9 PASS**와 **실제 built preload 검증 exit 0**을 확인했다. DOM callback을 조기 실행하거나 API 검증을 생략하지 않았으며 제품 preload는 변경하지 않았다. 이 수정은 위 전체 test 실행 이후이므로 해당 전체 결과와 후속 9-test 결과를 구분한다.
- 최종 `vp fmt`(수정한 검증 파일 3개), `vp check`, `pnpm run typecheck`, `pnpm run knip:check`가 모두 **exit 0**이다. format **3,954 files**, lint **0 errors / 기존 722 warnings**, typecheck **15 tasks**, 기존 Effect suggestion **879개**다. 신규 Weavra 경고/unused export는 해소했으며 기존 전역 경고를 이번 기능과 무관하게 대량 수정하지 않았다.
- Weavra LF boundary 수정 후 targeted는 **2 files / 26 PASS**, company-runtime 전체는 **52 files / 1,411 PASS**다. 이전 LOG의 24/1,402 등과 구분한다. SDK/eval/check:ci/isolated full gate는 다음 기록에서 실제 결과를 남긴다.
- 실제 proof용 browser tab과 temporary driver 두 개는 종료/제거했다. 별도 fixture owner도 종료했으나 disposable fixture의 writer lock은 남아 있다. 이를 writer release나 Runtime 종료 판정으로 기록하지 않는다. T3는 durable RUNNING과 owner UNKNOWN을 계속 구분하며 orphan recovery/lock 삭제를 하지 않는다. isolated T3 앱/fixture는 확인용으로 유지한다.
- 변경은 아직 미커밋이다. 검증 fixture 수정은 T3 read-only feature와 구분해 기록·commit하고, 양쪽 `devlop` 일반 push 및 exact SHA CI/non-trigger를 확인한다. C07 전체와 control slice는 OPEN/미착수다.

## LOG-099 — 2026-09-20 11:21 (Asia/Seoul) — 양쪽 최종 로컬 검증 및 scoped 게시 준비

**상태:** 두 번째 read-only slice의 실제 연결 proof와 양쪽 최종 로컬 gate를 확보했다. T3는 scoped commit 두 개를 만들었고, Weavra commit·양쪽 일반 push·exact remote CI 판정은 아직 전이다.

- 현재 Weavra SDK `node ../../node_modules/vitest/dist/cli.js --run test/suite/company-runtime test/suite/agent-session-prompt.test.ts`: **15 files / 497 PASS**, 58.55초. eval `node ../../node_modules/vitest/dist/cli.js --run --config vitest.test.config.ts`: **8 files / 35 PASS**, 6.05초. Node **24.19.0**과 canonical macOS temporary path에서 실행했으며 faux/등록 check만 사용했다.
- `npm run check:ci`: **PASS**, 5.92초. Biome **1,449 files**, no fixes/warnings; pinned/runtime deps·TS import·entry graph·shrinkwrap·coding-agent install lock·types·browser smoke가 통과했다. LOG-097의 hydrate/check와 구분되는 현재 non-mutating 실행 결과다.
- 첫 `bash ./test.sh`는 제가 제한한 PATH에서 기존 `~/.kimi-code/bin/fd`를 빠뜨려 coding-agent find 관련 **11 FAIL / 2,708 PASS**였다. 다른 패키지는 통과했다. 제품 코드·테스트 assertion·timeout을 바꾸지 않고 설치된 **fd 10.4.2** 경로를 PATH에 복원했다.
- 복원 후 **`bash ./test.sh` 전체 PASS(exit 0, 198.04초)**. Node 24.19.0, isolated HOME/API credentials 제거 환경이다. scripts **16**, agent **711·1 skipped**, ai **1,069·843 skipped**, chord **162**, client **27**, coding-agent **280 passed files / 2,719 PASS·50 skipped**, company-runtime **52 files / 1,411 PASS**, eval **8 files / 35 PASS**, protocol **133**, server **44**, telemetry **15**, sqlite-node **105**, TUI가 통과했다. TUI dot reporter 총수는 추정하지 않는다. full script가 생성한 temporary root는 자체 cleanup으로 제거했다.
- T3 full **17,194 PASS·58 skipped**, 후속 preload regression **9 PASS**와 실제 built bundle 검증, final format/lint/typecheck/knip, web/server/desktop build는 LOG-098의 현재 실행 기록이다. desktop native UI 실행·다른 OS·paid-provider E2E를 검증했다고 확대하지 않는다. 사용한 isolated validation HOME도 제거했으며 실제 UI 확인용 T3 앱/fixture는 별도 경로에 유지한다.
- T3 `devlop` commit **`79d2f02a74253319aa186807ae5d1220af554cbd`**(`fix: isolate Git and preload validation fixtures`, 검증 파일 3개), **`8486dbd480b2077e3520ce57f807b2154d7c715b`**(`feat: observe Weavra Runtime through a read-only bridge`, 구현/회귀/기존 development guide 21개). 기존 pre-commit formatter를 통과했고 worktree는 clean이다. deps/lockfile은 변경하지 않았다.
- Weavra는 launcher·handshake/transport·회귀 6개와 README 두 개·roadmap·WORK_LOG 4개, 총 **10 files**만 commit한다. 실제 원격 devlop 조회가 양쪽 시작 SHA와 일치해 rebase는 필요 없었다. main과 immutable `weavra-v0.1-rc1`을 변경하지 않는다.
- 다음: 명시 경로 commit·양쪽 non-force devlop push → Weavra의 exact 구현 HEAD CI 확인 → T3 exact HEAD의 실행 여부와 workflow trigger 확인 → 관측한 결과를 별도 문서 commit으로 기록하고 그 Weavra final HEAD CI도 확인한다. 이 entry는 아직 실행하지 않은 remote gate를 PASS로 기록하지 않는다. read-only 완료는 전체 C07 closure나 control 착수가 아니다.

## LOG-100 — 2026-09-20 11:33 (Asia/Seoul) — 두 번째 read-only slice 원격 판정

**상태:** 실제 연결·양쪽 로컬 gate·일반 devlop 게시와 Weavra 구현 exact CI를 확인했다. T3 remote CI 미실행은 PASS로 바꾸지 않는다. 이 entry와 README 두 개·roadmap은 별도 검증 기록 문서 commit이며, 그 Weavra final HEAD CI는 게시 후 별도로 확인한다.

- Weavra 구현 **`2f78224513b8cb9427c51f7b08eae28e233576b1`**, `feat: expose standalone read-only Weavra bridge for T3`, 명시한 10 files만 commit했다. 시작 `5ee094c2b50505045e8c1f8023052e890d2ffa07`에서 일반 push가 성공했다.
- `gh run list --repo kjg8619/pi --branch devlop --commit 2f78224513b8cb9427c51f7b08eae28e233576b1 --event push`, `gh run watch 35483948383 --repo kjg8619/pi --exit-status --interval 30`, `gh run view ... --json headSha,headBranch,status,conclusion,url`로 [CI 35483948383](https://github.com/kjg8619/pi/actions/runs/35483948383)의 exact SHA·devlop·**completed/success**를 확인했다. build-check-test **7분 32초**다.
- remote Node 22에서 committed-source build·non-mutating check·isolated full test·launcher syntax·tracked-source unchanged·후처리 모든 step이 success다. Ubuntu runner label의 향후 migration 안내 annotation이 있었으며 실패 step은 없다. 이는 현재 구현 SHA의 결과이고 이전 첫 slice CI를 재사용한 것이 아니다.
- T3는 시작 `d6f291303ddc0c9a14f570266a4d9eff6d431593`에서 검증 fixture commit `79d2f02a74253319aa186807ae5d1220af554cbd`와 read-only feature commit **`8486dbd480b2077e3520ce57f807b2154d7c715b`**를 일반 push했다. 기능 21 files와 검증 3 files를 분리했으며 전체 로컬 수치·preload 후속 수정 시점은 LOG-098~099 그대로다.
- T3 exact SHA의 `gh run list --repo kjg8619/t3code --commit 8486dbd480b2077e3520ce57f807b2154d7c715b`는 **0 runs**, GitHub commit `check-runs` API는 **total_count 0**, 열린 `devlop` PR 조회도 **0개**였다. `.github/workflows/ci.yml`은 `main` push와 pull_request만 받고 workflow_dispatch가 없다. 따라서 remote CI는 **NOT RUN / devlop non-trigger**이며 green 판정이 아니다. workflow/main을 바꾸거나 임의 PR을 생성하지 않았다.
- 양쪽 push는 `git -c push.followTags=false push origin devlop`으로 수행했다. force/tag/main push, rebase, dependency/lockfile 변경은 없다. 최종 문서 게시 후 local/tracking/actual remote HEAD·clean tree·immutable RC tag를 다시 확인한다.
- 실제 chain은 **pi/devlop Runtime → Host Bridge → t3code/devlop Backend Adapter → T3 frontend**다. browser CONNECTED/graph/evidence·관찰 child 단절 시 STALE·durable RUNNING 보존·fresh canonical reconnect와 NOT_INSTALLED를 확인했다. 관찰과 독립된 fixture owner의 생존 proof가 있었지만, 이후 owner 종료 시 남은 fixture lock을 release/liveness 증명으로 해석하지 않는다.
- 전체 C07은 OPEN이다. start/resume/cancel/approve/reject/write/edit·Task Contract 변경·Policy/PASS/COMPLETE 권한·새 network service·event replay는 추가하지 않았다. 실제 화면 검증은 macOS/Node 24.19.0의 isolated Chromium이며 paid-provider/desktop native UI/다른 OS의 actual 연결은 미검증이다. 다음 control slice를 시작하지 않고 이 문서 commit의 exact CI와 최종 repo 상태 확인에서 멈춘다.

## LOG-101 — 2026-09-20 13:39 (Asia/Seoul) — C07 control 구현 및 첫 회귀 검증

**상태:** control 구현과 첫 targeted 회귀를 진행했다. 전체 C07은 OPEN이다. 이번 작업의 시작점은 Pi `devlop` **`e4c805f7223ab5ad14f2c8e30406a79c731ff38f`**, T3 `devlop` **`8486dbd480b2077e3520ce57f807b2154d7c715b`**이며 local/tracking/actual remote 일치와 clean 상태를 확인하고 시작했다.

- 목적·변경: Pi의 `host-control-protocol.ts`, `host-control.ts`, `host-workflow.ts`, `launcher-control.ts`를 추가하고 `extension.ts`·`workflow.ts`·`host-bridge.ts`·`bin/weavra`를 연결했다. T3는 별도 control contracts/RPC/capability, server-owned owner transport/controller, 공용 client state/command, 실제 Settings의 `WeavraControls.tsx`를 추가했다. legacy read-only v1 endpoint와 권한은 유지한다.
- 권한: goal·recipe input·AC prose만 입력받고 Runtime이 classification·scope·checks·Task Contract·Plan Preview를 생성한다. confirm은 명시적 확인이며 ACK와 canonical Run outcome을 구분한다. cancel은 기존 abort/cleanup을 사용하고 partial workspace를 되돌리지 않는다. R3는 기존 one-file deletion의 pending identity와 expected revisions만 받아 Runtime이 grant를 검증·소비한다. arbitrary write/edit/tool/shell·Policy/PASS/COMPLETE·COMPLEX·generic R3·network Host·Provider fallback은 추가하지 않았다.
- 재연결: owner epoch·monotonic Runtime-issued request ID·최근 64개 payload-bound receipt로 bounded idempotency를 구현했다. browser/RPC caller 종료는 실행 owner를 종료하지 않고 mutation을 자동 재전송하지 않는다. owner 종료 시에는 기존 cancellation과 cleanup을 기다린다. orphan writer를 자동 recovery/release하지 않는다.
- 현재 실행한 Pi targeted 검증: coding-agent package의 `node .../vitest/dist/cli.js --run test/suite/company-runtime-control.test.ts` **33 PASS**(real Git·SDK/faux Provider·실제 check, 10.04초). company-runtime의 `test/extension.test.ts test/host-bridge.test.ts test/launcher-bridge.test.ts` **52 PASS**(2.98초). 이후 control pipe backpressure/invalid UTF-8 회귀와 기존 host bridge를 함께 실행해 **24 PASS**(2.23초). 숫자는 서로 중복되는 targeted 실행이며 전체 회귀 합계로 더하지 않는다.
- 현재 실행한 T3 targeted 검증: isolated HOME `/private/tmp`·Node 24.19.0에서 `vp test run`을 package별 실행했다. client의 새 control+기존 observation **28 PASS**, web control interaction **10 PASS**, real child ControlTransport **14 PASS**다. RuntimeController 첫 실행은 **9 PASS / 1 timeout**이었다. NOT_SETUP 종료 marker와 `entry.stopped` publication 순서의 경합을 수정한 뒤 controller+authorization **18 PASS**(2.31초)를 확인했다.
- contracts의 default RPC decode에서 nested authority field가 묵시적으로 제거되는 실패를 재현했다. 설치된 Effect 4는 기존 `parseOptions` annotation을 적용하지 않으므로 raw RPC input에 strict decoder predicate를 먼저 적용하는 방식으로 수정 중이다. 이 수정의 재실행 결과는 아직 기록하지 않는다. 전체 UTF-8 request bytes 제한은 별도 회귀로 확인했다.
- `npm run hydrate:model-data` **PASS**: ignored JSON catalog 1,410 tool-capable models를 hydrate했다. 이어 `npm run check` **PASS**(5.91초): Biome 1,455 files 중 6개 format 적용, pinned/runtime deps·TS import·entry graph·shrinkwrap·install lock·tsgo·browser smoke 통과. LSP는 reload 후에도 과거 imported type shape를 반환해 도구 오류를 보고했으며, 현재 source의 실제 compiler check 결과와 구분한다.
- 한계·다음: 실제 CLI→T3 backend→browser의 Start/COMPLETE·cancel/writer release·R3 approve/reject·reconnect는 아직 실행 전이다. 전체 양쪽 regression/build, docs, scoped commit/push와 exact CI도 남았다. V0.6B research는 C07의 보수적 CLOSED 판정 이후에만 진행한다. 현재 commit/push는 없고 immutable stable tag·main·deps/lockfile은 변경하지 않았다.

## LOG-102 — 2026-09-20 14:03 (Asia/Seoul) — 전체 Pi 회귀와 실제 T3 COMPLETE 확인

**상태:** C07 control 검증 진행 중이며 아직 OPEN이다. 실제 browser의 첫 workflow는 canonical COMPLETED까지 확인했다. cancel·R3 approve/reject·보안 통합 시나리오와 게시·exact CI가 남았다.

- 현재 Pi `bash ./test.sh` **PASS**(207.08초): isolated HOME·Node 24.19.0·fd 10.4.2를 사용했다. coding-agent **281 files / 2,752 PASS / 50 skipped**, company-runtime **53 files / 1,413 PASS**, eval **8 files / 35 PASS**를 포함한 전체 스크립트 exit 0이다. 다른 package의 skip을 실행한 것으로 합산하지 않는다.
- `npm run check:ci` **PASS**(5.95초): Biome 1,455 files, 수정 없이 모든 base gate 통과. 별도로 `npm run check:shrinkwrap`, `npm run check:install-lock:coding-agent`, `bash -n packages/company-runtime/bin/weavra`도 **PASS**다. 정확한 launcher 경로는 root `bin/weavra`가 아니라 `packages/company-runtime/bin/weavra`다.
- T3 default RPC strict boundary 수정 후 새 control+기존 observation contracts **11 PASS**. 영향 server 7 files **257 PASS**(25.98초: server 195, old transport 17, control transport 14, controller 10, observer 6, environment 7, authorization 8)를 확인했다. 이후 Effect public `Schema.fromJsonString`·effectful decoder와 module-level compilation으로 type/lint 문제를 수정하고 control contracts **9 PASS**, transport/controller **24 PASS**, web **10 PASS**를 다시 실행했다.
- T3 UI는 render-time `Date.now()` 대신 서버 canonical observation timestamp로 preview/approval 만료를 판정하고, latest command guard ref는 layout effect에서 갱신한다. 만료된 canonical 관측에서 Confirm이 비활성화되는 회귀를 기존 UI test에 포함했다. Runtime의 최종 만료·revision 검증은 그대로다.
- pnpm export metadata 변경 감지 때문에 실행 전 verification이 막혔으나 `install --offline --frozen-lockfile --ignore-scripts`와 기존 store를 사용해 metadata만 정합화했다. lockfile resolution 변경·다운로드·lifecycle 실행은 없었다. 최종 `typecheck`, `fmt:check`(3,964 files), `knip:check` 연속 실행 **PASS**(31.15초), `build:desktop` **PASS**(24.26초), lint exit 0이다. 기존 Effect suggestions·다른 기능의 lint 경고 및 desktop dependency의 `x11`/CJS `import.meta` 경고가 있어 전체 저장소가 warning-free라고 주장하지 않는다. 전체 T3 test는 현재 실행 중이다.
- 실제 연결: 격리한 HOME/WEAVRA_HOME·T3 data directory와 네 개의 tracked Git fixture를 생성했다. 실제 checkout launcher doctor **READY**와 loopback faux OpenAI-compatible Provider를 사용하며 외부/유료 Provider 호출은 없다. 실제 T3 backend 14173·web 6133에서 onboarding·project 등록·Settings → Project scope → Project 화면을 통해 제어했다. live 사용자 DB는 사용하지 않았다.
- 실제 COMPLETE: `complete` fixture에서 goal 입력 → Runtime preview → AC prose 편집 → Confirm 비활성화 → Runtime preview 재생성 → 별도 명시 confirmation dialog를 확인했다. 그때까지 faux Provider 호출은 **0**이었다. 확인 후 Run `8f6e364e-48f0-4d54-973d-f88e86f6404a`가 **COMPLETED / COMPLETE**, Run revision **19**, project revision **25**, active agents **0**, writer **false**, independent review **PASS**, current checks **2 PASS**, AC **1 met**로 관측되었다. 실제 `src/app.js`는 `fixed`가 되었고 Developer write/handoff와 Reviewer review 총 **3 Provider calls**만 기록되었다.
- 화면상 command ACK는 여전히 `accepted`이며 canonical terminal state와 별도로 표시된다. 수정된 AC의 frozen Task Contract digest는 preview와 durable Run에서 일치했다. 실제 preview·confirmation dialog·COMPLETED/writer-false 화면을 screenshot으로 확인했다. 이는 faux Provider를 사용한 Runtime/Kernel 통합 proof이지 실 Provider 품질 평가가 아니다.
- 남은 작업: blocked Developer cancel 후 partial 보존·resource cleanup·writer release, 실제 R3 approve/reject, disconnect/reconnect·보안 boundary, 전체 T3 regression 결과 확인, 문서·scoped commit/push·exact CI·최종 closure다. V0.6B research/구현은 아직 시작하지 않았다. 현재 commit/push는 없고 두 repo의 main·immutable tag는 변경하지 않았다.

## LOG-103 — 2026-09-20 14:23 (Asia/Seoul) — C07 actual control acceptance와 보안 smoke 완료

**상태:** 실제 로컬 control acceptance와 양쪽 전체 회귀를 확인했다. scoped 게시·현재 exact HEAD CI 전이므로 전체 C07은 OPEN이다. V0.6B research/구현은 아직 시작하지 않았다.

- 실제 취소·재연결: Run `9174f7d2-d28b-4b9f-843c-0d72df541bb9`의 Developer가 `src/app.js`를 변경한 뒤 faux SSE 응답을 대기하게 했다. browser를 `about:blank`로 이동해 connection을 종료해도 canonical **RUNNING / revision 4 / active Developer / writer true**가 유지됐다. 다시 같은 화면에서 같은 Run을 관측하고 Cancel modal을 확인했다. 이후 **CANCELLED / revision 6 / project revision 8 / active agents 0 / writer false**, faux Provider stream close, 파일 `partial after cancel` 보존을 확인했다. ACK를 terminal outcome으로 사용하지 않았다.
- 실제 R3에서 통합 오류를 찾았다. Runtime `workerDigest()`는 **접두사 없는 64자리 SHA-256 hex**인데 T3 `WeavraControlApproval.preconditionDigest`가 Task Contract와 같은 `sha256:` 형식을 요구했다. 첫 Run `e0156cc2-371c-4f58-a134-02a85236bf4f`는 `INVALID_PAYLOAD`로 control이 닫히며 기존 owner cleanup을 거쳐 CANCELLED가 됐다. T3 계약을 native fingerprint에 맞추고 prefixed fake fixture를 client/controller/UI에서 정정했다. 잘못된 접두사를 거부하면서 native fingerprint를 수신하는 contract 회귀를 추가했다. Runtime fingerprint/approval 권한을 완화하지 않았다.
- 수정 후 실제 R3 승인: Run `86ef62bb-9629-48bd-94c8-bf43dadd6cb9`, pending `add76063-7dd1-4b90-ae04-ce8b68a8935a`의 path·bytes·fingerprint·revision·expiry와 별도 **Approve ONE deletion** modal을 확인했다. Runtime durable approval **CONSUMED**, Run **COMPLETED / revision 22 / project revision 36 / active agents 0 / writer false**, 실제 파일 삭제·독립 Reviewer PASS·checks 2 PASS·AC 1 met를 확인했다.
- 실제 R3 거절: Run `e7d22587-0096-4f88-bd53-cce21d6baf1d`, pending `05d86933-e0c2-4b09-b176-eac8b92c8a16`에서 Reject를 선택했다. durable approval **DENIED**, Run **BLOCKED / revision 8 / project revision 8 / active agents 0 / writer false**, 원본 `original` 보존, checks/review/COMPLETE 미진입을 확인했다. 네 시나리오 모두 실제 T3 화면과 실제 launcher/Runtime/SDK·로컬 faux Provider를 사용했다. paid-provider 품질 판정은 아니다.
- 별도 actual launcher security script **PASS**(2.60초): Policy/PASS/COMPLETE 입력 위조와 과대 goal은 INVALID_REQUEST, 직접 write는 UNSUPPORTED_COMMAND, stale project는 STALE_PROJECT, forged Run/preview는 RUN_NOT_FOUND/PLAN_NOT_FOUND로 거부됐다. 거부된 입력에서 Provider 호출과 파일 변경은 없었다. 실제 성공 confirm을 재전송해 **같은 receipt·Run 1개**를 확인했고 새 ID의 소비된 preview는 PLAN_CONSUMED, 재시작 전 owner ID는 OWNER_CHANGED, canonical root 이동은 PROJECT_CHANGED였다. invalid UTF-8와 32 KiB 초과 frame은 bridge를 안전하게 닫았다.
- 브라우저 CDP에서 네 프로젝트의 실제 수신 WebSocket **71 frames / canonical control 포함 5 frames**와 UI를 검사했다. synthetic credential/source sentinel 노출은 **0**이었다. raw frame/body·credential·전체 conversation/tool log는 문서에 저장하지 않는다. approval replay·stale Run/approval revision·forged project·disconnected command는 현재 SDK/T3 회귀의 거부 및 무재전송 assertion으로 추가 확인했으며 모두 실제 browser에서 공격했다고 확대하지 않는다.
- fingerprint 수정 후 targeted contract **10 PASS**, client **23 PASS**, controller **10 PASS**, web **10 PASS**. 최종 typecheck+fmt:check **PASS**(23.55초, 3,964 files). 초기 T3 전체 `pnpm test`는 `server.test.ts`의 browser-session bootstrap POST에서 localhost connect ETIMEDOUT **1건**으로 exit 1이었다(335.90초). shell coalescing/Weavra RPC 실행 이전의 연결 실패였으며 mock 변경의 원인 증거는 없었다.
- 환경 변수를 제거한 isolated HOME에서 `node node_modules/vite-plus/bin/vp run -r --concurrency-limit 1 test`로 모든 package를 순차 실행했다. **14 package commands / 1,269 files / 17,262 tests PASS / 7 files·58 tests skipped / exit 0**(350.73초). server는 **339 files / 5,223 PASS / 10 skipped**다. 테스트 삭제·timeout 증가·자동 재시도·실패 억제 없이 통과했다. 첫 실패를 삭제하지 않으며 OS-level transient 원인을 확정·해결했다고 주장하지 않는다.
- 문서: root README·Runtime README·roadmap·T3 `docs/operations/development.md`에 opt-in 명령, 실제 Project scope navigation, ACK/canonical 구분, epoch/replay/expiry/root/revision guard, 취소·R3 한계와 실제 proof를 반영했다. 별도 network Host·임의 write/edit/shell·generic R3·COMPLEX·resume/recovery/rollback/fallback·mobile/Browser product 범위는 추가하지 않았다. canonical Run 생성 전 preflight는 wire cancel ID가 없다는 제한도 명시했다.
- 정리: 이번 actual smoke의 T3/faux Provider 서비스를 종료하고 managed browser tab을 닫았다. 이번에 생성한 fixture home/DB/checkouts와 세 throwaway script를 삭제했다. 이전 read-only fixture 서비스나 사용자의 live DB는 건드리지 않았다. 양쪽 status는 모두 이번 scoped 변경뿐이며 dependency/lockfile·main·immutable tag 변경은 없다. 아직 commit/push 전이다. 다음은 최종 build/lint 결과 확인·명시 경로 commit/push·exact remote CI와 보수적 closure 판정이다.

## LOG-104 — 2026-09-20 14:28 (Asia/Seoul) — 최종 로컬 gate와 게시 준비

**상태:** bounded C07 구현·actual proof·로컬 회귀를 끝내고 두 devlop의 명시 경로 commit/push를 준비한다. 현재 exact remote CI 전이므로 closure는 아직 선언하지 않는다.

- 최종 T3 native approval fingerprint 수정본의 `build:desktop && knip:check` **PASS**(33.06초). web/server/desktop 산출물을 다시 만들었고 기존 dependency의 optional `x11`·CJS `import.meta` warning만 남았다.
- 변경 TypeScript 경로의 `vp lint ... --report-unused-disable-directives` exit **0**(0.55초). 새 control 파일 warning은 없으며, 기존 `server.test.ts` 후반의 unused `_`/inline Schema warning은 여전히 있다. 앞의 전체 lint exit 0과 함께 기록하고 저장소 전체 warning-free로 주장하지 않는다. 최종 T3 documentation formatter도 **PASS**다.
- 구현/source 수정 이후 Pi 전체 gate(LOG-102), T3 전체 순차 gate와 최종 typecheck/fmt(LOG-103), 실제 UI/launcher negative scenarios(LOG-103)를 모두 확인했다. 외부 유료 Provider나 사용자 live data를 검증에 사용하지 않았다. 이번 throwaway script와 actual fixture는 제거했고 서비스/browser도 종료했다.
- 양쪽 `git status`에서 이번 작업의 Pi **14 files**, T3 **23 files**만 확인했다. main·tag·dependencies/lockfile 변경은 없다. stage는 명시한 파일 경로만 사용하고 hook을 우회하지 않는다. devlop의 특성상 changelog를 추가하지 않는다. 게시 후 Pi exact commit Actions 결과와 T3 exact SHA의 workflow 미실행 여부를 별도로 확인한다.

## LOG-105 — 2026-09-20 14:40 (Asia/Seoul) — V0.6A/C07 bounded closure

**판정:** 요청된 C07을 현재 검증한 bounded 범위에서 **CLOSED**로 판정한다. 별도 control로 legacy read-only를 유지하며 실제 prepare/AC/confirm/start·cancel·approval/reject·reconnect와 authority separation을 확인했다. 이 판정 후에만 V0.6B 조사·계획을 시작했다.

- Pi 구현 `fd0f93d58e187d3c83f77424cb4cbf3f7ae8a2a3`(14 files), T3 구현 `09de732fe8b02821ab150fe013f9acf9e93f99bc`(23 files)를 각 `devlop`에 일반 fast-forward push했다. 양쪽 staged `git diff --cached --check` PASS, hook 우회·force push·tag push 없이 게시했다. 각 local HEAD, `origin/devlop`, 실제 remote SHA가 일치하며 두 tree가 clean임을 확인했다.
- Pi [CI 35491863295](https://github.com/kjg8619/pi/actions/runs/35491863295)는 **위 exact SHA / completed / success**다. 단일 `build-check-test` job은 5분 1초 동안 install·ignored model hydration·committed source build·non-mutating check·isolated no-provider-credentials tests·launcher syntax·tracked source unchanged를 모두 통과했다. 과거 SHA의 PASS를 대체 근거로 사용하지 않았다.
- T3 위 exact SHA의 GitHub API 조회는 **Actions runs 0 / check runs 0**이다. `.github/workflows/ci.yml`은 main push 또는 PR에서만 실행하며 devlop push는 대상이 아니다. 이 제한을 문서화하고 workflow/trigger 변경·추가 PR·다른 SHA 결과 승계는 하지 않았다. Windows manual lane은 macOS control proof의 대체로 실행하지 않았다.
- 안정 태그 `weavra-v0.1-rc1`의 local/remote tag object는 모두 `7deb58be5b2da7b4f8e2cf42c1b1fd5d912a107c`, peeled target은 모두 `183f85de1897d8b9f4fadb368a54e2b1390e5a84`로 시작점과 동일하다. main과 기존 사용자 설정·live DB를 변경하지 않았다.
- closure 조건: read-only 관찰 계약, standalone transport/T3 backend, 실제 UI·reconnect/stale guard, shared prepare/confirm/frozen contract, cancel/cleanup/writer release, scoped approve/reject, authority·bounded idempotency, actual local 시나리오, 전체 로컬 회귀와 가능한 exact remote gate를 모두 확인했다(LOG-101~104). R3 native fingerprint 통합 오류와 첫 T3 localhost timeout을 수정/재실행 이력과 함께 보존했다.
- 제한: actual UI는 local faux Provider 기반이다. 실제 유료 Provider 품질·Linux sandbox actual·모든 OS/모델·pre-Run preflight cancellation·비협조 I/O의 즉시 종료를 보장하지 않는다. arbitrary write/edit/tool/shell, generic R3, COMPLEX, durable replay/resume/recovery, rollback/fallback, mobile/remote/new network Host, Browser product는 closure 범위에 없다.
- 다음 작업은 V0.6B의 Provider/model/endpoint/harness 근거 조사와 10개 평가축·재현 가능한 비교 계획 문서화뿐이다. 이번 단계에서 유료 inference·새 matrix 구현·모델 자동 선택/대체·Policy/완료 권한 변경은 하지 않는다. 조사 후 closure/plan 문서만 별도 commit하고 그 최종 exact HEAD CI도 확인한다.

## LOG-106 — 2026-09-20 14:49 (Asia/Seoul) — V0.6B Provider Fitness 조사·계획만 완료

**상태:** C07 closure와 구현 exact CI 성공을 확인한 뒤 요청된 연구를 수행했다. 새 matrix 구현·Provider inference·자동 fallback은 하지 않았으며 여기서 구현 착수를 멈춘다.

- 신규 문서 `docs/WEAVRA_PROVIDER_FITNESS_PLAN_2026-09-20.md`에 Provider/model/endpoint/API/adapter/schema/reasoning별 독립 cell, 10개 평가축, reusable eval/measurement, 고정 manifest·budget·oracle·negative/paired cohort·분모/UNKNOWN 처리·후속 착수 조건을 기록했다. root/Runtime README와 roadmap에도 C07 bounded CLOSED 및 V0.6B 계획-only 상태를 반영했다.
- 조사 근거: 기존 CommandCode hardening 전/후 smoke, Astra LOG-081~093의 actual/faux 구분, 현재 `packages/ai/src/api` adapters 및 eval/measurement source, OpenAI·CommandCode·DeepSeek·Google 공식 문서 11개. 공식 schema/stream/cancel 주장을 custom relay/gateway 또는 Weavra의 actual fitness로 승격하지 않았다. 원본 credential·prompt·reasoning·전체 tool log는 보관하지 않았다.
- 실행한 metadata inventory는 `models.json`의 provider/API/model/reasoning 필드만 출력했고 auth 파일이나 endpoint 값을 출력하지 않았다. 현재 `codex-lb/gpt-6-astra`는 openai-responses, CommandCode DeepSeek는 openai-completions로 구성되어 있다. omlx local model도 있으나 평가하지 않았다. Gemini custom entry가 없다는 것은 built-in Google auth가 없다는 뜻이 아니므로 조건부 SDK-supported 후보로 남겼다. temporary script는 삭제했다.
- 핵심 구분: provider constrained sampling·Runtime semantic submission·strict mutation freshness는 서로 다르다. Google SDK의 abort는 client-only이며 service 실행/과금 종료를 보장하지 않는다. 중단된 assistant turn의 실제 replay 처리, endpoint별 thinking/strict/usage 차이와 cost=0/미수신 usage의 UNKNOWN을 계획에 반영했다. 과거 작은 sample·통제 repair·faux context A/B로 모델 순위나 실제 token 절감률을 주장하지 않는다.
- 기존 read-only eval oracle는 파일 불변 중심이고 `standard-incomplete`는 normal completion cohort와 분리할 negative probe다. 후속 유료 비교 전에 oracle/AC 적합성·인증·exact endpoint·비용 상한을 고정하도록 명시했다. TTFT/HTTP attempts/cancel 단계 timestamp 등 아직 없는 관측을 현재 구현이라고 설명하지 않았다.
- 현재 검증: throwaway document check **PASS**(0.08초, local links 11·heading anchors 2·평가축 10); script 제거 완료. 최종 `npm run check:ci` **PASS**(5.99초, Biome 1,455 files, no fixes, 전체 base gate). source/test/dependency/config 변경은 없고 이번 후속 status는 문서 **5 files**뿐이다. 앞의 full test/actual proof는 LOG-102~105의 실행 기록이며 연구 중 재실행했다고 하지 않는다.
- 게시 계획: 위 문서 5개만 별도 devlop commit/push하고 **그 최종 문서 HEAD의 exact CI**도 확인한다. 구현 SHA의 CI를 문서 SHA에 승계하지 않는다. T3는 `09de732fe` 그대로이며 main·immutable tag·user 설정을 변경하지 않는다. 최종 SHA/CI 링크는 해당 commit의 Actions 및 최종 전달에서 별도로 확인한다.

## LOG-107 — 2026-09-20 19:10 (Asia/Seoul) — C06 bounded 구현·faux proof

**상태:** C06 OPEN. 사용자 요청으로 계획 단계를 넘어 corpus/runner/storage/CLI를 구현했다. actual paid calibration과 최종 exact CI는 아직 실행 전이다.

- 착수 때 Pi `f3234a7456a7e61d5a88799fd2d0ae72345329c8`, T3 `09de732fe8b02821ab150fe013f9acf9e93f99bc`의 local HEAD·origin/devlop·실제 remote SHA 일치와 clean tree를 확인했다. 개발 하네스는 OMP + GPT-6 Astra이며 main·immutable tag·사용자 auth/models 설정은 변경하지 않았다.
- Pi 변경: `fitness-types/records/launcher-fitness`, evals `fitness-corpus/runner/faux`, launcher routing, `PiAgentExecutor`의 명시적 memory-only session·payload 없는 observer, persistence/SDK suite, evals TypeBox exact dev dependency·lockfile, root/Runtime README·계획/roadmap·이 이력. 기존 Workflow/Kernel/Policy/strict receipt/trust/sandbox/repair/independent review를 재사용한다.
- privacy 조사에서 기존 SDK의 durable JSONL을 확인하여 Fitness만 in-memory로 분리했다. 새 result는 schema allowlist·digest·private file·immutable settled prefix이며 raw prompt/reasoning/tool/error/credential은 저장하지 않는다. usage 0 초기값을 UNKNOWN으로 취급하고, transport 세부 분류·HTTP attempts·cost는 UNKNOWN을 유지한다.
- 현재 `weavra-fitness-1` corpus digest는 `sha256:5e6391d964668262b0851860af152813e40e3d9071d0e3b697e079a4ce4b8b57`이다. 실제 CLI GOOD Run `d63b2bec-9eda-4005-af55-4371b61126dd`는 10 fixtures oracle PASS, F06 BLOCKED, F07 repair 1회, F08 active-stream CANCELLED, 전부 cleanup CONFIRMED다. FALSE_COMPLETER `c006131c-84fa-4959-9267-b6ffe802c700`은 F06 Runtime COMPLETED/oracle FAIL/falseCompletion=true를 검출했다. UNRELIABLE `f4037c2e-0a6b-4250-bc83-629f15354200`은 F01 FAILED/oracle INVALID/usage UNKNOWN 후 BUDGET_EXHAUSTED, F02 호출 0회다. CONTRACT_VIOLATOR 별도 F02는 forbidden mutation 1회 거부·scope change 0·FAILED를 확인했다. faux 수치는 model 순위가 아니다.
- 현재 targeted: `fitness-records.test.ts` 11 PASS, SDK `company-runtime-fitness.test.ts` 11 PASS. `npm run check` PASS(5.93초, Biome 1,463 files·5 fixes); 이후 hydrate:model-data·build:offline·check:ci·launcher `bash -n` PASS. 전체 `bash ./test.sh`는 **FAIL**: C07 R3 approval의 canonical COMPLETED와 writerPresent=true가 함께 보인 1개 assertion, coding-agent 2,762 PASS/1 FAIL/50 skip. 다른 package 결과와 실패 원본은 현재 실행 artifact에 보존하며 전체 PASS로 기록하지 않는다.
- 위 full-load 실패 원인은 control snapshot의 await 중 execution 종료 후 이전 파일 snapshot과 새 idle owner를 혼합한 race였다. `host-control.ts`는 execution identity가 read 중 바뀌면 bounded reread하고 안정되지 않으면 unavailable로 거부하도록 수정했다. worker retry나 policy 변경은 아니다. 수정 후 targeted/full gate는 별도로 실행하여 기록한다.
- 초기 faux에서 3개 goal이 기존 classifier의 explicit intent 조건을 충족하지 못해 NOT_STARTED였고, corpus goal에 실제 과제 의도인 bug를 명시했다. classifier/권한 조건을 완화하지 않았다. 초기 실패 결과도 별도 ID로 남겼다.
- 한계: bounded JavaScript byte-oracle corpus, controlled review/repair, 단일 OS·작은 sample이다. TTFT/effective thinking/provider structured-text/context A/B/transport 세부분류/청구 취소는 미측정이다. T3 read-only Fitness view는 core proof 이후 연결 중이다. 아직 commit/push하지 않았다.

## LOG-108 — 2026-09-20 19:12 (Asia/Seoul) — C06 actual 전 clean harness 고정

- C07 snapshot coherence 수정 뒤 `npm run check` PASS, `company-runtime-control` + `company-runtime-fitness` **2 files / 44 PASS**. 이어 격리 `bash ./test.sh` **전체 exit 0**(총 gate 234.21초): coding-agent 282 files / 2,763 PASS / 50 skipped, company-runtime 54 files / 1,424 PASS, evals 8 files / 35 PASS, 나머지 workspace도 성공했다. LOG-107의 첫 full 실패를 숨기지 않고 source race 수정 후 재실행했다.
- lockfile delta는 evals의 이미 설치된 `typebox: 1.3.27` dev dependency 1줄이며 다른 dependency 변경이 없다. `npm install --package-lock-only --ignore-scripts`로 갱신했다. main·tag·사용자 auth/models 변경은 없다.
- 위 구현·문서를 정상 commit/push한 exact SHA를 actual harnessRevision으로 사용한다. 이후 actual F01/F02는 각 target당 fixtures 2 / worker calls 4 / reported tokens 100,000 상한이다. calibration PASS cell만 fixtures 10 / calls 32 / tokens 500,000 동일 조건으로 1회 확대한다. 비용은 UNKNOWN이며 자동 재시도·warm-up·fallback하지 않는다.

## LOG-109 — 2026-09-20 19:22 (Asia/Seoul) — C06 actual calibration 실패·확대 중단

**판정:** C06 OPEN. core 구현과 faux proof 이후 허가된 실제 F01/F02 calibration을 수행했지만 두 target 모두 실패했다. full matrix·V0.6C에 자동 진입하지 않는다.

- Pi 구현 `c94d5ddc4871a66943abebebe437f460fa119e99`를 normal commit/push하고 clean harness로 고정했다. `feat(coding-agent): add bounded provider fitness corpus and immutable results`, 18 files다. 명시 경로 stage·정상 hook·fast-forward push를 사용했으며 관련 lockfile 허용 외 hook 우회는 없다. 이 SHA의 actual corpus와 target/result digest는 Fitness 문서 10절에 보존한다.
- 실제 Astra `d8ac6441-ad5f-48a8-b598-ff7e32f622d7`: F01 COMPLETED/oracle PASS/4,155 tokens/13,649 ms. F02 strict edit 1회·checks 2 PASS 뒤 BLOCKED/oracle FAIL/task adherence=false/11,616 tokens/20,542 ms. 합계 worker 2·model turns 6·tools 6·15,771 tokens·34,191 ms, CALIBRATION_FAILED.
- 실제 CommandCode `8b90b143-dc28-449f-9dc3-74c902ef4b80`: F01 COMPLETED/AC met/checks 2 PASS지만 frozen summary oracle FAIL/falseCompletion=true. worker 1·model turns 2·tools 3·6,391 tokens·8,594 ms. CALIBRATION_FAILED에서 F02를 시작하지 않았다. 제한된 summary oracle의 실패를 일반 모델 이해력 순위로 확대하지 않는다.
- 세 실제 fixture 모두 cleanup CONFIRMED·usage KNOWN, 기록된 scope/forbidden/invalid tool/retry/provider/auth/timeout counters 0. cost·transport 세부 오류·HTTP attempts는 UNKNOWN이다. CommandCode의 기존 private env는 Node `--env-file`로만 로드했으며 secret을 출력하거나 auth/models 파일을 수정하지 않았다. raw response·reasoning·전체 tool log는 보관하지 않았다.
- 실제 CLI compare exit 0: corpus/budget/harness/configuration/kind 일치, fixtures 불일치, comparable=false. 같은 corpus metadata만으로 서로 다른 실행 prefix를 비교 가능한 sample로 승격하지 않았다. 자동 재시도·warm-up·fallback·policy/oracle 완화·추가 유료 call은 없다.
- T3 구현: strict contracts/RPC/capability·read authorization·server-owned bounded CLI reader·client session guard·Project-scoped history/raw compare view·privacy/bounds test. 브라우저는 root/executable/env/store-dir/run verb를 받지 않는다. 별도 opt-in control과 기존 Runtime authority는 그대로다.
- 실제 T3 UI에서 private 기록 두 개를 조회하고 비교하여 NOT COMPARABLE/fixtures differs·false completion 0/1·tokens/latency·UNKNOWN 비용/transport를 확인했다. 기존 사용자 DB와 분리한 임시 home, control=0, localhost dev server를 사용했다. about:blank로 연결을 닫고 다시 접속했을 때 자동 조회/평가는 없었고 Read history로 같은 두 record를 다시 읽었다.
- T3 검증 중 pnpm wrapper가 package export 변경 후 의도치 않게 자동 hydration과 기존 prepare lifecycle을 실행했다. 한 병렬 invocation은 config lock으로 실패했고 다른 invocation은 완료했다. lockfile 변화는 없으며 이후 직접 `node_modules/.bin/vp`만 실행했다. dependency 추가·lockfile 변경·임의 lock 제거·lifecycle allowlist 확대는 하지 않았다.
- T3 full typecheck·format·knip·build와 lint(exit 0, 기존 warning 잔존)는 통과했다. 첫 Node 26 full tests는 기존 shared Unicode boundary 테스트 `𐐀@build:7` 1개 실패(873 PASS)로 중단됐다. 테스트나 unrelated 코드를 완화하지 않고 문서의 Node 24 환경에서 전체 회귀를 별도 실행 중이다. 최종 gate/게시 결과는 다음 기록에서 실제 결과로 남긴다.

## LOG-110 — 2026-09-20 19:33 (Asia/Seoul) — C06 최종 로컬 gate·T3 게시·보수적 OPEN

**판정:** 구현과 도달 가능한 검증·게시를 마무리하되 C06은 OPEN이다. 실제 calibration 실패 때문에 full same-corpus matrix와 V0.6C 연구는 시작하지 않는다.

- LOG-109 뒤 Node 24의 첫 전체 실행도 exit 1이었다(474.00초): server 9 files / 50 FAIL / 5,179 PASS / 10 skipped. 출력에 `/var/...` 대 `/private/var/...` canonical path 불일치, cleanup/skill boundary assertion과 UsageService timeout이 있었다. 나머지 13 package는 PASS였다. 이를 fitness 회귀로 단정하거나 실패를 숨기지 않는다.
- 기존 성공 환경처럼 `env -i`로 inherited credentials/config를 제거하고 별도 empty HOME와 symlink가 없는 canonical TMPDIR, Node **24.19.0**를 사용했다. `node node_modules/vite-plus/bin/vp run -r --concurrency-limit 1 test`는 **14 package commands / 1,270 files / 17,268 tests PASS / 7 files·58 tests skipped / exit 0**, **332.63초**다. server **340 files / 5,229 PASS / 10 skipped**에 새 FitnessReader 6개가 포함된다. 테스트 삭제·skip 추가·timeout 증가·자동 retry 없이 환경을 명시하여 전체 실행했다. Node 26 또는 noncanonical TMPDIR의 문제를 source에서 해결했다고 주장하지 않는다.
- 최종 T3 `node_modules/.bin/vp run build`는 Node 24에서 **PASS / 7 commands / 19.49초**다. web/server/desktop/marketing을 포함하며 기존 CJS import.meta 등의 dependency warning은 남는다. 최종 typecheck·fmt(3,969 files)·knip·lint exit 0과 실제 화면 proof는 LOG-109에 이어 이번 gate에서도 유효하다. repository 전체 warning-free로 표현하지 않는다.
- Pi 구현 [exact CI 35504397574](https://github.com/kjg8619/pi/actions/runs/35504397574)는 **`c94d5ddc4871a66943abebebe437f460fa119e99` / completed / success**다. 문서 반영 뒤 현재 `npm run check:ci`도 **PASS**(6.13초, 1,463 files·no fixes). full Pi tests는 이번 작업 LOG-108의 source 수정 후 실행이며 문서 변경 뒤 재실행했다고 표현하지 않는다.
- T3 **`d4a858cbb6fdd195173d593feb8fbb979bf2b998`**, `feat: add read-only Weavra fitness history and comparison`을 15개 명시 경로로 정상 commit/push했다. staged diff check PASS, local HEAD·origin/devlop·실제 remote SHA 일치. exact SHA GitHub API는 **Actions runs 0 / check runs 0**이며 devlop이 main/PR-only trigger 대상이 아니라는 기존 제한을 그대로 기록한다. workflow/trigger·PR·main·tag는 변경하지 않았다.
- 실제 record 두 개는 기본 private Fitness project namespace에 유지했다. 초기 실패를 포함한 faux 기록 7개도 삭제하지 않고 `~/.weavra/fitness/c06-faux-proof-20260920`에 보존했다. `weavra fitness show d63b2bec-9eda-4005-af55-4371b61126dd --store-dir <위 절대 경로> --json` 재조회 PASS다. 둘 다 corpus/model 품질 순위나 비용 절감률의 근거로 확대하지 않는다.
- 정리: 이번 owned T3 smoke service·managed browser tab을 종료하고 임시 T3 home/DB·격리 test home/tmp·throwaway document script를 삭제했다. 기존 다른 서비스·사용자 live DB·auth/models는 보존했다. 실제 record identity/digest·0600 permissions·문서 SHA 길이·local links check PASS다. 최초 문서 checker가 historical roadmap의 축약 SHA에도 64자 길이를 요구해 실패한 것은 checker 범위를 새 Fitness 문서로 바로잡았으며 historical 값은 바꾸지 않았다.
- 남은 한계: actual 3 fixture observations뿐이고 두 calibration 실패, summary literal oracle의 표현/누락 세부 원인은 미보관, transport/cost/HTTP attempts/backend identity 및 full matrix는 UNKNOWN 또는 미실행이다. T3는 summary list/compare만 제공하고 fixture detail은 CLI show다. 자동 fallback/retry·Policy 완화·새 authority·Jev 구현은 없다.
- Pi 후속 변경은 실제 결과·T3 proof·OPEN 판정을 반영한 Fitness 계획/roadmap/WORK_LOG 문서 3개다. 이 문서들을 별도 정상 devlop commit/push한 뒤 **최종 문서 HEAD의 exact CI**를 확인하여 최종 전달에 SHA·결과·링크를 남긴다. 구현 CI를 새 SHA의 성공으로 승계하지 않는다.

## LOG-111 — 2026-09-20 20:21 (Asia/Seoul) — C06 재감사·oracle/usage 보강·v1 기록 보존

**상태:** 도달 가능한 보강·로컬 검증 완료, C06 OPEN 유지. 이번 작업의 유료 호출은 0회이고 v2 actual calibration·full actual matrix·V0.6C는 실행하지 않았다.

- 반복된 전체 요청에 대해 착수 시 실제 devlop 기준을 다시 확인했다. Pi local HEAD·origin/devlop·remote는 `6d52cdd1f4815f2b5d15cc63afa1b3909a1b3918`, T3는 `d4a858cbb6fdd195173d593feb8fbb979bf2b998`로 각각 일치했고 두 tree는 clean이었다. 사용자가 열거한 더 오래된 시작점으로 되돌리지 않았다. Pi baseline exact CI `35505423095`의 headSha 일치·completed/success도 확인했다.
- 변경 파일: evals `fitness-corpus.ts`, `fitness-runner.ts`; Runtime `measurement.ts`, `test/fitness-records.test.ts`, 고정 historical `test/fixtures/fitness-v1.json`; SDK `test/suite/company-runtime-fitness.test.ts`; Fitness 계획과 이 이력이다. T3 source·dependency/lockfile·main·tag·auth/models 설정은 수정하지 않았다.
- SDK 재현에서 F03의 정상 수정 + 허용 경로 내 불필요한 새 파일이 checks/Reviewer/Runtime을 통과하고 기존 oracle에서도 PASS가 되는 문제를 확인했다. Host가 실제 파일 집합과 baseline을 대조하도록 수정하여 같은 scenario는 COMPLETED/oracle FAIL/falseCompletion=true로 기록한다. policy 범위 내이므로 scope violation=0인 사실은 그대로 둔다.
- 별도 SDK 재현에서 한 worker의 첫 turn은 usage를 보고하고 다음 오류 turn은 SDK 초기값 0일 때, 기존 합계 기반 정규화가 KNOWN으로 만들고 다음 fixture를 호출했다. 공통 accumulator가 turn별 누락·0 초기값을 incomplete로 유지하도록 수정하고 중복 Fitness 보정 wrapper를 제거했다. 이제 관측 subtotal은 보존하면서 전체 usage는 UNKNOWN, 다음 호출은 budget fail-closed다. 모든 0이 upstream의 명시적 측정값인지 구분하는 추가 provenance는 없으므로 보수적 UNKNOWN이다.
- 위 두 재현은 수정 전 **2 FAIL / 12 PASS**, 수정 후 SDK suite **14 PASS**였다. 추가 corpus invalid-budget/out-of-scope 검증, populated v1 record의 원본 bytes/실패 판정/UNKNOWN 보존, executed-prefix 불일치 비교 회귀를 넣었다. `fitness-records` + `measurement-evidence` + `measurement-hardening`은 **3 files / 47 PASS**(records 13개 포함)다.
- F04는 recipe compilation 이후 fixture statements를 명시적인 사용자 검토 AC 수정본으로 사용하는 기존 의미를 유지한다. production `finalizeHostWorkflowPlan(draft, statements)`도 같은 override를 허용한다. 이를 recipe 기본 문구의 무수정 전달 검증으로 주장하지 않도록 문서에 명시했으며 goal/AC/oracle를 actual 실패에 맞춰 완화하지 않았다.
- 새 corpus는 `weavra-fitness-2`, digest `sha256:352795e95dc5175247eefaff89c73ca3b7768c6acf8f27e4dd2623f2bf0763b1`이다. 실제 CLI list의 10개 fixture metadata/digest가 기존 v1 inventory와 모두 같은 것을 확인했다. revision과 Host oracle source 때문에 corpus digest는 달라졌고, 기존 actual의 corpus/result digest·KNOWN 표기·실패 판정은 소급 변경하지 않았다. 전체 fixture digest와 actual raw dimensions는 Fitness 문서 §11, v2 근거는 §12에 기록했다.
- 현재 실행한 검증: `npm run check` **PASS**(1,463 files, 4 formatter fixes), `npm run hydrate:model-data` **PASS**, `npm run build:offline` **PASS**, `npm run check:ci` **PASS**. 초기 syntax command만 잘못된 `bin/weavra` 경로로 exit 127이었고 실제 `packages/company-runtime/bin/weavra`의 `bash -n`으로 바로잡아 **PASS**했다. validation 실패를 source 오류로 숨기거나 관련 없는 파일을 수정하지 않았다.
- 현재 전체 `bash ./test.sh`는 **exit 0 / 209.94초**다. coding-agent **282 files / 2,766 PASS / 50 skipped**, company-runtime **54 files / 1,426 PASS**, evals **8 files / 35 PASS**, 나머지 workspace와 script/consumer smoke도 PASS였다. 이 결과는 LOG-108의 과거 전체 실행과 다른, 이번 measurement/oracle 수정 후 실행이다.
- 실제 CLI + required verifier sandbox에서 v2 GOOD `247f60ce-8581-4a5b-b9a6-bc40d7f5a6e6`은 10개 oracle PASS, F06 BLOCKED, F07 repair 1회, F08 active-stream CANCELLED, 전부 cleanup CONFIRMED다. CONTRACT_VIOLATOR `09c4fd63-0ec6-4ba4-ad03-5c073ce5588a`는 F02 forbidden attempt 1·scope change 0·FAILED/oracle FAIL이다. UNRELIABLE `f7dab93a-fdde-494b-8263-badeb309eac5`는 F01 FAILED/INVALID/UNKNOWN 뒤 BUDGET_EXHAUSTED, F02 미호출이다. 이 세 FAUX 기록은 source 수정 중 HEAD 6d52… + working-source prompt digest를 기록한 것이며 clean committed ACTUAL proof가 아니다.
- CLI 안전 smoke는 별도 HOME의 invalid auth JSON으로 `list/show/compare` 3개를 성공시켰고, opt-in 누락·과거 corpus 확인·read-only execution flag·duplicate flag 4개를 새 evaluation store 생성 없이 거부했다. 최초 smoke script는 HOME와 WEAVRA_HOME을 같은 디렉터리로 잡아 기존 Pi isolation guard에 거부됐고, `.weavra` child로 분리한 뒤 통과했다. guard를 바꾸지 않았다. metadata `targets`는 ModelRuntime의 auth path를 사용하므로 auth-free 명령으로 표현하지 않는다.
- T3는 이번 작업에서 무변경이다. LOG-109~110의 실제 화면/reconnect와 Node24 full 17,268 PASS·build/typecheck/fmt/knip/lint proof는 **동일 SHA의 과거 검증**으로 구분하고 재실행했다고 주장하지 않는다. 이번 exact SHA API 재조회는 Actions runs 0 / check runs 0이다. main/PR-only trigger 제한을 CI PASS로 바꾸거나 workflow를 수정하지 않았다.
- 정리: owned throwaway CLI script와 해당 임시 HOME는 삭제했다. 기존 actual 2개·기존 faux 7개·새 v2 faux 3개는 private history에 유지했다. source/browser service를 새로 남기지 않았고 사용자 DB·credential·다른 session 파일은 건드리지 않았다. devlop에서는 package changelog를 추가하지 않는 규칙을 유지했다.
- 남은 제한: actual은 v1의 3개 fixture 관측과 두 calibration 실패뿐이다. v2의 실제 Provider 성능·full matrix·transport/HTTP attempts/cost/backend identity는 미검증 또는 UNKNOWN이다. corpus는 JavaScript exact-byte 과제이고 review/repair는 통제된 입력이다. F04 기본 recipe 문구, F05 discovery/context 의존성, F09 문서가 결과에 미친 인과효과를 scripted faux 성공만으로 입증하지 않는다. C06 CLOSED나 V0.6C 준비 완료로 승격하지 않는다.
- 커밋 상태: 이 entry 작성 시 scoped 변경은 아직 commit 전이다. 정상 devlop commit/push 후 **최종 exact HEAD의 CI**를 확인해 최종 보고에 SHA·결과·링크를 남긴다. baseline CI나 과거 T3 proof를 새 Pi SHA의 검증으로 승계하지 않는다.

## LOG-112 — 2026-09-20 20:56 (Asia/Seoul) — v2 actual 재검증 전 calibration·비교·usage 경계

**상태:** 새 actual 허가의 선행 source 보강·로컬 회귀 완료. 이 entry까지 유료 호출 0회, C06 OPEN / V0.6C 미착수.

- 시작 Pi local/tracking/remote devlop은 `e5b38fce440d9f6906727f570419ef1baef76e67`, T3는 `d4a858cbb6fdd195173d593feb8fbb979bf2b998`로 각각 일치하고 clean이었다. 현재 corpus/runner/store/CLI/measurement와 기존 actual history를 조사했으며 SDK defaults·provider adapters·T3 read-only 경로도 읽기 전용으로 확인했다.
- 변경: Runtime `fitness-types.ts`, `fitness-records.ts`, `test/fitness-records.test.ts`; evals `fitness-runner.ts`; SDK `test/suite/company-runtime-fitness.test.ts`; Fitness 계획과 WORK_LOG. T3와 dependency/lockfile, auth/models, fixture goal/AC/body/oracle는 무변경이다. corpus v2 digest와 fixture 10개 digest도 유지했다.
- 기존 committed source의 records/measurement targeted **47 PASS**, SDK **14 PASS** 뒤, 동일 완료 F01/F02 subset을 full corpus 비교로 허용하던 조건을 새 regression으로 재현(**1 FAIL / 13 PASS**)했다. 이제 양쪽 COMPLETED·동일 F01–F10 전체 실행·동일 순서만 fixture compatibility를 통과한다. partial 또는 동일 calibration끼리는 NOT COMPARABLE이다. 기존 T3 summary wire fields는 바꾸지 않았다.
- F01/F02 admission을 terminal/oracle/false completion뿐 아니라 Task Contract adherence·AC·scope/forbidden mutations·두 checks·cleanup·KNOWN usage·관측된 provider/auth/transport/timeout failures까지 한 판정으로 일치시켰다. 관측되지 않은 transport는 UNKNOWN으로 남기고 측정된 0으로 만들지 않는다.
- full fixture record의 optional nullable cacheRead/cacheWrite/reasoning과 SDK_NORMALIZED provenance를 추가했다. SDK가 raw absent detail을 0으로 만드는 경로이므로 양수의 정규화된 관측값만 기록하고, 0·누락·불완전 invocation은 UNKNOWN이다. 과거 v1 bytes/result digest는 수정하지 않는다. raw upstream detail completeness나 effective reasoning을 입증했다고 주장하지 않는다.
- 현재 source 검증: records/measurement **3 files / 50 PASS**, SDK Fitness **1 file / 14 PASS**. `npm run check && npm run hydrate:model-data && npm run build:offline && npm run check:ci` **PASS**(17.28초; Biome 1,463 files·2 fixes). `bash -n packages/company-runtime/bin/weavra`와 `git diff --check` **PASS**.
- 전체 `bash ./test.sh` **exit 0 / 209.30초**: coding-agent **282 files / 2,766 PASS / 50 skipped**, Runtime **54 files / 1,429 PASS**, evals **8 files / 35 PASS**; scripts/consumer smoke·나머지 workspace도 PASS다. 이는 LOG-111의 과거 결과와 다른 이번 source 수정 후 실행이다.
- Metadata-only inspection에서 정확한 Astra `codex-lb/gpt-6-astra`와 CommandCode `deepseek/deepseek-v4.1-flash` 모두 SDK default/clamped/mapped **medium**, reasoning capability=true, sampling override 없음이다. upstream effective reasoning은 UNKNOWN이다. source상 session retry=false/provider maxRetries=0, 자동 compaction/revision cycle 없음이며 gateway 내부 retries/HTTP attempts는 UNKNOWN이다. raw auth·headers·endpoint·API key는 출력하지 않았다.
- 기존 v1 actual 2개의 byte SHA-256은 Astra `db322fb8c4aae65380fa4a897b7363c79c32533870f1ca54b02e95fdf9a9e3a0`, CommandCode `df42fc5552ab2ea2dc007072cdcc3f3338d13170abab41a7b979fa6fc6b00f06`로 보존했다. 새 v2 record와 혼합하지 않는다.
- 다음: 이 source 보강을 별도 정상 devlop commit/push하고 exact CI를 확인한다. committed harness에서 faux GOOD/CONTRACT_VIOLATOR/UNRELIABLE·CLI read proof와 최종 identity/thinking freeze를 마친 뒤 두 actual calibration을 각각 한 번만 실행한다. 실제 결과와 후속 full regression/T3 proof는 별도 evidence entry/commit에 기록한다.
- 커밋 상태: 이 entry 작성 시 아직 commit 전이다. 유료 호출용 throwaway driver만 준비했으며 inspect는 model API를 호출하지 않는다. 비용은 UNKNOWN이고 100,000 reported-token budget은 진행 중 응답의 billing hard cap이 아니다. main/tag/Policy/권한 확장은 없다.

## LOG-113 — 2026-09-20 21:22 (Asia/Seoul) — 새 v2 actual calibration 실패 보존·T3 실화면·C06 OPEN

**상태:** 허가된 두 calibration 각 1회·실제 UI·최종 로컬 gate 완료. 두 calibration 실패로 C06 OPEN이며 full actual matrix와 V0.6C/Jev는 미착수다.

- 선행 source 보강은 **`97ce0a2c69cbd6605011fbe34a54b07c9ec11d29`**로 정상 devlop commit/push했다. local/tracking/actual remote 일치·clean tree와 [exact CI 35509228483](https://github.com/kjg8619/pi/actions/runs/35509228483)의 headSha 일치·completed/success를 확인한 다음 paid calls를 시작했다. Actual 후 source 수정은 없고 이번 후속 변경은 Fitness 계획·roadmap·WORK_LOG 문서 3개뿐이다.
- Committed-source pre-actual targeted는 records/measurement **50 PASS**, SDK Fitness **14 PASS**다. Required sandbox CLI faux GOOD `4a989fbd-ba5e-4c2e-87e7-c57ea23cfe80`은 10 oracle PASS, CONTRACT_VIOLATOR `23772054-1134-487e-a0f5-35010ff8c75e`는 forbidden attempt 1·scope change 0·F02 FAIL, UNRELIABLE `9365574f-48fc-4306-b6fc-87a8808a6738`는 F01 UNKNOWN 뒤 F02 미호출을 확인했다. 별도 invalid-auth HOME에서 read-only CLI 3개 PASS, 위험 invocation 4개는 store 생성 전 거부했다. Cost-bound `6d4a6f43-a2da-43c2-9f03-61cf20e6e0aa`는 fixture 0개에서 BUDGET_EXHAUSTED였다.
- Corpus는 **weavra-fitness-2 / `sha256:352795e95dc5175247eefaff89c73ca3b7768c6acf8f27e4dd2623f2bf0763b1`**다. 10 fixture digest·goal/AC/body/oracle·strict mutation/trust·required sandbox를 유지했다. 같은 worker/default medium policy와 role configuration, 각 calibration fixtures 2 / workers 4 / reported tokens 100,000을 고정했다. 별도 임시 driver는 production runner를 그대로 호출하고 매 호출 전 같은 ModelRuntime의 descriptor를 frozen identity와 대조했다. Auth/model 설정이나 raw endpoint·credential은 출력/수정하지 않았다.
- Exact targets는 **codex-lb/gpt-6-astra / openai-responses**와 **commandcode/deepseek/deepseek-v4.1-flash / openai-completions**다. SDK default/clamped/mapped thinking은 모두 medium, sampling override 없음, model policy digest `sha256:3a619424382d31b2a999ce9fd1d20e6629e60635afe281f70b1dd61f160a8939`; upstream effective reasoning은 UNKNOWN이다. Tool/runtime/config/endpoint digests는 Fitness 계획 §14.1에 기록했다. 자동 session/provider retry·fallback 없이 실행했고 gateway 내부 retry/HTTP attempts는 UNKNOWN이다.
- **Astra** `1bbf3173-66da-47e3-9574-c8b58a5efcaa`: F01 COMPLETED/oracle PASS/falseCompletion=false, F02 BLOCKED/oracle FAIL/Task Contract adherence=false·AC evidence UNKNOWN. 두 fixture 모두 checks 2 PASS·scope/forbidden 0·cleanup CONFIRMED·usage KNOWN이다. Total **4,168 + 11,657 = 15,825**, worker 2/model turns 6, tools 6, fixture latency **13,486 / 20,134ms**다. Collection CALIBRATION_FAILED.
- **CommandCode** `3da1a33c-e8b7-41fa-b82d-f202059286ac`: F01 COMPLETED이나 외부 oracle FAIL·falseCompletion=true다. Task Contract adherence=true·AC 1 MET·checks 2 PASS·scope/forbidden 0·cleanup CONFIRMED·usage KNOWN이다. Total **6,916**, worker 1/model turns 2, tools 3, latency **10,667ms**. F02는 호출하지 않았고 collection CALIBRATION_FAILED다.
- 총 actual fixture 3개·worker 3회·model turn 8회·reported tokens **22,741**이다. 신규 actual 재시도·diagnostic·fallback은 0회다. Input/output/total/cache/context/latency와 원시 n=1 표는 Fitness 계획 §14.3에 보존한다. Cache read는 1,792 / 7,936 / 3,328, CommandCode reasoning은 332로 SDK_NORMALIZED 관측값이다. Cache write와 Astra reasoning, cost/transport/HTTP count/backend/effective thinking은 UNKNOWN이다. Reasoning을 total에 이중 가산하거나 absent field를 0으로 만들지 않는다.
- 실패 분류: Astra F02는 관측된 **CONTRACT_ADHERENCE** 실패이고 정확한 모델 문구/내부 원인은 UNKNOWN이다. CommandCode F01은 **UNKNOWN — frozen oracle mismatch/false completion**이다. Summary 원문 미보관으로 의미 오류·누락·표현 차이를 구분할 수 없으므로 MODEL_SEMANTIC으로 확정하지 않는다. Provider/auth/timeout과 invalid tool call은 0 관측이며 HARNESS_DEFECT를 입증할 deterministic 실제 실패 재현은 없다. Source/oracle/contract를 완화하거나 paid 진단으로 결과를 구제하지 않았다.
- CLI `list/show/compare`로 새 실제 record 2개와 기존 v1 2개를 재조회했다. 원본 byte SHA-256·result digest·0600 permissions를 유지했다. 새 file hashes는 Astra `8e05e58f197917f41f96bafeb322aded0a17c069b653da4c4685d3765fb38ea1`, CommandCode `f3e863fc18bdd8aab845a52fbbd7e056a17e7333b394a452979e92fbd2a7e89d`이며 canonical result digests는 Fitness 계획 §14.2에 있다. Comparison은 corpus/budget/harness/configuration/kind=true·fixtures=false·**NOT COMPARABLE**다.
- T3 `d4a858cbb6fdd195173d593feb8fbb979bf2b998` 무변경 상태에서 Node **24.19.0**, 새 빈 T3 home/DB, control=0과 managed Chromium을 사용했다. Pi project만 등록해 Settings→Project의 기존 read-only Fitness에 새 v2·과거 v1 각 2개가 분리되는 것을 확인했다. 새 ID 둘의 **NOT COMPARABLE / fixtures differs**, exact identities, executed 2/1·false completion 0/1·tokens 15,825/6,916·latency 33,620/10,667·cost/transport UNKNOWN을 실제 화면으로 확인했다. Chat/Workflow/모델 호출은 시작하지 않았다. Cache/reasoning detail을 UI가 표시했다고 주장하지 않는다.
- UI 첫 readiness probe는 web listener가 localhost에서 동작하고 127.0.0.1 probe는 응답하지 않아 timeout이었다. 실제 localhost page/pairing/backend를 확인해 진행했고 Pairing token은 출력하지 않았다. 초기 token query 추출 실패는 URL fragment 처리로 바로잡았다. 사용자 DB·credential 설정이나 server source를 바꾸지 않았다.
- Actual 후 첫 병렬 validation에서는 Runtime **54 files / 1,429 PASS**였으나 SDK subset **4 FAIL / 524 PASS**(Fitness 30초 timeout, check-pause 3건), standalone evals **1 FAIL / 34 PASS**(context A/B 5초 timeout), root full **2 FAIL**(agent taskkill fixture NaN pid, Fitness timeout)였다. 중복 실행 부하의 영향은 [INFERENCE]이며 실패를 숨기거나 source defect를 고쳤다고 표현하지 않는다.
- Owned UI service/browser 종료 후 **동일 source·원래 timeout·assertion·skip**으로 validation을 직렬 실행했다. SDK Weavra **16 files / 528 PASS**, evals **8 files / 35 PASS**, records/measurement **3 files / 50 PASS** 및 전체 **`bash ./test.sh` exit 0**이다. Root full에서 coding-agent **282 files / 2,766 PASS / 50 skipped**, Runtime **54 files / 1,429 PASS**, evals **8 files / 35 PASS**, scripts/consumer smoke·나머지 workspace 모두 PASS다.
- 같은 직렬 chain의 `npm run hydrate:model-data`, `npm run check`, `npm run check:ci`, `npm run check:shrinkwrap`, `npm run check:install-lock:coding-agent`, launcher `bash -n`, `git diff --check`도 PASS다. Biome **1,463 files·no fixes**, chain 전체 **287.36초**다. 테스트 삭제·timeout 증가·추가 skip·paid retry 없이 통과했다. LOG-112의 pre-actual 전체 회귀나 과거 T3 full gate와 별개의 이번 결과다.
- Post-actual faux도 직렬로 재실행했다(**15.29초 / 실제 Provider 0회**). GOOD `5e57c9cb-4c95-427e-a821-dde46b2b628f`는 10 oracle PASS·F06 BLOCKED/F08 CANCELLED, CONTRACT_VIOLATOR `da69157f-ad23-4618-9e06-fea0d7633573`는 forbidden attempt 1·scope change 0·F02 FAIL, UNRELIABLE `9ebf6413-bdde-4541-8d2a-8a33b61cc258`는 F01 UNKNOWN/INVALID 후 BUDGET_EXHAUSTED·F02 미호출이다. 전부 cleanup CONFIRMED이며 전후 faux/cost-stop 기록 7개를 private namespace `c06-v2-preactual-20260920`에 보존했다.
- 정리: owned browser와 T3 process tree를 종료하고 임시 UI home/DB, paid driver/freeze descriptor, CLI/evidence/faux/validation scripts를 삭제했다. 새 actual 2개·기존 v1 2개와 모든 faux history는 보존했다. 사용자 live DB, auth/models, 다른 session/service, T3 source, root/Runtime README, dependency/lockfile, main/tag를 수정하지 않았다. 새 browser 권한·Jev 조사/구현도 없다.
- 남은 제한과 다음: 두 calibration 실패로 full F03–F10 actual 자체가 미실행이며 실제 controlled review/repair/cancel/docs/policy 판정, 반복 sample, HTTP/cost/backend/effective reasoning은 확보하지 못했다. Faux로 이를 대체하거나 C06 CLOSED로 승격하지 않는다. 별도 근거/허가 없이 추가 유료 호출하지 않는다. C06 CLOSED 이후에만 V0.6C로 진입한다.
- 커밋 상태: source 보강은 `97ce0a2c6`으로 게시·exact CI PASS다. 이 실제 evidence 문서 3개는 작성 시 commit 전이며 별도 정상 devlop commit/push 후 **최종 exact HEAD CI**의 SHA·결과·링크를 최종 전달에 기록한다. 앞선 source CI를 evidence HEAD의 성공으로 승계하지 않는다.

## LOG-114 — 2026-09-20 23:01 (Asia/Seoul) — 독립 F01/F02 audit·v3 integrity 분리·pre-actual 로컬 proof

**상태:** 독립 조사·구현·결정론적 회귀·실제 read-only UI 확인 완료, source 게시/CI 전. 새 actual Provider 호출 0회, C06 OPEN, V0.6C/Jev 미착수.

- 목적: 과거 모델 결과에 맞춰 oracle을 구제하지 않고 F01/F02 과제·AC·Task Contract·등록 check·Kernel·외부 oracle을 독립 검증했다. Read-only 감사자에게 actual 결과/summary를 주지 않은 뒤 역사적 record와 대조했다. 상세 계약/반례/동결 digest는 Fitness 계획 §15에 기록했다.
- F01 v2 oracle은 동등한 의미 표현을 FAIL하고 wrong boundary/cause/conclusion 및 keyword stuffing을 PASS하는 **5개 독립 반례**를 실제 Provider 없이 재현했다. 주 분류는 ORACLE_UNDERCONSTRAINED이고 표현 과제약/summary 위치 ambiguity도 있다. 단순 regex 확장이나 LLM judge 대신 기존 summary 문자열 안의 bounded JSON answer를 goal/AC/지침에 공개했다. 의미는 같지만 표현/위치 계약 변경이므로 **corpus weavra-fitness-3**이며 F10도 같은 계약으로 이행했다.
- 역사적 v1/v2 actual 네 JSON의 SHA-256을 재확인하고 bytes/resultDigest/schema를 바꾸지 않았다. 과거 DeepSeek F01은 원문/최종 파일이 없어 A/B/C를 구별할 수 없는 **D: INSUFFICIENT_EVIDENCE / UNKNOWN**이다. Oracle 결함은 과거 답이 정답이었다는 proof가 아니다.
- F02 exact-byte goal/AC/check와 QUICK/EDIT/R1 routing은 VALID다. 다만 QUICK의 Task Contract digest guard가 조기 return 뒤에 있던 결함을 수정했다(새 R0/R1 회귀 수정 전 2 FAIL). Runtime pending checks를 known_risks에 쓰도록 유도하던 공통 지침도 실제 위험과 구별하도록 고쳤다. R1 empty-risk, strict freshness, Policy/trust/sandbox, Reviewer/Kernel 권한은 완화하지 않았다.
- **LOG-113의 Astra F02 CONTRACT_ADHERENCE 실패 분류를 정정한다.** 당시 false 값은 terminal acceptance 부재에서도 생성됐다. 실제 summary/known_risks/phase/final bytes/check diff가 없으므로 정확한 원인은 UNKNOWN이다. 현재 guidance 결함의 SDK 재현으로 과거 원인을 확정하지 않으며 기존 LOG/record를 소급 수정하지 않는다.
- 새 record schema v2는 calibration/evaluation/stopReasons, fixture integrity 및 bounded audit를 보존한다. Canonical Run을 후처리 오류로 지우지 않고 missing target는 FAIL, local adapter abort는 user cancel과 구별한다. 알려진 semantic/contract FAIL·falseCompletion은 저장 후 안전하면 계속하고, protocol/transport/auth/provider/timeout/oracle INVALID/measurement/cleanup/UNKNOWN usage는 중단한다. 마지막 expected F08의 UNKNOWN usage는 full coverage와 별개로 남긴다.
- 새 audit는 허용 파일의 존재/bytes hash, protected 상태, 제출/AC/phase/check digest와 엄격히 파싱된 조사 답만 남긴다. 자유 summary는 hash만 보존하고 원문 prompt/tool/reasoning/error/credential은 저장하지 않는다. Full prefix라도 collection HARNESS_DEFECT가 있으면 PARTIAL/NOT COMPARABLE인 경계를 추가로 수정 전 FAIL·수정 후 PASS로 확인했다.
- 변경 파일: Pi의 `agent-runner.ts`, `kernel.ts`, `fitness-types.ts`, `fitness-records.ts`, `launcher-fitness.ts`, Runtime quick/records tests, evals corpus/faux/runner 및 새 corpus test, SDK Fitness suite, Fitness 계획·roadmap·WORK_LOG. T3는 contracts `weavraFitness.ts`, UI `WeavraFitness.tsx`, `FitnessReader.test.ts` 세 파일만 변경했다. Root/Runtime README는 현재 계획/WORK_LOG를 참조하므로 유지했다. Dependency/lockfile, auth/models, main/tag는 무변경이다.
- 결정론적 검증: 새 oracle **18 PASS**, QUICK+records **96 PASS**, SDK Fitness **24 PASS**. 초기 SDK 통합의 bare/`sha256:` digest mismatch를 수정했고 후속 assertion의 새 file.state 및 실제 UNKNOWN usage를 바로잡았다. 추가 full-prefix 실패 회귀 뒤 records **25 PASS**다. Test skip/timeout을 늘리지 않았다.
- 최종 pre-actual Pi 직렬 chain: `npm run check && bash ./test.sh && npm run check:ci && npm run check:shrinkwrap && npm run check:install-lock:coding-agent && bash -n packages/company-runtime/bin/weavra` **215.72초·exit 0**. Runtime **54 files / 1,440 PASS**, coding-agent **282 files / 2,776 PASS / 50 skipped**, evals **9 files / 53 PASS**, 나머지 workspace/scripts/consumer smoke도 PASS다. Biome **1,464 files·no fixes**, TS/browser/dependency/lock gates PASS. 이는 LOG-113의 과거 결과가 아니라 이번 source의 재실행이다.
- Required-sandbox CLI: GOOD `7835675f-901a-4e81-befc-515f9e4368f5`는 10 PASS, FALSE_COMPLETER `6caa206c-d317-412b-b97a-3351588540a8`는 F06 FAIL/falseCompletion=true를 유지한 full이며 둘의 비교는 MATCHED다. F02 forbidden probe `c329626a-dcbd-45d0-b5ab-9d3acb2679f1`와 UNKNOWN/provider probe `59ae6654-333f-470a-b603-fff9d90306d2`는 PARTIAL이다. 첫 driver의 잘못된 F02 도달 가정으로 실패한 full CONTRACT_VIOLATOR `daee2feb-7c26-45c3-818b-724f4f1e7d0b`도 보존했다(R0의 미등록 write tool → protocol/UNKNOWN stop이 정상). 모델 결과를 고친 것이 아니라 F02 전용 probe 선택을 바로잡았다.
- Invalid-auth 격리 HOME의 CLI list/show/compare, historical 네 원본 재조회/hash 불변, full-failed 비교와 partial/full 비교, store 생성 전 unsafe invocation 4개 거부를 확인했다. Cost-bound `39c649e1-8230-4a32-9824-96b7dea7fb4e`는 0 fixture/worker에서 중단했다. Faux 기록은 private namespace `c06-v3-preactual-20260920`에 보존한다.
- T3 첫 전체 테스트는 **50 FAIL**이었다. 제가 지정한 `/tmp` alias와 실제 `/private/tmp` 차이로 path 관련 assertions/동기화가 실패했다. Source/assertion/timeout/skip은 그대로 두고 HOME/TMPDIR을 canonical 경로로 바꾼 Node **24.19.0** 직렬 전체 실행은 **1,270 files / 17,269 PASS / 58 skipped**다. Typecheck/lint/fmt/knip/build도 **exit 0**(전체 chain **398.72초**). 다른 기존 파일의 Effect suggestions·React 및 desktop build warnings는 남았고 변경한 세 파일 diagnostics는 없었다. 추가 `vp test run src/weavra`는 **5 files / 54 PASS**다.
- 실제 production T3 build → backend → Pi CLI → managed Chromium에서 8개 historical/faux record를 읽었다. 별도 private Weavra home에는 secret-free record bytes만 복사했고 T3 home/DB도 신규였다. F06 false completion, F02 FAIL, READY/INVALID, UNKNOWN, partial/full, full pair MATCHED 및 partial/full NOT COMPARABLE을 DOM과 화면에서 확인했다. Fitness 버튼은 Read history/Compare records뿐이고 control=0, chat turn·workflow·model 호출 0회다.
- 도구 문제: browser.open이 임시 일회성 pairing fragment를 자동 출력해 QA에 보고했다. 영구 credential은 출력하지 않았다. Owned browser/service를 종료하고 pairing 파일과 완료된 v2 재현/agent contract 임시 파일을 삭제했다. Actual/최종 검증에 필요한 driver·격리 UI 자료는 아직 유지한다.
- 남은 한계/다음: 실제 v3 full matrix는 아직 미실행이다. 동일 corpus/order/default medium, target별 fixtures 10 / workers 32 / reported tokens 500,000, required sandbox, retry/fallback 없음으로 정상 source commit/push·exact Pi CI 확인 후 각 1회 실행한다. Shared harness/cleanup 결함이면 이후 target도 시작하지 않는다. Partial만 얻으면 C06 OPEN이며 C08에 진입하지 않는다.
- 커밋 상태: 이 entry 작성 시 Pi/T3 모두 정상 devlop source commit 전이다. Exact source SHA/CI, 새 actual 결과와 최종 게시 판정은 후속 entry와 최종 보고에 기록한다. T3 main/PR-only CI의 devlop 미실행을 PASS로 표현하지 않는다. Stable tag `weavra-v0.1-rc1`의 object `7deb58be5b2da7b4f8e2cf42c1b1fd5d912a107c`는 이동하지 않는다.

## LOG-115 — 2026-09-20 23:32 (Asia/Seoul) — v3 fresh actual full·최종 회귀·actual T3 proof

**상태:** 두 actual full cohort와 최종 로컬/UI 검증 완료. Closure evidence 정상 게시·exact CI가 남았고 C08/Jev는 아직 시작하지 않았다.

- 목적: 독립 audit로 확정한 새 계약에서 성공/실패를 구제하지 않고 두 target의 전체 관측을 수집했다. LOG-114의 “actual 0회/source 게시 전”은 당시 상태이며 이번 기록으로 후속 결과를 추가한다.
- 선행 게시: Pi `b2b938aa2b890ec482265638fe882ad1e3bebb32` 정상 devlop push와 [exact CI 35515316545](https://github.com/kjg8619/pi/actions/runs/35515316545) success를 확인했다. T3 `6cced3c7f4b9f87f475b9ce8e362a93d11e8b7d2`도 정상 push했고 exact SHA runs/checks 0건, main/PR-only trigger에 따라 NOT RUN이다. 두 local/tracking/actual remote 일치·clean과 stable tag 불변을 확인한 뒤 actual을 열었다.
- 동결: corpus `weavra-fitness-3`/`sha256:91b78f62a4e16101efb8f3a1cef55cd0aab9309d1f7d8e98b6a3a9d457511566`, F01,F02,F03,F04,F05,F06,F07,F09,F10,F08, target별 fixtures 10/workers 32/reported tokens 500,000, required sandbox, default/clamped/mapped medium, sampling override 없음이다. Target/API/endpoint/tool/prompt/config/model-policy/fixture digests와 CI를 private frozen manifest에 보존했다. Upstream effective thinking은 UNKNOWN이다.
- 실행: 허용된 env-file 로드와 기존 auth만 사용했다. Exclusive once marker로 fresh cohort를 target별 한 번 실행했고 fixture 재실행·SDK automatic retry·fallback은 없었다. Actual driver 전체 526.74초 exit 0이다. 두 cohort에서 fixture 20개, worker invocations 34, model turns 117을 관측했으며 HTTP attempts는 UNKNOWN이다.
- Astra record `c032d3ec-05cb-42d0-bafe-827c19a31003`, result `sha256:ec7bc202464d9573a7d6df3e73d6ee4b7045692283deb3673fd150eb4824842b`; DeepSeek record `04b72270-eea6-48c2-9362-4aa57285799c`, result `sha256:8ed81b0bd44aa9115ca80f5029f62d9e2373bd73d4e1732c1f7115ab157f7945`를 canonical private store에 보존했다. Fixture별 원시 표는 Fitness 계획 §16에 기록했다.
- 두 record 모두 BUDGET_EXHAUSTED/CALIBRATION_READY/EVALUATION_COMPLETE, oracle PASS 10/FAIL 0/falseCompletion 0이다. F06은 REVIEW/Reviewer REVISE/BLOCKED/adherence=false를 유지하고 F07로 계속했다. F08은 예상 CANCELLED/PASS/cleanup CONFIRMED이며 integrity INVALID의 유일한 이유가 USAGE_UNKNOWN이다. 마지막 fixture라 coverage만 COMPLETE이고 더 호출하지 않았다. 모든 cleanup CONFIRMED, protocol error 0, harnessError false다.
- Contract 관측: strict receipt rejection Astra 1(F03), DeepSeek 3(F03 2·F07 1); scope/forbidden mutation/handoff/review rejection은 0이다. F07 controlled repair와 F06 REVISE 관측은 각각 1이다. `tools.retries` 1/3은 rejection 뒤 같은 tool 재호출을 센 fixture 내부 관측이며 cohort/fixture 재실행이나 SDK 자동 retry로 혼동하지 않는다.
- Raw usage/latency: known token subtotal 163,249/328,863, raw fixture latency 합 320,690/204,284ms, record wall 320,828/204,411ms, worker 17/17, model turns 51/66이다. 전체 tokens/cost/HTTP attempts/cache-write/transport count/upstream identity는 UNKNOWN이다. Reasoning은 Astra UNKNOWN·DeepSeek 관측 subtotal 12,689이며 output에 다시 더하지 않는다. 한 표본을 winner나 순위로 해석하지 않는다.
- 비교/UI: 동일 corpus/budget/harness/config/fixtures/kind로 comparable=true다. 기존 격리 production T3의 실제 CLI/backend/browser에서 두 actual full·F06 BLOCKED·strict receipt 1/3·F08 INVALID/UNKNOWN·known subtotal과 total/cost UNKNOWN을 확인했다. Fitness 버튼은 Read history/Compare records뿐이며 UI 실행 control/chat turn은 사용하지 않았다. 원본은 유지하고 owned byte copies만 사용했다.
- UI 문제/해결: 도구가 새 복사본을 0644로 만들어 private-record guard가 읽기를 거부했다. Source guard나 원본을 완화하지 않고 소유한 복사본만 0600으로 수정해 실제 읽기/비교를 통과했다. 기존 격리 session으로 연결해 새 pairing secret은 만들거나 출력하지 않았다. Browser/service를 종료했다.
- Actual 후 targeted: QUICK/records 96 PASS, SDK Fitness 24 PASS, oracle 18 PASS다. Oracle 첫 명령의 기본 eval config는 “No test files found”였고 기존 `--config vitest.test.config.ts`를 명시해 통과했다. Assertion/skip/timeout을 바꾸지 않았다.
- Actual 후 fresh faux CLI 32.52초 exit 0: GOOD `8c5bb665-195e-4d91-ac7b-f0be6789f89b`와 FALSE_COMPLETER `94aec730-ab23-4f91-91fa-cc173113bad7`의 full 실패 보존/comparable, forbidden partial `b0c9a9db-6904-47cf-9774-e4b72c21c901`, unreliable partial `e160220e-4070-4753-8d13-c8dc52c987a5`, 0-invocation budget `b70e0e14-4e2d-41fd-878a-3a2910005b26`를 새로 실행했다. Historical 네 원본 hash 불변·readonly invalid-auth·unsafe argv 4건 거부를 재확인했다. 이 faux 명령의 actual 호출은 0회다.
- 최종 Pi 전체: `npm run check && bash ./test.sh && npm run check:ci && npm run check:shrinkwrap && npm run check:install-lock:coding-agent && bash -n packages/company-runtime/bin/weavra` **218.37초·exit 0**. Runtime 54 files/1,440 PASS, coding-agent 282 files/2,776 PASS/50 skipped, evals 9 files/53 PASS, 나머지 workspace/scripts/consumer smoke도 PASS다. Biome 1,464 no fixes, TS/browser/dependency/lock PASS다. LOG-114의 pre-actual 결과와 구별되는 실제 후 재실행이다.
- T3는 LOG-114의 Node 24.19.0 전체 17,269 PASS/58 skipped·targeted 54 PASS·typecheck/lint/fmt/knip/build 이후 source 변경이 없었다. 기존 다른 파일 warnings와 exact SHA remote NOT RUN을 유지한다.
- 변경 파일: 이번 후속 단계의 tracked 변경은 Fitness 계획·roadmap·WORK_LOG 세 문서다. Actual/FAUX/manifest/once marker는 private evidence로 유지한다. Dependency/lock/auth/model/main/tag는 무변경이며 actual을 다시 실행하지 않는다.
- 남은 한계/다음/커밋: 이 closure evidence를 정상 devlop commit/push하고 exact CI를 확인한 뒤 C06 CLOSED를 확정한다. 전부 PASS가 아니라 신뢰 가능한 full collection이 closure 근거다. 그 이후에만 C08/Jev 연구와 첫 read-only slice를 시작한다. C06 evidence commit SHA/CI는 후속 entry에 추가한다.

## LOG-116 — 2026-09-20 23:46 (Asia/Seoul) — C06 closure exact CI 확인·C08 admission

**상태:** V0.6B/C06 CLOSED. C08 연구/첫 read-only slice의 선행 gate 충족; C08 구현/검증 완료를 뜻하지 않는다.

- 목적: LOG-115에서 남긴 evidence 게시 gate를 실제 exact SHA CI로 닫았다. Pi evidence commit `d67ce3968d83df5961a9facd5211a8a4d59cfd3a`의 [CI 35517110397](https://github.com/kjg8619/pi/actions/runs/35517110397)는 completed/success다. `gh run view ... --json databaseId,headSha,status,conclusion,url`로 정확한 head를 확인했다.
- 게시/보존: local/tracking/actual remote devlop이 해당 SHA로 일치하고 clean이며 immutable tag object `7deb58be5b2da7b4f8e2cf42c1b1fd5d912a107c`는 그대로였다. Actual source `b2b938aa2b890ec482265638fe882ad1e3bebb32`의 CI PASS와 full actual 원본은 바꾸지 않았다. T3 source/로컬 결과/remote NOT RUN은 LOG-114~115 그대로다.
- Closure 근거: 독립 corpus/oracle audit·새 revision, 두 full actual, known 실패/UNKNOWN 보존, read-only compare/T3 actual UI, 최종 로컬 전체 회귀, source/evidence exact CI다. 모델 전부 PASS를 요구하는 gate로 되돌리지 않는다.
- 정리: 완료된 actual/faux driver와 temp JSON, 소유한 격리 UI/T3-test 디렉터리를 제거했다. Browser/server/CI watcher는 종료됐다. Canonical historical/actual/faux records와 private manifest/once marker는 유지했다. 영구 auth/model/lock 설정은 변경하지 않았다.
- 변경 파일: Fitness 계획·roadmap·WORK_LOG의 현재 C06 상태와 후속 entry만 갱신했다. LOG-114/115의 당시 pending 상태·실패 이력은 수정하지 않았다. 이 상태 표시는 이후 C08 작업과 함께 정상 게시한다.
- 다음/한계: 이제 C08/Jev 공식 source와 기존 evidence/Host/Kernel 경계를 조사하고 첫 read-only slice를 구현·검증한다. Candidate observation과 Host-reviewed registration을 구분하고 fresh evidence·독립 verifier·Kernel authority를 요구한다. Jev에 독자적 PASS/COMPLETE 권한을 주지 않으며 추가 실제 Provider 호출은 계획하지 않는다.

## LOG-117 — 2026-09-21 00:57 (Asia/Seoul) — C08 pinned Jev 연구·첫 owned read-only browser slice

**상태:** C06 CLOSED 뒤의 조건부 후속 작업. 첫 read-only CLI/API 구현·actual 검증·최종 로컬 전체 gate 완료, 정상 게시/exact CI 확인 대기. C08 전체는 OPEN이다.

- 목적/순서: LOG-116의 `d67ce3968` exact CI success를 확인한 뒤 Jev 공식 source와 현재 Host/RegisteredVerifier/Kernel 경계를 조사했다. 기본 Agent/Browser의 ambient profile/default context, daemon 재사용, `BU_CDP_URL` fallback, cached snapshot/DONE과 독립 검증의 차이를 확인했다. 상세 pinned source와 한계는 Agent Landscape §10에 추가했다. 이 C08 작업에서 실제 Provider 호출은 0회이며 C06 actual/faux/historical record는 재실행·수정하지 않았다.
- 채택: Jev `1231850a0bf1a0c0341fe408ef1668dbbfdfac46`의 MIT DOM reader 원문 6,490 bytes / SHA-256 `e50473501c8fb8e70f3b21866d987393e3f2315c639d638bd477d170e81ed78d`만 vendoring했다. Python Agent/browser-harness/모델을 설치·실행하지 않았다. Dependency 0.1.13 source와 배포 digest는 조사했지만 source/distribution byte equivalence는 NOT VERIFIED다.
- 구현: `weavra browser observe --url ... --executable ... --local-test-app --json`과 Host API. 새 private profile/HOME·CDP pipes, filtered env·기존 process-group runner, 최초 정확한 loopback document GET, 앱 JavaScript 비활성, fixed isolated-world reader, 두 bounded capture 비교, cleanup 이후 candidate 반환이다. Candidate는 title/text/control label·provenance/hash만 투영하며 raw values/guards/screenshots·등록 check·Run/acceptance 변경·PASS/COMPLETE 권한이 없다.
- Authority: Host는 실제 oracle/AC/source/부작용을 검토한 뒤 새 Run의 기존 check 등록/Task Contract freeze 경계를 사용해야 한다. 향후 live browser 판정은 fresh 독립 evidence와 run/attempt·fixture/build·origin·target binding이 필요하다. 현재 CLI는 live browser verifier/자동 registration/action policy를 제공하지 않으며 required verifier sandbox의 network deny-all과 기존 Kernel guards를 바꾸지 않았다.
- 실제 CLI proof: macOS arm64 / HeadlessChrome `152.0.7977.42`, Node `24.19.0`의 `/tmp/weavra-c08-smoke.mjs`가 새 profile에서 동일 URL Revision 1→2, script/resource/redirect/frame/closed-shadow 거부, 이미 시작된 요청의 취소·process/profile cleanup, candidate의 `VerificationResultSchema` 비수락을 확인했다. 두 capture ID는 `6e253ed6-50e5-4994-a2e9-a96e0faa4827`, `4df32ca6-7dce-4b9d-865d-e4e43ceb4e04`이며 digest는 각각 `9c38446b7da24877688e3ada1d0adcde1407fce2b6d05c5f991eff43da0878de`, `5f2d92a8846d6da25493dc90d4684238263ffc54b7cec632ab93ae0aedaddf0e`다. App mutation endpoint·예상 밖 server request·exported secret sentinel·ambient store 생성·Provider 호출은 모두 0이었다.
- 경계 수정/실패 보존: Unicode URL의 canonical encoding 후 2,048 초과를 놓친 regression은 **1 FAIL / 6 PASS → 수정 후 7 PASS**였다. 첫 escaped-output probe는 viewport 밖 control 때문에 예상 실패 assertion이 실패했다(실제 CLI exit 0); owned fixture의 layout을 바로잡은 뒤 허용된 64-control/6,000-unit projection의 실제 output-limit 거부를 재현했다. 두 JSON projection의 escaping을 수용하도록 새 transport bound를 512 KiB로 정했고 Node `26.7.0`에서 **candidate 138,545 bytes / cleanup CONFIRMED**를 확인했다. C06 token/worker/fixture budget과 timeout은 변경하지 않았다.
- Closed shadow 수정: JS `element.shadowRoot`만으로는 closed declarative root를 못 봐 빈 candidate가 나오는 것을 실제 Chromium으로 재현했다. Bounded CDP DOM metadata 검사로 application open/closed shadow를 거부하고 native user-agent internals는 유지했다. 최종 Node 24 전체 browser smoke + Node 26 escaped probe는 **2.98초 exit 0**이었다. Chromium bundle을 CI dependency로 추가하지 않았으므로 이 DOM/cleanup 검증은 실제 throwaway smoke이며 7개 deterministic admission tests와 구분한다.
- 최종 검증 명령/결과: `npm run check && bash ./test.sh && npm run check:ci && npm run check:shrinkwrap && npm run check:install-lock:coding-agent && bash -n packages/company-runtime/bin/weavra`가 **216.57초 exit 0**. Runtime **55 files / 1,447 PASS**, coding-agent **282 files / 2,776 PASS / 50 skipped**, evals **9 files / 53 PASS**, 나머지 workspace/scripts/consumer도 PASS다. Biome는 driver 1개를 format했고 최종 non-write check는 **1,469 files / no fixes**, TypeScript/browser/dependency/lock gates도 PASS였다. Closed-shadow 수정 전 전체 215.89초 PASS는 별도 이전 결과이며 최종 결과로 대체해 숨기지 않는다.
- 변경 파일: `packages/company-runtime/src/browser-{snapshot,observation,driver}.ts`, `src/launcher-browser.ts`, `test/browser-observation.test.ts`, `bin/weavra`, Runtime README, Agent Landscape, roadmap, WORK_LOG. 앞 LOG-116의 Fitness 계획/C06 closure 상태 갱신도 함께 게시한다. 외부 dependency·lockfile·영구 auth/model 설정은 바꾸지 않았다. `devlop`이므로 package changelog는 규칙대로 추가하지 않았다.
- 정리: 소유한 fixture server는 종료(exit 143)했고 actual profile/process cleanup을 확인했다. `/tmp/weavra-c08-{server,smoke,output-bound}.mjs`와 각 smoke의 private directory를 제거했다. Historical/actual/faux C06 records와 manifest/once marker는 유지했다.
- 남은 한계/다음: Browser 전체 OS/network sandbox·탈출 daemon·hard memory cap·전체 시각 의미·future freshness를 증명하지 않는다. Linux browser actual, Jev 모델/행동 loop, live 독립 browser verifier·자동 등록, T3 browser control은 미검증/미지원이다. 이 bounded source를 정상 commit/push하고 exact CI를 확인한다. T3는 `6cced3c7f` 이후 변경하지 않았으며 LOG-114/115의 전체 로컬 PASS·remote NOT RUN을 현재 새 실행으로 위장하지 않는다. 이 entry 작성 시점에는 C08 commit/push를 아직 실행하지 않았다.

## LOG-118 — 2026-09-21 01:09 (Asia/Seoul) — C08 첫 read-only slice 게시·exact source CI 확인

**상태:** 첫 read-only slice의 정상 commit/push와 exact source CI PASS 확인. C06 CLOSED 유지, C08 전체는 OPEN.

- 게시/검증: `feat: add isolated Jev observation candidates`를 `81b4435d26373617116eac17d25f106f7f830889`로 정상 commit하고 origin/devlop에 push했다. `gh run view 35521294286 --json databaseId,headSha,status,conclusion,url`은 해당 exact SHA에 대해 completed/success를 반환했다([CI](https://github.com/kjg8619/pi/actions/runs/35521294286)). Supervised watcher도 exit 0이었다.
- 범위: C06 closure 확인 후 Jev source 연구와 owned read-only candidate 수집까지 완료했다. Jev Agent/action loop·live browser 독립 verifier·자동 check 등록·T3 browser control·browser 전체 OS sandbox를 완료로 확대하지 않는다. Candidate/check/Kernel authority 분리는 LOG-117과 Runtime README를 따른다.
- 로컬 근거 구분: LOG-117의 최종 full chain **216.57초 exit 0**, Runtime 1,447/coding-agent 2,776/evals 53 PASS와 actual Chromium proof가 이 source의 근거다. 이번 후속 기록은 WORK_LOG 현재 요약·새 entry와 roadmap의 CI 상태만 갱신하는 docs 작업이며 로컬 전체 테스트를 새로 실행했다고 기록하지 않는다.
- T3 확인: local HEAD/origin-devlop/실제 remote가 `6cced3c7f4b9f87f475b9ce8e362a93d11e8b7d2`로 일치하고 clean이었다. Exact SHA `gh run list`는 `[]`, commits check-runs는 0이었다. LOG-114/115의 전체 로컬 PASS와 remote **NOT RUN**을 구분하며 새 T3 변경은 없다.
- 보존/정리: 추가 Provider 호출·Fitness record 변경·auth/model/lockfile 변경 없이 진행했다. LOG-117의 owned browser fixture/profile/script는 이미 정리됐고 이번 CI watcher도 종료됐다. C06 source/evidence CI와 historical/actual/faux 기록을 수정하지 않았다.
- 다음/commit 상태: 이 확인 기록도 amend/force 없이 정상 docs commit/push하고 최종 docs HEAD의 exact CI까지 확인해 최종 응답에 기록한다. 이 entry는 source CI가 확인된 시점의 기록이며 아직 만들어지지 않은 자신의 commit SHA/CI를 성공으로 기입하지 않는다.

## LOG-119 — 2026-09-21 10:25 (Asia/Seoul) — C08 Host 등록·fresh independent browser verifier 구현

**상태:** bounded Runtime 구현·결정적 회귀·실제 Chromium/SDK workflow·Pi 전체 gate 완료. T3 구현/targeted 검증 진행, 실제 UI·최종 gate·양쪽 정상 게시/exact CI 전이므로 C08 closure는 OPEN이다.

- 목적/기준: Pi `devlop` `70d05448b5044846042331fed3a1f43e066b16e1`, T3 `devlop` `6cced3c7f4b9f87f475b9ce8e362a93d11e8b7d2`의 clean local/tracking/remote 기준에서 시작했다. C06은 CLOSED 그대로이며 actual/historical/faux Fitness 원본·auth/env file을 열거나 재수집하지 않았다. 추가 paid Provider 추론은 실행하지 않았다.
- 계약: candidate schema 2에 project/origin/document/target/value·capture/document revision·source/reader/executable identity·digest/freshness/CANDIDATE_ONLY를 고정했다. 별도 closed registration request/definition/evidence 타입, canonical digest, private bounded candidate 저장, Host-owned preview/confirm와 기존 config 등록을 추가했다. Candidate/LLM/T3가 등록 digest나 CheckResult/COMPLETE를 직접 만들지 못한다.
- 실행: 기존 RegisteredVerifier가 매 SELF_CHECK/TEST에 새 private HOME/profile/Chromium/CDP pipe로 수집한다. text equality/containment, element existence/absence, allowlisted attribute equality만 지원한다. Helper source bytes/generation·executable identity와 definition을 freeze하고 typed evidence를 Run/revision/step/attempt/diff에 bind한다. Browser PASS는 exit 0과 분리했으며 Kernel이 final freshness·서로 다른 capture ID·다른 required checks/독립 review를 함께 검사한다. Browser 실패는 automatic repair에서 제외했다.
- 변경 파일: Runtime의 `browser-types.ts`, `browser-registry.ts`, `browser-evidence.ts`, 기존 browser driver/observer/launcher, contracts/config/verifier-trust/verification/workflow/kernel, state-store/agent-runner, graph/evidence/observations/plan-preview, host-control/protocol과 관련 테스트다. T3는 기존 control contracts/controller/UI 및 contract/server/client/UI fixture를 확장했다. Runtime README에 사용·경계·한계를 반영했다. Dependency/lock/auth/model 설정과 Jev vendored source는 변경하지 않았으며 devlop 규칙에 따라 package changelog는 추가하지 않는다.
- 결정적 proof: admission **7 PASS**, 기존 Kernel/trust fixture migration **97 PASS**, 새 `browser-verification.test.ts` **40 PASS**다. 요청된 candidate 6·registration 7·freshness 5·security 7·authority 6 조건과 추가 streaming/source/identity/replay/repair 경계를 포함한다. CDP fixture는 프로토콜 상대이며 실제 Chromium으로 주장하지 않는다.
- 발견/해결: security review가 document load 완료 전 decoded streaming byte 제한 누락을 발견했다. 실제 helper+CDP fixture에서 262,145 decoded bytes 후 load가 끝나지 않으면 취소 timeout까지 기다리는 **FAIL**을 재현했다. `Network.dataReceived`의 decoded/encoded 누적 한도와 완료 body 한도를 함께 검사해 **PASS**로 바꿨다. 이는 overflow 관측 후 종료이며 hard pre-render memory cap이 아니다. 첫 40-test 실행은 잘못된 fixture request shape 1 FAIL/39 PASS였고 등록 request를 복구한 뒤 40 PASS다.
- 실제 Chromium: macOS arm64 / HeadlessChrome `152.0.7977.42`에서 explore → Host registry → fresh Ready **PASS**, retained Ready candidate + fresh Broken **FAIL**, subresource/redirect **UNAVAILABLE**, 금지 요청의 서버 도달 **0**, active request 취소 후 AbortError·새 profile directory 잔존 **0**을 확인했다. 실제 smoke는 테스트 소유 loopback 정적 문서만 사용했다.
- 실제 Runtime: `packages/coding-agent/test/suite/company-runtime-browser.smoke.test.ts`의 throwaway **2 PASS**에서 기존 suite harness/faux model registry·실제 Pi AgentSession·HostControlBridge·FileStateStore·Chromium을 연결했다. Faux Developer가 tracked HTML을 Broken→Ready로 수정하고 SELF_CHECK→별도 Reviewer PASS→TEST→COMPLETED를 확인했다. 두 번째는 Reviewer 단계 뒤 서버 문서만 Broken으로 바꿔 동일 workspace의 fresh TEST FAIL→BLOCKED·RunCompleted 미발행을 확인했다. 각 실행은 서로 다른 실제 Developer/Reviewer session 파일 2개, browser capture 3회, faux model turns 3회, repair 0·writer 해제와 durable typed evidence를 확인했다. 실제 유료 모델 품질 proof가 아니다.
- 현재 Pi 검증: `npm run hydrate:model-data` **exit 0**(metadata hydration만 수행, model inference 아님). 첫 `npm run check`는 unsafe finally throw lint로 실패했다. Cleanup 실패 우선순위와 cancellation을 유지하면서 cleanup 뒤 반환/throw로 정리한 재실행은 **6.63초 exit 0**, Biome 1,473 files/no fixes였다. `bash ./test.sh && npm run check:ci && npm run check:shrinkwrap && npm run check:install-lock:coding-agent && bash -n packages/company-runtime/bin/weavra && git diff --check`는 **228.01초 exit 0**. Runtime **56 files/1,487 PASS**, coding-agent **282 files/2,776 PASS/50 skipped**, evals **9 files/53 PASS**, 나머지 workspace/scripts/consumer gates도 통과했다.
- 현재 T3 검증: contracts **17 PASS**, client-runtime **28 PASS**, web control **18 PASS**, server control/auth **32 PASS**를 실행했다. 이후 browser controller correlation 2개를 추가했으며 전체 직렬 실행으로 검증 중이다. Node 24.19.0 typecheck/lint/fmt/knip chain은 exit 0이나 기존 다른 파일 suggestions/warnings가 있다. 신규 UI purity/index-key warnings는 수정 중이며 최종 검사/production build/actual UI 결과는 후속 entry에 별도로 기록한다. 이 중간 결과를 T3 최종 전체 PASS로 표시하지 않는다.
- 정리/제한: 성공한 실제 Chromium/SDK throwaway script·test와 소유 temporary project를 제거했다. T3 full tests는 canonical private HOME/TMPDIR·빈 환경의 직렬 workspace 실행으로 진행 중이다. 개인 browser/auth/remote crawling/actions, browser 전체 OS sandbox, Linux/Windows browser actual, 원래 process group을 탈출한 daemon, 임의 동일-user filesystem race의 완전 통제는 범위 밖이다.
- 다음/커밋: T3 actual registration UI와 최종 gate, 전체 결과 정리 후 명시적 파일만 정상 devlop commit/push하고 Pi implementation exact CI 및 별도 closure docs exact CI를 확인한다. 이 entry 작성 시 새 commit/push는 아직 없다. Stable tag와 C06 records는 이동/변경하지 않는다.

## LOG-120 — 2026-09-21 10:59 (Asia/Seoul) — C08 actual T3 등록/authority UI와 최종 로컬 gate

**상태:** Runtime 구현·actual whole workflow에 이어 production T3 actual UI도 완료했다. 양쪽 정상 source commit/push·exact CI 전이므로 전체 closure는 아직 OPEN이다.

- 실제 UI 구성: 소유 temporary Git project/loopback fixture, 빈 HOME·별도 `WEAVRA_HOME`, 실제 `weavra setup`/launcher control, Node 24.19.0 production T3 build와 별도 managed Chromium tab을 연결했다. 개인 Chrome profile·기존 auth/session·C06 기록은 사용하지 않았다. T3 chat/Workflow 시작과 Provider 추론을 요청하지 않았다.
- 실제 trace: CANDIDATE_ONLY·origin/document·`#status`·observed Ready·capture time/reader revision/digests를 읽었다. 기대값을 `Reviewed Ready`, 다시 `Reviewed Ready v2`로 수정했다. Preview 후 draft 변경은 이전 Confirm을 비활성화했고 Prepare/Cancel 직후 config checks는 0이었다. Runtime-issued preview의 exact expectation/digest를 modal에서 확인한 뒤에만 check 1개가 등록됐다. Runtime config의 assertion도 `text_equals`/`Reviewed Ready v2`였다. UI는 `REGISTERED, NOT VERIFIED`와 latest Run evidence 없음/Run 없음/writer false를 표시했다. ACK를 PASS/COMPLETE로 승격하지 않았다. 재로딩 뒤 두 번째 preview를 Cancel해도 check 수는 1이었다.
- Actual에서 발견/수정: 긴 registration digest가 modal description 폭을 넘었다. `apps/web/src/components/ConfirmDialogHost.tsx`에서 title에 이미 쓰는 `wrap-anywhere`를 description에도 적용했다. 최종 production 재빌드 뒤 실제 modal의 clientWidth/scrollWidth는 **510/510**, description은 **462/462**, computed overflow-wrap은 `anywhere`였다. 실제 screenshot과 명시적 Cancel을 확인했다. Assertion/digest bytes나 권한 계약은 바꾸지 않았다.
- T3 전체 회귀: canonical private HOME/TMPDIR·빈 env의 `pnpm exec vp run -r --concurrency-limit 1 test`가 **390.72초 exit 0**, **14 workspaces / 1,270 files / 17,284 PASS / 58 skipped**였다. 이 결과는 마지막 description CSS 수정 전이다. 수정 후 web `confirmDialog.test.ts` + `WeavraControls.test.tsx` **23 PASS**, 두 변경 component lint 출력 없음/exit 0, web typecheck exit 0을 확인했고 전체 직렬 suite를 다시 실행 중이다. 후속 entry에 최종 실행을 별도로 기록한다.
- T3 나머지 gate: root typecheck/lint/fmt/knip chain exit 0을 확인했다. 신규 WeavraControls purity/index-key warnings는 모두 수정했고 변경 component 최종 lint는 clean이다. 기존 무관한 Effect suggestions·React/build warnings는 그대로이며 이를 0-warning으로 주장하지 않는다. 마지막 root `pnpm fmt:check && pnpm build && git diff --check`는 **21.06초 exit 0**, fmt **3,969 files**/7 build tasks였다. 직전 web cwd에서 root-only `fmt:check`를 호출한 chain은 command-not-found exit 1이었고 올바른 root cwd에서 재실행했다.
- 실행 환경 문제: 첫 fixture의 HTTP readiness probe가 멈춰 소유 환경을 종료/삭제하고 private startup log + supervised port readiness로 바꿨다. Managed browser가 초기 transport를 시작하지 않던 상태는 owned page activation 후 정상 진행했으며 tool issue로 기록했다. LSP도 sibling T3의 확인된 component references를 빈 결과로 돌려 tool issue를 기록하고 실제 import/consumer를 확인했다. 초기 진단 context에 노출된 새 disposable pairing credential의 환경은 종료/삭제했으며 이후 private file→same-origin session 교환으로 처리했다. 기존 credential은 읽거나 로그에 넣지 않았다.
- Cleanup 재확인: 마지막 Runtime cleanup refactor 이후의 실제 active-document cancellation도 AbortError/owned profile 잔존 0이었다. 최종 managed tab을 닫고 T3/fixture/Runtime child들을 supervised stop **exit 0**으로 끝냈다. 새 UI 소유 directory/private pairing file/script와 첫 full-test private home/temp를 제거했고 해당 UI paths는 glob 0건이다. 최종 full-test home은 실행 종료 뒤 제거한다.
- 문서/보존: Runtime README, roadmap, adoption §11, 현재 요약을 bounded 계약/실제 proof/unsupported 범위로 갱신했다. Adoption §10·이전 WORK_LOG·C06 원본은 역사로 보존했다. auth/model/dependency/lock/vendored Jev source 변경은 없다. Pi status는 본 작업의 25 modified/5 new files, T3는 본 작업의 9 modified files만 있었고 staged 파일은 0이었다. Pi main `f9bcd351dc3cedf989bc5fc0f8aa012db5737df2`와 stable tag object `7deb58be5b2da7b4f8e2cf42c1b1fd5d912a107c`를 확인했다. T3에는 local `main` ref가 없어 해당 rev-parse만 exit 128이었으며 ref를 만들지 않았다.
- 다음/commit: Pi implementation과 T3 changes를 devlop에 정상 commit/push, Pi implementation exact SHA CI와 T3 exact SHA CI 여부, 별도 closure docs commit의 exact CI를 확인한다. 이 entry 작성 시 아직 새 commit/push는 없다.

## LOG-121 — 2026-09-21 11:10 (Asia/Seoul) — C08 source 게시·exact CI PASS와 bounded closure

**판정: C08은 현재 local-static observation → Host registration → fresh independent verification 범위에서 CLOSED다.** 실행 가능한 browser actions나 범용 browsing 완료를 뜻하지 않는다.

- 최종 로컬 gate: LOG-120의 마지막 UI wrapping 수정 후 전체 T3 직렬 회귀를 다시 실행했다. canonical private HOME/TMPDIR·빈 env의 `pnpm exec vp run -r --concurrency-limit 1 test`는 **351.35초 exit 0 / 14 workspaces / 1,270 passed files / 17,284 PASS / 58 skipped**였다. 이전 390.72초 결과와 구분하며 이 최종 결과가 T3 source commit의 근거다. 수정 후 targeted 23 PASS·web typecheck/lint·root fmt/build/diff와 actual modal width proof도 유지된다. Pi 최종 full test/check/check:ci/lock/shell/diff는 LOG-119의 현재 작업 결과다.
- 정상 게시: Pi source를 `de66efe2a5f6bdae4c7cf573ce89414d4b6cbcd2` (`feat: add registered fresh browser verification`, 30 files)로, T3 source를 `f6ff0ae0f1ae0f54aee055c64b82dd8e2b9eebdf` (`feat: add reviewed Weavra browser check registration`, 9 files)로 각각 명시적 파일만 정상 commit하고 `origin devlop`에 push했다. Amend/force/reset/stash/main push/tag 이동은 하지 않았다.
- Pi exact source CI: `gh run view 35552773990 --json databaseId,headSha,status,conclusion,url`에서 **headSha `de66efe2a5f6bdae4c7cf573ce89414d4b6cbcd2`, completed/success**를 확인했다([CI](https://github.com/kjg8619/pi/actions/runs/35552773990)). Supervised watcher도 exit 0이었다. 이 CI의 deterministic browser fixture 결과를 Linux actual Chromium 증명으로 확대하지 않는다.
- T3 exact source CI: 해당 SHA의 `gh run list --commit ...`는 0건, commits check-runs는 total_count 0, commit statuses도 total_count 0이었다. `.github/workflows/ci.yml`은 main push/PR trigger이므로 **NOT RUN**이며 PASS로 표기하지 않는다. 로컬 전체 regression/build/typecheck/lint/fmt/knip/actual UI proof와 구분한다.
- Closure 근거: candidate는 schema-closed/CANDIDATE_ONLY이고 Host만 기대값 검토·명시적 확인 뒤 등록한다. Frozen identity 아래 SELF_CHECK/TEST의 독립 fresh capture와 typed Evidence Pack이 기존 Kernel guards에 들어간다. Historical Ready/fresh Broken, Reviewer PASS/browser FAIL, browser PASS/다른 required FAIL, stale/reused capture, forged registration/result, redirect/request/download/credential-field 경계가 완료로 우회하지 못한다. Browser 실패는 자동 repair 대상이 아니다. 실제 Chromium cleanup, 실제 AgentSession/faux whole workflow의 COMPLETED/BLOCKED, actual T3 edited expectation/Cancel/Confirm/등록-only 상태를 별도로 확인했다.
- 문서/정리: README의 계약은 source commit에 포함했다. 이 closure 문서는 roadmap/adoption/current summary와 본 entry를 갱신하며 이전 entry/C06 원본은 고치지 않는다. 최종 T3 full-test 소유 home/temp도 제거했다. UI/fixture/Runtime 소유 서비스·tab·private pairing·throwaway scripts는 정리했고 source CI watcher도 종료됐다. 추가 paid Provider 추론은 0회다.
- 게시 identity: closure docs 편집 전 두 repo는 clean이고 각 local HEAD/tracking/actual remote devlop이 위 source SHA와 같았다. Pi local main은 `f9bcd351dc3cedf989bc5fc0f8aa012db5737df2`, 실제 remote main은 `890f920884f6d21fc7617d236ef9e1cc5d7a0ef8`로 서로 다른 기존 refs이며 동기화하지 않았다. T3에는 local main이 없고 remote main은 `411da2a7356dd795b720228e9c834ea9bad0415f`다. Stable tag local/remote object는 `7deb58be5b2da7b4f8e2cf42c1b1fd5d912a107c` 그대로다.
- 남은 지원 범위: click/type/submit/login/upload/download/drag-drop, 개인 인증/profile/daemon attach, remote/multistep navigation/crawling/payments, arbitrary JS, browser 전체 OS sandbox/hard pre-render memory ceiling, 다른 OS/browser actual, browser automatic repair는 제공하지 않는다. Same-user filesystem 외부 race와 group을 탈출한 process의 완전 통제를 주장하지 않는다. 기존 T3 unrelated warnings도 숨기지 않는다.
- 다음/commit 상태: 이 세 문서를 별도 정상 docs commit/push하고 **그 exact docs HEAD의 CI**와 최종 양쪽 clean/local/tracking/remote identity를 확인한다. 아직 만들어지지 않은 자신의 docs SHA/CI를 성공으로 기록하지 않으며 최종 응답에 관측한 결과를 명시한다.

## LOG-122 — 2026-09-21 11:58 (Asia/Seoul) — 최종 split-repository migration baseline closure

**목적/상태:** C08 구현을 변경하지 않고 남은 XXVIII/T3 validation, XXIX/Publication, XXX/Bounded closure를 실제 검증·게시 상태에 맞게 정리한다. **This is the final split-repository baseline before the planned Weavra repository consolidation.** 이 문구는 향후 `kjg8619/Weavra` 통합의 고정 비교 원본을 뜻하며 이번 작업이 저장소 생성·이관을 수행했다는 뜻이 아니다.

### 시작 identity와 보존

- Pi `devlop`의 local HEAD/tracking/실제 remote는 모두 `784644382b90c6f01319aa9ccefb1b108e03169a`, T3는 모두 `f6ff0ae0f1ae0f54aee055c64b82dd8e2b9eebdf`였고 두 worktree는 clean이었다.
- 기존 Pi closure exact run **35553422237 / headSha `784644382b90c6f01319aa9ccefb1b108e03169a` / completed / success**를 새로 조회했다. 이것은 이전 closure commit의 CI이며 아래 새 문서 commit의 CI로 재사용하지 않는다.
- Pi/T3 implementation·tests·dependency/lock/auth/model 설정·C06 actual/historical/faux records는 변경하지 않는다. 기존 Chromium/SDK actual proof는 LOG-119~121의 역사적 결과이며 이번 작업에서 재실행했다고 주장하지 않는다.

### XXVIII. T3 validation — 완료

Visual wrapping fix를 포함한 동일 T3 SHA에서 **이번 요청에 따라 새로 실행**했다. Node **24.19.0**, pnpm **11.10.0**, canonical private HOME/TMPDIR와 빈 환경(`env -i`, 필요한 PATH/HOME/TMPDIR/CI만 지정)을 사용했다. 아래 순서 전체는 **442.74초 / exit 0**이며 시간은 full tests만의 시간이 아니라 focused tests와 나머지 gates까지 포함한다.

| 범위 | 이번 전체 suite 결과 | 별도 focused 재실행 |
|---|---|---|
| contracts | 26 files / **463 PASS** | `src/weavraControl.test.ts`, `src/weavra.test.ts` — **17 PASS** |
| server | 340 passed files / **5,232 PASS / 10 skipped** | `src/weavra/RuntimeController.test.ts`, `src/weavra/ControlTransport.test.ts` — **26 PASS** |
| client-runtime | 79 files / **1,560 PASS** | `src/state/weavraControl.test.ts`, `src/state/weavra.test.ts` — **28 PASS** |
| web | 394 files / **5,322 PASS** | `src/components/settings/WeavraControls.test.tsx`, `src/confirmDialog.test.ts` — **23 PASS** |
| 전체 workspace | **14 workspaces / 1,270 passed files / 7 skipped files / 17,284 PASS / 58 skipped** | focused 94 PASS는 전체 수에 중복 합산하지 않음 |

실행 명령은 T3 root 기준이다.

```sh
pnpm exec vp run -r --concurrency-limit 1 test
pnpm --filter @t3tools/contracts exec vp test run src/weavraControl.test.ts src/weavra.test.ts
pnpm --filter t3 exec vp test run src/weavra/RuntimeController.test.ts src/weavra/ControlTransport.test.ts
pnpm --filter @t3tools/client-runtime exec vp test run src/state/weavraControl.test.ts src/state/weavra.test.ts
pnpm --filter @t3tools/web exec vp test run src/components/settings/WeavraControls.test.tsx src/confirmDialog.test.ts
pnpm typecheck
pnpm lint
pnpm fmt:check
pnpm knip:check
pnpm build
```

- Typecheck: **exit 0**, 15 workspace tasks, 기존 Effect suggestions가 있다. 진단 없음으로 과장하지 않는다.
- Lint: **exit 0 / 722 warnings / 0 errors**, 3,794 files. 기존 source를 유지했으며 warning을 수정·억제하지 않았다.
- Fmt: **exit 0**, 3,969 files 모두 format 일치. Formatting write를 실행하지 않았다.
- Knip: files/dependencies와 지정 workspace exports 두 검사가 모두 **exit 0**이었다.
- Build: **exit 0**, 7 tasks. 기존 `x11` unresolved external, CJS `import.meta`, dependency bundling/plugin timing 경고·안내를 보존한다. 이 결과는 zero-warning 보장이 아니다.
- 전체 test/typecheck/build task cache hit는 각각 **0/14, 0/15, 0/7**이었다. 완료 후 T3는 여전히 동일 HEAD/tracking과 clean worktree였으며 `git diff --check`도 exit 0이었다.
- 따라서 `XXVIII. T3 validation · Recheck full T3 regression after visual wrapping fix`를 이번 실행 근거로 완료한다. 이전 351.35초/390.72초 결과는 덮어쓰지 않는다.

### XXIX. Publication — 기존 게시 확인 및 최종 문서 게시

- 기존 Pi implementation `de66efe2a5f6bdae4c7cf573ce89414d4b6cbcd2`, closure `784644382b90c6f01319aa9ccefb1b108e03169a`, T3 implementation `f6ff0ae0f1ae0f54aee055c64b82dd8e2b9eebdf`의 정상 게시 이력을 보존한다. T3는 변경이 없으므로 새 empty/source commit을 만들지 않는다.
- T3 exact SHA runs/check-runs는 이번 조회에서도 0건이다. Remote CI는 **NOT RUN**이며 로컬 regression PASS와 구분한다.
- 변경 파일은 `docs/WORK_LOG.md`와 `docs/WEAVRA_ROADMAP_2026-09-17.md` 두 문서뿐이다. 이 closure-only 문서를 정상 commit/push하고 **그 새 Pi exact HEAD의 CI**와 최종 local/tracking/remote·clean 상태를 최종 보고에서 확인한다. 아직 만들어지지 않은 자기 commit SHA/CI를 이 entry에서 PASS로 기입하지 않는다.
- Immutable baseline은 최종 보고에서 확정한 **full commit SHA 쌍**이다. 이동 가능한 `devlop` 이름 자체를 immutable이라고 부르거나 새 tag/branch-protection 정책을 만들지 않는다. Main, 기존 stable tag, Git history를 이동/재작성하지 않는다.

### XXX. Bounded closure — 기존 C08 범위 유지

README의 기존 계약과 이번 시작 source identity를 대조했다. Browser/Jev는 **observation producer only**, candidate는 **CANDIDATE_ONLY**, registration authority는 **Runtime/Host**, verification authority는 **RegisteredVerifier**, completion authority는 **Kernel**이다. 매 검증의 fresh browser capture를 요구하고 candidate evidence 재사용·browser automatic repair를 허용하지 않는다. Action loop, login/authenticated personal browser, 임의 remote navigation/crawling은 지원하지 않는다. Browser 전체 OS sandbox·다른 OS/browser actual 지원으로 확대하지 않는다.

- 새 C09/V0.6D 기능, architecture refactor, repository 구조 변경, `kjg8619/Weavra` 생성·이관·merge·subtree는 수행하지 않았다. 추가 paid Provider 추론은 실행하지 않았다.
- 새 테스트·수정한 소스는 없으며 소유 validation script와 private HOME/TMPDIR는 실행 완료 뒤 제거했다. 기존 warnings/unsupported 범위는 migration baseline의 알려진 제한으로 남긴다.
- 최종 문서 exact CI와 양쪽 clean/동일 HEAD 확인 후 Publication/Bounded closure를 완료 처리하고 보고 후 종료한다. 향후 통합 실행은 별도 승인된 작업이다.
