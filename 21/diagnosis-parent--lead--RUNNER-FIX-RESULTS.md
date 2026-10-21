# Case 21 runner repair

Date: 2026-10-21.
Runner branch: `hig/01-capture-contract`.
Initial runner: `7bc326a366fe5936f850afbd414809f50e4d0841`.
New runner commit: `82834bcf1be52aed98eef525696550077bf83df2`.
Commit subject: `test(desktop): anchor HIG theme content parity captures`.
Pushed normally to `origin/hig/01-capture-contract`; local and remote-tracking
HEAD both equal the new commit. The runner worktree is clean.
Product sources and the installed application were not changed.

## Runner behavior

The code conversation is selected using mounted-code readiness, avoiding the
viewport-visible greeting precondition on an end-scrolled thread. The first code
block is anchored before the size matrix and before each size's theme cycle.
The runner records that anchor and zoom, then never resets the scroll position
inside the light/dark/light cycle.

DOM heading/code/table presence and order are checked independently of viewport
intersection. Every content node must retain a painted, nonzero rectangle; the
code anchor must intersect the transcript viewport and retain its offset and
horizontal position. Each sample also has a renderer PNG and full AX tree.

## Runner tests

Command: `bun test scripts/hig/harness.test.ts`.
Exit: 0. Result: 97 pass, 0 fail.

New Chromium regressions, all PASS:

1. An end-scrolled transcript is anchored and completes light/dark/light while
   the table is still below the viewport.
2. A genuinely missing shell block produces FAIL.
3. Reordered, otherwise unchanged content produces FAIL.
4. A blank transcript retaining its DOM text produces FAIL.
5. A zero-sized content rectangle produces FAIL.
6. A still-visible but shifted code anchor produces FAIL.

## Unchanged parent

Exact blocker command, changing only the evidence destination:

```sh
WEAVRA_CAPTURE_REPO=/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-21 \
WEAVRA_CAPTURE_APP=/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-20/after/app/weavra-desktop.app \
bun --preload /Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-21/tools/preload-app-gate.mjs \
/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-01/scripts/hig/assert.mjs \
--case 21 \
--evidence /Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-21-runnerfix
```

Parent revision: `d81bc594776ea0cf5b9ea45db6865a4f24831ded`.
app.asar SHA-256:
`0385a57b7203aaec8be0a94fe8257b2aa85f45468ce5060b0a08e6e60b51b5ef`.
Exit: 1. No readiness timeout. All 15/15 theme-size samples were recorded.

Run: `run-a1ef8eb7-1966-443e-a8d2-898ac216e64a`.
Receipt: `scenario-receipt.json`.
Samples: `<run>/scenarios/21/theme-content-parity/observations.json`.

| Viewport | Samples | DOM content/order retained | Painted samples |
| --- | --- | --- | --- |
| 840x620, actual minimum | 3 | 3/3 | 0/3 |
| 1280x800 | 3 | 3/3 | 0/3 |
| 1920x1080 | 3 | 3/3 | 3/3 |
| 2560x1440 | 3 | 3/3 | 3/3 |
| 390x844, unsupported renderer stress | 3 | 3/3 | 0/3 |

Every sample retains the Example heading, greeting/console code, shell, and table
in the same DOM order with nonzero geometric rectangles. Nine samples have no
painted transcript nodes. The minimum light, 1280 dark, 1920 light, and 390 dark
PNGs were opened: the first, second, and fourth show a blank transcript; the
1920 control shows the complete content. This is an observed parent rendering
failure, not the old offscreen-greeting timeout. It was not tuned away.

At minimum size, the stable baseline code-anchor offset is -58.203125 CSS px;
after theme navigation it is -140.203125 CSS px (82 px drift). The provider-auth
banner is present. No cause beyond the observed rendering/anchor failure is
claimed.

| Case 21 check | Result |
| --- | --- |
| theme-content-parity | FAIL |
| renderer-electron-parity | PASS, 6 pairs |
| virtual-anchor | FAIL |
| native-minimum | PASS |
| git-overflow | PASS |
| hit-test | FAIL |
| draft-preserved | PASS |

