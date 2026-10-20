# Todo 13 diff inspection

Parent d53d63196fc8a07e4c32aa42584d2f36a499bb17 and head
b4077b9d4c13004fb891b15dc5388022209c1c8a were independently packaged and freshly captured.
All 158 matching pairs have matching dimensions and intact alpha channels.

The required SnapShots pairs are:

- 1280x800/21_settings_snapshots.png: diff ratio 0.0167. The content section/card headings
  and explanation now describe the outcome, text is legible, and the switch has a full target.
- 1920x1080/21_settings_snapshots.png: diff ratio 0.0082; the same located content change.

The 1280 parent/head SnapShots images were directly opened and compared, as were the packaged
large-text ON and first-use states in light/dark. The measurement table provides the complete
both-theme, three-size, 100%/150% text OFF/unavailable/ON/setup evidence.

The two largest unrelated pairs were directly opened on both sides:

- 1280x800/45_rename_thread_inline.png (0.1476): both edit `03 Code blocks` and show the same
  TypeScript function, shell output and result table. The transcript scroll position differs:
  the head also exposes the preceding user request and scroll-to-bottom control.
- 1280x800/44_delete_thread_confirmation.png (0.1411): the exact same target and confirmation
  are visible; the inactive blurred transcript has the corresponding scroll difference.

These are retained as capture-state variance, not claimed as changes or full conversation-parity
closure. No dialog, timeline or capture-runner source was changed for todo 13. Smaller dynamic
differences include elapsed running time and diagnostic telemetry; the full per-pair JSON is
published unchanged. No masks or arbitrary similarity threshold were used.

The full every-image/every-hotspot universal review remains the plan's Final wave under the
2026-10-19 amendment. This report does not claim that review, VoiceOver, 200% zoom or +40% copy.
