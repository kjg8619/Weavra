# Todo 16 image metadata and visual review

158 shared-runner pairs and 20 Connections pairs
have matching dimensions and intact alpha. Full per-pair hotspot JSON is retained;
no broad masks or arbitrary global similarity threshold is used.

The source change is confined to Connections. Mandatory state 26 and its top/end,
hover/focus/open comparisons identify the expected changes: a legible normal action,
truthful empty guidance and a pairing-draft explanation. The parent trigger was enabled,
not permission-disabled. The complete regression corpus is retained, not sampled away.
The initial supplemental run wrongly assumed a short pane must overflow, and a later
frame caught the dialog mid-transition. Both are evidence-only defects, corrected by
finding the actual scroll owner and waiting for final dialog opacity/style and animation
completion. All 40 supplemental images were recaptured; superseded attempts remain local.

The implementer directly opened parent 26 at both sizes and fresh enlarged-minimum
guidance, light focus and dark dialog frames. These show content, not blank/black
compositor frames. This is not a claim that every image or hotspot was manually reviewed;
the full universal cross-product belongs to the Final wave under the amendment.

| Nonzero pair | Diff ratio | Hotspots |
|---|---|---|
| 1280x800/06_local_folder_picker.png | 0.0011 | 2 |
| 1280x800/26_settings_connections.png | 0.078 | 24 |
| 1280x800/28_add_custom_model_form.png | 0.0001 | 12 |
| 1280x800/29_settings_diagnostics.png | 0.0031 | 15 |
| 1280x800/33_project_list_with_threads.png | 0.0001 | 1 |
| 1280x800/34_chat_messages.png | 0.0001 | 1 |
| 1280x800/35_chat_long_messages.png | 0.0001 | 1 |
| 1280x800/36_chat_code_blocks.png | 0.0001 | 1 |
| 1280x800/37_chat_streaming_working.png | 0.0003 | 2 |
| 1280x800/38_chat_error.png | 0.0001 | 1 |
| 1280x800/39_chat_empty_existing_thread.png | 0.0001 | 1 |
| 1280x800/40_right_controlled_tasks.png | 0.0001 | 1 |
| 1280x800/41_chat_code_blocks_dark.png | 0.0001 | 1 |
| 1280x800/44_delete_thread_confirmation.png | 0.0002 | 1 |
| 1280x800/45_rename_thread_inline.png | 0.0001 | 1 |
| 1920x1080/06_local_folder_picker.png | 0.0005 | 2 |
| 1920x1080/26_settings_connections.png | 0.0389 | 13 |
| 1920x1080/29_settings_diagnostics.png | 0.0046 | 16 |
| 1920x1080/37_chat_streaming_working.png | 0.0001 | 2 |
| 1920x1080/44_delete_thread_confirmation.png | 0.0001 | 2 |
| connections/1280x800/light/top.png | 0.078 | 24 |
| connections/1280x800/light/end.png | 0.078 | 25 |
| connections/1280x800/light/hover.png | 0.0778 | 25 |
| connections/1280x800/light/focus.png | 0.0808 | 26 |
| connections/1280x800/light/open.png | 0.2504 | 45 |
| connections/1920x1080/light/top.png | 0.0403 | 15 |
| connections/1920x1080/light/end.png | 0.0403 | 15 |
| connections/1920x1080/light/hover.png | 0.0403 | 15 |
| connections/1920x1080/light/focus.png | 0.0403 | 15 |
| connections/1920x1080/light/open.png | 0.111 | 22 |
| connections/1280x800/dark/top.png | 0.0745 | 24 |
| connections/1280x800/dark/end.png | 0.0745 | 24 |
| connections/1280x800/dark/hover.png | 0.0745 | 24 |
| connections/1280x800/dark/focus.png | 0.0775 | 26 |
| connections/1280x800/dark/open.png | 0.1957 | 45 |
| connections/1920x1080/dark/top.png | 0.0386 | 15 |
| connections/1920x1080/dark/end.png | 0.0386 | 15 |
| connections/1920x1080/dark/hover.png | 0.0386 | 15 |
| connections/1920x1080/dark/focus.png | 0.0386 | 15 |
| connections/1920x1080/dark/open.png | 0.0802 | 18 |
