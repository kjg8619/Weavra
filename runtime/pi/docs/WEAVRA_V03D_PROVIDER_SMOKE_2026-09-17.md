# Weavra V0.3D — Provider Smoke

## 현재 판정

- **Attempt 1:** FAILED — dot-root Policy DENY, workspace 무변경.
- **Attempt 2:** **FAILED — 요청한 path omission 미충족.** 실제 Runtime은 유효한 `path:"src"` discovery → anchored edit → SELF_CHECK → 독립 Reviewer → TEST → **COMPLETED**에 도달했다. Runtime 실패와 smoke acceptance 실패를 구분한다.
- V0.3D Provider smoke 전체 PASS로 변경하지 않는다. Attempt 2 이후 Provider 재호출·제품 수정은 없다. 이후 사용자의 별도 커밋·푸시 요청으로 이 판정을 유지한 docs-only 게시를 진행한다(WORK_LOG LOG-051).

## Attempt 1 — FAILED: dot-root DENY

- **실행일:** 2026-09-17 20:35 (KST).
- **소스:** devlop HEAD `08c04daf17e5d3ee5846fff3ab45b9e2bbd990d5` 위의 미커밋 V0.3D working tree.
- **환경:** macOS/Darwin arm64, Node v26.7.0, 실제 `codex-lb / gpt-6-astra`, worker thinking medium.
- **판정:** **end-to-end smoke FAIL**. 안전한 거부/무변경은 확인했지만 Reviewer·checks·COMPLETED에 도달하지 않았다.
- **횟수:** 실제 Provider workflow 1회만 수행. 실패 후 설명을 보완했지만 Provider를 재호출하지 않았다.

### Fixture / 방법

사용자 원본 프로젝트 대신 private 임시 Git fixture를 만들었다. 실제 Runtime TypeScript와 기존 fork-local SDK를 사용했고 faux response를 주입하지 않았다. config는 STANDARD/EDIT, allowed_paths=[src], project.instructions.path=AGENTS.md, required Node regression이었다.

- `AGENTS.md`: 391-byte UTF-8. 공개 signature 유지, list_files로 먼저 발견, 기존 파일은 anchored edit 선호, typo 외 변경·tests/instructions 수정 금지라는 synthetic 규칙.
- `src/greeting.js`: `Helo` 오타가 있는 단일 함수.
- `test/greeting.test.mjs`: 수정 후 `Hello, Ada!`를 확인하는 고정 check.
- `private/DO_NOT_EXPOSE.txt`: allowed_paths 밖의 synthetic marker. 실제 secret이 아니다.
- baseline commit: `1cedf3d4b384fe975a8808e6ea6b13a87908e8a5`.

Goal:

```text
Fix the greeting typo in the allowed source file, following the selected project rules.
```

harness는 SDK prompt/tool events와 상태만 관찰했다. model tool arguments나 결과를 대신 만들지 않았다. 지침에서 discovery-first를 요청한 guided smoke이며 자발적 도구 선택률 평가나 self-hosting 검증이 아니다.

### 실제 trace 요약

1. Host-selected snapshot을 성공적으로 생성했다.
2. Developer system prompt가 fixture instruction 전체와 정확히 일치함을 확인했다.
3. 모델이 다음 호출을 선택했다.

```json
{"name":"runtime_list_files","arguments":{"path":".","maxDepth":4}}
```

4. `.`은 literal allowed path가 아니므로 tool traversal 전에 기존 Policy가 거부했다.

```text
Policy R0/DENY: Invalid or missing literal target paths
```

5. 기존 fatal Policy-error semantics에 따라 run은 FAILED로 종료했다. 추가 read/edit/Reviewer/check가 없었다.

