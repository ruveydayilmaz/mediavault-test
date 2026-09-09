import type { App } from "obsidian";
import type { StorageService } from "./storage";
import type { MediaItem } from "../models/media";
import type { NoteSyncState } from "../settings/settings";
import { generateMediaNote } from "./note-generator/media-note-generator";
import { mapWithConcurrency } from "./importer/concurrency";
import { maybeYield } from "./importer/yield";
import { confirmDialog } from "../ui/modals/confirm-modal";
import { t } from "../i18n";
import { Notice } from "obsidian";

const SYNC_CONCURRENCY = 4;
const YIELD_EVERY = 5;
const CHECKPOINT_EVERY = 10;
const MAX_RECONCILE_PASSES = 3;

export type SyncProgressCallback = (done: number, total: number) => void;

/**
 * Keeps MediaVault-generated Markdown notes in sync with the underlying
 * media data. See the class-level notes below for the design rationale.
 *
 * What "synced" means here: every syncable media item's MediaVault-owned
 * note content (see media-note-generator.ts / media-frontmatter.ts) has
 * been written to its note, without touching anything the user owns, as of
 * `noteSyncState.lastSuccessfulSyncAt`. It does NOT mean "the sync routine
 * ran" — `lastSuccessfulSyncAt` is only advanced once a full pass completes
 * with zero failures and no further changes are detected (see `runSync`).
 *
 * Persistence: sync state lives in `settings.noteSyncState`, alongside the
 * rest of MediaVault's settings — reusing the existing settings
 * persistence/backfill machinery rather than introducing a second storage
 * mechanism (e.g. a dedicated vault file) for what is, functionally,
 * exactly the kind of small structured app state settings already store.
 *
 * Change detection: rather than trusting `noteSyncState` alone, every check
 * recomputes "is anything actually out of date" from the real source of
 * truth — each MediaItem's `updatedAt` versus `lastSuccessfulSyncAt`. A
 * stale/incorrect `lastSuccessfulSyncAt` therefore self-corrects: it can
 * only under-trust (triggering an extra, harmless, no-op-writes sync pass)
 * never over-trust (silently skipping real changes).
 *
 * Loop safety: notes are only rewritten when their generated content
 * actually differs from what's on disk (see media-note-generator.ts), and a
 * note write does not touch `media.updatedAt`, so MediaVault's own writes
 * can never look like a "media change" that needs re-syncing.
 */
export class NoteSyncService {
  private running = false;
  private deferredThisSession = false;

  constructor(
    private app: App,
    private storage: StorageService,
  ) {}

  isRunning(): boolean {
    return this.running;
  }

  /** Media eligible for sync: only items that already have a generated
   * note. Sync never creates notes for items that were never generated —
   * that would be unexpected file creation outside what the user asked
   * for (see spec §22/§45). */
  private async syncableMedia(): Promise<MediaItem[]> {
    return this.storage.media.findWhere((m) => !!m.notePath);
  }

  private latestUpdatedAt(items: MediaItem[]): string | null {
    let latest: string | null = null;
    for (const item of items) {
      if (!latest || item.updatedAt > latest) latest = item.updatedAt;
    }
    return latest;
  }

  private state(): NoteSyncState {
    return this.storage.settings.get().noteSyncState;
  }

  private async patchState(patch: Partial<NoteSyncState>): Promise<void> {
    await this.storage.settings.update({
      noteSyncState: { ...this.state(), ...patch },
    });
  }

  /**
   * Called once on plugin load. Cheap when nothing needs to happen: a
   * single in-memory scan of already-loaded media, no file I/O, unless a
   * sync (or a resume prompt) actually needs to run.
   */
  async checkOnStartup(): Promise<void> {
    const state = this.state();

    if (state.status === "syncing") {
      // A `syncing` state that survived a restart means the previous
      // session ended (Obsidian closed, crashed, etc.) before the run
      // reached a terminal state — Obsidian plugins cannot keep running
      // after the app closes, so this is our only signal of interruption.
      await this.patchState({ status: "interrupted" });
    }

    const afterInterrupt = this.state();
    if (
      afterInterrupt.status === "interrupted" &&
      afterInterrupt.pendingMediaIds.length > 0 &&
      !this.deferredThisSession
    ) {
      const proceed = await confirmDialog(
        this.app,
        t("noteSync.interruptedPrompt", {
          done: afterInterrupt.completedItems,
          total: afterInterrupt.totalItems,
        }),
        t("noteSync.continueSync"),
        t("noteSync.later"),
      );
      if (proceed) {
        await this.runSync({ resume: true });
      } else {
        this.deferredThisSession = true;
      }
      return;
    }

    await this.checkAndSyncIfNeeded();
  }

  /** Lightweight change check; starts a background sync only if something
   * is actually out of date. Safe to call repeatedly (e.g. after media
   * edits, from a debounce timer, or from the manual command). */
  async checkAndSyncIfNeeded(): Promise<void> {
    if (this.running) return;

    const state = this.state();
    if (state.status === "syncing") return;

    const syncable = await this.syncableMedia();
    const latest = this.latestUpdatedAt(syncable);

    const needsSync =
      state.lastSuccessfulSyncAt === null ||
      (latest !== null && latest > state.lastSuccessfulSyncAt);

    if (!needsSync) return;

    await this.runSync({ resume: false });
  }

