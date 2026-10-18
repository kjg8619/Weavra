# Install Weavra

Weavra runs coding agents on your computer and lets you control them from its
desktop, web, or mobile app. Set up the machine where the agents will work first.

## Requirements

You need an installed, authenticated provider before starting a thread. You can
launch Weavra and configure providers afterwards.

## Command line

Weavra has no configured public release distribution or automatic installer.
Upstream T3 Code installers and `npx t3` are not Weavra installations.

For local development, use Node 24 and a Weavra source checkout:

```sh
cd app/t3code
corepack pnpm install --frozen-lockfile
corepack pnpm run dev
```

Open the pairing URL printed by the dev runner. This starts the development
server and web client, not a packaged release. Keep the App and Runtime's
independent build roots separate; see the [repository README](../../../../README.md).

The App package declares `weavra-server` as its executable. If you explicitly
install a local build, use `weavra-server --help`; its service commands are
documented in [Running in the background](./background-service.md).
The `weavra` executable is the separate coding Runtime, not the App installer.

## Desktop app

Run `corepack pnpm run dev:desktop` from `app/t3code` for the development
Electron shell. A packaged desktop artifact must be built and installed
explicitly from the checkout. Upstream desktop releases and package-manager
entries do not install Weavra.

### Windows Subsystem for Linux

Choose a WSL distro in **Settings → Connections** to run agents and projects
there. Install the provider CLIs inside that distro. Weavra has no upstream
server download channel; use an explicitly provisioned compatible build rather
than an upstream T3 Code installer.

### Open a project from a terminal

With an explicitly installed App CLI and the desktop app running on the same machine:

```bash
weavra-server app
```

This opens a new thread for the current directory, adding the project if needed.
Pass a path, such as `weavra-server app ../my-project`, to open another directory. It requires
the desktop app, so a standalone server or an SSH session is not enough. If the
command cannot reach the app, start or update the desktop app and try again.

## Mobile app

Weavra has no mobile store distribution or OTA update service. Build and install
the native client locally using the [mobile README](../../apps/mobile/README.md);
Expo Go is not supported. The phone connects directly to an App server. Follow
[remote access](./remote-access.md) for LAN or Tailscale pairing. A phone browser
showing the web interface is not the native mobile client.

If the app crashes during launch, open Settings → Diagnostics on the next launch
that succeeds. It lists startup crashes from the last 7 days with the error and
component stack that store crash reports leave out. Copy the report and paste it
into a GitHub issue. Error messages can quote values from the app, so read it over
before sharing.

## Providers

Open **Settings → Providers** in the web or desktop app, select the environment,
and enable the provider you want. Installation, login, and configuration belong
to that environment's machine, even when you connect from a phone or another
computer.

| Provider    | Install and authenticate                                                                     |
| ----------- | -------------------------------------------------------------------------------------------- |
| Codex       | Install [Codex CLI](https://developers.openai.com/codex/cli), then run `codex login`.        |
| Claude      | Install [Claude Code](https://claude.com/product/claude-code), then run `claude auth login`. |
| Cursor      | Install [Cursor CLI](https://cursor.com/cli), then run `agent login`.                        |
| Grok Build  | Install [Grok Build CLI](https://x.ai/cli), then run `grok login`.                           |
| OpenCode    | Install [OpenCode](https://opencode.ai), then run `opencode auth login`.                     |
| Antigravity | Install and sign in with Google from T3 Code's provider settings.                            |

Provider CLIs must be on the server's `PATH`. If T3 Code cannot find one, set its
**Binary path** in provider settings, especially when using a version manager.
Cursor's executable is `cursor-agent`, although its login command is
`agent login`. Antigravity can use its managed runtime without a `PATH` entry.

When a provider CLI is behind its latest release, its provider card shows the
available version. **Update now** appears only when T3 Code can tell which
installer owns the CLI (its own update command, Homebrew, or a global npm, pnpm,
bun, or Vite+ install) and runs that installer. Otherwise update the CLI the same
way you installed it. Homebrew installs compare against the version Homebrew
offers, which can trail the npm release by a few hours.

Add another provider instance for a separate account or configuration. Each
instance can have its own environment variables, such as API keys or a custom
base URL. Mark secret values as sensitive; after saving, T3 Code does not display
their original values.

For provider-specific setup and accounts, see [Codex](./providers-codex.md),
[Claude](./providers-claude.md), [OpenCode](./providers-opencode.md), and
[Antigravity](./providers-antigravity.md).

## Next steps

- [Working with threads](./thread-sidebar.md): start tasks and organize parallel work.
- [Permission modes](./permission-modes.md): choose when agents ask before acting.
- [Remote access](./remote-access.md): connect from another device.
- [Running in the background](./background-service.md): keep a Linux or macOS host available.
- [Updating Weavra](./updating.md): replace source-built apps and connected servers.
