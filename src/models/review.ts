import { MediaVaultId, ISODateString } from "../types/common";
import { Mood, WatchSource } from "../types/enums";

/**
 * A single watch of a piece of media. A MediaItem can have unlimited
 * WatchSessions — rewatches always create a NEW session; existing sessions
 * are never overwritten. This is what powers the rating-evolution /
 * "how my opinion changed over time" feature.
 *
 * For TV shows, a WatchSession can optionally represent a full
 * series/season rewatch; per-episode state lives in EpisodeProgress.
 */
export interface WatchSession {
	id: MediaVaultId;
	mediaId: MediaVaultId;

	/** When the watch began */
	watchDate: ISODateString;

	/** When the watch was finished (may equal watchDate for a single sitting) */
	completedDate: ISODateString | null;

	/** Rating on whatever scale the user has configured (normalized to 0-100 internally is an option; kept raw here) */
	rating: number | null;

	/** Free-text review for this specific watch */
	review: string;

	mood: Mood | null;

	/** Free-text context, e.g. "watched with family", "rainy Sunday" */
	context: string | null;

	/**
	 * 0 for the first watch, 1 for the first rewatch, 2 for the second
	 * rewatch, etc. Derived/validated by the repository layer but stored
	 * for fast reads.
	 */
	rewatchNumber: number;

	watchSource: WatchSource | null;

	tags: string[];

	/**
	 * Set only on sessions auto-created from marking a TV episode watched
	 * (Milestone 2: Automatic Watch Logs) — links the session back to the
	 * specific episode that generated it, so a season/series mark-watched
	 * doesn't need to guess which of a show's many sessions came from
	 * which episode. Null for movie sessions and manually-logged/show-level
	 * watches, which have no single episode to point to.
	 */
	episodeId: MediaVaultId | null;

	/**
	 * Tracks whether this session originated from an external sync (e.g.
	 * Trakt) and, if so, a stable identifier from that source — used to
	 * avoid re-importing the same watch as a duplicate on every sync run.
	 * null/null for sessions created directly in MediaVault.
	 */
	externalSource: "trakt" | null;
	externalRef: string | null;

	createdAt: ISODateString;
	updatedAt: ISODateString;
}

export type NewWatchSessionInput = Pick<WatchSession, "mediaId" | "watchDate"> &
	Partial<Omit<WatchSession, "id" | "mediaId" | "watchDate" | "rewatchNumber" | "createdAt" | "updatedAt">>;

/** Derived view used by the review timeline / rating evolution chart. */
export interface RatingEvolutionPoint {
	watchSessionId: MediaVaultId;
	rewatchNumber: number;
	watchDate: ISODateString;
	rating: number | null;
}
