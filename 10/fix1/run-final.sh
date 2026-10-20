#!/bin/bash
set -eu
export PATH="/Users/kangjingoo/.nvm/versions/node/v24.19.0/bin:$PATH"
O=/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-10-fix1-measure
bun "$O/measure.mjs" > "$O/logs/supported.log" 2>&1
printf 'SUPPORTED_EXIT=0\n'
bun "$O/measure.mjs" --unsupported > "$O/logs/unsupported.log" 2>&1
printf 'UNSUPPORTED_EXIT=0\n'
bun "$O/summarize.mjs" > "$O/logs/summary.log" 2>&1
printf 'SUMMARY_EXIT=0\n'
bash "$O/capture-accept.sh"
printf 'FINAL_PIPELINE_DONE\n'
