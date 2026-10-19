# PR 02 current evidence packet

Current product head: `d20f77e16ef4c1a26844988c27d9d27318a9b647`.
Base / shared runner: `821328d7410425da439381687721316215765a1f` (extends the original `71710424` runner with the case-02 icon check).
app.asar SHA-256: `67ea63a7aa86375ce18ed028deff95533df34aadba8281475b2af5cec102749e`.
Fixture: `hig-offline-projection-v3`.

This packet replaces the historical fdc8ffc0 evidence. Product source is clean. The shared runner change is test-only; the retained before package is from `bb7649c97402d9a853f91b3a987f9fa48aa970eb` with identical product sources at the new base. Both sides were freshly captured by the same runner.

## Executed checks

Build, extract, both captures, complete diff, measure-02, motion-02, accept_pr 02 and independent --verify-packet: exit 0. Seven packaged checks passed (454 assertions). Harness: 43 passing tests; existing sidebar: 1 passing test. All 18 observed touched icon identities measure 36x36 CSS px; disabled controls are included. Pairwise touched-control overlap is zero; no new overlap with other hittable controls.

The owner-approved 2026-10-19 plan amendment reserves the exhaustive universal Q1-Q12 matrix for the Final verification wave. No threshold or assertion was weakened.

## Touched icon measurements

| Control | Before (CSS px) | After (CSS px) | Disabled observed |
|---|---|---|---|
| Toggle main sidebar | 28x28 | 36x36 | false |
| Dismiss notification | 24x24 | 36x36 | false |
| 파일 첨부 | 28x28, 32x32 | 36x36 | false |
| 메시지 보내기 | 32x32, 36x36 | 36x36 | true |
| Close | 32x32 | 36x36 | false |
| Back | 24x24 | 36x36 | true |
| Forward | 24x24 | 36x36 | true |
| Refresh | 24x24 | 36x36 | true |
| Open in system browser | 24x24 | 36x36 | false |
| Annotate preview | 24x24 | 36x36 | false |
| Capture screenshot | 24x24 | 36x36 | false |
| Float preview over chat | 24x24 | 36x36 | false |
| 생성 중지 | 32x32 | 36x36 | false |
| 이전 미디어 | supplemental state | 36x36 | false |
| image 미리보기 닫기 | supplemental state | 36x36 | false |
| 다음 미디어 | supplemental state | 36x36 | false |
| Minimize the theme editor | supplemental state | 36x36 | false |
| Close the theme editor | supplemental state | 36x36 | false |

`q5-controls.json` records every manifest/scenario location and raw rectangles. Text buttons, media thumbnails, resize rails and icons implemented exclusively in unmodified consumer components are not recategorized as touched icon changes. Conditional icons not reached by this packet still use the same minimum-size contract.

## Before / after

