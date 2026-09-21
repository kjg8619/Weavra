# Runtime Product Independence

## 범위와 기준선

- 제품 저장소: `kjg8619/Weavra`. source-only development 제품이며 Pi 공식 배포판이나 upstream 자동 동기화 fork가 아니다.
- 기준: fetch로 확인한 `origin/devlop`의 `8447f9843e0b2d468554e0062abbe6b98a81ba13`.
- 작업 브랜치: `feat/runtime-product-independence`.
- 구현 범위: `runtime/pi/**`. 이 문서는 해당 lane의 독립 문서다. root 공통 문서·workflow·app 코드는 변경하지 않는다.
- 내부 패키지 버전 `0.85.1`, root workspace 버전 `0.0.3`, Weavra의 기존 개발 milestone은 제품 release 번호가 아니다.
- canonical 명령은 company-runtime의 `weavra` launcher다. local checkout의 bundled CLI만 실행한다. global Pi 실행 파일로 fallback하지 않는다.

## Audit: 일괄 치환 대신 소유권 분류

Git 추적 파일을 대상으로 `Pi`, `π`, `pi.dev`, `earendil-works`, `PI_*`, `.pi`, `pi-coding-agent`를 조사했다. 최초 broad scan은 982개 파일의 5,736개 일치 행이었다. 이는 `API_*` 내부 부분 일치, 같은 행의 여러 표기, 과거 문서·fixture·lockfile을 포함하는 후보 수이지 현재 제품 의존성 수가 아니다. dist/node_modules 및 개인 home은 audit 원본에 포함하지 않았다.

| 분류 | 대상 / 대표 위치 | 판단과 처리 |
| --- | --- | --- |
| A — 현재 사용자 제품 표면 | coding-agent `config.ts`, `cli/args.ts`, `main.ts`, interactive header/title/onboarding, company launcher/doctor, package-command help | 현재 identity를 Weavra로 전환. `APP_NAME=weavra`, `APP_TITLE=Weavra`. 버전은 `Weavra development (runtime 0.85.1)`. Pi 배포판 판별에 묶인 자동 onboarding과 Pi 광고/자동 changelog 출력을 제거. |
| B — 제품 update/release 권한 | `package-manager-cli.ts`, 옛 `utils/version-check.ts`, `utils/windows-self-update.ts`, `scripts/release.mjs`, `publish.mjs`, `publish-release-announcement.mjs`, `release-notes.mjs` | Pi latest-version·installer·npm self-install·managed directory 전환·Windows quarantine 경로 제거. 제품 self-update와 publication은 미설정 정책만 반환. source 저장소 release rewrite 기능 제거. extension update와 local archive/pack/install-lock tooling은 별개로 유지. |
| C — 상태·환경 소유권 | `getAgentDir`, `getSessionsDir`, company launcher/home, experimental server roots, tests/eval harness | canonical `WEAVRA_*`와 `~/.weavra/agent` 사용. inherited user-level `.pi` 및 Pi agent/session env로 자동 fallback하지 않는다. `.pi` project resource format과 내부 저수준 env는 호환성 범위에서 유지. |
| D — 외부 제품 서비스 | interactive startup, `session-share.ts`, `remote-catalog-provider.ts`, product telemetry, provider attribution | Pi startup release query, install report, 기본 remote catalog, Radius artifact 업로드, gh gist fallback 및 Pi session viewer 제거. 기본 share는 거부하고 `/export`를 안내. provider API traffic은 별도 분류한다. |
| E — 내부 구현·호환 식별자 | `@earendil-works/pi-*`, `pi-monorepo`, `piConfig.configDir`, internal bin `pi`, `dist/pi`, `createPiUserAgent`, SDK 타입, extension hooks, protocol, locks, fixtures | mass rename하지 않는다. npm import/lock/bundle/worker/format 호환성을 위한 이름이며 Weavra release나 원저장소 권한이 아니다. 미사용 legacy onboarding component도 내부 소스에 남지만 canonical startup에서 호출하지 않는다. |
| F — provenance·license·역사 | `runtime/pi/LICENSE`, 중첩 changelog, 과거 WORK_LOG, source archive metadata, 과거 upstream 링크·nested workflow·예제 | 원저작자와 MIT grant, historical import commits를 보존. embedded coding-agent README에는 내부 구현/역사 참고임을 명시하고 현재 Weavra 지침과 구분. 원저장소에 대한 쓰기·이름 변경·자동 동기화 없음. |
| G — provider/protocol compatibility와 검증 자료 | AI provider IDs, Codex originator, Radius gateway, `PI_*` worker/provider knobs, provider fixtures, 회귀 검증 | 원격 상대가 해석하는 protocol 값은 근거 없이 rename하지 않는다. HTTP 제품 attribution/UA는 Weavra로 전환하되 사용자 지정 header 우선순위를 유지. 기존 Pi 문자열을 시험하는 historical/adversarial fixture는 삭제 대상으로 취급하지 않는다. |

