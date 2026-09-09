import type { App } from "obsidian";
import { TFile } from "obsidian";
import type { StorageService } from "./storage";
import type { MediaItem } from "../models/media";
import type { WatchSession } from "../models/review";
import type { Episode, EpisodeProgress, EpisodeWatch } from "../models/episode";
import type { ComfortProfile, ComfortPreset } from "../models/comfort";
import type { CustomList } from "../models/list";
import type { MediaVaultSettings } from "../settings/settings";
import { MediaStatus } from "../types/enums";
import { MediaType } from "../types/enums";
import {
  resolveMediaFolder,
  resolveMediaNotePath,
} from "./note-generator/media-note-generator";
import { syncMediaAggregates } from "./watch-session-service";
import { recalculateAndPersistStatus } from "./status-service";
import { maybeYield } from "./importer/yield";

/**
 * MediaVault's own export/import format — round-tripping MediaVault's own
 * canonical data model, as distinct from:
 *
 * - Canonical MediaVault data: the repositories under services/storage —
 *   the single authoritative application state.
 * - Generated Markdown: a synchronized *representation* of a subset of
 *   canonical data (services/note-generator + note-sync-service), with an
 *   explicit owned/unowned split.
 * - Cache: nothing MediaVault currently treats as a rebuildable index sits
 *   apart from the repositories themselves (BaseRepository's id index is
 *   an in-memory optimization only, already safely rebuildable — it is
 *   NOT part of the export).
 * - Export: a portable, versioned snapshot of canonical data plus the
 *   generated Markdown text, self-contained enough to reconstruct the
 *   library relationships without the original vault/cache.
 * - Sync state / import state: local, non-portable operational metadata
 *   (settings.noteSyncState, settings.importState) — never embedded in an
 *   export, and not treated as authoritative for canonical data.
 *
 * This is kept as its own module rather than folded into the TV Time
 * importer pipeline (services/importer/tvtime/*), which solves a different
 * problem: converting *foreign* data into MediaVault's model via TMDB
 * matching. This module round-trips MediaVault's *own* model, so none of
 * that matching/normalization machinery applies.
 */

export const MEDIAVAULT_EXPORT_FORMAT = "mediavault-export";
export const MEDIAVAULT_EXPORT_VERSION = 1;

export interface MediaVaultExportNote {
  /** Path relative to the exporting vault's MediaVault folder — recomputed
   * against the importing vault's own folder settings on import, so the
   * export never depends on the original vault's absolute layout. */
  relativePath: string;
  /** Full raw file content, frontmatter and all — including anything the
   * user authored outside the mediavault:start/end markers. */
  content: string;
}

export interface MediaVaultExportItem {
  media: MediaItem;
  watchSessions: WatchSession[];
  episodes: Episode[];
  episodeProgress: EpisodeProgress[];
  episodeWatches: EpisodeWatch[];
  comfortProfile: ComfortProfile | null;
  note: MediaVaultExportNote | null;
}

/** Settings safe to include in a portable export: user preferences only —
 * never credentials (tmdbApiKey, trakt client id/secret/tokens), and never
 * local-only operational/cache state (noteSyncState, genreImageCache,
 * notification*Date timestamps, dataVersion, traktLastSyncedAt). Kept as an
 * explicit whitelist rather than an exclude-list so a newly added settings
 * field is safe-by-default (excluded) until someone deliberately opts it in. */
export const SETTINGS_EXPORT_WHITELIST: (keyof MediaVaultSettings)[] = [
  "language",
  "tmdbLanguage",
  "traktAutoSync",
  "traktSyncIntervalMinutes",
  "mediaFolderPath",
  "autoCreateNotes",
  "defaultView",
  "defaultSort",
  "defaultSortDirection",
  "ratingScale",
  "cacheDurationMinutes",
  "episodeSyncIntervalHours",
  "watchNextSidebarCollapsed",
  "watchNextUpcomingTab",
  "notificationsEnabled",
  "notificationTime",
  "notificationSilent",
  "notificationTimezone",
  "commentsPrimaryLanguage",
  "commentsAdditionalLanguages",
  "showAdultContent",
  "favoriteListSortModes",
  "noteTemplate",
];

export interface MediaVaultSettingsExport {
  type: "mediavault-settings";
  version: 1;
  settings: Partial<MediaVaultSettings>;
}

export function buildSettingsExport(
  storage: StorageService,
): MediaVaultSettingsExport {
  const current = storage.settings.get();
  const settings: Partial<MediaVaultSettings> = {};
  for (const key of SETTINGS_EXPORT_WHITELIST) {
    (settings as Record<string, unknown>)[key] = current[key];
  }
  return { type: "mediavault-settings", version: 1, settings };
}

