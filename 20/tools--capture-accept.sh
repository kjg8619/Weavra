#!/bin/bash
set -eu
export PATH="/Users/kangjingoo/.nvm/versions/node/v24.19.0/bin:$PATH"
export GIT_MASTER=1
PK=/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-20
WT=/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-20
BEFORE_WT=/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-20-before
QA=/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-01/scripts/hig
PRELOAD="$PK/tools/preload-app-gate.mjs"
HEAD=$(git -C "$WT" rev-parse HEAD)
BASE=$(git -C "$BEFORE_WT" rev-parse HEAD)
test "$(git -C "$QA/../.." rev-parse HEAD)" = 7bc326a366fe5936f850afbd414809f50e4d0841
test "$(git -C "$WT" ls-remote origin refs/heads/hig/19-theme-selection | cut -f1)" = "$BASE"
test -f "$PK/state44-regression/receipt.json"
test -f "$PK/measure-after/summary.json"
step() {
  NAME=$1; shift
  set +e
  "$@" > "$PK/logs/$NAME.log" 2>&1
  CODE=$?
  set -e
  printf 'STEP %s EXIT=%s\n' "$NAME" "$CODE"
  return "$CODE"
}
step capture-before env WEAVRA_CAPTURE_REPO="$BEFORE_WT" WEAVRA_CAPTURE_APP="$PK/before/app/weavra-desktop.app" WEAVRA_CAPTURE_OUT="$PK/before/capture" bun --preload "$PRELOAD" "$QA/capture.mjs" --revision "$BASE" --matrix ledger-plus --case 20
step capture-after env WEAVRA_CAPTURE_REPO="$WT" WEAVRA_CAPTURE_APP="$PK/after/app/weavra-desktop.app" WEAVRA_CAPTURE_OUT="$PK/after/capture" bun --preload "$PRELOAD" "$QA/capture.mjs" --revision "$HEAD" --matrix ledger-plus --case 20
step diff bun "$QA/diff.mjs" --before "$PK/before/capture" --after "$PK/after/capture" --out "$PK/diff"
for ROUND in 01 02; do
  step accept-scenarios-"$ROUND" env WEAVRA_CAPTURE_REPO="$WT" WEAVRA_CAPTURE_APP="$PK/after/app/weavra-desktop.app" bun --preload "$PRELOAD" "$QA/assert.mjs" --case 20 --evidence "$PK/qa"
  step verify-packet-"$ROUND" bun "$QA/assert.mjs" --verify-packet "$PK"
  step diff-check-"$ROUND" git -C "$WT" diff --check "$BASE" "$HEAD"
  cp "$PK/acceptance-verdict.json" "$PK/acceptance-verdict-$ROUND.json"
  if [ "$ROUND" = 01 ]; then
    mkdir -p "$PK/repeat-01/pr-20"
    cp -R "$PK/qa" "$PK/repeat-01/pr-20/"
    cp "$PK/acceptance-verdict.json" "$PK/repeat-01/pr-20/"
    mv "$PK/qa" "$PK/qa-round-01"
  fi
done
printf 'CAPTURE_ACCEPT_DONE\n'
