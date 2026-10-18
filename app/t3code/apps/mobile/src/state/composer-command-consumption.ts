import { isUsageLimitsCommand } from "@t3tools/shared/usageLimits";
import { getComposerDraftSnapshot } from "./use-composer-drafts";

/** Re-read the marker at activation, not when a menu or Send button rendered. */
export function consumeComposerUsageLimits(input: {
  readonly draftKey: string;
  readonly offered: boolean;
  readonly open: () => boolean;
  readonly changeText: (text: string) => void;
}): boolean {
  const draft = getComposerDraftSnapshot(input.draftKey);
  if (
    draft.rejectedTurn !== undefined ||
    !input.offered ||
    draft.attachments.length !== 0 ||
    !isUsageLimitsCommand(draft.text)
  )
    return false;
  if (input.open()) input.changeText("");
  return true;
}
