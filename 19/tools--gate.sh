#!/bin/bash
set -eu
occupied() {
  ps -axo pid,command | awk '/\/\.omo\/evidence\// && /\/MacOS\/weavra-desktop([[:space:]]|$)/ && !/awk/ { print }'
}
start=$SECONDS
while (( SECONDS - start < 600 )); do
  rows="$(occupied)"
  if [ -z "$rows" ]; then
    rows="$(occupied)"
    if [ -z "$rows" ]; then
      printf 'GATE_CLEAR %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
      exit 0
    fi
  fi
  if (( SECONDS - start == 0 )); then printf 'GATE_WAIT %s\n' "$rows"; fi
  sleep 2
done
printf 'GATE_TIMEOUT %s\n' "$(occupied)"
exit 1
