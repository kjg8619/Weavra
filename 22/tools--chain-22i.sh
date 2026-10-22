#!/bin/bash
# QA-22 round: run every evidence-app step one at a time and stop at the first failure. Each step's exit is printed as CHAIN <step> EXIT=<n>.
set -u
PK=/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-22
W=/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-22
RUNNER=daa942df567e52cf47453535083ff139f10d3885
export PATH="/Users/kangjingoo/.nvm/versions/node/v24.19.0/bin:$PATH"
export GIT_MASTER=1
cd "$PK" || exit 1
step() { local name=$1; shift; "$@"; local code=$?; echo "CHAIN $name EXIT=$code"; [ $code -eq 0 ] || { echo "CHAIN_STOPPED $name"; exit $code; }; }
step measure-after bash -c "HIG_MEASURE_ALLTEXT=1 HIG_MEASURE_APP=$PK/after/app/weavra-desktop.app HIG_MEASURE_OUT=$PK/measure-after bun --preload $PK/tools/preload-app-gate.mjs $PK/tools/measure-22.mjs > $PK/logs/measure-after.log 2>&1"
step measure-parent bash -c "HIG_MEASURE_ALLTEXT=1 HIG_MEASURE_APP=$PK/before/app/weavra-desktop.app HIG_MEASURE_REPO=/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-22-before HIG_MEASURE_OUT=$PK/measure-parent bun --preload $PK/tools/preload-app-gate.mjs $PK/tools/measure-22.mjs > $PK/logs/measure-parent.log 2>&1"
step stress-qa22 bash -c "bun --preload $PK/tools/preload-app-gate.mjs $PK/tools/qa22-stress/stress.mjs > $PK/logs/stress-qa22.log 2>&1 && bun $PK/tools/qa22-stress/analyze-stress.mjs >> $PK/logs/stress-qa22.log 2>&1"
step case21 bash -c "WEAVRA_CAPTURE_REPO=$W WEAVRA_CAPTURE_APP=$PK/after/app/weavra-desktop.app bun --preload $PK/tools/preload-app-gate.mjs /Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-01/scripts/hig/assert.mjs --case 21 --evidence $PK/regression-21 > $PK/logs/regression-21.log 2>&1"
step capture bash -c "RUNNER=$RUNNER bash $PK/tools/capture-accept.sh capture_pr 22 > $PK/logs/chain-capture.log 2>&1"
step capture-latin bash -c "bun $PK/tools/capture-latin-22.mjs $PK/after/capture/capture-manifest.json $PK/capture-latin > $PK/logs/capture-latin.log 2>&1"
step accept-01 bash -c "RUNNER=$RUNNER bash $PK/tools/capture-accept.sh accept_pr 22 01 > $PK/logs/chain-accept-01.log 2>&1 && ! grep -q 'EXIT=[1-9]' $PK/logs/chain-accept-01.log"
step accept-02 bash -c "RUNNER=$RUNNER bash $PK/tools/capture-accept.sh accept_pr 22 02 > $PK/logs/chain-accept-02.log 2>&1 && ! grep -q 'EXIT=[1-9]' $PK/logs/chain-accept-02.log"
echo CHAIN_DONE