/** Applies an imported settings block, restricted to the same whitelist
 * (defense in depth: even a hand-edited/malicious export can't smuggle a
 * credential field back in) and to only the keys actually present in the
 * import — an old export missing newer settings, or a partial/incomplete
 * settings object, leaves everything else at its current value rather than
 * resetting to defaults. */
export async function applySettingsImport(
  storage: StorageService,
  settingsExport: MediaVaultSettingsExport,
): Promise<number> {
  if (settingsExport.version > 1) {
    throw new Error("UNSUPPORTED_EXPORT_VERSION");
  }
  const patch: Partial<MediaVaultSettings> = {};
  let count = 0;
  for (const key of SETTINGS_EXPORT_WHITELIST) {
    const value = settingsExport.settings[key];
    if (value === undefined) continue;
    (patch as Record<string, unknown>)[key] = value;
    count++;
  }
  if (count > 0) await storage.settings.update(patch);
  return count;
}

export interface MediaVaultExportFile {
  mediavault: true;
  mediavault_export_format: string;
  mediavault_export_version: number;
  mediavault_plugin_version?: string;
  exportedAt: string;
  itemCount: number;
  items: MediaVaultExportItem[];
  /** Library-wide user-owned state that isn't tied to a single media item
   * (see module doc comment). Included only for lists that reference at
   * least one exported media item, and non-built-in comfort presets (the
   * built-in ones are re-seeded locally on every plugin load, so they're
   * cache-like and intentionally excluded). */
  lists: CustomList[];
  comfortPresets: ComfortPreset[];
  /** Present only when the user opted into exporting Settings Preferences
   * (see buildSettingsExport) — absent (not just empty) on exports that
   * didn't include this category, which the importer treats as "category
   * not present," not "reset to defaults." */
  settingsPreferences?: MediaVaultSettingsExport | null;
}

/**
 * Explicit, version-aware recognition of MediaVault's own export format.
 * Deliberately strict (exact marker + format name + numeric version + array
 * shape) so an arbitrary unrelated JSON/Markdown file is never mistaken for
 * one, and never inferred from the filename.
 */
export function isMediaVaultExport(
  data: unknown,
): data is MediaVaultExportFile {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return (
    d.mediavault === true &&
    d.mediavault_export_format === MEDIAVAULT_EXPORT_FORMAT &&
    typeof d.mediavault_export_version === "number" &&
    Array.isArray(d.items)
  );
}

const EXPORT_YIELD_EVERY = 25;

async function readNoteIfExists(
  app: App,
  storage: StorageService,
  media: MediaItem,
): Promise<MediaVaultExportNote | null> {
  if (!media.notePath) return null;
  const file = app.vault.getAbstractFileByPath(media.notePath);
  if (!(file instanceof TFile)) return null;

  const baseFolder = storage.settings.get().mediaFolderPath || "MediaVault";
  const folder = resolveMediaFolder(baseFolder, media.type);
  const relativePath = media.notePath.startsWith(`${folder}/`)
    ? media.notePath.slice(folder.length + 1)
    : (media.notePath.split("/").pop() ?? media.notePath);

  const content = await app.vault.adapter.read(media.notePath);
  return { relativePath, content };
}

export type ExportProgressCallback = (done: number, total: number) => void;

/**
 * Builds the portable export payload for the given media items. Processes
 * items in a simple yielding loop (not full worker-pool concurrency, since
 * each item here is mostly cheap in-memory array filtering plus at most one
 * vault read) so a large-library export doesn't block the UI thread for an
 * extended stretch.
 */
export interface ExportCategoryOptions {
  includeWatchHistory: boolean;
  includeLists: boolean;
  includeSettings: boolean;
}

const DEFAULT_EXPORT_CATEGORIES: ExportCategoryOptions = {
  includeWatchHistory: true,
  includeLists: true,
  includeSettings: false,
};

