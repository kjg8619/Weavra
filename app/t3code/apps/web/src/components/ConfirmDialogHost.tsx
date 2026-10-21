import { useEffect, useRef, useSyncExternalStore } from "react";

import {
  completeConfirmDialogClose,
  readConfirmDialogState,
  registerConfirmDialogHost,
  respondToConfirmDialog,
  subscribeConfirmDialog,
} from "../confirmDialog";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";

type ConfirmationCopy = {
  readonly title: string;
  readonly description: string | null;
};

function resolveConfirmDialogCopy(message: string): ConfirmationCopy {
  const normalizedMessage = message.trim();
  const lines = normalizedMessage.split("\n");
  const questionLineIndex = lines.findIndex((line) => line.trim().endsWith("?"));

  if (questionLineIndex >= 0) {
    const title = lines[questionLineIndex]!.trim();
    const description = lines
      .filter((_, index) => index !== questionLineIndex)
      .join("\n")
      .trim();
    return { title, description: description || null };
  }

  const questionMarkIndex = normalizedMessage.indexOf("?");
  if (questionMarkIndex >= 0) {
    return {
      title: normalizedMessage.slice(0, questionMarkIndex + 1).trim(),
      description: normalizedMessage.slice(questionMarkIndex + 1).trim() || null,
    };
  }

  return {
    title: "Confirm action",
    description: normalizedMessage || "This action requires your confirmation.",
  };
}

export function ConfirmDialogHost() {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const state = useSyncExternalStore(
    subscribeConfirmDialog,
    readConfirmDialogState,
    readConfirmDialogState,
  );

  useEffect(() => registerConfirmDialogHost(), []);

  const copy =
    state.status !== "idle" && state.title !== undefined
      ? { title: state.title, description: state.message }
      : resolveConfirmDialogCopy(state.status === "idle" ? "" : state.message);
  const confirmVariant = state.status === "idle" ? "default" : state.variant;
  const onCancel = () => respondToConfirmDialog(false);
  const onConfirm = () => respondToConfirmDialog(true);

  return (
    <AlertDialog
      open={state.status === "confirming"}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      onOpenChangeComplete={(open) => {
        if (!open) completeConfirmDialogClose();
      }}
    >
      <AlertDialogPopup className="max-w-lg" initialFocus={titleRef}>
        <AlertDialogHeader>
          <AlertDialogTitle
            ref={titleRef}
            tabIndex={-1}
            className="wrap-anywhere break-keep rounded-sm leading-snug focus:outline-2 focus:outline-offset-4 focus:outline-foreground"
          >
            {copy.title}
          </AlertDialogTitle>
          {copy.description ? (
            <AlertDialogDescription className="wrap-anywhere break-keep whitespace-pre-line text-sm text-popover-foreground">
              {copy.description}
            </AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose
            render={
              <Button
                variant="outline"
                size="lg"
                className="rounded-none border-foreground text-sm focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground [:hover,[data-pressed]]:border-foreground"
              />
            }
          >
            {state.status !== "idle" && state.confirmLabel !== undefined ? "취소" : "Cancel"}
          </AlertDialogClose>
          <Button
            variant={confirmVariant === "destructive" ? "destructive-outline" : confirmVariant}
            size="lg"
            className="rounded-none border-foreground text-sm focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground [:hover,[data-pressed]]:border-foreground"
            onClick={onConfirm}
          >
            {state.status !== "idle" ? (state.confirmLabel ?? "Confirm") : "Confirm"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
