import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { act, StrictMode, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("./ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? children : null),
  DialogDescription: "p",
  DialogFooter: "footer",
  DialogHeader: "header",
  DialogPanel: "section",
  DialogPopup: "section",
  DialogTitle: "h2",
}));
vi.mock("./ui/alert-dialog", () => ({
  AlertDialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? children : null,
  AlertDialogClose: "button",
  AlertDialogDescription: "p",
  AlertDialogFooter: "footer",
  AlertDialogHeader: "header",
  AlertDialogPopup: "section",
  AlertDialogTitle: "h2",
}));
vi.mock("./ui/button", () => ({ Button: "button" }));
vi.mock("./ui/input", () => ({ Input: "input" }));
vi.mock("./ui/label", () => ({ Label: "label" }));
vi.mock("./ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => children,
  PopoverPopup: () => null,
  PopoverTrigger: "button",
}));
vi.mock("./ui/switch", () => ({ Switch: "input" }));
vi.mock("./ui/textarea", () => ({ Textarea: "textarea" }));

import {
  EMPTY_PROJECT_SCRIPT_INPUT,
  ProjectScriptEditorDialog,
  type ProjectScriptActionResult,
  type ProjectScriptEditorRequest,
} from "./projectScriptEditor";

const onSubmit = vi.fn<Parameters<typeof ProjectScriptEditorDialog>[0]["onSubmit"]>();
const onClose = vi.fn();
const onDelete = vi.fn();
let renderer: ReactTestRenderer | null;

function request(name: string, error?: string): ProjectScriptEditorRequest {
  return {
    scriptId: name,
    initial: { ...EMPTY_PROJECT_SCRIPT_INPUT, name, command: `run-${name}` },
    ...(error === undefined ? {} : { error }),
  };
}

function editor(nextRequest: ProjectScriptEditorRequest) {
  return (
    <StrictMode>
      <ProjectScriptEditorDialog
        request={nextRequest}
        scripts={[]}
        onSubmit={onSubmit}
        onClose={onClose}
        onDelete={onDelete}
      />
    </StrictMode>
  );
}

function open(nextRequest: ProjectScriptEditorRequest) {
  act(() => {
    if (renderer) renderer.update(editor(nextRequest));
    else renderer = create(editor(nextRequest));
  });
}

function submit(): Promise<void> {
  return renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} });
}

function saveButton() {
  return renderer!.root.findAllByType("button").find((button) => button.props.type === "submit")!;
}

function commandField() {
  return renderer!.root.findByProps({ id: "script-command" });
}

function changeCommand(value: string) {
  act(() => {
    commandField().props.onChange({ target: { value } });
  });
}