export async function buildMediaVaultExport(
  app: App,
  storage: StorageService,
  mediaItems: MediaItem[],
  onProgress?: ExportProgressCallback,
  categories: ExportCategoryOptions = DEFAULT_EXPORT_CATEGORIES,
): Promise<MediaVaultExportFile> {
  const items: MediaVaultExportItem[] = [];

  for (let i = 0; i < mediaItems.length; i++) {
    const media = mediaItems[i];
    const [watchSessions, episodes, episodeProgress, episodeWatches, comfortProfiles, note] =
      categories.includeWatchHistory
        ? await Promise.all([
            storage.watchSessions.findWhere((s) => s.mediaId === media.id),
            storage.episodes.findWhere((e) => e.mediaId === media.id),
            storage.episodeProgress.findWhere((p) => p.mediaId === media.id),
            storage.episodeWatches.findWhere((w) => w.mediaId === media.id),
            storage.comfortProfiles.findWhere((c) => c.mediaId === media.id),
            readNoteIfExists(app, storage, media),
          ])
        : await Promise.all([
            Promise.resolve([] as WatchSession[]),
            storage.episodes.findWhere((e) => e.mediaId === media.id),
            Promise.resolve([] as EpisodeProgress[]),
            Promise.resolve([] as EpisodeWatch[]),
            storage.comfortProfiles.findWhere((c) => c.mediaId === media.id),
            readNoteIfExists(app, storage, media),
          ]);

    items.push({
      media,
      watchSessions,
      episodes,
      episodeProgress,
      episodeWatches,
      comfortProfile: comfortProfiles[0] ?? null,
      note,
    });

    onProgress?.(i + 1, mediaItems.length);
    await maybeYield(i + 1, EXPORT_YIELD_EVERY);
  }

  let lists: CustomList[] = [];
  let comfortPresets: ComfortPreset[] = [];
  if (categories.includeLists) {
    const exportedMediaIds = new Set(mediaItems.map((m) => m.id));
    const allLists = await storage.customLists.getAll();
    lists = allLists.filter((list) =>
      list.mediaIds.some((id) => exportedMediaIds.has(id)),
    );
    const allPresets = await storage.comfortPresets.getAll();
    comfortPresets = allPresets.filter((p) => !p.isBuiltIn);
  }

  const settingsPreferences = categories.includeSettings
    ? buildSettingsExport(storage)
    : null;

  return {
    mediavault: true,
    mediavault_export_format: MEDIAVAULT_EXPORT_FORMAT,
    mediavault_export_version: MEDIAVAULT_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    itemCount: items.length,
    items,
    lists,
    comfortPresets,
    settingsPreferences,
  };
}

async function ensureFolderExists(app: App, folderPath: string): Promise<void> {
  const parts = folderPath.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) {
      await app.vault.createFolder(current).catch(() => {
        // Already exists (race with another creator) — fine.
      });
    }
  }
}

export async function exportMediaToVault(
  app: App,
  storage: StorageService,
  mediaItems: MediaItem[],
  onProgress?: ExportProgressCallback,
  categories: ExportCategoryOptions = DEFAULT_EXPORT_CATEGORIES,
): Promise<string> {
  const data = await buildMediaVaultExport(app, storage, mediaItems, onProgress, categories);
  const baseFolder = storage.settings.get().mediaFolderPath || "MediaVault";
  const exportsFolder = `${baseFolder.replace(/\/+$/, "")}/Exports`;
  await ensureFolderExists(app, exportsFolder);

  const stamp = data.exportedAt.replace(/[:.]/g, "-");
  const path = `${exportsFolder}/mediavault-export-${stamp}.json`;
  await app.vault.create(path, JSON.stringify(data, null, 2));
  return path;
}

// ---------------------------------------------------------------------------
// Import: identity matching + non-destructive merge
// ---------------------------------------------------------------------------

export interface ImportSummary {
  mediaCreated: number;
  mediaUpdated: number;
  episodesAdded: number;
  episodesUpdated: number;
  progressAdded: number;
  progressUpdated: number;
  watchSessionsMerged: number;
  episodeWatchesMerged: number;
  notesReconnected: number;
  listsCreated: number;
  listsUpdated: number;
  listMembershipsAdded: number;
  presetsAdded: number;
  settingsApplied: number;
  skipped: number;
  errors: { title: string; message: string }[];
}

function emptySummary(): ImportSummary {
  return {
    mediaCreated: 0,
    mediaUpdated: 0,
    episodesAdded: 0,
    episodesUpdated: 0,
    progressAdded: 0,
    progressUpdated: 0,
    watchSessionsMerged: 0,
    episodeWatchesMerged: 0,
    notesReconnected: 0,
    listsCreated: 0,
    listsUpdated: 0,
    listMembershipsAdded: 0,
    presetsAdded: 0,
    settingsApplied: 0,
    skipped: 0,
    errors: [],
  };
}

function isValidExportItem(item: unknown): item is MediaVaultExportItem {
  if (!item || typeof item !== "object") return false;
  const i = item as Record<string, unknown>;
  const media = i.media as Record<string, unknown> | undefined;
  return (
    !!media &&
    typeof media.id === "string" &&
    media.id.length > 0 &&
    typeof media.tmdbId === "number" &&
    typeof media.type === "string" &&
    typeof media.title === "string" &&
    Array.isArray(i.watchSessions) &&
    Array.isArray(i.episodes) &&
    Array.isArray(i.episodeProgress) &&
    Array.isArray(i.episodeWatches)
  );
}

