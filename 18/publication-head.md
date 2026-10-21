## Problem and change

Status: blocked by the shared runner's disclosure selector. No PR is open and
no completed W closure is claimed. This local body is prepared for publication
after the hig-01 owner repairs the strict acceptance scenario.

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

Intended closure after passing acceptance: W-20, W-25 only.

Base: `hig/17-archive-next-step` at `c4e04c655ec393a0641dbafbfa204d9580b992bb`.
Head: `16955bb57c8c4611823d39e0fa3bf6960beb429e`.
app.asar SHA-256: `84de85e7bd26789da889425241e1b278183ea9b342313c09a7fdbf0a5b781f1c`.
Parent app.asar: `8aad4d93be48a7767b56d8437d48c41d26ebe6190cf2d1f2a9ef84e8ca8e4a4f`.

Dependencies: stack parent [#89](https://github.com/kjg8619/Weavra/pull/89);
foundations [#74](https://github.com/kjg8619/Weavra/pull/74),
contextual provider feedback [#76](https://github.com/kjg8619/Weavra/pull/76),
persistent input labels [#80](https://github.com/kjg8619/Weavra/pull/80).
The parent's later boundary fix was merged normally, not rebased. Earlier
builds/captures invalidated by that movement are retained locally, outside this
final published packet. The shared hig-01 runner was not edited.

The concise status option is explicit on provider cards. Onboarding keeps the
existing default summary contract, and the selected provider editor retains
account metadata even when no account email is reported.
