import type { StorageService } from "./storage";
import type { TMDBService } from "../api/tmdb";
import { Episode } from "../models/episode";
import { MediaItem } from "../models/media";
import { MediaStatus } from "../types/enums";
import { TMDBNormalizedEpisode } from "../types/tmdb";

/** Converts a normalized TMDB episode into a storable Episode record (still missing id/mediaId). */
export function tmdbEpisodeToEpisodeInput(
	mediaId: string,
	ep: TMDBNormalizedEpisode
): Omit<Episode, "id"> {
	return {
		mediaId,
		tmdbEpisodeId: ep.tmdbEpisodeId,
		seasonNumber: ep.seasonNumber,
		episodeNumber: ep.episodeNumber,
		title: ep.title,
		runtime: ep.runtime,
		airDate: ep.airDate,
		synopsis: ep.synopsis,
		thumbnailPath: ep.thumbnailPath,
		tmdbRating: ep.tmdbRating,
	};
}

/**
 * Given already-fetched normalized episodes and the current local episode
 * set for a show, returns which ones are genuinely new (by season+episode
 * number) — this is what keeps re-running an import idempotent instead of
 * creating duplicates every time metadata is refreshed.
 */
export function diffNewEpisodes(
	incoming: Omit<Episode, "id">[],
	existing: Episode[]
): Omit<Episode, "id">[] {
	const existingKeys = new Set(existing.map((e) => `${e.seasonNumber}:${e.episodeNumber}`));
	return incoming.filter((e) => !existingKeys.has(`${e.seasonNumber}:${e.episodeNumber}`));
}

export interface EpisodeImportResult {
	seasonsProcessed: number;
	episodesAdded: number;
	episodesSkipped: number;
}

/**
 * Fetches all seasons/episodes for a TV show from TMDB and saves any that
 * aren't already tracked locally. Existing Episode records (and, crucially,
 * their linked EpisodeProgress watched-state) are left completely
 * untouched — this only ever adds new episodes, never overwrites.
 */
export async function importEpisodesForShow(
	storage: StorageService,
	tmdb: TMDBService,
	media: MediaItem
): Promise<EpisodeImportResult> {
	const details = await tmdb.getTV(media.tmdbId);
	const seasons = details.seasons ?? [];

	const existing = await storage.episodes.findByMediaId(media.id);

	let episodesAdded = 0;
	let episodesSkipped = 0;

	for (const season of seasons) {
		const tmdbEpisodes = await tmdb.getEpisodes(media.tmdbId, season.seasonNumber);
		const inputs = tmdbEpisodes.map((ep) => tmdbEpisodeToEpisodeInput(media.id, ep));
		const freshExisting = await storage.episodes.findByMediaId(media.id);
		const toAdd = diffNewEpisodes(inputs, freshExisting);

		for (const input of toAdd) {
			await storage.episodes.create(input);
			episodesAdded++;
		}
		episodesSkipped += inputs.length - toAdd.length;
	}

	// Milestone 9 (Automatic TMDB Episode Synchronization): every successful
	// import — first-time, manual "Refresh Episodes from TMDB", or an
	// automatic periodic refresh — stamps this, so `needsEpisodeSync` always
	// has an accurate "last fetched" time to compare against, regardless of
	// which of those three paths triggered it.
	await storage.media.update(media.id, { episodesLastSyncedAt: new Date().toISOString() });

	return { seasonsProcessed: seasons.length, episodesAdded, episodesSkipped };
}

/** Statuses considered "actively being watched" for the purposes of automatic periodic episode refresh. */
const ACTIVELY_WATCHING_STATUSES: ReadonlySet<MediaStatus> = new Set([MediaStatus.Watching, MediaStatus.Rewatching]);

/**
 * Decides whether a TV show's episode metadata should be auto-synced right
 * now (Milestone 9). Two independent triggers:
 *
 * - **Never imported** (`hasExistingEpisodes` is false): always sync,
 *   regardless of status — this is the "first time details are opened"
 *   case, and the user has no episode data to track at all otherwise.
 * - **Periodic refresh**: only for shows actively being watched, and only
 *   once `episodesLastSyncedAt` is further in the past than
 *   `intervalHours` — avoids refreshing Finished/Dropped/Plan to Watch
 *   shows (their episode list isn't going to change) and avoids hammering
 *   TMDB on every single modal open for an active show.
 */
export function needsEpisodeSync(
	media: Pick<MediaItem, "status" | "episodesLastSyncedAt">,
	hasExistingEpisodes: boolean,
	intervalHours: number,
	now: number = Date.now()
): boolean {
	if (!hasExistingEpisodes) return true;
	if (!ACTIVELY_WATCHING_STATUSES.has(media.status)) return false;
	if (!media.episodesLastSyncedAt) return true;

	const lastSynced = new Date(media.episodesLastSyncedAt).getTime();
	if (Number.isNaN(lastSynced)) return true;

	return now - lastSynced > intervalHours * 60 * 60 * 1000;
}
