import type { DevicePlatformAvailability } from "@t3tools/contracts";
import { Check, Minus } from "lucide-react";
import { ko } from "~/i18n/ko";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";

export function DeviceHostAvailability({
  platforms,
}: {
  platforms: ReadonlyArray<DevicePlatformAvailability>;
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {platforms.map((platform) => (
        <Tooltip key={platform.platform}>
          <TooltipTrigger render={<span tabIndex={0} className="inline-flex items-center gap-1" />}>
            {platform.available ? <Check className="size-3" /> : <Minus className="size-3" />}
            {(platform.available
              ? ko.devices.host.platformAvailable
              : ko.devices.host.platformUnavailable)(
              platform.platform === "ios" ? "iOS" : "Android",
            )}
          </TooltipTrigger>
          <TooltipPopup>
            {platform.reason ??
              ko.devices.host.platformAvailable(platform.platform === "ios" ? "iOS" : "Android")}
          </TooltipPopup>
        </Tooltip>
      ))}
    </div>
  );
}
