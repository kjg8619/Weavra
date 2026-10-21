import type { DraftId } from "~/composerDraftStore";
import { useComposerDraftStore } from "~/composerDraftStore";
import { resolveEnvironmentMachineKind, type ScopedProjectRef } from "@t3tools/contracts";
import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import { FolderPlusIcon } from "lucide-react";
import { useCallback, useMemo } from "react";

import { openCommandPalette } from "~/commandPaletteBus";
import { ko } from "~/i18n/ko";
import { useClientSettings } from "~/hooks/useSettings";
import { hasExplicitComposerModelSelection } from "~/lib/chatThreadActions";
import { selectProjectGroupingSettings } from "~/logicalProject";
import {
  buildSidebarProjectPickerEntries,
  buildSidebarProjectSnapshots,
  projectGroupsSpanEnvironments,
} from "~/sidebarProjectGrouping";
import { useProjects, useThreadShells } from "~/state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { ProjectEnvironmentBadge } from "../ProjectEnvironmentBadge";
import { ProjectFavicon } from "../ProjectFavicon";
import { sortLogicalProjectsForSidebar } from "../Sidebar.logic";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";

/**
 * The project the draft targets, matched by its scoped (environment + project)
 * identity. Display names are not identities: two same-named projects on
 * different machines resolve to the group that holds the exact ref.
 */
export function findActiveProjectGroup<
  Group extends { readonly memberProjectRefs: ReadonlyArray<ScopedProjectRef> },
>(groups: ReadonlyArray<Group>, activeProjectRef: ScopedProjectRef | null): Group | null {
  if (activeProjectRef === null) return null;
  const activeKey = scopedProjectKey(activeProjectRef);
  return (
    groups.find((group) =>
      group.memberProjectRefs.some((projectRef) => scopedProjectKey(projectRef) === activeKey),
    ) ?? null
  );
}

function pathTail(workspaceRoot: string, segments: number): string {
  const parts = workspaceRoot.split(/[\\/]+/).filter((part) => part.length > 0);
  return parts.slice(-segments).join("/");
}

/**
 * Folder detail for groups whose display name another group shares, so two
 * same-named projects stay distinguishable in the menu and the headline. The
 * last two path segments are used; the full path only when those still collide.
 * Uniquely named groups get no detail.
 */
export function buildAmbiguousProjectDetails(
  groups: ReadonlyArray<{
    readonly projectKey: string;
    readonly displayName: string;
    readonly workspaceRoot: string;
  }>,
): Map<string, string> {
  const byName = new Map<string, typeof groups>();
  for (const group of groups) {
    byName.set(group.displayName, [...(byName.get(group.displayName) ?? []), group]);
  }
  const details = new Map<string, string>();
  for (const sameNamed of byName.values()) {
    if (sameNamed.length < 2) continue;
    const tails = sameNamed.map((group) => pathTail(group.workspaceRoot, 2));
    const tailsAreUnique = new Set(tails).size === tails.length;
    sameNamed.forEach((group, index) => {
      details.set(group.projectKey, tailsAreUnique ? tails[index]! : group.workspaceRoot);
    });
  }
  return details;
}

interface DraftHeroHeadlineProps {
  readonly draftId: DraftId | null;
  readonly activeProjectRef: ScopedProjectRef | null;
  readonly activeProjectTitle: string | null;
}

