import { useAtomValue } from "@effect/atom-react";
import { pendingTaskDraftKey } from "./pending-task-identity";
import {
  EnvironmentId as EnvironmentIdSchema,
  ModelSelection as ModelSelectionSchema,
  ComposerContextId,
  ComposerContextRecord,
  COMPOSER_CONTEXT_MAX_RECORDS,
  ForwardCompatibleArray,
  OrchestrationMessageContext,
  OrchestrationMessage,
  ThreadId,
  WorkspaceTurnStartRefusalPayload,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  ProjectId as ProjectIdSchema,
  ProviderInteractionMode as ProviderInteractionModeSchema,
  RuntimeMode as RuntimeModeSchema,
  type EnvironmentId,
  type ModelSelection,
  type ProjectId,
  type ProviderInteractionMode,
  type RuntimeMode,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useEffect } from "react";
import { Atom } from "effect/unstable/reactivity";

import { prepareAtomicFileWriter } from "../lib/atomic-file";
import { scopedThreadKey } from "../lib/scopedEntities";
import { mergeRejectedComposerContext } from "../lib/rejectedComposerSend";
import { createComposerContextHistory, referencedComposerContext } from "../lib/composerContext";
import {
  collectComposerContextReferences,
  formatComposerContextReference,
  sanitizeComposerContextLabel,
  replaceComposerContextReferences,
} from "@t3tools/shared/composerContextReferences";
import { imageMimeType } from "@t3tools/shared/image";
import { videoMimeType } from "@t3tools/shared/video";
import { stableStringify } from "@t3tools/shared/relaySigning";
import { DraftComposerAttachmentSchema } from "../lib/composer-image-schema";
import {
  composerAttachmentFileReferenceKey,
  isComposerAttachmentFileRetained,
  retainComposerAttachmentFile,
} from "../lib/composerAttachmentFiles";
import type { DraftComposerAttachment, FileBackedComposerAttachment } from "../lib/composerImages";
import { SerializedAsyncQueue } from "../lib/serialized-async-queue";
import { appAtomRegistry } from "./atom-registry";
import {
  isNewTaskDraftKey,
  newTaskDraftKey,
  parseLegacyNewTaskDraftKey,
} from "./new-task-draft-key";
import {
  decodeQueuedThreadMessage,
  encodeQueuedThreadMessage,
  QueuedThreadMessageSchema,
  threadOutboxStorageIdentity,
  type QueuedThreadMessage,
} from "./thread-outbox-model";
import { flushThreadOutbox, threadOutboxManager } from "./thread-outbox";
import { optimisticThreadOutboxOwnersAtom } from "./thread-outbox-ownership";
import { ownedThreadOutboxPayloads } from "./thread-outbox-record";
import {
  expoThreadOutboxStorage,
  flushThreadOutboxWrites,
  threadOutboxWriteState,
} from "./thread-outbox-storage";
import { composerDraftEnvironmentId } from "../lib/composerAttachmentUploadQueue";

const COMPOSER_DRAFTS_SCHEMA_VERSION = 2;
const COMPOSER_DRAFTS_DIRECTORY = "composer-drafts";
const COMPOSER_DRAFTS_FILE = "drafts.json";
const PERSIST_DEBOUNCE_MS = 200;
let composerMutationEpoch = 0;

export const composerContextImportsAtom = Atom.make<Record<string, boolean>>({}).pipe(
  Atom.keepAlive,
);

export function setComposerContextImporting(draftKey: string, importing: boolean): void {
  const next = { ...appAtomRegistry.get(composerContextImportsAtom) };
  if (importing) next[draftKey] = true;
  else delete next[draftKey];
  composerMutationEpoch += 1;
  appAtomRegistry.set(composerContextImportsAtom, next);
}

let lastComposerSelection: { draftKey: string; text: string; start: number; end: number } | null =
  null;

/** Retain the last focused caret while a picker or review sheet is open. */
export function rememberComposerDraftSelection(
  draftKey: string,
  text: string,
  selection: { start: number; end: number },
): void {
  lastComposerSelection = { draftKey, text, ...selection };
}

/**
 * The caret an insert left behind, for the text it produced. Inserting a chip moves the caret
 * past it here; without reading this back the editor would restore the pre-insert offset and
 * leave the caret sitting before the chip the user just added.
 */
export function readComposerDraftSelection(
  draftKey: string,
  text: string,
): { start: number; end: number } | null {
  if (lastComposerSelection?.draftKey !== draftKey || lastComposerSelection.text !== text) {
    return null;
  }
  return { start: lastComposerSelection.start, end: lastComposerSelection.end };
}

