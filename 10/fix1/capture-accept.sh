#!/bin/bash
set -eu
export PATH="/Users/kangjingoo/.nvm/versions/node/v24.19.0/bin:$PATH"
W=/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-10
E=/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra
O=$E/pr-10-fix1-measure
P=$E/pr-10-fix1/pr-10
Q=$E/qa-10-run/runner/scripts/hig
export WEAVRA_CAPTURE_REPO=$W
export WEAVRA_CAPTURE_APP=$P/after/app/weavra-desktop.app
export WEAVRA_CAPTURE_OUT=$P/after/capture
bun "$O/guarded-run.mjs" "$Q/capture.mjs" --revision "$(git -C "$W" rev-parse HEAD)" --matrix ledger-plus --case 10 > "$O/logs/capture.log" 2>&1
printf 'CAPTURE_EXIT=0\n'
bun "$Q/diff.mjs" --before "$P/before/capture" --after "$P/after/capture" --out "$P/diff" > "$O/logs/diff.log" 2>&1
printf 'DIFF_EXIT=0\n'
for r in 01 02; do
  bun "$O/guarded-run.mjs" "$Q/assert.mjs" --case 10 --evidence "$P/qa" > "$O/logs/accept-$r.log" 2>&1
  printf 'ACCEPT_%s_EXIT=0\n' "$r"
  bun "$Q/assert.mjs" --verify-packet "$P" > "$O/logs/verify-$r.log" 2>&1
  printf 'VERIFY_%s_EXIT=0\n' "$r"
  git -C "$W" diff --check 489dd542 HEAD
  if [ "$r" = 01 ]; then
    mkdir -p "$P/repeat-01/pr-10"
    cp -R "$P/qa" "$P/repeat-01/pr-10/"
    cp "$P/acceptance-verdict.json" "$P/repeat-01/pr-10/"
  fi
done
printf 'CAPTURE_ACCEPT_DONE\n'
