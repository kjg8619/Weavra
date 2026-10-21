#!/bin/bash
set -eu
export PATH="/Users/kangjingoo/.nvm/versions/node/v24.19.0/bin:$PATH"
PK=/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-18
WT=/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-18
BEFORE_WT=/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-18-before
QA=/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-01/scripts/hig
PRELOAD="$PK/tools/preload-app-gate.mjs"
HEAD=$(git -C "$WT" rev-parse HEAD)
BASE=$(git -C "$BEFORE_WT" rev-parse HEAD)
step() {
  NAME=$1; shift
  set +e
  "$@" > "$PK/logs/$NAME.log" 2>&1
  CODE=$?
  set -e
  printf 'STEP %s EXIT=%s\n' "$NAME" "$CODE"
  return "$CODE"
}
echo "HEAD=$HEAD BASE=$BASE RUNNER=$(git -C "$QA/../.." rev-parse HEAD)"
cd "$WT"
step runner-tests bun test scripts/hig/harness.test.ts
step runner-syntax node --check scripts/hig/cases.mjs
step diff-check git diff --check "$BASE" "$HEAD"
cd "$WT/app/t3code"
FILES="apps/web/src/components/settings/ProviderSettingsPanel.tsx apps/web/src/components/settings/ProviderInstanceCard.tsx apps/web/src/components/settings/ProviderModelsSection.tsx apps/web/src/components/settings/CustomModelEditor.tsx apps/web/src/components/settings/providerStatus.ts apps/web/src/components/settings/providerStatus.test.ts apps/web/src/components/settings/ProviderModelsSection.test.ts"
step fmt pnpm exec vp fmt --check $FILES
step lint pnpm exec vp lint $FILES
step typecheck pnpm --filter @t3tools/web typecheck
cd apps/web
step focused pnpm exec vp test run --project unit src/components/settings/providerStatus.test.ts src/components/settings/ProviderModelsSection.test.ts src/components/settings/ProviderSettingsPanel.environment.test.tsx
step build-after bash "$PK/tools/build.sh" after "$WT"
step measure-after bun --preload "$PRELOAD" "$PK/tools/measure-18.mjs" after
step measure-summary bun "$PK/tools/summarize-18.mjs"
step supplemental-diff bun "$PK/tools/diff-forms.mjs"
step capture-before env WEAVRA_CAPTURE_REPO="$BEFORE_WT" WEAVRA_CAPTURE_APP="$PK/before/app/weavra-desktop.app" WEAVRA_CAPTURE_OUT="$PK/before/capture" bun --preload "$PRELOAD" "$QA/capture.mjs" --revision "$BASE" --matrix ledger-plus --case 18
step capture-after env WEAVRA_CAPTURE_REPO="$WT" WEAVRA_CAPTURE_APP="$PK/after/app/weavra-desktop.app" WEAVRA_CAPTURE_OUT="$PK/after/capture" bun --preload "$PRELOAD" "$QA/capture.mjs" --revision "$HEAD" --matrix ledger-plus --case 18
step diff bun "$QA/diff.mjs" --before "$PK/before/capture" --after "$PK/after/capture" --out "$PK/diff"
for ROUND in 01 02; do
  step accept-scenarios-"$ROUND" env WEAVRA_CAPTURE_REPO="$WT" WEAVRA_CAPTURE_APP="$PK/after/app/weavra-desktop.app" bun --preload "$PRELOAD" "$QA/assert.mjs" --case 18 --evidence "$PK/qa"
  step verify-packet-"$ROUND" bun "$QA/assert.mjs" --verify-packet "$PK"
  if [ "$ROUND" = 01 ]; then
    mkdir -p "$PK/repeat-01/pr-18"
    cp -R "$PK/qa" "$PK/repeat-01/pr-18/"
    cp "$PK/acceptance-verdict.json" "$PK/repeat-01/pr-18/"
    mv "$PK/qa" "$PK/qa-round-01"
  fi
done
step final-diff-check git -C "$WT" diff --check "$BASE" "$HEAD"
echo PIPELINE_FINAL_DONE
