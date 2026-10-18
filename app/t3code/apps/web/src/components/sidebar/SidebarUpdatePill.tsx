import { TriangleAlertIcon } from "lucide-react";
import { isElectron } from "../../env";
import { useDesktopUpdateState } from "../../state/desktopUpdate";
import {
  getArm64IntelBuildWarningDescription,
  shouldShowArm64IntelBuildWarning,
} from "../desktopUpdate.logic";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { SidebarMenuItem } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function SidebarUpdateArchitectureWarning() {
  return isElectron ? <SidebarUpdateArchitectureWarningContent /> : null;
}

function SidebarUpdateArchitectureWarningContent() {
  const state = useDesktopUpdateState();
  if (!state || !shouldShowArm64IntelBuildWarning(state)) return null;
  return (
    <Alert variant="warning" className="rounded-2xl border-warning/40 bg-warning/8 text-xs">
      <TriangleAlertIcon />
      <AlertTitle>Apple Silicon에서 Intel 빌드 실행 중</AlertTitle>
      <AlertDescription>{getArm64IntelBuildWarningDescription(state)}</AlertDescription>
    </Alert>
  );
}

export function SidebarUpdatePill() {
  return isElectron ? (
    <SidebarMenuItem>
      <Tooltip>
        <TooltipTrigger
          render={<span tabIndex={0} className="px-2 text-xs text-muted-foreground" />}
        >
          업데이트를 사용할 수 없음
        </TooltipTrigger>
        <TooltipPopup side="top">Weavra 업데이트 서비스가 설정되지 않았어요.</TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  ) : null;
}
