import { useAtomValue } from "@effect/atom-react";
import type { ServerUpdateState } from "@t3tools/client-runtime/state/server";
import { Atom } from "effect/unstable/reactivity";
import { useMemo, useState } from "react";

import type { EnvironmentPresentation } from "~/state/environments";
import { serverEnvironment } from "~/state/server";
import {
  buildVersionMismatchDismissalKey,
  dismissServerUpdateFailure,
  dismissVersionMismatch,
  isServerUpdateFailureDismissed,
  isVersionMismatchDismissed,
  resolveServerConfigVersionMismatch,
  resolveServerSelfUpdateCapability,
  supportsDesktopAppUpdate,
  supportsServerUpdateThreadContinuation,
} from "~/versionSkew";
import {
  ServerUpdateAction,
  ServerUpdateProgress,
  ServerUpdatesAction,
} from "../ServerUpdateAction";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";
import { ComposerServerUpdateIcon } from "./ComposerServerUpdateStatus";

/** Keep every machine's update visible while auto balance has no single update target. */
export function useAutoBalanceUpdateBanner(
  environments: readonly EnvironmentPresentation[],
): ComposerBannerStackItem | null {
  const statesAtom = useMemo(
    () =>
      Atom.make((get) =>
        environments.map((environment) => ({
          environment,
          state: get(serverEnvironment.updateStateAtom(environment.environmentId)),
        })),
      ),
    [environments],
  );
  const states = useAtomValue(statesAtom);
  const [dismissedNotices, setDismissedNotices] = useState<ReadonlySet<string | ServerUpdateState>>(
    () => new Set(),
  );
  const machines = states.flatMap(({ environment, state }) => {
    const mismatch = resolveServerConfigVersionMismatch(environment.serverConfig);
    const dismissKey = mismatch
      ? buildVersionMismatchDismissalKey(environment.environmentId, mismatch)
      : null;
    if (
      state.status === "idle"
        ? !mismatch ||
          (dismissKey !== null && dismissedNotices.has(dismissKey)) ||
          isVersionMismatchDismissed(dismissKey)
        : dismissedNotices.has(state) || isServerUpdateFailureDismissed(state)
    )
      return [];
    const selfUpdate = resolveServerSelfUpdateCapability(environment.serverConfig);
    const desktopAppUpdate = supportsDesktopAppUpdate(environment.serverConfig);
    return [
      {
        environmentId: environment.environmentId,
        serverLabel: environment.label,
        selfUpdate,
        desktopAppUpdate,
        threadContinuation: supportsServerUpdateThreadContinuation(environment.serverConfig),
        continueThreadsAfterServerUpdate:
          environment.serverConfig?.settings.continueThreadsAfterServerUpdate ?? false,
        targetVersion: state.status === "idle" ? mismatch!.clientVersion : state.targetVersion,
        connected: environment.connection.phase === "connected",
        remoteUpdate: selfUpdate !== null && (selfUpdate !== "desktop-managed" || desktopAppUpdate),
        state,
        dismissKey,
      },
    ];
  });
  if (machines.length === 0) return null;

  const running = machines.filter((machine) => machine.state.status === "running").length;
  const failed = machines.filter((machine) => machine.state.status === "failed").length;
  const manual = machines.filter((machine) => !machine.remoteUpdate).length;
  const targets = machines.filter(
    (machine) => machine.connected && machine.remoteUpdate && machine.state.status !== "running",
  );
  const count = running || failed || machines.length;
  const status = running ? "running" : failed ? "failed" : "idle";
  const suffix = running ? "업데이트 중" : failed ? "업데이트 실패" : "빌드 불일치";
  const title = `기기 ${count}대 ${suffix}`;
  return {
    id: `auto-balance-server-updates-${dismissedNotices.size}`,
    variant: failed ? "error" : "default",
    priority: running ? "urgent" : "notice",
    icon: <ComposerServerUpdateIcon status={status} />,
    title: (
      <Popover>
        <PopoverTrigger
          className="block max-w-full truncate rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`${title}. 기기 보기`}
        >
          {title}
        </PopoverTrigger>
        <PopoverPopup side="top" align="start" className="w-80 max-w-[calc(100vw-2rem)]">
          <div className="space-y-3 text-xs">
            {machines.map((machine) => (
              <div key={machine.environmentId} className="space-y-1">
                <div className="font-medium">{machine.serverLabel}</div>
                {machine.state.status !== "idle" ? (
                  <ServerUpdateProgress state={machine.state} />
                ) : !machine.remoteUpdate ? (
                  <>
                    <div className="text-muted-foreground">같은 로컬 빌드가 필요해요</div>
                    <ServerUpdateAction {...machine} />
                  </>
                ) : (
                  <div className="text-muted-foreground">
                    {machine.connected
                      ? `Client build: ${machine.targetVersion}. Automatic updates are unavailable.`
                      : "빌드 호환성을 확인하려면 이 기기를 다시 연결해 주세요"}
                  </div>
                )}
              </div>
            ))}
          </div>
        </PopoverPopup>
      </Popover>
    ),
    description:
      manual > 0 ? "같은 로컬 빌드를 써 주세요. 자동 업데이트는 쓸 수 없어요." : undefined,
    actions:
      running === 0 && targets.length > 0 ? (
        <ServerUpdatesAction
          targets={targets}
          variant="ghost"
          label={
            failed > 0
              ? "다시 시도"
              : targets.length === machines.length
                ? "모두 업데이트"
                : `Update ${targets.length} ${targets.length === 1 ? "machine" : "machines"}`
          }
        />
      ) : undefined,
    dismissLabel: "업데이트 알림 닫기",
    ...(running
      ? {}
      : {
          onDismiss: () => {
            const next = new Set(dismissedNotices);
            for (const { state, dismissKey } of machines) {
              dismissServerUpdateFailure(state);
              dismissVersionMismatch(dismissKey);
              if (dismissKey) next.add(dismissKey);
              if (state.status === "failed") next.add(state);
            }
            setDismissedNotices(next);
          },
        }),
  };
}
