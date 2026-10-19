#!/bin/bash
# capture_pr 02 (plan section 3.6), recorded verbatim. Deviation: the artifact
# builder names the bundle weavra-desktop.app, so the bundle path is resolved.
set -u
source /tmp/hig02-env.sh
E=/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra
WT=/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-02
QA="$WT/scripts/hig"
BEFORE_SHA=bb7649c97402d9a853f91b3a987f9fa48aa970eb
AFTER_SHA="$(git -C "$WT" rev-parse hig/02-foundations)"
echo "BEFORE_SHA=$BEFORE_SHA AFTER_SHA=$AFTER_SHA"
node --version; pnpm --version; bun --version

build_capture_app() {
  WT_="$1"
  DEST="$2"
  mkdir -p "$DEST/package" "$DEST/app"
  (
    cd "$WT_/app/t3code" &&
    T3CODE_DESKTOP_SIGNED=false T3CODE_DESKTOP_SKIP_BUILD=false \
      pnpm run dist:desktop:artifact \
      --platform mac --target zip --arch arm64 --output-dir "$DEST/package"
  ) || return
  VERSION="$(cd "$WT_/app/t3code" && node -p "require('./apps/server/package.json').version")"
  ZIP="$DEST/package/Weavra-$VERSION-arm64.zip"
  test -f "$ZIP" || return 1
  /usr/bin/ditto -x -k "$ZIP" "$DEST/app" || return
  APP="$(ls -d "$DEST/app"/*.app | head -1)"
  test -x "$APP/Contents/MacOS/weavra-desktop" || return 1
  /usr/bin/shasum -a 256 "$APP/Contents/Resources/app.asar" | tee "$DEST/asar.sha256"
}

step() { echo "=== $1 @ $(date -u +%FT%TZ)"; }

step "checkout parent (detached) in task worktree"
git -C "$WT" checkout -q --detach "$BEFORE_SHA" || { echo "CHECKOUT_PARENT_FAILED"; exit 2; }
git -C "$WT" status --short | head -5
step "build before"
build_capture_app "$WT" "$E/pr-02/before" > "$E/pr-02/before-build.log" 2>&1; rc=$?; echo "before-build-exit=$rc"; tail -3 "$E/pr-02/before-build.log"
[ $rc -eq 0 ] || { git -C "$WT" checkout -q hig/02-foundations; echo "BEFORE_BUILD_FAILED"; exit 3; }
BEFORE_APP="$(ls -d "$E/pr-02/before/app"/*.app | head -1)"
step "capture before"
WEAVRA_CAPTURE_REPO="$WT" WEAVRA_CAPTURE_APP="$BEFORE_APP" WEAVRA_CAPTURE_OUT="$E/pr-02/before/capture" \
  bun "$QA/capture.mjs" --revision "$BEFORE_SHA" --matrix ledger-plus --case 02 > "$E/pr-02/before-capture.log" 2>&1; rc=$?; echo "before-capture-exit=$rc"; tail -2 "$E/pr-02/before-capture.log"
step "checkout head"
git -C "$WT" checkout -q hig/02-foundations || { echo "CHECKOUT_HEAD_FAILED"; exit 4; }
git -C "$WT" rev-parse HEAD
[ $rc -eq 0 ] || { echo "BEFORE_CAPTURE_FAILED"; exit 5; }
step "build after"
build_capture_app "$WT" "$E/pr-02/after" > "$E/pr-02/after-build.log" 2>&1; rc=$?; echo "after-build-exit=$rc"; tail -3 "$E/pr-02/after-build.log"
[ $rc -eq 0 ] || { echo "AFTER_BUILD_FAILED"; exit 6; }
AFTER_APP="$(ls -d "$E/pr-02/after/app"/*.app | head -1)"
step "capture after"
WEAVRA_CAPTURE_REPO="$WT" WEAVRA_CAPTURE_APP="$AFTER_APP" WEAVRA_CAPTURE_OUT="$E/pr-02/after/capture" \
  bun "$QA/capture.mjs" --revision "$AFTER_SHA" --matrix ledger-plus --case 02 > "$E/pr-02/after-capture.log" 2>&1; rc=$?; echo "after-capture-exit=$rc"; tail -2 "$E/pr-02/after-capture.log"
[ $rc -eq 0 ] || { echo "AFTER_CAPTURE_FAILED"; exit 7; }
step "diff"
bun "$QA/diff.mjs" --before "$E/pr-02/before/capture" --after "$E/pr-02/after/capture" --out "$E/pr-02/diff" > "$E/pr-02/diff.log" 2>&1; rc=$?; echo "diff-exit=$rc"; tail -3 "$E/pr-02/diff.log"
[ $rc -eq 0 ] || { echo "DIFF_FAILED"; exit 8; }
echo "CAPTURE_PR_02_DONE"
