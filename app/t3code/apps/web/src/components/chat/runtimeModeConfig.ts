import type { RuntimeMode } from "@t3tools/contracts";
import { type LucideIcon, LockIcon, LockOpenIcon, PenLineIcon, SparklesIcon } from "lucide-react";
import { ko } from "~/i18n/ko";

export const runtimeModeConfig: Record<
  RuntimeMode,
  { label: string; description: string; icon: LucideIcon }
> = {
  "approval-required": {
    label: ko.common.approvalRequired,
    description: ko.chat.runtimeMode.approvalRequiredDescription,
    icon: LockIcon,
  },
  "auto-accept-edits": {
    label: ko.chat.runtimeMode.autoAcceptEdits,
    description: ko.chat.runtimeMode.autoAcceptEditsDescription,
    icon: PenLineIcon,
  },
  auto: {
    label: ko.chat.runtimeMode.auto,
    description: ko.chat.runtimeMode.autoDescription,
    icon: SparklesIcon,
  },
  "full-access": {
    label: ko.common.fullAccess,
    description: ko.chat.runtimeMode.fullAccessDescription,
    icon: LockOpenIcon,
  },
};

export const runtimeModeOptions = Object.keys(runtimeModeConfig) as RuntimeMode[];
