# 로컬 팀 파일럿

이 문서는 소스 체크아웃에서 Weavra Runtime과 web App을 함께 점검하는 **개발자용 로컬 파일럿** 절차다. 호스팅/관리형 배포, 회사 저장소에 대한 실제 검증, 공급자 인증 성공 또는 프로덕션 준비 완료를 뜻하지 않는다. Runtime과 App은 별도 빌드 루트이며 stdio 프로토콜로만 연결된다. Node `24.19.0`을 사용한다.

아래 명령은 POSIX 셸 기준이며 이번 확인 환경은 macOS arm64다. 다른 운영체제와 네이티브 설치 패키지의 배포 검증은 별도로 필요하다.

## 1. 체크아웃 설치와 Runtime 빌드

사용 중인 버전 관리 도구로 Node `24.19.0`을 선택하고 저장소 루트에서 버전을 확인한다. 두 하위 저장소에는 각각 잠금 파일이 있으므로 설치 명령과 의존성 트리를 합치지 않는다.

```sh
node --version # v24.19.0

cd runtime/pi
npm ci --ignore-scripts
npm run hydrate:model-data
npm run build
npm link --workspace packages/company-runtime --ignore-scripts

cd ../../app/t3code
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm exec effect-tsgo patch
```

`hydrate:model-data`는 SDK 모델 카탈로그를 준비하는 단계이지 추론 요청이나 인증 검증이 아니다. 설치는 생명주기 스크립트를 실행하지 않으며, 이어지는 `effect-tsgo patch`는 저장소가 요구하는 타입 검사 도구 초기화를 명시적으로 수행한다. `weavra`를 PATH에서 찾을 수 없는 셸에서는 링크 대신 아래 절대 경로를 사용한다.

```sh
/절대/체크아웃/경로/runtime/pi/packages/company-runtime/bin/weavra --help
```

## 2. Runtime 홈과 대상 프로젝트 준비

Runtime을 사용할 OS 사용자 계정으로 파일럿 전용 제품 홈을 준비하고 검사한다. 아래 경로는 실제 사용할 별도 디렉터리로 바꾼다. `setup`과 `doctor`는 제품 홈 전용이며, 프로젝트를 초기화하지 않는다.

```sh
export WEAVRA_HOME="/절대/경로/파일럿-runtime-home"
weavra setup
weavra doctor
```

실제 대상 Git 프로젝트의 루트에서 팀이 검토한 YAML을 입력해 `.ai/config.yaml`을 초기화한다. 저장소의 `runtime/pi/packages/company-runtime/examples/config.yaml`은 **편집용 예시**일 뿐이다. `your-provider`, `your-coding-model`, `scripts/check.mjs` 같은 값을 그대로 실행 가능한 설정으로 복사하지 말고, 승인된 SDK provider/model ID, 프로젝트의 실제 필수 검사와 실행 경로, sandbox 및 예산 정책으로 바꾼 뒤 검토한다.

```sh
cd /절대/대상/Git-프로젝트
weavra project init --config /절대/경로/검토된-config.yaml
git status --short
# 편집기로 새 .ai/config.yaml을 열어 내용과 비밀값 포함 여부를 직접 검토한다.
# 팀의 정상 변경 검토/승인 절차로 설정을 반영한 뒤:
weavra project doctor
weavra project doctor --json
```

초기화는 기존 설정을 덮어쓰지 않으며 검사 명령을 실행하거나 인증/상태를 수리하지 않는다. doctor도 읽기 전용이다. Git 루트, 초기 HEAD, 깨끗한 작업 트리, 필수 check 등록과 실행 파일, `.ai` 상태 및 sandbox 사전조건을 진단한다. 초기화 자체가 작업 트리를 변경하므로 정책상 별도 승인·커밋이 필요하면 먼저 그 절차를 끝낸 뒤 doctor를 다시 실행한다. `READY`는 로컬 사전조건일 뿐 모델 인증, provider 연결, sandbox 실행, check 통과 또는 검증 증거가 아니다. 실패 시 출력된 진단 코드와 다음 조치를 확인하고, 어떤 자동 복구도 기대하지 않는다.

