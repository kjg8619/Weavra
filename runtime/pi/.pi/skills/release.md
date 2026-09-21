---
name: release
description: Build and inspect local Weavra runtime artifacts. Hosted publication and release announcements are unavailable.
---

# Local Weavra runtime artifacts

Weavra has no independent hosted release, registry publication, installer, model-catalog publication, or announcement infrastructure. Do not publish upstream packages, mutate GitHub releases, push release tags, upload to R2, execute nested historical workflows, or announce upstream Pi releases as Weavra.

From runtime/pi, `npm run release:local -- --out /absolute/local/output` retains the existing model-data validation, build, check, test, packed dependency, and isolated consumer gates. `npm run check:release` retains the explicit local clean/build/check sequence. Follow the normal lockfile acknowledgement policy; do not weaken locked installs or version/protocol checks.

The internal local artifact executable is weavra-runtime. The canonical user launcher is weavra, supplied by company-runtime and bound to this checkout. Product display is Weavra development; internal package versions and namespaces are factual and unchanged.

Use the root Weavra setup instructions for normal product launch. Local artifact creation is not permission to publish. Preserve LICENSE, NOTICE, changelogs, worklogs and original authorship.
