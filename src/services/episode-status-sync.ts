import type { StorageService } from "./storage";
import { Episode, EpisodeProgress } from "../models/episode";
import { MediaVaultId } from "../types/common";
import { recalculateAndPersistStatus } from "./status-service";
import { addWatchSession } from "./watch-session-service";
import { touchMediaActivity } from "./activity-service";

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

/**
 * All of a show's episodes that come strictly before `target` (by season,
 * then episode number) and are not yet marked watched — i.e. exactly the
 * set Smart Episode Completion (Milestone 3) should offer to backfill when
 * the user jumps ahead and marks e.g. S2E7 without having watched S2E1–6
 * or earlier seasons. Returns them in watch order, oldest first, so a
 * caller can pass the result straight to `markSeasonWatched`.
 */
export function findUnwatchedPrecedingEpisodes(
	allEpisodes: Episode[],
	target: Episode,
	progress: EpisodeProgress[]
): Episode[] {
	const watchedEpisodeIds = new Set(progress.filter((p) => p.watched).map((p) => p.episodeId));

	return [...allEpisodes]
		.filter((e) => e.id !== target.id)
		.filter(
			(e) =>
				e.seasonNumber < target.seasonNumber ||
				(e.seasonNumber === target.seasonNumber && e.episodeNumber < target.episodeNumber)
		)
		.filter((e) => !watchedEpisodeIds.has(e.id))
		.sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
}

/**
 * Marks a single episode watched/unwatched, then recalculates the parent
 * show's status. This is the function UI code, imports, and sync should
 * call instead of `storage.episodeProgress.markWatched` directly, so
 * status recalculation can never be forgotten at a call site.
 *
 * Milestone 2 (TV Watch Logging Logic): marking an individual episode
 * watched only updates EpisodeProgress — it does NOT create a WatchSession
 * on its own. A WatchSession is only auto-created when this transition is
 * the one that completes the entire series (every episode across every
 * season now watched); that single session represents "I finished this
 * series," not "I watched this episode." Movies are untouched — this
 * module only ever deals with episodes.
 */
export async function markEpisodeWatched(
	storage: StorageService,
	episode: Episode,
	watched: boolean,
	watchedDate?: string,
	options?: { skipWatchRecord?: boolean }
): Promise<EpisodeProgress> {
	const wasSeriesComplete = await isSeriesFullyWatched(storage, episode.mediaId);
	const wasWatched = (await storage.episodeProgress.findByEpisodeId(episode.id))?.watched ?? false;

	const progress = await storage.episodeProgress.markWatched(episode, watched, watchedDate);

	// Milestone 1 (Episode Watch Review Card Synchronization): every path
	// that marks an episode watched funnels through here, so creating the
	// review card here — once, only on the actual unwatched→watched
	// transition — guarantees it happens everywhere (Episode List, Watch
	// Next, imports/sync) without every call site having to remember to.
	// `skipWatchRecord` exists only for callers (like `addEpisodeWatch`)
	// that already created their own — richer — record for this exact
	// transition, so we never end up with two.
	if (watched && !wasWatched && !options?.skipWatchRecord) {
		await storage.episodeWatches.create({
			mediaId: episode.mediaId,
			episodeId: episode.id,
			watchedAt: watchedDate ?? today(),
			rating: null,
			emotion: null,
			review: null,
			notes: null,
		});
	}

	if (watched) {
		await touchMediaActivity(storage, episode.mediaId);
		const isSeriesCompleteNow = await isSeriesFullyWatched(storage, episode.mediaId);
		if (isSeriesCompleteNow && !wasSeriesComplete) {
			await addWatchSession(storage, {
				mediaId: episode.mediaId,
				watchDate: watchedDate ?? today(),
			});
		}
	} else if (wasWatched) {
		// Milestone 1 (Episode Watch History Consistency): unmarking
		// undoes the watch it corresponds to — the most recent
		// EpisodeWatch for this episode — rating/emotion/review and all,
		// whether or not the user had filled any of that in yet. This is
		// the toggle path (checkbox on/off); an intentional rewatch via
		// "Add another episode watch" is a separate, explicit action that
		// still always adds a new record.
		await deleteLatestEpisodeWatch(storage, episode.id);
	}

	await recalculateAndPersistStatus(storage, episode.mediaId);
	return progress;
}

