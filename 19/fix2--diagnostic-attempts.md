# Measurement setup diagnostics

These errors occurred while preparing the new measurement, before collecting
the accepted baseline. They are not product-test failures.

First attempt, exit 1:

```text
error: Not a task-owned capture profile
```

The temporary directory prefix was corrected from `weavra-hig19-label-`
to the seed contract's required `weavra-hig-19-label-`.

Second attempt, exit 1:

```text
error: evaluate: Error: Expected variant name and option count
```

React renders `+` and `1` as separate text nodes. The measurement now
checks the `+1` element value and measures every text-node rectangle
instead of assuming one text node per element.

The final baseline measurement completed all 12 contexts / 24 labels and
exited 1 for 12 actual overlapping labels, as intended. The identical
measurement is used for the rebuilt fixed head.

The file editor's LSP refresh repeatedly reported:

```text
Timed out waiting for fresh diagnostics
```

This affected external evidence JavaScript, not the product TSX diagnostic
check. `node --check` on the new measurement, diff, status and publication
scripts exited 0. The product TSX LSP check returned `No diagnostics found`.

The first final app-slot listing used a wrongly escaped awk pattern:

```text
awk: syntax error at source line 1
 context is
	 >>> //. <<< omo/evidence// && //MacOS/weavra-desktop([[:space:]]|$)/ && !/awk/ {print}
awk: bailing out at source line 1
```

The packet verifier before that listing had exited 0. The listing was
replaced with a complete `ps -wwaxo pid,command` result filtered in the JS
kernel: zero evidence-app processes, slot released. No process was killed.
