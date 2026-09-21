# Weavra runtime

Weavra development is the source-built product in [the Weavra repository](https://github.com/kjg8619/Weavra). This directory contains its coding-agent runtime. Follow the [root checkout setup](../../../../README.md); do not install the upstream Pi npm package or run an upstream hosted installer as Weavra.

After completing checkout setup:

    weavra setup
    weavra doctor
    weavra

The canonical launcher is `weavra`. `weavra-runtime` is the internal standalone runtime executable used by local artifact tooling. Package namespaces such as `@earendil-works/pi-coding-agent`, package versions, `.pi` project configuration, extension `pi` parameters and protocol identifiers remain internal compatibility contracts, not Weavra release authority.

## Product boundaries

- Product display: **Weavra development**. Internal package and wire versions remain factual.
- Global agent state: `<WEAVRA_HOME or ~/.weavra>/agent`. Explicit `WEAVRA_CODING_AGENT_DIR` overrides the direct runtime home; the canonical launcher owns its validated agent-home selection.
- Project configuration and resources remain `.pi/`. Project trust still gates project settings, packages and extensions.
- `WEAVRA_CODING_AGENT_SESSION_DIR` and explicit `--session-dir` govern session overrides. The canonical launcher ignores inherited Pi home/session variables; only documented, affirmative migration imports legacy state.
- Hosted self-update, installer, release checks, vendor install telemetry, vendor model overlays, hosted session sharing and automatic hosted relay attachment are unavailable. Old vendor flags and imported settings do not restore those services.
- Explicit provider calls, local/direct connections, user-selected extensions/packages, local HTML/JSONL exports, and SSH/Tailscale integrations remain supported. This is not a claim that all explicit third-party operations are network-free.

## Use the runtime

Authenticate with `/login` for a supported provider or set an appropriate provider API key before launching. Use `/model` to select a model. Use `/export` for a local session export; no hosted share destination is configured.

User-selected extension/package operations remain available:

    weavra install <source>
    weavra remove <source>
    weavra list
    weavra config
    weavra update --extensions
    weavra update --models

Self/all update requests report unavailable instead of downloading an upstream executable. Update this source checkout through the documented root workflow.

## Documentation

- [Quickstart](docs/quickstart.md), [Usage and CLI](docs/usage.md)
- [Providers](docs/providers.md), [Models](docs/models.md), [Custom providers](docs/custom-provider.md)
- [Security and project trust](docs/security.md), [Containerization](docs/containerization.md)
- [Settings](docs/settings.md), [Environment variables](docs/environment-variables.md)
- [Sessions](docs/sessions.md), [Session format](docs/session-format.md), [Compaction](docs/compaction.md)
- [Extensions](docs/extensions.md), [Packages](docs/packages.md), [Skills](docs/skills.md)
- [Prompt templates](docs/prompt-templates.md), [Themes](docs/themes.md), [Keybindings](docs/keybindings.md)
- [SDK](docs/sdk.md), [RPC](docs/rpc.md), [JSON events](docs/json.md), [TUI](docs/tui.md)
- [Development](docs/development.md), [Terminal setup](docs/terminal-setup.md)

## Local artifacts and provenance

The runtime's local build, offline build, lock generators, package-consumer checks and artifact builders remain available. Hosted publication commands refuse before mutation or network access. Do not promote nested inherited release workflows into product authority.

The runtime incorporates upstream Pi work. Preserve original LICENSE/NOTICE material, changelog history, authorship and package/protocol namespaces. Those historical records do not describe current Weavra service availability.
