import { MenuGroupLabel } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function PullRequestStackHeader({
  number,
  notice,
  stale = false,
}: {
  number: number;
  notice?: string | null | undefined;
  stale?: boolean;
}) {
  return (
    <MenuGroupLabel className="flex items-center justify-between gap-2">
      <span>Stack #{number}</span>
      {notice ? (
        <Tooltip>
          <TooltipTrigger render={<span role="status" className="text-xs font-normal" />}>
            {stale ? "오래된 정보일 수 있어요" : "새로고침 중…"}
          </TooltipTrigger>
          <TooltipPopup>{notice}</TooltipPopup>
        </Tooltip>
      ) : null}
    </MenuGroupLabel>
  );
}