function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.length === 0;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "boolean") return v === false;
  return false;
}

/** Fills only fields that are currently empty/default locally with the
 * imported value — never overwrites data the user or a TMDB refresh has
 * already populated. This is the deterministic conflict policy used for
 * every field where MediaVault has no reliable per-field timestamp to
 * arbitrate "who's newer" (see final report for rationale). */
function fillMissing<T extends object>(
  existing: T,
  imported: T,
  fields: (keyof T)[],
): Partial<T> {
  const patch: Partial<T> = {};
  for (const f of fields) {
    if (isEmptyValue(existing[f]) && !isEmptyValue(imported[f])) {
      patch[f] = imported[f];
    }
  }
  return patch;
}

/** MediaVault-owned/TMDB-derived identity & metadata fields: safe to fill
 * in when locally empty, never overwritten once populated. Deliberately
 * excludes tmdbId/type (identity, already matched on) and every
 * derived/aggregate or sync/runtime field (see module doc comment). */
const MEDIA_METADATA_FILL_FIELDS: (keyof MediaItem)[] = [
  "tvdbId",
  "imdbId",
  "tvTimeUuid",
  "originalTitle",
  "year",
  "releaseDate",
  "genres",
  "genreIds",
  "runtime",
  "posterPath",
  "backdropPath",
  "cast",
  "crew",
  "productionCompanies",
  "language",
  "country",
  "synopsis",
  "tvStatus",
  "streamingAvailability",
  "droppedReason",
  "platform",
  "notes",
  "tags",
];

function mergeMediaScalars(
  existing: MediaItem,
  imported: MediaItem,
): Partial<MediaItem> {
  const patch = fillMissing(existing, imported, MEDIA_METADATA_FILL_FIELDS);

  // status/isFavorite/liked are booleans/enums whose "empty" state is a
  // specific default rather than falsy-for-every-type, so they're handled
  // explicitly rather than through the generic emptiness check.
  if (existing.status === MediaStatus.PlanToWatch && imported.status !== MediaStatus.PlanToWatch) {
    patch.status = imported.status;
  }
  if (!existing.isFavorite && imported.isFavorite) patch.isFavorite = true;
  if (!existing.liked && imported.liked) {
    patch.liked = true;
    if (imported.likedAt) patch.likedAt = imported.likedAt;
  }

  return patch;
}

const EPISODE_METADATA_FILL_FIELDS: (keyof Episode)[] = [
  "tmdbEpisodeId",
  "title",
  "runtime",
  "airDate",
  "synopsis",
  "thumbnailPath",
  "tmdbRating",
];

function episodeKey(seasonNumber: number, episodeNumber: number): string {
  return `${seasonNumber}:${episodeNumber}`;
}

interface EpisodeReconcileResult {
  /** imported episode id -> local episode id */
  idRemap: Map<string, string>;
  added: number;
  updated: number;
}

/**
 * Reconciles imported episodes against an existing media item's episodes,
 * matched by stable identity — (seasonNumber, episodeNumber) first (the
 * durable real-world identity within a show), falling back to
 * tmdbEpisodeId — never by array position. Unmatched local episodes are
 * left untouched (never removed by an import); unmatched imported episodes
 * are added, preserving their original ID.
 */
async function reconcileEpisodes(
  storage: StorageService,
  localMediaId: string,
  importedEpisodes: Episode[],
): Promise<EpisodeReconcileResult> {
  const localEpisodes = await storage.episodes.findWhere(
    (e) => e.mediaId === localMediaId,
  );
  const byKey = new Map<string, Episode>();
  const byTmdbId = new Map<number, Episode>();
  for (const ep of localEpisodes) {
    byKey.set(episodeKey(ep.seasonNumber, ep.episodeNumber), ep);
    if (ep.tmdbEpisodeId !== null) byTmdbId.set(ep.tmdbEpisodeId, ep);
  }

  const idRemap = new Map<string, string>();
  let added = 0;
  let updated = 0;

  for (const imported of importedEpisodes) {
    const match =
      byKey.get(episodeKey(imported.seasonNumber, imported.episodeNumber)) ??
      (imported.tmdbEpisodeId !== null
        ? byTmdbId.get(imported.tmdbEpisodeId)
        : undefined);

    if (match) {
      idRemap.set(imported.id, match.id);
      const patch = fillMissing(match, imported, EPISODE_METADATA_FILL_FIELDS);
      if (Object.keys(patch).length > 0) {
        await storage.episodes.update(match.id, patch);
        updated++;
      }
      continue;
    }

    const created = await storage.episodes.save({
      ...imported,
      mediaId: localMediaId,
    });
    idRemap.set(imported.id, created.id);
    added++;
  }

  return { idRemap, added, updated };
}