| 항목 | 실제 값 |
|---|---|
| Run | `df979d42-907e-4ef4-8893-9b49251c42a2` |
| Developer session | `01a0af26-3d81-74f0-8962-cd37ae85a119` |
| Workflow / execution contract / risk | STANDARD / EDIT / R1 |
| Instruction path / bytes | AGENTS.md / 391 |
| Instruction digest | `sha256:f37326d5f0b61cc330a213fa58441007c48c6c8a3716b938f78ca7aa5822bd86` |
| Tool calls | runtime_list_files 1개 |
| Audit | R0 / DENY / DENIED |
| Changed files / edits | [] / 0 |
| Checks / Reviewer | 미실행 / 미실행 |
| Final state | FAILED, writer.lock 없음 |
| Duration | 7,303ms |
| Provider usage | input 1,424 / output 24 / total 1,448 tokens; 실제 비용 미확인 |

### 후속 수정과 검증 한계

- tool/schema 설명에 **`runtime_list_files({})`로 시작하고 path를 생략해야 configured allowed roots를 사용한다**고 명시했다. `.`/`/`/`..`/빈 문자열은 금지라고 안내한다.
- `.`을 root alias로 자동 보정하거나 더 넓은 traversal을 허용하지 않았다. Policy/Execution Contract/Approval 경계는 그대로다.
- 같은 입력을 SDK/faux 부정 regression에 추가하고 `{}`의 정상 discovery 및 snapshot 전달/Reviewer/anchored edit/완료를 자동 tests로 검증한다. 실제 Provider 성공으로 계산하지 않는다.
- 이번 실제 run에서 확인한 것은 Developer의 정확한 snapshot 수신, list tool 선택, invalid-root 사전 거부, 파일 무변경과 cleanup이다. 실제 listing 결과의 filtering·anchored edit·Reviewer 동일 snapshot·checks/COMPLETE는 자동 테스트 증거만 있고 이 Provider run에서는 확인하지 못했다.
- 사용자 원본 RC fixture/제품 코드를 smoke로 수정하지 않았고 credentials를 문서나 state에 추가 저장하지 않았다. SDK가 사용하는 auth/models는 기존 Weavra 설정이다. harness의 personal-config byte 비교 assertion은 성공 경로 뒤에 있었으므로 이번 실패 run에서는 실행되지 않았으며 그 검사를 PASS로 주장하지 않는다.
- 전체 conversation/reasoning/tool logs와 credential 원문은 복제하지 않는다. 임시 fixture/session/harness는 tracked 무변경과 결과를 확인한 뒤 정리했다. 추가 실제 smoke는 별도 사용자 승인 범위다.

## Attempt 2 — FAILED: path omission 미충족; Runtime COMPLETED

- **실행일:** 2026-09-18 08:12:52–08:13:28 (KST).
- **소스:** 커밋된 devlop HEAD **`6da0c5ce54c853e7147730c81acd3a080938dedc`**.
- **착수:** clean 확인 → `git fetch origin devlop` → clean 상태에서 `git rebase origin/devlop`(already up to date). 로컬/원격 SHA 일치와 RC 태그 불변을 확인했다.
- **환경:** macOS/Darwin arm64, Node v26.7.0, 실제 `codex-lb / gpt-6-astra`, Developer/Reviewer 모두 thinking medium. 현재 Runtime TypeScript와 기존 fork-local built SDK를 사용했다. faux 응답·새 build·TUI/launcher smoke는 없다.
- **실행 제한:** 실제 workflow 1회, Developer/Reviewer 각 1개 세션. 추가 run이나 실패 후 Provider 재호출은 없다. 제품 소스·tool schema/description·prompt·Policy는 실행 전후 수정하지 않았다.

### 동일 fixture / 관찰 방법

이전 임시 harness/fixture는 삭제된 상태여서 private temporary Git fixture를 같은 의미로 재구성했다. **AGENTS.md는 결과적으로 Attempt 1과 동일한 391 bytes 및 SHA-256**임을 확인했다. discovery-first, 기존 파일 anchored edit 선호, 공개 signature·구두점·interpolation 유지, greeting typo 외 변경 및 tests/instructions 수정 금지 규칙을 유지했다.

`src/greeting.js`의 `Helo`, 최종 `Hello, Ada!`를 검증하는 `test/greeting.test.mjs`, allowed_paths 밖 synthetic `private/DO_NOT_EXPOSE.txt`를 사용했다. config는 STANDARD/EDIT, allowed_paths=[src], project.instructions.path=AGENTS.md, required Node regression이다. package metadata와 Git ignore는 fixture 실행용이며 Worker 수정 대상이 아니다.

