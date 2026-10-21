import type {
  ProjectScript,
  ProjectScriptIcon,
  ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  BugIcon,
  CheckIcon,
  FlaskConicalIcon,
  HammerIcon,
  ListChecksIcon,
  PlayIcon,
  WrenchIcon,
} from "lucide-react";
import React, {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  keybindingValueForCommand,
  decodeProjectScriptKeybindingRule,
} from "~/lib/projectScriptKeybindings";
import { ko } from "~/i18n/ko";
import { keybindingFromKeyboardEvent } from "~/components/settings/KeybindingsSettings.logic";
import { commandForProjectScript, nextProjectScriptId } from "~/projectScripts";
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
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";
import { Switch } from "./ui/switch";
import { Textarea } from "./ui/textarea";

const SCRIPT_ICONS: Array<{ id: ProjectScriptIcon; label: string }> = [
  { id: "play", label: ko.projects.scriptEditor.iconPlay },
  { id: "test", label: ko.projects.scriptEditor.iconTest },
  { id: "lint", label: ko.projects.scriptEditor.iconLint },
  { id: "configure", label: ko.projects.scriptEditor.iconConfigure },
  { id: "build", label: ko.projects.scriptEditor.iconBuild },
  { id: "debug", label: ko.projects.scriptEditor.iconDebug },
];

export function ScriptIcon({
  icon,
  className = "size-3.5",
}: {
  icon: ProjectScriptIcon;
  className?: string;
}) {
  if (icon === "test") return <FlaskConicalIcon className={className} />;
  if (icon === "lint") return <ListChecksIcon className={className} />;
  if (icon === "configure") return <WrenchIcon className={className} />;
  if (icon === "build") return <HammerIcon className={className} />;
  if (icon === "debug") return <BugIcon className={className} />;
  return <PlayIcon className={className} />;
}

export interface NewProjectScriptInput {
  name: string;
  command: string;
  icon: ProjectScriptIcon;
  runOnWorktreeCreate: boolean;
  /** Setup scripts only: hold the agent until the script exits. */
  waitForSetup: boolean;
  keybinding: string | null;
  /** Optional URL to open in the in-app preview when this script runs. */
  previewUrl: string | null;
  /** When true, automatically open the preview panel pointed at `previewUrl`. */
  autoOpenPreview: boolean;
}

export type ProjectScriptActionResult = AtomCommandResult<void, unknown>;

export const EMPTY_PROJECT_SCRIPT_INPUT: NewProjectScriptInput = {
  name: "",
  command: "",
  icon: "play",
  runOnWorktreeCreate: false,
  waitForSetup: false,
  keybinding: null,
  previewUrl: null,
  autoOpenPreview: false,
};

/** What the editor dialog should open with. `scriptId: null` means "add". */
export interface ProjectScriptEditorRequest {
  scriptId: string | null;
  initial: NewProjectScriptInput;
  /** Validation error to show immediately (e.g. a failed t3.json import). */
  error?: string;
}

export function editorRequestForScript(
  script: ProjectScript,
  keybindings: ResolvedKeybindingsConfig,
): ProjectScriptEditorRequest {
  return {
    scriptId: script.id,
    initial: {
      name: script.name,
      command: script.command,
      icon: script.icon,
      runOnWorktreeCreate: script.runOnWorktreeCreate,
      waitForSetup: script.runOnWorktreeCreate && script.async === false,
      keybinding: keybindingValueForCommand(keybindings, commandForProjectScript(script.id)),
      previewUrl: script.previewUrl ?? null,
      autoOpenPreview: script.autoOpenPreview ?? false,
    },
  };
}

/**
 * Add/edit dialog for a project script, shared by the chat-header scripts menu
 * and the project settings page. The parent owns which script (if any) is
 * being edited via `request`; the dialog owns the form state and validation.
 */