const PROGRESS_USER_FIELDS: (keyof EpisodeProgress)[] = [
  "rating",
  "review",
  "emotion",
  "comfortNote",
];

interface ProgressReconcileResult {
  added: number;
  updated: number;
}

/**
 * Reconciles imported episode progress against existing local progress,
 * matched by (mediaId, local episodeId) via the remap produced by
 * reconcileEpisodes. Conflict policy:
 *  - `watched` is monotonic: once true (on either side), stays true — an
 *    import can never silently un-mark an episode as watched.
 *  - `watchedDate` follows whichever side established `watched`.
 *  - User-owned fields (rating/review/emotion/comfortNote) use whichever
 *    side has the newer `updatedAt` — this is the one place MediaVault's
 *    schema actually has a reliable per-record timestamp to arbitrate with.
 */
async function reconcileEpisodeProgress(
  storage: StorageService,
  localMediaId: string,
  importedProgress: EpisodeProgress[],
  episodeIdRemap: Map<string, string>,
): Promise<ProgressReconcileResult> {
  const localProgress = await storage.episodeProgress.findWhere(
    (p) => p.mediaId === localMediaId,
  );
  const byEpisodeId = new Map(localProgress.map((p) => [p.episodeId, p]));

  let added = 0;
  let updated = 0;

  for (const imported of importedProgress) {
    const localEpisodeId =
      episodeIdRemap.get(imported.episodeId) ?? imported.episodeId;
    const existing = byEpisodeId.get(localEpisodeId);

    if (!existing) {
      await storage.episodeProgress.save({
        ...imported,
        mediaId: localMediaId,
        episodeId: localEpisodeId,
      });
      added++;
      continue;
    }

    const finalWatched = existing.watched || imported.watched;
    const importIsNewer = imported.updatedAt > existing.updatedAt;

    const patch: Partial<EpisodeProgress> = {};
    if (finalWatched !== existing.watched) patch.watched = finalWatched;
    if (finalWatched && !existing.watched && imported.watchedDate) {
      patch.watchedDate = imported.watchedDate;
    }
    if (!finalWatched) {
      patch.watchedDate = null;
    }
    if (!existing.isFavorite && imported.isFavorite) patch.isFavorite = true;
    if (!existing.liked && imported.liked) {
      patch.liked = true;
      if (imported.likedAt) patch.likedAt = imported.likedAt;
    }
    if (importIsNewer) {
      // Newer side wins outright for these fields (not just fill-missing),
      // since updatedAt gives us real evidence of recency here.
      for (const f of PROGRESS_USER_FIELDS) {
        if (!isEmptyValue(imported[f])) (patch as Record<string, unknown>)[f] = imported[f];
      }
    }

    if (Object.keys(patch).length > 0) {
      // Note: EpisodeProgressRepository.update() always stamps its own
      // `updatedAt = now` regardless of what's in the patch (existing
      // repository behavior, unrelated to this feature) — which is fine
      // here: a genuinely no-op second import produces an empty patch and
      // never calls update() at all, so idempotency still holds.
      await storage.episodeProgress.update(existing.id, patch);
      updated++;
    }
  }

  return { added, updated };
}

const COMFORT_PROFILE_MERGE_FIELDS: (keyof ComfortProfile)[] = [
  "comfortScore",
  "energyLevel",
  "attentionLevel",
  "emotionalHeaviness",
  "plotComplexity",
  "rewatchability",
  "flags",
  "seasonalTags",
  "triggerWarnings",
];

/**
 * Merges an imported comfort profile into the local one for the same
 * media. Unlike MediaItem (whose `updatedAt` bumps on any write, not just
 * user edits), ComfortProfile's `updatedAt` genuinely only changes on a
 * direct edit — so "newer wins outright" is a safe, deterministic policy
 * here: if the import is newer, its preference values replace the local
 * ones wholesale (these are singular preference fields that can't be
 * meaningfully field-merged, e.g. two different `comfortScore` values);
 * otherwise the existing local profile is left untouched.
 */
