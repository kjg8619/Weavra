#!/bin/bash
export PATH="/Users/kangjingoo/.nvm/versions/node/v24.19.0/bin:$PATH"
PK=/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-05; QA=$PK/scrollfix-run/runner/scripts/hig; L=$PK/logs
W=/Users/kangjingoo/Workspace/tool/Weavra-worktrees
AFTER_WT=$W/hig-05; BEFORE_WT=$W/hig-04; BEFORE_SHA=$(git -C $BEFORE_WT rev-parse HEAD); AFTER_SHA=$(git -C $AFTER_WT rev-parse HEAD)
AFTER_APP=$PK/after/app/weavra-desktop.app
SUP=$PK/superseded-before-scrollfix-e63c4659; mkdir -p $SUP/logs
cd $PK
for x in after/capture after/package after/app diff qa repeat-01 acceptance-verdict.json publication-verification.json; do [ -e $PK/$x ] && { mkdir -p $SUP/$(dirname $x); mv $PK/$x $SUP/$x; }; done
for f in $L/accept-scenarios-0*.log $L/verify-packet-*.log $L/diff-check-0*.log $L/build-after.log $L/capture-after.log $L/diff.log $L/focused-tests.log; do [ -e $f ] && mv $f $SUP/logs/; done
gate() { for i in $(seq 1 1800); do n=$(ps -axo command | grep 'MacOS/weavra-desktop' | grep '/.omo/evidence/' | grep -v grep | wc -l | tr -d ' '); [ "$n" = 0 ] && { echo "GATE clear"; return 0; }; sleep 1; done; echo "GATE timeout"; return 1; }
step() { N=$1; shift; "$@" > $L/$N.log 2>&1; C=$?; echo "STEP $N EXIT=$C"; tail -2 $L/$N.log | cut -c1-300; return $C; }
echo "AFTER=$AFTER_SHA DIRTY=$(git -C $AFTER_WT status --porcelain | wc -l)"
step focused-tests bash -c "cd $AFTER_WT/app/t3code/apps/web && pnpm exec vp test run --project unit src/composerDraftStore.test.ts src/components/ChatView.logic.test.ts src/components/chat/DraftHeroHeadline.test.tsx" || exit 1
step build-after bash -c "mkdir -p $PK/after/package $PK/after/app && cd $AFTER_WT/app/t3code && T3CODE_DESKTOP_SIGNED=false T3CODE_DESKTOP_SKIP_BUILD=false pnpm run dist:desktop:artifact --platform mac --target zip --arch arm64 --output-dir $PK/after/package && /usr/bin/ditto -x -k $PK/after/package/*-arm64.zip $PK/after/app && test -x $AFTER_APP/Contents/MacOS/weavra-desktop" || exit 1
echo "AFTER_ASAR=$(shasum -a 256 $AFTER_APP/Contents/Resources/app.asar | cut -c1-64)"
gate || exit 1
step capture-after env WEAVRA_CAPTURE_REPO=$AFTER_WT WEAVRA_CAPTURE_APP=$AFTER_APP WEAVRA_CAPTURE_OUT=$PK/after/capture bun $QA/capture.mjs --revision $AFTER_SHA --matrix ledger-plus --case 05 || exit 1
step diff bun $QA/diff.mjs --before $PK/before/capture --after $PK/after/capture --out $PK/diff || exit 1
for R in 01 02; do
  gate || exit 1
  step accept-scenarios-$R env WEAVRA_CAPTURE_REPO=$AFTER_WT WEAVRA_CAPTURE_APP=$AFTER_APP bun $QA/assert.mjs --case 05 --evidence $PK/qa || exit 1
  step verify-packet-$R bun $QA/assert.mjs --verify-packet $PK || exit 1
  step diff-check-$R git -C $AFTER_WT diff --check $BEFORE_SHA $AFTER_SHA || exit 1
  if [ $R = 01 ]; then mkdir -p $PK/repeat-01/pr-05 && cp -R $PK/qa $PK/repeat-01/pr-05/qa && cp $PK/acceptance-verdict.json $PK/repeat-01/pr-05/ 2>/dev/null; rm -rf $PK/qa; fi
done
echo PIPELINE_DONE