| State | Before | After | Diff ratio |
|---|---|---|---|
| `1280x800/05_add_project_import_modal.png` | ![B](before/1280x800/05_add_project_import_modal.png) | ![A](after/1280x800/05_add_project_import_modal.png) | 0.06570 |
| `1280x800/07_chat_empty_project.png` | ![B](before/1280x800/07_chat_empty_project.png) | ![A](after/1280x800/07_chat_empty_project.png) | 0.03400 |
| `1280x800/11_add_action_dialog.png` | ![B](before/1280x800/11_add_action_dialog.png) | ![A](after/1280x800/11_add_action_dialog.png) | 0.01830 |
| `1280x800/15_right_browser.png` | ![B](before/1280x800/15_right_browser.png) | ![A](after/1280x800/15_right_browser.png) | 0.04130 |
| `1280x800/16_right_terminal.png` | ![B](before/1280x800/16_right_terminal.png) | ![A](after/1280x800/16_right_terminal.png) | 0.02400 |
| `1280x800/18_settings_appearance_light.png` | ![B](before/1280x800/18_settings_appearance_light.png) | ![A](after/1280x800/18_settings_appearance_light.png) | 0.00100 |
| `1280x800/19_settings_appearance_dark.png` | ![B](before/1280x800/19_settings_appearance_dark.png) | ![A](after/1280x800/19_settings_appearance_dark.png) | 0.00100 |
| `1280x800/34_chat_messages.png` | ![B](before/1280x800/34_chat_messages.png) | ![A](after/1280x800/34_chat_messages.png) | 0.01540 |
| `1280x800/35_chat_long_messages.png` | ![B](before/1280x800/35_chat_long_messages.png) | ![A](after/1280x800/35_chat_long_messages.png) | 0.06450 |
| `1280x800/36_chat_code_blocks.png` | ![B](before/1280x800/36_chat_code_blocks.png) | ![A](after/1280x800/36_chat_code_blocks.png) | 0.05160 |
| `1280x800/37_chat_streaming_working.png` | ![B](before/1280x800/37_chat_streaming_working.png) | ![A](after/1280x800/37_chat_streaming_working.png) | 0.01540 |
| `1280x800/38_chat_error.png` | ![B](before/1280x800/38_chat_error.png) | ![A](after/1280x800/38_chat_error.png) | 0.01320 |
| `1280x800/39_chat_empty_existing_thread.png` | ![B](before/1280x800/39_chat_empty_existing_thread.png) | ![A](after/1280x800/39_chat_empty_existing_thread.png) | 0.01690 |
| `1280x800/40_right_controlled_tasks.png` | ![B](before/1280x800/40_right_controlled_tasks.png) | ![A](after/1280x800/40_right_controlled_tasks.png) | 0.01330 |
| `1280x800/41_chat_code_blocks_dark.png` | ![B](before/1280x800/41_chat_code_blocks_dark.png) | ![A](after/1280x800/41_chat_code_blocks_dark.png) | 0.04740 |
| `1920x1080/05_add_project_import_modal.png` | ![B](before/1920x1080/05_add_project_import_modal.png) | ![A](after/1920x1080/05_add_project_import_modal.png) | 0.03270 |
| `1920x1080/07_chat_empty_project.png` | ![B](before/1920x1080/07_chat_empty_project.png) | ![A](after/1920x1080/07_chat_empty_project.png) | 0.01680 |
| `1920x1080/11_add_action_dialog.png` | ![B](before/1920x1080/11_add_action_dialog.png) | ![A](after/1920x1080/11_add_action_dialog.png) | 0.01410 |
| `1920x1080/15_right_browser.png` | ![B](before/1920x1080/15_right_browser.png) | ![A](after/1920x1080/15_right_browser.png) | 0.02530 |
| `1920x1080/16_right_terminal.png` | ![B](before/1920x1080/16_right_terminal.png) | ![A](after/1920x1080/16_right_terminal.png) | 0.01680 |
| `1920x1080/18_settings_appearance_light.png` | ![B](before/1920x1080/18_settings_appearance_light.png) | ![A](after/1920x1080/18_settings_appearance_light.png) | 0.00050 |
| `1920x1080/19_settings_appearance_dark.png` | ![B](before/1920x1080/19_settings_appearance_dark.png) | ![A](after/1920x1080/19_settings_appearance_dark.png) | 0.00050 |
| `1920x1080/34_chat_messages.png` | ![B](before/1920x1080/34_chat_messages.png) | ![A](after/1920x1080/34_chat_messages.png) | 0.00760 |
| `1920x1080/35_chat_long_messages.png` | ![B](before/1920x1080/35_chat_long_messages.png) | ![A](after/1920x1080/35_chat_long_messages.png) | 0.00760 |
| `1920x1080/36_chat_code_blocks.png` | ![B](before/1920x1080/36_chat_code_blocks.png) | ![A](after/1920x1080/36_chat_code_blocks.png) | 0.00760 |
| `1920x1080/37_chat_streaming_working.png` | ![B](before/1920x1080/37_chat_streaming_working.png) | ![A](after/1920x1080/37_chat_streaming_working.png) | 0.00760 |
| `1920x1080/38_chat_error.png` | ![B](before/1920x1080/38_chat_error.png) | ![A](after/1920x1080/38_chat_error.png) | 0.00650 |
| `1920x1080/39_chat_empty_existing_thread.png` | ![B](before/1920x1080/39_chat_empty_existing_thread.png) | ![A](after/1920x1080/39_chat_empty_existing_thread.png) | 0.00830 |
| `1920x1080/40_right_controlled_tasks.png` | ![B](before/1920x1080/40_right_controlled_tasks.png) | ![A](after/1920x1080/40_right_controlled_tasks.png) | 0.00830 |
| `1920x1080/41_chat_code_blocks_dark.png` | ![B](before/1920x1080/41_chat_code_blocks_dark.png) | ![A](after/1920x1080/41_chat_code_blocks_dark.png) | 0.00630 |

The complete 158 primary pairs are in `diff/pairs.json`; supplemental pairs are in `supplemental-diff/pairs.json`. Every image is indexed with its source SHA-256 in `publication-index.json`. Current package provenance is in `before/capture-manifest.json` and `after/capture-manifest.json`; packaged scenarios and their hashed observations are bound by `qa/scenario-receipt.json`. The known historical evidence remains available in this branch's parent commit, not as current-head proof.

## Reproduction and command receipts

See `q5-pipeline.mjs`, `measure-02.mjs`, `motion-02.mjs`, `q5-audit.mjs`, and `logs/q5-*.json` / `.log` for exact commands, exit codes and timestamps. Early formatter-only attempts returned 1 and were corrected; the final formatter check returned 0. No failing product assertion was bypassed.