export function DraftHeroHeadline({
  draftId,
  activeProjectRef,
  activeProjectTitle,
}: DraftHeroHeadlineProps) {
  const projects = useProjects();
  const threads = useThreadShells();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const projectSortOrder = useClientSettings((settings) => settings.sidebarProjectSortOrder);
  const setLogicalProjectDraftThreadId = useComposerDraftStore(
    (store) => store.setLogicalProjectDraftThreadId,
  );
  const getComposerDraft = useComposerDraftStore((store) => store.getComposerDraft);
  const applyStickyState = useComposerDraftStore((store) => store.applyStickyState);
  const setModelSelection = useComposerDraftStore((store) => store.setModelSelection);
  const openAddProject = useCallback(() => openCommandPalette({ open: "add-project" }), []);

  const environmentLabelById = useMemo(
    () =>
      new Map(
        environments.map((environment) => [environment.environmentId, environment.label] as const),
      ),
    [environments],
  );
  const projectGroups = useMemo(
    () =>
      sortLogicalProjectsForSidebar(
        buildSidebarProjectSnapshots({
          projects,
          settings: projectGroupingSettings,
          primaryEnvironmentId,
          resolveEnvironmentLabel: (environmentId) =>
            environmentLabelById.get(environmentId) ?? null,
        }),
        threads,
        projectSortOrder,
      ),
    [
      environmentLabelById,
      primaryEnvironmentId,
      projectGroupingSettings,
      projectSortOrder,
      projects,
      threads,
    ],
  );
  // Same-named projects on two machines are only told apart by where they
  // live, so rows on another machine carry its icon once the catalog spans
  // more than one environment; a single-machine catalog stays as it was.
  const showProjectEnvironments = useMemo(
    () => projectGroupsSpanEnvironments(projectGroups),
    [projectGroups],
  );
  const environmentMachineById = useMemo(
    () =>
      new Map(
        environments.map(
          (environment) =>
            [
              environment.environmentId,
              resolveEnvironmentMachineKind(environment.serverConfig),
            ] as const,
        ),
      ),
    [environments],
  );
  const projectPickerEntries = useMemo(
    () =>
      buildSidebarProjectPickerEntries({
        groups: projectGroups,
        preferredProjectRef: activeProjectRef,
      }),
    [activeProjectRef, projectGroups],
  );
  const projectEntryByKey = useMemo(
    () => new Map(projectPickerEntries.map((entry) => [entry.group.projectKey, entry] as const)),
    [projectPickerEntries],
  );
  const projectDetailByKey = useMemo(
    () => buildAmbiguousProjectDetails(projectGroups),
    [projectGroups],
  );
  const activeProjectGroup = findActiveProjectGroup(projectGroups, activeProjectRef);
  const activeProjectKey = activeProjectGroup?.projectKey ?? "";
  const activeProjectDisplayName = activeProjectGroup?.displayName ?? activeProjectTitle;
  const activeProjectDetail = projectDetailByKey.get(activeProjectKey) ?? null;
  const hasResolvedProject = activeProjectTitle !== null;
  const canChooseProject = projectPickerEntries.length > 0;
  const shouldShowProjectMenu = canChooseProject;

  const projectSelector = shouldShowProjectMenu ? (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              aria-label={
                hasResolvedProject
                  ? ko.chat.draftHero.changeProject
                  : ko.chat.draftHero.chooseProject
              }
              className="pointer-events-auto inline-block max-w-64 truncate border-foreground/60 border-b border-dotted align-baseline text-foreground transition-colors hover:border-foreground/80 focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            />
          }
        >
          {activeProjectDisplayName ?? ko.chat.draftHero.chooseProject}
          {activeProjectDetail ? (
            <span className="ms-2 font-normal text-muted-foreground text-sm">
              {activeProjectDetail}
            </span>
          ) : null}
        </TooltipTrigger>
        {activeProjectDisplayName ? (
          <TooltipPopup side="top" className="max-w-80">
            {activeProjectDisplayName}
            {activeProjectDetail ? ` (${activeProjectDetail})` : ""}
          </TooltipPopup>
        ) : null}
      </Tooltip>
      <MenuPopup align="center" className="max-h-80 min-w-40! w-max max-w-64 overflow-y-auto">
        <MenuRadioGroup
          value={activeProjectKey}
          onValueChange={(value) => {
            const entry = projectEntryByKey.get(value as string);
            if (!entry || value === activeProjectKey) {
              return;
            }
            const project = entry.targetProject;
            if (!draftId) {
              return;
            }
            // Project selection changes the target of the open draft in
            // place. The prompt stays in the same composer session, so the
            // sidebar only gets a draft row if the user later navigates away.
            const currentDraft = getComposerDraft(draftId);
            setLogicalProjectDraftThreadId(
              entry.group.projectKey,
              scopeProjectRef(project.environmentId, project.id),
              draftId,
            );
            if (!hasExplicitComposerModelSelection(currentDraft)) {
              applyStickyState(draftId);
              const environmentSettings = environments.find(
                (environment) => environment.environmentId === project.environmentId,
              )?.serverConfig?.settings;
              const defaultModelSelection = environmentSettings
                ? resolveProjectSettings(environmentSettings, project.id, project).settings
                    .defaultModelSelection
                : project.defaultModelSelection;
              if (defaultModelSelection) {
                setModelSelection(draftId, defaultModelSelection, {
                  replaceOptions: true,
                });
              }
            }
          }}
        >
          {projectPickerEntries.map(({ group }) => {
            return (
              <MenuRadioItem
                key={group.projectKey}
                value={group.projectKey}
                closeOnClick
                className="data-checked:font-medium [&>span:last-child]:flex [&>span:last-child]:min-w-0 [&>span:last-child]:items-center [&>span:last-child]:gap-2"
              >
                <ProjectFavicon project={group} className="size-4 shrink-0" />
                <Tooltip>
                  <TooltipTrigger render={<span className="block min-w-0 truncate" />}>
                    {group.displayName}
                  </TooltipTrigger>
                  <TooltipPopup side="top" className="max-w-80">
                    {group.displayName}
                  </TooltipPopup>
                </Tooltip>
                {projectDetailByKey.has(group.projectKey) ? (
                  <span className="min-w-0 truncate font-normal text-muted-foreground text-sm">
                    {projectDetailByKey.get(group.projectKey)}
                  </span>
                ) : null}
                {showProjectEnvironments ? (
                  <ProjectEnvironmentBadge
                    group={group}
                    primaryEnvironmentId={primaryEnvironmentId}
                    machineByEnvironmentId={environmentMachineById}
                  />
                ) : null}
                {/* The current project carries a visible check, not only the selection wash. */}
                <MenuRadioItemIndicator className="ms-auto" />
              </MenuRadioItem>
            );
          })}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuItem onClick={openAddProject}>
          <FolderPlusIcon />
          {ko.chat.draftHero.newProject}
        </MenuItem>
      </MenuPopup>
    </Menu>
  ) : (
    <button
      type="button"
      onClick={openAddProject}
      className="pointer-events-auto inline cursor-pointer border-muted-foreground/35 border-b border-dotted text-muted-foreground/60 transition-colors hover:border-muted-foreground/60 hover:text-muted-foreground/80 focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
    >
      {activeProjectTitle ?? ko.projects.add}
    </button>
  );

  return (
    <h1 className="mx-auto w-full max-w-5xl text-center font-normal text-2xl text-foreground tracking-tight sm:text-3xl">
      {hasResolvedProject ? (
        <>
          {projectSelector}
          {ko.chat.draftHero.whatToBuildSuffix}
        </>
      ) : canChooseProject ? (
        <>
          {projectSelector}
          {ko.chat.draftHero.startHereSuffix}
        </>
      ) : (
        <>{ko.chat.draftHero.addProjectToStart}</>
      )}
    </h1>
  );
}
