# Todo 13 draft provenance

The existing hig-13 worktree was on hig/13-snapshot-copy at d53d63196fc8a07e4c32aa42584d2f36a499bb17.
It had no branch-local commits, and had uncommitted changes only in the two todo-owned files:
SnapShotSettings.tsx and SnapShotSettings.logic.ts. Those changes renamed the section and
enabled-setting title, explained capture/attachment and first-use permissions, and scoped readable
text styles to this page. They were retained as an unreviewed draft and reviewed in this run.

Fetching and normally merging origin/hig/12-keybinding-meaning returned "Already up to date."
No reset, rebase, force push, unrelated worktree edit, or installed-app change was made.

This run extends the same scoped presentation to the manual-picker explanation, target sizes,
legible controls, and untruncated sound selection. No capture/permission/setup/shortcut persistence
semantics are intentionally changed. The existing focused setup tests remain the behavior record.
Pure prose gets no new prose-pinning test.

LSP diagnostics timed out twice (3000 ms); the actual web typecheck is required independently.

Final source is three forward-only commits: 639b7b4f, 716b662b, b4077b9d.
The first retains the initial draft; the latter two repair observed control readability, menu
keyboard focus, and larger-text rectangular hit ownership. No shortcut values, permission actions,
capture execution, or saved-setting schemas changed. All 73 focused tests, scoped fmt/lint,
and web typecheck pass on the final source. Final logic-file LSP diagnostics are clean;
TSX diagnostic refresh still times out, while its actual package typecheck passes.
