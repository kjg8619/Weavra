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
      aria-label="Runtime 기능 목록"
      className="space-y-3 rounded-md border border-border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Runtime 기능 목록</h3>
        <Badge variant={current ? "outline" : "warning"}>{weavraLabel(status)}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        조회 전용이에요. Runtime이 각 동작의 권한을 확인하며, 이 목록은 도구 접근·Policy
        허용·승인·검증 증거를 부여하지 않아요.
      </p>
      <details className="text-sm">
        <summary className="cursor-pointer rounded-sm py-2 focus-visible:outline-2 focus-visible:outline-ring">
          기능 관찰 상세
        </summary>
        <p className="select-text break-all text-sm text-muted-foreground">
          프로젝트 범위: {scope}
        </p>
        {!inventory ? (
          <p className="text-sm text-muted-foreground">
            기능 목록이 제공되지 않아 확인할 수 없어요. 일반 읽기 전용 관찰과는 별도이며, 기능
            목록을 보려면 제어 관찰 권한이 필요해요.
          </p>
        ) : (
          <>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              {[
                ["제공 범위", inventory.coverage],
                [
                  "소유자 / 프로젝트 revision",
                  `${inventory.ownerId} / ${inventory.projectRevision}`,
                ],
                ["시대 / 세대", `${inventory.brokerEpoch} / ${inventory.generation}`],
                ["Runtime 관찰", `${inventory.status} / ${inventory.reason}`],
                ["관찰 시각(Host Unix ms)", inventory.observedAt ?? "확인 안 됨"],
                ["전체 / 생략", `${inventory.total ?? "확인 안 됨"} / ${inventory.omitted}`],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="mt-1 break-all font-mono">{value}</dd>
                </div>
              ))}
            </dl>
            {historical && (
              <p className="text-sm text-muted-foreground">
                과거 관찰이에요. 보관된 모든 항목을 새로고침해야 해요. 검증된 새 Runtime 세대가
                필요해요.
              </p>
            )}
            <ul
              aria-label={historical ? "과거 기능 목록" : "관찰된 기능 목록"}
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
                    {descriptor.name.startsWith("runtime_lsp_") ? "LSP" : "파일"} ·{" "}
                    {weavraLabel(descriptor.origin)} · {weavraLabel(observation.reason)}
                  </p>
                  <p className="text-muted-foreground">
                    {weavraLabel(requirements.operation)} · {weavraLabel(requirements.mode)} ·{" "}
                    {weavraLabel(requirements.policy)} · {weavraLabel(requirements.approval)}
                  </p>
                  <p className="text-muted-foreground">
                    관찰 시각: {observation.observedAt ?? "확인 안 됨"} Host Unix ms ·{" "}
                    {weavraLabel(observation.source)}
                  </p>
                </li>
              ))}
            </ul>
            {current && inventory.entries.length === 0 && (
              <p className="text-sm text-muted-foreground">
                이 Runtime 결과에는 항목이 없어요. 생략한 항목: {inventory.omitted}.
              </p>
            )}
          </>
        )}
      </details>
    </section>
  );
}
