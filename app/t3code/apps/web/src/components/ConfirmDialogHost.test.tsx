import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

// The unit renderer has no portal DOM. Keep coordinator/host/button behavior real;
// native focus, Enter and Escape are exercised by the packaged Electron scenarios.
vi.mock("./ui/alert-dialog", () => ({
  AlertDialog: ({ children, ...props }: { children: ReactNode }) => (
    <section {...props}>{children}</section>
  ),
  AlertDialogPopup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  AlertDialogClose: ({ children }: { children: ReactNode }) => <aside>{children}</aside>,
}));

import {
  completeConfirmDialogClose,
  readConfirmDialogState,
  requestConfirmDialog,
  resetConfirmDialogForTests,
} from "../confirmDialog";
import { ConfirmDialogHost } from "./ConfirmDialogHost";

let renderer: ReactTestRenderer;

beforeEach(async () => {
  resetConfirmDialogForTests();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await act(() => {
    renderer = create(<ConfirmDialogHost />);
  });
});
afterEach(async () => {
  await act(() => renderer.unmount());
  resetConfirmDialogForTests();
  vi.unstubAllGlobals();
});

describe("confirmation host", () => {
  it("uses explicit presentation without parsing question marks in the target", async () => {
    const options = { title: "fixture? target", confirmLabel: "remove fixture" };
    await act(() => {
      requestConfirmDialog("description? retained", options);
    });
    expect(renderer.root.findByType("h2").children).toEqual([options.title]);
    expect(renderer.root.findByType("p").children).toEqual(["description? retained"]);
  });

  it("deletes only the explicitly confirmed disposable target once", async () => {
    const threads = new Set(["fixture-a", "fixture-b"]);
    let confirmation: Promise<boolean> | undefined;
    const remove = vi.fn();
    await act(() => {
      confirmation = requestConfirmDialog("fixture consequence", {
        title: "fixture-a",
        confirmLabel: "remove-a",
      });
      void confirmation?.then((confirmed) => {
        if (confirmed) {
          threads.delete("fixture-a");
          remove();
        }
      });
    });
    expect(threads.size).toBe(2);
    const approve = renderer.root.findByType("button");
    await act(() => {
      approve.props.onClick();
      approve.props.onClick();
    });
    await expect(confirmation).resolves.toBe(true);
    expect([...threads]).toEqual(["fixture-b"]);
    expect(remove).toHaveBeenCalledOnce();
  });

  it("resolves false through the host dismissal", async () => {
    let confirmation: Promise<boolean> | undefined;
    await act(() => {
      confirmation = requestConfirmDialog("fixture", { title: "fixture-a" });
    });
    await act(() => renderer.root.findByType("section").props.onOpenChange(false));
    await expect(confirmation).resolves.toBe(false);
    expect(readConfirmDialogState().status).toBe("closing");
  });

  it("resolves both active and queued requests false when the host unmounts", async () => {
    let active: Promise<boolean> | undefined;
    let queued: Promise<boolean> | undefined;
    await act(() => {
      active = requestConfirmDialog("first");
      queued = requestConfirmDialog("second");
    });
    await act(() => renderer.unmount());
    await expect(Promise.all([active, queued])).resolves.toEqual([false, false]);
  });

  it("keeps generic confirmation consumers usable", async () => {
    let confirmation: Promise<boolean> | undefined;
    await act(() => {
      confirmation = requestConfirmDialog("Continue?");
    });
    await act(() => renderer.root.findByType("button").props.onClick());
    await expect(confirmation).resolves.toBe(true);
    await act(() => completeConfirmDialogClose());
    expect(readConfirmDialogState()).toEqual({ status: "idle" });
  });
});
