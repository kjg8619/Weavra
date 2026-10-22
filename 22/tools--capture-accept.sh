#!/bin/bash
set -eu
export PATH="/Users/kangjingoo/.nvm/versions/node/v24.19.0/bin:$PATH"
export GIT_MASTER=1
PK=/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-22
WT=/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-22
BEFORE_WT=/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-22-before
QA=/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-01/scripts/hig
PRELOAD="$PK/tools/preload-app-gate.mjs"
: "${RUNNER:?set RUNNER to the lead-authorized hig-01 SHA}"
HEAD=$(git -C "$WT" rev-parse HEAD)
BASE=$(git -C "$BEFORE_WT" rev-parse HEAD)
test "$BASE" = 245a9efdfee4e949a5d312798bcdbf31ed0c1675
test "$(git -C "$QA/../.." rev-parse HEAD)" = "$RUNNER"
test -z "$(git -C "$QA/../.." status --porcelain --untracked-files=no)"
test -z "$(git -C "$WT" status --porcelain --untracked-files=no)"
test "$(cat "$PK/after/revision.txt")" = "$HEAD"
test "$(cat "$PK/before/revision.txt")" = "$BASE"
test ! -s "$PK/before/tracked-diff.patch"
test ! -s "$PK/after/tracked-diff.patch"
step() {
  NAME=$1
  shift
  set +e
  "$@" > "$PK/logs/$NAME.log" 2>&1
  CODE=$?
  set -e
  printf 'GATE %s EXIT=%s\n' "$NAME" "$CODE"
  return "$CODE"
}
capture_pr() {
  test "$1" = 22
  step runner-identity git -C "$WT" diff --exit-code "$RUNNER" HEAD -- scripts/hig
  step capture-before env WEAVRA_CAPTURE_REPO="$BEFORE_WT" \
    WEAVRA_CAPTURE_APP="$PK/before/app/weavra-desktop.app" WEAVRA_CAPTURE_OUT="$PK/before/capture" \
    bun --preload "$PRELOAD" "$QA/capture.mjs" --revision "$BASE" --matrix ledger-plus --case 22
  step capture-after env WEAVRA_CAPTURE_REPO="$WT" \
    WEAVRA_CAPTURE_APP="$PK/after/app/weavra-desktop.app" WEAVRA_CAPTURE_OUT="$PK/after/capture" \
    bun --preload "$PRELOAD" "$QA/capture.mjs" --revision "$HEAD" --matrix ledger-plus --case 22
  step diff bun "$QA/diff.mjs" --before "$PK/before/capture" --after "$PK/after/capture" --out "$PK/diff"
  printf 'CAPTURE_PR_22_DONE\n'
}
accept_pr() {
  test "$1" = 22
  ROUND=$2
  test "$ROUND" = 01 || test "$ROUND" = 02
  step accept-scenarios-"$ROUND" env WEAVRA_CAPTURE_REPO="$WT" \
    WEAVRA_CAPTURE_APP="$PK/after/app/weavra-desktop.app" \
    bun --preload "$PRELOAD" "$QA/assert.mjs" --case 22 --evidence "$PK/qa"
  step verify-packet-"$ROUND" bun "$QA/assert.mjs" --verify-packet "$PK"
  step diff-check-"$ROUND" git -C "$WT" diff --check "$BASE" "$HEAD"
  cp "$PK/acceptance-verdict.json" "$PK/acceptance-verdict-$ROUND.json"
  if test "$ROUND" = 01; then
    test ! -e "$PK/qa-round-01"
    mv "$PK/qa" "$PK/qa-round-01"
  fi
  printf 'ACCEPT_PR_22_ROUND_%s_DONE\n' "$ROUND"
}
MODE=$1
shift
case "$MODE" in
  capture_pr) capture_pr "$@" ;;
  accept_pr) accept_pr "$@" ;;
  *) printf 'Expected capture_pr 22 or accept_pr 22 01|02\n' >&2; exit 2 ;;
esac
