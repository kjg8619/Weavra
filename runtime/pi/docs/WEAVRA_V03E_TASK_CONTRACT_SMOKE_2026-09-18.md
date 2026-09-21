# Weavra V0.3E — Task Contract Provider Smoke

- 작성일: 2026-09-18 (KST), 실제 실행 11:12–11:14 KST.
- 소스: devlop `9e2cf9e8bfc6e011402a2598b6a1a93294a8214a` + 미커밋 V0.3E working tree(Task Contract/Plan Preview).
- 환경: macOS/Darwin arm64, Node v26.7.0. Weavra worker: `commandcode / deepseek/deepseek-v4.1-flash`, thinking medium. 교차검증: `codex-lb / gpt-6-astra`(로컬 relay).
- 성격: 실제 Provider smoke evidence. 제품 source·config·`models.json`은 실행 전후 수정하지 않았다.

## 목적과 범위

V0.3E의 Host-confirmed Task Contract가 실제 Provider workflow에서 다음 순서로 동작하는지 확인한다.

```text
Host Plan Preview(고정 문장 2개) → AC-001/AC-002 부여 → frozen digest
→ Developer가 동일 계약 수신 → anchored edit → SELF_CHECK
→ Reviewer가 exact AC ID별 결과/evidence 제출 → TEST → COMPLETED
```

복수 AC 예시(둘 다 Host가 확인한 문장):

```text
AC-001 Fix the greeting typo.
AC-002 Preserve the existing exported greet(name) API and punctuation.
```

Goal은 자연어로 유지했다: `Fix the greeting typo in the allowed source file, following the selected project rules.`

## Fixture / 방법

- private temporary Git fixture: `allowed_paths=[src]`, `runtime.workflow=STANDARD`, `project.instructions.path=AGENTS.md`(444 bytes), required check `node --test test/greeting.test.mjs`, allowed 밖 synthetic marker.
- harness는 Host 역할만 수행했다: 문장 파싱 → `buildTaskContract` → `formatPlanPreview` → `StandardWorkflow`에 frozen contract 전달. faux 응답·tool 인자 대체 없음.
- 교차검증은 같은 fixture/goal/문장에서 profile만 `codex-lb/gpt-6-astra`로 바꿔 1회 실행했다.

## 결과

| run | provider/model | 판정 | duration | tokens | acceptance |
|---|---|---|---:|---:|---|
| DeepSeek | commandcode / deepseek/deepseek-v4.1-flash | **COMPLETED** | 21,524ms | 34,144 (Developer 26,087 + Reviewer 8,057) | AC-001 MET, AC-002 MET, revision 0, diffDigest 현재 |
| GPT cross | codex-lb / gpt-6-astra | **COMPLETED** | 36,557ms | 13,235 (Developer 10,265 + Reviewer 2,970) | AC-001 MET, AC-002 MET, revision 0 |

- DeepSeek run: `changedFiles=["src/greeting.js"]`, Reviewer `PASS`(criteria 2개, 각각 exact AC ID + trusted diff/check refs), `taskContractDigest=sha256:932f6585…`. Developer는 `runtime_list_files({})` → anchored read → anchored edit(STALE_ANCHOR 1회 consumable 복구) → 재확인 → `runtime_request_check` → `submit_handoff`(unresolved `[]`) 순으로 동작했고, Reviewer는 list → read → `submit_review` 1회로 제출했다.
- GPT cross run: 동일한 acceptance shape(AC-001/AC-002 MET, revision 0, Reviewer PASS), `taskContractDigest=sha256:7fbd2c9c…`(contract id가 달라 digest도 다름). tool 순서는 list → read → anchored edit → request_check → submit_handoff / submit_review.
- 두 run의 최종 `src/greeting.js`는 byte-identical(`d1633a9d…`)이다.
- 두 run 모두 provider 전송 오류·tool schema 오류·cleanup 미확인·writer.lock 잔존이 없었고, workspace 변경은 허용된 파일 1개뿐이다.

## NOT VERIFIED

- 실제 Provider에서 "AC 하나 미충족 → COMPLETED 금지"는 별도 run으로 시도하지 않았다. 이 경계는 deterministic automated fixture로 검증한다(LOG-057).
- R2/R3 run의 AC 흐름, QUICK Executor AC 제출(자동 test로만 검증), 다른 Provider/OS/Node, 원격 CI, JVM build matrix는 미실행이다.
- 이 smoke는 self-hosting이나 전체 DeepSeek compatibility를 의미하지 않는다.
