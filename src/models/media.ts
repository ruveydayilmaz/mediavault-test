import { MediaVaultId, ISODateString, CastMember, CrewMember, ProductionCompany } from "../types/common";
import { MediaType, MediaStatus } from "../types/enums";

/**
 * The core library entry. Represents a single movie or TV show (or, in the
 * future, book/game/anime) tracked in the user's vault.
 *
 * Watch history/reviews live separately in WatchSession records linked by id
 * (see review.ts) — a MediaItem never stores a single "the review", since
 * rewatches must never overwrite prior reviews.
 *
 * Episode-level data for TV shows lives in episode.ts (EpisodeProgress),
 * linked by mediaId.
 *
 * Mood/comfort metadata lives in comfort.ts (ComfortProfile), linked by
 * mediaId — kept separate because it's optional and edited independently of
 * core metadata.
 */
export interface MediaItem {
	/** Internal MediaVault id (uuid) */
	id: MediaVaultId;

	/** TMDB numeric id, used for re-fetching/refreshing metadata */
	tmdbId: number;

	/**
	 * External ids from other services (TVDB, IMDb, and TV Time's own item
	 * uuid), captured when import sources provide them so re-importing the
	 * same history later can match locally by id instead of re-searching
	 * TMDB by title+year every time. All optional — native TMDB adds never
	 * populate these.
	 */
	tvdbId?: number | null;
	imdbId?: string | null;
	tvTimeUuid?: string | null;

	type: MediaType;

	title: string;
	originalTitle: string | null;

	/** Release year (first air year for TV) */
	year: number | null;

	/** Full ISO release date (movie release date / TV first-air date) where TMDB provides one. Powers the Watch Next "Upcoming Movies" tab; year alone can't tell "already out" from "coming next month" within the same year. */
	releaseDate: string | null;

	genres: string[];

	/** Runtime in minutes. For TV, this is typically average episode runtime. */
	runtime: number | null;

	posterPath: string | null;
	backdropPath: string | null;

	cast: CastMember[];
	crew: CrewMember[];
	productionCompanies: ProductionCompany[];

	language: string | null;
	country: string | null;

	/** Streaming availability, optional, populated by future integration */
	streamingAvailability?: string[];

	synopsis: string | null;

	status: MediaStatus;

	/**
	 * Optional note on why the user dropped this show (Milestone 3:
	 * Dropped TV Series). Set only when dropping via the "Why did you stop
	 * watching?" prompt — stays populated across a later "Resume Watching"
	 * until the user explicitly removes or edits it, since resuming only
	 * changes `status`, not this field.
	 */
	droppedReason: string | null;

	/**
	 * A lightweight "favorited" tag, distinct from `status`. Kept separate
	 * from MediaStatus.Favorite (which is a manual-override status value)
	 * because favoriting shouldn't freeze a movie/show out of the automatic
	 * Plan to Watch / Watching / Finished / Waiting for New Season
	 * lifecycle — you can favorite something you're still watching.
	 */
	isFavorite: boolean;

	/** "Liked" is TV Time's own separate concept from favoriting — imported as lightweight preserved metadata. */
	liked: boolean;
	likedAt: string | null;

	/**
	 * TMDB's raw TV show status (e.g. "Returning Series", "Ended", "Canceled",
	 * "In Production", "Planned", "Pilot"). Movie-only items leave this null.
	 * Used by StatusService to distinguish "Finished" from "Waiting for New
	 * Season" once every released episode has been watched.
	 */
	tvStatus: string | null;

	/** Free-form user notes, distinct from watch-session reviews */
	notes: string;

	/** User-defined tags, separate from comfort/trigger tags */
	tags: string[];

	/** Cached aggregate rating computed from WatchSession ratings (see analytics) */
	averageRating: number | null;

	/** Total number of times this media has been watched (watch session count) */
	watchCount: number;

	/**
	 * Cached aggregate: the most recent `watchDate` across this item's
	 * WatchSessions, or null if it has none yet. Kept in sync alongside
	 * averageRating/watchCount by watch-session-service's
	 * syncMediaAggregates — powers "Recent" sorting (roadmap Milestone 5)
	 * without every sort needing to join against the session collection.
	 */
	lastWatchedDate: ISODateString | null;

	/**
	 * Last time the user did *anything* with this media — episode watches,
	 * rewatches, season/series completion, movie watches/rewatches, or
	 * partial movie progress updates. Drives "Recent" library sorting.
	 * Deliberately separate from `lastWatchedDate`, which only reflects
	 * completed WatchSessions (Watch History) and must stay that way.
	 * Updated via `touchMediaActivity` in activity-service.ts — never
	 * write this field directly from elsewhere.
	 */
	lastActivityAt: ISODateString | null;

	/** Path to the generated markdown note, if auto-create-notes is enabled */
	notePath: string | null;

	/**
	 * ISO timestamp of the last time episode metadata was fetched from TMDB
	 * for this show (Milestone 9: Automatic TMDB Episode Synchronization).
	 * Null means "never imported" — which is exactly the signal that
	 * triggers the first-open auto-import. Movies leave this null forever.
	 */
	episodesLastSyncedAt: ISODateString | null;

	createdAt: ISODateString;
	updatedAt: ISODateString;
}

/** Fields required to create a new MediaItem before defaults are applied. */
export type NewMediaItemInput = Pick<MediaItem, "tmdbId" | "type" | "title"> &
	Partial<Omit<MediaItem, "id" | "tmdbId" | "type" | "title" | "createdAt" | "updatedAt">>;