Verbatim failures:

```text
AssertionError [ERR_ASSERTION]: all content has painted nonzero rectangles

false !== true
```

```text
AssertionError [ERR_ASSERTION]: theme retains same message and scroll anchor
+ actual - expected

  {
    route: '#/7870fa7e-ec66-4e30-a190-3b5accc6b5ee/baseline-code',
    text: 'export function greeting(name: string): string {\n' +
      '  return `Hello, ${name}!`;\n' +
      '}\n' +
      '\n' +
      "console.log(greeting('Weavra'));\n",
+   y: 315.796875
-   y: 233.796875
  }
```

```text
AssertionError [ERR_ASSERTION]: panel icon has desktop minimum hit size

false !== true
```

The two owned parent app runs exited. Model, Runtime mutation, and blocked
outbound counters are all zero. The existing inactive-window preload and app
gate were used; no mouse operation or installed-app access was performed.

## Cases 16-20 regression results

All five commands exited 0, sequentially, using the same existing inactive-window
preload and app gate as the parent command. Each command used the matching clean
`/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-N` source worktree,
`pr-N/after/app/weavra-desktop.app`, and the repaired runner's `assert.mjs --case N
--evidence <this directory>/pr-N/qa`.

| Case | Source revision | Passing checks |
| --- | --- | --- |
| 16 | `878a9162cd8ce64b39c36531d772cdbd3885b658` | 4/4 |
| 17 | `c4e04c655ec393a0641dbafbfa204d9580b992bb` | 3/3 |
| 18 | `fb97140d6781ff14b680cd56eec95e31fb23841b` | 6/6 |
| 19 | `b4de3b5dbdf441925ac2c5d64b9276737af2f1b3` | 4/4 |
| 20 | `d81bc594776ea0cf5b9ea45db6865a4f24831ded` | 5/5 |

Total: 22/22 PASS. Every receipt records `cleanup.exited: true` and zero model,
Runtime-mutation, and blocked-outbound counters. Receipts:
`pr-{16,17,18,19,20}/qa/scenario-receipt.json`.

Case 16: empty-connection-action, capability-copy-parity, unavailable-disabled,
direct-remote.
Case 17: empty-archive-route, return-to-conversation, archive-restore.
Case 18: status-summary-complete, raw-diagnostic, six-adapters, one-scroll-owner,
form-actions-reachable, draft-preserved.
Case 19: selection-wash-check, focus-not-selection, system-live-theme,
custom-theme-preview.
Case 20: named-delete-consequence, target-identity, enter-no-delete,
escape-cancel, focus-return.

## Diff

Only two runner-owned files changed, 182 insertions and 23 deletions:

- `scripts/hig/cases.mjs:165`: DOM content, paint, intersection, anchor, and zoom
  observation.
- `scripts/hig/cases.mjs:216`: strict seeded-content, order, geometry, visible
  anchor, scroll-offset, and zoom assertions.
- `scripts/hig/cases.mjs:1374`: establish and record the code anchor before the
  matrix; use layout readiness independent of viewport-visible greeting.
- `scripts/hig/cases.mjs:3995`: bind case 21 to those parity assertions.
- `scripts/hig/harness.test.ts:505`: six real-Chromium good/bad regressions.

## Diagnostics

`node --check scripts/hig/cases.mjs`, `git diff --check`, and the staged
`git diff --cached --check` passed. The language server cannot resolve the existing Bun
test imports in this root-level test file:

```text
Cannot find module 'bun:test' or its corresponding type declarations.
Cannot find module 'bun:sqlite' or its corresponding type declarations.
Cannot find module 'bun' or its corresponding type declarations.
```

Fresh language-server diagnostics for `cases.mjs` timed out:

```text
Timed out waiting for fresh diagnostics for /Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-01/scripts/hig/cases.mjs within 3000ms.
```

These are not a clean typecheck claim. The actual Bun suite passed.
