# Todo 17 implementation review

W-24 is the only product concern. The existing partial empty-state change was
preserved, then corrected to use the router's existing history rather than
linking to `/`, which starts another draft. The no-history fallback retains the
existing landing route. The new action is absent during loading or archive errors.

The empty explanation names the conversation action menu and its actual Korean
archive command. It is 14px, keep-all/pretty, and uses the existing semantic
muted-foreground role. The return button has a 36px minimum height, no press
scaling, and a solid 2px foreground keyboard outline distinct from selection.
No unrelated SettingsPanels code was extracted.

The seven focused tests exercise a real memory router and observable archive
updates. They cover one-activation contextual return, direct-entry fallback,
empty-to-populated replacement, exact scoped restoration, stable navigation on
an unrelated update, and omission of the empty CTA during loading/error.
The packaged scenarios separately verify the real composer draft and restored
conversation content.

Two shared fixture defects were repaired on hig/01: the return check used to
navigate to a new draft before entering settings, and projection-only seeded
threads did not exist in the event-derived command model. The lifecycle check
now registers only its disposable thread through the real authenticated RPC
thread.create command, reseeds the historical message projection, and retains
the original exact route, draft and content assertions. This is not a simulated
archive success. The new harness test checks the selected thread's exact machine
command and leaves the stored projection unchanged. No model or Runtime workflow
is started.

The second acceptance round exposed a loading race: the empty-route check counted
the return button while the archive snapshot was still loading. It now waits for
that exact visible button, then keeps the original uniqueness and navigation
assertions. No sleep, retry, skipped check or relaxed assertion was added.