function deferredSave() {
  let resolve!: (result: ProjectScriptActionResult) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ProjectScriptActionResult>((resolveResult, rejectResult) => {
    resolve = resolveResult;
    reject = rejectResult;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  renderer = null;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  onSubmit.mockReset();
  onClose.mockReset();
  onDelete.mockReset();
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
});

describe("project action editor save lifecycle", () => {
  it("blocks repeated submits and edits until the current save completes", async () => {
    const save = deferredSave();
    onSubmit.mockReturnValue(save.promise);
    open(request("build"));

    let completion!: Promise<void>;
    act(() => {
      completion = submit();
      void submit();
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(saveButton().props.disabled).toBe(true);
    expect(renderer!.root.findByType("fieldset").props.disabled).toBe(true);
    const cancel = renderer!.root
      .findAllByType("button")
      .find((button) => button.children.includes("Cancel"))!;
    expect(cancel.props.disabled).not.toBe(true);

    await act(async () => {
      save.resolve(AsyncResult.success(undefined));
      await completion;
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close a replacement request or release its in-flight save", async () => {
    const first = deferredSave();
    const second = deferredSave();
    onSubmit.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    open(request("build"));
    let firstCompletion!: Promise<void>;
    act(() => {
      firstCompletion = submit();
    });

    open(request("test"));
    expect(saveButton().props.disabled).toBe(false);
    expect(renderer!.root.findByProps({ id: "script-name" }).props.value).toBe("test");
    let secondCompletion!: Promise<void>;
    act(() => {
      secondCompletion = submit();
    });

    await act(async () => {
      first.resolve(AsyncResult.success(undefined));
      await firstCompletion;
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(saveButton().props.disabled).toBe(true);

    await act(async () => {
      second.resolve(AsyncResult.success(undefined));
      await secondCompletion;
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls.map(([scriptId]) => scriptId)).toEqual(["build", "test"]);
  });

  it.each(["failure", "rejection"] as const)(
    "ignores a stale %s after the request changes",
    async (outcome) => {
      const save = deferredSave();
      onSubmit.mockReturnValue(save.promise);
      open(request("build"));
      let completion!: Promise<void>;
      act(() => {
        completion = submit();
      });

      open(request("test", "New request error"));
      await act(async () => {
        if (outcome === "failure")
          save.resolve(AsyncResult.failure(Cause.fail(new Error("Old save error"))));
        else save.reject(new Error("Old save error"));
        await completion;
      });

      const messages = renderer!.root.findAllByType("p").flatMap((paragraph) => paragraph.children);
      expect(messages).toContain("New request error");
      expect(messages).not.toContain("Old save error");
      expect(saveButton().props.disabled).toBe(false);
      expect(onClose).not.toHaveBeenCalled();
    },
  );

  it("shows a current save error and allows retry", async () => {
    onSubmit.mockResolvedValueOnce(AsyncResult.failure(Cause.fail(new Error("Save failed"))));
    onSubmit.mockResolvedValueOnce(AsyncResult.success(undefined));
    open(request("build"));

    await act(async () => {
      await submit();
    });
    expect(renderer!.root.findAllByType("p").flatMap((paragraph) => paragraph.children)).toContain(
      "Save failed",
    );
    expect(saveButton().props.disabled).toBe(false);
    expect(renderer!.root.findByType("fieldset").props.disabled).toBe(false);
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      await submit();
    });
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each(["cancel", "unmount"] as const)("ignores save completion after %s", async (exit) => {
    const save = deferredSave();
    onSubmit.mockReturnValue(save.promise);
    open(request("build"));
    let completion!: Promise<void>;
    act(() => {
      completion = submit();
    });

    act(() => {
      if (exit === "cancel") {
        renderer!.root
          .findAllByType("button")
          .find((button) => button.children.includes("Cancel"))!
          .props.onClick();
      } else {
        renderer!.unmount();
        renderer = null;
      }
    });
    onClose.mockClear();
    await act(async () => {
      save.resolve(AsyncResult.success(undefined));
      await completion;
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("project action command validation", () => {
  it("marks the command invalid when the untouched new form is submitted", async () => {
    open({ scriptId: null, initial: EMPTY_PROJECT_SCRIPT_INPUT });

    await act(async () => {
      await submit();
    });

    expect(commandField().props["aria-invalid"]).toBe(true);
    expect(renderer!.root.findByProps({ id: "script-command-error" })).toBeDefined();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each(["", " \t\n "])(
    "blocks saving a %s command with an associated field error",
    async (value) => {
      open(request("build"));
      changeCommand(value);

      await act(async () => {
        await submit();
      });

      expect(commandField().props["aria-required"]).toBe("true");
      expect(commandField().props["aria-invalid"]).toBe(true);
      expect(commandField().props["aria-describedby"].split(" ")).toContain("script-command-error");
      expect(renderer!.root.findByProps({ id: "script-command-error" })).toBeDefined();
      expect(onSubmit).not.toHaveBeenCalled();
    },
  );

  it("saves a valid command once through the form submission boundary", async () => {
    onSubmit.mockResolvedValue(AsyncResult.success(undefined));
    open(request("build"));
    changeCommand(" \n bun test \t ");

    await act(async () => {
      await submit();
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[1].command).toBe("bun test");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clears the command error after correction and saves once", async () => {
    onSubmit.mockResolvedValue(AsyncResult.success(undefined));
    open(request("build"));
    changeCommand("  ");

    await act(async () => {
      await submit();
    });
    expect(commandField().props["aria-invalid"]).toBe(true);

    changeCommand("bun test");
    expect(commandField().props["aria-invalid"]).toBe(false);
    expect(renderer!.root.findAllByProps({ id: "script-command-error" })).toHaveLength(0);

    await act(async () => {
      await submit();
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[1].command).toBe("bun test");
  });

  it("cancels edited settings without saving or running the action", () => {
    open(request("build"));
    changeCommand("replacement-command");
    const cancel = renderer!.root
      .findAllByType("button")
      .find((button) => button.children.includes("Cancel"))!;

    act(() => {
      cancel.props.onClick();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
    open(request("build"));
    expect(commandField().props.value).toBe("run-build");
  });
});
