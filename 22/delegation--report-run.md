# report-run (todo 22, round 2, resumed)

## 결과
- 이어받은 상태: 이전 실행은 WeavraControls/WeavraSettings/WeavraFitness/ProjectSettingsPanel/CapabilityInventory 와 ko.workspace.ts(runtime.capabilities/controls/labels)를 편집했지만 "Run"/"Planner"/worker 등 라틴 문구가 남아 있었고, WeavraComplex·WeavraTaskResult·WeavraTaskCard·weavraTaskLogic·useWeavraTask 는 손대지 않은 상태였다. 기존 편집은 유지하고 중복 키 없이 이어서 마무리했다.
- 변경 파일(모두 app/t3code/apps/web/src 기준): i18n/ko.workspace.ts, components/settings/{WeavraControls,WeavraSettings,WeavraComplex}.tsx, components/chat/{WeavraTaskResult,WeavraTaskCard}.tsx, components/chat/{weavraTaskLogic,useWeavraTask}.ts. WeavraFitness/ProjectSettingsPanel/CapabilityInventory 는 이번 라운드 추가 변경 없음(이전 편집 유지, 재검사만).
- 추가한 카탈로그: ko.runtime.task.{card,result,logic,errors,complex} (약 444개 문구/함수), ko.runtime.controls.sectionTitle = "Weavra · 워크플로 제어".
  - 부모에게: WeavraRunGraphPanel.tsx 의 readinessHint("Weavra · 워크플로 제어") 는 ko.runtime.controls.sectionTitle 로 바꾸면 된다(내 범위 밖이라 편집하지 않음). WeavraControls 섹션 제목은 이미 이 키를 사용한다.
- ko.runtime.labels.values 에 누락된 wire 값 라벨 추가: ELIGIBLE 시작 가능, SELF_CHECK 자체 검사 중, REVIEW 검토 중, TEST 테스트 중, NOT_REQUESTED 요청 안 됨, INTEGRATION_CHECK 통합 검사, FINAL_TEST 최종 테스트, COMPLETING 완료 처리 중. 이제 WeavraCanonicalRunStatus·WeavraConnectionStatus·WeavraComplexTaskStatusV2·WeavraComplexCleanupStatus·WeavraComplexPhase 의 모든 값이 한국어로 표시된다(ko.test.ts 통과).
- 용어: "Run"→실행(공식 실행, 실행 리비전, 이전 실행 등), Planner→계획 담당(weavraLabel 의 Planner 라벨과 동일), worker→워커, revision→리비전, checkout→체크아웃, digest→다이제스트, Diff 라벨→변경 다이제스트, 프로바이더→공급자, Host→호스트, Budget→예산, Integration→통합, sandbox→샌드박스, push→푸시. "Run 그래프" 는 손대지 않음.
- 표시 변화(카피 전용): 쓰기 잠금 존재 값을 String(true)/"UNKNOWN" 대신 weavraLabel(예/아니요/확인 안 됨)로 표시(WeavraControls, WeavraComplex). WeavraControls 의 busy 표시 "active"/"idle" → "진행 중"/"대기". 증거 레코드 aria-label 은 원시 category 키 대신 분류 라벨(예: "등록된 검사 기록 1")을 사용.

## 테스트 갱신 (단언 의미 유지, 문구만 새 값으로)
- components/settings/WeavraControls.test.tsx: Run→실행, Planner→계획 담당, "worker 호출"→"워커 호출", "쓰기 잠금 존재:  true"→"예", "UNCONFIRMED / true"→"UNCONFIRMED / 예".
- components/chat/WeavraTaskResult.test.tsx: "실행 run-result", 사용량 "· 워커 N", PR 초안 꼬리말 "Weavra 실행 … 상태 리비전 9 · 코드 리비전 2", "이전 실행 run-result 검토 결과 REVISE".
- components/chat/WeavraTaskCard.test.tsx: "작업 및 체크아웃 진단", PREPARE_REJECTED 문구에서 "Run 실행을" → "실행을".

