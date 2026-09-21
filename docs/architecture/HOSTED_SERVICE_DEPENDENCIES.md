# Weavra Hosted-Service / External Product Dependency Audit

## 1. 기준과 결론의 범위

- Audit date: **2026-09-21 (UTC)**.
- Audit SHA / starting `origin/devlop`: **`8447f9843e0b2d468554e0062abbe6b98a81ba13`**. 원격 ref를 조회하고 fetch한 뒤 이 SHA에서 worktree를 생성했다.
- Repository: `kjg8619/Weavra`; branch: `docs/hosted-service-dependency-audit`.
- Worktree: `../Weavra-worktrees/hosted-service-dependency-audit`.
- 범위: 시작 SHA의 `runtime/pi`, `app/t3code`, root 실행/CI 설정에 대한 **read-only source audit**. 변경 산출물은 이 문서뿐이다.
- Runtime/App 병렬 branch는 읽거나 merge하지 않았다. 이 문서는 다른 lane의 구현 완료를 선반영하지 않으며 Product Independence closure 선언이 아니다.
- 아래의 “자동/기본값/활성”은 **소스에서 확인한 진입점과 조건**이다. 설치된 제품, 배포 환경변수, 원격 tenant dashboard, DNS/계약상 소유권, 실제 outbound capture는 **UNKNOWN / NOT VERIFIED**다. 소스에 tenant가 기재되어 있다는 이유만으로 이번 감사에서 해당 tenant에 접속했다고 해석하면 안 된다.

## 2. Methodology와 판정 규칙

1. 원격 `devlop`과 local baseline을 고정하고, 별도 worktree에서 소스·설정·스크립트를 조사했다.
2. Pi, T3, 공통 의존성을 분담하여 endpoint literal, 환경변수, SDK 초기화, HTTP/WebSocket 호출, package/CLI download, OAuth, release manifest, export/upload, telemetry exporter를 검색했다. 결과는 caller와 enabling gate까지 추적했다.
3. production source, 개발/build 작업, 명시적 사용자 동작, 예제/보존된 인프라를 구분했다. 검색 hit나 package dependency 하나만으로 runtime network dependency라고 판정하지 않았다.
4. generated model 목록은 provider/API 계열로 집계했다. 임의 URL·사용자 extension·MCP·외부 CLI가 추가하는 네트워크 전체를 정적 literal 목록으로 증명할 수는 없다. 이 문서는 서비스/authority map이며 전이적 npm package 전체의 SBOM이 아니다.
5. 모든 source evidence는 audit SHA에 고정된 permalink다. 감사 중 외부 제품 endpoint를 호출하거나 로그인·업로드·설치·telemetry 전송을 실행하지 않았다. 원격 Git/PR/CI 조회는 lane 제출 작업이다.
6. `Owner`는 코드가 선택한 service/account authority를 뜻한다. `T3 (third-party hosting)`처럼 tenant 운영 주체와 인프라 vendor를 함께 기록한다. 법적 소유권·현재 dashboard 권한은 별도 검증 대상이다.
7. `Required`는 **로컬 Weavra 핵심 사용** 기준이며, 특정 provider/remote/update 기능에만 필수인 경우 따로 명시한다. `Product authority`는 release 실행물, 제품 identity/access, session 공개, 제품 데이터 수신을 누가 통제하는지 구분한다.
8. 위험도: **HIGH** = upstream release/identity/실행물 또는 민감 데이터 authority; **MEDIUM** = 선택적 외부 경로·메타데이터·운영 의존; **LOW** = local-only/수동 provenance 또는 일반 라이브러리. 추천은 사실과 분리된 Integration 판단 제안이다.
9. `RETAIN`은 무조건적 보안 승인이나 오프라인 보장을 뜻하지 않는다. `DISABLE`은 이번 lane의 변경 결과가 아니라 권고다. `DEFER` 역시 현재 활성 upstream authority를 Phase 1에서 무시하라는 뜻이 아니다.

## 3. Service matrix

**Service count: 100개 외부 service/authority-function group + 5개 local/library 비교 항목 = 105행.**
이 수치는 실제 접속한 host 수·법인 수가 아니다. provider의 지역별 endpoint/API route는 같은 기능으로 묶고, inference와 OAuth registration·quota·배포처럼 trust/trigger가 다른 기능은 분리했다. arbitrary endpoint/forge/toolchain 집합은 열린 configuration family다. 모든 행은 audit source에서 도달 가능한 조건 또는 보존된 configuration을 기록하며, 비활성 항목도 포함한다.

### 실행 entrypoint 적용 범위

- 일반 `weavra` launcher는 fork-local Pi bundle을 `-e company-runtime/src/extension.ts`와 함께 실행한다. `PI_CODING_AGENT_DIR`는 격리하지만 `PI_OFFLINE`, version check, install telemetry를 자동으로 끄지 않는다. 따라서 **일반 interactive Weavra 사용에 P01/P03/P04의 Pi 진입점이 관련된다**.
- `weavra bridge --stdio --project-trusted`는 전용 read-only launcher로 분기한다. `--control`도 별도의 trusted control launcher다. **App가 관찰 bridge를 시작한다는 사실만으로 Pi interactive startup 요청까지 발생한다고 주장하지 않는다.** control 요청이 시작한 작업/provider/network는 해당 기능의 조건을 따로 확인해야 한다.
- control의 기본 `createHostWorkflow`는 `ModelRuntime.create({ allowModelNetwork: false })`를 사용한다. 이는 **catalog 초기화의 network 억제**이며 실제 model inference까지 금지하는 switch는 아니다. 따라서 interactive의 자동 catalog refresh를 control startup에 그대로 적용하지 않는다. [E278]
- App 서버의 T08 analytics, T14 provider manifest 및 App updater/cloud paths는 이 bridge 구분과 별개다.

Evidence: [E261] [E262] [E263] [E264] [E265].

### Provider contract (A01–A29에 공통 적용)

provider가 선택되고 credential이 해결된 model request에서 model ID, conversation/context, tool definitions/results, 지원되는 image 및 request options가 전송된다. saved/default/fallback selection과 agent의 후속 turn도 포함한다. 목록에 등록되어 있다는 이유만으로 모든 endpoint가 시작 시 호출되는 것은 아니다. OAuth는 request baseURL을 바꿀 수도 있으며, stored credential 우선순위와 만료 전 refresh가 있다. cloud account/region, proxy와 외부 SDK의 IAM/STS/ADC discovery까지 이 저장소 literal만으로 열거할 수는 없다.

Evidence: [E266] [E267] [E268].

표의 Evidence 번호는 마지막 index의 **정확한 source path/line 및 audit-SHA permalink**로 연결된다.

### 3.1. Pi-derived services

| Service | Owner | Used by | Trigger | Data sent | Authentication | Required | Default behavior | Product authority | Risk | Recommended action | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P01 — `https://pi.dev/api/latest-version` | Pi | interactive / self-update | 자동 interactive startup; 명시적 `pi update` | version/runtime/OS/arch User-Agent; GET | none | 아니오 | 자동 ON; `PI_SKIP_VERSION_CHECK`는 자동만, truthy `PI_OFFLINE`은 하위 lookup 억제 | YES: 응답 version/packageName/note가 update 대상 결정 | HIGH | REPLACE | [E001] [E002] [E003] |
| P02 — `https://pi.dev/api/installer/releases/{version}/{package.json,package-lock.json}`; `https://pi.dev/install.sh`; upstream npm 제품 설치 | Pi; npm publisher/registry는 별개 | managed installer / package-manager-cli | 명시적 self-update; shell 설치 안내 실행 | version/UA; manifest와 lock에 따라 package 다운로드 | manifest none; npm 사용자 설정 | 기존 core 아니오; 이 설치 경로에 필요 | `PI_INSTALLER_API_BASE` override; managed marker/root 검증 후 `npm ci`; latest authority P01은 별도 | YES: 설치 실행물/remote packageName/lock | HIGH | REPLACE | [E004] [E005] [E006] |
| P03 — `https://pi.dev/api/report-install?version={version}` | Pi | InteractiveMode changelog/init | 자동: 빈 session에서 최초 version 또는 새 changelog | version query + runtime/OS/arch UA; body/대화/추적 ID 없음 | none | 아니오 | install telemetry 기본 true; `PI_TELEMETRY` override; truthy `PI_OFFLINE` 억제; general analytics와 별개 | YES: upstream install reporting | MEDIUM | DISABLE | [E007] [E008] [E009] |
| P04 — `https://pi.dev/api/models/providers/{providerId}` | Pi (inference vendor 아님) | ModelRuntime / Models / picker | 자동 interactive refresh, picker open; 명시적 `update --models` | provider ID, UA, ETag; provider credential은 이 GET에 첨부하지 않음 | HTTP none; effective provider credential이 network refresh의 gate | 아니오: bundled/cache fallback | SDK 기본 cache-only; interactive network+credential 조건; 4h TTL; `catalogBaseUrl` override | YES: same-ID model/API/baseUrl 등 remote overlay; 기존 `models-store.json`도 영향 | HIGH | REPLACE | [E010] [E011] [E012] [E013] |
| P05 — `https://radius.pi.dev`: `/v1/oauth`, `/v1/oauth/device`, `/v1/oauth/token`, `/v1/config` 및 gateway models | Pi | Radius provider / login | 명시적 login/선택; 저장 credential의 refresh/config 조회는 이후 자동 가능 | OAuth code/device/refresh token; config GET; 선택 시 inference context | `RADIUS_API_KEY` 또는 OAuth `pi-gateway`, scope `gateway offline_access` | 아니오: 별도 provider 사용 가능 | 등록 != 접속; credential 필요; custom gateway 가능 | YES: account, gateway/routing authority; client registration 소유권 NOT VERIFIED | HIGH | DISABLE | [E014] [E015] [E016] |
| P06 — `https://radius.pi.dev/v1/artifacts?visibility=organization&title=Pi+session` | Pi | `/share` Radius upload | 명시적 share; Radius credential 있으면 자동 destination 선택 | 현재 branch JSONL, cwd/session ID, 대화/tool/custom entries, system prompt와 tool schemas; redaction 확인 안 됨 | Bearer Radius; credential 조회 중 OAuth refresh 가능 | 아니오 | Radius 우선; 실패/취소 시 Gist fallback 안 함; share 자체 offline guard 없음 | YES: 민감 session 저장/returned canonical URL; organization ACL는 요청값만 확인 | HIGH | DISABLE | [E017] [E018] |
| P07 — GitHub Gist via `gh gist create --public=false` | third-party GitHub + 사용자 account | `/share` fallback; 별도 legacy issue-analysis | 명시적 share, Radius provider/token 없을 때; CI는 별도 승인 경로 | 전체 session tree HTML/base64 JSON + header/system prompt/tools; legacy CI는 raw JSONL도 | 사용자 gh auth; CI `PI_GIST_TOKEN` reference | 아니오 | credential-gated fallback; secret/unlisted != access-restricted private | 외부 user-content storage; Pi backend는 아님 | HIGH | INVESTIGATE | [E019] [E020] [E021] [E022] |
| P08 — `https://pi.dev/session/#{gistId}` | Pi | Gist share viewer link | CLI는 링크 표시만; 사용자 click 시 웹 접속 | 초기 HTTP URL에 fragment 없음; viewer JS는 gist ID 접근 가능, 후속 처리 UNKNOWN | 초기 링크 none; viewer 동작 NOT VERIFIED | 아니오 | `PI_SHARE_VIEWER_URL` override; legacy CI hardcoded | YES: 공유 자료를 여는 외부 viewer application | HIGH | REPLACE | [E023] [E024] [E025] |
| P09 — `wss://radius.pi.dev/v1/session-relays/{serverId}/connect`; `PI_RADIUS_GATEWAY` | Pi 또는 설정 gateway | experimental source server/client | 명시적 experimental server 진입 후 token 있으면 자동 WSS | server/connection IDs, multiplexed protocol bytes; E2EE NOT VERIFIED | Bearer token/file/stored Radius auth | 아니오 | published CLI에서 experimental 제외; `PI_EXPERIMENTAL=1` 및 source entry 조건; offline gate | 활성화 시 YES: session transport | HIGH | DEFER | [E026] [E027] [E028] [E029] [E030] |
| P10 — R2 `https://67c0d357268b0fca6e0b465bb9d01b84.r2.cloudflarestorage.com`, bucket `pi-artifacts` | Pi-configured account; third-party Cloudflare | catalog/release/installer publishing | 수동 script; nested CI 정의는 root에서 비활성 | model shards, release metadata, npm tarball integrity, source SHA, installer lock | `PI_ARTIFACTS_R2_ACCESS_KEY_ID/SECRET_ACCESS_KEY`; registry/CI auth 별개 | installed core 아니오 | nested scheduled/tag workflow는 보존 파일; 직접 실행/승격 전 재승인 필요 | YES: product artifact publication; GitHub repo는 dynamic이어도 R2는 fixed | HIGH | DEFER | [E031] [E032] [E033] [E034] |
| P11 — `https://github.com/earendil-works/pi/releases/latest` 및 upstream changelog links | Pi repository authority; third-party GitHub | update fallback / changelog; release scripts | 표시/사용자 click; maintainer release 명령은 별도 | public request metadata; publishing 시 source/assets | browser none; publishing GH/npm credentials | 아니오 | hyperlink 기본 upstream; nested GitHub publish `github.repository`는 fork-dependent | YES: product acquisition; literal 존재만으로 자동 lookup 아님 | MEDIUM | REPLACE | [E035] [E036] [E037] |
| P12 — Provider attribution headers (`HTTP-Referer: https://pi.dev`, Pi title, NVIDIA/Cloudflare/OpenCode headers) | third-party provider 수신; Pi attribution | SDK provider request transform | 선택한 provider inference 시 조건부 첨부 | app identity/category; OpenCode session ID | 동일 provider credential; 별도 Pi HTTP 요청 아님 | 아니오 | 일부 `PI_TELEMETRY` gate; OpenCode session/client headers는 별도 조건 | Pi branding/data attribution, hosted Pi backend 아님 | MEDIUM | REPLACE | [E038] [E039] |

### 3.2. T3-derived services