async function reconcileComfortProfile(
  storage: StorageService,
  localMediaId: string,
  imported: ComfortProfile,
): Promise<void> {
  const existing = await storage.comfortProfiles.findByMediaId(localMediaId);
  if (!existing) {
    await storage.comfortProfiles.save({ ...imported, mediaId: localMediaId });
    return;
  }
  if (imported.updatedAt <= existing.updatedAt) return;

  const patch: Partial<ComfortProfile> = {};
  for (const f of COMFORT_PROFILE_MERGE_FIELDS) {
    (patch as Record<string, unknown>)[f] = imported[f];
  }
  await storage.comfortProfiles.update(existing.id, patch);
}

/** Additively merges records that are de-duplicated purely by their own
 * stable ID (watch sessions, episode watches) — consistent with
 * MediaVault's existing "watch records are never overwritten" invariant.
 * Idempotent: importing the same record twice is a no-op the second time. */
async function mergeAdditiveById<T extends { id: string }>(
  incoming: T[],
  findById: (id: string) => Promise<T | null>,
  save: (record: T) => Promise<T>,
): Promise<number> {
  let addedCount = 0;
  for (const record of incoming) {
    const existing = await findById(record.id);
    if (existing) continue;
    await save(record);
    addedCount++;
  }
  return addedCount;
}

/** Non-built-in comfort presets are additive-by-id, same as watch records —
 * ComfortPreset has no updatedAt to arbitrate recency, and presets aren't
 * tied to media so there's no natural "fill missing" merge either. */
async function reconcileComfortPresets(
  storage: StorageService,
  presets: ComfortPreset[],
): Promise<number> {
  return mergeAdditiveById(
    presets,
    (id) => storage.comfortPresets.findById(id),
    (r) => storage.comfortPresets.save(r),
  );
}

/**
 * Reconciles imported lists against local ones, matched by stable list ID.
 * A missing local list is created (original ID preserved). An existing
 * list's own metadata (title/description/sortMode) is filled in only where
 * locally empty — the same non-destructive policy used for MediaItem,
 * since CustomList's `updatedAt` bumps on membership changes too and so
 * can't reliably distinguish "user renamed this" from "the app touched
 * it." Membership is merged additively: imported media IDs (remapped
 * through `mediaIdRemap`) are appended if the referenced media exists
 * locally and isn't already a member — existing local membership and
 * ordering are never disturbed, and membership referencing media absent
 * from both the import and the local library is safely skipped rather
 * than failing the whole list (see spec: absence must not crash or
 * silently corrupt the list).
 */
async function reconcileLists(
  storage: StorageService,
  lists: CustomList[],
  mediaIdRemap: Map<string, string>,
): Promise<{ created: number; updated: number; membershipsAdded: number }> {
  let created = 0;
  let updated = 0;
  let membershipsAdded = 0;

  const LIST_METADATA_FILL_FIELDS: (keyof CustomList)[] = [
    "description",
    "posterUrl",
    "bannerUrl",
  ];

  for (const importedList of lists) {
    const remappedMemberIds = importedList.mediaIds
      .map((id) => mediaIdRemap.get(id) ?? id)
      .filter((id, index, arr) => arr.indexOf(id) === index);

    const existing = await storage.customLists.findById(importedList.id);

    if (!existing) {
      // Only include members that actually resolve to a media item that
      // exists locally — anything else is silently dropped from this new
      // list rather than left as a dangling reference.
      const resolvable: string[] = [];
      for (const id of remappedMemberIds) {
        if (await storage.media.findById(id)) resolvable.push(id);
      }
      await storage.customLists.save({
        ...importedList,
        mediaIds: resolvable,
      });
      created++;
      continue;
    }

    const metadataPatch = fillMissing(existing, importedList, LIST_METADATA_FILL_FIELDS);
    const newMemberIds: string[] = [];
    for (const id of remappedMemberIds) {
      if (existing.mediaIds.includes(id)) continue;
      if (await storage.media.findById(id)) newMemberIds.push(id);
    }

    if (newMemberIds.length > 0) {
      metadataPatch.mediaIds = [...existing.mediaIds, ...newMemberIds];
      membershipsAdded += newMemberIds.length;
    }

    if (Object.keys(metadataPatch).length > 0) {
      await storage.customLists.update(existing.id, metadataPatch);
      updated++;
    }
  }

  return { created, updated, membershipsAdded };
}

const IMPORT_YIELD_EVERY = 10;

export interface ImportProgressCallback {
  (done: number, total: number): void;
}

/**
 * Imports a MediaVault export. Existing media is matched by stable ID, then
 * TMDB ID + type, and is never overwritten wholesale or duplicated —
 * scalar fields are merged via `mergeMediaScalars`, episodes/progress via
 * identity-based reconciliation, and watch history/episode-watches
 * additively by stable ID. Every one of these merges is designed to be a
 * no-op on a second import of the same export (see reconcile* / mergeAdditive*
 * doc comments for exactly why each one is idempotent).
 *
 * Processes items sequentially with a yield every few items so a large
 * import doesn't block Obsidian's UI thread for an extended stretch.
 */