## 실행한 명령 (app/t3code, Node 24.19.0)
- pnpm exec vp fmt <14 files> → 0; vp fmt --check → 0 ("All matched files use the correct format").
- pnpm exec vp lint <14 files> → 0, 경고 1건: ProjectSettingsPanel.tsx:292 react(memo-dependencies) — HEAD 와 동일한 `[updateAllMembers]` 의존성 줄로, 이번 변경과 무관(기존).
- pnpm --filter @t3tools/web typecheck → 담당 파일 오류 0, 전체 "error TS" 0건.
- apps/web: pnpm exec vp test run --project unit ko.test.ts, WeavraControls/CapabilityInventory/WeavraSettings/WeavraFitness tests, WeavraTaskResult/WeavraTaskCard/weavraTaskLogic/useWeavraTask/weavraTaskFocus/weavraTaskResultLogic/WeavraRunGraphPanel tests → 첫 실행 249/250 통과(WeavraControls "UNCONFIRMED / true" 단언 1건이 예/아니요 라벨 변경으로 실패) → 단언 갱신 후 WeavraControls + ko.test 재실행 82/82 통과.

## 의도적으로 남긴 라틴 문구 (분류)
- 열거형/식별자 값(원문 그대로): COMPLEX, STANDARD, QUICK, COMPLETED, INTERRUPTED, BLOCKED/CANCELLED/FAILED, REVISE/BLOCK(검토 판정, ko.runtime.task.result.reviseOutcome/blockOutcome), PASS/COMPLETE/VALID(WeavraControls.tsx 689·709·916·2050·2172 판정 설명), SELF_CHECK·TEST(916), CANCELLED(722), NOT EXPOSED(751), CANDIDATE_ONLY(1887), TARGET_CHANGED/PREPARE_REJECTED 등 오류 코드 접두, R3, MODEL_UNAVAILABLE 등.
- 명령/경로/설정 키: weavra project init --config <reviewed-config.yaml>, docs/operations/LOCAL_TEAM_PILOT.md, .ai/config.yaml, .ai/ (errors.guidance), weavra project doctor(errors.doctor 인자), weavra setup / weavra doctor(WeavraSettings.tsx 21·23 — Record 문자열이라 <code> 감쌀 수 없음, 보고), git status(WeavraTaskCard 에서 <code> 로 분리), orchestration:operate(권한 범위 ID, 함수 인자), models.intents.plan(WeavraControls 149), sha256:/lines/start/end(card.sourcesHelp, JSON 키), HOME·CDP-pipe(WeavraControls 1859), HEAD(card.targetCheckout, Git 참조 이름), "Weavra: 작업 시작 전 기준 커밋"(Runtime 커밋 메시지 원문).
- 단위: 256 KiB / 8 KiB / 2KiB(표시 한도), ms·s(경과 시간).
- 허용 고유명사: Weavra, Runtime, Kernel, Codex, Claude Code, Git, CLI, JSON, PR(2자), HTTP.
- 판단 보류: "활성 MCP"(card.analysisRefusals) — 프로토콜 고유명사로 보고 유지. 허용 목록에 없으니 부모 판단 필요.
- 비가시: WeavraTaskResult.tsx:353 'section[aria-label="프로젝트 설정"], …' 는 WeavraProjectSetup 의 라벨을 찾는 DOM 선택자라 그대로 둠(그 라벨이 바뀌면 함께 바꿔야 함).

## 확인 필요/우려
- Planner→"계획 담당" 으로 "계획 담당으로 초안 만들기", "계획 담당 실행 중"(aria-label) 등이 됐다. 러너가 "Planner …" 이름으로 선택하면 별칭이 필요하다.
- useWeavraTask 의 INVALID_GOAL 감지는 오류 문구 안 "(INVALID_GOAL)" 토큰에 의존한다. errors.prepareRejected 가 `code (reason):` 형식을 유지해 동작은 같다.
- 고정 폭 때문에 맞지 않는 라벨은 발견하지 못했다(레이아웃·클래스 변경 없음).
