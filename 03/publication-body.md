## Problem and change

Runtime preparation looked like a local save, was styled ambiguously when unavailable, and buried the human connection/project identity under raw endpoint, environment ID, project ID, workspace path and a repeated grid of unknown observation values.

This PR keeps the same eligibility inputs (`canPrepareWorkflow`, including the foreign-active and stale-writer recovery branches, and the common()/submit() binding rechecks) and changes only how they are presented:
- When preparation is unavailable, the button is neutral and readable, with its cause right beside it. Preparation is described as a Runtime request, not a local save, approval or execution. Missing control capabilities cannot prepare.
- The human connection name and project title come first. Endpoint, environment ID, project ID and the full workspace path are in a labelled diagnostic disclosure, where they are selectable and can be copied with local feedback.
- Unknown capability and observation metadata collapses into one summary with details. Every original field is kept exactly once, and unknown is never turned into zero or success.
- Onboarding shows raw connection data after the connection name.

Closes: W-06, W-31, W-32.
Base: `hig/02-foundations` @ `54df7a601c8715d48f9d09a0b3e023de392c7e45` (parent app.asar `8cf8aa4a01fd665180c73daf42bc43ddee980fc76d4ff211af9d05bb8653cdf8`). Head: `9e8c3ac3d082b667c35709669cd333c04b1e57f1`. app.asar: `a6823b8c3d5785fa2f79db26063578d9a5d4b11d3cecfb48348d4cbd1919ca86`. Fixture: hig-offline-projection-v4.
Dependencies: #74 (foundations) and #73 (shared runner). The runner now waits for the diagnostic-copy clipboard write to finish, at `132dc59d` (merged into foundations as `54df7a60`). This was a harness race, not a product failure. The assertion is still exact: the copied value must equal the full fixture project path.

## Verification

