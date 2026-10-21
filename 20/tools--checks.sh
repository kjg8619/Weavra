#!/bin/bash
set -u
export PATH="/Users/kangjingoo/.nvm/versions/node/v24.19.0/bin:$PATH"
export GIT_MASTER=1
WT=/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-20
PK=/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-20
mkdir -p "$PK/logs"
failed=0
step() {
  name=$1; shift
  "$@" > "$PK/logs/$name.log" 2>&1
  code=$?
  printf 'STEP %s EXIT=%s\n' "$name" "$code"
  if [ "$code" -ne 0 ]; then failed=1; fi
}
cd "$WT/app/t3code/apps/web" || exit 1
step tests pnpm exec vp test run --project unit src/confirmDialog.test.ts src/localApi.test.ts src/components/ConfirmDialogHost.test.tsx src/components/settings/ArchivedThreadsPanel.test.tsx src/hooks/useThreadActions.test.ts
cd "$WT/app/t3code" || exit 1
files=(
  packages/contracts/src/ipc.ts
  apps/web/src/confirmDialog.ts apps/web/src/confirmDialog.test.ts apps/web/src/localApi.test.ts
  apps/web/src/components/ConfirmDialogHost.tsx apps/web/src/components/ConfirmDialogHost.test.tsx
  apps/web/src/components/Sidebar.tsx apps/web/src/components/LegacySidebar.tsx
  apps/web/src/components/settings/SettingsPanels.tsx
)
step fmt pnpm exec vp fmt --check "${files[@]}"
step lint pnpm exec vp lint "${files[@]}"
step typecheck-web pnpm --filter @t3tools/web typecheck
step typecheck-contracts pnpm --filter @t3tools/contracts typecheck
step diff-check git -C "$WT" diff --check
printf 'CHECKS_EXIT=%s\n' "$failed"
exit "$failed"
