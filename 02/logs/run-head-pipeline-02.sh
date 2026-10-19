#!/bin/bash
# Head rebuild after the AppSidebarLayout fix. The parent build/capture in this
# packet is reused unchanged (parent SHA and provenance are in its manifest).
set -u
source /tmp/hig02-env.sh
E=/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra
WT=/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-02
QA="$WT/scripts/hig"
BEFORE_SHA=bb7649c97402d9a853f91b3a987f9fa48aa970eb
AFTER_SHA="$(git -C "$WT" rev-parse hig/02-foundations)"
echo "BEFORE_SHA=$BEFORE_SHA AFTER_SHA=$AFTER_SHA"
(cd "$WT/app/t3code" && echo "pnpm in app/t3code: $(pnpm --version)"); node --version; bun --version
build_capture_app() {
  WT_="$1"; DEST="$2"
  mkdir -p "$DEST/package" "$DEST/app"
  ( cd "$WT_/app/t3code" && T3CODE_DESKTOP_SIGNED=false T3CODE_DESKTOP_SKIP_BUILD=false pnpm run dist:desktop:artifact --platform mac --target zip --arch arm64 --output-dir "$DEST/package" ) || return
  VERSION="$(cd "$WT_/app/t3code" && node -p "require('./apps/server/package.json').version")"
  ZIP="$DEST/package/Weavra-$VERSION-arm64.zip"; test -f "$ZIP" || return 1
  /usr/bin/ditto -x -k "$ZIP" "$DEST/app" || return
  APP="$(ls -d "$DEST/app"/*.app | head -1)"; test -x "$APP/Contents/MacOS/weavra-desktop" || return 1
  /usr/bin/shasum -a 256 "$APP/Contents/Resources/app.asar" | tee "$DEST/asar.sha256"
}
step() { echo "=== $1 @ $(date -u +%FT%TZ)"; }
git -C "$WT" checkout -q hig/02-foundations; git -C "$WT" status --short | head -3
step "build after"
build_capture_app "$WT" "$E/pr-02/after" > "$E/pr-02/after-build.log" 2>&1; rc=$?; echo "after-build-exit=$rc"; tail -1 "$E/pr-02/after-build.log"
[ $rc -eq 0 ] || { echo "AFTER_BUILD_FAILED"; exit 6; }
AFTER_APP="$(ls -d "$E/pr-02/after/app"/*.app | head -1)"
BEFORE_APP="$(ls -d "$E/pr-02/before/app"/*.app | head -1)"
step "capture after"
WEAVRA_CAPTURE_REPO="$WT" WEAVRA_CAPTURE_APP="$AFTER_APP" WEAVRA_CAPTURE_OUT="$E/pr-02/after/capture" bun "$QA/capture.mjs" --revision "$AFTER_SHA" --matrix ledger-plus --case 02 > "$E/pr-02/after-capture.log" 2>&1; rc=$?; echo "after-capture-exit=$rc"; tail -1 "$E/pr-02/after-capture.log"
[ $rc -eq 0 ] || { echo "AFTER_CAPTURE_FAILED"; exit 7; }
step "diff"
bun "$QA/diff.mjs" --before "$E/pr-02/before/capture" --after "$E/pr-02/after/capture" --out "$E/pr-02/diff" > "$E/pr-02/diff.log" 2>&1; rc=$?; echo "diff-exit=$rc"
[ $rc -eq 0 ] || { echo "DIFF_FAILED"; exit 8; }
step "accept"
bash "$E/pr-02/run-accept-02.sh" 2>&1 | tee "$E/pr-02/run-accept-02.log" | grep -E "exit=|AFTER_SHA"
step "measure after"
WEAVRA_CAPTURE_REPO="$WT" WEAVRA_CAPTURE_APP="$AFTER_APP" WEAVRA_MEASURE_OUT="$E/pr-02/qa" bun "$E/pr-02/measure-02.mjs" > "$E/pr-02/measure-02.log" 2>&1; echo "measure-after-exit=$?"; tail -1 "$E/pr-02/measure-02.log"
step "motion after"
WEAVRA_CAPTURE_REPO="$WT" WEAVRA_CAPTURE_APP="$AFTER_APP" WEAVRA_MEASURE_OUT="$E/pr-02/qa/motion-clean" bun "$E/pr-02/motion-02.mjs" > "$E/pr-02/motion-02.log" 2>&1; echo "motion-after-exit=$?"; tail -1 "$E/pr-02/motion-02.log"
step "measure before"
git -C "$WT" checkout -q --detach "$BEFORE_SHA"
WEAVRA_CAPTURE_REPO="$WT" WEAVRA_CAPTURE_APP="$BEFORE_APP" WEAVRA_MEASURE_OUT="$E/pr-02/qa-before" bun "$E/pr-02/measure-02.mjs" > "$E/pr-02/measure-02-before.log" 2>&1; echo "measure-before-exit=$?"; tail -1 "$E/pr-02/measure-02-before.log"
git -C "$WT" checkout -q hig/02-foundations; echo "worktree-head=$(git -C "$WT" rev-parse --short HEAD)"
echo "PIPELINE_02_DONE"
