# PR 02 deterministic capture packet

Product head: `4488aaba95c6cc5f9ce3b33d38559b504578c560`.
Shared runner/base: `c90e69e93062c4cb2bc54caf75bdd3e85ee6d839`.
app.asar SHA-256: `ae8e926311113f3d46ed222a4521158778aa5bc5ba33b044b885940039e1ce5a`.
Fixture: hig-offline-projection-v4.

## Fix and boundary

The old fixture blocked renderer HTTP but allowed server-side live version checks to emit a late provider-update notice. The isolated profile now disables update checks and quota sources before launch. Initial/subscription update, progress, quota and remote-derived observations are frozen at the capture boundary; explicit labelled scenario inputs remain controlled. HTTP/WS handlers are installed before the fresh renderer load, and scenario setup subscribes to its configuration event before reloading. Raw startup settings and final profile settings are checked, not merely a projected flag.

This follow-up changes no product sources or notification policy: git diff f49c1584..4488aaba95c6cc5f9ce3b33d38559b504578c560 -- app runtime is empty. A toast covering enabled controls remains a genuine product defect assigned to todo 04. See carry-forward.md for the exact QA run d frame.

## Consecutive fresh acceptance

| Run | Capture | Checks | Assertions | accept_pr 02 | standalone --verify-packet |
|---|---|---:|---:|---:|---:|
| 1 | run-aeb28c27-0d78-48f0-8cc4-38592dd4302f/capture-manifest.json | 8 | 620 | 0 | 0 |
| 2 | run-60a29f63-a2be-4d06-8688-21c19b252681/capture-manifest.json | 8 | 620 | 0 | 0 |

Both runs create new isolated profiles and distinct capture UUIDs, without inheriting PASS. Each contains 152 primary records; all have identical empty unsolicited-notification state. Both have 127 eligible foreground icon occurrences, all five samples true. The 1920 browser-toolbar rectangles and five hit samples are exactly equal; all four controls identified by QA pass. Touched target intersections remain zero. The independent comparison is determinism.json / det-repeat-audit.mjs.

The first full packet is preserved under repeat-01/pr-02; the root qa/scenario-receipt.json binds the second. Existing size (>=36x36), five-point inset (4px), foreground eligibility and overlap assertions are unchanged. A new frozen-network-notices scenario checks the actual browser state. 47 harness tests pass, including initial and late live-update regression tests and pre-launch setting isolation; formatter/lint and web typecheck exit 0.

## Images and provenance

Both primary matrices and both supplemental measurement/motion sets were regenerated with fixture v4. The complete table contains 192 pairs and 51 after-only scenario frames (435 image bindings). All current published URLs have matching HTTP 200 image content and SHA-256.

- before/capture-manifest.json and after/capture-manifest.json: exact revisions, package/fixture/source hashes and primary images. The retained parent appRevision bb7649c97402d9a853f91b3a987f9fa48aa970eb is explicitly identified; product-source equality is asserted before reuse.
- qa/scenario-receipt.json and repeat-01/pr-02/qa/scenario-receipt.json: two independent fresh runs and hashed observations.
- determinism.json: notification/control equality and separate profile/capture identities.
- det-controls.json: 17 observed current icon identities, all 36x36; 160 primary/live foreground samples pass. Ambient notification dismissal is no longer spuriously introduced by live input.
- diff/pairs.json and supplemental-diff/pairs.json: 158 primary and 34 supplemental pairs, no missing dimensions or diff failures.
- publication-index.json, attachment-map.json, publication-body.md, publication-verification.json: current published image/body/hash bindings.
- det-pipeline.mjs, det-repeat-audit.mjs, det-audit.mjs, measure-02.mjs and motion-02.mjs: reproduction.
- logs/det-*.json and .log: exact commands, exit codes, times. Only extra EOF newlines are normalized in Git log copies; local originals remain unchanged.

Controlled synthetic provider-update scenes remain labelled fixture inputs; they are not evidence that normal product toast placement is repaired. That placement belongs to todo 04. Full final-wave Q1-Q12 coverage remains separate under the owner-approved amendment. Only files referenced by the current manifests, two receipts and publication index certify this head; older unindexed directories and hit-/q5- packets are historical.