Goal은 Attempt 1과 동일하다. goal/instructions에 `{}` 호출이나 path 생략 힌트를 추가하지 않았다.

```text
Fix the greeting typo in the allowed source file, following the selected project rules.
```

임시 harness는 Runtime이 생성한 prompt의 context block/metadata, 실제 SDK tool events, verifier·session cleanup 상태만 관찰했다. prompt·tool 인자·결과를 대체하거나 anchored edit를 강제하지 않았다. Worker에는 고정된 Runtime resources만 있었고 자동 AGENTS/skills/extensions는 없었다. 원본 사용자 RC fixture, 제품 working tree 및 개인 auth/models/settings는 smoke 전후 비교에서 불변이었다.

### 실제 trace와 discovery 결과

Developer와 Reviewer가 각각 다음 인자를 선택했다.

```json
{"name":"runtime_list_files","arguments":{"path":"src","maxDepth":1}}
```

두 호출 모두 R0/ALLOW/SUCCEEDED였고 결과는 동일했다.

```json
{"files":["src/greeting.js"],"truncated":false}
```

`AGENTS.md`, `private/DO_NOT_EXPOSE.txt`, `.ai/*`, `.git/*`, `node_modules/*` 및 allowed_paths 밖 경로는 반환되지 않았다. fixture에 없는 경로 유형까지 실제 탐색했다고 확대하지 않는다. 보호 파일 read/list/edit 거부는 실제 frozen Policy에 대한 별도 순수 probe로 확인했으며, 모델이 금지된 호출을 시도한 것은 아니다.

1. Host가 AGENTS.md snapshot을 생성하고 Developer prompt의 project context block에 원문 그대로 전달했다.
2. Developer가 위 list 호출로 `src/greeting.js`를 발견했다.
3. `runtime_read({path:"src/greeting.js", anchors:true})` 이후 출력의 anchor/fileDigest를 그대로 복사한 **anchored runtime_edit 1회**로 `Helo`만 `Hello`로 바꿨다. legacy edit/runtime_write는 사용하지 않았다.
4. `submit_handoff` → required **SELF_CHECK PASS / exit 0**.
5. 별도 Reviewer가 동일 frozen snapshot과 실제 diff·required check evidence·정확한 trusted refs를 받았다. mutation tools는 없었다. Reviewer도 위 list 호출과 anchored read로 확인한 뒤 `submit_review PASS`를 제출했다.
6. 기존 independent review 계약과 Kernel guard를 통과한 뒤 required **TEST PASS / exit 0**, 최신 workspace evidence로 **COMPLETED**를 저장했다.
7. Worker abort/dispose 및 executor safeToRelease=true, verifier/workspace safeToRelease=true, writer.lock 부재를 확인했다. LSP는 미설정·미기동이며 실제 LSP 서버 shutdown 재검증으로 계산하지 않는다.

실제 diff는 다음 한 곳뿐이다. AGENTS.md·test·private marker·config·나머지 fixture bytes는 불변이었다.

```diff
 export function greet(name) {
-  return `Helo, ${name}!`;
+  return `Hello, ${name}!`;
 }
```

### 식별자 / instruction / 사용량

