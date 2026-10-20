#!/bin/bash
# Observe only; never close another run's evidence app or the installed app.
occupied() {
  ps -axo pid,command | awk '/\/\.omo\/evidence\// && /\/MacOS\/weavra-desktop([[:space:]]|$)/ && !/awk/ { print }'
}
start=$SECONDS
clear_since=$SECONDS
while (( SECONDS - start < 600 )); do
  rows="$(occupied)"
  if [ -z "$rows" ]; then
    if (( SECONDS - clear_since >= 10 )); then
      printf 'GATE_CLEAR %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
      exit 0
    fi
  else
    clear_since=$SECONDS
  fi
  if (( SECONDS - start == 0 )); then printf 'GATE_WAIT %s\n' "$rows"; fi
  sleep 2
done
printf 'GATE_TIMEOUT %s\n' "$(occupied)"
exit 1
