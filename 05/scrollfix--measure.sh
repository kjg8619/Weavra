#!/bin/bash
set -e
export PATH="/Users/kangjingoo/.nvm/versions/node/v24.19.0/bin:$PATH"
PK=/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-05
RUN=$PK/scrollfix-run
bash "$RUN/app-gate.sh" > "$RUN/logs/measure.gate"
QA_OUT_UI=$RUN/measurements.json \
WEAVRA_CAPTURE_REPO=/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-05 \
WEAVRA_CAPTURE_APP=$PK/after/app/weavra-desktop.app \
bun "$RUN/measure-runner/scripts/hig/assert.mjs" --case 05 --evidence "$RUN/ev"