위 분류는 파일 단위 단일 label이 아니다. 예를 들어 provider의 transport identifier는 G지만 같은 요청의 제품 User-Agent는 D이고, lockfile의 package name은 E다. docs/examples/tests 전체를 새 제품 지침으로 오인하거나 문자열을 일괄 바꾸지 않는다.

## 제품 표시와 배포 정책

```text
weavra --help
Weavra - AI coding assistant with read, bash, edit, write tools

weavra --version
Weavra development (runtime 0.85.1)

weavra update
Weavra self-update is not configured for this development build. Update from the Weavra source repository: https://github.com/kjg8619/Weavra
```

`update`, `update --self --force`, `update weavra`는 installer, npm self-update, release API를 실행하지 않는다. source-only 정책 안내의 exit code는 0이며 “최신”, “업데이트 완료”라고 주장하지 않는다. `--all`이나 명시된 extension source의 update는 사용자 extension 관리 기능이다. 이를 제품 자동 updater와 혼동하지 않는다.

inherited release/publish/announcement entrypoint는 exit 1로 publication 미설정을 알린다. credential을 읽거나 npm/Git/gh/network를 실행하지 않는다. source-repository GitHub release rewrite는 불가능하다. local build/pack, source archive, package/install lock 생성·검증과 명시적 model catalog 개발 tooling은 유지한다. 새 Weavra release/version/tag/distribution 체계는 별도 승인 대상이다.

## 상태 경계

core/SDK의 기본 user root 선택 우선순위는 아래와 같다. 정상 chat/control launcher는 먼저 `WEAVRA_HOME`을 검증하고 child의 `WEAVRA_CODING_AGENT_DIR`을 그 home의 `agent`로 고정한다. 따라서 launcher의 사용자 위치 변경 입력은 `WEAVRA_HOME`이고, 임의 agent-dir env로 launcher의 private-home 검사를 우회하지 않는다.

1. 명시적 `WEAVRA_CODING_AGENT_DIR`.
2. `WEAVRA_HOME/agent`.
3. `~/.weavra/agent`.

세션은 CLI `--session-dir`, canonical `WEAVRA_CODING_AGENT_SESSION_DIR`, 설정된 sessionDir, agent root 아래 sessions 순서의 기존 선택 정책을 따른다. explicit `--session`은 사용자 입력이며 implicit fallback이 아니다. launcher는 user-state 경로 중첩·권한·symlink 검사 및 worktree 경계를 유지한다.

