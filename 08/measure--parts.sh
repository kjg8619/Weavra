#!/bin/bash
M=/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-08-fix3/measure
for p in model address palette composer; do bash $M/runq.sh $p; done
echo done > $M/logs/parts.done
