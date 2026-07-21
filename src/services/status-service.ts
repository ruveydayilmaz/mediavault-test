import { MediaItem } from "../models/media";
import { MediaStatus, MediaType } from "../types/enums";
import { WatchSession } from "../models/review";
import { Episode, EpisodeProgress } from "../models/episode";
import type { StorageService } from "./storage";

/**
 * Statuses the user sets explicitly and that automatic recalculation must
 * never overwrite. The "override" is represented purely by the media's
 * current status being one of these — there's no separate flag to keep in
 * sync, which means it's impossible for the override bit to drift out of
 * sync with the status itself.
 */
const MANUAL_OVERRIDE_STATUSES: ReadonlySet<MediaStatus> = new Set([
	MediaStatus.Dropped,
	MediaStatus.OnHold,
	MediaStatus.WatchLater,
]);

/** TMDB TV statuses that mean "this show is done," as opposed to more episodes being expected. */
export const ENDED_TV_STATUSES: ReadonlySet<string> = new Set(["Ended", "Canceled"]);

export interface StatusCalculationContext {
	sessions: WatchSession[];
	episodes: Episode[];
	episodeProgress: EpisodeProgress[];
}

export function isReleased(episode: Episode, now: Date): boolean {
	// No air date on record is treated conservatively as "not yet released" —
	// an episode MediaVault doesn't know has aired shouldn't count against
	// the user for not having watched it yet.
	if (!episode.airDate) return false;
	return new Date(episode.airDate).getTime() <= now.getTime();
}

/**
 * Pure calculation of what a media item's status SHOULD be right now,
 * given its watch history / episode progress. This is the single source
 * of truth for status logic — every mutation path (logging a watch,
 * marking episodes, imports, Trakt sync, metadata refresh) should route
 * through this function (via recalculateAndPersistStatus below) rather
 * than setting `status` directly.
 *
 * Manual overrides (Dropped, On Hold, Watch Later) are always preserved: if
 * the media's current status is one of those, this function returns it
 * unchanged.
 */
export function calculateMediaStatus(
	media: Pick<MediaItem, "type" | "status" | "tvStatus">,
	ctx: StatusCalculationContext,
	now: Date = new Date()
): MediaStatus {
	if (MANUAL_OVERRIDE_STATUSES.has(media.status)) {
		return media.status;
	}

	if (media.type === MediaType.Movie) {
		if (ctx.sessions.length > 0) return MediaStatus.Completed;
		return MediaStatus.PlanToWatch;
	}

	// --- TV Show ---
	const releasedEpisodes = ctx.episodes.filter((e) => isReleased(e, now));
	const progressByEpisodeId = new Map(ctx.episodeProgress.map((p) => [p.episodeId, p]));
	const watchedReleasedCount = releasedEpisodes.filter((e) => progressByEpisodeId.get(e.id)?.watched).length;

	if (watchedReleasedCount === 0) {
		return MediaStatus.PlanToWatch;
	}

	const allReleasedWatched = watchedReleasedCount >= releasedEpisodes.length;

	if (!allReleasedWatched) {
		return MediaStatus.Watching;
	}

	// Every released episode has been watched — is the show done, or is more coming?
	if (media.tvStatus && ENDED_TV_STATUSES.has(media.tvStatus)) {
		return MediaStatus.Completed;
	}
	if (!media.tvStatus) {
		// No TMDB status on record — nothing indicates more episodes are
		// coming, so treat it the same as "no remaining released episodes".
		return MediaStatus.Completed;
	}

	// Returning Series / In Production / Planned / Pilot / any other non-ended
	// value: more episodes are coming, but is a specific one already on the
	// calendar, or are we in a gap between seasons with nothing scheduled?
	// We distinguish using data we already have — a future-dated Episode
	// record — rather than adding a new field: if TMDB has already told us
	// about an upcoming episode, the user is caught up on an actively airing
	// season (Up To Date); if not, they're in the gap waiting on a renewal
	// (Waiting for New Season).
	const hasScheduledFutureEpisode = ctx.episodes.some((e) => e.airDate !== null && new Date(e.airDate).getTime() > now.getTime());
	return hasScheduledFutureEpisode ? MediaStatus.UpToDate : MediaStatus.WaitingForNewSeason;
}

/**
 * Fetches everything calculateMediaStatus needs for one media item,
 * recalculates, and persists the new status IF it actually changed (never
 * writes/bumps the repository version on a no-op).
 *
 * This is the function every mutation path should call — see the call
 * sites in watch-session-service.ts, episode-repository mark-watched
 * wrappers, the TV Time importer, and trakt-sync.ts.
 */
export async function recalculateAndPersistStatus(
	storage: StorageService,
	mediaId: string,
	now: Date = new Date()
): Promise<MediaStatus | null> {
	const media = await storage.media.findById(mediaId);
	if (!media) return null;

	const [sessions, episodes, episodeProgress] = await Promise.all([
		storage.watchSessions.findByMediaId(mediaId),
		storage.episodes.findByMediaId(mediaId),
		storage.episodeProgress.findByMediaId(mediaId),
	]);

	const newStatus = calculateMediaStatus(media, { sessions, episodes, episodeProgress }, now);

	if (newStatus !== media.status) {
		await storage.media.update(mediaId, { status: newStatus });
	}

	return newStatus;
}
