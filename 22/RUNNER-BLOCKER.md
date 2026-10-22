# weavra-hig22 - shared runner defect stop (todo 22 / W-03)

Date: 2026-10-21. Lane: weavra-hig22. Status: BLOCKER, stopped per brief.

Shared runner: hig-01 at 82834bcf1be52aed98eef525696550077bf83df2, clean and unedited.
Product parent: hig/21-adaptive-chat at 245a9efdfee4e949a5d312798bcdbf31ed0c1675.
No worktree, branch, product edit, build, app launch, commit, push or PR was created
by this lane. Nothing is running.

## Defect

The W-03 closure requires translating authored English copy on states 11, 14, 15 and 17-30.
The runner pins that same English text as mandatory machine targets, and has no Korean
alias for it. So any correct translation fails capture or acceptance. Case 22 also
contradicts itself: its locale audit fails any visible English label, while its own
navigation requires the English names.

### 1. capture_pr 22 readiness (blocks the 94-PNG capture)

`scripts/hig/capture.mjs:194` requires `document.body.innerText.includes(expected)`, using the
`expected` strings from the state rows at `scripts/hig/cases.mjs:15-63`.
Exact per-state lines are in runner-alias-request.md, which supersedes the l.NN numbers below.
Correction: those numbers were 7 too high (e.g. state 11 is l.26, state 30 is l.45). There are no aliases, unlike LABELS
(`cases.mjs:93`). Translating the authored source text removes these English strings, so
readiness times out (capture.mjs:173, 15 s):

| State | expected (cases.mjs) | Authored source at 245a9efd |
|---|---|---|
| 11 | Add Action (l.33) | projectScriptEditor.tsx:308 DialogTitle |
| 14 | Set up devices (l.36) | device/DeviceSetup.tsx:80 title |
| 15 | No preview yet (l.37) | preview/PreviewEmptyState.tsx:41 EmptyTitle |
| 17 | Restore device defaults (l.39) | routes/settings.tsx:45 button |
| 18/19 | Color scheme (l.40-41) | settings section title (settingsSearch.ts:177) |
| 20 | Keybindings (l.42) | settings page title |
| 22 | Providers (l.44) | settingsSearch.ts:89/527 page title |
| 23 | Integrations (l.45) | settings page title |
| 24 | Source Control (l.46) | settings page title |
| 25 | Storage (l.47) | settingsSearch.ts:92 page title |
| 26 | Connections (l.48) | settings page title |
| 27 | Archive (l.49) | settingsSearch.ts:94 page title |
| 28 | Cancel (l.50) | custom-model form button (LABELS.cancel already has 취소) |
| 29 | Diagnostics (l.51) | settings page title |
| 30 | Third-party notices (l.52) | settings/OpenSourceLicenses.tsx:226 title |

State 21 "SnapShots", 31 "Claude" and the fixture texts (34-38) are proper names or fixture
data and are not affected.

### 2. accept_pr 22: case 22 contradicts itself

- `cases.mjs:1648,1652` (bothSidebars, used by `22/both-sidebars` at l.4410) requires the
  button named exactly `Legacy features`. `cases.mjs:1657` requires the switch named exactly
  `Sidebar (legacy)`. Both are visible in settings General, where `22/authored-locale`
  (l.4363) and `22/keyboard-ax` (l.4457) run `localeAudit` (l.1689-1720). That audit fails
  any visible button or label with three or more Latin letters outside the `proper` regex
  (l.1705). One of the two checks must fail.
- `cases.mjs:3888` (`18/six-adapters`, called by `22/six-adapters` at l.4415) requires the
  button `Add provider`. `localeAudit(main)` in the same check (l.4416) and
  `22/authored-locale` "providers" fail on that same English button.

### 3. Final-wave re-run (not case 22, but broken by the same W-03 translation)

These English-only selectors have no Korean alias: `cases.mjs:101-103` (Thread notifications,
Notifications only, In-app notifications; used at l.1788-1798), l.673 `Run HIG saved action`,
l.1582/3113 `Refresh workspace files`, l.2294-2306/3975-3992 theme editor names, l.3603-3669
`Open links in`, l.3708-3767 `Add environment`, l.3897-3950 appearance-mode names,
l.4175 `When expression`, l.4277 `Unarchive`, and the files region
`[aria-label="baseline-project files"]` (l.3030-3090).

## Needed (runner owner, hig-01)

For each translated target, add an explicit baseline/current alias, as todo 1 step 3 requires
("explicit baseline/current accessible-selector aliases for authored labels that task 22
translates"). Apply this to the `expected` readiness strings and to the case-local exact names
above. Exact aliases only: keep the same semantic target and selector uniqueness, and weaken no
assertion. I can supply the exact Korean strings I will ship before the runner change. Alternatively,
the lead decides which Korean term each target uses, and I implement to match.

I did not edit the runner, weaken any criterion or guess a workaround.
