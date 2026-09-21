# Weavra App

Desktop, Web, Mobile and Server sources for [Weavra](https://github.com/kjg8619/Weavra).
This is an independent product, not an upstream-synchronized T3 Code fork.

## Run from this checkout

Use Node 24 and pnpm 11. This directory is an independent build root; do not combine
its workspace or lockfile with `runtime/pi`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

See the [product README](../../README.md) for the App/runtime launch boundary and
[App product independence](../../docs/architecture/APP_PRODUCT_INDEPENDENCE.md) for
identity, release authority, compatibility names and validation evidence.

## Distribution and updates

No Weavra release channel is configured. Desktop checks/downloads/installs, Server
self-update, Mobile OTA and the inherited shell/PowerShell installers are disabled.
Build matching App and Server revisions from this repository. Do not install or
update Weavra with `npx t3`, the T3 website, T3 app-store entries, T3 GitHub releases,
Homebrew, winget or the inherited AUR recipes: those distribute a different product.
The local `t3` executable name and internal `@t3tools/*` packages remain compatibility
names, not permission to download or publish upstream packages.

Hosted auth, relay, tracing and legal services require explicit operator configuration.
There is no default Weavra hosted website, Expo update project or store submission.

## Historical material

`apps/marketing`, nested `.github/workflows`, AUR packaging, release notification
scripts and inherited `docs/` describe historical T3 infrastructure unless explicitly
reviewed by the App independence document. They are not current Weavra distribution
or deployment instructions. Historical testimonials, statistics, screenshots, legal
policies and source issue links must not be relabeled as Weavra claims.

T3 Code provenance and the existing [MIT license](LICENSE) are preserved. Package,
OS application identifiers, data paths and artwork are intentionally not fully
renamed in this lane. No automatic synchronization with a source repository is enabled.
