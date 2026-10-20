#!/bin/bash
export PATH="/Users/kangjingoo/.nvm/versions/node/v24.19.0/bin:$PATH"
PK=/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-08-fix3; M=$PK/measure; mkdir -p $M/logs
TAG=$1
for i in $(seq 1 600); do n=$(ps -axo command | grep 'MacOS/weavra-desktop' | grep '/.omo/evidence/' | grep -v grep | wc -l | tr -d " "); [ "$n" = 0 ] && break; sleep 2; done
echo "gate=$n" > $M/logs/$TAG.gate
rm -rf $M/ev-$TAG; mkdir -p $M/dir-$TAG
QA_PART=$TAG QA_DIR=$M/dir-$TAG QA_OUT=$M/$TAG.json WEAVRA_CAPTURE_REPO=/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-08 WEAVRA_CAPTURE_APP=$PK/after/app/weavra-desktop.app bun $M/scripts/hig/assert.mjs --case 08 --evidence $M/ev-$TAG > $M/logs/$TAG.log 2>&1
echo "EXIT=$?" > $M/logs/$TAG.exit
pgrep -f "$PK/after/app" | wc -l | sed 's/^/LEFTOVER=/' >> $M/logs/$TAG.exit
