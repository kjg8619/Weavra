# Weavra 보완 계획 및 추가 기능 조사

> 작성일: 2026-09-17 (KST)  
> 검토 브랜치: `devlop`  
> 검토 기준 소스: `e09100fe3e0ce08610b48a056ed6cd03714e0f97`  
> 상태: **원래 본문은 정적 개선 제안. V0.3C 및 V0.3D의 표시된 범위만 구현·자동 검증**<br>
> 목적: 현재 보완점을 실행 가능한 작업으로 정리하고, 추가 기능을 기존 구조의 재사용·안전 경계·실사용 효과에 따라 선별한다.

원래 조사는 제품 코드, 설정, 기존 검증 기록을 변경하지 않았으며 전체 build/test, 실제 Provider 호출, 외부 도구 설치 및 통합 실험을 수행하지 않았다. 해당 시점의 관찰·고정 SHA 근거는 보존한다. 후속 V0.3C에서는 **FIX-01/02/04만 구현**하고 Node26/macOS 49 files / 1,646 PASS, Node22/macOS targeted 18 files / 800 PASS 및 non-mutating check:ci를 확인했다(WORK_LOG LOG-046). 실제 GitHub Actions/Node22 Linux build-test·전체 fresh install·branch protection·새 contract의 실제 Provider는 NOT VERIFIED다. 후속 V0.3D는 FIX-03/FIX-06과 FEAT-02의 file listing만 구현했다(LOG-048). 지침 snapshot/안전성·JVM risk·bounded discovery의 자동 회귀는 통과했지만 Provider smoke 1회는 `path:"."` 거부로 FAILED였다. 설명 보완 후 실제 성공은 미검증이며 self-hosting을 주장하지 않는다. 아래 다른 후보의 완료 기준은 여전히 계획이다.

기존 `MASTER_SPEC`, `DECISIONS`, 구현 계획과 작업 로그를 대체하지 않는다. 새로운 명령·설정·자료 구조의 예시는 모두 설계 후보이며 **현재 `.ai/config.yaml`에 그대로 넣으면 안 된다.** 현재 config는 미지원 필드를 거부한다.[S10]

## 목차