| Service | Owner | Used by | Trigger | Data sent | Authentication | Required | Default behavior | Product authority | Risk | Recommended action | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T01 — Clerk tenant `clerk.t3.codes`; public key `pk_live_Y2xlcmsudDMuY29kZXMk`; JWT `t3-relay`; CLI client `hzxSgY2cH10sDU2r` | T3-configured tenant; third-party Clerk; admin UNKNOWN | web/mobile managed auth; desktop bridge; CLI OAuth | 완전한 cloud config면 auth shell 자동 초기화; sign-in 명시적; token refresh 조건부 자동 | account/session/passkey/OAuth code·PKCE/device/refresh credential | publishable key는 public; session/OAuth credential; backend secret key/audience 별도 | 로컬 core 아니오; 현 managed cloud에는 필요 | source loader는 env > .env.local > .env; .env.example 자동 로드 안 함. 복사하면 upstream config. SDK와 tenant 구분 | YES: account identity/cloud authorization | HIGH | REPLACE | [E040] [E041] [E042] [E043] [E044] |
| T02 — `https://app.t3.codes/connect`; `T3CODE_HOSTED_APP_URL` | T3 | CLI browser authorization / hosted frontend | 명시적 connect; headless device grant는 Clerk 직접 사용 | fragment의 state/challenge/callback port; sign-in browser metadata | Clerk session + PKCE OAuth | 로컬 아니오 | origin 기본 upstream; cloud/oauth config 없으면 비활성 flow | YES: account setup frontend | HIGH | REPLACE | [E045] [E046] [E047] |
| T03 — `https://relay.t3.codes`; `T3CODE_RELAY_URL` / VITE mapping | T3 또는 설정 operator | T3 Connect discovery/link/token control plane | 명시적 sign-in/link; 저장 desired link startup reconciliation; signed-in discovery 자동 | user/environment IDs, labels/endpoints/public keys/proofs; linked device/credential metadata | Clerk bearer → DPoP tokens; signed environment credentials | 로컬/direct 아니오; managed discovery는 필요 | config+credential gate; server는 persisted desired link도 필요; no-key helper `http://relay.invalid`는 upstream fallback 아님 | YES: discovery/link/credential minting trust | HIGH | REPLACE | [E048] [E049] [E050] [E051] |
| T04 — Cloudflare Worker / managed tunnel/DNS; `RELAY_API_ZONE_NAME`, `RELAY_TUNNEL_ZONE_NAME`, `RELAY_DOMAIN` | third-party Cloudflare; configured account UNKNOWN | relay deployment / environment managed endpoint | 명시적 deploy/link; 기존 link 재연결 | zone/hostname/loopback target, tunnel credentials; tunnel ingress에 API/WS traffic 가능 | deployment account/API credentials, runtime bindings/connector token | 로컬 아니오; managed tunnel 기능에 필요 | 실제 zone/account 미검증; source infra만으로 배포 단정 불가 | YES: cloud reachability/data path | HIGH | DEFER | [E052] [E053] [E054] |
| T05 — PlanetScale Postgres `t3coderelay` + Cloudflare Hyperdrive; generated DB origin | third-party vendors; configured operator UNKNOWN | relay persistent state | 명시적 deployment 뒤 relay 요청 처리 | environment links/public keys/credential hashes, replay state, mobile/activity/delivery metadata | generated DB role/password via binding | 로컬 아니오; 이 relay 구현에는 필요 | 배포 조건부; production DB를 타 stage가 참조하는 config 주의 | YES: hosted account/control-plane state | HIGH | DEFER | [E055] [E056] |
| T06 — APNs `https://api.push.apple.com/3/device/{token}` / sandbox | third-party Apple + developer account UNKNOWN | relay iOS notifications/live activity | 등록 device + opt-in activity publication 뒤 event delivery | device/activity token, environment/thread/project titles, phase/headline/detail/model/deepLink | Apple provider JWT; team/key/bundle/private key | 아니오 | relay deploy `APNS_ENABLED` 기본 true; local core와 별개; publisher flag+stored credentials gate | 제품 notification account/content delivery | MEDIUM | DEFER | [E057] [E058] [E059] [E060] |
| T07 — Google FCM `https://oauth2.googleapis.com/token`, `https://fcm.googleapis.com/v1/projects/{project_id}/messages:send` | third-party Google + project UNKNOWN | relay Android push | 등록 device + activity publisher/queue 조건 | device token + activity data; high-priority Android message | `FCM_SERVICE_ACCOUNT` OAuth bearer | 아니오 | FCM config 없으면 비활성/전송 불가; 실제 account NOT VERIFIED | 제품 notification project | MEDIUM | DEFER | [E061] [E062] |
| T08 — PostHog `https://us.i.posthog.com/batch/`; fixed ingest key in AnalyticsService | third-party PostHog + inherited product project; admin UNKNOWN | server AnalyticsService, boot/client/provider events | 자동 startup/event buffering; 1초 flush/finalizer | SHA-256 provider account ID 우선 distinct_id, fallback anonymous ID; OS/arch/version/mode, project/thread counts, provider/model/token/approval metadata | public ingest project key; Clerk 불필요 | 아니오 | `T3CODE_TELEMETRY_ENABLED` 기본 true; `T3CODE_POSTHOG_HOST/KEY` override; cloud-off와 무관 | YES: upstream-configured product analytics collection | HIGH | DISABLE | [E063] [E064] [E065] [E066] [E067] |
| T09 — Axiom relay/client/mobile OTLP `https://api.axiom.co/v1/traces`; URL/DATASET/TOKEN config | third-party Axiom + configured product dataset UNKNOWN | relay worker / web/mobile/server relay tracing | 완전한 tracing config로 layer 구성 시 relay operation spans 자동 | timing/errors/service/version/surface; error message/stack/cause 및 operation attributes 가능; 완전 익명 아님 | Bearer ingest token + `X-Axiom-Dataset`; management token 별도 | 아니오 | URL+dataset+token 모두 필요; bare mobile URL만으로 upload 안 함; nested release config injection 가능 | YES if inherited dataset: product diagnostics sink | MEDIUM | INVESTIGATE | [E068] [E069] [E070] [E071] |
| T10 — operator OTLP collector via `otlpTracesUrl/MetricsUrl/LogsUrl`; web `/api/observability/v1/traces` | local 또는 third-party operator-selected | server/desktop observability; web → own environment proxy | 명시적 exporter config 뒤 instrumentation | logs/spans/metrics/attributes; 정확한 데이터는 instrument/config에 의존 | collector headers; browser는 environment session | 아니오 | server remote URL 기본 undefined; URL 없으면 proxy 204/local ingest; desktop metrics exporter commented out | Pi/T3 authority 내재 없음; sink operator 통제 | MEDIUM | RETAIN | [E072] [E073] [E074] [E075] |
| T11 — desktop GitHub feed `app-update.yml`, latest/nightly YAML/blockmap/archives | build-selected repo: `T3CODE_DESKTOP_UPDATE_REPOSITORY` > `GITHUB_REPOSITORY`; third-party GitHub | Electron updater | production configured feed: 15초 후/4분마다 자동 check; download/install 명시적 | version/channel/platform metadata, manifest/assets GET | public client requests; publishing/signing credentials 별도 | 기존 core 아니오 | feed+packaged production+platform gate; `T3CODE_DISABLE_AUTO_UPDATE`; no-feed/preview 비활성; autoDownload/autoInstallOnAppQuit false | YES: 선택된 repo release executable authority; 항상 pingdotgg라는 주장은 틀림 | HIGH | INVESTIGATE | [E076] [E077] [E078] [E079] |
| T12 — CLI/server `https://api.github.com/repos/pingdotgg/t3code/releases?per_page=100&page=N`; `https://github.com/pingdotgg/t3code/releases/download` | T3 release authority; third-party GitHub | CLI update / pinnedRuntime / boot-service / shell installers | 명시적 update/service install; server update는 desktop/boot-service 조건 | release metadata, platform archive + SHA256SUMS | public GET; package-manager/CI credentials 별도 | 기존 core 아니오; 이 install/update 경로에 필요 | `T3CODE_RELEASE_BASE_URL`은 download만 변경; index는 upstream 고정 | YES: executable bytes + version selection; 동일 authority checksum은 독립 provenance 아님 | HIGH | REPLACE | [E080] [E081] [E082] [E083] [E084] |
| T13 — Expo OTA `https://u.expo.dev/d763fcb8-d37c-41ea-a773-b54a0ab4a454`; owner `pingdotgg` | T3-configured Expo project; third-party Expo | mobile native/JS updates | 자동 ON_LOAD; launch/foreground recheck; manual About action도 존재 | SDK/runtime/channel update metadata; 정확한 SDK wire payload NOT VERIFIED | client에 EXPO_TOKEN 불필요; publishing token 별도 | embedded app core 아니오; OTA에는 필요 | 기본 enabled (`T3CODE_MOBILE_UPDATES_ENABLED !== "0"`); __DEV__/Updates.isEnabled runtime gates | YES: 실행 JS bundle/rollback delivery | HIGH | DISABLE | [E085] [E086] [E087] [E088] |
| T14 — `https://raw.githubusercontent.com/pingdotgg/t3code/main/apps/server/src/provider/model-manifest.json` | T3 mutable main authority; third-party GitHub | ModelManifest / provider checks | provider checks에서 background refresh; startup service에 포함 | public GET; prompts/keys 전송 코드 없음 | none | 아니오: bundled/disk fallback | `enableProviderUpdateChecks` 기본 true; success 1h/failure 5min TTL; false라도 기존 disk cache 유지 | YES: model capabilities/defaults/adapter metadata; inference API 아님 | HIGH | REPLACE | [E089] [E090] [E091] [E092] |
| T15 — `https://raw.githubusercontent.com/pingdotgg/t3code/main/.github/triage/PLAYBOOK.md`; upstream clone/issues | T3 support instruction authority | explicit `t3 triage` → installed Claude/Codex | 사용자가 triage 실행하면 agent에 fetch/follow 지시; app의 직접 startup GET 아님 | playbook/repo/issue 조회; 승인 후 diagnostic issue 전송 가능 | agent tools/provider/GitHub 사용자 권한 | 아니오 | 명시적 사용 전 dormant; 실제 agent execution NOT VERIFIED | YES: mutable support instructions/issue destination | MEDIUM | REPLACE | [E093] [E094] [E095] |
| T16 — marketing `t3.codes`, upstream GitHub release index; Apple app `6787819824`, Android `com.t3tools.t3code` | T3 site/repo/store listings; third-party hosting/stores | marketing/download page, installer/store links | 페이지 load/channel change 자동 release GET; 링크/installer 실행 명시적 | browser metadata, public release GET; sessionStorage cache | none | 아니오 | page targets upstream; 배포 여부 NOT VERIFIED; 링크는 autoexecution 아님 | YES: product acquisition/download/store routing | MEDIUM | REPLACE | [E096] [E097] [E098] |
| T17 — Discord `DISCORD_WEBHOOK_URL` / nested `DISCORD_RELEASE_WEBHOOK_URL` | third-party Discord; configured channel UNKNOWN | release notification script | 명시적 CLI 또는 nested release workflow; root 자동 실행 아님 | release name/version/tag/URL/time/mention role; 사용자 analytics 아님 | secret webhook URL | 아니오 | config 없는 runtime에서 비활성; nested workflow 보존 | announcement channel; core auth/update authority 아님 | LOW | DEFER | [E099] [E100] [E101] |

### 3.3. Provider APIs — vendor families

| Service | Owner | Used by | Trigger | Data sent | Authentication | Required | Default behavior | Product authority | Risk | Recommended action | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A01 — Anthropic — `https://api.anthropic.com` | third-party Anthropic | pi-ai / coding-agent | 선택한 inference; saved/default model의 후속 agent turn 포함 | model/context/messages/tools/results/images/options (§3 provider contract) | ANTHROPIC_API_KEY / ANTHROPIC_OAUTH_TOKEN / ANTHROPIC_AUTH_TOKEN / stored OAuth | model provider 하나 필요; 이 vendor는 교체 가능 | supported != automatic call; credential+selection 필요 | model inference/billing만; Pi/T3 product backend 아님 | HIGH | RETAIN | [E117] |
| A02 — OpenAI API — `https://api.openai.com/v1` | third-party OpenAI API | pi-ai / coding-agent | 선택한 inference; saved/default model의 후속 agent turn 포함 | model/context/messages/tools/results/images/options (§3 provider contract) | OPENAI_API_KEY | model provider 하나 필요; 이 vendor는 교체 가능 | supported != automatic call; credential+selection 필요 | model inference/billing만; Pi/T3 product backend 아님 | HIGH | RETAIN | [E118] |
| A03 — OpenAI Codex subscription — `https://chatgpt.com/backend-api/codex/responses (HTTPS/WSS)` | third-party OpenAI Codex subscription | pi-ai / coding-agent | 선택한 inference; saved/default model의 후속 agent turn 포함 | model/context/messages/tools/results/images/options (§3 provider contract) | OpenAI subscription OAuth/account | model provider 하나 필요; 이 vendor는 교체 가능 | supported != automatic call; credential+selection 필요 | model inference/billing만; Pi/T3 product backend 아님 | HIGH | RETAIN | [E119] [E120] |
| A04 — Microsoft Azure OpenAI — `AZURE_OPENAI_BASE_URL 또는 https://{resource}.openai.azure.com/openai/v1` | third-party Microsoft Azure OpenAI | pi-ai / coding-agent | 선택한 inference; saved/default model의 후속 agent turn 포함 | model/context/messages/tools/results/images/options (§3 provider contract) | AZURE_OPENAI_API_KEY, resource/deployment/version | model provider 하나 필요; 이 vendor는 교체 가능 | supported != automatic call; credential+selection 필요 | model inference/billing만; Pi/T3 product backend 아님 | HIGH | RETAIN | [E121] [E122] |
| A05 — Amazon Bedrock — `SDK region/model.baseUrl; 예 https://bedrock-runtime.us-east-1.amazonaws.com` | third-party Amazon Bedrock | pi-ai / coding-agent | 선택한 inference; saved/default model의 후속 agent turn 포함 | model/context/messages/tools/results/images/options (§3 provider contract) | AWS credential chain/profile 또는 AWS_BEARER_TOKEN_BEDROCK | model provider 하나 필요; 이 vendor는 교체 가능 | supported != automatic call; credential+selection 필요 | model inference/billing만; Pi/T3 product backend 아님 | HIGH | RETAIN | [E123] [E124] |
| A06 — Google Gemini — `https://generativelanguage.googleapis.com/v1beta` | third-party Google Gemini | pi-ai / coding-agent | 선택한 inference; saved/default model의 후속 agent turn 포함 | model/context/messages/tools/results/images/options (§3 provider contract) | GEMINI_API_KEY | model provider 하나 필요; 이 vendor는 교체 가능 | supported != automatic call; credential+selection 필요 | model inference/billing만; Pi/T3 product backend 아님 | HIGH | RETAIN | [E125] |
| A07 — Google Vertex AI — `https://{location}-aiplatform.googleapis.com 또는 custom baseURL` | third-party Google Vertex AI | pi-ai / coding-agent | 선택한 inference; saved/default model의 후속 agent turn 포함 | model/context/messages/tools/results/images/options (§3 provider contract) | GOOGLE_CLOUD_API_KEY / ADC / project/location | model provider 하나 필요; 이 vendor는 교체 가능 | supported != automatic call; credential+selection 필요 | model inference/billing만; Pi/T3 product backend 아님 | HIGH | RETAIN | [E126] [E127] |
| A08 — GitHub Copilot — `https://api.individual.githubcopilot.com; token proxy-ep/enterprise override` | third-party GitHub Copilot | pi-ai / coding-agent | 선택한 inference; saved/default model의 후속 agent turn 포함 | model/context/messages/tools/results/images/options (§3 provider contract) | COPILOT_GITHUB_TOKEN / Copilot OAuth | model provider 하나 필요; 이 vendor는 교체 가능 | supported != automatic call; credential+selection 필요 | model inference/billing만; Pi/T3 product backend 아님 | HIGH | RETAIN | [E128] |
| A09 — xAI — `https://api.x.ai/v1` | third-party xAI | pi-ai / coding-agent | 선택한 inference; saved/default model의 후속 agent turn 포함 | model/context/messages/tools/results/images/options (§3 provider contract) | XAI_API_KEY / OAuth | model provider 하나 필요; 이 vendor는 교체 가능 | supported != automatic call; credential+selection 필요 | model inference/billing만; Pi/T3 product backend 아님 | HIGH | RETAIN | [E129] |
| A10 — Moonshot/Kimi — `https://api.moonshot.ai/v1; https://api.moonshot.cn/v1; https://api.kimi.com/coding` | third-party Moonshot/Kimi | pi-ai / coding-agent | 선택한 inference; saved/default model의 후속 agent turn 포함 | model/context/messages/tools/results/images/options (§3 provider contract) | MOONSHOT_API_KEY / KIMI_API_KEY / Kimi OAuth | model provider 하나 필요; 이 vendor는 교체 가능 | supported != automatic call; credential+selection 필요 | model inference/billing만; Pi/T3 product backend 아님 | HIGH | RETAIN | [E130] [E131] [E132] |
| A11 — OpenRouter — `https://openrouter.ai/api/v1` | third-party OpenRouter | pi-ai / coding-agent | 선택한 inference; saved/default model의 후속 agent turn 포함 | model/context/messages/tools/results/images/options (§3 provider contract) | OPENROUTER_API_KEY / authorized permanent key | model provider 하나 필요; 이 vendor는 교체 가능 | supported != automatic call; credential+selection 필요 | model inference/billing만; Pi/T3 product backend 아님 | HIGH | RETAIN | [E133] |
| A12 — Cloudflare Workers AI — `https://api.cloudflare.com/client/v4/accounts/{account}/ai/v1` | third-party Cloudflare Workers AI | pi-ai / coding-agent | 선택한 inference; saved/default model의 후속 agent turn 포함 | model/context/messages/tools/results/images/options (§3 provider contract) | Cloudflare API key + CLOUDFLARE_ACCOUNT_ID | model provider 하나 필요; 이 vendor는 교체 가능 | supported != automatic call; credential+selection 필요 | model inference/billing만; Pi/T3 product backend 아님 | HIGH | RETAIN | [E134] [E135] |
| A13 — Cloudflare AI Gateway — `https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/{provider}; optional workers-binding.ai transport` | third-party Cloudflare AI Gateway | pi-ai / coding-agent | 선택한 inference; saved/default model의 후속 agent turn 포함 | model/context/messages/tools/results/images/options (§3 provider contract) | account/gateway/API key 또는 supplied binding | model provider 하나 필요; 이 vendor는 교체 가능 | supported != automatic call; credential+selection 필요 | model inference/billing만; Pi/T3 product backend 아님 | HIGH | RETAIN | [E136] [E137] |
| A14 — Vercel AI Gateway — `https://ai-gateway.vercel.sh` | third-party Vercel AI Gateway | pi-ai / coding-agent | 선택한 inference; saved/default model의 후속 agent turn 포함 | model/context/messages/tools/results/images/options (§3 provider contract) | AI_GATEWAY_API_KEY | model provider 하나 필요; 이 vendor는 교체 가능 | supported != automatic call; credential+selection 필요 | model inference/billing만; Pi/T3 product backend 아님 | HIGH | RETAIN | [E138] |
| A15 — OpenCode Zen/Go — `https://opencode.ai/zen; https://opencode.ai/zen/go` | third-party OpenCode Zen/Go | pi-ai / coding-agent | 선택한 inference; saved/default model의 후속 agent turn 포함 | model/context/messages/tools/results/images/options (§3 provider contract) | OPENCODE_API_KEY | model provider 하나 필요; 이 vendor는 교체 가능 | supported != automatic call; credential+selection 필요 | model inference/billing만; Pi/T3 product backend 아님 | HIGH | RETAIN | [E139] [E140] |
| A16 — Hugging Face inference router — `https://router.huggingface.co/v1` | third-party Hugging Face inference router | pi-ai / coding-agent | 선택한 inference; saved/default model의 후속 agent turn 포함 | model/context/messages/tools/results/images/options (§3 provider contract) | HF_TOKEN | model provider 하나 필요; 이 vendor는 교체 가능 | supported != automatic call; credential+selection 필요 | model inference/billing만; Pi/T3 product backend 아님 | HIGH | RETAIN | [E141] |
| A17 — DeepSeek — `https://api.deepseek.com` | third-party DeepSeek | pi-ai / coding-agent | 선택한 inference; saved/default model의 후속 agent turn 포함 | model/context/messages/tools/results/images/options (§3 provider contract) | DEEPSEEK_API_KEY | model provider 하나 필요; 이 vendor는 교체 가능 | supported != automatic call; credential+selection 필요 | model inference/billing만; Pi/T3 product backend 아님 | HIGH | RETAIN | [E142] |
| A18 — Mistral — `https://api.mistral.ai (v1/chat/completions)` | third-party Mistral | pi-ai / coding-agent | 선택한 inference; saved/default model의 후속 agent turn 포함 | model/context/messages/tools/results/images/options (§3 provider contract) | MISTRAL_API_KEY | model provider 하나 필요; 이 vendor는 교체 가능 | supported != automatic call; credential+selection 필요 | model inference/billing만; Pi/T3 product backend 아님 | HIGH | RETAIN | [E143] |
| A19 — MiniMax — `https://api.minimax.io/anthropic; https://api.minimaxi.com/anthropic` | third-party MiniMax | pi-ai / coding-agent | 선택한 inference; saved/default model의 후속 agent turn 포함 | model/context/messages/tools/results/images/options (§3 provider contract) | MINIMAX_API_KEY / MINIMAX_CN_API_KEY | model provider 하나 필요; 이 vendor는 교체 가능 | supported != automatic call; credential+selection 필요 | model inference/billing만; Pi/T3 product backend 아님 | HIGH | RETAIN | [E144] [E145] |
| A20 — Alibaba/Qwen token plans — `https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1; cn-beijing variant` | third-party Alibaba/Qwen token plans | pi-ai / coding-agent | 선택한 inference; saved/default model의 후속 agent turn 포함 | model/context/messages/tools/results/images/options (§3 provider contract) | QWEN_TOKEN_PLAN_API_KEY / QWEN_TOKEN_PLAN_CN_API_KEY | model provider 하나 필요; 이 vendor는 교체 가능 | supported != automatic call; credential+selection 필요 | model inference/billing만; Pi/T3 product backend 아님 | HIGH | RETAIN | [E146] [E147] |
| A21 — Xiaomi — `https://api.xiaomimimo.com/v1; https://token-plan-{ams,cn,sgp}.xiaomimimo.com/v1` | third-party Xiaomi | pi-ai / coding-agent | 선택한 inference; saved/default model의 후속 agent turn 포함 | model/context/messages/tools/results/images/options (§3 provider contract) | XIAOMI_API_KEY / XIAOMI_TOKEN_PLAN_{AMS,CN,SGP}_API_KEY | model provider 하나 필요; 이 vendor는 교체 가능 | supported != automatic call; credential+selection 필요 | model inference/billing만; Pi/T3 product backend 아님 | HIGH | RETAIN | [E148] [E149] [E150] [E151] |
| A22 — Z.AI/BigModel — `https://api.z.ai/api/coding/paas/v4; https://open.bigmodel.cn/api/coding/paas/v4` | third-party Z.AI/BigModel | pi-ai / coding-agent | 선택한 inference; saved/default model의 후속 agent turn 포함 | model/context/messages/tools/results/images/options (§3 provider contract) | ZAI_API_KEY / ZAI_CODING_CN_API_KEY | model provider 하나 필요; 이 vendor는 교체 가능 | supported != automatic call; credential+selection 필요 | model inference/billing만; Pi/T3 product backend 아님 | HIGH | RETAIN | [E152] [E153] |
| A23 — Ant Ling — `https://api.ant-ling.com/v1` | third-party Ant Ling | pi-ai / coding-agent | 선택한 inference; saved/default model의 후속 agent turn 포함 | model/context/messages/tools/results/images/options (§3 provider contract) | ANT_LING_API_KEY | model provider 하나 필요; 이 vendor는 교체 가능 | supported != automatic call; credential+selection 필요 | model inference/billing만; Pi/T3 product backend 아님 | HIGH | RETAIN | [E154] |
| A24 — Baseten — `https://inference.baseten.co/v1` | third-party Baseten | pi-ai / coding-agent | 선택한 inference; saved/default model의 후속 agent turn 포함 | model/context/messages/tools/results/images/options (§3 provider contract) | BASETEN_API_KEY | model provider 하나 필요; 이 vendor는 교체 가능 | supported != automatic call; credential+selection 필요 | model inference/billing만; Pi/T3 product backend 아님 | HIGH | RETAIN | [E155] |
| A25 — Cerebras — `https://api.cerebras.ai/v1` | third-party Cerebras | pi-ai / coding-agent | 선택한 inference; saved/default model의 후속 agent turn 포함 | model/context/messages/tools/results/images/options (§3 provider contract) | CEREBRAS_API_KEY | model provider 하나 필요; 이 vendor는 교체 가능 | supported != automatic call; credential+selection 필요 | model inference/billing만; Pi/T3 product backend 아님 | HIGH | RETAIN | [E156] |
| A26 — Fireworks — `https://api.fireworks.ai/inference` | third-party Fireworks | pi-ai / coding-agent | 선택한 inference; saved/default model의 후속 agent turn 포함 | model/context/messages/tools/results/images/options (§3 provider contract) | FIREWORKS_API_KEY | model provider 하나 필요; 이 vendor는 교체 가능 | supported != automatic call; credential+selection 필요 | model inference/billing만; Pi/T3 product backend 아님 | HIGH | RETAIN | [E157] |
| A27 — Groq — `https://api.groq.com/openai/v1` | third-party Groq | pi-ai / coding-agent | 선택한 inference; saved/default model의 후속 agent turn 포함 | model/context/messages/tools/results/images/options (§3 provider contract) | GROQ_API_KEY | model provider 하나 필요; 이 vendor는 교체 가능 | supported != automatic call; credential+selection 필요 | model inference/billing만; Pi/T3 product backend 아님 | HIGH | RETAIN | [E158] |
| A28 — NVIDIA NIM — `https://integrate.api.nvidia.com/v1` | third-party NVIDIA NIM | pi-ai / coding-agent | 선택한 inference; saved/default model의 후속 agent turn 포함 | model/context/messages/tools/results/images/options (§3 provider contract) | NVIDIA_API_KEY | model provider 하나 필요; 이 vendor는 교체 가능 | supported != automatic call; credential+selection 필요 | model inference/billing만; Pi/T3 product backend 아님 | HIGH | RETAIN | [E159] |
| A29 — Together — `https://api.together.ai/v1` | third-party Together | pi-ai / coding-agent | 선택한 inference; saved/default model의 후속 agent turn 포함 | model/context/messages/tools/results/images/options (§3 provider contract) | TOGETHER_API_KEY | model provider 하나 필요; 이 vendor는 교체 가능 | supported != automatic call; credential+selection 필요 | model inference/billing만; Pi/T3 product backend 아님 | HIGH | RETAIN | [E160] |