All commands were run from the hig-03 worktree with Node v24.19.0 and pnpm 11.10.0. Each one has a receipt (`logs/*.json`) and a full log on [hig-evidence/03](https://github.com/kjg8619/Weavra/tree/hig-evidence/03/03).

| Step | Command | Exit |
|---|---|---:|
| Focused tests | `pnpm exec vp test run --project unit src/components/settings/{WeavraControls,CapabilityInventory,WeavraSettings}.test.tsx` (3 files, 78 tests) | 0 |
| Format / lint | `pnpm exec vp fmt --check` / `pnpm exec vp lint` on the six owned files | 0 / 0 |
| Typecheck | `pnpm --filter @t3tools/web typecheck` | 0 |
| Parent build + extract + capture | `dist:desktop:artifact --platform mac --target zip --arch arm64` at `54df7a60`; `capture.mjs --matrix ledger-plus --case 03` (152 PNGs + 6 Electron) | 0 |
| Head build + extract + capture | same at `9e8c3ac3` (152 PNGs + 6 Electron) | 0 |
| Diff | `diff.mjs` (158 pairs: 102 changed, 56 identical, 0 failures) | 0 |
| Todo-3 measurements | `measure-runtime.mjs before` / `after` (19 + 19 PNGs) | 0 / 0 |
| accept_pr 03, round 01 | `assert.mjs --case 03` (run `b526a2a6`, 11/11 PASS) -> `--verify-packet` -> `git diff --check 54df7a60 9e8c3ac3`; then standalone `--verify-packet` | 0, 0, 0; 0 |
| accept_pr 03, round 02 | `assert.mjs --case 03` (run `bd55d13f`, 11/11 PASS) -> `--verify-packet` -> `git diff --check`; then standalone `--verify-packet` | 0, 0, 0; 0 |

Round 01 is kept intact under `repeat-01/pr-03`. Each round launched a fresh isolated profile under its own run UUID. Neither round reuses a stored PASS.

**Request counters (case 03, both rounds).** These are synthetic renderer wire fixtures, not proof of Runtime execution.

| Variant | DOM disabled | AX disabled | prepare/confirm/planner requests |
|---|---|---|---:|
| unsupported | yes | yes | 0 |
| disconnected | yes | yes | 0 |
| stale | yes | yes | 0 |
| missing-scope | yes | yes | 0 |
| fresh (explicit prepare) | no | no | 1 prepare, 0 confirm/execution |
| stale confirmation binding | n/a | n/a | 0 confirm (1 prepare only) |
| reconnect after disconnect | yes | yes | 0 replayed intents |

There were 0 model requests across all unavailable variants, and the scenario counters were model 0, runtimeMutation 0, blockedOutbound 0. These are the guards that already existed. This PR does not claim to have found an execution bypass.

**Measured (supplemental, 1280x800 / 1920x1080 / 840x620, light and dark):**
- The labelled 240-character workspace path was copied exactly at all six size/theme combinations. It is selectable and wraps with no horizontal overflow.
- The prepare reason is 14px, with contrast 4.786 (light) and 4.920 (dark).
- The prepare button is 32px tall at opacity 1, with contrast 14.270 (light) and 16.750 (dark).
- All 16 original overview metadata fields are present exactly once.
- Model, mutation and external-network counters were 0.

**Known limitation.** The shared missing-scope fixture currently reports CONNECTED with an empty goal rather than a real scope denial. Its PASS shows that preparation stays disabled with zero requests. It does not show full denial integration. Unit tests in WeavraControls.test.tsx cover an ERROR/stale/null-state missing-scope observation and a forced submission.

## Before / after

Every primary capture pair (`diff/pairs.json`; Ratio / HS = diffRatio / hotspot count), then the todo-3 supplemental long-path/metadata pairs, then after-only scenario frames from accept round 02. Full hashes: publication-index.json and diff/pairs.json on hig-evidence/03.

| State, size, theme, interaction | Before (parent build) | After (this build) | Ratio / HS |
|---|---|---|---|
| `1280x800/01_first_launch_onboarding_connection` | ![B](https://github.com/user-attachments/assets/d791da8e-ab04-4515-803b-2476b032f98d) | ![A](https://github.com/user-attachments/assets/3aa809d6-4d39-4b7d-a081-1bc7cdc435d4) | 0.1717 / 38 |
| `1280x800/02_onboarding_agents` | ![B](https://github.com/user-attachments/assets/21da33b2-e10d-4187-9570-e5683d47018d) | ![A](https://github.com/user-attachments/assets/609d79f8-68dc-4001-b598-0c280ece5545) | 0.0027 / 3 |
| `1280x800/03_onboarding_project_selection` | ![B](https://github.com/user-attachments/assets/5cafbab0-986c-496f-8879-9d16b11bac27) | ![A](https://github.com/user-attachments/assets/9b3b39dc-f3ca-41ba-b93d-3b689e3de562) | 0 / 0 |
| `1280x800/04_empty_projects` | ![B](https://github.com/user-attachments/assets/fd368c1b-846a-4adc-bd1e-bd746a246d57) | ![A](https://github.com/user-attachments/assets/1179f8c7-a231-4495-a596-4f99162ee1d5) | 0 / 0 |
| `1280x800/05_add_project_import_modal` | ![B](https://github.com/user-attachments/assets/eb718141-90e1-44e7-b246-97ba9e780691) | ![A](https://github.com/user-attachments/assets/8bc6673c-6ff4-4d30-8eb9-880880bcd363) | 0 / 0 |
| `1280x800/06_local_folder_picker` | ![B](https://github.com/user-attachments/assets/880d7c7e-883b-46c3-9ac8-77141b88ce35) | ![A](https://github.com/user-attachments/assets/245f55b1-e595-4a3e-b620-6650af6afc01) | 0.0011 / 4 |
| `1280x800/07_chat_empty_project` | ![B](https://github.com/user-attachments/assets/e0d7d554-be09-454f-87ec-2250159c28e2) | ![A](https://github.com/user-attachments/assets/71fbc3f5-0d44-4c7c-bdbf-04c445e132b2) | 0 / 0 |
| `1280x800/08_project_selection` | ![B](https://github.com/user-attachments/assets/b52b1788-fced-43a2-9f15-c849cdeb3f07) | ![A](https://github.com/user-attachments/assets/0ad74bc8-b433-427b-ab33-425fdd4356cd) | 0 / 0 |
| `1280x800/09_right_panel_menu` | ![B](https://github.com/user-attachments/assets/dca041bf-1091-46ef-8a5a-7340ffa9d558) | ![A](https://github.com/user-attachments/assets/ec355923-0a41-4240-8365-55ef04a6cb5e) | 0 / 0 |
| `1280x800/10_right_files` | ![B](https://github.com/user-attachments/assets/5f55d9f8-d6fe-48ad-9bc1-a866438b1cbb) | ![A](https://github.com/user-attachments/assets/467d2fa0-6dca-4d68-b987-71e47e64fda2) | 0 / 0 |
| `1280x800/11_add_action_dialog` | ![B](https://github.com/user-attachments/assets/9c8299d2-d829-46e0-b9cf-a5768650944e) | ![A](https://github.com/user-attachments/assets/019deb22-e1cf-41a1-aaf6-8c4f17ee3f07) | 0 / 0 |
| `1280x800/12_right_agents` | ![B](https://github.com/user-attachments/assets/fe0d46c4-a5f2-4dce-ad89-4c0461320ad7) | ![A](https://github.com/user-attachments/assets/f54c5c2c-c30f-43ec-8b1d-5847fac0b769) | 0 / 0 |
| `1280x800/13_right_run_graph` | ![B](https://github.com/user-attachments/assets/44b75c56-6e2f-4eb8-b53c-3bc2276bb214) | ![A](https://github.com/user-attachments/assets/a91490bb-c738-4e4b-a4df-836e8444b2ab) | 0 / 0 |
| `1280x800/14_device_setup_dialog` | ![B](https://github.com/user-attachments/assets/cc793de2-5691-4c86-bab1-90f5820afb31) | ![A](https://github.com/user-attachments/assets/b5f8e975-1432-4995-abfc-bf0fe133f426) | 0 / 0 |
| `1280x800/15_right_browser` | ![B](https://github.com/user-attachments/assets/321e81ba-f800-42d3-9e9b-738242e15858) | ![A](https://github.com/user-attachments/assets/1c256175-1782-4356-b4b8-52d573857386) | 0 / 0 |
| `1280x800/16_right_terminal` | ![B](https://github.com/user-attachments/assets/0dcbcebe-c64c-4f2e-95e0-6e09224d6822) | ![A](https://github.com/user-attachments/assets/d4a3d0e7-e101-4183-bf10-c179735af48e) | 0 / 0 |
| `1280x800/17_settings_general` | ![B](https://github.com/user-attachments/assets/259126f9-edb4-4077-bc6d-aeb6474f1eb7) | ![A](https://github.com/user-attachments/assets/75de8c28-3f9d-439d-9664-40e8cccf748c) | 0 / 1 |
| `1280x800/18_settings_appearance_light` | ![B](https://github.com/user-attachments/assets/88d86230-cc93-4eaf-9684-6b3a116bb8bd) | ![A](https://github.com/user-attachments/assets/92bb9c16-83f6-4a7e-b567-016aa6a1a0d4) | 0 / 0 |
| `1280x800/19_settings_appearance_dark` | ![B](https://github.com/user-attachments/assets/42a377d1-77bf-42fd-acf0-c25013b1854f) | ![A](https://github.com/user-attachments/assets/5b5b3c92-cc54-4149-8de1-8da814751feb) | 0.0001 / 2 |
| `1280x800/20_settings_keybindings` | ![B](https://github.com/user-attachments/assets/641a1f6f-b419-4248-9de8-6965c3fe73b3) | ![A](https://github.com/user-attachments/assets/ebadf06d-6fe3-4823-9ccc-da02a4357f55) | 0 / 0 |
| `1280x800/21_settings_snapshots` | ![B](https://github.com/user-attachments/assets/3d0a5d9f-6b3f-4b51-964f-9166870b9178) | ![A](https://github.com/user-attachments/assets/6b12be9d-3b72-4b67-98f4-65fe5e50c2e4) | 0 / 0 |
| `1280x800/22_settings_providers` | ![B](https://github.com/user-attachments/assets/ad1efb47-5742-401f-8af6-865b160490c9) | ![A](https://github.com/user-attachments/assets/22516ab4-ef46-4eb2-aa42-1c1d85fa75c7) | 0 / 0 |
| `1280x800/23_settings_integrations` | ![B](https://github.com/user-attachments/assets/90ffc68b-e495-4c42-a13d-f6cc51805f5e) | ![A](https://github.com/user-attachments/assets/428850a5-3645-4c46-a32c-86ce8e1ea7c2) | 0 / 0 |
| `1280x800/24_settings_source_control` | ![B](https://github.com/user-attachments/assets/94fad8fb-4691-4811-bc42-854f349f2f4a) | ![A](https://github.com/user-attachments/assets/1128c3f3-26a5-4f90-875d-58327f2f6e43) | 0 / 0 |
| `1280x800/25_settings_storage` | ![B](https://github.com/user-attachments/assets/1dc7abed-2b9a-4951-92e8-5927b26379f0) | ![A](https://github.com/user-attachments/assets/217efb53-8908-4515-a759-e148148574fa) | 0 / 0 |
| `1280x800/26_settings_connections` | ![B](https://github.com/user-attachments/assets/03b84104-e805-48a3-abff-2d0228fe36ef) | ![A](https://github.com/user-attachments/assets/97e6c8c6-d896-4831-a77d-35fbcb1f2313) | 0.0037 / 7 |
| `1280x800/27_settings_archive` | ![B](https://github.com/user-attachments/assets/ca3c075b-330a-45b8-b23a-9d327687302c) | ![A](https://github.com/user-attachments/assets/982b29a5-b0da-47c7-a07a-ca2cd911d48e) | 0 / 0 |
| `1280x800/28_add_custom_model_form` | ![B](https://github.com/user-attachments/assets/d93cf8fa-cf33-4f4c-b016-5e0b1ee66ce8) | ![A](https://github.com/user-attachments/assets/a49fe70f-0814-4cc4-9bec-173f7a7ca8e6) | 0 / 0 |
| `1280x800/29_settings_diagnostics` | ![B](https://github.com/user-attachments/assets/9d04c786-7c7f-4cfc-9c8a-2c9a59663767) | ![A](https://github.com/user-attachments/assets/19b5eb55-960a-4da2-8ea4-cda2f0f8ebd4) | 0.0036 / 19 |
| `1280x800/30_settings_licenses` | ![B](https://github.com/user-attachments/assets/c171e9f2-3869-4683-ac67-dc137133fa46) | ![A](https://github.com/user-attachments/assets/8e65d9f7-cee3-46d7-ae6d-ee1e70b22ea1) | 0 / 0 |
| `1280x800/31_chat_model_selector` | ![B](https://github.com/user-attachments/assets/9b390561-1946-45cc-90e4-7e492aee155c) | ![A](https://github.com/user-attachments/assets/69449670-b9ba-426b-9da4-82c9e5e72f7d) | 0 / 0 |
| `1280x800/32_chat_permission_menu` | ![B](https://github.com/user-attachments/assets/cb33b0eb-b247-48ea-a85f-5a486eae1483) | ![A](https://github.com/user-attachments/assets/cd6620b3-42f1-4128-81bf-8df345bf4f2a) | 0 / 0 |
| `1280x800/33_project_list_with_threads` | ![B](https://github.com/user-attachments/assets/5143ff92-1ed2-40cf-916d-c3fa14415a76) | ![A](https://github.com/user-attachments/assets/2011cac1-7472-46bb-a6c4-b9306d826633) | 0.0001 / 1 |
| `1280x800/34_chat_messages` | ![B](https://github.com/user-attachments/assets/7b22bfdb-7487-472a-9de5-77b948bb0843) | ![A](https://github.com/user-attachments/assets/d4fee031-fa1c-44d4-a1c7-94460213afdf) | 0.0001 / 1 |
| `1280x800/35_chat_long_messages` | ![B](https://github.com/user-attachments/assets/73825715-eeba-43b3-9c47-b158ba806ab2) | ![A](https://github.com/user-attachments/assets/f1891a88-1cf9-4401-9f4d-cfd7655eb5bd) | 0.0001 / 1 |
| `1280x800/36_chat_code_blocks` | ![B](https://github.com/user-attachments/assets/c788db92-d3b2-40bf-8cb7-c45ce6165c72) | ![A](https://github.com/user-attachments/assets/32259cf1-733d-4431-99b5-75c816c2e4db) | 0.0001 / 1 |
| `1280x800/37_chat_streaming_working` | ![B](https://github.com/user-attachments/assets/6da9a3c7-dbe1-489b-a50e-ae9577e3cc40) | ![A](https://github.com/user-attachments/assets/82667fbb-5de1-4e84-b1a5-83e8ccba2f65) | 0.0005 / 2 |
| `1280x800/38_chat_error` | ![B](https://github.com/user-attachments/assets/1603e0fe-4f81-43a6-ab1a-6e3d672937cb) | ![A](https://github.com/user-attachments/assets/d0df7aed-b77c-46d1-bf47-70d2cbf6f597) | 0.0001 / 1 |
| `1280x800/39_chat_empty_existing_thread` | ![B](https://github.com/user-attachments/assets/5156856d-bf52-404a-a4bd-fd23b7cc345f) | ![A](https://github.com/user-attachments/assets/becd2a2a-a6bf-4ce0-beb2-baae92224422) | 0.0001 / 1 |
| `1280x800/40_right_controlled_tasks` | ![B](https://github.com/user-attachments/assets/3d06ffdc-6472-4067-a43e-598593f7c251) | ![A](https://github.com/user-attachments/assets/3af91c39-f966-4878-8996-e54aad1ad7d5) | 0.0001 / 1 |
| `1280x800/41_chat_code_blocks_dark` | ![B](https://github.com/user-attachments/assets/1bdc9d81-e275-4621-b331-e466a376b262) | ![A](https://github.com/user-attachments/assets/a51cb086-c4b2-4691-b35e-616b1074e78b) | 0.0001 / 1 |
| `1280x800/44_delete_thread_confirmation` | ![B](https://github.com/user-attachments/assets/c8215d60-1d79-44a1-9d56-39604496ff50) | ![A](https://github.com/user-attachments/assets/3dd1a8c5-8441-4f90-abe9-83445d488b73) | 0.0004 / 1 |
| `1280x800/45_rename_thread_inline` | ![B](https://github.com/user-attachments/assets/d41fd986-4e73-4d9c-88e4-03d5c49ff15d) | ![A](https://github.com/user-attachments/assets/52939844-b0bf-411c-bc8e-bb27343a1052) | 0.0001 / 1 |
| `1280x800/46_project_settings_control` | ![B](https://github.com/user-attachments/assets/694e81ee-e5da-4d5d-8b3a-01363e4e1504) | ![A](https://github.com/user-attachments/assets/9c60b1b6-5edb-4205-9cd3-5b9672b3927a) | 0.1033 / 43 |
| `1280x800/47_project_settings_evidence` | ![B](https://github.com/user-attachments/assets/213c385e-7a18-4716-a2a2-83da11a15386) | ![A](https://github.com/user-attachments/assets/7d474d0f-6ba4-4b04-a232-2bed889ecf82) | 0.1103 / 36 |
| `1280x800/48_project_settings_model_fitness` | ![B](https://github.com/user-attachments/assets/fc3bc766-4389-449d-82d2-5ff43894abf1) | ![A](https://github.com/user-attachments/assets/0322dc12-8475-497f-9bd2-b56fc7a4391c) | 0.0001 / 5 |
| `1920x1080/01_first_launch_onboarding_connection` | ![B](https://github.com/user-attachments/assets/cdc37870-c943-410c-be2a-4553cd073e36) | ![A](https://github.com/user-attachments/assets/34b7f78e-3c9c-4ba5-a1e9-1f8a362caa79) | 0.0848 / 24 |
| `1920x1080/02_onboarding_agents` | ![B](https://github.com/user-attachments/assets/3adf4f62-e7a2-410c-80ac-a193bda48ebd) | ![A](https://github.com/user-attachments/assets/74edbae3-2f15-4786-8142-1c89e742a1bd) | 0.0013 / 4 |
| `1920x1080/03_onboarding_project_selection` | ![B](https://github.com/user-attachments/assets/583f07bb-10c2-47dc-aa68-c630a2cd14df) | ![A](https://github.com/user-attachments/assets/c646a723-37d7-418b-ae16-2375a5281e07) | 0 / 0 |
| `1920x1080/04_empty_projects` | ![B](https://github.com/user-attachments/assets/7b348639-6e2b-46ff-b160-5ae279d28897) | ![A](https://github.com/user-attachments/assets/c98da8c1-b6ad-4e98-b79d-23c4dbca5a21) | 0 / 0 |
| `1920x1080/05_add_project_import_modal` | ![B](https://github.com/user-attachments/assets/868e6fbc-bc1e-4959-929e-4328844321b1) | ![A](https://github.com/user-attachments/assets/08b6f19c-aa30-446b-a598-f6f72ef07f44) | 0 / 0 |
| `1920x1080/06_local_folder_picker` | ![B](https://github.com/user-attachments/assets/e275d4f9-b067-40ad-8ce7-132c2163cef0) | ![A](https://github.com/user-attachments/assets/a734abb2-2ab7-47da-a8cb-68f50c258a73) | 0.0005 / 4 |
| `1920x1080/07_chat_empty_project` | ![B](https://github.com/user-attachments/assets/59b7a095-cd25-477e-93e2-4f9a2b0b516c) | ![A](https://github.com/user-attachments/assets/f8f4341a-8842-4235-be33-981f3d251969) | 0 / 0 |
| `1920x1080/08_project_selection` | ![B](https://github.com/user-attachments/assets/c214ae19-7e1a-46fb-98dc-d3bbe50f06c0) | ![A](https://github.com/user-attachments/assets/eb9b7008-59c4-4c89-9b91-4757ff4a8a55) | 0 / 0 |
| `1920x1080/09_right_panel_menu` | ![B](https://github.com/user-attachments/assets/76baa096-22f6-4e50-9bde-cc73ed4f1c77) | ![A](https://github.com/user-attachments/assets/b9d29fd5-f0b7-47a7-8849-77981fc99379) | 0 / 0 |
| `1920x1080/10_right_files` | ![B](https://github.com/user-attachments/assets/5c5cad3f-a69e-4fff-a944-3a78c1d62fdf) | ![A](https://github.com/user-attachments/assets/7a4a3bc2-6631-4a75-a074-ee2af89061f8) | 0 / 0 |
| `1920x1080/11_add_action_dialog` | ![B](https://github.com/user-attachments/assets/48ad4bb7-adcf-4507-b2bb-aaea9e08b142) | ![A](https://github.com/user-attachments/assets/7597b3e0-b7da-42ed-9951-71d535d3622e) | 0 / 0 |
| `1920x1080/12_right_agents` | ![B](https://github.com/user-attachments/assets/22831a46-9436-407f-afb6-8f12c746fa24) | ![A](https://github.com/user-attachments/assets/30c76fb7-7432-4a76-a335-6bed33101e48) | 0 / 0 |
| `1920x1080/13_right_run_graph` | ![B](https://github.com/user-attachments/assets/10e8ad5f-1e8d-4212-9f3d-cf7c1fcc8dcf) | ![A](https://github.com/user-attachments/assets/90546cc1-65c2-4d3e-92c6-6c62fd3d043b) | 0 / 0 |
| `1920x1080/14_device_setup_dialog` | ![B](https://github.com/user-attachments/assets/79471582-b97e-482a-a602-2b26298f837b) | ![A](https://github.com/user-attachments/assets/b118a8b0-696d-4511-a105-7549ca726641) | 0 / 0 |
| `1920x1080/15_right_browser` | ![B](https://github.com/user-attachments/assets/c1139d66-e5d1-46b7-af94-7ea8267db693) | ![A](https://github.com/user-attachments/assets/f33049f3-6685-44f9-bdac-0cbd1a3d22ef) | 0 / 0 |
| `1920x1080/16_right_terminal` | ![B](https://github.com/user-attachments/assets/678a07fe-ac50-46b0-bd07-8cc77fb657ad) | ![A](https://github.com/user-attachments/assets/29b9cc68-8ce5-4f93-ac0b-226fc87f1c59) | 0 / 0 |
| `1920x1080/17_settings_general` | ![B](https://github.com/user-attachments/assets/41beac97-cc70-4502-8680-fdf0e280375b) | ![A](https://github.com/user-attachments/assets/5868c422-dd91-4c35-ae7a-490a9058133c) | 0 / 0 |
| `1920x1080/18_settings_appearance_light` | ![B](https://github.com/user-attachments/assets/4a62ec4d-a31a-40c1-8afc-2ae6cb8f7ced) | ![A](https://github.com/user-attachments/assets/9793f2e3-a5aa-49b5-8dda-67213805d666) | 0 / 0 |
| `1920x1080/19_settings_appearance_dark` | ![B](https://github.com/user-attachments/assets/e729cfd4-c9e6-4a55-a5fd-af9e5cef5580) | ![A](https://github.com/user-attachments/assets/9bda9213-fa5e-45c0-b4ae-619087d1453f) | 0 / 3 |
| `1920x1080/20_settings_keybindings` | ![B](https://github.com/user-attachments/assets/2d3332e7-5aca-4e68-b468-346c8f8855a8) | ![A](https://github.com/user-attachments/assets/7e5ca2f7-7b2b-4c59-b3c2-93704e32cef7) | 0 / 0 |
| `1920x1080/21_settings_snapshots` | ![B](https://github.com/user-attachments/assets/c6a788c0-bea8-48fd-b7fc-70f9204b0c8c) | ![A](https://github.com/user-attachments/assets/aa3a24ca-c4a0-4b8e-8c0d-21f6329fbc96) | 0 / 0 |
| `1920x1080/22_settings_providers` | ![B](https://github.com/user-attachments/assets/5007485b-a873-4f64-9451-286d0b5c08c5) | ![A](https://github.com/user-attachments/assets/97f2a8c8-aefe-4b3c-a59d-04171ac1fd30) | 0 / 0 |
| `1920x1080/23_settings_integrations` | ![B](https://github.com/user-attachments/assets/3b4c75b5-2a5b-4f23-97f1-b5bcb77e9b65) | ![A](https://github.com/user-attachments/assets/d035f308-2705-4157-adbf-85e6d86068b0) | 0 / 0 |
| `1920x1080/24_settings_source_control` | ![B](https://github.com/user-attachments/assets/14326ebb-e621-4a50-9879-cd51af07685e) | ![A](https://github.com/user-attachments/assets/43f88c65-1fe3-4e19-8a26-83b18c099a15) | 0 / 0 |
| `1920x1080/25_settings_storage` | ![B](https://github.com/user-attachments/assets/252da858-93d1-4db6-a13e-c64fd079a7c2) | ![A](https://github.com/user-attachments/assets/7a79fe04-ecae-4dc7-99c3-c8af2d62361a) | 0 / 0 |
| `1920x1080/26_settings_connections` | ![B](https://github.com/user-attachments/assets/e71eb465-67ec-434c-90f7-a17daf060730) | ![A](https://github.com/user-attachments/assets/e8ba9e34-5b33-4ac5-945c-d6a416faab91) | 0 / 0 |
| `1920x1080/27_settings_archive` | ![B](https://github.com/user-attachments/assets/458937df-3b06-42d9-a84b-39fe65a082c2) | ![A](https://github.com/user-attachments/assets/2ec95bc5-9e2c-4d85-bbe4-fc31daf8e2ad) | 0 / 0 |
| `1920x1080/28_add_custom_model_form` | ![B](https://github.com/user-attachments/assets/d8504ac7-ab7a-4df9-be82-465be789dbc3) | ![A](https://github.com/user-attachments/assets/c98af252-5769-4018-95c7-04b07814bec3) | 0 / 0 |
| `1920x1080/29_settings_diagnostics` | ![B](https://github.com/user-attachments/assets/c7d94e63-1ba1-446c-ad2a-ac02125ab48a) | ![A](https://github.com/user-attachments/assets/dad50335-26e7-4269-bfdd-76a36bc24cc9) | 0.0026 / 16 |
| `1920x1080/30_settings_licenses` | ![B](https://github.com/user-attachments/assets/b891a26e-24e5-4b42-916d-ebffbc5898f5) | ![A](https://github.com/user-attachments/assets/674d6d83-4eea-485e-869e-93d80903e92b) | 0 / 0 |
| `1920x1080/31_chat_model_selector` | ![B](https://github.com/user-attachments/assets/4540ab45-10e9-4623-bf56-12ee521cee92) | ![A](https://github.com/user-attachments/assets/6d1db62b-d8d2-41bb-8e5c-9b1a50f5076c) | 0 / 0 |
| `1920x1080/32_chat_permission_menu` | ![B](https://github.com/user-attachments/assets/2b9d0a08-8d61-42af-8f9a-30a6343306b9) | ![A](https://github.com/user-attachments/assets/fe4b11d7-828f-4f96-81ca-c98d05aaaaf9) | 0 / 0 |
| `1920x1080/33_project_list_with_threads` | ![B](https://github.com/user-attachments/assets/38d64840-7a63-4182-b850-feb00cc826ba) | ![A](https://github.com/user-attachments/assets/0af07d0b-2455-4dcf-9a7a-e579256e8987) | 0.0001 / 1 |
| `1920x1080/34_chat_messages` | ![B](https://github.com/user-attachments/assets/1ab6d6a2-b10a-4a0c-962e-40d03e444c73) | ![A](https://github.com/user-attachments/assets/33f0f935-d85a-4a25-a10a-9a735b0222ce) | 0.0001 / 1 |
| `1920x1080/35_chat_long_messages` | ![B](https://github.com/user-attachments/assets/f9e20241-a59d-43fd-9bac-74e1c4679af0) | ![A](https://github.com/user-attachments/assets/714a3b3b-efdb-4c6f-a038-c68d29e28636) | 0.0001 / 1 |
| `1920x1080/36_chat_code_blocks` | ![B](https://github.com/user-attachments/assets/896eb364-7e6b-41ab-8492-085c3d2681a2) | ![A](https://github.com/user-attachments/assets/6fb52991-f3a1-427e-aba5-7fd9522657b5) | 0.0001 / 1 |
| `1920x1080/37_chat_streaming_working` | ![B](https://github.com/user-attachments/assets/7abc2b53-348d-4316-bdd2-3f0d0bfc3415) | ![A](https://github.com/user-attachments/assets/cb4d73c7-b17a-40db-a892-da68fef9f15e) | 0.0003 / 2 |
| `1920x1080/38_chat_error` | ![B](https://github.com/user-attachments/assets/8e878a11-2acf-4e51-b840-b1faa4f350e4) | ![A](https://github.com/user-attachments/assets/acbec055-542c-4783-855c-e371f734eb82) | 0.0001 / 1 |
| `1920x1080/39_chat_empty_existing_thread` | ![B](https://github.com/user-attachments/assets/0bce0181-4139-4f75-b239-aa1b9efb3bbc) | ![A](https://github.com/user-attachments/assets/d5a205d3-777b-437a-8555-df27466ee294) | 0.0001 / 1 |
| `1920x1080/40_right_controlled_tasks` | ![B](https://github.com/user-attachments/assets/72a4dcf4-03be-419d-9584-d48b97a5fb83) | ![A](https://github.com/user-attachments/assets/776d3da0-7646-4891-b31f-af5130edf150) | 0.0001 / 1 |
| `1920x1080/41_chat_code_blocks_dark` | ![B](https://github.com/user-attachments/assets/2b75fcce-d79c-40a1-8ddd-7a909c4bfff5) | ![A](https://github.com/user-attachments/assets/8bedf89f-3cd5-472c-841e-6fa2721e8597) | 0.0001 / 1 |
| `1920x1080/44_delete_thread_confirmation` | ![B](https://github.com/user-attachments/assets/617c3409-2f95-44ca-ba80-4b05413b6255) | ![A](https://github.com/user-attachments/assets/74c63c6c-ab21-43d0-9129-00e7ddad4661) | 0.0002 / 2 |
| `1920x1080/45_rename_thread_inline` | ![B](https://github.com/user-attachments/assets/02fc8d5a-a007-4a64-bc2e-a802841ddddc) | ![A](https://github.com/user-attachments/assets/c4ed6818-e145-4a52-aa95-cfe8ae9c6af8) | 0.0001 / 1 |
| `1920x1080/46_project_settings_control` | ![B](https://github.com/user-attachments/assets/15d123df-0a73-475c-adcb-f70e4d3acf04) | ![A](https://github.com/user-attachments/assets/3f3d017d-cac9-4b37-a6ca-84d9a82b7241) | 0.0642 / 40 |
| `1920x1080/47_project_settings_evidence` | ![B](https://github.com/user-attachments/assets/9e50990f-d7a9-41f5-b9a5-4b73089a5a63) | ![A](https://github.com/user-attachments/assets/cce44690-60a3-4a7f-9aca-de5fc430d0e0) | 0.0966 / 36 |
| `1920x1080/48_project_settings_model_fitness` | ![B](https://github.com/user-attachments/assets/8145eb4a-9df0-4c08-b65a-5622608d3529) | ![A](https://github.com/user-attachments/assets/77ce4b8b-852e-488b-8cf6-b49b6f87e01b) | 0.0046 / 13 |
| `390x844/42_narrow_chat_dark` | ![B](https://github.com/user-attachments/assets/50afa3dd-922c-4a74-b5e0-6b9853801285) | ![A](https://github.com/user-attachments/assets/0c005494-bc61-4141-8533-b65e5ca9d45c) | 0 / 0 |
| `390x844/43_narrow_chat_light` | ![B](https://github.com/user-attachments/assets/7aceca6e-ff2f-42bb-a988-e079cd46820b) | ![A](https://github.com/user-attachments/assets/a81f5a8e-1976-41e5-b2d4-5539ef5bb8a1) | 0 / 0 |
| `1280x800/36_chat_code_blocks.electron` | ![B](https://github.com/user-attachments/assets/a6ea6813-9622-4db6-9fcf-c40a8b5e6134) | ![A](https://github.com/user-attachments/assets/274f4ed6-0d35-4570-822c-b974d419d9d6) | 0 / 1 |
| `1280x800/41_chat_code_blocks_dark.electron` | ![B](https://github.com/user-attachments/assets/8dc5c46e-1cf0-4c39-8c3a-b908de1bae4b) | ![A](https://github.com/user-attachments/assets/dab87163-b09c-4107-9c4e-7c4a1b94c830) | 0 / 1 |
| `390x844/42_narrow_chat_dark.electron` | ![B](https://github.com/user-attachments/assets/27046471-21ff-4afd-af54-598f70192de5) | ![A](https://github.com/user-attachments/assets/44629525-3047-4ac1-bf81-2cbd4d53bb36) | 0 / 0 |
| `390x844/43_narrow_chat_light.electron` | ![B](https://github.com/user-attachments/assets/608b88b0-7af5-4dc6-a9aa-78bde8cebf4e) | ![A](https://github.com/user-attachments/assets/5a93f09a-917a-4057-b67d-9bf878ba54d0) | 0 / 0 |
| `matrix/1280x800/light/46/prepare-end-default` | ![B](https://github.com/user-attachments/assets/d7ad0507-9e15-44a1-a15c-c1f398e999d3) | ![A](https://github.com/user-attachments/assets/4b325686-baf2-493f-baa9-f710ffc112fa) | 0.1033 / 43 |
| `matrix/1280x800/light/48/actions-end-default` | ![B](https://github.com/user-attachments/assets/efc66e58-dc83-44de-af7b-2586d700a28f) | ![A](https://github.com/user-attachments/assets/a7621740-b973-4c7f-b975-38578971e391) | 0.0012 / 6 |
| `matrix/1280x800/dark/46/top-default` | ![B](https://github.com/user-attachments/assets/6217ae13-eb37-4024-a6a8-95d80114d5d1) | ![A](https://github.com/user-attachments/assets/0c8508e9-839e-4383-8495-bd6cfb016dbf) | 0.12 / 43 |
| `matrix/1280x800/dark/46/end-default` | ![B](https://github.com/user-attachments/assets/2753cafd-8da6-485c-883c-0cf013e349e0) | ![A](https://github.com/user-attachments/assets/9054a566-5720-4b81-bc2f-d731dc56cdff) | 0.0875 / 17 |
| `matrix/1280x800/dark/47/top-default` | ![B](https://github.com/user-attachments/assets/048ef6bc-c67d-44b4-ab8e-9508bb2c693a) | ![A](https://github.com/user-attachments/assets/024f6567-8599-4696-88ed-12f2e706b085) | 0.0002 / 4 |
| `matrix/1280x800/dark/47/end-default` | ![B](https://github.com/user-attachments/assets/4222eb15-2dba-4f7c-94e5-88124fd83697) | ![A](https://github.com/user-attachments/assets/da281c6c-e815-4991-a8ae-4c3097f9fc71) | 0.1103 / 36 |
| `matrix/1280x800/dark/48/top-default` | ![B](https://github.com/user-attachments/assets/59c4387d-363b-4bcb-8039-d225412088ea) | ![A](https://github.com/user-attachments/assets/19cdb3be-28ee-426e-9e07-734d89286b01) | 0.0001 / 4 |
| `matrix/1280x800/dark/48/end-default` | ![B](https://github.com/user-attachments/assets/b8d39663-39e1-4723-a141-cbe0eff745a0) | ![A](https://github.com/user-attachments/assets/e0ec6412-1551-4f89-a006-02b45d15ec64) | 0.019 / 20 |
| `matrix/1280x800/dark/48/actions-end-default` | ![B](https://github.com/user-attachments/assets/157609a9-9bbf-4443-ba3a-db54f91faa70) | ![A](https://github.com/user-attachments/assets/51a1db15-d9bc-478c-aaca-ec867fc82636) | 0.0012 / 5 |
| `matrix/1280x800/light/46/top-default` | ![B](https://github.com/user-attachments/assets/a89156b3-6c9e-4098-98e1-c6c4891f181b) | ![A](https://github.com/user-attachments/assets/f5f7f4f3-fbcb-4d3c-99c7-e714a710e735) | 0.1033 / 43 |
| `matrix/1280x800/light/46/end-default` | ![B](https://github.com/user-attachments/assets/b9c29be1-3fbf-4905-8cf9-1e8d2602ccea) | ![A](https://github.com/user-attachments/assets/05a08505-a6c1-45b7-bcab-2799158c976a) | 0.0633 / 18 |
| `matrix/1280x800/light/47/top-default` | ![B](https://github.com/user-attachments/assets/c2ed65e2-927f-472a-a44e-64ec22d2ef44) | ![A](https://github.com/user-attachments/assets/a11d2cb3-a822-4c6d-9038-2bf40165e7e9) | 0.0002 / 5 |
| `matrix/1280x800/light/47/end-default` | ![B](https://github.com/user-attachments/assets/3425dc74-765e-4d45-a76f-e98b2082dbbc) | ![A](https://github.com/user-attachments/assets/a3e3e0f0-02fe-4cb2-9240-387ad696c17d) | 0.1103 / 36 |
| `matrix/1280x800/light/48/top-default` | ![B](https://github.com/user-attachments/assets/c0059c86-8ecc-4191-a417-2299f4bb152a) | ![A](https://github.com/user-attachments/assets/6d5572a7-44a9-4b39-8e79-11b6a034bc12) | 0.0001 / 5 |
| `matrix/1280x800/light/48/end-default` | ![B](https://github.com/user-attachments/assets/02231210-1500-4cc7-81fa-17459250e263) | ![A](https://github.com/user-attachments/assets/c12b7e70-1cdb-4ca9-ad07-5070bcf19ebf) | 0.0188 / 21 |
| `matrix/840x620/light/46/top-default` | ![B](https://github.com/user-attachments/assets/3186683c-842c-414e-8b66-ecd58eb0a957) | ![A](https://github.com/user-attachments/assets/3ce4f705-20d8-4d21-8f01-c87858b2c4f0) | 0.1007 / 41 |
| `matrix/840x620/light/46/end-default` | ![B](https://github.com/user-attachments/assets/ab1fd1c2-bd6f-43eb-b89d-dcb5ab54bcd2) | ![A](https://github.com/user-attachments/assets/0dbc3192-98a6-4a8e-b484-a39692e6d861) | 0.0006 / 3 |
| `matrix/840x620/light/47/top-default` | ![B](https://github.com/user-attachments/assets/f00f8839-2eec-497f-91c5-cfeed9248f27) | ![A](https://github.com/user-attachments/assets/c34704f8-e518-4842-8412-a642dab1f582) | 0.0006 / 7 |
| `matrix/840x620/light/47/end-default` | ![B](https://github.com/user-attachments/assets/ee358288-0c20-4968-8fba-02a86460a313) | ![A](https://github.com/user-attachments/assets/1348f2ec-64f1-4195-9d00-860ee6530b7f) | 0.113 / 31 |
| `matrix/840x620/light/48/top-default` | ![B](https://github.com/user-attachments/assets/520589ee-eb5b-4ba5-922b-7f974ff0ffd0) | ![A](https://github.com/user-attachments/assets/dde7bb5f-61b1-4d66-bb24-879a114f6960) | 0.0005 / 7 |
| `matrix/840x620/light/48/end-default` | ![B](https://github.com/user-attachments/assets/f322dab2-c11b-41c2-87ee-e8d35afb18cc) | ![A](https://github.com/user-attachments/assets/7c274fd6-fd07-44e2-96b1-ce71209ab999) | 0.0006 / 7 |
| `matrix/840x620/light/48/actions-end-default` | ![B](https://github.com/user-attachments/assets/c9470543-1b0f-4dd7-8ef5-f4e7d349cd53) | ![A](https://github.com/user-attachments/assets/280e7aae-5408-4513-b383-7e6bd1ef92c5) | 0.0005 / 8 |
| `matrix/840x620/dark/46/top-default` | ![B](https://github.com/user-attachments/assets/eaa81485-d210-4aeb-a99a-257d0627d9d7) | ![A](https://github.com/user-attachments/assets/372a1260-071e-4f5f-a817-af11696319f9) | 0.1354 / 41 |
| `matrix/840x620/dark/46/end-default` | ![B](https://github.com/user-attachments/assets/388a1108-e1c7-4c9d-a199-50bd8b7737c6) | ![A](https://github.com/user-attachments/assets/e499ada4-1792-4686-8aea-3721f88faed6) | 0.0006 / 3 |
| `matrix/840x620/dark/47/top-default` | ![B](https://github.com/user-attachments/assets/34bbe1b0-c767-4f38-9751-cc358251f6b2) | ![A](https://github.com/user-attachments/assets/d707f3b8-a53a-4623-a807-f116ace276b0) | 0.0004 / 6 |
| `matrix/840x620/dark/47/end-default` | ![B](https://github.com/user-attachments/assets/c139dc51-7c58-43d4-95f3-c841d74de20b) | ![A](https://github.com/user-attachments/assets/8248a2f7-e771-41ec-85d0-9ee71bff7ce1) | 0.1124 / 33 |
| `matrix/840x620/dark/48/top-default` | ![B](https://github.com/user-attachments/assets/2cf855fb-087f-4290-9811-98ce4128788e) | ![A](https://github.com/user-attachments/assets/c05cfc66-49fa-4f0e-9507-6eb1837597e1) | 0.0002 / 6 |
| `matrix/840x620/dark/48/end-default` | ![B](https://github.com/user-attachments/assets/1bdb8111-f0fb-44db-8c5c-28f2d42112c6) | ![A](https://github.com/user-attachments/assets/6ff458c4-f989-499a-837c-9ff4fc8770d9) | 0.0004 / 7 |
| `matrix/840x620/dark/48/actions-end-default` | ![B](https://github.com/user-attachments/assets/e3e87f5c-3a0d-4423-b0f4-9c8ffc9e89b2) | ![A](https://github.com/user-attachments/assets/3f0f5e62-0072-42a2-a08d-12461b27c541) | 0.0003 / 6 |
| `matrix/2560x1440/light/46/top-default` | ![B](https://github.com/user-attachments/assets/3f21942e-46be-44cf-aa0e-4debe60cd362) | ![A](https://github.com/user-attachments/assets/d23c7c59-8193-47d4-bd94-01e5f92d1fe1) | 0.0716 / 26 |
| `matrix/2560x1440/light/46/end-default` | ![B](https://github.com/user-attachments/assets/36ecfd7a-3aa9-48a0-9cb6-44a31db67dbc) | ![A](https://github.com/user-attachments/assets/396dd978-3f8f-4e5c-9625-9b2ae84d4c17) | 0.0799 / 27 |
| `matrix/2560x1440/light/47/top-default` | ![B](https://github.com/user-attachments/assets/bcf22312-ede2-4ed8-bedc-8e3d94937086) | ![A](https://github.com/user-attachments/assets/4eb74f4a-d024-44a0-a466-f7f14d8c695a) | 0.0296 / 13 |
| `matrix/2560x1440/light/47/end-default` | ![B](https://github.com/user-attachments/assets/9b4826c6-4d55-46af-92d9-da0396dd54f7) | ![A](https://github.com/user-attachments/assets/b4e0ade4-ddfe-450d-ba09-55e76661656e) | 0.0726 / 25 |
| `matrix/2560x1440/light/48/top-default` | ![B](https://github.com/user-attachments/assets/bfb40f80-b051-41af-8dc3-c87901bfa7cf) | ![A](https://github.com/user-attachments/assets/d67cb887-bddd-4831-8e5a-b944cdb31763) | 0.0296 / 13 |
| `matrix/2560x1440/light/48/end-default` | ![B](https://github.com/user-attachments/assets/8ed5786d-9b30-4882-b7a1-01d61a33abdb) | ![A](https://github.com/user-attachments/assets/cfe790d9-d538-49ef-9a24-1e854d629d44) | 0.0563 / 21 |
| `matrix/2560x1440/light/48/actions-end-default` | ![B](https://github.com/user-attachments/assets/53663486-8d8e-47f9-a8d8-21f58b49250d) | ![A](https://github.com/user-attachments/assets/8d15129d-765a-4551-83e0-034d70cca53c) | 0.0505 / 16 |
| `matrix/2560x1440/dark/46/top-default` | ![B](https://github.com/user-attachments/assets/ddec46f2-c1aa-4816-ae66-320718b55206) | ![A](https://github.com/user-attachments/assets/2efd2be3-49e3-4b33-8dd4-6a7a8e94f59d) | 0.1081 / 26 |
| `matrix/2560x1440/dark/46/end-default` | ![B](https://github.com/user-attachments/assets/40e0da80-36a3-4166-b867-b3a100f61a1f) | ![A](https://github.com/user-attachments/assets/cd6215e1-e3b4-4e6d-b9b2-b0ea65c6fe51) | 0.0974 / 27 |
| `matrix/2560x1440/dark/47/top-default` | ![B](https://github.com/user-attachments/assets/9d5697b8-cd5c-45ca-8ffb-48e19a54a557) | ![A](https://github.com/user-attachments/assets/f985a444-42b5-4eed-9a59-a55ab84e39af) | 0.0295 / 12 |
| `matrix/2560x1440/dark/47/end-default` | ![B](https://github.com/user-attachments/assets/547ba0b3-c17e-4601-9c8c-95638d7aa31a) | ![A](https://github.com/user-attachments/assets/5a3c6bef-403e-40e7-a306-7b486755679d) | 0.1071 / 26 |
| `matrix/2560x1440/dark/48/top-default` | ![B](https://github.com/user-attachments/assets/2727c0be-c03c-4d37-93f4-99276af1f114) | ![A](https://github.com/user-attachments/assets/cda5dcd8-7487-4ab0-acf6-c5f83b8b3366) | 0.0295 / 12 |
| `matrix/2560x1440/dark/48/end-default` | ![B](https://github.com/user-attachments/assets/ac93ef92-6840-479c-bc7b-a955c1f247d3) | ![A](https://github.com/user-attachments/assets/2c342df6-ba5f-4001-93de-4eec3c3cd80f) | 0.0694 / 20 |
| `matrix/2560x1440/dark/48/actions-end-default` | ![B](https://github.com/user-attachments/assets/df926b2f-03d4-48bc-b7a5-1f3d42fc17ed) | ![A](https://github.com/user-attachments/assets/50c03630-f24f-4a29-a886-acf4f0b454e0) | 0.055 / 15 |
| `1920x1080/36_chat_code_blocks.electron` | ![B](https://github.com/user-attachments/assets/170b4e66-8e09-4eaa-8437-5d23b247a395) | ![A](https://github.com/user-attachments/assets/57d6593e-1d95-44f8-8998-afbef7d5d8f4) | 0 / 1 |
| `1920x1080/41_chat_code_blocks_dark.electron` | ![B](https://github.com/user-attachments/assets/6f2299da-4b54-45cd-9d96-db493a8677a2) | ![A](https://github.com/user-attachments/assets/2dc2cd76-0358-491d-8b89-bca5b2df50f6) | 0 / 1 |
| `matrix/1920x1080/light/46/prepare-end-default` | ![B](https://github.com/user-attachments/assets/f4c22754-0c7c-4618-be31-0d2c2e898200) | ![A](https://github.com/user-attachments/assets/8a7fb5a8-696c-4479-9eb6-d51a5a03cfa4) | 0.0642 / 40 |
| `matrix/1920x1080/light/48/actions-end-default` | ![B](https://github.com/user-attachments/assets/20c6cd2c-5413-4dd7-9113-acd5fd0039a2) | ![A](https://github.com/user-attachments/assets/8672c738-f4f1-4516-8b07-aba27136cfdd) | 0.0388 / 19 |
| `matrix/1920x1080/dark/46/top-default` | ![B](https://github.com/user-attachments/assets/98dbca71-fb86-42a0-84e6-d65e1aba06ce) | ![A](https://github.com/user-attachments/assets/e4f7cec5-476d-4764-a447-e5adae73a895) | 0.1302 / 39 |
| `matrix/1920x1080/dark/46/end-default` | ![B](https://github.com/user-attachments/assets/7e139696-844e-463d-bdce-be431aaffd38) | ![A](https://github.com/user-attachments/assets/179adc3b-30fa-4e50-b2ab-dd6c75586b9f) | 0.0732 / 24 |
| `matrix/1920x1080/dark/47/top-default` | ![B](https://github.com/user-attachments/assets/8d015be2-9527-439b-ab0c-bf3d21a0f38d) | ![A](https://github.com/user-attachments/assets/4083f9d9-b7e4-48aa-8e3f-2bad1c691396) | 0.0046 / 11 |
| `matrix/1920x1080/dark/47/end-default` | ![B](https://github.com/user-attachments/assets/6034c425-70eb-46e0-bc17-0aa29b4d6096) | ![A](https://github.com/user-attachments/assets/acecad0d-b9c4-4bf3-939f-2345af03ed37) | 0.12 / 37 |
| `matrix/1920x1080/dark/48/top-default` | ![B](https://github.com/user-attachments/assets/34fa5353-82ed-4ca0-b4d1-e6004544eb24) | ![A](https://github.com/user-attachments/assets/65d75245-58bf-41e4-a759-725e111292b7) | 0.0046 / 11 |
| `matrix/1920x1080/dark/48/end-default` | ![B](https://github.com/user-attachments/assets/7c4d28c3-06ef-4ae3-96d3-886b20b7209f) | ![A](https://github.com/user-attachments/assets/94e95234-6aec-4467-b552-1951434e839f) | 0.0507 / 24 |
| `matrix/1920x1080/dark/48/actions-end-default` | ![B](https://github.com/user-attachments/assets/3e0ff2a1-1c0b-4c57-98bd-d0da3e1b8788) | ![A](https://github.com/user-attachments/assets/711fd2ae-689c-411e-894d-adee666e6a73) | 0.0387 / 17 |
| `matrix/1920x1080/light/46/top-default` | ![B](https://github.com/user-attachments/assets/9a6a0616-4612-4560-9229-943407cec6fb) | ![A](https://github.com/user-attachments/assets/c198a3b7-28be-43c1-9eaa-881a32b5b057) | 0.0642 / 40 |
| `matrix/1920x1080/light/46/end-default` | ![B](https://github.com/user-attachments/assets/43526e6c-4adb-435a-9b99-47fdf90dc374) | ![A](https://github.com/user-attachments/assets/35e2be3d-8390-4e29-bdda-a883792a2be3) | 0.0485 / 24 |
| `matrix/1920x1080/light/47/top-default` | ![B](https://github.com/user-attachments/assets/6efefe17-c618-4493-ac8c-25564666fbe2) | ![A](https://github.com/user-attachments/assets/8999048f-a8d4-4f8c-9982-a760ec1d7107) | 0.0046 / 13 |
| `matrix/1920x1080/light/47/end-default` | ![B](https://github.com/user-attachments/assets/91d182bc-c08b-47ef-91cd-a045797e04df) | ![A](https://github.com/user-attachments/assets/a945b095-c663-437b-bd98-e937f0555c24) | 0.0966 / 36 |
| `matrix/1920x1080/light/48/top-default` | ![B](https://github.com/user-attachments/assets/a6f71ba9-824e-44b6-8358-039536eedac8) | ![A](https://github.com/user-attachments/assets/4e9b9e15-ac27-4c15-b191-b9c97cde6636) | 0.0046 / 13 |
| `matrix/1920x1080/light/48/end-default` | ![B](https://github.com/user-attachments/assets/67a603fc-ef3a-4f5a-b1e0-f7efea04f917) | ![A](https://github.com/user-attachments/assets/46f4d9d4-5252-4f55-a8f1-faea0dd7f3f6) | 0.0509 / 26 |

### Supplemental todo-3 measurements (240-char path, preparation end, metadata)

| State | Before | After |
|---|---|---|
| `1280x800/dark/diagnostic-open` | ![B](https://github.com/user-attachments/assets/f7d62597-7ba4-4c6d-9306-41a073eaf83c) | ![A](https://github.com/user-attachments/assets/c6c2b570-cacd-4a78-a7d7-e1b9ce8973b1) |
| `1280x800/dark/observation-details` | ![B](https://github.com/user-attachments/assets/8ef4dad6-c33e-4009-af3e-77a7d3eb43a9) | ![A](https://github.com/user-attachments/assets/babf9a8e-d828-4f74-8dbe-7587045da549) |
| `1280x800/dark/prepare-end` | ![B](https://github.com/user-attachments/assets/cf9ca6b3-8989-4311-926a-87bd577cdb7f) | ![A](https://github.com/user-attachments/assets/4c70c3e5-d224-4fcc-ac38-3be560555c7d) |
| `1280x800/light/diagnostic-open` | ![B](https://github.com/user-attachments/assets/fabe68fb-fb7b-4aff-8971-1ae0e79dc48b) | ![A](https://github.com/user-attachments/assets/a5a3f17a-2c14-4fea-8843-4ddb02d103a9) |
| `1280x800/light/observation-details` | ![B](https://github.com/user-attachments/assets/7689c4f4-94f1-41d2-bd6c-852958689bbd) | ![A](https://github.com/user-attachments/assets/d42a6872-037d-4a7b-aad5-dab5538d7429) |
| `1280x800/light/prepare-end` | ![B](https://github.com/user-attachments/assets/6f7c3fd4-88d0-4c02-a7e0-1c0def870a05) | ![A](https://github.com/user-attachments/assets/5a0d6124-0e8a-49aa-92ed-9b75f5c33efb) |
| `1280x800/onboarding-diagnostics` | ![B](https://github.com/user-attachments/assets/4c1da028-ee49-4aac-8bd0-84d6c8de4333) | ![A](https://github.com/user-attachments/assets/cc15be92-9221-4c48-8cd1-b4ddd9df2551) |
| `1920x1080/dark/diagnostic-open` | ![B](https://github.com/user-attachments/assets/b45505d4-20a7-4eaf-8dc1-f10e3a849950) | ![A](https://github.com/user-attachments/assets/22e80d94-dad8-4820-9e21-3119e97788f1) |
| `1920x1080/dark/observation-details` | ![B](https://github.com/user-attachments/assets/fe60721b-741e-43d6-a6e0-fe801ff88a2e) | ![A](https://github.com/user-attachments/assets/3459d1cd-d072-4513-bf69-c695b6187631) |
| `1920x1080/dark/prepare-end` | ![B](https://github.com/user-attachments/assets/dacd7ed3-213d-4d1d-9628-f912881623e3) | ![A](https://github.com/user-attachments/assets/9fded737-9c9b-4f64-af78-a57e7f25b1c7) |
| `1920x1080/light/diagnostic-open` | ![B](https://github.com/user-attachments/assets/2d82de3c-d526-459c-bf41-0c0cd30d9407) | ![A](https://github.com/user-attachments/assets/52aa7380-80c2-4e58-a348-ab84cee5950f) |
| `1920x1080/light/observation-details` | ![B](https://github.com/user-attachments/assets/ef6be066-ae1e-4e5a-b3ea-4b2b4d473950) | ![A](https://github.com/user-attachments/assets/e9886d82-c0ee-4cff-90a5-feecacca92ee) |
| `1920x1080/light/prepare-end` | ![B](https://github.com/user-attachments/assets/19c8d7e6-dfac-4913-b390-a801b70528c7) | ![A](https://github.com/user-attachments/assets/bedbb4e5-5b14-49d2-92ec-23e9d46e7caa) |
| `840x620/dark/diagnostic-open` | ![B](https://github.com/user-attachments/assets/8bdcb9dd-3d57-41dd-98cd-1c3b8bcba1c2) | ![A](https://github.com/user-attachments/assets/9e0c65f8-a6d1-4c5b-84af-9d0fd4615db4) |
| `840x620/dark/observation-details` | ![B](https://github.com/user-attachments/assets/e36337cb-9124-489c-9676-911115b34d24) | ![A](https://github.com/user-attachments/assets/f7a3603a-bb3e-434b-90fa-3115eb88dcca) |
| `840x620/dark/prepare-end` | ![B](https://github.com/user-attachments/assets/c4ea0c0d-4e78-4aeb-863b-072845fc7d63) | ![A](https://github.com/user-attachments/assets/e447a98f-2cf2-48d9-9754-7083235c5a69) |
| `840x620/light/diagnostic-open` | ![B](https://github.com/user-attachments/assets/e56c538e-207e-4720-ad61-65970a78848d) | ![A](https://github.com/user-attachments/assets/b4b9b785-6a6e-4753-af06-456ec7632b0f) |
| `840x620/light/observation-details` | ![B](https://github.com/user-attachments/assets/8b6a8d82-0487-4759-af32-05cecfba86c3) | ![A](https://github.com/user-attachments/assets/2059f939-a71a-459c-8120-b44e4450d2b2) |
| `840x620/light/prepare-end` | ![B](https://github.com/user-attachments/assets/1e18f250-0cc2-4265-8cb3-7c6c31e76929) | ![A](https://github.com/user-attachments/assets/d9fc0949-08a1-41de-988b-63b3053aa6ee) |

### Accepted case-03 scenarios (after build, round 02)

| Scenario frame | After |
|---|---|
| `03/unsupported/unsupported` | ![A](https://github.com/user-attachments/assets/fa58d8a4-3110-4095-9296-8b9e60a72ac9) |
| `03/unsupported/result` | ![A](https://github.com/user-attachments/assets/52cc5256-df4e-4953-b109-0f917a9b799c) |
| `03/disconnected/disconnected` | ![A](https://github.com/user-attachments/assets/4b6a4b5d-2078-439c-b344-721f7da03c8e) |
| `03/disconnected/result` | ![A](https://github.com/user-attachments/assets/03934a29-c346-437d-b833-2225b5a79c87) |
| `03/stale/stale` | ![A](https://github.com/user-attachments/assets/6d96495f-e472-47e9-a560-519f235c5c9b) |
| `03/stale/result` | ![A](https://github.com/user-attachments/assets/c07f942c-8873-4d9f-a286-337e7ea39775) |
| `03/missing-scope/missing-scope` | ![A](https://github.com/user-attachments/assets/65b5594b-a310-4ace-8d9c-7ab4d87ea00f) |
| `03/missing-scope/result` | ![A](https://github.com/user-attachments/assets/02e9e6fb-20d3-4a80-947d-0363651e8bf1) |
| `03/fresh/result` | ![A](https://github.com/user-attachments/assets/e8dbbca7-fc84-4044-ba46-d77c672f055b) |
| `03/foreign-owner/foreign-owner-explanation` | ![A](https://github.com/user-attachments/assets/2d5d1bd7-eec9-4a60-baa3-b8f5239c624b) |
| `03/foreign-owner/result` | ![A](https://github.com/user-attachments/assets/a97ea700-ec93-4b13-8d57-928afd5f03a7) |
| `03/confirmation-binding/result` | ![A](https://github.com/user-attachments/assets/53eb86cd-0c4d-4591-9d02-8e854e554c9a) |
| `03/no-reconnect-replay/disconnected` | ![A](https://github.com/user-attachments/assets/882fbeeb-f1f1-402e-9fa4-69bfdb71533f) |
| `03/no-reconnect-replay/result` | ![A](https://github.com/user-attachments/assets/065cd0c3-dc29-496b-ae51-bf9e8f1feb38) |
| `03/diagnostic-copy/diagnostic-identities` | ![A](https://github.com/user-attachments/assets/c82953d9-c99b-4d2f-a26a-978f58b8e3f1) |
| `03/diagnostic-copy/result` | ![A](https://github.com/user-attachments/assets/9fcf21e2-e8f5-4d11-a293-dd4b94ff0b9f) |
| `03/unknown-disclosure/unknown-detail-preserved` | ![A](https://github.com/user-attachments/assets/94078561-2a7e-4b87-aea0-9a75a0a5c282) |
| `03/unknown-disclosure/result` | ![A](https://github.com/user-attachments/assets/093d344a-5f0e-4c4d-b2c2-3cce18421cd8) |
| `03/request-counters/unsupported` | ![A](https://github.com/user-attachments/assets/6da73bc9-a8ff-4a33-9010-9a804861543b) |
| `03/request-counters/disconnected` | ![A](https://github.com/user-attachments/assets/05093309-2cea-4487-92b5-af93c546edf9) |
| `03/request-counters/stale` | ![A](https://github.com/user-attachments/assets/b54a9c71-b49a-4fa3-befa-60e45ebc8c1d) |
| `03/request-counters/missing-scope` | ![A](https://github.com/user-attachments/assets/3e776b53-2279-46ca-8d0b-fea0d53041ef) |
| `03/request-counters/result` | ![A](https://github.com/user-attachments/assets/614a829d-0d5b-407a-bbbc-83530e277db3) |

## Residual findings

- The provider/turn error overlay in states 38 and 45 is pre-existing and assigned to todo 04 (W-01/W-02). This PR does not change it.
- Existing authored English copy, small untouched fact/browser buttons and the full universal Q1-Q12 matrix are owned elsewhere or deferred to the Final wave, per the 2026-10-19 amendment.
- The 390-wide frames are labelled renderer stress probes. They do not claim phone support.
- The lint run printed four pre-existing WelcomeWizard React warnings and no errors.

Model and harness: Claude (Opus) coding agent in Senpi, using the shared packaged-Electron HIG runner `scripts/hig` at `132dc59d`.
