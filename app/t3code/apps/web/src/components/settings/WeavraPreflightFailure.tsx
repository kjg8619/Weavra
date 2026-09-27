import type { WeavraControlState } from "@t3tools/contracts";

export function WeavraPreflightFailure({
  configuration,
}: {
  configuration: WeavraControlState["snapshot"]["configuration"] | null;
}) {
  return (
    <section aria-label="Runtime preflight failure" className="space-y-3 text-sm">
      <p className="text-destructive">
        Runtime preflight did not create a Run. No automatic retry was performed.
      </p>
      {configuration ? (
        <>
          <p className="text-xs text-muted-foreground">
            Current project configuration, not the frozen configuration of a Run.
          </p>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-xs sm:grid-cols-2">
            {[
              ["Status", configuration.status],
              ["Registered checks", configuration.registeredCheckCount ?? "UNKNOWN"],
              ["Required checks", configuration.requiredCheckCount ?? "UNKNOWN"],
              ...Object.entries(configuration.modes ?? {}),
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="mt-1 break-words">{value}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          Current configuration is unavailable. Reconnect and wait for a fresh snapshot before
          preparing again.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        On the Runtime host, open this project directory and run{" "}
        <code className="break-words">weavra project doctor</code>. Resolve its local blockers. If
        local prerequisites pass, verify the configured model profiles and authentication before
        preparing again. This diagnostic does not run checks or validate model credentials.
      </p>
    </section>
  );
}
