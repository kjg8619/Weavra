#!/bin/bash
set -eu
export PATH="/Users/kangjingoo/.nvm/versions/node/v24.19.0/bin:$PATH"
export GIT_MASTER=1
WT=/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-21
PK=/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-21
LOG_DIR=${HIG_CHECK_LOG_DIR:-"$PK/logs"}
mkdir -p "$LOG_DIR"
step() {
  NAME=$1
  shift
  set +e
  "$@" > "$LOG_DIR/$NAME.log" 2>&1
  CODE=$?
  set -e
  printf 'GATE %s EXIT=%s\n' "$NAME" "$CODE"
  return "$CODE"
}
cd "$WT/app/t3code"
OWNED=(
  apps/web/src/components/ChatView.tsx
  apps/web/src/components/chat/MessagesTimeline.tsx
  apps/web/src/components/GitActionsControl.tsx
  apps/web/src/components/chat/PanelLayoutControls.tsx
  apps/desktop/src/window/DesktopWindow.test.ts
)
step fmt pnpm exec vp fmt --check "${OWNED[@]}"
step lint pnpm exec vp lint "${OWNED[@]}"
step typecheck-web pnpm --filter @t3tools/web typecheck
step typecheck-desktop pnpm --filter @t3tools/desktop typecheck
cd apps/web
step tests-web pnpm exec vp test run --project unit \
  src/components/chat/MessagesTimeline.test.tsx \
  src/components/chat/MessagesTimeline.logic.test.ts \
  src/components/GitActionsControl.logic.test.ts \
  src/components/chat/ProviderStatusBanner.test.tsx
cd "$WT"
step diff-check git diff --check
printf 'STATIC_GATES_DONE\n'
