import { MediaVaultId, ISODateString } from "../types/common";

/**
 * Static episode metadata, typically imported from TMDB and cached locally.
 * Separate from EpisodeProgress so re-fetching metadata never touches the
 * user's watched state.
 */
export interface Episode {
	id: MediaVaultId;
	mediaId: MediaVaultId; // parent TV show

	tmdbEpisodeId: number | null;
	seasonNumber: number;
	episodeNumber: number;

	title: string;
	runtime: number | null;
	airDate: ISODateString | null;
	synopsis: string | null;
	thumbnailPath: string | null;

	/** TMDB community rating, distinct from the user's own rating below */
	tmdbRating: number | null;
}

/**
 * The user's per-episode watched state and rating/review. Kept separate
 * from Episode (static metadata) so watched-state persists cleanly across
 * metadata refreshes.
 */
export interface EpisodeProgress {
	id: MediaVaultId;
	mediaId: MediaVaultId;
	episodeId: MediaVaultId;

	seasonNumber: number;
	episodeNumber: number;

	watched: boolean;
	watchedDate: ISODateString | null;

	rating: number | null;
	review: string | null;

	/**
	 * One selected reaction emoji for this watch (Milestone 1: Episode
	 * Details Experience). Additive-optional — null for every pre-existing
	 * record and for anything imported/synced, since neither TV Time nor
	 * Trakt has an equivalent concept.
	 */
	emotion: string | null;

	/** Marked via the Comfort Finder / favorite-episode workflow */
	isFavorite: boolean;

	/** TV Time's separate "liked" concept, imported as lightweight preserved metadata. */
	liked: boolean;
	likedAt: string | null;

	/** e.g. "low stress", "high energy", "emotional but uplifting" */
	comfortNote: string | null;

	updatedAt: ISODateString;
}

/** Aggregate progress for a season, computed from EpisodeProgress records. */
export interface SeasonProgress {
	seasonNumber: number;
	totalEpisodes: number;
	watchedEpisodes: number;
	percentWatched: number; // 0-100
	totalRuntimeWatched: number; // minutes
}

/** Aggregate progress for an entire show. */
export interface ShowProgress {
	mediaId: MediaVaultId;
	seasons: SeasonProgress[];
	totalEpisodes: number;
	watchedEpisodes: number;
	remainingEpisodes: number;
	percentWatched: number;
	totalRuntimeWatched: number;
}
