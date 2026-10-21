#!/bin/bash
set -eu
export PATH="/Users/kangjingoo/.nvm/versions/node/v24.19.0/bin:$PATH"
PK=/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-18
QA=/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-01/scripts/hig
BEFORE_WT=/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-18-before
AFTER_WT=/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-18
BEFORE_SHA=$(git -C "$BEFORE_WT" rev-parse HEAD)
AFTER_SHA=$(git -C "$AFTER_WT" rev-parse HEAD)
PRELOAD="$PK/tools/preload-app-gate.mjs"
step() {
  N=$1; shift
  set +e
  "$@" > "$PK/logs/$N.log" 2>&1
  C=$?
  set -e
  printf 'STEP %s EXIT=%s\n' "$N" "$C"
  return "$C"
}
step measure-after bun --preload "$PRELOAD" "$PK/tools/measure-18.mjs" after
step measure-summary bun "$PK/tools/summarize-18.mjs"
step supplemental-diff bun "$PK/tools/diff-forms.mjs"
step capture-before env WEAVRA_CAPTURE_REPO="$BEFORE_WT" WEAVRA_CAPTURE_APP="$PK/before/app/weavra-desktop.app" WEAVRA_CAPTURE_OUT="$PK/before/capture" bun --preload "$PRELOAD" "$QA/capture.mjs" --revision "$BEFORE_SHA" --matrix ledger-plus --case 18
step capture-after env WEAVRA_CAPTURE_REPO="$AFTER_WT" WEAVRA_CAPTURE_APP="$PK/after/app/weavra-desktop.app" WEAVRA_CAPTURE_OUT="$PK/after/capture" bun --preload "$PRELOAD" "$QA/capture.mjs" --revision "$AFTER_SHA" --matrix ledger-plus --case 18
step diff bun "$QA/diff.mjs" --before "$PK/before/capture" --after "$PK/after/capture" --out "$PK/diff"
failed=0
for R in 01 02; do
  if step accept-scenarios-"$R" env WEAVRA_CAPTURE_REPO="$AFTER_WT" WEAVRA_CAPTURE_APP="$PK/after/app/weavra-desktop.app" bun --preload "$PRELOAD" "$QA/assert.mjs" --case 18 --evidence "$PK/qa"; then :; else failed=1; fi
  if step verify-packet-"$R" bun "$QA/assert.mjs" --verify-packet "$PK"; then :; else failed=1; fi
  step diff-check-"$R" git -C "$AFTER_WT" diff --check "$BEFORE_SHA" "$AFTER_SHA"
  if [ "$R" = 01 ]; then
    mkdir -p "$PK/repeat-01/pr-18"
    cp -R "$PK/qa" "$PK/repeat-01/pr-18/qa"
    if [ -f "$PK/acceptance-verdict.json" ]; then cp "$PK/acceptance-verdict.json" "$PK/repeat-01/pr-18/"; fi
    mv "$PK/qa" "$PK/qa-round-01"
  fi
done
if [ "$failed" = 1 ]; then
  echo BLOCKED_SHARED_RUNNER_SELECTOR
  exit 1
fi
echo PIPELINE_FINAL_DONE