Runtime이 쓰는 `.ai/state.json`, `tasks.json`, writer lock, `runs/` 등의 상태는 Git에 추적하지 않는다. 팀 정책에 따라 `.ai/` 전체를 무시하거나, `.ai/*`를 무시하고 `!.ai/config.yaml`로 검토된 설정만 예외 처리한다. 초기화 명령은 `.gitignore`를 대신 수정하지 않는다. `ACTIVE_RUN_PRESENT`나 `WRITER_LOCK_PRESENT`는 상태를 검토하라는 뜻이며, 진단 명령이 중단된 실행을 복구하거나 재개하지 않는다.

Runtime workflow workers는 App의 일반 provider CLI가 아니라 Pi SDK 모델 프로필을 사용한다. 프로필 인증은 팀이 승인한 사용자 환경에서 별도로 준비하되, 유효성 확인 전까지 **인증 상태는 UNKNOWN**으로 취급한다. 비밀값, 설정 전문, 개인 홈 경로가 들어간 산출물을 저장소나 증거 자료에 올리지 않는다.

### 대형 저장소의 증거 수집

`project doctor`는 실행과 같은 읽기 전용 증거 수집기로 저장소의 용량·경로·파일 형식도 확인한다.
`WORKSPACE_EVIDENCE_CAPACITY`, `WORKSPACE_EVIDENCE_UNSUPPORTED`, `WORKSPACE_EVIDENCE_UNAVAILABLE`은
각각 한도 초과, 지원하지 않는 항목, 읽기/Git 실패를 뜻한다. 일부 증거만으로 READY를 반환하지 않는다.

기본 한도는 Git 출력 2 MiB, 증거 항목 5,000개, 파일당 2 MiB, 합계 32 MiB다.
더 큰 저장소에는 검토한 설정에 다음 프로필을 명시적으로 추가할 수 있다. 실패 후 자동 전환하지 않는다.

```yaml
workspace:
  evidence:
    mode: bounded-monorepo
```

이 프로필은 Git 출력 8 MiB, 증거 항목 50,000개, 캡처당 일반 파일 512 MiB,
편집 범위 밖의 일반 파일당 64 MiB, 링크 대상 문자열 4 KiB, 캡처당 60초로 제한한다.
편집할 텍스트는 여전히 파일당 2 MiB·합계 32 MiB이며 검토 diff 한도도 유지된다.
기존 증거 범위의 바이트를 매번 해시하지만 편집 범위 밖의 내용은 검토 텍스트로 보관하지 않는다.
해당 파일이 바뀌면 안전한 변경으로 인정하지 않는다.

시작 시 추적된 편집 범위 밖 심볼릭 링크는 대상 문자열만 확인하며 대상을 따라가지 않는다.
링크 변경·삭제·종류 변경은 안전하지 않은 증거다. 새로운 링크, 편집 범위 안 링크,
링크인 상위 디렉터리, hardlink 및 특수 파일은 계속 거부한다.
이 프로필은 worker 권한, 보호 파일, 등록 검사 또는 Kernel 완료 조건을 완화하지 않는다.
설정을 바꾼 뒤에는 doctor를 다시 실행하고 새 계획을 준비·확인한다.

## 3. 격리된 App 실행과 검토된 시작

저장소 루트에서 이 체크아웃의 Runtime launcher를 절대 경로로 지정하고 control 기능을 명시적으로 켠 뒤 App 개발 서버를 실행한다.

```sh
cd /절대/체크아웃/경로
export T3_WEAVRA_EXECUTABLE="/절대/체크아웃/경로/runtime/pi/packages/company-runtime/bin/weavra"
export T3_WEAVRA_CONTROL=1
export WEAVRA_APP_HOME="/절대/경로/파일럿-app-home"
cd app/t3code
corepack pnpm exec vp run dev --home-dir "$WEAVRA_APP_HOME"
```