export function ProjectScriptEditorDialog({
  request,
  scripts,
  onSubmit,
  onDelete,
  onClose,
}: {
  request: ProjectScriptEditorRequest | null;
  /** Existing scripts, used to derive a unique id for new scripts. */
  scripts: ReadonlyArray<ProjectScript>;
  onSubmit: (
    scriptId: string | null,
    input: NewProjectScriptInput,
  ) => Promise<ProjectScriptActionResult>;
  onDelete: (scriptId: string) => void;
  onClose: () => void;
}) {
  const formId = React.useId();
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [icon, setIcon] = useState<ProjectScriptIcon>("play");
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [runOnWorktreeCreate, setRunOnWorktreeCreate] = useState(false);
  const [waitForSetup, setWaitForSetup] = useState(false);
  const [keybinding, setKeybinding] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [autoOpenPreview, setAutoOpenPreview] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const commandRef = useRef<HTMLTextAreaElement>(null);
  const iconTriggerRef = useRef<HTMLButtonElement>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [savingRequest, setSavingRequest] = useState<ProjectScriptEditorRequest | null>(null);
  const pendingSubmissionRef = useRef<{ request: ProjectScriptEditorRequest } | null>(null);

  const isOpen = request !== null;
  const isEditing = request?.scriptId != null;
  const isSaving = request !== null && savingRequest === request;

  // A save completion must not affect a replacement request or an unmounted editor.
  useLayoutEffect(
    () => () => {
      if (pendingSubmissionRef.current?.request === request) {
        pendingSubmissionRef.current = null;
      }
    },
    [request],
  );

  // Hydrate the form whenever a new request opens the dialog.
  useEffect(() => {
    if (!request) return;
    setName(request.initial.name);
    setCommand(request.initial.command);
    setIcon(request.initial.icon);
    setIconPickerOpen(false);
    setRunOnWorktreeCreate(request.initial.runOnWorktreeCreate);
    setWaitForSetup(request.initial.waitForSetup);
    setKeybinding(request.initial.keybinding ?? "");
    setPreviewUrl(request.initial.previewUrl ?? "");
    setAutoOpenPreview(request.initial.autoOpenPreview);
    setValidationError(request.error ?? null);
    setCommandError(null);
    setSavingRequest(null);
  }, [request]);

  const close = () => {
    pendingSubmissionRef.current = null;
    setSavingRequest(null);
    setIconPickerOpen(false);
    onClose();
  };

  const captureKeybinding = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab") return;
    event.preventDefault();
    if (event.key === "Backspace" || event.key === "Delete") {
      setKeybinding("");
      return;
    }
    const next = keybindingFromKeyboardEvent(event, navigator.platform);
    if (!next) return;
    setKeybinding(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!request || pendingSubmissionRef.current !== null) return;
    const trimmedName = name.trim();
    const trimmedCommand = command.trim();
    setValidationError(trimmedName.length === 0 ? ko.projects.scriptEditor.nameRequired : null);
    setCommandError(trimmedCommand.length === 0 ? "실행할 명령을 입력해 주세요." : null);
    if (trimmedCommand.length === 0) {
      commandRef.current?.focus();
      return;
    }
    if (trimmedName.length === 0) return;

    let payload: NewProjectScriptInput;
    try {
      const scriptIdForValidation =
        request.scriptId ??
        nextProjectScriptId(
          trimmedName,
          scripts.map((script) => script.id),
        );
      const keybindingRule = decodeProjectScriptKeybindingRule({
        keybinding,
        command: commandForProjectScript(scriptIdForValidation),
      });
      const trimmedPreviewUrl = previewUrl.trim();
      payload = {
        name: trimmedName,
        command: trimmedCommand,
        icon,
        runOnWorktreeCreate,
        waitForSetup: runOnWorktreeCreate && waitForSetup,
        keybinding: keybindingRule?.key ?? null,
        previewUrl: trimmedPreviewUrl.length > 0 ? trimmedPreviewUrl : null,
        autoOpenPreview: trimmedPreviewUrl.length > 0 ? autoOpenPreview : false,
      } satisfies NewProjectScriptInput;
    } catch (error) {
      setValidationError(
        error instanceof Error ? error.message : ko.projects.scriptEditor.saveFailed,
      );
      return;
    }

    const submission = { request };
    pendingSubmissionRef.current = submission;
    setSavingRequest(request);
    setIconPickerOpen(false);
    try {
      const result = await onSubmit(request.scriptId, payload);
      if (pendingSubmissionRef.current === submission) {
        if (result._tag === "Failure") {
          if (!isAtomCommandInterrupted(result)) {
            const error = squashAtomCommandFailure(result);
            setValidationError(
              error instanceof Error ? error.message : ko.projects.scriptEditor.saveFailed,
            );
          }
        } else {
          close();
        }
      }
    } catch (error) {
      if (pendingSubmissionRef.current === submission) {
        setValidationError(
          error instanceof Error ? error.message : ko.projects.scriptEditor.saveFailed,
        );
      }
    }
    if (pendingSubmissionRef.current === submission) {
      pendingSubmissionRef.current = null;
      setSavingRequest(null);
    }
  };

  return (
    <>
      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) {
            close();
          }
        }}
      >
        <DialogPopup className="break-keep text-pretty">
          <DialogHeader>
            <DialogTitle>
              {isEditing ? ko.projects.scriptEditor.editTitle : ko.projects.scriptEditor.addTitle}
            </DialogTitle>
            <DialogDescription className="text-foreground">
              {ko.projects.scriptEditor.description}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <form id={formId} onSubmit={submit}>
              <fieldset className="space-y-4" disabled={isSaving}>
                <div className="space-y-1.5">
                  <Label htmlFor="script-name">{ko.projects.scriptEditor.nameLabel}</Label>
                  <div className="flex items-center gap-2">
                    <Popover onOpenChange={setIconPickerOpen} open={iconPickerOpen}>
                      <PopoverTrigger
                        render={
                          <Button
                            type="button"
                            variant="outline"
                            className="size-9 shrink-0 border-foreground/60! hover:bg-popover active:bg-popover data-pressed:bg-popover data-pressed:shadow-xs/5 data-pressed:before:shadow-[0_1px_--theme(--color-black/4%)] dark:bg-white/[0.035] dark:data-pressed:before:shadow-none"
                            aria-label={ko.projects.scriptEditor.chooseIcon}
                            data-icon-control=""
                            ref={iconTriggerRef}
                          />
                        }
                      >
                        <ScriptIcon icon={icon} className="size-4.5" />
                      </PopoverTrigger>
                      <PopoverPopup align="start" finalFocus={iconTriggerRef}>
                        <div className="grid grid-cols-3 gap-2">
                          {SCRIPT_ICONS.map((entry) => {
                            const isSelected = entry.id === icon;
                            return (
                              <button
                                key={entry.id}
                                type="button"
                                aria-pressed={isSelected}
                                className={`relative flex min-h-9 flex-col items-center gap-2 rounded-md border border-foreground/60 px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 ${
                                  isSelected
                                    ? "bg-primary/10"
                                    : "hover:bg-accent/60 dark:bg-white/[0.035]"
                                }`}
                                onClick={() => {
                                  setIcon(entry.id);
                                  setIconPickerOpen(false);
                                }}
                              >
                                <ScriptIcon icon={entry.id} className="size-4" />
                                <span>{entry.label}</span>
                                {isSelected && (
                                  <CheckIcon
                                    aria-hidden
                                    className="absolute right-1 top-1 size-3.5 text-foreground"
                                  />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </PopoverPopup>
                    </Popover>
                    <Input
                      id="script-name"
                      autoFocus
                      placeholder={ko.projects.scriptEditor.namePlaceholder}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="script-keybinding">
                    {ko.projects.scriptEditor.keybindingLabel}
                  </Label>
                  <Input
                    id="script-keybinding"
                    placeholder={ko.projects.scriptEditor.keybindingPlaceholder}
                    value={keybinding}
                    readOnly
                    onKeyDown={captureKeybinding}
                  />
                  <p className="text-sm text-foreground">
                    {ko.projects.scriptEditor.keybindingHintBefore}
                    <code>Backspace</code>
                    {ko.projects.scriptEditor.keybindingHintAfter}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="script-command">
                    {ko.projects.scriptEditor.commandLabel}{" "}
                    <span className="font-normal text-foreground">(필수)</span>
                  </Label>
                  <p
                    id="script-command-hint"
                    className="break-keep text-pretty text-sm text-foreground"
                  >
                    명령을 입력한 뒤 저장하세요. 저장만으로 실행되지는 않아요.
                  </p>
                  <Textarea
                    id="script-command"
                    className="border-foreground/60! has-aria-invalid:border-destructive-foreground! has-focus-visible:ring-ring! has-focus-visible:has-aria-invalid:ring-destructive-foreground!"
                    placeholder="bun test"
                    value={command}
                    ref={commandRef}
                    aria-required="true"
                    aria-invalid={commandError !== null}
                    aria-describedby={
                      commandError
                        ? "script-command-hint script-command-error"
                        : "script-command-hint"
                    }
                    onChange={(event) => {
                      setCommand(event.target.value);
                      if (event.target.value.trim().length > 0) setCommandError(null);
                    }}
                  />
                  {commandError && (
                    <p
                      id="script-command-error"
                      className="break-keep text-pretty text-sm text-destructive-foreground"
                      role="alert"
                    >
                      {commandError}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="script-preview-url">
                    {ko.projects.scriptEditor.previewUrlLabel}
                  </Label>
                  <Input
                    id="script-preview-url"
                    placeholder="http://localhost:5173"
                    value={previewUrl}
                    onChange={(event) => setPreviewUrl(event.target.value)}
                  />
                  <p className="text-sm text-foreground">
                    {ko.projects.scriptEditor.previewUrlHint}
                  </p>
                </div>
                <label className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm dark:border-transparent dark:bg-white/[0.035]">
                  <span>{ko.projects.scriptEditor.runOnWorktreeCreate}</span>
                  <Switch
                    checked={runOnWorktreeCreate}
                    onCheckedChange={(checked) => setRunOnWorktreeCreate(Boolean(checked))}
                  />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm text-foreground dark:border-transparent dark:bg-white/[0.035]">
                  <span>{ko.projects.scriptEditor.waitForSetup}</span>
                  <Switch
                    checked={waitForSetup}
                    disabled={!runOnWorktreeCreate}
                    onCheckedChange={(checked) => setWaitForSetup(Boolean(checked))}
                  />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm text-foreground dark:border-transparent dark:bg-white/[0.035]">
                  <span>{ko.projects.scriptEditor.autoOpenPreview}</span>
                  <Switch
                    checked={autoOpenPreview}
                    disabled={previewUrl.trim().length === 0}
                    onCheckedChange={(checked) => setAutoOpenPreview(Boolean(checked))}
                  />
                </label>
                {validationError && (
                  <p className="text-sm text-destructive-foreground">{validationError}</p>
                )}
              </fieldset>
            </form>
          </DialogPanel>
          <DialogFooter className="dark:border-transparent dark:bg-transparent">
            {isEditing && (
              <Button
                type="button"
                variant="destructive-outline"
                className="mr-auto min-h-8 border-destructive-foreground! px-3 active:scale-100!"
                disabled={isSaving}
                onClick={() => setDeleteConfirmOpen(true)}
              >
                {ko.common.delete}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              className="min-h-8 border-foreground/60! px-3 active:scale-100!"
              onClick={close}
            >
              {ko.common.cancel}
            </Button>
            <Button
              form={formId}
              type="submit"
              className="min-h-8 px-3 hover:bg-primary! active:scale-100! data-pressed:bg-primary! disabled:opacity-100"
              disabled={isSaving}
            >
              {isSaving
                ? ko.common.saving
                : isEditing
                  ? ko.projects.scriptEditor.saveChanges
                  : ko.projects.scriptEditor.saveAction}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{ko.projects.scriptEditor.deleteConfirmTitle(name)}</AlertDialogTitle>
            <AlertDialogDescription>
              {ko.projects.scriptEditor.deleteConfirmDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {ko.common.cancel}
            </AlertDialogClose>
            <Button
              variant="destructive"
              disabled={isSaving}
              onClick={() => {
                if (!request?.scriptId) return;
                setDeleteConfirmOpen(false);
                close();
                onDelete(request.scriptId);
              }}
            >
              {ko.projects.scriptEditor.deleteAction}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