- `PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR`는 canonical launcher가 제거하고, core의 기본 user root 선택에도 사용하지 않는다.
- `PI_PACKAGE_DIR`로 packaged runtime identity를 바꾸지 않는다. explicit override는 `WEAVRA_PACKAGE_DIR`다.
- `WEAVRA_SERVER_DIR`, `WEAVRA_SERVER_ID`가 experimental server env다. 기본 server state는 canonical agent root의 `experimental/server` 아래다.
- `WEAVRA_OFFLINE`이 CLI의 canonical offline 입력이다. 기존 low-level AI 코드는 `PI_OFFLINE`을 읽으므로 경계에서 변환한다. canonical 값이 있으면 legacy 값보다 우선한다. legacy-only `PI_OFFLINE`은 저수준 호환 입력으로 유지한다.
- provider attribution 설정 env는 `WEAVRA_TELEMETRY`다. 내부 settings schema key는 rename하지 않는다.
- 프로젝트 `.pi/settings.json`, `.pi/skills` 등은 resource compatibility다. user home의 `.pi`를 자동 사용한다는 뜻이 아니다.
- `setup`/`doctor`의 “Pi”는 **선택되지 않은 기존 상태의 존재 여부·명시적 import 안내**에만 남는다. credential 내용을 출력하거나 자동 복사하지 않는다.

## 네트워크와 데이터 정책

### 제거한 기본 제품 통신

- `https://pi.dev/api/latest-version`
- `https://pi.dev/api/installer/releases` 및 managed-install release 전환
- upstream GitHub latest-release/self-update 지침
- `https://pi.dev/api/report-install`
- `https://pi.dev/api/models/providers/*` 기본 catalog refresh
- Radius `/v1/artifacts` session upload, `gh gist create` fallback
- `https://pi.dev/session` viewer URL 생성

원격 catalog wrapper는 명시적인 base URL이 없으면 원래 provider를 그대로 반환한다. 기본 Pi 서비스는 없지만 SDK 호출자가 명시적으로 지정한 catalog 사용까지 금지하는 것은 아니다. build/hydration은 검토된 모델 metadata 생성 경로를 유지한다.

`/share`는 credential/session/private content를 읽기 전에 아래 오류만 표시한다.

```text
Weavra remote sharing is not configured. Use /export to save a local session file.
```

`/export`는 기존 local 파일 export다. 원격 공유 서비스·credential 정책·retention 정책·공개 범위를 이번 작업에서 만들어내지 않는다.

### 제품 telemetry와 provider 통신 구분

remote install-report transport는 제거했다. company-runtime의 local metrics, observer, fitness/evidence 기록은 그대로 유지한다. 이 기록은 completion 권한이 아니며 외부 제품 analytics 전송도 아니다. provider usage accounting과 사용자 선택 API 호출도 Pi 제품 telemetry와 구분한다.

HTTP User-Agent와 OpenRouter attribution, NVIDIA billing origin, Cloudflare client 및 OpenCode client attribution은 Weavra를 표시한다. 명시적으로 지정한 header의 우선순위와 transport 동작은 유지한다.

의도적으로 남는 protocol 예:

- OpenAI Codex `originator: pi`: 기존 provider compatibility 식별자. 제품 User-Agent는 Weavra다.
- `https://radius.pi.dev`: 사용자가 선택한 Radius provider/experimental relay의 endpoint. session sharing이나 자동 제품 update endpoint가 아니다.
- provider/model IDs, protocol schema keys, worker env, package import namespace: 내부 compatibility 식별자.

따라서 “Pi 도메인 문자열이 전혀 없다”거나 “모든 provider 요청을 없앴다”는 주장을 하지 않는다. 검증하는 경계는 **credential 없는 정상 Weavra 시작·제품 metadata/update/share가 Pi 제품 서비스에 암묵적으로 접속하지 않는다**는 것이다. 유료 provider inference는 실행하지 않았다.

## C08 및 cross-boundary 권한

브랜딩·state-root 전환은 다음 경계를 변경하지 않는다.

- Browser/Jev: observation only.
- candidate: `CANDIDATE_ONLY`; registration 또는 PASS가 아니다.
- Runtime/Host: 등록 주체.
- RegisteredVerifier: fresh capture로 검증; candidate evidence를 재사용하지 않는다.
- Kernel: 최종 완료의 유일한 주체.
- Host Bridge: read-only observation; Host Control: 기존 허용 command와 owner lifecycle만 사용.
- browser automatic repair 없음. C09/V0.6D 시작하지 않음.

