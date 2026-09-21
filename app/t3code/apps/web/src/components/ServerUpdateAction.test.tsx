import { renderToStaticMarkup } from "react-dom/server";
import { EnvironmentId } from "@t3tools/contracts";
import { APP_UPDATE_UNAVAILABLE_REASON } from "@t3tools/shared/cliRelease";
import { expect, it, vi } from "vite-plus/test";

const updateServer = vi.hoisted(() => vi.fn());
const copyToClipboard = vi.hoisted(() => vi.fn());
vi.mock("~/hooks/useCopyToClipboard", () => ({ useCopyToClipboard: () => ({ copyToClipboard }) }));
vi.mock("~/hooks/useSettings", () => ({ useEnvironmentSettings: () => false }));
vi.mock("~/state/server", () => ({ serverEnvironment: { updateServer: Symbol("updateServer") } }));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => updateServer }));
vi.mock("./ui/toast", () => ({ toastManager: { add: vi.fn() } }));

import { ServerUpdateAction, ServerUpdatesAction } from "./ServerUpdateAction";

it("offers neither a remote update nor a vendor installation command", () => {
  for (const selfUpdate of [null, "boot-service", "desktop-managed"] as const) {
    const markup = renderToStaticMarkup(
      <ServerUpdateAction
        environmentId={EnvironmentId.make("remote")}
        serverLabel="Remote"
        selfUpdate={selfUpdate}
        desktopAppUpdate
        targetVersion="1.2.3"
      />,
    );
    expect(markup).toContain(APP_UPDATE_UNAVAILABLE_REASON);
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("npx");
  }
  expect(updateServer).not.toHaveBeenCalled();
  expect(copyToClipboard).not.toHaveBeenCalled();
});

it("disables batch updates despite an inherited server advertising support", () => {
  const markup = renderToStaticMarkup(
    <ServerUpdatesAction
      targets={[
        {
          environmentId: EnvironmentId.make("legacy"),
          serverLabel: "Legacy",
          selfUpdate: "desktop-managed",
          desktopAppUpdate: true,
          targetVersion: "1.2.3",
        },
      ]}
    />,
  );
  expect(markup).toContain("disabled");
  expect(updateServer).not.toHaveBeenCalled();
});