### 3.4. Provider OAuth registrations / authorization

| Service | Owner | Used by | Trigger | Data sent | Authentication | Required | Default behavior | Product authority | Risk | Recommended action | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| O01 — Anthropic `claude.ai/oauth/authorize` → `platform.claude.com/v1/oauth/token`; fixed decoded client ID | third-party provider; registration admin UNKNOWN | Pi provider login/refresh | 명시적 login; 저장 token refresh 자동 가능 | code/PKCE/state/refresh; org:create_api_key, profile/inference/Claude Code/MCP/file scopes | fixed public client ID; user grant | API-key 대안 있음 | lazy flow; 사전 로그인 없음 | provider registration reliance; Pi/T3-owned 근거 없음 | HIGH | INVESTIGATE | [E161] [E162] |
| O02 — OpenAI `https://auth.openai.com` OAuth/deviceauth; client `app_EMoamEEZ73f0CkXaXp7hrann` | third-party OpenAI; registration admin UNKNOWN | Pi Codex login/refresh | 명시적 OAuth/device login; 이후 refresh | openid/profile/email/offline_access, code/device/refresh | public client ID + user grant; loopback callback | subscription 방법에만 필요 | lazy flow; stored credential 조건 | provider registration reliance; Pi backend 아님 | HIGH | INVESTIGATE | [E163] [E164] |
| O03 — GitHub/enterprise `/login/device/code`, `/login/oauth/access_token`, `/copilot_internal/v2/token`; fixed decoded client ID | third-party GitHub; registration admin UNKNOWN | Pi Copilot sign-in | 명시적 device grant; 이후 refresh/models lookup | read:user, device/access tokens, client ID | user OAuth; gh/Gist auth와 별개 | Copilot 방법에만 필요 | 기본 GitHub; enterprise host 선택 가능 | provider registration/token authority; Pi 소유 근거 없음 | HIGH | INVESTIGATE | [E165] [E166] [E167] |
| O04 — `https://auth.kimi.com/api/oauth/{device_authorization,token}`; client `17e5f671-d194-4dfb-9706-5516cb48c098` | third-party Kimi; registration admin UNKNOWN | Pi Kimi login | 명시적 device grant; 이후 refresh | client/device/refresh token | user grant; `KIMI_CODE_OAUTH_HOST` / `KIMI_OAUTH_HOST` override | 이 auth 방법에만 필요 | lazy; host override는 credential trust 경계 | provider registration; Pi backend 아님 | HIGH | INVESTIGATE | [E168] [E169] |
| O05 — `https://auth.x.ai/oauth2/{device/code,token}`; client `b1a00492-073a-47ea-816f-4c329264a828` | third-party xAI; registration admin UNKNOWN | Pi xAI login/refresh | 명시적 device grant; 이후 refresh | openid/profile/email/offline_access/grok-cli:access/api:access; `referrer: pi` | public client ID + user grant | 이 auth 방법에만 필요 | lazy flow; attribution도 전송 | provider registration; Pi/T3 admin 근거 없음 | HIGH | INVESTIGATE | [E170] [E171] [E172] |
| O06 — OpenRouter `https://openrouter.ai/auth` → `https://openrouter.ai/api/v1/auth/keys` | third-party OpenRouter | Pi key authorization | 명시적 login/PKCE | authorization code/verifier; permanent user API key 반환 | user authorization; fixed client_id 발견 못함 | 이 key 발급 방법에만 필요 | refresh는 기존 credential 반환 | generic user key issuance; upstream product tenant 근거 없음 | MEDIUM | RETAIN | [E173] [E174] |
| O07 — Antigravity-emitted Google authorize URL; accepted `https://accounts.google.com/o/oauth2/v2/auth` | third-party Google/process; client registration UNKNOWN | T3 Antigravity provider sign-in | 명시적 provider auth RPC → external binary | authorization URL/state/code/loopback forwarding; vendor token wire NOT VERIFIED | external vendor process-owned flow | 아니오 | provider 기본 disabled; installed/auth action 조건 | registration delegated; T3-owned tenant라 단정 불가 | HIGH | INVESTIGATE | [E175] [E176] [E177] |

### 3.5. Common network, assets and tooling

| Service | Owner | Used by | Trigger | Data sent | Authentication | Required | Default behavior | Product authority | Risk | Recommended action | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C01 — T3 provider CLI/SDK processes: Codex, Claude, Cursor, Grok, Antigravity, OpenCode | third-party vendors 또는 configured server | provider adapters | inference + enabled/installed provider의 initial/settings/demand probes | prompts/context/tools; account/model/rate-limit requests; vendor-internal telemetry UNKNOWN | user CLI/SDK auth; OpenCode serverUrl/password 가능 | provider 하나 필요; 특정 vendor 아님 | Codex/Claude 기본 enabled; 나머지 기본 disabled | generic model runtime; Pi/T3 backend 아님 | HIGH | RETAIN | [E178] [E179] [E180] [E181] [E182] |
| C02 — Cursor `${apiEndpoint &#124;&#124; CURSOR_API_ENDPOINT &#124;&#124; https://api2.cursor.sh}/aiserver.v1.DashboardService/GetCurrentPeriodUsage` | third-party Cursor | provider usage snapshot | enabled+installed+authenticated refresh 자동 | POST {} + account request metadata | CURSOR_AUTH_TOKEN / selected credential; mismatches 거부 | 아니오 | Cursor 기본 off | provider quota, T3 backend 아님 | MEDIUM | RETAIN | [E183] [E184] |
| C03 — `https://cli-chat-proxy.grok.com/v1/billing?format=credits` | third-party xAI | Grok quota | enabled+installed+recognized OAuth refresh 자동 | account usage request | GROK_AUTH / GROK_HOME auth; API-key/override mode 거부 | 아니오 | Grok 기본 off | provider quota only | MEDIUM | RETAIN | [E185] |
| C04 — `https://opencode.ai/zen/go/v1/usage` | third-party OpenCode | OpenCode Go quota | enabled provider refresh 자동 | usage GET | OPENCODE_AUTH_CONTENT/local auth/OPENCODE_API_KEY | 아니오 | OpenCode 기본 off; external serverUrl 제외 | provider quota only | MEDIUM | RETAIN | [E186] |
| C05 — operator quota hub `/v0/management/{auth-files,api-call,reset-quota}`; delegates Anthropic `/api/oauth/usage`, ChatGPT `/backend-api/wham` | operator-selected third-party/local | UsageLimitSources / CLIProxyAPI | configured source startup/settings/health refresh; reset-credit 명시적 | account descriptors; `$TOKEN$` delegated calls; explicit reset/credit operations | hub management bearer key; provider token은 hub-side | 아니오 | sources 기본 empty; 개별 source 기본 enabled | 설정된 account-management authority; Pi/T3 fixed backend 아님 | HIGH | RETAIN | [E187] [E188] [E189] [E190] |
| C06 — GitHub forge APIs/GraphQL via user remote/gh | third-party GitHub + user repositories | source control / PR / issue operations | 사용자 action 및 displayed data refresh/auth discovery | repo/PR/issues/reviews/diffs/actions; 승인된 mutation 포함 | gh 또는 host-specific GH_TOKEN/GITHUB_TOKEN/enterprise auth | VCS 기능에 조건부; core inference 아니오 | configured remote/auth에 의존; 고정 pingdotgg lookup 아님 | 사용자 forge authority; product release T12와 별개 | HIGH | RETAIN | [E191] [E192] |
| C07 — configured GitLab/Bitbucket/Azure DevOps/Forgejo/Gitea remotes | third-party/user-selected | source-control provider registry | remote에 맞는 CLI/read/mutation 선택 | repo/PR/source metadata; 전송은 selected forge에 한정 | git/glab/az/fj/tea 사용자 credentials | 선택적 VCS | host classification literals != 모든 host 동시 접속 | 사용자 forge, upstream product backend 아님 | HIGH | RETAIN | [E193] [E194] |
| C08 — GitHub media/raw/avatar + `github.githubassets.com/favicons/` | third-party GitHub/content host | PR/media rendering | 표시/요청 시 자동 asset fetch | media/avatar URL + network metadata | media bearer는 allowlisted HTTPS GitHub hosts만; external redirect에는 미전달 | 아니오 | surface-driven; 매 startup 요청 아님 | 외부 asset authority; Pi/T3 product 아님 | MEDIUM | RETAIN | [E195] [E196] [E197] |
| C09 — Tailscale CLI/daemon, MagicDNS HTTPS `/.well-known/t3/environment` | third-party Tailscale + operator tailnet | remote exposure / pair | 명시적 --tailscale-serve/pair/desktop setting; configured probe/reconnect | backend traffic/host exposure; status/serve CLI config | existing daemon/tailnet auth + app session/pairing | 아니오 | T3CODE_TAILSCALE_SERVE 기본 false; cloud control hostname UNKNOWN | generic remote transport; T3 relay와 별개 | HIGH | RETAIN | [E198] [E199] [E200] |
| C10 — Google `https://www.google.com/s2/favicons?domain={host}&sz={size}` | third-party Google | markdown/preview favicon | 해당 content의 lazy image render 시 자동 | public linked host/port + browser metadata; path/query 제거; private/reserved host 제외 | none | 아니오 | render-driven; 명시적 consent gate 발견 못함 | generic asset/data disclosure, Pi/T3 backend 아님 | MEDIUM | INVESTIGATE | [E201] [E202] |
| C11 — arbitrary markdown images/favicon URLs/page `/favicon.ico`/browser preview targets | UNKNOWN: content/user-selected | web media/preview/browser | content render 또는 사용자/agent navigation | URL/network metadata, browser cookies/session은 해당 환경에 의존 | target/browser session dependent | 특정 host 필수 아님 | content/config conditional; finite allowlist 입증 안 됨 | external content authority; built-in product backend는 아님 | HIGH | RETAIN | [E203] [E204] [E205] |
| C12 — `https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json` | third-party BerriAI content authority | UsageService local cost calculation | usage scan에서 stale/missing cache 시; 명시적 rates refresh | public GET; local transcript upload 코드 아님 | none | 아니오 | 24h cache; manual refresh 60초 floor; disk fallback | 가격 metadata authority; T3 product catalog T14와 다름 | MEDIUM | RETAIN | [E206] [E207] [E208] |
| C13 — Hugging Face Hub `https://huggingface.co/api/models?...filter=gguf`, `/api/models/{id}?blobs=true` | third-party Hugging Face + model publishers | Pi llama model browser | 명시적 /llama search/details/download | search terms/repo IDs; download 명령은 llama server `/models`에 전달 | optional HF_TOKEN/token file; actual weights transport는 llama-side UNKNOWN | 아니오 | explicit UI; A16 inference router와 다른 기능 | generic model distribution | MEDIUM | RETAIN | [E209] [E210] |
| C14 — llama.cpp `http://127.0.0.1:8080` placeholder / `LLAMA_BASE_URL` / stored server URL | local 또는 operator-selected remote | Pi llama provider/manage/SSE | 명시적 login/inference; credential-gated catalog; /llama explicit refresh | model context/keys, model management/download requests | stored server URL/key | 이 local model 선택 시만 | local placeholder != 모든 배포 local; explicit /llama refresh는 offline에서도 가능 | operator model runtime; Pi SaaS 아님 | MEDIUM | RETAIN | [E211] [E212] [E213] |
| C15 — npm/pnpm/yarn/bun configured registries; source default `https://registry.npmjs.org` | third-party registry + individual package publishers | build/install; Pi configured extension package manager | 명시적 install/update; installed unpinned extension startup `npm view`; missing configured sources policy-gated install | package/version/platform metadata; executable packages | user package-manager registry/auth config | configured bootstrap 필요; installed per-turn backend 아님 | locked installs; no configured extensions ⇒ 해당 조회 없음; upstream product namespaces G02/P02 별도 | generic supply chain; namespace ownership 별도 | HIGH | RETAIN | [E214] [E215] [E216] [E217] |
| C16 — provider npm `/package/latest`; Homebrew delegated update endpoints | third-party provider publisher/registry | T3 provider maintenance | enabled+installed+versioned provider advisory 자동; install/upgrade 명시적 | package name/version; update code 다운로드 | registry/package-manager user configuration | 아니오 | enableProviderUpdateChecks 기본 true; ownership-aware update; T14도 같은 switch 사용 | generic provider executable supply chain | MEDIUM | RETAIN | [E218] [E219] |
| C17 — https://github.com/sharkdp/fd/releases/{latest,download/...} | third-party sharkdp/fd | Pi missing fd bootstrap | 자동 interactive init/tool 사용: private bin/PATH 없을 때 | platform/arch release query + executable download | none | hosted 필요 없음: tool preinstall 가능 | offline/platform gate; moving latest (fd Darwin x64는 pinned); shared flow checksum 검증 발견 못함 | third-party executable authority, Pi SaaS 아님 | HIGH | RETAIN | [E220] [E221] [E222] |
| C18 — https://github.com/BurntSushi/ripgrep/releases/{latest,download/...} | third-party BurntSushi/ripgrep | Pi missing ripgrep bootstrap | 자동 interactive init/tool 사용: private bin/PATH 없을 때 | platform/arch release query + executable download | none | hosted 필요 없음: tool preinstall 가능 | offline/platform gate; moving latest (fd Darwin x64는 pinned); shared flow checksum 검증 발견 못함 | third-party executable authority, Pi SaaS 아님 | HIGH | RETAIN | [E223] [E221] [E222] |
| C19 — Google `https://dl.google.com/agy-extensions/releases/...` pinned Antigravity assets | third-party Google | T3 provider installation | 명시적 authorized providerInstallStart RPC | platform asset request; executable zip | public download; app RPC authorization | 선택적 provider | provider off; pinned version/SHA256/size | vendor executable, T3 product backend 아님 | HIGH | RETAIN | [E224] [E225] |
| C20 — `https://github.com/electron/electron/releases/download/v{version}/electron-...zip` | third-party Electron/GitHub | desktop runtime bootstrap | dev/build ensure:electron; local artifact missing/invalid 시 download | version/platform/arch; binary download | none | desktop runtime 필요; network는 cache/vendor 대체 가능 | installed package version 기반; root CI에서 명시적 실행 | generic toolchain executable | HIGH | RETAIN | [E226] [E227] |
| C21 — Node/apt/Playwright Chromium, crates.io, Maven/native SDK ecosystem | third-party toolchain/registry operators | build/dev/CI/mobile native | 해당 build/bootstrap command에서 자동 acquisition | dependency/version/platform requests; exact SDK CDN redirects UNKNOWN | runner/operator config | configured build 필요; installed core backend 아님 | Node/actions pinned; lockfiles 유지; root CI Chromium install | generic toolchain supply chain | HIGH | RETAIN | [E228] [E229] [E230] |
| C22 — SPDX `raw.githubusercontent.com/spdx/license-list-data/{revision}/json/details/{license}.json` | third-party SPDX content authority | license sync tooling | 명시적 sync; cached details 없고 allowMissing false일 때 | license ID/revision GET | none | 아니오 | revision-pinned/cacheable metadata | license data only | LOW | RETAIN | [E231] |
| C23 — `https://github.com/Effect-TS/effect.git`, `https://github.com/alchemy-run/alchemy-effect.git` reference imports | third-party reference repositories | manual reference-sync tool | 명시적 개발 source sync만; 이번 lane 실행 안 함 | git repo/ref/version metadata | operator Git auth | core runtime 아니오 | source tool retained; 자동 upstream sync 승인 아님 | reference content provenance; product backend 아님 | MEDIUM | DEFER | [E232] [E034] |
| C24 — configured Git extension sources, models.json/custom providers, MCP/tools/shell/HTTP proxy egress | local/user-selected/UNKNOWN | Pi package/extensions/model runtime; T3 tool integrations | configured unpinned Git startup ls-remote; explicit clone/update/tool/inference | repo/ref queries, code/context/credential/data는 실행된 integration에 의존 | Git/SSH agent, provider keys, custom headers, proxy config | 특정 외부 host 필수 아님 | offline/trust/missing-source gates는 경로별; 범용 network firewall 아님 | arbitrary configured authority; finite inventory 불가 | HIGH | RETAIN | [E233] [E234] [E235] [E236] |
| C25 — jsDelivr `https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4`, `.../chart.js@4.4.9/dist/chart.umd.min.js` | third-party CDN/package publishers | Pi scripts/tool-stats generated report | 명시적 report 생성 후 HTML browser open 시 자동 script load | asset GET/browser metadata; remote JS가 report context에서 실행 | none | 아니오 | developer report만; 일반 session HTML exporter는 vendored local scripts | generic script supply chain | MEDIUM | RETAIN | [E237] |

