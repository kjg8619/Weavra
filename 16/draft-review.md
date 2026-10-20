# Todo 16 scope and mechanism review

Base: `hig/15-source-control-status`, `69f2cc6c645b6a07525a6a4439c9252741a2d7da`.
Source: `hig/16-connection-action`, `878a9162cd8ce64b39c36531d772cdbd3885b658`.
Shared runner: `08e5df5d37ba6bd3ab7e09f698ddf7a9c42550ed`, unchanged.

Only the three plan-owned ConnectionsSettings files change. The original trigger was
enabled, not permission-disabled. It only set `addBackendDialogOpen`; the separate
`handleAddSavedBackend` parses inputs and invokes `connectPairing`, whose runtime command
calls `ConnectionOnboarding.registerPairing`. Opening the draft does not invoke it.
Host access changes remain guarded by the existing `canManageLocalBackend` and typed
auth APIs. SSH remains desktop-only. No pairing or scope checks change.

One operation model now feeds the actual trigger, SSH option and empty guidance.
The local draft remains available independently of current-host access. Host disconnection
and missing administrative permission explain the separate limitation with an alternative.
Unsupported SSH retains direct host/code entry, not a fabricated disabled local draft.
The available trigger has a normal outline, legible text, visible focus and a 36px minimum
height. New explanatory text is 14px, foreground, keep-all and pretty wrapping.
The empty state no longer advertises retired T3 Connect.

Focused tests cover all three independent axes and disconnection precedence. They assert
machine state rather than Korean prose. Original WSL and endpoint tests remain intact.
Real packaged acceptance checks opening, capability/copy parity, unavailable controls
where applicable and direct-remote draft semantics.

Fmt, scoped lint, web typecheck, focused tests (16/16) and diff checks exited 0.
The existing React Compiler memoization warning is present at the same unchanged
callback in the parent; unrelated Effect suggestions also remain. Neither is suppressed.
No Runtime, contracts, desktop, dependency, credential or installed-app edit is included.

The first package at `d5a00e02` exposed a missing solid outline style and an inherited
box-shadow transition. The follow-up adds the actual 2px solid foreground stroke and
limits this trigger to opacity/transform transitions. The first package and measurement
remain under SHA-suffixed paths; they are not acceptance evidence.

This is the implementer's review, not independent reviewer approval.
