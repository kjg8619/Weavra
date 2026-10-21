#!/bin/bash
set -eu
PK=/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-21
HISTORY="$PK/history-cleanup-failure"
test ! -e "$HISTORY"
mkdir "$HISTORY"
for path in before/capture after/capture diff qa qa-round-01 review; do
  mkdir -p "$HISTORY/$(dirname "$path")"
  mv "$PK/$path" "$HISTORY/$path"
done
for path in acceptance-verdict.json acceptance-verdict-01.json acceptance-verdict-02.json diff-inspection.md; do
  mv "$PK/$path" "$HISTORY/$path"
done
mkdir "$HISTORY/logs"
for name in capture-before capture-after diff accept-scenarios-01 accept-scenarios-02 verify-packet-01 verify-packet-02 diff-check-01 diff-check-02 runner-identity; do
  mv "$PK/logs/$name.log" "$HISTORY/logs/$name.log"
done
bash "$PK/tools/capture-accept.sh" capture_pr 21
bash "$PK/tools/capture-accept.sh" accept_pr 21 01
bash "$PK/tools/capture-accept.sh" accept_pr 21 02
printf 'PACKET_REGENERATED_AND_ACCEPTED\n'