export interface ImportCategoryOptions {
  includeMovies: boolean;
  includeTVShows: boolean;
  includeWatchHistory: boolean;
  includeLists: boolean;
  includeSettings: boolean;
}

export const DEFAULT_IMPORT_CATEGORIES: ImportCategoryOptions = {
  includeMovies: true,
  includeTVShows: true,
  includeWatchHistory: true,
  includeLists: true,
  includeSettings: false,
};

export interface ExportContents {
  hasMovies: boolean;
  hasTVShows: boolean;
  hasWatchHistory: boolean;
  hasLists: boolean;
  hasSettings: boolean;
  movieCount: number;
  tvCount: number;
}

/** Inspects an already-parsed, already-recognized export to determine which
 * categories are actually present, so the import UI can only offer choices
 * that exist in this particular file (an old export with no Settings
 * Preferences simply won't show that checkbox). */
export function describeExportContents(
  data: MediaVaultExportFile,
): ExportContents {
  const movieCount = data.items.filter((i) => i.media?.type === MediaType.Movie).length;
  const tvCount = data.items.filter((i) => i.media?.type === MediaType.TVShow).length;
  const hasWatchHistory = data.items.some(
    (i) => i.watchSessions?.length > 0 || i.episodeWatches?.length > 0,
  );
  return {
    hasMovies: movieCount > 0,
    hasTVShows: tvCount > 0,
    hasWatchHistory,
    hasLists: (data.lists?.length ?? 0) > 0 || (data.comfortPresets?.length ?? 0) > 0,
    hasSettings: !!data.settingsPreferences,
    movieCount,
    tvCount,
  };
}