### 3.6. Build-time model catalog inputs

| Service | Owner | Used by | Trigger | Data sent | Authentication | Required | Default behavior | Product authority | Risk | Recommended action | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B01 — models.dev — `https://models.dev/api.json` | third-party models.dev | Pi model generate/hydrate | 명시적 source build/generate; root CI hydration/build; NVIDIA는 input 존재 조건 | public model metadata GET; session upload 아님 | none in fetch | installed runtime 아니오; online generation에는 필요 | build/generate path conditional; generated import 자체 network 아님 | build metadata supply chain; pi.dev runtime overlay P04와 별개 | MEDIUM | RETAIN | [E238] [E244] [E245] |
| B02 — OpenRouter catalog/images — `https://openrouter.ai/api/v1/models; ?output_modalities=image` | third-party OpenRouter catalog/images | Pi model generate/hydrate | 명시적 source build/generate; root CI hydration/build; NVIDIA는 input 존재 조건 | public model metadata GET; session upload 아님 | none in fetch | installed runtime 아니오; online generation에는 필요 | build/generate path conditional; generated import 자체 network 아님 | build metadata supply chain; pi.dev runtime overlay P04와 별개 | MEDIUM | RETAIN | [E239] [E240] [E244] [E245] |
| B03 — Vercel gateway catalog — `https://ai-gateway.vercel.sh/v1/models` | third-party Vercel gateway catalog | Pi model generate/hydrate | 명시적 source build/generate; root CI hydration/build; NVIDIA는 input 존재 조건 | public model metadata GET; session upload 아님 | none in fetch | installed runtime 아니오; online generation에는 필요 | build/generate path conditional; generated import 자체 network 아님 | build metadata supply chain; pi.dev runtime overlay P04와 별개 | MEDIUM | RETAIN | [E241] [E244] [E245] |
| B04 — NVIDIA model-ID catalog — `https://integrate.api.nvidia.com/v1/models` | third-party NVIDIA model-ID catalog | Pi model generate/hydrate | 명시적 source build/generate; root CI hydration/build; NVIDIA는 input 존재 조건 | public model metadata GET; session upload 아님 | none in fetch | installed runtime 아니오; online generation에는 필요 | build/generate path conditional; generated import 자체 network 아님 | build metadata supply chain; pi.dev runtime overlay P04와 별개 | MEDIUM | RETAIN | [E242] [E243] [E244] [E245] |

### 3.7. CI / publication / deployment authorities

| Service | Owner | Used by | Trigger | Data sent | Authentication | Required | Default behavior | Product authority | Risk | Recommended action | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| G01 — GitHub Actions / GitHub-hosted ubuntu·macOS runners | Weavra repository control; third-party GitHub | actual root CI | push main/devlop/migration; PR; workflow_dispatch | source checkout, build requests/logs/artifacts | contents:read; persist-credentials:false; root deploy secret reference 없음 | CI 필요; product runtime 아니오 | root active definition; nested workflows와 구분 | Weavra CI account/platform authority, upstream product 아님 | MEDIUM | RETAIN | [E246] [E247] [E248] |
| G02 — npm publication `@earendil-works/*`, `t3`, `@t3code/t3-<platform>` | Pi/T3-configured namespace; third-party npm | release publish scripts / nested workflows | 명시적 publishing; nested YAML root 자동 실행 안 함 | executable packages/provenance/version metadata | npm trusted publisher/OIDC or operator credentials | runtime registry C15와 별개 | 현재 Weavra publication/account rights NOT VERIFIED | YES: product namespace/trusted-publisher authority | HIGH | DEFER | [E249] [E250] [E251] |
| G03 — Apple signing/notarization + Azure trusted signing; `http://timestamp.acs.microsoft.com` | third-party Apple/Microsoft; developer accounts UNKNOWN | desktop release packaging | 명시적 signed release build; nested workflow 보존 | binary hashes/artifacts/developer identity | CSC/Apple API/provisioning, Azure tenant/client/certificate profile | signed distribution에는 필요; runtime auth 아님 | 실제 signing identities/rights NOT VERIFIED | YES: product executable signing identity | HIGH | DEFER | [E252] [E253] [E254] |
| G04 — secret-configured Cursor hygiene webhook `CURSOR_T3CODE_WEBHOOK_URL` / `_AUTH` | UNKNOWN; 이름만으로 vendor/tenant 소유 입증 불가 | nested workflow | 원본 정의는 push/PR/issues/discussions; root 자동 비활성; missing config skip | entire github event JSON + event/delivery headers | secret auth + configured arbitrary URL | 아니오 | nested 보존; effective URL 미열람 | product operations data sink | HIGH | DEFER | [E255] |
| G05 — AUR `ssh://aur@aur.archlinux.org/{pkgname}.git` | third-party AUR + package maintainer UNKNOWN | packaging publish | 명시적 release/manual nested workflow | PKGBUILD/SRCINFO packaging source | AUR_SSH_PRIVATE_KEY + pinned known host | 아니오 | source retained; current rights NOT VERIFIED | YES: package namespace publication | HIGH | DEFER | [E256] [E257] |
| G06 — Vercel deployment `VERCEL_TOKEN/ORG_ID/PROJECT_ID`; hosted app/nightly routing | third-party Vercel + project operator UNKNOWN | web preview/hosted app/marketing deployment | 명시적 deploy or nested workflow; root CI는 deploy 안 함 | built frontend/source/environment/artifacts | Vercel account token + project bindings | local core 아니오 | nested retained; actual deployment NOT VERIFIED | YES: hosted frontend publication; A14 model gateway와 별개 | HIGH | DEFER | [E258] [E259] [E260] |

### 3.8. Local / library comparison — service count 제외

| Service | Owner | Used by | Trigger | Data sent | Authentication | Required | Default behavior | Product authority | Risk | Recommended action | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| L01 — Pi general `enableAnalytics` / `trackingId` preference | local | settings / experimental first-time setup | 명시적 setup 설정 저장 | local UUID/preference; uploader consumer 발견 못함 | none | 아니오 | preference 기본 false; first-time setup 선택값과 upload P03은 별개 | 외부 authority 확인 안 됨 | LOW | DEFER | [E102] [E103] [E104] |
| L02 — Pi telemetry/harness context library | local 또는 caller-injected | pi-telemetry / agent / company runtime | local instrumentation; caller가 exporter 넣으면 그 설정 | local spans/request/model/token/cost attributes | none; injected exporter는 UNKNOWN | library는 사용; hosted dependency는 없음 | NOOP default; in-memory adapter 선택 가능 | Pi hosted authority 없음 | LOW | RETAIN | [E105] [E106] [E107] |
| L03 — local/direct environment authentication | local operator | web/mobile/desktop ↔ selected environment | startup pairing; 명시적 direct connection | pairing/session/access credentials | environment auth; reusable dev token은 web+devUrl+explicit token 조건 | 로컬 접근 제어에 필요; Clerk는 불필요 | no-cloud여도 ordinary app render; anonymous bypass 아님 | local access authority | LOW | RETAIN | [E108] [E109] [E110] |
| L04 — Clerk libraries / Electron IPC bridge (tenant와 별도) | third-party library + local | DesktopClerk / preload / managed auth shells | desktop bridge 구성은 unconditional; renderer tenant 초기화 T01은 gated | bridge storage/passkey/deep-link IPC; 이것만으로 HTTP upload 증거 아님 | local SDK storage; remote auth는 T01 | local core의 hosted Clerk 필요성 입증 안 됨 | bridge 포함 != T3 tenant 접속; SDK-internal traffic NOT VERIFIED | library 자체는 T3 tenant authority 아님 | LOW | RETAIN | [E111] [E112] [E113] |
| L05 — resource telemetry: native process monitor / Electron FD4·FD5 / authenticated RPC | local environment | server/desktop resource diagnostics | local monitor; live diagnostics는 subscribers에 따라 시작/종료 | process/group CPU·memory/power/timing/health/history; authorized remote UI 수신 가능 | environment RPC/session | 진단만; core inference에 필수 아님 | local plumbing; 해당 ResourceTelemetry modules에 vendor uploader 없음 | 외부 product analytics authority 없음 | LOW | RETAIN | [E114] [E115] [E116] |

## 4. Product authority matrix

| Authority | 소스에서 실제 통제하는 것 | 활성 조건 / Phase 1 판정 |
| --- | --- | --- |
| Pi `pi.dev` | latest version/packageName, managed install manifests, runtime model overlay, install reporting, Gist viewer | 일반 interactive/명시적 update/share 경로에 남음. P01–P04/P08 detach 필요. |
| Pi Radius | gateway identity/config/routing, session artifact storage, 실험 relay | P05/P06은 credential/명시적 동작 조건, P09는 source experimental 전용. 일반 provider API로 묶어 숨기면 안 됨. |
| T3 `pingdotgg/t3code` | CLI version index/archive, mutable runtime model manifest, agent triage playbook, acquisition links | T12/T14/T15/T16은 fixed upstream. Desktop T11은 build-selected이므로 별도 artifact 증거가 필요. |
| T3-configured Clerk + `app.t3.codes` + relay | account identity, authorization browser, environment discovery/link/token minting | T01–T03은 cloud config/credentials/persisted link에 조건부. local/direct core의 필수 서비스 아님. |
| inherited analytics project | Pi install reporting; T3 fixed PostHog project 및 account-derived identifier | P03/T08 기본 ON. Clerk/cloud 비활성으로 차단되지 않음. |
| Expo `pingdotgg` project | mobile executable JS updates/rollback | T13 source default ON_LOAD/ON. no-Clerk build도 별도 차단 필요. |
| Axiom dataset / external OTLP | configured span/error/diagnostic collection | T09는 full config 필요, T10은 operator endpoint 필요. local resource telemetry L05와 다름. |
| GitHub/npm/Cloudflare/Vercel/Apple 등 | 일반 infra인 동시에 지정 account/repo/bucket/certificate의 artifact/identity authority 제공 | vendor 이름 교체가 아니라 account/repo/project/namespace/signing binding의 소유권을 검증해야 함. |
| provider APIs / provider OAuth | inference, quota, billing, 해당 provider account grants | A/C provider integrations는 generic. O01–O05 registration 권한은 UNKNOWN; Pi/T3-owned라고 단정하지 않음. |
| local libraries / own environment | telemetry context, local credential/pairing, resource monitor | L02–L05 유지 가능. 라이브러리 이름만으로 hosted product authority가 생기지 않음. |

## 5. Network authority inventory — 언제 요청하는가

