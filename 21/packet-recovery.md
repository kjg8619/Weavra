# QA-21 evidence-only packet recovery

Date: 2026-10-21. Lead QA rerun is pending; no lane completion claim.

## Failure and correction

Independent QA passed the fresh product checks but the submitted packet failed `--verify-packet`: `scripts/hig/assert.mjs:487` resolves the manifest fixture home, and writer cleanup had removed `/private/tmp/weavra-hig-NcF4AD/{home,workspace,app}` and the corresponding parent fixture `/private/tmp/weavra-hig-Cm61kG`. That cleanup was incorrect. The old submitted packet is preserved locally under `history-cleanup-failure`; historical pre-cleanup passes are not substituted for a current pass.

The official capture/accept convention was rerun from scratch at unchanged product HEAD `245a9efdfee4e949a5d312798bcdbf31ed0c1675`, parent `d81bc594776ea0cf5b9ea45db6865a4f24831ded`, and shared runner `82834bcf1be52aed98eef525696550077bf83df2`. Product and runner sources stayed clean and unchanged. The existing fresh packaged builds were reused with unchanged app.asar hashes: parent `ac879d51d6317a0d1d4bf34dbe0b905bf2ca1f86e485dab25992d3629f8d9c90`, head `81debd18a2c3d7332ed2588c824b59db8f273e122efc2e6402b8400c2af92f65`. No new build is claimed.

## Fresh results

- `capture_pr 21`: before, after and diff each exit 0; 152 records per side, 158 bound pairs, 59 nonzero rounded-ratio pairs, 389 hotspots, zero dimension/alpha failures.
- `accept_pr 21 01`: scenarios, packet verification and source diff check each exit 0; 7 checks / 265 assertions. Run `a2cfb6e4-7c53-458d-8a02-c3bedaeff83f`.
- `accept_pr 21 02`: scenarios, packet verification and source diff check each exit 0; 7 checks / 265 assertions. Run `467729e7-2507-4847-bfe7-dec57479efb6`.
- Both rounds retain all 15 W-33 cycle samples painted with content/order/anchor checks passing. Model, Runtime mutation and blocked-outbound counters are all zero.
- Post-process-cleanup fixture validation exits 0: 4 manifests, 42 unique referenced directories including bundles, 8 genuine synthetic fixture roots, all referenced home/workspace/app/userData paths still exist, owned evidence applications 0.
- Additional unchanged-runner `--verify-packet pr-21` after process cleanup exits **0**; output is linked below.

```sh
bun /Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-01/scripts/hig/assert.mjs \
  --verify-packet /Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-21
```

All generated fixture directories remain at their original real paths, following pr-19/pr-20. Cleanup closes owned processes only. No path rewriting, symlink substitution, empty-directory recreation, verifier edits or product edits were used. Keep these paths and both source/evidence worktrees for the lead QA rerun.

## Bound artifacts

- [Retained paths and manifest hashes](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/fixture-retention.json)
- [Verification after process cleanup](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/logs--verify-packet-retained.log)
- [First acceptance verdict](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/acceptance-verdict-01.json)
- [Second acceptance verdict](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/acceptance-verdict-02.json)
- [Round 1 receipt](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/qa-round-01--scenario-receipt.json)
- [Round 2 receipt](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/qa--scenario-receipt.json)
- [Complete gallery](https://github.com/kjg8619/Weavra/blob/hig-evidence/21/21/image-table.md)
- [Fresh image inspection](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/diff-inspection.md)

The original scoped static/test gates, 1,821-row a-j measurement, and independent product QA remain valid at the same source/package identity; they were not rerun or represented as new checks for this evidence-only correction. Inherited red full CI, 12 unsupported 390+150% geometry diagnostics and Final-wave limits remain as documented in the PR.
