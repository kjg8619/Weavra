#!/bin/bash
# accept_pr 02 (plan section 3.6) recorded verbatim, plus the harness-only packet verification.
set -u
source /tmp/hig02-env.sh
E=/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra
AFTER_WT=/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-02
QA="$AFTER_WT/scripts/hig"
BEFORE_SHA=bb7649c97402d9a853f91b3a987f9fa48aa970eb
AFTER_SHA="$(git -C "$AFTER_WT" rev-parse HEAD)"
AFTER_APP="$(ls -d "$E/pr-02/after/app"/*.app | head -1)"
NN=02
echo "AFTER_SHA=$AFTER_SHA AFTER_APP=$AFTER_APP"
echo "== accept_pr $NN step 1: assert.mjs --case"
WEAVRA_CAPTURE_REPO="$AFTER_WT" WEAVRA_CAPTURE_APP="$AFTER_APP" bun "$QA/assert.mjs" --case "$NN" --evidence "$E/pr-$NN/qa" > "$E/pr-02/accept-step1.out" 2>&1; echo "assert-case-exit=$?"; head -c 600 "$E/pr-02/accept-step1.out"; echo
echo "== accept_pr $NN step 2: assert.mjs --verify-packet (product mode, as written)"
bun "$QA/assert.mjs" --verify-packet "$E/pr-$NN" > "$E/pr-02/accept-step2.out" 2>&1; echo "assert-verify-packet-exit=$?"; head -c 600 "$E/pr-02/accept-step2.out"; echo
echo "== accept_pr $NN step 3: git diff --check"
git -C "$AFTER_WT" diff --check "$BEFORE_SHA" "$AFTER_SHA"; echo "git-diff-check-exit=$?"
echo "== supplemental: assert.mjs --verify-packet --harness-only (packet structure/provenance)"
bun "$QA/assert.mjs" --verify-packet "$E/pr-$NN" --harness-only > "$E/pr-02/accept-harness-only.out" 2>&1; echo "assert-verify-packet-harness-only-exit=$?"; head -c 400 "$E/pr-02/accept-harness-only.out"; echo
echo "== diff summary"
bun -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const ch=d.pairs.filter(p=>p.result.diffRatio>0);console.log(JSON.stringify({pairs:d.pairs.length,failures:d.failures.length,changed:ch.length,identical:d.pairs.length-ch.length,maxDiff:Math.max(...d.pairs.map(p=>p.result.diffRatio)),dimensionsMismatch:d.pairs.filter(p=>!p.result.dimensionsMatch).length}));for(const p of ch.sort((a,b)=>b.result.diffRatio-a.result.diffRatio)) console.log(p.file, p.result.diffRatio.toFixed(5), "hotspots="+p.result.hotspots.length)' "$E/pr-02/diff/pairs.json"
echo "ACCEPT_PR_02_DONE"