export async function importMediaVaultExport(
  app: App,
  storage: StorageService,
  raw: string,
  onProgress?: ImportProgressCallback,
  categories: ImportCategoryOptions = DEFAULT_IMPORT_CATEGORIES,
): Promise<ImportSummary> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!isMediaVaultExport(parsed)) {
    throw new Error("NOT_MEDIAVAULT_EXPORT");
  }

  if (parsed.mediavault_export_version > MEDIAVAULT_EXPORT_VERSION) {
    throw new Error("UNSUPPORTED_EXPORT_VERSION");
  }

  const summary = emptySummary();
  const baseFolder = storage.settings.get().mediaFolderPath || "MediaVault";
  const itemsToProcess = parsed.items.filter((item) => {
    const type = item?.media?.type;
    if (type === MediaType.Movie) return categories.includeMovies;
    if (type === MediaType.TVShow) return categories.includeTVShows;
    return true; // unknown/other media types are not filtered out
  });
  const total = itemsToProcess.length;
  /** original exported media ID -> local media ID, used after the item
   * loop to remap list membership. Populated for both branches below (an
   * existing-media match with a different local ID, and a freshly created
   * media record that preserves its original ID). */
  const mediaIdRemap = new Map<string, string>();

  for (let i = 0; i < itemsToProcess.length; i++) {
    const item = itemsToProcess[i];

    if (!isValidExportItem(item)) {
      summary.skipped++;
      summary.errors.push({
        title: "(unknown)",
        message: "Missing required fields (media id, tmdb id, type, title, or sub-record arrays).",
      });
      onProgress?.(i + 1, total);
      continue;
    }

    try {
      const existing =
        (await storage.media.findById(item.media.id)) ??
        (
          await storage.media.findWhere(
            (m) => m.tmdbId === item.media.tmdbId && m.type === item.media.type,
          )
        )[0] ??
        null;

      if (existing) {
        mediaIdRemap.set(item.media.id, existing.id);

        const scalarPatch = mergeMediaScalars(existing, item.media);
        if (Object.keys(scalarPatch).length > 0) {
          await storage.media.update(existing.id, scalarPatch);
          summary.mediaUpdated++;
        }

        const { idRemap, added: epAdded, updated: epUpdated } =
          await reconcileEpisodes(storage, existing.id, item.episodes);
        summary.episodesAdded += epAdded;
        summary.episodesUpdated += epUpdated;

        let progAdded = 0;
        let progUpdated = 0;
        let sessionsMergedThisItem = 0;
        let watchesMergedThisItem = 0;

        if (categories.includeWatchHistory) {
          const progResult = await reconcileEpisodeProgress(
            storage,
            existing.id,
            item.episodeProgress,
            idRemap,
          );
          progAdded = progResult.added;
          progUpdated = progResult.updated;
          summary.progressAdded += progAdded;
          summary.progressUpdated += progUpdated;

          const remappedWatches = item.episodeWatches.map((w) => ({
            ...w,
            mediaId: existing.id,
            episodeId: idRemap.get(w.episodeId) ?? w.episodeId,
          }));
          watchesMergedThisItem = await mergeAdditiveById(
            remappedWatches,
            (id) => storage.episodeWatches.findById(id),
            (r) => storage.episodeWatches.save(r),
          );
          summary.episodeWatchesMerged += watchesMergedThisItem;

          const remappedSessions = item.watchSessions.map((s) => ({
            ...s,
            mediaId: existing.id,
            episodeId: s.episodeId ? (idRemap.get(s.episodeId) ?? s.episodeId) : null,
          }));
          sessionsMergedThisItem = await mergeAdditiveById(
            remappedSessions,
            (id) => storage.watchSessions.findById(id),
            (r) => storage.watchSessions.save(r),
          );
          summary.watchSessionsMerged += sessionsMergedThisItem;
        }

        if (sessionsMergedThisItem > 0 || progAdded + progUpdated > 0) {
          await syncMediaAggregates(storage, existing.id);
          await recalculateAndPersistStatus(storage, existing.id);
        }

        if (item.comfortProfile) {
          await reconcileComfortProfile(storage, existing.id, item.comfortProfile);
        }

        if (!existing.notePath && item.note) {
          const notePath = resolveMediaNotePath(baseFolder, existing);
          await ensureFolderExists(app, resolveMediaFolder(baseFolder, existing.type));
          if (!app.vault.getAbstractFileByPath(notePath)) {
            await app.vault.create(notePath, item.note.content);
            await storage.media.update(existing.id, { notePath });
            summary.notesReconnected++;
          }
        }

        onProgress?.(i + 1, total);
        await maybeYield(i + 1, IMPORT_YIELD_EVERY);
        continue;
      }

      // No existing media — reconstruct it, preserving the original
      // stable media ID and every related record's original ID (episodes,
      // progress, watch sessions, episode watches, comfort profile) rather
      // than generating new ones, so relationships stay intact and a
      // second import of the same export finds this exact record by ID and
      // takes the "existing" branch above (idempotent).
      await storage.media.save(item.media);
      await Promise.all([
        ...item.episodes.map((e) => storage.episodes.save(e)),
        ...(categories.includeWatchHistory
          ? [
              ...item.episodeProgress.map((p) => storage.episodeProgress.save(p)),
              ...item.watchSessions.map((s) => storage.watchSessions.save(s)),
              ...item.episodeWatches.map((w) => storage.episodeWatches.save(w)),
            ]
          : []),
        ...(item.comfortProfile ? [storage.comfortProfiles.save(item.comfortProfile)] : []),
      ]);

      if (item.note) {
        const notePath = resolveMediaNotePath(baseFolder, item.media);
        await ensureFolderExists(app, resolveMediaFolder(baseFolder, item.media.type));
        if (!app.vault.getAbstractFileByPath(notePath)) {
          await app.vault.create(notePath, item.note.content);
          await storage.media.update(item.media.id, { notePath });
        }
      }

      mediaIdRemap.set(item.media.id, item.media.id);
      summary.mediaCreated++;
    } catch (err) {
      summary.skipped++;
      summary.errors.push({
        title: item.media?.title ?? "(unknown)",
        message: err instanceof Error ? err.message : String(err),
      });
    }

    onProgress?.(i + 1, total);
    await maybeYield(i + 1, IMPORT_YIELD_EVERY);
  }

  // Lists/presets are library-wide, not per-media, so they're reconciled
  // once after every media item has been processed and mediaIdRemap is
  // complete. `?? []` keeps this forward/backward tolerant of exports
  // written before these fields existed (still format/version 1 — see
  // module doc comment for why that's treated as safe here).
  if (categories.includeLists) {
    summary.presetsAdded = await reconcileComfortPresets(
      storage,
      parsed.comfortPresets ?? [],
    );
    const listResult = await reconcileLists(
      storage,
      parsed.lists ?? [],
      mediaIdRemap,
    );
    summary.listsCreated = listResult.created;
    summary.listsUpdated = listResult.updated;
    summary.listMembershipsAdded = listResult.membershipsAdded;
  }

  if (categories.includeSettings && parsed.settingsPreferences) {
    try {
      summary.settingsApplied = await applySettingsImport(
        storage,
        parsed.settingsPreferences,
      );
    } catch (err) {
      summary.errors.push({
        title: "Settings Preferences",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summary;
}
