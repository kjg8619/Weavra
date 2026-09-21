#!/usr/bin/env bash
# Source this file, or pass a command to execute with the trusted local binary.
set -euo pipefail
WEAVRA_PRODUCT_ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
export T3_WEAVRA_EXECUTABLE="$WEAVRA_PRODUCT_ROOT/runtime/pi/packages/company-runtime/bin/weavra"
if [[ ! -x "$T3_WEAVRA_EXECUTABLE" ]]; then
  printf 'Missing executable: %s\n' "$T3_WEAVRA_EXECUTABLE" >&2
  return 1 2>/dev/null || exit 1
fi
if [[ "${BASH_SOURCE[0]}" = "$0" ]]; then
  if (( $# )); then
    exec "$@"
  else
    printf 'export T3_WEAVRA_EXECUTABLE=%q\n' "$T3_WEAVRA_EXECUTABLE"
  fi
fi
