import { renderToStaticMarkup } from "react-dom/server";
import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

const calls = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => calls.update }));
import {
  ServerUpdateAction,
  ServerUpdatesAction,
  ServerUpdateProgress,
} from "./ServerUpdateAction";

const target = {
  environmentId: EnvironmentId.make("remote"),
  serverLabel: "Remote server",
  selfUpdate: "desktop-managed" as const,
  desktopAppUpdate: true,
  targetVersion: "0.0.42",
};

describe("unavailable product updates", () => {
  it("does not offer install authority even when a remote server advertises it", () => {
    calls.update.mockReset();
    const action = ServerUpdateAction(target);
    expect(action.props.disabled).toBe(true);
    expect(action.props.onClick).toBeUndefined();
    const batch = ServerUpdatesAction({ targets: [target] });
    expect(batch.props.disabled).toBe(true);
    expect(batch.props.onClick).toBeUndefined();
    expect(calls.update).not.toHaveBeenCalled();
  });
  it("does not turn a manual path into an upstream install command or link", () => {
    const markup = renderToStaticMarkup(<ServerUpdateAction {...target} selfUpdate={null} />);
    expect(markup).toContain("disabled");
    expect(markup).not.toContain("npx");
    expect(markup).not.toContain("href=");
  });
  it("keeps an incoming failure visible without offering a retry install", () => {
    const markup = renderToStaticMarkup(
      <ServerUpdateProgress
        state={{
          status: "failed",
          stage: "installing",
          fromVersion: "0.0.41",
          targetVersion: "0.0.42",
          message: "The package could not be verified.",
        }}
      />,
    );
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("The package could not be verified.");
    expect(markup).not.toContain("<button");
  });
});
