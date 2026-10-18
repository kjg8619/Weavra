import type { RuntimeMode } from "@t3tools/contracts";
import { type LucideIcon, LockIcon, LockOpenIcon, PenLineIcon, SparklesIcon } from "lucide-react";

export const runtimeModeConfig: Record<
  RuntimeMode,
  { label: string; description: string; icon: LucideIcon }
> = {
  "approval-required": {
    label: "승인 후 실행",
    description: "명령 실행과 파일 변경 전에 물어봐요.",
    icon: LockIcon,
  },
  "auto-accept-edits": {
    label: "편집 자동 승인",
    description: "편집은 자동 승인하고 다른 작업은 물어봐요.",
    icon: PenLineIcon,
  },
  auto: {
    label: "자동",
    description: "지원하는 공급자는 일상 작업을 자동 승인하고, 나머지는 계속 물어봐요.",
    icon: SparklesIcon,
  },
  "full-access": {
    label: "전체 접근",
    description: "묻지 않고 명령 실행과 편집을 허용해요.",
    icon: LockOpenIcon,
  },
};

export const runtimeModeOptions = Object.keys(runtimeModeConfig) as RuntimeMode[];