Kernel/Host/Browser/Verifier의 production authority 구현은 수정하지 않았다. 현재 제품 metadata 명령은 extension을 inject하지 않는 직접 CLI 경로를 사용한다. help/version/update가 workflow prompt로 오인되어 실행 권한을 얻는 기존 launcher 문제도 함께 제거했다. worktree create/open, 실제 chat, stdio protocol 경로는 유지한다.

## 회귀 검증 대응표

| 요구 경계 | 검증 |
| --- | --- |
| 1. 현재 product name | `coding-agent/test/product-independence.test.ts` |
| 2. help identity | 위 suite + 실제 `company-runtime/test/product-cli.test.ts --help` |
| 3. terminal title | 실제 InteractiveMode title method 및 대화형 PTY smoke |
| 4. version 의미 | product identity suite + 실제 `--version` integration |
| 5. canonical home/env | `coding-agent/test/config.test.ts`, launcher-home 및 actual setup integration |
| 6. Pi 상태로 자동 fallback 금지 | poisoned Pi env/private auth fixture, launcher/launcher-home/worktree tests |
| 7. inherited updater 실행 금지 | child-process spy + managed-directory marker 보존 + 실제 update integration |
| 8. Pi version query 금지 | online startup/model refresh/update fetch guard |
| 9. Pi release query 금지 | 같은 network boundary + source publication subprocess guard |
| 10. managed installer 금지 | 악성 inherited installer env/marker 및 source publication tests |
| 11. remote share 금지 | private session Proxy, fetch/spawn guards + 실제 `/share` |
| 12. provenance/license 보존 | `scripts/product-policy.test.mjs` SHA-256 + `scripts/verify-imports.mjs` immutable tree 검증 |
| 13. C08 후보/검증 권한 | 기존 browser-observation 7 tests, browser-verification 40 tests; metadata CLI의 `.ai` byte 보존 회귀 추가 |
| 14. Host Bridge/Control 권한 | 기존 host-bridge 22, host-control-stream 2, host-boundary 1 및 full runtime suite |
| 15. Kernel completion 권한 | 기존 kernel 54 tests 및 full runtime suite |

신규 suite는 product-independence 5, product-cli 5, product-policy 5 cases다. config suite에는 canonical root/metadata 경계 3 cases가 있다. 기존 provider transport/override와 extension package 관리 tests도 변경된 계약에 맞춰 유지한다. 폐기한 updater/share transport tests와 단순 문구 snapshot은 제거했으며, 실제 오류 거부·입력 파일 보존·권한 검증을 삭제하지 않았다.

license SHA-256: `0457f5bcec3b3b211605dfb5d1a49042fd638f3686a410fe099c24a25af13c48`.

## 실제 CLI 증거와 검증 명령

Darwin arm64, Node 26.7.0의 격리된 HOME/project에서 local launcher를 실행했다. 실제 `--help`, `--version`, `update`, `setup`, `doctor`, `config --help`, `install --help`, `remove --help`, `list`는 모두 exit 0이었다. setup은 `.weavra/agent`, doctor는 local build/extension과 canonical root를 표시했다.

실제 PTY에서 Weavra header와 development version을 확인하고 `/share`를 입력했다. 위 미설정 오류를 표시한 뒤 Ctrl-D로 exit 0 종료했다. preload fetch observer에서 시작·명령·종료 동안 기록된 요청은 0회였다. 모델 credential을 제공하지 않았고 inference를 실행하지 않았다. 이는 관찰한 `fetch` 경계의 증거이며 OS 전체 packet capture라고 주장하지 않는다.

추가로 actual `weavra bridge --stdio --project-trusted --control`을 inherited Pi home/session env와 함께 실행했다. handshake는 `authority=Runtime/Kernel`, `readiness=READY`를 반환했고 snapshot은 `busy=false`, `ownedRunId=null`이었다. `product=Weavra`, `status=COMPLETED`를 포함한 위조 `control.complete` 요청은 `UNSUPPORTED_COMMAND`로 거부되었다. 종료 신호 후 exit 0이었다. control launcher의 env adapter도 canonical agent root를 넘기고 ambient Pi/canonical session override를 제거한다; protocol authority 구현 자체는 변경하지 않는다.

