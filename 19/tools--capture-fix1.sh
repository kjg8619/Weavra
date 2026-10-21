#!/bin/bash
set -eu
export PATH="/Users/kangjingoo/.nvm/versions/node/v24.19.0/bin:$PATH"
PK=/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-19
WT=/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-19
QA=/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-01/scripts/hig
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
echo "HEAD=$HEAD RUNNER=$(git -C "$QA/../.." rev-parse HEAD)"
step measure-after bun --preload "$PRELOAD" "$PK/tools/measure-19.mjs" after
step capture-after env WEAVRA_CAPTURE_REPO="$WT" WEAVRA_CAPTURE_APP="$PK/after/app/weavra-desktop.app" WEAVRA_CAPTURE_OUT="$PK/after/capture" bun --preload "$PRELOAD" "$QA/capture.mjs" --revision "$HEAD" --matrix ledger-plus --case 19
step diff bun "$QA/diff.mjs" --before "$PK/before/capture" --after "$PK/after/capture" --out "$PK/diff"
step supplemental-diff bun "$PK/tools/diff-supplemental.mjs"
step accept-scenarios-fix1 env WEAVRA_CAPTURE_REPO="$WT" WEAVRA_CAPTURE_APP="$PK/after/app/weavra-desktop.app" bun --preload "$PRELOAD" "$QA/assert.mjs" --case 19 --evidence "$PK/qa"
step verify-packet-fix1 bun "$QA/assert.mjs" --verify-packet "$PK"
step diff-check-fix1 git -C "$WT" diff --check fb97140d "$HEAD"
echo CAPTURE_FIX1_DONE
