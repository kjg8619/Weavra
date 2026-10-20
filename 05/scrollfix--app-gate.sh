#!/bin/bash
# Only observe other evidence apps. Never terminate an app found by matching.
for i in $(seq 1 900); do
  n=$(ps -axo command | grep 'MacOS/weavra-desktop' | grep '/.omo/evidence/' | grep -v grep | wc -l | tr -d ' ')
  if [ "$n" = 0 ]; then
    n=$(ps -axo command | grep 'MacOS/weavra-desktop' | grep '/.omo/evidence/' | grep -v grep | wc -l | tr -d ' ')
    if [ "$n" = 0 ]; then printf 'GATE clear %s\n' "$(date -u +%FT%TZ)"; exit 0; fi
  fi
  sleep 2
done
echo 'GATE timeout'
exit 1