export interface ComposerDraftInsertion {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/** Capture the paste target before any clipboard reads, downloads, or file writes. */
export function captureComposerDraftInsertion(
  draftKey: string,
  selection?: { start: number; end: number },
): ComposerDraftInsertion {
  const { text } = getComposerDraftSnapshot(draftKey);
  return {
    text,
    ...(selection ??
      readComposerDraftSelection(draftKey, text) ?? { start: text.length, end: text.length }),
  };
}

function contextInsertionRange(
  draftKey: string,
  draft: ComposerDraft,
  target?: ComposerDraftInsertion,
) {
  const captured =
    target ?? (lastComposerSelection?.draftKey === draftKey ? lastComposerSelection : null);
  // Edits made during a file write must not be replaced using stale offsets. A changed
  // draft receives the file at its end; moving only the caret preserves the captured range.
  const selection = captured?.text === draft.text ? captured : null;
  const start = Math.max(0, Math.min(selection?.start ?? draft.text.length, draft.text.length));
  return { start, end: Math.max(start, Math.min(selection?.end ?? start, draft.text.length)) };
}

function draftWithoutInsertionSelection(
  draftKey: string,
  draft: ComposerDraft,
  target?: ComposerDraftInsertion,
) {
  const { start, end } = contextInsertionRange(draftKey, draft, target);
  const text = `${draft.text.slice(0, start)} ${draft.text.slice(end)}`;
  return withReferencedContextFiles(draft, text, referencedComposerContext(text, draft.context));
}

export function countComposerDraftAttachmentsAfterSelection(
  draftKey: string,
  target: ComposerDraftInsertion,
): number {
  return getComposerDraftAfterSelection(draftKey, target).attachments.length;
}

export function getComposerDraftAfterSelection(
  draftKey: string,
  target: ComposerDraftInsertion,
): ComposerDraft {
  return draftWithoutInsertionSelection(draftKey, getComposerDraftSnapshot(draftKey), target);
}

function contextWithRejectedSource(
  draft: ComposerDraft,
  context: OrchestrationMessageContext | undefined,
): OrchestrationMessageContext | undefined {
  return draft.rejectedTurn === undefined
    ? context
    : mergeRejectedComposerContext(draft.rejectedTurn.message.context, context);
}

function withReferencedContextFiles(
  draft: ComposerDraft,
  text: string,
  context: OrchestrationMessageContext | undefined,
): ComposerDraft {
  const nextContext = contextWithRejectedSource(draft, context);
  const sourceIds = new Set(
    draft.rejectedTurn?.message.attachments?.map((attachment) => attachment.id),
  );
  const previousIds = new Set(
    draft.context?.records.flatMap((record) =>
      "attachmentId" in record ? [record.attachmentId] : [],
    ),
  );
  const retainedIds = new Set(
    nextContext?.records.flatMap((record) =>
      "attachmentId" in record ? [record.attachmentId] : [],
    ),
  );
  return {
    ...draft,
    text,
    context: nextContext,
    attachments: draft.attachments.filter(
      (attachment) =>
        sourceIds.has(attachment.id) ||
        attachment.type === "image" ||
        !previousIds.has(attachment.id) ||
        retainedIds.has(attachment.id),
    ),
  };
}

/** Retains file bytes while native text undo can restore their references. */
export function createComposerDraftContextHistory() {
  const restoreContext = createComposerContextHistory();
  const files = new Map<
    string,
    { attachment: FileBackedComposerAttachment; release: () => void }
  >();
  return {
    restore(text: string, draft: ComposerDraft) {
      for (const attachment of draft.attachments) {
        if (attachment.type !== "file") continue;
        const previous = files.get(attachment.id);
        files.delete(attachment.id);
        if (previous?.attachment.fileUri === attachment.fileUri) {
          previous.attachment = attachment;
          files.set(attachment.id, previous);
        } else {
          previous?.release();
          files.set(attachment.id, {
            attachment,
            release: retainComposerAttachmentFileForPreview(attachment),
          });
        }
      }
      const limit = Math.max(COMPOSER_CONTEXT_MAX_RECORDS, draft.attachments.length);
      while (files.size > limit) {
        const oldest = files.keys().next().value!;
        files.get(oldest)!.release();
        files.delete(oldest);
      }
      const context = restoreContext(text, draft.context);
      const liveIds = new Set(draft.attachments.map((attachment) => attachment.id));
      const attachments = (context?.records ?? []).flatMap((record) => {
        if (
          record.kind !== "file" ||
          !("attachmentId" in record) ||
          liveIds.has(record.attachmentId)
        )
          return [];
        const saved = files.get(record.attachmentId)?.attachment;
        liveIds.add(record.attachmentId);
        // Removing the file can release its old pending upload. Undo reuploads the retained bytes.
        return saved
          ? [{ ...saved, uploadedAttachmentId: undefined, uploadEnvironmentId: undefined }]
          : [];
      });
      return { context, attachments };
    },
    dispose() {
      for (const file of files.values()) file.release();
      files.clear();
    },
  };
}

export function setComposerDraftContext(
  draftKey: string,
  context: OrchestrationMessageContext | undefined,
): void {
  updateComposerDrafts((current) => {
    const draft = normalizeDraft(current[draftKey]);
    return {
      ...current,
      [draftKey]: { ...draft, context: contextWithRejectedSource(draft, context) },
    };
  });
}

export function insertComposerDraftContext(
  draftKey: string,
  content: {
    text: string;
    context: OrchestrationMessageContext;
    attachments?: ReadonlyArray<DraftComposerAttachment>;
  },
  target?: ComposerDraftInsertion,
): boolean {
  let inserted = false;
  let removed: ReadonlyArray<DraftComposerAttachment> = [];
  updateComposerDrafts((current) => {
    const draft = normalizeDraft(current[draftKey]);
    const attachments = content.attachments ?? [];
    const retained = draftWithoutInsertionSelection(draftKey, draft, target);
    if (
      attachments.length > 0 &&
      retained.attachments.length + attachments.length > PROVIDER_SEND_TURN_MAX_ATTACHMENTS
    )
      return current;
    const nextDraft = draftWithInsertedContext(
      draftKey,
      { ...draft, attachments: [...draft.attachments, ...attachments] },
      content,
      target,
    );
    if (!nextDraft) return current;
    inserted = true;
    removed = draft.attachments.filter((attachment) => !nextDraft.attachments.includes(attachment));
    return { ...current, [draftKey]: nextDraft };
  });
  scheduleUnusedComposerAttachmentCleanup(inserted ? removed : (content.attachments ?? []));
  return inserted;
}

function draftWithInsertedContext(
  draftKey: string,
  draft: ComposerDraft,
  content: { text: string; context: OrchestrationMessageContext },
  target?: ComposerDraftInsertion,
): ComposerDraft | null {
  const { start, end } = contextInsertionRange(draftKey, draft, target);
  const before = draft.text.slice(0, start);
  const after = draft.text.slice(end);
  const insertion = `${before.length > 0 && !/\s$/.test(before) && !/^\s/.test(content.text) ? " " : ""}${content.text}${!/\s$/.test(content.text) && (after.length === 0 || !/^\s/.test(after)) ? " " : ""}`;
  const text = before + insertion + after;
  const records = new Map(draft.context?.records.map((record) => [record.contextId, record]));
  for (const record of content.context.records) records.set(record.contextId, record);
  const context = contextWithRejectedSource(
    draft,
    referencedComposerContext(text, { version: 1, records: [...records.values()] }),
  );
  if ((context?.records.length ?? 0) > COMPOSER_CONTEXT_MAX_RECORDS) return null;
  lastComposerSelection = {
    draftKey,
    text,
    start: start + insertion.length,
    end: start + insertion.length,
  };
  return withReferencedContextFiles(draft, text, context);
}

export class ComposerDraftPersistenceError extends Schema.TaggedError<ComposerDraftPersistenceError>()(
  "ComposerDraftPersistenceError",
  {
    operation: Schema.Literals(["open", "read", "decode", "encode", "write", "hydrate"]),
    directory: Schema.String,
    fileName: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Composer draft persistence operation ${this.operation} failed for ${this.directory}/${this.fileName}.`;
  }
}

const RejectedComposerDraftSourceSchema = Schema.Struct({
  version: Schema.Literal(1),
  environmentId: EnvironmentIdSchema,
  threadId: ThreadId,
  message: OrchestrationMessage,
  refusal: WorkspaceTurnStartRefusalPayload,
}).check(
  Schema.makeFilter(
    (source) => source.message.role === "user" && source.message.id === source.refusal.requestId,
  ),
);

export type RejectedComposerDraftSource = typeof RejectedComposerDraftSourceSchema.Type;

export interface ComposerDraft {
  readonly text: string;
  readonly context?: OrchestrationMessageContext;
  readonly attachments: ReadonlyArray<DraftComposerAttachment>;
  readonly importedShareIds?: ReadonlyArray<string>;
  readonly modelSelection?: ModelSelection;
  readonly runtimeMode?: RuntimeMode;
  readonly interactionMode?: ProviderInteractionMode;
  readonly workspaceSelection?: ComposerDraftWorkspaceSelection;
  /**
   * Set on new-task drafts only. The project is stored here rather than in
   * the key so a project can hold any number of drafts and a draft can be
   * retargeted to another project without changing identity.
   */
  readonly project?: ComposerDraftProject;
  /** Immutable provenance, never permission to upload or replay. */
  readonly rejectedTurn?: RejectedComposerDraftSource;
}

export interface ComposerDraftProject {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly createdAt: string;
}

export interface ComposerDraftContent {
  readonly text: string;
  readonly context?: OrchestrationMessageContext;
  readonly attachments: ReadonlyArray<DraftComposerAttachment>;
  readonly sourceShareId?: string;
}

export interface ComposerDraftWorkspaceSelection {
  readonly mode: "local" | "worktree";
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly startFromOrigin?: boolean;
}

export type ComposerDraftSettingsUpdate = Pick<
  ComposerDraft,
  "modelSelection" | "runtimeMode" | "interactionMode" | "workspaceSelection" | "project"
>;

const ComposerDraftWorkspaceSelectionSchema = Schema.Struct({
  mode: Schema.Literals(["local", "worktree"]),
  branch: Schema.NullOr(Schema.String),
  worktreePath: Schema.NullOr(Schema.String),
  startFromOrigin: Schema.optional(Schema.Boolean),
});

const ComposerDraftProjectSchema = Schema.Struct({
  environmentId: EnvironmentIdSchema,
  projectId: ProjectIdSchema,
  createdAt: Schema.String,
});

// Recovery can merge two individually valid drafts beyond the send limit, just like
// attachments. Keep every payload reloadable; send guards ask the user to trim the draft.
const PersistedComposerContextSchema = Schema.Struct({
  version: Schema.Literal(1),
  records: ForwardCompatibleArray(ComposerContextRecord),
});

const ComposerDraftSchema = Schema.Struct({
  // Version1 never granted recovery provenance.
  rejectedTurn: Schema.optional(Schema.Never),
  text: Schema.String,
  context: Schema.optional(PersistedComposerContextSchema),
  attachments: Schema.Array(DraftComposerAttachmentSchema),
  importedShareIds: Schema.optional(Schema.Array(Schema.String)),
  modelSelection: Schema.optional(ModelSelectionSchema),
  runtimeMode: Schema.optional(RuntimeModeSchema),
  interactionMode: Schema.optional(ProviderInteractionModeSchema),
  workspaceSelection: Schema.optional(ComposerDraftWorkspaceSelectionSchema),
  project: Schema.optional(ComposerDraftProjectSchema),
});

const RecoveryComposerDraftSchema = Schema.Struct({
  ...ComposerDraftSchema.fields,
  rejectedTurn: Schema.optional(RejectedComposerDraftSourceSchema),
});

const PersistedComposerDraftsSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  drafts: Schema.Record(Schema.String, ComposerDraftSchema),
  stickyModelSelection: Schema.optional(ModelSelectionSchema),
  cloudAccountId: Schema.optional(Schema.String),
  signedOutDrafts: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        drafts: Schema.Record(Schema.String, ComposerDraftSchema),
        queuedMessages: Schema.Array(QueuedThreadMessageSchema),
      }),
    ),
  ),
});

const decodeLegacyComposerDraftsDocument = Schema.decodeUnknownSync(PersistedComposerDraftsSchema);
const decodeCurrentComposerDraftsDocument = Schema.decodeUnknownSync(
  Schema.toType(
    Schema.Struct({
      ...PersistedComposerDraftsSchema.fields,
      schemaVersion: Schema.Literal(COMPOSER_DRAFTS_SCHEMA_VERSION),
      drafts: Schema.Record(Schema.String, RecoveryComposerDraftSchema),
      signedOutDrafts: Schema.optional(
        Schema.Record(
          Schema.String,
          Schema.Struct({
            drafts: Schema.Record(Schema.String, RecoveryComposerDraftSchema),
            queuedMessages: Schema.Array(QueuedThreadMessageSchema),
          }),
        ),
      ),
    }).check(
      Schema.makeFilter((document) =>
        [
          document.drafts,
          ...Object.values(document.signedOutDrafts ?? {}).map((saved) => saved.drafts),
        ].every((drafts) =>
          Object.entries(drafts).every(
            ([key, draft]) =>
              draft.rejectedTurn === undefined ||
              (draft.project === undefined &&
                key === `${draft.rejectedTurn.environmentId}:${draft.rejectedTurn.threadId}`),
          ),
        ),
      ),
    ),
  ),
  { onExcessProperty: "error" },
);

function decodePersistedComposerDraftsDocument(value: unknown) {
  return typeof value === "object" &&
    value !== null &&
    "schemaVersion" in value &&
    value.schemaVersion === 1
    ? decodeLegacyComposerDraftsDocument(value)
    : decodeCurrentComposerDraftsDocument(value);
}

const EMPTY_DRAFT: ComposerDraft = {
  text: "",
  attachments: [],
};

export const composerDraftsAtom = Atom.make<Record<string, ComposerDraft>>({}).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:composer-drafts"),
);

export const stickyComposerModelSelectionAtom = Atom.make<ModelSelection | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:sticky-composer-model-selection"),
);

interface SignedOutDrafts {
  readonly drafts: Record<string, ComposerDraft>;
  readonly queuedMessages: ReadonlyArray<QueuedThreadMessage>;
}

interface ComposerCloudDraftState {
  readonly accountId: string | null;
  readonly signedOut: Record<string, SignedOutDrafts>;
}

export const composerCloudDraftsAtom = Atom.make<ComposerCloudDraftState>({
  accountId: null,
  signedOut: {},
}).pipe(Atom.keepAlive);

let loadPromise: Promise<void> | null = null;
let draftsHydrated = false;
const draftsChangedBeforeHydration = new Set<string>();
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistRetryNeeded = false;
const persistenceQueue = new SerializedAsyncQueue();

function publishComposerDrafts(next: Record<string, ComposerDraft>): void {
  composerMutationEpoch += 1;
  appAtomRegistry.set(composerDraftsAtom, next);
}

function publishComposerCloudDrafts(next: ComposerCloudDraftState): void {
  composerMutationEpoch += 1;
  appAtomRegistry.set(composerCloudDraftsAtom, next);
}

export interface ComposerRecoveryTarget {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly draftKey: string;
  readonly epoch: number;
}

/** Capture before asset acquisition; existing marked drafts are resolved at commit. */
export function captureComposerRecoveryTarget(scope: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}): ComposerRecoveryTarget | null {
  const draftKey = scopedThreadKey(scope.environmentId, scope.threadId);
  const draft = getComposerDraftSnapshot(draftKey);
  if (
    !draftsHydrated ||
    appAtomRegistry.get(composerContextImportsAtom)[draftKey] ||
    draft.project !== undefined ||
    (!isEmptyDraft(draft) && draft.rejectedTurn === undefined)
  )
    return null;
  return {
    environmentId: scope.environmentId,
    threadId: scope.threadId,
    draftKey,
    epoch: composerMutationEpoch,
  };
}

export function isComposerRecoveryTargetCurrent(target: ComposerRecoveryTarget): boolean {
  const current = captureComposerRecoveryTarget(target);
  return current !== null && current.draftKey === target.draftKey && current.epoch === target.epoch;
}

/** Resets module-level state between test runs. */
export function resetComposerDraftsLoadState(): void {
  composerMutationEpoch += 1;
  loadPromise = null;
  draftsHydrated = false;
  draftsChangedBeforeHydration.clear();
  persistRetryNeeded = false;
}

function attachmentContextRecord(
  attachment: DraftComposerAttachment,
  contextId = ComposerContextId.make(attachment.id),
) {
  const common = {
    version: 1 as const,
    contextId,
    label: sanitizeComposerContextLabel(attachment.name, attachment.type),
    attachmentId: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
  };
  // A picture picked through the document picker is typed as a plain file, but the
  // record has to say what it is or no client will offer to open it as an image.
  return attachment.type === "image" || imageMimeType(attachment) !== null
    ? { ...common, kind: "image" as const }
    : { ...common, kind: "file" as const };
}

/** Older drafts stored documents only in the attachment strip. Restore their missing chips. */
function restoreMissingComposerFileReferences(draft: ComposerDraft): ComposerDraft {
  const records = [...(draft.context?.records ?? [])];
  const usedIds = new Set<string>(records.map((record) => record.contextId));
  const referenced = new Set(
    collectComposerContextReferences(draft.text).map(
      (reference) => `${reference.kind}:${reference.contextId}`,
    ),
  );
  let text = draft.text;
  let changed = false;
  for (const attachment of draft.attachments) {
    if (
      attachment.type === "image" ||
      imageMimeType(attachment) !== null ||
      videoMimeType(attachment) !== null
    )
      continue;
    let record = records.find(
      (candidate) =>
        candidate.kind === "file" &&
        "attachmentId" in candidate &&
        candidate.attachmentId === attachment.id,
    );
    if (!record) {
      const baseId = attachment.id.replace(/[^a-z0-9_-]/gi, "_").slice(0, 110) || "file";
      let contextId = baseId;
      for (let suffix = 2; usedIds.has(contextId); suffix += 1) contextId = `${baseId}_${suffix}`;
      usedIds.add(contextId);
      record = attachmentContextRecord(attachment, ComposerContextId.make(contextId));
      records.push(record);
      changed = true;
    }
    const key = `${record.kind}:${record.contextId}`;
    if (referenced.has(key)) continue;
    text += `${text.length > 0 && !/\s$/.test(text) ? " " : ""}${formatComposerContextReference(record)} `;
    referenced.add(key);
    changed = true;
  }
  return changed ? { ...draft, text, context: { version: 1, records } } : draft;
}

function normalizeDraft(draft: ComposerDraft | undefined): ComposerDraft {
  if (!draft) {
    return EMPTY_DRAFT;
  }
  return {
    ...draft,
    text: draft.text,
    attachments: draft.attachments,
  };
}

export function getComposerDraftSnapshot(draftKey: string): ComposerDraft {
  return normalizeDraft(appAtomRegistry.get(composerDraftsAtom)[draftKey]);
}

export function isComposerDraftEmpty(draft: ComposerDraft): boolean {
  return isEmptyDraft(draft);
}

// The project stamp is identity, not content: a new-task draft with nothing
// else in it is still empty and gets dropped like any other.
function isEmptyDraft(draft: ComposerDraft): boolean {
  return (
    draft.rejectedTurn === undefined &&
    draft.text.length === 0 &&
    draft.attachments.length === 0 &&
    (draft.context?.records.length ?? 0) === 0 &&
    (draft.importedShareIds?.length ?? 0) === 0 &&
    draft.modelSelection === undefined &&
    draft.runtimeMode === undefined &&
    draft.interactionMode === undefined &&
    draft.workspaceSelection === undefined
  );
}

/**
 * Writes a draft back, dropping it once empty. A new-task draft keeps its
 * entry while the composer is bound to it (the project stamp is what the
 * composer binds to); the persist sweep still leaves empty ones off disk.
 */
function withComposerDraft(
  current: Record<string, ComposerDraft>,
  draftKey: string,
  draft: ComposerDraft,
): Record<string, ComposerDraft> {
  if (isEmptyDraft(draft) && draft.project === undefined) {
    const next = { ...current };
    delete next[draftKey];
    return next;
  }
  return { ...current, [draftKey]: draft };
}

export { isNewTaskDraftKey, newTaskDraftKey } from "./new-task-draft-key";

// Draft ids only need to be unique within this device's draft file. Deriving
// them from time plus randomness keeps this module free of native imports,
// which the persistence tests rely on.
function newDraftId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Project-keyed new-task drafts from earlier builds are rewritten on load into
 * id-keyed drafts with the project stamped in, so existing drafts survive the
 * switch to many-per-project.
 */
export function migrateLegacyNewTaskDraft(
  key: string,
  draft: ComposerDraft,
  now: string,
): readonly [key: string, draft: ComposerDraft] {
  const restored = restoreMissingComposerFileReferences(draft);
  const legacy = draft.project === undefined ? parseLegacyNewTaskDraftKey(key) : null;
  if (legacy === null) {
    return [key, restored];
  }
  return [
    newTaskDraftKey(newDraftId()),
    {
      ...restored,
      project: {
        environmentId: EnvironmentIdSchema.make(legacy.environmentId),
        projectId: ProjectIdSchema.make(legacy.projectId),
        createdAt: now,
      },
    },
  ];
}

export function decodePersistedComposerState(value: unknown): {
  readonly drafts: Record<string, ComposerDraft>;
  readonly stickyModelSelection: ModelSelection | null;
  readonly cloudDrafts: ComposerCloudDraftState;
} {
  const parsed = decodePersistedComposerDraftsDocument(value);
  const now = new Date().toISOString();
  return {
    drafts: Object.fromEntries(
      Object.entries(parsed.drafts)
        .map(([key, draft]) =>
          parsed.schemaVersion === 2
            ? ([key, draft] as const)
            : migrateLegacyNewTaskDraft(
                key,
                // Stale new-task drafts left on disk by builds before the
                // model-precedence fix carry a bare modelSelection with no
                // other selector settings. Strip it so the next compose pass
                // re-resolves project → sticky → provider defaults. Drafts
                // with runtime/interaction/workspace settings or actual text /
                // attachments were deliberately configured and are left alone.
                isNewTaskDraftKey(key) &&
                  draft.modelSelection &&
                  draft.text.length === 0 &&
                  draft.attachments.length === 0 &&
                  (draft.context?.records.length ?? 0) === 0 &&
                  draft.runtimeMode === undefined &&
                  draft.interactionMode === undefined &&
                  draft.workspaceSelection === undefined
                  ? { ...draft, modelSelection: undefined }
                  : draft,
                now,
              ),
        )
        // importedShareIds are share-import receipts: a contentless draft
        // carrying one is not empty, or the same native share would be
        // re-imported after restart.
        .filter(([, draft]) => !isEmptyDraft(draft) || (draft.importedShareIds?.length ?? 0) > 0),
    ),
    stickyModelSelection: parsed.stickyModelSelection ?? null,
    cloudDrafts: {
      accountId: parsed.cloudAccountId ?? null,
      signedOut: Object.fromEntries(
        Object.entries(parsed.signedOutDrafts ?? {}).map(([id, saved]) => [
          id,
          {
            // Archived drafts come back through restoreCloudComposerDrafts
            // without another decode, so they get the same key migration.
            drafts: Object.fromEntries(
              Object.entries(saved.drafts).map(([key, draft]) =>
                parsed.schemaVersion === 2
                  ? ([key, draft] as const)
                  : migrateLegacyNewTaskDraft(key, draft, now),
              ),
            ),
            queuedMessages: saved.queuedMessages.map(decodeQueuedThreadMessage),
          },
        ]),
      ),
    },
  };
}

async function getComposerDraftsFile() {
  const { Directory, File, Paths } = await import("expo-file-system");
  const directory = new Directory(Paths.document, COMPOSER_DRAFTS_DIRECTORY);
  directory.create({ idempotent: true, intermediates: true });
  return new File(directory, COMPOSER_DRAFTS_FILE);
}

async function loadPersistedComposerState(): Promise<
  ReturnType<typeof decodePersistedComposerState>
> {
  let operation: ComposerDraftPersistenceError["operation"] = "open";
  try {
    const file = await getComposerDraftsFile();
    if (!file.exists) {
      return {
        drafts: {},
        stickyModelSelection: null,
        cloudDrafts: { accountId: null, signedOut: {} },
      };
    }
    operation = "read";
    const raw = await file.text();
    operation = "decode";
    return decodePersistedComposerState(JSON.parse(raw) as unknown);
  } catch (cause) {
    throw new ComposerDraftPersistenceError({
      operation,
      directory: COMPOSER_DRAFTS_DIRECTORY,
      fileName: COMPOSER_DRAFTS_FILE,
      cause,
    });
  }
}

function encodePersistedComposerState(drafts: Record<string, ComposerDraft>): string {
  const stickyModelSelection = appAtomRegistry.get(stickyComposerModelSelectionAtom);
  const cloudDrafts = appAtomRegistry.get(composerCloudDraftsAtom);
  return JSON.stringify({
    schemaVersion: COMPOSER_DRAFTS_SCHEMA_VERSION,
    drafts: Object.fromEntries(Object.entries(drafts).filter(([, draft]) => !isEmptyDraft(draft))),
    ...(stickyModelSelection ? { stickyModelSelection } : {}),
    ...(cloudDrafts.accountId ? { cloudAccountId: cloudDrafts.accountId } : {}),
    ...(Object.keys(cloudDrafts.signedOut).length > 0
      ? {
          signedOutDrafts: Object.fromEntries(
            Object.entries(cloudDrafts.signedOut).map(([id, saved]) => [
              id,
              {
                drafts: saved.drafts,
                queuedMessages: saved.queuedMessages.map(encodeQueuedThreadMessage),
              },
            ]),
          ),
        }
      : {}),
  });
}

async function writePersistedComposerState(): Promise<void> {
  let operation: ComposerDraftPersistenceError["operation"] = "open";
  try {
    const file = await getComposerDraftsFile();
    const write = await prepareAtomicFileWriter(file);
    // Capture after all asynchronous preparation. An older queued snapshot must
    // never overwrite edits, deletions or a recovery committed while it waited.
    const drafts = appAtomRegistry.get(composerDraftsAtom);
    operation = "encode";
    const encoded = encodePersistedComposerState(drafts);
    operation = "write";
    write(encoded);
  } catch (cause) {
    throw new ComposerDraftPersistenceError({
      operation,
      directory: COMPOSER_DRAFTS_DIRECTORY,
      fileName: COMPOSER_DRAFTS_FILE,
      cause,
    });
  }
}

export class ComposerDraftRecoveryError extends Schema.TaggedError<ComposerDraftRecoveryError>()(
  "ComposerDraftRecoveryError",
  { reason: Schema.Literals(["source-scope", "attachments"]) },
) {}

const decodeRecoveryDraft = Schema.decodeUnknownSync(Schema.toType(RecoveryComposerDraftSchema), {
  onExcessProperty: "error",
});

/** The caller authenticates source and owns downloaded files; this grants no delivery authority. */
export async function commitRejectedComposerDraft(input: {
  readonly target: ComposerRecoveryTarget;
  readonly source: RejectedComposerDraftSource;
  readonly attachments: ReadonlyArray<DraftComposerAttachment>;
  readonly isCurrent: () => boolean;
}): Promise<"recovered" | "existing" | "changed"> {
  const target = { ...input.target };
  // Detach source and editable content before the first await.
  const recovered = decodeRecoveryDraft(
    JSON.parse(
      JSON.stringify({
        text: input.source.message.text,
        context: input.source.message.context,
        attachments: input.attachments,
        rejectedTurn: input.source,
      }),
    ),
  );
  const source = recovered.rejectedTurn;
  if (
    source === undefined ||
    source.environmentId !== target.environmentId ||
    source.threadId !== target.threadId ||
    target.draftKey !== scopedThreadKey(target.environmentId, target.threadId)
  )
    throw new ComposerDraftRecoveryError({ reason: "source-scope" });
  const originals = source.message.attachments ?? [];
  if (
    originals.length !== recovered.attachments.length ||
    new Set(originals.map((attachment) => attachment.id)).size !== originals.length ||
    !recovered.attachments.every((attachment, index) => {
      const original = originals[index];
      return (
        original !== undefined &&
        attachment.type === original.type &&
        attachment.id === original.id &&
        attachment.name === original.name &&
        attachment.mimeType === original.mimeType &&
        attachment.sizeBytes === original.sizeBytes &&
        stableStringify({ source: attachment.source }) ===
          stableStringify({ source: "source" in original ? original.source : undefined }) &&
        attachment.fileUri !== undefined &&
        attachment.uploadedAttachmentId === undefined &&
        attachment.uploadEnvironmentId === undefined
      );
    })
  )
    throw new ComposerDraftRecoveryError({ reason: "attachments" });

  return persistenceQueue.run(async () => {
    await waitForComposerDraftsLoaded();
    let operation: ComposerDraftPersistenceError["operation"] = "open";
    try {
      const write = await prepareAtomicFileWriter(await getComposerDraftsFile());
      if (!input.isCurrent() || appAtomRegistry.get(composerContextImportsAtom)[target.draftKey]) {
        return "changed";
      }
      const current = appAtomRegistry.get(composerDraftsAtom);
      const existing = current[target.draftKey];
      if (existing?.project !== undefined) return "changed";
      if (existing?.rejectedTurn !== undefined) {
        return stableStringify(existing.rejectedTurn) === stableStringify(source)
          ? "existing"
          : "changed";
      }
      if (!isComposerRecoveryTargetCurrent(target)) return "changed";
      const next = { ...current, [target.draftKey]: recovered };
      operation = "encode";
      const encoded = encodePersistedComposerState(next);
      decodeCurrentComposerDraftsDocument(JSON.parse(encoded));
      operation = "write";
      const result = write(
        encoded,
        () => input.isCurrent() && isComposerRecoveryTargetCurrent(target),
      );
      if (result === "cancelled") return "changed";
      // No await may separate the successful rename from publication.
      publishComposerDrafts(next);
      return "recovered";
    } catch (cause) {
      throw new ComposerDraftPersistenceError({
        operation,
        directory: COMPOSER_DRAFTS_DIRECTORY,
        fileName: COMPOSER_DRAFTS_FILE,
        cause,
      });
    }
  });
}

/** End an explicitly submitted/discarded recovery, never an ordinary edit-clear. */
export async function completeRejectedComposerSend(input: {
  readonly target: ComposerRecoveryTarget;
  readonly expected: ComposerDraft;
  readonly ownerCurrent: () => boolean;
}): Promise<"cleared" | "changed"> {
  const target = { ...input.target };
  const expected = { ...input.expected };
  const { ownerCurrent } = input;
  if (expected.rejectedTurn === undefined) return "changed";
  return persistenceQueue.run(async () => {
    await waitForComposerDraftsLoaded();
    let operation: ComposerDraftPersistenceError["operation"] = "open";
    try {
      const write = await prepareAtomicFileWriter(await getComposerDraftsFile());
      const canClear = () =>
        ownerCurrent() &&
        isComposerRecoveryTargetCurrent(target) &&
        sameComposerDraftState(expected, getComposerDraftSnapshot(target.draftKey));
      if (!canClear()) return "changed";
      const current = appAtomRegistry.get(composerDraftsAtom);
      const { rejectedTurn: _source, ...unmarked } = expected;
      const next = clearComposerDraftContentState(
        { ...current, [target.draftKey]: unmarked },
        target.draftKey,
      );
      operation = "encode";
      const encoded = encodePersistedComposerState(next);
      decodeCurrentComposerDraftsDocument(JSON.parse(encoded));
      operation = "write";
      if (write(encoded, canClear) === "cancelled") return "changed";
      publishComposerDrafts(next);
      scheduleUnusedComposerAttachmentCleanup(expected.attachments);
      return "cleared";
    } catch (cause) {
      throw new ComposerDraftPersistenceError({
        operation,
        directory: COMPOSER_DRAFTS_DIRECTORY,
        fileName: COMPOSER_DRAFTS_FILE,
        cause,
      });
    }
  });
}

/**
 * Lands any debounced or in-flight draft write before the JS runtime is torn
 * down (app update restart), so the freshest draft state survives it. A write
 * failure propagates so the caller can decide whether the restart may proceed.
 */
export async function flushComposerDrafts(): Promise<void> {
  // Never land a pre-hydration snapshot: persisted state must merge into the
  // atoms first, or this write would clobber disk with partial data.
  ensureComposerDraftsLoaded();
  if (loadPromise !== null) {
    await loadPromise;
  }
  // An edit during an awaited write schedules another debounced write, so
  // keep landing snapshots until no debounce is pending after a queue drain.
  do {
    while (persistTimer !== null || persistRetryNeeded) {
      if (persistTimer !== null) clearTimeout(persistTimer);
      persistTimer = null;
      persistRetryNeeded = false;
      try {
        await persistenceQueue.run(writePersistedComposerState);
      } catch (error) {
        persistRetryNeeded = true;
        throw error;
      }
    }
    // Draining also waits for an already-fired debounce whose write is still
    // gated behind its own hydration await inside the queue.
    await persistenceQueue.run(() => Promise.resolve());
  } while (persistTimer !== null || persistRetryNeeded);
}

/** Transfer a failed marked submission's ownership, without merging its old text back. */
export async function releaseRejectedComposerAdmission(input: {
  readonly draftKey: string;
  readonly source: RejectedComposerDraftSource;
  readonly content: Pick<ComposerDraft, "context" | "attachments">;
  readonly ownerCurrent: () => boolean;
  readonly releaseAfterHandback: () => boolean;
}): Promise<"released" | "retained"> {
  const { draftKey, ownerCurrent, releaseAfterHandback } = input;
  if (draftKey !== scopedThreadKey(input.source.environmentId, input.source.threadId)) {
    return "retained";
  }
  const source = stableStringify(input.source);
  const attachments = input.content.attachments.map((attachment) => stableStringify(attachment));
  const records = (input.content.context?.records ?? []).map((record) => stableStringify(record));
  try {
    await flushComposerDrafts();
    return await persistenceQueue.run(async () => {
      const epoch = composerMutationEpoch;
      const current = getComposerDraftSnapshot(draftKey);
      if (!ownerCurrent() || stableStringify(current.rejectedTurn) !== source) return "retained";
      const persisted = (await loadPersistedComposerState()).drafts[draftKey];
      if (
        !ownerCurrent() ||
        epoch !== composerMutationEpoch ||
        persisted === undefined ||
        stableStringify(persisted) !== stableStringify(current)
      )
        return "retained";
      const ownedAttachments = new Set(
        persisted.attachments.map((attachment) => stableStringify(attachment)),
      );
      const ownedRecords = new Set(
        [
          ...(persisted.rejectedTurn?.message.context?.records ?? []),
          ...(persisted.context?.records ?? []),
        ].map((record) => stableStringify(record)),
      );
      if (
        !attachments.every((attachment) => ownedAttachments.has(attachment)) ||
        !records.every((record) => ownedRecords.has(record))
      )
        return "retained";
      // No await between the durable/live ownership proof and this exact admission's release.
      return releaseAfterHandback() ? "released" : "retained";
    });
  } catch (error) {
    if (error instanceof ComposerDraftPersistenceError) return "retained";
    throw error;
  }
}

/** Read through the writer queue without restoring stale disk content into live drafts. */
export async function persistedComposerAttachmentOwnership(
  attachments: ReadonlyArray<DraftComposerAttachment>,
): Promise<"referenced" | "unreferenced" | "unknown"> {
  const keys = new Set(
    attachments.flatMap((attachment) =>
      attachment.fileUri === undefined
        ? []
        : [composerAttachmentFileReferenceKey(attachment.fileUri)],
    ),
  );
  if (keys.size === 0) return "unreferenced";
  return persistenceQueue.run(async () => {
    try {
      const persisted = await loadPersistedComposerState();
      const owners = [
        ...Object.values(persisted.drafts),
        ...Object.values(persisted.cloudDrafts.signedOut).flatMap((saved) => [
          ...Object.values(saved.drafts),
          ...saved.queuedMessages,
        ]),
      ];
      return owners.some((owner) =>
        owner.attachments.some(
          (attachment) =>
            attachment.fileUri !== undefined &&
            keys.has(composerAttachmentFileReferenceKey(attachment.fileUri)),
        ),
      )
        ? "referenced"
        : "unreferenced";
    } catch (error) {
      if (error instanceof ComposerDraftPersistenceError) return "unknown";
      throw error;
    }
  });
}

function signedOutAttachmentOwners() {
  return Object.values(appAtomRegistry.get(composerCloudDraftsAtom).signedOut).flatMap((saved) => [
    ...Object.values(saved.drafts),
    ...saved.queuedMessages,
  ]);
}

/** Clipboard fragments can refer to a local file that has not finished uploading yet. */
export function findLocalComposerClipboardAttachment(
  environmentId: EnvironmentId,
  id: string,
): DraftComposerAttachment | undefined {
  const queuedMessages = Object.values(
    appAtomRegistry.get(threadOutboxManager.queuedMessagesByThreadKeyAtom),
  ).flat();
  for (const [key, draft] of Object.entries(appAtomRegistry.get(composerDraftsAtom))) {
    if (composerDraftEnvironmentId(key, queuedMessages, draft) !== environmentId) continue;
    const attachment = draft.attachments.find((entry) => entry.id === id);
    if (attachment) return attachment;
  }
  return queuedMessages
    .filter((message) => message.environmentId === environmentId)
    .flatMap((message) => message.attachments)
    .find((attachment) => attachment.id === id);
}

function isComposerAttachmentFileReferenced(
  fileUri: string,
  recordOwners: ReadonlyArray<Pick<ComposerDraft, "attachments">>,
): boolean {
  if (isComposerAttachmentFileRetained(fileUri)) {
    return true;
  }
  const referenceKey = composerAttachmentFileReferenceKey(fileUri);
  const drafts = Object.values(appAtomRegistry.get(composerDraftsAtom));
  const queuedMessages = Object.values(
    appAtomRegistry.get(threadOutboxManager.queuedMessagesByThreadKeyAtom),
  ).flat();
  const optimistic = appAtomRegistry.get(optimisticThreadOutboxOwnersAtom);
  return [
    ...drafts,
    ...queuedMessages,
    ...recordOwners,
    ...optimistic,
    ...signedOutAttachmentOwners(),
  ].some((owner) =>
    owner.attachments.some(
      (attachment) =>
        attachment.fileUri !== undefined &&
        composerAttachmentFileReferenceKey(attachment.fileUri) === referenceKey,
    ),
  );
}

function isComposerAttachmentUploadReferenced(
  environmentId: EnvironmentId,
  attachmentId: string,
  recordOwners: ReadonlyArray<Pick<ComposerDraft, "attachments">>,
): boolean {
  const drafts = Object.values(appAtomRegistry.get(composerDraftsAtom));
  const queuedMessages = Object.values(
    appAtomRegistry.get(threadOutboxManager.queuedMessagesByThreadKeyAtom),
  ).flat();
  const optimistic = appAtomRegistry.get(optimisticThreadOutboxOwnersAtom);
  return [
    ...drafts,
    ...queuedMessages,
    ...recordOwners,
    ...optimistic,
    ...signedOutAttachmentOwners(),
  ].some((owner) =>
    owner.attachments.some(
      (attachment) =>
        attachment.uploadEnvironmentId === environmentId &&
        attachment.uploadedAttachmentId === attachmentId,
    ),
  );
}

export async function releaseUnusedComposerAttachmentFiles(
  attachments: ReadonlyArray<DraftComposerAttachment>,
): Promise<void> {
  const candidates = new Set(
    attachments.flatMap((attachment) =>
      attachment.fileUri !== undefined ? [attachment.fileUri] : [],
    ),
  );
  const uploadCandidates = new Map<EnvironmentId, Set<string>>();
  for (const attachment of attachments) {
    if (
      attachment.uploadEnvironmentId === undefined ||
      attachment.uploadedAttachmentId === undefined
    ) {
      continue;
    }
    const ids = uploadCandidates.get(attachment.uploadEnvironmentId) ?? new Set<string>();
    ids.add(attachment.uploadedAttachmentId);
    uploadCandidates.set(attachment.uploadEnvironmentId, ids);
  }
  if (candidates.size === 0 && uploadCandidates.size === 0) {
    return;
  }

  // Persisted drafts must hydrate before the reference scan. On a cold start
  // the atom is still empty, and every file a persisted draft owns would look
  // unused. Hydrate before flushing so a pending pre-hydration write cannot
  // land an incomplete snapshot either.
  await waitForComposerDraftsLoaded();
  await flushComposerDrafts();
  if (!(await threadOutboxManager.load())) {
    // An unreadable outbox store must not look like an empty queue: deleting
    // now would take bytes a persisted queued message still needs. Skip the
    // sweep; the next one retries hydration.
    return;
  }
  await flushThreadOutbox();
  await flushThreadOutboxWrites();
  const initialWriteState = threadOutboxWriteState();
  if (initialWriteState.pending) return;
  const inventoryUnchanged = (): boolean => {
    const current = threadOutboxWriteState();
    return !current.pending && current.revision === initialWriteState.revision;
  };
  let recordOwners: ReadonlyArray<Pick<ComposerDraft, "attachments">>;
  try {
    const loaded = await expoThreadOutboxStorage.loadRecords();
    if (loaded.errors.length > 0 || !inventoryUnchanged()) return;
    recordOwners = loaded.records.flatMap(ownedThreadOutboxPayloads);
  } catch (error) {
    console.warn("[composer-attachments] could not verify durable outbox ownership", error);
    return;
  }

  const allFilesReferenced = [...candidates].every((fileUri) =>
    isComposerAttachmentFileReferenced(fileUri, recordOwners),
  );
  const allUploadsReferenced = [...uploadCandidates].every(([environmentId, attachmentIds]) =>
    [...attachmentIds].every((attachmentId) =>
      isComposerAttachmentUploadReferenced(environmentId, attachmentId, recordOwners),
    ),
  );
  if (allFilesReferenced && allUploadsReferenced) {
    return;
  }

  let incomingShareFileUris: ReadonlySet<string>;
  try {
    const { loadIncomingShareDrafts } = await import("../features/sharing/incoming-share-storage");
    const incomingShares = await loadIncomingShareDrafts({ strict: true });
    incomingShareFileUris = new Set(
      incomingShares.flatMap((share) =>
        share.attachments.flatMap((attachment) =>
          attachment.fileUri !== undefined
            ? [composerAttachmentFileReferenceKey(attachment.fileUri)]
            : [],
        ),
      ),
    );
  } catch (error) {
    console.warn("[composer-attachments] could not verify incoming share ownership", error);
    return;
  }

  const { removePersistedComposerAttachmentFile } = await import("../lib/composerImages");
  for (const fileUri of candidates) {
    if (!inventoryUnchanged()) return;
    // Re-check ownership immediately before each deletion: a restore or edit
    // can re-own a file after an earlier scan decided it was unused.
    if (
      isComposerAttachmentFileReferenced(fileUri, recordOwners) ||
      incomingShareFileUris.has(composerAttachmentFileReferenceKey(fileUri))
    ) {
      continue;
    }
    await removePersistedComposerAttachmentFile(fileUri);
  }

  if (uploadCandidates.size > 0) {
    const { releasePendingAttachmentUploads } = await import("../lib/attachmentUpload");
    for (const [environmentId, attachmentIds] of uploadCandidates) {
      for (const attachmentId of attachmentIds) {
        if (!inventoryUnchanged()) return;
        // A different draft or queued message can reuse the same pending
        // upload with another local URI. Re-check the server-side ownership
        // key immediately before deletion.
        if (isComposerAttachmentUploadReferenced(environmentId, attachmentId, recordOwners)) {
          continue;
        }
        try {
          await releasePendingAttachmentUploads(environmentId, [attachmentId]);
        } catch (error) {
          // The server expires stale pending uploads. Local discard must still
          // complete when the environment is disconnected or deletion fails.
          console.warn("[composer-attachments] could not remove pending upload", {
            environmentId,
            attachmentId,
            error,
          });
        }
      }
    }
  }
}

export function scheduleUnusedComposerAttachmentCleanup(
  attachments: ReadonlyArray<DraftComposerAttachment>,
): void {
  if (
    !attachments.some(
      (attachment) =>
        attachment.fileUri !== undefined || attachment.uploadedAttachmentId !== undefined,
    )
  ) {
    return;
  }
  void releaseUnusedComposerAttachmentFiles(attachments).catch((error) => {
    console.warn("[composer-attachments] could not remove unused files", error);
  });
}

/** Keeps a native preview or upload readable until it finishes, then retries ownership cleanup. */
export function retainComposerAttachmentFileForPreview(
  attachment: FileBackedComposerAttachment,
): () => void {
  return retainComposerAttachmentFile(attachment.fileUri, () => {
    scheduleUnusedComposerAttachmentCleanup([attachment]);
  });
}

function schedulePersistComposerState(): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    // The write enters the serialization queue before waiting on hydration,
    // so flushComposerDrafts' queue drain cannot resolve ahead of it.
    void persistenceQueue.run(async () => {
      try {
        await waitForComposerDraftsLoaded();
        await writePersistedComposerState();
        persistRetryNeeded = false;
      } catch (error) {
        // A failed debounce has no timer left. A later final flush must retry
        // these edits after persisted ownership can be read safely.
        persistRetryNeeded = true;
        console.warn("[composer-drafts] failed to persist drafts", error);
        // Draft persistence is best-effort; in-memory drafts still keep working.
      }
    });
  }, PERSIST_DEBOUNCE_MS);
}

export function ensureComposerDraftsLoaded(): void {
  if (loadPromise !== null) {
    return;
  }
  const loading = loadPersistedComposerState().then((persisted) => {
    publishComposerCloudDrafts(persisted.cloudDrafts);
    if (Object.keys(persisted.drafts).length > 0) {
      const current = appAtomRegistry.get(composerDraftsAtom);
      publishComposerDrafts({
        ...Object.fromEntries(
          Object.entries(persisted.drafts).filter(
            ([key]) => !draftsChangedBeforeHydration.has(key),
          ),
        ),
        ...current,
      });
    }
    if (
      persisted.stickyModelSelection !== null &&
      appAtomRegistry.get(stickyComposerModelSelectionAtom) === null
    ) {
      composerMutationEpoch += 1;
      appAtomRegistry.set(stickyComposerModelSelectionAtom, persisted.stickyModelSelection);
    }
    draftsHydrated = true;
    draftsChangedBeforeHydration.clear();
  });
  loadPromise = loading;
  // Handle fire-and-forget hook loads without swallowing failures from the
  // write and cleanup callers that await this same promise. A later call retries.
  void loading.catch((cause) => {
    if (loadPromise === loading) loadPromise = null;
    console.warn(
      "[composer-drafts] failed to hydrate drafts",
      cause instanceof ComposerDraftPersistenceError
        ? cause
        : new ComposerDraftPersistenceError({
            operation: "hydrate",
            directory: COMPOSER_DRAFTS_DIRECTORY,
            fileName: COMPOSER_DRAFTS_FILE,
            cause,
          }),
    );
  });
}

/** Wait until persisted drafts have been merged into the in-memory composer state. */
export async function waitForComposerDraftsLoaded(): Promise<void> {
  ensureComposerDraftsLoaded();
  if (loadPromise !== null) {
    await loadPromise;
  }
}

export async function getComposerCloudAccountId(): Promise<string | null> {
  await waitForComposerDraftsLoaded();
  return appAtomRegistry.get(composerCloudDraftsAtom).accountId;
}

/** Save an account's local work before its relay environments are removed. */
export async function archiveCloudComposerDrafts(
  accountId: string | null,
  environmentIds: ReadonlySet<EnvironmentId>,
): Promise<void> {
  await waitForComposerDraftsLoaded();
  if (!(await threadOutboxManager.load())) throw new Error("Could not preserve queued messages.");
  await flushThreadOutbox();
  const cloud = appAtomRegistry.get(composerCloudDraftsAtom);
  const owner = accountId ?? cloud.accountId;
  if (owner === null) return;
  const queued = Object.values(
    appAtomRegistry.get(threadOutboxManager.queuedMessagesByThreadKeyAtom),
  )
    .flat()
    .filter((message) => {
      const record = threadOutboxManager.recordFor(message);
      return record !== null && record.ownerAccountId === owner;
    });
  await threadOutboxManager.authority.parkAccount(owner, environmentIds);
  const current = appAtomRegistry.get(composerDraftsAtom);
  const remaining = { ...current };
  const savedDrafts = { ...cloud.signedOut[owner]?.drafts };
  for (const [key, draft] of Object.entries(current)) {
    if (
      key.startsWith("pending-task:") &&
      !queued.some((message) => pendingTaskDraftKey(message) === key) &&
      threadOutboxManager.authority
        .knownRecords()
        .filter((record) => `pending-task:${record.storageIdentity.messageId}` === key).length !== 1
    )
      continue;
    const environmentId = composerDraftEnvironmentId(key, queued, draft);
    if (environmentId !== null && environmentIds.has(environmentId)) {
      savedDrafts[key] = draft;
      delete remaining[key];
    }
  }
  const savedMessages = new Map(
    (cloud.signedOut[owner]?.queuedMessages ?? []).map((message) => [
      threadOutboxStorageIdentity(message),
      message,
    ]),
  );
  for (const message of queued) {
    if (environmentIds.has(message.environmentId))
      savedMessages.set(threadOutboxStorageIdentity(message), message);
  }
  publishComposerCloudDrafts({
    // Keep the owner through removal. A crash or failed cleanup can retry it
    // on cold start before a different account activates.
    accountId: owner,
    signedOut: {
      ...cloud.signedOut,
      [owner]: { drafts: savedDrafts, queuedMessages: [...savedMessages.values()] },
    },
  });
  schedulePersistComposerState();
  await flushComposerDrafts();
  // The archive owns these exact snapshots durably before removing live copies.
  updateComposerDrafts((latest) => {
    const next = { ...latest };
    for (const [key, draft] of Object.entries(current)) {
      if (!(key in remaining) && latest[key] === draft) delete next[key];
    }
    return next;
  });
  await flushComposerDrafts();
}

function sameDraftAttachmentContent(
  left: ReadonlyArray<DraftComposerAttachment>,
  right: ReadonlyArray<DraftComposerAttachment>,
): boolean {
  return (
    left.length === right.length &&
    left.every((attachment, index) => {
      const other = right[index];
      if (other === undefined) return false;
      const {
        uploadedAttachmentId: _leftUpload,
        uploadEnvironmentId: _leftEnvironment,
        ...leftContent
      } = attachment;
      const {
        uploadedAttachmentId: _rightUpload,
        uploadEnvironmentId: _rightEnvironment,
        ...rightContent
      } = other;
      return stableStringify(leftContent) === stableStringify(rightContent);
    })
  );
}

/** An in-flight delivery can finish after sign-out took its snapshot. */
export async function removeDeliveredCloudQueuedMessage(
  message: QueuedThreadMessage,
): Promise<void> {
  await waitForComposerDraftsLoaded();
  const cloud = appAtomRegistry.get(composerCloudDraftsAtom);
  const signedOut = { ...cloud.signedOut };
  let changed = false;
  for (const [accountId, saved] of Object.entries(signedOut)) {
    const archived = saved.queuedMessages.find(
      (candidate) =>
        threadOutboxStorageIdentity(candidate) === threadOutboxStorageIdentity(message),
    );
    if (
      !archived ||
      archived.environmentId !== message.environmentId ||
      archived.commandId !== message.commandId ||
      archived.threadId !== message.threadId ||
      archived.text !== message.text ||
      !sameDraftAttachmentContent(archived.attachments, message.attachments)
    )
      continue;
    // Upload ids may change during preparation; user edits must remain recoverable.
    if (
      stableStringify([
        archived.context,
        archived.modelSelection,
        archived.runtimeMode,
        archived.interactionMode,
        archived.creation,
      ]) !==
      stableStringify([
        message.context,
        message.modelSelection,
        message.runtimeMode,
        message.interactionMode,
        message.creation,
      ])
    )
      continue;
    const scopedEditorKey = pendingTaskDraftKey(message);
    const editorKey =
      saved.drafts[scopedEditorKey] === undefined
        ? `pending-task:${message.messageId}`
        : scopedEditorKey;
    const editor = saved.drafts[editorKey];
    if (
      editor &&
      editorKey !== scopedEditorKey &&
      (threadOutboxManager.authority
        .knownRecords()
        .filter((record) => record.storageIdentity.messageId === message.messageId).length > 1 ||
        saved.queuedMessages.some(
          (candidate) => candidate !== archived && candidate.messageId === message.messageId,
        ))
    )
      continue;
    if (
      editor &&
      (editor.text !== message.text ||
        stableStringify(editor.context) !== stableStringify(message.context) ||
        !sameDraftAttachmentContent(editor.attachments, message.attachments) ||
        (editor.modelSelection !== undefined &&
          JSON.stringify(editor.modelSelection) !== JSON.stringify(message.modelSelection)) ||
        (editor.runtimeMode !== undefined && editor.runtimeMode !== message.runtimeMode) ||
        (editor.interactionMode !== undefined &&
          editor.interactionMode !== message.interactionMode) ||
        (editor.workspaceSelection !== undefined &&
          (editor.workspaceSelection.mode !== message.creation?.workspaceMode ||
            editor.workspaceSelection.branch !== message.creation?.branch ||
            editor.workspaceSelection.worktreePath !== message.creation?.worktreePath ||
            (editor.workspaceSelection.startFromOrigin ?? false) !==
              (message.creation?.startFromOrigin ?? false))))
    )
      continue;
    const drafts = { ...saved.drafts };
    delete drafts[editorKey];
    signedOut[accountId] = {
      drafts,
      queuedMessages: saved.queuedMessages.filter((candidate) => candidate !== archived),
    };
    changed = true;
  }
  if (!changed) return;
  publishComposerCloudDrafts({ ...cloud, signedOut });
  schedulePersistComposerState();
  try {
    await flushComposerDrafts();
  } catch (error) {
    // The live outbox can still remove this acknowledged message. Keep the
    // archive update pending so a later successful flush lands it too.
    schedulePersistComposerState();
    throw error;
  }
}

/** Restores only this account, before its connections can deliver queued turns. */
export async function restoreCloudComposerDrafts(accountId: string): Promise<void> {
  await waitForComposerDraftsLoaded();
  const cloud = appAtomRegistry.get(composerCloudDraftsAtom);
  const saved = cloud.signedOut[accountId];
  const conflicts: QueuedThreadMessage[] = [];
  if (!(await threadOutboxManager.load())) throw new Error("Could not restore queued messages.");
  if (saved) {
    for (const message of saved.queuedMessages) {
      const result = await threadOutboxManager.authority.reconcileArchived(accountId, message);
      if (result.status === "conflict") conflicts.push(message);
    }
    updateComposerDrafts((current) => {
      const restored = { ...current };
      for (const [key, draft] of Object.entries(saved.drafts)) {
        const existing = current[key];
        const attachmentIds = new Set(existing?.attachments.map((attachment) => attachment.id));
        restored[key] = existing
          ? {
              ...draft,
              ...existing,
              text: mergeComposerDraftText(existing.text, draft.text),
              context: mergeReferencedComposerContext(
                mergeComposerDraftText(existing.text, draft.text),
                draft.context,
                existing.context,
              ),
              // A concurrent import must not lose files, even above the send limit.
              attachments: [
                ...existing.attachments,
                ...draft.attachments.filter((attachment) => !attachmentIds.has(attachment.id)),
              ],
              importedShareIds: [
                ...new Set([
                  ...(existing.importedShareIds ?? []),
                  ...(draft.importedShareIds ?? []),
                ]),
              ],
            }
          : draft;
      }
      return restored;
    });
  }
  // Placement restoration also applies when no composer archive survived.
  const environments = new Set(
    threadOutboxManager.authority
      .knownRecords()
      .filter((record) => record.archivedFor === accountId)
      .map((record) => record.transport.environmentId),
  );
  await threadOutboxManager.authority.restoreAccount(accountId, environments);
  await flushComposerDrafts();
  const latestCloud = appAtomRegistry.get(composerCloudDraftsAtom);
  const signedOut = { ...latestCloud.signedOut };
  // Only the exact, fully reconciled snapshot may be removed. Another archive
  // write during an await is not part of this restore's deletion authority.
  if (saved && latestCloud.signedOut[accountId] === saved) {
    if (conflicts.length === 0) delete signedOut[accountId];
    else signedOut[accountId] = { drafts: saved.drafts, queuedMessages: conflicts };
  }
  publishComposerCloudDrafts({ accountId, signedOut });
  schedulePersistComposerState();
  await flushComposerDrafts();
}

function updateComposerDrafts(
  update: (current: Record<string, ComposerDraft>) => Record<string, ComposerDraft>,
): void {
  const current = appAtomRegistry.get(composerDraftsAtom);
  const next = update(current);
  if (next === current) {
    composerMutationEpoch += 1;
    return;
  }
  // An edited then cleared key is absent from `next`, but still overrides disk.
  // Keep that intent across failed reads until hydration actually succeeds.
  if (!draftsHydrated) {
    for (const key of new Set([...Object.keys(current), ...Object.keys(next)])) {
      if (current[key] !== next[key]) draftsChangedBeforeHydration.add(key);
    }
  }
  publishComposerDrafts(next);
  schedulePersistComposerState();
}

export function setStickyComposerModelSelection(modelSelection: ModelSelection): void {
  composerMutationEpoch += 1;
  appAtomRegistry.set(stickyComposerModelSelectionAtom, modelSelection);
  schedulePersistComposerState();
}

export function setComposerDraftText(draftKey: string, value: string): void {
  let removed: ReadonlyArray<DraftComposerAttachment> = [];
  updateComposerDrafts((current) => {
    const existing = normalizeDraft(current[draftKey]);
    const context = referencedComposerContext(value, existing.context);
    const draft = withReferencedContextFiles(existing, value, context);
    removed = existing.attachments.filter((attachment) => !draft.attachments.includes(attachment));
    return withComposerDraft(current, draftKey, draft);
  });
  scheduleUnusedComposerAttachmentCleanup(removed);
}

export function insertComposerDraftText(
  draftKey: string,
  value: string,
  target: ComposerDraftInsertion,
): void {
  const draft = getComposerDraftSnapshot(draftKey);
  const { start, end } = contextInsertionRange(draftKey, draft, target);
  const text = draft.text.slice(0, start) + value + draft.text.slice(end);
  setComposerDraftText(draftKey, text);
  rememberComposerDraftSelection(draftKey, text, {
    start: start + value.length,
    end: start + value.length,
  });
}

export function appendComposerDraftText(draftKey: string, value: string): void {
  updateComposerDrafts((current) => {
    const existing = normalizeDraft(current[draftKey]);
    return {
      ...current,
      [draftKey]: {
        ...existing,
        text: `${existing.text}${value}`,
      },
    };
  });
}

/**
 * Appends attachments to a draft, capped at the send limit against the draft's
 * live state (callers may have counted before an await; the picker can race
 * concurrent adds). Overflowed file attachments are released. Returns how many
 * were rejected. Restore paths pass allowOverflow so a failed send never drops
 * the message's own attachments.
 */
export function appendComposerDraftAttachments(
  draftKey: string,
  attachments: ReadonlyArray<DraftComposerAttachment>,
  options?: {
    readonly allowOverflow?: boolean;
    readonly appendReference?: boolean;
    readonly insertion?: ComposerDraftInsertion;
    readonly maxAttachments?: number;
  },
): number {
  if (attachments.length === 0) {
    return 0;
  }
  let rejected: ReadonlyArray<DraftComposerAttachment> = [];
  let removed: ReadonlyArray<DraftComposerAttachment> = [];
  updateComposerDrafts((current) => {
    const existing = normalizeDraft(current[draftKey]);
    const retained = options?.appendReference
      ? draftWithoutInsertionSelection(draftKey, existing, options.insertion)
      : existing;
    const remaining = options?.allowOverflow
      ? attachments.length
      : Math.max(
          0,
          Math.min(
            PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
            options?.maxAttachments ?? PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
          ) - retained.attachments.length,
        );
    const contextCapacity = options?.appendReference
      ? Math.max(0, COMPOSER_CONTEXT_MAX_RECORDS - (retained.context?.records.length ?? 0))
      : attachments.length;
    const accepted = attachments.slice(0, Math.min(remaining, contextCapacity));
    rejected = attachments.slice(accepted.length);
    if (accepted.length === 0) {
      return current;
    }
    let draft = { ...existing, attachments: [...existing.attachments, ...accepted] };
    if (options?.appendReference) {
      const records = accepted.map((attachment) => attachmentContextRecord(attachment));
      const inserted = draftWithInsertedContext(
        draftKey,
        draft,
        {
          text: records.map(formatComposerContextReference).join(" "),
          context: { version: 1, records },
        },
        options?.insertion,
      );
      if (!inserted) {
        rejected = attachments;
        return current;
      }
      draft = { ...inserted, attachments: [...inserted.attachments] };
      removed = existing.attachments.filter(
        (attachment) => !draft.attachments.includes(attachment),
      );
    }
    return {
      ...current,
      [draftKey]: draft,
    };
  });
  scheduleUnusedComposerAttachmentCleanup([...rejected, ...removed]);
  return rejected.length;
}

export function replaceComposerDraftAttachments(
  draftKey: string,
  attachments: ReadonlyArray<DraftComposerAttachment>,
): void {
  const previousAttachments = getComposerDraftSnapshot(draftKey).attachments;
  let retainedIds = new Set(attachments.map((attachment) => attachment.id));
  updateComposerDrafts((current) => {
    const existing = normalizeDraft(current[draftKey]);
    const sourceIds = new Set(
      existing.rejectedTurn?.message.attachments?.map((attachment) => attachment.id),
    );
    const nextAttachments =
      existing.rejectedTurn === undefined
        ? attachments
        : [
            ...existing.attachments.filter((attachment) => sourceIds.has(attachment.id)),
            ...attachments.filter((attachment) => !sourceIds.has(attachment.id)),
          ];
    retainedIds = new Set(nextAttachments.map((attachment) => attachment.id));
    // An attachment that is no longer here must take its chip and context record with it, or
    // the draft keeps a reference pointing at a file it no longer holds.
    const droppedContextIds = new Set(
      existing.context?.records
        .filter((record) => "attachmentId" in record && !retainedIds.has(record.attachmentId))
        .map((record) => record.contextId),
    );
    const text = replaceComposerContextReferences(existing.text, (ref) =>
      droppedContextIds.has(ref.contextId) ? "" : ref.source,
    );
    const draft = {
      ...existing,
      text,
      context: contextWithRejectedSource(
        existing,
        referencedComposerContext(text, existing.context),
      ),
      attachments: nextAttachments,
    };
    return withComposerDraft(current, draftKey, draft);
  });
  scheduleUnusedComposerAttachmentCleanup(
    previousAttachments.filter((attachment) => !retainedIds.has(attachment.id)),
  );
}

export function removeComposerDraftAttachment(draftKey: string, imageId: string): void {
  const previousAttachments = getComposerDraftSnapshot(draftKey).attachments;
  updateComposerDrafts((current) => {
    const existing = normalizeDraft(current[draftKey]);
    if (
      existing.rejectedTurn?.message.attachments?.some((attachment) => attachment.id === imageId)
    ) {
      return current;
    }
    const removedIds = new Set(
      existing.context?.records
        .filter((record) => "attachmentId" in record && record.attachmentId === imageId)
        .map((record) => record.contextId),
    );
    const text = replaceComposerContextReferences(existing.text, (ref) =>
      removedIds.has(ref.contextId) ? "" : ref.source,
    );
    const draft = {
      ...existing,
      text,
      context: contextWithRejectedSource(
        existing,
        referencedComposerContext(text, existing.context),
      ),
      attachments: existing.attachments.filter((image) => image.id !== imageId),
    };
    return withComposerDraft(current, draftKey, draft);
  });
  scheduleUnusedComposerAttachmentCleanup(
    previousAttachments.filter((attachment) => attachment.id === imageId),
  );
}

/** Stamps a finished upload without overwriting text, removals, or newer attachments. */
export function setComposerDraftAttachmentUpload(
  draftKey: string,
  attachment: DraftComposerAttachment,
): boolean {
  let previous: DraftComposerAttachment | undefined;
  updateComposerDrafts((current) => {
    const draft = current[draftKey];
    previous = draft?.attachments.find((candidate) => candidate.id === attachment.id);
    if (!draft || !previous) return current;
    if (
      previous.uploadedAttachmentId === attachment.uploadedAttachmentId &&
      previous.uploadEnvironmentId === attachment.uploadEnvironmentId
    )
      return current;
    return {
      ...current,
      [draftKey]: {
        ...draft,
        attachments: draft.attachments.map((candidate) =>
          candidate.id === attachment.id
            ? {
                ...candidate,
                uploadedAttachmentId: attachment.uploadedAttachmentId,
                uploadEnvironmentId: attachment.uploadEnvironmentId,
              }
            : candidate,
        ),
      },
    };
  });
  if (previous) scheduleUnusedComposerAttachmentCleanup([previous]);
  return previous !== undefined;
}

export function updateComposerDraftSettings(
  draftKey: string,
  settings: Partial<ComposerDraftSettingsUpdate>,
): void {
  updateComposerDrafts((current) => {
    const draft = {
      ...normalizeDraft(current[draftKey]),
      ...settings,
    };
    return withComposerDraft(current, draftKey, draft);
  });
}

export function clearComposerDraftContentState(
  current: Record<string, ComposerDraft>,
  draftKey: string,
  options?: {
    readonly clearModelSelection?: boolean;
    readonly clearWorkspaceSelection?: boolean;
  },
): Record<string, ComposerDraft> {
  const existing = current[draftKey];
  if (!existing) {
    return current;
  }
  // Clearing content is the "this draft is done" moment (sent, queued, or
  // discarded), so the project stamp goes too and an otherwise-empty new-task
  // draft leaves the store rather than lingering as a blank row.
  const {
    importedShareIds: _importedShareIds,
    context: _context,
    modelSelection,
    workspaceSelection,
    project: _project,
    ...retained
  } = existing;
  const draft = {
    ...retained,
    ...(options?.clearModelSelection || modelSelection === undefined ? {} : { modelSelection }),
    ...(options?.clearWorkspaceSelection || workspaceSelection === undefined
      ? {}
      : { workspaceSelection }),
    text: "",
    attachments: [],
  };
  if (isEmptyDraft(draft)) {
    const next = { ...current };
    delete next[draftKey];
    return next;
  }
  return {
    ...current,
    [draftKey]: draft,
  };
}

export function restoreComposerDraftSnapshotState(
  current: Record<string, ComposerDraft>,
  draftKey: string,
  snapshot: ComposerDraft,
): Record<string, ComposerDraft> {
  const next = { ...current };
  if (isEmptyDraft(snapshot)) {
    delete next[draftKey];
  } else {
    next[draftKey] = snapshot;
  }
  return next;
}

function stripAttachmentUploadReference(
  attachment: DraftComposerAttachment,
): DraftComposerAttachment {
  const { uploadedAttachmentId: _id, uploadEnvironmentId: _environmentId, ...rest } = attachment;
  return rest;
}

function mergeComposerDraftText(existing: string, incoming: string): string {
  if (incoming.length === 0) {
    return existing;
  }
  if (existing.length === 0) {
    return incoming;
  }
  // Import retries are possible after an interrupted native handoff. Keep the
  // operation idempotent when the same shared text is already present.
  if (existing === incoming || existing.endsWith(`\n\n${incoming}`)) {
    return existing;
  }
  return `${existing}\n\n${incoming}`;
}

function mergeReferencedComposerContext(
  text: string,
  first?: OrchestrationMessageContext,
  second?: OrchestrationMessageContext,
) {
  const records = new Map((first?.records ?? []).map((record) => [record.contextId, record]));
  for (const record of second?.records ?? []) records.set(record.contextId, record);
  if (records.size === 0) return undefined;
  return referencedComposerContext(text, { version: 1, records: [...records.values()] });
}

export function mergeComposerDraftContentState(
  current: Record<string, ComposerDraft>,
  draftKey: string,
  content: ComposerDraftContent,
): Record<string, ComposerDraft> {
  const existing = normalizeDraft(current[draftKey]);
  if (content.sourceShareId && existing.importedShareIds?.includes(content.sourceShareId)) {
    return current;
  }
  const attachmentIds = new Set(existing.attachments.map((attachment) => attachment.id));
  const incomingAttachments = content.attachments.filter((attachment) => {
    if (attachmentIds.has(attachment.id)) {
      return false;
    }
    attachmentIds.add(attachment.id);
    return true;
  });
  const attachments =
    existing.rejectedTurn === undefined
      ? [...existing.attachments, ...incomingAttachments].slice(
          0,
          PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
        )
      : [
          ...existing.attachments,
          ...incomingAttachments.slice(
            0,
            Math.max(0, PROVIDER_SEND_TURN_MAX_ATTACHMENTS - existing.attachments.length),
          ),
        ];
  const text = mergeComposerDraftText(existing.text, content.text);
  const context = contextWithRejectedSource(
    existing,
    mergeReferencedComposerContext(text, existing.context, content.context),
  );
  const importedShareIds = content.sourceShareId
    ? [...(existing.importedShareIds ?? []), content.sourceShareId]
    : existing.importedShareIds;
  if (
    text === existing.text &&
    attachments.length === existing.attachments.length &&
    content.context === undefined &&
    importedShareIds === existing.importedShareIds
  ) {
    return current;
  }
  return {
    ...current,
    [draftKey]: {
      ...existing,
      text,
      attachments,
      context,
      ...(importedShareIds ? { importedShareIds } : {}),
    },
  };
}

/**
 * Atomically moves an incoming share into a project-scoped composer draft.
 * The durable write happens before the share inbox item can be acknowledged.
 */
export async function mergeComposerDraftContent(
  draftKey: string,
  content: ComposerDraftContent,
): Promise<{ readonly skippedAttachmentCount: number }> {
  ensureComposerDraftsLoaded();
  if (loadPromise !== null) {
    await loadPromise;
  }
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  const current = appAtomRegistry.get(composerDraftsAtom);
  const next = mergeComposerDraftContentState(current, draftKey, content);
  const currentAttachmentIds = new Set(
    normalizeDraft(current[draftKey]).attachments.map((attachment) => attachment.id),
  );
  const nextAttachmentIds = new Set(
    normalizeDraft(next[draftKey]).attachments.map((attachment) => attachment.id),
  );
  const skippedAttachmentCount = content.attachments.filter(
    (attachment) =>
      !currentAttachmentIds.has(attachment.id) && !nextAttachmentIds.has(attachment.id),
  ).length;
  // Publish the content and its import receipt together before the filesystem
  // await. Typing during persistence then builds on the receipt-bearing state,
  // and its debounced write is serialized after this transaction.
  if (next !== current) {
    publishComposerDrafts(next);
  }
  await persistenceQueue.run(writePersistedComposerState);
  return { skippedAttachmentCount };
}

/** Restores the exact content/settings captured before an interrupted import. */
export async function restoreComposerDraftSnapshot(
  draftKey: string,
  snapshot: ComposerDraft,
  canRestore: () => boolean = () => true,
): Promise<void> {
  ensureComposerDraftsLoaded();
  if (loadPromise !== null) {
    await loadPromise;
  }
  if (!canRestore()) return;
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  const next = restoreComposerDraftSnapshotState(
    appAtomRegistry.get(composerDraftsAtom),
    draftKey,
    snapshot,
  );
  publishComposerDrafts(next);
  await persistenceQueue.run(writePersistedComposerState);
}

export function sameComposerDraftState(a: ComposerDraft, b: ComposerDraft): boolean {
  return (
    a.text === b.text &&
    a.attachments === b.attachments &&
    a.context === b.context &&
    a.importedShareIds === b.importedShareIds &&
    a.modelSelection === b.modelSelection &&
    a.runtimeMode === b.runtimeMode &&
    a.interactionMode === b.interactionMode &&
    a.workspaceSelection === b.workspaceSelection &&
    a.project === b.project &&
    a.rejectedTurn === b.rejectedTurn
  );
}

/**
 * Undoes an abandoned mergeComposerDraftContent. When the draft is untouched
 * since `merged` (the state captured right after the merge), the pre-merge
 * snapshot comes back exactly. When the user edited the draft during the
 * merge's awaits, only what the merge inserted (the appended text and the new
 * attachments) is taken back out, so the user's edits survive the rollback.
 */
export function undoComposerDraftMergeState(
  current: Record<string, ComposerDraft>,
  draftKey: string,
  snapshot: ComposerDraft,
  merged: ComposerDraft,
): Record<string, ComposerDraft> {
  const existing = normalizeDraft(current[draftKey]);
  if (sameComposerDraftState(existing, merged)) {
    return restoreComposerDraftSnapshotState(current, draftKey, snapshot);
  }
  const insertedText = merged.text.startsWith(snapshot.text)
    ? merged.text.slice(snapshot.text.length)
    : "";
  const snapshotAttachmentIds = new Set(snapshot.attachments.map((attachment) => attachment.id));
  const insertedAttachmentIds = new Set(
    merged.attachments
      .filter((attachment) => !snapshotAttachmentIds.has(attachment.id))
      .map((attachment) => attachment.id),
  );
  // A setting still holding the merge's value is the merge's doing: restore
  // the snapshot's. One the user changed since the merge stays theirs.
  const undoSetting = <
    K extends "modelSelection" | "runtimeMode" | "interactionMode" | "workspaceSelection",
  >(
    key: K,
  ): ComposerDraft[K] => (existing[key] === merged[key] ? snapshot[key] : existing[key]);
  const text =
    insertedText.length > 0 && existing.text.startsWith(merged.text)
      ? snapshot.text + existing.text.slice(merged.text.length)
      : insertedText.length > 0 && existing.text.endsWith(insertedText)
        ? existing.text.slice(0, existing.text.length - insertedText.length)
        : existing.text;
  const draft = {
    ...existing,
    text,
    context: contextWithRejectedSource(existing, referencedComposerContext(text, existing.context)),
    attachments: existing.attachments.filter(
      (attachment) => !insertedAttachmentIds.has(attachment.id),
    ),
    modelSelection: undoSetting("modelSelection"),
    runtimeMode: undoSetting("runtimeMode"),
    interactionMode: undoSetting("interactionMode"),
    workspaceSelection: undoSetting("workspaceSelection"),
  };
  return withComposerDraft(current, draftKey, draft);
}

/** Applies undoComposerDraftMergeState and lands it durably. */
export async function undoComposerDraftMerge(
  draftKey: string,
  snapshot: ComposerDraft,
  merged: ComposerDraft,
): Promise<void> {
  ensureComposerDraftsLoaded();
  if (loadPromise !== null) {
    await loadPromise;
  }
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  const next = undoComposerDraftMergeState(
    appAtomRegistry.get(composerDraftsAtom),
    draftKey,
    snapshot,
    merged,
  );
  publishComposerDrafts(next);
  await persistenceQueue.run(writePersistedComposerState);
}

export function clearComposerDraftContent(
  draftKey: string,
  options?: {
    readonly clearModelSelection?: boolean;
    readonly clearWorkspaceSelection?: boolean;
    // Send clears the draft while the durable outbox write is still in
    // flight. Sweeping then would race the write: a failed enqueue rolls the
    // message out of the queue mid-sweep and its files get deleted right
    // before the failure handler restores them. The sender re-schedules
    // cleanup once the write settles.
    readonly deferAttachmentCleanup?: boolean;
  },
): void {
  if (!draftsHydrated) {
    draftsChangedBeforeHydration.add(draftKey);
    schedulePersistComposerState();
  }
  const previousAttachments = getComposerDraftSnapshot(draftKey).attachments;
  updateComposerDrafts((current) => clearComposerDraftContentState(current, draftKey, options));
  if (!options?.deferAttachmentCleanup) {
    scheduleUnusedComposerAttachmentCleanup(previousAttachments);
  }
}

export function clearComposerDraft(
  draftKey: string,
  options?: { readonly deferAttachmentCleanup?: boolean },
): void {
  if (!draftsHydrated) {
    draftsChangedBeforeHydration.add(draftKey);
    schedulePersistComposerState();
  }
  const previousAttachments = getComposerDraftSnapshot(draftKey).attachments;
  updateComposerDrafts((current) => {
    if (!current[draftKey]) {
      return current;
    }
    const next = { ...current };
    delete next[draftKey];
    return next;
  });
  if (!options?.deferAttachmentCleanup) {
    scheduleUnusedComposerAttachmentCleanup(previousAttachments);
  }
}

export function removeComposerDraftsForEnvironment(
  drafts: Record<string, ComposerDraft>,
  environmentId: EnvironmentId,
): Record<string, ComposerDraft> {
  const environmentPrefix = `${environmentId}:`;
  return Object.fromEntries(
    Object.entries(drafts).filter(
      ([draftKey, draft]) =>
        !draftKey.startsWith(environmentPrefix) && draft.project?.environmentId !== environmentId,
    ),
  );
}

/**
 * Mints a new-task draft for a project. The entry is published immediately so
 * the composer can bind to its key before the user types; it stays out of the
 * list until it has content, and the empty-draft sweep drops it on persist if
 * nothing is ever written.
 */
export function createNewTaskDraft(project: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}): string {
  const draftKey = newTaskDraftKey(newDraftId());
  const stamp: ComposerDraftProject = {
    environmentId: project.environmentId,
    projectId: project.projectId,
    createdAt: new Date().toISOString(),
  };
  updateComposerDrafts((current) => ({
    ...current,
    [draftKey]: { ...EMPTY_DRAFT, project: stamp },
  }));
  return draftKey;
}

/**
 * Points an existing new-task draft at a different project, keeping its
 * content and identity. Workspace selection is project-specific (branch,
 * worktree), so it is cleared; model and mode choices carry over.
 */
export function retargetNewTaskDraft(
  draftKey: string,
  project: { readonly environmentId: EnvironmentId; readonly projectId: ProjectId },
): void {
  updateComposerDrafts((current) => {
    const existing = current[draftKey];
    const stamp = existing?.project;
    if (
      stamp !== undefined &&
      stamp.environmentId === project.environmentId &&
      stamp.projectId === project.projectId
    ) {
      return current;
    }
    const { workspaceSelection: _workspaceSelection, ...retained } = normalizeDraft(existing);
    // Pending uploads live on one server. Crossing environments keeps the
    // local bytes (the upload worker re-sends them to the new environment)
    // but drops the old stamp, so it cannot pin the source environment's
    // pending upload alive from the moved draft.
    const attachments = retained.attachments.map((attachment) =>
      attachment.uploadEnvironmentId !== undefined &&
      attachment.uploadEnvironmentId !== project.environmentId
        ? stripAttachmentUploadReference(attachment)
        : attachment,
    );
    return {
      ...current,
      [draftKey]: {
        ...retained,
        attachments,
        project: {
          environmentId: project.environmentId,
          projectId: project.projectId,
          createdAt: stamp?.createdAt ?? new Date().toISOString(),
        },
      },
    };
  });
}

/** New-task drafts for a project, newest first. */
export function findNewTaskDraftKeys(
  drafts: Readonly<Record<string, ComposerDraft>>,
  project: { readonly environmentId: EnvironmentId; readonly projectId: ProjectId },
): ReadonlyArray<string> {
  return Object.entries(drafts)
    .filter(
      ([key, draft]) =>
        isNewTaskDraftKey(key) &&
        draft.project?.environmentId === project.environmentId &&
        draft.project.projectId === project.projectId,
    )
    .sort(([, left], [, right]) =>
      (right.project?.createdAt ?? "").localeCompare(left.project?.createdAt ?? ""),
    )
    .map(([key]) => key);
}

export async function clearComposerDraftsEnvironment(environmentId: EnvironmentId): Promise<void> {
  ensureComposerDraftsLoaded();
  if (loadPromise !== null) {
    await loadPromise;
  }

  const current = appAtomRegistry.get(composerDraftsAtom);
  const next = removeComposerDraftsForEnvironment(current, environmentId);
  const removedAttachments = Object.entries(current)
    .filter(([draftKey]) => next[draftKey] === undefined)
    .flatMap(([, draft]) => draft.attachments);

  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  publishComposerDrafts(next);
  await persistenceQueue.run(writePersistedComposerState);
  await releaseUnusedComposerAttachmentFiles(removedAttachments);
}

export function useComposerDraft(draftKey: string | null): ComposerDraft {
  const drafts = useAtomValue(composerDraftsAtom);
  useEffect(() => {
    ensureComposerDraftsLoaded();
  }, []);
  return draftKey ? normalizeDraft(drafts[draftKey]) : EMPTY_DRAFT;
}

export function useStickyComposerModelSelection(): ModelSelection | null {
  const selection = useAtomValue(stickyComposerModelSelectionAtom);
  useEffect(() => {
    ensureComposerDraftsLoaded();
  }, []);
  return selection;
}