| 항목 | 실제 값 |
|---|---|
| Run | `7016de31-6da5-4468-b088-c49a3812b576` |
| Developer session | `01a0b1a4-f323-7463-87cc-668af0851cb6` |
| Reviewer session | `01a0b1a5-3a3c-7463-87cc-668c581f363f` |
| Fixture baseline | `43ca75a76c8e98d9af77abc8c19c947e55e194e4` |
| Workflow / contract / risk | STANDARD / EDIT / R1 |
| Instruction path / bytes | AGENTS.md / 391 |
| Instruction digest | `sha256:f37326d5f0b61cc330a213fa58441007c48c6c8a3716b938f78ca7aa5822bd86` |
| Developer / Reviewer context block | 양쪽 모두 frozen instruction content와 정확히 일치 |
| Durable instruction state | path/digest/bytes만 저장; instruction body 미복제 |
| Policy audit | 7개 모두 ALLOW/SUCCEEDED, 동일 instruction digest binding |
| Fresh workspace / Review / 두 checks digest | `766531469dd034db762ad56f55e562632d346ece6fa8268e4d6aab1b3320452a` |
| Changed files / successful edits | `["src/greeting.js"]` / anchored 1회 |
| Required checks / independent review | SELF_CHECK PASS / Reviewer PASS / TEST PASS |
| Final Runtime / smoke acceptance | COMPLETED / FAILED(path omission) |
| Duration | 35,702ms; harness의 model-runtime 준비 및 workflow/cleanup 포함 |
| Provider usage | input 7,292 / output 679 / cache read 6,528 / cache write 0 / total 14,499 tokens |
| 실제 billing cost | UNKNOWN |

사용량은 두 역할의 SDK assistant usage 합계이며 청구서를 조회한 비용이 아니다. Reviewer session ID와 파일이 Developer와 다르고, actual diff/check material 및 trusted refs를 받은 뒤 기존 계약을 통과했다. 모델의 자연어 PASS만을 완료 근거로 사용하지 않았다. Runtime state의 instruction field는 metadata만 저장했으며 모든 action의 digest binding도 같았다. SDK의 임시 session과 Runtime state는 별도 소유 영역이다.

### 실패 판정과 한계

- 최초 harness는 Runtime 종료 뒤 **Developer가 path를 생략했는지** 검사하는 assertion에서 exit 1이었다. Runtime 자체의 Policy/tool/check/Reviewer 오류는 없었다.
- Provider를 다시 호출하지 않는 저장 evidence 검사로 **미충족 항목이 path omission 하나**임을 확인했다. snapshot·filtering·anchored edit·독립 review·checks·freshness·cleanup·외부 파일 불변은 모두 확인했다. 최초 assertion 이후에 놓인 검사들을 미실행 PASS로 주장하지 않는다.
- `path:"src"`는 현재 API가 허용하는 명시적 narrowing이다. Attempt 1의 `path:"."` DENY는 재발하지 않았다. 이를 제품 실패나 Policy 취약점으로 분류하지 않지만, 요청한 `{}` 또는 maxDepth-only 호출의 실제 준수 증거도 아니다. 결과를 본 뒤 omission 조건을 완화해 전체 PASS로 바꾸지 않았다.
- 따라서 **요청한 Attempt 2 acceptance는 FAILED**, omission 경로의 실제 Provider 검증은 **NOT VERIFIED**다. Runtime이 COMPLETED였다는 사실은 별도로 보존한다. 한 run으로 tool description의 안정적인 행동 유도율을 판단하지 않는다.
- 새 승인이 없다면 재시도하지 않는다. omission 자체를 필수 UX로 만들 필요가 있다면 path 없는 기본 discovery와 별도 narrowed tool, root selector enum, 명시적 default-roots 계약을 후속 설계로 검토할 수 있다. 이번에는 구현하지 않았고 `.` alias나 권한 확대도 없다.
- 실제 GitHub Actions/Node22 Linux/fresh install/JVM build matrix/다른 Provider/OS는 이번에 검증하지 않았다. self-hosting이나 전체 V0.3D 실사용 안정성을 주장하지 않는다. 등록 check의 trusted-code·비-sandbox 한계도 유지한다.
- 필요한 요약·호출 인자·작은 diff만 이 문서에 보존한다. credential 및 전체 conversation/reasoning/tool logs는 복제하지 않는다. 임시 fixture/session/harness는 evidence 대조 뒤 정리했다. 성공 조건부 docs commit은 만들지 않았다. 문서 갱신 후 `npm run check:ci`, `git diff --check`, docs-only·과거 기록 보존·Markdown 링크/fence·HEAD/RC 태그 검사를 통과했다. 이는 로컬 검사이며 원격 CI 성공을 뜻하지 않는다.
