# Todo 12 diff inspection

All 158 matching image pairs have matching dimensions and intact alpha.
136 pairs have zero pixel difference; 22 have a nonzero diff ratio.
The task-specific changes are Keybindings state 20: 0.0782 at 1280x800,
0.0540 at 1920x1080. These show the explanation, alias grouping and larger controls.

The largest unrelated pairs were opened side by side:

- `1280x800/45_rename_thread_inline.png` (0.1476): both target `03 Code blocks`
  and show the same inline rename input. The transcript scroll position differs:
  the after frame includes the preceding user prompt and scroll-to-bottom affordance.
  Both retain the greeting function, console call, shell output and table.
- `1280x800/44_delete_thread_confirmation.png` (0.1413): the same dialog targets
  `03 Code blocks`, with identical consequence and Cancel/Confirm actions. The
  inactive blurred transcript behind it has the same scroll-position difference.
- These are explicitly retained background/scroll differences, not keybinding
  source changes, a claimed conversation fix, or a manufactured pixel-parity PASS.

Only the three KeybindingsSettings owner files differ between the product revisions.
The packet does not attribute unrelated dynamic captures to those source changes, mask
them, or claim that all other surfaces were manually proven pixel-identical. Every pair's
raw diff ratio and hotspot list is retained. Exhaustive all-image/hotspot review is the
Final-wave Q12 check, not a manufactured per-PR PASS.
