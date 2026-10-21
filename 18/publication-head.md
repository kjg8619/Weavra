## Problem and change

The shared diagnostic-runner fix is integrated by a normal merge. This
integration changes only `scripts/hig/cases.mjs` and `scripts/hig/harness.test.ts`;
the provider product implementation is unchanged.

Provider rows used to truncate a detailed CLI failure into the status sentence.
They now show the complete structured status headline, while a labelled,
keyboard-operable disclosure retains the exact diagnostic and recovery text.
Authentication and provider readiness are not rewritten.
The selection button contains the visible identity/status rather than an empty
absolute overlay; the optional update action remains a separate sibling control.

The provider list and editor now share normal document flow under the existing
Settings page scroll owner. Fixed card heights, nested vertical ScrollAreas and
the inner model-list scroller are removed. Wide panes use sibling columns;
compact panes stack. Opening/focusing/resizing a model form reveals its label,
input and decisions together without a fixed footer. Inline validation growth
uses a ResizeObserver and preserves the selected provider and unsaved model ID.
Model ordering, favorites, visibility and explicit save/cancel behavior remain
at their existing persistence boundaries.

Closes: W-20, W-25 only.

Base: `hig/17-archive-next-step` at `c4e04c655ec393a0641dbafbfa204d9580b992bb`.
Head: `fb97140d6781ff14b680cd56eec95e31fb23841b`.
app.asar SHA-256: `9e66e7ef7014b1412ff30a6da7505884fc9e1aa49cbfff6d21392bb5e14fd69b`.
Parent app.asar: `8aad4d93be48a7767b56d8437d48c41d26ebe6190cf2d1f2a9ef84e8ca8e4a4f`.

Dependencies: stack parent [#89](https://github.com/kjg8619/Weavra/pull/89);
foundations [#74](https://github.com/kjg8619/Weavra/pull/74),
contextual provider feedback [#76](https://github.com/kjg8619/Weavra/pull/76),
persistent input labels [#80](https://github.com/kjg8619/Weavra/pull/80).
The parent's later boundary fix was merged normally, not rebased. Earlier
builds/captures invalidated by that movement are retained locally, outside this
final published packet. Shared runner
[`6aa04ecc`](https://github.com/kjg8619/Weavra/commit/6aa04ecc910bc36c105b10930c1a0d04ffe8897e)
was merged forward without editing the shared hig-01 worktree or rewriting history.

The concise status option is explicit on provider cards. Onboarding keeps the
existing default summary contract, and the selected provider editor retains
account metadata even when no account email is reported.
