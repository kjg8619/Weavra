#!/bin/bash
set -eu
export PATH="/Users/kangjingoo/.nvm/versions/node/v24.19.0/bin:$PATH"
PK=/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-17
QA=/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-01/scripts/hig
WT=/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-17
MEASURE=/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-17-fix1-measure
PRELOAD="$PK/tools/preload-app-gate.mjs"
SHA=$(git -C "$WT" rev-parse HEAD)
step() {
  name=$1; shift
  set +e
  "$@" > "$PK/logs/$name.log" 2>&1
  code=$?
  set -e
  printf 'STEP %s EXIT=%s\n' "$name" "$code"
  return "$code"
}
step measure-fix1 bun --preload "$PRELOAD" "$PK/tools/measure-17-fix1.mjs" after
cp -R "$MEASURE" "$PK/measure"
step capture-after env WEAVRA_CAPTURE_REPO="$WT" WEAVRA_CAPTURE_APP="$PK/after/app/weavra-desktop.app" WEAVRA_CAPTURE_OUT="$PK/after/capture" bun --preload "$PRELOAD" "$QA/capture.mjs" --revision "$SHA" --matrix ledger-plus --case 17
step diff bun "$QA/diff.mjs" --before "$PK/before/capture" --after "$PK/after/capture" --out "$PK/diff"
step supplemental-diff bun "$PK/tools/diff-archives.mjs"
step accept-fix1 env WEAVRA_CAPTURE_REPO="$WT" WEAVRA_CAPTURE_APP="$PK/after/app/weavra-desktop.app" bun --preload "$PRELOAD" "$QA/assert.mjs" --case 17 --evidence "$PK/qa"
step verify-fix1 bun "$QA/assert.mjs" --verify-packet "$PK"
step diff-check-fix1 git -C "$WT" diff --check 878a9162cd8ce64b39c36531d772cdbd3885b658 "$SHA"
step measure-summary bun "$PK/tools/summarize-measure.mjs"
echo FIX1_PIPELINE_DONE
