import type { WeavraControlViewState } from "@t3tools/client-runtime/state/weavraControl";
import { Badge } from "../ui/badge";

export function CapabilityInventory({
  view,
  connected,
  scope,
}: {
  view: WeavraControlViewState["capabilityInventory"] | undefined;
  connected: boolean;
  scope: string;
}) {
  const inventory = view?.inventory;
  const status = !connected && inventory ? "NEEDS_REFRESH" : (view?.status ?? "NOT_EXPOSED");
  const current = connected && status === "CURRENT";
  const historical = inventory?.status === "CURRENT" && !current;
  return (
    <section
      aria-label="Runtime capability inventory"
      className="space-y-3 rounded-md border border-border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Runtime capability inventory</h3>
        <Badge variant={current ? "outline" : "warning"}>{status}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Inspection only. Runtime checks permission per action. This catalog does not grant tool
        access, Policy eligibility, approval or verification evidence.
      </p>
      <p className="break-all text-xs text-muted-foreground">Project scope: {scope}</p>
      {!inventory ? (
        <p className="text-sm text-muted-foreground">
          NOT EXPOSED / UNKNOWN. This connection has no Runtime capability inventory. Ordinary
          read-only observation remains separate; inventory requires control observation access.
        </p>
      ) : (
        <>
          <dl className="grid gap-2 text-xs sm:grid-cols-2">
            {[
              ["Coverage", inventory.coverage],
              ["Owner / project revision", `${inventory.ownerId} / ${inventory.projectRevision}`],
              ["Epoch / generation", `${inventory.brokerEpoch} / ${inventory.generation}`],
              ["Runtime observation", `${inventory.status} / ${inventory.reason}`],
              ["Observed time (Host Unix ms)", inventory.observedAt ?? "UNKNOWN"],
              ["Total / omitted", `${inventory.total ?? "UNKNOWN"} / ${inventory.omitted}`],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="mt-1 break-all font-mono">{value}</dd>
              </div>
            ))}
          </dl>
          {historical && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Historical observation — all retained rows NEEDS_REFRESH. A checked new Runtime
              generation is required.
            </p>
          )}
          <ul
            aria-label={historical ? "Historical capabilities" : "Capability observations"}
            className="divide-y divide-border"
          >
            {inventory.entries.map(({ descriptor, requirements, observation }) => (
              <li key={descriptor.id} className="space-y-1 py-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono font-medium">{descriptor.name}</span>
                  <Badge variant="outline">
                    {current ? observation.availability : "NEEDS_REFRESH"}
                  </Badge>
                </div>
                <p className="break-all font-mono text-muted-foreground">{descriptor.id}</p>
                <p>
                  {descriptor.name.startsWith("runtime_lsp_") ? "LSP" : "File"} ·{" "}
                  {descriptor.origin} · {observation.reason}
                </p>
                <p className="text-muted-foreground">
                  {requirements.operation} · {requirements.mode} · {requirements.policy} ·{" "}
                  {requirements.approval}
                </p>
                <p className="text-muted-foreground">
                  Observed: {observation.observedAt ?? "UNKNOWN"} Host Unix ms ·{" "}
                  {observation.source}
                </p>
              </li>
            ))}
          </ul>
          {current && inventory.entries.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No rows in this Runtime result. Omitted rows: {inventory.omitted}.
            </p>
          )}
        </>
      )}
    </section>
  );
}
