# Todo 15 pair metadata review

158 matching pairs have matching dimensions and intact alpha.
The complete raw hotspot data is preserved in diff/pairs.json; no global similarity
threshold or image masks are used.

Source changes are confined to Source Control discovery rows and details. Mandatory
state 24 is the user-facing comparison; other captures retain the full regression corpus.
This file records automated pair metadata, not an assertion that every image/hotspot
received manual review. Representative fresh state-24 and a-j frames are opened directly
by the executor; exhaustive visual review remains the Final-wave contract.

Directly opened the fresh top-level state-24 parent/head screenshots at both sizes and
all eight supplemental Bitbucket screenshots (parent/head x both sizes x light/dark).
The two axes and built-in Bitbucket description are readable, the whole Bitbucket row
is visible and the misleading combined provider switch is gone. All 12 supplemental
pairs additionally pass dimension/alpha checks in supplemental/pairs.json.

Located non-product differences: state 06 shows the task-owned workspace changing from
`weavra-hig-5SXjUY` to `weavra-hig-eQQPUK`; state 29 changes actual telemetry samples
(CPU 139.7% to 138.0%, read 365 to 362 KB/s, and corresponding process counters).
Neither pane's product code changed. No mask or arbitrary similarity threshold hides them.
Remaining small nonzero corpus pairs and every hotspot are preserved for exhaustive
Final-wave review; this per-PR report does not claim to have opened every one.

| Pair with nonzero difference | Diff ratio | Hotspots |
|---|---|---|
| 1280x800/06_local_folder_picker.png | 0.0011 | 2 |
| 1280x800/24_settings_source_control.png | 0.0884 | 30 |
| 1280x800/28_add_custom_model_form.png | 0.0001 | 12 |
| 1280x800/29_settings_diagnostics.png | 0.0038 | 12 |
| 1280x800/33_project_list_with_threads.png | 0.0001 | 1 |
| 1280x800/34_chat_messages.png | 0.0001 | 1 |
| 1280x800/35_chat_long_messages.png | 0.0001 | 1 |
| 1280x800/36_chat_code_blocks.png | 0.0001 | 1 |
| 1280x800/37_chat_streaming_working.png | 0.0005 | 2 |
| 1280x800/38_chat_error.png | 0.0001 | 1 |
| 1280x800/39_chat_empty_existing_thread.png | 0.0001 | 1 |
| 1280x800/40_right_controlled_tasks.png | 0.0001 | 1 |
| 1280x800/41_chat_code_blocks_dark.png | 0.0001 | 1 |
| 1280x800/44_delete_thread_confirmation.png | 0.0003 | 1 |
| 1280x800/45_rename_thread_inline.png | 0.0001 | 1 |
| 1920x1080/06_local_folder_picker.png | 0.0005 | 2 |
| 1920x1080/24_settings_source_control.png | 0.085 | 31 |
| 1920x1080/29_settings_diagnostics.png | 0.0013 | 15 |
| 1920x1080/37_chat_streaming_working.png | 0.0002 | 2 |
| 1920x1080/44_delete_thread_confirmation.png | 0.0001 | 2 |