실행 대상 gate:

```text
npm install --ignore-scripts
npm run hydrate:model-data
npm run build
npm run check
npm run check:ci
npm run check:shrinkwrap
npm run check:install-lock:coding-agent
npm run check:package-install
npm test
bash ./test.sh
bash -n packages/company-runtime/bin/weavra
git diff --check
node scripts/verify-imports.mjs                 # product root
node --test scripts/consolidation-paths.test.mjs # product root
```

`node scripts/validate.mjs pi`는 runtime check/check:ci, 양쪽 lock gate, npm test, bash test.sh, launcher syntax, diff gate를 실행하는 기존 root orchestration이다. provider credentials를 전달하지 않는 기존 정책을 사용한다. 최종 gate 결과와 원격 CI는 PR/최종 보고에 기록하며, 로컬 smoke를 원격 CI 성공으로 대체하지 않는다.

2026-09-21 최종 로컬 orchestration 결과: **ALL GATES PASS**, exit 0. check/check:ci, 양쪽 lock gate, `npm test`, 격리된 `bash ./test.sh`, launcher syntax, diff check를 모두 완주했다. 두 전체 실행 각각 coding-agent 2,735 passed / 50 skipped, company-runtime 1,486 passed, AI 1,069 passed / 843 skipped였다. credential을 요구하는 기존 skip은 유지했으며 유료 inference 검증으로 주장하지 않는다. 별도로 full build, packed consumer, immutable import tree, source archive 검사도 통과했다.

로컬 full runs에서는 높은 동시 부하에서 기존 fitness/A-B suite의 wall-clock timeout과 streaming test의 10ms sleep race가 관찰되었다. fitness 단독 실행은 24 tests 모두 통과했다. 15개 가용 CPU에서 Vitest 기본 14 workers가 실행되는 것을 확인하여 `vitest.base.ts`의 worker 수를 `max(1, min(4, availableParallelism - 1))`로 제한했다. streaming 회귀는 실제 streaming 상태를 기다린다. context A/B test의 암묵적 5초 한도는 인접 reviewer A/B test와 같은 명시적 30초로 맞췄다. workflow 자체의 기존 제한, 완료/oracle/권한 단언, test 선택, credentials isolation은 변경하지 않는다. 최종 두 전체 test entrypoint는 이 동일한 설정을 사용한다.

추가 packed-consumer 검증도 통과했다. local tarball 10개를 만들고 격리된 npm config로 production dependency만 설치한 뒤 SDK import 및 bundled/unbundled CLI의 Weavra version 계약을 모두 확인했다. install scripts는 실행하지 않았다. inherited 개인 npm 설정의 `allow-scripts` 오류는 repo 설정을 바꾸지 않고 서로 다른 빈 user/global npm config로 격리했다.

## 의도적으로 남긴 작업

- `@earendil-works` package namespace, internal `pi` executable/artifact, imports, catalog keys, TypeScript symbols의 전면 rename.
- project `.pi` resource format 및 low-level env의 schema migration.
- Weavra의 정식 release/version/tag/package registry/installer 배포 체계.
- Weavra 원격 session sharing, remote telemetry 서비스와 개인정보 정책.
- upstream historical docs/examples의 전면 재작성, UI redesign, app lane, architecture refactor.
- provider가 요구하는 protocol 식별자 변경은 provider 호환성 근거가 필요한 별도 작업.

이번 상태는 source-only 제품 identity와 실행 경계를 완결한 것이지 위 서비스가 구현된 것처럼 위장한 배포판이 아니다. PR은 `devlop` 대상이며 merge하지 않는다. `devlop`/`main` 직접 commit 없음, 원저장소 변경 없음, 자동 동기화 없음, C08 CLOSED 경계 유지, C09 NOT STARTED.