| Trigger | 확인된 경로 | 억제/예외/주의 |
| --- | --- | --- |
| 일반 interactive Weavra startup | P01 version; P03 fresh/update changelog reporting; P04 credential-gated catalog; C15/C24 configured extension metadata; C17/C18 missing tools | observer bridge startup과 다름. SDK cache-only 생성과 interactive refresh도 다름. |
| App server startup/운영 | T08 boot/event analytics; T14 provider manifest; C01 provider probes; configured C05 quota sources | driver enabled/installed/auth/version gates를 유지해서 판단. T14 실패한 settings read는 fetch를 막지 않음. |
| Desktop update | T11 packaged production+feed: 15초 후 첫 check, 4분 주기; channel/manual check | no-feed/preview/disable/platform gates. autoDownload와 autoInstallOnAppQuit는 false. |
| CLI/server update/install | P01/P02, T12 index/archive/checksum | 명시적 action. T12 download mirror만 바꾸면 upstream index는 남음. 서버 self-update는 desktop/boot-service 조건. |
| Mobile update | T13 native ON_LOAD + launch/foreground recheck; explicit manual path | Expo code delivery는 Clerk/relay/analytics와 독립적. 실제 EAS env/compiled artifact 미검증. |
| Auth initialization | T01 configured auth shell; P05/O-series explicit login 후 자동 token refresh 가능 | .env.example 자동 로드 아님. Desktop bridge SDK 초기화는 무조건적이지만 그 자체를 tenant HTTP라고 주장하지 않음. |
| Relay/cloud connection | T03 sign-in/discovery/link, persisted-link reconciliation; T04 managed tunnel; T06/T07 opted-in activity delivery | signed-out discovery는 idle; link state와 stored credentials도 확인해야 함. P09는 published startup path에서 제외. |
| Analytics/tracing upload | P03 install GET; T08 PostHog batch; T09 complete-config Axiom; T10 configured OTLP | 네 가지 gate는 서로 다름. 일반 analytics preference L01이나 local monitor L05로 일괄 설명 불가. |
| Session sharing | P06 `/share` Radius 우선; Radius provider/token 없을 때 P07 Gist; P08 viewer는 click | Radius failure는 Gist fallback 안 함. Radius는 current branch, Gist HTML은 whole tree. |
| UI auxiliary requests | C08 GitHub media, C10 Google favicons, C11 arbitrary media; T16 marketing page release fetch | render/load 자동 request와 단순 hyperlink click을 구별. public favicon 조회도 host disclosure. |
| Build/dev/release | B01–B04 metadata; C15/C19–C23/C25; P10/G02–G06/T17 | root CI의 package scripts는 활성. nested workflow의 schedule/deploy/upload는 root에서 자동 발견되지 않음. |

### Offline / cache 주의

`PI_OFFLINE`이나 `enableProviderUpdateChecks=false`는 network firewall이 아니다. Pi는 함수에 따라 truthy/presence 확인이 다르며, 명시적 `update --models`/`/llama`는 network를 요청하는 별도 경로다. provider inference, share, extensions/shell에도 각자의 gate가 있다. Pi `models-store.json`와 T3 `${stateDir}/model-manifest.json`은 이전 upstream 응답을 계속 적용할 수 있다. **새 요청 차단과 기존 authority-bearing cache의 검토/이관은 별개 acceptance criterion**이다. 사용자 데이터를 자동 삭제하라는 권고가 아니다.

## 6. Hosted auth 심층 판정

### Clerk tenant와 library

1. `.env.example`는 production identifiers임을 명시한다. `pk_live_Y2xlcmsudDMuY29kZXMk`가 나타내는 frontend는 `clerk.t3.codes`, JWT template은 `t3-relay`, CLI OAuth client는 `hzxSgY2cH10sDU2r`다. 이들은 **public identifiers이며 secrets가 아니다**. 복사해 쓸 수 있다는 것이 Weavra의 tenant 관리 권한을 뜻하지 않는다.
2. source config loader는 process env → `.env.local` → `.env` 순서다. `.env.example`를 자동 읽지 않는다. web은 publishable key + JWT template + secure relay URL이 있어야 managed auth shell을 가져온다. mobile wrapper는 key+relay가 없으면 children을 그대로 렌더링한다. mobile의 full-config/token gate는 template도 요구하므로 web과 guard를 동일하게 기술하면 안 된다.
3. 무설정 source build에 blanket “T3 auth 필수” 판정은 틀리다. 반대로 production public config가 주입된 release/source build를 “library만 포함되어 cloud-off”라고 해도 틀리다. configured ClerkProvider 초기화는 sign-in click 이전에도 시작할 수 있다.
4. Electron `createClerkBridge`/preload bridge, passkeys/local state/deep-link handling은 별도로 남는다. **SDK-internal 실제 네트워크는 NOT VERIFIED**. renderer cloud gate와 IPC library 포함 여부를 각각 확인한다.

### 로컬 development fallback과 auth 없는 범위

- Clerk가 없으면 ordinary AppRoot/children이 렌더링되고 direct environment/pairing 경로가 남는다. 일반 Weavra 로컬 기능을 위해 독립 Clerk tenant를 만들 필요는 없다.
- 이것은 **모든 authentication을 없애도 된다**는 뜻이 아니다. environment pairing/session/access authorization은 유지된다. reusable dev credential은 web mode + dev URL + explicit devAuthToken 조건이며, 설정된 token 길이 제약도 있다. 임의 개발 Clerk tenant나 hardcoded login bypass는 발견하지 못했다.
- managed cloud linking/discovery/account UI를 독립 제품으로 유지하려면 own identity tenant 또는 대체 auth backend가 필요하다. relay backend는 audience 검증/Clerk token verification을 하므로 frontend publishable key만 바꾸는 것으로 migration이 끝나지 않는다.

### silent production dependency와 migration 단위

- 실제 `.env`, CI variables/secrets, EAS env, signed binaries는 이번 감사에서 열람/실행하지 않았다. 해당 build의 cloud 활성 여부는 **UNKNOWN / NOT VERIFIED**다.
- 독립 tenant를 쓸 경우 frontend domain/key, OAuth app/client/redirects, JWT template/audience, backend secret, hosted `/connect`, relay URL/signing trust, native Google sign-in IDs, passkey RP/associated domains를 함께 검증한다.
- sign-out이나 UI 제거만으로 기존 environment desired-link/persisted token/tunnel trust가 없어지는 것은 아니다. 이전 tenant의 account/session을 Weavra가 소유한다고 가정하거나 자동 이전하지 않는다.
- Phase 1에 cloud를 보류하면 공개 sample/release inputs를 통해 upstream tenant를 조용히 재활성화하지 않는지 검증하고 local/direct 경로를 유지한다. backend 구축은 Phase 2로 분리할 수 있다.

Additional evidence: [E269] [E270] [E271] [E272] [E273].

### 다른 provider OAuth registrations

O01–O05와 Radius P05는 fixed client identities를 쓴다. provider API vendor가 외부라는 사실과 그 OAuth client를 Weavra가 관리/재사용할 권한이 있다는 주장은 다르다. admin/약관/redirect 승인 여부는 UNKNOWN이다. O06 OpenRouter에는 같은 fixed client-ID 패턴이 발견되지 않았고, O07 Antigravity는 vendor process가 URL/registration을 제공한다. 외부 account를 이 감사에서 만들거나 인증하지 않았다.

## 7. Telemetry와 session data 경계

- **P03:** version query + Pi/runtime/platform/arch UA. 이 함수에서 transcript/trackingId/body를 전송하지 않는다. 원격 수신 측 IP 보관/retention/익명성은 검증하지 않았다.
- **T08:** source의 “anonymous” 표현보다 구현이 우선한다. `~/.codex/auth.json`의 account_id, 없으면 `~/.claude.json` userID, 없으면 persisted anonymous ID를 hash한다. 따라서 반드시 installation-random ID라고 설명하면 안 된다. enabled=false도 service construction의 identifier resolution 자체를 건너뛰지는 않는다.
- T08 payload에는 event/time/identifier, platform/arch/WSL/server version/mode, client device/browser/connection fields, project/thread counts, provider/model/effort/usage token counts/approval/recovery metadata 등이 있다. 조사한 analytics callsites에서 raw prompt/attachment/transcript upload는 발견하지 못했지만, 그것을 모든 tracing/외부 CLI까지 확대하지 않는다. Additional evidence: [E276] [E277].
- **T09/T10:** spans/errors/logs는 message/stack/cause/operation attributes를 포함할 수 있다. exporter config와 data policy가 필요하다. PostHog disable flag만으로 이 수신처를 차단했다고 주장하지 않는다.
- **L01/L02/L05:** unused analytics preference, local/no-op/injected telemetry library, native process resource diagnostics를 각각 유지/보류할 수 있다. local instrumentation을 remote analytics와 혼동하지 않는다.
- **P06/P07/P08:** Radius는 current branch JSONL+system prompt/tool schema, Gist HTML은 entire session tree. secret gist의 base64는 암호화가 아니다. `visibility=organization`도 서버 ACL의 검증 증거는 아니다. viewer fragment는 초기 URL 로그에서 ID를 제외할 뿐 viewer JS의 데이터 접근을 막지 않는다. controlled viewer, chosen storage, payload disclosure, user consent를 분리해 결정한다.

## 8. Recommended closure groups

### Must detach before Product Independence Phase 1 closure

아래는 **현재 base의 callable/default product authority**에 대한 요구다. 이번 문서가 detach를 구현한 것은 아니다. 조건부 기능을 Phase 1에서 제공하지 않을 경우, 독립 대체 서비스 구축 대신 해당 upstream 경로가 비활성/비노출임을 증명할 수 있다.

| Group | 대상 | Integration acceptance |
| --- | --- | --- |
| M1 Release/install | P01/P02/P11, T12 | version index, remote-selected packageName, installer/lock/archive, user-facing release destination까지 owned/disabled. download mirror나 이름만 변경해서 완료 처리 금지. |
| M2 Product reporting | P03/T08 | 기본 upstream install reporting/PostHog 전송 제거 또는 비활성; inherited ingest identity/프로젝트 분리. cloud-off만으로 충족하지 않음. |
| M3 Runtime mutable catalogs | P04/T14 | upstream fetch와 cached overlay authority 모두 검토/이관. bundled/offline provider 사용은 유지. inference API 자체를 제거할 필요 없음. |
| M4 Gateway/share/viewer | P05/P06/P08 | upstream Radius credentials/gateway/artifact storage 및 pi.dev viewer를 독립 destination으로 교체하거나 기능 disable. P07 Gist는 별도 explicit product/privacy decision. |
| M5 Mobile executable updates | T13 | inherited Expo OTA disabled 또는 owned project/owner/URL/channel/runtime identity. Expo build/submit token 권한도 별도 검증. |
| M6 Configured auth/cloud/diagnostics | T01–T03/T09, 조건부 T11 | shipped build에 upstream Clerk/hosted app/relay/Axiom이 주입되거나 desktop feed가 upstream이면 반드시 detach. 무설정 source만 확인해서 release에도 적용됐다고 추정하지 않음. |
| M7 Enabled support/acquisition surfaces | T15/T16 | 배포하는 triage/marketing/download/store 경로는 upstream mutable playbook·제품으로 유도하지 않음. Phase 1 배포 제외라면 exclusion을 명시적으로 증명. |

### Safe to retain

- **A01–A29:** 사용자 credential의 model APIs. 민감 context/billing/network 정책은 여전히 필요하다. Pi/T3 backend로 분류하지 않는다.
- **O06, C01–C09, C12–C22, C24–C25, B01–B04, G01, T10:** generic provider/forge/Tailscale/user-configured quota·collector·registry/toolchain/metadata integrations. **조건부 유지**이며 below supply-chain/egress decisions와 충돌하지 않는다.
- **L02–L05:** local/no-op/injected telemetry, local auth/pairing, Clerk library/IPC 자체, resource monitor. local bridge/Runtime/Host/RegisteredVerifier/Kernel 권한 경계를 유지한다.
- C17/C18의 tool 선택은 retain할 수 있지만, controlled distribution에는 reviewed pinned/preinstalled binaries와 integrity policy를 권고한다. C15의 generic npm registry 유지와 G02의 upstream publication namespace 사용은 다른 결정이다.

### Disabled but retained code

- **P09:** normal published CLI에서 제외된 experimental Radius relay. 명시적 source experimental server에서는 활성화될 수 있으므로 “아무 경로에서도 실행 불가”가 아니다.
- **P10/G02–G06/T17:** nested release/catalog/relay/webhook/signing/deploy/publishing workflows는 Weavra root Actions에서 자동 발견되지 않는다. 관련 scripts를 직접 실행할 수 있으므로 자동 활성과 callable source를 구분한다.
- **L01:** preference/getter/UUID는 남으나 조사한 runtime source에서 general analytics uploader consumer를 발견하지 못했다. 실제 install reporting P03은 별개로 활성이다.
- **T01–T03/T09:** 필요한 config/credential이 없을 때만 dormant. **repository 전체가 영구 cloud-disabled라는 판정이 아니다.**

### Phase 2 migration

- **T01–T07/T09/G06:** 독립 identity/control plane/Worker/zone/tunnel/database/push/observability/hosted frontend 구축. Phase 1은 upstream 경로를 먼저 disable하거나 owned 상태를 증명한다.
- **P10/G02/G03/G05/T13 publication side:** R2 bucket, npm namespace/trusted publisher, signing certificate, AUR identity, own Expo EAS/build/store credentials. broad namespace/branding migration은 이 audit lane의 코드 변경 범위가 아니다. Mobile publishing evidence: [E274] [E275].
- **P12/P11/T16:** inherited attribution/branding/acquisition assets를 제품 정책에 맞게 교체. 단순 header 값 `https://pi.dev`는 Pi 서버 접속 증거가 아니다.
- **P09/C23/L01:** 실험 relay 채택 여부, manual reference import 정책, 미사용 analytics UX 정리. 자동 upstream sync는 권고하지 않으며 기존 금지 정책을 유지한다.

### Unknown / requires explicit product decision

| ID | UNKNOWN / decision | 필요한 증거/결정 |
| --- | --- | --- |
| U1 | 각 host/tenant/project/account의 법적 소유권·실제 관리자·재사용 권한 | authorized product owner의 dashboard/계약/registration 검증. source literal만으로 대체 불가. |
| U2 | O01–O05/P05/O07 OAuth registration 재사용 | vendor 승인/지원 auth 방식 또는 독립 registration. 임의 client ID 생성은 해결책 아님. |
| U3 | T11 실제 shipped app-update.yml, T01–T03/T09/T13 compiled public config/EAS env | clean artifact inspect와 effective config evidence. upstream이면 M5/M6 blocker. |
| U4 | P07 외부 Gist fallback 유지, P06 ACL/retention, P08 viewer 처리 | 사용자 선택·정확한 whole-tree disclosure·access/retention policy. hosted viewer/server 구현 미검증. |
| U5 | P02 실제 pi.dev/install.sh 및 pi.dev ↔ R2 serving 구현 | 이번 tree에서 installer server/script 구현을 찾지 못했으며 live fetch 안 함. 안전하다고 추정 금지. |
| U6 | C10 Google favicon 및 C11 remote media의 incidental egress 허용 | 로컬 아이콘/explicit gate 또는 허용 정책. no-incidental-egress profile이면 C10 교체 권고. |
| U7 | C12/B01–B04 mutable third-party metadata, C17/C18 latest binary bootstrap 허용 | pin/snapshot/cache/integrity/provenance 정책. upstream product backend와 일반 supply chain 위험을 분리. |
| U8 | C01/C21/C24 external SDK/CLI/proxy/extensions/MCP/Tailscale의 실제 network/auth/telemetry | 각 배포에서 selected tools/config/captures로 별도 확인. 전이적 endpoints 전부를 source audit가 증명하지 않음. |
| U9 | server-side 데이터 retention/redaction/access, 원격 서비스 availability | 이 감사는 service에 로그인/전송하지 않음. UNKNOWN을 no-data/no-network/no-risk로 바꾸지 않음. |
| U10 | inherited nested release/webhook/deployment secret의 현재 존재와 account 권리 | source에는 secret names만 있음. current deployment/publishing이 존재한다고 가정하지 않음. |

## 9. Recommended Integration checks

이하 항목은 **향후 Integration acceptance**이며 이 documentation-only lane에서 실행한 결과가 아니다.

