# Product and authority boundaries

`Weavra` is the Git/product root. `runtime/pi` and `app/t3code` remain separate source checkouts and package-manager roots inside it. Neither is the project an agent is necessarily operating on.

| Meaning | Resolution | Must not become |
| --- | --- | --- |
| Product repository | Containing Git root | Pi npm root or T3 pnpm root |
| Pi source/build checkout | Module/launcher-relative `runtime/pi` | Containing Git root |
| T3 source/build checkout | Module/script-relative `app/t3code` | Containing Git root |
| Agent target project | Explicit trusted project cwd and its Git identity | Weavra's own source tree |
| Package root | Existing workspace/package boundaries | New root workspace |

The app starts the configured absolute executable with `weavra bridge --stdio --project-trusted`. Control uses the existing opt-in `--control` mode. `scripts/weavra-env.sh` resolves the exact executable from its own location; it neither changes cwd nor silently enables control. Set the app's existing trusted-project/control settings separately.

```text
Weavra Desktop/Web/Host
  -> production BridgeTransport / ControlTransport / FitnessReader
  -> absolute weavra executable, trusted project cwd
  -> Runtime Host -> RegisteredVerifier -> Kernel
```

Production app modules do not import Runtime implementation source. The root cross-boundary validation scenario imports both sides solely to exercise their existing contracts. The duplicated schema/DTO definitions are deliberately retained; no shared protocol package or schema generation is introduced.

## C08 remains bounded

- Browser/Jev captures observations only. Saved candidates have `CANDIDATE_ONLY` authority.
- Runtime/Host owns reviewed check registration. Registration is not verification.
- RegisteredVerifier freezes trusted registrations and obtains new isolated captures for self-check and test.
- Candidate DOM/text is not accepted as verification evidence. A retained Ready candidate cannot make a freshly Broken document pass.
- Kernel owns state transitions and completion. UI preview, transport success, worker text, and registration success cannot manufacture PASS/COMPLETE.
- Owned loopback static documents and fresh profiles only. No authenticated user profile, personal browser session, remote crawling, action loop, automatic browser repair, or C09/V0.6D work.

## Preserved legacy scope

Nested `.github` workflows are historical files, not active Weavra workflows. Nested `t3.json` describes the old standalone T3 checkout setup; it is not discovered at the product root and is not promoted into an automatic product-root worktree installer. For development, explicitly use the two build-root commands documented at the root. Historical upstream URLs, package names, branded assets, vendored reference trees, and manual reference-update tools remain provenance; they do not establish an upstream synchronization policy.

The historical consolidation scope above does not authorize current product
connections to inherited services. [Product Independence](PRODUCT_INDEPENDENCE.md)
defines the current CLI, identity, home, update, sharing, analytics and hosted-service
policy. Historical names remain in internal namespaces and provenance; active
product behavior must not use them as distribution or tenant authority.