1. [결론과 유지할 경계](#1-결론과-유지할-경계)
2. [현재 자산과 이전 평가의 보정](#2-현재-자산과-이전-평가의-보정)
3. [보완 백로그](#3-보완-백로그)
4. [추가 기능 조사](#4-추가-기능-조사)
5. [권장 실행 순서](#5-권장-실행-순서)
6. [실사용 평가 설계](#6-실사용-평가-설계)
7. [공통 완료 기준과 작업 분할](#7-공통-완료-기준과-작업-분할)
8. [근거 자료](#8-근거-자료)

## 1. 결론과 유지할 경계

현재 Weavra의 강점은 에이전트 수가 아니라 **Kernel이 구현·리뷰·검증·승인을 구분하고 최신 증거로 완료를 통제하는 구조**다. 다음 투자는 병렬 조직 확대보다 요청 계약, 프로젝트 맥락, 코드 탐색, 평가·사용량 측정에 우선 배분하는 것을 제안한다.[S4][S5][S11]

유지할 경계:

- Kernel만 workflow 전이와 완료를 결정한다. 모델·UI·telemetry·외부 도구는 실행 권한의 원본이 아니다.
- Reviewer는 독립 세션으로 실행하고, 실행 허가와 리뷰 PASS를 구분한다.
- Policy의 기본 보호, R2 독립 리뷰, 한정 R3 일회성 승인, stale evidence 거부를 유지한다.
- `~/.pi`와 Weavra 저장 영역을 분리하고 `weavra-v0.1-rc1` 태그를 변경하지 않는다.
- 자동 commit/merge/stash/reset/rollback/worktree 삭제, 중단된 Run의 자동 resume는 추가하지 않는다.
- 일반 Pi 대화와 `/workflow run`의 보장 범위를 혼동하지 않는다. 사용자 저장 영역 분리와 Git worktree는 OS sandbox가 아니다.
- DeepSeek는 보류 및 NOT VERIFIED를 유지한다. GPT 기록을 다른 Provider의 검증 근거로 사용하지 않는다.[S1][S16]

우선순위의 뜻은 다음과 같다. 보안 취약점 등급이나 소요 시간 추정이 아니다.

| 우선순위 | 의미 |
|---|---|
| P0 | 일상 사용 확대 전에 설치·회귀·사용자 의도 보호 경계를 먼저 정리 |
| P1 | 실제 작업 품질과 편집·검증의 신뢰성을 높이는 핵심 보완 |
| P2 | 운영 편의 또는 앞선 보완 이후 선택적으로 도입 |
| HOLD | 현재 범위 밖. 별도 설계·승인·검증 없이는 시작하지 않음 |

## 2. 현재 자산과 이전 평가의 보정

| 이미 있는 것 | 후속 작업에서의 처리 |
|---|---|
| QUICK / STANDARD 순차 실행, 독립 Reviewer, 검증 및 완료 guard | 유지·확장. 새로운 오케스트레이션 프레임워크로 교체하지 않음 |
| setup/doctor, 전용 agent dir, worktree, status, 읽기 전용 graph | 재구현하지 않음. `/graph`를 병렬 실행 scheduler로 설명하지 않음 |
| V0.3A optional anchored read/edit | 신규 기능으로 다시 계획하지 않음. strict 모드와 복구 검증을 후속으로 분리 |
| `packages/evals` | 실제 AgentSession, 격리 fixture, 비교 실행, 토큰·시간·추정 비용 보고 기반을 우선 재사용 |
| `packages/telemetry` | backend 중립 계약, NOOP 및 in-memory 구현을 재사용. 외부 SaaS를 기본 의존성으로 만들지 않음 |
| OMP/OMO 도입 계획 및 Pi Extension 도입 계획 | LSP·sandbox·메모리 등 기존 후보와 연결하고, 이 문서를 새 구현 완료 선언으로 사용하지 않음 |

특히 **평가 도구와 telemetry가 저장소에 전혀 없다는 평가는 부정확하다.** 필요한 일은 Weavra의 Run/role/check 수명주기를 기존 기반에 연결하는 것이다. 기존 eval harness가 Weavra workflow를 수정 없이 직접 실행한다는 뜻은 아니며, 별도 adapter 또는 suite 연결이 필요하다.[S13][S14]

검증 기록의 범위도 구분한다. V0.1의 909개 테스트 기록은 문서에 명시된 과거 HEAD의 결과다. 최신 anchored smoke는 두 시나리오에 한정되며, stale 거부 사례의 CANCELLED는 harness가 취소한 결과다. 실제 모델의 자율 재읽기·복구 성공까지 입증하지 않는다.[S12][S16]

## 3. 보완 백로그

| ID | 우선순위 | 항목 | 관찰의 성격 | 주요 변경 후보 |
|---|---|---|---|---|
| FIX-01 | P0 | 설치 대상 브랜치 명시 | 문서·저장소 설정 불일치 | 루트 README |
| FIX-02 | P0 | devlop CI 및 비수정 검사 | CI 구성 보완 | `.github/workflows/ci.yml`, root scripts |
| FIX-03 | P1 | 프로젝트 지침 전달 | 기본 Host 연결 누락 | extension / agent-runner / config |
| FIX-04 | P0 | 요청 분류와 read-only 계약 분리 | 정적 코드상 권한 경계 점검 필요 | classification / workflow / policy / tools |
| FIX-05 | P1 | 개별 수용 기준과 증거 매핑 | 현재 요구사항 모델의 한계 | contracts / workflow / kernel |
| FIX-06 | P1 | JVM 의존성·프로젝트 위험 경로 | 파일명 기반 분류 범위 부족 | policy / config |
| FIX-07 | P1 | 기존 파일 strict edit | 현재 선택적 보호의 확장 | anchored-files / agent-tools |
| FIX-08 | P1 | 검증 프로그램·기준의 신뢰 고정 | 문서화된 비격리 경계 보강 | verification / agent-runner |
| FIX-09 | P2 | 실제 worker 설정·빌드 출처 표시 | 재현성·관측 보완 | launcher / doctor / agent-runner |
| FIX-10 | P2 | 현재 상태와 역사 문서 분리 | 문서 탐색·검증 추적 보완 | README / readiness / 작업 로그 |

### FIX-01 — 설치 대상 브랜치 명시

**V0.3C 반영:** README clone에 `--branch devlop --single-branch`를 명시하고 main/upstream, devlop/development, immutable RC tag를 구분했다. fork-local rebuild 계약과 global pi 불변을 유지한다. 문서 contract/launcher regression은 PASS이며 fresh install 전체 재실행은 미수행이다.

**관찰(조사 기준 SHA):** 루트 Weavra README의 clone 명령에는 branch가 없다. 조사 시 저장소 기본 브랜치는 `main`이고 main README는 Pi Agent Harness 안내다. 따라서 devlop 문서를 읽고 그대로 설치해도 동일 소스를 받는다고 보장되지 않는다.[S0][S1][S21]

**제안:** 개발판 설치는 `--branch devlop --single-branch`를 명시한다. 안정 태그 설치는 별도 경로로 설명하고 해당 태그의 실제 파일·명령에 맞춰 독립 검증한다. checkout 이동 및 갱신 후 rebuild 필요도 유지한다.

```sh
# 개발판 checkout을 선택하는 명령. 설치 실행 결과를 주장하는 예시는 아니다.
git clone --branch devlop --single-branch https://github.com/kjg8619/pi.git weavra
```

**완료 기준:** 새 임시 환경에서 문서의 전체 설치 순서를 수행하고 `weavra`가 해당 checkout의 CLI/Extension을 사용함을 확인한다. 기존 global `pi`, 사용자 Pi 설정, 안정 태그는 바뀌지 않아야 한다.

### FIX-02 — devlop CI와 읽기 전용 검사

**V0.3C 반영:** main/devlop push/PR trigger, `check:base` 공유·non-write `check:ci`, credential 없는 isolated `test.sh`, launcher syntax와 final `git diff --exit-code HEAD --`를 구성했다. 기존 build의 tracked model catalog generation 경로는 ignored data-only hydration + offline build로 분리했다. check:ci 전후 tracked/untracked source bytes 불변과 unformatted fixture의 실패/무수정을 확인했다. 실제 Actions/Linux 및 branch rule 설정은 아직 NOT VERIFIED다.

**관찰(조사 기준 SHA):** CI의 push/PR 대상은 `main`뿐이다. devlop 직접 push는 이 workflow를 시작하지 않는다. 루트 `check`는 `biome check --write`를 포함하므로 이름만 보고 비수정 검사로 취급하면 안 된다.[S2][S20]

**제안:** devlop push 및 필요한 PR 대상으로 핵심 회귀를 실행한다. formatter 적용과 CI 검사를 분리한다. Weavra 핵심 unit/integration, coding-agent 연결, launcher 및 기존 Pi 관련 회귀를 명시적으로 묶는다. macOS/POSIX 검증 경로와 Linux 검증 경로를 구분하며, Node 지원 범위와 실제 테스트 버전을 기록한다. 유료 Provider 검증은 매 push에서 자동 호출하지 않는다.

**완료 기준:** 의도적 회귀가 CI에서 실패하고 정상 fixture가 통과한다. CI 종료 후 checkout의 tracked diff가 없어야 한다. API key 없는 환경에서도 핵심 회귀가 수행되고, 모델 미실행을 모델 검증 PASS로 보고하지 않아야 한다. 실제 branch rules/required checks 설정 여부는 YAML 존재와 별도로 확인한다.

### FIX-03 — 프로젝트 지침을 고정된 입력으로 전달

**V0.3D 반영:** `project.instructions.path`의 explicit 파일 하나를 trusted adapter preflight에서 64 KiB strict UTF-8/regular/single-link/no-follow·identity 검사로 snapshot한다. 모든 role은 같은 frozen content를 사용하고 다음 run만 재읽는다. selected file은 worker protected path/list 결과에서 제외하며 durable state와 observation에는 path/digest/bytes만 남긴다. config/action/Policy/Agent request의 digest binding을 대조한다. context는 권한이 아니며 자동 AGENTS/CLAUDE/Skill/Extension discovery나 여러 파일 merge는 없다. 기존 inline Host seam과 configured file의 동시 지정도 거부한다.

**관찰(조사 기준 SHA):** `PiAgentExecutorOptions.projectInstructions`와 prompt 연결은 있지만, 기본 extension의 `PiAgentExecutor.create()` 호출은 값을 전달하지 않는다. worker는 자동 AGENTS/Skill/Extension 탐색도 하지 않는다.[S3][S4]

**제안:** Host가 사용자가 선택한 지침 파일만 읽고, 경로·내용 digest·크기·선택 내역을 이번 Run의 instruction snapshot으로 고정한다. Developer와 Reviewer에 같은 작업 규칙을 전달하되 정책 권한으로 해석하지 않는다. 초기에는 명시적인 파일 하나부터 지원하고, 중첩 지침의 상속·우선순위는 별도 설계한다.

**완료 기준:** 지침이 양쪽 세션에 실제 전달되는 integration test가 있어야 한다. 파일 변경 후 다음 Run은 새 snapshot을 사용한다. symlink·외부 경로·과대 파일·인코딩 오류·신뢰 미승인은 거부한다. 지침에 승인 우회나 shell 사용 문장이 있어도 도구 권한은 늘어나지 않아야 한다.

### FIX-04 — 자연어 분류와 실행 권한을 분리

**V0.3C 반영:** 순수 execution-contract 모듈이 후보와 trusted `{runId, mode}`를 분리한다. Host 확인 후 Run/Agent/Policy에 READ_ONLY/EDIT를 고정하고 tool 미노출·직접 Policy DENY·durable mode binding·완료 시 no-change를 집행한다. mode는 worker input/config override가 아니다. 과거 mode 부재는 UNKNOWN으로 관찰하고 새 live 실행은 누락/불일치를 거부한다. R2 review/R3 approval/risk floor는 유지하며 READ_ONLY/R3는 preflight에서 fail closed한다. Korean/English negation·인용·혼합, 한글/공백/quote/문장부호 및 `src/a.ts:` regression을 추가했다. 아래 관찰은 수정 전 소스의 근거로 보존한다.

**관찰 1(조사 기준 SHA):** intent는 순서 있는 정규식으로 고른다. `오류 원인을 설명해줘`의 `오류`, `삭제하지 말고 설명해줘`의 `삭제`처럼 목적·부정 표현을 충분히 반영하지 못한다. 미인식 요청의 `requiresConfirmation`은 현재 workflow에서 추가 해석 확인 대신 실행 거부 조건으로 사용된다. QUICK 파일 경로 파싱은 경로 뒤 문장부호에도 민감하며 실제 smoke에 관련 preflight 실패가 기록돼 있다.[S5][S6][S9][S12]

**관찰 2 — 중요:** R0 분류와 강제 read-only를 동일하게 취급하지 않는다. QUICK/R0은 `executorScope` 및 무변경 guard가 있지만, STANDARD/R0은 같은 QUICK scope를 받지 않는다. 일반 Developer는 write/edit 도구를 받고, 파일 작업의 risk는 R1로 구성된다. StateStore의 추가 risk binding 검사는 ALLOW R2/R3에 적용된다. 따라서 **STANDARD/R0 라벨만으로 파일 수정 불가능을 보장한다고 설명해서는 안 된다.** 이는 소스 경로의 정적 확인이며 이번에 실제 mutation을 재현한 결과는 아니다.[S5][S7][S8][S9][S17]

**제안:** intent/complexity/risk와 별도로 `read-only` 또는 `edit` 실행 범위를 trusted contract로 고정한다. 읽기 전용에서는 모델 도구 미노출과 Policy 실행 거부를 함께 적용한다. 자연어 parser나 모델은 계약 초안을 제안할 뿐 권한을 부여하지 못한다. 애매한 해석은 실행 전에 보여 주고, R2/R3 최소 위험도와 승인 의무를 낮추지 않는다.

**완료 기준:** 한국어·영어·부정문·인용된 위험 단어·한글 및 공백 경로·문장부호 corpus를 통과한다. QUICK와 STANDARD 양쪽의 read-only에서 write/edit/delete를 직접 호출하는 부정 테스트도 mutation 전에 거부한다. 검증 프로그램 자체의 mutation 가능성은 별도로 다루며, Git diff 사후 확인만으로 사전 차단을 주장하지 않는다.

### FIX-05 — 요구사항을 검증 가능한 단위로 분해

**구현 상태(V0.3E, LOG-057):** Host-confirmed Acceptance Criteria(순차 AC ID·statement·scope·checkIds/reviewRequired), Kernel AC 완료 guard, Reviewer/Executor의 AC ID별 결과·evidence mapping, legacy `requirements` 읽기 전용 호환이 구현됐다. 모델 기반 자동 분해(Planner)는 도입하지 않았다.

**관찰:** workflow가 `requirements: [goal]`을 생성한다. Kernel은 정확한 requirement 목록과 evidence reference를 검사하지만, 복합 요청 전체가 한 항목이면 개별 조건 누락을 구조적으로 식별하기 어렵다.[S5][S11]

**제안:** 실행 전 AC ID, 조건, 검증 방식, 허용 범위, 제외 범위를 가진 작업 계약을 만든다. 사용자 확인 후 고정하고 Developer/Reviewer가 임의로 줄이거나 바꾸지 못하게 한다. 자동 assertion, 테스트, 코드 근거, 수동 확인을 구분한다. 모든 조건이 자동화 가능한 것은 아니므로 확인 불가는 명시적으로 남긴다.

예: 로그인 수정 요청을 `재현`, `원인 수정`, `기존 성공 경로 유지`, `메시지 변경`, `회귀 테스트`로 나눈다. 최종 표는 `AC ID → 결과 → evidence ref → 해당 revision/digest`를 연결한다.

**완료 기준:** 한 조건만 미충족인 fixture, 조건 누락·중복·변경, 모르는 evidence, 이전 attempt의 PASS 재사용을 모두 완료 거부로 처리한다. 독립 테스트 기준은 구현 agent가 수정할 수 없어야 한다. 증거의 형식적 일치는 의미적 정답의 증명과 다름을 보고서에 유지한다.

### FIX-06 — JVM 파일과 프로젝트별 위험 경로

**V0.3D 반영:** pom.xml, build/settings.gradle[.kts], gradle.properties, gradle/libs.versions.toml, gradle/wrapper/gradle-wrapper.properties, .mvn/wrapper/maven-wrapper.properties의 exact case-insensitive suffix와 module prefix를 최소 R2 mutation 대상으로 추가했다. 유사 backup/docs 파일과 .mvn 전체로 확장하지 않는다. R1 자동 승격은 없고 READ_ONLY mutation DENY 및 bound R2 independent review를 유지한다. 실제 Maven/Gradle build matrix를 실행했다는 뜻은 아니다.

**관찰(조사 기준 SHA):** `isDependencyPath()`에는 npm/Cargo/Python/Go 계열이 있으나 `pom.xml`, `build.gradle`, `build.gradle.kts` 등은 없다. allowed path 안의 해당 파일을 파일명만으로 의존성 변경으로 승격하는 규칙이 빠져 있다. 실제 요청문에 따라 더 높은 risk가 선택될 수 있으므로 모든 JVM 변경이 반드시 R1이 된다는 뜻은 아니다.[S6][S7]

**제안:** Maven/Gradle manifest, settings, version catalog, wrapper 설정 등 우선 지원할 목록을 테스트와 함께 정의한다. 프로젝트 설정은 기본 deny를 제거하지 못하고 보호·최소 위험도를 더하는 방향으로 설계한다. `config.*` 같은 기존 넓은 보호 규칙 때문에 정상 수정이 막히는 사례는 따로 수집하되, 편의를 위해 일괄 해제하지 않는다.

**완료 기준:** 다중 모듈 경로·대소문자·유사 파일명 사례를 검증한다. R1 작업이 도중에 R2 파일을 만나면 자동 승격하여 계속하지 않고 새 적절한 Run을 요구한다. wrapper/manifest 수정 허용이 설치나 임의 프로그램 실행 허가로 이어지면 안 된다.

### FIX-07 — 기존 파일 strict edit 모드

**관찰:** V0.3A는 이미 선택적 anchor + full-file digest 검증을 제공한다. legacy exact edit와 runtime_write까지 같은 precondition을 강제하지는 않는다. 최신 실제 Provider 검증은 stale 거부 후 자동 복구를 포함하지 않는다.[S8][S12]

**제안:** opt-in strict 모드를 먼저 설계한다. 기존 파일 변경은 최신 read receipt/digest를 요구하고, 새 파일 생성은 `must-not-exist` 조건을 별도로 둔다. strict 모드에서 write로 stale guard를 우회하지 못하게 한다. 새 생성·기존 교체·한정 삭제의 계약을 섞지 않는다.

**완료 기준:** 중복 문자열·외부 변경·삭제 후 재생성·CRLF/BOM·UTF-8·긴 줄·공백/한글 경로를 다룬다. stale 후 실제 모델이 제한된 예산 내 재읽고 수정하는 시나리오를 별도로 수행한다. 마지막 확인과 OS write 사이 모든 외부 경합을 해결했다고 주장하지 않는다. 기존 호환 모드와 strict 모드의 차이를 문서화한다.

> 구현 상태(2026-09-18): V0.4B에서 구현·자동 회귀 검증했다. `verification.trust.mode`(기본 compatible)·`checks[].trust.files`·registration/executable/source freeze(pre/post process + settle 재검증)·Kernel `trustRequired` guard·bounded trust evidence. sandbox는 V0.4C다. 상세는 LOG-066.
### FIX-08 — 검증 프로그램과 정답 기준의 신뢰 고정

**관찰:** 실행 파일·인자 등록과 일부 직접 참조 파일 보호는 있다. 그러나 등록된 명령은 내부에서 파일을 수정하거나 다른 프로그램·네트워크를 사용할 수 있고, 모든 전이 의존성의 무해성까지 증명하지 않는다. 현재 승인 UI도 이 비격리 경계를 명시한다.[S3][S4][S15]

**제안:** 검증 entrypoint·직접 설정·Host 소유 acceptance test의 출처/digest를 고정한다. 구현 대상 테스트와 완료 판정용 보호 테스트를 구분한다. package script·동적 import·plugin 등 간접 실행 범위를 명시하고, 일반 프로젝트에서는 검토된 check만 사용한다. OS 격리는 FEAT-07에서 별도 도입한다.

**완료 기준:** 구현 agent가 테스트 기준이나 실행 entrypoint를 수정해 거짓 PASS를 만드는 부정 fixture를 둔다. 선택된 check의 등록 변경과 코드 변경을 구분하며 오래된 검증은 무효화한다. 전이 의존성까지 완전히 보호하지 못하는 경우 그 범위를 명시한다. shell을 막았다는 이유만으로 trusted check를 sandboxed라고 표시하지 않는다.

### FIX-09 — 실제 worker 설정과 빌드 출처

**관찰:** config profile은 provider/model 중심이며 부모 UI 설정과 실제 worker 설정은 같다고 단정할 수 없다. 최신 smoke는 worker thinking이 medium이었다고 명시한다. launcher는 local build freshness를 검사하지 않는다고 README에 설명한다.[S1][S4][S10][S12]

**제안:** worker별 실제 provider/model/thinking, Runtime 소스 기준, CLI build 기준, config digest를 관측 가능하게 한다. 지원 모델에 한정한 역할별 thinking 설정을 검토하되 호환되지 않는 값은 거부한다. doctor에 build provenance/갱신 필요 경고를 추가하더라도 자동 build/update/auth refresh는 하지 않는다.

**완료 기준:** 부모 표시를 worker의 실제 값으로 복제하지 않는다. 정보가 없으면 UNKNOWN이다. 소스·CLI build 불일치가 관측되고, 설정 변경은 새 Run에서만 적용된다. 개인 credential/endpoint는 공개 보고서에서 제외한다.

### FIX-10 — 현재 지원 범위와 역사 기록의 분리

**관찰:** 설계 제안, 단계별 구현, 과거 검증, 최신 보완이 여러 문서에 분산되어 있다. 과거 문서 첫머리만 읽으면 현재 상태를 오인하기 쉽다.[S1][S16][S18][S19]

**제안:** README에는 짧은 현재 capability/제한/다음 작업 인덱스를 둔다. 역사 문서는 보존하고 현재 상태 문서로 연결한다. 검증 결과는 source SHA, build, Provider/model/thinking, OS/Node, 테스트 범위, 원시 증거 위치, 미검증 범위를 함께 기록한다. 과거 PASS를 새 HEAD의 PASS로 승계하지 않는다.

**완료 기준:** 새 사용자가 설치 경로와 지원 범위를 찾을 수 있고, 후보 기능과 구현 기능이 구분되어야 한다. 신규 상태 자료가 과거 readiness나 안정 태그를 소급 변경하지 않아야 한다.

## 4. 추가 기능 조사

### 4.1 후보 요약

아래 적합성·순서는 Weavra에 대한 설계 판단이다. 외부 프로젝트의 성능이 Weavra에서도 재현된다는 주장이 아니며, 직접 의존성 도입을 승인하는 목록도 아니다.

| ID | 후보 | 권장 위치 | 기존 계획과 관계 | 초기 구현 범위 |
|---|---|---|---|---|
| FEAT-01 | 실행 전 Plan Preview / Task Contract | P1 | FIX-04/05의 제품 UX | 목표·AC·범위·checks 확인 |
| FEAT-02 | 읽기 전용 파일 탐색 / Repo Map / LSP | P1, 단계 도입 | 기존 LSP 후보 구체화 | 파일 목록 → 심볼 → 선택적 diagnostics |
| FEAT-03 | 로컬 사용량 대시보드 / Run Budget | P1 | 기존 telemetry 재사용 | 역할별 집계와 별도 예산 통제 |
| FEAT-04 | Weavra 비교 평가 adapter | P1 | 기존 evals 재사용 | 같은 fixture의 Pi/Weavra 비교 |
| FEAT-05 | Evidence Pack / 실패 설명 / 재시작 안내 | P1~P2 | 기존 observation/export 확장 | 읽기 전용 보고·명시적 export |
| FEAT-06 | 검토된 Project Facts / Lessons | P2 | 기존 메모리 후보 축소 | 출처·유효성 있는 수동 승인 사실 |
| FEAT-07 | Verifier OS Sandbox | P2, 외부 check 확대 전 | 기존 sandbox 후보 구체화 | 검증 프로세스 경계부터 |
| FEAT-08 | Browser QA Evidence | P2, 격리 이후 | 기존 browser 후보 축소 | 로컬 fixture의 등록 Playwright test |
| FEAT-09 | Governed MCP / Capability Broker | HOLD → 별도 실험 | 기존 tool discovery 후보 | 검토한 connector 한 개부터 |

### FEAT-01 — 실행 전 계획을 보고 시작하기

**구현 상태(V0.3E, LOG-057):** `/workflow run` preflight가 Goal/Workflow/Execution Contract/Risk/AC/Allowed paths/Planned checks/Roles/instruction/LSP와 경고를 보여주고, STANDARD는 `ctx.ui.editor`로 AC를 확인·편집한다. Plan 확인은 approval token이 아니며 R3는 기존 1회 승인을 유지한다. 모델/예산 표시는 후속 범위다.

**조사 근거:** GitHub Spec Kit은 의도를 specification·plan·task 등 명시적 산출물로 이어가는 프로세스를 제공한다. 가져올 것은 전체 프레임워크나 명령 세트가 아니라, 실행 전에 작업 계약을 확인하는 패턴이다.[R1]

**Weavra 제안:** 현재 승인 창의 allowed files/checks에 작업 해석, 개별 AC, 수정 가능 범위, 제외 범위, 예정 역할, 사용 모델과 예산을 더한다. 첫 버전은 별도 Planner agent 없이 Host의 구조화 입력/확인 UI로 시작한다. 모델 기반 분해는 선택 기능이며 비용과 전달 데이터를 먼저 알린다.

`/workflow plan` 같은 명령을 만들더라도 이는 **미구현 후보**다. 순수 정적 preview는 worker/check를 실행하지 않는다. 모델을 부르는 planning은 별도 표시하고, 계획 확인을 R3 작업 승인으로 재사용하지 않는다. 적용 시점에 HEAD/config/instruction digest가 바뀌면 다시 확인한다.

**채택 조건:** 복합 요청 누락이 줄고, 작은 QUICK 작업에 불필요한 추가 모델 호출을 강제하지 않을 것. FIX-04/05와 하나의 작업 묶음으로 관리해 중복 구현하지 않는다.

### FEAT-02 — 코드 위치를 찾는 도구부터, 그다음 LSP

**V0.3D 반영 범위:** `runtime_list_files({path?,maxDepth?})`만 추가했다. 첫 호출은 `{}`로 path를 생략한다. Node fs/Policy R0/allowed+protected 필터, no symlink traversal, 500 files/64 KiB/depth 4/roots 32/entry+visit 4,096, lexical ordering과 명시적 truncation을 적용한다. node_modules 및 security protected 경로는 숨기되 explicit allowed generated dirs는 유지한다. .gitignore 전체/Repo Map/index/recursive search는 구현하지 않는다. Reviewer/READ_ONLY도 사용 가능하며 V0.3B LSP와 기존 explicit search의 책임은 유지한다. 실제 Provider는 list tool을 선택했으나 `path:"."` 때문에 거부됐고 1회 제한에 따라 재호출하지 않았다.

**수정 전 한계(조사 기준 SHA):** runtime_search는 이미 아는 파일 목록을 받아 literal text를 찾으며 재귀 탐색을 하지 않는다. 관련 파일을 모르는 작업에서는 탐색 출발점이 약하다.[S8]

**조사 근거:** Aider는 주요 심볼·서명과 관계를 요약한 repository map을 token budget 안에서 선택한다. Microsoft 문서는 LSP 기반 diagnostics와 정의 이동 등을 설명한다. 이는 서로 대체재가 아니라, 저비용 구조 요약과 언어 분석이라는 다른 계층이다.[R2][R3]

**권장 단계:**

1. 정책 허용 경로 안의 `runtime_list_files` 후보: 결과 수·깊이·bytes 제한, 외부 symlink 금지, ignore 규칙과 보호 경로 적용.
2. 읽기 전용 symbol/repo map 후보: 실제 파일 digest와 출처를 포함하고, 필요한 파일만 후속 read.
3. 선택적 LSP adapter: 우선 정의/참조/diagnostics. rename, code action apply, formatting, executeCommand는 열지 않음.

Repo map·LSP 응답은 문맥이지 완료 증거를 자동 대체하지 않는다. LSP 서버 실행·workspace plugin·프로젝트 로딩 자체의 신뢰 경계를 별도로 검토한다. 최신 파일 version과 맞지 않는 diagnostics, 서버 미설치/오류를 PASS로 기록하지 않는다. 등록 check가 아니라면 diagnostics 조회에 가짜 exit code 0을 붙이지 않는다.

**채택 조건:** 같은 과제에서 불필요한 파일 읽기와 input token을 줄이거나 정확한 파일 발견률을 높일 것. 최초에는 한 언어로 검증하고 Java/JSP 등 지원을 일반화하지 않는다. 외부 extension을 worker에 통째로 로드하지 않는다.

### FEAT-03 — 로컬 사용량과 실행 예산

**조사 근거:** OpenTelemetry는 GenAI 작업의 모델·사용량·지연을 표현하는 자료를 제공한다. agent/workflow span 규약은 별도 GenAI 저장소로 이동했고 조사 시 Development 상태다. 원문 prompt/tool 인자를 기본 수집하지 않는 관측 패턴이 적합하다.[R4][R5]

**재사용:** Pi의 TelemetryContext/NOOP/in-memory 계약을 먼저 사용한다. 현재 패키지는 exporter를 제공하지 않으므로 연결 완료로 간주하지 않는다.[S14]

**핵심 설계:** 관측과 예산 통제를 분리한다.

- 관측: Run/role/attempt별 provider-reported input/output/cache/reasoning usage, elapsed time, tool calls, revision, 결과를 기록. 원문 대화·reasoning·secret은 기본 제외.
- 통제: Kernel/실행 소유자의 별도 BudgetController가 다음 모델 호출·역할·재작업을 허용할지 판단. 선택적 telemetry 실패 때문에 예산이 무제한이 되어서는 안 됨.
- 합산: 실제 모델 호출 단위로 집계하고 부모/자식 span의 토큰을 중복 합산하지 않음. reasoning/cache가 total의 부분집합인지 Provider 계약을 확인.
- 표시: 사용량 누락은 0이 아니라 UNKNOWN. 가격표 출처·기준일이 없으면 금액은 미산정. 구독 사용량을 실제 청구액처럼 환산하지 않음.

**채택 조건:** run 전체 한도·다음 호출 전 검사·취소/cleanup·부분 변경 보고 테스트가 있어야 한다. 스트리밍 종료 전 usage가 없거나 이미 진행 중인 호출이 있어 정확한 청구액 상한을 보장할 수 없는 경우 이를 명시한다. 외부 전송은 opt-in이다.

### FEAT-04 — 기존 evals에 Weavra 비교 시나리오 연결

**조사 근거:** 저장소의 evals는 격리된 실제 AgentSession 비교와 report.json/runs.jsonl 등의 기반을 이미 갖는다. SWE-bench는 patch를 실제 저장소에 적용하고 테스트로 결과를 확인하는 평가 패턴을 제공한다.[S13][R6]

**Weavra 제안:** 새 평가 서비스 대신 StandardWorkflow를 기존 평가 형태로 연결하는 adapter와 고정 fixture를 추가한다. 일반 Pi, Weavra QUICK, Weavra STANDARD를 해당 workflow가 지원하는 과제에서만 비교한다. 과제와 지원 범위가 다른 결과를 같은 성공률로 합치지 않는다.

구현 agent가 편집할 수 없는 acceptance oracle로 최종 결과를 판단한다. 실패가 예상되는 정책 차단 과제는 정상 작업 성공률과 별도 집계한다. 실제 모델 호출은 명시적 opt-in 및 예산 제한으로 실행하고 매 push에 붙이지 않는다.

**채택 조건:** 동일 기준 commit·모델·thinking·과제·예산에서 결과와 비용 차이를 설명할 수 있을 것. mock/계약 테스트의 PASS를 실제 LLM 품질로 표시하지 않는다. 상세 설계는 6절을 따른다.

### FEAT-05 — 완료 근거와 실패 원인을 한 화면에서

**현재 기반:** 이미 상태·리뷰·검증·이력과 일부 export가 있다. 이를 새 저장 원본으로 복제하지 않고 projection으로 묶는다.[S1][S17]

**제안:** 읽기 전용 Evidence Pack에 목표/AC 결과, 변경 파일, diff digest, 검증 출처, 독립 리뷰 결과, 승인 소비 여부, 부분 변경, 사용량, 알려진 한계를 묶는다. 실패는 `분류/정책/인증/도구/검증/리뷰/저장/cleanup`으로 분류하고 근거에 따른 다음 행동을 보여 준다. 공개용 export에는 경로·로그·credential·개인 데이터 검토와 크기 제한을 둔다.

복구 기능은 자동 resume가 아니라 **이전 Run을 읽고 새 Run 준비를 돕는 것**으로 제한한다. 이전 승인/PASS를 새 Run에 복사하지 않는다. 새 실행은 사용자가 명시적으로 시작하고 fresh preflight를 거친다. dirty workspace를 임의 stash/reset하지 않으며, 현재 preflight를 만족하지 못하면 변경 검토 방법만 안내한다.

**채택 조건:** 조회는 원본 state, lock, 파일, 승인 상태를 수정하지 않는다. exporter 실패가 성공 여부를 바꾸지 않고, generated 보고서를 다시 권한의 원본으로 읽지 않는다.

### FEAT-06 — 검토된 프로젝트 사실과 교훈

**기존 후보:** OMP/OMO 도입 문서에 프로젝트 메모리가 이미 있다. 처음부터 외부 memory 서버·벡터 DB·자동 학습을 붙이지 않는다.[S18]

**제안:** 사용자가 확인한 사실만 저장하는 작은 Facts Pack부터 시작한다. 항목은 statement, source ref, 관련 파일/digest, 검토일, 유효 상태를 가진다. 예를 들어 현재 검증 명령, 생성 파일 위치, 실제로 확인한 모듈 의존 관계를 담는다. '다음부터 테스트 생략' 같은 정책 변경은 사실 메모로 허용하지 않는다.

**경계:** factual context와 규칙/권한을 분리한다. 사용자 선택 없이 전체 세션을 장기 기억으로 넣지 않는다. 코드 변경으로 근거가 stale이면 새 Run에서 제외하거나 재확인한다. facts는 이전 PASS의 대체 증거가 아니다.

**채택 조건:** 동일 프로젝트 반복 작업에서 재탐색을 줄이는지 FEAT-04로 확인한다. 관련 없는 정보, 비밀값, 오래된 교훈의 주입을 검사한다. 외부 메모리 제품 도입은 필요성이 확인된 뒤 별도로 조사한다.

### FEAT-07 — Verifier부터 OS 격리

**조사 근거:** Anthropic sandbox-runtime은 프로세스의 파일·네트워크 접근을 OS 수준에서 제한하는 도구로 설명된다. 기존 Pi Extension 도입 문서도 sandbox/Gondolin을 후보로 둔다. 이 조사는 Weavra와의 호환성 검증이 아니다.[R7][S19]

**제안:** 첫 범위는 등록된 검증 프로그램이다. disposable fixture/worktree 안의 허용 write, 별도 임시 home, host auth 비노출, 네트워크 기본 차단, process 종료 확인을 설계한다. Host의 Provider 인증과 검증 프로그램 권한을 분리한다. 자체 sandbox를 새로 쓰지 말고 adapter로 평가한다.

**채택 조건:** 파일/네트워크 탈출 부정 테스트, child process·취소·cleanup, readonly oracle 보존, sandbox 불가 시 명시적 차단을 검증한다. 무조건 host 실행으로 fallback하지 않는다. 도구별 지원 OS와 사용 버전은 선택 시점에 다시 확인한다. sandbox 추가를 Policy/Approval 제거의 근거로 사용하지 않는다.

### FEAT-08 — Browser QA를 증거 생성기로 제한

**조사 근거:** Playwright Trace Viewer는 실행 후 action, DOM snapshot, screenshot, console/network 기록을 확인할 수 있다. auth state에는 계정 접근에 사용될 수 있는 값이 포함될 수 있다는 공식 경고가 있다.[R8][R9]

**제안:** 자유로운 브라우저 agent보다, 사용자가 검토한 Playwright test를 로컬 테스트 앱에 실행하고 결과 artifact를 Verifier에 연결한다. 빌드·테스트 결과와 trace·screenshot을 같은 run/revision/digest로 묶는다. trace는 원시 증거이고 테스트 PASS를 대신하지 않는다.

**선행 조건:** FIX-08 및 FEAT-07. 테스트 계정·로컬 fixture·명시적 origin/egress 제한, artifact redaction 및 보존 규칙이 필요하다. 초기 URL이 localhost라는 이유만으로 외부 subresource/redirect/프로세스 접근까지 안전하다고 보지 않는다. 운영 LMS·실사용 계정에 자동 연결하지 않는다.

**채택 조건:** UI 회귀 한 종류를 독립 테스트로 재현하고, artifact에 민감값이 없는지 확인한다. 테스트 환경 설치·서버 실행 역시 승인된 실행 범위로 제한한다.

### FEAT-09 — 통제된 MCP와 Capability Broker

**조사 근거:** MCP는 도구 발견·호출·schema를 제공하지만 tool annotation을 권한 보증으로 취급하지 않는다. 공식 규격도 신뢰하지 않는 서버의 annotation을 불신하도록 규정한다.[R10][R11]

**제안:** 필요한 도구만 단계적으로 노출하는 Host broker를 두되 기본 비활성화한다. 첫 실험은 서버 하나와 검토된 도구 소수로 제한한다. 서버 신원/버전, schema fingerprint, 출력 제한, timeout, 데이터 전달 범위, credential scope를 고정한다. `readOnlyHint`만 보고 승인하지 않으며 조회 도구도 데이터 유출 가능성을 검토한다.

**채택 조건:** 도구 정의 변경·미등록 호출·prompt injection·자격증명 오용·출력의 허위 승인 지시를 검사한다. 외부 도구 결과는 evidence/data일 뿐 Kernel/Policy 명령이 아니다. 현재 파일 작업용 Policy에 억지로 넣지 말고 새 action contract를 별도 설계한다. 필요 도구가 파일 탐색/LSP만이라면 MCP보다 좁은 로컬 adapter를 먼저 사용한다.

### 4.2 지금 보류할 것

| 후보 | 보류 이유 | 다시 검토할 조건 |
|---|---|---|
| COMPLEX·대규모 병렬 팀 | 작업 계약·예산·파일 소유권·통합 검증이 선행되어야 함 | 순차 평가로 병목이 확인되고 실행 DAG와 충돌 규칙을 별도 설계 |
| 자동 계속 실행·무제한 self-improvement | 현재 bounded 실행과 종료 책임을 흐릴 수 있음 | 명시적 사용자 승인, 평가 데이터, 종료/예산 계약이 먼저 존재 |
| 자동 merge/commit/reset/rollback/cleanup | 기존 운영 방향과 충돌 | 이 문서에서는 추가하지 않음 |
| worker의 임의 Extension/Skill 로딩 | 고정된 도구·문맥·권한 경계가 약해짐 | 좁은 reviewed adapter로 대체할 수 없는 필요가 확인될 때 |
| 외부 memory SaaS·벡터 DB 선도입 | 사실 저장·유효성 문제보다 인프라가 먼저 커짐 | 작은 Facts Pack의 효과와 검색 병목이 측정될 때 |
| Windows 지원 확대 | 현재 POSIX process/lifecycle 설계와 별도 문제 | 플랫폼별 설계 및 독립 검증 계획이 생길 때 |

## 5. 권장 실행 순서

아래 묶음은 새 버전 번호나 기존 로드맵 변경 선언이 아니다. 동시에 진행하지 않고 한 묶음의 증거를 확인한 뒤 다음을 선택한다.

| 묶음 | 범위 | 종료 조건 |
|---|---|---|
| M1 — 기본 신뢰 | FIX-01/02/04 | V0.3C 구현·로컬 회귀 완료; Actions/Linux/fresh-install 전체 검증은 별도 |
| M2 — 작업 이해 | FIX-03/05/06 + FEAT-01 + FEAT-02의 파일 목록 | V0.3C/D 반영에 이어 V0.3E에서 FIX-05 AC와 FEAT-01 Plan Preview 구현(LOG-057); 모델 기반 분해/Planner는 미구현 |
| M3 — 효과 측정 | FEAT-03/04/05 + FIX-09 | V0.3F에서 측정·budget·Evidence Pack·provenance·eval adapter/fixture 6개 반영(LOG-059); 실제 비교 실행·20 corpus는 후속 |
| M4 — 선택 강화 | FIX-07/08 + 필요한 LSP / FEAT-07 | 실제 실패 사례를 줄이는 검증 결과와 새 권한 경계 테스트 |
| 이후 선택 | FEAT-06/08/09 | 반복 작업·UI·외부 도구에 실제 수요가 있고 선행 조건 충족 |

**설치·CI·read-only 계약**은 V0.3C에서 구현·로컬 검증했다. V0.3D의 지침 전달·파일 탐색·JVM risk는 구현/자동 검증했으며 AC/Planner는 V0.3E 및 별도 사용자 승인 범위로 유지한다. UI 장식이나 agent 수 확대를 위해 이 순서를 미루지 않는다.

## 6. 실사용 평가 설계

### 6.1 처음에는 작은 내부 평가셋

20개 fixture를 시작점으로 제안한다. 이는 현재 측정 수가 아니라 평가 설계 예시다.

| 종류 | 예시 | 기본 판정 |
|---|---|---|
| 읽기 전용 5개 | 설명, 원인 분석, 위험 단어 인용, 부정문, 파일 탐색 | 필요한 답 + 금지 mutation 없음 |
| 제한적 수정 5개 | 한 파일 버그·오타·중복 문자열·경계값·규칙 준수 | 고정 postcondition과 기존 회귀 통과 |
| STANDARD 5개 | 두 파일 수정, 복합 AC, review REVISE, 지침 준수, 의존성 분류 | 개별 AC + 독립 리뷰 + fresh check |
| 실패 경계 5개 | stale edit, 승인 거부, timeout, 중단, 검증 기준 변경 시도 | 기대 차단/종료 + 부분 변경·cleanup의 정확한 보고 |

### 6.2 비교 조건

동일한 fixture baseline, check 등록, model/provider/thinking, 기능 옵션과 예산을 기록한다. 한 번의 비교에서 모델과 harness를 동시에 바꾸지 않는다. 사전 설치된 환경을 고정하고 각 실행은 격리한다. 지원되지 않는 과제는 성능 실패와 분리하여 표시한다.

개발 중에는 적은 반복으로 확인하고, 효과를 보고할 때는 비용에 맞는 반복 수를 정해 함께 공개한다. 20개 과제 한 번의 성공률을 일반 품질로 확대하지 않는다. 안전 회귀는 결정적 테스트로 매 변경 확인하고 실제 모델 평가는 명시적으로 수행한다.

### 6.3 지표

| 지표 | 의미 |
|---|---|
| 지원 과제 성공률 | 독립 oracle로 충족된 과제 / 지원 과제 실행 수 |
| false completion | Runtime이 COMPLETED인데 독립 기준을 충족하지 못한 관측 건수 |
| 기대 차단 정확성 | 실패 경계 과제가 의도한 이유로 차단되었는지 |
| 재작업 | revision 수와 사용자의 후속 수정량/수정 시간 |
| 사용량 | 역할 및 모델 호출별 input/output/cache/reasoning. 누락은 UNKNOWN |
| 지연 | Run 전체와 단계별 시간. 성공·실패를 분리한 중앙값 등 |
| 부분 변경·cleanup | 취소 후 변경 보고, 남은 프로세스, lock 상태의 정확성 |
| 문맥 효율 | 중복 read, 관련 파일 발견, context 크기 |

테스트 통과율만 높고 false completion이 생기면 출시 근거로 삼지 않는다. 관측된 false completion 0은 전 입력에서의 무오류 보장이 아니다. 비용은 Provider usage, 가격표 기반 추정, 실제 청구를 구분한다.

### 6.4 검증 무결성

평가용 정답·보호 테스트는 구현 agent의 allowed paths 밖에 둔다. 새 회귀 테스트를 작성하는 과제에서도 평가자가 가진 oracle은 따로 유지한다. 코드·모델·도구·prompt·config가 바뀌면 새 평가 ID를 사용한다. 저장된 trace를 읽는 것은 진단이지 실행 성공의 재검증이 아니다.[R6]

## 7. 공통 완료 기준과 작업 분할

### 7.1 구현 작업마다 필요한 기록

- [ ] 변경 목적, 관련 FIX/FEAT ID, 수정 파일과 지원 범위를 기록했다.
- [ ] 기존 지원 동작과 새 후보 기능을 구분하고 설정 기본값을 명시했다.
- [ ] 정상·오류·취소·stale·권한 거부 테스트를 해당 범위에서 수행했다.
- [ ] 과거 state를 읽을 때 새 필드 부재를 성공/승인으로 해석하지 않는다.
- [ ] schema 변경은 호환성 또는 명시적 migration을 설계하며 자동 덮어쓰지 않는다.
- [ ] 실패한 worker/process의 정리가 확인되기 전에 lock을 풀지 않는다.
- [ ] 새 evidence는 run/revision/attempt/digest에 연결한다.
- [ ] 등록되지 않은 외부 실행·network·자동 설치·Provider 호출이 없다.
- [ ] credential·사용자 세션·원문 reasoning을 공개 문서나 artifact에 넣지 않는다.
- [ ] 현재 코드 기준의 검증 명령·환경·결과·NOT VERIFIED 항목을 남긴다.
- [ ] 기존 안정 태그와 Pi 사용자 저장 영역을 변경하지 않는다.

### 7.2 작업 요청 템플릿

```text
대상: Weavra devlop / 착수 시 실제 HEAD 확인
작업: FIX-XX 또는 FEAT-XX 한 항목만 구현
기준: 이 문서는 설계 제안이며 기존 MASTER_SPEC/DECISIONS와 충돌 시 변경점을 먼저 명시

1. 관련 구현·계약·기존 테스트를 읽고 지원 범위를 확정한다.
2. 확인된 문제의 최소 재현/회귀 테스트를 먼저 만든다.
3. Kernel/Policy/Approval/freshness/cleanup 경계를 유지하는 최소 변경을 한다.
4. 관련 회귀와 실제 수행 가능한 검증을 실행한다.
5. 수행하지 않은 build/Provider/플랫폼 검증을 PASS라고 쓰지 않는다.
6. 문서와 검증 로그에 실제 SHA·환경·결과를 남긴다.

제외: 다른 FEAT 동시 구현, 임의 의존성 추가, 자동 commit/push/merge,
      안정 태그 변경, 권한 우회, 무제한 재시도, 자동 resume/rollback.
```

구현 승인은 별도 작업 요청으로 한다. 문서의 체크리스트 자체가 코드 변경·유료 실행·배포의 사전 승인은 아니다.

## 8. 근거 자료

### 8.1 저장소 기준 자료

소스 링크는 특별히 표시한 metadata/main 조회를 제외하고 모두 검토 SHA에 고정했다. 함수 이름을 함께 사용해 후속 변경에서 위치를 찾을 수 있게 한다.

| ID | 자료 | 사용한 근거 |
|---|---|---|
| S0 | [저장소 metadata][S0] | 2026-09-17 조회 시 default_branch=main. URL은 실시간 자료 |
| S1 | [Weavra README][S1] | 설치·현재 capability·비지원 범위·build 경계 |
| S2 | [CI workflow][S2] | main push/PR trigger |
| S3 | [extension.ts][S3] | 기본 createAgents 연결과 preflight 승인 UI |
| S4 | [agent-runner.ts][S4] | projectInstructions, worker resource/tool/model 구성 |
| S5 | [workflow.ts][S5] | classify, QUICK scope, requirements 생성 |
| S6 | [classification.ts][S6] | classifyRequest / selectWorkflow |
| S7 | [policy.ts][S7] | isDependencyPath / evaluatePolicy |
| S8 | [agent-tools.ts][S8] | runtime_search, write/edit 도구 구성 |
| S9 | [quick.ts][S9] | selectQuickScope / assertQuickWorkspace |
| S10 | [config.ts][S10] | strict schema와 profile/limit 구성 |
| S11 | [kernel.ts][S11] | assertCanComplete 및 evidence 검증 |
| S12 | [V0.3A Provider smoke][S12] | 제한된 실제 모델 사례와 그 한계 |
| S13 | [Pi evals README][S13] | 기존 평가·비교·artifact 기반 |
| S14 | [Pi telemetry README][S14] | 기존 관측 계약과 exporter 부재 |
| S15 | [Architecture][S15] | 실행 adapter 및 신뢰 경계 설명 |
| S16 | [V0.1 readiness][S16] | 과거 검증 범위 및 NOT VERIFIED |
| S17 | [state-store.ts][S17] | prepare의 risk binding, 상태·승인·중단 처리 |
| S18 | [OMP/OMO 도입 계획][S18] | 기존 LSP·메모리·병렬화 후보와 V0.3A 현황 |
| S19 | [Pi Extension 도입 계획][S19] | 기존 sandbox 및 verification adapter 후보 |
| S20 | [root package.json][S20] | check의 --write와 workspace scripts |
| S21 | [main README][S21] | 조사 당시 main은 Pi 안내. URL은 브랜치를 따라 변경됨 |

### 8.2 외부 공식·1차 자료

모두 2026-09-17에 확인했다. 기능 개념의 조사이며 특정 패키지 버전의 설치·성능·Weavra 호환성을 검증한 결과는 아니다. 코드 이식이나 직접 의존성 추가 전에는 채택할 revision, license, transitive dependency, 지원 플랫폼을 별도 확인한다.

| ID | 출처 | 이번에 참고한 범위 |
|---|---|---|
| R1 | [GitHub Spec Kit 공식 문서][R1] | 의도→명세→계획→작업 산출물 연결 |
| R2 | [Aider Repository Map][R2] | 주요 심볼과 token budget 기반 문맥 선택 |
| R3 | [Microsoft Language Server 가이드][R3] | diagnostics·정의 이동·언어 서버 경계 |
| R4 | [OpenTelemetry GenAI 관측 안내][R4] | 모델 호출 사용량·시간과 민감 원문 opt-in |
| R5 | [OpenTelemetry GenAI agent/workflow spans][R5] | 이동된 규약 저장소, Development 상태, span 계층 |
| R6 | [SWE-bench Evaluation Guide][R6] | 격리 평가·patch/test·실행과 해결 여부 구분 |
| R7 | [Anthropic sandbox-runtime][R7] | OS 수준 프로세스 파일·네트워크 제한 후보 |
| R8 | [Playwright Trace Viewer][R8] | UI 동작·DOM·console/network artifact |
| R9 | [Playwright Authentication][R9] | auth state 민감정보와 저장 경계 |
| R10 | [MCP Tools 규격][R10] | 도구 schema·발견·annotation의 신뢰 한계 |
| R11 | [MCP Security Best Practices][R11] | 외부 도구/인증 경계 검토 |

[S0]: https://api.github.com/repos/kjg8619/pi
[S1]: https://github.com/kjg8619/pi/blob/e09100fe3e0ce08610b48a056ed6cd03714e0f97/README.md
[S2]: https://github.com/kjg8619/pi/blob/e09100fe3e0ce08610b48a056ed6cd03714e0f97/.github/workflows/ci.yml
[S3]: https://github.com/kjg8619/pi/blob/e09100fe3e0ce08610b48a056ed6cd03714e0f97/packages/company-runtime/src/extension.ts
[S4]: https://github.com/kjg8619/pi/blob/e09100fe3e0ce08610b48a056ed6cd03714e0f97/packages/company-runtime/src/agent-runner.ts
[S5]: https://github.com/kjg8619/pi/blob/e09100fe3e0ce08610b48a056ed6cd03714e0f97/packages/company-runtime/src/workflow.ts
[S6]: https://github.com/kjg8619/pi/blob/e09100fe3e0ce08610b48a056ed6cd03714e0f97/packages/company-runtime/src/classification.ts
[S7]: https://github.com/kjg8619/pi/blob/e09100fe3e0ce08610b48a056ed6cd03714e0f97/packages/company-runtime/src/policy.ts
[S8]: https://github.com/kjg8619/pi/blob/e09100fe3e0ce08610b48a056ed6cd03714e0f97/packages/company-runtime/src/agent-tools.ts
[S9]: https://github.com/kjg8619/pi/blob/e09100fe3e0ce08610b48a056ed6cd03714e0f97/packages/company-runtime/src/quick.ts
[S10]: https://github.com/kjg8619/pi/blob/e09100fe3e0ce08610b48a056ed6cd03714e0f97/packages/company-runtime/src/config.ts
[S11]: https://github.com/kjg8619/pi/blob/e09100fe3e0ce08610b48a056ed6cd03714e0f97/packages/company-runtime/src/kernel.ts
[S12]: https://github.com/kjg8619/pi/blob/e09100fe3e0ce08610b48a056ed6cd03714e0f97/docs/WEAVRA_V03A_PROVIDER_SMOKE_2026-09-17.md
[S13]: https://github.com/kjg8619/pi/blob/e09100fe3e0ce08610b48a056ed6cd03714e0f97/packages/evals/README.md
[S14]: https://github.com/kjg8619/pi/blob/e09100fe3e0ce08610b48a056ed6cd03714e0f97/packages/telemetry/README.md
[S15]: https://github.com/kjg8619/pi/blob/e09100fe3e0ce08610b48a056ed6cd03714e0f97/docs/ARCHITECTURE.md
[S16]: https://github.com/kjg8619/pi/blob/e09100fe3e0ce08610b48a056ed6cd03714e0f97/docs/V0.1_READINESS.md
[S17]: https://github.com/kjg8619/pi/blob/e09100fe3e0ce08610b48a056ed6cd03714e0f97/packages/company-runtime/src/state-store.ts
[S18]: https://github.com/kjg8619/pi/blob/e09100fe3e0ce08610b48a056ed6cd03714e0f97/docs/WEAVRA_OMP_OMO_ADOPTION_PLAN.md
[S19]: https://github.com/kjg8619/pi/blob/e09100fe3e0ce08610b48a056ed6cd03714e0f97/docs/WEAVRA_EXTENSION_ADOPTION_PLAN.md
[S20]: https://github.com/kjg8619/pi/blob/e09100fe3e0ce08610b48a056ed6cd03714e0f97/package.json
[S21]: https://github.com/kjg8619/pi/blob/main/README.md
[R1]: https://github.github.io/spec-kit/
[R2]: https://aider.chat/docs/repomap.html
[R3]: https://code.visualstudio.com/api/language-extensions/language-server-extension-guide
[R4]: https://opentelemetry.io/blog/2026/genai-observability/
[R5]: https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md
[R6]: https://www.swebench.com/SWE-bench/guides/evaluation/
[R7]: https://github.com/anthropics/sandbox-runtime
[R8]: https://playwright.dev/docs/trace-viewer
[R9]: https://playwright.dev/docs/auth
[R10]: https://modelcontextprotocol.io/specification/2025-11-25/server/tools
[R11]: https://modelcontextprotocol.io/docs/2025-11-25/tutorials/security/security_best_practices
