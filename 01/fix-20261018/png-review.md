# Final per-PNG review

316 final PNGs were opened and match their declared states. Renderer geometry/visible-state assertions are in the adjacent manifests; native cross-checks are distinct files. All final rows PASS.

| PNG | What it shows | Verdict |
|---|---|---|
| [after/1280x800/01_first_launch_onboarding_connection.png](after/1280x800/01_first_launch_onboarding_connection.png) | Connection onboarding: local computer selected and connected; connection-stage heading visible. | PASS |
| [after/1280x800/02_onboarding_agents.png](after/1280x800/02_onboarding_agents.png) | Agents onboarding: provider availability rows and agents-stage explanation; distinct from connection step 01. | PASS |
| [after/1280x800/03_onboarding_project_selection.png](after/1280x800/03_onboarding_project_selection.png) | Project-selection onboarding with import choices. | PASS |
| [after/1280x800/04_empty_projects.png](after/1280x800/04_empty_projects.png) | Empty workspace with the add-project action. | PASS |
| [after/1280x800/05_add_project_import_modal.png](after/1280x800/05_add_project_import_modal.png) | Import-method dialog with Local folder and provider choices. | PASS |
| [after/1280x800/06_local_folder_picker.png](after/1280x800/06_local_folder_picker.png) | Local folder picker showing the isolated workspace and baseline-project folder. | PASS |
| [after/1280x800/07_chat_empty_project.png](after/1280x800/07_chat_empty_project.png) | Empty baseline-project draft and composer. | PASS |
| [after/1280x800/08_project_selection.png](after/1280x800/08_project_selection.png) | Project chooser open over the empty-project draft. | PASS |
| [after/1280x800/09_right_panel_menu.png](after/1280x800/09_right_panel_menu.png) | Right-panel chooser menu open. | PASS |
| [after/1280x800/10_right_files.png](after/1280x800/10_right_files.png) | Files pane open with search/refresh toolbar and empty isolated file tree. | PASS |
| [after/1280x800/11_add_action_dialog.png](after/1280x800/11_add_action_dialog.png) | Add Action dialog with command/name/preview fields; not submitted. | PASS |
| [after/1280x800/12_right_agents.png](after/1280x800/12_right_agents.png) | Agents pane open with its no-agents empty state. | PASS |
| [after/1280x800/13_right_run_graph.png](after/1280x800/13_right_run_graph.png) | Run Graph pane with no-snapshot explanation. | PASS |
| [after/1280x800/14_device_setup_dialog.png](after/1280x800/14_device_setup_dialog.png) | Set up devices dialog open. | PASS |
| [after/1280x800/15_right_browser.png](after/1280x800/15_right_browser.png) | Browser pane with URL control and No preview yet state. | PASS |
| [after/1280x800/16_right_terminal.png](after/1280x800/16_right_terminal.png) | Terminal pane initialized with a visible idle shell prompt; no command sent. | PASS |
| [after/1280x800/17_settings_general.png](after/1280x800/17_settings_general.png) | General settings with new-thread and device-default controls. | PASS |
| [after/1280x800/18_settings_appearance_light.png](after/1280x800/18_settings_appearance_light.png) | Appearance settings with Light explicitly selected, not System. | PASS |
| [after/1280x800/19_settings_appearance_dark.png](after/1280x800/19_settings_appearance_dark.png) | Appearance settings with Dark explicitly selected. | PASS |
| [after/1280x800/20_settings_keybindings.png](after/1280x800/20_settings_keybindings.png) | Keybindings settings with shortcut rows. | PASS |
| [after/1280x800/21_settings_snapshots.png](after/1280x800/21_settings_snapshots.png) | SnapShots settings and disabled capture toggle. | PASS |
| [after/1280x800/22_settings_providers.png](after/1280x800/22_settings_providers.png) | Providers settings with local provider availability rows. | PASS |
| [after/1280x800/23_settings_integrations.png](after/1280x800/23_settings_integrations.png) | Integrations settings with browser profiles and device options. | PASS |
| [after/1280x800/24_settings_source_control.png](after/1280x800/24_settings_source_control.png) | Source Control settings with Git and source-control provider status. | PASS |
| [after/1280x800/25_settings_storage.png](after/1280x800/25_settings_storage.png) | Storage settings with cleanup options. | PASS |
| [after/1280x800/26_settings_connections.png](after/1280x800/26_settings_connections.png) | Connections settings and no saved remote environments. | PASS |
| [after/1280x800/27_settings_archive.png](after/1280x800/27_settings_archive.png) | Archive settings with no archived threads. | PASS |
| [after/1280x800/28_add_custom_model_form.png](after/1280x800/28_add_custom_model_form.png) | Unsaved Add custom model form containing capture-fixture-unsaved; Add and Cancel visible. | PASS |
| [after/1280x800/29_settings_diagnostics.png](after/1280x800/29_settings_diagnostics.png) | Diagnostics resource monitor with host and collection health. | PASS |
| [after/1280x800/30_settings_licenses.png](after/1280x800/30_settings_licenses.png) | Third-party notices and license list. | PASS |
| [after/1280x800/31_chat_model_selector.png](after/1280x800/31_chat_model_selector.png) | Model selector open with provider/model choices; no request sent. | PASS |
| [after/1280x800/32_chat_permission_menu.png](after/1280x800/32_chat_permission_menu.png) | Permission/execution-mode menu open with current selection. | PASS |
| [after/1280x800/33_project_list_with_threads.png](after/1280x800/33_project_list_with_threads.png) | Sidebar lists all six synthetic fixture threads beside the empty project draft. | PASS |
| [after/1280x800/34_chat_messages.png](after/1280x800/34_chat_messages.png) | 01 Conversation selected; seeded user question and local screenshot fixture Markdown reply visible. | PASS |
| [after/1280x800/35_chat_long_messages.png](after/1280x800/35_chat_long_messages.png) | 02 Long messages selected; long user brief, Baseline review and numbered sections visible. | PASS |
| [after/1280x800/36_chat_code_blocks.electron.png](after/1280x800/36_chat_code_blocks.electron.png) | Light Code blocks conversation with TypeScript greeting, shell block and fixture-results table. Native Electron compositor cross-check of the same state. | PASS |
| [after/1280x800/36_chat_code_blocks.png](after/1280x800/36_chat_code_blocks.png) | Light Code blocks conversation with TypeScript greeting, shell block and fixture-results table. | PASS |
| [after/1280x800/37_chat_streaming_working.png](after/1280x800/37_chat_streaming_working.png) | Working fixture with Inspecting the local workspace text, working indicator and stop control; synthetic only. | PASS |
| [after/1280x800/38_chat_error.png](after/1280x800/38_chat_error.png) | Error fixture with provider-unavailable notice and seeded Recovery context explanation; no request sent. | PASS |
| [after/1280x800/39_chat_empty_existing_thread.png](after/1280x800/39_chat_empty_existing_thread.png) | 06 Empty thread selected with no messages and an empty composer. | PASS |
| [after/1280x800/40_right_controlled_tasks.png](after/1280x800/40_right_controlled_tasks.png) | Controlled Tasks pane with the baseline-project control settings and unavailable-operation explanation. | PASS |
| [after/1280x800/41_chat_code_blocks_dark.electron.png](after/1280x800/41_chat_code_blocks_dark.electron.png) | Dark Code blocks conversation with painted TypeScript greeting, shell block and results table. Native Electron compositor cross-check of the same state. | PASS |
| [after/1280x800/41_chat_code_blocks_dark.png](after/1280x800/41_chat_code_blocks_dark.png) | Dark Code blocks conversation with painted TypeScript greeting, shell block and results table. | PASS |
| [after/1280x800/44_delete_thread_confirmation.png](after/1280x800/44_delete_thread_confirmation.png) | Delete-thread confirmation naming 03 Code blocks; Cancel/Confirm visible, not confirmed. | PASS |
| [after/1280x800/45_rename_thread_inline.png](after/1280x800/45_rename_thread_inline.png) | Inline conversation-title editor containing 03 Code blocks; project chooser open. | PASS |
| [after/1280x800/46_project_settings_control.png](after/1280x800/46_project_settings_control.png) | Project workflow controls with Runtime execution control and preparation inputs visible. | PASS |
| [after/1280x800/47_project_settings_evidence.png](after/1280x800/47_project_settings_evidence.png) | Evidence summary heading and unavailable-evidence/privacy explanation visible; distinct from the Fitness frame. | PASS |
| [after/1280x800/48_project_settings_model_fitness.png](after/1280x800/48_project_settings_model_fitness.png) | Model Fitness heading, contract-evidence explanation and Load history control visible. | PASS |
| [after/1920x1080/01_first_launch_onboarding_connection.png](after/1920x1080/01_first_launch_onboarding_connection.png) | Connection onboarding: local computer selected and connected; connection-stage heading visible. | PASS |
| [after/1920x1080/02_onboarding_agents.png](after/1920x1080/02_onboarding_agents.png) | Agents onboarding: provider availability rows and agents-stage explanation; distinct from connection step 01. | PASS |
| [after/1920x1080/03_onboarding_project_selection.png](after/1920x1080/03_onboarding_project_selection.png) | Project-selection onboarding with import choices. | PASS |
| [after/1920x1080/04_empty_projects.png](after/1920x1080/04_empty_projects.png) | Empty workspace with the add-project action. | PASS |
| [after/1920x1080/05_add_project_import_modal.png](after/1920x1080/05_add_project_import_modal.png) | Import-method dialog with Local folder and provider choices. | PASS |
| [after/1920x1080/06_local_folder_picker.png](after/1920x1080/06_local_folder_picker.png) | Local folder picker showing the isolated workspace and baseline-project folder. | PASS |
| [after/1920x1080/07_chat_empty_project.png](after/1920x1080/07_chat_empty_project.png) | Empty baseline-project draft and composer. | PASS |
| [after/1920x1080/08_project_selection.png](after/1920x1080/08_project_selection.png) | Project chooser open over the empty-project draft. | PASS |
| [after/1920x1080/09_right_panel_menu.png](after/1920x1080/09_right_panel_menu.png) | Right-panel chooser menu open. | PASS |
| [after/1920x1080/10_right_files.png](after/1920x1080/10_right_files.png) | Files pane open with search/refresh toolbar and empty isolated file tree. | PASS |
| [after/1920x1080/11_add_action_dialog.png](after/1920x1080/11_add_action_dialog.png) | Add Action dialog with command/name/preview fields; not submitted. | PASS |
| [after/1920x1080/12_right_agents.png](after/1920x1080/12_right_agents.png) | Agents pane open with its no-agents empty state. | PASS |
| [after/1920x1080/13_right_run_graph.png](after/1920x1080/13_right_run_graph.png) | Run Graph pane with no-snapshot explanation. | PASS |
| [after/1920x1080/14_device_setup_dialog.png](after/1920x1080/14_device_setup_dialog.png) | Set up devices dialog open. | PASS |
| [after/1920x1080/15_right_browser.png](after/1920x1080/15_right_browser.png) | Browser pane with URL control and No preview yet state. | PASS |
| [after/1920x1080/16_right_terminal.png](after/1920x1080/16_right_terminal.png) | Terminal pane initialized with a visible idle shell prompt; no command sent. | PASS |
| [after/1920x1080/17_settings_general.png](after/1920x1080/17_settings_general.png) | General settings with new-thread and device-default controls. | PASS |
| [after/1920x1080/18_settings_appearance_light.png](after/1920x1080/18_settings_appearance_light.png) | Appearance settings with Light explicitly selected, not System. | PASS |
| [after/1920x1080/19_settings_appearance_dark.png](after/1920x1080/19_settings_appearance_dark.png) | Appearance settings with Dark explicitly selected. | PASS |
| [after/1920x1080/20_settings_keybindings.png](after/1920x1080/20_settings_keybindings.png) | Keybindings settings with shortcut rows. | PASS |
| [after/1920x1080/21_settings_snapshots.png](after/1920x1080/21_settings_snapshots.png) | SnapShots settings and disabled capture toggle. | PASS |
| [after/1920x1080/22_settings_providers.png](after/1920x1080/22_settings_providers.png) | Providers settings with local provider availability rows. | PASS |
| [after/1920x1080/23_settings_integrations.png](after/1920x1080/23_settings_integrations.png) | Integrations settings with browser profiles and device options. | PASS |
| [after/1920x1080/24_settings_source_control.png](after/1920x1080/24_settings_source_control.png) | Source Control settings with Git and source-control provider status. | PASS |
| [after/1920x1080/25_settings_storage.png](after/1920x1080/25_settings_storage.png) | Storage settings with cleanup options. | PASS |
| [after/1920x1080/26_settings_connections.png](after/1920x1080/26_settings_connections.png) | Connections settings and no saved remote environments. | PASS |
| [after/1920x1080/27_settings_archive.png](after/1920x1080/27_settings_archive.png) | Archive settings with no archived threads. | PASS |
| [after/1920x1080/28_add_custom_model_form.png](after/1920x1080/28_add_custom_model_form.png) | Unsaved Add custom model form containing capture-fixture-unsaved; Add and Cancel visible. | PASS |
| [after/1920x1080/29_settings_diagnostics.png](after/1920x1080/29_settings_diagnostics.png) | Diagnostics resource monitor with host and collection health. | PASS |
| [after/1920x1080/30_settings_licenses.png](after/1920x1080/30_settings_licenses.png) | Third-party notices and license list. | PASS |
| [after/1920x1080/31_chat_model_selector.png](after/1920x1080/31_chat_model_selector.png) | Model selector open with provider/model choices; no request sent. | PASS |
| [after/1920x1080/32_chat_permission_menu.png](after/1920x1080/32_chat_permission_menu.png) | Permission/execution-mode menu open with current selection. | PASS |
| [after/1920x1080/33_project_list_with_threads.png](after/1920x1080/33_project_list_with_threads.png) | Sidebar lists all six synthetic fixture threads beside the empty project draft. | PASS |
| [after/1920x1080/34_chat_messages.png](after/1920x1080/34_chat_messages.png) | 01 Conversation selected; seeded user question and local screenshot fixture Markdown reply visible. | PASS |
| [after/1920x1080/35_chat_long_messages.png](after/1920x1080/35_chat_long_messages.png) | 02 Long messages selected; long user brief, Baseline review and numbered sections visible. | PASS |
| [after/1920x1080/36_chat_code_blocks.electron.png](after/1920x1080/36_chat_code_blocks.electron.png) | Light Code blocks conversation with TypeScript greeting, shell block and fixture-results table. Native Electron compositor cross-check of the same state. | PASS |
| [after/1920x1080/36_chat_code_blocks.png](after/1920x1080/36_chat_code_blocks.png) | Light Code blocks conversation with TypeScript greeting, shell block and fixture-results table. | PASS |
| [after/1920x1080/37_chat_streaming_working.png](after/1920x1080/37_chat_streaming_working.png) | Working fixture with Inspecting the local workspace text, working indicator and stop control; synthetic only. | PASS |
| [after/1920x1080/38_chat_error.png](after/1920x1080/38_chat_error.png) | Error fixture with provider-unavailable notice and seeded Recovery context explanation; no request sent. | PASS |
| [after/1920x1080/39_chat_empty_existing_thread.png](after/1920x1080/39_chat_empty_existing_thread.png) | 06 Empty thread selected with no messages and an empty composer. | PASS |
| [after/1920x1080/40_right_controlled_tasks.png](after/1920x1080/40_right_controlled_tasks.png) | Controlled Tasks pane with the baseline-project control settings and unavailable-operation explanation. | PASS |
| [after/1920x1080/41_chat_code_blocks_dark.electron.png](after/1920x1080/41_chat_code_blocks_dark.electron.png) | Dark Code blocks conversation with painted TypeScript greeting, shell block and results table. Native Electron compositor cross-check of the same state. | PASS |
| [after/1920x1080/41_chat_code_blocks_dark.png](after/1920x1080/41_chat_code_blocks_dark.png) | Dark Code blocks conversation with painted TypeScript greeting, shell block and results table. | PASS |
| [after/1920x1080/44_delete_thread_confirmation.png](after/1920x1080/44_delete_thread_confirmation.png) | Delete-thread confirmation naming 03 Code blocks; Cancel/Confirm visible, not confirmed. | PASS |
| [after/1920x1080/45_rename_thread_inline.png](after/1920x1080/45_rename_thread_inline.png) | Inline conversation-title editor containing 03 Code blocks; project chooser open. | PASS |
| [after/1920x1080/46_project_settings_control.png](after/1920x1080/46_project_settings_control.png) | Project workflow controls with Runtime execution control and preparation inputs visible. | PASS |
| [after/1920x1080/47_project_settings_evidence.png](after/1920x1080/47_project_settings_evidence.png) | Evidence summary heading and unavailable-evidence/privacy explanation visible; distinct from the Fitness frame. | PASS |
| [after/1920x1080/48_project_settings_model_fitness.png](after/1920x1080/48_project_settings_model_fitness.png) | Model Fitness heading, contract-evidence explanation and Load history control visible. | PASS |
| [after/390x844/42_narrow_chat_dark.electron.png](after/390x844/42_narrow_chat_dark.electron.png) | Forced 390x844 dark Code blocks conversation; TypeScript, shell and table retained; unsupported native width. Native Electron compositor cross-check of the same state. | PASS |
| [after/390x844/42_narrow_chat_dark.png](after/390x844/42_narrow_chat_dark.png) | Forced 390x844 dark Code blocks conversation; TypeScript, shell and table retained; unsupported native width. | PASS |
| [after/390x844/43_narrow_chat_light.electron.png](after/390x844/43_narrow_chat_light.electron.png) | Forced 390x844 light Code blocks conversation; TypeScript, shell and table retained; unsupported native width. Native Electron compositor cross-check of the same state. | PASS |
| [after/390x844/43_narrow_chat_light.png](after/390x844/43_narrow_chat_light.png) | Forced 390x844 light Code blocks conversation; TypeScript, shell and table retained; unsupported native width. | PASS |
| [after/matrix/1280x800/dark/46/end-default.png](after/matrix/1280x800/dark/46/end-default.png) | dark 1280x800: Workflow controls at its end boundary. | PASS |
| [after/matrix/1280x800/dark/46/top-default.png](after/matrix/1280x800/dark/46/top-default.png) | dark 1280x800: Workflow controls at its top boundary. | PASS |
| [after/matrix/1280x800/dark/47/end-default.png](after/matrix/1280x800/dark/47/end-default.png) | dark 1280x800: Evidence summary at its end boundary. | PASS |
| [after/matrix/1280x800/dark/47/top-default.png](after/matrix/1280x800/dark/47/top-default.png) | dark 1280x800: Evidence summary at its top boundary. | PASS |
| [after/matrix/1280x800/dark/48/actions-end-default.png](after/matrix/1280x800/dark/48/actions-end-default.png) | dark 1280x800: Actions section, Add action and no configured actions at its end boundary. | PASS |
| [after/matrix/1280x800/dark/48/end-default.png](after/matrix/1280x800/dark/48/end-default.png) | dark 1280x800: Model Fitness at its end boundary. | PASS |
| [after/matrix/1280x800/dark/48/top-default.png](after/matrix/1280x800/dark/48/top-default.png) | dark 1280x800: Model Fitness at its top boundary. | PASS |
| [after/matrix/1280x800/light/46/end-default.png](after/matrix/1280x800/light/46/end-default.png) | light 1280x800: Workflow controls at its end boundary. | PASS |
| [after/matrix/1280x800/light/46/prepare-end-default.png](after/matrix/1280x800/light/46/prepare-end-default.png) | light 1280x800: Preparation action visible in the controls section. | PASS |
| [after/matrix/1280x800/light/46/top-default.png](after/matrix/1280x800/light/46/top-default.png) | light 1280x800: Workflow controls at its top boundary. | PASS |
| [after/matrix/1280x800/light/47/end-default.png](after/matrix/1280x800/light/47/end-default.png) | light 1280x800: Evidence summary at its end boundary. | PASS |
| [after/matrix/1280x800/light/47/top-default.png](after/matrix/1280x800/light/47/top-default.png) | light 1280x800: Evidence summary at its top boundary. | PASS |
| [after/matrix/1280x800/light/48/actions-end-default.png](after/matrix/1280x800/light/48/actions-end-default.png) | light 1280x800: Actions section, Add action and no configured actions at its end boundary. | PASS |
| [after/matrix/1280x800/light/48/end-default.png](after/matrix/1280x800/light/48/end-default.png) | light 1280x800: Model Fitness at its end boundary. | PASS |
| [after/matrix/1280x800/light/48/top-default.png](after/matrix/1280x800/light/48/top-default.png) | light 1280x800: Model Fitness at its top boundary. | PASS |
| [after/matrix/1920x1080/dark/46/end-default.png](after/matrix/1920x1080/dark/46/end-default.png) | dark 1920x1080: Workflow controls at its end boundary. | PASS |
| [after/matrix/1920x1080/dark/46/top-default.png](after/matrix/1920x1080/dark/46/top-default.png) | dark 1920x1080: Workflow controls at its top boundary. | PASS |
| [after/matrix/1920x1080/dark/47/end-default.png](after/matrix/1920x1080/dark/47/end-default.png) | dark 1920x1080: Evidence summary at its end boundary. | PASS |
| [after/matrix/1920x1080/dark/47/top-default.png](after/matrix/1920x1080/dark/47/top-default.png) | dark 1920x1080: Evidence summary at its top boundary. | PASS |
| [after/matrix/1920x1080/dark/48/actions-end-default.png](after/matrix/1920x1080/dark/48/actions-end-default.png) | dark 1920x1080: Actions section, Add action and no configured actions at its end boundary. | PASS |
| [after/matrix/1920x1080/dark/48/end-default.png](after/matrix/1920x1080/dark/48/end-default.png) | dark 1920x1080: Model Fitness at its end boundary. | PASS |
| [after/matrix/1920x1080/dark/48/top-default.png](after/matrix/1920x1080/dark/48/top-default.png) | dark 1920x1080: Model Fitness at its top boundary. | PASS |
| [after/matrix/1920x1080/light/46/end-default.png](after/matrix/1920x1080/light/46/end-default.png) | light 1920x1080: Workflow controls at its end boundary. | PASS |
| [after/matrix/1920x1080/light/46/prepare-end-default.png](after/matrix/1920x1080/light/46/prepare-end-default.png) | light 1920x1080: Preparation action visible in the controls section. | PASS |
| [after/matrix/1920x1080/light/46/top-default.png](after/matrix/1920x1080/light/46/top-default.png) | light 1920x1080: Workflow controls at its top boundary. | PASS |
| [after/matrix/1920x1080/light/47/end-default.png](after/matrix/1920x1080/light/47/end-default.png) | light 1920x1080: Evidence summary at its end boundary. | PASS |
| [after/matrix/1920x1080/light/47/top-default.png](after/matrix/1920x1080/light/47/top-default.png) | light 1920x1080: Evidence summary at its top boundary. | PASS |
| [after/matrix/1920x1080/light/48/actions-end-default.png](after/matrix/1920x1080/light/48/actions-end-default.png) | light 1920x1080: Actions section, Add action and no configured actions at its end boundary. | PASS |
| [after/matrix/1920x1080/light/48/end-default.png](after/matrix/1920x1080/light/48/end-default.png) | light 1920x1080: Model Fitness at its end boundary. | PASS |
| [after/matrix/1920x1080/light/48/top-default.png](after/matrix/1920x1080/light/48/top-default.png) | light 1920x1080: Model Fitness at its top boundary. | PASS |
| [after/matrix/2560x1440/dark/46/end-default.png](after/matrix/2560x1440/dark/46/end-default.png) | dark 2560x1440: Workflow controls at its end boundary. | PASS |
| [after/matrix/2560x1440/dark/46/top-default.png](after/matrix/2560x1440/dark/46/top-default.png) | dark 2560x1440: Workflow controls at its top boundary. | PASS |
| [after/matrix/2560x1440/dark/47/end-default.png](after/matrix/2560x1440/dark/47/end-default.png) | dark 2560x1440: Evidence summary at its end boundary. | PASS |
| [after/matrix/2560x1440/dark/47/top-default.png](after/matrix/2560x1440/dark/47/top-default.png) | dark 2560x1440: Evidence summary at its top boundary. | PASS |
| [after/matrix/2560x1440/dark/48/actions-end-default.png](after/matrix/2560x1440/dark/48/actions-end-default.png) | dark 2560x1440: Actions section, Add action and no configured actions at its end boundary. | PASS |
| [after/matrix/2560x1440/dark/48/end-default.png](after/matrix/2560x1440/dark/48/end-default.png) | dark 2560x1440: Model Fitness at its end boundary. | PASS |
| [after/matrix/2560x1440/dark/48/top-default.png](after/matrix/2560x1440/dark/48/top-default.png) | dark 2560x1440: Model Fitness at its top boundary. | PASS |
| [after/matrix/2560x1440/light/46/end-default.png](after/matrix/2560x1440/light/46/end-default.png) | light 2560x1440: Workflow controls at its end boundary. | PASS |
| [after/matrix/2560x1440/light/46/top-default.png](after/matrix/2560x1440/light/46/top-default.png) | light 2560x1440: Workflow controls at its top boundary. | PASS |
| [after/matrix/2560x1440/light/47/end-default.png](after/matrix/2560x1440/light/47/end-default.png) | light 2560x1440: Evidence summary at its end boundary. | PASS |
| [after/matrix/2560x1440/light/47/top-default.png](after/matrix/2560x1440/light/47/top-default.png) | light 2560x1440: Evidence summary at its top boundary. | PASS |
| [after/matrix/2560x1440/light/48/actions-end-default.png](after/matrix/2560x1440/light/48/actions-end-default.png) | light 2560x1440: Actions section, Add action and no configured actions at its end boundary. | PASS |
| [after/matrix/2560x1440/light/48/end-default.png](after/matrix/2560x1440/light/48/end-default.png) | light 2560x1440: Model Fitness at its end boundary. | PASS |
| [after/matrix/2560x1440/light/48/top-default.png](after/matrix/2560x1440/light/48/top-default.png) | light 2560x1440: Model Fitness at its top boundary. | PASS |
| [after/matrix/840x620/dark/46/end-default.png](after/matrix/840x620/dark/46/end-default.png) | dark 840x620: Workflow controls at its end boundary. | PASS |
| [after/matrix/840x620/dark/46/top-default.png](after/matrix/840x620/dark/46/top-default.png) | dark 840x620: Workflow controls at its top boundary. | PASS |
| [after/matrix/840x620/dark/47/end-default.png](after/matrix/840x620/dark/47/end-default.png) | dark 840x620: Evidence summary at its end boundary. | PASS |
| [after/matrix/840x620/dark/47/top-default.png](after/matrix/840x620/dark/47/top-default.png) | dark 840x620: Evidence summary at its top boundary. | PASS |
| [after/matrix/840x620/dark/48/actions-end-default.png](after/matrix/840x620/dark/48/actions-end-default.png) | dark 840x620: Actions section, Add action and no configured actions at its end boundary. | PASS |
| [after/matrix/840x620/dark/48/end-default.png](after/matrix/840x620/dark/48/end-default.png) | dark 840x620: Model Fitness at its end boundary. | PASS |
| [after/matrix/840x620/dark/48/top-default.png](after/matrix/840x620/dark/48/top-default.png) | dark 840x620: Model Fitness at its top boundary. | PASS |
| [after/matrix/840x620/light/46/end-default.png](after/matrix/840x620/light/46/end-default.png) | light 840x620: Workflow controls at its end boundary. | PASS |
| [after/matrix/840x620/light/46/top-default.png](after/matrix/840x620/light/46/top-default.png) | light 840x620: Workflow controls at its top boundary. | PASS |
| [after/matrix/840x620/light/47/end-default.png](after/matrix/840x620/light/47/end-default.png) | light 840x620: Evidence summary at its end boundary. | PASS |
| [after/matrix/840x620/light/47/top-default.png](after/matrix/840x620/light/47/top-default.png) | light 840x620: Evidence summary at its top boundary. | PASS |
| [after/matrix/840x620/light/48/actions-end-default.png](after/matrix/840x620/light/48/actions-end-default.png) | light 840x620: Actions section, Add action and no configured actions at its end boundary. | PASS |
| [after/matrix/840x620/light/48/end-default.png](after/matrix/840x620/light/48/end-default.png) | light 840x620: Model Fitness at its end boundary. | PASS |
| [after/matrix/840x620/light/48/top-default.png](after/matrix/840x620/light/48/top-default.png) | light 840x620: Model Fitness at its top boundary. | PASS |
| [before/1280x800/01_first_launch_onboarding_connection.png](before/1280x800/01_first_launch_onboarding_connection.png) | Connection onboarding: local computer selected and connected; connection-stage heading visible. | PASS |
| [before/1280x800/02_onboarding_agents.png](before/1280x800/02_onboarding_agents.png) | Agents onboarding: provider availability rows and agents-stage explanation; distinct from connection step 01. | PASS |
| [before/1280x800/03_onboarding_project_selection.png](before/1280x800/03_onboarding_project_selection.png) | Project-selection onboarding with import choices. | PASS |
| [before/1280x800/04_empty_projects.png](before/1280x800/04_empty_projects.png) | Empty workspace with the add-project action. | PASS |
| [before/1280x800/05_add_project_import_modal.png](before/1280x800/05_add_project_import_modal.png) | Import-method dialog with Local folder and provider choices. | PASS |
| [before/1280x800/06_local_folder_picker.png](before/1280x800/06_local_folder_picker.png) | Local folder picker showing the isolated workspace and baseline-project folder. | PASS |
| [before/1280x800/07_chat_empty_project.png](before/1280x800/07_chat_empty_project.png) | Empty baseline-project draft and composer. | PASS |
| [before/1280x800/08_project_selection.png](before/1280x800/08_project_selection.png) | Project chooser open over the empty-project draft. | PASS |
| [before/1280x800/09_right_panel_menu.png](before/1280x800/09_right_panel_menu.png) | Right-panel chooser menu open. | PASS |
| [before/1280x800/10_right_files.png](before/1280x800/10_right_files.png) | Files pane open with search/refresh toolbar and empty isolated file tree. | PASS |
| [before/1280x800/11_add_action_dialog.png](before/1280x800/11_add_action_dialog.png) | Add Action dialog with command/name/preview fields; not submitted. | PASS |
| [before/1280x800/12_right_agents.png](before/1280x800/12_right_agents.png) | Agents pane open with its no-agents empty state. | PASS |
| [before/1280x800/13_right_run_graph.png](before/1280x800/13_right_run_graph.png) | Run Graph pane with no-snapshot explanation. | PASS |
| [before/1280x800/14_device_setup_dialog.png](before/1280x800/14_device_setup_dialog.png) | Set up devices dialog open. | PASS |
| [before/1280x800/15_right_browser.png](before/1280x800/15_right_browser.png) | Browser pane with URL control and No preview yet state. | PASS |
| [before/1280x800/16_right_terminal.png](before/1280x800/16_right_terminal.png) | Terminal pane initialized with a visible idle shell prompt; no command sent. | PASS |
| [before/1280x800/17_settings_general.png](before/1280x800/17_settings_general.png) | General settings with new-thread and device-default controls. | PASS |
| [before/1280x800/18_settings_appearance_light.png](before/1280x800/18_settings_appearance_light.png) | Appearance settings with Light explicitly selected, not System. | PASS |
| [before/1280x800/19_settings_appearance_dark.png](before/1280x800/19_settings_appearance_dark.png) | Appearance settings with Dark explicitly selected. | PASS |
| [before/1280x800/20_settings_keybindings.png](before/1280x800/20_settings_keybindings.png) | Keybindings settings with shortcut rows. | PASS |
| [before/1280x800/21_settings_snapshots.png](before/1280x800/21_settings_snapshots.png) | SnapShots settings and disabled capture toggle. | PASS |
| [before/1280x800/22_settings_providers.png](before/1280x800/22_settings_providers.png) | Providers settings with local provider availability rows. | PASS |
| [before/1280x800/23_settings_integrations.png](before/1280x800/23_settings_integrations.png) | Integrations settings with browser profiles and device options. | PASS |
| [before/1280x800/24_settings_source_control.png](before/1280x800/24_settings_source_control.png) | Source Control settings with Git and source-control provider status. | PASS |
| [before/1280x800/25_settings_storage.png](before/1280x800/25_settings_storage.png) | Storage settings with cleanup options. | PASS |
| [before/1280x800/26_settings_connections.png](before/1280x800/26_settings_connections.png) | Connections settings and no saved remote environments. | PASS |
| [before/1280x800/27_settings_archive.png](before/1280x800/27_settings_archive.png) | Archive settings with no archived threads. | PASS |
| [before/1280x800/28_add_custom_model_form.png](before/1280x800/28_add_custom_model_form.png) | Unsaved Add custom model form containing capture-fixture-unsaved; Add and Cancel visible. | PASS |
| [before/1280x800/29_settings_diagnostics.png](before/1280x800/29_settings_diagnostics.png) | Diagnostics resource monitor with host and collection health. | PASS |
| [before/1280x800/30_settings_licenses.png](before/1280x800/30_settings_licenses.png) | Third-party notices and license list. | PASS |
| [before/1280x800/31_chat_model_selector.png](before/1280x800/31_chat_model_selector.png) | Model selector open with provider/model choices; no request sent. | PASS |
| [before/1280x800/32_chat_permission_menu.png](before/1280x800/32_chat_permission_menu.png) | Permission/execution-mode menu open with current selection. | PASS |
| [before/1280x800/33_project_list_with_threads.png](before/1280x800/33_project_list_with_threads.png) | Sidebar lists all six synthetic fixture threads beside the empty project draft. | PASS |
| [before/1280x800/34_chat_messages.png](before/1280x800/34_chat_messages.png) | 01 Conversation selected; seeded user question and local screenshot fixture Markdown reply visible. | PASS |
| [before/1280x800/35_chat_long_messages.png](before/1280x800/35_chat_long_messages.png) | 02 Long messages selected; long user brief, Baseline review and numbered sections visible. | PASS |
| [before/1280x800/36_chat_code_blocks.electron.png](before/1280x800/36_chat_code_blocks.electron.png) | Light Code blocks conversation with TypeScript greeting, shell block and fixture-results table. Native Electron compositor cross-check of the same state. | PASS |
| [before/1280x800/36_chat_code_blocks.png](before/1280x800/36_chat_code_blocks.png) | Light Code blocks conversation with TypeScript greeting, shell block and fixture-results table. | PASS |
| [before/1280x800/37_chat_streaming_working.png](before/1280x800/37_chat_streaming_working.png) | Working fixture with Inspecting the local workspace text, working indicator and stop control; synthetic only. | PASS |
| [before/1280x800/38_chat_error.png](before/1280x800/38_chat_error.png) | Error fixture with provider-unavailable notice and seeded Recovery context explanation; no request sent. | PASS |
| [before/1280x800/39_chat_empty_existing_thread.png](before/1280x800/39_chat_empty_existing_thread.png) | 06 Empty thread selected with no messages and an empty composer. | PASS |
| [before/1280x800/40_right_controlled_tasks.png](before/1280x800/40_right_controlled_tasks.png) | Controlled Tasks pane with the baseline-project control settings and unavailable-operation explanation. | PASS |
| [before/1280x800/41_chat_code_blocks_dark.electron.png](before/1280x800/41_chat_code_blocks_dark.electron.png) | Dark Code blocks conversation with painted TypeScript greeting, shell block and results table. Native Electron compositor cross-check of the same state. | PASS |
| [before/1280x800/41_chat_code_blocks_dark.png](before/1280x800/41_chat_code_blocks_dark.png) | Dark Code blocks conversation with painted TypeScript greeting, shell block and results table. | PASS |
| [before/1280x800/44_delete_thread_confirmation.png](before/1280x800/44_delete_thread_confirmation.png) | Delete-thread confirmation naming 03 Code blocks; Cancel/Confirm visible, not confirmed. | PASS |
| [before/1280x800/45_rename_thread_inline.png](before/1280x800/45_rename_thread_inline.png) | Inline conversation-title editor containing 03 Code blocks; project chooser open. | PASS |
| [before/1280x800/46_project_settings_control.png](before/1280x800/46_project_settings_control.png) | Project workflow controls with Runtime execution control and preparation inputs visible. | PASS |
| [before/1280x800/47_project_settings_evidence.png](before/1280x800/47_project_settings_evidence.png) | Evidence summary heading and unavailable-evidence/privacy explanation visible; distinct from the Fitness frame. | PASS |
| [before/1280x800/48_project_settings_model_fitness.png](before/1280x800/48_project_settings_model_fitness.png) | Model Fitness heading, contract-evidence explanation and Load history control visible. | PASS |
| [before/1920x1080/01_first_launch_onboarding_connection.png](before/1920x1080/01_first_launch_onboarding_connection.png) | Connection onboarding: local computer selected and connected; connection-stage heading visible. | PASS |
| [before/1920x1080/02_onboarding_agents.png](before/1920x1080/02_onboarding_agents.png) | Agents onboarding: provider availability rows and agents-stage explanation; distinct from connection step 01. | PASS |
| [before/1920x1080/03_onboarding_project_selection.png](before/1920x1080/03_onboarding_project_selection.png) | Project-selection onboarding with import choices. | PASS |
| [before/1920x1080/04_empty_projects.png](before/1920x1080/04_empty_projects.png) | Empty workspace with the add-project action. | PASS |
| [before/1920x1080/05_add_project_import_modal.png](before/1920x1080/05_add_project_import_modal.png) | Import-method dialog with Local folder and provider choices. | PASS |
| [before/1920x1080/06_local_folder_picker.png](before/1920x1080/06_local_folder_picker.png) | Local folder picker showing the isolated workspace and baseline-project folder. | PASS |
| [before/1920x1080/07_chat_empty_project.png](before/1920x1080/07_chat_empty_project.png) | Empty baseline-project draft and composer. | PASS |
| [before/1920x1080/08_project_selection.png](before/1920x1080/08_project_selection.png) | Project chooser open over the empty-project draft. | PASS |
| [before/1920x1080/09_right_panel_menu.png](before/1920x1080/09_right_panel_menu.png) | Right-panel chooser menu open. | PASS |
| [before/1920x1080/10_right_files.png](before/1920x1080/10_right_files.png) | Files pane open with search/refresh toolbar and empty isolated file tree. | PASS |
| [before/1920x1080/11_add_action_dialog.png](before/1920x1080/11_add_action_dialog.png) | Add Action dialog with command/name/preview fields; not submitted. | PASS |
| [before/1920x1080/12_right_agents.png](before/1920x1080/12_right_agents.png) | Agents pane open with its no-agents empty state. | PASS |
| [before/1920x1080/13_right_run_graph.png](before/1920x1080/13_right_run_graph.png) | Run Graph pane with no-snapshot explanation. | PASS |
| [before/1920x1080/14_device_setup_dialog.png](before/1920x1080/14_device_setup_dialog.png) | Set up devices dialog open. | PASS |
| [before/1920x1080/15_right_browser.png](before/1920x1080/15_right_browser.png) | Browser pane with URL control and No preview yet state. | PASS |
| [before/1920x1080/16_right_terminal.png](before/1920x1080/16_right_terminal.png) | Terminal pane initialized with a visible idle shell prompt; no command sent. | PASS |
| [before/1920x1080/17_settings_general.png](before/1920x1080/17_settings_general.png) | General settings with new-thread and device-default controls. | PASS |
| [before/1920x1080/18_settings_appearance_light.png](before/1920x1080/18_settings_appearance_light.png) | Appearance settings with Light explicitly selected, not System. | PASS |
| [before/1920x1080/19_settings_appearance_dark.png](before/1920x1080/19_settings_appearance_dark.png) | Appearance settings with Dark explicitly selected. | PASS |
| [before/1920x1080/20_settings_keybindings.png](before/1920x1080/20_settings_keybindings.png) | Keybindings settings with shortcut rows. | PASS |
| [before/1920x1080/21_settings_snapshots.png](before/1920x1080/21_settings_snapshots.png) | SnapShots settings and disabled capture toggle. | PASS |
| [before/1920x1080/22_settings_providers.png](before/1920x1080/22_settings_providers.png) | Providers settings with local provider availability rows. | PASS |
| [before/1920x1080/23_settings_integrations.png](before/1920x1080/23_settings_integrations.png) | Integrations settings with browser profiles and device options. | PASS |
| [before/1920x1080/24_settings_source_control.png](before/1920x1080/24_settings_source_control.png) | Source Control settings with Git and source-control provider status. | PASS |
| [before/1920x1080/25_settings_storage.png](before/1920x1080/25_settings_storage.png) | Storage settings with cleanup options. | PASS |
| [before/1920x1080/26_settings_connections.png](before/1920x1080/26_settings_connections.png) | Connections settings and no saved remote environments. | PASS |
| [before/1920x1080/27_settings_archive.png](before/1920x1080/27_settings_archive.png) | Archive settings with no archived threads. | PASS |
| [before/1920x1080/28_add_custom_model_form.png](before/1920x1080/28_add_custom_model_form.png) | Unsaved Add custom model form containing capture-fixture-unsaved; Add and Cancel visible. | PASS |
| [before/1920x1080/29_settings_diagnostics.png](before/1920x1080/29_settings_diagnostics.png) | Diagnostics resource monitor with host and collection health. | PASS |
| [before/1920x1080/30_settings_licenses.png](before/1920x1080/30_settings_licenses.png) | Third-party notices and license list. | PASS |
| [before/1920x1080/31_chat_model_selector.png](before/1920x1080/31_chat_model_selector.png) | Model selector open with provider/model choices; no request sent. | PASS |
| [before/1920x1080/32_chat_permission_menu.png](before/1920x1080/32_chat_permission_menu.png) | Permission/execution-mode menu open with current selection. | PASS |
| [before/1920x1080/33_project_list_with_threads.png](before/1920x1080/33_project_list_with_threads.png) | Sidebar lists all six synthetic fixture threads beside the empty project draft. | PASS |
| [before/1920x1080/34_chat_messages.png](before/1920x1080/34_chat_messages.png) | 01 Conversation selected; seeded user question and local screenshot fixture Markdown reply visible. | PASS |
| [before/1920x1080/35_chat_long_messages.png](before/1920x1080/35_chat_long_messages.png) | 02 Long messages selected; long user brief, Baseline review and numbered sections visible. | PASS |
| [before/1920x1080/36_chat_code_blocks.electron.png](before/1920x1080/36_chat_code_blocks.electron.png) | Light Code blocks conversation with TypeScript greeting, shell block and fixture-results table. Native Electron compositor cross-check of the same state. | PASS |
| [before/1920x1080/36_chat_code_blocks.png](before/1920x1080/36_chat_code_blocks.png) | Light Code blocks conversation with TypeScript greeting, shell block and fixture-results table. | PASS |
| [before/1920x1080/37_chat_streaming_working.png](before/1920x1080/37_chat_streaming_working.png) | Working fixture with Inspecting the local workspace text, working indicator and stop control; synthetic only. | PASS |
| [before/1920x1080/38_chat_error.png](before/1920x1080/38_chat_error.png) | Error fixture with provider-unavailable notice and seeded Recovery context explanation; no request sent. | PASS |
| [before/1920x1080/39_chat_empty_existing_thread.png](before/1920x1080/39_chat_empty_existing_thread.png) | 06 Empty thread selected with no messages and an empty composer. | PASS |
| [before/1920x1080/40_right_controlled_tasks.png](before/1920x1080/40_right_controlled_tasks.png) | Controlled Tasks pane with the baseline-project control settings and unavailable-operation explanation. | PASS |
| [before/1920x1080/41_chat_code_blocks_dark.electron.png](before/1920x1080/41_chat_code_blocks_dark.electron.png) | Dark Code blocks conversation with painted TypeScript greeting, shell block and results table. Native Electron compositor cross-check of the same state. | PASS |
| [before/1920x1080/41_chat_code_blocks_dark.png](before/1920x1080/41_chat_code_blocks_dark.png) | Dark Code blocks conversation with painted TypeScript greeting, shell block and results table. | PASS |
| [before/1920x1080/44_delete_thread_confirmation.png](before/1920x1080/44_delete_thread_confirmation.png) | Delete-thread confirmation naming 03 Code blocks; Cancel/Confirm visible, not confirmed. | PASS |
| [before/1920x1080/45_rename_thread_inline.png](before/1920x1080/45_rename_thread_inline.png) | Inline conversation-title editor containing 03 Code blocks; project chooser open. | PASS |
| [before/1920x1080/46_project_settings_control.png](before/1920x1080/46_project_settings_control.png) | Project workflow controls with Runtime execution control and preparation inputs visible. | PASS |
| [before/1920x1080/47_project_settings_evidence.png](before/1920x1080/47_project_settings_evidence.png) | Evidence summary heading and unavailable-evidence/privacy explanation visible; distinct from the Fitness frame. | PASS |
| [before/1920x1080/48_project_settings_model_fitness.png](before/1920x1080/48_project_settings_model_fitness.png) | Model Fitness heading, contract-evidence explanation and Load history control visible. | PASS |
| [before/390x844/42_narrow_chat_dark.electron.png](before/390x844/42_narrow_chat_dark.electron.png) | Forced 390x844 dark Code blocks conversation; TypeScript, shell and table retained; unsupported native width. Native Electron compositor cross-check of the same state. | PASS |
| [before/390x844/42_narrow_chat_dark.png](before/390x844/42_narrow_chat_dark.png) | Forced 390x844 dark Code blocks conversation; TypeScript, shell and table retained; unsupported native width. | PASS |
| [before/390x844/43_narrow_chat_light.electron.png](before/390x844/43_narrow_chat_light.electron.png) | Forced 390x844 light Code blocks conversation; TypeScript, shell and table retained; unsupported native width. Native Electron compositor cross-check of the same state. | PASS |
| [before/390x844/43_narrow_chat_light.png](before/390x844/43_narrow_chat_light.png) | Forced 390x844 light Code blocks conversation; TypeScript, shell and table retained; unsupported native width. | PASS |
| [before/matrix/1280x800/dark/46/end-default.png](before/matrix/1280x800/dark/46/end-default.png) | dark 1280x800: Workflow controls at its end boundary. | PASS |
| [before/matrix/1280x800/dark/46/top-default.png](before/matrix/1280x800/dark/46/top-default.png) | dark 1280x800: Workflow controls at its top boundary. | PASS |
| [before/matrix/1280x800/dark/47/end-default.png](before/matrix/1280x800/dark/47/end-default.png) | dark 1280x800: Evidence summary at its end boundary. | PASS |
| [before/matrix/1280x800/dark/47/top-default.png](before/matrix/1280x800/dark/47/top-default.png) | dark 1280x800: Evidence summary at its top boundary. | PASS |
| [before/matrix/1280x800/dark/48/actions-end-default.png](before/matrix/1280x800/dark/48/actions-end-default.png) | dark 1280x800: Actions section, Add action and no configured actions at its end boundary. | PASS |
| [before/matrix/1280x800/dark/48/end-default.png](before/matrix/1280x800/dark/48/end-default.png) | dark 1280x800: Model Fitness at its end boundary. | PASS |
| [before/matrix/1280x800/dark/48/top-default.png](before/matrix/1280x800/dark/48/top-default.png) | dark 1280x800: Model Fitness at its top boundary. | PASS |
| [before/matrix/1280x800/light/46/end-default.png](before/matrix/1280x800/light/46/end-default.png) | light 1280x800: Workflow controls at its end boundary. | PASS |
| [before/matrix/1280x800/light/46/prepare-end-default.png](before/matrix/1280x800/light/46/prepare-end-default.png) | light 1280x800: Preparation action visible in the controls section. | PASS |
| [before/matrix/1280x800/light/46/top-default.png](before/matrix/1280x800/light/46/top-default.png) | light 1280x800: Workflow controls at its top boundary. | PASS |
| [before/matrix/1280x800/light/47/end-default.png](before/matrix/1280x800/light/47/end-default.png) | light 1280x800: Evidence summary at its end boundary. | PASS |
| [before/matrix/1280x800/light/47/top-default.png](before/matrix/1280x800/light/47/top-default.png) | light 1280x800: Evidence summary at its top boundary. | PASS |
| [before/matrix/1280x800/light/48/actions-end-default.png](before/matrix/1280x800/light/48/actions-end-default.png) | light 1280x800: Actions section, Add action and no configured actions at its end boundary. | PASS |
| [before/matrix/1280x800/light/48/end-default.png](before/matrix/1280x800/light/48/end-default.png) | light 1280x800: Model Fitness at its end boundary. | PASS |
| [before/matrix/1280x800/light/48/top-default.png](before/matrix/1280x800/light/48/top-default.png) | light 1280x800: Model Fitness at its top boundary. | PASS |
| [before/matrix/1920x1080/dark/46/end-default.png](before/matrix/1920x1080/dark/46/end-default.png) | dark 1920x1080: Workflow controls at its end boundary. | PASS |
| [before/matrix/1920x1080/dark/46/top-default.png](before/matrix/1920x1080/dark/46/top-default.png) | dark 1920x1080: Workflow controls at its top boundary. | PASS |
| [before/matrix/1920x1080/dark/47/end-default.png](before/matrix/1920x1080/dark/47/end-default.png) | dark 1920x1080: Evidence summary at its end boundary. | PASS |
| [before/matrix/1920x1080/dark/47/top-default.png](before/matrix/1920x1080/dark/47/top-default.png) | dark 1920x1080: Evidence summary at its top boundary. | PASS |
| [before/matrix/1920x1080/dark/48/actions-end-default.png](before/matrix/1920x1080/dark/48/actions-end-default.png) | dark 1920x1080: Actions section, Add action and no configured actions at its end boundary. | PASS |
| [before/matrix/1920x1080/dark/48/end-default.png](before/matrix/1920x1080/dark/48/end-default.png) | dark 1920x1080: Model Fitness at its end boundary. | PASS |
| [before/matrix/1920x1080/dark/48/top-default.png](before/matrix/1920x1080/dark/48/top-default.png) | dark 1920x1080: Model Fitness at its top boundary. | PASS |
| [before/matrix/1920x1080/light/46/end-default.png](before/matrix/1920x1080/light/46/end-default.png) | light 1920x1080: Workflow controls at its end boundary. | PASS |
| [before/matrix/1920x1080/light/46/prepare-end-default.png](before/matrix/1920x1080/light/46/prepare-end-default.png) | light 1920x1080: Preparation action visible in the controls section. | PASS |
| [before/matrix/1920x1080/light/46/top-default.png](before/matrix/1920x1080/light/46/top-default.png) | light 1920x1080: Workflow controls at its top boundary. | PASS |
| [before/matrix/1920x1080/light/47/end-default.png](before/matrix/1920x1080/light/47/end-default.png) | light 1920x1080: Evidence summary at its end boundary. | PASS |
| [before/matrix/1920x1080/light/47/top-default.png](before/matrix/1920x1080/light/47/top-default.png) | light 1920x1080: Evidence summary at its top boundary. | PASS |
| [before/matrix/1920x1080/light/48/actions-end-default.png](before/matrix/1920x1080/light/48/actions-end-default.png) | light 1920x1080: Actions section, Add action and no configured actions at its end boundary. | PASS |
| [before/matrix/1920x1080/light/48/end-default.png](before/matrix/1920x1080/light/48/end-default.png) | light 1920x1080: Model Fitness at its end boundary. | PASS |
| [before/matrix/1920x1080/light/48/top-default.png](before/matrix/1920x1080/light/48/top-default.png) | light 1920x1080: Model Fitness at its top boundary. | PASS |
| [before/matrix/2560x1440/dark/46/end-default.png](before/matrix/2560x1440/dark/46/end-default.png) | dark 2560x1440: Workflow controls at its end boundary. | PASS |
| [before/matrix/2560x1440/dark/46/top-default.png](before/matrix/2560x1440/dark/46/top-default.png) | dark 2560x1440: Workflow controls at its top boundary. | PASS |
| [before/matrix/2560x1440/dark/47/end-default.png](before/matrix/2560x1440/dark/47/end-default.png) | dark 2560x1440: Evidence summary at its end boundary. | PASS |
| [before/matrix/2560x1440/dark/47/top-default.png](before/matrix/2560x1440/dark/47/top-default.png) | dark 2560x1440: Evidence summary at its top boundary. | PASS |
| [before/matrix/2560x1440/dark/48/actions-end-default.png](before/matrix/2560x1440/dark/48/actions-end-default.png) | dark 2560x1440: Actions section, Add action and no configured actions at its end boundary. | PASS |
| [before/matrix/2560x1440/dark/48/end-default.png](before/matrix/2560x1440/dark/48/end-default.png) | dark 2560x1440: Model Fitness at its end boundary. | PASS |
| [before/matrix/2560x1440/dark/48/top-default.png](before/matrix/2560x1440/dark/48/top-default.png) | dark 2560x1440: Model Fitness at its top boundary. | PASS |
| [before/matrix/2560x1440/light/46/end-default.png](before/matrix/2560x1440/light/46/end-default.png) | light 2560x1440: Workflow controls at its end boundary. | PASS |
| [before/matrix/2560x1440/light/46/top-default.png](before/matrix/2560x1440/light/46/top-default.png) | light 2560x1440: Workflow controls at its top boundary. | PASS |
| [before/matrix/2560x1440/light/47/end-default.png](before/matrix/2560x1440/light/47/end-default.png) | light 2560x1440: Evidence summary at its end boundary. | PASS |
| [before/matrix/2560x1440/light/47/top-default.png](before/matrix/2560x1440/light/47/top-default.png) | light 2560x1440: Evidence summary at its top boundary. | PASS |
| [before/matrix/2560x1440/light/48/actions-end-default.png](before/matrix/2560x1440/light/48/actions-end-default.png) | light 2560x1440: Actions section, Add action and no configured actions at its end boundary. | PASS |
| [before/matrix/2560x1440/light/48/end-default.png](before/matrix/2560x1440/light/48/end-default.png) | light 2560x1440: Model Fitness at its end boundary. | PASS |
| [before/matrix/2560x1440/light/48/top-default.png](before/matrix/2560x1440/light/48/top-default.png) | light 2560x1440: Model Fitness at its top boundary. | PASS |
| [before/matrix/840x620/dark/46/end-default.png](before/matrix/840x620/dark/46/end-default.png) | dark 840x620: Workflow controls at its end boundary. | PASS |
| [before/matrix/840x620/dark/46/top-default.png](before/matrix/840x620/dark/46/top-default.png) | dark 840x620: Workflow controls at its top boundary. | PASS |
| [before/matrix/840x620/dark/47/end-default.png](before/matrix/840x620/dark/47/end-default.png) | dark 840x620: Evidence summary at its end boundary. | PASS |
| [before/matrix/840x620/dark/47/top-default.png](before/matrix/840x620/dark/47/top-default.png) | dark 840x620: Evidence summary at its top boundary. | PASS |
| [before/matrix/840x620/dark/48/actions-end-default.png](before/matrix/840x620/dark/48/actions-end-default.png) | dark 840x620: Actions section, Add action and no configured actions at its end boundary. | PASS |
| [before/matrix/840x620/dark/48/end-default.png](before/matrix/840x620/dark/48/end-default.png) | dark 840x620: Model Fitness at its end boundary. | PASS |
| [before/matrix/840x620/dark/48/top-default.png](before/matrix/840x620/dark/48/top-default.png) | dark 840x620: Model Fitness at its top boundary. | PASS |
| [before/matrix/840x620/light/46/end-default.png](before/matrix/840x620/light/46/end-default.png) | light 840x620: Workflow controls at its end boundary. | PASS |
| [before/matrix/840x620/light/46/top-default.png](before/matrix/840x620/light/46/top-default.png) | light 840x620: Workflow controls at its top boundary. | PASS |
| [before/matrix/840x620/light/47/end-default.png](before/matrix/840x620/light/47/end-default.png) | light 840x620: Evidence summary at its end boundary. | PASS |
| [before/matrix/840x620/light/47/top-default.png](before/matrix/840x620/light/47/top-default.png) | light 840x620: Evidence summary at its top boundary. | PASS |
| [before/matrix/840x620/light/48/actions-end-default.png](before/matrix/840x620/light/48/actions-end-default.png) | light 840x620: Actions section, Add action and no configured actions at its end boundary. | PASS |
| [before/matrix/840x620/light/48/end-default.png](before/matrix/840x620/light/48/end-default.png) | light 840x620: Model Fitness at its end boundary. | PASS |
| [before/matrix/840x620/light/48/top-default.png](before/matrix/840x620/light/48/top-default.png) | light 840x620: Model Fitness at its top boundary. | PASS |