/** Deletes the most-recently-created EpisodeWatch for an episode, if any. */
async function deleteLatestEpisodeWatch(storage: StorageService, episodeId: MediaVaultId): Promise<void> {
	const watches = await storage.episodeWatches.findByEpisodeId(episodeId);
	if (watches.length === 0) return;
	const latest = [...watches].sort((a, b) => (a.watchedAt === b.watchedAt ? a.createdAt.localeCompare(b.createdAt) : a.watchedAt.localeCompare(b.watchedAt)))[watches.length - 1];
	await storage.episodeWatches.delete(latest.id);
}

/**
 * Removes exactly one watch from an episode (the adaptive watch button's
 * long-press undo). Reuses the existing pipeline rather than duplicating
 * it: if this is the episode's only remaining watch, it goes through the
 * exact same unwatch path as `markEpisodeWatched(storage, episode, false)`
 * — which already deletes the record, flips EpisodeProgress back to
 * unwatched, and recalculates the parent show's status — so the episode
 * ends up exactly as if it had never been watched, with no orphaned
 * progress/status state. Otherwise it's a plain rewatch decrement: only
 * the latest EpisodeWatch record is removed and the episode stays marked
 * watched, matching the ×5 → ×4 behavior with nothing else to recalculate.
 */
export async function removeOneEpisodeWatch(storage: StorageService, episode: Episode): Promise<void> {
	const watches = await storage.episodeWatches.findByEpisodeId(episode.id);
	if (watches.length <= 1) {
		await markEpisodeWatched(storage, episode, false);
	} else {
		await deleteLatestEpisodeWatch(storage, episode.id);
	}
}

/**
 * Batch-marks every episode in a season, then recalculates status once
 * (not once per episode) — cheaper and avoids the status flapping through
 * intermediate "Watching" states mid-batch.
 *
 * Milestone 2 (TV Watch Logging Logic): like `markEpisodeWatched`, this no
 * longer logs a WatchSession per episode. If the batch is the one that
 * pushes the series from incomplete to fully watched (e.g. Smart Episode
 * Completion backfilling the rest of a season, or "mark whole show
 * watched"), exactly one series-level WatchSession is appended for the
 * whole show — never one per episode in the batch.
 */
export async function markSeasonWatched(
	storage: StorageService,
	episodes: Episode[],
	watched: boolean
): Promise<EpisodeProgress[]> {
	const mediaId = episodes.length > 0 ? episodes[0].mediaId : "";
	const wasSeriesComplete = episodes.length > 0 ? await isSeriesFullyWatched(storage, mediaId) : false;

	const priorProgress = await storage.episodeProgress.findByMediaId(mediaId);
	const wasWatchedByEpisodeId = new Set(priorProgress.filter((p) => p.watched).map((p) => p.episodeId));

	const results = await storage.episodeProgress.markSeasonWatched(episodes, watched);

	if (watched) {
		const today_ = today();
		for (const episode of episodes) {
			if (!wasWatchedByEpisodeId.has(episode.id)) {
				await storage.episodeWatches.create({
					mediaId: episode.mediaId,
					episodeId: episode.id,
					watchedAt: today_,
					rating: null,
					emotion: null,
					review: null,
					notes: null,
				});
			}
		}
	} else {
		for (const episode of episodes) {
			if (wasWatchedByEpisodeId.has(episode.id)) {
				await deleteLatestEpisodeWatch(storage, episode.id);
			}
		}
	}

	if (watched && episodes.length > 0) {
		await touchMediaActivity(storage, mediaId);
		const isSeriesCompleteNow = await isSeriesFullyWatched(storage, mediaId);
		if (isSeriesCompleteNow && !wasSeriesComplete) {
			await addWatchSession(storage, {
				mediaId,
				watchDate: today(),
			});
		}
	}

	if (episodes.length > 0) {
		await recalculateAndPersistStatus(storage, mediaId);
	}
	return results;
}

/**
 * True when a show has at least one episode and every episode is currently
 * marked watched. Used to detect the exact transition (incomplete →
 * complete) that should auto-log a series-level WatchSession, so re-saving
 * an already-complete show, or a show with zero imported episodes, never
 * creates one.
 */
export async function isSeriesFullyWatched(storage: StorageService, mediaId: MediaVaultId): Promise<boolean> {
	const [allEpisodes, progress] = await Promise.all([
		storage.episodes.findByMediaId(mediaId),
		storage.episodeProgress.findByMediaId(mediaId),
	]);
	if (allEpisodes.length === 0) return false;

	const watchedEpisodeIds = new Set(progress.filter((p) => p.watched).map((p) => p.episodeId));
	return allEpisodes.every((e) => watchedEpisodeIds.has(e.id));
}
