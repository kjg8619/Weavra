# Reviewed model-data fallbacks

Pinned snapshots used only when the live upstream source for a provider is completely absent. They keep
`generate-models.ts` deterministic instead of failing (or silently dropping a provider) when upstream
model-data changes shape.

## kimi-coding.json

- provider: `kimi-coding` (live models.dev source id: `kimi-for-coding`)
- source package: `@earendil-works/pi-ai`
- source version: `0.85.1` (exactly the version in this repository)
- source path: `dist/providers/data/kimi-coding.json`
- captured date: 2026-09-18 (KST)
- model ids: `k3`, `k3-256k`, `kimi-for-coding`, `kimi-for-coding-highspeed`
- usage: only when the live `kimi-for-coding` source produces no `kimi-coding` model; a live source always
  wins. Every other provider keeps the strict `Cannot hydrate missing providers` behaviour.
- no credentials or API keys are stored here; the file is a verbatim copy of the published artifact.
- sha256: `5e28e32e5b16df506a3a1c620ed7870fa7e5e57d8ede4a2aa44dbb24ecf1ba2f` (pin this in reviews; a change here means the reviewed artifact changed)
