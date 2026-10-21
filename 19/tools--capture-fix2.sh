#!/bin/bash
set -eu
export PATH="/Users/kangjingoo/.nvm/versions/node/v24.19.0/bin:$PATH"
export GIT_MASTER=1
PK=/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-19
WT=/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-19
# Use the fa5e1dbc runner already merged into this worktree. hig-01 may
# advance for todo 20 while this task is running; never edit or race it.
QA="$WT/scripts/hig"
PRELOAD="$PK/tools/preload-app-gate.mjs"
HEAD=$(git -C "$WT" rev-parse HEAD)
step() {
  NAME=$1; shift
  set +e
  "$@" > "$PK/logs/$NAME.log" 2>&1
  CODE=$?
  set -e
  printf 'STEP %s EXIT=%s\n' "$NAME" "$CODE"
  return "$CODE"
}
echo "HEAD=$HEAD RUNNER=fa5e1dbcfb12fd51c5ac0d9dd0ca7a6e89f91c4a"
step variant-label-after-fix2 env QA_APP="$PK/after/app/weavra-desktop.app" QA_OUT="$PK/fix2/after" QA_REVISION="$HEAD" bun --preload "$PRELOAD" "$PK/tools/variant-label-19.mjs"
step variant-label-diff-fix2 bun "$PK/tools/diff-label-19.mjs"
step korean-focus-fix2 bun --preload "$PRELOAD" "$PK-fix1-measure/measure.mjs"
step measure-after bun --preload "$PRELOAD" "$PK/tools/measure-19.mjs" after
step capture-after env WEAVRA_CAPTURE_REPO="$WT" WEAVRA_CAPTURE_APP="$PK/after/app/weavra-desktop.app" WEAVRA_CAPTURE_OUT="$PK/after/capture" bun --preload "$PRELOAD" "$QA/capture.mjs" --revision "$HEAD" --matrix ledger-plus --case 19
step diff bun "$QA/diff.mjs" --before "$PK/before/capture" --after "$PK/after/capture" --out "$PK/diff"
step supplemental-diff bun "$PK/tools/diff-supplemental.mjs"
for ROUND in 01 02; do
  step accept-scenarios-fix2-"$ROUND" env WEAVRA_CAPTURE_REPO="$WT" WEAVRA_CAPTURE_APP="$PK/after/app/weavra-desktop.app" bun --preload "$PRELOAD" "$QA/assert.mjs" --case 19 --evidence "$PK/qa"
  step verify-packet-fix2-"$ROUND" bun "$QA/assert.mjs" --verify-packet "$PK"
  step diff-check-fix2-"$ROUND" git -C "$WT" diff --check fb97140d "$HEAD"
  if [ "$ROUND" = 01 ]; then
    mv "$PK/qa" "$PK/fix2/qa-round-01"
    cp "$PK/acceptance-verdict.json" "$PK/fix2/acceptance-verdict-01.json"
  fi
done
echo CAPTURE_FIX2_DONE
