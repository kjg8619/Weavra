import { ko } from "~/i18n/ko";
import { weavraLabel } from "../weavraLabels";
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
      aria-label={ko.runtime.capabilities.title}
      className="space-y-3 rounded-md border border-border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{ko.runtime.capabilities.title}</h3>
        <Badge variant={current ? "outline" : "warning"}>{weavraLabel(status)}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">{ko.runtime.capabilities.inspectionOnly}</p>
      <details className="text-sm">
        <summary className="cursor-pointer rounded-sm py-2 focus-visible:outline-2 focus-visible:outline-ring">
          {ko.runtime.capabilities.details}
        </summary>
        <p className="select-text break-all text-sm text-muted-foreground">
          {ko.runtime.capabilities.projectScope(scope)}
        </p>
        {!inventory ? (
          <p className="text-sm text-muted-foreground">{ko.runtime.capabilities.notExposed}</p>
        ) : (
          <>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              {[
                [ko.runtime.capabilities.coverage, inventory.coverage],
                [
                  ko.runtime.capabilities.ownerRevision,
                  `${inventory.ownerId} / ${inventory.projectRevision}`,
                ],
                [
                  ko.runtime.capabilities.epochGeneration,
                  `${inventory.brokerEpoch} / ${inventory.generation}`,
                ],
                [
                  ko.runtime.capabilities.runtimeObservation,
                  `${inventory.status} / ${inventory.reason}`,
                ],
                [ko.runtime.capabilities.observedAtHost, inventory.observedAt ?? ko.common.unknown],
                [
                  ko.runtime.capabilities.totalOmitted,
                  `${inventory.total ?? ko.common.unknown} / ${inventory.omitted}`,
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="mt-1 break-all font-mono">{value}</dd>
                </div>
              ))}
            </dl>
            {historical && (
              <p className="text-sm text-muted-foreground">{ko.runtime.capabilities.historical}</p>
            )}
            <ul
              aria-label={
                historical
                  ? ko.runtime.capabilities.historicalList
                  : ko.runtime.capabilities.observedList
              }
              className="divide-y divide-border"
            >
              {inventory.entries.map(({ descriptor, requirements, observation }) => (
                <li key={descriptor.id} className="space-y-1 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono font-medium">{descriptor.name}</span>
                    <Badge variant="outline">
                      {weavraLabel(current ? observation.availability : "NEEDS_REFRESH")}
                    </Badge>
                  </div>
                  <p className="break-all font-mono text-muted-foreground">{descriptor.id}</p>
                  <p>
                    {descriptor.name.startsWith("runtime_lsp_")
                      ? "LSP"
                      : ko.runtime.capabilities.file}{" "}
                    · {weavraLabel(descriptor.origin)} · {weavraLabel(observation.reason)}
                  </p>
                  <p className="text-muted-foreground">
                    {weavraLabel(requirements.operation)} · {weavraLabel(requirements.mode)} ·{" "}
                    {weavraLabel(requirements.policy)} · {weavraLabel(requirements.approval)}
                  </p>
                  <p className="text-muted-foreground">
                    {ko.runtime.capabilities.observedAt(
                      String(observation.observedAt ?? ko.common.unknown),
                    )}{" "}
                    · {weavraLabel(observation.source)}
                  </p>
                </li>
              ))}
            </ul>
            {current && inventory.entries.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {ko.runtime.capabilities.emptyResult(inventory.omitted)}
              </p>
            )}
          </>
        )}
      </details>
    </section>
  );
}