1. **Cross-lane evidence:** 이 audit SHA의 ID별 source fact와 실제 merge된 Runtime/App commit을 대조한다. 다른 lane의 주장/branch 이름을 이 문서의 기존 사실로 소급하지 않는다.
2. **Entrypoints:** fresh home의 일반 interactive `weavra`, configured home 재시작, read-only bridge, explicit control, App server/web/desktop/mobile를 각각 구분해 확인한다. browser/Jev는 observation-only, candidate는 CANDIDATE_ONLY, fresh RegisteredVerifier capture와 Kernel completion 경계를 바꾸지 않는다.
3. **Startup egress:** 기본·cloud-off·offline profile에서 release/catalog/install-report/PostHog/Axiom/Clerk/relay 요청을 구분해 captures로 확인한다. 필수 model/provider request는 별도 허용 목록과 user credential로 검증한다. audit 중 사용자의 실제 credential을 재사용해 검증한 것으로 기록하지 않는다.
4. **Catalog migration:** P04/T14의 cold cache와 old upstream cache 각각에서 upstream fetch/metadata authority 제거를 확인한다. T14 settings load failure도 포함한다. 사용자 session/cache를 무단 삭제하지 않는다.
5. **Release integrity:** P01/P02/T12의 index+artifact+installer+packageName+checksum/signing chain을 한 단위로 확인한다. T11 packaged feed와 preview/no-feed/platform gates, explicit download/install 동작을 검증한다. shell installer redirect도 포함한다.
6. **Mobile OTA:** native manifest와 JS config에서 Expo project/owner/URL, ON_LOAD/foreground paths, disabled behavior, channel/runtime/fingerprint, rollback/update install policy를 확인한다. Clerk off와 별도 체크한다.
7. **Hosted auth:** no config, own config, inherited config rejection/exclusion, signed-out, signed-in, expired credential, stored desired link의 cases를 구분한다. local pairing/direct 연결이 보존되는지 확인한다. own tenant 미도입이면 cloud-disabled release를 입증한다.
8. **Sharing:** explicit destination 선택, Radius vs Gist payload scope, system prompt/tool schemas, failure/cancel fallback, user consent, viewer host/ACL/retention을 확인한다. session 공개는 실제 사용자 자료가 아닌 승인된 fixture로만 검증한다.
9. **Telemetry:** install reporting, PostHog event upload 및 identifier derivation, Axiom, generic OTLP, provider attribution/OpenCode session header, local resource monitor를 각각 검증한다. no remote analytics라는 주장을 local telemetry 제거로 대신하지 않는다.
10. **Ancillary network:** missing fd/rg, extension install/update, provider health/quota/update advisory, LiteLLM/build metadata, favicon/media, Tailscale exposure, arbitrary configured endpoint를 분리한다. capture 없이 완전 오프라인 보장으로 확대하지 않는다.
11. **Publishing gates:** root workflow만 active인지 확인하고 nested workflows를 무심코 승격하지 않는다. own repo/namespace/bucket/signing/EAS/store/Clerk/relay/webhook 권한 없이는 배포 금지. 역사 source repository의 rename/transfer/archive/sync 금지 유지.
12. **Closure evidence:** accepted RETAIN 정책, explicit unknown decisions, disabled features, Phase 2 backlog와 실제 source/artifact/network proof를 ID별로 연결한 뒤에만 Phase 1 closure를 판단한다. 이 audit PR의 merge나 CI green만으로 Product Independence CLOSED라고 기록하지 않는다.

## 10. Coverage / negative findings / lane validation

- Pi coding-agent/AI/telemetry/agent/company-runtime/server/client source, package/installer/release/catalog scripts, T3 web/desktop/server/mobile/marketing/packages/relay infra, root scripts/CI 및 nested operational definitions를 조사했다. production caller와 examples/test fixture/docs-only literal을 분리했다.
- targeted first-party searches에서 별도 non-Clerk hosted application-auth implementation (Auth0/Supabase/Cognito/Keycloak/Okta 등)을 찾지 못했다. Firebase messaging은 push 증거이며 Firebase Auth의 증거가 아니다. provider OAuth와 external SDK auth는 별도다.
- targeted web/mobile/desktop/marketing searches에서 별도 Sentry/Amplitude/Segment/Mixpanel/Plausible/Google Analytics/Vercel analytics integration을 찾지 못했다. **server PostHog와 Axiom/OTLP는 실제로 존재**하므로 “analytics 없음”이 아니다.
- Pi general analytics getter/trackingId에는 관찰된 uploader consumer가 없고 pi-telemetry는 local/no-op/injected다. 실제 default-on install reporting을 이 음성 결과로 부정하지 않는다.
- 일반 Pi HTML exporter는 local vendored marked/highlight를 사용한다. developer tool-stats report의 jsDelivr C25는 별도다. `t3.codes/schema/t3.json`, theme schema, source provenance/docs/issues/Discord/social hyperlinks와 CSP allowlist만으로 app runtime HTTP 요청을 단정하지 않았다. editor/user click/SDK-internal activity는 별도일 수 있다.
- live host reachability, tenant dashboard, 원격 서버 구현, effective .env/secret/credential files, installed binaries/CI environment의 실제 outgoing requests는 **UNKNOWN / NOT VERIFIED**다.

### 이 lane의 검증 범위

문서의 audit-SHA source links와 line ranges를 local fixed-base source에 대조하고, matrix 필드/ID/reference 완전성 및 `git diff --check`를 검증한다. diff allowlist는 이 문서 하나다. commit/push 후 worktree clean, branch tracking/local/remote SHA 및 PR state/checks를 제출 보고에 기록한다. source code 변경은 0이어야 한다.

local Runtime/App full suite, npm/pnpm 설치, product 실행, 외부 auth/share/telemetry 호출은 이 documentation-only lane의 검증으로 수행하지 않는다. 기존 root PR CI가 자동 실행되는 것은 변경 없이 관찰하며 실패를 우회하거나 이 lane에서 source를 수정하지 않는다. CI/PR 상태는 가변 정보이므로 audit facts와 분리해 PR 및 최종 제출 보고에 기록한다.

## 11. Evidence index

아래 링크는 모두 audit SHA 고정이다. source path의 case와 line 범위를 검증 대상으로 삼는다.

