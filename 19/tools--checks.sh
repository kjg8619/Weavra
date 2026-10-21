#!/bin/bash
set -eu
export PATH="/Users/kangjingoo/.nvm/versions/node/v24.19.0/bin:$PATH"
PK=/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-19
WT=/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-19
step() {
  NAME=$1; shift
  set +e
  "$@" > "$PK/logs/$NAME.log" 2>&1
  CODE=$?
  set -e
  printf 'STEP %s EXIT=%s\n' "$NAME" "$CODE"
  return "$CODE"
}
cd "$WT/app/t3code"
FILES="apps/web/src/components/settings/ThemeSettings.tsx apps/web/src/components/settings/ThemePreviewCircles.tsx apps/web/src/components/settings/ThemeSelection.test.tsx"
step fmt pnpm exec vp fmt --check $FILES
step lint pnpm exec vp lint $FILES
step typecheck pnpm --filter @t3tools/web typecheck
step accent-stripes bun /Users/kangjingoo/.bun/install/global/node_modules/omo-ai/plugin/skills/frontend/scripts/perfection/check-accent-stripes.ts $FILES
cd apps/web
step focused pnpm exec vp test run --project unit src/components/settings/ThemeSelection.test.tsx src/hooks/useTheme.test.ts src/components/settings/ThemeEditorHost.test.tsx src/components/settings/ThemeImportDialog.test.ts
step diff-check git -C "$WT" diff --check
echo CHECKS_DONE
