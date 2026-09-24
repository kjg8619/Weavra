// Dependency-free so config displays and Plan Preview share one text; the launcher keeps its own short copy.

/**
 * Shown wherever a project config is displayed with the verifier sandbox off. The default stays `disabled`: the
 * sandbox denies network and $HOME/$TMPDIR reads, so checks that need toolchain caches or downloads would fail.
 */
export const SANDBOX_DISABLED_WARNING =
	"WARNING: registered checks run unsandboxed with this user's filesystem and network access, including code the Developer wrote. " +
	"Set verification.sandbox.mode: required to run them in the OS sandbox (macOS verified; Linux NOT VERIFIED). " +
	"Sandboxed checks cannot use the network or read $HOME/$TMPDIR, so checks that need toolchain caches (~/.m2, ~/.gradle, ~/.cargo, ~/.npm) or downloads must stay disabled.";