| Evidence | Source at audit SHA |
| --- | --- |
| E001 | [`runtime/pi/packages/coding-agent/src/utils/version-check.ts:5-107`][E001] |
| E002 | [`runtime/pi/packages/coding-agent/src/modes/interactive/interactive-mode.ts:1034-1064`][E002] |
| E003 | [`runtime/pi/packages/coding-agent/src/package-manager-cli.ts:662-689`][E003] |
| E004 | [`runtime/pi/packages/coding-agent/src/package-manager-cli.ts:50-99`][E004] |
| E005 | [`runtime/pi/packages/coding-agent/src/package-manager-cli.ts:171-220`][E005] |
| E006 | [`runtime/pi/packages/coding-agent/README.md:63-75`][E006] |
| E007 | [`runtime/pi/packages/coding-agent/src/modes/interactive/interactive-mode.ts:1212-1257`][E007] |
| E008 | [`runtime/pi/packages/coding-agent/src/core/settings-manager.ts:1055-1081`][E008] |
| E009 | [`runtime/pi/packages/coding-agent/src/core/telemetry.ts:1-13`][E009] |
| E010 | [`runtime/pi/packages/coding-agent/src/core/remote-catalog-provider.ts:6-134`][E010] |
| E011 | [`runtime/pi/packages/coding-agent/src/core/model-runtime.ts:169-214`][E011] |
| E012 | [`runtime/pi/packages/ai/src/models.ts:391-479`][E012] |
| E013 | [`runtime/pi/packages/coding-agent/src/package-manager-cli.ts:583-597`][E013] |
| E014 | [`runtime/pi/packages/ai/src/providers/radius-config.ts:4-95`][E014] |
| E015 | [`runtime/pi/packages/ai/src/auth/oauth/radius.ts:26-65`][E015] |
| E016 | [`runtime/pi/packages/ai/src/providers/radius.ts:19-78`][E016] |
| E017 | [`runtime/pi/packages/coding-agent/src/modes/interactive/session-share.ts:24-146`][E017] |
| E018 | [`runtime/pi/packages/coding-agent/src/core/session-export.ts:7-41`][E018] |
| E019 | [`runtime/pi/packages/coding-agent/src/modes/interactive/session-share.ts:45-84`][E019] |
| E020 | [`runtime/pi/packages/coding-agent/src/modes/interactive/session-share.ts:148-194`][E020] |
| E021 | [`runtime/pi/packages/coding-agent/src/core/export-html/index.ts:242-284`][E021] |
| E022 | [`runtime/pi/.github/workflows/issue-analysis.yml:539-578`][E022] |
| E023 | [`runtime/pi/packages/coding-agent/src/config.ts:515-521`][E023] |
| E024 | [`runtime/pi/packages/coding-agent/src/modes/interactive/session-share.ts:184-192`][E024] |
| E025 | [`runtime/pi/.github/workflows/issue-analysis.yml:565-569`][E025] |
| E026 | [`runtime/pi/packages/coding-agent/src/cli.ts:1-6`][E026] |
| E027 | [`runtime/pi/packages/coding-agent/src/experimental/cli.ts:1-12`][E027] |
| E028 | [`runtime/pi/packages/coding-agent/package.json:29-33`][E028] |
| E029 | [`runtime/pi/packages/coding-agent/src/experimental/radius-relay.ts:121-171`][E029] |
| E030 | [`runtime/pi/packages/coding-agent/src/experimental/radius-auth.ts:8-63`][E030] |
| E031 | [`runtime/pi/.github/workflows/publish-model-catalog.yml:73-146`][E031] |
| E032 | [`runtime/pi/.github/workflows/build-binaries.yml:350-418`][E032] |
| E033 | [`runtime/pi/scripts/publish-release-announcement.mjs:271-379`][E033] |
| E034 | [`docs/architecture/BOUNDARIES.md:33-35`][E034] |
| E035 | [`runtime/pi/packages/coding-agent/src/config.ts:333-348`][E035] |
| E036 | [`runtime/pi/packages/coding-agent/src/utils/changelog.ts:69-100`][E036] |
| E037 | [`runtime/pi/.github/workflows/build-binaries.yml:204-213`][E037] |
| E038 | [`runtime/pi/packages/coding-agent/src/core/provider-attribution.ts:5-95`][E038] |
| E039 | [`runtime/pi/packages/coding-agent/src/core/sdk.ts:314-341`][E039] |
| E040 | [`app/t3code/.env.example:1-26`][E040] |
| E041 | [`app/t3code/scripts/lib/public-config.ts:26-65`][E041] |
| E042 | [`app/t3code/apps/web/src/main.tsx:41-76`][E042] |
| E043 | [`app/t3code/apps/mobile/src/features/cloud/CloudAuthProvider.tsx:198-218`][E043] |
| E044 | [`app/t3code/apps/desktop/src/app/DesktopClerk.ts:69-153`][E044] |
| E045 | [`app/t3code/packages/shared/src/connectAuth.ts:10-59`][E045] |
| E046 | [`app/t3code/apps/server/src/cloud/CliTokenManager.ts:459-501`][E046] |
| E047 | [`app/t3code/apps/server/src/cloud/publicConfig.ts:106-153`][E047] |
| E048 | [`app/t3code/apps/server/src/server.ts:712-750`][E048] |
| E049 | [`app/t3code/packages/client-runtime/src/relay/discovery.ts:206-263`][E049] |
| E050 | [`app/t3code/packages/client-runtime/src/relay/discovery.ts:315-347`][E050] |
| E051 | [`app/t3code/apps/web/src/cloud/publicConfig.ts:40-75`][E051] |
| E052 | [`app/t3code/infra/relay/.env.example:1-17`][E052] |
| E053 | [`app/t3code/infra/relay/src/worker.ts:115-121`][E053] |
| E054 | [`app/t3code/infra/relay/src/environments/ManagedEndpointProvider.ts:286-300`][E054] |
| E055 | [`app/t3code/infra/relay/src/db.ts:38-85`][E055] |
| E056 | [`app/t3code/infra/relay/migrations/postgres/20260527044716_baseline/migration.sql:1-98`][E056] |
| E057 | [`app/t3code/infra/relay/src/agentActivity/ApnsClient.ts:234-243`][E057] |
| E058 | [`app/t3code/infra/relay/src/worker.ts:145-163`][E058] |
| E059 | [`app/t3code/packages/contracts/src/relay.ts:122-145`][E059] |
| E060 | [`app/t3code/apps/server/src/relay/AgentAwarenessRelay.ts:314-359`][E060] |
| E061 | [`app/t3code/infra/relay/src/agentActivity/FcmClient.ts:87-140`][E061] |
| E062 | [`app/t3code/infra/relay/src/worker.ts:155-163`][E062] |
| E063 | [`app/t3code/apps/server/src/telemetry/AnalyticsService.ts:32-206`][E063] |
| E064 | [`app/t3code/apps/server/src/telemetry/Identify.ts:149-213`][E064] |
| E065 | [`app/t3code/apps/server/src/telemetry/Identify.ts:250-303`][E065] |
| E066 | [`app/t3code/apps/server/src/serverRuntimeStartup.ts:172-175`][E066] |
| E067 | [`app/t3code/apps/server/src/server.ts:560-561`][E067] |
| E068 | [`app/t3code/packages/shared/src/relayTracing.ts:44-156`][E068] |
| E069 | [`app/t3code/apps/mobile/app.config.ts:451-454`][E069] |
| E070 | [`app/t3code/apps/web/src/cloud/publicConfig.ts:61-69`][E070] |
| E071 | [`app/t3code/infra/relay/src/observability.ts:29-73`][E071] |
| E072 | [`app/t3code/apps/server/src/config.ts:212-218`][E072] |
| E073 | [`app/t3code/apps/server/src/observability/Layers/Observability.ts:49-83`][E073] |
| E074 | [`app/t3code/apps/server/src/http.ts:317-359`][E074] |
| E075 | [`app/t3code/apps/desktop/src/app/DesktopObservability.ts:587-672`][E075] |
| E076 | [`app/t3code/scripts/build-desktop-artifact.ts:2537-2576`][E076] |
| E077 | [`app/t3code/apps/desktop/src/updates/DesktopUpdates.ts:250-267`][E077] |
| E078 | [`app/t3code/apps/desktop/src/updates/DesktopUpdates.ts:660-687`][E078] |
| E079 | [`app/t3code/apps/desktop/src/updates/DesktopUpdates.ts:864-926`][E079] |
| E080 | [`app/t3code/packages/shared/src/cliRelease.ts:8-102`][E080] |
| E081 | [`app/t3code/apps/server/src/cli/update.ts:64-102`][E081] |
| E082 | [`app/t3code/apps/server/src/cloud/pinnedRuntime.ts:195-230`][E082] |
| E083 | [`app/t3code/apps/server/src/cloud/selfUpdate.ts:180-200`][E083] |
| E084 | [`app/t3code/scripts/install.sh:156-160`][E084] |
| E085 | [`app/t3code/apps/mobile/app.config.ts:227-232`][E085] |
| E086 | [`app/t3code/apps/mobile/app.config.ts:456-460`][E086] |
| E087 | [`app/t3code/apps/mobile/src/features/updates/app-updates.ts:127-153`][E087] |
| E088 | [`app/t3code/apps/mobile/src/features/updates/app-updates.ts:560-622`][E088] |
| E089 | [`app/t3code/apps/server/src/provider/ModelManifest.ts:39-49`][E089] |
| E090 | [`app/t3code/apps/server/src/provider/ModelManifest.ts:335-416`][E090] |
| E091 | [`app/t3code/packages/contracts/src/settings.ts:1064`][E091] |
| E092 | [`app/t3code/apps/server/src/provider/Drivers/CodexDriver.ts:196-205`][E092] |
| E093 | [`app/t3code/apps/server/src/cli/triagePrompt.ts:39-51`][E093] |
| E094 | [`app/t3code/apps/server/src/cli/triagePrompt.ts:94-126`][E094] |
| E095 | [`app/t3code/apps/server/src/cli/triage.ts:215-218`][E095] |
| E096 | [`app/t3code/apps/marketing/src/lib/releases.ts:1-54`][E096] |
| E097 | [`app/t3code/apps/marketing/src/pages/download.astro:134-218`][E097] |
| E098 | [`app/t3code/apps/marketing/src/lib/site.ts:1-7`][E098] |
| E099 | [`app/t3code/scripts/notify-discord-release.ts:120-151`][E099] |
| E100 | [`app/t3code/scripts/notify-discord-release.ts:183-185`][E100] |
| E101 | [`app/t3code/.github/workflows/release.yml:1170-1190`][E101] |
| E102 | [`runtime/pi/packages/coding-agent/src/core/settings-manager.ts:1065-1081`][E102] |
| E103 | [`runtime/pi/packages/coding-agent/src/cli/startup-ui.ts:122-141`][E103] |
| E104 | [`runtime/pi/packages/coding-agent/src/modes/interactive/components/first-time-setup.ts:24-35`][E104] |
| E105 | [`runtime/pi/packages/telemetry/src/noop.ts:1-20`][E105] |
| E106 | [`runtime/pi/packages/telemetry/src/memory.ts:192-196`][E106] |
| E107 | [`runtime/pi/packages/agent/src/harness/context.ts:27-36`][E107] |
| E108 | [`app/t3code/apps/web/src/main.tsx:70-76`][E108] |
| E109 | [`app/t3code/apps/server/src/auth/EnvironmentAuth.ts:990-1013`][E109] |
| E110 | [`app/t3code/apps/server/src/auth/ReusableDevAuth.ts:12-30`][E110] |
| E111 | [`app/t3code/apps/desktop/src/app/DesktopClerk.ts:75-153`][E111] |
| E112 | [`app/t3code/apps/desktop/src/preload.ts:8-30`][E112] |
| E113 | [`app/t3code/apps/web/src/main.tsx:43-52`][E113] |
| E114 | [`app/t3code/apps/server/src/resourceTelemetry/ResourceTelemetry.ts:285-445`][E114] |
| E115 | [`app/t3code/apps/server/src/ws.ts:2597-2613`][E115] |
| E116 | [`app/t3code/apps/desktop/src/backend/DesktopBackendConfiguration.ts:538-543`][E116] |
| E117 | [`runtime/pi/packages/ai/src/providers/anthropic.ts:10-54`][E117] |
| E118 | [`runtime/pi/packages/ai/src/providers/openai.ts:6-14`][E118] |
| E119 | [`runtime/pi/packages/ai/src/providers/openai-codex.ts:8-20`][E119] |
| E120 | [`runtime/pi/packages/ai/src/api/openai-codex-responses.ts:637-649`][E120] |
| E121 | [`runtime/pi/packages/ai/src/providers/azure-openai-responses.ts:6-12`][E121] |
| E122 | [`runtime/pi/packages/ai/src/api/azure-openai-responses.ts:217-272`][E122] |
| E123 | [`runtime/pi/packages/ai/src/providers/amazon-bedrock.ts:11-86`][E123] |
| E124 | [`runtime/pi/packages/ai/src/api/bedrock-converse-stream.ts:154-207`][E124] |
| E125 | [`runtime/pi/packages/ai/src/providers/google.ts:6-14`][E125] |
| E126 | [`runtime/pi/packages/ai/src/providers/google-vertex.ts:13-98`][E126] |
| E127 | [`runtime/pi/packages/ai/src/api/google-vertex.ts:385-416`][E127] |
| E128 | [`runtime/pi/packages/ai/src/providers/github-copilot.ts:10-23`][E128] |
| E129 | [`runtime/pi/packages/ai/src/providers/xai.ts:8-20`][E129] |
| E130 | [`runtime/pi/packages/ai/src/providers/kimi-coding.ts:8-20`][E130] |
| E131 | [`runtime/pi/packages/ai/src/providers/moonshotai.ts:6-14`][E131] |
| E132 | [`runtime/pi/packages/ai/src/providers/moonshotai-cn.ts:6-14`][E132] |
| E133 | [`runtime/pi/packages/ai/src/providers/openrouter.ts:9-20`][E133] |
| E134 | [`runtime/pi/packages/ai/src/providers/cloudflare-workers-ai.ts:8-14`][E134] |
| E135 | [`runtime/pi/packages/ai/src/api/cloudflare.ts:1-15`][E135] |
| E136 | [`runtime/pi/packages/ai/src/providers/cloudflare-auth.ts:75-100`][E136] |
| E137 | [`runtime/pi/packages/ai/src/api/cloudflare-ai-binding.ts:60-89`][E137] |
| E138 | [`runtime/pi/packages/ai/src/providers/vercel-ai-gateway.ts:6-14`][E138] |
| E139 | [`runtime/pi/packages/ai/src/providers/opencode.ts:13-22`][E139] |
| E140 | [`runtime/pi/packages/ai/src/providers/opencode-go.ts:10-19`][E140] |
| E141 | [`runtime/pi/packages/ai/src/providers/huggingface.ts:6-14`][E141] |
| E142 | [`runtime/pi/packages/ai/src/providers/deepseek.ts:6-14`][E142] |
| E143 | [`runtime/pi/packages/ai/src/providers/mistral.ts:6-14`][E143] |
| E144 | [`runtime/pi/packages/ai/src/providers/minimax.ts:6-14`][E144] |
| E145 | [`runtime/pi/packages/ai/src/providers/minimax-cn.ts:6-14`][E145] |
| E146 | [`runtime/pi/packages/ai/src/providers/qwen-token-plan.ts:6-14`][E146] |
| E147 | [`runtime/pi/packages/ai/src/providers/qwen-token-plan-cn.ts:6-14`][E147] |
| E148 | [`runtime/pi/packages/ai/src/providers/xiaomi.ts:6-14`][E148] |
| E149 | [`runtime/pi/packages/ai/src/providers/xiaomi-token-plan-ams.ts:6-14`][E149] |
| E150 | [`runtime/pi/packages/ai/src/providers/xiaomi-token-plan-cn.ts:6-14`][E150] |
| E151 | [`runtime/pi/packages/ai/src/providers/xiaomi-token-plan-sgp.ts:6-14`][E151] |
| E152 | [`runtime/pi/packages/ai/src/providers/zai.ts:6-14`][E152] |
| E153 | [`runtime/pi/packages/ai/src/providers/zai-coding-cn.ts:6-14`][E153] |
| E154 | [`runtime/pi/packages/ai/src/providers/ant-ling.ts:6-14`][E154] |
| E155 | [`runtime/pi/packages/ai/src/providers/baseten.ts:6-14`][E155] |
| E156 | [`runtime/pi/packages/ai/src/providers/cerebras.ts:6-14`][E156] |
| E157 | [`runtime/pi/packages/ai/src/providers/fireworks.ts:8-18`][E157] |
| E158 | [`runtime/pi/packages/ai/src/providers/groq.ts:6-14`][E158] |
| E159 | [`runtime/pi/packages/ai/src/providers/nvidia.ts:6-14`][E159] |
| E160 | [`runtime/pi/packages/ai/src/providers/together.ts:6-14`][E160] |
| E161 | [`runtime/pi/packages/ai/src/auth/oauth/anthropic.ts:28-37`][E161] |
| E162 | [`runtime/pi/packages/ai/src/auth/oauth/anthropic.ts:318-359`][E162] |
| E163 | [`runtime/pi/packages/ai/src/auth/oauth/openai-codex.ts:26-39`][E163] |
| E164 | [`runtime/pi/packages/ai/src/auth/oauth/openai-codex.ts:153-197`][E164] |
| E165 | [`runtime/pi/packages/ai/src/auth/oauth/github-copilot.ts:10-17`][E165] |
| E166 | [`runtime/pi/packages/ai/src/auth/oauth/github-copilot.ts:44-86`][E166] |
| E167 | [`runtime/pi/packages/ai/src/auth/oauth/github-copilot.ts:210-218`][E167] |
| E168 | [`runtime/pi/packages/ai/src/auth/oauth/kimi-coding.ts:14-38`][E168] |
| E169 | [`runtime/pi/packages/ai/src/auth/oauth/kimi-coding.ts:214-237`][E169] |
| E170 | [`runtime/pi/packages/ai/src/auth/oauth/xai.ts:8-11`][E170] |
| E171 | [`runtime/pi/packages/ai/src/auth/oauth/xai.ts:145-175`][E171] |
| E172 | [`runtime/pi/packages/ai/src/auth/oauth/xai.ts:213-237`][E172] |
| E173 | [`runtime/pi/packages/ai/src/auth/oauth/openrouter.ts:20-26`][E173] |
| E174 | [`runtime/pi/packages/ai/src/auth/oauth/openrouter.ts:301-308`][E174] |
| E175 | [`app/t3code/apps/server/src/provider/AntigravityAuth.ts:266-298`][E175] |
| E176 | [`app/t3code/apps/server/src/provider/antigravityCallback.ts:54-59`][E176] |
| E177 | [`app/t3code/packages/contracts/src/settings.ts:758-762`][E177] |
| E178 | [`app/t3code/apps/server/src/provider/Layers/CodexProvider.ts:362-445`][E178] |
| E179 | [`app/t3code/apps/server/src/provider/Layers/OpenCodeProvider.ts:498-520`][E179] |
| E180 | [`app/t3code/apps/server/src/provider/makeManagedServerProvider.ts:126-179`][E180] |
| E181 | [`app/t3code/packages/contracts/src/settings.ts:563-568`][E181] |
| E182 | [`app/t3code/packages/contracts/src/settings.ts:622-626`][E182] |
| E183 | [`app/t3code/apps/server/src/provider/Layers/cursorUsageLimits.ts:73-123`][E183] |
| E184 | [`app/t3code/apps/server/src/provider/Drivers/CursorDriver.ts:140-148`][E184] |
| E185 | [`app/t3code/apps/server/src/provider/Layers/grokUsageLimits.ts:61-130`][E185] |
| E186 | [`app/t3code/apps/server/src/provider/Layers/openCodeUsageLimits.ts:30-69`][E186] |
| E187 | [`app/t3code/apps/server/src/usage/UsageLimitSources.ts:74-170`][E187] |
| E188 | [`app/t3code/apps/server/src/usage/cliproxyApi.ts:118-171`][E188] |
| E189 | [`app/t3code/apps/server/src/usage/cliproxyApi.ts:313-345`][E189] |
| E190 | [`app/t3code/packages/contracts/src/settings.ts:1234-1236`][E190] |
| E191 | [`app/t3code/apps/server/src/sourceControl/GitHubSourceControlProvider.ts:109-162`][E191] |
| E192 | [`app/t3code/apps/server/src/sourceControl/GitHubCli.ts:413-453`][E192] |
| E193 | [`app/t3code/packages/shared/src/sourceControl.ts:183-265`][E193] |
| E194 | [`app/t3code/apps/server/src/sourceControl/SourceControlProviderRegistry.ts:13-24`][E194] |
| E195 | [`app/t3code/apps/server/src/assets/GitHubMediaFetch.ts:18-42`][E195] |
| E196 | [`app/t3code/apps/server/src/assets/GitHubMediaFetch.ts:115-157`][E196] |
| E197 | [`app/t3code/packages/shared/src/favicon.ts:19-26`][E197] |
| E198 | [`app/t3code/packages/tailscale/src/tailscale.ts:217-285`][E198] |
| E199 | [`app/t3code/packages/tailscale/src/tailscale.ts:341-381`][E199] |
| E200 | [`app/t3code/apps/server/src/cli/config.ts:68-77`][E200] |
| E201 | [`app/t3code/packages/shared/src/favicon.ts:85-96`][E201] |
| E202 | [`app/t3code/apps/web/src/components/ChatMarkdown.tsx:1247-1281`][E202] |
| E203 | [`app/t3code/packages/shared/src/favicon.ts:8-15`][E203] |
| E204 | [`app/t3code/packages/shared/src/favicon.ts:42-80`][E204] |
| E205 | [`app/t3code/apps/server/src/mcp/toolkits/preview/tools.ts:80-84`][E205] |
| E206 | [`app/t3code/apps/server/src/usage/UsageService.ts:66-73`][E206] |
| E207 | [`app/t3code/apps/server/src/usage/UsageService.ts:162-236`][E207] |
| E208 | [`app/t3code/apps/server/src/usage/UsageService.ts:538-542`][E208] |
| E209 | [`runtime/pi/packages/coding-agent/src/extensions/llama/huggingface.ts:46-120`][E209] |
| E210 | [`runtime/pi/packages/coding-agent/src/extensions/llama/client.ts:299-321`][E210] |
| E211 | [`runtime/pi/packages/coding-agent/src/extensions/llama/provider.ts:13-25`][E211] |
| E212 | [`runtime/pi/packages/coding-agent/src/extensions/llama/provider.ts:95-175`][E212] |
| E213 | [`runtime/pi/packages/coding-agent/src/extensions/llama/index.ts:29-57`][E213] |
| E214 | [`.github/workflows/ci.yml:33-37`][E214] |
| E215 | [`.github/workflows/ci.yml:66-71`][E215] |
| E216 | [`runtime/pi/packages/coding-agent/src/core/package-manager.ts:1186-1305`][E216] |
| E217 | [`runtime/pi/packages/coding-agent/src/core/package-manager.ts:1773-1812`][E217] |
| E218 | [`app/t3code/apps/server/src/provider/providerMaintenance.ts:407-470`][E218] |
| E219 | [`app/t3code/apps/server/src/provider/providerMaintenance.ts:635-723`][E219] |
| E220 | [`runtime/pi/packages/coding-agent/src/utils/tools-manager.ts:29-49`][E220] |
| E221 | [`runtime/pi/packages/coding-agent/src/utils/tools-manager.ts:257-330`][E221] |
| E222 | [`runtime/pi/packages/coding-agent/src/modes/interactive/interactive-mode.ts:976-980`][E222] |
| E223 | [`runtime/pi/packages/coding-agent/src/utils/tools-manager.ts:50-69`][E223] |
| E224 | [`app/t3code/apps/server/src/provider/antigravityRelease.ts:18-72`][E224] |
| E225 | [`app/t3code/apps/server/src/ws.ts:2458-2461`][E225] |
| E226 | [`app/t3code/apps/desktop/scripts/ensure-electron-runtime.mjs:119-159`][E226] |
| E227 | [`.github/workflows/ci.yml:70-71`][E227] |
| E228 | [`.github/workflows/ci.yml:86-105`][E228] |
| E229 | [`app/t3code/native/resource-monitor/Cargo.lock:5-15`][E229] |
| E230 | [`app/t3code/apps/mobile/modules/t3-agent-notifications/android/build.gradle:21-25`][E230] |
| E231 | [`app/t3code/scripts/lib/third-party-licenses.ts:340-365`][E231] |
| E232 | [`app/t3code/scripts/lib/reference-repos.ts:14-27`][E232] |
| E233 | [`runtime/pi/packages/coding-agent/src/core/package-manager.ts:1831-1874`][E233] |
| E234 | [`runtime/pi/packages/coding-agent/src/core/model-runtime.ts:750-791`][E234] |
| E235 | [`runtime/pi/packages/coding-agent/src/core/extensions/loader.ts:435-442`][E235] |
| E236 | [`runtime/pi/packages/ai/src/utils/node-http-proxy.ts:118-160`][E236] |
| E237 | [`runtime/pi/scripts/tool-stats.ts:159-161`][E237] |
| E238 | [`runtime/pi/packages/ai/scripts/generate-models.ts:1515-1523`][E238] |
| E239 | [`runtime/pi/packages/ai/scripts/generate-models.ts:1145-1150`][E239] |
| E240 | [`runtime/pi/packages/ai/scripts/generate-image-models.ts:92-97`][E240] |
| E241 | [`runtime/pi/packages/ai/scripts/generate-models.ts:1210-1215`][E241] |
| E242 | [`runtime/pi/packages/ai/scripts/generate-models.ts:1123-1128`][E242] |
| E243 | [`runtime/pi/packages/ai/scripts/generate-models.ts:1517-1523`][E243] |
| E244 | [`runtime/pi/packages/ai/package.json:55-64`][E244] |
| E245 | [`.github/workflows/ci.yml:34-39`][E245] |
| E246 | [`.github/workflows/ci.yml:1-14`][E246] |
| E247 | [`.github/workflows/ci.yml:17-50`][E247] |
| E248 | [`.github/workflows/ci.yml:51-108`][E248] |
| E249 | [`runtime/pi/.github/workflows/build-binaries.yml:296-347`][E249] |
| E250 | [`runtime/pi/scripts/publish.mjs:102-108`][E250] |
| E251 | [`app/t3code/.github/workflows/release.yml:623-686`][E251] |
| E252 | [`app/t3code/scripts/build-desktop-artifact.ts:1526-1537`][E252] |
| E253 | [`app/t3code/.github/workflows/release-desktop.yml:259-266`][E253] |
| E254 | [`app/t3code/.github/workflows/desktop-macos-preview-publish.yml:287-294`][E254] |
| E255 | [`app/t3code/.github/workflows/cursor-hygiene-webhook.yml:1-36`][E255] |
| E256 | [`app/t3code/.github/workflows/publish-aur.yml:38-65`][E256] |
| E257 | [`app/t3code/packaging/aur/scripts/release.sh:72-83`][E257] |
| E258 | [`app/t3code/.github/workflows/web-preview.yml:33-45`][E258] |
| E259 | [`app/t3code/.github/workflows/web-preview.yml:79-85`][E259] |
| E260 | [`app/t3code/.github/workflows/release.yml:888-895`][E260] |
| E261 | [`runtime/pi/packages/company-runtime/bin/weavra:17-36`][E261] |
| E262 | [`runtime/pi/packages/company-runtime/bin/weavra:77-93`][E262] |
| E263 | [`runtime/pi/packages/company-runtime/bin/weavra:171-175`][E263] |
| E264 | [`runtime/pi/packages/company-runtime/src/launcher-bridge.ts:1-40`][E264] |
| E265 | [`runtime/pi/packages/company-runtime/src/launcher-control.ts:14-54`][E265] |
| E266 | [`runtime/pi/packages/ai/src/models.ts:650-699`][E266] |
| E267 | [`runtime/pi/packages/ai/src/auth/resolve.ts:44-175`][E267] |
| E268 | [`runtime/pi/packages/ai/src/api/openai-completions.ts:783-817`][E268] |
| E269 | [`app/t3code/apps/web/src/cloud/managedAuth.tsx:31-108`][E269] |
| E270 | [`app/t3code/apps/server/src/cloud/publicConfig.ts:14-103`][E270] |
| E271 | [`app/t3code/infra/relay/src/http/Api.ts:1246-1300`][E271] |
| E272 | [`app/t3code/apps/server/src/cli/config.ts:157-175`][E272] |
| E273 | [`app/t3code/apps/mobile/src/features/cloud/publicConfig.ts:76-97`][E273] |
| E274 | [`app/t3code/.github/workflows/mobile-eas-production.yml:163-178`][E274] |
| E275 | [`app/t3code/.github/workflows/mobile-eas-production.yml:292-311`][E275] |
| E276 | [`app/t3code/apps/server/src/ws.ts:450-495`][E276] |
| E277 | [`app/t3code/apps/server/src/provider/Layers/ProviderService.ts:785-818`][E277] |
| E278 | [`runtime/pi/packages/company-runtime/src/host-workflow.ts:162-179`][E278] |