경로는 실제 체크아웃과 별도 파일럿 홈으로 바꾸고 앞 단계의 `WEAVRA_HOME`을 같은 셸에 유지한다. 다른 전역 `weavra` 바이너리로 대체하지 않는다. 위 `--home-dir`는 기존 개인 App 데이터 대신 지정한 파일럿 디렉터리를 사용한다. 출력된 로컬 주소/포트를 확인하고 App에서 승인된 대상 프로젝트를 추가하거나 선택한다. 해당 프로젝트의 Project Settings에서 Weavra 상태·설정 진단을 살펴본다. UI 제어는 별도 opt-in인 `T3_WEAVRA_CONTROL=1`이 없으면 활성화되지 않는다. 기본 dev 서버는 로컬 개발용이며 `--share`를 사용하지 않는다.

실제 작업 전 사람은 목표와 acceptance criteria를 담은 계획을 검토·수정하고 직접 확인한다. 실행 뒤에는 Runtime이 fresh하게 수행한 등록 check 결과와 각 기준을 다루는 **독립 Reviewer** 결과를 함께 확인한다. Developer의 자체 보고, doctor 결과, 과거/캐시된 evidence만으로 완료를 판단하지 않는다. App의 Workflow control에서 실패한 Run의 진단을 확인하고 실행 카드의 증거 링크로 acceptance criteria, 현재 revision의 check, review 독립성, failure category를 검토한다. 프로젝트 진단이 READY인데 시작에 실패하면 승인된 모델 프로필의 등록·가용성과 인증을 별도로 확인한 뒤 새 계획을 준비한다.

## 4. 중단, 변경사항과 비공개 상태

취소·프로세스 종료·비정상 종료는 자동 rollback이나 재개를 보장하지 않는다. `INTERRUPTED` 상태와 작업 트리의 일부 변경이 남을 수 있다. 새 실행 전 Git diff/status를 직접 검토하고 변경을 보존할지, 별도 검토를 거쳐 정리할지 결정한다. Runtime은 완료되지 않은 작업을 자동 재개하지 않는다.

백업은 App과 Runtime을 모두 완전히 멈춘 뒤 수행한다. 이 절차에서 지정한 `$WEAVRA_HOME/agent`, `$WEAVRA_APP_HOME/userdata`, 대상 프로젝트의 필요한 `.ai` 상태는 서로 구분해 암호화된 접근 제한 위치에 보관한다. 실행 중 SQLite 파일을 단순 복사하지 않는다. `.ai/config.yaml`이 팀 저장소에 들어가는 경우에는 비밀값을 넣지 않고 프로젝트 변경 검토 절차를 따른다. 백업에는 인증 토큰·provider 자격증명·개인 세션 기록을 포함하지 않도록 최소화하고, 보관 위치와 접근 권한을 팀 정책으로 정한다.

## 5. 초기 실제 작업의 수용 기록

첫 실제 파일럿 작업은 회사가 승인한 저장소·SDK profile·필수 check를 사용하고 담당자가 입회한다. 미리 성공률이나 시간 목표를 꾸며내지 말고 작업별로 다음 수치를 기록해 팀이 수용 기준을 정할 근거를 만든다.

- 설정/doctor에서 첫 계획 확인까지 걸린 시간과 막힌 사전조건
- 계획 수정 횟수, 사람의 확인 여부, 실행 모드 및 위험 등급
- 최초/최종 fresh check 통과 수와 실패·재검사 횟수
- 독립 review 결과와 acceptance criteria 충족/미확인 수
- 완료/실패/취소/중단 결과, 남은 diff와 수동 복구 시간
- 보고된 사용량(미제공이면 UNKNOWN), 반복 사용 의향과 관찰된 운영 이슈

각 작업은 비밀값을 제외한 Run ID, 설정 revision, check/review 결과와 함께 검토 기록에 연결한다. 여러 초기 작업을 본 뒤 팀은 계속/수정/중단 결정, 최소 합격 표본과 허용 가능한 실패·복구 기준을 정한다. 이 파일럿 기록은 호스팅 배포나 유료 실행을 증명하지 않는다.