  /** Manual trigger (command palette / settings button). */
  async runManualSync(onProgress?: SyncProgressCallback): Promise<void> {
    if (this.running) {
      new Notice(t("noteSync.alreadyRunning"));
      return;
    }
    this.deferredThisSession = false;
    const state = this.state();
    const resume =
      state.status === "interrupted" && state.pendingMediaIds.length > 0;
    await this.runSync({ resume, onProgress });
  }

  private async computeQueue(resume: boolean): Promise<MediaItem[]> {
    const state = this.state();
    const syncable = await this.syncableMedia();

    const changed =
      state.lastSuccessfulSyncAt === null
        ? syncable
        : syncable.filter((m) => m.updatedAt > state.lastSuccessfulSyncAt!);

    if (!resume) return changed;

    // Resuming: only items still pending from the interrupted run, plus
    // anything that changed after that run started (so nothing that
    // changed mid-interruption gets silently dropped).
    const pendingSet = new Set(state.pendingMediaIds);
    const startedAt = state.lastSyncStartedAt;
    return changed.filter(
      (m) => pendingSet.has(m.id) || (startedAt !== null && m.updatedAt > startedAt),
    );
  }

  private async runSync(opts: {
    resume: boolean;
    onProgress?: SyncProgressCallback;
  }): Promise<void> {
    this.running = true;
    try {
      let queue = await this.computeQueue(opts.resume);
      if (queue.length === 0) {
        await this.patchState({
          status: "completed",
          lastSuccessfulSyncAt: new Date().toISOString(),
          lastSyncCompletedAt: new Date().toISOString(),
          pendingMediaIds: [],
          failedMediaIds: [],
        });
        return;
      }

      const runStartedAt = new Date().toISOString();
      let totalSeen = 0;
      let completedTotal = 0;
      const allFailedIds = new Set<string>();

      await this.patchState({
        status: "syncing",
        lastSyncStartedAt: runStartedAt,
        totalItems: queue.length,
        completedItems: 0,
        pendingMediaIds: queue.map((m) => m.id),
        failedMediaIds: [],
      });

      let passStart = runStartedAt;
      let pass = 0;
      let converged = false;

      while (pass < MAX_RECONCILE_PASSES) {
        totalSeen += queue.length;
        const pendingIds = new Set(queue.map((m) => m.id));
        let processedInPass = 0;

        await mapWithConcurrency(queue, SYNC_CONCURRENCY, async (media) => {
          try {
            await generateMediaNote(this.app, this.storage, media);
            allFailedIds.delete(media.id);
          } catch (err) {
            allFailedIds.add(media.id);
            console.warn(
              `MediaVault: note sync failed for "${media.title}" (${media.id})`,
              err,
            );
          }

          pendingIds.delete(media.id);
          completedTotal++;
          processedInPass++;

          if (
            processedInPass % CHECKPOINT_EVERY === 0 ||
            processedInPass === queue.length
          ) {
            await this.patchState({
              completedItems: completedTotal,
              pendingMediaIds: [...pendingIds],
              failedMediaIds: [...allFailedIds],
            });
            opts.onProgress?.(completedTotal, totalSeen);
          }

          await maybeYield(processedInPass, YIELD_EVERY);
        });

        pass++;
        const checkAt = new Date().toISOString();
        const syncable = await this.syncableMedia();
        const newlyChanged = syncable.filter((m) => m.updatedAt > passStart);

        if (newlyChanged.length === 0) {
          passStart = checkAt;
          converged = true;
          break;
        }

        queue = newlyChanged;
        passStart = checkAt;
      }

      const completedAt = new Date().toISOString();
      if (converged && allFailedIds.size === 0) {
        await this.patchState({
          status: "completed",
          lastSuccessfulSyncAt: passStart,
          lastSyncCompletedAt: completedAt,
          completedItems: completedTotal,
          totalItems: totalSeen,
          pendingMediaIds: [],
          failedMediaIds: [],
        });
      } else if (allFailedIds.size > 0) {
        // Some items failed — leave lastSuccessfulSyncAt where it was so
        // the next check re-includes the failed items (their updatedAt is
        // still newer than the last successful sync) and retries them.
        await this.patchState({
          status: "failed",
          lastSyncCompletedAt: completedAt,
          completedItems: completedTotal,
          totalItems: totalSeen,
          pendingMediaIds: [...allFailedIds],
          failedMediaIds: [...allFailedIds],
        });
      } else {
        // Media kept changing faster than we could converge within the
        // reconciliation-pass budget — real progress was made and written,
        // but we can't yet claim a fully clean state. Leave status idle so
        // the next check picks up whatever is still outstanding.
        await this.patchState({
          status: "idle",
          lastSyncCompletedAt: completedAt,
          completedItems: completedTotal,
          totalItems: totalSeen,
          pendingMediaIds: [],
          failedMediaIds: [],
        });
      }
    } finally {
      this.running = false;
    }
  }
}