[E001]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/utils/version-check.ts#L5-L107
[E002]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L1034-L1064
[E003]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/package-manager-cli.ts#L662-L689
[E004]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/package-manager-cli.ts#L50-L99
[E005]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/package-manager-cli.ts#L171-L220
[E006]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/README.md#L63-L75
[E007]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L1212-L1257
[E008]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/core/settings-manager.ts#L1055-L1081
[E009]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/core/telemetry.ts#L1-L13
[E010]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/core/remote-catalog-provider.ts#L6-L134
[E011]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/core/model-runtime.ts#L169-L214
[E012]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/models.ts#L391-L479
[E013]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/package-manager-cli.ts#L583-L597
[E014]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/radius-config.ts#L4-L95
[E015]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/auth/oauth/radius.ts#L26-L65
[E016]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/radius.ts#L19-L78
[E017]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/modes/interactive/session-share.ts#L24-L146
[E018]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/core/session-export.ts#L7-L41
[E019]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/modes/interactive/session-share.ts#L45-L84
[E020]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/modes/interactive/session-share.ts#L148-L194
[E021]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/core/export-html/index.ts#L242-L284
[E022]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/.github/workflows/issue-analysis.yml#L539-L578
[E023]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/config.ts#L515-L521
[E024]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/modes/interactive/session-share.ts#L184-L192
[E025]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/.github/workflows/issue-analysis.yml#L565-L569
[E026]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/cli.ts#L1-L6
[E027]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/experimental/cli.ts#L1-L12
[E028]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/package.json#L29-L33
[E029]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/experimental/radius-relay.ts#L121-L171
[E030]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/experimental/radius-auth.ts#L8-L63
[E031]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/.github/workflows/publish-model-catalog.yml#L73-L146
[E032]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/.github/workflows/build-binaries.yml#L350-L418
[E033]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/scripts/publish-release-announcement.mjs#L271-L379
[E034]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/docs/architecture/BOUNDARIES.md#L33-L35
[E035]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/config.ts#L333-L348
[E036]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/utils/changelog.ts#L69-L100
[E037]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/.github/workflows/build-binaries.yml#L204-L213
[E038]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/core/provider-attribution.ts#L5-L95
[E039]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/core/sdk.ts#L314-L341
[E040]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/.env.example#L1-L26
[E041]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/scripts/lib/public-config.ts#L26-L65
[E042]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/web/src/main.tsx#L41-L76
[E043]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/mobile/src/features/cloud/CloudAuthProvider.tsx#L198-L218
[E044]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/desktop/src/app/DesktopClerk.ts#L69-L153
[E045]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/packages/shared/src/connectAuth.ts#L10-L59
[E046]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/cloud/CliTokenManager.ts#L459-L501
[E047]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/cloud/publicConfig.ts#L106-L153
[E048]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/server.ts#L712-L750
[E049]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/packages/client-runtime/src/relay/discovery.ts#L206-L263
[E050]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/packages/client-runtime/src/relay/discovery.ts#L315-L347
[E051]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/web/src/cloud/publicConfig.ts#L40-L75
[E052]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/infra/relay/.env.example#L1-L17
[E053]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/infra/relay/src/worker.ts#L115-L121
[E054]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/infra/relay/src/environments/ManagedEndpointProvider.ts#L286-L300
[E055]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/infra/relay/src/db.ts#L38-L85
[E056]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/infra/relay/migrations/postgres/20260527044716_baseline/migration.sql#L1-L98
[E057]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/infra/relay/src/agentActivity/ApnsClient.ts#L234-L243
[E058]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/infra/relay/src/worker.ts#L145-L163
[E059]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/packages/contracts/src/relay.ts#L122-L145
[E060]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/relay/AgentAwarenessRelay.ts#L314-L359
[E061]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/infra/relay/src/agentActivity/FcmClient.ts#L87-L140
[E062]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/infra/relay/src/worker.ts#L155-L163
[E063]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/telemetry/AnalyticsService.ts#L32-L206
[E064]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/telemetry/Identify.ts#L149-L213
[E065]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/telemetry/Identify.ts#L250-L303
[E066]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/serverRuntimeStartup.ts#L172-L175
[E067]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/server.ts#L560-L561
[E068]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/packages/shared/src/relayTracing.ts#L44-L156
[E069]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/mobile/app.config.ts#L451-L454
[E070]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/web/src/cloud/publicConfig.ts#L61-L69
[E071]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/infra/relay/src/observability.ts#L29-L73
[E072]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/config.ts#L212-L218
[E073]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/observability/Layers/Observability.ts#L49-L83
[E074]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/http.ts#L317-L359
[E075]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/desktop/src/app/DesktopObservability.ts#L587-L672
[E076]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/scripts/build-desktop-artifact.ts#L2537-L2576
[E077]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/desktop/src/updates/DesktopUpdates.ts#L250-L267
[E078]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/desktop/src/updates/DesktopUpdates.ts#L660-L687
[E079]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/desktop/src/updates/DesktopUpdates.ts#L864-L926
[E080]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/packages/shared/src/cliRelease.ts#L8-L102
[E081]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/cli/update.ts#L64-L102
[E082]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/cloud/pinnedRuntime.ts#L195-L230
[E083]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/cloud/selfUpdate.ts#L180-L200
[E084]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/scripts/install.sh#L156-L160
[E085]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/mobile/app.config.ts#L227-L232
[E086]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/mobile/app.config.ts#L456-L460
[E087]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/mobile/src/features/updates/app-updates.ts#L127-L153
[E088]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/mobile/src/features/updates/app-updates.ts#L560-L622
[E089]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/provider/ModelManifest.ts#L39-L49
[E090]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/provider/ModelManifest.ts#L335-L416
[E091]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/packages/contracts/src/settings.ts#L1064
[E092]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/provider/Drivers/CodexDriver.ts#L196-L205
[E093]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/cli/triagePrompt.ts#L39-L51
[E094]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/cli/triagePrompt.ts#L94-L126
[E095]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/cli/triage.ts#L215-L218
[E096]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/marketing/src/lib/releases.ts#L1-L54
[E097]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/marketing/src/pages/download.astro#L134-L218
[E098]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/marketing/src/lib/site.ts#L1-L7
[E099]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/scripts/notify-discord-release.ts#L120-L151
[E100]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/scripts/notify-discord-release.ts#L183-L185
[E101]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/.github/workflows/release.yml#L1170-L1190
[E102]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/core/settings-manager.ts#L1065-L1081
[E103]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/cli/startup-ui.ts#L122-L141
[E104]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/modes/interactive/components/first-time-setup.ts#L24-L35
[E105]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/telemetry/src/noop.ts#L1-L20
[E106]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/telemetry/src/memory.ts#L192-L196
[E107]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/agent/src/harness/context.ts#L27-L36
[E108]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/web/src/main.tsx#L70-L76
[E109]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/auth/EnvironmentAuth.ts#L990-L1013
[E110]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/auth/ReusableDevAuth.ts#L12-L30
[E111]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/desktop/src/app/DesktopClerk.ts#L75-L153
[E112]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/desktop/src/preload.ts#L8-L30
[E113]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/web/src/main.tsx#L43-L52
[E114]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/resourceTelemetry/ResourceTelemetry.ts#L285-L445
[E115]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/ws.ts#L2597-L2613
[E116]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/desktop/src/backend/DesktopBackendConfiguration.ts#L538-L543
[E117]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/anthropic.ts#L10-L54
[E118]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/openai.ts#L6-L14
[E119]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/openai-codex.ts#L8-L20
[E120]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/api/openai-codex-responses.ts#L637-L649
[E121]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/azure-openai-responses.ts#L6-L12
[E122]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/api/azure-openai-responses.ts#L217-L272
[E123]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/amazon-bedrock.ts#L11-L86
[E124]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/api/bedrock-converse-stream.ts#L154-L207
[E125]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/google.ts#L6-L14
[E126]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/google-vertex.ts#L13-L98
[E127]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/api/google-vertex.ts#L385-L416
[E128]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/github-copilot.ts#L10-L23
[E129]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/xai.ts#L8-L20
[E130]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/kimi-coding.ts#L8-L20
[E131]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/moonshotai.ts#L6-L14
[E132]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/moonshotai-cn.ts#L6-L14
[E133]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/openrouter.ts#L9-L20
[E134]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/cloudflare-workers-ai.ts#L8-L14
[E135]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/api/cloudflare.ts#L1-L15
[E136]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/cloudflare-auth.ts#L75-L100
[E137]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/api/cloudflare-ai-binding.ts#L60-L89
[E138]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/vercel-ai-gateway.ts#L6-L14
[E139]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/opencode.ts#L13-L22
[E140]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/opencode-go.ts#L10-L19
[E141]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/huggingface.ts#L6-L14
[E142]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/deepseek.ts#L6-L14
[E143]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/mistral.ts#L6-L14
[E144]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/minimax.ts#L6-L14
[E145]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/minimax-cn.ts#L6-L14
[E146]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/qwen-token-plan.ts#L6-L14
[E147]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/qwen-token-plan-cn.ts#L6-L14
[E148]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/xiaomi.ts#L6-L14
[E149]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/xiaomi-token-plan-ams.ts#L6-L14
[E150]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/xiaomi-token-plan-cn.ts#L6-L14
[E151]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/xiaomi-token-plan-sgp.ts#L6-L14
[E152]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/zai.ts#L6-L14
[E153]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/zai-coding-cn.ts#L6-L14
[E154]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/ant-ling.ts#L6-L14
[E155]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/baseten.ts#L6-L14
[E156]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/cerebras.ts#L6-L14
[E157]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/fireworks.ts#L8-L18
[E158]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/groq.ts#L6-L14
[E159]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/nvidia.ts#L6-L14
[E160]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/providers/together.ts#L6-L14
[E161]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/auth/oauth/anthropic.ts#L28-L37
[E162]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/auth/oauth/anthropic.ts#L318-L359
[E163]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/auth/oauth/openai-codex.ts#L26-L39
[E164]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/auth/oauth/openai-codex.ts#L153-L197
[E165]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/auth/oauth/github-copilot.ts#L10-L17
[E166]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/auth/oauth/github-copilot.ts#L44-L86
[E167]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/auth/oauth/github-copilot.ts#L210-L218
[E168]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/auth/oauth/kimi-coding.ts#L14-L38
[E169]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/auth/oauth/kimi-coding.ts#L214-L237
[E170]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/auth/oauth/xai.ts#L8-L11
[E171]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/auth/oauth/xai.ts#L145-L175
[E172]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/auth/oauth/xai.ts#L213-L237
[E173]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/auth/oauth/openrouter.ts#L20-L26
[E174]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/auth/oauth/openrouter.ts#L301-L308
[E175]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/provider/AntigravityAuth.ts#L266-L298
[E176]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/provider/antigravityCallback.ts#L54-L59
[E177]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/packages/contracts/src/settings.ts#L758-L762
[E178]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/provider/Layers/CodexProvider.ts#L362-L445
[E179]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/provider/Layers/OpenCodeProvider.ts#L498-L520
[E180]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/provider/makeManagedServerProvider.ts#L126-L179
[E181]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/packages/contracts/src/settings.ts#L563-L568
[E182]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/packages/contracts/src/settings.ts#L622-L626
[E183]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/provider/Layers/cursorUsageLimits.ts#L73-L123
[E184]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/provider/Drivers/CursorDriver.ts#L140-L148
[E185]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/provider/Layers/grokUsageLimits.ts#L61-L130
[E186]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/provider/Layers/openCodeUsageLimits.ts#L30-L69
[E187]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/usage/UsageLimitSources.ts#L74-L170
[E188]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/usage/cliproxyApi.ts#L118-L171
[E189]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/usage/cliproxyApi.ts#L313-L345
[E190]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/packages/contracts/src/settings.ts#L1234-L1236
[E191]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/sourceControl/GitHubSourceControlProvider.ts#L109-L162
[E192]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/sourceControl/GitHubCli.ts#L413-L453
[E193]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/packages/shared/src/sourceControl.ts#L183-L265
[E194]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/sourceControl/SourceControlProviderRegistry.ts#L13-L24
[E195]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/assets/GitHubMediaFetch.ts#L18-L42
[E196]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/assets/GitHubMediaFetch.ts#L115-L157
[E197]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/packages/shared/src/favicon.ts#L19-L26
[E198]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/packages/tailscale/src/tailscale.ts#L217-L285
[E199]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/packages/tailscale/src/tailscale.ts#L341-L381
[E200]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/cli/config.ts#L68-L77
[E201]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/packages/shared/src/favicon.ts#L85-L96
[E202]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/web/src/components/ChatMarkdown.tsx#L1247-L1281
[E203]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/packages/shared/src/favicon.ts#L8-L15
[E204]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/packages/shared/src/favicon.ts#L42-L80
[E205]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/mcp/toolkits/preview/tools.ts#L80-L84
[E206]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/usage/UsageService.ts#L66-L73
[E207]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/usage/UsageService.ts#L162-L236
[E208]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/usage/UsageService.ts#L538-L542
[E209]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/extensions/llama/huggingface.ts#L46-L120
[E210]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/extensions/llama/client.ts#L299-L321
[E211]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/extensions/llama/provider.ts#L13-L25
[E212]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/extensions/llama/provider.ts#L95-L175
[E213]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/extensions/llama/index.ts#L29-L57
[E214]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/.github/workflows/ci.yml#L33-L37
[E215]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/.github/workflows/ci.yml#L66-L71
[E216]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/core/package-manager.ts#L1186-L1305
[E217]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/core/package-manager.ts#L1773-L1812
[E218]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/provider/providerMaintenance.ts#L407-L470
[E219]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/provider/providerMaintenance.ts#L635-L723
[E220]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/utils/tools-manager.ts#L29-L49
[E221]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/utils/tools-manager.ts#L257-L330
[E222]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/modes/interactive/interactive-mode.ts#L976-L980
[E223]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/utils/tools-manager.ts#L50-L69
[E224]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/provider/antigravityRelease.ts#L18-L72
[E225]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/ws.ts#L2458-L2461
[E226]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/desktop/scripts/ensure-electron-runtime.mjs#L119-L159
[E227]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/.github/workflows/ci.yml#L70-L71
[E228]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/.github/workflows/ci.yml#L86-L105
[E229]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/native/resource-monitor/Cargo.lock#L5-L15
[E230]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/mobile/modules/t3-agent-notifications/android/build.gradle#L21-L25
[E231]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/scripts/lib/third-party-licenses.ts#L340-L365
[E232]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/scripts/lib/reference-repos.ts#L14-L27
[E233]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/core/package-manager.ts#L1831-L1874
[E234]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/core/model-runtime.ts#L750-L791
[E235]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/coding-agent/src/core/extensions/loader.ts#L435-L442
[E236]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/utils/node-http-proxy.ts#L118-L160
[E237]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/scripts/tool-stats.ts#L159-L161
[E238]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/scripts/generate-models.ts#L1515-L1523
[E239]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/scripts/generate-models.ts#L1145-L1150
[E240]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/scripts/generate-image-models.ts#L92-L97
[E241]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/scripts/generate-models.ts#L1210-L1215
[E242]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/scripts/generate-models.ts#L1123-L1128
[E243]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/scripts/generate-models.ts#L1517-L1523
[E244]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/package.json#L55-L64
[E245]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/.github/workflows/ci.yml#L34-L39
[E246]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/.github/workflows/ci.yml#L1-L14
[E247]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/.github/workflows/ci.yml#L17-L50
[E248]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/.github/workflows/ci.yml#L51-L108
[E249]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/.github/workflows/build-binaries.yml#L296-L347
[E250]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/scripts/publish.mjs#L102-L108
[E251]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/.github/workflows/release.yml#L623-L686
[E252]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/scripts/build-desktop-artifact.ts#L1526-L1537
[E253]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/.github/workflows/release-desktop.yml#L259-L266
[E254]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/.github/workflows/desktop-macos-preview-publish.yml#L287-L294
[E255]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/.github/workflows/cursor-hygiene-webhook.yml#L1-L36
[E256]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/.github/workflows/publish-aur.yml#L38-L65
[E257]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/packaging/aur/scripts/release.sh#L72-L83
[E258]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/.github/workflows/web-preview.yml#L33-L45
[E259]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/.github/workflows/web-preview.yml#L79-L85
[E260]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/.github/workflows/release.yml#L888-L895
[E261]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/company-runtime/bin/weavra#L17-L36
[E262]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/company-runtime/bin/weavra#L77-L93
[E263]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/company-runtime/bin/weavra#L171-L175
[E264]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/company-runtime/src/launcher-bridge.ts#L1-L40
[E265]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/company-runtime/src/launcher-control.ts#L14-L54
[E266]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/models.ts#L650-L699
[E267]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/auth/resolve.ts#L44-L175
[E268]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/ai/src/api/openai-completions.ts#L783-L817
[E269]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/web/src/cloud/managedAuth.tsx#L31-L108
[E270]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/cloud/publicConfig.ts#L14-L103
[E271]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/infra/relay/src/http/Api.ts#L1246-L1300
[E272]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/cli/config.ts#L157-L175
[E273]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/mobile/src/features/cloud/publicConfig.ts#L76-L97
[E274]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/.github/workflows/mobile-eas-production.yml#L163-L178
[E275]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/.github/workflows/mobile-eas-production.yml#L292-L311
[E276]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/ws.ts#L450-L495
[E277]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/app/t3code/apps/server/src/provider/Layers/ProviderService.ts#L785-L818
[E278]: https://github.com/kjg8619/Weavra/blob/8447f9843e0b2d468554e0062abbe6b98a81ba13/runtime/pi/packages/company-runtime/src/host-workflow.ts#L162-L179
